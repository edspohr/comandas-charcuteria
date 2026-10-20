import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFactsIndex, useSalesFacts, useVariantStock, type SalesFacts } from '@/data/facts';
import { useBsaleSettings, useDiagnostic } from '@/data/bsaleAdmin';
import { useBsaleVariants, useCatalogMap } from '@/data/catalogMap';
import { useProducts } from '@/data/products';
import { useSyncState } from '@/data/stock';
import { isRealBsale } from '@/integrations/bsale/client';
import { formatCLP } from '@/lib/pricing';
import { todayInSantiago } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';
import {
  addDays, clientRows, compareRange, concentration, delta, fmtRange, monthsOf, periodRange, pickDocs, pickLines, pivot, productRows,
  sellerRows, seasonality, series, stockAnalysis, totals, byKind, byWeekday, variantDims, dimOf,
  CLIENT_STATUS_LABEL, KIND_LABEL, PERIOD_LABEL, PIVOT_DIM_LABEL, PIVOT_MEASURE_LABEL, STOCK_FLAG_LABEL,
  type ClientRow, type ClientStatus, type CompareMode, type Filters, type PeriodKey, type PivotDim, type PivotMeasure,
  type ProductGroup, type ProductRow, type Range, type StockFlag, type VariantDim,
} from '@/domain/bsaleAnalytics';
import Button from '@/components/ui/Button';
import { Card, Export, Metric, Table, setExportPeriod } from '@/components/panel/PanelUI';
import PanelPedidos from './Panel';
import SamplesPanel from '@/components/panel/SamplesPanel';
import { useClients } from '@/data/clients';
import type { CatalogMapEntry } from '@/data/catalogMap';
import type { Purchase, SampleRow } from '@/domain/samples';

// Panel de gestión sobre las ventas reales de Bsale (facturas, boletas y
// notas de crédito de fábrica y tienda). Filtros globales arriba; cada
// pestaña va de la visión general al detalle, y cualquier fila de cliente o
// producto abre su ficha a la derecha. Sin Bsale real, el panel de pedidos.

