import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, runTransaction, where, limit, } from 'firebase/firestore';
import { db } from './firebase';
import { stockDocId } from '@/domain/types';
// Single transaction: read counter + all touched stock docs, decide reserved
// vs pendingProduction per line, write order + increment reserved + append
// reserva movements + bump counter. All reads happen before any writes.
export async function createOrder(createdByUid, input) {
    const year = new Date().getFullYear();
    const counterRef = doc(db, 'counters', `orders-${year}`);
    return await runTransaction(db, async (tx) => {
        // ---- Reads
        const counterSnap = await tx.get(counterRef);
        const nextN = (counterSnap.data()?.last ?? 0) + 1;
        const orderId = `PED-${year}-${String(nextN).padStart(4, '0')}`;
        const stockReads = [];
        for (const line of input.lines) {
            const ref = doc(db, 'stock', stockDocId(line.productId, line.formatId));
            const snap = await tx.get(ref);
            stockReads.push({ ref, snap: (snap.exists() ? snap.data() : null) });
        }
        // ---- Decide split per line
        const enriched = [];
        const parcialLines = [];
        let anyPending = false;
        input.lines.forEach((line, i) => {
            const stock = stockReads[i].snap;
            const available = stock ? Math.max(0, stock.onHand - stock.reserved) : 0;
            let reservedQty = 0;
            let pendingProductionQty = 0;
            if (available >= line.qty) {
                reservedQty = line.qty;
            }
            else {
                reservedQty = available;
                pendingProductionQty = line.qty - available;
                anyPending = true;
                parcialLines.push({
                    productName: line.productName,
                    formatLabel: line.formatLabel,
                    missing: pendingProductionQty,
                });
            }
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
            });
        });
        const status = anyPending ? 'confirmado_parcial' : 'confirmado';
        const now = Date.now();
        const order = {
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
                { status: 'recibido', by: createdByUid, at: now },
                { status, by: createdByUid, at: now },
            ],
            source: input.source,
            rawText: input.rawText,
            invoicingComplete: input.client.invoicingComplete,
            createdAt: now,
            updatedAt: now,
        };
        // ---- Writes
        // Only reserve where we could — pending is not written to stock.reserved.
        enriched.forEach((line, i) => {
            if (line.reservedQty > 0) {
                const ref = stockReads[i].ref;
                const prev = stockReads[i].snap;
                if (prev) {
                    tx.update(ref, { reserved: prev.reserved + line.reservedQty });
                }
                else {
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
const DESPACHO_STATUSES = ['confirmado', 'confirmado_parcial', 'en_armado', 'armado'];
export function useDespachoQueue() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const q = query(collection(db, 'orders'), where('status', 'in', DESPACHO_STATUSES));
        const unsub = onSnapshot(q, (snap) => {
            const list = [];
            snap.forEach((d) => list.push(d.data()));
            list.sort((a, b) => {
                if (a.requestedDate !== b.requestedDate)
                    return a.requestedDate.localeCompare(b.requestedDate);
                return a.createdAt - b.createdAt;
            });
            setOrders(list);
            setLoading(false);
        });
        return unsub;
    }, []);
    return { orders, loading };
}
export function useOrder(orderId) {
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!orderId) {
            setOrder(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        const unsub = onSnapshot(doc(db, 'orders', orderId), (snap) => {
            setOrder(snap.exists() ? snap.data() : null);
            setLoading(false);
        });
        return unsub;
    }, [orderId]);
    return { order, loading };
}
// Assign self as packer + advance to en_armado if still confirmado(_parcial).
// One transaction: reads current order, writes assignedPackerId + status + history.
export async function assignPacker(orderId, packerUid) {
    const orderRef = doc(db, 'orders', orderId);
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(orderRef);
        if (!snap.exists())
            throw new Error('Pedido no encontrado');
        const order = snap.data();
        if (order.assignedPackerId && order.assignedPackerId !== packerUid) {
            throw new Error('Pedido ya asignado a otro armador');
        }
        const advance = order.status === 'confirmado' || order.status === 'confirmado_parcial';
        const now = Date.now();
        const newStatus = advance ? 'en_armado' : order.status;
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
// Mark order as armado. Transaction:
//   Reads:  order doc + one stock doc per line with reservedQty > 0
//   Writes: stock.reserved -= reservedQty, stock.onHand -= packedQty
//           per line, appends stockMovements type consumo, updates order
export async function markArmado(orderId, packed, packerUid) {
    const orderRef = doc(db, 'orders', orderId);
    await runTransaction(db, async (tx) => {
        // ---- Reads
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists())
            throw new Error('Pedido no encontrado');
        const order = orderSnap.data();
        if (order.status !== 'en_armado' && order.status !== 'confirmado' && order.status !== 'confirmado_parcial') {
            throw new Error(`No se puede armar un pedido en estado ${order.status}`);
        }
        const stockReads = [];
        for (const line of order.lines) {
            if (line.reservedQty <= 0) {
                stockReads.push({ ref: doc(db, 'stock', stockDocId(line.productId, line.formatId)), prev: null, line });
                continue;
            }
            const ref = doc(db, 'stock', stockDocId(line.productId, line.formatId));
            const snap = await tx.get(ref);
            stockReads.push({ ref, prev: snap.exists() ? snap.data() : null, line });
        }
        // ---- Writes
        const now = Date.now();
        const packedMap = new Map(packed.map((p) => [`${p.productId}::${p.formatId}`, p]));
        const enrichedLines = order.lines.map((line) => {
            const key = `${line.productId}::${line.formatId}`;
            const p = packedMap.get(key);
            const packedQty = p?.packedQty ?? line.reservedQty;
            return { ...line, packedQty, packedWeightKg: p?.packedWeightKg };
        });
        stockReads.forEach(({ ref, prev, line }) => {
            if (line.reservedQty <= 0 || !prev)
                return;
            const packedQty = packedMap.get(`${line.productId}::${line.formatId}`)?.packedQty ?? line.reservedQty;
            tx.update(ref, {
                reserved: Math.max(0, prev.reserved - line.reservedQty),
                onHand: Math.max(0, prev.onHand - packedQty),
            });
            const mvRef = doc(collection(db, 'stockMovements'));
            const mv = {
                id: mvRef.id,
                productId: line.productId,
                formatId: line.formatId,
                qty: packedQty,
                type: 'consumo',
                orderId,
                by: packerUid,
                at: now,
            };
            tx.set(mvRef, mv);
        });
        tx.update(orderRef, {
            lines: enrichedLines,
            status: 'armado',
            assignedPackerId: order.assignedPackerId ?? packerUid,
            updatedAt: now,
            statusHistory: [...order.statusHistory, { status: 'armado', by: packerUid, at: now }],
        });
    });
}
export function useLastOrderForClient(vendedorUid, clientId) {
    const [order, setOrder] = useState(null);
    useEffect(() => {
        if (!clientId) {
            setOrder(null);
            return;
        }
        const q = query(collection(db, 'orders'), where('createdBy', '==', vendedorUid), where('clientId', '==', clientId), orderBy('createdAt', 'desc'), limit(1));
        const unsub = onSnapshot(q, (snap) => {
            const first = snap.docs[0];
            setOrder(first ? first.data() : null);
        });
        return unsub;
    }, [vendedorUid, clientId]);
    return order;
}
