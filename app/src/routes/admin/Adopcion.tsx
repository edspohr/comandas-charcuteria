import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/data/firebase';
import type { UserUsage } from '@/data/usage';
import type { AppUser } from '@/domain/types';
import { ROLE_LABEL } from '@/domain/permissions';
import { addDaysIso, todayInSantiago } from '@/lib/format';
import DataTable, { Pill } from '@/components/ui/DataTable';
import ErrorBanner from '@/components/ui/ErrorBanner';

export default function Adopcion({ users }: { users: AppUser[] }) {
  const [usage, setUsage] = useState<Record<string, UserUsage>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => onSnapshot(collection(db, 'userUsage'), (snap) => {
    setUsage(Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as UserUsage])));
    setLoading(false); setError(false);
  }, () => { setError(true); setLoading(false); }), []);
  const today = todayInSantiago();
  const since7 = addDaysIso(today, -6);
  const since30 = addDaysIso(today, -29);
  const rows = users.filter((u) => !u.placeholder && !u.mergedInto).map((u) => {
    const data = usage[u.uid];
    const days = data?.days ?? [];
    return { ...u, lastSeenAt: data?.lastSeenAt, days7: days.filter((d) => d >= since7 && d <= today).length, days30: days.filter((d) => d >= since30 && d <= today).length };
  }).sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0) || a.displayName.localeCompare(b.displayName, 'es'));
  const enabled = rows.filter((u) => u.active !== false);
  const active7 = enabled.filter((u) => u.days7 > 0).length;
  const active30 = enabled.filter((u) => u.days30 > 0).length;
  if (loading) return <p className="text-sm text-charcoal-500">Cargando uso…</p>;
  if (error) return <ErrorBanner message="No se pudo cargar el reporte de adopción. Intente abrir esta vista nuevamente." />;
  return <section className="space-y-4">
    <div>
      <h2 className="text-lg font-semibold text-charcoal-900">Adopción de la app</h2>
      <p className="text-xs text-charcoal-500 mt-1">Uso al abrir, desbloquear o interactuar con la app. Fechas de Chile; incluye hoy. Último uso aproximado (intervalos de 5 minutos).</p>
      <p className="text-xs text-charcoal-500 mt-1">El registro comienza con esta versión. “Sin registro” no implica que nunca haya usado la app. Las personas del historial sin cuenta no se incluyen.</p>
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[
        ['Cuentas habilitadas', enabled.length],
        ['Activos · 7 días', `${active7} / ${enabled.length}`],
        ['Activos · 30 días', `${active30} / ${enabled.length}`],
        ['Adopción · 30 días', `${enabled.length ? Math.round(active30 / enabled.length * 100) : 0}%`],
      ].map(([label, value]) => <div key={label} className="card p-3"><p className="text-xs text-charcoal-500">{label}</p><p className="text-2xl font-semibold text-charcoal-900 mt-1">{value}</p></div>)}
    </div>
    <p className="text-xs text-charcoal-500">Los indicadores consideran cuentas habilitadas. La tabla también muestra cuentas desactivadas. Activo = al menos un día de uso en el período.</p>
    <DataTable rows={rows} rowKey={(r) => r.uid} emptyText="Todavía no hay cuentas." columns={[
      { key: 'user', label: 'Usuario', mobile: true, render: (r) => <div><p className="font-semibold text-charcoal-900">{r.displayName}</p><p className="text-xs text-charcoal-500">{r.email}</p></div> },
      { key: 'role', label: 'Perfil', render: (r) => ROLE_LABEL[r.role] },
      { key: 'status', label: 'Estado', mobile: true, render: (r) => <Pill tone={r.active === false ? 'muted' : r.days7 ? 'ok' : 'warn'}>{r.active === false ? 'Desactivado' : r.days7 ? 'Activo · 7 días' : r.lastSeenAt ? 'Sin uso reciente' : 'Sin registro'}</Pill> },
      { key: 'last', label: 'Último uso', mobile: true, render: (r) => r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }) : 'Sin registro' },
      { key: 'days7', label: 'Días de uso · 7 d', align: 'right', render: (r) => r.days7 },
      { key: 'days30', label: 'Días de uso · 30 d', align: 'right', render: (r) => r.days30 },
    ]} />
  </section>;
}
