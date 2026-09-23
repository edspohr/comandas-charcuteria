import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/data/firebase';
import Button from '@/components/ui/Button';
import { useProducts } from '@/data/products';
import { useClients } from '@/data/clients';
import { useAllStock, useSyncState } from '@/data/stock';
import { demoUsers } from '@/data/demo-users';
import { categoryLabel } from '@/domain/categories';
import {
  anulados, backlog, byCategory, byClient, byPacker, byProduct, byVendedor, clientRows, gramsMap, inRange, leadTimes,
  pareto, pctDelta, rangeFor, salesForce, salesTotals, seriesByDay, serviceLevel, stockRows,
  HEALTH_LABEL, DEFAULT_CLIENT_HEALTH, type ClientHealth, type RangeKey,
} from '@/domain/analytics';
import { useSettings } from '@/data/settings';
import { downloadCsv } from '@/lib/csv';
import { formatDateShort, formatQty, todayInSantiago } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';
import type { Order } from '@/domain/types';

const NAME: Record<string, string> = Object.fromEntries(demoUsers.map((u) => [u.uid, u.displayName]));
const nameOf = (uid: string) => NAME[uid] ?? uid;
const VENDEDORES = demoUsers.filter((u) => u.role === 'vendedor').map((u) => ({ uid: u.uid, name: u.displayName }));

type Tab = 'ventas' | 'fuerza' | 'operacion' | 'stock' | 'clientes';
const TABS: Array<[Tab, string]> = [['ventas', 'Ventas'], ['fuerza', 'Fuerza de ventas'], ['operacion', 'Operación'], ['stock', 'Stock'], ['clientes', 'Clientes']];

