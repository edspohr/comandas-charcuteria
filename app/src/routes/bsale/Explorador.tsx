import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '@/data/firebase';
import { useProducts } from '@/data/products';
import { useAllStock } from '@/data/stock';
import { useBsaleVariants, useCatalogMap } from '@/data/catalogMap';
import { bsaleGet } from '@/data/bsaleAdmin';
import { DOCUMENTS_PATH, isRealBsale } from '@/integrations/bsale/client';
import type { BsaleDocument } from '@/integrations/bsale/BsaleClient';
import DataTable, { Pill } from '@/components/ui/DataTable';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { downloadCsv } from '@/lib/csv';
import { formatQty } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';
import { callableMessage } from '@/data/userAdmin';

// Ventana a Bsale (perfil Consultor, también administración). Solo lectura:
// lee los espejos que mantiene el servidor (documentos, stock, catálogo) y
// permite consultas GET directas a la API. Todo exportable a CSV.

type Tab = 'ventas' | 'stock' | 'documentos' | 'api';
type Range = 7 | 30 | 90;

// The real mirror carries seller/office/details with variant ids; the mock
// documents are a subset. Optional fields cover both.
interface Doc extends BsaleDocument {
  sellerName?: string; officeName?: string; docTypeName?: string; state?: number; netCLP?: number;
}

const DAY = 24 * 60 * 60 * 1000;
const GOLD = '#a8834a';
const TOOLTIP = { fontSize: 12, borderRadius: 6, border: '1px solid #e5e2dd' };
const isSale = (d: Doc) => (d.state ?? 0) === 0 && (d.type === 'factura' || d.type === 'boleta');

function useDocuments(sinceMs: number) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const path = DOCUMENTS_PATH.join('/');
  useEffect(() => {
    setLoading(true);
    return onSnapshot(query(collection(db, path), where('emittedAt', '>=', sinceMs), orderBy('emittedAt', 'desc'), limit(5000)),
      (s) => { const l: Doc[] = []; s.forEach((d) => l.push(d.data() as Doc)); setDocs(l); setLoading(false); },
      () => setLoading(false));
  }, [path, sinceMs]);
  return { docs, loading };
}

export default function Explorador() {
  const [tab, setTab] = useState<Tab>('ventas');
  const [range, setRange] = useState<Range>(30);
  // Rounded to the hour so the query (and its listener) stays stable.
  const since = useMemo(() => Math.floor((Date.now() - range * DAY) / 3600000) * 3600000, [range]);
  const { docs, loading } = useDocuments(since);

  return (
    <div>
      <header className="mb-4 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">Consulta · solo lectura · {isRealBsale ? 'Bsale real' : 'Bsale simulado'}</p>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Ventana a Bsale</h1>
          <p className="text-xs text-charcoal-300 mt-1">Lo que Bsale registra, tal cual: ventas por mesón y por pedido, stock por sucursal y documentos.</p>
        </div>
        {(tab === 'ventas' || tab === 'documentos') && (
          <div className="flex gap-1">
            {([7, 30, 90] as Range[]).map((r) => (
              <button key={r} onClick={() => setRange(r)} className={'rounded-md px-3 py-1.5 text-[11px] uppercase tracking-display border ' + (range === r ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500')}>{r} días</button>
            ))}
          </div>
        )}
      </header>
      <nav className="mb-4 flex gap-1 border-b border-charcoal-100 overflow-x-auto">
        {([['ventas', 'Ventas'], ['stock', 'Stock'], ['documentos', 'Documentos'], ['api', 'Consulta API']] as Array<[Tab, string]>).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={'px-4 py-2.5 text-xs uppercase tracking-display font-medium border-b-2 transition -mb-px whitespace-nowrap ' + (t === tab ? 'border-brass-500 text-charcoal-900' : 'border-transparent text-charcoal-300 hover:text-charcoal-500')}>{label}</button>
        ))}
      </nav>
      {loading && (tab === 'ventas' || tab === 'documentos') && <p className="text-sm text-charcoal-300">Cargando documentos…</p>}
      {tab === 'ventas' && !loading && <Ventas docs={docs} range={range} />}
      {tab === 'stock' && <Stock />}
      {tab === 'documentos' && !loading && <Documentos docs={docs} range={range} />}
      {tab === 'api' && <ConsultaApi />}
    </div>
  );
}

