import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { stockDocId } from '@/domain/types';
// Loads the whole stock collection once (~150 docs, one per product+format).
// Cheaper than per-product listeners for a mockup and lets the picker show
// availability without waterfall reads.
export function useAllStock() {
    const [stock, setStock] = useState(new Map());
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'stock'), (snap) => {
            const next = new Map();
            snap.forEach((d) => next.set(d.id, d.data()));
            setStock(next);
            setLoading(false);
        });
        return unsub;
    }, []);
    return { stock, loading };
}
export function availableFor(stock, productId, formatId) {
    const doc = stock.get(stockDocId(productId, formatId));
    if (!doc)
        return 0;
    return Math.max(0, doc.onHand - doc.reserved);
}
export function semaphore(available, qty) {
    if (available >= qty && qty > 0)
        return 'ok';
    if (available > 0)
        return 'partial';
    return 'none';
}
