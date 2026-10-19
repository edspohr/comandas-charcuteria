import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type {
  BsaleApi, RawDocument, RawDocumentType, RawOffice, RawPriceDetail, RawPriceList, RawProduct,
  RawProductType, RawStock, RawUser, RawVariant,
} from './api';
import { docKindFor, loadSettings, patchSettings } from './config';
import { documentFromRaw, fetchDocumentsInRange, stripUndefined, writeInChunks, type WriteOp } from './sync';

// Diagnóstico: la primera vez que llega el token se corre esto y queda
// todo lo que hace falta para "darle forma definitiva" a la integración:
//   - maestros (sucursales, tipos de documento, listas de precio, tipos de
//     producto, usuarios/vendedores, tipos de despacho) en bsale/master/*
//   - catálogo completo (productos + variantes + precio) en bsale/catalog/variants
//   - stock por sucursal en bsale/stock/byVariant
//   - 90 días de documentos en bsale/sales/documents
//   - sugerencias de cruce variante ↔ producto/formato en catalogMap
//   - un resumen legible en bsale/meta (diagnostic)
// Es idempotente: se puede correr de nuevo cuando cambie algo en Bsale.

interface AppProduct { id: string; name: string; aliases?: string[]; formats: Array<{ formatId: string; label: string; unit: string; grams?: number }> }

export interface DiagnosticSummary {
  at: number;
  by: string;
  durationMs: number;
  apiCalls: number;
  offices: Array<{ id: number; name: string; isVirtual: boolean; variantsWithStock: number }>;
  documentTypes: Array<{ id: number; name: string; codeSii?: string; kind: string; count90d: number }>;
  priceLists: Array<{ id: number; name: string }>;
  productTypes: Array<{ id: number; name: string; products: number }>;
  products: number;
  variants: number;
  activeVariants: number;
  clients: number;
  users: Array<{ id: number; name: string; email?: string; documents90d: number }>;
  documents90d: number;
  sales90dCLP: number;
  topVariants90d: Array<{ variantId: string; label: string; quantity: number; totalCLP: number }>;
  mapping: { suggested: number; confirmed: number; unmatched: number };
  warnings: string[];
  suggestedSettings: { factoryOfficeId?: number; storeOfficeId?: number; priceListId?: number; transferShippingTypeId?: number };
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['de', 'del', 'la', 'el', 'en', 'con', 'x', 'y', 'al', 'gr', 'g', 'kg', 'un', 'unidad', 'sachet', 'granel', 'pieza', 'aprox']);
const tokens = (s: string) => new Set(norm(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t)));

function similarity(a: string, b: string): number {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(A.size, B.size);
}

// Formato por pistas del nombre de la variante: "200 g" → sachet de 200 g,
// "kg"/"granel" → granel por kg, "pieza"/"entero" → pieza.
function guessFormat(p: AppProduct, variantLabel: string): { formatId: string; confidence: number } | null {
  const n = norm(variantLabel);
  const grams = Number(n.match(/(\d{2,4})\s?g(r|rs)?\b/)?.[1] ?? NaN);
  if (Number.isFinite(grams)) {
    const f = p.formats.find((x) => x.grams === grams) ?? p.formats.find((x) => x.unit === 'unidad' && norm(x.label).includes(String(grams)));
    if (f) return { formatId: f.formatId, confidence: 1 };
  }
  // Pieza before kg: "Pieza entera x kg" is priced per kg but is a piece.
  if (/\b(pieza|entero|entera|trozo)/.test(n)) {
    const f = p.formats.find((x) => x.formatId === 'pieza' || norm(x.label).includes('pieza'));
    if (f) return { formatId: f.formatId, confidence: 0.8 };
  }
  if (/\b(kg|kilo|granel|laminad)/.test(n)) {
    const f = p.formats.find((x) => x.unit === 'kg' && !norm(x.label).includes('pieza')) ?? p.formats.find((x) => x.unit === 'kg');
    if (f) return { formatId: f.formatId, confidence: 0.8 };
  }
  if (p.formats.length === 1) return { formatId: p.formats[0].formatId, confidence: 0.5 };
  return null;
}