// ---------- Ventas ----------

interface Group { key: string; name: string; docs: number; totalCLP: number; quantity?: number }

function groupBy(docs: Doc[], keyOf: (d: Doc) => string, nameOf: (d: Doc) => string): Group[] {
  const m = new Map<string, Group>();
  for (const d of docs) {
    const k = keyOf(d) || '—';
    const g = m.get(k) ?? { key: k, name: nameOf(d) || '—', docs: 0, totalCLP: 0 };
    g.docs++; g.totalCLP += d.totalCLP;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.totalCLP - a.totalCLP);
}

function Ventas({ docs, range }: { docs: Doc[]; range: Range }) {
  const variants = useBsaleVariants();
  const label = useMemo(() => new Map(variants.map((v) => [v.variantId, v.label])), [variants]);
  const sales = useMemo(() => docs.filter(isSale), [docs]);
  const total = sales.reduce((s, d) => s + d.totalCLP, 0);
  const period = `Últimos ${range} días`;

  const series = useMemo(() => {
    const m = new Map<string, { date: string; totalCLP: number; docs: number }>();
    for (let i = range - 1; i >= 0; i--) { const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10); m.set(d, { date: d, totalCLP: 0, docs: 0 }); }
    for (const d of sales) { const r = m.get(d.emissionDate); if (r) { r.totalCLP += d.totalCLP; r.docs++; } }
    return [...m.values()].map((r) => ({ ...r, label: r.date.slice(8, 10) + '/' + r.date.slice(5, 7) }));
  }, [sales, range]);

  const bySeller = useMemo(() => groupBy(sales, (d) => d.sellerName ?? '', (d) => d.sellerName ?? 'Sin vendedor'), [sales]);
  const byOffice = useMemo(() => groupBy(sales, (d) => String(d.officeId), (d) => d.officeName ?? `Sucursal ${d.officeId}`), [sales]);
  const byClient = useMemo(() => groupBy(sales, (d) => d.clientRut ?? d.clientName, (d) => d.clientName), [sales]);
  const byProduct = useMemo(() => {
    const m = new Map<string, Group>();
    for (const d of sales) for (const it of d.details) {
      const k = it.variantId || it.sku;
      const g = m.get(k) ?? { key: k, name: label.get(it.variantId) ?? it.description ?? k, docs: 0, totalCLP: 0, quantity: 0 };
      g.docs++; g.quantity = (g.quantity ?? 0) + it.quantity;
      g.totalCLP += (it as { totalCLP?: number }).totalCLP ?? Math.round(it.netUnitValue * it.quantity * 1.19);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.totalCLP - a.totalCLP);
  }, [sales, label]);

  const cols = [['name', 'Nombre'], ['docs', 'Documentos'], ['totalCLP', 'Total CLP']] as const;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label="Ventas (facturas + boletas)" value={formatCLP(total)} />
        <Kpi label="Documentos" value={String(sales.length)} />
        <Kpi label="Ticket promedio" value={sales.length ? formatCLP(Math.round(total / sales.length)) : '—'} />
        <Kpi label="Clientes con compra" value={String(byClient.filter((c) => c.key !== '—').length)} />
      </div>
      <section className="card p-4">
        <div className="flex justify-between items-center mb-2"><p className="eyebrow">Ventas por día</p><Csv name="bsale-ventas-dia" rows={series} cols={[['date', 'Fecha'], ['docs', 'Documentos'], ['totalCLP', 'Total CLP']]} period={period} /></div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e2dd" vertical={false} />
            <XAxis dataKey="label" stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round((v as number) / 1000)}k`} />
            <Tooltip contentStyle={TOOLTIP} formatter={(v) => [formatCLP(v as number), 'Ventas']} />
            <Line type="monotone" dataKey="totalCLP" stroke={GOLD} strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <GroupTable title="Por vendedor (Bsale)" name="bsale-ventas-vendedor" rows={bySeller} cols={cols} period={period} />
        <GroupTable title="Por sucursal" name="bsale-ventas-sucursal" rows={byOffice} cols={cols} period={period} />
        <GroupTable title="Por cliente" name="bsale-ventas-cliente" rows={byClient} cols={cols} period={period} />
        <GroupTable title="Por producto" name="bsale-ventas-producto" rows={byProduct} cols={[['name', 'Producto'], ['quantity', 'Cantidad'], ['totalCLP', 'Total CLP']]} period={period} />
      </div>
    </div>
  );
}

function GroupTable({ title, name, rows, cols, period }: { title: string; name: string; rows: Group[]; cols: ReadonlyArray<readonly [string, string]>; period: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <section className="card p-4">
      <div className="flex justify-between items-center mb-2"><p className="eyebrow">{title}</p><Csv name={name} rows={rows} cols={cols} period={period} /></div>
      <ul className="divide-y divide-charcoal-100/70 text-sm">
        {shown.length === 0 && <li className="py-2 text-xs text-charcoal-300">Sin datos.</li>}
        {shown.map((r) => (
          <li key={r.key} className="py-1.5 flex justify-between gap-3">
            <span className="text-charcoal-700 truncate">{r.name}</span>
            <span className="shrink-0 tabular-nums"><span className="text-charcoal-300 text-xs mr-2">{r.quantity != null ? formatQty(r.quantity, 'unidad') : `${r.docs} doc.`}</span><span className="font-semibold text-charcoal-900">{formatCLP(r.totalCLP)}</span></span>
          </li>
        ))}
      </ul>
      {rows.length > 10 && <button onClick={() => setAll(!all)} className="mt-2 text-xs underline text-charcoal-500">{all ? 'Ver menos' : `Ver los ${rows.length}`}</button>}
    </section>
  );
}

// ---------- Stock ----------

function Stock() {
  const { products } = useProducts();
  const { stock } = useAllStock();
  const map = useCatalogMap();
  const variants = useBsaleVariants();
  const [q, setQ] = useState('');
  const confirmed = useMemo(() => new Map(map.filter((m) => m.status === 'confirmado' && m.productId).map((m) => [`${m.productId}__${m.formatId}`, m.variantId])), [map]);
  const vById = useMemo(() => new Map(variants.map((v) => [v.variantId, v])), [variants]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.flatMap((p) => p.formats.map((f) => {
      const k = `${p.id}__${f.formatId}`;
      const s = stock.get(k);
      const v = vById.get(confirmed.get(k) ?? '');
      return { key: k, product: p.name, format: f.label, unit: f.unit, code: v?.code ?? '', factory: s?.onHand ?? 0, store: s?.storeOnHand, reserved: s?.reserved ?? 0, available: Math.max(0, (s?.onHand ?? 0) - (s?.reserved ?? 0)), mapped: !!v || !isRealBsale };
    })).filter((r) => !needle || `${r.product} ${r.format} ${r.code}`.toLowerCase().includes(needle));
  }, [products, stock, confirmed, vById, q]);
  const unmapped = rows.filter((r) => !r.mapped).length;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Producto, formato o código Bsale" className="field h-9 text-sm w-full sm:w-72" />
        {isRealBsale && unmapped > 0 && <Pill tone="warn">{unmapped} formatos sin cruce con Bsale</Pill>}
        <span className="ml-auto"><Csv name="bsale-stock" rows={rows} cols={[['product', 'Producto'], ['format', 'Formato'], ['code', 'Código Bsale'], ['factory', 'Fábrica'], ['store', 'Tienda'], ['reserved', 'Reservado app'], ['available', 'Disponible']]} /></span>
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => r.key}
        dense
        columns={[
          { key: 'p', label: 'Producto', mobile: true, render: (r) => <div><p className="font-semibold text-charcoal-900">{r.product}</p><p className="text-[11px] text-charcoal-300">{r.format}{r.code ? ` · ${r.code}` : ''}</p></div> },
          { key: 'f', label: 'Fábrica', align: 'right', mobile: true, render: (r) => formatQty(r.factory, r.unit) },
          { key: 's', label: 'Tienda', align: 'right', render: (r) => (r.store != null ? formatQty(r.store, r.unit) : '—'), muted: true },
          { key: 'r', label: 'Reservado', align: 'right', render: (r) => formatQty(r.reserved, r.unit), muted: true },
          { key: 'a', label: 'Disponible', align: 'right', mobile: true, render: (r) => <span className={r.factory < r.reserved ? 'text-red-700 font-semibold' : 'font-semibold'}>{r.factory < r.reserved ? 'comprometido' : formatQty(r.available, r.unit)}</span> },
        ]}
      />
    </div>
  );
}

// ---------- Documentos (conciliación) ----------

function Documentos({ docs, range }: { docs: Doc[]; range: Range }) {
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'todos' | 'sin_pedido' | 'con_pedido'>('todos');
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return docs.filter((d) => {
      if (only === 'sin_pedido' && d.linkedOrderId) return false;
      if (only === 'con_pedido' && !d.linkedOrderId) return false;
      return !needle || `${d.number} ${d.clientName} ${d.clientRut ?? ''} ${d.reference ?? ''} ${d.sellerName ?? ''}`.toLowerCase().includes(needle);
    });
  }, [docs, q, only]);
  const sales = docs.filter(isSale);
  const linked = sales.filter((d) => d.linkedOrderId);
  const pct = sales.length ? Math.round((linked.length / sales.length) * 100) : 0;
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        <Kpi label="Ventas en Bsale" value={String(sales.length)} />
        <Kpi label="Vinculadas a un pedido" value={`${linked.length} · ${pct}%`} />
        <Kpi label="Fuera de Comandas" value={formatCLP(sales.filter((d) => !d.linkedOrderId).reduce((s, d) => s + d.totalCLP, 0))} />
      </div>
      <p className="text-xs text-charcoal-500 mb-3">"Fuera de Comandas" son ventas emitidas en Bsale sin pedido en la app: mesón de la tienda o pedidos que todavía entran por WhatsApp. Es el indicador de adopción.</p>
      <div className="mb-3 flex flex-wrap gap-2 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número, cliente, RUT, vendedor o referencia" className="field h-9 text-sm w-full sm:w-80" />
        {([['todos', 'Todos'], ['sin_pedido', 'Sin pedido'], ['con_pedido', 'Con pedido']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setOnly(k)} className={'rounded-md px-2.5 py-1.5 text-[11px] uppercase tracking-display border ' + (only === k ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500')}>{l}</button>
        ))}
        <span className="ml-auto"><Csv name="bsale-documentos" rows={rows.map((d) => ({ ...d, details: d.details.length }))} cols={[['number', 'Número'], ['type', 'Tipo'], ['emissionDate', 'Fecha'], ['officeName', 'Sucursal'], ['sellerName', 'Vendedor'], ['clientName', 'Cliente'], ['clientRut', 'RUT'], ['totalCLP', 'Total CLP'], ['reference', 'Referencia'], ['linkedOrderId', 'Pedido Comandas']]} period={`Últimos ${range} días`} /></span>
      </div>
      <DataTable<Doc>
        rows={rows}
        rowKey={(d) => d.id}
        dense
        columns={[
          { key: 'n', label: 'Documento', mobile: true, render: (d) => <div><p className="font-mono text-charcoal-900">{d.number}</p><p className="text-[11px] text-charcoal-300">{d.emissionDate}{d.officeName ? ` · ${d.officeName}` : ''}</p></div> },
          { key: 'c', label: 'Cliente', render: (d) => <div><p className="text-charcoal-700 truncate">{d.clientName}</p><p className="text-[11px] text-charcoal-300">{d.clientRut ?? ''}</p></div> },
          { key: 's', label: 'Vendedor', render: (d) => d.sellerName ?? '—', muted: true },
          { key: 't', label: 'Total', align: 'right', mobile: true, render: (d) => <span className="font-semibold">{formatCLP(d.totalCLP)}</span> },
          { key: 'l', label: 'Pedido', mobile: true, render: (d) => d.linkedOrderId ? <Pill tone="ok">{d.linkedOrderId}</Pill> : isSale(d) ? <Pill tone="warn">sin pedido</Pill> : <Pill tone="muted">{d.type}</Pill> },
        ]}
        expand={(d) => (
          <ul className="text-xs text-charcoal-700 space-y-0.5">
            {d.details.map((it, i) => <li key={i} className="flex justify-between gap-3"><span>{it.description || it.sku || it.variantId}</span><span className="tabular-nums">{it.quantity} × {formatCLP(Math.round(it.netUnitValue * 1.19))}</span></li>)}
            {d.reference && <li className="text-charcoal-500">Referencia: {d.reference}</li>}
          </ul>
        )}
      />
    </div>
  );
}

// ---------- Consulta directa ----------

const PRESETS = ['/v1/offices.json', '/v1/document_types.json', '/v1/price_lists.json', '/v1/users.json', '/v1/products.json?limit=5', '/v1/stocks.json?limit=5', '/v1/documents.json?limit=3&expand=[details,client]'];

function ConsultaApi() {
  const [path, setPath] = useState(PRESETS[0]);
  const [out, setOut] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true); setError(null);
    try { setOut(await bsaleGet(path.trim())); } catch (e) { setError(callableMessage(e)); setOut(null); } finally { setBusy(false); }
  }
  if (!isRealBsale) return <div className="card p-4 text-sm text-charcoal-500">La consulta directa a la API se habilita en modo Bsale real.</div>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-charcoal-500">Consulta GET a la API de Bsale con el token del servidor. No modifica nada.</p>
      <div className="flex gap-2 flex-wrap">
        <input value={path} onChange={(e) => setPath(e.target.value)} className="field h-10 text-sm font-mono flex-1 min-w-0" onKeyDown={(e) => { if (e.key === 'Enter') void run(); }} />
        <Button onClick={run} disabled={busy}>{busy ? 'Consultando…' : 'Consultar'}</Button>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {PRESETS.map((p) => <button key={p} onClick={() => setPath(p)} className="rounded border border-charcoal-200 bg-white px-2 py-1 text-[11px] font-mono text-charcoal-500 hover:border-charcoal-300">{p.replace('/v1/', '')}</button>)}
      </div>
      {error && <ErrorBanner message={error} />}
      {out != null && <pre className="rounded-md bg-charcoal-900 text-cream-100 text-[11px] leading-relaxed p-3 overflow-auto max-h-[60vh]">{JSON.stringify(out, null, 2)}</pre>}
    </div>
  );
}

// ---------- bits ----------

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="card p-3"><p className="text-[10px] uppercase tracking-display text-charcoal-300">{label}</p><p className="text-lg font-semibold text-charcoal-900 mt-0.5">{value}</p></div>;
}

function Csv({ name, rows, cols, period }: { name: string; rows: Array<object>; cols: ReadonlyArray<readonly [string, string]>; period?: string }) {
  return <button onClick={() => downloadCsv(name, rows, cols.map(([key, label]) => ({ key, label })), period)} disabled={rows.length === 0} className="text-[11px] uppercase tracking-display text-charcoal-500 hover:text-charcoal-900 disabled:opacity-40">Exportar CSV</button>;
}
