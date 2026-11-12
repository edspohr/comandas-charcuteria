import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { syncClients, syncStock } from '../../functions/src/bsale/sync';
import { linkPosDocument } from '../../functions/src/bsale/link';
import type { BsaleApi } from '../../functions/src/bsale/api';
const project = 'comandas-bsale-flows-test';
const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
// No production credentials or services are used by these tests.
describe.skipIf(!emulated)('Bsale: sincronización y vinculación en emulador', () => {
  let app: ReturnType<typeof initializeApp>;
  let db: ReturnType<typeof getFirestore>;
  const settings = { enabled: true, writesEnabled: false, dryRun: true, factoryOfficeId: 1, storeOfficeId: 2, docTypeKinds: { '1': 'factura' as const } };
  beforeAll(() => { app = initializeApp({ projectId: project }); db = getFirestore(app); });
  beforeEach(async () => { await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' }); });
  afterAll(async () => { await deleteApp(app); });
  const order = (id: string, source = 'tienda') => ({ id, stockSource: source, status: 'armado', clientSnapshot: { rut: '78205279-9' }, lines: [{ productId: 'p', formatId: 'kg', reservedQty: 3, pendingProductionQty: 0, packedQty: 3 }], statusHistory: [], requestedDate: '2026-11-13', createdAt: 1 });
  const doc = { id: 123, number: 5, state: 0, emissionDate: 1794510000, office: { id: 2 }, client: { code: '78.205.279-9' }, document_type: { id: 1 }, details: { items: [] } };
  const api = (office = 2): BsaleApi => ({ callCount: 0, get: async () => ({ ...doc, office: { id: office } }), getAll: async (path: string) => path === '/stocks.json' ? [{ variant: { id: 4 }, office: { id: 1 }, quantity: 10 }, { variant: { id: 4 }, office: { id: 2 }, quantity: 5 }] : [] } as unknown as BsaleApi);
  async function seedStock() {
    await db.doc('catalogMap/4').set({ variantId: '4', productId: 'p', formatId: 'kg', status: 'confirmado' });
    await db.doc('stock/p__kg').set({ productId: 'p', formatId: 'kg', onHand: 10, reserved: 2, storeOnHand: 8, storeReserved: 3 });
  }
  it('trae clientes antiguos aunque nunca hayan comprado y limpia el contacto usado como fantasía', async () => {
    await db.doc('clients/zulu').set({ id: 'zulu', name: 'ZULU SPA', fantasyName: 'MAGDALENA VEGANZONES', bsaleClientId: '5929', notes: 'conservar', deliveryMode: 'despacho' });
    const fake = { getAll: async () => [{ id: 5929, company: 'ZULU SPA', firstName: 'MAGDALENA', lastName: 'VEGANZONES', createdAt: 1 }, { id: 9, company: 'Antiguo SpA', createdAt: 1 }] } as unknown as BsaleApi;
    expect((await syncClients(fake)).total).toBe(2);
    const c = (await db.doc('clients/zulu').get()).data();
    expect(c).toMatchObject({ name: 'ZULU SPA', contactName: 'MAGDALENA VEGANZONES', fantasyName: null, notes: 'conservar' });
    expect((await db.collection('clients').where('bsaleClientId', '==', '9').get()).size).toBe(1);
  });
  it('un nombre igual con RUT distinto no cambia la identidad de la ficha local', async () => {
    await db.doc('clients/legacy').set({ id: 'legacy', name: 'Local SPA', rut: '11111111-1', deliveryMode: 'despacho' });
    const fake = { getAll: async () => [{ id: 50, company: 'Local SPA', code: '22222222-2' }] } as unknown as BsaleApi;
    await syncClients(fake);
    expect((await db.doc('clients/legacy').get()).get('rut')).toBe('11111111-1');
    expect((await db.collection('clients').where('bsaleClientId', '==', '50').get()).size).toBe(1);
  });
  it('una sincronización anterior no sobrescribe una lectura más reciente', async () => {
    await seedStock();
    await db.doc('stock/p__kg').update({ onHand: 1, storeOnHand: 2, balanceReadStartedAt: Date.now() + 60_000 });
    await syncStock(api(), settings);
    expect((await db.doc('stock/p__kg').get()).data()).toMatchObject({ onHand: 1, storeOnHand: 2 });
  });
  it('la sincronización no repone reservas y una variante sin filas queda en cero', async () => {
    await seedStock();
    await syncStock(api(), settings);
    expect((await db.doc('stock/p__kg').get()).data()).toMatchObject({ onHand: 10, reserved: 2, storeOnHand: 5, storeReserved: 3 });
    const empty = { getAll: async () => [], callCount: 0 } as unknown as BsaleApi;
    await syncStock(empty, settings);
    expect((await db.doc('stock/p__kg').get()).data()).toMatchObject({ onHand: 0, reserved: 2, storeOnHand: 0, storeReserved: 3 });
  });
  it('la reserva FIFO de tienda no usa el stock de fábrica', async () => {
    await seedStock();
    await db.doc('orders/pending').set({ ...order('pending'), status: 'confirmado_parcial', lines: [{ productId: 'p', formatId: 'kg', reservedQty: 0, pendingProductionQty: 4 }] });
    await syncStock(api(), settings);
    expect((await db.doc('orders/pending').get()).get('lines')[0]).toMatchObject({ reservedQty: 2, pendingProductionQty: 2 });
    expect((await db.doc('stock/p__kg').get()).data()).toMatchObject({ reserved: 2, storeReserved: 5 });
  });
  it('vincula en una transacción, libera tienda y lee la venta real sin una segunda rebaja', async () => {
    await seedStock(); await db.doc('orders/o1').set(order('o1'));
    await linkPosDocument(api(), settings, 'o1', '123', 'FA-000005', 'admin', false);
    expect((await db.doc('stock/p__kg').get()).data()).toMatchObject({ onHand: 10, reserved: 2, storeOnHand: 5, storeReserved: 0 });
    expect((await db.doc('orders/o1').get()).get('status')).toBe('facturado');
    await expect(linkPosDocument(api(), settings, 'o1', '123', 'FA-000005', 'admin', false)).rejects.toThrow('ya tiene');
    expect((await db.doc('stock/p__kg').get()).get('storeReserved')).toBe(0);
  });
  it('rechaza otra sucursal y la misma factura para dos pedidos concurrentes', async () => {
    await seedStock(); await db.doc('orders/o1').set(order('o1')); await db.doc('orders/o2').set(order('o2'));
    await expect(linkPosDocument(api(1), settings, 'o1', '123', 'FA-000005', 'admin', false)).rejects.toThrow('sucursal');
    const result = await Promise.allSettled(['o1','o2'].map(id => linkPosDocument(api(), settings, id, '123', 'FA-000005', 'admin', false)));
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter(r => r.status === 'rejected')).toHaveLength(1);
  });
});
