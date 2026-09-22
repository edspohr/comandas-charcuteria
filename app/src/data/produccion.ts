import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  where,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Order, OrderStatus, Product, StockDoc, StockMovement } from '@/domain/types';
import { stockDocId } from '@/domain/types';
import { useProducts } from './products';
import { useAllStock } from './stock';
import { addDaysIso, todayInSantiago } from '@/lib/format';

// Orders that still consume/hold reservations or have pending production
const OPEN_STATUSES: OrderStatus[] = [
  'recibido', 'confirmado', 'confirmado_parcial', 'en_armado',
];

// Aggregated demand for one product/format over the coming days
export interface DemandRow {
  productId: string;
  productName: string;
  formatId: string;
  formatLabel: string;
  unit: 'g' | 'kg' | 'unidad';
  onHand: number;
  reserved: number;
  available: number;
  confirmedDemand: number;      // sum of reservedQty across open orders
  pendingProduction: number;    // sum of pendingProductionQty across open orders
  toProduce: number;            // max(0, pendingProduction) — bookings still un-covered
  affectingOrders: Array<{
    orderId: string;
    clientName: string;
    requestedDate: string;
    reservedQty: number;
    pendingProductionQty: number;
  }>;
}

export function useProduccionData(): {
  rows: DemandRow[];
  loading: boolean;
} {
  const { products, loading: pLoading } = useProducts();
  const { stock, loading: sLoading } = useAllStock();
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [oLoading, setOLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'orders'),
      where('status', 'in', OPEN_STATUSES),
      orderBy('requestedDate', 'asc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: Order[] = [];
      snap.forEach((d) => list.push(d.data() as Order));
      setOpenOrders(list);
      setOLoading(false);
    });
    return unsub;
  }, []);

  const rows = useMemo<DemandRow[]>(() => {
    if (pLoading || sLoading || oLoading) return [];
    const byPF = new Map<string, DemandRow>();
    for (const p of products) {
      if (p.discontinued || !p.active) continue;
      for (const f of p.formats) {
        const key = stockDocId(p.id, f.formatId);
        const s = stock.get(key);
        byPF.set(key, {
          productId: p.id,
          productName: p.name,
          formatId: f.formatId,
          formatLabel: f.label,
          unit: f.unit,
          onHand: s?.onHand ?? 0,
          reserved: s?.reserved ?? 0,
          available: Math.max(0, (s?.onHand ?? 0) - (s?.reserved ?? 0)),
          confirmedDemand: 0,
          pendingProduction: 0,
          toProduce: 0,
          affectingOrders: [],
        });
      }
    }
    for (const o of openOrders) {
      for (const l of o.lines) {
        const key = stockDocId(l.productId, l.formatId);
        const row = byPF.get(key);
        if (!row) continue;
        row.confirmedDemand += l.reservedQty;
        row.pendingProduction += l.pendingProductionQty;
        if (l.reservedQty > 0 || l.pendingProductionQty > 0) {
          row.affectingOrders.push({
            orderId: o.id,
            clientName: o.clientSnapshot.fantasyName ?? o.clientSnapshot.name,
            requestedDate: o.requestedDate,
            reservedQty: l.reservedQty,
            pendingProductionQty: l.pendingProductionQty,
          });
        }
      }
    }
    for (const row of byPF.values()) {
      row.toProduce = row.pendingProduction;
    }
    const list = [...byPF.values()].filter((r) =>
      r.pendingProduction > 0 || r.confirmedDemand > 0 || r.onHand > 0
    );
    // Sort: rows that need production first, then by product name.
    list.sort((a, b) => {
      if ((b.toProduce > 0 ? 1 : 0) !== (a.toProduce > 0 ? 1 : 0)) return (b.toProduce > 0 ? 1 : 0) - (a.toProduce > 0 ? 1 : 0);
      if (b.toProduce !== a.toProduce) return b.toProduce - a.toProduce;
      return a.productName.localeCompare(b.productName, 'es');
    });
    return list;
  }, [products, stock, openOrders, pLoading, sLoading, oLoading]);

  return { rows, loading: pLoading || sLoading || oLoading };
}

// Horizon helper for the "7 días" view
export function nextDays(count: number): string[] {
  const days: string[] = [];
  const today = todayInSantiago();
  for (let i = 0; i < count; i++) days.push(addDaysIso(today, i));
  return days;
}

