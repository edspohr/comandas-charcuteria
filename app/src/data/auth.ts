import { useEffect, useState } from 'react';
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

export function useCurrentUser(): { current: CurrentUser | null; loading: boolean } {
  const [current, setCurrent] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) { setCurrent(null); setLoading(false); return; }
      const snap = await getDoc(doc(db, 'users', fbUser.uid));
      if (!snap.exists()) {
        // Auth user without a users/{uid} doc — treat as signed out.
        await fbSignOut(auth);
        setCurrent(null);
      } else {
        setCurrent({ fbUser, appUser: snap.data() as AppUser });
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  return { current, loading };
}

export async function signInWithPassword(email: string, password: string) {
  await signInWithEmailAndPassword(auth, email, password);
}

export async function signOut() {
  await fbSignOut(auth);
}

export const ROLE_HOME: Record<Role, string> = {
  vendedor: '/vendedor/nuevo',
  armador: '/armador/cola',
  produccion: '/produccion',
  admin: '/admin/panel',
};

export const ROLE_LABEL: Record<Role, string> = {
  vendedor: 'Vendedor',
  armador: 'Armador',
  produccion: 'Producción',
  admin: 'Administración',
};
