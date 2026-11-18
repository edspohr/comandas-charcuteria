import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { REGION } from '../common';
import { checkPin } from '../pin';
import { BSALE_TOKEN, apiFromSecret, type BsaleApi, type RawDocument } from './api';
import { requireRole, requireEnabled, loadSettings } from './config';
import { debtInvoices, ownsReceivable, paymentWritesAllowed, validPayment, type ClientDebt } from './receivableModel';

const roles = ['vendedor', 'tienda', 'admin', 'superAdmin'] as const;
const options = { region: REGION, secrets: [BSALE_TOKEN], timeoutSeconds: 180 };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const clean = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const idArg = (id: unknown): string => { if (typeof id !== 'string' || !id || id.includes('/')) throw new HttpsError('invalid-argument', 'Identificador no válido.'); return id; };
async function ensureActive(uid: string, role: string) {
  const user = await getFirestore().doc(`users/${uid}`).get();
  if (!user.exists || user.get('active') === false || user.get('role') !== role || user.get('placeholder') || user.get('mergedInto')) throw new HttpsError('permission-denied', 'Su cuenta no tiene acceso a cobranza.');
}
async function userClient(clientId: unknown, uid: string, role: string) {
  const snap = await getFirestore().doc(`clients/${idArg(clientId)}`).get();
  if (!snap.exists || snap.get('canonicalClientId') || !ownsReceivable(role, uid, snap.get('ownerUid'))) throw new HttpsError('permission-denied', 'Este cliente no pertenece a su cartera.');
  if (!/^\d+$/.test(String(snap.get('bsaleClientId') ?? ''))) throw new HttpsError('failed-precondition', 'Cliente sin vinculación con Bsale.');
  return snap;
}
async function debt(api: BsaleApi, bsaleId: string) {
  const data = await api.get<ClientDebt>('/clients/unpaid_documents.json', { clientid: bsaleId });
  if (String(data.client?.id) !== bsaleId) throw new Error('Bsale no confirmó el cliente consultado.');
  return debtInvoices(data, today());
}

