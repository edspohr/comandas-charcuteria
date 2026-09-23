import { useEffect, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, query, runTransaction, where } from 'firebase/firestore';
import { db } from './firebase';
import { describeFirestoreError } from '@/lib/errors';
import { stockDocId, type Order, type StockDoc, type StockMovement } from '@/domain/types';
import { bsale } from '@/integrations/bsale/MockBsaleClient';
import { absorbPendingForKey } from './produccion';

// Loads the whole stock mirror once (~100 docs, one per product+format).
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

// True when Bsale reports less than what open orders hold — somebody sold
// reserved goods at the counter. The kanban paints those orders red.
export function isCompromised(stock: Map<string, StockDoc>, productId: string, formatId: string): boolean {
  const doc = stock.get(stockDocId(productId, formatId));
  return !!doc && doc.onHand < doc.reserved;
}

export function orderHasCompromisedStock(order: Order, stock: Map<string, StockDoc>): boolean {
  if (!['confirmado', 'confirmado_parcial', 'en_armado'].includes(order.status)) return false;
  return order.lines.some((l) => l.reservedQty > 0 && isCompromised(stock, l.productId, l.formatId));
}

export type Semaphore = 'ok' | 'partial' | 'none';

export function semaphore(available: number, qty: number): Semaphore {
  if (available >= qty && qty > 0) return 'ok';
  if (available > 0) return 'partial';
  return 'none';
}

// ---------- Sync with Bsale ----------

export interface SyncSummary {
  at: number;
  by: string;
  updated: number;        // stock docs whose onHand changed
  promoted: string[];     // orders promoted confirmado_parcial → confirmado
  absorbed: number;       // pending units re-assigned to reservations
  compromised: string[];  // skus where Bsale < reserved
}

export interface SyncState extends SyncSummary { running?: boolean; }

export function useSyncState(): SyncState | null {
  const [state, setState] = useState<SyncState | null>(null);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'bsaleSync'), (snap) => {
      setState(snap.exists() ? (snap.data() as SyncState) : null);
    }, () => setState(null));
    return unsub;
  }, []);
  return state;
}

// Pull stock from Bsale and overwrite the mirror's onHand. Then, for every
// sku that now has room, absorb pending production FIFO (promoting orders
// whose lines are fully covered). Bsale is the source of truth: the app never
// pushes stock the other way.
export async function syncStockFromBsale(by: string, officeId?: number): Promise<SyncSummary> {
  const remote = await bsale.getStocks(officeId);
  const remoteBySku = new Map(remote.map((r) => [r.sku, r]));

  // 1. Mirror onHand. One transaction over the docs that actually changed.
  const stockSnap = await getDocs(collection(db, 'stock'));
  const local = new Map<string, StockDoc>();
  stockSnap.forEach((d) => local.set(d.id, d.data() as StockDoc));

  const changed: string[] = [];
  for (const [sku, r] of remoteBySku) {
    const l = local.get(sku);
    if (!l || l.onHand !== r.quantity) changed.push(sku);
  }

  const now = Date.now();
  if (changed.length > 0) {
    await runTransaction(db, async (tx) => {
      const reads = await Promise.all(changed.map((sku) => tx.get(doc(db, 'stock', sku))));
      reads.forEach((snap, i) => {
        const sku = changed[i];
        const r = remoteBySku.get(sku)!;
        const prev = snap.exists() ? (snap.data() as StockDoc) : null;
        const [productId, formatId] = sku.split('__');
        tx.set(doc(db, 'stock', sku), {
          productId: prev?.productId ?? productId,
          formatId: prev?.formatId ?? formatId,
          onHand: r.quantity,
          reserved: prev?.reserved ?? 0,
          bsaleVariantId: r.variantId,
          syncedAt: now,
        });
        const mvRef = doc(collection(db, 'stockMovements'));
        const mv: StockMovement = {
          id: mvRef.id,
          productId: prev?.productId ?? productId,
          formatId: prev?.formatId ?? formatId,
          qty: r.quantity - (prev?.onHand ?? 0),
          type: 'sync_bsale',
          by,
          at: now,
          reason: `Bsale: ${prev?.onHand ?? 0} → ${r.quantity}`,
        };
        tx.set(mvRef, mv);
      });
    });
  }

  // 2. Absorb pending production where the new stock allows it.
  const pendingQ = query(collection(db, 'orders'), where('status', 'in', ['confirmado_parcial', 'recibido']));
  const pendingSnap = await getDocs(pendingQ);
  const keysWithPending = new Set<string>();
  pendingSnap.forEach((d) => {
    const o = d.data() as Order;
    for (const l of o.lines) if (l.pendingProductionQty > 0) keysWithPending.add(stockDocId(l.productId, l.formatId));
  });

  let absorbed = 0;
  const promoted: string[] = [];
  for (const key of keysWithPending) {
    const [productId, formatId] = key.split('__');
    const r = await absorbPendingForKey(productId, formatId, by);
    absorbed += r.absorbed;
    promoted.push(...r.promoted);
  }

  // 3. Flag skus where the counter sold what we had reserved.
  const compromised: string[] = [];
  for (const [sku, r] of remoteBySku) {
    const l = local.get(sku);
    if (l && r.quantity < l.reserved) compromised.push(sku);
  }

  const summary: SyncSummary = { at: now, by, updated: changed.length, promoted, absorbed, compromised };
  // Best-effort: the summary is informational (header timestamp); a rules
  // denial here must not fail the sync itself.
  try {
    const { setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'settings', 'bsaleSync'), summary);
  } catch (e) { console.warn('[sync] no se pudo guardar el resumen', e); }
  return summary;
}
