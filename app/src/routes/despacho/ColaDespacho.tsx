import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '@/data/auth';
import { useDespachoQueue } from '@/data/orders';
import { formatDateShort, formatQty, todayInSantiago, addDaysIso } from '@/lib/format';
import StatusPill from '@/components/ui/StatusPill';
import ErrorBanner from '@/components/ui/ErrorBanner';
import type { Order } from '@/domain/types';
import { demoUsers } from '@/data/demo-users';

type DayFilter = 'hoy' | 'manana' | 'todos';
type OwnerFilter = 'todos' | 'mias' | 'sin_asignar';

const PACKER_NAME: Record<string, string> = Object.fromEntries(
  demoUsers.filter((u) => u.role === 'despacho').map((u) => [u.uid, u.displayName]),
);

export default function ColaDespacho() {
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const { orders, loading, error } = useDespachoQueue();
  const [day, setDay] = useState<DayFilter>('todos');
  const [owner, setOwner] = useState<OwnerFilter>('todos');

  const today = todayInSantiago();
  const tomorrow = addDaysIso(today, 1);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (day === 'hoy'    && o.requestedDate !== today) return false;
      if (day === 'manana' && o.requestedDate !== tomorrow) return false;
      if (owner === 'mias' && o.assignedPackerId !== uid) return false;
      if (owner === 'sin_asignar' && !!o.assignedPackerId) return false;
      return true;
    });
  }, [orders, day, owner, today, tomorrow, uid]);

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Despacho</p>
        <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Cola de despacho</h1>
      </header>

      <section className="mb-4 flex flex-col gap-2">
        <FilterRow label="Fecha">
          <FilterChip active={day === 'hoy'}    onClick={() => setDay('hoy')}>Hoy</FilterChip>
          <FilterChip active={day === 'manana'} onClick={() => setDay('manana')}>Mañana</FilterChip>
          <FilterChip active={day === 'todos'}  onClick={() => setDay('todos')}>Todos</FilterChip>
        </FilterRow>
        <FilterRow label="Asignación">
          <FilterChip active={owner === 'todos'}       onClick={() => setOwner('todos')}>Todos</FilterChip>
          <FilterChip active={owner === 'mias'}        onClick={() => setOwner('mias')}>Míos</FilterChip>
          <FilterChip active={owner === 'sin_asignar'} onClick={() => setOwner('sin_asignar')}>Sin asignar</FilterChip>
        </FilterRow>
      </section>

      {loading && !error && <p className="text-sm text-charcoal-300">Cargando…</p>}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && filtered.length === 0 && (
        <div className="card p-8 text-center">
          <p className="eyebrow mb-2">Vacío</p>
          <p className="text-sm text-charcoal-500">Nada por armar con estos filtros.</p>
        </div>
      )}

      <ul className="space-y-2">
        {filtered.map((o) => (
          <li key={o.id}>
            <QueueCard order={o} currentUid={uid} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="eyebrow shrink-0 w-20">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded-md px-3 py-1.5 text-xs uppercase tracking-display font-medium border transition ' +
        (active
          ? 'bg-charcoal-900 border-charcoal-900 text-cream-50'
          : 'bg-white border-charcoal-200 text-charcoal-500 hover:border-charcoal-300')
      }
    >
      {children}
    </button>
  );
}

function QueueCard({ order, currentUid }: { order: Order; currentUid: string }) {
  const totalLines = order.lines.length;
  const anyPending = order.lines.some((l) => l.pendingProductionQty > 0);
  const mine = order.assignedPackerId === currentUid;
  const packerName = order.assignedPackerId ? PACKER_NAME[order.assignedPackerId] ?? 'Otro' : null;

  return (
    <Link
      to={`/despacho/cola/${order.id}`}
      className="block card p-4 hover:border-brass-500 hover:shadow-lift transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] text-charcoal-300 uppercase tracking-display">{order.id}</span>
            <StatusPill status={order.status} />
            {anyPending && (
              <span className="text-[10px] uppercase tracking-display text-brass-700">· parte a producción</span>
            )}
          </div>
          <p className="font-semibold text-charcoal-900 mt-1 truncate">
            {order.clientSnapshot.fantasyName ?? order.clientSnapshot.name}
          </p>
          <p className="text-xs text-charcoal-300 mt-0.5">
            {totalLines} {totalLines === 1 ? 'línea' : 'líneas'} · {order.deliveryMode === 'retiro' ? 'Retiro' : 'Despacho'}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="eyebrow">Solicitado</p>
          <p className="text-sm font-semibold text-charcoal-900 mt-0.5 first-letter:uppercase">
            {formatDateShort(order.requestedDate)}
          </p>
          {packerName && (
            <p className={'text-[10px] uppercase tracking-display mt-1 ' + (mine ? 'text-brass-700 font-semibold' : 'text-charcoal-300')}>
              {mine ? 'Míos' : `Asignado ${packerName}`}
            </p>
          )}
        </div>
      </div>

      <ul className="mt-3 pt-3 border-t border-charcoal-100 space-y-1">
        {order.lines.slice(0, 3).map((l) => (
          <li key={`${l.productId}-${l.formatId}`} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-charcoal-500 truncate">{l.productName} · {l.formatLabel}</span>
            <span className="text-charcoal-700 font-medium shrink-0">{formatQty(l.qty, l.unit)}</span>
          </li>
        ))}
        {totalLines > 3 && <li className="text-[11px] text-charcoal-300">+ {totalLines - 3} más</li>}
      </ul>
    </Link>
  );
}
