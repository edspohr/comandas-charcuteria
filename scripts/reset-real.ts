// Arranque limpio del proyecto real: borra todo lo de la demo para que el
// equipo parta con datos de verdad (stock y clientes llegan desde Bsale).
//
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/reset-real.ts            # muestra qué borraría
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/reset-real.ts --confirm comandas-charcuteria
//
// Borra: pedidos, bitácora de stock, contadores, espejo de stock y clientes,
// el Bsale simulado, el resumen de sincronización y los usuarios de demo
// (@charcuteria.demo, en Auth y en users/). Opcional --products también borra
// el catálogo transcrito (por defecto se conserva: sirve de destino para el
// cruce con Bsale y tiene alias para Pedido IA).
// Conserva: settings/app, settings/bsale, catalogMap, bsale/* (espejos del
// servidor), usuarios reales e invitaciones.

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'comandas-charcuteria';
const args = process.argv.slice(2);
const confirmed = args[args.indexOf('--confirm') + 1] === PROJECT && args.includes('--confirm');
const withProducts = args.includes('--products');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Falta GOOGLE_APPLICATION_CREDENTIALS (cuenta de servicio del proyecto real).');
  process.exit(1);
}

initializeApp({ projectId: process.env.FIRESTORE_EMULATOR_HOST ? 'comandas-charcuteria-demo' : PROJECT });
const db = getFirestore();
const auth = getAuth();

const COLLECTIONS = [
  'orders', 'stockMovements', 'counters', 'stock', 'clients',
  'bsaleMock', 'bsaleDocuments', 'bsaleReceptions', 'bsaleClients',
  ...(withProducts ? ['products'] : []),
];
const DEMO_DOMAIN = '@charcuteria.demo';

async function main() {
  console.log(confirmed ? `⚠️  Borrando datos de demo en ${PROJECT}…` : `Simulación (nada se borra). Para ejecutar: --confirm ${PROJECT}`);
  for (const name of COLLECTIONS) {
    const snap = await db.collection(name).get();
    console.log(`  ${name}: ${snap.size}`);
    if (confirmed && snap.size) await db.recursiveDelete(db.collection(name));
  }
  const sync = db.doc('settings/bsaleSync');
  if ((await sync.get()).exists) { console.log('  settings/bsaleSync: 1'); if (confirmed) await sync.delete(); }

  const demo: string[] = [];
  let page: string | undefined;
  do {
    const r = await auth.listUsers(1000, page);
    for (const u of r.users) if (u.email?.endsWith(DEMO_DOMAIN)) demo.push(u.uid);
    page = r.pageToken;
  } while (page);
  const demoDocs = (await db.collection('users').get()).docs.filter((d) => String(d.data().email ?? '').endsWith(DEMO_DOMAIN));
  console.log(`  usuarios demo: ${demo.length} en Auth, ${demoDocs.length} en users/`);
  if (confirmed) {
    if (demo.length) await auth.deleteUsers(demo);
    for (const d of demoDocs) await d.ref.delete();
  }
  console.log(confirmed ? '✅ Listo. Siguiente: scripts/bootstrap-admin.ts para los primeros accesos.' : 'Fin de la simulación.');
}

main().catch((e) => { console.error(e); process.exit(1); });
