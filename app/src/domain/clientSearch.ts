import type { Client } from './types';
import { baseName } from './parse/client';
import { cleanRut } from '../lib/rut';

const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Lo que más se parece primero: nombre exacto, después los que empiezan con
// lo escrito y al final los que lo contienen (antes salía en el orden de la
// colección y «Andar Café» quedaba al fondo).
export function searchClients(all: Client[], query: string, max = 20): Client[] {
  if (!query.trim()) return all.slice(0, max);
  const q = norm(query.trim());
  const qb = baseName(query);
  const rank = (c: Client) => {
    const fields = [baseName(c.fantasyName), baseName(c.name), baseName(c.contactName)];
    if (fields.includes(qb)) return 0;
    if (fields.some((f) => f.startsWith(qb))) return 1;
    if (fields.some((f) => f.split(' ').some((w) => w.startsWith(qb)))) return 2;
    return 3;
  };
  return all
    .filter((c) => norm(c.name).includes(q)
      || norm(c.fantasyName ?? '').includes(q)
      || norm(c.contactName ?? '').includes(q)
      || norm(c.rut ?? '').includes(q)
      || (/^[\d.kK\s-]+$/.test(query) && cleanRut(query).length >= 3 && cleanRut(c.rut ?? '').includes(cleanRut(query)))
      || (qb.length > 2 && (baseName(c.name).includes(qb) || baseName(c.fantasyName).includes(qb))))
    .map((c, i) => ({ c, r: rank(c), i }))
    .sort((a, b) => a.r - b.r || Number(!!b.c.bsaleClientId) - Number(!!a.c.bsaleClientId) || Number(b.c.invoicingComplete) - Number(a.c.invoicingComplete) || a.i - b.i)
    .map((x) => x.c)
    .slice(0, max);
}

// Exact fiscal identity first; a name only blocks creation if no conflicting RUT exists.
export function duplicateClient(all: Client[], input: { name?: string; fantasyName?: string; rut?: string }): Client | undefined {
  const rut = cleanRut(input.rut ?? '');
  if (rut) return all.find(c => c.rut && cleanRut(c.rut) === rut);
  const names = [input.name, input.fantasyName].map(baseName).filter(Boolean);
  return all.find(c => [c.name, c.fantasyName].map(baseName).some(n => n && names.includes(n)));
}
