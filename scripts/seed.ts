// Populates the Firestore + Auth emulators with the demo dataset.
// Run against emulators only. Wipes existing data first.
//
//   npm run emulators   # in one terminal (needs Java for firestore/auth)
//   npm run seed        # in another
//
// Requires FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST env vars,
// set below if unset. The seed refuses to run against a real project.

import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import { products } from './data/products.ts';
import { clients } from './data/clients.ts';
import { users } from './data/users.ts';
import { weekOrders } from './data/orders-week.ts';
import { stockDocId, type StockMovement } from '../app/src/domain/types.ts';

// Target selection:
//   - Default: Firebase emulators (safer; won't touch production).
//   - Set USE_REAL_FIREBASE=1 + GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
//     to run against the real project. The service account must have
//     Firebase Admin permissions on the target project.
const useEmulators = process.env.USE_REAL_FIREBASE !== '1';

if (useEmulators) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
} else {
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
}

const PROJECT_ID = useEmulators ? 'comandas-charcuteria-demo' : 'comandas-charcuteria';

function assertTarget() {
  if (useEmulators) {
    if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      throw new Error('Seed refused: emulator env vars missing.');
    }
    return;
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Seed against real Firebase requires GOOGLE_APPLICATION_CREDENTIALS pointing to a service account JSON.');
  }
  console.warn(`⚠️  Running against REAL project ${PROJECT_ID}. This will wipe products/clients/users/orders/stock. Ctrl-C to abort.`);
}

if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();
// Real Firestore rejects undefined values; the seed data has optional fields
// (aliases, notes, rut, …). Emulators accept them either way.
db.settings({ ignoreUndefinedProperties: true });

async function wipeFirestore() {
  // Note: `counters` is included so a re-seed resets both orders-YYYY and bsale-YYYY.
  const collections = ['products', 'clients', 'orders', 'stock', 'stockMovements', 'users', 'settings', 'counters'];
  for (const name of collections) {
    const snap = await db.collection(name).get();
    let batch = db.batch();
    let n = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      if (++n === 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n > 0) await batch.commit();
  }
}

async function wipeAuth() {
  const list = await auth.listUsers(1000);
  const uids = list.users.map((u) => u.uid);
  if (uids.length) await auth.deleteUsers(uids);
}

async function seedUsers() {
  for (const u of users) {
    try {
      await auth.createUser({ uid: u.uid, email: u.email, password: u.password, displayName: u.displayName });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/uid-already-exists' && code !== 'auth/email-already-exists') throw err;
    }
    await db.collection('users').doc(u.uid).set({
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
    });
  }
}

async function seedCatalog() {
  const batch = db.batch();
  for (const prod of products) batch.set(db.collection('products').doc(prod.id), prod);
  for (const cli of clients) batch.set(db.collection('clients').doc(cli.id), cli);
  batch.set(db.collection('settings').doc('app'), { cutoffHour: 15, timezone: 'America/Santiago' });
  batch.set(db.collection('counters').doc('orders-2026'), { last: weekOrders.length });
  // Bsale doc counter continues from the seeded invoice numbers (FA-000811..FA-000822).
  batch.set(db.collection('counters').doc('bsale-2026'), { last: 822 });
  await batch.commit();
}

// Initial stock: enough to satisfy most orders, but tight on some products
// so the demo can exercise the confirmado_parcial + Registrar producción flows.
// Keyed by "productId::formatId"; anything unlisted defaults to a comfortable buffer.
const initialOnHand: Record<string, number> = {
  // Longaniza chillán granel: PED-0029 pide 20 kg del wizard demo → 8 disponibles
  // + 12 a producción. Suma también: PED-0002/0009/0010/0017 = 64, reservas
  // abiertas ~ 26. Start at 100 → 100 − 64 − 28 = 8 disponibles.
  'longaniza-chillan::granel-kg': 100,
  'longaniza-chillan::sachet-4u-400g': 30,
  'coppa::pieza': 10,                       // PED-0037 splits at 4 reserved / 6 pending; el wizard demo puede pedir hasta 4 más
  'coppa::granel-kg': 15,
  'coppa::sachet-100g': 40,
  'pastrami-americano::pieza': 6,
  'jamon-cocido::sachet-200g': 200,
  'jamon-cocido::granel-kg': 25,
  'jamon-ahumado::sachet-200g': 100,
  'jamon-ahumado::granel-kg': 25,
  'mortadela-pistacho::granel-kg': 30,
  'mortadela-pistacho::sachet-200g': 100,
  'queso-gouda-ahumado::sachet-200g': 200,
  'queso-gouda-ahumado::granel-kg': 30,
  'salame-italiano::pieza': 40,
  'salame-milano::pieza': 40,
  'salame-angus::pieza': 30,
  'cabanossi-polaco::unidad-20g': 500,
  'cabanossi-polaco::caja-20u': 30,
  'tabla-150::tabla-150': 100,
  'tabla-200::tabla-200': 60,
};
const DEFAULT_ONHAND = 40;

