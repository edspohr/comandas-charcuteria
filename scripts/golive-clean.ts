// Puesta en marcha 1.0: deja producción solo con datos reales.
//
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/golive-clean.ts                                   # muestra qué haría
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/golive-clean.ts --confirm comandas-charcuteria    # lo hace
//   ... --confirm comandas-charcuteria --test-orders PED-2026-0412,PED-2026-0413                                             # además borra esos pedidos de prueba
//
// 1. Historial de WhatsApp (source 'whatsapp'): los cerrados quedan como
//    historial (archived: true, fuera del Tablero; siguen en fichas y panel).
//    Los abiertos (estado inferido, esperando producción) se anulan: no son
//    pedidos vivos y competían por el stock real.
// 2. Restos de la demo: usuarios @charcuteria.demo (Auth + users/) y las
//    colecciones del Bsale simulado.
// 3. Reservas: stock.reserved se recalcula desde los pedidos abiertos reales.
// 4. Lista los pedidos que no vienen de WhatsApp, para revisar si alguno fue
//    de prueba (se borran solo los que se pasen en --test-orders).
// Conserva: catálogo, clientes, cruce, espejos de Bsale, configuración,
// usuarios reales e invitaciones.

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type DocumentReference } from 'firebase-admin/firestore';

const PROJECT = 'comandas-charcuteria';
const args = process.argv.slice(2);
const confirmed = args.includes('--confirm') && args[args.indexOf('--confirm') + 1] === PROJECT;
const testOrders = new Set((args.includes('--test-orders') ? args[args.indexOf('--test-orders') + 1] ?? '' : '').split(',').map((x) => x.trim()).filter(Boolean));

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Falta GOOGLE_APPLICATION_CREDENTIALS (cuenta de servicio del proyecto real).');
  process.exit(1);
}
initializeApp({ projectId: process.env.FIRESTORE_EMULATOR_HOST ? 'comandas-charcuteria-demo' : PROJECT });
const db = getFirestore();
const auth = getAuth();

const MOCK_COLLECTIONS = ['bsaleMock', 'bsaleDocuments', 'bsaleReceptions', 'bsaleClients'];
const OPEN = new Set(['recibido', 'confirmado', 'confirmado_parcial', 'en_armado', 'armado']);
const DEMO_DOMAIN = '@charcuteria.demo';

interface Line { productId: string; formatId: string; reservedQty: number; pendingProductionQty: number }
interface Order { id: string; status: string; source?: string; archived?: boolean; createdBy: string; createdAt: number; clientSnapshot?: { name?: string; fantasyName?: string }; lines: Line[]; statusHistory: unknown[] }

type Op = { ref: DocumentReference; data?: Record<string, unknown>; del?: boolean };
async function commit(ops: Op[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    for (const op of ops.slice(i, i + 400)) op.del ? b.delete(op.ref) : b.set(op.ref, op.data!, { merge: true });
    await b.commit();
  }
}

async function main() {
  console.log(confirmed ? '→ MODO REAL: aplicando cambios en ' + PROJECT : '→ Simulación (sin cambios). Agregue --confirm ' + PROJECT + ' para aplicar.');
  const now = Date.now();
  const orders = (await db.collection('orders').get()).docs.map((d) => d.data() as Order);
  const wa = orders.filter((o) => o.source === 'whatsapp');
  const waOpen = wa.filter((o) => OPEN.has(o.status));
  const waClosed = wa.filter((o) => !OPEN.has(o.status) && !o.archived);
  const live = orders.filter((o) => o.source !== 'whatsapp');
  const ops: Op[] = [];

  // 1. WhatsApp history
  for (const o of waOpen) {
    ops.push({ ref: db.doc(`orders/${o.id}`), data: {
      status: 'anulado', archived: true, updatedAt: now,
      lines: o.lines.map((l) => ({ ...l, reservedQty: 0, pendingProductionQty: 0 })),
      statusHistory: [...o.statusHistory, { status: 'anulado', by: 'sistema', at: now, note: 'Archivado: pedido del historial de WhatsApp (puesta en marcha 1.0)' }],
    } });
  }
  for (const o of waClosed) ops.push({ ref: db.doc(`orders/${o.id}`), data: { archived: true } });
  console.log(`1. WhatsApp: ${wa.length} pedidos · ${waOpen.length} abiertos → anulados y archivados · ${waClosed.length} cerrados → archivados`);

  // 4. Test orders (explicit list only)
  for (const id of testOrders) {
    if (!orders.some((o) => o.id === id)) { console.warn(`   ${id} no existe, se omite`); continue; }
    ops.push({ ref: db.doc(`orders/${id}`), del: true });
  }

  // 3. Reservations from the real open orders that remain
  const remaining = live.filter((o) => OPEN.has(o.status) && !testOrders.has(o.id));
  const reserved = new Map<string, number>();
  for (const o of remaining) for (const l of o.lines) if (l.reservedQty > 0) {
    const k = `${l.productId}__${l.formatId}`; reserved.set(k, Math.round(((reserved.get(k) ?? 0) + l.reservedQty) * 1000) / 1000);
  }
  const stock = await db.collection('stock').get();
  let fixed = 0;
  for (const d of stock.docs) {
    const want = reserved.get(d.id) ?? 0;
    if (Math.abs(Number(d.get('reserved') ?? 0) - want) > 0.0001) { fixed++; ops.push({ ref: d.ref, data: { reserved: want } }); }
  }
  console.log(`3. Reservas: ${fixed} formatos corregidos según ${remaining.length} pedidos abiertos reales`);

  // 2. Demo leftovers
  let mockDocs = 0;
  for (const c of MOCK_COLLECTIONS) {
    const refs = await db.collection(c).listDocuments();
    for (const r of refs) { mockDocs++; ops.push({ ref: r, del: true }); }
  }
  const demoUsers = (await db.collection('users').get()).docs.filter((d) => String(d.get('email') ?? '').endsWith(DEMO_DOMAIN));
  for (const d of demoUsers) ops.push({ ref: d.ref, del: true });
  console.log(`2. Demo: ${mockDocs} documentos del Bsale simulado · ${demoUsers.length} usuarios @charcuteria.demo`);

  console.log(`4. Pedidos que no vienen de WhatsApp: ${live.length}${testOrders.size ? ` (${testOrders.size} se borran como prueba)` : ''}`);
  for (const o of live.sort((a, b) => a.createdAt - b.createdAt)) {
    console.log(`   ${o.id}  ${new Date(o.createdAt).toISOString().slice(0, 16)}  ${o.status.padEnd(18)} ${o.createdBy.padEnd(30)} ${o.clientSnapshot?.fantasyName ?? o.clientSnapshot?.name ?? ''}${testOrders.has(o.id) ? '  ← BORRAR' : ''}`);
  }

  if (!confirmed) { console.log(`\n${ops.length} escrituras pendientes. Nada se modificó.`); return; }
  await commit(ops);
  for (const d of demoUsers) { try { await auth.deleteUser(d.id); } catch { /* ya no existía en Auth */ } }
  let page = await auth.listUsers(1000);
  for (;;) {
    for (const u of page.users) if (u.email?.endsWith(DEMO_DOMAIN)) await auth.deleteUser(u.uid);
    if (!page.pageToken) break;
    page = await auth.listUsers(1000, page.pageToken);
  }
  console.log(`\n✔ Listo: ${ops.length} escrituras aplicadas.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
