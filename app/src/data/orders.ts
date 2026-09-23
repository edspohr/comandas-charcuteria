import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  where,
  limit,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Client, Order, OrderLine, OrderStatus, ProductFormat, StockDoc, StockMovement } from '@/domain/types';
import { stockDocId } from '@/domain/types';
import { describeFirestoreError } from '@/lib/errors';
import { computeLineSubtotal } from '@/lib/pricing';

export interface DraftLine {
  productId: string;
  productName: string;
  formatId: string;
  formatLabel: string;
  unit: OrderLine['unit'];
  qty: number;
  notes?: string;
  // Optional pricing snapshot passed from the wizard (comes from the catalog
  // format at the moment the line was added). If absent, createOrder computes
  // it from `format` inside the transaction.
  format?: ProductFormat;
}

export interface DraftOrderInput {
  client: Client;
  lines: DraftLine[];
  requestedDate: string;
  deliveryMode: 'retiro' | 'despacho';
  deliveryAddress?: string;
  receivingHours?: string;
  source: 'app' | 'pasted';
  rawText?: string;
}

export interface CreateOrderResult {
  orderId: string;
  status: OrderStatus;
  parcialLines: Array<{ productName: string; formatLabel: string; missing: number }>;
}

// Single transaction: read counter + all touched stock docs, decide reserved
// vs pendingProduction per line, write order + increment reserved + append
// reserva movements + bump counter. All reads happen before any writes.
export async function createOrder(
  createdByUid: string,
  input: DraftOrderInput,
): Promise<CreateOrderResult> {
  const year = new Date().getFullYear();
  const counterRef = doc(db, 'counters', `orders-${year}`);

  return await runTransaction(db, async (tx) => {
    // ---- Reads
    const counterSnap = await tx.get(counterRef);
    const nextN = (counterSnap.data()?.last ?? 0) + 1;
    const orderId = `PED-${year}-${String(nextN).padStart(4, '0')}`;

    const stockReads: Array<{ ref: ReturnType<typeof doc>; snap: StockDoc | null }> = [];
    for (const line of input.lines) {
      const ref = doc(db, 'stock', stockDocId(line.productId, line.formatId));
      const snap = await tx.get(ref);
      stockReads.push({ ref, snap: (snap.exists() ? (snap.data() as StockDoc) : null) });
    }

    // ---- Decide split per line
    const enriched: OrderLine[] = [];
    const parcialLines: CreateOrderResult['parcialLines'] = [];
    let anyPending = false;

    input.lines.forEach((line, i) => {
      const stock = stockReads[i].snap;
      const available = stock ? Math.max(0, stock.onHand - stock.reserved) : 0;
      let reservedQty = 0;
      let pendingProductionQty = 0;
      if (available >= line.qty) {
        reservedQty = line.qty;
      } else {
        reservedQty = available;
        pendingProductionQty = line.qty - available;
        anyPending = true;
        parcialLines.push({
          productName: line.productName,
          formatLabel: line.formatLabel,
          missing: pendingProductionQty,
        });
      }
      const subtotalCLP = line.format ? computeLineSubtotal(line.format, line.qty) : undefined;
      const unitPriceSnapshotCLP = line.format?.priceCLP ?? line.format?.pricePerKgCLP;
      enriched.push({
        productId: line.productId,
        productName: line.productName,
        formatId: line.formatId,
        formatLabel: line.formatLabel,
        unit: line.unit,
        qty: line.qty,
        notes: line.notes,
        reservedQty,
        pendingProductionQty,
        subtotalCLP,
        unitPriceSnapshotCLP,
      });
    });

    const totalCLP = enriched.reduce((s, l) => s + (l.subtotalCLP ?? 0), 0);

    const status: OrderStatus = anyPending ? 'confirmado_parcial' : 'confirmado';
    const now = Date.now();

    const order: Order = {
      id: orderId,
      createdBy: createdByUid,
      clientId: input.client.id,
      clientSnapshot: {
        name: input.client.name,
        fantasyName: input.client.fantasyName,
        rut: input.client.rut,
        address: input.client.address,
      },
      lines: enriched,
      requestedDate: input.requestedDate,
      deliveryMode: input.deliveryMode,
      deliveryAddress: input.deliveryAddress ?? input.client.address,
      receivingHours: input.receivingHours ?? input.client.receivingHours,
      status,
      statusHistory: [
        { status: 'recibido',     by: createdByUid, at: now },
        { status,                  by: createdByUid, at: now },
      ],
      source: input.source,
      rawText: input.rawText,
      invoicingComplete: input.client.invoicingComplete,
      createdAt: now,
      updatedAt: now,
      totalCLP,
    };

    // ---- Writes
    // Only reserve where we could — pending is not written to stock.reserved.
    enriched.forEach((line, i) => {
      if (line.reservedQty > 0) {
        const ref = stockReads[i].ref;
        const prev = stockReads[i].snap;
        if (prev) {
          tx.update(ref, { reserved: prev.reserved + line.reservedQty });
        } else {
          // Missing stock doc — create with onHand=0, reserved=reservedQty
          // (shouldn't happen in the seeded set, but safe fallback).
          tx.set(ref, {
            productId: line.productId,
            formatId: line.formatId,
            onHand: 0,
            reserved: line.reservedQty,
          });
        }
        const mvRef = doc(collection(db, 'stockMovements'));
        tx.set(mvRef, {
          id: mvRef.id,
          productId: line.productId,
          formatId: line.formatId,
          qty: line.reservedQty,
          type: 'reserva',
          orderId,
          by: createdByUid,
          at: now,
        });
      }
    });

    tx.set(counterRef, { last: nextN }, { merge: true });
    tx.set(doc(db, 'orders', orderId), order);

    return { orderId, status, parcialLines };
  });
}

