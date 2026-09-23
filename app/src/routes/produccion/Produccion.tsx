import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import { useCurrentUser } from '@/data/auth';
import { needsProduction, useProduccionData, type DemandRow } from '@/data/produccion';
import { syncStockFromBsale, useSyncState } from '@/data/stock';
import { formatDateShort, formatQty } from '@/lib/format';
import { describeFirestoreError } from '@/lib/errors';
import ErrorBanner from '@/components/ui/ErrorBanner';

// Read-only view for production: what the open orders still need vs. what
// Bsale reports. The factory loads finished goods directly in Bsale; the app
// picks them up on sync and promotes the partial orders by itself.
export default function Produccion() {
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const { rows, loading, error } = useProduccionData();
  const sync = useSyncState();
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const urgent = useMemo(() => needsProduction(rows), [rows]);
  const others = useMemo(() => rows.filter((r) => r.toProduce <= 0), [rows]);

  async function doSync() {
    setSyncing(true); setSyncError(null); setFlash(null);
    try {
      const r = await syncStockFromBsale(uid);
      setFlash(
        r.updated === 0 && r.promoted.length === 0
          ? 'Bsale no reporta cambios de stock.'
          : `Stock actualizado en ${r.updated} formato${r.updated === 1 ? '' : 's'}.` +
            (r.absorbed > 0 ? ` Reasignadas ${r.absorbed} u/kg a pedidos pendientes.` : '') +
            (r.promoted.length > 0 ? ` Promovidos: ${r.promoted.join(', ')}.` : ''),
      );
    } catch (e) { setSyncError(describeFirestoreError(e)); }
    finally { setSyncing(false); }
  }

  return (
    <div>
      <header className="mb-6 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">Producción</p>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Demanda vs. stock Bsale</h1>
          <p className="text-xs text-charcoal-300 mt-1">
            La producción terminada se carga en Bsale. {sync?.at ? `Última sincronización ${new Date(sync.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}.` : 'Aún sin sincronizar.'}
          </p>
        </div>
        <Button size="md" onClick={doSync} disabled={syncing}>{syncing ? 'Consultando Bsale…' : 'Sincronizar con Bsale'}</Button>
      </header>

      {flash && <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm mb-4">{flash}</div>}
      {syncError && <div className="mb-4"><ErrorBanner message={syncError} /></div>}
      {loading && !error && <p className="text-sm text-charcoal-300">Cargando…</p>}
      {error && <ErrorBanner message={error} />}

      {!loading && (
        <div className="space-y-6">
          <section>
            <div className="flex items-baseline gap-2 mb-2">
              <p className="eyebrow">A producir (pedidos esperando stock)</p>
              <span className="text-[10px] text-charcoal-300">({urgent.length})</span>
            </div>
            {urgent.length === 0 ? (
              <div className="card p-6 text-center"><p className="text-sm text-charcoal-500">Sin producción pendiente.</p></div>
            ) : (
              <ul className="space-y-2">
                {urgent.map((r) => {
                  const key = `${r.productId}::${r.formatId}`;
                  return (
                    <li key={key}>
                      <DemandCard row={r} isSelected={selectedKey === key} onToggle={() => setSelectedKey((k) => (k === key ? null : key))} />
                    </li>
                  );
                })}
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
                {others.map((r) => <li key={`${r.productId}::${r.formatId}`}><CoverageCard row={r} /></li>)}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function DemandCard({ row, isSelected, onToggle }: { row: DemandRow; isSelected: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className={'block w-full text-left card p-4 transition hover:border-brass-500 hover:shadow-lift ' + (isSelected ? 'border-brass-500 shadow-lift' : '')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{row.formatLabel}</p>
          <p className="font-semibold text-charcoal-900 mt-0.5">{row.productName}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="eyebrow">A producir</p>
          <p className="text-2xl font-semibold text-brass-700 mt-0.5">{formatQty(row.toProduce, row.unit)}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-charcoal-100 text-center">
        <StatCell label="Bsale" value={formatQty(row.onHand, row.unit)} />
        <StatCell label="Reservado" value={formatQty(row.reserved, row.unit)} />
        <StatCell label="Disponible" value={formatQty(row.available, row.unit)} />
      </div>
      {isSelected && row.affectingOrders.length > 0 && (
        <div className="mt-3 pt-3 border-t border-charcoal-100">
          <p className="eyebrow mb-1.5">Pedidos que dependen</p>
          <ul className="space-y-1">
            {row.affectingOrders.map((a) => (
              <li key={`${a.orderId}-${row.formatId}`} className="text-xs flex items-center justify-between gap-2">
                <span className="text-charcoal-500 truncate"><span className="font-mono text-charcoal-300">{a.orderId}</span> · {a.clientName}</span>
                <span className="text-charcoal-700 shrink-0 first-letter:uppercase">
                  {formatDateShort(a.requestedDate)}
                  {a.pendingProductionQty > 0 && <span className="ml-2 text-brass-700">+{formatQty(a.pendingProductionQty, row.unit)}</span>}
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