type Tab = 'resumen' | 'ventas' | 'productos' | 'clientes' | 'vendedores' | 'stock' | 'muestras' | 'explorador' | 'pedidos';
const TABS: Array<[Tab, string]> = [
  ['resumen', 'Resumen'], ['ventas', 'Ventas'], ['productos', 'Productos'], ['clientes', 'Clientes'], ['vendedores', 'Vendedores'],
  ['stock', 'Stock'], ['muestras', 'Muestras'], ['explorador', 'Explorador'], ['pedidos', 'Pedidos'],
];
const GOLD = '#a8834a'; const WOOD = '#4d3b28'; const WOOD_LIGHT = '#b39776'; const GRID = '#e5e2dd'; const AXIS = '#8b8177';
const TOOLTIP = { borderRadius: 8, border: '1px solid #e5e2dd', fontSize: 12 };
const money = (v: number): string => (v < 0 ? `−${money(-v)}` : v >= 1_000_000 ? `$${(v / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} M` : `$${Math.round(v / 1000).toLocaleString('es-CL')} k`);
const num = (v: number, d = 0) => v.toLocaleString('es-CL', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const pct = (v: number | null | undefined, d = 0) => (v == null ? '—' : `${v.toLocaleString('es-CL', { maximumFractionDigits: d })}%`);
const deltaTxt = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v)}%`);
const dShort = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: '2-digit' });

type Detail = { kind: 'cliente'; id: string } | { kind: 'producto'; key: string; group: ProductGroup } | null;

export default function PanelGestion() {
  if (!isRealBsale) return <PanelPedidos />;
  return <Gestion />;
}

function Gestion() {
  const today = todayInSantiago();
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('tab') as Tab) || 'resumen');
  const [period, setPeriod] = useState<PeriodKey>('mes');
  const [compare, setCompare] = useState<CompareMode>('anio');
  const [officeId, setOfficeId] = useState<number | undefined>();
  const [sellerId, setSellerId] = useState<string | undefined>();
  const [detail, setDetail] = useState<Detail>(null);

  const { months: index, costs, loading: indexLoading } = useFactsIndex();
  const { settings } = useBsaleSettings();
  const diagnostic = useDiagnostic();
  const variants = useBsaleVariants();
  const map = useCatalogMap();
  const { products } = useProducts();
  const sync = useSyncState();

  const range = useMemo(() => periodRange(period, today), [period, today]);
  const cmpRange = useMemo(() => compareRange(range, compare, period), [range, compare, period]);
  // History for recency/frequency (13 months) is always loaded: ~13 reads,
  // cached for the session.
  const history: Range = useMemo(() => ({ from: addDays(today, -395), to: today }), [today]);
  const wanted = useMemo(() => monthsOf(range, cmpRange, history), [range, cmpRange, history]);
  const { facts, loading } = useSalesFacts(wanted, index);

  const dims = useMemo(() => variantDims(variants, map, products), [variants, map, products]);
  const officeName = useMemo(() => {
    const names = new Map((diagnostic?.offices ?? []).map((o) => [o.id, o.name]));
    return (id: number) => (id === settings.factoryOfficeId ? 'Fábrica' : id === settings.storeOfficeId ? 'Tienda' : names.get(id) ?? `Sucursal ${id}`);
  }, [diagnostic, settings.factoryOfficeId, settings.storeOfficeId]);
  const sellerName = (id: string) => (id === '0' ? 'Sin vendedor' : facts.sellers.get(id) ?? `Usuario ${id}`);
  const clientInfo = (id: string) => (id === '0' ? { name: 'Venta sin cliente (mesón)', rut: '' } : facts.clients.get(id) ?? { name: `Cliente ${id}`, rut: '' });

  const f: Filters = { officeId, sellerId };
  const cur = useMemo(() => ({ docs: pickDocs(facts.docs, range, f), lines: pickLines(facts.lines, range, f) }), [facts, range, officeId, sellerId]);
  const cmp = useMemo(() => ({ docs: pickDocs(facts.docs, cmpRange, f), lines: pickLines(facts.lines, cmpRange, f) }), [facts, cmpRange, officeId, sellerId]);
  const tCur = useMemo(() => totals(cur.docs, cur.lines, dims, costs), [cur, dims, costs]);
  const tCmp = useMemo(() => totals(cmp.docs, cmp.lines, dims, costs), [cmp, dims, costs]);
  const clients = useMemo(() => clientRows(facts.docs, range, cmpRange, today, f, sellerName, clientInfo), [facts, range, cmpRange, today, officeId, sellerId]);

  const periodTxt = `${PERIOD_LABEL[period]} (${fmtRange(range)}) vs ${compare === 'anio' ? 'año anterior' : 'período anterior'} (${fmtRange(cmpRange)})${officeId != null ? ` · ${officeName(officeId)}` : ''}${sellerId ? ` · ${sellerName(sellerId)}` : ''}`;
  setExportPeriod(periodTxt);

  const loadedAll = wanted.filter((m) => index[m]);
  const missing = wanted.filter((m) => m <= today.slice(0, 7) && !index[m]?.complete);
  const noData = !indexLoading && Object.keys(index).length === 0;
  const sellerOptions = [...facts.sellers.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  const offices = [settings.factoryOfficeId, settings.storeOfficeId].filter((x): x is number => !!x);

  const ctx: Ctx = { facts, dims, costs, range, cmpRange, today, cur, cmp, tCur, tCmp, clients, officeName, sellerName, clientInfo, compare, index, settings, open: setDetail, f };

  return (
    <div>
      <header className="mb-3 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">Gerencia</p>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Panel de gestión</h1>
          <p className="text-xs text-charcoal-300 mt-1">
            Ventas de Bsale (facturas + boletas − notas de crédito, neto) · {fmtRange(range)}
            {sync?.at ? ` · al día ${new Date(sync.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
          </p>
        </div>
      </header>

      {tab !== 'pedidos' && (
        <div className="card p-3 mb-3 flex flex-wrap items-center gap-2 lg:sticky lg:top-0 lg:z-10">
          <Seg value={period} onChange={setPeriod} options={(Object.keys(PERIOD_LABEL) as PeriodKey[]).map((k) => [k, PERIOD_LABEL[k]])} />
          <select className="field h-9 text-xs w-auto" value={compare} onChange={(e) => setCompare(e.target.value as CompareMode)} aria-label="Comparar con">
            <option value="anio">vs. año anterior</option>
            <option value="anterior">vs. período anterior</option>
          </select>
          <select className="field h-9 text-xs w-auto" value={officeId ?? ''} onChange={(e) => setOfficeId(e.target.value ? Number(e.target.value) : undefined)} aria-label="Sucursal">
            <option value="">Fábrica + tienda</option>
            {offices.map((o) => <option key={o} value={o}>{officeName(o)}</option>)}
          </select>
          <select className="field h-9 text-xs w-auto max-w-[12rem]" value={sellerId ?? ''} onChange={(e) => setSellerId(e.target.value || undefined)} aria-label="Vendedor">
            <option value="">Todos los vendedores</option>
            {sellerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          {loading && <span className="text-[11px] text-charcoal-300">Cargando {loadedAll.length} meses…</span>}
        </div>
      )}

      {noData && tab !== 'pedidos' && (
        <div className="rounded-md border border-brass-300 bg-brass-50 text-brass-700 text-sm p-3 mb-3">
          Aún no hay historia de ventas cargada. Un administrador la carga en <Link className="underline" to="/admin/bsale">Bsale → Conexión → Historia de ventas</Link> (2 años, unos minutos).
        </div>
      )}
      {!noData && missing.length > 0 && tab !== 'pedidos' && (
        <p className="text-[11px] text-brass-700 mb-3">Faltan meses por cargar ({missing.slice(0, 4).join(', ')}{missing.length > 4 ? '…' : ''}): las comparaciones pueden quedar incompletas. <Link className="underline" to="/admin/bsale">Cargar en Bsale → Conexión</Link>.</p>
      )}

      <nav className="mb-4 flex gap-1 border-b border-charcoal-100 overflow-x-auto">
        {TABS.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={'px-3.5 py-2.5 text-xs uppercase tracking-display font-medium border-b-2 transition -mb-px whitespace-nowrap ' + (t === tab ? 'border-brass-500 text-charcoal-900' : 'border-transparent text-charcoal-300 hover:text-charcoal-500')}>{label}</button>
        ))}
      </nav>

      {tab === 'resumen' && <Resumen {...ctx} />}
      {tab === 'ventas' && <Ventas {...ctx} />}
      {tab === 'productos' && <Productos {...ctx} />}
      {tab === 'clientes' && <Clientes {...ctx} />}
      {tab === 'vendedores' && <Vendedores {...ctx} />}
      {tab === 'stock' && <Stock {...ctx} />}
      {tab === 'muestras' && <Muestras {...ctx} map={map} />}
      {tab === 'explorador' && <Explorador {...ctx} />}
      {tab === 'pedidos' && <PanelPedidos embedded />}

      {detail && <DetailDrawer detail={detail} onClose={() => setDetail(null)} {...ctx} />}
    </div>
  );
}

interface Ctx {
  facts: SalesFacts; dims: Map<string, VariantDim>; costs: Record<string, number>; range: Range; cmpRange: Range; today: string;
  cur: { docs: SalesFacts['docs']; lines: SalesFacts['lines'] }; cmp: { docs: SalesFacts['docs']; lines: SalesFacts['lines'] };
  tCur: ReturnType<typeof totals>; tCmp: ReturnType<typeof totals>; clients: ClientRow[];
  officeName: (id: number) => string; sellerName: (id: string) => string; clientInfo: (id: string) => { name: string; rut: string };
  compare: CompareMode; index: ReturnType<typeof useFactsIndex>['months']; settings: ReturnType<typeof useBsaleSettings>['settings'];
  open: (d: Detail) => void; f: Filters;
}

// ---------- Resumen ----------

