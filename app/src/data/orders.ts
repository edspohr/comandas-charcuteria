import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  updateDoc,
  getDoc,
  where,
  limit,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Client, Order, OrderLine, OrderStatus, ProductFormat, StockDoc, StockMovement } from '@/domain/types';
import { stockDocId } from '@/domain/types';
import { describeFirestoreError } from '@/lib/errors';
import { computeLineSubtotal } from '@/lib/pricing';
import { DOCUMENTS_PATH, isRealBsale } from '@/integrations/bsale/client';
import { hasSamples, isSampleOnly, lineKey } from '@/domain/samples';
import { formatWindow, type DeliveryWindow } from '@/domain/delivery';
import { autoReasons, EXCEPTION_KINDS, type Approval, type ExceptionKind } from '@/domain/exceptions';
import type { DocumentReference, Transaction } from 'firebase/firestore';

// One read per stock doc, even when several lines share it (a Coppa line and
// a Coppa sample both come out of the bulk format): reading it twice and
// writing `prev.reserved ± qty` per line would let the last write win.
type StockRead = { ref: DocumentReference; prev: StockDoc | null };
async function readStocks(tx: Transaction, lines: Array<Pick<OrderLine, 'productId' | 'formatId'>>): Promise<Map<string, StockRead>> {
  const out = new Map<string, StockRead>();
  for (const l of lines) {
    const id = stockDocId(l.productId, l.formatId);
    if (out.has(id)) continue;
    const ref = doc(db, 'stock', id);
    const snap = await tx.get(ref);
    out.set(id, { ref, prev: snap.exists() ? (snap.data() as StockDoc) : null });
  }
  return out;
}

// Releases the reservation of every line in one write per stock doc.
function releaseReserved(tx: Transaction, reads: Map<string, StockRead>, lines: OrderLine[]) {
  const total = new Map<string, number>();
  for (const l of lines) if (l.reservedQty > 0) { const id = stockDocId(l.productId, l.formatId); total.set(id, (total.get(id) ?? 0) + l.reservedQty); }
  for (const [id, qty] of total) {
    const r = reads.get(id);
    if (r?.prev) tx.update(r.ref, { reserved: Math.max(0, r.prev.reserved - qty) });
  }
}

export interface DraftLine {
  productId: string;
  productName: string;
  formatId: string;
  formatLabel: string;
  unit: OrderLine['unit'];
  qty: number;
  notes?: string;
  sample?: boolean;
  sampleGrams?: number;
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
  deliveryWindow?: DeliveryWindow;
  // Nombre de fantasía con que despacho reconoce al cliente (opcional).
  fantasyName?: string;
  // Condición especial declarada por el vendedor (pide aprobación).
  exception?: { kinds: ExceptionKind[]; note: string };
  source: 'app' | 'pasted';
  rawText?: string;
}

export interface CreateOrderResult {
  orderId: string;
  status: OrderStatus;
  parcialLines: Array<{ productName: string; formatLabel: string; missing: number }>;
  awaitingApproval?: boolean;
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

