// Carga real desde Bsale, de una vez y desde la terminal (no espera al cron):
//   1. diagnóstico: maestros, catálogo, precios, stock, 90 días de documentos,
//      sucursales y lista de precios sugeridas (functions/src/bsale/diagnose.ts)
//   2. cruce de catálogo: confirma las sugerencias con puntaje alto
//   3. crea en la app los productos de Bsale que se venden o tienen stock y no
//      calzaron con ninguno (catálogo = Bsale)
//   4. precios de la lista de Bsale en los formatos cruzados
//   5. productos de la app sin cruce → inactivos (no se ofrecen al vender; los
//      pedidos históricos que los usan quedan intactos)
//   6. enciende la sincronización (escrituras siguen apagadas) y corre la
//      primera: stock por sucursal, documentos y clientes que compran
//
//   BSALE_ACCESS_TOKEN=$(gcloud secrets versions access latest --secret=BSALE_ACCESS_TOKEN --project=comandas-charcuteria) \
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//   npx tsx scripts/bsale-load.ts --confirm comandas-charcuteria
//
// Re-ejecutable: nunca pisa un cruce confirmado o ignorado a mano.

import { getFirestore } from 'firebase-admin/firestore';
import '../functions/src/common.ts';
import { BsaleApi } from '../functions/src/bsale/api.ts';
import { runDiagnostic } from '../functions/src/bsale/diagnose.ts';
import { fullSync } from '../functions/src/bsale/sync.ts';
import { patchSettings } from '../functions/src/bsale/config.ts';

const PROJECT = 'comandas-charcuteria';
const AUTO_CONFIRM = 0.8;

interface MapEntry { variantId: string; productId?: string; formatId?: string; status: string; score?: number; bsaleLabel?: string }
interface Variant { variantId: string; bsaleProductId: string; productName: string; description: string; label: string; productType?: string; active: boolean; priceCLP?: number }
interface Format { formatId: string; label: string; unit: 'g' | 'kg' | 'unidad'; grams?: number; priceCLP?: number; pricePerKgCLP?: number; avgWeightKg?: number }
interface Product { id: string; name: string; category: string; active: boolean; discontinued: boolean; formats: Format[]; aliases?: string[]; bsaleProductId?: string }

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const title = (s: string) => s.trim().toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());

function formatFromVariant(v: Variant): Format {
  const d = `${v.description} ${v.productName}`.toLowerCase();
  const grams = Number(d.match(/(\d{2,4})\s?g(r|rs)?\b/)?.[1] ?? NaN);
  if (/pieza|entero|entera/.test(d)) return { formatId: 'pieza', label: v.description ? title(v.description) : 'Pieza', unit: 'unidad', pricePerKgCLP: v.priceCLP, avgWeightKg: 1.5 };
  if (/\b(kg|kilo|granel|laminad)/.test(d)) return { formatId: 'granel-kg', label: v.description ? title(v.description) : 'Granel (kg)', unit: 'kg', pricePerKgCLP: v.priceCLP };
  return { formatId: Number.isFinite(grams) ? `sachet-${grams}g` : `v-${v.variantId}`, label: v.description ? title(v.description) : 'Unidad', unit: 'unidad', grams: Number.isFinite(grams) ? grams : undefined, priceCLP: v.priceCLP };
}
const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined)) as T;

