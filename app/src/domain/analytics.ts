import type { Client, Order, OrderLine, OrderStatus, Product, StockDoc } from './types';
import { columnFor, COLUMNS, type ColumnId } from './kanban';
import { addDaysIso, todayInSantiago } from '@/lib/format';

// Pure aggregations for the owners' dashboard. Everything works on the
// in-memory snapshot (≤ a few thousand orders) — no server aggregation yet.

export interface DateRange { from: string; to: string; }   // ISO inclusive
export type RangeKey = '7' | '30' | '90' | 'all';

export function rangeFor(key: RangeKey, today = todayInSantiago()): { current: DateRange; previous: DateRange } {
  if (key === 'all') return { current: { from: '2000-01-01', to: '2999-12-31' }, previous: { from: '1900-01-01', to: '1999-12-31' } };
  const days = Number(key);
  const current = { from: addDaysIso(today, -(days - 1)), to: today };
  const previous = { from: addDaysIso(today, -(2 * days - 1)), to: addDaysIso(today, -days) };
  return { current, previous };
}

const INVOICED: OrderStatus[] = ['facturado', 'despachado', 'entregado'];
const OPEN: OrderStatus[] = ['recibido', 'confirmado', 'confirmado_parcial', 'en_armado', 'armado', 'facturado', 'despachado'];

export const inRange = (o: Order, r: DateRange) => o.requestedDate >= r.from && o.requestedDate <= r.to;
const isInvoiced = (o: Order) => INVOICED.includes(o.status);

export function gramsMap(products: Product[]): Map<string, number | undefined> {
  const m = new Map<string, number | undefined>();
  for (const p of products) for (const f of p.formats) m.set(`${p.id}::${f.formatId}`, f.grams);
  return m;
}
export function lineKg(l: OrderLine, grams: Map<string, number | undefined>, qty = l.qty): number {
  if (l.unit === 'kg') return qty;
  if (l.packedWeightKg != null && qty === (l.packedQty ?? l.qty)) return l.packedWeightKg;
  const g = grams.get(`${l.productId}::${l.formatId}`);
  return g == null ? 0 : (g * qty) / 1000;
}

// ---------- Ventas ----------

export interface SalesTotals { revenue: number; orders: number; invoicedOrders: number; ticket: number; kg: number; anulados: number; }

export function salesTotals(orders: Order[], grams: Map<string, number | undefined>): SalesTotals {
  let revenue = 0, invoicedOrders = 0, kg = 0, anulados = 0, count = 0;
  for (const o of orders) {
    if (o.status === 'anulado') { anulados++; continue; }
    count++;
    if (isInvoiced(o)) { revenue += o.totalCLP ?? 0; invoicedOrders++; }
    for (const l of o.lines) kg += lineKg(l, grams, l.packedQty ?? l.qty);
  }
  return { revenue, orders: count, invoicedOrders, ticket: invoicedOrders ? revenue / invoicedOrders : 0, kg, anulados };
}

export function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return cur ? null : 0;
  return ((cur - prev) / prev) * 100;
}

export interface DayPoint { date: string; label: string; revenue: number; orders: number; kg: number; }
export function seriesByDay(orders: Order[], range: DateRange, grams: Map<string, number | undefined>): DayPoint[] {
  const m = new Map<string, DayPoint>();
  const isAll = range.from < '2001-01-01';
  const days = isAll ? [...new Set(orders.map((o) => o.requestedDate))].sort() : (() => {
    const out: string[] = []; let d = range.from;
    while (d <= range.to) { out.push(d); d = addDaysIso(d, 1); }
    return out;
  })();
  for (const d of days) m.set(d, { date: d, label: d.slice(8, 10) + '/' + d.slice(5, 7), revenue: 0, orders: 0, kg: 0 });
  for (const o of orders) {
    if (o.status === 'anulado') continue;
    const p = m.get(o.requestedDate); if (!p) continue;
    p.orders++;
    if (isInvoiced(o)) p.revenue += o.totalCLP ?? 0;
    for (const l of o.lines) p.kg += lineKg(l, grams, l.packedQty ?? l.qty);
  }
  return [...m.values()];
}

export interface GroupRow { key: string; name: string; orders: number; revenue: number; kg: number; ticket: number; }
function groupBy(orders: Order[], grams: Map<string, number | undefined>, keyOf: (o: Order) => { key: string; name: string } | null): GroupRow[] {
  const m = new Map<string, GroupRow & { invoiced: number }>();
  for (const o of orders) {
    if (o.status === 'anulado') continue;
    const k = keyOf(o); if (!k) continue;
    const row = m.get(k.key) ?? { key: k.key, name: k.name, orders: 0, revenue: 0, kg: 0, ticket: 0, invoiced: 0 };
    row.orders++;
    if (isInvoiced(o)) { row.revenue += o.totalCLP ?? 0; row.invoiced++; }
    for (const l of o.lines) row.kg += lineKg(l, grams, l.packedQty ?? l.qty);
    m.set(k.key, row);
  }
  return [...m.values()].map((r) => ({ ...r, ticket: r.invoiced ? r.revenue / r.invoiced : 0 })).sort((a, b) => b.revenue - a.revenue);
}