function Kpis({ tCur, tCmp }: Pick<Ctx, 'tCur' | 'tCmp'>) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
      <Metric label="Venta neta" value={money(tCur.net)} delta={delta(tCur.net, tCmp.net)} sub={`antes ${money(tCmp.net)}`} />
      <Metric label="Margen bruto" value={pct(tCur.marginPct, 1)} deltaUnit=" pts" delta={tCur.marginPct != null && tCmp.marginPct != null ? tCur.marginPct - tCmp.marginPct : null}
        sub={tCur.margin != null ? `${money(tCur.margin)} · costo en ${pct(tCur.costCoverage * 100)}` : 'sin costos en Bsale'} tone={tCur.costCoverage < 0.6 ? 'warn' : undefined} />
      <Metric label="Documentos" value={num(tCur.docs)} delta={delta(tCur.docs, tCmp.docs)} sub={tCur.creditNotes ? `${tCur.creditNotes} NC (${money(tCur.creditNet)})` : 'sin notas de crédito'} />
      <Metric label="Ticket promedio" value={money(tCur.ticket)} delta={delta(tCur.ticket, tCmp.ticket)} />
      <Metric label="Clientes" value={num(tCur.clients)} delta={delta(tCur.clients, tCmp.clients)} sub="con RUT (sin mesón)" />
      <Metric label="Kilos" value={`${num(tCur.kg)} kg`} delta={delta(tCur.kg, tCmp.kg)} sub={tCur.kgCoverage < 0.95 ? `kg conocidos en ${pct(tCur.kgCoverage * 100)}` : undefined} />
    </div>
  );
}

function Resumen(c: Ctx) {
  const season = useMemo(() => seasonality(c.index, c.today, c.settings.storeOfficeId, c.f.officeId), [c.index, c.today, c.settings.storeOfficeId, c.f.officeId]);
  const pts = useMemo(() => series(c.cur.docs, c.cmp.docs, c.range, c.cmpRange), [c.cur, c.cmp, c.range, c.cmpRange]);
  const prods = useMemo(() => productRows(c.cur.lines, c.cmp.lines, c.dims, c.costs, 'producto'), [c.cur, c.cmp, c.dims, c.costs]);
  const movers = useMemo(() => {
    const withDelta = prods.filter((p) => Math.abs(p.net - p.cmpNet) > 0).map((p) => ({ ...p, diff: p.net - p.cmpNet }));
    return { up: [...withDelta].sort((a, b) => b.diff - a.diff).slice(0, 5), down: [...withDelta].sort((a, b) => a.diff - b.diff).slice(0, 5) };
  }, [prods]);
  const toCall = useMemo(() => c.clients.filter((r) => r.status === 'en_riesgo' || r.status === 'perdido').sort((a, b) => b.net12 - a.net12).slice(0, 8), [c.clients]);
  const channel = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of c.cur.docs) m.set(d.officeId, (m.get(d.officeId) ?? 0) + d.net);
    return [...m.entries()].map(([id, net]) => ({ name: c.officeName(id), net })).sort((a, b) => b.net - a.net);
  }, [c.cur]);
  const cmpLabel = c.compare === 'anio' ? 'Año anterior' : 'Período anterior';

  return (
    <div className="space-y-4">
      <Kpis tCur={c.tCur} tCmp={c.tCmp} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Ventas: período vs comparación">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={pts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => money(v as number)} width={56} />
              <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => [formatCLP(v as number), n === 'cur' ? 'Período' : cmpLabel]} />
              <Legend formatter={(v) => (v === 'cur' ? 'Período' : cmpLabel)} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="cmp" stroke={WOOD_LIGHT} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              <Line type="monotone" dataKey="cur" stroke={GOLD} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Estacionalidad: últimos 12 meses vs año anterior">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={season} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" stroke={AXIS} fontSize={10} tickLine={false} axisLine={false} interval={0} />
              <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => money(v as number)} width={56} />
              <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => [v == null ? '—' : formatCLP(v as number), n === 'thisYear' ? 'Este año' : 'Año anterior']} />
              <Legend formatter={(v) => (v === 'thisYear' ? 'Este año' : 'Año anterior')} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="lastYear" fill={WOOD_LIGHT} radius={[2, 2, 0, 0]} />
              <Bar dataKey="thisYear" fill={WOOD} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Lo que más crece">
          <Movers rows={movers.up} open={c.open} />
        </Card>
        <Card title="Lo que más cae">
          <Movers rows={movers.down} open={c.open} />
        </Card>
        <Card title="Canal">
          <ul className="space-y-2 text-sm">
            {channel.map((ch) => (
              <li key={ch.name}>
                <div className="flex justify-between"><span className="text-charcoal-700">{ch.name}</span><span className="font-semibold tabular-nums">{money(ch.net)}</span></div>
                <div className="h-1.5 bg-charcoal-100 rounded mt-1"><div className="h-1.5 rounded bg-brass-500" style={{ width: `${c.tCur.net ? Math.max(0, (ch.net / c.tCur.net) * 100) : 0}%` }} /></div>
              </li>
            ))}
            {channel.length === 0 && <li className="text-xs text-charcoal-300">Sin ventas en el período.</li>}
          </ul>
        </Card>
      </div>
      <Table title="Clientes a llamar (dejaron de comprar a su ritmo habitual)" rows={toCall} onRow={(r) => c.open({ kind: 'cliente', id: r.id })}
        export={{ name: 'clientes-a-llamar', rows: c.clients.filter((r) => r.status === 'en_riesgo' || r.status === 'perdido') }}
        cols={[['name', 'Cliente'], ['seller', 'Vendedor'], ['last', 'Última compra', (v) => dShort(v as string)], ['interval', 'Compra cada', (v) => (v == null ? '—' : `${Math.round(v as number)} d`)], ['net12', 'Venta 12 m', (v) => formatCLP(v as number)], ['status', 'Estado', (v) => CLIENT_STATUS_LABEL[v as ClientStatus]]]}
        rowTone={(r) => (r.status === 'perdido' ? 'bad' : 'warn')} />
    </div>
  );
}

