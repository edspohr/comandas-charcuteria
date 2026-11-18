import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ where: vi.fn(), api: vi.fn(), moved: false }));
vi.mock('firebase-admin/firestore', () => {
  const document = (id: string, data: Record<string, unknown>) => ({ id, exists: true, get: (key: string) => data[key], data: () => data });
  const a = () => document('a', { name: 'Cliente A', bsaleClientId: '10', ownerUid: 'seller' });
  const selected = { select: () => ({ get: async () => ({ docs: [a()] }) }) };
  return { getFirestore: () => ({
    doc: (path: string) => ({ get: async () => path.startsWith('users/') ? document('seller', { role: 'vendedor', active: true }) : path === 'settings/bsale' ? document('bsale', { enabled: true, writesEnabled: false }) : document('b', { ownerUid: 'other', bsaleClientId: '20' }) }),
    collection: () => ({ where: (...args: unknown[]) => { m.where(...args); return selected; } }),
    getAll: async () => [document('a', { ownerUid: m.moved ? 'other' : 'seller' })],
  }) };
});
vi.mock('../../functions/src/bsale/api', () => ({ BSALE_TOKEN: {}, apiFromSecret: () => { m.api(); return { get: async () => ({ client: { id: 10 }, overdue_documents: [] }) }; } }));
vi.mock('../../functions/src/pin', () => ({ checkPin: vi.fn() }));
import { bsaleReceivables, bsaleClientInvoices } from '../../functions/src/bsale/receivables';
const request = (data: unknown) => ({ auth: { uid: 'seller', token: { role: 'vendedor' } }, data }) as never;
beforeEach(() => { vi.clearAllMocks(); m.moved = false; });
it('ignora el ownerUid enviado por un vendedor y consulta solo la cartera del uid autenticado', async () => {
  const result = await bsaleReceivables.run(request({ ownerUid: 'other' }));
  expect(m.where).toHaveBeenCalledWith('ownerUid', '==', 'seller');
  expect(result.clients.map(c => c.id)).toEqual(['a']);
  expect(result.writesEnabled).toBe(false);
});
it('rechaza acceder al historial de un cliente ajeno antes de consultar Bsale', async () => {
  await expect(bsaleClientInvoices.run(request({ clientId: 'b' }))).rejects.toMatchObject({ code: 'permission-denied' });
  expect(m.api).not.toHaveBeenCalled();
});
it('retira los datos si el cliente fue reasignado durante la consulta remota', async () => {
  m.moved = true;
  const result = await bsaleReceivables.run(request({}));
  expect(result.clients).toEqual([]);
});
