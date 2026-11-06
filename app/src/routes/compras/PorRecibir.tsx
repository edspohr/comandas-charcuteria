import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { Pill } from '@/components/ui/DataTable';
import { ModalShell } from '@/components/orders/OrderDialogs';
import { closePurchaseOrder, createPurchaseOrder, createSupply, updatePurchaseOrder, usePurchaseOrders, useSuppliers, type NewPurchaseOrder } from '@/data/purchases';
import { isOpenOrder, ORDER_STATUS_LABEL, orderProgress, orderTotal, type PurchaseOrder, type PurchaseOrderItem, type Supply, type SupplyKind, type SupplyUnit } from '@/domain/purchases';
import { describeFirestoreError } from '@/lib/errors';
import { addDaysIso, formatDateShort, todayInSantiago } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';

// Compras por recibir (Fase 4): administración registra lo que compró y la
// fábrica recibe contra cada compra. Avance por insumo; parcial hasta
// completarse o hasta que administración la cierre con la diferencia.

const qtyText = (n: number, unit: SupplyUnit) => (unit === 'unidad' ? `${n.toLocaleString('es-CL')} un.` : `${n.toLocaleString('es-CL', { maximumFractionDigits: 1 })} kg`);
const TONE: Record<PurchaseOrder['status'], 'ok' | 'warn' | 'bad' | 'muted' | 'info'> = { por_recibir: 'info', parcial: 'warn', recibida: 'ok', cerrada: 'muted', anulada: 'bad' };

export default function PorRecibir({ me, supplies, canOrder, canReceive, onReceive }: {
  me: { uid: string; name: string }; supplies: Supply[]; canOrder: boolean; canReceive: boolean; onReceive: (po: PurchaseOrder) => void;
}) {
  const { items, loading, error } = usePurchaseOrders();
  const [showClosed, setShowClosed] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrder | 'new' | null>(null);
  const [closing, setClosing] = useState<{ po: PurchaseOrder; cancel: boolean } | null>(null);
  const today = todayInSantiago();
  const open = useMemo(() => items.filter(isOpenOrder).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)), [items]);
  const closed = useMemo(() => items.filter((o) => !isOpenOrder(o)), [items]);

  if (loading) return <p className="text-sm text-charcoal-300">Cargando…</p>;
  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-charcoal-500">{open.length} compra{open.length === 1 ? '' : 's'} por recibir{canReceive ? ' · toque «Recibir» cuando llegue el proveedor' : ''}</p>
        {canOrder && <Button size="sm" onClick={() => setEditing('new')}>+ Nueva compra</Button>}
      </div>
      {open.length === 0 && <p className="card p-4 text-sm text-charcoal-400">{canOrder ? 'No hay compras pendientes. Registre lo que compró con «+ Nueva compra» para que la fábrica lo reciba.' : 'No hay compras pendientes. Si llega algo sin compra registrada, recíbalo igual en «Recibir».'}</p>}
      <ul className="space-y-2">
        {open.map((po) => (
          <OrderCard key={po.id} po={po} late={po.expectedDate < today}>
            <div className="flex flex-wrap gap-2 mt-2">
              {canReceive && <Button size="sm" onClick={() => onReceive(po)}>Recibir</Button>}
              {canOrder && <Button size="sm" variant="secondary" onClick={() => setEditing(po)}>Editar</Button>}
              {canOrder && po.status === 'parcial' && <Button size="sm" variant="secondary" onClick={() => setClosing({ po, cancel: false })}>Cerrar con diferencia</Button>}
              {canOrder && po.status === 'por_recibir' && <button type="button" onClick={() => setClosing({ po, cancel: true })} className="text-xs underline text-red-700">Anular</button>}
            </div>
          </OrderCard>
        ))}
      </ul>
      {closed.length > 0 && (
        <button type="button" onClick={() => setShowClosed((v) => !v)} className="text-xs underline text-charcoal-500">{showClosed ? 'Ocultar' : 'Ver'} compras cerradas ({closed.length})</button>
      )}
      {showClosed && <ul className="space-y-2">{closed.map((po) => <OrderCard key={po.id} po={po} late={false} />)}</ul>}
      {editing && <OrderForm me={me} supplies={supplies} po={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {closing && <CloseDialog po={closing.po} cancel={closing.cancel} uid={me.uid} onClose={() => setClosing(null)} />}
    </div>
  );
}

