import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCurrentUser } from '@/data/auth';
import { useMyOrders } from '@/data/orders';
import StatusPill from '@/components/ui/StatusPill';
import { formatDateShort, formatQty } from '@/lib/format';
import type { Order, OrderStatus } from '@/domain/types';

type Group = 'activos' | 'historial';

const ACTIVE: OrderStatus[] = ['recibido', 'confirmado', 'confirmado_parcial', 'en_armado', 'armado', 'facturado', 'despachado'];

export default function MisPedidos() {
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const { orders, loading } = useMyOrders(uid);
  const [group, setGroup] = useState<Group>('activos');
  const location = useLocation();
  const flash = location.state as null | { justCreated?: string; status?: OrderStatus; parcialLines?: Array<{ productName: string; formatLabel: string; missing: number }> };

  const filtered = useMemo(() => {
    if (group === 'activos') return orders.filter((o) => ACTIVE.includes(o.status));
    return orders.filter((o) => o.status === 'entregado' || o.status === 'anulado');
  }, [orders, group]);

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Vendedor</p>
        <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Mis pedidos</h1>
      </header>

      {flash?.justCreated && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm mb-4">
          Pedido <span className="font-mono">{flash.justCreated}</span> creado — estado <strong>{flash.status}</strong>.
          {flash.parcialLines && flash.parcialLines.length > 0 && (
            <ul className="mt-2 text-xs list-disc pl-4">
              {flash.parcialLines.map((p, i) => (
                <li key={i}>{p.productName} · {p.formatLabel}: {p.missing} a producción</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <nav className="mb-4 flex gap-1 border-b border-charcoal-100">
        {(['activos', 'historial'] as const).map((g) => (
          <button
            key={g}
            onClick={() => setGroup(g)}
            className={
              'px-4 py-2.5 text-xs uppercase tracking-display font-medium border-b-2 transition -mb-px ' +
              (g === group
                ? 'border-brass-500 text-charcoal-900'
                : 'border-transparent text-charcoal-300 hover:text-charcoal-500 hover:border-charcoal-200')
            }
          >
            {g === 'activos' ? 'Activos' : 'Historial'}
          </button>
        ))}
      </nav>

      {loading && <p className="text-sm text-charcoal-300">Cargando…</p>}

      {!loading && filtered.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-charcoal-500">Sin pedidos.</p>
        </div>
      )}

      <ul className="space-y-2">
        {filtered.map((o) => (
          <li key={o.id}>
            <OrderCard order={o} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const anyPending = order.lines.some((l) => l.pendingProductionQty > 0);
  return (
    <Link
      to={`/vendedor/mis/${order.id}`}
      className="block card p-4 hover:border-brass-500 hover:shadow-lift transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] text-charcoal-300 uppercase tracking-display">{order.id}</span>
            <StatusPill status={order.status} />
            {order.invoiceRef && <span className="font-mono text-[11px] text-charcoal-500">{order.invoiceRef}</span>}
            {anyPending && <span className="text-[10px] uppercase tracking-display text-brass-700">· parte a producción</span>}
          </div>
          <p className="font-semibold text-charcoal-900 mt-1 truncate">
            {order.clientSnapshot.fantasyName ?? order.clientSnapshot.name}
          </p>
          <p className="text-xs text-charcoal-300 mt-0.5">
            {order.lines.length} {order.lines.length === 1 ? 'línea' : 'líneas'}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="eyebrow">Solicitado</p>
          <p className="text-sm font-semibold text-charcoal-900 mt-0.5 first-letter:uppercase">
            {formatDateShort(order.requestedDate)}
          </p>
        </div>
      </div>

      <ul className="mt-3 pt-3 border-t border-charcoal-100 space-y-1">
        {order.lines.slice(0, 3).map((l) => (
          <li key={`${l.productId}-${l.formatId}`} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-charcoal-500 truncate">{l.productName} · {l.formatLabel}</span>
            <span className="text-charcoal-700 font-medium shrink-0">{formatQty(l.qty, l.unit)}</span>
          </li>
        ))}
        {order.lines.length > 3 && <li className="text-[11px] text-charcoal-300">+ {order.lines.length - 3} más</li>}
      </ul>
    </Link>
  );
}
