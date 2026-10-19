import { useEffect, useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import { anularOrder, despacharOrder, entregarOrder, registrarTraslado, vincularDocumento } from '@/data/orders';
import { useBsaleDocuments } from '@/data/bsale';
import { emitDocumentForOrder } from '@/integrations/bsale/mockAdmin';
import { syncStockFromBsale } from '@/data/stock';
import { bsale, isRealBsale } from '@/integrations/bsale/client';
import { emitInvoice, previewInvoice, type InvoicePreview } from '@/data/bsaleOps';
import { callableMessage } from '@/data/userAdmin';
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
    <ModalShell title={order.kind === 'reposicion' ? 'Recibir en tienda' : 'Marcar entregado'} eyebrow={order.id} onClose={onClose}>
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

// Reposición de tienda armada → traslado en Bsale (consumo + recepción o
// guía, según Bsale → Configuración). Muestra lo que se va a mover.
export function TrasladoDialog({ order, uid, onClose }: { order: Order; uid: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const lines = order.lines.filter((l) => (l.packedQty ?? l.reservedQty) > 0);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await registrarTraslado(order, uid);
      setDone(r.skipped ? 'Traslado registrado en la app (Bsale simulado).' : r.dryRun ? 'Traslado registrado. Bsale está en simulacro: quedó en la bitácora sin enviarse.' : 'Traslado registrado en Bsale.');
    } catch (e) { setError(describeFirestoreError(e)); setBusy(false); }
  }
  return (
    <ModalShell title="Registrar traslado a tienda" eyebrow={order.id} onClose={onClose}>
      <div className="space-y-4">
        {done ? (
          <>
            <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm">{done}</div>
            <Button onClick={onClose} className="w-full">Listo</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-charcoal-700">Sale de la fábrica y entra a la tienda con lo empacado. No se factura.</p>
            <ul className="card divide-y divide-charcoal-100 text-sm">
              {lines.map((l) => (
                <li key={`${l.productId}-${l.formatId}`} className="px-3 py-2 flex justify-between gap-3">
                  <span className="text-charcoal-700">{l.productName} · {l.formatLabel}</span>
                  <span className="font-semibold text-charcoal-900 tabular-nums">{l.packedQty ?? l.reservedQty}{l.unit === 'kg' ? ' kg' : ''}</span>
                </li>
              ))}
            </ul>
            {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button onClick={submit} disabled={busy || lines.length === 0} className="flex-1">{busy ? 'Registrando…' : 'Registrar traslado'}</Button>
            </div>
          </>
        )}
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

  // After linking, Bsale is the only writer of onHand: refresh the mirror
  // right away so availability reflects the counter sale.
  async function afterLink() { try { await syncStockFromBsale(uid); } catch (e) { console.warn('[vincular] sync', e); } }

  async function link(d: BsaleDocument) {
    setBusy(d.id); setError(null);
    try { await vincularDocumento(order.id, { id: d.id, number: d.number }, uid); onLinked?.(d); onClose(); void afterLink(); }
    catch (e) { setError(describeFirestoreError(e)); setBusy(null); }
  }

  async function simulate() {
    setBusy('simulate'); setError(null);
    try {
      const d = await emitDocumentForOrder(order, order.invoicingComplete ? 'factura' : 'boleta');
      await vincularDocumento(order.id, { id: d.id, number: d.number }, uid);
      onLinked?.(d); onClose(); void afterLink();
    } catch (e) { setError(describeFirestoreError(e)); setBusy(null); }
  }

  const manualNumber = manual.trim().toUpperCase();
  const manualValid = /^(FA|BO|GD)-\d{6}$/.test(manualNumber);
  const manualLinkedElsewhere = documents.find((d) => d.number === manualNumber && d.linkedOrderId && d.linkedOrderId !== order.id);

  async function linkManual() {
    if (!manualValid) { setError('Formato esperado: FA-000824, BO-004102 o GD-000310.'); return; }
    if (manualLinkedElsewhere) { setError(`${manualNumber} ya está vinculado al pedido ${manualLinkedElsewhere.linkedOrderId}.`); return; }
    const found = documents.find((d) => d.number === manualNumber);
    if (found) return link(found);
    setBusy('manual'); setError(null);
    try { await vincularDocumento(order.id, { id: `manual-${manualNumber}`, number: manualNumber }, uid); onClose(); void afterLink(); }
    catch (e) { setError(describeFirestoreError(e)); setBusy(null); }
  }

  return (
    <ModalShell title={isRealBsale ? 'Facturar en Bsale' : 'Vincular documento Bsale'} eyebrow={order.id} onClose={onClose} wide>
      <div className="space-y-4">
        {isRealBsale && <EmitirEnBsale order={order} onDone={(d) => { onLinked?.(d as BsaleDocument); }} onClose={onClose} />}
        {isRealBsale && <p className="eyebrow pt-2 border-t border-charcoal-100">¿Ya se emitió en el POS? Vincúlelo</p>}
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
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="FA-000824" className={'field h-10 text-sm font-mono ' + (manual.trim() && !manualValid ? 'border-red-400' : '')} />
            {manual.trim() && !manualValid && <p className="text-[11px] text-red-700 mt-1">Formato FA-000000 / BO-000000 / GD-000000</p>}
            {manualLinkedElsewhere && <p className="text-[11px] text-red-700 mt-1">Ya vinculado a {manualLinkedElsewhere.linkedOrderId}</p>}
          </div>
          <Button variant="secondary" onClick={linkManual} disabled={busy != null || !manualValid || !!manualLinkedElsewhere}>Vincular</Button>
        </div>

        {!isRealBsale && <div className="rounded-md border border-dashed border-charcoal-200 p-3">
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
        </div>}

        {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
      </div>
    </ModalShell>
  );
}

// Emit the invoice/boleta in Bsale from the packed order (real weights, Bsale
// prices) and link it in the same step: no retyping at the POS. Preview first;
// with Bsale in dry-run the payload goes to the write log only.
function EmitirEnBsale({ order, onDone, onClose }: { order: Order; onDone: (d: unknown) => void; onClose: () => void }) {
  const [kind, setKind] = useState<'factura' | 'boleta' | undefined>(undefined);
  const [state, setState] = useState<{ preview: InvoicePreview; writesEnabled: boolean; dryRun: boolean } | null>(null);
  const [busy, setBusy] = useState<'preview' | 'emit' | null>('preview');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setBusy('preview'); setError(null);
    previewInvoice(order.id, kind).then((r) => { if (alive) { setState(r); setBusy(null); } }).catch((e) => { if (alive) { setError(callableMessage(e)); setBusy(null); } });
    return () => { alive = false; };
  }, [order.id, kind]);

  async function emit() {
    setBusy('emit'); setError(null);
    try {
      const r = await emitInvoice(order.id, state?.preview.kind === 'factura' || state?.preview.kind === 'boleta' ? state.preview.kind : undefined);
      if (r.dryRun) setDone('Simulacro: el documento quedó en la bitácora de Bsale sin emitirse. El pedido no cambió.');
      else { setDone(`Emitido ${r.number}. El pedido pasó a "Por despachar".`); onDone(r); }
    } catch (e) { setError(callableMessage(e)); }
    setBusy(null);
  }

  const p = state?.preview;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-charcoal-700">Se emite con lo empacado: kilos reales y precios de la lista de Bsale.</p>
        <div className="flex gap-1">
          {(['factura', 'boleta'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={'rounded-md px-2.5 py-1 text-[11px] uppercase tracking-display border ' + ((p?.kind ?? kind) === k ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500')}>{k}</button>
          ))}
        </div>
      </div>
      {busy === 'preview' && <p className="text-xs text-charcoal-300">Preparando el documento…</p>}
      {p && (
        <>
          <div className="text-xs text-charcoal-500 flex flex-wrap gap-x-4">
            <span><strong className="text-charcoal-900">{p.documentTypeName ?? p.kind}</strong></span>
            <span>{p.client.name}{p.client.rut ? ` · ${p.client.rut}` : ''}{p.client.bsaleClientId ? '' : ' · (nuevo en Bsale)'}</span>
            {p.seller && <span>Vendedor: {p.seller.name}</span>}
          </div>
          <div className="card divide-y divide-charcoal-100 text-sm">
            {p.lines.map((l, i) => (
              <div key={i} className="px-3 py-2 flex justify-between gap-3">
                <span className="min-w-0"><span className="text-charcoal-900">{l.productName}</span> <span className="text-charcoal-300 text-xs">{l.variantLabel}</span></span>
                <span className="shrink-0 tabular-nums text-charcoal-700">{l.quantity} {l.unitLabel} × {formatCLP(Math.round(l.netUnitValue * 1.19))} = <strong>{formatCLP(l.totalCLP)}</strong>{l.priceSource === 'pedido' && <span className="text-brass-700"> *</span>}</span>
              </div>
            ))}
            <div className="px-3 py-2 flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{formatCLP(p.totalCLP)}{p.orderTotalCLP ? <span className="text-xs font-normal text-charcoal-300"> · pedido {formatCLP(p.orderTotalCLP)}</span> : null}</span></div>
          </div>
          {p.warnings.map((w) => <p key={w} className="text-xs text-brass-700">⚠︎ {w}</p>)}
          {p.blocking.map((w) => <p key={w} className="text-xs text-red-700">✕ {w}</p>)}
          {done
            ? <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-2.5 text-sm flex justify-between gap-2"><span>{done}</span><button className="underline text-xs" onClick={onClose}>Cerrar</button></div>
            : <Button className="w-full" onClick={emit} disabled={busy != null || p.blocking.length > 0 || !state?.writesEnabled}>
                {busy === 'emit' ? 'Emitiendo…' : !state?.writesEnabled ? 'Escrituras hacia Bsale apagadas' : state.dryRun ? `Probar en simulacro (${p.kind})` : `Emitir ${p.kind} en Bsale`}
              </Button>}
        </>
      )}
      {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
    </section>
  );
}
