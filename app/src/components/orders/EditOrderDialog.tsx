import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import SampleTag from '@/components/orders/SampleTag';
import { ModalShell } from '@/components/orders/OrderDialogs';
import { confirmPin, PinCancelled } from '@/data/pin';
import { deleteOrder, editOrderLines } from '@/data/orders';
import { useProducts } from '@/data/products';
import type { EditLine } from '@/domain/orderEdit';
import { lineKey, sampleLabel } from '@/domain/samples';
import { isSellable, type Order, type Product, type ProductFormat } from '@/domain/types';
import { describeFirestoreError } from '@/lib/errors';
import { formatQty } from '@/lib/format';
import { computeLineSubtotal, formatCLP } from '@/lib/pricing';

// Modificar un pedido antes de facturar (ADR-0018): cambiar cantidades,
// quitar o agregar productos. Las reservas se reajustan solas y armado ve el
// pedido en naranja con el cambio.

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function EditOrderDialog({ order, uid, onClose }: { order: Order; uid: string; onClose: () => void }) {
  const { products } = useProducts();
  const [lines, setLines] = useState<EditLine[]>(() => order.lines.map((l) => ({
    productId: l.productId, productName: l.productName, formatId: l.formatId, formatLabel: l.formatLabel, unit: l.unit,
    qty: l.qty, notes: l.notes, sample: l.sample, sampleGrams: l.sampleGrams,
  })));
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Product | null>(null);
  const [fmt, setFmt] = useState<ProductFormat | null>(null);
  const [addQty, setAddQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const samplesOnly = !!order.samplesHolderUid;

  const results = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return [];
    return products.filter((p) => isSellable(p) && (norm(p.name).includes(n) || (p.aliases ?? []).some((a) => norm(a).includes(n)))).slice(0, 8);
  }, [products, q]);

  const before = new Map(order.lines.map((l) => [lineKey(l), l.qty]));
  const changed = lines.some((l) => before.get(lineKey(l)) !== l.qty) || order.lines.length !== lines.filter((l) => l.qty > 0).length;

  function setQty(i: number, v: number) { setLines((ls) => ls.map((l, k) => (k === i ? { ...l, qty: Math.max(0, v) } : l))); }

  function addLine() {
    if (!picked || !fmt) return;
    const qty = Number(addQty.replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) { setError('Indique una cantidad mayor que cero.'); return; }
    const key = lineKey({ productId: picked.id, formatId: fmt.formatId });
    const subtotalCLP = computeLineSubtotal(fmt, qty);
    setLines((ls) => {
      const i = ls.findIndex((l) => lineKey(l) === key);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, qty: Math.round((l.qty + qty) * 1000) / 1000 } : l));
      return [...ls, { productId: picked.id, productName: picked.name, formatId: fmt.formatId, formatLabel: fmt.label, unit: fmt.unit, qty, subtotalCLP, unitPriceSnapshotCLP: fmt.priceCLP ?? fmt.pricePerKgCLP }];
    });
    setPicked(null); setFmt(null); setQ(''); setAddQty(''); setError(null);
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      await confirmPin('modificar_pedido', `Modificar ${order.id}`, order.id);
      await editOrderLines(order.id, lines, uid, note);
      onClose();
    } catch (e) { if (!(e instanceof PinCancelled)) setError(e instanceof Error && !('code' in e) ? e.message : describeFirestoreError(e)); setBusy(false); }
  }

  return (
    <ModalShell title="Modificar pedido" eyebrow={order.id} onClose={onClose} wide>
      <div className="space-y-4">
        {order.status === 'armado' && <p className="text-xs rounded-md bg-orange-50 border border-orange-200 text-orange-900 p-2">El pedido ya está armado: al modificarlo vuelve a «En armado» para empacar el cambio.</p>}
        <ul className="card divide-y divide-charcoal-100">
          {lines.map((l, i) => (
            <li key={lineKey(l)} className={'p-3 flex items-center gap-3 ' + (l.qty === 0 ? 'opacity-50' : '')}>
              <div className="min-w-0 flex-1">
                <p className={'text-sm text-charcoal-900 ' + (l.qty === 0 ? 'line-through' : '')}>{l.sample && <SampleTag />}{l.productName}</p>
                <p className="text-[11px] text-charcoal-400">{l.formatLabel}{before.has(lineKey(l)) && before.get(lineKey(l)) !== l.qty ? ` · antes ${l.sample ? sampleLabel({ qty: before.get(lineKey(l))!, unit: l.unit }) : formatQty(before.get(lineKey(l))!, l.unit)}` : ''}{!before.has(lineKey(l)) ? ' · nuevo' : ''}</p>
              </div>
              {l.sample ? (
                <span className="text-sm text-charcoal-700">{l.qty > 0 ? sampleLabel(l) : '—'}</span>
              ) : (
                <input type="number" inputMode="decimal" min={0} step={l.unit === 'kg' ? 0.1 : 1} value={l.qty}
                  onChange={(e) => setQty(i, Number(e.target.value))} aria-label={`Cantidad de ${l.productName}`} className="field h-9 w-24 text-sm text-right" />
              )}
              <span className="text-[11px] text-charcoal-400 w-6">{l.sample ? '' : l.unit === 'unidad' ? 'u' : l.unit}</span>
              {l.qty > 0
                ? <button type="button" onClick={() => setQty(i, 0)} className="text-xs underline text-red-700">Quitar</button>
                : <button type="button" onClick={() => setQty(i, before.get(lineKey(l)) ?? 1)} className="text-xs underline text-charcoal-500">Volver</button>}
            </li>
          ))}
        </ul>

        {!samplesOnly && (
          <div className="card p-3 space-y-2">
            <p className="eyebrow">Agregar producto</p>
            {!picked ? (
              <>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto" className="field h-10 text-sm" />
                {results.length > 0 && (
                  <ul className="divide-y divide-charcoal-100 border border-charcoal-100 rounded-md">
                    {results.map((p) => <li key={p.id}><button type="button" onClick={() => { setPicked(p); setFmt(p.formats[0] ?? null); }} className="w-full text-left px-3 py-2 text-sm hover:bg-cream-100">{p.name}</button></li>)}
                  </ul>
                )}
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-charcoal-900">{picked.name}</span>
                <select value={fmt?.formatId ?? ''} onChange={(e) => setFmt(picked.formats.find((f) => f.formatId === e.target.value) ?? null)} className="field h-9 text-sm">
                  {picked.formats.map((f) => <option key={f.formatId} value={f.formatId}>{f.label}</option>)}
                </select>
                <input type="number" inputMode="decimal" min={0} step={fmt?.unit === 'kg' ? 0.1 : 1} value={addQty} onChange={(e) => setAddQty(e.target.value)} placeholder={fmt?.unit === 'kg' ? 'kg' : 'unidades'} className="field h-9 w-24 text-sm" />
                <Button size="sm" onClick={addLine}>Agregar</Button>
                <button type="button" onClick={() => { setPicked(null); setFmt(null); }} className="text-xs underline text-charcoal-500">Cancelar</button>
              </div>
            )}
            <p className="text-[11px] text-charcoal-400">Para agregar una muestra, use «+ Muestra» en un pedido nuevo.</p>
          </div>
        )}

        <div>
          <label className="eyebrow block mb-1.5">Motivo (opcional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: el cliente pidió 2 más de coppa" className="field h-10 text-sm" />
        </div>
        {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
        <p className="text-xs text-charcoal-300">Las reservas de stock se reajustan solas. Armado ve el pedido destacado con el cambio.</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={save} disabled={busy || !changed || !lines.some((l) => l.qty > 0)} className="flex-1">{busy ? 'Guardando…' : 'Guardar cambios'}</Button>
        </div>
      </div>
    </ModalShell>
  );
}

export function DeleteOrderDialog({ order, uid, onClose, onDone }: { order: Order; uid: string; onClose: () => void; onDone?: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (reason.trim().length < 3) { setError('Indique un motivo (mínimo 3 caracteres)'); return; }
    setBusy(true); setError(null);
    try { await confirmPin('eliminar_pedido', `Eliminar ${order.id}`, order.id); await deleteOrder(order.id, uid, reason); onClose(); onDone?.(); }
    catch (e) { if (!(e instanceof PinCancelled)) setError(describeFirestoreError(e)); setBusy(false); }
  }
  return (
    <ModalShell title="Eliminar pedido" eyebrow={order.id} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-charcoal-700">El pedido desaparece de la app (tablero, informes y Panel) y libera su stock. Queda guardado como historia{order.totalCLP ? ` · ${formatCLP(order.totalCLP)}` : ''}.</p>
        <div>
          <label className="eyebrow block mb-1.5">Motivo</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: pedido duplicado, prueba, el cliente lo canceló…" rows={3} className="field h-auto py-2 text-sm resize-none" />
        </div>
        {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button variant="danger" onClick={submit} disabled={busy} className="flex-1">{busy ? '…' : 'Eliminar'}</Button>
        </div>
      </div>
    </ModalShell>
  );
}
