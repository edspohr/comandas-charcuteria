import { customerFromRaw } from './customers';
import { getFirestore, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type { BsaleApi, RawClient, RawDocument, RawStock } from './api';
import { DOC_PREFIX, docKindFor, loadSettings, patchSettings, type BsaleSettings, type DocKind } from './config';
import { dayOf, daysBetween, writeFactDays } from './facts';

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
interface Order { stockSource?: 'fabrica' | 'tienda'; id: string; status: string; requestedDate: string; createdAt: number; lines: OrderLine[]; statusHistory: unknown[] }

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
  const balanceReadStartedAt = Date.now();
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
  // Write only variants whose stock changed: a one-doc fingerprint index
  // (bsale/index.stock) replaces ~500 writes per run with a single read.
  const indexRef = db.doc('bsale/index');
  const index = ((await indexRef.get()).data() ?? {}) as { stock?: Record<string, string>; docs?: Record<string, string> };
  const stockIdx = { ...(index.stock ?? {}) };
  const changedVariants = [...byVariant.entries()].filter(([v, offs]) => {
    const fp = Object.keys(offs).sort().map((o) => `${o}:${offs[o].quantity}/${offs[o].reserved}`).join('|');
    if (stockIdx[v] === fp) return false;
    stockIdx[v] = fp; return true;
  });
  await writeInChunks(db, changedVariants.map(([v, offs]) => ({
    ref: db.doc(`bsale/stock/byVariant/${v}`), data: { variantId: v, offices: offs, syncedAt: now }, merge: true,
  })));
  if (changedVariants.length) await indexRef.set({ stock: stockIdx }, { merge: true });

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

  // Guard against malformed mappings (empty ids, '/' in an id): skip and say
  // which, instead of failing the whole sync.
  const validKey = (k: string) => /^[^/]+__[^/]+$/.test(k) && !k.startsWith('__') && !k.endsWith('__');
  const invalid = [...agg.keys()].filter((k) => !validKey(k));
  if (invalid.length) {
    logger.warn(`[bsale] ${invalid.length} cruces con id inválido omitidos`, { keys: invalid.slice(0, 20), variants: invalid.slice(0, 20).map((k) => agg.get(k)?.variantIds) });
    invalid.forEach((k) => agg.delete(k));
  }
  // A variant with no stock rows means zero, not its previous balance.
  const targetKeys = opts.variantIds ? new Set(opts.variantIds.map(v => map.get(v)).filter(Boolean)) : null;
  for (const [v, k] of map) {
    if (targetKeys && !targetKeys.has(k)) continue;
    if (!validKey(k)) continue;
    const a = agg.get(k) ?? { onHand: 0, storeOnHand: 0, variantIds: [] };
    if (!a.variantIds.includes(v)) a.variantIds.push(v);
    agg.set(k, a);
  }
  const compromised: string[] = [];
  let updated = 0;
  for (const [k, a] of agg) {
    const result = await db.runTransaction(async tx => {
      const ref = db.doc(`stock/${k}`);
      const snap = await tx.get(ref);
      const prev = snap.data() as { onHand?: number; reserved?: number; storeOnHand?: number; storeReserved?: number; balanceReadStartedAt?: number } | undefined;
      // A POS link or a newer webhook may have refreshed this balance while
      // the API pagination was in flight. Never overwrite that newer reading.
      if ((prev?.balanceReadStartedAt ?? 0) > balanceReadStartedAt) return { changed: false, compromised: false };
      const [productId, formatId] = k.split('__');
      const changed = prev?.onHand !== a.onHand || prev?.storeOnHand !== a.storeOnHand;
      tx.set(ref, { productId, formatId, onHand: a.onHand, storeOnHand: a.storeOnHand,
        bsaleVariantId: a.variantIds[0], bsaleVariantIds: a.variantIds, syncedAt: now, balanceReadStartedAt,
        ...(!snap.exists ? { reserved: 0, storeReserved: 0 } : {}) }, { merge: true });
      if (changed) {
        const mv = db.collection('stockMovements').doc();
        tx.set(mv, { id: mv.id, productId, formatId, qty: a.onHand - (prev?.onHand ?? 0), type: 'sync_bsale', by, at: now,
          reason: `Bsale fábrica: ${prev?.onHand ?? 0} → ${a.onHand}; tienda: ${prev?.storeOnHand ?? 0} → ${a.storeOnHand}` });
      }
      return { changed, compromised: !!prev && ((prev.reserved ?? 0) > a.onHand || (prev.storeReserved ?? 0) > a.storeOnHand) };
    });
    if (result.changed) updated++;
    if (result.compromised) compromised.push(k);
  }

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
    for (const source of ['fabrica', 'tienda'] as const) {
      const r = await absorbForKey(db, k, by, source);
      absorbed += r.absorbed;
      promoted.push(...r.promoted);
    }
  }
  return { absorbed, promoted };
}

