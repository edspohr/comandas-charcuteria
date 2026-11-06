import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { Pill } from '@/components/ui/DataTable';
import { VincularDocumentoDialog, linkDocumentWithPin } from '@/components/orders/OrderDialogs';
import { useCurrentUser } from '@/data/auth';
import { useBsaleDocuments } from '@/data/bsale';
import { useBsaleSettings, useWriteLog } from '@/data/bsaleAdmin';
import { useClients } from '@/data/clients';
import { consumeSamplesAfterInvoice } from '@/data/orders';
import { markSamplesLoadedManually, markTransferLoadedManually, useOrdersAwaitingDocument, useProductionToLoad, useSamplesToRegister, useTransfersToRegister } from '@/data/pendienteBsale';
import { markLoadedInBsale } from '@/data/productionLog';
import { PinCancelled } from '@/data/pin';
import { suggestDocument } from '@/domain/linking';
import { can } from '@/domain/permissions';
import { ORDER_STATUS_LABEL, type Order } from '@/domain/types';
import { describeFirestoreError } from '@/lib/errors';
import { formatDateShort, formatQty } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';

// Pendiente en Bsale: la lista de trabajo de la oficina. Reúne lo que
// todavía no está cerrado en Bsale — pedidos sin documento (con la sugerencia
// del documento emitido en el POS), escrituras que fallaron, producción y
// muestras que no llegaron a Bsale y clientes por revisar.

const ERROR_WINDOW_MS = 7 * 86_400_000;

const WRITE_KIND: Record<string, string> = {
  recepcion_produccion: 'Producción', traslado_consumo: 'Traslado (salida)', traslado_recepcion: 'Traslado (entrada)', traslado_guia: 'Traslado (guía)',
  muestras_consumo: 'Muestras', cliente_alta: 'Cliente nuevo', cliente_edicion: 'Cliente', factura: 'Factura', boleta: 'Boleta',
};