// ---------- Despacho queue ----------

// `armado` lives in Facturación (waiting for admin to invoice); showing it in
// despacho would only add noise for the packer. The queue keeps everything up
// to en_armado so despacho can still see what they're currently working on.
const DESPACHO_STATUSES: OrderStatus[] = ['confirmado', 'confirmado_parcial', 'en_armado'];

export function useDespachoQueue(): { orders: Order[]; loading: boolean; error: string | null } {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'orders'), where('status', 'in', DESPACHO_STATUSES));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Order[] = [];
        snap.forEach((d) => list.push(d.data() as Order));
        list.sort((a, b) => {
          if (a.requestedDate !== b.requestedDate) return a.requestedDate.localeCompare(b.requestedDate);
          return a.createdAt - b.createdAt;
        });
        setOrders(list);
        setError(null);
        setLoading(false);
      },
      (err) => { setError(describeFirestoreError(err)); setLoading(false); },
    );
    return unsub;
  }, []);

  return { orders, loading, error };
}

export function useOrder(orderId: string | null): { order: Order | null; loading: boolean; error: string | null } {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) { setOrder(null); setLoading(false); setError(null); return; }
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, 'orders', orderId),
      (snap) => {
        setOrder(snap.exists() ? (snap.data() as Order) : null);
        setError(null);
        setLoading(false);
      },
      (err) => { setError(describeFirestoreError(err)); setLoading(false); },
    );
    return unsub;
  }, [orderId]);

  return { order, loading, error };
}

// Assign self as packer + advance to en_armado if still confirmado(_parcial).
// One transaction: reads current order, writes assignedPackerId + status + history.
export async function assignPacker(orderId: string, packerUid: string): Promise<void> {
  const orderRef = doc(db, 'orders', orderId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('Pedido no encontrado');
    const order = snap.data() as Order;
    if (order.assignedPackerId && order.assignedPackerId !== packerUid) {
      throw new Error('Pedido ya asignado a otro armador');
    }
    const advance = order.status === 'confirmado' || order.status === 'confirmado_parcial';
    const now = Date.now();
    const newStatus: OrderStatus = advance ? 'en_armado' : order.status;
    tx.update(orderRef, {
      assignedPackerId: packerUid,
      status: newStatus,
      updatedAt: now,
      statusHistory: advance
        ? [...order.statusHistory, { status: 'en_armado', by: packerUid, at: now }]
        : order.statusHistory,
    });
  });
}

export interface PackedLineInput {
  productId: string;
  formatId: string;
  packedQty: number;
  packedWeightKg?: number;
}