function Movers({ rows, open }: { rows: Array<ProductRow & { diff: number }>; open: Ctx['open'] }) {
  if (!rows.length) return <p className="text-xs text-charcoal-300">Sin cambios.</p>;
  return (
    <ul className="divide-y divide-charcoal-100 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="py-1.5 flex justify-between gap-2 cursor-pointer hover:bg-cream-100 -mx-1 px-1 rounded" onClick={() => open({ kind: 'producto', key: r.key, group: 'producto' })}>
          <span className="truncate text-charcoal-700">{r.name}</span>
          <span className={'tabular-nums font-semibold shrink-0 ' + (r.diff >= 0 ? 'text-emerald-700' : 'text-red-700')}>{r.diff >= 0 ? '+' : '−'}{money(Math.abs(r.diff))}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------- Ventas ----------

function Ventas(c: Ctx) {
  const pts = useMemo(() => series(c.cur.docs, c.cmp.docs, c.range, c.cmpRange), [c.cur, c.cmp, c.range, c.cmpRange]);
  const wd = useMemo(() => byWeekday(c.cur.docs), [c.cur]);
  const kinds = useMemo(() => byKind(c.cur.docs), [c.cur]);
  const nc = useMemo(() => {
    const m = new Map<string, { id: string; name: string; docs: number; net: number }>();
    for (const d of c.cur.docs) if (d.kind === 'nota_credito') { const r = m.get(d.clientId) ?? { id: d.clientId, name: c.clientInfo(d.clientId).name, docs: 0, net: 0 }; r.docs++; r.net += d.net; m.set(d.clientId, r); }
    return [...m.values()].sort((a, b) => a.net - b.net);
  }, [c.cur]);
  const monthly = useMemo(() => Object.entries(c.index).sort(([a], [b]) => b.localeCompare(a)).slice(0, 24).map(([m, e]) => ({
    month: m, net: e.net ?? 0, factory: c.settings.factoryOfficeId ? e.netByOffice?.[String(c.settings.factoryOfficeId)] ?? 0 : 0,
    store: c.settings.storeOfficeId ? e.netByOffice?.[String(c.settings.storeOfficeId)] ?? 0 : 0, docs: e.docCount,
    yoy: delta(e.net ?? 0, c.index[`${Number(m.slice(0, 4)) - 1}-${m.slice(5)}`]?.net ?? 0),
  })), [c.index, c.settings]);

  return (
    <div className="space-y-4">
      <Kpis tCur={c.tCur} tCmp={c.tCmp} />
      <Card title="Venta neta por día (por semana en períodos largos)" action={<Export name="ventas-serie" rows={pts} cols={[['date', 'Desde'], ['cur', 'Período CLP'], ['cmp', 'Comparación CLP']]} />}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={pts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} minTickGap={12} />
            <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => money(v as number)} width={56} />
            <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => [formatCLP(v as number), n === 'cur' ? 'Período' : 'Comparación']} />
            <Bar dataKey="cmp" fill={WOOD_LIGHT} opacity={0.5} radius={[2, 2, 0, 0]} />
            <Bar dataKey="cur" fill={GOLD} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Por día de la semana">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={wd} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="name" stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => money(v as number)} width={56} />
              <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => [n === 'net' ? formatCLP(v as number) : v, n === 'net' ? 'Venta' : 'Documentos']} />
              <Bar dataKey="net" fill={WOOD} radius={[3, 3, 0, 0]}>{wd.map((w, i) => <Cell key={i} fill={w.net === Math.max(...wd.map((x) => x.net)) ? GOLD : WOOD} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Table title="Por tipo de documento" rows={kinds} cols={[['name', 'Tipo'], ['docs', 'Documentos', (v) => num(v as number)], ['net', 'Neto', (v) => formatCLP(v as number)]]} export={{ name: 'ventas-por-tipo-documento', rows: kinds }} />
      </div>
      <Table title="Mes a mes (24 meses)" rows={monthly} export={{ name: 'ventas-mensuales', rows: monthly }}
        cols={[['month', 'Mes'], ['net', 'Neto', (v) => formatCLP(v as number)], ['factory', 'Fábrica', (v) => formatCLP(v as number)], ['store', 'Tienda', (v) => formatCLP(v as number)], ['docs', 'Documentos', (v) => num(v as number)], ['yoy', 'vs. año ant.', (v) => deltaTxt(v as number | null)]]} />
      <Table title="Notas de crédito por cliente" rows={nc} onRow={(r) => r.id !== '0' && c.open({ kind: 'cliente', id: r.id })} export={{ name: 'notas-de-credito', rows: nc }}
        note={nc.length ? `${num(c.tCur.creditNotes)} notas por ${formatCLP(-c.tCur.creditNet)}: ${pct(c.tCur.net ? (-c.tCur.creditNet / (c.tCur.net - c.tCur.creditNet)) * 100 : 0, 1)} de lo facturado.` : undefined}
        cols={[['name', 'Cliente'], ['docs', 'Notas'], ['net', 'Monto neto', (v) => formatCLP(v as number)]]} />
    </div>
  );
}

// ---------- Productos ----------

function Productos(c: Ctx) {
  const [group, setGroup] = useState<ProductGroup>('producto');
  const [q, setQ] = useState('');
  const rows = useMemo(() => productRows(c.cur.lines, c.cmp.lines, c.dims, c.costs, group), [c.cur, c.cmp, c.dims, c.costs, group]);
  const shown = q ? rows.filter((r) => `${r.name} ${r.format} ${r.type}`.toLowerCase().includes(q.toLowerCase())) : rows;
  const types = useMemo(() => productRows(c.cur.lines, c.cmp.lines, c.dims, c.costs, 'tipo').slice(0, 12), [c.cur, c.cmp, c.dims, c.costs]);
  const abc = (k: 'A' | 'B' | 'C') => rows.filter((r) => r.abc === k && r.net > 0).length;
  const noSale = rows.filter((r) => r.net <= 0 && r.cmpNet > 0).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <Metric label="Clase A" value={abc('A')} sub="hacen el 80% de la venta" />
        <Metric label="Clase B" value={abc('B')} sub="el 15% siguiente" />
        <Metric label="Clase C" value={abc('C')} sub="el último 5%" />
        <Metric label="Dejaron de venderse" value={noSale} sub="vendían en la comparación" tone={noSale ? 'warn' : undefined} />
        <Metric label="Margen bruto" value={pct(c.tCur.marginPct, 1)} sub={`costo conocido en ${pct(c.tCur.costCoverage * 100)} de la venta`} tone={c.tCur.costCoverage < 0.6 ? 'warn' : undefined} />
      </div>
      <Card title="Venta por tipo de producto">
        <ResponsiveContainer width="100%" height={Math.max(160, types.length * 26)}>
          <BarChart data={types} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
            <XAxis type="number" stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => money(v as number)} />
            <YAxis dataKey="name" type="category" stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} width={150} />
            <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => [formatCLP(v as number), n === 'net' ? 'Período' : 'Comparación']} />
            <Bar dataKey="cmpNet" fill={WOOD_LIGHT} opacity={0.5} radius={[0, 3, 3, 0]} />
            <Bar dataKey="net" fill={WOOD} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={group} onChange={setGroup} options={[['producto', 'Por producto'], ['variante', 'Por formato'], ['tipo', 'Por tipo']]} />
        <input className="field h-9 text-sm max-w-xs" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Table title="Productos (clic para ver el detalle)" rows={shown} max={150} onRow={(r) => group !== 'tipo' && c.open({ kind: 'producto', key: r.key, group })}
        export={{ name: `productos-${group}`, rows: shown }}
        cols={[
          ['name', 'Producto', (v, r) => <span>{v as string}{r.format ? <span className="text-charcoal-300 font-normal"> · {r.format as string}</span> : null}</span>],
          ['abc', 'ABC'], ['units', 'Unid.', (v) => num(v as number, 1)], ['kg', 'Kg', (v) => (v == null ? '—' : num(v as number, 1))],
          ['net', 'Neto', (v) => formatCLP(v as number)], ['share', '% venta', (v) => pct(v as number, 1)], ['avgPrice', 'Precio prom.', (v) => formatCLP(v as number)],
          ['marginPct', 'Margen', (v) => pct(v as number | null, 1)], ['clients', 'Clientes'], ['cmpNet', 'Comparación', (v) => formatCLP(v as number)], ['delta', 'Var.', (v) => deltaTxt(v as number | null)],
        ]}
        rowTone={(r) => (r.marginPct != null && r.marginPct < 15 ? 'bad' : r.net <= 0 && r.cmpNet > 0 ? 'warn' : undefined)} />
    </div>
  );
}