function OrderCard({ po, late, children }: { po: PurchaseOrder; late: boolean; children?: React.ReactNode }) {
  const rows = orderProgress(po);
  const total = orderTotal(po);
  return (
    <li className={'card p-3 ' + (late ? 'border-l-4 border-l-red-500' : '')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm"><span className="font-semibold text-charcoal-900">{po.supplierName}</span> <span className="font-mono text-[11px] text-charcoal-400">{po.number}</span></p>
          <p className={'text-xs ' + (late ? 'text-red-700 font-semibold' : 'text-charcoal-500')}>Llega {formatDateShort(po.expectedDate)}{late ? ' · atrasada' : ''} · {po.createdByName}{total ? ` · ${formatCLP(total)}` : ''}</p>
        </div>
        <Pill tone={TONE[po.status]}>{ORDER_STATUS_LABEL[po.status]}</Pill>
      </div>
      <ul className="mt-2 space-y-1">
        {rows.map((r) => (
          <li key={r.supplyId} className="text-sm flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">{r.done ? '✓ ' : ''}{r.name}</span>
            <span className="text-xs whitespace-nowrap text-charcoal-600">{qtyText(r.received, r.unit)} / <b>{qtyText(r.qty, r.unit)}</b>{!r.done && r.received > 0 ? <span className="text-brass-700"> · faltan {qtyText(r.pending, r.unit)}</span> : ''}</span>
          </li>
        ))}
      </ul>
      {po.note && <p className="text-xs text-charcoal-600 mt-1">Nota: {po.note}</p>}
      {po.closedNote && <p className="text-xs text-charcoal-600 mt-1">{po.status === 'anulada' ? 'Anulada' : 'Cerrada'}: {po.closedNote}</p>}
      {po.receptions.length > 0 && <p className="text-[11px] text-charcoal-400 mt-1">{po.receptions.length} recepción{po.receptions.length === 1 ? '' : 'es'}</p>}
      {children}
    </li>
  );
}

function OrderForm({ me, supplies, po, onClose }: { me: { uid: string; name: string }; supplies: Supply[]; po: PurchaseOrder | null; onClose: () => void }) {
  const { items: suppliers } = useSuppliers();
  const [supplierName, setSupplierName] = useState(po?.supplierName ?? '');
  const [supplierRut, setSupplierRut] = useState(po?.supplierRut ?? '');
  const [expectedDate, setExpectedDate] = useState(po?.expectedDate ?? addDaysIso(todayInSantiago(), 1));
  const [rows, setRows] = useState<PurchaseOrderItem[]>(po?.items ?? []);
  const [note, setNote] = useState(po?.note ?? '');
  const [pick, setPick] = useState('');
  const [newSupply, setNewSupply] = useState<{ name: string; kind: SupplyKind; unit: SupplyUnit } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = new Set(Object.keys(po?.received ?? {}).filter((k) => (po?.received[k] ?? 0) > 0));

  function addSupply(s: Supply) {
    if (rows.some((r) => r.supplyId === s.id)) return;
    setRows((rs) => [...rs, { supplyId: s.id, supplyName: s.name, unit: s.unit, qty: 0 }]);
    setPick('');
  }
  function onSupplier(name: string) {
    setSupplierName(name);
    const hit = suppliers.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    if (hit && !supplierRut) setSupplierRut(hit.rut);
  }
  async function createAndAdd() {
    if (!newSupply?.name.trim()) return;
    setBusy(true); setError(null);
    try { const s = await createSupply(newSupply, me.uid); addSupply(s); setNewSupply(null); } catch (e) { setError(describeFirestoreError(e)); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError(null);
    const input: NewPurchaseOrder = { supplierName, supplierRut, expectedDate, items: rows, note };
    try { if (po) await updatePurchaseOrder(po, input); else await createPurchaseOrder(input, me); onClose(); }
    catch (e) { setError(e instanceof Error && !('code' in e) ? e.message : describeFirestoreError(e)); setBusy(false); }
  }
  const num = (v: string) => { const n = Number(v.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const dec = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? n : 0; };

  return (
    <ModalShell title={po ? `Editar ${po.number}` : 'Nueva compra'} eyebrow="Lo que llega a la fábrica" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-3 gap-2">
          <label className="sm:col-span-2 text-xs text-charcoal-500">Proveedor
            <input list="po-suppliers" value={supplierName} onChange={(e) => onSupplier(e.target.value)} className="field h-10 text-sm mt-1" placeholder="Nombre del proveedor" />
            <datalist id="po-suppliers">{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
          </label>
          <label className="text-xs text-charcoal-500">RUT (opcional)
            <input value={supplierRut} onChange={(e) => setSupplierRut(e.target.value)} className="field h-10 text-sm mt-1" placeholder="76.123.456-7" />
          </label>
          <label className="text-xs text-charcoal-500">Llega el
            <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="field h-10 text-sm mt-1" />
          </label>
        </div>

        <div className="card divide-y divide-charcoal-100">
          {rows.length === 0 && <p className="p-3 text-sm text-charcoal-400">Agregue los insumos que compró.</p>}
          {rows.map((r, i) => (
            <div key={r.supplyId} className="p-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-charcoal-900 flex-1 min-w-[8rem]">{r.supplyName}</span>
              <input type="number" inputMode="decimal" min={0} step={r.unit === 'kg' ? 0.1 : 1} value={r.qty || ''} placeholder={r.unit === 'kg' ? 'kg' : 'unidades'}
                onChange={(e) => setRows((rs) => rs.map((x, k) => (k === i ? { ...x, qty: dec(e.target.value) } : x)))} aria-label={`Cantidad de ${r.supplyName}`} className="field h-9 w-24 text-sm text-right" />
              <span className="text-xs text-charcoal-400 w-6">{r.unit === 'kg' ? 'kg' : 'un.'}</span>
              <input inputMode="numeric" value={r.priceCLP ? r.priceCLP.toLocaleString('es-CL') : ''} placeholder={`$ por ${r.unit === 'kg' ? 'kg' : 'un.'}`}
                onChange={(e) => setRows((rs) => rs.map((x, k) => (k === i ? { ...x, priceCLP: num(e.target.value) || undefined } : x)))} aria-label={`Precio de ${r.supplyName}`} className="field h-9 w-28 text-sm text-right" />
              {!locked.has(r.supplyId) && <button type="button" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} className="text-xs underline text-red-700">Quitar</button>}
            </div>
          ))}
        </div>

        {!newSupply ? (
          <div className="flex flex-wrap gap-2 items-center">
            <select value={pick} onChange={(e) => { const s = supplies.find((x) => x.id === e.target.value); if (s) addSupply(s); }} className="field h-10 text-sm flex-1 min-w-[12rem]">
              <option value="">+ Agregar insumo…</option>
              {supplies.filter((s) => !rows.some((r) => r.supplyId === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" onClick={() => setNewSupply({ name: '', kind: 'carne', unit: 'kg' })} className="text-xs underline text-charcoal-600">Insumo nuevo</button>
          </div>
        ) : (
          <div className="card p-3 flex flex-wrap gap-2 items-center">
            <input autoFocus value={newSupply.name} onChange={(e) => setNewSupply({ ...newSupply, name: e.target.value })} placeholder="Nombre del insumo (ej. Pierna de cerdo sin hueso)" className="field h-9 text-sm flex-1 min-w-[12rem]" />
            <select value={newSupply.kind} onChange={(e) => setNewSupply({ ...newSupply, kind: e.target.value as SupplyKind })} className="field h-9 text-sm"><option value="carne">Carne</option><option value="otro">Otro</option></select>
            <select value={newSupply.unit} onChange={(e) => setNewSupply({ ...newSupply, unit: e.target.value as SupplyUnit })} className="field h-9 text-sm"><option value="kg">kg</option><option value="unidad">unidades</option></select>
            <Button size="sm" onClick={createAndAdd} disabled={busy || !newSupply.name.trim()}>Crear y agregar</Button>
            <button type="button" onClick={() => setNewSupply(null)} className="text-xs underline text-charcoal-500">Cancelar</button>
          </div>
        )}

        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional): llega en la mañana, viene con guía, etc." className="field h-10 text-sm" />
        {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={save} disabled={busy} className="flex-1">{busy ? 'Guardando…' : po ? 'Guardar cambios' : 'Registrar compra'}</Button>
        </div>
      </div>
    </ModalShell>
  );
}

function CloseDialog({ po, cancel, uid, onClose }: { po: PurchaseOrder; cancel: boolean; uid: string; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = orderProgress(po).filter((r) => !r.done);
  async function go() {
    setBusy(true); setError(null);
    try { await closePurchaseOrder(po, uid, note, cancel); onClose(); } catch (e) { setError(e instanceof Error && !('code' in e) ? e.message : describeFirestoreError(e)); setBusy(false); }
  }
  return (
    <ModalShell title={cancel ? 'Anular compra' : 'Cerrar con diferencia'} eyebrow={po.number} onClose={onClose}>
      <div className="space-y-3">
        {!cancel && pending.length > 0 && <p className="text-sm text-charcoal-700">Quedará sin recibir: {pending.map((r) => `${r.name} ${qtyText(r.pending, r.unit)}`).join(' · ')}.</p>}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={cancel ? 'Motivo: el proveedor no la despachará, error al registrarla…' : 'Motivo: el proveedor no tenía, nota de crédito, etc.'} className="field h-auto py-2 text-sm resize-none" />
        {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Volver</Button>
          <Button variant={cancel ? 'danger' : 'primary'} onClick={go} disabled={busy} className="flex-1">{busy ? '…' : cancel ? 'Anular' : 'Cerrar compra'}</Button>
        </div>
      </div>
    </ModalShell>
  );
}
