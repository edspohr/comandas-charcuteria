import { getFirestore, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type { BsaleApi, RawClient, RawDocument, RawStock } from './api';
import { DOC_PREFIX, docKindFor, loadSettings, patchSettings, type BsaleSettings, type DocKind } from './config';

// Sincronización Bsale → Firestore. Bsale es el dueño del stock, los
// clientes y los documentos; acá solo se espejan. Lo único propio de la app
// que se toca es la reasignación FIFO de reservas a pedidos parciales, que
// nace del stock nuevo.
//
// Colecciones:
//   catalogMap/{variantId}              cruce variante Bsale ↔ producto/formato app
//   bsale/stock/byVariant/{variantId}   stock crudo por sucursal
//   stock/{productId__formatId}         espejo para la app (onHand = fábrica)
//   clients/{id}                        espejo + campos propios
//   bsale/sales/documents/{id}          documentos emitidos (para vincular y analizar)
//   settings/bsaleSync                  resumen de la última corrida

const SYSTEM = 'bsale-sync';

interface CatalogMapDoc { variantId: string; productId?: string; formatId?: string; status: 'sugerido' | 'confirmado' | 'ignorado' }

interface OrderLine { productId: string; formatId: string; reservedQty: number; pendingProductionQty: number; [k: string]: unknown }
interface Order { id: string; status: string; requestedDate: string; createdAt: number; lines: OrderLine[]; statusHistory: unknown[] }

export interface SyncSummary {
  at: number;
  by: string;
  mode: 'real';
  updated: number;
  promoted: string[];
  absorbed: number;
  compromised: string[];
  unmappedVariantsWithStock: number;
  clientsUpdated?: number;
  documentsUpserted?: number;
  apiCalls?: number;
}

const key = (productId: string, formatId: string) => `${productId}__${formatId}`;

export async function confirmedMap(db: Firestore): Promise<Map<string, string>> {
  const snap = await db.collection('catalogMap').where('status', '==', 'confirmado').get();
  const m = new Map<string, string>();
  snap.forEach((d) => {
    const c = d.data() as CatalogMapDoc;
    if (c.productId && c.formatId) m.set(String(c.variantId), key(c.productId, c.formatId));
  });
  return m;
}

const availableOf = (s: RawStock) => Number(s.quantityAvailable ?? (Number(s.quantity ?? 0) - Number(s.quantityReserved ?? 0)));

// ---------- Stock ----------

export async function syncStock(api: BsaleApi, settings: BsaleSettings, opts: { variantIds?: string[]; by?: string } = {}): Promise<SyncSummary> {
  const db = getFirestore();
  const by = opts.by ?? SYSTEM;
  const factory = settings.factoryOfficeId;
  const store = settings.storeOfficeId;
  const offices = [factory, store].filter((x): x is number => !!x);

  // 1. Crudo por sucursal. Con variantIds (webhook) se consulta solo eso.
  const map = await confirmedMap(db);
  const rows: RawStock[] = [];
  if (opts.variantIds?.length) {
    // A product/format can be backed by several variants: refresh all of
    // them, otherwise the sum below would undercount.
    const keys = new Set(opts.variantIds.map((v) => map.get(String(v))).filter(Boolean));
    const ids = new Set(opts.variantIds.map(String));
    for (const [v, k] of map) if (keys.has(k)) ids.add(v);
    for (const v of ids) rows.push(...await api.getAll<RawStock>('/stocks.json', { variantid: v }));
  } else if (offices.length) {
    for (const o of offices) rows.push(...await api.getAll<RawStock>('/stocks.json', { officeid: o }));
  } else {
    rows.push(...await api.getAll<RawStock>('/stocks.json'));
  }

  const byVariant = new Map<string, Record<string, { quantity: number; reserved: number; available: number }>>();
  for (const r of rows) {
    const v = String(r.variant?.id ?? '');
    if (!v) continue;
    const off = String(r.office?.id ?? '');
    const entry = byVariant.get(v) ?? {};
    entry[off] = { quantity: Number(r.quantity ?? 0), reserved: Number(r.quantityReserved ?? 0), available: availableOf(r) };
    byVariant.set(v, entry);
  }
  const now = Date.now();
  await writeInChunks(db, [...byVariant.entries()].map(([v, offs]) => ({
    ref: db.doc(`bsale/stock/byVariant/${v}`), data: { variantId: v, offices: offs, syncedAt: now }, merge: true,
  })));

  // 2. Espejo de la app para las variantes cruzadas. Varias variantes pueden
  //    apuntar al mismo producto/formato: se suman.
  const agg = new Map<string, { onHand: number; storeOnHand: number; variantIds: string[] }>();
  let unmapped = 0;
  for (const [v, offs] of byVariant) {
    const k = map.get(v);
    const fac = factory ? offs[String(factory)]?.available ?? 0 : Object.values(offs).reduce((s, o) => s + o.available, 0);
    if (!k) { if (fac > 0) unmapped++; continue; }
    const a = agg.get(k) ?? { onHand: 0, storeOnHand: 0, variantIds: [] };
    a.onHand += Math.max(0, fac);
    a.storeOnHand += store ? Math.max(0, offs[String(store)]?.available ?? 0) : 0;
    a.variantIds.push(v);
    agg.set(k, a);
  }

  const stockSnaps = await db.getAll(...[...agg.keys()].map((k) => db.doc(`stock/${k}`)).concat(db.doc('stock/__none__')));
  const prevByKey = new Map(stockSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as { onHand: number; reserved: number }]));
  const writes: WriteOp[] = [];
  const compromised: string[] = [];
  let updated = 0;
  for (const [k, a] of agg) {
    const prev = prevByKey.get(k);
    const [productId, formatId] = k.split('__');
    if (prev && prev.reserved > a.onHand) compromised.push(k);
    if (prev && prev.onHand === a.onHand) {
      writes.push({ ref: db.doc(`stock/${k}`), data: { storeOnHand: a.storeOnHand, bsaleVariantIds: a.variantIds, syncedAt: now }, merge: true });
      continue;
    }
    updated++;
    // merge: nunca pisa `reserved`, que es de la app.
    writes.push({ ref: db.doc(`stock/${k}`), data: { productId, formatId, onHand: a.onHand, storeOnHand: a.storeOnHand, bsaleVariantId: a.variantIds[0], bsaleVariantIds: a.variantIds, syncedAt: now, ...(prev ? {} : { reserved: 0 }) }, merge: true });
    const mv = db.collection('stockMovements').doc();
    writes.push({ ref: mv, data: { id: mv.id, productId, formatId, qty: a.onHand - (prev?.onHand ?? 0), type: 'sync_bsale', by, at: now, reason: `Bsale: ${prev?.onHand ?? 0} → ${a.onHand}` } });
  }
  await writeInChunks(db, writes);

  // 3. Reasignación FIFO donde el stock nuevo alcanza.
  const { absorbed, promoted } = await absorbAllPending(db, by, opts.variantIds ? new Set([...agg.keys()]) : undefined);

  const summary: SyncSummary = { at: now, by, mode: 'real', updated, promoted, absorbed, compromised, unmappedVariantsWithStock: unmapped, apiCalls: api.callCount };
  await db.doc('settings/bsaleSync').set(summary, { merge: true });
  return summary;
}

