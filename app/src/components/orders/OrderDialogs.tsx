import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import { anularOrder, despacharOrder, entregarOrder, vincularDocumento } from '@/data/orders';
import { useBsaleDocuments } from '@/data/bsale';
import { emitDocumentForOrder } from '@/integrations/bsale/mockAdmin';
import { bsale } from '@/integrations/bsale/MockBsaleClient';
import { describeFirestoreError } from '@/lib/errors';
import { formatCLP } from '@/lib/pricing';
import type { Order } from '@/domain/types';
import type { BsaleDocument } from '@/integrations/bsale/BsaleClient';

// Shared action dialogs for the kanban and the detail screens. Each one owns
// its own busy/error state and calls the data layer directly.

export function ModalShell({ title, eyebrow, onClose, children, wide }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-30 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} bg-cream-50 rounded-t-xl sm:rounded-xl shadow-lift p-5 max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 className="text-lg font-semibold text-charcoal-900 tracking-display uppercase mt-0.5">{title}</h2>
          </div>
          <button onClick={onClose} className="text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center" aria-label="Cerrar">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const COURIERS = ['Retiro cliente', 'Repartidor propio', 'Courier Chilexpress', 'Courier Starken'];

export function DispatchDialog({ order, uid, onClose }: { order: Order; uid: string; onClose: () => void }) {
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

export function DeliverDialog({ order, uid, onClose }: { order: Order; uid: string; onClose: () => void }) {
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

export function AnularDialog({ order, uid, onClose, onDone }: { order: Order; uid: string; onClose: () => void; onDone?: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (reason.trim().length < 3) { setError('Indique un motivo (mínimo 3 caracteres)'); return; }
    setBusy(true); setError(null);
    try { await anularOrder(order.id, uid, reason.trim()); onClose(); onDone?.(); }
    catch (e) { setError(describeFirestoreError(e)); setBusy(false); }
  }
  return (
    <ModalShell title="Anular pedido" eyebrow={order.id} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="eyebrow block mb-1.5">Motivo</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: cliente reprogramó, error de captura…" rows={3} className="field h-auto py-2 text-sm resize-none" />
        </div>
        {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
        <p className="text-xs text-charcoal-300">Las reservas de stock se liberan automáticamente.</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button variant="danger" onClick={submit} disabled={busy} className="flex-1">{busy ? '…' : 'Anular'}</Button>
        </div>
      </div>
    </ModalShell>
  );
}

// Link the document the cashier emitted in Bsale. Lists unlinked documents
// (best matches first: same reference, same RUT, closest total) and offers
// the demo shortcut "Simular emisión en POS" that creates the document in
// the mock Bsale as if the cashier had just done it.
export function VincularDocumentoDialog({ order, uid, onClose, onLinked }: { order: Order; uid: string; onClose: () => void; onLinked?: (doc: BsaleDocument) => void }) {
  const { documents, loading } = useBsaleDocuments({ limit: 60 });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [showPayload, setShowPayload] = useState(false);

  const candidates = useMemo(() => {
    const unlinked = documents.filter((d) => !d.linkedOrderId);
    const score = (d: BsaleDocument) => {
      let s = 0;
      if (d.reference === order.id) s += 100;
      if (d.clientRut && d.clientRut === order.clientSnapshot.rut) s += 20;
      if (order.totalCLP && Math.abs(d.totalCLP - order.totalCLP) / order.totalCLP < 0.05) s += 10;
      return s;
    };
    return unlinked.map((d) => ({ d, s: score(d) })).sort((a, b) => b.s - a.s || b.d.emittedAt - a.d.emittedAt).slice(0, 8);
  }, [documents, order]);

  async function link(d: BsaleDocument) {
    setBusy(d.id); setError(null);
    try { await vincularDocumento(order.id, { id: d.id, number: d.number }, uid); onLinked?.(d); onClose(); }
    catch (e) { setError(describeFirestoreError(e)); setBusy(null); }
  }

  async function simulate() {
    setBusy('simulate'); setError(null);
    try {
      const d = await emitDocumentForOrder(order, order.invoicingComplete ? 'factura' : 'boleta');
      await vincularDocumento(order.id, { id: d.id, number: d.number }, uid);
      onLinked?.(d); onClose();
    } catch (e) { setError(describeFirestoreError(e)); setBusy(null); }
  }

  async function linkManual() {
    const number = manual.trim().toUpperCase();
    if (!number) return;
    const found = documents.find((d) => d.number === number);
    if (found) return link(found);
    setBusy('manual'); setError(null);
    try { await vincularDocumento(order.id, { id: `manual-${number}`, number }, uid); onClose(); }
    catch (e) { setError(describeFirestoreError(e)); setBusy(null); }
  }

  return (
    <ModalShell title="Vincular documento Bsale" eyebrow={order.id} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-charcoal-700">
          La venta se emite en el POS de Bsale. Elegí el documento que corresponde a{' '}
          <span className="font-semibold">{order.clientSnapshot.fantasyName ?? order.clientSnapshot.name}</span>
          {order.totalCLP ? <> · total esperado <span className="font-semibold">{formatCLP(order.totalCLP)}</span></> : null}.
          Al vincularlo se libera la reserva y el pedido pasa a <em>facturado</em>.
        </p>
        {!order.invoicingComplete && (
          <div className="rounded-md bg-brass-50 border border-brass-300 text-brass-700 p-2.5 text-xs">
            Cliente con datos de facturación incompletos — probablemente se emitió boleta.
          </div>
        )}

        <div>
          <p className="eyebrow mb-1.5">Documentos sin vincular en Bsale</p>
          {loading && <p className="text-xs text-charcoal-300">Consultando Bsale…</p>}
          {!loading && candidates.length === 0 && (
            <p className="text-xs text-charcoal-300">No hay documentos sin vincular. Emitilo en el POS y volvé a abrir este diálogo, o usá el atajo de simulación.</p>
          )}
          <ul className="divide-y divide-charcoal-100 card">
            {candidates.map(({ d, s }) => (
              <li key={d.id} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-charcoal-900">{d.number}</span>
                    <span className="text-[10px] uppercase tracking-display text-charcoal-300">{d.type}</span>
                    {s >= 100 && <span className="text-[10px] uppercase tracking-display bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 rounded">Ref. {order.id}</span>}
                  </div>
                  <p className="text-xs text-charcoal-500 truncate">{d.clientName}{d.clientRut ? ` · ${d.clientRut}` : ''} · {new Date(d.emittedAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-charcoal-900">{formatCLP(d.totalCLP)}</p>
                  <Button size="sm" onClick={() => link(d)} disabled={busy != null}>{busy === d.id ? '…' : 'Vincular'}</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="eyebrow block mb-1.5">O ingresá el número a mano</label>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="FA-000824" className="field h-10 text-sm font-mono" />
          </div>
          <Button variant="secondary" onClick={linkManual} disabled={busy != null || !manual.trim()}>Vincular</Button>
        </div>

        <div className="rounded-md border border-dashed border-charcoal-200 p-3">
          <p className="eyebrow mb-1">Demo · Bsale simulado</p>
          <p className="text-xs text-charcoal-500 mb-2">Emite el documento en el POS simulado con las cantidades empacadas y lo vincula en un paso.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={simulate} disabled={busy != null}>{busy === 'simulate' ? 'Emitiendo…' : 'Simular emisión en POS'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowPayload((v) => !v)}>{showPayload ? 'Ocultar payload' : 'Ver payload API'}</Button>
          </div>
          {showPayload && (
            <pre className="mt-2 rounded-md bg-charcoal-900 text-cream-100 text-[11px] leading-relaxed p-3 overflow-auto max-h-56">
{JSON.stringify(bsale.buildPayload(order), null, 2)}
            </pre>
          )}
        </div>

        {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
      </div>
    </ModalShell>
  );
}