  const result = await runTransaction(db, async (tx) => {
    // ---- Reads
    const counterSnap = await tx.get(counterRef);
    const nextN = (counterSnap.data()?.last ?? 0) + 1;
    const orderId = `PED-${year}-${String(nextN).padStart(4, '0')}`;

    const stockReads = await readStocks(tx, input.lines);
    // Available per stock doc, consumed line by line: regular lines first so
    // a sample never takes stock a sale needs.
    const left = new Map([...stockReads].map(([id, r]) => [id, r.prev ? Math.max(0, r.prev.onHand - r.prev.reserved) : 0]));
    const order_ = input.lines.map((l, i) => ({ l, i })).sort((a, b) => Number(!!a.l.sample) - Number(!!b.l.sample));
    const split = new Map<number, { reservedQty: number; pendingProductionQty: number }>();
    for (const { l, i } of order_) {
      const id = stockDocId(l.productId, l.formatId);
      const available = left.get(id) ?? 0;
      const reservedQty = Math.min(available, l.qty);
      left.set(id, available - reservedQty);
      // Samples never create production demand: without stock, despacho
      // decides at packing time (replace or mark as missing).
      split.set(i, { reservedQty, pendingProductionQty: l.sample ? 0 : Math.round((l.qty - reservedQty) * 1000) / 1000 });
    }

    // ---- Decide split per line
    const enriched: OrderLine[] = [];
    const parcialLines: CreateOrderResult['parcialLines'] = [];
    let anyPending = false;

    input.lines.forEach((line, i) => {
      const { reservedQty, pendingProductionQty } = split.get(i)!;
      if (pendingProductionQty > 0) {
        anyPending = true;
        parcialLines.push({
          productName: line.productName,
          formatLabel: line.formatLabel,
          missing: pendingProductionQty,
        });
      }
      const subtotalCLP = line.sample ? 0 : line.format ? computeLineSubtotal(line.format, line.qty) : undefined;
      const unitPriceSnapshotCLP = line.sample ? undefined : line.format?.priceCLP ?? line.format?.pricePerKgCLP;
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
        ...(line.sample ? { sample: true, sampleGrams: line.sampleGrams } : {}),
      });
    });
    // Firestore rejects undefined fields.
    for (const l of enriched) for (const k of Object.keys(l) as Array<keyof OrderLine>) if (l[k] === undefined) delete l[k];

    const totalCLP = enriched.reduce((s, l) => s + (l.subtotalCLP ?? 0), 0);

    const status: OrderStatus = anyPending ? 'confirmado_parcial' : 'confirmado';
    const now = Date.now();

    const order: Order = {
      id: orderId,
      kind: input.client.isInternalShop ? 'reposicion' : enriched.every((l) => l.sample) ? 'muestras' : 'venta',
      createdBy: createdByUid,
      clientId: input.client.id,
      clientSnapshot: {
        name: input.client.name,
        fantasyName: input.fantasyName?.trim() || input.client.fantasyName,
        rut: input.client.rut,
        address: input.client.address,
      },
      lines: enriched,
      requestedDate: input.requestedDate,
      deliveryMode: input.deliveryMode,
      deliveryAddress: input.deliveryAddress ?? input.client.address,
      receivingHours: input.deliveryWindow ? formatWindow(input.deliveryWindow) : input.receivingHours ?? input.client.receivingHours,
      ...(input.deliveryWindow ? { deliveryWindow: stripEmpty(input.deliveryWindow) } : {}),
      ...approvalFor(input, createdByUid, now),
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
    const addReserved = new Map<string, number>();
    for (const line of enriched) if (line.reservedQty > 0) { const id = stockDocId(line.productId, line.formatId); addReserved.set(id, (addReserved.get(id) ?? 0) + line.reservedQty); }
    for (const [id, qty] of addReserved) {
      const { ref, prev } = stockReads.get(id)!;
      if (prev) tx.update(ref, { reserved: prev.reserved + qty });
    }
    enriched.forEach((line) => {
      if (line.reservedQty > 0) {
        const mvRef = doc(collection(db, 'stockMovements'));
        tx.set(mvRef, {
          id: mvRef.id,
          productId: line.productId,
          formatId: line.formatId,
          qty: line.reservedQty,
          type: 'reserva',
          orderId,
          ...(line.sample ? { reason: 'muestra' } : {}),
          by: createdByUid,
          at: now,
        });
      }
    });

    tx.set(counterRef, { last: nextN }, { merge: true });
    tx.set(doc(db, 'orders', orderId), order);

    return { orderId, status, parcialLines, awaitingApproval: !!order.approval };
  });
  await rememberClientHabits(input);
  return result;
}

