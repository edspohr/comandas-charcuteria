import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { REGION } from './common';

// PIN personal de 4 dígitos, creado por cada persona. Sirve para entrar a la
// app (correo + PIN) y para confirmar las acciones clave: las escrituras en
// Bsale se verifican acá, en el servidor, y las acciones importantes de la
// app llaman a verifyPin antes de hacerse. Al crearlo la persona acepta que
// lo que se haga con su cuenta y su PIN es su responsabilidad.
//
//   userPins/{uid}  { hash, salt, setAt, failed, lockedUntil, disabled }   solo servidor
//   pinLog/{id}     { uid, action, ref, ok, reason, at }                   auditoría
//   users/{uid}     hasPin, pinSetAt, pinAcceptedAt, pinAcceptVersion      para la app
//
// Intentos fallidos: a los 5, bloqueo de 15 minutos; a los 10 seguidos, el
// PIN queda desactivado hasta que la persona vuelva a verificarse (Google o
// contraseña) y cree uno nuevo.

export const RESPONSIBILITY_VERSION = 'v1-2026-10-24';
export const RESPONSIBILITY_TEXT = 'Declaro que este PIN es personal e intransferible y que todo lo que se haga con mi cuenta y con mi PIN en Comandas es de mi plena responsabilidad.';

const LOCK_AT = 5;
const DISABLE_AT = 10;
const LOCK_MS = 15 * 60_000;
const PIN_RE = /^\d{4}$/;

const hashPin = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('base64');

export function validatePin(pin: string) {
  if (!PIN_RE.test(pin)) throw new HttpsError('invalid-argument', 'El PIN debe tener 4 dígitos.');
  const obvious = /^(\d)\1{3}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin) || ['1212', '1122', '2580', '0852', '1004', '2000', '2026', '1990'].includes(pin);
  if (obvious) throw new HttpsError('invalid-argument', 'Ese PIN es muy fácil de adivinar. Elija otro (no repetido, correlativo ni un año).');
}

interface PinDoc { hash: string; salt: string; setAt: number; failed?: number; lockedUntil?: number; disabled?: boolean }
const log = (uid: string, action: string, ok: boolean, extra: Record<string, unknown> = {}) =>
  getFirestore().collection('pinLog').add({ uid, action, ok, at: Date.now(), ...extra });

// Shared check for login and confirmations. Returns normally on success.
async function verify(uid: string, pin: string, action: string, ref?: string): Promise<void> {
  const db = getFirestore();
  const pinRef = db.doc(`userPins/${uid}`);
  const snap = await pinRef.get();
  if (!snap.exists) throw new HttpsError('failed-precondition', 'Todavía no tiene PIN. Entre con Google o su contraseña y créelo.', { pin: 'unset' });
  const d = snap.data() as PinDoc;
  if (d.disabled) {
    await log(uid, action, false, { ref: ref ?? null, reason: 'desactivado' });
    throw new HttpsError('failed-precondition', 'Su PIN quedó desactivado por intentos fallidos. Entre con Google o su contraseña y cree uno nuevo.', { pin: 'disabled' });
  }
  if ((d.lockedUntil ?? 0) > Date.now()) {
    await log(uid, action, false, { ref: ref ?? null, reason: 'bloqueado' });
    const min = Math.ceil(((d.lockedUntil ?? 0) - Date.now()) / 60_000);
    throw new HttpsError('failed-precondition', `PIN bloqueado por intentos fallidos. Intente en ${min} min.`, { pin: 'locked' });
  }
  const ok = PIN_RE.test(pin) && timingSafeEqual(Buffer.from(hashPin(pin, d.salt)), Buffer.from(d.hash));
  if (ok) {
    if (d.failed) await pinRef.update({ failed: 0, lockedUntil: 0 });
    await log(uid, action, true, { ref: ref ?? null });
    return;
  }
  const failed = (d.failed ?? 0) + 1;
  const disabled = failed >= DISABLE_AT;
  await pinRef.update({ failed, lockedUntil: failed >= LOCK_AT && !disabled ? Date.now() + LOCK_MS : 0, disabled });
  if (disabled) await db.doc(`users/${uid}`).set({ pinDisabled: true }, { merge: true });
  await log(uid, action, false, { ref: ref ?? null, reason: disabled ? 'desactivado' : 'incorrecto', failed });
  if (disabled) throw new HttpsError('failed-precondition', 'PIN desactivado por demasiados intentos. Entre con Google o su contraseña y cree uno nuevo.', { pin: 'disabled' });
  if (failed >= LOCK_AT) throw new HttpsError('failed-precondition', 'PIN bloqueado 15 minutos por intentos fallidos.', { pin: 'locked' });
  throw new HttpsError('failed-precondition', `PIN incorrecto. Le quedan ${LOCK_AT - failed} intentos antes del bloqueo.`, { pin: 'invalid' });
}