// ---------- Clientes ----------

function Clientes(c: Ctx) {
  const [status, setStatus] = useState<ClientStatus | 'todos'>('todos');
  const [q, setQ] = useState('');
  const conc = useMemo(() => concentration(c.clients), [c.clients]);
  const count = (s: ClientStatus) => c.clients.filter((r) => r.status === s).length;
  const lost = useMemo(() => c.clients.filter((r) => r.net <= 0 && r.cmpNet > 0), [c.clients]);
  const shown = c.clients.filter((r) => (status === 'todos' || r.status === status) && (!q || `${r.name} ${r.rut}`.toLowerCase().includes(q.toLowerCase())));
  const store = c.cur.docs.filter((d) => d.clientId === '0').reduce((s, d) => s + d.net, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
        <Metric label="Compraron" value={num(conc.buyers)} delta={delta(conc.buyers, c.tCmp.clients)} sub="en el período" />
        <Metric label="Nuevos" value={count('nuevo')} sub="primera compra en el período" />
        <Metric label="En riesgo" value={count('en_riesgo')} sub="atrasados vs su ritmo" tone={count('en_riesgo') ? 'warn' : undefined} />
        <Metric label="Perdidos" value={count('perdido')} sub={`${lost.length} compraron en la comparación y no ahora`} tone={count('perdido') ? 'bad' : undefined} />
        <Metric label="Top 10" value={pct(conc.top10Share)} sub="de la venta" />
        <Metric label="80% de la venta" value={`${conc.n80} clientes`} sub={store ? `+ mesón sin cliente ${money(store)}` : undefined} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={status} onChange={setStatus} options={[['todos', 'Todos'], ['activo', 'Activos'], ['nuevo', 'Nuevos'], ['en_riesgo', 'En riesgo'], ['perdido', 'Perdidos']]} />
        <input className="field h-9 text-sm max-w-xs" placeholder="Buscar cliente o RUT…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Table title="Cartera (clic para ver el detalle)" rows={shown} max={150} onRow={(r) => c.open({ kind: 'cliente', id: r.id })} export={{ name: 'clientes', rows: shown }}
        note="Ritmo = días promedio entre compras en los últimos 13 meses. En riesgo: atrasado 1,5 veces su ritmo (mín. 21 días). Perdido: 3 veces (mín. 60 días)."
        cols={[
          ['name', 'Cliente'], ['seller', 'Vendedor'], ['net', 'Neto', (v) => formatCLP(v as number)], ['delta', 'Var.', (v) => deltaTxt(v as number | null)],
          ['docs', 'Docs'], ['ticket', 'Ticket', (v) => formatCLP(v as number)], ['net12', '12 meses', (v) => formatCLP(v as number)],
          ['interval', 'Ritmo', (v) => (v == null ? '—' : `${Math.round(v as number)} d`)], ['last', 'Última', (v) => dShort(v as string)],
          ['status', 'Estado', (v) => CLIENT_STATUS_LABEL[v as ClientStatus]],
        ]}
        rowTone={(r) => (r.status === 'perdido' ? 'bad' : r.status === 'en_riesgo' ? 'warn' : undefined)} />
    </div>
  );
}

// ---------- Vendedores ----------

