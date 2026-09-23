import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
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

// Creates the client with the minimum the vendedor knows. Facturación is
// complete only when razón social + RUT válido + dirección + giro are present;
// otherwise the client is flagged needsReview for administración.
export async function createClientQuick(input: QuickClientInput, by: string): Promise<Client> {
  const fantasyName = input.fantasyName.trim();
  if (fantasyName.length < 2) throw new Error('Indique el nombre del cliente');
  const rutClean = input.rut?.trim() ? cleanRut(input.rut) : '';
  if (rutClean && !isValidRut(rutClean)) throw new Error('El RUT no es válido');
  const name = (input.name?.trim() || fantasyName);
  const invoicingComplete = !!(rutClean && name && input.address?.trim() && input.giro?.trim());
  const id = `${slugify(fantasyName)}-${Math.random().toString(36).slice(2, 6)}`;
  const client: Client = {
    id,
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