// Exceptions (auto by quantity, or declared by the seller) wait for approval.
function approvalFor(input: DraftOrderInput, by: string, now: number): { approval?: Approval } {
  const reasons = [...autoReasons(input.lines)];
  const kinds = input.exception?.kinds ?? [];
  if (input.exception?.note?.trim()) reasons.unshift(`${kinds.map((k) => EXCEPTION_KINDS.find(([id]) => id === k)?.[1] ?? k).join(', ') || 'Condición especial'}: ${input.exception.note.trim()}`);
  if (!reasons.length) return {};
  return { approval: { status: 'pendiente', reasons, ...(kinds.length ? { kinds } : {}), ...(input.exception?.note?.trim() ? { note: input.exception.note.trim() } : {}), requestedBy: by, requestedAt: now } };
}

// Super administración aprueba: el pedido queda libre para armar.
export async function approveOrder(orderId: string, by: string, note?: string): Promise<void> {
  const ref = doc(db, 'orders', orderId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Pedido no encontrado');
    const o = snap.data() as Order;
    if (o.approval?.status !== 'pendiente') throw new Error('El pedido no está esperando aprobación.');
    const now = Date.now();
    tx.update(ref, {
      approval: { ...o.approval, status: 'aprobado', decidedBy: by, decidedAt: now, ...(note?.trim() ? { decisionNote: note.trim() } : {}) },
      updatedAt: now,
      statusHistory: [...o.statusHistory, { status: o.status, by, at: now, note: `Excepción aprobada${note?.trim() ? ` · ${note.trim()}` : ''}` }],
    });
  });
}

// Rechazar = anular con el motivo (libera reservas). El vendedor lo ve en anulados.
export async function rejectOrder(orderId: string, by: string, note: string): Promise<void> {
  const ref = doc(db, 'orders', orderId);
  const now = Date.now();
  await anularOrder(orderId, by, `Excepción rechazada: ${note.trim()}`);
  const snap = await getDoc(ref);
  const o = snap.data() as Order | undefined;
  if (o?.approval) await updateDoc(ref, { approval: { ...o.approval, status: 'rechazado', decidedBy: by, decidedAt: now, decisionNote: note.trim() } });
}

const stripEmpty = (w: DeliveryWindow): DeliveryWindow => (w.note?.trim() ? { from: w.from, to: w.to, note: w.note.trim() } : { from: w.from, to: w.to });