export const byVendedor = (orders: Order[], grams: Map<string, number | undefined>, name: (uid: string) => string) =>
  groupBy(orders, grams, (o) => ({ key: o.createdBy, name: name(o.createdBy) }));
export const byClient = (orders: Order[], grams: Map<string, number | undefined>) =>
  groupBy(orders, grams, (o) => ({ key: o.clientId, name: o.clientSnapshot.fantasyName ?? o.clientSnapshot.name }));

export interface ProductRow { key: string; name: string; category: string; kg: number; revenue: number; orders: number; units: number; }
export function byProduct(orders: Order[], products: Product[], grams: Map<string, number | undefined>): ProductRow[] {
  const cat = new Map(products.map((p) => [p.id, p.category]));
  const m = new Map<string, ProductRow>();
  for (const o of orders) {
    if (o.status === 'anulado') continue;
    const seen = new Set<string>();
    for (const l of o.lines) {
      const row = m.get(l.productId) ?? { key: l.productId, name: l.productName, category: cat.get(l.productId) ?? '—', kg: 0, revenue: 0, orders: 0, units: 0 };
      row.kg += lineKg(l, grams, l.packedQty ?? l.qty);
      row.revenue += isInvoiced(o) ? (l.subtotalCLP ?? 0) : 0;
      row.units += l.unit === 'unidad' ? (l.packedQty ?? l.qty) : 0;
      if (!seen.has(l.productId)) { row.orders++; seen.add(l.productId); }
      m.set(l.productId, row);
    }
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue || b.kg - a.kg);
}

export function byCategory(rows: ProductRow[], label: (slug: string) => string): GroupRow[] {
  const m = new Map<string, GroupRow>();
  for (const r of rows) {
    const g = m.get(r.category) ?? { key: r.category, name: label(r.category), orders: 0, revenue: 0, kg: 0, ticket: 0 };
    g.revenue += r.revenue; g.kg += r.kg; g.orders += r.orders;
    m.set(r.category, g);
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue);
}

// ---------- Operación ----------

const H = 60 * 60 * 1000;
function at(o: Order, s: OrderStatus): number | null {
  const e = o.statusHistory.find((h) => h.status === s);
  return e ? e.at : null;
}
export interface LeadTimes { captura: number | null; armado: number | null; documento: number | null; despacho: number | null; entrega: number | null; total: number | null; n: number; }
export function leadTimes(orders: Order[]): LeadTimes {
  const acc: Record<string, number[]> = { captura: [], armado: [], documento: [], despacho: [], entrega: [], total: [] };
  for (const o of orders) {
    if (o.status === 'anulado') continue;
    const r = at(o, 'recibido') ?? o.createdAt;
    const en = at(o, 'en_armado'); const ar = at(o, 'armado'); const fa = at(o, 'facturado'); const de = at(o, 'despachado'); const et = at(o, 'entregado');
    if (en) acc.captura.push((en - r) / H);
    if (en && ar) acc.armado.push((ar - en) / H);
    if (ar && fa) acc.documento.push((fa - ar) / H);
    if (fa && de) acc.despacho.push((de - fa) / H);
    if (de && et) acc.entrega.push((et - de) / H);
    if (et) acc.total.push((et - r) / H);
  }
  const avg = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  return { captura: avg(acc.captura), armado: avg(acc.armado), documento: avg(acc.documento), despacho: avg(acc.despacho), entrega: avg(acc.entrega), total: avg(acc.total), n: acc.total.length };
}

export interface ServiceLevel { onTimePct: number | null; delivered: number; late: number; lateNow: number; openNow: number; }
export function serviceLevel(orders: Order[], today = todayInSantiago()): ServiceLevel {
  let delivered = 0, late = 0, lateNow = 0, openNow = 0;
  for (const o of orders) {
    if (o.status === 'entregado') {
      delivered++;
      const et = at(o, 'entregado');
      const etDate = et ? new Date(et).toISOString().slice(0, 10) : o.requestedDate;
      if (etDate > o.requestedDate) late++;
    } else if (OPEN.includes(o.status)) {
      openNow++;
      if (o.requestedDate < today) lateNow++;
    }
  }
  return { onTimePct: delivered ? ((delivered - late) / delivered) * 100 : null, delivered, late, lateNow, openNow };
}

