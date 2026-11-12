import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { BsaleApi, RawDocument, RawStock } from './api';
import type { BsaleSettings } from './config';
import { confirmedMap, documentFromRaw, stripUndefined, variantLabels } from './sync';

interface Line { productId: string; formatId: string; reservedQty: number; packedQty?: number; sample?: boolean }
interface Order { id: string; status: string; stockSource?: 'fabrica' | 'tienda'; invoiceRef?: string; clientSnapshot: { rut?: string }; lines: Line[]; statusHistory: unknown[] }
const normRut = (r: string) => r.replace(/[^0-9kK]/g, '').toUpperCase();
export function validateDocument(order: Order, d: { number: string; officeId: number; state: number; type: string; clientRut?: string }, s: BsaleSettings, wanted: string) {
  if (d.number !== wanted || d.state !== 0 || !['factura', 'boleta'].includes(d.type)) throw new HttpsError('failed-precondition', 'El documento no es una factura o boleta vigente de Bsale.');
  const office = order.stockSource === 'tienda' ? s.storeOfficeId : s.factoryOfficeId;
  if (!office || d.officeId !== office) throw new HttpsError('failed-precondition', 'La sucursal de la factura debe coincidir con el origen del stock del pedido.');
  if (order.clientSnapshot.rut && d.clientRut && normRut(order.clientSnapshot.rut) !== normRut(d.clientRut)) throw new HttpsError('failed-precondition', 'El RUT del documento no coincide con el cliente del pedido.');
}

// GET only in Bsale. The fresh balances and reservation release are committed
// together: linking cannot temporarily put already invoiced goods back on sale.
export async function linkPosDocument(api: BsaleApi, s: BsaleSettings, orderId: string, documentId: string, number: string, by: string, allowLate: boolean) {
  const db = getFirestore();
  const ref = db.doc(`orders/${orderId}`);
  const initial = (await ref.get()).data() as Order | undefined;
  if (!initial) throw new HttpsError('not-found', 'Pedido no encontrado.');
  if (documentId.startsWith('manual-')) {
    const found = await db.collection('bsale/sales/documents').where('number', '==', number).limit(2).get();
    if (found.size !== 1) throw new HttpsError('failed-precondition', 'El documento aún no aparece en Bsale. Sincronice y selecciónelo de la lista.');
    documentId = found.docs[0].id;
  }
  if (!/^\d+$/.test(documentId)) throw new HttpsError('invalid-argument', 'Id de documento Bsale inválido.');
  const raw = await api.get<RawDocument>(`/documents/${documentId}.json`, { expand: '[client,document_type,details]' });
  const map = await confirmedMap(db);
  const labels = await variantLabels(db);
  const mirror = documentFromRaw(raw, s, v => map.get(v), v => labels.get(v));
  validateDocument(initial, mirror, s, number);
  const balanceReadStartedAt = Date.now();
  const keys = new Set(initial.lines.map(l => `${l.productId}__${l.formatId}`));
  const balances = new Map([...keys].map(k => [k, { onHand: 0, storeOnHand: 0 }]));
  for (const [v, k] of map) {
    if (!keys.has(k)) continue;
    const rows = await api.getAll<RawStock>('/stocks.json', { variantid: v });
    const a = balances.get(k)!;
    for (const row of rows) {
      const available = Math.max(0, Number(row.quantityAvailable ?? (row.quantity - (row.quantityReserved ?? 0))));
      if (Number(row.office.id) === s.factoryOfficeId) a.onHand += available;
      if (Number(row.office.id) === s.storeOfficeId) a.storeOnHand += available;
    }
  }
  const docRef = db.doc(`bsale/sales/documents/${documentId}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const order = snap.data() as Order;
    const locked = await tx.get(docRef);
    if (order.invoiceRef) throw new HttpsError('already-exists', `El pedido ya tiene ${order.invoiceRef}.`);
    const late = ['despachado', 'entregado'].includes(order.status);
    if (order.status !== 'armado' && !(late && allowLate)) throw new HttpsError('failed-precondition', 'El pedido debe estar armado para vincular el documento.');
    if ((order.stockSource ?? 'fabrica') !== (initial.stockSource ?? 'fabrica') || JSON.stringify(order.lines) !== JSON.stringify(initial.lines)) throw new HttpsError('aborted', 'El pedido cambió. Vuelva a revisarlo.');
    validateDocument(order, mirror, s, number);
    if (locked.get('linkedOrderId')) throw new HttpsError('already-exists', 'Ese documento ya está vinculado a otro pedido.');
    const stocks = keys.size ? await tx.getAll(...[...keys].map(k => db.doc(`stock/${k}`))) : [];
    const field = order.stockSource === 'tienda' ? 'storeReserved' : 'reserved';
    const now = Date.now();
    for (const stock of stocks) {
      if (!stock.exists) continue;
      if ((stock.get('balanceReadStartedAt') ?? 0) > balanceReadStartedAt) throw new HttpsError('aborted', 'Llegó una lectura más reciente de stock. Vuelva a vincular.');
      const held = order.lines.filter(l => `${l.productId}__${l.formatId}` === stock.id).reduce((a, l) => a + l.reservedQty, 0);
      tx.update(stock.ref, { ...balances.get(stock.id), [field]: Math.max(0, (stock.get(field) ?? 0) - held), syncedAt: now, balanceReadStartedAt });
    }
    tx.set(docRef, { ...stripUndefined(mirror), linkedOrderId: orderId }, { merge: true });
    tx.update(ref, {
      status: late ? order.status : 'facturado', invoiceRef: number, bsaleDocumentId: documentId, updatedAt: now,
      lines: order.lines.map(l => ({ ...l, reservedQty: 0 })),
      statusHistory: [...order.statusHistory, { status: late ? order.status : 'facturado', by, at: now, note: number }],
    });
    for (const l of order.lines.filter(l => l.reservedQty > 0)) {
      const mv = db.collection('stockMovements').doc();
      tx.set(mv, { id: mv.id, productId: l.productId, formatId: l.formatId, qty: l.reservedQty, type: 'venta_bsale', orderId, by, at: now, reason: number, stockSource: order.stockSource ?? 'fabrica' });
    }
  });
  return { linked: true };
}
