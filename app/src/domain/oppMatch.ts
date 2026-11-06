import type { AppUser } from '@/domain/types';
import type { Client } from '@/domain/types';
import { cleanRut } from '@/lib/rut';

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

export function matchClients(name: string | null, rut: string | null, clients: Client[]): Client[] {
  if (rut) {
    const r = cleanRut(rut);
    const byRut = clients.filter((c) => c.rut && cleanRut(c.rut) === r);
    if (byRut.length) return byRut;
  }
  if (!name) return [];
  const n = norm(name);
  const words = n.split(' ').filter((w) => w.length > 2 && !['restaurant', 'restaurante', 'cafe', 'hotel', 'spa', 'ltda', 'limitada'].includes(w));
  const scored = clients.map((c) => {
    const hay = norm(`${c.fantasyName ?? ''} ${c.name}`);
    const score = hay.includes(n) ? 10 : words.filter((w) => hay.includes(w)).length;
    return { c, score };
  }).filter((x) => x.score > 0 && (x.score >= 10 || x.score >= Math.max(1, Math.ceil(words.length * 0.6))));
  return scored.sort((a, b) => b.score - a.score).slice(0, 5).map((x) => x.c);
}
