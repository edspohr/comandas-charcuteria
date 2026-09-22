import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut, } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
export function useCurrentUser() {
    const [current, setCurrent] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (fbUser) => {
            if (!fbUser) {
                setCurrent(null);
                setLoading(false);
                return;
            }
            const snap = await getDoc(doc(db, 'users', fbUser.uid));
            if (!snap.exists()) {
                // Auth user without a users/{uid} doc — treat as signed out.
                await fbSignOut(auth);
                setCurrent(null);
            }
            else {
                setCurrent({ fbUser, appUser: snap.data() });
            }
            setLoading(false);
        });
        return unsub;
    }, []);
    return { current, loading };
}
export async function signInWithPassword(email, password) {
    await signInWithEmailAndPassword(auth, email, password);
}
export async function signOut() {
    await fbSignOut(auth);
}
export const ROLE_HOME = {
    vendedor: '/vendedor/nuevo',
    armador: '/armador/cola',
    produccion: '/produccion',
    admin: '/admin/panel',
};
export const ROLE_LABEL = {
    vendedor: 'Vendedor',
    armador: 'Armador',
    produccion: 'Producción',
    admin: 'Administración',
};