function Vendedores(c: Ctx) {
  const rows = useMemo(() => sellerRows(c.cur.docs, c.cmp.docs, c.cur.lines, c.clients, c.dims, c.costs, c.sellerName, c.settings.storeOfficeId), [c.cur, c.cmp, c.clients, c.dims, c.costs, c.settings.storeOfficeId]);
  const risk = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of c.clients) if (r.status === 'en_riesgo' || r.status === 'perdido') m.set(r.seller, (m.get(r.seller) ?? 0) + 1);
    return m;
  }, [c.clients]);
  return (
    <div className="space-y-4">
      <p className="text-xs text-charcoal-500 max-w-3xl">Vendedor = usuario de Bsale que emitió el documento (la tienda cuenta como una vendedora más). Margen con el costo promedio de Bsale.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.slice(0, 8).map((v) => (
          <div key={v.id} className="card p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-semibold text-charcoal-900 truncate">{v.name}</p>
              <p className="text-sm font-semibold text-charcoal-900 tabular-nums">{money(v.net)}</p>
            </div>
            <p className="text-[11px] text-charcoal-300 uppercase tracking-display mt-0.5">
              {pct(v.share)} de la venta · <span className={v.delta == null ? '' : v.delta >= 0 ? 'text-emerald-700' : 'text-red-700'}>{deltaTxt(v.delta)}</span>
            </p>
            <dl className="grid grid-cols-3 gap-1 mt-3 text-center text-xs">
              <div className="rounded bg-cream-100/60 py-1"><dt className="text-[9px] uppercase text-charcoal-300">Clientes</dt><dd className="font-semibold">{v.clients}</dd></div>
              <div className="rounded bg-cream-100/60 py-1"><dt className="text-[9px] uppercase text-charcoal-300">Ticket</dt><dd className="font-semibold">{money(v.ticket)}</dd></div>
              <div className="rounded bg-cream-100/60 py-1"><dt className="text-[9px] uppercase text-charcoal-300">Margen</dt><dd className="font-semibold">{pct(v.marginPct)}</dd></div>
            </dl>
            <p className="mt-2 text-[10px] uppercase tracking-display text-charcoal-500">
              {v.newClients ? `${v.newClients} nuevos · ` : ''}{risk.get(v.name) ? <span className="text-brass-700">{risk.get(v.name)} clientes en riesgo</span> : 'cartera al día'}
            </p>
          </div>
        ))}
      </div>
      <Table title="Detalle por vendedor" rows={rows} export={{ name: 'vendedores', rows }}
        cols={[['name', 'Vendedor'], ['net', 'Neto', (v) => formatCLP(v as number)], ['share', '% venta', (v) => pct(v as number, 1)], ['delta', 'Var.', (v) => deltaTxt(v as number | null)], ['docs', 'Docs'], ['ticket', 'Ticket', (v) => formatCLP(v as number)], ['clients', 'Clientes'], ['newClients', 'Nuevos'], ['kg', 'Kg', (v) => num(v as number)], ['marginPct', 'Margen', (v) => pct(v as number | null, 1)], ['storeShare', '% tienda', (v) => pct(v as number)]]} />
    </div>
  );
}

// ---------- Stock ----------

function Stock(c: Ctx) {
  const stock = useVariantStock();
  const [flag, setFlag] = useState<StockFlag | 'todos'>('todos');
  const [days, setDays] = useState(7);
  // Velocity ignores the global seller/office filters: it's the whole business.
  const allLines = c.facts.lines;
  const rows = useMemo(() => stockAnalysis(stock, allLines, c.today, c.dims, c.costs, c.settings.factoryOfficeId, c.settings.storeOfficeId, days), [stock, allLines, c.today, c.dims, c.costs, c.settings, days]);
  const n = (k: StockFlag) => rows.filter((r) => r.flag === k).length;
  const value = rows.reduce((s, r) => s + (r.stockValue ?? 0), 0);
  const restock = rows.filter((r) => r.restock > 0).sort((a, b) => (a.storeCoverage ?? 0) - (b.storeCoverage ?? 0));
  const shown = flag === 'todos' ? rows : rows.filter((r) => r.flag === flag);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <Metric label="Quiebres" value={n('quiebre')} sub="sin stock y con venta" tone={n('quiebre') ? 'bad' : undefined} />
        <Metric label="Stock bajo" value={n('bajo')} sub="menos de 7 días" tone={n('bajo') ? 'warn' : undefined} />
        <Metric label="Sobre-stock" value={n('sobre')} sub="más de 60 días" />
        <Metric label="Sin movimiento" value={n('sin_movimiento')} sub="con stock, sin venta en 90 días" />
        <Metric label="Valor del stock" value={value ? money(value) : '—'} sub="a costo promedio Bsale" />
      </div>
      <Table title="Reposición sugerida a tienda" rows={restock} export={{ name: 'reposicion-tienda', rows: restock }}
        note={<span>Cubre <select className="field h-7 text-xs w-auto inline-block mx-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[3, 5, 7, 10, 14].map((d) => <option key={d} value={d}>{d} días</option>)}</select> de venta de la tienda (ritmo de los últimos 30 días), sin pasar lo que hay en fábrica. Se traslada desde el Tablero → Nuevo traslado.</span>}
        cols={[['name', 'Producto'], ['format', 'Formato'], ['store', 'En tienda', (v) => num(v as number, 1)], ['storeDaily', 'Venta/día tienda', (v) => num(v as number, 1)], ['storeCoverage', 'Cubre', (v) => (v == null ? '—' : `${num(v as number)} d`)], ['factory', 'En fábrica', (v) => num(v as number, 1)], ['restock', 'Llevar', (v) => <strong>{num(v as number)}</strong>]]} />
      <div className="flex flex-wrap gap-2 items-center">
        <Seg value={flag} onChange={setFlag} options={[['todos', 'Todos'], ...(['quiebre', 'bajo', 'sobre', 'sin_movimiento', 'ok'] as StockFlag[]).map((k) => [k, STOCK_FLAG_LABEL[k]] as [StockFlag, string])]} />
      </div>
      <Table title="Cobertura por formato (ritmo de los últimos 30 días)" rows={shown} max={200} onRow={(r) => c.open({ kind: 'producto', key: r.variantId, group: 'variante' })} export={{ name: 'stock-cobertura', rows: shown }}
        cols={[['name', 'Producto'], ['format', 'Formato'], ['factory', 'Fábrica', (v) => num(v as number, 1)], ['store', 'Tienda', (v) => num(v as number, 1)], ['daily', 'Venta/día', (v) => num(v as number, 2)], ['coverage', 'Cobertura', (v) => (v == null ? '—' : `${num(v as number)} d`)], ['sold90', 'Vendido 90 d', (v) => num(v as number, 1)], ['stockValue', 'Valor', (v) => (v == null ? '—' : formatCLP(v as number))], ['flag', 'Estado', (v) => STOCK_FLAG_LABEL[v as StockFlag]]]}
        rowTone={(r) => (r.flag === 'quiebre' ? 'bad' : r.flag === 'bajo' ? 'warn' : undefined)} />
    </div>
  );
}

// ---------- Muestras ----------