// The person creates (or replaces) their own PIN. Only from a session opened
// with Google or password, never with the PIN itself: that verifies it's them.
export const setOwnPin = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.');
  const provider = (req.auth.token.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
  if (provider === 'custom') throw new HttpsError('failed-precondition', 'Para crear o cambiar el PIN entre con Google o su contraseña.');
  const pin = String(req.data?.pin ?? '');
  validatePin(pin);
  if (req.data?.accept !== true || req.data?.version !== RESPONSIBILITY_VERSION) throw new HttpsError('failed-precondition', 'Debe aceptar la declaración de responsabilidad.');
  const uid = req.auth.uid;
  const db = getFirestore();
  const user = await db.doc(`users/${uid}`).get();
  if (!user.exists || user.get('active') === false) throw new HttpsError('permission-denied', 'Su cuenta no está activa.');
  const salt = randomBytes(16).toString('base64');
  const now = Date.now();
  await db.doc(`userPins/${uid}`).set({ hash: hashPin(pin, salt), salt, setAt: now, failed: 0, lockedUntil: 0, disabled: false });
  await user.ref.update({ hasPin: true, pinSetAt: now, pinAcceptedAt: now, pinAcceptVersion: RESPONSIBILITY_VERSION, pinDisabled: false });
  await log(uid, 'pin_creado', true, { acceptText: RESPONSIBILITY_TEXT, acceptVersion: RESPONSIBILITY_VERSION, userAgent: String(req.rawRequest.headers['user-agent'] ?? '').slice(0, 200) });
  return { ok: true };
});

// Email + PIN → session (custom token). Same message whether the email
// exists or not, so it can't be used to probe accounts.
export const pinLogin = onCall({ region: REGION }, async (req) => {
  const email = String(req.data?.email ?? '').trim().toLowerCase();
  const pin = String(req.data?.pin ?? '');
  const generic = new HttpsError('permission-denied', 'Correo o PIN incorrecto.');
  if (!email || !PIN_RE.test(pin)) throw generic;
  const db = getFirestore();
  const users = await db.collection('users').where('email', '==', email).limit(2).get();
  const user = users.docs.find((d) => !d.get('placeholder'));
  if (!user) throw generic;
  if (user.get('active') === false) throw new HttpsError('permission-denied', 'Su cuenta está desactivada. Hable con administración.');
  try {
    await verify(user.id, pin, 'ingreso');
  } catch (e) {
    const s = (e as HttpsError).details as { pin?: string } | undefined;
    if (s?.pin === 'invalid') throw new HttpsError('permission-denied', (e as HttpsError).message);
    throw e;
  }
  if (user.get('pinDisabled')) await user.ref.update({ pinDisabled: false });
  return { token: await getAuth().createCustomToken(user.id) };
});

// SuperAdmin clears someone's PIN (forgot it, left the company, suspected
// misuse). The person creates a new one on their next Google/password login.
export const adminResetPin = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.');
  if (req.auth.token.role !== 'superAdmin') throw new HttpsError('permission-denied', 'Solo super administración puede borrar un PIN.');
  const uid = String(req.data?.uid ?? '');
  if (!uid) throw new HttpsError('invalid-argument', 'Falta el usuario.');
  const db = getFirestore();
  await db.doc(`userPins/${uid}`).delete();
  await db.doc(`users/${uid}`).set({ hasPin: false, pinDisabled: false }, { merge: true });
  await log(uid, 'pin_borrado', true, { by: req.auth.uid });
  return { ok: true };
});

// Verifies the caller's PIN for an action. Throws failed-precondition with
// details { pin: 'required' | 'invalid' | 'locked' | 'disabled' | 'unset' }.
export async function checkPin(req: CallableRequest, action: string, ref?: string): Promise<void> {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.');
  const pin = typeof req.data?.pin === 'string' ? req.data.pin : '';
  if (!pin) {
    const exists = (await getFirestore().doc(`userPins/${req.auth.uid}`).get()).exists;
    if (!exists) throw new HttpsError('failed-precondition', 'Todavía no tiene PIN. Entre con Google o su contraseña y créelo.', { pin: 'unset' });
    throw new HttpsError('failed-precondition', 'Ingrese su PIN para confirmar.', { pin: 'required' });
  }
  await verify(req.auth.uid, pin, action, ref);
}

// Confirmation for app-side actions (anular, vincular, despachar sin
// factura…) and the app lock (action 'desbloqueo').
export const verifyPin = onCall({ region: REGION }, async (req) => {
  const action = String(req.data?.action ?? 'accion').slice(0, 60);
  const ref = req.data?.ref != null ? String(req.data.ref).slice(0, 80) : undefined;
  await checkPin(req, action, ref);
  return { ok: true };
});