export interface BacklogRow { col: ColumnId; label: string; count: number; revenue: number; }
export function backlog(orders: Order[]): BacklogRow[] {
  const m = new Map<ColumnId, BacklogRow>(COLUMNS.map((c) => [c.id, { col: c.id, label: c.label, count: 0, revenue: 0 }]));
  for (const o of orders) {
    if (o.status === 'entregado' || o.status === 'anulado') continue;
    const col = columnFor(o.status); if (!col) continue;
    const r = m.get(col)!; r.count++; r.revenue += o.totalCLP ?? 0;
  }
  return [...m.values()].filter((r) => r.col !== 'cerrado');
}

export interface PackerRow { key: string; name: string; enArmado: number; armados: number; kg: number; avgHours: number | null; }
export function byPacker(orders: Order[], grams: Map<string, number | undefined>, name: (uid: string) => string): PackerRow[] {
  const m = new Map<string, PackerRow & { hours: number[] }>();
  for (const o of orders) {
    if (!o.assignedPackerId) continue;
    const r = m.get(o.assignedPackerId) ?? { key: o.assignedPackerId, name: name(o.assignedPackerId), enArmado: 0, armados: 0, kg: 0, avgHours: null, hours: [] };
    if (o.status === 'en_armado') r.enArmado++;
    const en = at(o, 'en_armado'); const ar = at(o, 'armado');
    if (ar) { r.armados++; for (const l of o.lines) r.kg += lineKg(l, grams, l.packedQty ?? l.qty); if (en) r.hours.push((ar - en) / H); }
    m.set(o.assignedPackerId, r);
  }
  return [...m.values()].map((r) => ({ ...r, avgHours: r.hours.length ? r.hours.reduce((s, x) => s + x, 0) / r.hours.length : null })).sort((a, b) => b.armados - a.armados);
}

export interface AnuladoRow { id: string; client: string; vendedor: string; date: string; reason: string; revenue: number; }
export function anulados(orders: Order[], name: (uid: string) => string): AnuladoRow[] {
  return orders.filter((o) => o.status === 'anulado').map((o) => ({
    id: o.id, client: o.clientSnapshot.fantasyName ?? o.clientSnapshot.name, vendedor: name(o.createdBy), date: o.requestedDate,
    reason: [...o.statusHistory].reverse().find((h) => h.status === 'anulado')?.note ?? '', revenue: o.totalCLP ?? 0,
  }));
}

// ---------- Stock ----------

export interface StockRow { key: string; product: string; format: string; unit: OrderLine['unit']; onHand: number; reserved: number; available: number; avgDaily: number; coverageDays: number | null; pending: number; mermaKg: number; }
export function stockRows(products: Product[], stock: Map<string, StockDoc>, orders: Order[], grams: Map<string, number | undefined>, today = todayInSantiago()): StockRow[] {
  const since = addDaysIso(today, -30);
  const demand = new Map<string, number>(); const pending = new Map<string, number>(); const merma = new Map<string, number>();
  for (const o of orders) {
    if (o.status === 'anulado') continue;
    for (const l of o.lines) {
      const k = `${l.productId}__${l.formatId}`;
      if (o.requestedDate >= since && o.requestedDate <= today) demand.set(k, (demand.get(k) ?? 0) + l.qty);
      if (l.pendingProductionQty > 0 && OPEN.includes(o.status)) pending.set(k, (pending.get(k) ?? 0) + l.pendingProductionQty);
      if (l.packedQty != null && l.reservedQty > 0) {
        const diff = lineKg(l, grams, l.reservedQty) - lineKg(l, grams, l.packedQty);
        if (Math.abs(diff) >= 0.05) merma.set(k, (merma.get(k) ?? 0) + diff);
      }
    }
  }
  const rows: StockRow[] = [];
  for (const p of products) {
    if (!p.active || p.discontinued) continue;
    for (const f of p.formats) {
      const k = `${p.id}__${f.formatId}`; const s = stock.get(k);
      const onHand = s?.onHand ?? 0; const reserved = s?.reserved ?? 0; const available = onHand - reserved;
      const avgDaily = (demand.get(k) ?? 0) / 30;
      rows.push({ key: k, product: p.name, format: f.label, unit: f.unit, onHand, reserved, available, avgDaily, coverageDays: avgDaily > 0 ? available / avgDaily : null, pending: pending.get(k) ?? 0, mermaKg: merma.get(k) ?? 0 });
    }
  }
  return rows.sort((a, b) => (b.pending - a.pending) || ((a.coverageDays ?? 1e9) - (b.coverageDays ?? 1e9)));
}

