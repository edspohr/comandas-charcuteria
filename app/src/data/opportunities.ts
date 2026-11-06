import { useEffect, useState } from 'react';
import { arrayUnion, collection, doc, onSnapshot, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { describeFirestoreError } from '@/lib/errors';
import type { Client } from '@/domain/types';
import { opportunityAlerts, type ActivityType, type LostReason, type NextActionType, type Opportunity, type OpportunityAlerts, type OpportunityCandidate, type OpportunityOrigin } from '@/domain/opportunities';
import { addDaysIso, todayInSantiago } from '@/lib/format';

// Oportunidades comerciales (opportunities/{id}). Ver domain/opportunities.ts.

const col = collection(db, 'opportunities');

// Todas (super administración, administración, consultor) o las propias.
export function useOpportunities(scope: { all: true } | { ownerUid: string }): { opportunities: Opportunity[]; loading: boolean; error: string | null } {
  const owner = 'all' in scope ? null : scope.ownerUid;
  const [state, setState] = useState<{ opportunities: Opportunity[]; loading: boolean; error: string | null }>({ opportunities: [], loading: true, error: null });
  useEffect(() => onSnapshot(owner ? query(col, where('ownerUid', '==', owner)) : query(col),
    (s) => setState({ opportunities: s.docs.map((d) => d.data() as Opportunity).sort((a, b) => b.updatedAt - a.updatedAt), loading: false, error: null }),
    (e) => setState({ opportunities: [], loading: false, error: describeFirestoreError(e) })), [owner]);
  return state;
}

// Avisos de las oportunidades propias (globo del menú y recordatorio).
export function useMyOpportunityAlerts(uid: string, enabled: boolean): OpportunityAlerts | null {
  const [list, setList] = useState<Opportunity[] | null>(null);
  useEffect(() => {
    if (!enabled) { setList(null); return; }
    return onSnapshot(query(col, where('ownerUid', '==', uid)), (s) => setList(s.docs.map((d) => d.data() as Opportunity)), () => setList(null));
  }, [uid, enabled]);
  const today = todayInSantiago();
  return list ? opportunityAlerts(list, today, addDaysIso(today, 1)) : null;
}

export function useClientOpportunities(clientId: string | null, scope: { all: true } | { ownerUid: string }) {
  const [state, setState] = useState<Opportunity[]>([]);
  const owner = 'all' in scope ? null : scope.ownerUid;
  useEffect(() => {
    if (!clientId) { setState([]); return; }
    const q = owner ? query(col, where('ownerUid', '==', owner), where('clientId', '==', clientId)) : query(col, where('clientId', '==', clientId));
    return onSnapshot(q, (s) => setState(s.docs.map((d) => d.data() as Opportunity).sort((a, b) => b.updatedAt - a.updatedAt)), () => setState([]));
  }, [clientId, owner]);
  return state;
}

export function useOpportunity(id: string | null): Opportunity | null {
  const [o, setO] = useState<Opportunity | null>(null);
  useEffect(() => {
    if (!id) { setO(null); return; }
    return onSnapshot(doc(col, id), (s) => setO((s.data() as Opportunity | undefined) ?? null), () => setO(null));
  }, [id]);
  return o;
}

export function useCandidates(enabled: boolean): { candidates: OpportunityCandidate[]; loading: boolean } {
  const [state, setState] = useState<{ candidates: OpportunityCandidate[]; loading: boolean }>({ candidates: [], loading: true });
  useEffect(() => {
    if (!enabled) { setState({ candidates: [], loading: false }); return; }
    return onSnapshot(collection(db, 'opportunityCandidates'),
      (s) => setState({ candidates: s.docs.map((d) => d.data() as OpportunityCandidate).sort((a, b) => a.rank - b.rank), loading: false }),
      () => setState({ candidates: [], loading: false }));
  }, [enabled]);
  return state;
}

const snapshotOf = (c: Pick<Client, 'name' | 'fantasyName' | 'rut'>) => strip({ name: c.name, fantasyName: c.fantasyName, rut: c.rut });

export interface NewOpportunity {
  client: Pick<Client, 'id' | 'name' | 'fantasyName' | 'rut'>;
  title: string;
  ownerUid: string | null;
  origin: OpportunityOrigin;
  productsOfInterest: string[];
  notes?: string;
  nextAction?: { type: NextActionType; date: string; note?: string };
  candidateId?: string;
}

function buildNew(ref: { id: string }, input: NewOpportunity, by: string, now: number): Opportunity {
  return strip({
    id: ref.id,
    clientId: input.client.id,
    clientSnapshot: snapshotOf(input.client),
    title: input.title.trim(),
    origin: input.origin,
    ownerUid: input.ownerUid,
    createdBy: by,
    productsOfInterest: input.productsOfInterest,
    notes: input.notes?.trim() || undefined,
    status: 'abierta',
    nextAction: input.nextAction ? strip(input.nextAction) : undefined,
    orderIds: [],
    candidateId: input.candidateId,
    activity: [{ type: 'estado', at: now, by, note: input.ownerUid && input.ownerUid !== by ? 'Creada y asignada' : 'Creada' }],
    createdAt: now,
    updatedAt: now,
  }) as Opportunity;
}

export async function createOpportunity(input: NewOpportunity, by: string): Promise<string> {
  const ref = doc(col);
  const now = Date.now();
  const batch = writeBatch(db);
  batch.set(ref, buildNew(ref, input, by, now));
  await batch.commit();
  return ref.id;
}

// Carga filas del informe como oportunidades (super administración).
export async function loadCandidates(picks: Array<{ candidate: OpportunityCandidate; client: Pick<Client, 'id' | 'name' | 'fantasyName' | 'rut'>; ownerUid: string | null }>, visitBy: string, by: string) {
  const now = Date.now();
  for (let i = 0; i < picks.length; i += 200) {
    const batch = writeBatch(db);
    for (const { candidate: c, client, ownerUid } of picks.slice(i, i + 200)) {
      const ref = doc(col);
      const top = c.productosSugeridos.slice(0, 3).join(', ');
      batch.set(ref, buildNew(ref, {
        client, ownerUid, origin: 'informe', candidateId: c.id,
        title: top ? `Venta cruzada: ${top}` : 'Venta cruzada',
        productsOfInterest: c.productosSugeridos,
        notes: c.propuesta,
        nextAction: { type: 'visita', date: visitBy },
      }, by, now));
      batch.update(doc(db, 'opportunityCandidates', c.id), { status: 'cargada', opportunityId: ref.id, loadedBy: by, loadedAt: now });
    }
    await batch.commit();
  }
}

export async function dismissCandidate(id: string, by: string) {
  await updateDoc(doc(db, 'opportunityCandidates', id), { status: 'descartada', loadedBy: by, loadedAt: Date.now() });
}

// Cambios con historial. Toda acción del ejecutivo queda como actividad.
async function change(id: string, by: string, patch: Partial<Opportunity>, activity: { type: ActivityType; note?: string }) {
  const now = Date.now();
  await updateDoc(doc(col, id), strip({
    ...patch,
    updatedAt: now,
    activity: arrayUnion(strip({ type: activity.type, at: now, by, note: activity.note?.trim() || undefined })),
  }) as Record<string, unknown>);
}

export async function logActivity(o: Opportunity, by: string, type: 'visita' | 'llamada' | 'nota', note: string, next?: { type: NextActionType; date: string; note?: string } | null) {
  await change(o.id, by, {
    ...(o.status === 'abierta' && type !== 'nota' ? { status: 'en_gestion' } : {}),
    ...(next ? { nextAction: strip(next) } : {}),
  }, { type, note });
}

export async function setNextAction(o: Opportunity, by: string, next: { type: NextActionType; date: string; note?: string }) {
  await change(o.id, by, { nextAction: strip(next) }, { type: 'nota', note: `Próxima acción: ${next.type} el ${next.date}${next.note ? ` · ${next.note}` : ''}` });
}

export async function postpone(o: Opportunity, by: string, until: string, note: string) {
  await change(o.id, by, { status: 'postergada', postponedUntil: until }, { type: 'estado', note: `Postergada hasta ${until}${note.trim() ? ` · ${note.trim()}` : ''}` });
}

export async function markLost(o: Opportunity, by: string, reason: LostReason, note: string) {
  await change(o.id, by, { status: 'perdida', lostReason: reason, lostNote: note.trim() || undefined, closedAt: Date.now() }, { type: 'estado', note: `Perdida${note.trim() ? ` · ${note.trim()}` : ''}` });
}

export async function reopen(o: Opportunity, by: string, next: { type: NextActionType; date: string }) {
  await change(o.id, by, { status: o.orderIds.length || o.activity.some((a) => a.type === 'visita' || a.type === 'llamada') ? 'en_gestion' : 'abierta', nextAction: next }, { type: 'estado', note: 'Reabierta' });
}

export async function reassign(o: Opportunity, by: string, ownerUid: string, ownerName: string) {
  await change(o.id, by, { ownerUid }, { type: 'estado', note: `Asignada a ${ownerName}` });
}

// Usado por createOrder dentro de su transacción: liga el pedido a la oportunidad.
export function opportunityOrderPatch(o: Opportunity, orderId: string, by: string, isSamples: boolean, hasSamples: boolean, now: number) {
  return {
    orderIds: arrayUnion(orderId),
    updatedAt: now,
    ...(o.status === 'abierta' || o.status === 'postergada' ? { status: 'en_gestion' } : {}),
    activity: arrayUnion(...[
      ...(isSamples || hasSamples ? [{ type: 'muestra', at: now, by, orderId, note: isSamples ? 'Pedido de muestras' : 'Muestras en el pedido' }] : []),
      ...(isSamples ? [] : [{ type: 'pedido', at: now, by, orderId }]),
    ]),
  };
}

function strip<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}
