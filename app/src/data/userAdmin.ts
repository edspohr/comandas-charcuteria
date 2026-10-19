import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth, db, functions } from './firebase';
import type { Invite, Role } from '@/domain/types';

// Thin wrappers over the admin callables (functions/src/users.ts). Only a
// superAdmin token passes them; the rules forbid writing users/invites here.

const inviteFn = httpsCallable<{ email: string; displayName: string; role: Role; withPassword: boolean }, { status: 'invited' | 'created'; uid?: string }>(functions, 'adminInviteUser');
const updateFn = httpsCallable<{ uid: string; role?: Role; active?: boolean; displayName?: string }, { ok: true }>(functions, 'adminUpdateUser');
const deleteInviteFn = httpsCallable<{ email: string }, { ok: true }>(functions, 'adminDeleteInvite');

export async function inviteUser(input: { email: string; displayName: string; role: Role; withPassword: boolean }): Promise<string> {
  const res = await inviteFn(input);
  if (res.data.status === 'created') {
    // The account exists with a throwaway password: the person receives
    // Firebase's "reset password" mail and picks their own.
    await sendPasswordResetEmail(auth, input.email.trim());
    return `Se creó la cuenta y se envió a ${input.email.trim()} un correo para crear su contraseña. También puede entrar con Google si ese correo es de Google.`;
  }
  return `Invitación lista: ${input.email.trim()} puede entrar con "Continuar con Google".`;
}

export async function updateUser(uid: string, patch: { role?: Role; active?: boolean; displayName?: string }) {
  await updateFn({ uid, ...patch });
}

export async function deleteInvite(email: string) {
  await deleteInviteFn({ email });
}

export async function resendPasswordEmail(email: string) {
  await sendPasswordResetEmail(auth, email);
}

export function useInvites(): Invite[] {
  const [items, setItems] = useState<Invite[]>([]);
  useEffect(() => onSnapshot(collection(db, 'invites'), (snap) => {
    const l: Invite[] = []; snap.forEach((d) => l.push(d.data() as Invite));
    l.sort((a, b) => b.createdAt - a.createdAt);
    setItems(l);
  }, () => setItems([])), []);
  return items;
}

export function callableMessage(e: unknown): string {
  const msg = (e as { message?: string }).message ?? '';
  // HttpsError messages are already user-facing Spanish.
  return msg && !msg.startsWith('internal') ? msg : 'No se pudo completar la operación.';
}