export default function PendienteBsale() {
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const role = current!.appUser.role;
  const canAct = can(role, 'order.link');
  const { settings } = useBsaleSettings();
  const { orders, loading } = useOrdersAwaitingDocument();
  const { documents } = useBsaleDocuments({ limit: 150 });
  const production = useProductionToLoad();
  const samples = useSamplesToRegister();
  const transfers = useTransfersToRegister();
  const writes = useWriteLog(100);
  const { clients } = useClients();
  const [linking, setLinking] = useState<Order | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const since = useMemo(() => Date.now() - ERROR_WINDOW_MS, []);
  const failed = writes.filter((w) => w.status === 'error' && w.at >= since);
  const toReview = clients.filter((c) => c.needsReview).length;
  const withSuggestion = useMemo(() => orders.map((o) => ({ o, d: suggestDocument(o, documents) })), [orders, documents]);
  const writesOn = settings.enabled && settings.writesEnabled;

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id); setError(null);
    try { await fn(); } catch (e) { if (!(e instanceof PinCancelled)) setError(describeFirestoreError(e)); } finally { setBusy(null); }
  }

  const total = orders.length + failed.length + production.length + samples.length + transfers.length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Pendiente en Bsale</h1>
        <p className="text-xs text-charcoal-300 mt-1">
          {total === 0 ? 'Nada pendiente.' : `${total} pendiente${total === 1 ? '' : 's'}`} · escrituras a Bsale {writesOn ? (settings.dryRun ? 'en simulacro' : 'encendidas') : 'apagadas'}
        </p>
      </header>
      {error && <ErrorBanner message={error} />}

      <Section title="Pedidos sin documento" count={orders.length} hint="Emita en el POS de Bsale con los pesos del armado. Si Comandas encuentra el documento (referencia, o mismo RUT y total parecido), lo sugiere: confírmelo con su PIN.">
        {loading ? <Empty>Cargando…</Empty> : orders.length === 0 ? <Empty>Todos los pedidos armados tienen su documento.</Empty> : (
          <ul className="divide-y divide-charcoal-100 card">
            {withSuggestion.map(({ o, d }) => (
              <li key={o.id} className="p-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm">
                    <Link to={`/vendedor/mis/${o.id}`} className="font-mono text-charcoal-900 hover:text-brass-700">{o.id}</Link>{' '}
                    <span className="font-semibold text-charcoal-900">{o.clientSnapshot.fantasyName ?? o.clientSnapshot.name}</span>
                  </p>
                  <p className="text-xs text-charcoal-500">{ORDER_STATUS_LABEL[o.status]} · entrega {formatDateShort(o.requestedDate)}{o.totalCLP ? ` · ${formatCLP(o.totalCLP)}` : ''}</p>
                  {d && <p className="text-xs mt-1"><Pill tone="warn">Sugerido</Pill> <span className="font-mono">{d.number}</span> · {formatCLP(d.totalCLP)} · {new Date(d.emittedAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</p>}
                </div>
                {canAct && (
                  <div className="flex gap-2 shrink-0">
                    {d && <Button size="sm" disabled={busy != null} onClick={() => run(o.id, () => linkDocumentWithPin(o, d, uid))}>{busy === o.id ? '…' : `Confirmar ${d.number}`}</Button>}
                    <Button size="sm" variant={d ? 'ghost' : 'secondary'} disabled={busy != null} onClick={() => setLinking(o)}>{d ? 'Otro' : 'Vincular'}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Escrituras con error (7 días)" count={failed.length} hint="Bsale rechazó estos envíos. Revise el detalle en Conexión Bsale → Bitácora y repita la acción en la app, o hágala a mano en Bsale.">
        {failed.length === 0 ? <Empty>Sin errores.</Empty> : (
          <ul className="divide-y divide-charcoal-100 card">
            {failed.map((w) => (
              <li key={w.id} className="p-3">
                <p className="text-sm"><span className="font-semibold text-charcoal-900">{WRITE_KIND[w.kind] ?? w.kind}</span>{w.ref ? <> · <span className="font-mono">{w.ref}</span></> : null}</p>
                <p className="text-xs text-charcoal-500">{new Date(w.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })} · {errorText(w.error)}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Producción por cargar" count={production.length} hint="Producción que no llegó a Bsale (escrituras apagadas o rechazo de Bsale). Si dice que Bsale la rechazó, revise primero la Bitácora; luego cárguela en Bsale como recepción en la sala de proceso y márquela.">
        {production.length === 0 ? <Empty>Toda la producción está en Bsale.</Empty> : (
          <ul className="space-y-2">
            {production.map((e) => (
              <li key={e.id} className="card p-3">
                <p className="text-xs text-charcoal-500"><span className="font-semibold text-charcoal-900">{new Date(e.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</span> · {e.byName}</p>
                {e.bsaleError && <p className="text-xs text-red-700 mt-1">Bsale la rechazó: {e.bsaleError}</p>}
                <ul className="mt-1 text-sm text-charcoal-700">
                  {e.lines.map((l, i) => <li key={i}><span className="font-semibold">{formatQty(l.qty, l.unit)}</span> {l.productName} <span className="text-charcoal-300 text-xs">· {l.formatLabel}</span></li>)}
                </ul>
                {canAct && <Button size="sm" variant="secondary" className="mt-2" disabled={busy != null} onClick={() => run(e.id, () => markLoadedInBsale(e.id, uid))}>{busy === e.id ? '…' : 'Ya la cargué en Bsale'}</Button>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Traslados a tienda sin registrar en Bsale" count={transfers.length} hint="Salieron a la tienda con las escrituras apagadas. Hágalos en Bsale (consumo en la sala de proceso y recepción en la tienda, referencia TR-pedido) y márquelos.">
        {transfers.length === 0 ? <Empty>Todos los traslados están en Bsale.</Empty> : (
          <ul className="divide-y divide-charcoal-100 card">
            {transfers.map((o) => (
              <li key={o.id} className="p-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm"><span className="font-mono">{o.transferBsale?.ref ?? `TR-${o.id}`}</span> · <span className="text-charcoal-500">{new Date(o.transferBsale?.at ?? o.updatedAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</span></p>
                  <p className="text-xs text-charcoal-500">{o.lines.filter((l) => !l.sample && (l.packedQty ?? l.reservedQty) > 0).map((l) => `${formatQty(l.packedQty ?? l.reservedQty, l.unit)} ${l.productName}`).join(' · ')}</p>
                </div>
                {canAct && <Button size="sm" variant="secondary" disabled={busy != null} onClick={() => run(o.id, () => markTransferLoadedManually(o, uid))}>{busy === o.id ? '…' : 'Ya lo hice a mano'}</Button>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Muestras sin consumo en Bsale" count={samples.length} hint={writesOn ? 'Salieron cuando las escrituras estaban apagadas. «Registrar en Bsale» hace el consumo interno ahora.' : 'Haga el consumo interno en Bsale con la referencia MU-pedido y márquelo.'}>
        {samples.length === 0 ? <Empty>Todas las muestras están en Bsale.</Empty> : (
          <ul className="divide-y divide-charcoal-100 card">
            {samples.map((o) => (
              <li key={o.id} className="p-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm"><span className="font-mono">MU-{o.id}</span> · <span className="font-semibold text-charcoal-900">{o.clientSnapshot.fantasyName ?? o.clientSnapshot.name}</span></p>
                  <p className="text-xs text-charcoal-500">{o.lines.filter((l) => l.sample && !l.shortReason).map((l) => `${formatQty(l.packedQty ?? l.reservedQty, l.unit)} ${l.productName}`).join(' · ')}</p>
                </div>
                {canAct && (
                  <div className="flex gap-2 shrink-0">
                    {writesOn && <Button size="sm" disabled={busy != null} onClick={() => run(o.id, () => consumeSamplesAfterInvoice(o))}>{busy === o.id ? '…' : 'Registrar en Bsale'}</Button>}
                    <Button size="sm" variant="secondary" disabled={busy != null} onClick={() => run(o.id, () => markSamplesLoadedManually(o, uid))}>Ya lo hice a mano</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Clientes por revisar" count={toReview} hint="Clientes creados en la app o del historial de WhatsApp sin su ficha completa en Bsale.">
        {toReview === 0 ? <Empty>Sin clientes por revisar.</Empty> : <Link to="/clientes?filtro=revision" className="text-sm underline text-charcoal-700">Ver los {toReview} clientes en Clientes → Por revisar</Link>}
      </Section>

      {linking && <VincularDocumentoDialog order={linking} uid={uid} onClose={() => setLinking(null)} />}
    </div>
  );
}

function Section({ title, count, hint, children }: { title: string; count: number; hint: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <p className="eyebrow">{title}</p>
        {count > 0 && <span className="rounded-full bg-brass-100 text-brass-700 px-1.5 text-[11px]">{count}</span>}
      </div>
      <p className="text-xs text-charcoal-500 mb-2">{hint}</p>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-charcoal-300">{children}</p>;

function errorText(e: unknown): string {
  if (!e || typeof e !== 'object') return 'error';
  const x = e as { status?: number; message?: string; body?: unknown };
  if (x.message) return x.message;
  const body = typeof x.body === 'string' ? x.body : JSON.stringify(x.body ?? '');
  return `HTTP ${x.status ?? '?'} · ${body.slice(0, 160)}`;
}