// Bsale sales as purchases for the sample conversion: Bsale client → app
// client (bsaleClientId) and variant → product (confirmed cross).
function Muestras({ map, ...c }: Ctx & { map: CatalogMapEntry[] }) {
  const { clients } = useClients();
  const extra = useMemo<Purchase[]>(() => {
    const clientOf = new Map(clients.filter((x) => x.bsaleClientId).map((x) => [String(x.bsaleClientId), x.id]));
    const productOf = new Map(map.filter((m) => m.status === 'confirmado' && m.productId).map((m) => [m.variantId, m.productId!]));
    const out: Purchase[] = [];
    for (const l of c.facts.lines) {
      if (l.kind === 'nota_credito' || l.net <= 0) continue;
      const clientId = clientOf.get(l.clientId); const productId = productOf.get(l.variantId);
      if (clientId && productId) out.push({ clientId, productId, at: Date.parse(`${l.date}T12:00:00Z`), ref: `Bsale ${l.date.slice(8)}/${l.date.slice(5, 7)}`, revenue: Math.round(l.net * 1.19) });
    }
    return out;
  }, [clients, map, c.facts]);
  const costOf = useMemo(() => {
    const variantOf = new Map<string, string>();
    for (const m of map) if (m.status === 'confirmado' && m.productId && !variantOf.has(`${m.productId}__${m.formatId}`)) variantOf.set(`${m.productId}__${m.formatId}`, m.variantId);
    return (r: SampleRow) => {
      const v = variantOf.get(`${r.productId}__${r.formatId}`);
      const cost = v ? c.costs[v] : undefined;
      if (!cost) return null;
      return c.dims.get(v!)?.kgPerUnit === 1 ? cost * r.kg : cost;
    };
  }, [map, c.costs, c.dims]);
  return <SamplesPanel extraPurchases={extra} costOf={costOf} />;
}

// ---------- Explorador ----------

