import { SALES_KINDS, type FactDoc, type FactLine, type MonthIndexEntry, type VariantStock } from '@/data/facts';
import { variantNames, type BsaleVariantMirror, type CatalogMapEntry } from '@/data/catalogMap';
import type { DocKind } from '@/data/bsaleAdmin';
import type { Product } from './types';

// Análisis del Panel de gestión sobre los hechos de venta de Bsale
// (data/facts.ts). Funciones puras: filtran por rango, sucursal y vendedor y
// agregan; la pantalla solo dibuja.

// ---------- Períodos ----------

export interface Range { from: string; to: string }
export type PeriodKey = 'mes' | 'mesAnterior' | '30' | '90' | '12m' | 'ytd';
export type CompareMode = 'anterior' | 'anio';

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  mes: 'Mes en curso', mesAnterior: 'Mes anterior', '30': '30 días', '90': '90 días', '12m': '12 meses', ytd: 'Año en curso',
};

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => iso(parse(d) + n * 86400_000);
export const daysIn = (r: Range) => Math.round((parse(r.to) - parse(r.from)) / 86400_000) + 1;
const shiftYear = (d: string, n: number) => {
  const [y, m, day] = d.split('-').map(Number);
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return `${y + n}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
};

export function periodRange(key: PeriodKey, today: string): Range {
  const [y, m] = today.split('-').map(Number);
  switch (key) {
    case 'mes': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'mesAnterior': { const first = iso(Date.UTC(y, m - 2, 1)); return { from: first, to: iso(Date.UTC(y, m - 1, 0)) }; }
    case '30': return { from: addDays(today, -29), to: today };
    case '90': return { from: addDays(today, -89), to: today };
    case '12m': return { from: iso(Date.UTC(y - 1, m - 1, Number(today.slice(8)) + 1)), to: today };
    case 'ytd': return { from: `${y}-01-01`, to: today };
  }
}

export function compareRange(r: Range, mode: CompareMode, key: PeriodKey): Range {
  if (mode === 'anio') return { from: shiftYear(r.from, -1), to: shiftYear(r.to, -1) };
  if (key === 'mes') {
    // Month to date vs the same days of the previous month.
    const [y, m] = r.from.split('-').map(Number);
    const from = iso(Date.UTC(y, m - 2, 1));
    const last = iso(Date.UTC(y, m - 1, 0));
    const to = addDays(from, daysIn(r) - 1);
    return { from, to: to > last ? last : to };
  }
  if (key === 'mesAnterior') { const [y, m] = r.from.split('-').map(Number); return { from: iso(Date.UTC(y, m - 2, 1)), to: iso(Date.UTC(y, m - 1, 0)) }; }
  const n = daysIn(r);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

export function monthsOf(...ranges: Range[]): string[] {
  const set = new Set<string>();
  for (const r of ranges) {
    let [y, m] = r.from.split('-').map(Number);
    const end = r.to.slice(0, 7);
    for (;;) { const k = `${y}-${String(m).padStart(2, '0')}`; set.add(k); if (k >= end) break; m++; if (m > 12) { m = 1; y++; } }
  }
  return [...set].sort();
}

export const fmtRange = (r: Range) => {
  const f = (d: string) => new Date(parse(d)).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
  return `${f(r.from)} – ${f(r.to)}`;
};

// ---------- Dimensiones ----------

export interface VariantDim { id: string; product: string; format: string; label: string; type: string; productKey: string; kgPerUnit: number | null }

export function variantDims(variants: BsaleVariantMirror[], map: CatalogMapEntry[], products: Product[]): Map<string, VariantDim> {
  const grams = new Map<string, number | undefined>();
  for (const p of products) for (const f of p.formats) grams.set(`${p.id}__${f.formatId}`, f.unit === 'kg' ? 1000 : f.grams);
  const confirmed = new Map(map.filter((m) => m.status === 'confirmado' && m.productId).map((m) => [m.variantId, `${m.productId}__${m.formatId}`]));
  const names = variantNames(variants);
  const out = new Map<string, VariantDim>();
  for (const v of variants) {
    let kg: number | null = null;
    if (v.allowDecimal) kg = 1;
    else {
      const g = confirmed.has(v.variantId) ? grams.get(confirmed.get(v.variantId)!) : undefined;
      const fromText = Number((v.description || v.productName).match(/(\d+(?:[.,]\d+)?)\s*(?:g|gr|grs)\b/i)?.[1]?.replace(',', '.'));
      kg = g ? g / 1000 : fromText ? fromText / 1000 : null;
    }
    out.set(v.variantId, {
      id: v.variantId, product: titleCase(names.get(v.variantId)!.product), format: names.get(v.variantId)!.format, label: titleCase(names.get(v.variantId)!.label),
      type: titleCase(v.productType || 'Sin tipo'), productKey: v.bsaleProductId, kgPerUnit: kg,
    });
  }
  return out;
}

function titleCase(s: string) {
  if (s !== s.toUpperCase()) return s;
  return s.toLocaleLowerCase('es').replace(/(^|[\s(·/-])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase('es'));
}

const unknownDim = (id: string): VariantDim => ({ id, product: `Variante ${id}`, format: '—', label: `Variante ${id}`, type: 'Sin tipo', productKey: `v${id}`, kgPerUnit: null });
export const dimOf = (dims: Map<string, VariantDim>, id: string) => dims.get(id) ?? unknownDim(id);

// ---------- Filtros ----------

export interface Filters { officeId?: number; sellerId?: string }
const inR = (d: string, r: Range) => d >= r.from && d <= r.to;
export function pickDocs(docs: FactDoc[], r: Range, f: Filters) {
  return docs.filter((d) => SALES_KINDS.has(d.kind) && inR(d.date, r) && (f.officeId == null || d.officeId === f.officeId) && (!f.sellerId || d.sellerId === f.sellerId));
}
export function pickLines(lines: FactLine[], r: Range, f: Filters) {
  return lines.filter((d) => SALES_KINDS.has(d.kind) && inR(d.date, r) && (f.officeId == null || d.officeId === f.officeId) && (!f.sellerId || d.sellerId === f.sellerId));
}

// ---------- Totales ----------

export interface Totals {
  net: number; gross: number; docs: number; ticket: number; clients: number; creditNotes: number; creditNet: number;
  units: number; kg: number; kgCoverage: number; cost: number; margin: number | null; marginPct: number | null; costCoverage: number;
}

export function totals(docs: FactDoc[], lines: FactLine[], dims: Map<string, VariantDim>, costs: Record<string, number>): Totals {
  let net = 0, gross = 0, n = 0, nc = 0, ncNet = 0, salesNet = 0;
  const clients = new Set<string>();
  for (const d of docs) {
    net += d.net; gross += d.total;
    if (d.kind === 'nota_credito') { nc++; ncNet += d.net; } else { n++; salesNet += d.net; }
    if (d.clientId !== '0' && d.kind !== 'nota_credito') clients.add(d.clientId);
  }
  let units = 0, kg = 0, kgNet = 0, cost = 0, costedNet = 0, linesNet = 0;
  for (const l of lines) {
    units += l.qty; linesNet += l.net;
    const dim = dimOf(dims, l.variantId);
    if (dim.kgPerUnit != null) { kg += l.qty * dim.kgPerUnit; kgNet += l.net; }
    const c = costs[l.variantId];
    if (c) { cost += c * l.qty; costedNet += l.net; }
  }
  const margin = costedNet ? costedNet - cost : null;
  return {
    net, gross, docs: n, ticket: n ? salesNet / n : 0, clients: clients.size, creditNotes: nc, creditNet: ncNet,
    units, kg, kgCoverage: linesNet ? kgNet / linesNet : 0, cost, margin, marginPct: margin != null && costedNet ? (margin / costedNet) * 100 : null,
    costCoverage: linesNet ? costedNet / linesNet : 0,
  };
}

export const delta = (cur: number, prev: number): number | null => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);

// ---------- Series ----------

export interface SeriesPoint { i: number; label: string; date: string; cur: number; cmp: number | null }

// Daily for ranges up to 92 days, weekly beyond. The comparison is aligned by
// position (day 1 vs day 1).
export function series(cur: FactDoc[], cmp: FactDoc[], r: Range, rc: Range): SeriesPoint[] {
  const weekly = daysIn(r) > 92;
  const step = weekly ? 7 : 1;
  const bucket = (date: string, from: string) => Math.floor((parse(date) - parse(from)) / 86400_000 / step);
  const n = Math.ceil(daysIn(r) / step);
  const pts: SeriesPoint[] = Array.from({ length: n }, (_, i) => {
    const date = addDays(r.from, i * step);
    const d = new Date(parse(date));
    return { i, date, label: weekly ? d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : d.toLocaleDateString('es-CL', { day: 'numeric', month: 'numeric', timeZone: 'UTC' }), cur: 0, cmp: 0 };
  });
  for (const d of cur) { const b = bucket(d.date, r.from); if (pts[b]) pts[b].cur += d.net; }
  const cn = Math.ceil(daysIn(rc) / step);
  for (const d of cmp) { const b = bucket(d.date, rc.from); if (pts[b] && b < cn) pts[b].cmp = (pts[b].cmp ?? 0) + d.net; }
  for (const p of pts) if (p.i >= cn) p.cmp = null;
  return pts;
}

const MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export interface SeasonPoint { m: number; label: string; thisYear: number | null; lastYear: number | null; thisYearStore: number | null; lastYearStore: number | null }

// Twelve months ending this month, this year vs the previous: read from the
// facts index only (no month documents downloaded).
export function seasonality(index: Record<string, MonthIndexEntry>, today: string, storeOfficeId?: number, officeId?: number): SeasonPoint[] {
  const [y, m] = today.split('-').map(Number);
  const val = (k: string, store: boolean) => {
    const e = index[k];
    if (!e) return null;
    if (store) return storeOfficeId ? e.netByOffice?.[String(storeOfficeId)] ?? 0 : null;
    if (officeId != null) return e.netByOffice?.[String(officeId)] ?? 0;
    return e.net ?? null;
  };
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 12 + i, 1));
    const k = d.toISOString().slice(0, 7);
    const kPrev = `${d.getUTCFullYear() - 1}-${k.slice(5)}`;
    return { m: i, label: `${MONTH_ABBR[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, thisYear: val(k, false), lastYear: val(kPrev, false), thisYearStore: val(k, true), lastYearStore: val(kPrev, true) };
  });
}

