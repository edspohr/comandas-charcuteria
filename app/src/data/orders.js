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
