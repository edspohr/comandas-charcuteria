import { useSyncExternalStore } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User as FbUser,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { AppUser, Role } from '@/domain/types';

export interface CurrentUser {
  fbUser: FbUser;
  appUser: AppUser;
}

// Module-level auth state so every useCurrentUser() call sees the same
// resolved user. Before this, each hook instance began with current=null
// and any route that immediately dereferenced current!.appUser crashed.
interface AuthState { current: CurrentUser | null; loading: boolean }
let authState: AuthState = { current: null, loading: true };
const listeners = new Set<() => void>();
let started = false;

function emit(next: AuthState) {
  authState = next;
  listeners.forEach((l) => l());
}

function startAuthListener() {
  if (started) return;
  started = true;
  onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) { emit({ current: null, loading: false }); return; }
    const snap = await getDoc(doc(db, 'users', fbUser.uid));
    if (!snap.exists()) {
      // Auth user without a users/{uid} doc — treat as signed out.
      await fbSignOut(auth);
      emit({ current: null, loading: false });
    } else {
      emit({ current: { fbUser, appUser: snap.data() as AppUser }, loading: false });
    }
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useCurrentUser(): { current: CurrentUser | null; loading: boolean } {
  startAuthListener();
  return useSyncExternalStore(subscribe, () => authState);
}

export async function signInWithPassword(email: string, password: string) {
  await signInWithEmailAndPassword(auth, email, password);
}

export async function signOut() {
  await fbSignOut(auth);
}

export const ROLE_HOME: Record<Role, string> = {
  vendedor: '/tablero',
  despacho: '/tablero',
  produccion: '/produccion',
  admin: '/tablero',
  superAdmin: '/tablero',
};

export const ROLE_LABEL: Record<Role, string> = {
  vendedor: 'Vendedor',
  despacho: 'Despacho',
  produccion: 'Producción',
  admin: 'Administración',
  superAdmin: 'Super Administrador',
};
