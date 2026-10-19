import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { BsaleApi, RawDocument } from './api';
import { DOC_PREFIX, requireFactory, type BsaleSettings, type DocKind } from './config';
import { confirmedMap, documentFromRaw, stripUndefined, syncStock, variantLabels } from './sync';
import { send } from './writes';

// Facturar desde Comandas: el pedido armado (con los pesos reales que
// registró despacho) se emite como factura o boleta en Bsale, y queda
// vinculado en la misma operación. Reemplaza el retipeo en el POS.
//
// Supuestos sobre POST /v1/documents.json (documentación pública; verificar
// con el primer envío en simulacro y la bitácora):
//   documentTypeId, officeId, emissionDate (epoch s), priceListId, declareSii,
//   clientId | client{code, company, activity, address, municipality, city},
//   details[{ variantId, quantity, netUnitValue, comment }], sellerId.

interface OrderLine { productId: string; productName: string; formatId: string; formatLabel: string; unit: string; qty: number; reservedQty: number; packedQty?: number; packedWeightKg?: number; unitPriceSnapshotCLP?: number; subtotalCLP?: number; notes?: string; shortReason?: string }
interface Order { id: string; kind?: string; status: string; createdBy: string; clientId: string; clientSnapshot: { name: string; rut?: string; address?: string }; lines: OrderLine[]; statusHistory: unknown[]; invoiceRef?: string; totalCLP?: number }
interface Client { name: string; fantasyName?: string; rut?: string; giro?: string; address?: string; bsaleClientId?: string; invoicingComplete?: boolean }
interface VariantMirror { variantId: string; label: string; description: string; allowDecimal?: boolean; netPriceCLP?: number; priceCLP?: number }

export interface InvoiceLine { productName: string; formatLabel: string; variantId: string; variantLabel: string; quantity: number; unitLabel: string; netUnitValue: number; netCLP: number; totalCLP: number; priceSource: 'bsale' | 'pedido' }
export interface InvoicePreview {
  orderId: string;
  kind: DocKind;
  documentTypeId?: number;
  documentTypeName?: string;
  client: { name: string; rut?: string; bsaleClientId?: string };
  seller?: { id: number; name: string };
  lines: InvoiceLine[];
  netCLP: number;
  totalCLP: number;
  orderTotalCLP?: number;
  warnings: string[];
  blocking: string[];
  payload: Record<string, unknown>;
}

const isKgVariant = (v: VariantMirror | undefined) => !!v && (v.allowDecimal === true || /\bkg\b|kilo|granel/i.test(`${v.description} ${v.label}`));