const GOLD = '#a8834a'; const WOOD = '#4d3b28'; const WOOD_LIGHT = '#b39776';
const TOOLTIP = { borderRadius: 8, border: '1px solid #e5e2dd', fontSize: 12 };
const kFmt = (v: number) => `$${Math.round(v / 1000)}k`;
const h = (v: number | null) => (v == null ? '—' : v < 1 ? `${Math.round(v * 60)} min` : v < 48 ? `${v.toFixed(1)} h` : `${(v / 24).toFixed(1)} d`);
const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(0)}%`);

export default function Panel() {
  const [tab, setTab] = useState<Tab>('ventas');
  const [rangeKey, setRangeKey] = useState<RangeKey>('30');
  const [orders, setOrders] = useState<Order[]>([]);
  const { products } = useProducts();
  const { clients } = useClients();
  const { stock } = useAllStock();
  const sync = useSyncState();
  const { settings } = useSettings();

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'orders'), (snap) => {
      const list: Order[] = []; snap.forEach((d) => list.push(d.data() as Order)); setOrders(list);
    });
    return unsub;
  }, []);

  const grams = useMemo(() => gramsMap(products), [products]);
  const { current, previous } = useMemo(() => rangeFor(rangeKey), [rangeKey]);
  const cur = useMemo(() => orders.filter((o) => inRange(o, current)), [orders, current]);
  const prev = useMemo(() => orders.filter((o) => inRange(o, previous)), [orders, previous]);

  const totals = useMemo(() => salesTotals(cur, grams), [cur, grams]);
  const prevTotals = useMemo(() => salesTotals(prev, grams), [prev, grams]);
  const series = useMemo(() => seriesByDay(cur, current, grams), [cur, current, grams]);
  const vend = useMemo(() => byVendedor(cur, grams, nameOf), [cur, grams]);
  const cli = useMemo(() => byClient(cur, grams), [cur, grams]);
  const prod = useMemo(() => byProduct(cur, products, grams), [cur, products, grams]);
  const cats = useMemo(() => byCategory(prod, categoryLabel), [prod]);
  const lt = useMemo(() => leadTimes(cur), [cur]);
  const svc = useMemo(() => serviceLevel(orders), [orders]);
  const bl = useMemo(() => backlog(orders), [orders]);
  const packers = useMemo(() => byPacker(cur, grams, nameOf), [cur, grams]);
  const anul = useMemo(() => anulados(cur, nameOf), [cur]);
  const stRows = useMemo(() => stockRows(products, stock, orders, grams), [products, stock, orders, grams]);
  const cRows = useMemo(() => clientRows(clients, orders, current, nameOf, undefined, settings.clientHealth ?? DEFAULT_CLIENT_HEALTH), [clients, orders, current, settings.clientHealth]);
  const today = todayInSantiago();
  const hoy = useMemo(() => {
    const t = orders.filter((o) => o.requestedDate === today && o.status !== 'anulado');
    const ventas = t.filter((o) => ['facturado', 'despachado', 'entregado'].includes(o.status)).reduce((s, o) => s + (o.totalCLP ?? 0), 0);
    return { pedidos: t.length, ventas, atrasados: svc.lateNow, quiebres: stRows.filter((r) => r.pending > 0).length };
  }, [orders, today, svc.lateNow, stRows]);
  const par = useMemo(() => pareto(cRows), [cRows]);
  const force = useMemo(() => salesForce(cur, cRows, grams, nameOf, VENDEDORES), [cur, cRows, grams]);

  const rangeLabel = rangeKey === 'all' ? 'todo el historial' : `últimos ${rangeKey} días`;
  const prevLabel = rangeKey === 'all' ? '(sin comparación)' : `vs. ${rangeKey} días anteriores`;
  const period = rangeKey === 'all' ? 'todo el historial' : `${current.from} a ${current.to}`;
  const delta = (cur: number, prev: number) => (rangeKey === 'all' ? undefined : pctDelta(cur, prev));
  currentPeriod = period;

  return (
    <div>
      <header className="mb-4 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">Gerencia</p>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Panel de dueños</h1>
          <p className="text-xs text-charcoal-300 mt-1">Pedidos por fecha solicitada · {rangeLabel} {prevLabel}{sync?.at ? ` · stock Bsale ${new Date(sync.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {(['7', '30', '90', 'all'] as RangeKey[]).map((k) => (
            <button key={k} onClick={() => setRangeKey(k)} className={'rounded-md px-3 py-1.5 text-xs uppercase tracking-display font-medium border transition ' + (rangeKey === k ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500 hover:border-charcoal-300')}>
              {k === 'all' ? 'Todo' : `${k} días`}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        <Today label="Pedidos para hoy" value={hoy.pedidos} />
        <Today label="Ventas de hoy" value={formatCLP(hoy.ventas)} />
        <Today label="Atrasados" value={hoy.atrasados} tone={hoy.atrasados ? 'bad' : undefined} />
        <Today label="Quiebres de stock" value={hoy.quiebres} tone={hoy.quiebres ? 'warn' : undefined} />
      </div>

      <nav className="mb-5 flex gap-1 border-b border-charcoal-100 overflow-x-auto">
        {TABS.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={'px-4 py-2.5 text-xs uppercase tracking-display font-medium border-b-2 transition -mb-px whitespace-nowrap ' + (t === tab ? 'border-brass-500 text-charcoal-900' : 'border-transparent text-charcoal-300 hover:text-charcoal-500')}>{label}</button>
        ))}
      </nav>

      {tab === 'ventas' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="Ventas facturadas" value={formatCLP(totals.revenue)} delta={delta(totals.revenue, prevTotals.revenue)} sub={`${totals.invoicedOrders} con documento${totals.pendingInvoice ? ` · ${totals.pendingInvoice} sin facturar aún (${formatCLP(totals.pendingRevenue)})` : ''}`} />
            <Metric label="Pedidos" value={totals.orders} delta={delta(totals.orders, prevTotals.orders)} sub={totals.anulados ? `${totals.anulados} anulados` : undefined} />
            <Metric label="Ticket promedio" value={formatCLP(totals.ticket)} delta={delta(totals.ticket, prevTotals.ticket)} />
            <Metric label="Kilos" value={`${totals.kg.toFixed(0)} kg`} delta={delta(totals.kg, prevTotals.kg)} />
          </div>

          <Card title="Ventas por día" action={<Export name="ventas-por-dia" rows={series} cols={[['date', 'Fecha'], ['orders', 'Pedidos'], ['revenue', 'Ventas CLP'], ['kg', 'Kg']]} />}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e2dd" vertical={false} />
                <XAxis dataKey="label" stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => kFmt(v as number)} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => [n === 'revenue' ? formatCLP(v as number) : v, n === 'revenue' ? 'Ventas' : n === 'orders' ? 'Pedidos' : 'Kg']} />
                <Line type="monotone" dataKey="revenue" stroke={GOLD} strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Ventas por vendedor" action={<Export name="ventas-por-vendedor" rows={vend} cols={[['name', 'Vendedor'], ['orders', 'Pedidos'], ['revenue', 'Ventas CLP'], ['ticket', 'Ticket'], ['kg', 'Kg']]} />}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={vend} margin={{ top: 8, right: 8, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e2dd" vertical={false} />
                  <XAxis dataKey="name" stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} interval={0} angle={-25} textAnchor="end" dy={4} />
                  <YAxis stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => kFmt(v as number)} />
                  <Tooltip contentStyle={TOOLTIP} formatter={(v) => [formatCLP(v as number), 'Ventas']} />
                  <Bar dataKey="revenue" radius={[3, 3, 0, 0]}>{vend.map((_, i) => <Cell key={i} fill={i === 0 ? GOLD : WOOD} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Ventas por categoría" action={<Export name="ventas-por-categoria" rows={cats} cols={[['name', 'Categoría'], ['revenue', 'Ventas CLP'], ['kg', 'Kg'], ['orders', 'Pedidos']]} />}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={cats} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e2dd" horizontal={false} />
                  <XAxis type="number" stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => kFmt(v as number)} />
                  <YAxis dataKey="name" type="category" stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} width={150} />
                  <Tooltip contentStyle={TOOLTIP} formatter={(v) => [formatCLP(v as number), 'Ventas']} />
                  <Bar dataKey="revenue" fill={WOOD_LIGHT} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Table title="Top clientes" rows={cli.slice(0, 10)} export={{ name: 'ventas-por-cliente', rows: cli }}
              cols={[['name', 'Cliente'], ['orders', 'Pedidos'], ['revenue', 'Ventas', (v) => formatCLP(v as number)], ['ticket', 'Ticket', (v) => formatCLP(v as number)]]} />
            <Table title="Top productos" rows={prod.slice(0, 12)} export={{ name: 'ventas-por-producto', rows: prod }}
              cols={[['name', 'Producto'], ['kg', 'Kg', (v) => (v as number).toFixed(1)], ['units', 'Unid.'], ['revenue', 'Ventas', (v) => formatCLP(v as number)]]} />
          </div>
        </div>
      )}

      {tab === 'fuerza' && (
        <div className="space-y-5">
          <p className="text-xs text-charcoal-500 max-w-3xl">Ventas del período por vendedor y estado de su cartera (clientes con vendedor responsable). Activo = pidió en los últimos 14 días · En riesgo = 15–30 días · Inactivo = más de 30 días sin pedir.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {force.map((v) => (
              <div key={v.key} className="card p-4">
                <div className="flex items-baseline justify-between">
                  <p className="font-semibold text-charcoal-900">{v.name}</p>
                  <p className="text-sm font-semibold text-charcoal-900">{formatCLP(v.revenue)}</p>
                </div>
                <p className="text-[11px] text-charcoal-300 uppercase tracking-display mt-0.5">{v.orders} pedidos · ticket {formatCLP(v.ticket)} · {v.kg.toFixed(0)} kg</p>
                <div className="grid grid-cols-4 gap-1 mt-3 text-center">
                  <Mini label="Cartera" value={v.cartera} />
                  <Mini label="Activos" value={v.activos} tone="ok" />
                  <Mini label="Riesgo" value={v.enRiesgo} tone={v.enRiesgo ? 'warn' : undefined} />
                  <Mini label="Inactivos" value={v.inactivos} tone={v.inactivos ? 'bad' : undefined} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-[10px] uppercase tracking-display">
                  {v.nuevos > 0 && <span className="rounded px-1.5 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200">{v.nuevos} nuevo{v.nuevos === 1 ? '' : 's'}</span>}
                  {v.anulados > 0 && <span className="rounded px-1.5 py-0.5 bg-red-50 text-red-700 border border-red-200">{v.anulados} anulado{v.anulados === 1 ? '' : 's'}</span>}
                  {v.parciales > 0 && <span className="rounded px-1.5 py-0.5 bg-brass-50 text-brass-700 border border-brass-300">{v.parciales} esperando stock</span>}
                  {v.avgDaysSince != null && <span className="rounded px-1.5 py-0.5 bg-charcoal-50 text-charcoal-500 border border-charcoal-100">último pedido hace ~{Math.round(v.avgDaysSince)} d</span>}
                </div>
              </div>
            ))}
          </div>
          <Table title="Detalle por vendedor" rows={force} export={{ name: 'fuerza-de-ventas', rows: force }}
            cols={[['name', 'Vendedor'], ['orders', 'Pedidos'], ['revenue', 'Ventas', (v) => formatCLP(v as number)], ['ticket', 'Ticket', (v) => formatCLP(v as number)], ['cartera', 'Cartera'], ['activos', 'Activos'], ['enRiesgo', 'Riesgo'], ['inactivos', 'Inactivos'], ['nuevos', 'Nuevos'], ['anulados', 'Anulados']]} />
          <Table title="Clientes en riesgo o inactivos (por vendedor)" rows={cRows.filter((c) => c.health === 'en_riesgo' || c.health === 'inactivo').sort((a, b) => (a.owner.localeCompare(b.owner)) || (b.daysSince ?? 0) - (a.daysSince ?? 0))} export={{ name: 'clientes-en-riesgo', rows: cRows.filter((c) => c.health !== 'activo') }}
            cols={[['owner', 'Vendedor'], ['name', 'Cliente'], ['daysSince', 'Días sin pedir'], ['avgIntervalDays', 'Frecuencia (d)', (v) => v == null ? '—' : Math.round(v as number)], ['health', 'Estado', (v) => HEALTH[v as ClientHealth]]]} />
        </div>
      )}

      {tab === 'operacion' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="Entregas a tiempo" value={pct(svc.onTimePct)} sub={`${svc.delivered} entregados · ${svc.late} tarde`} tone={svc.onTimePct != null && svc.onTimePct < 90 ? 'warn' : undefined} />
            <Metric label="Atrasados hoy" value={svc.lateNow} sub={`${svc.openNow} abiertos`} tone={svc.lateNow ? 'bad' : undefined} />
            <Metric label="Ciclo total" value={h(lt.total)} sub={`recibido → entregado · n=${lt.n}`} />
            <Metric label="Anulados" value={anul.length} sub={anul.length ? formatCLP(anul.reduce((s, a) => s + a.revenue, 0)) : undefined} tone={anul.length ? 'warn' : undefined} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Tiempo promedio por etapa">
              <ul className="divide-y divide-charcoal-100 text-sm">
                {([['Captura → tomado', lt.captura], ['Armado', lt.armado], ['Armado → documento', lt.documento], ['Documento → despacho', lt.despacho], ['Despacho → entrega', lt.entrega]] as Array<[string, number | null]>).map(([l, v]) => (
                  <li key={l} className="py-2 flex justify-between"><span className="text-charcoal-500">{l}</span><span className="font-semibold text-charcoal-900">{h(v)}</span></li>
                ))}
              </ul>
            </Card>
            <Card title="Backlog por etapa (hoy)" action={<Export name="backlog" rows={bl} cols={[['label', 'Etapa'], ['count', 'Pedidos'], ['revenue', 'CLP']]} />}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={bl} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e2dd" vertical={false} />
                  <XAxis dataKey="label" stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => [n === 'count' ? v : formatCLP(v as number), n === 'count' ? 'Pedidos' : 'CLP']} />
                  <Bar dataKey="count" fill={WOOD} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Table title="Carga por armador" rows={packers} export={{ name: 'armadores', rows: packers }}
              cols={[['name', 'Armador'], ['enArmado', 'En armado'], ['armados', 'Armados'], ['kg', 'Kg', (v) => (v as number).toFixed(0)], ['avgHours', 'Tiempo prom.', (v) => h(v as number | null)]]} />
            <Table title="Pedidos anulados" rows={anul} export={{ name: 'anulados', rows: anul }}
              cols={[['id', 'Pedido'], ['client', 'Cliente'], ['vendedor', 'Vendedor'], ['reason', 'Motivo'], ['revenue', 'CLP', (v) => formatCLP(v as number)]]} />
          </div>
        </div>
      )}

      {tab === 'stock' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="Quiebres" value={stRows.filter((r) => r.pending > 0).length} sub="formatos con pedidos esperando" tone={stRows.some((r) => r.pending > 0) ? 'warn' : undefined} />
            <Metric label="Cobertura < 3 días" value={stRows.filter((r) => r.coverageDays != null && r.coverageDays < 3).length} sub="con demanda en 30 días" />
            <Metric label="Stock comprometido" value={stRows.filter((r) => r.available < 0).length} sub="Bsale por debajo de reservas" tone={stRows.some((r) => r.available < 0) ? 'bad' : undefined} />
            <Metric label="Merma (30 d)" value={`${stRows.reduce((s, r) => s + Math.max(0, r.mermaKg), 0).toFixed(1)} kg`} sub="vendido − empacado" />
          </div>
          <Table title="Cobertura por formato (demanda promedio de los últimos 30 días)" rows={stRows.filter((r) => r.pending > 0 || r.avgDaily > 0 || r.reserved > 0).slice(0, 40)} export={{ name: 'stock-cobertura', rows: stRows }}
            cols={[['product', 'Producto'], ['format', 'Formato'], ['onHand', 'Bsale', (v, r) => formatQty(v as number, r.unit as 'kg')], ['reserved', 'Reserv.', (v, r) => formatQty(v as number, r.unit as 'kg')], ['available', 'Disp.', (v, r) => formatQty(v as number, r.unit as 'kg')], ['avgDaily', 'Dem./día', (v) => (v as number).toFixed(1)], ['coverageDays', 'Cobertura', (v) => v == null ? '—' : `${Math.round(v as number)} d`], ['pending', 'A producir', (v) => (v as number) > 0 ? String(v) : '']]}
            rowTone={(r) => r.available < 0 ? 'bad' : r.pending > 0 ? 'warn' : undefined} />
          <Table title="Merma por formato" rows={stRows.filter((r) => Math.abs(r.mermaKg) >= 0.05).sort((a, b) => b.mermaKg - a.mermaKg)} export={{ name: 'merma', rows: stRows.filter((r) => r.mermaKg !== 0) }}
            cols={[['product', 'Producto'], ['format', 'Formato'], ['mermaKg', 'Δ kg (vendido − empacado)', (v) => `${(v as number) > 0 ? '−' : '+'}${Math.abs(v as number).toFixed(2)} kg`]]} />
        </div>
      )}

      {tab === 'clientes' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="Clientes activos" value={cRows.filter((c) => c.health === 'activo' || c.health === 'nuevo').length} sub={`de ${cRows.length}`} />
            <Metric label="Nuevos en el período" value={cRows.filter((c) => c.health === 'nuevo').length} />
            <Metric label="En riesgo / inactivos" value={`${cRows.filter((c) => c.health === 'en_riesgo').length} / ${cRows.filter((c) => c.health === 'inactivo').length}`} tone={cRows.some((c) => c.health === 'inactivo') ? 'warn' : undefined} />
            <Metric label="Concentración" value={pct(par.topShare)} sub={`top ${par.topCount} clientes`} />
          </div>
          {cRows.some((c) => c.needsReview || !c.invoicingComplete) && (
            <div className="rounded-md bg-brass-50 border border-brass-300 text-brass-700 p-3 text-sm">
              {cRows.filter((c) => c.needsReview).length} cliente{cRows.filter((c) => c.needsReview).length === 1 ? '' : 's'} creado{cRows.filter((c) => c.needsReview).length === 1 ? '' : 's'} desde el wizard pendiente{cRows.filter((c) => c.needsReview).length === 1 ? '' : 's'} de revisión · {cRows.filter((c) => !c.invoicingComplete).length} con facturación incompleta. <Link to="/admin/catalogo" className="underline">Completar en Catálogo → Clientes</Link>.
            </div>
          )}
          <Table title="Cartera" rows={cRows} export={{ name: 'clientes', rows: cRows }}
            cols={[['name', 'Cliente'], ['owner', 'Vendedor'], ['orders', 'Pedidos'], ['revenue', 'Ventas', (v) => formatCLP(v as number)], ['ticket', 'Ticket', (v) => formatCLP(v as number)], ['lastDate', 'Último', (v) => v ? formatDateShort(v as string) : '—'], ['avgIntervalDays', 'Cada', (v) => v == null ? '—' : `${Math.round(v as number)} d`], ['health', 'Estado', (v) => HEALTH[v as ClientHealth]]]}
            rowTone={(r) => r.health === 'inactivo' ? 'bad' : r.health === 'en_riesgo' ? 'warn' : undefined} />
        </div>
      )}
    </div>
  );
}

