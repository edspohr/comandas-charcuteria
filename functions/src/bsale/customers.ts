import type { RawClient } from './api';

const key = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function customerFromRaw(c: RawClient) {
  const person = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  const company = c.company?.trim();
  const fantasy = c.attributes?.items?.find(a => ['nombre fantasia', 'nombre de fantasia', 'nombre comercial'].includes(key(a.name)))?.value?.trim();
  return {
    id: String(c.id),
    rut: c.code?.trim() || undefined,
    name: company || person || `Cliente ${c.id}`,
    // firstName/lastName are the person/contact, never a business alias.
    fantasyName: fantasy || undefined,
    contactName: company && person && key(person) !== key(company) ? person : undefined,
    giro: c.activity?.trim() || undefined,
    address: [c.address, c.municipality, c.city].filter(s => s?.trim()).join(', ') || undefined,
    phone: c.phone?.trim() || undefined,
    email: c.email?.trim() || undefined,
  };
}
