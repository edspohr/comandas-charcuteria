import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

// Needs the Firestore emulator (Java). From the repo root:
//   npm run test:rules:emu
// The role travels as the custom claim `role`, exactly like production
// (functions/src/users.ts sets it), so each context passes it as a token claim.

// Own project id: running against the dev emulator must not wipe its data.
const PROJECT = 'comandas-rules-test';

let env: RulesTestEnvironment;

function as(uid: string, role?: string) {
  return env.authenticatedContext(uid, role ? { role, email: `${uid}@test.local` } : { email: `${uid}@test.local` }).firestore();
}

async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), path), data); });
}

async function seedOrder(id: string, createdBy: string, overrides: Record<string, unknown> = {}) {
  await seed(`orders/${id}`, {
    id, createdBy,
    clientId: 'c-1', clientSnapshot: { name: 'Cliente demo' },
    lines: [], requestedDate: '2026-10-30',
    deliveryMode: 'despacho',
    status: 'confirmado',
    statusHistory: [{ status: 'confirmado', by: createdBy, at: Date.now() }],
    source: 'app',
    invoicingComplete: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => { await env.clearFirestore(); });

afterAll(async () => {
  await env?.cleanup();
});

describe('pedidos', () => {
  it('vendedor cannot edit another vendedor\'s order', async () => {
    await seedOrder('PED-1', 'u-alice');
    await assertFails(updateDoc(doc(as('u-bob', 'vendedor'), 'orders', 'PED-1'), { status: 'anulado' }));
  });

  it('vendedor cannot skip states, but can anular their own', async () => {
    await seedOrder('PED-2', 'u-alice');
    const alice = as('u-alice', 'vendedor');
    await assertFails(updateDoc(doc(alice, 'orders', 'PED-2'), { status: 'en_armado' }));
    await assertSucceeds(updateDoc(doc(alice, 'orders', 'PED-2'), { status: 'anulado' }));
  });

  it('vendedor edits own order before invoicing (ADR-0018) but not the client or after facturado', async () => {
    await seedOrder('PED-E1', 'u-alice', { status: 'armado', assignedPackerId: 'u-edu' });
    await seedOrder('PED-E2', 'u-alice', { status: 'facturado', invoiceRef: 'FA-000001' });
    const alice = as('u-alice', 'vendedor');
    await assertSucceeds(updateDoc(doc(alice, 'orders', 'PED-E1'), { status: 'en_armado', lines: [{ productId: 'p', qty: 2 }], changeNotice: { for: 'armado', at: 1, by: 'u-alice' } }));
    await assertFails(updateDoc(doc(alice, 'orders', 'PED-E1'), { clientId: 'c-otro' }));
    await assertFails(updateDoc(doc(alice, 'orders', 'PED-E1'), { assignedPackerId: 'u-alice' }));
    await assertFails(updateDoc(doc(alice, 'orders', 'PED-E2'), { lines: [{ productId: 'p', qty: 9 }] }));
  });

  it('vendedor deletes own armado order (soft delete); another vendedor cannot', async () => {
    await seedOrder('PED-D1', 'u-alice', { status: 'armado' });
    await assertFails(updateDoc(doc(as('u-bob', 'vendedor'), 'orders', 'PED-D1'), { status: 'anulado', deleted: { at: 1, by: 'u-bob', reason: 'x' } }));
    await assertSucceeds(updateDoc(doc(as('u-alice', 'vendedor'), 'orders', 'PED-D1'), { status: 'anulado', deleted: { at: 1, by: 'u-alice', reason: 'duplicado' } }));
  });

  it('packer acknowledges a change notice but cannot touch anything else that way', async () => {
    await seedOrder('PED-V1', 'u-alice', { changeNotice: { for: 'armado', at: 1, by: 'u-alice' } });
    const edu = as('u-edu', 'despacho');
    await assertFails(updateDoc(doc(edu, 'orders', 'PED-V1'), { changeNotice: null, lines: [{ productId: 'p', qty: 9 }] }));
    await assertSucceeds(updateDoc(doc(edu, 'orders', 'PED-V1'), { changeNotice: null, updatedAt: 2 }));
  });

  it('despacho cannot set invoiceRef, but can marcar armado', async () => {
    await seedOrder('PED-3', 'u-someone', { status: 'en_armado' });
    const edu = as('u-edu', 'despacho');
    await assertSucceeds(updateDoc(doc(edu, 'orders', 'PED-3'), { status: 'armado' }));
    await assertFails(updateDoc(doc(edu, 'orders', 'PED-3'), { invoiceRef: 'FA-999999' }));
  });

  it('produccion also packs (06-11) but cannot link a document', async () => {
    await seedOrder('PED-3P', 'u-someone', { status: 'en_armado' });
    const yuri = as('u-yuri', 'produccion');
    await assertSucceeds(updateDoc(doc(yuri, 'orders', 'PED-3P'), { status: 'armado' }));
    await assertFails(updateDoc(doc(yuri, 'orders', 'PED-3P'), { invoiceRef: 'FA-999999' }));
  });

  it('reparto delivers a dispatched order but cannot link a document', async () => {
    await seedOrder('PED-4', 'u-someone', { status: 'despachado' });
    await seedOrder('PED-5', 'u-someone', { status: 'armado' });
    const daniel = as('u-daniel', 'reparto');
    await assertSucceeds(updateDoc(doc(daniel, 'orders', 'PED-4'), { status: 'entregado' }));
    await assertFails(updateDoc(doc(daniel, 'orders', 'PED-5'), { status: 'facturado', invoiceRef: 'FA-1' }));
  });

  it('tienda creates its own replenishment order', async () => {
    const lucy = as('u-lucy', 'tienda');
    await assertSucceeds(setDoc(doc(lucy, 'orders', 'PED-6'), {
      id: 'PED-6', createdBy: 'u-lucy', status: 'confirmado', lines: [], statusHistory: [],
    }));
    await assertFails(setDoc(doc(lucy, 'orders', 'PED-7'), {
      id: 'PED-7', createdBy: 'u-otro', status: 'confirmado', lines: [], statusHistory: [],
    }));
  });
});

describe('reposición de tienda', () => {
  it('despacho registers the exit of a samples-only order (MU-) but not of a sale', async () => {
    await seedOrder('PED-M', 'u-alice', { status: 'armado', kind: 'muestras' });
    await seedOrder('PED-V', 'u-alice', { status: 'armado', kind: 'venta' });
    const edu = as('u-edu', 'despacho');
    await assertFails(updateDoc(doc(edu, 'orders', 'PED-V'), { status: 'facturado', invoiceRef: 'MU-PED-V' }));
    await assertFails(updateDoc(doc(edu, 'orders', 'PED-M'), { status: 'facturado', invoiceRef: 'FA-000001' }));
    await assertSucceeds(updateDoc(doc(edu, 'orders', 'PED-M'), { status: 'facturado', invoiceRef: 'MU-PED-M' }));
  });

  it('a seller saves the client usual window and a missing fantasy name, nothing else', async () => {
    await seed('clients/c-1', { id: 'c-1', name: 'Inversiones Uno SpA', deliveryMode: 'despacho', invoicingComplete: true });
    await seed('clients/c-2', { id: 'c-2', name: 'Dos Ltda', fantasyName: 'Café Dos', deliveryMode: 'despacho', invoicingComplete: true });
    const alice = as('u-alice', 'vendedor');
    await assertSucceeds(updateDoc(doc(alice, 'clients', 'c-1'), { deliveryWindow: { from: '09:00', to: '13:00' }, receivingHours: '09:00–13:00', fantasyName: 'Café Uno' }));
    await assertFails(updateDoc(doc(alice, 'clients', 'c-2'), { fantasyName: 'Otro nombre' }));
    await assertFails(updateDoc(doc(alice, 'clients', 'c-1'), { rut: '11.111.111-1' }));
    await assertFails(updateDoc(doc(as('u-rep', 'reparto'), 'clients', 'c-1'), { fantasyName: 'X' }));
  });

  it('despacho cannot take an order waiting for approval; superAdmin approves it', async () => {
    await seedOrder('PED-X', 'u-alice', { approval: { status: 'pendiente', reasons: ['Precio especial'], requestedBy: 'u-alice', requestedAt: 1 } });
    await assertFails(updateDoc(doc(as('u-edu', 'despacho'), 'orders', 'PED-X'), { status: 'en_armado', assignedPackerId: 'u-edu' }));
    await assertSucceeds(updateDoc(doc(as('u-ciro', 'superAdmin'), 'orders', 'PED-X'), { 'approval.status': 'aprobado' }));
    await assertSucceeds(updateDoc(doc(as('u-edu', 'despacho'), 'orders', 'PED-X'), { status: 'en_armado', assignedPackerId: 'u-edu' }));
  });

  it('a seller answers a sample follow-up only as themself', async () => {
    const alice = as('u-alice', 'vendedor');
    const fb = { id: 'PED-1__coppa__granel', orderId: 'PED-1', productId: 'coppa', formatId: 'granel', result: 'gusto', at: Date.now() };
    await assertFails(setDoc(doc(alice, 'sampleFeedback', fb.id), { ...fb, by: 'u-bob' }));
    await assertSucceeds(setDoc(doc(alice, 'sampleFeedback', fb.id), { ...fb, by: 'u-alice' }));
    await assertFails(setDoc(doc(as('u-edu', 'despacho'), 'sampleFeedback', fb.id), { ...fb, by: 'u-edu' }));
  });

  it('despacho registers the transfer only for a reposición, and tienda receives it', async () => {
    await seedOrder('PED-R1', 'u-lucy', { kind: 'reposicion', status: 'armado' });
    await seedOrder('PED-V1', 'u-alice', { kind: 'venta', status: 'armado' });
    await seedOrder('PED-R2', 'u-lucy', { kind: 'reposicion', status: 'despachado' });
    const edu = as('u-edu', 'despacho');
    await assertSucceeds(updateDoc(doc(edu, 'orders', 'PED-R1'), { status: 'facturado', invoiceRef: 'TR-PED-R1' }));
    await assertFails(updateDoc(doc(edu, 'orders', 'PED-V1'), { status: 'facturado', invoiceRef: 'TR-PED-V1' }));
    await assertSucceeds(updateDoc(doc(as('u-lucy', 'tienda'), 'orders', 'PED-R2'), { status: 'entregado' }));
    await assertFails(updateDoc(doc(as('u-lucy', 'tienda'), 'orders', 'PED-V1'), { status: 'entregado' }));
  });
});

describe('consultor (auditor)', () => {
  it('reads everything but writes nothing', async () => {
    await seedOrder('PED-8', 'u-alice');
    await seed('stock/p__f', { productId: 'p', formatId: 'f', onHand: 5, reserved: 0 });
    await seed('invites/x@y.cl', { email: 'x@y.cl', role: 'vendedor' });
    const ed = as('u-ed', 'consultor');
    await assertSucceeds(getDoc(doc(ed, 'orders', 'PED-8')));
    await assertSucceeds(getDoc(doc(ed, 'invites', 'x@y.cl')));
    await assertFails(updateDoc(doc(ed, 'orders', 'PED-8'), { status: 'anulado' }));
    await assertFails(updateDoc(doc(ed, 'stock', 'p__f'), { reserved: 1 }));
    await assertFails(setDoc(doc(ed, 'stockMovements', 'm1'), { by: 'u-ed', qty: 1 }));
  });
});

describe('usuarios', () => {
  it('nobody writes users or invites from the client, not even superAdmin', async () => {
    const ciro = as('u-ciro', 'superAdmin');
    await assertFails(setDoc(doc(ciro, 'users', 'u-x'), { role: 'superAdmin' }));
    await assertFails(setDoc(doc(ciro, 'invites', 'a@b.cl'), { role: 'vendedor' }));
  });

  it('a signed-in account without a role reads only its own user doc', async () => {
    await seed('users/u-new', { uid: 'u-new', role: 'vendedor' });
    await seedOrder('PED-9', 'u-alice');
    const fresh = as('u-new');
    await assertSucceeds(getDoc(doc(fresh, 'users', 'u-new')));
    await assertFails(getDoc(doc(fresh, 'orders', 'PED-9')));
    await assertFails(getDoc(doc(as('u-new', 'vendedor'), 'invites', 'x@y.cl')));
  });
});

describe('bsale real (espejos del servidor)', () => {
  it('admin only marks linkedOrderId on a mirrored document; nobody else writes mirrors', async () => {
    await seed('bsale/sales/documents/d1', { id: 'd1', number: 'FA-000001', totalCLP: 1000 });
    const miguel = as('u-miguel', 'admin');
    await assertSucceeds(updateDoc(doc(miguel, 'bsale/sales/documents/d1'), { linkedOrderId: 'PED-1' }));
    await assertFails(updateDoc(doc(miguel, 'bsale/sales/documents/d1'), { totalCLP: 1 }));
    await assertFails(updateDoc(doc(as('u-edu', 'despacho'), 'bsale/sales/documents/d1'), { linkedOrderId: 'PED-2' }));
    await assertFails(setDoc(doc(as('u-ciro', 'superAdmin'), 'bsale/stock/byVariant/1'), { offices: {} }));
    await assertSucceeds(getDoc(doc(as('u-ed', 'consultor'), 'bsale/sales/documents/d1')));
  });

  it('webhook key is unreadable from the client', async () => {
    await seed('bsaleSecrets/webhook', { key: 'x' });
    await assertFails(getDoc(doc(as('u-ciro', 'superAdmin'), 'bsaleSecrets/webhook')));
  });
});


describe('oportunidades', () => {
  const opp = (overrides: Record<string, unknown> = {}) => ({
    id: 'op-1', clientId: 'c-1', clientSnapshot: { name: 'Cliente demo' }, title: 'Visita', origin: 'asignada',
    ownerUid: 'u-rafael', createdBy: 'u-ciro', productsOfInterest: [], status: 'abierta', orderIds: [], activity: [],
    createdAt: 1, updatedAt: 1, ...overrides,
  });

  it('the executive reads and manages only their own; cannot reassign or mark won', async () => {
    await seed('opportunities/op-1', opp());
    await seed('opportunities/op-2', opp({ id: 'op-2', ownerUid: 'u-gabriela' }));
    const rafael = as('u-rafael', 'vendedor');
    await assertSucceeds(getDoc(doc(rafael, 'opportunities', 'op-1')));
    await assertFails(getDoc(doc(rafael, 'opportunities', 'op-2')));
    await assertSucceeds(updateDoc(doc(rafael, 'opportunities', 'op-1'), { status: 'en_gestion', updatedAt: 2 }));
    await assertFails(updateDoc(doc(rafael, 'opportunities', 'op-1'), { ownerUid: 'u-gabriela' }));
    await assertFails(updateDoc(doc(rafael, 'opportunities', 'op-1'), { status: 'ganada' }));
    await assertFails(updateDoc(doc(rafael, 'opportunities', 'op-2'), { status: 'en_gestion' }));
  });

  it('postpone needs a date and lost needs a reason', async () => {
    await seed('opportunities/op-1', opp());
    const rafael = as('u-rafael', 'vendedor');
    await assertFails(updateDoc(doc(rafael, 'opportunities', 'op-1'), { status: 'postergada' }));
    await assertSucceeds(updateDoc(doc(rafael, 'opportunities', 'op-1'), { status: 'postergada', postponedUntil: '2026-12-01' }));
    await assertFails(updateDoc(doc(rafael, 'opportunities', 'op-1'), { status: 'perdida' }));
    await assertSucceeds(updateDoc(doc(rafael, 'opportunities', 'op-1'), { status: 'perdida', lostReason: 'precio' }));
  });

  it('sellers create only their own; superAdmin assigns anyone; admin and consultor only read', async () => {
    await assertSucceeds(setDoc(doc(as('u-rafael', 'vendedor'), 'opportunities', 'a'), opp({ id: 'a', ownerUid: 'u-rafael', createdBy: 'u-rafael', origin: 'propia' })));
    await assertFails(setDoc(doc(as('u-rafael', 'vendedor'), 'opportunities', 'b'), opp({ id: 'b', ownerUid: 'u-gabriela', createdBy: 'u-rafael' })));
    await assertSucceeds(setDoc(doc(as('u-ciro', 'superAdmin'), 'opportunities', 'c'), opp({ id: 'c', ownerUid: null })));
    await assertSucceeds(updateDoc(doc(as('u-ciro', 'superAdmin'), 'opportunities', 'c'), { ownerUid: 'u-gabriela' }));
    await assertFails(setDoc(doc(as('u-miguel', 'admin'), 'opportunities', 'd'), opp({ id: 'd', createdBy: 'u-miguel' })));
    await assertFails(updateDoc(doc(as('u-miguel', 'admin'), 'opportunities', 'c'), { status: 'en_gestion' }));
    await assertSucceeds(getDoc(doc(as('u-miguel', 'admin'), 'opportunities', 'c')));
    await assertSucceeds(getDoc(doc(as('u-ed', 'consultor'), 'opportunities', 'c')));
  });

  it('report candidates: superAdmin marks them, nobody creates them from the app', async () => {
    await seed('opportunityCandidates/inf-1', { id: 'inf-1', status: 'pendiente', rank: 1 });
    const ciro = as('u-ciro', 'superAdmin');
    await assertSucceeds(updateDoc(doc(ciro, 'opportunityCandidates', 'inf-1'), { status: 'cargada', opportunityId: 'op-1', loadedBy: 'u-ciro', loadedAt: 1 }));
    await assertFails(updateDoc(doc(ciro, 'opportunityCandidates', 'inf-1'), { rank: 2 }));
    await assertFails(setDoc(doc(ciro, 'opportunityCandidates', 'inf-2'), { id: 'inf-2' }));
    await assertFails(getDoc(doc(as('u-rafael', 'vendedor'), 'opportunityCandidates', 'inf-1')));
  });
});

describe('compras e insumos (prototipo, solo superAdmin)', () => {
  const purchase = (by: string) => ({ id: '761234567-33-10', supplierRut: '76.123.456-7', supplierName: 'Proveedor', docKind: 'factura', folio: '10', lines: [], boxes: [], summary: [], read: { timbre: true, foto: false }, receivedBy: by, receivedByName: 'X', receivedAt: 1 });
  it('superAdmin registra la compra; nadie la edita después', async () => {
    const ciro = as('u-ciro', 'superAdmin');
    await assertSucceeds(setDoc(doc(ciro, 'purchases', '761234567-33-10'), purchase('u-ciro')));
    await assertFails(updateDoc(doc(ciro, 'purchases', '761234567-33-10'), { folio: '11' }));
    // Solo se agregan documentos (foto o PDF) a una compra registrada.
    const d1 = { path: 'purchases/761234567-33-10/1-doc.jpg', name: 'doc.jpg', contentType: 'image/jpeg', size: 10, uploadedAt: 2, uploadedBy: 'u-ciro' };
    await assertSucceeds(updateDoc(doc(ciro, 'purchases', '761234567-33-10'), { documents: [d1] }));
    await assertFails(updateDoc(doc(ciro, 'purchases', '761234567-33-10'), { documents: [] }));
    await assertFails(updateDoc(doc(ciro, 'purchases', '761234567-33-10'), { documents: [d1, { ...d1, path: 'x' }], folio: '12' }));
    await assertFails(setDoc(doc(ciro, 'purchases', 'otra'), purchase('u-otro')));
    await assertSucceeds(setDoc(doc(ciro, 'supplyLots', 'l-1'), { supplyId: 's-1', kg: 12.5, receivedBy: 'u-ciro', receivedAt: 1 }));
    await assertFails(updateDoc(doc(ciro, 'supplyLots', 'l-1'), { kg: 99 }));
  });
  it('los demás perfiles no ven ni registran compras', async () => {
    await seed('purchases/p-1', purchase('u-ciro'));
    for (const [uid, role] of [['u-yury', 'produccion'], ['u-miguel', 'admin'], ['u-ed', 'consultor'], ['u-edu', 'despacho']] as const) {
      await assertFails(getDoc(doc(as(uid, role), 'purchases', 'p-1')));
      await assertFails(setDoc(doc(as(uid, role), 'supplies', `s-${uid}`), { name: 'x', createdBy: uid }));
    }
  });
});