// Mark order as armado. Bsale is the stock source of truth, so armado no
// longer moves stock: the reservation stays until the POS document is linked
// (vincularDocumento) and Bsale discounts the sale on its side.
//   Reads:  order doc
//   Writes: packedQty / packedWeightKg / subtotal per line, status, history
export async function markArmado(
  orderId: string,
  packed: PackedLineInput[],
  packerUid: string,
): Promise<void> {
  const orderRef = doc(db, 'orders', orderId);
  await runTransaction(db, async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists()) throw new Error('Pedido no encontrado');
    const order = orderSnap.data() as Order;
    if (order.status !== 'en_armado' && order.status !== 'confirmado' && order.status !== 'confirmado_parcial') {
      throw new Error(`No se puede armar un pedido en estado ${order.status}`);
    }
    // Hard-block armado while any line still has production pending — the
    // stock has to show up in Bsale first (sync promotes the order).
    const stillPending = order.lines.some((l) => l.pendingProductionQty > 0);
    if (stillPending) {
      throw new Error('El pedido tiene líneas esperando stock de producción. Se arma cuando Bsale reporte el stock.');
    }

    const now = Date.now();
    const packedMap = new Map(packed.map((p) => [`${p.productId}::${p.formatId}`, p]));
    const enrichedLines: OrderLine[] = order.lines.map((line) => {
      const key = `${line.productId}::${line.formatId}`;
      const p = packedMap.get(key);
      const packedQty = p?.packedQty ?? line.reservedQty;
      // Recompute the subtotal against actual packed values so pieza-by-weight
      // invoices and the Panel delta reflect merma.
      let subtotalCLP = line.subtotalCLP;
      if (line.unitPriceSnapshotCLP != null) {
        if (line.unit === 'kg') {
          subtotalCLP = packedQty * line.unitPriceSnapshotCLP;
        } else if (p?.packedWeightKg != null && p.packedWeightKg > 0) {
          subtotalCLP = p.packedWeightKg * line.unitPriceSnapshotCLP;
        } else if (line.subtotalCLP == null) {
          subtotalCLP = packedQty * line.unitPriceSnapshotCLP;
        }
      }
      return { ...line, packedQty, packedWeightKg: p?.packedWeightKg, subtotalCLP };
    });
    const totalCLP = enrichedLines.reduce((s, l) => s + (l.subtotalCLP ?? 0), 0);

    tx.update(orderRef, {
      lines: enrichedLines,
      status: 'armado',
      assignedPackerId: order.assignedPackerId ?? packerUid,
      updatedAt: now,
      totalCLP,
      statusHistory: [...order.statusHistory, { status: 'armado', by: packerUid, at: now }],
    });
  });
}

// ---------- Facturación / despacho / entrega ----------

// Link a document emitted at the Bsale POS to a packed order. The sale
// already happened in Bsale (stock discounted there), so here we:
//   - release the app-side reservation for every line,
//   - pre-apply the sale to the mirror (onHand −= packed) so availability is
//     right until the next sync overwrites it with Bsale's number,
//   - store invoiceRef + bsaleDocumentId, status → facturado,
//   - mark the mock document as linked so it can't be reused.
export async function vincularDocumento(
  orderId: string,
  document: { id: string; number: string },
  by: string,
): Promise<void> {
  const orderRef = doc(db, 'orders', orderId);
  const docRef = doc(db, 'bsaleDocuments', document.id);
  await runTransaction(db, async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists()) throw new Error('Pedido no encontrado');
    const order = orderSnap.data() as Order;
    if (order.invoiceRef) throw new Error(`El pedido ya tiene el documento ${order.invoiceRef}`);
    if (order.status !== 'armado') throw new Error(`No se puede vincular un documento a un pedido en estado ${order.status}`);
    const docSnap = await tx.get(docRef);
    if (docSnap.exists() && (docSnap.data() as { linkedOrderId?: string }).linkedOrderId) {
      throw new Error('Ese documento ya está vinculado a otro pedido');
    }

    const reads: Array<{ ref: ReturnType<typeof doc>; prev: StockDoc | null; line: OrderLine }> = [];
    for (const line of order.lines) {
      if (line.reservedQty <= 0) continue;
      const ref = doc(db, 'stock', stockDocId(line.productId, line.formatId));
      const snap = await tx.get(ref);
      reads.push({ ref, prev: snap.exists() ? (snap.data() as StockDoc) : null, line });
    }

    const now = Date.now();
    for (const { ref, prev, line } of reads) {
      if (!prev) continue;
      const packedQty = line.packedQty ?? line.reservedQty;
      tx.update(ref, {
        reserved: Math.max(0, prev.reserved - line.reservedQty),
        onHand: Math.max(0, prev.onHand - packedQty),
      });
      const mvRef = doc(collection(db, 'stockMovements'));
      const mv: StockMovement = {
        id: mvRef.id,
        productId: line.productId,
        formatId: line.formatId,
        qty: packedQty,
        type: 'venta_bsale',
        orderId,
        by,
        at: now,
        reason: document.number,
      };
      tx.set(mvRef, mv);
    }

    if (docSnap.exists()) tx.update(docRef, { linkedOrderId: orderId });
    tx.update(orderRef, {
      status: 'facturado',
      invoiceRef: document.number,
      bsaleDocumentId: document.id,
      updatedAt: now,
      statusHistory: [...order.statusHistory, { status: 'facturado', by, at: now, note: document.number }],
    });
  });
}

export async function despacharOrder(
  orderId: string,
  by: string,
  deliveredBy: string,
  note?: string,
): Promise<void> {
  const orderRef = doc(db, 'orders', orderId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('Pedido no encontrado');
    const order = snap.data() as Order;
    if (order.status !== 'facturado') throw new Error(`No se puede despachar un pedido en estado ${order.status}`);
    const now = Date.now();
    tx.update(orderRef, {
      status: 'despachado',
      deliveredBy,
      deliveryProof: note ? { note } : undefined,
      updatedAt: now,
      statusHistory: [...order.statusHistory, { status: 'despachado', by, at: now, note: deliveredBy }],
    });
  });
}