export function byWeekday(docs: FactDoc[]) {
  const names = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const out = names.map((name) => ({ name, net: 0, docs: 0 }));
  for (const d of docs) { const w = (new Date(parse(d.date)).getUTCDay() + 6) % 7; out[w].net += d.net; if (d.kind !== 'nota_credito') out[w].docs++; }
  return out;
}

export const KIND_LABEL: Record<DocKind, string> = { factura: 'Facturas', boleta: 'Boletas', guia: 'Guías', nota_credito: 'Notas de crédito', otro: 'Otros' };
export function byKind(docs: FactDoc[]) {
  const m = new Map<DocKind, { kind: DocKind; name: string; net: number; docs: number }>();
  for (const d of docs) { const r = m.get(d.kind) ?? { kind: d.kind, name: KIND_LABEL[d.kind], net: 0, docs: 0 }; r.net += d.net; r.docs++; m.set(d.kind, r); }
  return [...m.values()].sort((a, b) => b.net - a.net);
}

// ---------- Productos ----------

export type ProductGroup = 'variante' | 'producto' | 'tipo';
export interface ProductRow {
  key: string; name: string; format: string; type: string; units: number; kg: number | null; net: number; share: number; cum: number; abc: 'A' | 'B' | 'C';
  avgPrice: number; cost: number | null; margin: number | null; marginPct: number | null; cmpNet: number; delta: number | null; clients: number;
}

