import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { confirmPin } from './pin';
import { registerProduction, type BsaleWriteOutcome } from './bsaleOps';
import { isRealBsale } from '@/integrations/bsale/client';

// Bitácora de producción cargada desde Comandas (productionLog/{id}). Queda
// siempre, aunque las escrituras hacia Bsale estén apagadas: así la oficina
// ve qué falta cargar en Bsale y Producción ve lo que ya registró.

export interface ProductionLine { productId: string; formatId: string; productName: string; formatLabel: string; unit: 'g' | 'kg' | 'unidad'; qty: number }

// ok = recepción hecha en Bsale · simulado = Bsale en simulacro (bitácora) ·
// por_cargar = escrituras apagadas, la oficina la carga en Bsale ·
// cargado_manual = la oficina marcó que ya la cargó.
export type ProductionBsaleStatus = 'ok' | 'simulado' | 'por_cargar' | 'cargado_manual';

export interface ProductionEntry {
  id: string; at: number; by: string; byName: string;
  lines: ProductionLine[]; note?: string; source: 'foto' | 'texto' | 'manual';
  bsaleStatus: ProductionBsaleStatus; bsaleMarkedBy?: string; bsaleMarkedAt?: number;
}

export interface LoadResult { entry: ProductionEntry; outcome: BsaleWriteOutcome | null }

// Carga la producción: PIN → Bsale (si las escrituras están activas) → bitácora.
export async function loadProduction(lines: ProductionLine[], user: { uid: string; name: string }, source: ProductionEntry['source'], note?: string): Promise<LoadResult> {
  const valid = lines.filter((l) => l.productId && l.formatId && l.qty > 0);
  if (valid.length === 0) throw new Error('No hay cantidades para cargar.');
  await confirmPin('registrar_produccion', `Cargar producción: ${valid.length} línea${valid.length === 1 ? '' : 's'}`);
  let outcome: BsaleWriteOutcome | null = null;
  let bsaleStatus: ProductionBsaleStatus;
  const writesOn = !isRealBsale || (await getDoc(doc(db, 'settings', 'bsale'))).data()?.writesEnabled === true;
  if (writesOn) {
    outcome = await registerProduction(valid.map((l) => ({ productId: l.productId, formatId: l.formatId, qty: l.qty })), user.uid, note);
    bsaleStatus = outcome.dryRun ? 'simulado' : 'ok';
  } else {
    bsaleStatus = 'por_cargar';
  }
  const ref = doc(collection(db, 'productionLog'));
  const entry: ProductionEntry = {
    id: ref.id, at: Date.now(), by: user.uid, byName: user.name, lines: valid, source, bsaleStatus,
    ...(note ? { note } : {}),
  };
  await setDoc(ref, entry);
  return { entry, outcome };
}

export async function markLoadedInBsale(id: string, uid: string) {
  await updateDoc(doc(db, 'productionLog', id), { bsaleStatus: 'cargado_manual', bsaleMarkedBy: uid, bsaleMarkedAt: Date.now() });
}

export function useProductionLog(sinceMs: number): { entries: ProductionEntry[]; loading: boolean } {
  const [state, setState] = useState<{ entries: ProductionEntry[]; loading: boolean }>({ entries: [], loading: true });
  useEffect(() => onSnapshot(
    query(collection(db, 'productionLog'), where('at', '>=', sinceMs), orderBy('at', 'desc')),
    (s) => setState({ entries: s.docs.map((d) => d.data() as ProductionEntry), loading: false }),
    () => setState({ entries: [], loading: false }),
  ), [sinceMs]);
  return state;
}

export function loadResultText(r: LoadResult): string {
  const n = r.entry.lines.length;
  const what = `Producción cargada: ${n} línea${n === 1 ? '' : 's'}`;
  if (r.entry.bsaleStatus === 'por_cargar') return `${what}. Quedó registrada en Comandas; la oficina la carga en Bsale y el stock se actualiza con la sincronización.`;
  if (r.entry.bsaleStatus === 'simulado') return `${what}. Bsale está en simulacro: quedó en la bitácora sin enviarse.`;
  const s = r.outcome?.summary;
  return `${what} en Bsale.` + (s && s.absorbed > 0 ? ` Se asignaron ${s.absorbed} u/kg a pedidos que esperaban.` : '') + (s && s.promoted.length > 0 ? ` Pedidos listos para armar: ${s.promoted.join(', ')}.` : '');
}