const HEALTH = HEALTH_LABEL;

function Metric({ label, value, sub, delta, tone }: { label: string; value: number | string; sub?: string; delta?: number | null; tone?: 'warn' | 'bad' }) {
  return (
    <div className={'card p-4 ' + (tone === 'warn' ? 'border-brass-300' : tone === 'bad' ? 'border-red-200' : '')}>
      <p className="eyebrow">{label}</p>
      <p className={'text-2xl font-semibold mt-1 tracking-display ' + (tone === 'warn' ? 'text-brass-700' : tone === 'bad' ? 'text-red-700' : 'text-charcoal-900')}>{value}</p>
      <p className="text-[11px] text-charcoal-300 mt-1 uppercase tracking-display flex items-center gap-2">
        {delta != null && <span className={delta >= 0 ? 'text-emerald-700' : 'text-red-700'}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%</span>}
        {sub}
      </p>
    </div>
  );
}

function Today({ label, value, tone }: { label: string; value: number | string; tone?: 'warn' | 'bad' }) {
  return (
    <div className={'rounded-md border px-3 py-2 flex items-baseline justify-between gap-2 ' + (tone === 'bad' ? 'bg-red-50 border-red-200' : tone === 'warn' ? 'bg-brass-50 border-brass-300' : 'bg-cream-100/60 border-charcoal-100')}>
      <span className="text-[10px] uppercase tracking-display text-charcoal-500">{label}</span>
      <span className={'text-lg font-semibold ' + (tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-brass-700' : 'text-charcoal-900')}>{value}</span>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-md bg-cream-100/60 py-1.5">
      <p className={'text-base font-semibold ' + (tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-brass-700' : tone === 'bad' ? 'text-red-700' : 'text-charcoal-900')}>{value}</p>
      <p className="text-[9px] uppercase tracking-display text-charcoal-300">{label}</p>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3"><p className="eyebrow">{title}</p>{action}</div>
      {children}
    </div>
  );
}

// The current period label is set by Panel on each render so every export
// carries it in the header without threading a prop through Table.
let currentPeriod = '';

function Export({ name, rows, cols }: { name: string; rows: Array<object>; cols: Array<[string, string]> }) {
  return (
    <Button size="sm" variant="ghost" className="!py-1 !px-2 text-[11px]" onClick={() => downloadCsv(name, rows, cols.map(([key, label]) => ({ key, label })), currentPeriod)} disabled={rows.length === 0}>
      Exportar CSV
    </Button>
  );
}

type Col = [string, string, ((v: unknown, row: Record<string, unknown>) => React.ReactNode)?];
const rec = (r: object) => r as Record<string, unknown>;

function Table<T extends object>({ title, rows, cols, export: exp, rowTone }: { title: string; rows: T[]; cols: Col[]; export?: { name: string; rows: Array<object> }; rowTone?: (r: T) => 'warn' | 'bad' | undefined }) {
  return (
    <Card title={title} action={exp ? <Export name={exp.name} rows={exp.rows} cols={cols.map(([k, l]) => [k, l])} /> : undefined}>
      {rows.length === 0 ? <p className="text-xs text-charcoal-300">Sin datos en el período.</p> : (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-display text-charcoal-300 border-b border-charcoal-100">
                {cols.map(([k, l], i) => <th key={k} className={'py-1.5 pr-3 font-semibold ' + (i > 0 ? 'text-right' : '')}>{l}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-charcoal-100/70">
              {rows.map((r, ri) => {
                const tone = rowTone?.(r);
                return (
                  <tr key={ri} className={tone === 'bad' ? 'bg-red-50/40' : tone === 'warn' ? 'bg-brass-50/40' : ''}>
                    {cols.map(([k, , fmt], i) => <td key={k} className={'py-1.5 pr-3 ' + (i > 0 ? 'text-right tabular-nums text-charcoal-700' : 'text-charcoal-900 font-medium')}>{fmt ? fmt(rec(r)[k], rec(r)) : String(rec(r)[k] ?? '')}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
