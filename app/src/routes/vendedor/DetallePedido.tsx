import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/ui/Button';
import StatusPill from '@/components/ui/StatusPill';
import { useCurrentUser } from '@/data/auth';
import { anularOrder, useOrder } from '@/data/orders';
import { demoUsers } from '@/data/demo-users';
import { formatDateLong, formatQty } from '@/lib/format';
import { describeFirestoreError } from '@/lib/errors';
import ErrorBannerLazy from '@/components/ui/ErrorBanner';
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/domain/types';

const NAME_BY_UID: Record<string, string> = Object.fromEntries(demoUsers.map((u) => [u.uid, u.displayName]));
const CANCELLABLE: OrderStatus[] = ['recibido', 'confirmado', 'confirmado_parcial', 'en_armado'];

export default function DetallePedido() {
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
        <Link to="/vendedor/mis" className="text-[11px] uppercase tracking-display text-charcoal-300 hover:text-charcoal-700">
          ← Mis pedidos
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
          {order.clientSnapshot.fantasyName ?? order.clientSnapshot.name}
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
            <li key={`${l.productId}-${l.formatId}`} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-charcoal-900">{l.productName}</p>
                  <p className="text-xs text-charcoal-300 mt-0.5">{l.formatLabel}</p>
                  {l.notes && <p className="text-xs text-charcoal-500 mt-1 italic">{l.notes}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="eyebrow">Vendido</p>
                  <p className="font-semibold text-charcoal-700 mt-0.5">{formatQty(l.qty, l.unit)}</p>
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
                  {l.packedQty != null && (
                    <p className="text-[10px] uppercase tracking-display text-charcoal-500 mt-1">
                      Empacado {formatQty(l.packedQty, l.unit)}
                      {l.packedWeightKg != null && <span> · {l.packedWeightKg} kg reales</span>}
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
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
                {NAME_BY_UID[h.by] ?? h.by} · {new Date(h.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
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
              orderId={order.id}
              uid={uid}
              onClose={() => setAnularOpen(false)}
              onDone={() => navigate('/vendedor/mis')}
            />
          )}
        </>
      )}
    </div>
  );
}

function AnularDialog({ orderId, uid, onClose, onDone }: { orderId: string; uid: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (reason.trim().length < 3) { setError('Indique un motivo (mínimo 3 caracteres)'); return; }
    setBusy(true); setError(null);
    try { await anularOrder(orderId, uid, reason.trim()); onDone(); }
    catch (e) { setError(describeFirestoreError(e)); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-20 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-cream-50 rounded-t-xl sm:rounded-xl shadow-lift p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="eyebrow">Anular</p>
            <h2 className="text-lg font-semibold text-charcoal-900 tracking-display uppercase mt-0.5">{orderId}</h2>
          </div>
          <button onClick={onClose} className="text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center">×</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="eyebrow block mb-1.5">Motivo</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: cliente reprogramó, error de captura…"
              rows={3}
              className="field h-auto py-2 text-sm resize-none"
            />
          </div>
          {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
          <p className="text-xs text-charcoal-300">Las reservas de stock se liberan automáticamente.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button variant="danger" onClick={submit} disabled={busy} className="flex-1">{busy ? '…' : 'Anular'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