async function absorbForKey(db: Firestore, k: string, by: string, source: 'fabrica' | 'tienda'): Promise<{ absorbed: number; promoted: string[] }> {
  const [productId, formatId] = k.split('__');
  return db.runTransaction(async (tx) => {
    const stockRef = db.doc(`stock/${k}`);
    const stockSnap = await tx.get(stockRef);
    if (!stockSnap.exists) return { absorbed: 0, promoted: [] };
    const st = stockSnap.data() as { onHand: number; reserved: number; storeOnHand?: number; storeReserved?: number };
    const field = source === 'tienda' ? 'storeReserved' : 'reserved';
    const held = st[field] ?? 0;
    let remaining = Math.max(0, (source === 'tienda' ? st.storeOnHand ?? 0 : st.onHand) - held);
    if (remaining <= 0) return { absorbed: 0, promoted: [] };

    const q = await tx.get(db.collection('orders').where('status', 'in', ['confirmado_parcial', 'recibido']));
    const candidates = q.docs.map((d) => ({ ref: d.ref, order: d.data() as Order }))
      .filter(c => (c.order.stockSource ?? 'fabrica') === source)
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
    tx.update(stockRef, { [field]: held + absorbed });
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
  id: string; name: string; fantasyName?: string | null; rut?: string; giro?: string; address?: string;
  contactPhone?: string; email?: string; deliveryMode: 'retiro' | 'despacho'; invoicingComplete: boolean;
  needsReview?: boolean; bsaleClientId?: string; bsaleSyncedAt?: number; [k: string]: unknown;
}

export { customerFromRaw } from './customers';

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const cleanRut = (r?: string) => (r ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

// Every active Bsale client is searchable, regardless of age or sales history.
export async function syncClients(api: BsaleApi): Promise<{ updated: number; total: number }> {
  const db = getFirestore();
  const all = await api.getAll<RawClient>('/clients.json', { state: 0, expand: '[attributes]' });
  const snap = await db.collection('clients').get();
  const byBsale = new Map<string, AppClient>();
  const byRut = new Map<string, AppClient | null>();
  // Clients that came from the WhatsApp history have no RUT: match by name,
  // only when the name is unique on both sides.
  const byName = new Map<string, AppClient | null>();
  const nameKey = (s?: string | null) => slug(s ?? '');
  snap.forEach((d) => {
    const c = d.data() as AppClient;
    if (c.bsaleClientId) byBsale.set(c.bsaleClientId, c);
    if (c.rut) { const k = cleanRut(c.rut); byRut.set(k, byRut.has(k) ? null : c); }
    if (!c.bsaleClientId && !c.isInternalShop && !c.canonicalClientId) {
      for (const k of new Set([nameKey(c.name), nameKey(c.fantasyName)])) {
        if (!k || k.startsWith('sin-cliente')) continue;
        byName.set(k, byName.has(k) ? null : c);
      }
    }
  });
  const remote = all.map(customerFromRaw);
  const remoteRutCount = new Map<string, number>();
  for (const r of remote) if (r.rut) { const k = cleanRut(r.rut); remoteRutCount.set(k, (remoteRutCount.get(k) ?? 0) + 1); }
  const remoteNameCount = new Map<string, number>();
  for (const r of remote) for (const k of new Set([nameKey(r.name), nameKey(r.fantasyName)])) if (k) remoteNameCount.set(k, (remoteNameCount.get(k) ?? 0) + 1);
  const now = Date.now();
  const writes: WriteOp[] = [];
  const claimedLocals = new Set<string>();
  for (const r of remote) {
    const nameMatch = [nameKey(r.name), nameKey(r.fantasyName)].map((k) => (k && remoteNameCount.get(k) === 1 ? byName.get(k) : undefined)).find(Boolean) ?? undefined;
    const rutMatch = r.rut && remoteRutCount.get(cleanRut(r.rut)) === 1 ? byRut.get(cleanRut(r.rut)) : undefined;
    const safeNameMatch = nameMatch && (!r.rut || !nameMatch.rut || cleanRut(r.rut) === cleanRut(nameMatch.rut)) ? nameMatch : undefined;
    const candidate = byBsale.get(r.id) ?? (rutMatch && !rutMatch.bsaleClientId ? rutMatch : undefined) ?? safeNameMatch;
    const local = candidate && !claimedLocals.has(candidate.id) ? candidate : undefined;
    if (local) claimedLocals.add(local.id);
    const invoicingComplete = !!(r.rut && r.name && r.address && r.giro);
    const merged: AppClient = {
      ...(local ?? {}),
      id: local?.id ?? `${slug(r.fantasyName ?? r.name) || 'cliente'}-${r.id}`,
      name: r.name,
      fantasyName: r.fantasyName ?? (local?.fantasyName && slug(local.fantasyName) !== slug(r.contactName ?? '') ? local.fantasyName : null),
      contactName: r.contactName ?? null,
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
    const same = local && ['name', 'fantasyName', 'contactName', 'rut', 'giro', 'address', 'contactPhone', 'email', 'invoicingComplete', 'bsaleClientId']
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

// Bsale's variant `description` is just the format ("Granel laminado",
// "Sachet 100 gr"); the product name lives on the product. Document lines are
// named from the catalog mirror (bsale/catalog/variants, label = product ·
// format), cached for an hour per instance so each sync doesn't reread it.
let labelCache: { at: number; map: Map<string, string> } | null = null;
export async function variantLabels(db: Firestore): Promise<Map<string, string>> {
  if (labelCache && Date.now() - labelCache.at < 3600_000) return labelCache.map;
  const snap = await db.collection('bsale/catalog/variants').get();
  const map = new Map<string, string>(snap.docs.map((x) => [x.id, String((x.data() as { label?: string }).label ?? '')] as [string, string]).filter(([, l]) => l));
  labelCache = { at: Date.now(), map };
  return map;
}

export function documentFromRaw(d: RawDocument, s: BsaleSettings, skuOf: (variantId: string) => string | undefined, labelOf: (variantId: string) => string | undefined = () => undefined): MirrorDocument {
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
        description: labelOf(v) ?? String(it.variant?.description ?? it.note ?? ''),
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

export const DOC_EXPAND = '[details,client,document_type,sellers,office,references]';

// Documents in an emission-date window. The account has ~47.000 documents:
// if Bsale ever ignored the range filter we would page through years of
// history, so the first page is checked and the call aborts if it's off.
export async function fetchDocumentsInRange(api: BsaleApi, fromS: number, toS: number): Promise<RawDocument[]> {
  const out: RawDocument[] = [];
  for (let offset = 0, page = 0; page < 400; page++, offset += 50) {
    const res = await api.get<{ items?: RawDocument[]; count?: number }>('/documents.json', { emissiondaterange: `[${fromS},${toS}]`, expand: DOC_EXPAND, limit: 50, offset });
    const items = res.items ?? [];
    if (page === 0 && items.some((d) => Number(d.emissionDate) < fromS - 86400 || Number(d.emissionDate) > toS + 86400)) {
      throw new Error('Bsale ignoró el filtro de fecha de documentos; se detuvo la consulta para no recorrer todo el historial.');
    }
    out.push(...items);
    if (items.length < 50 || (res.count != null && out.length >= res.count)) break;
  }
  return out;
}

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
    // Aligned to UTC midnight so every day in the window is complete and the
    // Panel facts (facts.ts) can replace those days wholesale.
    const since = opts.sinceS ?? (settings.documentsSyncedUntil ? settings.documentsSyncedUntil - 86400 : nowS - 30 * 86400);
    const fromDay = dayOf(since);
    const from = Date.parse(`${fromDay}T00:00:00Z`) / 1000;
    raws.push(...await fetchDocumentsInRange(api, from, nowS));
    try { await writeFactDays(raws, settings, daysBetween(fromDay, dayOf(nowS))); } catch (e) { logger.error('[bsale] hechos del panel', e); }
    await patchSettings({ documentsSyncedUntil: nowS });
  }
  const labels = raws.length ? await variantLabels(db) : new Map<string, string>();
  const docs = raws.filter(Boolean).map((r) => documentFromRaw(r, settings, skuOf, (v) => labels.get(v)));
  // Each run re-reads today and yesterday (emissionDate has no time): skip
  // documents whose content didn't change, tracked in bsale/index.docs for
  // the last days only.
  const indexRef = db.doc('bsale/index');
  const docIdx = { ...((((await indexRef.get()).data() ?? {}) as { docs?: Record<string, string> }).docs ?? {}) };
  const fp = (d: MirrorDocument) => `${d.emissionDate}|${d.state}|${d.totalCLP}|${d.details.length}|${d.details.map((x) => x.sku).join(',')}`;
  const changed = docs.filter((d) => { const f = fp(d); if (docIdx[d.id] === f) return false; docIdx[d.id] = f; return true; });
  // merge: conserva linkedOrderId que escribe la app al vincular.
  await writeInChunks(db, changed.map((d) => ({ ref: db.doc(`bsale/sales/documents/${d.id}`), data: stripUndefined(d), merge: true })));
  if (changed.length) {
    const cutoff = new Date(Date.now() - 4 * 86400_000).toISOString().slice(0, 10);
    const pruned = Object.fromEntries(Object.entries(docIdx).filter(([, f]) => f.slice(0, 10) >= cutoff));
    // update() replaces the whole `docs` map (set+merge would only add keys).
    await indexRef.set({}, { merge: true });
    await indexRef.update({ docs: pruned });
  }
  return changed.length;
}

// ---------- Corrida completa ----------

// Health of the integration lives next to the last summary
// (settings/bsaleSync.health): the app shows a banner when it degrades and a
// Cloud Monitoring alert (scripts/setup-alerts.sh) mails on errors.
export interface SyncHealth { lastOkAt?: number; lastErrorAt?: number; lastError?: string; consecutiveFailures: number; partial?: string[] }

async function recordHealth(ok: boolean, error?: string, partial: string[] = []) {
  const ref = getFirestore().doc('settings/bsaleSync');
  const prev = ((await ref.get()).data()?.health ?? { consecutiveFailures: 0 }) as SyncHealth;
  const health: SyncHealth = ok
    ? { ...prev, lastOkAt: Date.now(), consecutiveFailures: 0, partial }
    : { ...prev, lastErrorAt: Date.now(), lastError: (error ?? '').slice(0, 300), consecutiveFailures: (prev.consecutiveFailures ?? 0) + 1 };
  await ref.set({ health: stripUndefined(health) }, { merge: true });
}

export async function fullSync(api: BsaleApi, by: string, opts: { forceClients?: boolean } = {}): Promise<SyncSummary> {
  const settings = await loadSettings();
  const partial: string[] = [];
  let summary: SyncSummary;
  try {
    summary = await syncStock(api, settings, { by });
  } catch (e) {
    await recordHealth(false, `stock: ${(e as Error).message}`);
    throw e;
  }
  try { summary.documentsUpserted = await syncDocuments(api, settings); } catch (e) { logger.error('[bsale] documentos', e); partial.push(`documentos: ${(e as Error).message}`); }
  const hourAgo = Date.now() - 60 * 60 * 1000;
  if (opts.forceClients || !settings.clientsSyncedAt || settings.clientsSyncedAt < hourAgo) {
    try { summary.clientsUpdated = (await syncClients(api)).updated; } catch (e) { logger.error('[bsale] clientes', e); partial.push(`clientes: ${(e as Error).message}`); }
  }
  summary.apiCalls = api.callCount;
  await getFirestore().doc('settings/bsaleSync').set(summary, { merge: true });
  await recordHealth(true, undefined, partial);
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