// The client's usual window (and fantasy name, when it had none) prefill the
// next order. Best effort: the order is already saved.
async function rememberClientHabits(input: DraftOrderInput) {
  const patch: Record<string, unknown> = {};
  const w = input.deliveryWindow;
  if (w && (input.client.deliveryWindow?.from !== w.from || input.client.deliveryWindow?.to !== w.to)) {
    patch.deliveryWindow = { from: w.from, to: w.to };
    patch.receivingHours = `${w.from}–${w.to}`;
  }
  const fantasy = input.fantasyName?.trim();
  if (fantasy && !input.client.fantasyName) patch.fantasyName = fantasy;
  if (!Object.keys(patch).length) return;
  try { await updateDoc(doc(db, 'clients', input.client.id), patch); } catch (e) { console.warn('[pedido] hábitos del cliente', e); }
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
  sample?: boolean;
  packedQty: number;
  packedWeightKg?: number;
  // Si se marcó "Faltó", packedQty=0 y shortReason lleva el motivo (obligatorio
  // en la UI). Cuando llega presente, la línea no aporta subtotal ni kilos.
  shortReason?: string;
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
  opts: { strictStock?: boolean } = {},
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
    // Informative stock (marcha blanca): packed with what's in the cold room;
    // the pending production of the order stops counting once it's armado.
    const stillPending = order.lines.some((l) => l.pendingProductionQty > 0);
    if (stillPending && opts.strictStock) {
      throw new Error('El pedido tiene líneas esperando stock de producción. Se arma cuando Bsale reporte el stock.');
    }

    // Bsale may have sold at the counter what this order had reserved. Don't
    // let the packer ship goods that no longer exist: the kanban paints the
    // card red and admin has to re-sync / resolve first.
    const compromised: string[] = [];
    const reads = await readStocks(tx, order.lines.filter((l) => l.reservedQty > 0));
    for (const line of order.lines) {
      if (line.reservedQty <= 0) continue;
      const st = reads.get(stockDocId(line.productId, line.formatId))?.prev;
      const label = `${line.productName} · ${line.formatLabel}`;
      if (st && st.onHand < st.reserved && !compromised.includes(label)) compromised.push(label);
    }
    if (compromised.length > 0 && opts.strictStock) {
      throw new Error(`Bsale reporta menos stock del reservado en ${compromised.join(', ')}. Sincronice con Bsale o resuelva el pedido desde administración antes de armar.`);
    }

    const now = Date.now();
    const packedMap = new Map(packed.map((p) => [lineKey(p), p]));
    const enrichedLines: OrderLine[] = order.lines.map((line) => {
      const key = lineKey(line);
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
      const shortReason = p?.shortReason?.trim() || undefined;
      // Si la línea faltó, forzamos packedQty=0 y subtotal=0: la ficha y el
      // Panel lo tratan como no-vendido, no como merma.
      if (shortReason) { const { packedWeightKg: _w, ...rest } = line; return { ...rest, packedQty: 0, subtotalCLP: 0, shortReason, pendingProductionQty: 0 }; }
      const out: OrderLine = { ...line, packedQty, packedWeightKg: p?.packedWeightKg, subtotalCLP, pendingProductionQty: 0 };
      if (out.packedWeightKg === undefined) delete out.packedWeightKg;
      if (out.subtotalCLP === undefined) delete out.subtotalCLP;
      return out;
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

const DOC_NUMBER_RE = /^(FA|BO|GD)-\d{6}$/;

// Link a document emitted at the Bsale POS to a packed order. The sale
// already happened in Bsale (stock discounted there), so here we:
//   - release the app-side reservation for every line (onHand is only ever
//     written by the sync — the caller triggers one right after),
//   - store invoiceRef + bsaleDocumentId, status → facturado,
//   - mark the mock document as linked so it can't be reused.
// Rejects malformed numbers and numbers already linked to another order.
export async function vincularDocumento(
  orderId: string,
  document: { id: string; number: string },
  by: string,
): Promise<void> {
  const orderRef = doc(db, 'orders', orderId);
  const docRef = doc(db, DOCUMENTS_PATH.join('/'), document.id);
  const number = document.number.trim().toUpperCase();
  if (!DOC_NUMBER_RE.test(number)) throw new Error('Número de documento inválido. Formato esperado: FA-000824, BO-004102 o GD-000310.');
  const { getDocs } = await import('firebase/firestore');
  const dup = await getDocs(query(collection(db, 'orders'), where('invoiceRef', '==', number), limit(1)));
  if (!dup.empty && dup.docs[0].id !== orderId) throw new Error(`El documento ${number} ya está vinculado al pedido ${dup.docs[0].id}`);
  await runTransaction(db, async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists()) throw new Error('Pedido no encontrado');
    const order = orderSnap.data() as Order;
    if (order.invoiceRef) throw new Error(`El pedido ya tiene el documento ${order.invoiceRef}`);
    const late = order.status === 'despachado' || order.status === 'entregado';
    if (order.status !== 'armado' && !late) throw new Error(`No se puede vincular un documento a un pedido en estado ${order.status}`);
    const docSnap = await tx.get(docRef);
    if (docSnap.exists() && (docSnap.data() as { linkedOrderId?: string }).linkedOrderId) {
      throw new Error('Ese documento ya está vinculado a otro pedido');
    }

    const reserved = order.lines.filter((l) => l.reservedQty > 0);
    const reads = await readStocks(tx, reserved);

    const now = Date.now();
    releaseReserved(tx, reads, order.lines);
    for (const line of reserved) {
      const mvRef = doc(collection(db, 'stockMovements'));
      const mv: StockMovement = {
        id: mvRef.id,
        productId: line.productId,
        formatId: line.formatId,
        qty: line.packedQty ?? line.reservedQty,
        type: 'venta_bsale',
        orderId,
        by,
        at: now,
        reason: line.sample ? `${number} · muestra` : number,
      };
      tx.set(mvRef, mv);
    }

    if (docSnap.exists()) tx.update(docRef, { linkedOrderId: orderId });
    // Invoiced after delivery: the order keeps its status, the history says when.
    tx.update(orderRef, {
      status: late ? order.status : 'facturado',
      invoiceRef: number,
      bsaleDocumentId: document.id,
      updatedAt: now,
      statusHistory: [...order.statusHistory, { status: late ? order.status : 'facturado', by, at: now, note: late ? `Facturado tras despacho · ${number}` : number }],
    });
  });
}

export const isReposicion = (o: Pick<Order, 'kind'> & { clientId?: string }, shopIds?: Set<string>) =>
  o.kind === 'reposicion' || (!!shopIds && !!o.clientId && shopIds.has(o.clientId));

// Reposición de tienda armada → traslado. Registra el movimiento en Bsale
// (consumo en fábrica + recepción en tienda, o guía, según configuración)
// con las cantidades empacadas, libera la reserva y deja el pedido listo para
// salir. Reemplaza a "Vincular documento": a la tienda propia no se le factura.
export async function registrarTraslado(order: Order, by: string): Promise<{ dryRun: boolean; skipped?: boolean }> {
  if (order.status !== 'armado') throw new Error(`No se puede trasladar un pedido en estado ${order.status}`);
  const { registerTransfer } = await import('./bsaleOps');
  const lines = order.lines
    .filter((l) => !l.sample)
    .map((l) => ({ productId: l.productId, formatId: l.formatId, qty: l.packedQty ?? l.reservedQty }))
    .filter((l) => l.qty > 0);
  const result = await registerTransfer(order.id, lines);
  const ref = `TR-${order.id}`;
  const orderRef = doc(db, 'orders', order.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('Pedido no encontrado');
    const fresh = snap.data() as Order;
    if (fresh.status !== 'armado') throw new Error('El pedido cambió de estado mientras se registraba el traslado');
    const reserved = fresh.lines.filter((l) => l.reservedQty > 0);
    const reads = await readStocks(tx, reserved);
    const now = Date.now();
    releaseReserved(tx, reads, fresh.lines);
    for (const line of reserved) {
      const mvRef = doc(collection(db, 'stockMovements'));
      const mv: StockMovement = {
        id: mvRef.id, productId: line.productId, formatId: line.formatId, qty: line.packedQty ?? line.reservedQty,
        type: 'traslado_tienda', orderId: order.id, by, at: now,
        reason: result.dryRun ? `${ref} (Bsale en simulacro)` : ref,
      };
      tx.set(mvRef, mv);
    }
    tx.update(orderRef, {
      kind: 'reposicion',
      status: 'facturado',
      invoiceRef: ref,
      updatedAt: now,
      statusHistory: [...fresh.statusHistory, { status: 'facturado', by, at: now, note: result.skipped ? `${ref} · solo en la app` : result.dryRun ? `${ref} · simulacro` : `${ref} · registrado en Bsale` }],
    });
  });
  return result;
}

