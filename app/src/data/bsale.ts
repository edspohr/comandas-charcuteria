import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from './firebase';
import { describeFirestoreError } from '@/lib/errors';
import type { BsaleDocument, BsaleReception } from '@/integrations/bsale/BsaleClient';
import { DOCUMENTS_PATH } from '@/integrations/bsale/client';

// Live view of the Bsale document feed: the simulated one in mock mode, the
// server-side mirror (bsale/sales/documents, fed by cron + webhooks) in real
// mode. Either way it's Firestore, so every screen updates in real time.
export function useBsaleDocuments(opts: { limit?: number } = {}): { documents: BsaleDocument[]; loading: boolean; error: string | null } {
  const [documents, setDocuments] = useState<BsaleDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = query(collection(db, DOCUMENTS_PATH.join('/')), orderBy('emittedAt', 'desc'), limit(opts.limit ?? 100));
    const unsub = onSnapshot(
      q,
      (snap) => { const l: BsaleDocument[] = []; snap.forEach((d) => l.push(d.data() as BsaleDocument)); setDocuments(l); setError(null); setLoading(false); },
      (err) => { setError(describeFirestoreError(err)); setLoading(false); },
    );
    return unsub;
  }, [opts.limit]);
  return { documents, loading, error };
}

export function useBsaleReceptions(max = 30): BsaleReception[] {
  const [items, setItems] = useState<BsaleReception[]>([]);
  useEffect(() => {
    const q = query(collection(db, 'bsaleReceptions'), orderBy('at', 'desc'), limit(max));
    const unsub = onSnapshot(q, (snap) => { const l: BsaleReception[] = []; snap.forEach((d) => l.push(d.data() as BsaleReception)); setItems(l); }, () => setItems([]));
    return unsub;
  }, [max]);
  return items;
}

export function useBsaleMockStock(): Record<string, number> {
  const [q, setQ] = useState<Record<string, number>>({});
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'bsaleMock'), (snap) => {
      snap.forEach((d) => { if (d.id === 'stock') setQ((d.data() as { quantities: Record<string, number> }).quantities ?? {}); });
    }, () => setQ({}));
    return unsub;
  }, []);
  return q;
}
