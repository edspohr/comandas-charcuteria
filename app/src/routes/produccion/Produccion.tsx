import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import Stepper from '@/components/ui/Stepper';
import { useCurrentUser } from '@/data/auth';
import {
  needsProduction,
  registrarProduccion,
  useProductsForProduccion,
  useProduccionData,
  type DemandRow,
} from '@/data/produccion';
import { formatDateShort, formatQty } from '@/lib/format';
import { describeFirestoreError } from '@/lib/errors';
import ErrorBanner from '@/components/ui/ErrorBanner';
import type { ProductFormat } from '@/domain/types';

export default function Produccion() {
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const { rows, loading, error } = useProduccionData();
  const products = useProductsForProduccion();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const urgent = useMemo(() => needsProduction(rows), [rows]);
  const others = useMemo(() => rows.filter((r) => r.toProduce <= 0), [rows]);

  const selected = useMemo(
    () => rows.find((r) => `${r.productId}::${r.formatId}` === selectedKey) ?? null,
    [rows, selectedKey],
  );

  return (
    <div>
      <header className="mb-6 flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Producción</p>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Demanda y stock</h1>
        </div>
        <Button size="md" onClick={() => setDialogOpen(true)}>
          Registrar producción
        </Button>
      </header>

      {loading && !error && <p className="text-sm text-charcoal-300">Cargando…</p>}
      {error && <ErrorBanner message={error} />}

      {!loading && (
        <div className="space-y-6">
          <section>
            <div className="flex items-baseline gap-2 mb-2">
              <p className="eyebrow">Con demanda pendiente</p>
              <span className="text-[10px] text-charcoal-300">({urgent.length})</span>
            </div>
            {urgent.length === 0 ? (
              <div className="card p-6 text-center">
                <p className="text-sm text-charcoal-500">Sin producción pendiente.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {urgent.map((r) => (
                  <li key={`${r.productId}::${r.formatId}`}>
                    <DemandCard
                      row={r}
                      isSelected={selectedKey === `${r.productId}::${r.formatId}`}
                      onToggle={() => setSelectedKey((k) => (k === `${r.productId}::${r.formatId}` ? null : `${r.productId}::${r.formatId}`))}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {others.length > 0 && (
            <section>
              <div className="flex items-baseline gap-2 mb-2">
                <p className="eyebrow">Cobertura actual</p>
                <span className="text-[10px] text-charcoal-300">({others.length})</span>
              </div>
              <ul className="space-y-1.5">
                {others.map((r) => (
                  <li key={`${r.productId}::${r.formatId}`}>
                    <CoverageCard row={r} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {dialogOpen && (
        <RegistrarDialog
          products={products}
          uid={uid}
          initialSelection={selected ?? undefined}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}

function DemandCard({
  row, isSelected, onToggle,
}: {
  row: DemandRow;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={
        'block w-full text-left card p-4 transition hover:border-brass-500 hover:shadow-lift ' +
        (isSelected ? 'border-brass-500 shadow-lift' : '')
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{row.formatLabel}</p>
          <p className="font-semibold text-charcoal-900 mt-0.5">{row.productName}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="eyebrow">A producir</p>
          <p className="text-2xl font-semibold text-brass-700 mt-0.5">
            {formatQty(row.toProduce, row.unit)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-charcoal-100 text-center">
        <StatCell label="En bodega" value={formatQty(row.onHand, row.unit)} />
        <StatCell label="Reservado" value={formatQty(row.reserved, row.unit)} />
        <StatCell label="Disponible" value={formatQty(row.available, row.unit)} />
      </div>

      {isSelected && row.affectingOrders.length > 0 && (
        <div className="mt-3 pt-3 border-t border-charcoal-100">
          <p className="eyebrow mb-1.5">Pedidos que dependen</p>
          <ul className="space-y-1">
            {row.affectingOrders.map((a) => (
              <li key={`${a.orderId}-${row.formatId}`} className="text-xs flex items-center justify-between gap-2">
                <span className="text-charcoal-500 truncate">
                  <span className="font-mono text-charcoal-300">{a.orderId}</span> · {a.clientName}
                </span>
                <span className="text-charcoal-700 shrink-0 first-letter:uppercase">
                  {formatDateShort(a.requestedDate)}
                  {a.pendingProductionQty > 0 && (
                    <span className="ml-2 text-brass-700">+{formatQty(a.pendingProductionQty, row.unit)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </button>
  );
}

function CoverageCard({ row }: { row: DemandRow }) {
  return (
    <div className="card px-4 py-2.5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-charcoal-700 font-medium truncate">{row.productName}</p>
        <p className="text-xs text-charcoal-300 truncate">{row.formatLabel}</p>
      </div>
      <div className="text-right shrink-0 text-xs">
        <p className="text-charcoal-700"><span className="text-charcoal-300">Disp.</span> {formatQty(row.available, row.unit)}</p>
        <p className="text-charcoal-300">Reserv. {formatQty(row.reserved, row.unit)}</p>
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="text-sm font-semibold text-charcoal-700 mt-0.5">{value}</p>
    </div>
  );
}

// ---------- Registrar Producción dialog ----------

function RegistrarDialog({
  products, uid, initialSelection, onClose,
}: {
  products: ReturnType<typeof useProductsForProduccion>;
  uid: string;
  initialSelection?: DemandRow;
  onClose: () => void;
}) {
  const [productId, setProductId] = useState(initialSelection?.productId ?? products[0]?.id ?? '');
  const product = products.find((p) => p.id === productId);
  const [formatId, setFormatId] = useState<string>(
    initialSelection?.formatId ?? (product?.formats[0]?.formatId ?? ''),
  );
  const format: ProductFormat | undefined = product?.formats.find((f) => f.formatId === formatId);
  const [qty, setQty] = useState<number>(0);
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ absorbed: number; promoted: string[] } | null>(null);

  async function submit() {
    if (!product || !format || qty <= 0) { setError('Elija producto, formato y cantidad'); return; }
    setSubmitting(true); setError(null);
    try {
      const r = await registrarProduccion(product.id, format.formatId, qty, uid, reason || undefined);
      setResult(r);
    } catch (e) {
      setError(describeFirestoreError(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-cream-50 rounded-t-xl sm:rounded-xl shadow-lift p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="eyebrow">Producción</p>
            <h2 className="text-lg font-semibold text-charcoal-900 tracking-display uppercase mt-0.5">Registrar</h2>
          </div>
          <button onClick={onClose} className="text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center">×</button>
        </div>

        {result ? (
          <div className="space-y-4">
            <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm">
              Producción registrada. {result.absorbed > 0 && `Reasignadas ${formatQty(result.absorbed, format?.unit ?? 'unidad')} a pedidos pendientes.`}
            </div>
            {result.promoted.length > 0 && (
              <div>
                <p className="eyebrow mb-1">Pedidos promovidos a confirmado</p>
                <ul className="text-xs space-y-0.5">
                  {result.promoted.map((id) => (
                    <li key={id} className="font-mono text-charcoal-700">{id}</li>
                  ))}
                </ul>
              </div>
            )}
            <Button onClick={onClose} className="w-full">Cerrar</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="eyebrow block mb-1.5">Producto</label>
              <select
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  const next = products.find((p) => p.id === e.target.value);
                  setFormatId(next?.formats[0]?.formatId ?? '');
                }}
                className="field"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="eyebrow block mb-1.5">Formato</label>
              <select value={formatId} onChange={(e) => setFormatId(e.target.value)} className="field">
                {product?.formats.map((f) => (
                  <option key={f.formatId} value={f.formatId}>{f.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="eyebrow block mb-1.5">Cantidad producida</label>
              <Stepper
                value={qty}
                onChange={setQty}
                step={format?.unit === 'kg' ? 0.5 : 1}
                decimals={format?.unit === 'kg' ? 2 : 0}
                quick={format?.unit === 'kg' ? [1, 5, 10] : [1, 5, 10, 25]}
              />
            </div>

            <div>
              <label className="eyebrow block mb-1.5">Motivo / lote (opcional)</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej: producción del turno mañana"
                className="field h-10 text-sm"
              />
            </div>

            {error && (
              <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-3 text-sm">{error}</div>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button onClick={submit} disabled={submitting || qty <= 0} className="flex-1">
                {submitting ? 'Registrando…' : 'Registrar'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