// FIFO por fecha pedida: cada línea con pendiente toma lo disponible
// (onHand − reserved) y el pedido sin pendientes pasa a confirmado.
export async function absorbAllPending(db: Firestore, by: string, onlyKeys?: Set<string>): Promise<{ absorbed: number; promoted: string[] }> {
  const open = await db.collection('orders').where('status', 'in', ['confirmado_parcial', 'recibido']).get();
  const keys = new Set<string>();
  open.forEach((d) => {
    for (const l of (d.data() as Order).lines) {
      const k = key(l.productId, l.formatId);
      if (l.pendingProductionQty > 0 && (!onlyKeys || onlyKeys.has(k))) keys.add(k);
    }
  });
  let absorbed = 0;
  const promoted: string[] = [];
  for (const k of keys) {
    const r = await absorbForKey(db, k, by);
    absorbed += r.absorbed;
    promoted.push(...r.promoted);
  }
  return { absorbed, promoted };
}

async function absorbForKey(db: Firestore, k: string, by: string): Promise<{ absorbed: number; promoted: string[] }> {
  const [productId, formatId] = k.split('__');
  return db.runTransaction(async (tx) => {
    const stockRef = db.doc(`stock/${k}`);
    const stockSnap = await tx.get(stockRef);
    if (!stockSnap.exists) return { absorbed: 0, promoted: [] };
    const st = stockSnap.data() as { onHand: number; reserved: number };
    let remaining = Math.max(0, st.onHand - st.reserved);
    if (remaining <= 0) return { absorbed: 0, promoted: [] };

    const q = await tx.get(db.collection('orders').where('status', 'in', ['confirmado_parcial', 'recibido']));
    const candidates = q.docs.map((d) => ({ ref: d.ref, order: d.data() as Order }))
      .filter((c) => c.order.lines.some((l) => l.productId === productId && l.formatId === formatId && l.pendingProductionQty > 0))
      .sort((a, b) => a.order.requestedDate.localeCompare(b.order.requestedDate) || a.order.createdAt - b.order.createdAt);

    let absorbed = 0;
    const updates: Array<{ ref: DocumentReference; order: Order; lines: OrderLine[] }> = [];
    for (const c of candidates) {
      if (remaining <= 0) break;
      let moved = 0;
      const lines = c.order.lines.map((l) => {
        if (remaining <= 0 || l.productId !== productId || l.formatId !== formatId || l.pendingProductionQty <= 0) return l;
        const m = Math.min(remaining, l.pendingProductionQty);
        remaining -= m; moved += m;
        return { ...l, reservedQty: l.reservedQty + m, pendingProductionQty: l.pendingProductionQty - m };
      });
      if (moved > 0) { absorbed += moved; updates.push({ ref: c.ref, order: c.order, lines }); }
    }
    if (absorbed === 0) return { absorbed: 0, promoted: [] };

    const now = Date.now();
    tx.update(stockRef, { reserved: st.reserved + absorbed });
    const mv = db.collection('stockMovements').doc();
    tx.set(mv, { id: mv.id, productId, formatId, qty: absorbed, type: 'reserva', by, at: now, reason: 'Reasignación FIFO tras sync Bsale' });
    const promoted: string[] = [];
    for (const u of updates) {
      const stillPending = u.lines.some((l) => l.pendingProductionQty > 0);
      const patch: Record<string, unknown> = { lines: u.lines, updatedAt: now };
      if (!stillPending && u.order.status !== 'confirmado') {
        patch.status = 'confirmado';
        patch.statusHistory = [...u.order.statusHistory, { status: 'confirmado', by, at: now, note: 'Stock recibido desde Bsale' }];
        promoted.push(u.order.id);
      }
      tx.update(u.ref, patch);
    }
    return { absorbed, promoted };
  });
}

