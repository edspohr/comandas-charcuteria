import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { REGION } from '../common';
import { checkPin } from '../pin';
import { requireRole, loadSettings } from '../bsale/config';
import { BSALE_TOKEN, apiFromSecret } from '../bsale/api';
import { receiveProduction } from '../bsale/writes';
import { syncStock } from '../bsale/sync';
import { startBatch, closeBatch, cancelBatch, validId, sendBatchProduction } from './service';
const roles = ['produccion', 'admin', 'superAdmin'] as const;
async function userName(uid: string) { return (await getFirestore().doc(`users/${uid}`).get()).get('displayName') ?? uid; }
export const productionStart = onCall({ region: REGION }, async req => {
  const { uid } = requireRole(req, [...roles], 'iniciar una elaboración');
  await checkPin(req, 'iniciar_elaboracion');
  return startBatch(getFirestore(), validId(req.data?.id), String(req.data?.process ?? ''), req.data?.inputs, { uid, name: await userName(uid) }, String(req.data?.note ?? ''));
});
export const productionClose = onCall({ region: REGION }, async req => {
  const { uid } = requireRole(req, [...roles], 'terminar una elaboración');
  await checkPin(req, 'terminar_elaboracion');
  return { entryId: await closeBatch(getFirestore(), validId(req.data?.id), req.data?.outputs, { uid, name: await userName(uid) }) };
});
export const productionCancel = onCall({ region: REGION }, async req => {
  const { uid } = requireRole(req, ['admin', 'superAdmin'], 'anular una elaboración');
  await checkPin(req, 'anular_elaboracion');
  await cancelBatch(getFirestore(), validId(req.data?.id), uid);
  return { ok: true };
});
// Un intento externo por registro. Un resultado incierto exige conciliación
// manual: repetir un POST después de un timeout podría duplicar el stock.
export const productionSendToBsale = onCall({ region: REGION, secrets: [BSALE_TOKEN], timeoutSeconds: 120 }, async req => {
  const { uid } = requireRole(req, [...roles], 'cargar la elaboración en Bsale');
  await checkPin(req, 'bsale_elaboracion');
  const db = getFirestore();
  const entryId = validId(req.data?.entryId);
  const s = await loadSettings();
  if (!s.enabled || !s.writesEnabled || s.dryRun) return { status: 'por_cargar', message: 'Registrado en Comandas. La oficina debe cargarlo en Bsale mientras las escrituras estén apagadas o en simulacro.' };
  const api = apiFromSecret();
  return sendBatchProduction(db, entryId, uid,
    entry => receiveProduction(api, s, uid, entry.lines, `Elaboración ${entry.batchId}`, `EL-${entry.batchId}`),
    () => syncStock(api, s, { by: uid }));
});
export const supplyInitialStock = onCall({ region: REGION }, async req => {
  const { uid } = requireRole(req, ['admin', 'superAdmin'], 'registrar existencias iniciales');
  await checkPin(req, 'inventario_insumos');
  const db = getFirestore();
  const id = validId(req.data?.id); const supplyId = validId(req.data?.supplyId);
  const qty = Number(req.data?.qty); const cost = req.data?.costPerKg;
  if (!Number.isFinite(qty) || qty <= 0 || qty > 1e6 || Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-6 || (cost != null && (!Number.isFinite(cost) || cost < 0))) throw new HttpsError('invalid-argument', 'Revise cantidad y costo neto.');
  const expiry = String(req.data?.expiry ?? '');
  if (expiry && (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(Date.parse(expiry)) || new Date(expiry).toISOString().slice(0, 10) !== expiry)) throw new HttpsError('invalid-argument', 'Fecha de vencimiento inválida.');
  await db.runTransaction(async tx => {
    const ref = db.doc(`supplyLots/${id}`);
    const [prev, supply] = await Promise.all([tx.get(ref), tx.get(db.doc(`supplies/${supplyId}`))]);
    if (prev.exists) { if (prev.get('receivedBy') !== uid) throw new HttpsError('permission-denied', 'Identificador en uso.'); return; }
    if (!supply.exists || !['kg', 'unidad'].includes(supply.get('unit')) || (supply.get('unit') === 'unidad' && !Number.isInteger(qty))) throw new HttpsError('invalid-argument', 'Revise el insumo y su unidad.');
    tx.create(ref, { id, supplyId, supplyName: supply.get('name'), origin: 'inventario', kg: supply.get('unit') === 'kg' ? qty : 0, units: supply.get('unit') === 'unidad' ? qty : 0, boxes: 0, lot: String(req.data?.lot ?? '').slice(0, 100), expiry, ...(cost != null ? { costPerKg: cost } : {}), receivedAt: Date.now(), receivedBy: uid });
  });
  return { ok: true };
});
export const productionMarkManual = onCall({ region: REGION }, async req => {
  const { uid } = requireRole(req, ['admin', 'superAdmin'], 'conciliar producción en Bsale');
  await checkPin(req, 'conciliar_produccion');
  const db = getFirestore(); const ref = db.doc(`productionLog/${validId(req.data?.entryId)}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Carga no encontrada.');
    if (snap.get('bsaleStatus') === 'enviando' && Date.now() - snap.get('bsaleAttemptAt') < 180000) throw new HttpsError('failed-precondition', 'El envío a Bsale sigue en curso. Espere antes de conciliarlo.');
    tx.update(ref, { bsaleStatus: 'cargado_manual', bsaleMarkedBy: uid, bsaleMarkedAt: Date.now() });
  });
  return { ok: true };
});
