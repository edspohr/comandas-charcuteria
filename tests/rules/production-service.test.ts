import { scryptSync } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect, it, describe, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { startBatch, closeBatch, cancelBatch, sendBatchProduction } from '../../functions/src/production/service';
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const project = 'comandas-production-test';
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('elaboraciones atómicas en emulador', () => {
  let app: ReturnType<typeof initializeApp>; let db: ReturnType<typeof getFirestore>;
  const user = { uid: 'production', name: 'Producción' };
  beforeAll(() => { app = initializeApp({ projectId: project }); db = getFirestore(app); });
  beforeEach(async () => {
    await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
    await db.doc('supplies/carne').set({ name: 'Carne', unit: 'kg' });
    await db.doc('supplyLots/l1').set({ supplyId: 'carne', supplyName: 'Carne', kg: 10, units: 0, receivedAt: 1, costPerKg: 1500, purchaseId: 'compra-1' });
    await db.doc('products/jamon').set({ name: 'Jamón', active: true, formats: [{ formatId: 'kg', label: 'Kilo', unit: 'kg' }] });
  });
  afterAll(async () => deleteApp(app));
  it('un reintento consume una sola vez y el cierre crea una sola carga', async () => {
    const inputs = [{ supplyId: 'carne', qty: 8 }];
    await Promise.all([startBatch(db, 'batch-a', 'Cocción', inputs, user), startBatch(db, 'batch-a', 'Cocción', inputs, user)]);
    expect((await db.doc('supplyLots/l1').get()).get('consumedKg')).toBe(8);
    expect((await db.collection('supplyMovements').get()).size).toBe(1);
    const outputs = [{ productId: 'jamon', formatId: 'kg', qty: 6, outputKg: 6 }];
    const ids = await Promise.all([closeBatch(db, 'batch-a', outputs, user), closeBatch(db, 'batch-a', outputs, user)]);
    expect(ids[0]).toBe(ids[1]);
    expect((await db.collection('productionLog').get()).size).toBe(1);
    expect((await db.doc('productionBatches/batch-a').get()).data()).toMatchObject({ outputKg: 6, knownCostCLP: 12000, costComplete: true });
  });
  it('dos elaboraciones concurrentes no sobreconsumen el mismo lote', async () => {
    const results = await Promise.allSettled(['a', 'b'].map(id => startBatch(db, id, 'Cocción', [{ supplyId: 'carne', qty: 8 }], user)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.doc('supplyLots/l1').get()).get('consumedKg')).toBe(8);
  });
  it('anular devuelve los insumos una sola vez y bloquea el cierre', async () => {
    await startBatch(db, 'a', 'Cocción', [{ supplyId: 'carne', qty: 4 }], user);
    await cancelBatch(db, 'a', 'admin'); await cancelBatch(db, 'a', 'admin');
    expect((await db.doc('supplyLots/l1').get()).get('consumedKg')).toBe(0);
    expect((await db.collection('supplyMovements').get()).size).toBe(2);
    await expect(closeBatch(db, 'a', [{ productId: 'jamon', formatId: 'kg', qty: 3, outputKg: 3 }], user)).rejects.toThrow('anulada');
  });
  it('un cierre inválido no termina el proceso ni genera stock', async () => {
    await startBatch(db, 'a', 'Cocción', [{ supplyId: 'carne', qty: 4 }], user);
    await expect(closeBatch(db, 'a', [{ productId: 'jamon', formatId: 'kg', qty: 3, outputKg: 20 }], user)).rejects.toThrow('no coinciden');
    expect((await db.doc('productionBatches/a').get()).get('status')).toBe('en_proceso');
    expect((await db.collection('productionLog').get()).size).toBe(0);
  });
  it('un envío simultáneo recibe una sola vez en Bsale; un fallo de sync no reenvía producción', async () => {
    await startBatch(db, 'a', 'Cocción', [{ supplyId: 'carne', qty: 4 }], user);
    const id = await closeBatch(db, 'a', [{ productId: 'jamon', formatId: 'kg', qty: 3, outputKg: 3 }], user);
    let calls = 0;
    const send = async () => { calls++; return { logId: 'log1' }; };
    await Promise.all([sendBatchProduction(db, id, user.uid, send, async () => { throw Error('sync falló'); }), sendBatchProduction(db, id, user.uid, send, async () => {})]);
    expect(calls).toBe(1);
    expect((await db.doc(`productionLog/${id}`).get()).get('bsaleStatus')).toBe('ok');
  });
  it('un timeout externo queda para conciliación y nunca se reenvía automáticamente', async () => {
    await startBatch(db, 'a', 'Cocción', [{ supplyId: 'carne', qty: 4 }], user);
    const id = await closeBatch(db, 'a', [{ productId: 'jamon', formatId: 'kg', qty: 3, outputKg: 3 }], user);
    let calls = 0;
    const send = async () => { calls++; throw Error('timeout'); };
    expect((await sendBatchProduction(db, id, user.uid, send, async () => {})).status).toBe('revisar');
    expect((await sendBatchProduction(db, id, user.uid, send, async () => {})).status).toBe('consultar');
    expect(calls).toBe(1);
    expect((await db.doc(`productionLog/${id}`).get()).get('bsaleStatus')).toBe('revisar');
  });

  it('las funciones exigen perfil y PIN en servidor; el inventario inicial es idempotente', async () => {
    const functions = await import('../../functions/src/production');
    const req = (role: string, data: object) => ({ auth: { uid: user.uid, token: { role } }, data, rawRequest: { headers: {} } } as any);
    const data = { id: 'inicial', supplyId: 'carne', qty: 2, costPerKg: 1000 };
    await db.doc(`userPins/${user.uid}`).set({ salt: 'qa-only', hash: scryptSync('4827', 'qa-only', 32).toString('base64'), setAt: 1 });
    await expect(functions.productionStart.run(req('vendedor', { id: 'x', process: 'Cocción', inputs: [{ supplyId: 'carne', qty: 2 }], pin: '4827' }))).rejects.toThrow('perfil');
    await expect(functions.supplyInitialStock.run(req('admin', data))).rejects.toThrow('PIN');
    expect((await db.doc('supplyLots/inicial').get()).exists).toBe(false);
    await functions.supplyInitialStock.run(req('admin', { ...data, pin: '4827' }));
    await functions.supplyInitialStock.run(req('admin', { ...data, pin: '4827' }));
    expect((await db.doc('supplyLots/inicial').get()).data()).toMatchObject({ kg: 2, origin: 'inventario', costPerKg: 1000 });
    await functions.productionStart.run(req('produccion', { id: 'via-funcion', process: 'Cocción', inputs: [{ supplyId: 'carne', qty: 2 }], pin: '4827' }));
    expect((await db.doc('productionBatches/via-funcion').get()).get('status')).toBe('en_proceso');
  });

});
