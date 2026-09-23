import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '@/data/firebase';
import { ROLE_LABEL } from '@/data/auth';
import { useClients } from '@/data/clients';
import DataTable, { Pill } from '@/components/ui/DataTable';
import { addDaysIso, formatDateShort, todayInSantiago } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';
import type { AppUser, Order, Role } from '@/domain/types';

const ROLE_ORDER: Role[] = ['superAdmin', 'admin', 'produccion', 'despacho', 'vendedor'];
const ROLE_TONE: Record<Role, 'ok' | 'warn' | 'bad' | 'muted' | 'info'> = { superAdmin: 'bad', admin: 'warn', produccion: 'info', despacho: 'info', vendedor: 'ok' };

interface UserRow extends AppUser {
  cartera: number;
  creados30: number;
  ventas30: number;
  armados30: number;
  lastActivity: string | null;
  anulados30: number;
}

export default function Usuarios() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const { clients } = useClients();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'users'), (snap) => { const l: AppUser[] = []; snap.forEach((d) => l.push(d.data() as AppUser)); setUsers(l); setLoading(false); });
    const u2 = onSnapshot(collection(db, 'orders'), (snap) => { const l: Order[] = []; snap.forEach((d) => l.push(d.data() as Order)); setOrders(l); });
    return () => { u1(); u2(); };
  }, []);

  const rows = useMemo<UserRow[]>(() => {
    const since = addDaysIso(todayInSantiago(), -30);
    return users.map((u) => {
      const created = orders.filter((o) => o.createdBy === u.uid);
      const packed = orders.filter((o) => o.assignedPackerId === u.uid && o.statusHistory.some((h) => h.status === 'armado' && h.by === u.uid));
      const touched = orders.filter((o) => o.statusHistory.some((h) => h.by === u.uid));
      const lastAt = touched.reduce((m, o) => Math.max(m, ...o.statusHistory.filter((h) => h.by === u.uid && Number.isFinite(h.at)).map((h) => h.at)), 0);
      const c30 = created.filter((o) => o.requestedDate >= since && o.status !== 'anulado');
      return {
        ...u,
        cartera: clients.filter((c) => c.ownerUid === u.uid).length,
        creados30: c30.length,
        ventas30: c30.filter((o) => ['facturado', 'despachado', 'entregado'].includes(o.status)).reduce((s, o) => s + (o.totalCLP ?? 0), 0),
        armados30: packed.filter((o) => o.requestedDate >= since).length,
        anulados30: created.filter((o) => o.requestedDate >= since && o.status === 'anulado').length,
        lastActivity: lastAt ? new Date(lastAt).toISOString().slice(0, 10) : null,
      };
    }).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.displayName.localeCompare(b.displayName, 'es'));
  }, [users, orders, clients]);

  return (
    <div>
      <header className="mb-4">
        <p className="eyebrow">Super Administración</p>
        <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Usuarios</h1>
        <p className="text-xs text-charcoal-300 mt-1">{users.length} usuarios · actividad de los últimos 30 días · los permisos se gestionan en Firebase Console mientras esté en demo</p>
      </header>

      {loading && <p className="text-sm text-charcoal-300">Cargando…</p>}

      <DataTable<UserRow>
        rows={rows}
        rowKey={(r) => r.uid}
        columns={[
          { key: 'name', label: 'Usuario', mobile: true, render: (r) => <div><p className="font-semibold text-charcoal-900">{r.displayName}</p><p className="text-[11px] text-charcoal-300 truncate">{r.email}</p></div> },
          { key: 'role', label: 'Rol', mobile: true, render: (r) => <Pill tone={ROLE_TONE[r.role]}>{ROLE_LABEL[r.role]}</Pill> },
          { key: 'cartera', label: 'Cartera', align: 'right', render: (r) => r.role === 'vendedor' ? r.cartera : '—', muted: true },
          { key: 'creados', label: 'Pedidos 30 d', align: 'right', render: (r) => r.creados30 || '—' },
          { key: 'ventas', label: 'Ventas 30 d', align: 'right', mobile: true, render: (r) => r.ventas30 ? <span className="font-semibold">{formatCLP(r.ventas30)}</span> : '—' },
          { key: 'armados', label: 'Armados 30 d', align: 'right', render: (r) => r.armados30 || '—' },
          { key: 'anulados', label: 'Anulados', align: 'right', render: (r) => r.anulados30 ? <span className="text-red-700">{r.anulados30}</span> : '—', muted: true },
          { key: 'last', label: 'Última actividad', align: 'right', render: (r) => r.lastActivity ? <span className="first-letter:uppercase whitespace-nowrap">{formatDateShort(r.lastActivity)}</span> : '—', muted: true },
        ]}
        expand={(r) => (
          <div className="text-xs text-charcoal-500 flex flex-wrap gap-x-6 gap-y-1">
            <span>uid <span className="font-mono text-charcoal-700">{r.uid}</span></span>
            {r.role === 'vendedor' && <Link to={`/tablero?vendedor=${r.uid}`} className="underline hover:text-charcoal-900">Ver sus pedidos en el tablero →</Link>}
            {r.role === 'vendedor' && <Link to="/clientes" className="underline hover:text-charcoal-900">Ver clientes →</Link>}
            <span>Cambio de rol: Firebase Console → Firestore → users/{r.uid}</span>
          </div>
        )}
      />
    </div>
  );
}
