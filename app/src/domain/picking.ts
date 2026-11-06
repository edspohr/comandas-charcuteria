import type { Order, OrderLine } from './types';
import { lineKey } from './samples';

// Total para armar (pedido de Eduanis, 05-11): suma por producto y formato de
// los pedidos «En armado», para ir a buscar todo de una vez antes de pasarlos
// a listos. Cuenta lo reservado (lo que hay para sacar); lo que espera
// producción va aparte porque todavía no está en la cámara.

export interface PickingRow {
  key: string; productName: string; formatLabel: string; unit: OrderLine['unit']; sample: boolean;
  qty: number; pendingQty: number; orders: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function pickingTotals(orders: Order[]): PickingRow[] {
  const rows = new Map<string, PickingRow>();
  for (const o of orders) {
    const seen = new Set<string>();
    for (const l of o.lines) {
      if (l.shortReason) continue;
      const k = lineKey(l);
      const r = rows.get(k) ?? { key: k, productName: l.productName, formatLabel: l.formatLabel, unit: l.unit, sample: !!l.sample, qty: 0, pendingQty: 0, orders: 0 };
      r.qty = round(r.qty + (l.reservedQty ?? 0));
      r.pendingQty = round(r.pendingQty + (l.pendingProductionQty ?? 0));
      if (!seen.has(k)) { r.orders++; seen.add(k); }
      rows.set(k, r);
    }
  }
  return [...rows.values()].filter((r) => r.qty > 0 || r.pendingQty > 0)
    .sort((a, b) => Number(a.sample) - Number(b.sample) || a.productName.localeCompare(b.productName, 'es') || a.formatLabel.localeCompare(b.formatLabel, 'es'));
}
