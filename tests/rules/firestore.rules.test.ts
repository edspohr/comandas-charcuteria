import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

// Firestore emulator must be running on 127.0.0.1:8080 for this suite.
// Firestore + Auth emulators both require a Java runtime.
//
// Coverage — three critical cases from the spec:
//   1. Vendedor cannot edit orders belonging to another vendedor.
//   2. Vendedor cannot change status past their allowed transitions.
//   3. Despacho cannot set invoiceRef.

const PROJECT = 'comandas-charcuteria-demo';

let env: RulesTestEnvironment;

async function seedUser(uid: string, role: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), {
      uid, email: `${uid}@test.local`, displayName: uid, role,
    });
  });
}

async function seedOrder(id: string, createdBy: string, overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'orders', id), {
      id, createdBy,
      clientId: 'c-1', clientSnapshot: { name: 'Cliente demo' },
      lines: [], requestedDate: '2026-09-30',
      deliveryMode: 'despacho',
      status: 'confirmado',
      statusHistory: [{ status: 'confirmado', by: createdBy, at: Date.now() }],
      source: 'app',
      invoicingComplete: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    });
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

afterAll(async () => {
  await env?.cleanup();
});

describe('firestore rules', () => {
  it('vendedor cannot edit another vendedor\'s order', async () => {
    await env.clearFirestore();
    await seedUser('u-alice', 'vendedor');
    await seedUser('u-bob',   'vendedor');
    await seedOrder('PED-A-1', 'u-alice');

    const bob = env.authenticatedContext('u-bob').firestore();
    await assertFails(updateDoc(doc(bob, 'orders', 'PED-A-1'), { status: 'anulado' }));
  });

  it('vendedor cannot change status past their allowed transition (en_armado is forbidden)', async () => {
    await env.clearFirestore();
    await seedUser('u-alice', 'vendedor');
    await seedOrder('PED-A-2', 'u-alice');

    const alice = env.authenticatedContext('u-alice').firestore();
    // Trying to jump directly to en_armado from their own order must fail.
    await assertFails(updateDoc(doc(alice, 'orders', 'PED-A-2'), { status: 'en_armado' }));
    // Sanity: anular on the same order IS allowed.
    await assertSucceeds(updateDoc(doc(alice, 'orders', 'PED-A-2'), { status: 'anulado' }));
  });

  it('despacho cannot set invoiceRef', async () => {
    await env.clearFirestore();
    await seedUser('u-edu', 'despacho');
    await seedOrder('PED-A-3', 'u-someone', { status: 'en_armado' });

    const edu = env.authenticatedContext('u-edu').firestore();
    // Marcar armado (legal): status stays despacho-allowed and invoiceRef doesn't change.
    await assertSucceeds(updateDoc(doc(edu, 'orders', 'PED-A-3'), { status: 'armado' }));
    // Setting invoiceRef alongside is forbidden.
    await assertFails(updateDoc(doc(edu, 'orders', 'PED-A-3'), { invoiceRef: 'FA-999999' }));
  });
});
