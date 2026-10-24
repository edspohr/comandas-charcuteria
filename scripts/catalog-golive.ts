// Catálogo para la puesta en marcha (23-10-2026), decisiones explícitas:
//   1. Cruza las variantes de Bsale con stock que se venden y no estaban
//      cruzadas (agrega el formato al producto que corresponde o crea el
//      producto). El stock aparece en la próxima sincronización (10 min).
//   2. Marca como no vendibles (sellable: false) los productos de Bsale que no
//      se ofrecen al cliente: materia prima, insumos y la tienda web. Siguen
//      en el catálogo y sincronizando; se reactivan en Catálogo.
// Los packs ($0, miles de unidades) y las variantes "PÁGINA" se dejan sin cruzar.
//
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/catalog-golive.ts                                  # simulación
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/catalog-golive.ts --confirm comandas-charcuteria   # aplica

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'comandas-charcuteria';
const args = process.argv.slice(2);
const confirmed = args.includes('--confirm') && args[args.indexOf('--confirm') + 1] === PROJECT;
initializeApp({ projectId: process.env.FIRESTORE_EMULATOR_HOST ? 'comandas-charcuteria-demo' : PROJECT });
const db = getFirestore();

interface Format { formatId: string; label: string; unit: 'kg' | 'unidad'; grams?: number; priceCLP?: number; pricePerKgCLP?: number }
type Target =
  | { variantId: string; product: string; format: string }                                   // existing format
  | { variantId: string; product: string; addFormat: Format }                                // new format on existing product
  | { variantId: string; newProduct: { id: string; name: string; category: string }; addFormat: Format };

const TARGETS: Target[] = [
  { variantId: '5307', product: 'jamon-serrano', addFormat: { formatId: 'sachet-100g', label: 'Sachet 100 g', unit: 'unidad', grams: 100, priceCLP: 4000 } },
  { variantId: '5592', product: 'roast-beef', format: 'sachet-200g' },
  { variantId: '5407', product: 'pepperoni-untable', addFormat: { formatId: 'tubo', label: 'Tubo', unit: 'unidad', priceCLP: 2000 } },
  { variantId: '5408', product: 'sobrasada-untable', addFormat: { formatId: 'tubo', label: 'Tubo', unit: 'unidad' } },
  { variantId: '5454', newProduct: { id: 'salame-untable', name: 'Salame Untable', category: 'untables' }, addFormat: { formatId: 'tubo', label: 'Tubo', unit: 'unidad', priceCLP: 2000 } },
  { variantId: '5482', newProduct: { id: 'pastrami-untable', name: 'Pastrami Untable', category: 'untables' }, addFormat: { formatId: 'tubo', label: 'Tubo', unit: 'unidad' } },
  { variantId: '5537', product: 'untable-madurado', format: 'unidad' },
  { variantId: '5398', newProduct: { id: 'queso-guayanes', name: 'Queso Guayanés', category: 'cocidos' }, addFormat: { formatId: 'granel-kg', label: 'Granel (kg)', unit: 'kg' } },
  { variantId: '5423', product: 'recorte-cecinas', format: 'granel-kg' },
  { variantId: '5425', product: 'recorte-cecinas', format: 'unidad' },
  { variantId: '5426', newProduct: { id: 'despunte-lomo', name: 'Despunte de Lomo', category: 'cocidos' }, addFormat: { formatId: 'sachet-250g', label: 'Sachet 250 g', unit: 'unidad', grams: 250 } },
  { variantId: '5581', product: 'salame-italiano', addFormat: { formatId: 'ahumado', label: 'Ahumado', unit: 'unidad', priceCLP: 1690 } },
  { variantId: '5699', newProduct: { id: 'trucha-ahumada', name: 'Trucha Ahumada en Frío', category: 'cocidos' }, addFormat: { formatId: 'granel-kg', label: 'Granel (kg)', unit: 'kg', pricePerKgCLP: 30000 } },
];

const NOT_SELLABLE_CATEGORIES = new Set(['materia prima', 'pagina']);
const NOT_SELLABLE_NAMES = /^(caja|delivery|plumavit|sobre|productos varios|productos madurando)$|p[aá]gina/i;

async function main() {
  console.log(confirmed ? `→ Aplicando en ${PROJECT}` : '→ Simulación (agregue --confirm ' + PROJECT + ' para aplicar)');
  const products = new Map((await db.collection('products').get()).docs.map((d) => [d.id, d.data() as { name: string; category: string; active: boolean; formats: Format[]; sellable?: boolean }]));
  const batch = db.batch();
  let n = 0;
  const now = Date.now();
  for (const t of TARGETS) {
    const variant = (await db.doc(`bsale/catalog/variants/${t.variantId}`).get()).data();
    if (!variant) { console.warn(`  ${t.variantId}: no existe en el espejo, se omite`); continue; }
    let productId: string; let formatId: string;
    if ('newProduct' in t) {
      productId = t.newProduct.id; formatId = t.addFormat.formatId;
      if (!products.has(productId)) {
        const p = { id: productId, name: t.newProduct.name, category: t.newProduct.category, active: true, discontinued: false, formats: [t.addFormat], aliases: [], source: 'bsale', createdAt: now };
        products.set(productId, p); batch.set(db.doc(`products/${productId}`), p); n++;
      }
    } else {
      productId = t.product;
      const p = products.get(productId);
      if (!p) { console.warn(`  ${t.variantId}: producto ${productId} no existe, se omite`); continue; }
      if ('addFormat' in t) {
        formatId = t.addFormat.formatId;
        if (!p.formats.some((f) => f.formatId === formatId)) p.formats = [...p.formats, t.addFormat];
      } else {
        formatId = t.format;
        if (!p.formats.some((f) => f.formatId === formatId)) { console.warn(`  ${t.variantId}: ${productId} no tiene ${formatId}, se omite`); continue; }
      }
      batch.set(db.doc(`products/${productId}`), { formats: p.formats, active: true, discontinued: false, sellable: true }, { merge: true }); n++;
    }
    batch.set(db.doc(`catalogMap/${t.variantId}`), { variantId: t.variantId, productId, formatId, status: 'confirmado', bsaleLabel: variant.label, updatedAt: now, updatedBy: 'puesta-en-marcha' }, { merge: true }); n++;
    console.log(`  ${t.variantId} ${String(variant.label).padEnd(40)} → ${productId} / ${formatId}`);
  }
  let hidden = 0;
  for (const [id, p] of products) {
    if (p.sellable === false) continue;
    if (NOT_SELLABLE_CATEGORIES.has(p.category) || NOT_SELLABLE_NAMES.test(p.name)) {
      batch.set(db.doc(`products/${id}`), { sellable: false }, { merge: true }); n++; hidden++;
      console.log(`  no vendible: ${p.name} (${p.category})`);
    }
  }
  console.log(`${TARGETS.length} cruces · ${hidden} productos fuera del pedido · ${n} escrituras`);
  if (confirmed) { await batch.commit(); console.log('✔ Aplicado. El stock de los nuevos cruces aparece en la próxima sincronización.'); }
}

main().catch((e) => { console.error(e); process.exit(1); });
