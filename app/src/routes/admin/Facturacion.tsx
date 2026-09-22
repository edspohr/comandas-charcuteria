import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import StatusPill from '@/components/ui/StatusPill';
import { useCurrentUser } from '@/data/auth';
import {
  despacharOrder,
  entregarOrder,
  facturarOrder,
  useOrdersByStatuses,
} from '@/data/orders';
import { formatDateShort, formatQty } from '@/lib/format';
import { describeFirestoreError } from '@/lib/errors';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { bsale } from '@/integrations/bsale/MockBsaleClient';
import type { Order } from '@/domain/types';

type Tab = 'facturar' | 'despachar' | 'entregar';

const TAB_STATUSES: Record<Tab, Order['status'][]> = {
  facturar:  ['armado'],
  despachar: ['facturado'],
  entregar:  ['despachado'],
};

const TAB_LABEL: Record<Tab, string> = {
  facturar:  'Por facturar',
  despachar: 'Por despachar',
  entregar:  'Por entregar',
};

export default function Facturacion() {
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const [tab, setTab] = useState<Tab>('facturar');
  const { orders, loading, error } = useOrdersByStatuses(TAB_STATUSES[tab]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ orderId: string; text: string } | null>(null);
  const [dispatchModal, setDispatchModal] = useState<Order | null>(null);
  const [deliverModal, setDeliverModal] = useState<Order | null>(null);
  const [confirmInvoice, setConfirmInvoice] = useState<Order | null>(null);
  const [payloadModal, setPayloadModal] = useState<{ docNumber: string; payload: unknown; orderId: string } | null>(null);

  const incompleteInvoicing = useMemo(() => orders.filter((o) => !o.invoicingComplete), [orders]);

  async function factura(o: Order) {
    setBusyId(o.id); setMessage(null);
    try {
      const res = await facturarOrder(o.id, uid, (order) => bsale.createDocument(order));
      setPayloadModal({ docNumber: res.invoiceRef, payload: res.payload, orderId: o.id });
    } catch (e) {
      setMessage({ orderId: o.id, text: describeFirestoreError(e) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Administración</p>
        <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Facturación y despacho</h1>
      </header>

      <nav className="mb-4 flex gap-1 border-b border-charcoal-100">
        {(['facturar', 'despachar', 'entregar'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              'px-4 py-2.5 text-xs uppercase tracking-display font-medium border-b-2 transition -mb-px ' +
              (t === tab
                ? 'border-brass-500 text-charcoal-900'
                : 'border-transparent text-charcoal-300 hover:text-charcoal-500 hover:border-charcoal-200')
            }
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </nav>

      {tab === 'facturar' && incompleteInvoicing.length > 0 && (
        <div className="rounded-md bg-brass-50 border border-brass-300 text-brass-700 p-3 text-sm mb-4">
          {incompleteInvoicing.length} pedido{incompleteInvoicing.length === 1 ? '' : 's'} con datos de facturación incompletos — se facturará con los datos disponibles.
        </div>
      )}

      {loading && !error && <p className="text-sm text-charcoal-300">Cargando…</p>}
      {error && <ErrorBanner message={error} />}

      {!loading && orders.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-sm text-charcoal-500">Nada por hacer en {TAB_LABEL[tab].toLowerCase()}.</p>
        </div>
      )}

      <ul className="space-y-2">
        {orders.map((o) => (
          <li key={o.id}>
            <div className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] text-charcoal-300 uppercase tracking-display">{o.id}</span>
                    <StatusPill status={o.status} />
                    {o.invoiceRef && (
                      <span className="font-mono text-[11px] text-charcoal-500">{o.invoiceRef}</span>
                    )}
                    {!o.invoicingComplete && tab === 'facturar' && (
                      <span className="text-[10px] uppercase tracking-display bg-brass-100 text-brass-700 border border-brass-300 px-2 py-0.5 rounded">
                        Facturación incompleta
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-charcoal-900 mt-1 truncate">
                    {o.clientSnapshot.fantasyName ?? o.clientSnapshot.name}
                  </p>
                  <p className="text-xs text-charcoal-300 mt-0.5 first-letter:uppercase">
                    Solicitado {formatDateShort(o.requestedDate)} · {o.lines.length} {o.lines.length === 1 ? 'línea' : 'líneas'}
                  </p>
                  <details className="mt-2">
                    <summary className="text-[11px] uppercase tracking-display text-charcoal-300 hover:text-charcoal-500 cursor-pointer">
                      Ver líneas
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {o.lines.map((l) => (
                        <li key={`${l.productId}-${l.formatId}`} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-charcoal-500 truncate">{l.productName} · {l.formatLabel}</span>
                          <span className="text-charcoal-700 font-medium shrink-0">
                            {formatQty(l.packedQty ?? l.reservedQty, l.unit)}
                            {l.packedWeightKg != null && <span className="text-charcoal-300 ml-1">· {l.packedWeightKg} kg reales</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
                <div className="shrink-0">
                  {tab === 'facturar' && (
                    <Button size="md" onClick={() => setConfirmInvoice(o)} disabled={busyId === o.id}>
                      {busyId === o.id ? '…' : 'Facturar'}
                    </Button>
                  )}
                  {tab === 'despachar' && (
                    <Button size="md" onClick={() => setDispatchModal(o)}>Despachar</Button>
                  )}
                  {tab === 'entregar' && (
                    <Button size="md" onClick={() => setDeliverModal(o)}>Marcar entregado</Button>
                  )}
                </div>
              </div>
              {message?.orderId === o.id && (
                <div className="mt-3 rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-xs">{message.text}</div>
              )}
              {o.deliveredBy && (
                <p className="mt-2 text-[11px] text-charcoal-300 uppercase tracking-display">
                  Despachado por {o.deliveredBy}{o.deliveryProof?.note ? ` · ${o.deliveryProof.note}` : ''}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {payloadModal && (
        <PayloadDialog
          docNumber={payloadModal.docNumber}
          orderId={payloadModal.orderId}
          payload={payloadModal.payload}
          onClose={() => setPayloadModal(null)}
        />
      )}

      {dispatchModal && (
        <DispatchDialog
          order={dispatchModal}
          uid={uid}
          onClose={() => setDispatchModal(null)}
        />
      )}

      {deliverModal && (
        <DeliverDialog
          order={deliverModal}
          uid={uid}
          onClose={() => setDeliverModal(null)}
        />
      )}

      {confirmInvoice && (
        <ConfirmInvoiceDialog
          order={confirmInvoice}
          busy={busyId === confirmInvoice.id}
          onCancel={() => setConfirmInvoice(null)}
          onConfirm={async () => {
            const o = confirmInvoice;
            setConfirmInvoice(null);
            await factura(o);
          }}
        />
      )}
    </div>
  );
}

function ConfirmInvoiceDialog({ order, busy, onCancel, onConfirm }: { order: Order; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <ModalShell title="Facturar pedido" eyebrow={order.id} onClose={onCancel}>
      <div className="space-y-4">
        <div>
          <p className="text-sm text-charcoal-700">
            Se emitirá el documento (mock Bsale) para <span className="font-semibold">{order.clientSnapshot.fantasyName ?? order.clientSnapshot.name}</span> con las {order.lines.length} línea{order.lines.length === 1 ? '' : 's'} armada{order.lines.length === 1 ? '' : 's'}.
          </p>
          <p className="text-xs text-charcoal-500 mt-2">
            La operación no se puede deshacer desde la app — el número queda asignado al pedido.
          </p>
        </div>
        {!order.invoicingComplete && (
          <div className="rounded-md bg-brass-50 border border-brass-300 text-brass-700 p-2.5 text-xs">
            Datos de facturación del cliente incompletos. Se emitirá igual y queda marcado.
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy} className="flex-1">Cancelar</Button>
          <Button onClick={onConfirm} disabled={busy} className="flex-1">
            {busy ? '…' : 'Facturar'}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-20 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-cream-50 rounded-t-xl sm:rounded-xl shadow-lift p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 className="text-lg font-semibold text-charcoal-900 tracking-display uppercase mt-0.5">{title}</h2>
          </div>
          <button onClick={onClose} className="text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PayloadDialog({ docNumber, orderId, payload, onClose }: { docNumber: string; orderId: string; payload: unknown; onClose: () => void }) {
  return (
    <ModalShell title="Documento generado" eyebrow="Mock Bsale" onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm">
          <span className="font-mono">{docNumber}</span> emitido para <span className="font-mono">{orderId}</span>.
        </div>
        <p className="eyebrow">Payload enviado (simulado)</p>
        <pre className="rounded-md bg-charcoal-900 text-cream-100 text-[11px] leading-relaxed p-3 overflow-auto max-h-64">
{JSON.stringify(payload, null, 2)}
        </pre>
        <Button onClick={onClose} className="w-full">Cerrar</Button>
      </div>
    </ModalShell>
  );
}

const COURIERS = ['Retiro cliente', 'Repartidor propio', 'Courier Chilexpress', 'Courier Starken'];

function DispatchDialog({ order, uid, onClose }: { order: Order; uid: string; onClose: () => void }) {
  const [deliveredBy, setDeliveredBy] = useState<string>(order.deliveryMode === 'retiro' ? 'Retiro cliente' : 'Repartidor propio');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await despacharOrder(order.id, uid, deliveredBy, note || undefined); onClose(); }
    catch (e) { setError(describeFirestoreError(e)); setBusy(false); }
  }
  return (
    <ModalShell title="Despachar pedido" eyebrow={order.id} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="eyebrow block mb-1.5">Entregado por</label>
          <select value={deliveredBy} onChange={(e) => setDeliveredBy(e.target.value)} className="field">
            {COURIERS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="eyebrow block mb-1.5">Nota (opcional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Guía, patente, referencia interna…" className="field h-10 text-sm" />
        </div>
        {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={submit} disabled={busy} className="flex-1">{busy ? '…' : 'Despachar'}</Button>
        </div>
      </div>
    </ModalShell>
  );
}

function DeliverDialog({ order, uid, onClose }: { order: Order; uid: string; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await entregarOrder(order.id, uid, note || undefined); onClose(); }
    catch (e) { setError(describeFirestoreError(e)); setBusy(false); }
  }
  return (
    <ModalShell title="Marcar entregado" eyebrow={order.id} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="eyebrow block mb-1.5">Confirmación de entrega</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: recibido por chef Andrés" className="field h-10 text-sm" />
        </div>
        {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={submit} disabled={busy} className="flex-1">{busy ? '…' : 'Confirmar entrega'}</Button>
        </div>
      </div>
    </ModalShell>
  );
}