async function main() {
  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token || token === 'pendiente') throw new Error('Falta BSALE_ACCESS_TOKEN.');
  const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (!emulated) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Falta GOOGLE_APPLICATION_CREDENTIALS.');
    const i = process.argv.indexOf('--confirm');
    if (i < 0 || process.argv[i + 1] !== PROJECT) throw new Error(`Para escribir en el proyecto real agregue --confirm ${PROJECT}`);
  }
  const db = getFirestore();
  const api = new BsaleApi(token);

  console.log('1/6 Diagnóstico…');
  const d = await runDiagnostic(api, 'bsale-load');
  console.log(`    ${d.products} productos, ${d.variants} variantes (${d.activeVariants} activas), ${d.clients} clientes, ${d.documents90d} documentos en 90 días, ${d.apiCalls} llamadas`);
  console.log(`    sucursales: ${d.offices.map((o) => `${o.id} ${o.name}`).join(' · ')}`);
  console.log(`    sugerido → fábrica ${d.suggestedSettings.factoryOfficeId}, tienda ${d.suggestedSettings.storeOfficeId}, lista ${d.suggestedSettings.priceListId}`);
  d.warnings.forEach((w) => console.log(`    ⚠ ${w}`));

  const variants = (await db.collection('bsale').doc('catalog').collection('variants').get()).docs.map((x) => x.data() as Variant);
  const vById = new Map(variants.map((v) => [v.variantId, v]));
  let map = (await db.collection('catalogMap').get()).docs.map((x) => x.data() as MapEntry);

  console.log('2/6 Cruce de catálogo…');
  const toConfirm = map.filter((m) => m.status === 'sugerido' && m.productId && (m.score ?? 0) >= AUTO_CONFIRM && vById.get(m.variantId)?.active);
  for (let i = 0; i < toConfirm.length; i += 400) {
    const b = db.batch();
    toConfirm.slice(i, i + 400).forEach((m) => b.set(db.doc(`catalogMap/${m.variantId}`), { status: 'confirmado', updatedAt: Date.now(), updatedBy: 'bsale-load' }, { merge: true }));
    await b.commit();
  }
  console.log(`    ${toConfirm.length} cruces confirmados (puntaje ≥ ${AUTO_CONFIRM})`);
  map = (await db.collection('catalogMap').get()).docs.map((x) => x.data() as MapEntry);

  console.log('3/6 Productos de Bsale que faltan en la app…');
  const stockByVariant = new Map((await db.collection('bsale').doc('stock').collection('byVariant').get()).docs.map((x) => {
    const offs = (x.get('offices') ?? {}) as Record<string, { quantity: number }>;
    return [x.id, Object.values(offs).reduce((s, o) => s + (o.quantity > 0 ? o.quantity : 0), 0)];
  }));
  const sold = new Set<string>();
  (await db.collection('bsale').doc('sales').collection('documents').get()).forEach((x) => (x.get('details') ?? []).forEach((it: { variantId: string }) => sold.add(String(it.variantId))));
  const mappedVariant = new Set(map.filter((m) => m.productId && m.status !== 'ignorado').map((m) => m.variantId));
  const byBsaleProduct = new Map<string, Variant[]>();
  for (const v of variants) if (v.active) byBsaleProduct.set(v.bsaleProductId, [...(byBsaleProduct.get(v.bsaleProductId) ?? []), v]);
  const products = new Map((await db.collection('products').get()).docs.map((x) => [x.id, x.data() as Product]));
  let created = 0;
  for (const [, vs] of byBsaleProduct) {
    if (vs.some((v) => mappedVariant.has(v.variantId))) continue;
    if (!vs.some((v) => sold.has(v.variantId) || (stockByVariant.get(v.variantId) ?? 0) > 0)) continue; // ni se vende ni hay stock
    const first = vs[0];
    const id = `${slug(first.productName) || 'producto'}-${first.bsaleProductId}`;
    const used = new Set<string>();
    const formats = vs.map((v) => { const f = formatFromVariant(v); if (used.has(f.formatId)) f.formatId = `${f.formatId}-${v.variantId}`; used.add(f.formatId); return clean(f); });
    const b = db.batch();
    b.set(db.doc(`products/${id}`), { id, name: title(first.productName), category: (first.productType ?? 'otros').toLowerCase(), active: true, discontinued: false, formats, bsaleProductId: first.bsaleProductId });
    vs.forEach((v, i) => b.set(db.doc(`catalogMap/${v.variantId}`), { variantId: v.variantId, productId: id, formatId: formats[i].formatId, status: 'confirmado', bsaleLabel: v.label, updatedAt: Date.now(), updatedBy: 'bsale-load' }, { merge: true }));
    await b.commit();
    created++;
  }
  console.log(`    ${created} productos creados desde Bsale`);
  map = (await db.collection('catalogMap').get()).docs.map((x) => x.data() as MapEntry);
  const refreshed = new Map((await db.collection('products').get()).docs.map((x) => [x.id, x.data() as Product]));

  console.log('4/6 Precios desde la lista de Bsale…');
  const priceByKey = new Map<string, number>();
  for (const m of map) {
    if (m.status !== 'confirmado' || !m.productId || !m.formatId) continue;
    const p = vById.get(m.variantId)?.priceCLP;
    if (p != null && p > 0 && !priceByKey.has(`${m.productId}__${m.formatId}`)) priceByKey.set(`${m.productId}__${m.formatId}`, p);
  }
  let priced = 0;
  for (const p of refreshed.values()) {
    let touched = false;
    const formats = p.formats.map((f) => {
      const price = priceByKey.get(`${p.id}__${f.formatId}`);
      if (price == null) return f;
      const byKg = f.unit === 'kg' || f.formatId === 'pieza' || (f.pricePerKgCLP != null && f.priceCLP == null);
      if ((byKg ? f.pricePerKgCLP : f.priceCLP) === price) return f;
      touched = true; priced++;
      return byKg ? { ...f, pricePerKgCLP: price } : { ...f, priceCLP: price };
    });
    if (touched) await db.doc(`products/${p.id}`).update({ formats });
  }
  console.log(`    ${priced} formatos con precio de Bsale`);

  console.log('5/6 Productos sin cruce con Bsale…');
  // Only products Bsale doesn't know at all: a pending suggestion keeps the
  // product active until someone reviews it in Catálogo → Cruce.
  const mappedProducts = new Set(map.filter((m) => m.productId && m.status !== 'ignorado' && vById.get(m.variantId)?.active).map((m) => m.productId!));
  const orphan = [...refreshed.values()].filter((p) => !mappedProducts.has(p.id) && p.active);
  for (const p of orphan) await db.doc(`products/${p.id}`).update({ active: false, inactiveReason: 'Sin cruce con Bsale (bsale-load)' });
  console.log(`    ${orphan.length} desactivados (revise Catálogo → Cruce con Bsale para recuperar los que sí existen)${orphan.length ? ': ' + orphan.slice(0, 15).map((p) => p.name).join(', ') + (orphan.length > 15 ? '…' : '') : ''}`);

  console.log('6/6 Primera sincronización…');
  await patchSettings({ enabled: true, writesEnabled: false, dryRun: true });
  const s = await fullSync(api, 'bsale-load', { forceClients: true });
  console.log(`    stock: ${s.updated} formatos actualizados · ${s.unmappedVariantsWithStock} variantes con stock sin cruce · ${s.compromised.length} comprometidos`);
  console.log(`    pedidos promovidos por stock: ${s.promoted.length} · documentos: ${s.documentsUpserted ?? 0} · clientes: ${s.clientsUpdated ?? 0} · ${s.apiCalls} llamadas`);
  const pending = map.filter((m) => m.status === 'sugerido' && vById.get(m.variantId)?.active).length;
  console.log(`✅ Listo. Quedan ${pending} variantes activas por revisar en Catálogo → Cruce con Bsale. Escrituras hacia Bsale: apagadas.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
