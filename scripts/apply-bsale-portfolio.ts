import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { matchSeller, suggestPortfolio, type PortfolioSale } from './portfolio-suggestions';

// Dry run by default. Explicit --apply writes only currently unassigned clients.
initializeApp({ credential: applicationDefault(), projectId: 'comandas-charcuteria' });
async function main() {
  const db = getFirestore();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const start = new Date(`${today}T12:00:00Z`); start.setUTCMonth(start.getUTCMonth() - 6);
  const since = start.toISOString().slice(0, 10);
  const [userSnap, sellerSnap, monthSnap, clientSnap] = await Promise.all([
    db.collection('users').get(), db.collection('bsale/master/users').get(),
    db.collection('bsale/facts/months').where('month', '>=', since.slice(0, 7)).get(), db.collection('clients').get(),
  ]);
  const users = userSnap.docs.filter(d => d.get('active') !== false && !d.get('placeholder') && !d.get('mergedInto') && ['vendedor', 'tienda', 'admin', 'superAdmin'].includes(d.get('role')))
    .map(d => ({ uid: d.id, displayName: String(d.get('displayName') ?? ''), email: d.get('email') as string | undefined }));
  const sellerMap = new Map(sellerSnap.docs.map(d => [d.id, { uid: d.get('state') === 1 || /soporte|logistica|inventario|prueba|por fabrica|^tienda /i.test(d.get('name') ?? '') ? null : matchSeller({ name: d.get('name') ?? '', email: d.get('email') }, users), name: d.get('name') }]));
  const sales: PortfolioSale[] = [];
  for (const month of monthSnap.docs) {
    const buf = month.get('data');
    if (!buf) continue;
    const data = JSON.parse(gunzipSync(Buffer.isBuffer(buf) ? buf : Buffer.from(buf.toUint8Array?.() ?? buf)).toString('utf8'));
    for (const [day, id, kind, , sellerId, clientId, , total] of data.docs) sales.push({ id, kind, sellerId, clientId, total, date: `${month.id}-${String(day).padStart(2, '0')}` });
  }
  const suggestions = suggestPortfolio(sales, since, today);
  const report: Array<Record<string, unknown>> = [];
  const duplicated = new Map<string, number>();
  for (const c of clientSnap.docs) if (!c.get('canonicalClientId') && c.get('bsaleClientId')) duplicated.set(String(c.get('bsaleClientId')), (duplicated.get(String(c.get('bsaleClientId'))) ?? 0) + 1);
  for (const c of clientSnap.docs) {
    if (c.get('canonicalClientId') || c.get('isInternalShop')) continue;
    const bsaleId = String(c.get('bsaleClientId') ?? '');
    const suggestion = suggestions.get(bsaleId);
    if (!suggestion) continue;
    const seller = suggestion.sellerId ? sellerMap.get(suggestion.sellerId) : undefined;
    const status = c.get('ownerUid') || c.get('ownerAssignmentSource') === 'manual' ? 'conservado' : duplicated.get(bsaleId)! > 1 ? 'cliente_duplicado' : !suggestion.sellerId ? 'sin_mayoria' : !seller?.uid ? 'vendedor_sin_usuario' : 'asignar';
    report.push({ clientId: c.id, clientName: c.get('fantasyName') ?? c.get('name'), previousOwner: c.get('ownerUid') ?? null, suggestedOwner: seller?.uid ?? null, seller: seller?.name ?? suggestion.sellerId, status, ...suggestion });
  }
  const runId = `bsale-portfolio-${Date.now()}`;
  mkdirSync('private', { recursive: true });
  writeFileSync(`private/${runId}.json`, JSON.stringify({ since, until: today, sellerMapping: Object.fromEntries(sellerMap), report }, null, 2));
  let applied = 0;
  if (process.argv.includes('--apply')) {
    for (const row of report.filter(r => r.status === 'asignar')) {
      const changed = await db.runTransaction(async tx => {
        const ref = db.doc(`clients/${row.clientId}`);
        const snap = await tx.get(ref);
        if (!snap.exists || snap.get('ownerUid') || snap.get('ownerAssignmentSource') === 'manual' || snap.get('canonicalClientId') || snap.get('isInternalShop')) return false;
        tx.update(ref, { ownerUid: row.suggestedOwner, ownerAssignmentSource: 'bsale', ownerAssignedAt: Date.now(), ownerAssignedBy: runId, ownerAssignmentEvidence: { since, until: today, sellerId: row.sellerId, documents: row.documents, total: row.total } });
        return true;
      });
      if (changed) applied++;
    }
  }
  console.log(JSON.stringify({ since, until: today, counts: report.reduce((a, r) => { const k = String(r.status); a[k] = (a[k] ?? 0) + 1; return a; }, {} as Record<string, number>), bySeller: report.filter(r => r.status === 'asignar').reduce((a, r) => { const k = String(r.seller); a[k] = (a[k] ?? 0) + 1; return a; }, {} as Record<string, number>), applied, report: `private/${runId}.json` }, null, 2));
}
main().catch(e => { console.error(e.message); process.exit(1); });
