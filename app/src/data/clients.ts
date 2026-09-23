import { useEffect, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { bsale } from '@/integrations/bsale/MockBsaleClient';
import type { BsaleCustomer } from '@/integrations/bsale/BsaleClient';
import { db } from './firebase';
import { describeFirestoreError } from '@/lib/errors';
import type { Client, DeliveryMode } from '@/domain/types';
import { cleanRut, formatRut, isValidRut } from '@/lib/rut';

export function useClients(): { clients: Client[]; loading: boolean; error: string | null } {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'clients'),
      (snap) => {
        const list: Client[] = [];
        snap.forEach((d) => list.push(d.data() as Client));
        list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
        setClients(list);
        setError(null);
        setLoading(false);
      },
      (err) => { setError(describeFirestoreError(err)); setLoading(false); },
    );
    return unsub;
  }, []);

  return { clients, loading, error };
}

const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');

export function searchClients(all: Client[], query: string): Client[] {
  if (!query.trim()) return all.slice(0, 20);
  const q = norm(query);
  return all
    .filter((c) => norm(c.name).includes(q)
      || norm(c.fantasyName ?? '').includes(q)
      || norm(c.rut ?? '').includes(q))
    .slice(0, 20);
}

// ---------- Espejo de clientes Bsale ----------

// Bsale fields win; app-only fields are preserved. Returns how many docs
// were written (new or changed).
function mirrorFromBsale(remote: BsaleCustomer, local: Client | undefined, now: number): Client {
  const merged: Client = {
    id: local?.id ?? remote.id,
    name: remote.name,
    fantasyName: remote.fantasyName ?? local?.fantasyName,
    rut: remote.rut ?? local?.rut,
    giro: remote.giro ?? local?.giro,
    address: remote.address ?? local?.address,
    contactPhone: remote.phone ?? local?.contactPhone,
    email: remote.email ?? local?.email,
    deliveryMode: local?.deliveryMode ?? 'despacho',
    receivingHours: local?.receivingHours,
    notes: local?.notes,
    isInternalShop: local?.isInternalShop,
    invoicingComplete: !!(remote.rut && remote.name && remote.address && remote.giro),
    source: local?.source ?? 'seed',
    createdBy: local?.createdBy,
    createdAt: local?.createdAt,
    needsReview: local?.needsReview && !(remote.rut && remote.address && remote.giro) ? true : false,
    ownerUid: local?.ownerUid,
    hubspotCompanyId: local?.hubspotCompanyId,
    bsaleClientId: remote.id,
    bsaleSyncedAt: now,
  };
  return merged;
}

function sameClient(a: Client, b: Client): boolean {
  const pick = (c: Client) => [c.name, c.fantasyName, c.rut, c.giro, c.address, c.contactPhone, c.email, c.invoicingComplete, c.needsReview].join('|');
  return pick(a) === pick(b);
}

export async function syncClientsFromBsale(): Promise<{ updated: number; total: number }> {
  const remote = await bsale.getClients();
  const snap = await getDocs(collection(db, 'clients'));
  const localByBsaleId = new Map<string, Client>();
  const localById = new Map<string, Client>();
  snap.forEach((d) => { const c = d.data() as Client; localById.set(c.id, c); if (c.bsaleClientId) localByBsaleId.set(c.bsaleClientId, c); });
  const now = Date.now();
  let batch = writeBatch(db); let n = 0; let updated = 0;
  for (const r of remote) {
    const local = localByBsaleId.get(r.id) ?? localById.get(r.id);
    const merged = mirrorFromBsale(r, local, now);
    if (local && sameClient(local, merged)) continue;
    batch.set(doc(db, 'clients', merged.id), merged);
    updated++;
    if (++n === 400) { await batch.commit(); batch = writeBatch(db); n = 0; }
  }
  if (n > 0) await batch.commit();
  return { updated, total: remote.length };
}

// ---------- Alta rápida (vendedor) ----------

export interface QuickClientInput {
  fantasyName: string;
  name?: string;          // razón social; defaults to fantasyName
  rut?: string;
  giro?: string;
  address?: string;
  contactPhone?: string;
  email?: string;
  receivingHours?: string;
  deliveryMode: DeliveryMode;
  notes?: string;
}

function slugify(s: string): string {
  return s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

// Creates the client in Bsale first (it is the master), then the local
// mirror with the app-only fields. Facturación is complete only when razón
// social + RUT válido + dirección + giro are present; otherwise the client
// is flagged needsReview for administración.
export async function createClientQuick(input: QuickClientInput, by: string): Promise<Client> {
  const fantasyName = input.fantasyName.trim();
  if (fantasyName.length < 2) throw new Error('Indique el nombre del cliente');
  const rutClean = input.rut?.trim() ? cleanRut(input.rut) : '';
  if (rutClean && !isValidRut(rutClean)) throw new Error('El RUT no es válido');
  const name = (input.name?.trim() || fantasyName);
  const invoicingComplete = !!(rutClean && name && input.address?.trim() && input.giro?.trim());
  const remote = await bsale.createClient({
    name,
    fantasyName,
    rut: rutClean ? formatRut(rutClean) : undefined,
    giro: input.giro?.trim() || undefined,
    address: input.address?.trim() || undefined,
    phone: input.contactPhone?.trim() || undefined,
    email: input.email?.trim() || undefined,
  });
  const id = `${slugify(fantasyName)}-${remote.id.slice(-4).toLowerCase()}`;
  const client: Client = {
    id,
    bsaleClientId: remote.id,
    bsaleSyncedAt: Date.now(),
    name,
    fantasyName,
    rut: rutClean ? formatRut(rutClean) : undefined,
    giro: input.giro?.trim() || undefined,
    address: input.address?.trim() || undefined,
    contactPhone: input.contactPhone?.trim() || undefined,
    email: input.email?.trim() || undefined,
    receivingHours: input.receivingHours?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    deliveryMode: input.deliveryMode,
    invoicingComplete,
    needsReview: !invoicingComplete,
    source: 'app',
    createdBy: by,
    createdAt: Date.now(),
    ownerUid: by,
  };
  await setDoc(doc(db, 'clients', id), client);
  return client;
}
