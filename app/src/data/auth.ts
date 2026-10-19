import { useSyncExternalStore } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User as FbUser,
} from 'firebase/auth';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from './firebase';
import { resetUsersDirectory } from './users';
import { resetClientsStore } from './clients';
import type { AppUser } from '@/domain/types';

export { ROLE_HOME, ROLE_LABEL } from '@/domain/permissions';

export interface CurrentUser {
  fbUser: FbUser;
  appUser: AppUser;
}

// Module-level auth state so every useCurrentUser() call sees the same
// resolved user. `denied` explains why a signed-in Google/password account
// was turned away (no invitation, account disabled) so Login can say so.
interface AuthState { current: CurrentUser | null; loading: boolean; denied: string | null }
let authState: AuthState = { current: null, loading: true, denied: null };
const listeners = new Set<() => void>();
let started = false;
let userDocUnsub: Unsubscribe | null = null;

function emit(next: AuthState) {
  authState = next;
  listeners.forEach((l) => l());
}

const claimInvite = httpsCallable<void, { user: AppUser }>(functions, 'claimInvite');

async function deny(message: string) {
  userDocUnsub?.(); userDocUnsub = null;
  await fbSignOut(auth);
  emit({ current: null, loading: false, denied: message });
}

// The role lives in two places: users/{uid}.role (what the UI reads) and the
// custom claim `role` on the ID token (what firestore.rules read). Both are
// written together by the admin Cloud Functions; when the doc changes under
// us we force a token refresh so the rules see the new claim right away.
async function ensureFreshClaim(fbUser: FbUser, role: string) {
  const token = await fbUser.getIdTokenResult();
  if (token.claims.role !== role) await fbUser.getIdToken(true);
}

function watchUserDoc(fbUser: FbUser) {
  userDocUnsub?.();
  let claimed = false;
  userDocUnsub = onSnapshot(doc(db, 'users', fbUser.uid), async (snap) => {
    if (!snap.exists()) {
      if (claimed) return;
      claimed = true;
      // First sign-in of an invited person: the function binds the invite to
      // this uid (users doc + claim). The snapshot fires again with the doc.
      try {
        await claimInvite();
        await fbUser.getIdToken(true);
      } catch {
        await deny(`La cuenta ${fbUser.email ?? ''} no tiene acceso. Pídale a un administrador que lo invite con ese correo.`);
      }
      return;
    }
    const appUser = snap.data() as AppUser;
    if (appUser.active === false) {
      await deny('Su usuario está desactivado. Contacte a un administrador.');
      return;
    }
    await ensureFreshClaim(fbUser, appUser.role);
    emit({ current: { fbUser, appUser }, loading: false, denied: null });
  }, async () => {
    // Rules deny reading users/* until the claim exists; retry after refresh.
    if (!claimed) {
      claimed = true;
      try { await claimInvite(); await fbUser.getIdToken(true); watchUserDoc(fbUser); return; } catch { /* fallthrough */ }
    }
    await deny('No se pudo validar su acceso. Intente de nuevo.');
  });
}

function startAuthListener() {
  if (started) return;
  started = true;
  onAuthStateChanged(auth, (fbUser) => {
    if (!fbUser) {
      userDocUnsub?.(); userDocUnsub = null;
      resetUsersDirectory();
      resetClientsStore();
      emit({ current: null, loading: false, denied: authState.denied });
      return;
    }
    emit({ ...authState, loading: true });
    watchUserDoc(fbUser);
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useCurrentUser(): AuthState {
  startAuthListener();
  return useSyncExternalStore(subscribe, () => authState);
}

export async function signInWithPassword(email: string, password: string) {
  emit({ ...authState, denied: null });
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function signInWithGoogle() {
  emit({ ...authState, denied: null });
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // Installed PWAs (iOS standalone) and some mobile browsers block popups.
    const code = (e as { code?: string }).code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw e;
  }
}

export async function requestPasswordReset(email: string) {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function signOut() {
  emit({ ...authState, denied: null });
  await fbSignOut(auth);
}

export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string }).code ?? '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'Correo o contraseña incorrectos.';
  if (code === 'auth/too-many-requests') return 'Demasiados intentos. Espere unos minutos o restablezca su contraseña.';
  if (code === 'auth/user-disabled') return 'Su usuario está desactivado. Contacte a un administrador.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
  if (code === 'auth/network-request-failed') return 'Sin conexión. Revise su internet e intente de nuevo.';
  if (code === 'auth/invalid-email') return 'El correo no es válido.';
  return 'No se pudo iniciar sesión. Intente de nuevo.';
}