async function seedStock() {
  const batch = db.batch();
  for (const prod of products) {
    if (prod.discontinued) continue;
    for (const fmt of prod.formats) {
      const key = `${prod.id}::${fmt.formatId}`;
      const onHand = initialOnHand[key] ?? DEFAULT_ONHAND;
      // reserved re-computed below when we seed orders — start at zero here.
      batch.set(db.collection('stock').doc(stockDocId(prod.id, fmt.formatId)), {
        productId: prod.id,
        formatId: fmt.formatId,
        onHand,
        reserved: 0,
      });
    }
  }
  await batch.commit();
}

// An order still consumes reservations if it hasn't yet reached armado/consumo.
// Once armado+ we treat stock as consumed (onHand decremented, reserved back to 0).
function isReservingStock(status: string) {
  return ['recibido', 'confirmado', 'confirmado_parcial', 'en_armado'].includes(status);
}
function isConsumingStock(status: string) {
  return ['armado', 'facturado', 'despachado', 'entregado'].includes(status);
}

async function seedOrdersAndMovements() {
  const movements: StockMovement[] = [];
  const reservedByStock: Record<string, number> = {};
  const consumedByStock: Record<string, number> = {};

  for (const order of weekOrders) {
    for (const l of order.lines) {
      const key = stockDocId(l.productId, l.formatId);
      if (isReservingStock(order.status) && l.reservedQty > 0) {
        reservedByStock[key] = (reservedByStock[key] ?? 0) + l.reservedQty;
        movements.push({
          id: `mv-res-${order.id}-${l.productId}-${l.formatId}`,
          productId: l.productId,
          formatId: l.formatId,
          qty: l.reservedQty,
          type: 'reserva',
          orderId: order.id,
          by: order.createdBy,
          at: order.createdAt,
        });
      }
      if (isConsumingStock(order.status) && (l.packedQty ?? l.reservedQty) > 0) {
        const consumed = l.packedQty ?? l.reservedQty;
        consumedByStock[key] = (consumedByStock[key] ?? 0) + consumed;
        movements.push({
          id: `mv-cons-${order.id}-${l.productId}-${l.formatId}`,
          productId: l.productId,
          formatId: l.formatId,
          qty: consumed,
          type: 'consumo',
          orderId: order.id,
          by: order.assignedPackerId ?? 'u-edu',
          at: order.updatedAt,
        });
      }
    }
  }

  // Apply aggregated reservations / consumptions to stock docs.
  const stockUpdates = new Map<string, { reserved: number; onHandDelta: number }>();
  for (const [key, qty] of Object.entries(reservedByStock)) {
    stockUpdates.set(key, { reserved: qty, onHandDelta: (stockUpdates.get(key)?.onHandDelta ?? 0) });
  }
  for (const [key, qty] of Object.entries(consumedByStock)) {
    const prev = stockUpdates.get(key) ?? { reserved: 0, onHandDelta: 0 };
    stockUpdates.set(key, { reserved: prev.reserved, onHandDelta: prev.onHandDelta - qty });
  }

  const batch = db.batch();
  for (const order of weekOrders) batch.set(db.collection('orders').doc(order.id), order);
  for (const mv of movements) batch.set(db.collection('stockMovements').doc(mv.id), mv);
  for (const [key, upd] of stockUpdates.entries()) {
    const ref = db.collection('stock').doc(key);
    batch.update(ref, {
      reserved: upd.reserved,
      onHand: FieldValue.increment(upd.onHandDelta),
    });
  }
  await batch.commit();
}

async function assertStockNonNegative() {
  const snap = await db.collection('stock').get();
  const bad: string[] = [];
  snap.forEach((d) => {
    const s = d.data() as { onHand: number; reserved: number };
    if (s.onHand < 0) bad.push(`${d.id}: onHand=${s.onHand}`);
    if (s.reserved < 0) bad.push(`${d.id}: reserved=${s.reserved}`);
  });
  if (bad.length) {
    throw new Error(`Seed left non-negative stock invariant broken:\n  ${bad.join('\n  ')}`);
  }
}

async function main() {
  assertTarget();
  console.log(`→ Wiping project "${PROJECT_ID}"...`);
  await wipeFirestore();
  await wipeAuth();

  console.log('→ Seeding users (auth + firestore)...');
  await seedUsers();

  console.log(`→ Seeding catalog (${products.length} products, ${clients.length} clients)...`);
  await seedCatalog();

  console.log('→ Seeding initial stock...');
  await seedStock();

  console.log(`→ Seeding ${weekOrders.length} orders + stock movements...`);
  await seedOrdersAndMovements();

  console.log('→ Verifying stock invariant...');
  await assertStockNonNegative();

  console.log('✅ Seed complete.');
  console.log('   Login: rafael@charcuteria.demo / demo1234 (vendedor)');
  console.log('           edu@charcuteria.demo   / demo1234 (armador)');
  console.log('           yuri@charcuteria.demo  / demo1234 (producción)');
  console.log('           miguel@charcuteria.demo/ demo1234 (admin)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