export function productRows(cur: FactLine[], cmp: FactLine[], dims: Map<string, VariantDim>, costs: Record<string, number>, group: ProductGroup): ProductRow[] {
  const keyOf = (v: string) => { const d = dimOf(dims, v); return group === 'variante' ? v : group === 'producto' ? d.productKey : d.type; };
  const acc = new Map<string, ProductRow & { costed: number; clientSet: Set<string> }>();
  for (const l of cur) {
    const d = dimOf(dims, l.variantId);
    const k = keyOf(l.variantId);
    const r = acc.get(k) ?? { key: k, name: group === 'tipo' ? d.type : d.product, format: group === 'variante' ? d.format : '', type: d.type, units: 0, kg: 0, net: 0, share: 0, cum: 0, abc: 'C' as const, avgPrice: 0, cost: 0, margin: null, marginPct: null, cmpNet: 0, delta: null, clients: 0, costed: 0, clientSet: new Set<string>() };
    r.units += l.qty; r.net += l.net;
    if (d.kgPerUnit != null && r.kg != null) r.kg += l.qty * d.kgPerUnit; else r.kg = null;
    const c = costs[l.variantId];
    if (c) { r.cost = (r.cost ?? 0) + c * l.qty; r.costed += l.net; }
    if (l.clientId !== '0') r.clientSet.add(l.clientId);
    acc.set(k, r);
  }
  const cmpBy = new Map<string, number>();
  for (const l of cmp) { const k = keyOf(l.variantId); cmpBy.set(k, (cmpBy.get(k) ?? 0) + l.net); }
  for (const [k, v] of cmpBy) if (!acc.has(k)) {
    const d = dimOf(dims, group === 'variante' ? k : cmp.find((l) => keyOf(l.variantId) === k)!.variantId);
    acc.set(k, { key: k, name: group === 'tipo' ? d.type : d.product, format: group === 'variante' ? d.format : '', type: d.type, units: 0, kg: 0, net: 0, share: 0, cum: 0, abc: 'C', avgPrice: 0, cost: 0, margin: null, marginPct: null, cmpNet: v, delta: null, clients: 0, costed: 0, clientSet: new Set() });
  }
  const rows = [...acc.values()].sort((a, b) => b.net - a.net);
  const total = rows.reduce((s, r) => s + Math.max(0, r.net), 0);
  let cum = 0;
  return rows.map(({ costed, clientSet, ...r }) => {
    cum += Math.max(0, r.net);
    const share = total ? (r.net / total) * 100 : 0;
    const cumPct = total ? (cum / total) * 100 : 0;
    const cmpNet = cmpBy.get(r.key) ?? 0;
    const margin = costed ? costed - (r.cost ?? 0) : null;
    return {
      ...r, share, cum: cumPct, abc: cumPct - share < 80 ? 'A' : cumPct - share < 95 ? 'B' : 'C',
      avgPrice: r.units ? r.net / r.units : 0, cost: costed ? r.cost : null, margin, marginPct: margin != null && costed ? (margin / costed) * 100 : null,
      cmpNet, delta: delta(r.net, cmpNet), clients: clientSet.size,
    };
  });
}