export async function buildInvoice(s: BsaleSettings, orderId: string, wanted?: 'factura' | 'boleta'): Promise<InvoicePreview> {
  const db = getFirestore();
  const officeId = requireFactory(s);
  const orderSnap = await db.doc(`orders/${orderId}`).get();
  if (!orderSnap.exists) throw new HttpsError('not-found', 'Pedido no encontrado.');
  const order = orderSnap.data() as Order;
  const client = ((await db.doc(`clients/${order.clientId}`).get()).data() ?? {}) as Client;
  const warnings: string[] = [];
  const blocking: string[] = [];
  if (order.kind === 'reposicion') blocking.push('Es una reposición de tienda: se registra como traslado, no se factura.');
  if (order.status !== 'armado') blocking.push(`El pedido está en "${order.status}": se factura cuando está armado.`);
  if (order.invoiceRef) blocking.push(`Ya tiene el documento ${order.invoiceRef}.`);

  const canInvoice = !!(client.rut && client.giro && client.address && (client.name || order.clientSnapshot.name));
  const kind: DocKind = wanted ?? (canInvoice ? 'factura' : 'boleta');
  if (kind === 'factura' && !canInvoice) blocking.push('Para factura faltan datos del cliente (RUT, giro y dirección). Complételos en la ficha o emita boleta.');

  // Document type id from the mirror (bsale/master/documentTypes, written by the diagnostic).
  const types = (await db.collection('bsale').doc('master').collection('documentTypes').get()).docs.map((d) => d.data() as { id: number; name: string; kind: DocKind; state?: number; isElectronicDocument?: number });
  const type = types.find((t) => t.kind === kind && t.state !== 1 && t.isElectronicDocument === 1) ?? types.find((t) => t.kind === kind && t.state !== 1);
  if (!type) blocking.push(`No encontré el tipo de documento "${kind}" en Bsale. Corra el diagnóstico.`);

  // product/format → variant (first confirmed).
  const map = await confirmedMap(db);
  const reverse = new Map<string, string>();
  for (const [v, k] of map) if (!reverse.has(k)) reverse.set(k, v);
  const variantDocs = await Promise.all([...new Set(order.lines.map((l) => reverse.get(`${l.productId}__${l.formatId}`)).filter(Boolean) as string[])]
    .map((v) => db.doc(`bsale/catalog/variants/${v}`).get()));
  const variants = new Map(variantDocs.filter((d) => d.exists).map((d) => [d.id, d.data() as VariantMirror]));

  const lines: InvoiceLine[] = [];
  for (const l of order.lines) {
    const variantId = reverse.get(`${l.productId}__${l.formatId}`);
    const shipped = l.packedQty ?? l.reservedQty;
    if (!shipped && !l.packedWeightKg) continue; // faltó: no se factura
    if (!variantId) { blocking.push(`${l.productName} · ${l.formatLabel} no tiene cruce con Bsale.`); continue; }
    const v = variants.get(variantId);
    const kg = isKgVariant(v);
    // Kg variants bill the real weight packed; unit variants bill units.
    const quantity = kg ? Math.round(((l.unit === 'kg' ? shipped : (l.packedWeightKg ?? 0)) || 0) * 1000) / 1000 : shipped;
    if (kg && !quantity) { blocking.push(`${l.productName}: falta el peso real empacado para facturar por kilo.`); continue; }
    let net = v?.netPriceCLP;
    let priceSource: InvoiceLine['priceSource'] = 'bsale';
    if (!net) {
      priceSource = 'pedido';
      const gross = l.unitPriceSnapshotCLP ?? (l.subtotalCLP && quantity ? l.subtotalCLP / quantity : 0);
      net = gross ? Math.round(gross / 1.19) : 0;
      warnings.push(`${l.productName}: sin precio en la lista de Bsale, se usa el del pedido.`);
    }
    if (!net) blocking.push(`${l.productName}: sin precio.`);
    const lineNet = Math.round(net * quantity);
    lines.push({ productName: l.productName, formatLabel: l.formatLabel, variantId, variantLabel: v?.label ?? variantId, quantity, unitLabel: kg ? 'kg' : 'u', netUnitValue: Math.round(net), netCLP: lineNet, totalCLP: Math.round(lineNet * 1.19), priceSource });
  }
  if (!lines.length && !blocking.length) blocking.push('No hay líneas empacadas para facturar.');

  // Seller: the Bsale user with the same email (or first name) as the
  // person who took the order.
  const creator = ((await db.doc(`users/${order.createdBy}`).get()).data() ?? {}) as { email?: string; displayName?: string };
  const bsaleUsers = (await db.collection('bsale').doc('master').collection('users').get()).docs.map((d) => d.data() as { id: number; name?: string; email?: string; state?: number });
  const norm = (x?: string) => (x ?? '').trim().toLowerCase();
  const seller = bsaleUsers.find((u) => creator.email && norm(u.email) === norm(creator.email))
    ?? bsaleUsers.find((u) => u.state !== 1 && creator.displayName && norm(u.name).startsWith(norm(creator.displayName).split(' ')[0]) && norm(creator.displayName).length > 2);
  if (!seller) warnings.push('No encontré al vendedor en Bsale: el documento sale sin vendedor asignado.');

  const netCLP = lines.reduce((a, l) => a + l.netCLP, 0);
  const totalCLP = Math.round(netCLP * 1.19);
  if (order.totalCLP && Math.abs(totalCLP - order.totalCLP) / order.totalCLP > 0.1) warnings.push('El total difiere más de 10% del valorizado en el pedido (pesos reales o precios de Bsale).');

  const now = Math.floor(Date.now() / 1000);
  const clientPart = client.bsaleClientId
    ? { clientId: Number(client.bsaleClientId) }
    : kind === 'factura'
      ? { client: stripUndefined({ code: client.rut, company: client.name, activity: client.giro, address: client.address, municipality: 'Santiago', city: 'Santiago', companyOrPerson: 1 }) }
      : {};
  if (!client.bsaleClientId && kind === 'factura') warnings.push('El cliente no está vinculado en Bsale: se creará con estos datos.');
  const payload = stripUndefined({
    documentTypeId: type?.id,
    officeId,
    emissionDate: now,
    expirationDate: now,
    declareSii: 1,
    priceListId: s.priceListId,
    sellerId: seller?.id,
    ...clientPart,
    details: lines.map((l) => ({ variantId: Number(l.variantId), quantity: l.quantity, netUnitValue: l.netUnitValue, comment: `${l.productName} · ${l.formatLabel}` })),
  });

  return {
    orderId, kind, documentTypeId: type?.id, documentTypeName: type?.name,
    client: stripUndefined({ name: client.name ?? order.clientSnapshot.name, rut: client.rut, bsaleClientId: client.bsaleClientId }) as InvoicePreview['client'],
    seller: seller ? { id: seller.id, name: seller.name ?? '' } : undefined,
    lines, netCLP, totalCLP, orderTotalCLP: order.totalCLP, warnings, blocking, payload,
  };
}

