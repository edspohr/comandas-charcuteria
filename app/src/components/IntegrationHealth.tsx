import { Link } from 'react-router-dom';
import { useSyncState } from '@/data/stock';
import { useBsaleSettings } from '@/data/bsaleAdmin';
import { isRealBsale } from '@/integrations/bsale/client';

// Banner when the Bsale sync degrades: two failed runs in a row, or no
// successful run for 40 min during operating hours (the cron runs every 10).
// Shown to the roles that depend on fresh stock; the alert mail covers the
// rest (scripts/setup-alerts.sh).
const STALE_MS = 40 * 60 * 1000;

export default function IntegrationHealth({ canFix }: { canFix: boolean }) {
  const sync = useSyncState();
  const { settings, loading } = useBsaleSettings();
  if (!isRealBsale || loading || !settings.enabled || !sync?.health) return null;
  const h = sync.health;
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago', hour: 'numeric', hour12: false }));
  const inHours = hour >= 6 && hour < 23;
  const stale = inHours && h.lastOkAt != null && Date.now() - h.lastOkAt > STALE_MS;
  const failing = (h.consecutiveFailures ?? 0) >= 2;
  if (!stale && !failing) return null;
  const since = h.lastOkAt ? new Date(h.lastOkAt).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'nunca';
  return (
    <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 text-red-900 px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
      <span>
        <strong>Bsale no se está sincronizando.</strong> Último stock al día: {since}.
        {failing && h.lastError ? <span className="text-red-800/80"> · {h.lastError}</span> : null}
        <span className="block text-xs text-red-800/80">El stock que ve la app puede estar desactualizado: confirme disponibilidad antes de comprometer pedidos grandes.</span>
      </span>
      {canFix && <Link to="/admin/bsale" className="text-xs underline whitespace-nowrap">Ver Conexión Bsale →</Link>}
    </div>
  );
}