export const bsaleReceivables = onCall(options, async req => {
  const { uid, role } = requireRole(req, [...roles], 'ver cuentas por cobrar');
  await ensureActive(uid, role);
  const settings = await loadSettings(); requireEnabled(settings);
  const db = getFirestore();
  const owner = role === 'superAdmin' ? String(req.data?.ownerUid ?? '') : uid;
  const query = owner ? db.collection('clients').where('ownerUid', '==', owner) : db.collection('clients');
  const snap = await query.select('name', 'fantasyName', 'rut', 'bsaleClientId', 'ownerUid', 'canonicalClientId', 'isInternalShop').get();
  const search = clean(String(req.data?.search ?? '').slice(0, 100));
  const all = snap.docs.filter(d => !d.get('canonicalClientId') && !d.get('isInternalShop') && /^\d+$/.test(String(d.get('bsaleClientId') ?? '')))
    .map(d => ({ id: d.id, name: String(d.get('fantasyName') || d.get('name')), rut: String(d.get('rut') ?? ''), bsaleId: String(d.get('bsaleClientId')), ownerUid: d.get('ownerUid') ?? null }))
    .filter(c => !search || clean(`${c.name} ${c.rut}`).includes(search)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const page = Math.min(Math.max(0, Math.floor(Number(req.data?.page) || 0)), Math.max(0, Math.ceil(all.length / 20) - 1));
  const selected = all.slice(page * 20, (page + 1) * 20);
  const api = apiFromSecret();
  const clients: Array<Record<string, unknown>> = [];
  // Bounded concurrency; a failure is shown as unavailable, never zero debt.
  for (let i = 0; i < selected.length; i += 4) {
    clients.push(...await Promise.all(selected.slice(i, i + 4).map(async c => {
      try { return { ...c, invoices: await debt(api, c.bsaleId), error: null }; }
      catch { return { ...c, invoices: [], error: 'No se pudo consultar el saldo en Bsale.' }; }
    })));
  }
  // Re-check ownership after remote requests, including a reassignment while loading.
  if (role !== 'superAdmin') {
    const current = selected.length ? await db.getAll(...selected.map(c => db.doc(`clients/${c.id}`))) : [];
    const allowed = new Set(current.filter(d => ownsReceivable(role, uid, d.get('ownerUid'))).map(d => d.id));
    for (let i = clients.length - 1; i >= 0; i--) if (!allowed.has(String(clients[i].id))) clients.splice(i, 1);
  }
  return { clients, totalClients: all.length, page, checkedAt: Date.now(), writesEnabled: paymentWritesAllowed(settings) };
});

export const bsaleClientInvoices = onCall(options, async req => {
  const { uid, role } = requireRole(req, [...roles], 'ver facturas de su cartera');
  await ensureActive(uid, role);
  requireEnabled(await loadSettings());
  const client = await userClient(req.data?.clientId, uid, role);
  const api = apiFromSecret();
  const [unpaid, types] = await Promise.all([debt(api, String(client.get('bsaleClientId'))), api.getAll<{ id: number; codeSii: string }>('/document_types.json')]);
  const invoiceTypes = new Set(types.filter(t => ['33', '34'].includes(String(t.codeSii))).map(t => String(t.id)));
  const raws = await api.getAll<RawDocument>('/clients/purchases.json', { clientid: String(client.get('bsaleClientId')) });
  if (raws.some(d => String(d.client?.id) !== String(client.get('bsaleClientId')))) throw new HttpsError('unavailable', 'Bsale no confirmó la cartera consultada.');
  const pending = new Map(unpaid.map(d => [d.id, d]));
  const invoices = raws.filter(d => Number(d.state) === 0 && invoiceTypes.has(String(d.document_type?.id))).map(d => pending.get(String(d.id)) ?? {
    id: String(d.id), number: String(d.number), issued: new Date(d.emissionDate * 1000).toISOString().slice(0, 10), due: null,
    total: Number(d.totalAmount), balance: 0, applied: Number(d.totalAmount), overdue: false,
  }).sort((a, b) => b.issued.localeCompare(a.issued));
  await userClient(req.data?.clientId, uid, role);
  return { invoices, checkedAt: Date.now(), truncated: raws.length >= 20_000 };
});

// Prepared for activation later. All gates are checked on the server before any POST.
export const bsaleRecordPayment = onCall(options, async req => {
  const { uid, role } = requireRole(req, [...roles], 'registrar un pago');
  await ensureActive(uid, role);
  const s = await loadSettings();
  if (!paymentWritesAllowed(s)) throw new HttpsError('failed-precondition', 'El registro de pagos en Bsale está desactivado.');
  const client = await userClient(req.data?.clientId, uid, role);
  const documentId = String(req.data?.documentId ?? '');
  if (!/^\d+$/.test(documentId)) throw new HttpsError('invalid-argument', 'Factura no válida.');
  const api = apiFromSecret();
  const balanceReadStartedAt = Date.now();
  const invoice = (await debt(api, String(client.get('bsaleClientId')))).find(d => d.id === documentId);
  if (!invoice || !validPayment(req.data?.amount, invoice.balance, req.data?.date, today()) || req.data.date < invoice.issued) throw new HttpsError('invalid-argument', 'Revise el monto y la fecha del pago. No puede superar el saldo pendiente.');
  const paymentTypeId = Number(req.data?.paymentTypeId);
  if (![1, 8].includes(paymentTypeId)) throw new HttpsError('invalid-argument', 'Solo efectivo o transferencia bancaria.');
  const type = await api.get<{ state: number; isClientCredit: number; isCheck: number; isCreditNote: number; isCreditMemo: number }>(`/payment_types/${paymentTypeId}.json`);
  if (![1, 8].includes(paymentTypeId) || Number(type.state) !== 0 || [type.isClientCredit, type.isCheck, type.isCreditNote, type.isCreditMemo].some(v => Number(v) === 1)) throw new HttpsError('invalid-argument', 'Solo efectivo o transferencia bancaria.');
  await checkPin(req, 'bsale_pago', documentId);
  const requestId = String(req.data?.requestId ?? '');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw new HttpsError('invalid-argument', 'Falta el identificador de la operación.');
  const db = getFirestore();
  const operation = db.doc(`receivablePaymentOperations/${uid}-${requestId}`);
  const lock = db.doc(`receivablePaymentLocks/${documentId}`);
  await db.runTransaction(async tx => {
    const [previous, busy, current, settings] = await Promise.all([tx.get(operation), tx.get(lock), tx.get(client.ref), tx.get(db.doc('settings/bsale'))]);
    if (!ownsReceivable(role, uid, current.get('ownerUid'))) throw new HttpsError('permission-denied', 'La cartera cambió. Actualice la vista.');
    if (!paymentWritesAllowed(settings.data() ?? {})) throw new HttpsError('failed-precondition', 'El registro de pagos está desactivado.');
    if ((busy.get('completedAt') ?? 0) >= balanceReadStartedAt) throw new HttpsError('aborted', 'El saldo cambió mientras preparaba el pago. Actualice la vista.');
    if (previous.exists || busy.get('pending')) throw new HttpsError('already-exists', 'La operación ya se inició. Revise Bsale antes de registrar otro pago.');
    tx.set(operation, { by: uid, clientId: client.id, documentId, amount: req.data.amount, date: req.data.date, paymentTypeId, status: 'pending', at: Date.now() });
    tx.set(lock, { pending: true, operation: operation.id });
  });
  try {
    // Exactly one attempt: an ambiguous response must never duplicate a payment.
    const response = await api.postOnce<{ id: number }>('/payments.json', { documentId: Number(documentId), amount: req.data.amount, recordDate: Date.parse(`${req.data.date}T12:00:00Z`) / 1000, paymentTypeId });
    const batch = db.batch(); batch.update(operation, { status: 'ok', bsalePaymentId: response.id }); batch.set(lock, { pending: false, completedAt: Date.now() }); await batch.commit();
    return { ok: true, paymentId: response.id };
  } catch {
    await operation.update({ status: 'needs_review' });
    throw new HttpsError('unknown', 'No se pudo confirmar el pago. Revíselo en Bsale antes de repetirlo; la factura quedó bloqueada para evitar duplicados.');
  }
});
