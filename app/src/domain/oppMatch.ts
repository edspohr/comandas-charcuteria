import type { AppUser } from '@/domain/types';
import type { Client } from '@/domain/types';
import { rankClients } from '@/domain/parse/client';

// Cruce de lo dictado con los datos de la app: ejecutivo por nombre, cliente
// por RUT o nombre. Devuelve candidatos; la pantalla de confirmación decide.

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function matchExecutive(name: string | null, executives: Pick<AppUser, 'uid' | 'displayName'>[]): string | null {
  if (!name) return null;
  const n = norm(name);
  const exact = executives.find((u) => norm(u.displayName) === n);
  if (exact) return exact.uid;
  const first = n.split(' ')[0];
  const hits = executives.filter((u) => norm(u.displayName).split(' ').includes(first) || norm(u.displayName).startsWith(n));
  return hits.length === 1 ? hits[0].uid : null;
}

// Mismo ranking que el Pedido IA (domain/parse/client.ts rankClients).
export function matchClients(name: string | null, rut: string | null, clients: Client[]): Client[] {
  return rankClients({ fantasyName: name ?? undefined, rut: rut ?? undefined }, clients).filter((r) => r.score >= 30).map((r) => r.client);
}