// /variants.json?expand=[product]&limit=50 answered 404 on the real account
// (19-10-2026) while limit=2 worked. Try lighter shapes, then per product.
// Without expand the variant still carries product.id; names come from the
// products list fetched separately.
async function fetchVariants(api: BsaleApi, products: RawProduct[]): Promise<RawVariant[]> {
  const attempts: Array<[Record<string, string>, number]> = [[{ expand: '[product]' }, 50], [{}, 50], [{}, 25], [{}, 10]];
  let lastError: unknown;
  for (const [params, size] of attempts) {
    try {
      const v = await api.getAll<RawVariant>('/variants.json', params, size);
      if (v.length) { logger.info(`[diagnose] variantes con ${JSON.stringify(params)} limit=${size}: ${v.length}`); return v; }
    } catch (e) { lastError = e; logger.warn(`[diagnose] variantes ${JSON.stringify(params)} limit=${size} falló`, (e as Error).message); }
  }
  const out: RawVariant[] = [];
  for (const p of products.filter((x) => x.state !== 1)) {
    try { out.push(...(await api.getAll<RawVariant>(`/products/${p.id}/variants.json`, {}, 25)).map((v) => ({ ...v, product: { ...(v.product ?? { id: p.id }), id: p.id, name: p.name } }))); }
    catch (e) { lastError = e; }
  }
  if (!out.length && lastError) throw lastError;
  return out;
}

