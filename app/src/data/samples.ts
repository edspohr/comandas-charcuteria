import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { SampleFeedback, SampleResult } from '@/domain/samples';

// Respuestas del seguimiento de muestras (sampleFeedback/{orderId__producto__formato}).
// Pocas filas: se escucha la colección completa.
export function useSampleFeedback(): SampleFeedback[] {
  const [rows, setRows] = useState<SampleFeedback[]>([]);
  useEffect(() => onSnapshot(collection(db, 'sampleFeedback'), (s) => { const l: SampleFeedback[] = []; s.forEach((d) => l.push(d.data() as SampleFeedback)); setRows(l); }, () => setRows([])), []);
  return rows;
}

export async function saveSampleFeedback(input: { id: string; orderId: string; productId: string; formatId: string; result: SampleResult; note?: string }, by: string) {
  const data: SampleFeedback = { ...input, by, at: Date.now() };
  if (!data.note) delete data.note;
  await setDoc(doc(db, 'sampleFeedback', input.id), data);
}
