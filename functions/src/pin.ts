import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { REGION } from './common';

// PIN personal (4–6 dígitos) que asigna un superAdmin. Lo piden las acciones
// que escriben en Bsale (verificado acá, en el servidor) y las acciones
// importantes de la app (verifyPin antes de hacerlas). Cada uso queda en
// pinLog: la persona responde por lo que se hace con su cuenta y su PIN.
//
//   userPins/{uid}  { hash, salt, setAt, setBy, failed, lockedUntil }   solo servidor
//   pinLog/{id}     { uid, action, ref, ok, at }                         auditoría
//   users/{uid}.hasPin                                                   para la app

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;
const PIN_RE = /^\d{4,6}$/;

const hashPin = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('base64');

function requireSuperAdmin(req: CallableRequest): string {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.');
  if (req.auth.token.role !== 'superAdmin') throw new HttpsError('permission-denied', 'Solo super administración asigna PIN.');
  return req.auth.uid;
}

export function validatePin(pin: string) {
  if (!PIN_RE.test(pin)) throw new HttpsError('invalid-argument', 'El PIN debe tener entre 4 y 6 dígitos.');
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw new HttpsError('invalid-argument', 'Elija un PIN menos obvio (no repetido ni correlativo).');
}

export function pinRecord(pin: string, by: string) {
  const salt = randomBytes(16).toString('base64');
  return { hash: hashPin(pin, salt), salt, setAt: Date.now(), setBy: by, failed: 0, lockedUntil: 0 };
}

// Stores an already-built record (from pinRecord) for a user that exists.
export async function storePin(uid: string, record: ReturnType<typeof pinRecord>) {
  const db = getFirestore();
  await db.doc(`userPins/${uid}`).set(record);
  await db.doc(`users/${uid}`).set({ hasPin: true, pinSetAt: record.setAt }, { merge: true });
  await db.collection('pinLog').add({ uid, action: 'pin_asignado', by: record.setBy, ok: true, at: Date.now() });
}

export const adminSetPin = onCall({ region: REGION }, async (req) => {
  const by = requireSuperAdmin(req);
  const uid = String(req.data?.uid ?? '');
  const pin = String(req.data?.pin ?? '');
  if (!uid) throw new HttpsError('invalid-argument', 'Falta el usuario.');
  validatePin(pin);
  if (!(await getFirestore().doc(`users/${uid}`).get()).exists) throw new HttpsError('not-found', 'Usuario no encontrado.');
  await storePin(uid, pinRecord(pin, by));
  return { ok: true };
});

// Verifies the caller's PIN. Throws a failed-precondition with details
// { pin: 'required' | 'invalid' | 'locked' | 'unset' } so the app can ask
// again. Every attempt is logged.
export async function checkPin(req: CallableRequest, action: string, ref?: string): Promise<void> {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.');
  const uid = req.auth.uid;
  const pin = typeof req.data?.pin === 'string' ? req.data.pin : '';
  const db = getFirestore();
  const ref_ = db.doc(`userPins/${uid}`);
  const snap = await ref_.get();
  const log = (ok: boolean, reason?: string) => db.collection('pinLog').add({ uid, action, ref: ref ?? null, ok, reason: reason ?? null, at: Date.now() });
  if (!snap.exists) throw new HttpsError('failed-precondition', 'No tiene PIN asignado. Pídale a super administración que le asigne uno en Usuarios.', { pin: 'unset' });
  if (!pin) throw new HttpsError('failed-precondition', 'Ingrese su PIN para confirmar.', { pin: 'required' });
  const d = snap.data() as { hash: string; salt: string; failed?: number; lockedUntil?: number };
  if ((d.lockedUntil ?? 0) > Date.now()) {
    await log(false, 'bloqueado');
    throw new HttpsError('failed-precondition', 'PIN bloqueado por intentos fallidos. Espere 15 minutos o pida que se lo reasignen.', { pin: 'locked' });
  }
  const ok = PIN_RE.test(pin) && timingSafeEqual(Buffer.from(hashPin(pin, d.salt)), Buffer.from(d.hash));
  if (!ok) {
    const failed = (d.failed ?? 0) + 1;
    await ref_.update({ failed, lockedUntil: failed >= MAX_FAILED ? Date.now() + LOCK_MS : 0 });
    await log(false, 'incorrecto');
    throw new HttpsError('failed-precondition', failed >= MAX_FAILED ? 'PIN bloqueado por intentos fallidos. Espere 15 minutos.' : `PIN incorrecto (${MAX_FAILED - failed} intentos restantes).`, { pin: failed >= MAX_FAILED ? 'locked' : 'invalid' });
  }
  if (d.failed) await ref_.update({ failed: 0, lockedUntil: 0 });
  await log(true);
}

// For important actions that run in the app (anular, vincular, despachar
// sin factura…): the app confirms the PIN here first.
export const verifyPin = onCall({ region: REGION }, async (req) => {
  const action = String(req.data?.action ?? 'accion').slice(0, 60);
  const ref = req.data?.ref != null ? String(req.data.ref).slice(0, 80) : undefined;
  await checkPin(req, action, ref);
  return { ok: true };
});
