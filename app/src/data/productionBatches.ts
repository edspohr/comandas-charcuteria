import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
import { withPin } from './pin';
export { remaining, batchMetrics } from '../../../functions/src/production/model';
export type { ProductionBatch, ProducedLine } from '../../../functions/src/production/model';
import type { ProductionBatch } from '../../../functions/src/production/model';
export function useProductionBatches() {
  const [state, setState] = useState<{ batches: ProductionBatch[]; error: string | null; loading: boolean }>({ batches: [], error: null, loading: true });
  useEffect(() => onSnapshot(query(collection(db, 'productionBatches'), orderBy('at', 'desc')), snap => setState({ batches: snap.docs.map(d => d.data() as ProductionBatch), error: null, loading: false }), e => setState(s => ({ ...s, error: e.message, loading: false }))), []);
  return state;
}
export async function batchCall<T>(name: string, reason: string, data: Record<string, unknown>): Promise<T> {
  const call = httpsCallable<Record<string, unknown>, T>(functions, name, { timeout: 120000 });
  return withPin(reason, async pin => (await call({ ...data, pin })).data);
}