// ---------- Clientes y fuerza de ventas ----------

export type ClientHealth = 'nuevo' | 'activo' | 'en_riesgo' | 'inactivo' | 'sin_pedidos';
export interface ClientRow {
  id: string; name: string; owner: string; ownerUid?: string; orders: number; revenue: number; ticket: number;
  lastDate: string | null; daysSince: number | null; avgIntervalDays: number | null; health: ClientHealth; invoicingComplete: boolean; needsReview: boolean;
}
export function clientRows(clients: Client[], allOrders: Order[], range: DateRange, name: (uid: string) => string, today = todayInSantiago()): ClientRow[] {
  const byId = new Map<string, Order[]>();
  for (const o of allOrders) { if (o.status === 'anulado') continue; const l = byId.get(o.clientId) ?? []; l.push(o); byId.set(o.clientId, l); }
  const todayMs = Date.parse(today);
  return clients.map((c) => {
    const os = (byId.get(c.id) ?? []).sort((a, b) => a.requestedDate.localeCompare(b.requestedDate));
    const inR = os.filter((o) => inRange(o, range));
    const invoiced = inR.filter(isInvoiced);
    const revenue = invoiced.reduce((s, o) => s + (o.totalCLP ?? 0), 0);
    const last = os.length ? os[os.length - 1].requestedDate : null;
    const daysSince = last ? Math.round((todayMs - Date.parse(last)) / (24 * H)) : null;
    let avgInterval: number | null = null;
    if (os.length >= 2) { let sum = 0; for (let i = 1; i < os.length; i++) sum += (Date.parse(os[i].requestedDate) - Date.parse(os[i - 1].requestedDate)) / (24 * H); avgInterval = sum / (os.length - 1); }
    const first = os.length ? os[0].requestedDate : null;
    let health: ClientHealth = 'sin_pedidos';
    if (first && first >= range.from && first <= range.to && os.length <= 2) health = 'nuevo';
    else if (daysSince != null) health = daysSince <= 14 ? 'activo' : daysSince <= 30 ? 'en_riesgo' : 'inactivo';
    return {
      id: c.id, name: c.fantasyName ?? c.name, owner: c.ownerUid ? name(c.ownerUid) : '—', ownerUid: c.ownerUid,
      orders: inR.length, revenue, ticket: invoiced.length ? revenue / invoiced.length : 0,
      lastDate: last, daysSince, avgIntervalDays: avgInterval, health, invoicingComplete: c.invoicingComplete, needsReview: !!c.needsReview,
    };
  }).sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
}

export function pareto(rows: ClientRow[]): { topShare: number; topCount: number } {
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  if (!total) return { topShare: 0, topCount: 0 };
  const sorted = [...rows].sort((a, b) => b.revenue - a.revenue);
  const topCount = Math.max(1, Math.ceil(sorted.length * 0.2));
  const top = sorted.slice(0, topCount).reduce((s, r) => s + r.revenue, 0);
  return { topShare: (top / total) * 100, topCount };
}

export interface SalesForceRow extends GroupRow {
  cartera: number; activos: number; enRiesgo: number; inactivos: number; nuevos: number; anulados: number; parciales: number; avgDaysSince: number | null;
}
export function salesForce(orders: Order[], clients: ClientRow[], grams: Map<string, number | undefined>, name: (uid: string) => string, vendedores: Array<{ uid: string; name: string }>): SalesForceRow[] {
  const base = new Map(byVendedor(orders, grams, name).map((r) => [r.key, r]));
  return vendedores.map((v) => {
    const g = base.get(v.uid) ?? { key: v.uid, name: v.name, orders: 0, revenue: 0, kg: 0, ticket: 0 };
    const mine = clients.filter((c) => c.ownerUid === v.uid);
    const withOrders = mine.filter((c) => c.daysSince != null);
    const avgDaysSince = withOrders.length ? withOrders.reduce((s, c) => s + (c.daysSince ?? 0), 0) / withOrders.length : null;
    return {
      ...g,
      cartera: mine.length,
      activos: mine.filter((c) => c.health === 'activo' || c.health === 'nuevo').length,
      enRiesgo: mine.filter((c) => c.health === 'en_riesgo').length,
      inactivos: mine.filter((c) => c.health === 'inactivo').length,
      nuevos: mine.filter((c) => c.health === 'nuevo').length,
      anulados: orders.filter((o) => o.createdBy === v.uid && o.status === 'anulado').length,
      parciales: orders.filter((o) => o.createdBy === v.uid && o.lines.some((l) => l.pendingProductionQty > 0) && OPEN.includes(o.status)).length,
      avgDaysSince,
    };
  }).sort((a, b) => b.revenue - a.revenue);
}
