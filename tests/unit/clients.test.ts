import { describe, expect, it } from 'vitest';
import { customerFromRaw } from '../../functions/src/bsale/customers';
import { searchClients, duplicateClient } from '../../app/src/domain/clientSearch';
import { rankClients, rankClientsInText } from '../../app/src/domain/parse/client';
import type { Client } from '../../app/src/domain/types';
const c = (id: string, overrides: Partial<Client> = {}): Client => ({ id, name: 'ZULU SPA', deliveryMode: 'despacho', invoicingComplete: true, ...overrides });

describe('identidad de clientes Bsale', () => {
  it('mantiene razón social y contacto separados (Zulu y Bilbao)', () => {
    const x = customerFromRaw({ id: 5929, company: 'ZULU SPA', firstName: 'MAGADALENA', lastName: 'VEGANZONES', activity: 'RESTAURANT' });
    expect(x.name).toBe('ZULU SPA'); expect(x.contactName).toBe('MAGADALENA VEGANZONES'); expect(x.fantasyName).toBeUndefined(); expect(x.giro).toBe('RESTAURANT');
    const y = customerFromRaw({ id: 5452, company: 'Bilbao Restobar SpA', firstName: 'EDUADO', lastName: 'CID', attributes: { items: [{ id: 8, name: 'NOMBRE FANTASÍA', value: 'Lola Bar' }] } });
    expect(y.fantasyName).toBe('Lola Bar'); expect(y.contactName).toBe('EDUADO CID');
  });
  it('busca RUT con puntos, sin puntos, sin guion y K minúscula', () => {
    const all = [c('g', { name: 'EXPLORA CHILE S. A.', rut: '96.566.100-k' })];
    for (const q of ['96566100-k', '96.566.100-K', '96566100k', '96566100']) expect(searchClients(all, q).map(c => c.id)).toEqual(['g']);
  });
  it('prioriza Bsale frente a la ficha histórica y busca por contacto y razón social', () => {
    const remote = c('bsale', { bsaleClientId: '5929', contactName: 'Magdalena Veganzones' });
    const old = c('wa', { name: 'Zulu', invoicingComplete: false });
    expect(searchClients([old, remote], 'zulu')[0].id).toBe('bsale');
    expect(searchClients([remote], 'magdalena')).toEqual([remote]);
    expect(rankClients({ fantasyName: 'Zulu' }, [old, remote])[0].client.id).toBe('bsale');
  });
  it('el modo local reconoce Andar Café en el mensaje original y respeta un RUT contradictorio', () => {
    const client = c('andar', { name: 'ANDAR CAFE SPA', bsaleClientId: '5140', rut: '77980484-4' });
    expect(rankClientsInText('10 pastrami para andar cafe', [client])[0].client.id).toBe('andar');
    expect(rankClients({ rut: '78205279-9', name: 'Andar Café' }, [client])).toEqual([]);
  });
  it('no limita los clientes a los primeros resultados cuando se pide el directorio', () => {
    const all = Array.from({ length: 40 }, (_, i) => c(`${i}`));
    expect(searchClients(all, 'zulu', Infinity)).toHaveLength(40);
  });
  it('bloquea duplicado por identidad fiscal y permite razones sociales distintas con nombre parecido', () => {
    const all = [c('one', { rut: '78.205.279-9' })];
    expect(duplicateClient(all, { rut: '782052799', name: 'Otro nombre' })?.id).toBe('one');
    expect(duplicateClient(all, { rut: '77980484-4', name: 'ZULU SPA' })).toBeUndefined();
    expect(duplicateClient(all, { name: 'Zulu' })?.id).toBe('one');
  });
});
