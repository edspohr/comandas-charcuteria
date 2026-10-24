import { useState } from 'react';
import SampleTag from '@/components/orders/SampleTag';
import { lineKey, sampleLabel } from '@/domain/samples';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/ui/Button';
import StatusPill from '@/components/ui/StatusPill';
import { useCurrentUser } from '@/data/auth';
import { useOrder } from '@/data/orders';
import { AnularDialog } from '@/components/orders/OrderDialogs';
import { useUsers } from '@/data/users';
import { formatDateLong, formatQty } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';
import ErrorBannerLazy from '@/components/ui/ErrorBanner';
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/domain/types';

const CANCELLABLE: OrderStatus[] = ['recibido', 'confirmado', 'confirmado_parcial', 'en_armado'];

export default function DetallePedido() {
  const { nameOf } = useUsers();
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const { order, loading, error } = useOrder(orderId ?? null);
  const [anularOpen, setAnularOpen] = useState(false);

  if (error) return <div className="max-w-2xl mx-auto"><ErrorBannerLazy message={error} /></div>;
  if (loading || !order) return <p className="text-sm text-charcoal-300">Cargando…</p>;

  const isMine = order.createdBy === uid;
  const canAnular = isMine && CANCELLABLE.includes(order.status);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-4">
        <Link to="/tablero" className="text-[11px] uppercase tracking-display text-charcoal-300 hover:text-charcoal-700">
          ← Pedidos
        </Link>
      </div>

      <header className="mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] text-charcoal-300 uppercase tracking-display">{order.id}</span>
          <StatusPill status={order.status} />
          {order.invoiceRef && <span className="font-mono text-[11px] text-charcoal-500">{order.invoiceRef}</span>}
          {!order.invoicingComplete && (
            <span className="text-[10px] uppercase tracking-display bg-brass-100 text-brass-700 border border-brass-300 px-2 py-0.5 rounded">
              Facturación incompleta
            </span>
          )}
        </div>
        <h1 className="text-xl font-semibold text-charcoal-900 tracking-display uppercase mt-1">
          <Link to={`/clientes/${order.clientId}`} className="hover:text-brass-700">{order.clientSnapshot.fantasyName ?? order.clientSnapshot.name}</Link>
        </h1>
        <p className="text-xs text-charcoal-300 mt-1 first-letter:uppercase">
          Solicitado para {formatDateLong(order.requestedDate)} · {order.deliveryMode === 'retiro' ? 'Retiro en tienda' : (order.deliveryAddress ?? 'Despacho')}
        </p>
        {order.receivingHours && (
          <p className="text-xs text-charcoal-300">Horario · {order.receivingHours}</p>
        )}
      </header>

      <div className="card mb-4">
        <div className="p-4">
          <p className="eyebrow">Líneas</p>
        </div>
        <ul className="divide-y divide-charcoal-100">
          {order.lines.map((l) => (
            <li key={lineKey(l)} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-charcoal-900">{l.sample && <SampleTag />}{l.productName}</p>
                  <p className="text-xs text-charcoal-300 mt-0.5">{l.formatLabel}</p>
                  {l.notes && <p className="text-xs text-charcoal-500 mt-1 italic">{l.notes}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="eyebrow">{l.sample ? 'Muestra' : 'Vendido'}</p>
                  <p className="font-semibold text-charcoal-700 mt-0.5">{l.sample ? sampleLabel(l) : formatQty(l.qty, l.unit)}</p>
                  {l.reservedQty !== l.qty && l.reservedQty > 0 && (
                    <p className="text-[10px] uppercase tracking-display text-emerald-700 mt-1">
                      Reservado {formatQty(l.reservedQty, l.unit)}
                    </p>
                  )}
                  {l.pendingProductionQty > 0 && (
                    <p className="text-[10px] uppercase tracking-display text-brass-700 mt-0.5">
                      {formatQty(l.pendingProductionQty, l.unit)} a producción
                    </p>
                  )}
                  {l.shortReason ? (
                    <p className="text-[10px] uppercase tracking-display text-red-700 mt-1">Faltó · <span className="normal-case tracking-normal italic">{l.shortReason}</span></p>
                  ) : l.packedQty != null && (
                    <p className="text-[10px] uppercase tracking-display text-charcoal-500 mt-1">
                      Empacado {formatQty(l.packedQty, l.unit)}
                      {l.packedWeightKg != null && <span> · {l.packedWeightKg} kg reales</span>}
                    </p>
                  )}
                  {l.subtotalCLP != null && (
                    <p className="text-xs text-charcoal-700 font-semibold mt-1">{formatCLP(l.subtotalCLP)}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {order.totalCLP != null && order.totalCLP > 0 && (
          <div className="p-4 border-t border-charcoal-100 flex items-center justify-between">
            <span className="eyebrow">Total</span>
            <span className="text-lg font-semibold text-charcoal-900 tracking-display">{formatCLP(order.totalCLP)}</span>
          </div>
        )}
      </div>

      <div className="card p-4 mb-4">
        <p className="eyebrow mb-2">Historial</p>
        <ol className="space-y-1.5">
          {order.statusHistory.map((h, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-charcoal-700 font-medium tracking-[0.02em]">
                {ORDER_STATUS_LABEL[h.status]}
              </span>
              <span className="text-charcoal-300 text-right">
                {nameOf(h.by)} · {new Date(h.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
                {h.note && <span className="block text-charcoal-500 italic">{h.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {canAnular && (
        <>
          <Button variant="danger" onClick={() => setAnularOpen(true)} className="w-full">
            Anular pedido
          </Button>
          {anularOpen && (
            <AnularDialog
              order={order}
              uid={uid}
              onClose={() => setAnularOpen(false)}
              onDone={() => navigate('/tablero')}
            />
          )}
        </>
      )}
    </div>
  );
}