// Pedido solo de muestras armado → salida. No se factura: las muestras se
// descuentan de Bsale como consumo interno (servidor, con bitácora), se libera
// la reserva y el pedido queda listo para despachar con referencia MU-.
export async function registrarSalidaMuestras(order: Order, by: string): Promise<{ dryRun?: boolean; skipped?: boolean; reason?: string }> {
  if (order.status !== 'armado') throw new Error(`No se puede registrar la salida de un pedido en estado ${order.status}`);
  if (!isSampleOnly(order)) throw new Error('El pedido trae productos para facturar: las muestras se descuentan al facturarlo.');
  const { consumeSamples } = await import('./bsaleOps');
  const result = await consumeSamples(order.id);
  const ref = `MU-${order.id}`;
  const orderRef = doc(db, 'orders', order.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('Pedido no encontrado');
    const fresh = snap.data() as Order;
    if (fresh.status !== 'armado') throw new Error('El pedido cambió de estado mientras se registraba la salida');
    const reserved = fresh.lines.filter((l) => l.reservedQty > 0);
    const reads = await readStocks(tx, reserved);
    const now = Date.now();
    releaseReserved(tx, reads, fresh.lines);
    for (const line of reserved) {
      const mvRef = doc(collection(db, 'stockMovements'));
      tx.set(mvRef, { id: mvRef.id, productId: line.productId, formatId: line.formatId, qty: line.packedQty ?? line.reservedQty, type: 'venta_bsale', orderId: order.id, by, at: now, reason: `${ref} · muestra` });
    }
    const note = result.skipped ? `${ref} · solo en la app (${result.reason ?? 'Bsale apagado'})` : result.dryRun ? `${ref} · simulacro` : `${ref} · consumo interno en Bsale`;
    tx.update(orderRef, {
      kind: 'muestras',
      status: 'facturado',
      invoiceRef: ref,
      updatedAt: now,
      ...(isRealBsale ? {} : { samplesConsumption: { at: now, by, ref, skipped: true } }),
      statusHistory: [...fresh.statusHistory, { status: 'facturado', by, at: now, note }],
    });
  });
  return result;
}