export async function entregarOrder(orderId: string, by: string, note?: string): Promise<void> {
  const orderRef = doc(db, 'orders', orderId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('Pedido no encontrado');
    const order = snap.data() as Order;
    if (order.status !== 'despachado') throw new Error(`No se puede marcar entregado en estado ${order.status}`);
    const now = Date.now();
    const proof = note ? { note } : (order.deliveryProof ?? undefined);
    tx.update(orderRef, {
      status: 'entregado',
      deliveryProof: proof,
      updatedAt: now,
      statusHistory: [...order.statusHistory, { status: 'entregado', by, at: now, note }],
    });
  });
}

// ---------- Vendedor: mis pedidos ----------

export function useMyOrders(vendedorUid: string): { orders: Order[]; loading: boolean; error: string | null } {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'orders'),
      where('createdBy', '==', vendedorUid),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Order[] = [];
        snap.forEach((d) => list.push(d.data() as Order));
        setOrders(list);
        setError(null);
        setLoading(false);
      },
      (err) => { setError(describeFirestoreError(err)); setLoading(false); },
    );
    return unsub;
  }, [vendedorUid]);

  return { orders, loading, error };
}

// Anular pedido — releases any active reservations back to stock, writes
// liberacion movements, and sets status=anulado. Only allowed while the
// order is still in {recibido, confirmado, confirmado_parcial, en_armado}
// and belongs to the caller (or admin). Once armado we don't allow anular
// through this path (consumo already applied — needs admin refund flow,
// out of scope).
export async function anularOrder(orderId: string, by: string, reason: string): Promise<void> {
  const orderRef = doc(db, 'orders', orderId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('Pedido no encontrado');
    const order = snap.data() as Order;
    const cancellable: OrderStatus[] = ['recibido', 'confirmado', 'confirmado_parcial', 'en_armado'];
    if (!cancellable.includes(order.status)) {
      throw new Error(`No se puede anular un pedido en estado ${order.status}`);
    }

    // Reads: one stock doc per line with reservedQty > 0.
    const reads: Array<{ ref: ReturnType<typeof doc>; prev: StockDoc | null; releaseQty: number; line: OrderLine }> = [];
    for (const line of order.lines) {
      if (line.reservedQty <= 0) continue;
      const ref = doc(db, 'stock', stockDocId(line.productId, line.formatId));
      const stockSnap = await tx.get(ref);
      reads.push({
        ref,
        prev: stockSnap.exists() ? (stockSnap.data() as StockDoc) : null,
        releaseQty: line.reservedQty,
        line,
      });
    }

    // Writes
    const now = Date.now();
    for (const r of reads) {
      if (!r.prev) continue;
      tx.update(r.ref, { reserved: Math.max(0, r.prev.reserved - r.releaseQty) });
      const mvRef = doc(collection(db, 'stockMovements'));
      tx.set(mvRef, {
        id: mvRef.id,
        productId: r.line.productId,
        formatId: r.line.formatId,
        qty: r.releaseQty,
        type: 'liberacion',
        orderId,
        by,
        at: now,
        reason,
      });
    }

    tx.update(orderRef, {
      status: 'anulado',
      updatedAt: now,
      statusHistory: [...order.statusHistory, { status: 'anulado', by, at: now, note: reason }],
    });
  });
}

export function useOrdersByStatuses(statuses: OrderStatus[]): { orders: Order[]; loading: boolean; error: string | null } {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Serialize array into stable key to keep the effect deps sane.
  const key = statuses.slice().sort().join(',');

  useEffect(() => {
    const q = query(collection(db, 'orders'), where('status', 'in', statuses));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Order[] = [];
        snap.forEach((d) => list.push(d.data() as Order));
        list.sort((a, b) => a.requestedDate.localeCompare(b.requestedDate) || a.createdAt - b.createdAt);
        setOrders(list);
        setError(null);
        setLoading(false);
      },
      (err) => { setError(describeFirestoreError(err)); setLoading(false); },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { orders, loading, error };
}

export function useLastOrderForClient(vendedorUid: string, clientId: string | null): Order | null {
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (!clientId) { setOrder(null); return; }
    const q = query(
      collection(db, 'orders'),
      where('createdBy', '==', vendedorUid),
      where('clientId', '==', clientId),
      orderBy('createdAt', 'desc'),
      limit(1),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const first = snap.docs[0];
        setOrder(first ? (first.data() as Order) : null);
      },
      (err) => {
        // Non-fatal for the wizard — just skip the "Repetir último" suggestion.
        console.warn('[orders] useLastOrderForClient failed:', describeFirestoreError(err));
        setOrder(null);
      },
    );
    return unsub;
  }, [vendedorUid, clientId]);

  return order;
}
