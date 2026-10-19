import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { REGION } from '../common';
import { BSALE_TOKEN, apiFromSecret, type RawClient, type RawDocument } from './api';
import { loadSettings, requireEnabled, requireRole } from './config';
import { runDiagnostic } from './diagnose';
import { customerFromRaw, fullSync, stripUndefined, syncDocuments, syncStock } from './sync';
import { createClient, receiveProduction, transferToStore, updateClient, type CustomerInput, type QtyLine } from './writes';
import { buildInvoice, emitInvoice } from './invoice';

const secrets = [BSALE_TOKEN];
const SYNC_ROLES = ['despacho', 'produccion', 'admin', 'superAdmin'] as const;

// ---------- Lectura ----------

export const bsaleDiagnose = onCall({ region: REGION, secrets, timeoutSeconds: 540, memory: '1GiB' }, async (req) => {
  const { uid } = requireRole(req, ['superAdmin', 'admin', 'consultor'], 'correr el diagnóstico de Bsale');
  return { summary: await runDiagnostic(apiFromSecret(), uid) };
});

export const bsaleSyncNow = onCall({ region: REGION, secrets, timeoutSeconds: 300, memory: '512MiB' }, async (req) => {
  const { uid } = requireRole(req, [...SYNC_ROLES], 'sincronizar con Bsale');
  requireEnabled(await loadSettings());
  return { summary: await fullSync(apiFromSecret(), uid, { forceClients: req.data?.clients === true }) };
});

// Respaldo de los webhooks: cada 10 minutos en horario de operación.
export const bsaleScheduledSync = onSchedule({ region: REGION, secrets, schedule: 'every 10 minutes from 06:00 to 23:00', timeZone: 'America/Santiago', timeoutSeconds: 300, memory: '512MiB' }, async () => {
  const s = await loadSettings();
  if (!s.enabled) return;
  const summary = await fullSync(apiFromSecret(), 'bsale-cron');
  logger.info('[bsale] cron', { updated: summary.updated, promoted: summary.promoted.length, docs: summary.documentsUpserted, calls: summary.apiCalls });
});

// ---------- Webhook ----------
// Bsale avisa { cpnId, resource, resourceId, topic, action, officeId, send }.
// No firma las notificaciones: la URL lleva una clave aleatoria (?key=) que
// solo ve un superAdmin. Se responde 200 rápido y se refresca lo puntual.

async function webhookKey(create: boolean): Promise<string | null> {
  const ref = getFirestore().doc('bsaleSecrets/webhook');
  const snap = await ref.get();
  if (snap.exists) return (snap.data() as { key: string }).key;
  if (!create) return null;
  const key = randomBytes(24).toString('base64url');
  await ref.set({ key, createdAt: Date.now() });
  return key;
}

export const bsaleWebhookInfo = onCall({ region: REGION }, async (req) => {
  requireRole(req, ['superAdmin'], 'ver la URL del webhook');
  const key = await webhookKey(true);
  const project = process.env.GCLOUD_PROJECT ?? 'comandas-charcuteria';
  return { url: `https://${REGION}-${project}.cloudfunctions.net/bsaleWebhook?key=${key}`, topics: ['document', 'stock', 'client', 'variant', 'product', 'price'] };
});

export const bsaleWebhook = onRequest({ region: REGION, secrets, timeoutSeconds: 120 }, async (req, res) => {
  const expected = await webhookKey(false);
  const got = String(req.query.key ?? '');
  if (!expected || got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    res.status(403).send('forbidden'); return;
  }
  if (req.method !== 'POST') { res.status(200).send('ok'); return; }
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) as { topic?: string; resource?: string; resourceId?: string | number; action?: string };
  const db = getFirestore();
  const logRef = db.collection('bsale').doc('webhooks').collection('log').doc();
  await logRef.set(stripUndefined({ id: logRef.id, at: Date.now(), topic: body.topic, action: body.action, resource: body.resource, resourceId: body.resourceId != null ? String(body.resourceId) : undefined }));

  try {
    const s = await loadSettings();
    if (!s.enabled) { res.status(200).send('disabled'); return; }
    const api = apiFromSecret();
    const topic = (body.topic ?? '').toLowerCase();
    const id = String(body.resourceId ?? '');
    if (topic === 'document' && id) {
      await syncDocuments(api, s, { ids: [id] });
      const d = await api.get<RawDocument>(`/documents/${id}.json`, { expand: '[details]' });
      const variants = (d.details?.items ?? []).map((it) => String(it.variant?.id ?? '')).filter(Boolean);
      if (variants.length) await syncStock(api, s, { variantIds: variants, by: 'bsale-webhook' });
    } else if (topic === 'stock') {
      const variant = body.resource?.match(/variant(?:id)?=(\d+)/)?.[1] ?? id;
      if (variant) await syncStock(api, s, { variantIds: [variant], by: 'bsale-webhook' });
    } else if (topic === 'client' && id) {
      const c = customerFromRaw(await api.get<RawClient>(`/clients/${id}.json`));
      const existing = await db.collection('clients').where('bsaleClientId', '==', c.id).limit(1).get();
      if (!existing.empty) {
        await existing.docs[0].ref.set(stripUndefined({ name: c.name, rut: c.rut, giro: c.giro, address: c.address, contactPhone: c.phone, email: c.email, invoicingComplete: !!(c.rut && c.name && c.address && c.giro), bsaleSyncedAt: Date.now() }), { merge: true });
      }
      // Clientes nuevos entran en la próxima corrida completa.
    }
    // variant / product / price: el catálogo se revisa con el diagnóstico.
    await logRef.update({ status: 'ok' });
    res.status(200).send('ok');
  } catch (e) {
    logger.error('[bsale] webhook', e);
    await logRef.update({ status: 'error', error: (e as Error).message });
    // 200 igual: el cron de 10 min cubre lo que falte y Bsale no reintenta en loop.
    res.status(200).send('error');
  }
});