// Register a production batch. In one transaction:
//   1. bump stock.onHand by the produced qty
//   2. write a stockMovements type produccion
//   3. FIFO by requestedDate: for each open order with pendingProductionQty
//      on the same product/format, move pending → reserved up to available.
//      If the order ends up with all pending == 0, promote to confirmado.
export async function registrarProduccion(
  productId: string,
  formatId: string,
  qty: number,
  by: string,
  reason?: string,
): Promise<{ absorbed: number; promoted: string[] }> {
  if (qty <= 0) throw new Error('Cantidad debe ser mayor a cero');

  const stockRef = doc(db, 'stock', stockDocId(productId, formatId));

  // Firestore client transactions only accept DocumentReference reads. We
  // find candidate orders outside the transaction and then re-read each doc
  // by ref inside it, filtering again against fresh state.
  const ordersQ = query(
    collection(db, 'orders'),
    where('status', 'in', ['confirmado_parcial', 'recibido']),
    orderBy('requestedDate', 'asc'),
  );
  const candidateOrdersSnap = await getDocs(ordersQ);
  const candidateOrderIds: string[] = [];
  candidateOrdersSnap.forEach((d) => {
    const o = d.data() as Order;
    if (o.lines.some((l) => l.productId === productId && l.formatId === formatId && l.pendingProductionQty > 0)) {
      candidateOrderIds.push(o.id);
    }
  });

  return await runTransaction(db, async (tx) => {
    // ---- Reads (all before any writes)
    const stockSnap = await tx.get(stockRef);
    const prev: StockDoc = stockSnap.exists()
      ? (stockSnap.data() as StockDoc)
      : { productId, formatId, onHand: 0, reserved: 0 };

    const candidates: Array<{ ref: ReturnType<typeof doc>; order: Order; lineIdx: number; pending: number }> = [];
    for (const id of candidateOrderIds) {
      const ref = doc(db, 'orders', id);
      const snap = await tx.get(ref);
      if (!snap.exists()) continue;
      const o = snap.data() as Order;
      // Re-check under the fresh read; state may have changed since the query.
      if (o.status !== 'confirmado_parcial' && o.status !== 'recibido') continue;
      o.lines.forEach((l, i) => {
        if (l.productId === productId && l.formatId === formatId && l.pendingProductionQty > 0) {
          candidates.push({ ref, order: o, lineIdx: i, pending: l.pendingProductionQty });
        }
      });
    }
    // FIFO by requestedDate ascending, then created time
    candidates.sort((a, b) => {
      if (a.order.requestedDate !== b.order.requestedDate) return a.order.requestedDate.localeCompare(b.order.requestedDate);
      return a.order.createdAt - b.order.createdAt;
    });

    // ---- Compute distribution
    let remaining = qty;
    let absorbed = 0;
    const orderUpdates: Array<{
      ref: ReturnType<typeof doc>;
      order: Order;
      newLines: Order['lines'];
      newStatus: OrderStatus;
      appendHistory: boolean;
    }> = [];

    for (const c of candidates) {
      if (remaining <= 0) break;
      const move = Math.min(remaining, c.pending);
      const newLines = c.order.lines.map((l, i) => {
        if (i !== c.lineIdx) return l;
        return {
          ...l,
          reservedQty: l.reservedQty + move,
          pendingProductionQty: l.pendingProductionQty - move,
        };
      });
      const stillPending = newLines.some((l) => l.pendingProductionQty > 0);
      const newStatus: OrderStatus = stillPending ? c.order.status : 'confirmado';
      const appendHistory = newStatus !== c.order.status;
      orderUpdates.push({ ref: c.ref, order: c.order, newLines, newStatus, appendHistory });
      remaining -= move;
      absorbed += move;
    }

    // ---- Writes
    const now = Date.now();
    // Stock update: onHand goes up by full qty, reserved goes up by absorbed.
    tx.set(stockRef, {
      productId, formatId,
      onHand: prev.onHand + qty,
      reserved: prev.reserved + absorbed,
    });

    const mvRef = doc(collection(db, 'stockMovements'));
    const mv: StockMovement = {
      id: mvRef.id,
      productId, formatId,
      qty,
      type: 'produccion',
      by,
      at: now,
      reason,
    };
    tx.set(mvRef, mv);

    const promoted: string[] = [];
    // Deduplicate order updates in case the same order had multiple pending
    // lines on the same product/format (rare, but be safe).
    const seen = new Map<string, typeof orderUpdates[number]>();
    for (const u of orderUpdates) seen.set(u.order.id, u);
    for (const u of seen.values()) {
      const updates: Record<string, unknown> = {
        lines: u.newLines,
        updatedAt: now,
      };
      if (u.appendHistory) {
        updates.status = u.newStatus;
        updates.statusHistory = [...u.order.statusHistory, { status: u.newStatus, by, at: now }];
        if (u.newStatus === 'confirmado') promoted.push(u.order.id);
      }
      tx.update(u.ref, updates);
    }

    return { absorbed, promoted };
  });
}

// Small helper used in the UI: which unique products/formats currently need production
export function needsProduction(rows: DemandRow[]): DemandRow[] {
  return rows.filter((r) => r.toProduce > 0);
}

// Product picker for the Registrar Producción action — any active product.
export function useProductsForProduccion(): Product[] {
  const { products } = useProducts();
  return useMemo(() => products.filter((p) => p.active && !p.discontinued), [products]);
}
