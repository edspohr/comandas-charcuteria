import { useMemo, useSyncExternalStore } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import type { AppUser, Role } from '@/domain/types';

// Directorio de usuarios (users/*), compartido por todas las pantallas que
// muestran nombres (tablero, fichas, panel). Una sola suscripción por sesión.
interface State { users: AppUser[]; loading: boolean }
let state: State = { users: [], loading: true };
const listeners = new Set<() => void>();
let unsub: (() => void) | null = null;

function start() {
  if (unsub) return;
  unsub = onSnapshot(
    collection(db, 'users'),
    (snap) => {
      const list: AppUser[] = [];
      snap.forEach((d) => list.push(d.data() as AppUser));
      list.sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));
      state = { users: list, loading: false };
      listeners.forEach((l) => l());
    },
    () => { state = { users: [], loading: false }; listeners.forEach((l) => l()); },
  );
}

function subscribe(l: () => void) {
  start();
  listeners.add(l);
  return () => { listeners.delete(l); };
}

// Llamar al cerrar sesión: la suscripción quedó atada al usuario anterior.
export function resetUsersDirectory() {
  unsub?.();
  unsub = null;
  state = { users: [], loading: true };
}

export function useUsers(): State & { nameOf: (uid: string | undefined) => string; byRole: (role: Role) => AppUser[] } {
  const s = useSyncExternalStore(subscribe, () => state);
  // Stable per snapshot so callers can put nameOf in useMemo deps.
  return useMemo(() => {
    const names = new Map(s.users.map((u) => [u.uid, u.displayName]));
    return {
      ...s,
      nameOf: (uid: string | undefined) => (uid ? names.get(uid) ?? uid : ''),
      byRole: (role: Role) => s.users.filter((u) => u.role === role && u.active !== false),
    };
  }, [s]);
}
