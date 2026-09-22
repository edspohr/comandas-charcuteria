import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db } from './firebase';
import { describeFirestoreError } from '@/lib/errors';
import { stockDocId, type StockDoc, type StockMovement } from '@/domain/types';

// Loads the whole stock collection once (~150 docs, one per product+format).
// Cheaper than per-product listeners for a mockup and lets the picker show
// availability without waterfall reads.
export function useAllStock(): { stock: Map<string, StockDoc>; loading: boolean; error: string | null } {
  const [stock, setStock] = useState<Map<string, StockDoc>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'stock'),
      (snap) => {
        const next = new Map<string, StockDoc>();
        snap.forEach((d) => next.set(d.id, d.data() as StockDoc));
        setStock(next);
        setError(null);
        setLoading(false);
      },
      (err) => { setError(describeFirestoreError(err)); setLoading(false); },
    );
    return unsub;
  }, []);

  return { stock, loading, error };
}

export function availableFor(
  stock: Map<string, StockDoc>,
  productId: string,
  formatId: string,
): number {
  const doc = stock.get(stockDocId(productId, formatId));
  if (!doc) return 0;
  return Math.max(0, doc.onHand - doc.reserved);
}

export type Semaphore = 'ok' | 'partial' | 'none';

export function semaphore(available: number, qty: number): Semaphore {
  if (available >= qty && qty > 0) return 'ok';
  if (available > 0) return 'partial';
  return 'none';
}

// Admin action: set stock.onHand to a new absolute value, writing an
// `ajuste` movement with the required reason for auditability. Never
// touches `reserved` — that's owned by the reservation transactions.
export async function ajustarStock(
  productId: string,
  formatId: string,
  newOnHand: number,
  reason: string,
  by: string,
): Promise<void> {
  if (newOnHand < 0) throw new Error('El stock no puede ser negativo');
  if (reason.trim().length < 3) throw new Error('Indique un motivo');

  const stockRef = doc(db, 'stock', stockDocId(productId, formatId));
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(stockRef);
    const prev: StockDoc = snap.exists()
      ? (snap.data() as StockDoc)
      : { productId, formatId, onHand: 0, reserved: 0 };
    const delta = newOnHand - prev.onHand;
    tx.set(stockRef, { ...prev, onHand: newOnHand });
    const mvRef = doc(collection(db, 'stockMovements'));
    const mv: StockMovement = {
      id: mvRef.id,
      productId, formatId,
      qty: delta,
      type: 'ajuste',
      by,
      at: Date.now(),
      reason: reason.trim(),
    };
    tx.set(mvRef, mv);
  });
}