export async function runDiagnostic(api: BsaleApi, by: string): Promise<DiagnosticSummary> {
  const t0 = Date.now();
  const db = getFirestore();
  const settings = await loadSettings();
  const warnings: string[] = [];
  const safe = async <T>(label: string, fn: () => Promise<T[]>): Promise<T[]> => {
    try { return await fn(); } catch (e) { warnings.push(`No se pudo leer ${label}: ${(e as Error).message}`); logger.warn(`[diagnose] ${label}`, e); return []; }
  };

  const offices = await safe('sucursales', () => api.getAll<RawOffice>('/offices.json'));
  const docTypes = await safe('tipos de documento', () => api.getAll<RawDocumentType>('/document_types.json'));
  const priceLists = await safe('listas de precio', () => api.getAll<RawPriceList>('/price_lists.json'));
  const productTypes = await safe('tipos de producto', () => api.getAll<RawProductType>('/product_types.json'));
  const products = await safe('productos', () => api.getAll<RawProduct>('/products.json', { expand: '[product_type]' }));
  const variants = await safe('variantes', () => fetchVariants(api, products));
  const users = await safe('usuarios', () => api.getAll<RawUser>('/users.json'));
  const shippingTypes = await safe('tipos de despacho', () => api.getAll<{ id: number; name: string; useDestinationOffice?: number; state?: number }>('/shipping_types.json'));
  const stock = await safe('stock', () => api.getAll<RawStock>('/stocks.json'));
  let clientsCount = 0;
  try { clientsCount = Number((await api.get<{ count?: number }>('/clients.json', { limit: 1, state: 0 })).count ?? 0); } catch (e) { warnings.push(`No se pudo contar clientes: ${(e as Error).message}`); }

  const activePL = priceLists.filter((p) => p.state !== 1);
  // Each office carries its default price list; the factory's is the one for orders.
  const factoryDefaultPL = offices.find((o) => o.id === settings.factoryOfficeId)?.defaultPriceList
    ?? offices.find((o) => /proceso|f[aá]brica|planta|marcosi/i.test(o.name))?.defaultPriceList;
  const priceListId = settings.priceListId ?? (factoryDefaultPL ? Number(factoryDefaultPL) : (activePL[0] ? Number(activePL[0].id) : undefined));
  const prices = priceListId ? await safe('precios', () => api.getAll<RawPriceDetail>(`/price_lists/${priceListId}/details.json`)) : [];
  const priceByVariant = new Map(prices.map((p) => [String(p.variant?.id), p]));

  const nowS = Math.floor(Date.now() / 1000);
  const docs = await safe('documentos 90 días', () => fetchDocumentsInRange(api, nowS - 90 * 86400, nowS));

  // ---- Mirrors
  const productById = new Map(products.map((p) => [String(p.id), p]));
  const typeById = new Map(productTypes.map((t) => [String(t.id), t.name]));
  const now = Date.now();
  const ops: WriteOp[] = [];
  const put = (path: string, data: object) => ops.push({ ref: db.doc(path), data: stripUndefined({ ...data, syncedAt: now }), merge: true });
  offices.forEach((o) => put(`bsale/master/offices/${o.id}`, o));
  docTypes.forEach((d) => put(`bsale/master/documentTypes/${d.id}`, { ...d, kind: docKindFor(settings, d.id, d.codeSii ?? d.code, d.name) }));
  activePL.forEach((p) => put(`bsale/master/priceLists/${p.id}`, p));
  users.forEach((u) => put(`bsale/master/users/${u.id}`, { ...u, name: [u.firstName, u.lastName].filter(Boolean).join(' ') }));
  shippingTypes.forEach((s) => put(`bsale/master/shippingTypes/${s.id}`, s));
  for (const v of variants) {
    const p = productById.get(String(v.product?.id ?? ''));
    const price = priceByVariant.get(String(v.id));
    put(`bsale/catalog/variants/${v.id}`, {
      variantId: String(v.id),
      bsaleProductId: String(v.product?.id ?? ''),
      productName: p?.name ?? v.product?.name ?? '',
      description: v.description ?? '',
      label: [p?.name ?? v.product?.name, v.description].filter(Boolean).join(' · '),
      code: v.code, barCode: v.barCode,
      productType: p?.product_type ? typeById.get(String(p.product_type.id)) ?? p.product_type.name : undefined,
      active: v.state !== 1 && p?.state !== 1,
      stockControl: p?.stockControl !== 0,
      allowDecimal: (p?.allowDecimal ?? v.product?.allowDecimal ?? v.allowDecimal) === 1,
      priceListId,
      priceCLP: price?.variantValueWithTaxes,
      netPriceCLP: price?.variantValue,
    });
  }
  const byVariant = new Map<string, Record<string, { quantity: number; reserved: number; available: number }>>();
  for (const r of stock) {
    const v = String(r.variant?.id ?? ''); if (!v) continue;
    const e = byVariant.get(v) ?? {};
    e[String(r.office?.id)] = { quantity: Number(r.quantity ?? 0), reserved: Number(r.quantityReserved ?? 0), available: Number(r.quantityAvailable ?? r.quantity ?? 0) };
    byVariant.set(v, e);
  }
  byVariant.forEach((offs, v) => put(`bsale/stock/byVariant/${v}`, { variantId: v, offices: offs }));

  // ---- Catalog mapping suggestions (never overwrite a human decision)
  const appProducts: AppProduct[] = (await db.collection('products').get()).docs.map((d) => d.data() as AppProduct);
  const existingMap = new Map((await db.collection('catalogMap').get()).docs.map((d) => [d.id, d.data() as { status: string }]));
  let suggested = 0; let unmatched = 0; let confirmed = 0;
  for (const v of variants) {
    const id = String(v.id);
    const prev = existingMap.get(id);
    if (prev && prev.status !== 'sugerido') { if (prev.status === 'confirmado') confirmed++; continue; }
    const p = productById.get(String(v.product?.id ?? ''));
    const label = [p?.name ?? v.product?.name, v.description].filter(Boolean).join(' ');
    let best: { product: AppProduct; score: number } | null = null;
    for (const ap of appProducts) {
      const score = Math.max(similarity(label, ap.name), ...(ap.aliases ?? []).map((a) => similarity(label, a)));
      if (!best || score > best.score) best = { product: ap, score };
    }
    const fmt = best && best.score >= 0.5 ? guessFormat(best.product, label) : null;
    if (best && fmt) {
      suggested++;
      put(`catalogMap/${id}`, { variantId: id, productId: best.product.id, formatId: fmt.formatId, status: 'sugerido', score: Math.round(best.score * fmt.confidence * 100) / 100, bsaleLabel: label, updatedAt: now, updatedBy: by });
    } else {
      unmatched++;
      put(`catalogMap/${id}`, { variantId: id, status: 'sugerido', score: 0, bsaleLabel: label, updatedAt: now, updatedBy: by });
    }
  }

  // ---- Documents
  const labelById = new Map(variants.map((v) => [String(v.id), [productById.get(String(v.product?.id ?? ''))?.name ?? v.product?.name, v.description].filter(Boolean).join(' · ')]));
  const mirrorDocs = docs.map((d) => documentFromRaw(d, settings, () => undefined, (v) => labelById.get(v) || undefined));
  mirrorDocs.forEach((d) => put(`bsale/sales/documents/${d.id}`, d));
  await writeInChunks(db, ops);

  // ---- Summary
  const active = mirrorDocs.filter((d) => d.state === 0 && d.type !== 'nota_credito' && d.type !== 'guia');
  const countByType = new Map<string, number>();
  mirrorDocs.forEach((d) => countByType.set(d.docTypeId ?? '', (countByType.get(d.docTypeId ?? '') ?? 0) + 1));
  const countByUser = new Map<string, number>();
  mirrorDocs.forEach((d) => d.sellerId && countByUser.set(d.sellerId, (countByUser.get(d.sellerId) ?? 0) + 1));
  const variantLabel = new Map(variants.map((v) => [String(v.id), [productById.get(String(v.product?.id ?? ''))?.name, v.description].filter(Boolean).join(' · ')]));
  const top = new Map<string, { quantity: number; totalCLP: number }>();
  for (const d of active) for (const it of d.details) {
    const t = top.get(it.variantId) ?? { quantity: 0, totalCLP: 0 };
    t.quantity += it.quantity; t.totalCLP += it.totalCLP ?? it.netUnitValue * it.quantity * 1.19;
    top.set(it.variantId, t);
  }
  const stockOffices = new Map<string, number>();
  byVariant.forEach((offs) => Object.entries(offs).forEach(([o, q]) => q.quantity > 0 && stockOffices.set(o, (stockOffices.get(o) ?? 0) + 1)));
  const realOffices = offices.filter((o) => o.state !== 1);
  // Guesses only among physical offices that actually hold stock: a virtual
  // "bodega web" must never be taken for the factory.
  const physical = realOffices.filter((o) => o.isVirtual !== 1 && (stockOffices.get(String(o.id)) ?? 0) > 0);
  const sortedByStock = [...physical].sort((a, b) => (stockOffices.get(String(b.id)) ?? 0) - (stockOffices.get(String(a.id)) ?? 0));
  // Factory first ('MARCOSI (SALA DE PROCESO)' in this account): 'sala' alone
  // must not read as the store.
  const FACTORY_RE = /f[aá]brica|planta|bodega|producci|proceso|matriz|marcosi/i;
  const factoryGuess = physical.find((o) => FACTORY_RE.test(o.name)) ?? sortedByStock[0];
  const storeGuess = physical.find((o) => o.id !== factoryGuess?.id && /tienda|local|mes[oó]n|charcuter/i.test(o.name)) ?? physical.find((o) => o.id !== factoryGuess?.id);

  if (!variants.length) warnings.push('Bsale no devolvió variantes: revisar permisos del token.');
  if (realOffices.length < 2) warnings.push('Hay menos de dos sucursales activas: la tienda podría no estar separada de la fábrica.');
  if (!activePL.length) warnings.push('No hay listas de precio activas.');
  const kgNoDecimal = variants.filter((v) => v.state !== 1 && /\bkg\b|granel|kilo/i.test(v.description ?? '') && (productById.get(String(v.product?.id ?? ''))?.allowDecimal ?? v.product?.allowDecimal) !== 1);
  if (kgNoDecimal.length) warnings.push(`${kgNoDecimal.length} variantes por kg en productos que no permiten decimales: Bsale redondearía los pesos reales.`);

  const summary: DiagnosticSummary = {
    at: now,
    by,
    durationMs: Date.now() - t0,
    apiCalls: api.callCount,
    offices: realOffices.map((o) => ({ id: o.id, name: o.name, isVirtual: o.isVirtual === 1, variantsWithStock: stockOffices.get(String(o.id)) ?? 0 })),
    documentTypes: docTypes.filter((d) => d.state !== 1).map((d) => ({ id: d.id, name: d.name, codeSii: d.codeSii ?? d.code, kind: docKindFor(settings, d.id, d.codeSii ?? d.code, d.name), count90d: countByType.get(String(d.id)) ?? 0 })),
    priceLists: activePL.map((p) => ({ id: Number(p.id), name: p.name })),
    productTypes: productTypes.map((t) => ({ id: t.id, name: t.name, products: products.filter((p) => String(p.product_type?.id) === String(t.id)).length })),
    products: products.length,
    variants: variants.length,
    activeVariants: variants.filter((v) => v.state !== 1).length,
    clients: clientsCount,
    users: users.map((u) => ({ id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(' '), email: u.email, documents90d: countByUser.get(String(u.id)) ?? 0 })),
    documents90d: mirrorDocs.length,
    sales90dCLP: Math.round(active.reduce((s, d) => s + d.totalCLP, 0)),
    topVariants90d: [...top.entries()].sort((a, b) => b[1].totalCLP - a[1].totalCLP).slice(0, 25).map(([v, t]) => ({ variantId: v, label: variantLabel.get(v) ?? v, quantity: Math.round(t.quantity * 100) / 100, totalCLP: Math.round(t.totalCLP) })),
    mapping: { suggested, confirmed, unmatched },
    warnings,
    suggestedSettings: stripUndefined({ factoryOfficeId: factoryGuess?.id, storeOfficeId: storeGuess?.id, priceListId, transferShippingTypeId: shippingTypes.find((t) => t.useDestinationOffice === 1 && t.state !== 1)?.id }) as DiagnosticSummary['suggestedSettings'],
  };
  await db.doc('bsale/meta').set({ diagnostic: summary }, { merge: true });
  // Only fill blanks: never override a choice made in Configuración.
  await patchSettings(stripUndefined({
    factoryOfficeId: settings.factoryOfficeId ?? factoryGuess?.id,
    storeOfficeId: settings.storeOfficeId ?? storeGuess?.id,
    priceListId: settings.priceListId ?? priceListId,
    transferShippingTypeId: settings.transferShippingTypeId ?? shippingTypes.find((t) => t.useDestinationOffice === 1 && t.state !== 1)?.id,
  }));
  return summary;
}