function Explorador(c: Ctx) {
  const [rowDim, setRowDim] = useState<PivotDim>('producto');
  const [colDim, setColDim] = useState<PivotDim | ''>('mes');
  const [measure, setMeasure] = useState<PivotMeasure>('net');
  const res = useMemo(() => pivot(c.cur.lines, rowDim, colDim || null, measure, {
    dims: c.dims, costs: c.costs, office: c.officeName, seller: c.sellerName, client: (id) => c.clientInfo(id).name,
  }), [c.cur, rowDim, colDim, measure, c.dims, c.costs]);
  const fmt = (v: number) => (measure === 'net' || measure === 'margin' ? formatCLP(v) : measure === 'kg' || measure === 'units' ? num(v, 1) : num(v));
  const cols = res.cols.slice(0, 24);
  const exportRows = res.rows.map((r) => ({ label: r.label, ...Object.fromEntries(cols.map((col) => [col.key, Math.round(r.cells[col.key] * 100) / 100])), total: Math.round(r.total * 100) / 100 }));
  const dimOptions = Object.entries(PIVOT_DIM_LABEL) as Array<[PivotDim, string]>;

  return (
    <div className="space-y-3">
      <div className="card p-3 flex flex-wrap items-end gap-3 text-xs">
        <label className="text-charcoal-500">Filas<select className="field mt-1 h-9 text-xs" value={rowDim} onChange={(e) => setRowDim(e.target.value as PivotDim)}>{dimOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="text-charcoal-500">Columnas<select className="field mt-1 h-9 text-xs" value={colDim} onChange={(e) => setColDim(e.target.value as PivotDim | '')}><option value="">(ninguna)</option>{dimOptions.filter(([k]) => k !== rowDim).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="text-charcoal-500">Medida<select className="field mt-1 h-9 text-xs" value={measure} onChange={(e) => setMeasure(e.target.value as PivotMeasure)}>{(Object.entries(PIVOT_MEASURE_LABEL) as Array<[PivotMeasure, string]>).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <Button size="sm" variant="secondary" disabled={!res.rows.length} onClick={() => downloadCsv(`explorador-${rowDim}${colDim ? `-${colDim}` : ''}-${measure}`, exportRows, [{ key: 'label', label: PIVOT_DIM_LABEL[rowDim] }, ...cols.map((col) => ({ key: col.key, label: col.label })), { key: 'total', label: 'Total' }], `${fmtRange(c.range)} · ${PIVOT_MEASURE_LABEL[measure]}`)}>Exportar CSV</Button>
        <span className="text-charcoal-300">{res.rows.length} filas · usa los filtros de arriba (período, sucursal, vendedor)</span>
      </div>
      <div className="card p-0 overflow-auto max-h-[70vh]">
        <table className="text-xs w-full">
          <thead className="sticky top-0 bg-cream-50 z-10">
            <tr className="text-[10px] uppercase tracking-display text-charcoal-300 border-b border-charcoal-100">
              <th className="text-left py-2 px-3 sticky left-0 bg-cream-50">{PIVOT_DIM_LABEL[rowDim]}</th>
              {cols.map((col) => <th key={col.key} className="text-right py-2 px-2 whitespace-nowrap">{col.label}</th>)}
              {colDim && <th className="text-right py-2 px-3">Total</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-charcoal-100/70">
            {res.rows.slice(0, 300).map((r) => (
              <tr key={r.key} className="hover:bg-cream-100/60">
                <td className="py-1.5 px-3 text-charcoal-900 font-medium sticky left-0 bg-white max-w-[18rem] truncate">{r.label}</td>
                {cols.map((col) => <td key={col.key} className="py-1.5 px-2 text-right tabular-nums text-charcoal-700 whitespace-nowrap">{r.cells[col.key] ? fmt(r.cells[col.key]) : ''}</td>)}
                {colDim && <td className="py-1.5 px-3 text-right tabular-nums font-semibold">{fmt(r.total)}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-cream-100">
            <tr className="font-semibold">
              <td className="py-2 px-3 sticky left-0 bg-cream-100">Total</td>
              {cols.map((col) => <td key={col.key} className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmt(res.colTotals[col.key])}</td>)}
              {colDim && <td className="py-2 px-3 text-right tabular-nums">{fmt(res.total)}</td>}
            </tr>
          </tfoot>
        </table>
        {res.rows.length > 300 && <p className="text-[11px] text-charcoal-300 p-2">Mostrando 300 de {res.rows.length} filas; el CSV trae todas.</p>}
      </div>
    </div>
  );
}

// ---------- Ficha de detalle ----------

function DetailDrawer({ detail, onClose, ...c }: Ctx & { detail: NonNullable<Detail>; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const since = addDays(c.today, -395);
  const keyOf = (v: string) => (detail.kind === 'producto' ? (detail.group === 'variante' ? v : dimOf(c.dims, v).productKey) : '');
  const lines = useMemo(() => c.facts.lines.filter((l) => l.date >= since && (detail.kind === 'cliente' ? l.clientId === detail.id : keyOf(l.variantId) === detail.key) && (c.f.officeId == null || l.officeId === c.f.officeId)), [c.facts, detail, since, c.f.officeId]);
  const docs = useMemo(() => (detail.kind === 'cliente' ? c.facts.docs.filter((d) => d.clientId === detail.id && d.date >= since) : []), [c.facts, detail, since]);
  const monthly = useMemo(() => {
    const m = new Map<string, { month: string; net: number; qty: number }>();
    for (const mo of monthsOf({ from: since, to: c.today })) m.set(mo, { month: mo, net: 0, qty: 0 });
    for (const l of lines) { const r = m.get(l.date.slice(0, 7)); if (r) { r.net += l.net; r.qty += l.qty; } }
    return [...m.values()].map((r) => ({ ...r, label: r.month.slice(5) + '/' + r.month.slice(2, 4) }));
  }, [lines, since, c.today]);
  const top = useMemo(() => {
    const m = new Map<string, { key: string; name: string; qty: number; net: number }>();
    for (const l of lines) {
      const [k, name] = detail.kind === 'cliente' ? [l.variantId, `${dimOf(c.dims, l.variantId).product} · ${dimOf(c.dims, l.variantId).format}`] : [l.clientId, c.clientInfo(l.clientId).name];
      const r = m.get(k) ?? { key: k, name, qty: 0, net: 0 }; r.qty += l.qty; r.net += l.net; m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.net - a.net);
  }, [lines, detail]);

  const client = detail.kind === 'cliente' ? c.clients.find((r) => r.id === detail.id) : undefined;
  const info = detail.kind === 'cliente' ? c.clientInfo(detail.id) : undefined;
  const dim = detail.kind === 'producto' ? (detail.group === 'variante' ? dimOf(c.dims, detail.key) : [...c.dims.values()].find((d) => d.productKey === detail.key)) : undefined;
  const title = detail.kind === 'cliente' ? info!.name : detail.group === 'variante' ? `${dim?.product ?? ''} · ${dim?.format ?? ''}` : dim?.product ?? 'Producto';
  const net12 = lines.reduce((s, l) => s + l.net, 0);
  const cost = lines.reduce((s, l) => s + (c.costs[l.variantId] ? c.costs[l.variantId] * l.qty : 0), 0);
  const costed = lines.reduce((s, l) => s + (c.costs[l.variantId] ? l.net : 0), 0);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-label={title}>
      <button className="absolute inset-0 bg-charcoal-900/30" aria-label="Cerrar" onClick={onClose} />
      <aside className="relative w-full max-w-xl h-full bg-white shadow-xl overflow-y-auto p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{detail.kind === 'cliente' ? 'Cliente' : 'Producto'} · últimos 13 meses</p>
            <h2 className="text-lg font-semibold text-charcoal-900">{title}</h2>
            {info?.rut && <p className="text-xs text-charcoal-500">RUT {info.rut}{client ? ` · ${client.seller}` : ''}</p>}
            {dim && <p className="text-xs text-charcoal-500">{dim.type}</p>}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>Cerrar</Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Venta 13 m" value={money(net12)} />
          <Metric label="Margen" value={costed ? pct(((costed - cost) / costed) * 100, 1) : '—'} />
          {client ? <Metric label="Ritmo" value={client.interval == null ? '—' : `${Math.round(client.interval)} d`} sub={`última ${dShort(client.last)}`} tone={client.status === 'perdido' ? 'bad' : client.status === 'en_riesgo' ? 'warn' : undefined} />
            : <Metric label="Unidades" value={num(lines.reduce((s, l) => s + l.qty, 0), 1)} />}
        </div>
        {client && <p className="text-xs text-charcoal-500">{CLIENT_STATUS_LABEL[client.status]} · {docs.filter((d) => d.kind !== 'nota_credito').length} documentos en 13 meses · ticket {formatCLP(client.ticket || (docs.length ? net12 / docs.length : 0))} · cliente desde {dShort(client.first)}</p>}
        <Card title="Mes a mes">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" stroke={AXIS} fontSize={10} tickLine={false} axisLine={false} interval={0} />
              <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => money(v as number)} width={52} />
              <Tooltip contentStyle={TOOLTIP} formatter={(v) => [formatCLP(v as number), 'Neto']} />
              <Bar dataKey="net" fill={WOOD} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Table title={detail.kind === 'cliente' ? 'Qué compra' : 'Quién lo compra'} rows={top} max={25} export={{ name: `detalle-${detail.kind}`, rows: top }}
          cols={[['name', detail.kind === 'cliente' ? 'Producto' : 'Cliente'], ['qty', 'Unid.', (v) => num(v as number, 1)], ['net', 'Neto', (v) => formatCLP(v as number)]]} />
        {detail.kind === 'cliente' && docs.length > 0 && (
          <Table title="Últimos documentos" rows={[...docs].sort((a, b) => b.date.localeCompare(a.date))} max={15}
            cols={[['date', 'Fecha', (v) => dShort(v as string)], ['kind', 'Tipo', (v) => KIND_LABEL[v as keyof typeof KIND_LABEL]], ['officeId', 'Sucursal', (v) => c.officeName(v as number)], ['net', 'Neto', (v) => formatCLP(v as number)]]} />
        )}
      </aside>
    </div>
  );
}

// ---------- Controles ----------

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<[T, string]> }) {
  return (
    <div className="inline-flex flex-wrap rounded-md border border-charcoal-200 overflow-hidden">
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} className={'px-2.5 py-1.5 text-[11px] uppercase tracking-display font-medium transition ' + (value === k ? 'bg-charcoal-900 text-cream-50' : 'bg-white text-charcoal-500 hover:bg-cream-100')}>{label}</button>
      ))}
    </div>
  );
}