// ---------- Escritura ----------

function parseLines(raw: unknown): QtyLine[] {
  if (!Array.isArray(raw)) throw new HttpsError('invalid-argument', 'Faltan las líneas.');
  return raw.map((l) => ({ productId: String(l?.productId ?? ''), formatId: String(l?.formatId ?? ''), qty: Number(l?.qty ?? 0) }))
    .filter((l) => l.productId && l.formatId && Number.isFinite(l.qty) && l.qty > 0);
}

export const bsaleReceiveProduction = onCall({ region: REGION, secrets, timeoutSeconds: 120 }, async (req) => {
  const { uid } = requireRole(req, ['produccion', 'admin', 'superAdmin'], 'registrar producción');
  const s = await loadSettings();
  requireEnabled(s);
  const api = apiFromSecret();
  const result = await receiveProduction(api, s, uid, parseLines(req.data?.lines), typeof req.data?.note === 'string' ? req.data.note.slice(0, 200) : undefined);
  const summary = result.dryRun ? null : await syncStock(api, s, { by: uid });
  return { ...result, summary };
});

export const bsaleTransferToStore = onCall({ region: REGION, secrets, timeoutSeconds: 120 }, async (req) => {
  const { uid } = requireRole(req, ['despacho', 'admin', 'superAdmin'], 'registrar traslados');
  const s = await loadSettings();
  requireEnabled(s);
  const orderId = String(req.data?.orderId ?? '');
  if (!orderId) throw new HttpsError('invalid-argument', 'Falta el pedido.');
  return transferToStore(apiFromSecret(), s, uid, orderId, parseLines(req.data?.lines));
});

function parseCustomer(raw: unknown, partial: boolean): Partial<CustomerInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' && (r[k] as string).trim() ? (r[k] as string).trim().slice(0, 200) : undefined);
  const out = { name: str('name'), fantasyName: str('fantasyName'), rut: str('rut'), giro: str('giro'), address: str('address'), city: str('city'), phone: str('phone'), email: str('email') };
  if (!partial && !out.name) throw new HttpsError('invalid-argument', 'Falta el nombre del cliente.');
  return out;
}

export const bsaleCreateClient = onCall({ region: REGION, secrets }, async (req) => {
  const { uid } = requireRole(req, ['vendedor', 'tienda', 'admin', 'superAdmin'], 'crear clientes');
  const s = await loadSettings();
  // Selling must not stop because Bsale is off: the client stays in the app,
  // pending review, and administración creates it in Bsale later.
  if (!s.enabled || !s.writesEnabled) return { dryRun: true, customer: null, pending: true };
  return createClient(apiFromSecret(), s, uid, parseCustomer(req.data, false) as CustomerInput);
});

export const bsaleUpdateClient = onCall({ region: REGION, secrets }, async (req) => {
  const { uid } = requireRole(req, ['admin', 'superAdmin'], 'editar clientes');
  const s = await loadSettings();
  requireEnabled(s);
  const id = String(req.data?.bsaleClientId ?? '');
  if (!id) throw new HttpsError('invalid-argument', 'Falta el id de Bsale.');
  return updateClient(apiFromSecret(), s, uid, id, parseCustomer(req.data?.patch, true));
});

// ---------- Facturación desde Comandas ----------

const INVOICE_ROLES = ['admin', 'superAdmin'] as const;
const kindArg = (x: unknown) => (x === 'factura' || x === 'boleta' ? x : undefined);

export const bsaleInvoicePreview = onCall({ region: REGION }, async (req) => {
  requireRole(req, [...INVOICE_ROLES], 'facturar');
  const s = await loadSettings();
  const orderId = String(req.data?.orderId ?? '');
  if (!orderId) throw new HttpsError('invalid-argument', 'Falta el pedido.');
  return { preview: await buildInvoice(s, orderId, kindArg(req.data?.kind)), writesEnabled: s.writesEnabled, dryRun: s.dryRun };
});

export const bsaleEmitInvoice = onCall({ region: REGION, secrets, timeoutSeconds: 120 }, async (req) => {
  const { uid } = requireRole(req, [...INVOICE_ROLES], 'facturar');
  const s = await loadSettings();
  requireEnabled(s);
  const orderId = String(req.data?.orderId ?? '');
  if (!orderId) throw new HttpsError('invalid-argument', 'Falta el pedido.');
  return emitInvoice(apiFromSecret(), s, uid, orderId, kindArg(req.data?.kind));
});