// Mixed order just invoiced or linked: its samples leave with it. Best effort
// (the order is already facturado); a failure is visible in the write log.
export async function consumeSamplesAfterInvoice(order: Pick<Order, 'id' | 'lines'>): Promise<void> {
  if (!hasSamples(order)) return;
  try { const { consumeSamples } = await import('./bsaleOps'); await consumeSamples(order.id); } catch (e) { console.warn('[muestras] consumo', e); }
}

export async function despacharOrder(
  orderId: string,
  by: string,
  deliveredBy: string,
  note?: string,
  opts: { deferInvoice?: boolean } = {},
): Promise<void> {
  const orderRef = doc(db, 'orders', orderId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('Pedido no encontrado');
    const order = snap.data() as Order;
    // Despachar sin factura (superAdmin): leaves armado with its reservation
    // held until the document is linked or emitted after delivery.
    const deferred = opts.deferInvoice && order.status === 'armado';
    if (order.status !== 'facturado' && !deferred) throw new Error(`No se puede despachar un pedido en estado ${order.status}`);
    const now = Date.now();
    tx.update(orderRef, {
      status: 'despachado',
      deliveredBy,
      deliveryProof: note ? { note } : undefined,
      updatedAt: now,
      statusHistory: [...order.statusHistory, { status: 'despachado', by, at: now, note: deferred ? `${deliveredBy} · sin factura (se factura al entregar)` : deliveredBy }],
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

    // Reads: one per stock doc touched by a reservation.
    const reserved = order.lines.filter((l) => l.reservedQty > 0);
    const reads = await readStocks(tx, reserved);

    // Writes
    const now = Date.now();
    releaseReserved(tx, reads, order.lines);
    for (const line of reserved) {
      const mvRef = doc(collection(db, 'stockMovements'));
      tx.set(mvRef, {
        id: mvRef.id,
        productId: line.productId,
        formatId: line.formatId,
        qty: line.reservedQty,
        type: 'liberacion',
        orderId,
        by,
        at: now,
        reason,
      });
    }

    // Pending production is a promise, not stock: it simply stops counting
    // once the order is anulado, but we leave a trace in the history.
    const pendingTotal = order.lines.reduce((s, l) => s + l.pendingProductionQty, 0);
    const note = pendingTotal > 0 ? `${reason} · incluía ${pendingTotal} pendiente(s) de producción` : reason;
    tx.update(orderRef, {
      status: 'anulado',
      updatedAt: now,
      lines: order.lines.map((l) => ({ ...l, pendingProductionQty: 0 })),
      statusHistory: [...order.statusHistory, { status: 'anulado', by, at: now, note }],
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
