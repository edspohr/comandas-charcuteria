import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/ui/Button';
import Stepper from '@/components/ui/Stepper';
import StatusPill from '@/components/ui/StatusPill';
import { useCurrentUser } from '@/data/auth';
import { assignPacker, markArmado, useOrder } from '@/data/orders';
import { formatDateLong, formatQty } from '@/lib/format';
import { describeFirestoreError } from '@/lib/errors';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { formatCLP } from '@/lib/pricing';
import { demoUsers } from '@/data/demo-users';
import { ORDER_STATUS_LABEL } from '@/domain/types';

const NAME_BY_UID: Record<string, string> = Object.fromEntries(
  demoUsers.map((u) => [u.uid, u.displayName]),
);

interface PackedState { packedQty: number; packedWeightKg: string; short: boolean; shortReason: string; }

export default function DetalleArmado() {
  const { orderId } = useParams<{ orderId: string }>();
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const navigate = useNavigate();
  const { order, loading, error: loadError } = useOrder(orderId ?? null);

  const [state, setState] = useState<Record<string, PackedState>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!order) return;
    // Initialize inputs from reservedQty (assumed default packed amount).
    setState(Object.fromEntries(order.lines.map((l) => [
      `${l.productId}::${l.formatId}`,
      {
        packedQty: l.packedQty ?? l.reservedQty,
        packedWeightKg: l.packedWeightKg != null ? String(l.packedWeightKg) : '',
        short: !!l.shortReason,
        shortReason: l.shortReason ?? '',
      },
    ])));
  }, [order]);

  const mine = order?.assignedPackerId === uid;
  const anyPendingProduction = order?.lines.some((l) => l.pendingProductionQty > 0) ?? false;
  const canTake = order && (!order.assignedPackerId || mine) && (order.status === 'confirmado' || order.status === 'confirmado_parcial') && !anyPendingProduction;
  const canPack = order && mine && order.status === 'en_armado' && !anyPendingProduction;
  const isDone = order && (order.status === 'armado' || order.status === 'facturado' || order.status === 'despachado' || order.status === 'entregado');

  const anyPacked = useMemo(
    () => order?.lines.some((l) => {
      const s = state[`${l.productId}::${l.formatId}`];
      if (!s) return false;
      return s.short || (s.packedQty ?? 0) > 0;
    }) ?? false,
    [order, state],
  );
  const missingReasons = useMemo(
    () => order?.lines.some((l) => {
      const s = state[`${l.productId}::${l.formatId}`];
      return s?.short && !s.shortReason.trim();
    }) ?? false,
    [order, state],
  );

  async function take() {
    if (!order) return;
    setError(null);
    try { await assignPacker(order.id, uid); } catch (e) { setError(describeFirestoreError(e)); }
  }

  async function done() {
    if (!order) return;
    setSubmitting(true); setError(null);
    try {
      await markArmado(
        order.id,
        order.lines.map((l) => {
          const k = `${l.productId}::${l.formatId}`;
          const s = state[k];
          const parsedWeight = s?.packedWeightKg ? Number(s.packedWeightKg) : undefined;
          if (s?.short) {
            return { productId: l.productId, formatId: l.formatId, packedQty: 0, shortReason: s.shortReason.trim() || 'Faltó' };
          }
          return {
            productId: l.productId,
            formatId: l.formatId,
            packedQty: s?.packedQty ?? l.reservedQty,
            packedWeightKg: Number.isFinite(parsedWeight) ? parsedWeight : undefined,
          };
        }),
        uid,
      );
      navigate('/tablero', { state: { armadoOk: order.id } });
    } catch (e) {
      setError(describeFirestoreError(e));
      setSubmitting(false);
    }
  }

  if (loadError) return <div className="max-w-2xl mx-auto"><ErrorBanner message={loadError} /></div>;
  if (loading || !order) return <p className="text-sm text-charcoal-300">Cargando…</p>;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-4">
        <Link to="/tablero" className="text-[11px] uppercase tracking-display text-charcoal-300 hover:text-charcoal-700">
          ← Tablero
        </Link>
      </div>

      <header className="mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] text-charcoal-300 uppercase tracking-display">{order.id}</span>
          <StatusPill status={order.status} />
        </div>
        <h1 className="text-xl font-semibold text-charcoal-900 tracking-display uppercase mt-1">
          <Link to={`/clientes/${order.clientId}`} className="hover:text-brass-700">{order.clientSnapshot.fantasyName ?? order.clientSnapshot.name}</Link>
        </h1>
        <p className="text-xs text-charcoal-300 mt-1 first-letter:uppercase">
          Solicitado para {formatDateLong(order.requestedDate)} · {order.deliveryMode === 'retiro' ? 'Retiro' : (order.deliveryAddress ?? 'Despacho')}
        </p>
      </header>

      {canTake && (
        <div className="card p-4 mb-4 bg-brass-50 border-brass-300">
          <p className="text-sm text-charcoal-700 mb-3">
            {order.assignedPackerId ? 'Este pedido está asignado a usted.' : 'Este pedido está sin asignar.'}
          </p>
          <Button onClick={take} className="w-full">
            {order.assignedPackerId ? 'Comenzar armado' : 'Tomar este pedido'}
          </Button>
        </div>
      )}

      {anyPendingProduction && (order.status === 'confirmado_parcial' || order.status === 'en_armado') && (
        <div className="rounded-md bg-brass-50 border border-brass-300 text-brass-700 p-3 text-sm mb-4">
          Este pedido tiene líneas esperando stock. Se libera para armar cuando Bsale reporte la producción (sincronización).
        </div>
      )}

      {!canTake && !canPack && order.assignedPackerId && !mine && (
        <div className="card p-4 mb-4">
          <p className="text-sm text-charcoal-500">
            Asignado a <span className="font-semibold text-charcoal-700">{NAME_BY_UID[order.assignedPackerId] ?? 'otro armador'}</span>.
          </p>
        </div>
      )}

      <div className="card divide-y divide-charcoal-100">
        <div className="p-4">
          <p className="eyebrow">Líneas a armar</p>
        </div>
        {order.lines.map((line) => {
          const k = `${line.productId}::${line.formatId}`;
          const s = state[k] ?? { packedQty: line.reservedQty, packedWeightKg: '', short: false, shortReason: '' };
          const packed = s.packedQty;
          const readOnly = !canPack;
          const showWeight = line.unit !== 'kg';  // extra field only when line's unit isn't already kg
          const parsedWeight = s.packedWeightKg ? Number(s.packedWeightKg) : undefined;
          const showWeightDelta = readOnly && line.packedWeightKg != null;

          return (
            <div key={k} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-charcoal-900">{line.productName}</p>
                  <p className="text-xs text-charcoal-300 mt-0.5">{line.formatLabel}</p>
                  {line.notes && <p className="text-xs text-charcoal-500 mt-1 italic">{line.notes}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="eyebrow">Vendido</p>
                  <p className="font-semibold text-charcoal-700 mt-0.5">{formatQty(line.qty, line.unit)}</p>
                  {line.reservedQty !== line.qty && (
                    <p className="text-[10px] uppercase tracking-display text-brass-700 mt-0.5">
                      Reserv. {formatQty(line.reservedQty, line.unit)}
                    </p>
                  )}
                </div>
              </div>

              {line.unitPriceSnapshotCLP != null && (() => {
                // Live subtotal preview: recomputes as the packer types weight
                // so they know the invoice impact of the merma.
                const previewSub = line.unit === 'kg'
                  ? packed * line.unitPriceSnapshotCLP
                  : (Number.isFinite(parsedWeight) && parsedWeight! > 0
                      ? parsedWeight! * line.unitPriceSnapshotCLP
                      : packed * line.unitPriceSnapshotCLP);
                if (!Number.isFinite(previewSub) || previewSub <= 0) return null;
                return (
                  <p className="mt-2 text-xs text-charcoal-500">
                    {readOnly ? 'Subtotal' : 'Subtotal estimado'} · <span className="font-semibold text-charcoal-700">{formatCLP(previewSub)}</span>
                  </p>
                );
              })()}

              <div className="mt-3 pt-3 border-t border-charcoal-100">
                <p className="eyebrow mb-2">Empacado</p>
                {readOnly ? (
                  line.shortReason ? (
                    <div className="rounded-md bg-red-50 border border-red-200 text-red-800 px-2.5 py-1.5 text-sm">
                      Faltó · <em className="not-italic text-red-700">{line.shortReason}</em>
                    </div>
                  ) : (
                    <p className="text-sm text-charcoal-700 font-medium">
                      {line.packedQty != null ? formatQty(line.packedQty, line.unit) : '—'}
                      {showWeightDelta && (
                        <span className="ml-2 text-xs text-charcoal-300">
                          · peso real {line.packedWeightKg} kg
                        </span>
                      )}
                    </p>
                  )
                ) : (
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-xs text-charcoal-700">
                      <input type="checkbox" checked={s.short} onChange={(e) => setState((prev) => ({ ...prev, [k]: { ...s, short: e.target.checked, packedQty: e.target.checked ? 0 : line.reservedQty } }))} className="w-4 h-4 accent-red-700" />
                      Faltó — no pude empacar esta línea
                    </label>
                    {s.short ? (
                      <div>
                        <label className="text-[11px] uppercase tracking-display text-charcoal-300 block mb-1">Motivo *</label>
                        <input
                          value={s.shortReason}
                          onChange={(e) => setState((prev) => ({ ...prev, [k]: { ...s, shortReason: e.target.value } }))}
                          placeholder="Ej: se rompió al cortar, calidad no aceptable, no había en cámara"
                          className={'field h-10 text-sm ' + (s.short && !s.shortReason.trim() ? 'border-red-400' : '')}
                        />
                      </div>
                    ) : (
                      <>
                        <Stepper
                          value={packed}
                          onChange={(v) => setState((prev) => ({ ...prev, [k]: { ...s, packedQty: v } }))}
                          step={line.unit === 'kg' ? 0.5 : 1}
                          decimals={line.unit === 'kg' ? 2 : 0}
                          quick={line.unit === 'kg' ? [0.5, 1, 5] : [1, 5, 10]}
                        />
                        {showWeight && (
                          <div>
                            <label className="text-[11px] uppercase tracking-display text-charcoal-300 block mb-1">
                              Peso real (kg) — opcional
                            </label>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.1"
                              placeholder="Solo si difiere del vendido"
                              value={s.packedWeightKg}
                              onChange={(e) => setState((prev) => ({ ...prev, [k]: { ...s, packedWeightKg: e.target.value } }))}
                              className="field h-10 text-sm"
                            />
                            {Number.isFinite(parsedWeight) && parsedWeight !== undefined && line.unit === 'unidad' && (
                              <p className="text-[11px] text-charcoal-300 mt-1">
                                Registrará peso real de {parsedWeight} kg
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {order.totalCLP != null && order.totalCLP > 0 && (
          <div className="p-4 border-t border-charcoal-100 flex items-center justify-between">
            <span className="eyebrow">Total {order.status === 'armado' ? 'a facturar' : 'estimado'}</span>
            <span className="text-lg font-semibold text-charcoal-900 tracking-display">{formatCLP(order.totalCLP)}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-3 text-sm mt-4">{error}</div>
      )}

      {canPack && (
        <div className="mt-5 sticky bottom-0 bg-cream-50 border-t border-charcoal-100 pt-4 pb-2">
          <Button
            onClick={done}
            disabled={submitting || !anyPacked || missingReasons}
            size="lg"
            className="w-full"
          >
            {submitting ? 'Registrando…' : missingReasons ? 'Falta el motivo del faltante' : 'Marcar armado'}
          </Button>
        </div>
      )}

      {isDone && (
        <div className="card p-4 mt-4">
          <p className="eyebrow mb-2">Historial</p>
          <ol className="space-y-1 text-xs">
            {order.statusHistory.map((h, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="text-charcoal-700 font-medium">{ORDER_STATUS_LABEL[h.status]}</span>
                <span className="text-charcoal-300">
                  {NAME_BY_UID[h.by] ?? h.by} · {new Date(h.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
