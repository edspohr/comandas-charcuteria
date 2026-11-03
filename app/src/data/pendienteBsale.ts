import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { addDaysIso, todayInSantiago } from '@/lib/format';
import { awaitsDocument } from '@/domain/linking';
import type { Order } from '@/domain/types';
import type { ProductionEntry } from './productionLog';

// Lo que la oficina tiene que cerrar en Bsale, en un solo lugar
// (Pendiente en Bsale): pedidos sin documento, producción y muestras que
// no llegaron a Bsale. Las escrituras con error salen de bsale/writes/log.

const DOC_WINDOW_DAYS = 45;

// Pedidos de venta armados, o despachados / entregados sin factura, con
// fecha de entrega en las últimas semanas (índice status + requestedDate).
export function useOrdersAwaitingDocument(): { orders: Order[]; loading: boolean } {
  const [state, setState] = useState<{ orders: Order[]; loading: boolean }>({ orders: [], loading: true });
  useEffect(() => onSnapshot(
    query(collection(db, 'orders'), where('status', 'in', ['armado', 'despachado', 'entregado']), where('requestedDate', '>=', addDaysIso(todayInSantiago(), -DOC_WINDOW_DAYS))),
    (s) => setState({ orders: s.docs.map((d) => d.data() as Order).filter(awaitsDocument).sort((a, b) => a.requestedDate.localeCompare(b.requestedDate) || a.createdAt - b.createdAt), loading: false }),
    () => setState({ orders: [], loading: false }),
  ), []);
  return state;
}

export function useProductionToLoad(): ProductionEntry[] {
  const [items, setItems] = useState<ProductionEntry[]>([]);
  useEffect(() => onSnapshot(
    query(collection(db, 'productionLog'), where('bsaleStatus', '==', 'por_cargar')),
    (s) => setItems(s.docs.map((d) => d.data() as ProductionEntry).sort((a, b) => a.at - b.at)),
    () => setItems([]),
  ), []);
  return items;
}

// Muestras que salieron sin consumo en Bsale porque las escrituras estaban
// apagadas (los registros antiguos no traen motivo).
export function useSamplesToRegister(): Order[] {
  const [items, setItems] = useState<Order[]>([]);
  useEffect(() => onSnapshot(
    query(collection(db, 'orders'), where('samplesConsumption.skipped', '==', true)),
    (s) => setItems(s.docs.map((d) => d.data() as Order).filter((o) => o.status !== 'anulado' && o.samplesConsumption?.reason !== 'sin_muestras').sort((a, b) => (a.samplesConsumption?.at ?? 0) - (b.samplesConsumption?.at ?? 0))),
    () => setItems([]),
  ), []);
  return items;
}

// La oficina ya hizo el consumo interno a mano en Bsale.
export async function markSamplesLoadedManually(order: Order, uid: string) {
  await updateDoc(doc(db, 'orders', order.id), {
    samplesConsumption: { at: Date.now(), by: uid, ref: order.samplesConsumption?.ref ?? `MU-${order.id}`, manual: true },
    updatedAt: Date.now(),
  });
}
