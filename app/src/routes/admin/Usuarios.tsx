import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/data/firebase';
import { ROLE_LABEL } from '@/data/auth';
import type { AppUser, Role } from '@/domain/types';

const ROLE_ORDER: Role[] = ['superAdmin', 'admin', 'produccion', 'despacho', 'vendedor'];

export default function Usuarios() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const list: AppUser[] = [];
      snap.forEach((d) => list.push(d.data() as AppUser));
      list.sort((a, b) => {
        const ra = ROLE_ORDER.indexOf(a.role), rb = ROLE_ORDER.indexOf(b.role);
        if (ra !== rb) return ra - rb;
        return a.displayName.localeCompare(b.displayName, 'es');
      });
      setUsers(list);
      setLoading(false);
    });
    return unsub;
  }, []);

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Super Administración</p>
        <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Usuarios</h1>
        <p className="text-xs text-charcoal-300 mt-1">Vista de sólo lectura. Los permisos se gestionan en Firebase Console mientras esté en demo.</p>
      </header>

      {loading && <p className="text-sm text-charcoal-300">Cargando…</p>}

      <div className="space-y-6">
        {ROLE_ORDER.map((role) => {
          const list = users.filter((u) => u.role === role);
          if (list.length === 0) return null;
          return (
            <section key={role}>
              <div className="flex items-center gap-2 mb-2">
                <span className="h-px flex-1 bg-charcoal-100" />
                <span className="eyebrow whitespace-nowrap">{ROLE_LABEL[role]} · {list.length}</span>
                <span className="h-px flex-1 bg-charcoal-100" />
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {list.map((u) => (
                  <li key={u.uid} className="card p-3">
                    <p className="font-semibold text-charcoal-900">{u.displayName}</p>
                    <p className="text-xs text-charcoal-300 mt-0.5 truncate">{u.email}</p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
