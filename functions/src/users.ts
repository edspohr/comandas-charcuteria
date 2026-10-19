import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { REGION, ROLES, isRole, type Role } from './common';

// Gestión de usuarios. El rol vive en dos lados y estas funciones son las
// únicas que lo escriben, siempre juntos:
//   - users/{uid}.role       → lo que lee la UI
//   - custom claim `role`    → lo que leen firestore.rules (sin get() extra)
// Las reglas prohíben escribir users/* e invites/* desde el cliente.

interface AppUserDoc {
  uid: string;
  displayName: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: number;
  createdBy: string;
}

const normEmail = (e: unknown) => (typeof e === 'string' ? e.trim().toLowerCase() : '');

function requireSuperAdmin(req: CallableRequest): string {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.');
  if (req.auth.token.role !== 'superAdmin') throw new HttpsError('permission-denied', 'Solo super administración gestiona usuarios.');
  return req.auth.uid;
}

async function writeUser(user: AppUserDoc) {
  await getAuth().setCustomUserClaims(user.uid, { role: user.role });
  await getFirestore().doc(`users/${user.uid}`).set(user, { merge: true });
}

// Primera entrada de una persona invitada (Google o contraseña): vincula la
// invitación al uid que acaba de autenticarse.
export const claimInvite = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.');
  const db = getFirestore();
  const existing = await db.doc(`users/${req.auth.uid}`).get();
  if (existing.exists) return { user: existing.data() };

  const email = normEmail(req.auth.token.email);
  if (!email) throw new HttpsError('failed-precondition', 'La cuenta no tiene correo.');
  // Solo correos verificados (Google siempre lo es). Las cuentas con
  // contraseña nacen con su users/{uid} desde adminInviteUser y nunca pasan
  // por acá; exigir verificación impide que alguien se registre con
  // contraseña usando el correo de una invitación pendiente.
  if (req.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'El correo no está verificado.');
  }
  const inviteRef = db.doc(`invites/${email}`);
  const invite = await inviteRef.get();
  if (!invite.exists) throw new HttpsError('permission-denied', 'No hay una invitación para este correo.');
  const inv = invite.data() as { displayName: string; role: Role; createdBy: string; createdAt: number };
  const user: AppUserDoc = {
    uid: req.auth.uid,
    displayName: inv.displayName,
    email,
    role: inv.role,
    active: true,
    createdAt: Date.now(),
    createdBy: inv.createdBy,
  };
  await writeUser(user);
  await inviteRef.delete();
  return { user };
});

// Alta de una persona. Siempre deja una invitación (así puede entrar con
// Google). Con `withPassword` además crea la cuenta de correo/contraseña;
// el cliente le manda el correo de "crear contraseña" con
// sendPasswordResetEmail, para que nadie tenga que dictar una clave.
export const adminInviteUser = onCall({ region: REGION }, async (req) => {
  const by = requireSuperAdmin(req);
  const email = normEmail(req.data?.email);
  const displayName = typeof req.data?.displayName === 'string' ? req.data.displayName.trim() : '';
  const role = req.data?.role;
  const withPassword = req.data?.withPassword === true;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpsError('invalid-argument', 'Correo no válido.');
  if (displayName.length < 2) throw new HttpsError('invalid-argument', 'Indique el nombre.');
  if (!isRole(role)) throw new HttpsError('invalid-argument', `Perfil no válido. Use uno de: ${ROLES.join(', ')}.`);

  const db = getFirestore();
  const auth = getAuth();
  let existingUid: string | null = null;
  try { existingUid = (await auth.getUserByEmail(email)).uid; } catch { /* not found */ }
  if (existingUid && (await db.doc(`users/${existingUid}`).get()).exists) {
    throw new HttpsError('already-exists', 'Ese correo ya tiene usuario. Cambie su perfil desde la lista.');
  }

  await db.doc(`invites/${email}`).set({ email, displayName, role, createdAt: Date.now(), createdBy: by });

  if (withPassword) {
    const uid = existingUid ?? (await auth.createUser({
      email,
      displayName,
      // Throwaway: the person sets their own via the reset email.
      password: randomBytes(24).toString('base64url'),
    })).uid;
    await writeUser({ uid, displayName, email, role, active: true, createdAt: Date.now(), createdBy: by });
    await db.doc(`invites/${email}`).delete();
    return { status: 'created', uid };
  }
  return { status: 'invited' };
});

export const adminUpdateUser = onCall({ region: REGION }, async (req) => {
  const by = requireSuperAdmin(req);
  const uid = typeof req.data?.uid === 'string' ? req.data.uid : '';
  if (!uid) throw new HttpsError('invalid-argument', 'Falta el usuario.');
  const db = getFirestore();
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Usuario no encontrado.');
  const current = snap.data() as AppUserDoc;

  const patch: Partial<AppUserDoc> & { updatedAt: number; updatedBy: string } = { updatedAt: Date.now(), updatedBy: by };
  if (req.data?.role !== undefined) {
    if (!isRole(req.data.role)) throw new HttpsError('invalid-argument', 'Perfil no válido.');
    if (uid === by && req.data.role !== 'superAdmin') throw new HttpsError('failed-precondition', 'No puede quitarse a sí mismo el perfil de super administración.');
    patch.role = req.data.role;
  }
  if (typeof req.data?.displayName === 'string' && req.data.displayName.trim().length >= 2) patch.displayName = req.data.displayName.trim();
  if (typeof req.data?.active === 'boolean') {
    if (uid === by && !req.data.active) throw new HttpsError('failed-precondition', 'No puede desactivarse a sí mismo.');
    patch.active = req.data.active;
  }

  const auth = getAuth();
  if (patch.role && patch.role !== current.role) await auth.setCustomUserClaims(uid, { role: patch.role });
  if (patch.active !== undefined && patch.active !== current.active) {
    await auth.updateUser(uid, { disabled: !patch.active });
    if (!patch.active) await auth.revokeRefreshTokens(uid);
  }
  if (patch.displayName) await auth.updateUser(uid, { displayName: patch.displayName });
  await ref.update(patch);
  return { ok: true };
});

export const adminDeleteInvite = onCall({ region: REGION }, async (req) => {
  requireSuperAdmin(req);
  const email = normEmail(req.data?.email);
  if (!email) throw new HttpsError('invalid-argument', 'Falta el correo.');
  await getFirestore().doc(`invites/${email}`).delete();
  return { ok: true };
});