// ---------- Clientes ----------

interface AppClient {
  id: string; name: string; fantasyName?: string; rut?: string; giro?: string; address?: string;
  contactPhone?: string; email?: string; deliveryMode: 'retiro' | 'despacho'; invoicingComplete: boolean;
  needsReview?: boolean; bsaleClientId?: string; bsaleSyncedAt?: number; [k: string]: unknown;
}

export function customerFromRaw(c: RawClient) {
  const person = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  const address = [c.address, c.municipality, c.city].filter(Boolean).join(', ');
  return {
    id: String(c.id),
    rut: c.code || undefined,
    name: (c.company || person || `Cliente ${c.id}`).trim(),
    fantasyName: c.company && person && person !== c.company ? person : undefined,
    giro: c.activity || undefined,
    address: address || undefined,
    phone: c.phone || undefined,
    email: c.email || undefined,
  };
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const cleanRut = (r?: string) => (r ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

export async function syncClients(api: BsaleApi): Promise<{ updated: number; total: number }> {
  const db = getFirestore();
  const remote = (await api.getAll<RawClient>('/clients.json', { state: 0 })).map(customerFromRaw);
  const snap = await db.collection('clients').get();
  const byBsale = new Map<string, AppClient>();
  const byRut = new Map<string, AppClient>();
  snap.forEach((d) => {
    const c = d.data() as AppClient;
    if (c.bsaleClientId) byBsale.set(c.bsaleClientId, c);
    if (c.rut) byRut.set(cleanRut(c.rut), c);
  });
  const now = Date.now();
  const writes: WriteOp[] = [];
  for (const r of remote) {
    const local = byBsale.get(r.id) ?? (r.rut ? byRut.get(cleanRut(r.rut)) : undefined);
    const invoicingComplete = !!(r.rut && r.name && r.address && r.giro);
    const merged: AppClient = {
      ...(local ?? {}),
      id: local?.id ?? `${slug(r.fantasyName ?? r.name) || 'cliente'}-${r.id}`,
      name: r.name,
      fantasyName: r.fantasyName ?? local?.fantasyName,
      rut: r.rut ?? local?.rut,
      giro: r.giro ?? local?.giro,
      address: r.address ?? local?.address,
      contactPhone: r.phone ?? local?.contactPhone,
      email: r.email ?? local?.email,
      deliveryMode: local?.deliveryMode ?? 'despacho',
      invoicingComplete,
      needsReview: !!local?.needsReview && !invoicingComplete,
      source: (local?.source as string | undefined) ?? 'bsale',
      bsaleClientId: r.id,
      bsaleSyncedAt: now,
    };
    const same = local && ['name', 'fantasyName', 'rut', 'giro', 'address', 'contactPhone', 'email', 'invoicingComplete', 'bsaleClientId']
      .every((f) => (local as Record<string, unknown>)[f] === (merged as Record<string, unknown>)[f]);
    if (same) continue;
    writes.push({ ref: db.doc(`clients/${merged.id}`), data: stripUndefined(merged), merge: true });
  }
  await writeInChunks(db, writes);
  await patchSettings({ clientsSyncedAt: now });
  return { updated: writes.length, total: remote.length };
}

// ---------- Documentos ----------

export interface MirrorDocument {
  id: string; type: DocKind; number: string; rawNumber: string; docTypeId?: string; docTypeName?: string;
  officeId: number; officeName?: string; emissionDate: string; emittedAt: number;
  clientRut?: string; clientName: string; bsaleClientId?: string;
  sellerId?: string; sellerName?: string;
  totalCLP: number; netCLP?: number;
  details: Array<{ variantId: string; sku: string; description: string; quantity: number; netUnitValue: number; totalCLP?: number }>;
  reference?: string; state: number; urlPdf?: string; syncedAt: number;
}

export function documentFromRaw(d: RawDocument, s: BsaleSettings, skuOf: (variantId: string) => string | undefined): MirrorDocument {
  const kind = docKindFor(s, d.document_type?.id, d.document_type?.codeSii, d.document_type?.name);
  const seller = d.sellers?.items?.[0] ?? d.user;
  const emitted = Number(d.emissionDate) * 1000;
  return {
    id: String(d.id),
    type: kind,
    number: `${DOC_PREFIX[kind]}-${String(d.number).padStart(6, '0')}`,
    rawNumber: String(d.number),
    docTypeId: d.document_type?.id != null ? String(d.document_type.id) : undefined,
    docTypeName: d.document_type?.name,
    officeId: Number(d.office?.id ?? 0),
    officeName: d.office?.name,
    emissionDate: new Date(emitted).toISOString().slice(0, 10),
    emittedAt: emitted,
    clientRut: d.client?.code || undefined,
    clientName: (d.client?.company || [d.client?.firstName, d.client?.lastName].filter(Boolean).join(' ') || 'Sin cliente').trim(),
    bsaleClientId: d.client?.id != null ? String(d.client.id) : undefined,
    sellerId: seller?.id != null ? String(seller.id) : undefined,
    sellerName: seller ? [seller.firstName, seller.lastName].filter(Boolean).join(' ') || undefined : undefined,
    totalCLP: Number(d.totalAmount ?? 0),
    netCLP: d.netAmount != null ? Number(d.netAmount) : undefined,
    details: (d.details?.items ?? []).map((it) => {
      const v = String(it.variant?.id ?? '');
      return {
        variantId: v,
        sku: skuOf(v) ?? '',
        description: String(it.variant?.description ?? it.note ?? ''),
        quantity: Number(it.quantity ?? 0),
        netUnitValue: Number(it.netUnitValue ?? 0),
        totalCLP: it.totalAmount != null ? Number(it.totalAmount) : undefined,
      };
    }),
    reference: d.references?.items?.map((r) => r.number).filter(Boolean).join(' ') || undefined,
    state: Number(d.state ?? 0),
    urlPdf: d.urlPdf,
    syncedAt: Date.now(),
  };
}

const DOC_EXPAND = '[details,client,document_type,sellers,office,references]';

export async function syncDocuments(api: BsaleApi, settings: BsaleSettings, opts: { sinceS?: number; ids?: string[] } = {}): Promise<number> {
  const db = getFirestore();
  const map = await confirmedMap(db);
  const skuOf = (v: string) => map.get(v);
  const raws: RawDocument[] = [];
  if (opts.ids?.length) {
    for (const id of opts.ids) raws.push(await api.get<RawDocument>(`/documents/${id}.json`, { expand: DOC_EXPAND }));
  } else {
    const nowS = Math.floor(Date.now() / 1000);
    // Desde la última corrida menos un día de margen (documentos con fecha
    // de emisión anterior a su generación); la primera vez, 30 días.
    const from = opts.sinceS ?? (settings.documentsSyncedUntil ? settings.documentsSyncedUntil - 86400 : nowS - 30 * 86400);
    raws.push(...await api.getAll<RawDocument>('/documents.json', { emissiondaterange: `[${from},${nowS}]`, expand: DOC_EXPAND }));
    await patchSettings({ documentsSyncedUntil: nowS });
  }
  const docs = raws.filter(Boolean).map((r) => documentFromRaw(r, settings, skuOf));
  // merge: conserva linkedOrderId que escribe la app al vincular.
  await writeInChunks(db, docs.map((d) => ({ ref: db.doc(`bsale/sales/documents/${d.id}`), data: stripUndefined(d), merge: true })));
  return docs.length;
}

// ---------- Corrida completa ----------

export async function fullSync(api: BsaleApi, by: string, opts: { forceClients?: boolean } = {}): Promise<SyncSummary> {
  const settings = await loadSettings();
  const summary = await syncStock(api, settings, { by });
  try { summary.documentsUpserted = await syncDocuments(api, settings); } catch (e) { logger.error('[bsale] documentos', e); }
  const hourAgo = Date.now() - 60 * 60 * 1000;
  if (opts.forceClients || !settings.clientsSyncedAt || settings.clientsSyncedAt < hourAgo) {
    try { summary.clientsUpdated = (await syncClients(api)).updated; } catch (e) { logger.error('[bsale] clientes', e); }
  }
  summary.apiCalls = api.callCount;
  await getFirestore().doc('settings/bsaleSync').set(summary, { merge: true });
  return summary;
}

// ---------- utilidades ----------

export interface WriteOp { ref: DocumentReference; data: Record<string, unknown>; merge?: boolean }

export async function writeInChunks(db: Firestore, ops: WriteOp[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + 400)) batch.set(op.ref, op.data, { merge: !!op.merge });
    await batch.commit();
  }
}

export function stripUndefined<T extends object>(o: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}
