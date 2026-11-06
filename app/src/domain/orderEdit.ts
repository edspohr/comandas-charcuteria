import { stockDocId, type OrderChangeItem, type OrderLine, type OrderStatus } from './types';
import { lineKey } from './samples';

// Edición de líneas de un pedido (ADR-0018). Lógica pura: recibe las líneas
// actuales, las nuevas cantidades y lo disponible por documento de stock, y
// devuelve las líneas resultantes, cuánto reservar o liberar por stock y la
// lista de cambios. data/orders.ts editOrderLines la aplica en una transacción.

export const EDITABLE_STATUSES: OrderStatus[] = ['recibido', 'confirmado', 'confirmado_parcial', 'en_armado', 'armado'];
export const isEditable = (s: OrderStatus) => EDITABLE_STATUSES.includes(s);

export interface EditLine {
  productId: string; productName: string; formatId: string; formatLabel: string; unit: OrderLine['unit'];
  qty: number; notes?: string; sample?: boolean; sampleGrams?: number;
  // Línea nueva: subtotal y precio desde el catálogo (lo calcula quien llama).
  subtotalCLP?: number; unitPriceSnapshotCLP?: number;
}

export interface EditPlan {
  lines: OrderLine[];
  // Cambio neto de `reserved` por documento de stock (+ reservar, − liberar).
  reserveDelta: Map<string, number>;
  // Para la bitácora de stock: por línea, cuánto se reservó (+) o liberó (−).
  movements: Array<{ productId: string; formatId: string; qty: number }>;
  items: OrderChangeItem[];
  anyPending: boolean;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const stockId = (l: Pick<OrderLine, 'productId' | 'formatId'>) => stockDocId(l.productId, l.formatId);

// `available`: onHand − reserved por documento de stock, antes del cambio.
export function planLineEdit(current: OrderLine[], next: EditLine[], available: Map<string, number>): EditPlan {
  const left = new Map(available);
  const reserveDelta = new Map<string, number>();
  const movements: EditPlan['movements'] = [];
  const items: OrderChangeItem[] = [];
  const bump = (l: Pick<OrderLine, 'productId' | 'formatId'>, q: number) => {
    if (!q) return;
    const id = stockId(l);
    reserveDelta.set(id, r3((reserveDelta.get(id) ?? 0) + q));
    left.set(id, r3((left.get(id) ?? 0) - q));
    movements.push({ productId: l.productId, formatId: l.formatId, qty: r3(q) });
  };

  const byKey = new Map(current.map((l) => [lineKey(l), l]));
  const nextKeys = new Set(next.filter((n) => n.qty > 0).map((n) => lineKey(n)));

  // Releases first, so stock freed by a removed or lowered line can serve
  // a line that grows in the same edit.
  for (const old of current) {
    if (!nextKeys.has(lineKey(old)) && old.reservedQty > 0) bump(old, -old.reservedQty);
  }
  const lowered = new Map<string, OrderLine>();
  for (const n of next) {
    const old = byKey.get(lineKey(n));
    if (!old || n.qty <= 0 || n.qty >= old.qty) continue;
    let reduce = r3(old.qty - n.qty);
    const fromPending = Math.min(old.pendingProductionQty, reduce);
    reduce = r3(reduce - fromPending);
    const release = Math.min(old.reservedQty, reduce);
    bump(old, -release);
    lowered.set(lineKey(n), { ...old, pendingProductionQty: r3(old.pendingProductionQty - fromPending), reservedQty: r3(old.reservedQty - release) });
  }

  const lines: OrderLine[] = [];
  // Regular lines claim stock before samples (same rule as createOrder).
  const ordered = next.map((n, i) => ({ n, i })).filter(({ n }) => n.qty > 0).sort((a, b) => Number(!!a.n.sample) - Number(!!b.n.sample) || a.i - b.i);
  const out = new Map<number, OrderLine>();
  for (const { n, i } of ordered) {
    const key = lineKey(n);
    const old = byKey.get(key);
    const notes = n.notes?.trim() || undefined;
    if (old && n.qty === old.qty) {
      out.set(i, notes === old.notes || (!notes && !old.notes) ? old : withNotes(old, notes));
      continue;
    }
    if (old && n.qty < old.qty) {
      const l = lowered.get(key)!;
      out.set(i, repriced(l, old, n.qty, notes));
      items.push(item(old, n.qty));
      continue;
    }
    // Grows or is new: reserve what's available, the rest waits for production.
    const base = old ?? null;
    const delta = r3(n.qty - (base?.qty ?? 0));
    const avail = Math.max(0, left.get(stockId(n)) ?? 0);
    const reserve = Math.min(avail, delta);
    bump(n, reserve);
    const pending = n.sample ? 0 : r3(delta - reserve);
    if (base) {
      out.set(i, repriced({ ...base, reservedQty: r3(base.reservedQty + reserve), pendingProductionQty: r3(base.pendingProductionQty + pending) }, base, n.qty, notes));
      items.push(item(base, n.qty));
    } else {
      const line: OrderLine = {
        productId: n.productId, productName: n.productName, formatId: n.formatId, formatLabel: n.formatLabel, unit: n.unit,
        qty: n.qty, reservedQty: reserve, pendingProductionQty: pending,
        ...(notes ? { notes } : {}),
        ...(n.sample ? { sample: true, subtotalCLP: 0, ...(n.sampleGrams ? { sampleGrams: n.sampleGrams } : {}) } : {}),
        ...(!n.sample && n.subtotalCLP != null ? { subtotalCLP: n.subtotalCLP } : {}),
        ...(!n.sample && n.unitPriceSnapshotCLP != null ? { unitPriceSnapshotCLP: n.unitPriceSnapshotCLP } : {}),
      };
      out.set(i, line);
      items.push({ productName: n.productName, formatLabel: n.formatLabel, unit: n.unit, ...(n.sample ? { sample: true } : {}), before: 0, after: n.qty });
    }
  }
  for (let i = 0; i < next.length; i++) { const l = out.get(i); if (l) lines.push(l); }
  for (const old of current) if (!nextKeys.has(lineKey(old))) items.push(item(old, 0));
  return { lines, reserveDelta, movements, items, anyPending: lines.some((l) => l.pendingProductionQty > 0) };
}

function item(old: OrderLine, after: number): OrderChangeItem {
  return { productName: old.productName, formatLabel: old.formatLabel, unit: old.unit, ...(old.sample ? { sample: true } : {}), before: old.qty, after };
}

function withNotes(l: OrderLine, notes: string | undefined): OrderLine {
  const { notes: _n, ...rest } = l;
  return notes ? { ...rest, notes } : rest;
}

// A changed line must be packed again: drop what was packed for it and scale
// the subtotal with the stored price (kg) or proportionally (units).
function repriced(l: OrderLine, old: OrderLine, qty: number, notes: string | undefined): OrderLine {
  const { packedQty: _p, packedWeightKg: _w, shortReason: _s, notes: _n, ...rest } = l;
  let subtotalCLP = old.subtotalCLP;
  if (old.sample) subtotalCLP = 0;
  else if (old.unit === 'kg' && old.unitPriceSnapshotCLP != null) subtotalCLP = Math.round(qty * old.unitPriceSnapshotCLP);
  else if (old.subtotalCLP != null && old.qty > 0) subtotalCLP = Math.round((old.subtotalCLP * qty) / old.qty);
  const out: OrderLine = { ...rest, qty, ...(notes ? { notes } : {}) };
  if (subtotalCLP != null) out.subtotalCLP = subtotalCLP; else delete out.subtotalCLP;
  return out;
}

// Rebajas al armar que el vendedor tiene que saber (ADR-0018): línea marcada
// «Faltó», o unidades empacadas por debajo de lo pedido. En granel (kg) la
// diferencia de peso es normal y no avisa.
export function packingReductions(before: OrderLine[], after: OrderLine[]): OrderChangeItem[] {
  const prev = new Map(before.map((l) => [lineKey(l), l]));
  const out: OrderChangeItem[] = [];
  for (const l of after) {
    const b = prev.get(lineKey(l));
    if (!b) continue;
    const packed = l.packedQty ?? l.qty;
    if (l.shortReason || (l.unit !== 'kg' && packed < b.qty)) {
      out.push({ productName: l.productName, formatLabel: l.formatLabel, unit: l.unit, ...(l.sample ? { sample: true } : {}), before: b.qty, after: l.shortReason ? 0 : packed });
    }
  }
  return out;
}