// Emit + link. With dryRun the payload goes to the write log and the order
// is left as is.
export async function emitInvoice(api: BsaleApi, s: BsaleSettings, by: string, orderId: string, wanted?: 'factura' | 'boleta') {
  const preview = await buildInvoice(s, orderId, wanted);
  if (preview.blocking.length) throw new HttpsError('failed-precondition', preview.blocking.join(' '));
  const result = await send<RawDocument>(api, s, `emision_${preview.kind}`, by, 'POST', '/v1/documents.json', preview.payload, orderId);
  if (result.dryRun || !result.response) return { dryRun: true, logId: result.logId, preview };

  const raw = result.response;
  const db = getFirestore();
  const map = await confirmedMap(db);
  const labels = await variantLabels(getFirestore());
  const mirror = documentFromRaw({ ...raw, document_type: raw.document_type ?? { id: preview.documentTypeId!, name: preview.documentTypeName } }, s, (v) => map.get(v), (v) => labels.get(v));
  const number = `${DOC_PREFIX[preview.kind]}-${String(raw.number ?? '').padStart(6, '0')}`;

  // Same bookkeeping as vincularDocumento (app): release reservations,
  // facturado, link both ways.
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`orders/${orderId}`);
    const order = (await tx.get(ref)).data() as Order;
    const stockRefs = order.lines.filter((l) => l.reservedQty > 0).map((l) => db.doc(`stock/${l.productId}__${l.formatId}`));
    const stockSnaps = stockRefs.length ? await tx.getAll(...stockRefs) : [];
    const now = Date.now();
    order.lines.filter((l) => l.reservedQty > 0).forEach((l, i) => {
      const snap = stockSnaps[i];
      if (snap?.exists) tx.update(snap.ref, { reserved: Math.max(0, (snap.data()!.reserved ?? 0) - l.reservedQty) });
      const mv = db.collection('stockMovements').doc();
      tx.set(mv, { id: mv.id, productId: l.productId, formatId: l.formatId, qty: l.packedQty ?? l.reservedQty, type: 'venta_bsale', orderId, by, at: now, reason: number });
    });
    tx.set(db.doc(`bsale/sales/documents/${mirror.id}`), { ...stripUndefined(mirror), linkedOrderId: orderId }, { merge: true });
    tx.update(ref, {
      status: 'facturado', invoiceRef: number, bsaleDocumentId: String(raw.id), invoiceUrl: raw.urlPdf ?? FieldValue.delete(), updatedAt: now,
      statusHistory: [...order.statusHistory, { status: 'facturado', by, at: now, note: `${number} · emitido desde Comandas` }],
    });
  });
  try { await syncStock(api, s, { variantIds: preview.lines.map((l) => l.variantId), by }); } catch { /* el cron lo cubre */ }
  return { dryRun: false, logId: result.logId, number, documentId: String(raw.id), urlPdf: raw.urlPdf, preview };
}