// ---------- Clientes ----------

export type ClientStatus = 'nuevo' | 'activo' | 'en_riesgo' | 'perdido';
export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = { nuevo: 'Nuevo', activo: 'Activo', en_riesgo: 'En riesgo', perdido: 'Perdido' };
export interface ClientRow {
  id: string; name: string; rut: string; net: number; cmpNet: number; delta: number | null; docs: number; ticket: number;
  net12: number; docs12: number; first: string; last: string; daysSince: number; interval: number | null; status: ClientStatus; seller: string; share: number;
}

// `history` covers the loaded months (ideally 12+): recency, frequency and
// first purchase come from there; `net`/`docs` from the selected range.
export function clientRows(history: FactDoc[], r: Range, rc: Range, today: string, f: Filters, sellerName: (id: string) => string, clientName: (id: string) => { name: string; rut: string }): ClientRow[] {
  const acc = new Map<string, { net: number; cmp: number; docs: number; net12: number; days: Set<string>; first: string; last: string; sellers: Map<string, number> }>();
  const since12 = addDays(today, -365);
  for (const d of history) {
    if (!SALES_KINDS.has(d.kind) || d.clientId === '0' || d.date > r.to) continue;
    if (f.officeId != null && d.officeId !== f.officeId) continue;
    if (f.sellerId && d.sellerId !== f.sellerId) continue;
    const a = acc.get(d.clientId) ?? { net: 0, cmp: 0, docs: 0, net12: 0, days: new Set<string>(), first: d.date, last: d.date, sellers: new Map<string, number>() };
    if (inR(d.date, r)) { a.net += d.net; if (d.kind !== 'nota_credito') a.docs++; }
    if (inR(d.date, rc)) a.cmp += d.net;
    if (d.date >= since12) a.net12 += d.net;
    if (d.kind !== 'nota_credito') {
      a.days.add(d.date);
      if (d.date < a.first) a.first = d.date;
      if (d.date > a.last) a.last = d.date;
      a.sellers.set(d.sellerId, (a.sellers.get(d.sellerId) ?? 0) + d.net);
    }
    acc.set(d.clientId, a);
  }
  const total = [...acc.values()].reduce((s, a) => s + Math.max(0, a.net), 0);
  const rows: ClientRow[] = [];
  for (const [id, a] of acc) {
    const days = [...a.days].sort();
    const interval = days.length > 1 ? (parse(days[days.length - 1]) - parse(days[0])) / 86400_000 / (days.length - 1) : null;
    const daysSince = Math.round((parse(r.to) - parse(a.last)) / 86400_000);
    const expected = Math.max(21, (interval ?? 30) * 1.5);
    const status: ClientStatus = a.first >= r.from ? 'nuevo'
      : daysSince > Math.max(60, (interval ?? 30) * 3) || (a.net <= 0 && a.cmp > 0) ? 'perdido'
      : daysSince > expected ? 'en_riesgo' : 'activo';
    const seller = [...a.sellers.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const c = clientName(id);
    rows.push({
      id, name: c.name || `Cliente ${id}`, rut: c.rut, net: a.net, cmpNet: a.cmp, delta: delta(a.net, a.cmp), docs: a.docs, ticket: a.docs ? a.net / a.docs : 0,
      net12: a.net12, docs12: days.filter((d) => d >= since12).length, first: a.first, last: a.last, daysSince, interval, status,
      seller: seller ? sellerName(seller) : '—', share: total ? (a.net / total) * 100 : 0,
    });
  }
  return rows.sort((a, b) => b.net - a.net || b.net12 - a.net12);
}

export function concentration(rows: ClientRow[]) {
  const pos = rows.filter((r) => r.net > 0).sort((a, b) => b.net - a.net);
  const total = pos.reduce((s, r) => s + r.net, 0);
  let cum = 0, n80 = 0;
  for (const r of pos) { cum += r.net; n80++; if (cum >= total * 0.8) break; }
  const top10 = pos.slice(0, 10).reduce((s, r) => s + r.net, 0);
  return { buyers: pos.length, top10Share: total ? (top10 / total) * 100 : 0, n80 };
}

// ---------- Vendedores ----------

export interface SellerRow { id: string; name: string; net: number; cmpNet: number; delta: number | null; docs: number; ticket: number; clients: number; newClients: number; kg: number; marginPct: number | null; share: number; storeShare: number }

export function sellerRows(curDocs: FactDoc[], cmpDocs: FactDoc[], curLines: FactLine[], clients: ClientRow[], dims: Map<string, VariantDim>, costs: Record<string, number>, sellerName: (id: string) => string, storeOfficeId?: number): SellerRow[] {
  const acc = new Map<string, { net: number; cmp: number; docs: number; store: number; clients: Set<string> }>();
  const get = (id: string) => { const a = acc.get(id) ?? { net: 0, cmp: 0, docs: 0, store: 0, clients: new Set<string>() }; acc.set(id, a); return a; };
  for (const d of curDocs) { const a = get(d.sellerId); a.net += d.net; if (d.kind !== 'nota_credito') a.docs++; if (d.officeId === storeOfficeId) a.store += d.net; if (d.clientId !== '0') a.clients.add(d.clientId); }
  for (const d of cmpDocs) get(d.sellerId).cmp += d.net;
  const kg = new Map<string, number>(); const cost = new Map<string, number>(); const costed = new Map<string, number>();
  for (const l of curLines) {
    const dim = dimOf(dims, l.variantId);
    if (dim.kgPerUnit != null) kg.set(l.sellerId, (kg.get(l.sellerId) ?? 0) + l.qty * dim.kgPerUnit);
    const c = costs[l.variantId];
    if (c) { cost.set(l.sellerId, (cost.get(l.sellerId) ?? 0) + c * l.qty); costed.set(l.sellerId, (costed.get(l.sellerId) ?? 0) + l.net); }
  }
  const newBy = new Map<string, number>();
  for (const c of clients) if (c.status === 'nuevo') { const s = c.seller; newBy.set(s, (newBy.get(s) ?? 0) + 1); }
  const total = [...acc.values()].reduce((s, a) => s + Math.max(0, a.net), 0);
  return [...acc.entries()].map(([id, a]) => {
    const name = id === '0' ? 'Sin vendedor' : sellerName(id);
    const cn = costed.get(id) ?? 0;
    return {
      id, name, net: a.net, cmpNet: a.cmp, delta: delta(a.net, a.cmp), docs: a.docs, ticket: a.docs ? a.net / a.docs : 0, clients: a.clients.size,
      newClients: newBy.get(name) ?? 0, kg: kg.get(id) ?? 0, marginPct: cn ? ((cn - (cost.get(id) ?? 0)) / cn) * 100 : null,
      share: total ? (a.net / total) * 100 : 0, storeShare: a.net ? (a.store / a.net) * 100 : 0,
    };
  }).filter((r) => r.net !== 0 || r.cmpNet !== 0).sort((a, b) => b.net - a.net);
}

// ---------- Stock ----------

export type StockFlag = 'quiebre' | 'bajo' | 'ok' | 'sobre' | 'sin_movimiento';
export const STOCK_FLAG_LABEL: Record<StockFlag, string> = { quiebre: 'Quiebre', bajo: 'Bajo', ok: 'OK', sobre: 'Sobre-stock', sin_movimiento: 'Sin movimiento' };
export interface StockAnalysisRow {
  variantId: string; name: string; format: string; type: string; factory: number; store: number; daily: number; storeDaily: number;
  coverage: number | null; storeCoverage: number | null; flag: StockFlag; restock: number; stockValue: number | null; sold90: number;
}

// Velocity from the last 30 days (90 for "sin movimiento"); store restock
// suggestion covers `targetDays` of store sales, capped by factory stock.
export function stockAnalysis(stock: VariantStock[], lines: FactLine[], today: string, dims: Map<string, VariantDim>, costs: Record<string, number>, factoryId?: number, storeId?: number, targetDays = 7): StockAnalysisRow[] {
  const from30 = addDays(today, -29); const from90 = addDays(today, -89);
  const sold30 = new Map<string, number>(); const sold30Store = new Map<string, number>(); const sold90 = new Map<string, number>();
  for (const l of lines) {
    if (!SALES_KINDS.has(l.kind) || l.date > today) continue;
    if (l.date >= from90) sold90.set(l.variantId, (sold90.get(l.variantId) ?? 0) + l.qty);
    if (l.date >= from30) {
      sold30.set(l.variantId, (sold30.get(l.variantId) ?? 0) + l.qty);
      if (l.officeId === storeId) sold30Store.set(l.variantId, (sold30Store.get(l.variantId) ?? 0) + l.qty);
    }
  }
  const ids = new Set([...stock.map((s) => s.variantId), ...sold30.keys()]);
  const byId = new Map(stock.map((s) => [s.variantId, s]));
  const rows: StockAnalysisRow[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    const factory = factoryId ? s?.offices[String(factoryId)]?.available ?? 0 : 0;
    const store = storeId ? s?.offices[String(storeId)]?.available ?? 0 : 0;
    const daily = (sold30.get(id) ?? 0) / 30;
    const storeDaily = (sold30Store.get(id) ?? 0) / 30;
    const onHand = factory + store;
    const coverage = daily > 0 ? onHand / daily : null;
    const storeCoverage = storeDaily > 0 ? store / storeDaily : null;
    const s90 = sold90.get(id) ?? 0;
    const flag: StockFlag = onHand <= 0 && daily > 0 ? 'quiebre'
      : onHand > 0 && s90 <= 0 ? 'sin_movimiento'
      : coverage != null && coverage < 7 ? 'bajo'
      : coverage != null && coverage > 60 ? 'sobre' : 'ok';
    const restock = storeDaily > 0 ? Math.max(0, Math.min(Math.max(0, factory), Math.ceil(storeDaily * targetDays - Math.max(0, store)))) : 0;
    if (onHand === 0 && daily === 0) continue;
    const d = dimOf(dims, id);
    rows.push({ variantId: id, name: d.product, format: d.format, type: d.type, factory, store, daily, storeDaily, coverage, storeCoverage, flag, restock, stockValue: costs[id] ? Math.max(0, onHand) * costs[id] : null, sold90: s90 });
  }
  const order: Record<StockFlag, number> = { quiebre: 0, bajo: 1, sobre: 3, sin_movimiento: 4, ok: 2 };
  return rows.sort((a, b) => order[a.flag] - order[b.flag] || b.daily - a.daily);
}

// ---------- Explorador (tabla dinámica) ----------

export type PivotDim = 'mes' | 'semana' | 'dia' | 'sucursal' | 'vendedor' | 'cliente' | 'producto' | 'variante' | 'tipo' | 'documento';
export type PivotMeasure = 'net' | 'units' | 'kg' | 'margin' | 'clients';
export const PIVOT_DIM_LABEL: Record<PivotDim, string> = { mes: 'Mes', semana: 'Semana', dia: 'Día', sucursal: 'Sucursal', vendedor: 'Vendedor', cliente: 'Cliente', producto: 'Producto', variante: 'Producto · formato', tipo: 'Tipo de producto', documento: 'Tipo de documento' };
export const PIVOT_MEASURE_LABEL: Record<PivotMeasure, string> = { net: 'Venta neta', units: 'Unidades', kg: 'Kilos', margin: 'Margen bruto', clients: 'Clientes distintos' };

export interface PivotCtx { dims: Map<string, VariantDim>; costs: Record<string, number>; office: (id: number) => string; seller: (id: string) => string; client: (id: string) => string }
export interface PivotResult { cols: Array<{ key: string; label: string }>; rows: Array<{ key: string; label: string; cells: Record<string, number>; total: number }>; colTotals: Record<string, number>; total: number }

const weekStart = (d: string) => { const t = parse(d); const w = (new Date(t).getUTCDay() + 6) % 7; return iso(t - w * 86400_000); };

function dimKey(l: FactLine, dim: PivotDim, ctx: PivotCtx): [string, string] {
  switch (dim) {
    case 'mes': return [l.date.slice(0, 7), l.date.slice(0, 7)];
    case 'semana': { const w = weekStart(l.date); return [w, `sem. ${w.slice(8)}/${w.slice(5, 7)}/${w.slice(2, 4)}`]; }
    case 'dia': return [l.date, l.date];
    case 'sucursal': return [String(l.officeId), ctx.office(l.officeId)];
    case 'vendedor': return [l.sellerId, ctx.seller(l.sellerId)];
    case 'cliente': return [l.clientId, ctx.client(l.clientId)];
    case 'producto': { const d = dimOf(ctx.dims, l.variantId); return [d.productKey, d.product]; }
    case 'variante': { const d = dimOf(ctx.dims, l.variantId); return [l.variantId, `${d.product} · ${d.format}`]; }
    case 'tipo': { const d = dimOf(ctx.dims, l.variantId); return [d.type, d.type]; }
    case 'documento': return [l.kind, KIND_LABEL[l.kind]];
  }
}

export function pivot(lines: FactLine[], rowDim: PivotDim, colDim: PivotDim | null, measure: PivotMeasure, ctx: PivotCtx): PivotResult {
  const val = (l: FactLine) => {
    switch (measure) {
      case 'net': return l.net;
      case 'units': return l.qty;
      case 'kg': { const k = dimOf(ctx.dims, l.variantId).kgPerUnit; return k != null ? l.qty * k : 0; }
      case 'margin': { const c = ctx.costs[l.variantId]; return c ? l.net - c * l.qty : 0; }
      case 'clients': return 0;
    }
  };
  const cells = new Map<string, Map<string, number>>();
  const distinct = new Map<string, Set<string>>();
  const rowLabels = new Map<string, string>(); const colLabels = new Map<string, string>();
  for (const l of lines) {
    const [rk, rl] = dimKey(l, rowDim, ctx); rowLabels.set(rk, rl);
    const [ck, cl] = colDim ? dimKey(l, colDim, ctx) : ['total', 'Total']; colLabels.set(ck, cl);
    if (measure === 'clients') {
      if (l.clientId === '0') continue;
      for (const k of [`${rk}|${ck}`, `${rk}|*`, `*|${ck}`, '*|*']) { const s = distinct.get(k) ?? new Set<string>(); s.add(l.clientId); distinct.set(k, s); }
      continue;
    }
    const row = cells.get(rk) ?? new Map<string, number>();
    row.set(ck, (row.get(ck) ?? 0) + val(l));
    cells.set(rk, row);
  }
  const sortedCols = [...colLabels.entries()].sort((a, b) => (colDim && ['mes', 'semana', 'dia'].includes(colDim) ? a[0].localeCompare(b[0]) : 0));
  let cols = sortedCols.map(([key, label]) => ({ key, label }));
  const rows = [...rowLabels.entries()].map(([key, label]) => {
    const c: Record<string, number> = {};
    let total = 0;
    for (const col of cols) {
      const v = measure === 'clients' ? distinct.get(`${key}|${col.key}`)?.size ?? 0 : cells.get(key)?.get(col.key) ?? 0;
      c[col.key] = v; total += v;
    }
    if (measure === 'clients') total = distinct.get(`${key}|*`)?.size ?? 0;
    return { key, label, cells: c, total };
  });
  const colTotals: Record<string, number> = {};
  for (const col of cols) colTotals[col.key] = measure === 'clients' ? distinct.get(`*|${col.key}`)?.size ?? 0 : rows.reduce((s, r) => s + r.cells[col.key], 0);
  // Without a time dimension in columns, order columns by weight.
  if (!colDim || !['mes', 'semana', 'dia'].includes(colDim)) cols = cols.sort((a, b) => colTotals[b.key] - colTotals[a.key]);
  const timeRows = ['mes', 'semana', 'dia'].includes(rowDim);
  rows.sort((a, b) => (timeRows ? a.key.localeCompare(b.key) : b.total - a.total));
  const total = measure === 'clients' ? distinct.get('*|*')?.size ?? 0 : rows.reduce((s, r) => s + r.total, 0);
  return { cols, rows, colTotals, total };
}
