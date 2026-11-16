import { usePersistentForm } from '@/lib/persistentForm';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import type { Supply } from '@/domain/purchases';
import { batchCall } from '@/data/productionBatches';
export default function InventarioInicial({ supplies, uid }: { supplies: Supply[]; uid: string }) {
  const [open, setOpen] = useState(false);
  const fresh = () => ({ id: crypto.randomUUID(), supplyId: '', qty: '', cost: '', lot: '', expiry: '' });
  const [draft, setDraft] = usePersistentForm(`initial-stock:${uid}`, fresh);
  const { id, supplyId, qty, cost, lot, expiry } = draft;
  const setSupplyId = (supplyId: string) => setDraft(d => ({ ...d, supplyId }));
  const setQty = (qty: string) => setDraft(d => ({ ...d, qty }));
  const setCost = (cost: string) => setDraft(d => ({ ...d, cost }));
  const setLot = (lot: string) => setDraft(d => ({ ...d, lot }));
  const setExpiry = (expiry: string) => setDraft(d => ({ ...d, expiry })); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [flash, setFlash] = useState('');
  const supply = supplies.find(s => s.id === supplyId);
  async function save() {
    setBusy(true); setError('');
    try {
      await batchCall('supplyInitialStock', 'Registrar existencias iniciales de insumos', { id, supplyId, qty: Number(qty), ...(cost.trim() ? { costPerKg: Number(cost) } : {}), lot, expiry });
      setDraft(fresh()); setFlash('Existencia inicial registrada.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="card p-3 space-y-2">
    <button className="text-sm underline" onClick={() => setOpen(v => !v)}>Registrar existencias iniciales</button>
    {flash && <p role="status" className="text-sm text-emerald-700">{flash}</p>}
    {open && <fieldset disabled={busy} className="space-y-2"><p className="text-xs text-charcoal-500">Para lo que ya estaba en fábrica antes de usar Comandas. Las compras nuevas se registran en Recibir.</p>
      {error && <ErrorBanner message={error} />}
      <label className="block text-sm">Insumo<select className="field" value={supplyId} onChange={e => { setSupplyId(e.target.value); setQty(''); setCost(''); }}><option value="">Seleccione</option>{supplies.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
      <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">Cantidad ({supply?.unit ?? 'kg'})<input className="field" type="number" min="0" step={supply?.unit === 'unidad' ? '1' : '.001'} value={qty} onChange={e => setQty(e.target.value)} /></label>{supply?.unit === 'kg' && <label className="text-sm">Costo neto por kg (si lo conoce)<input className="field" type="number" min="0" value={cost} onChange={e => setCost(e.target.value)} /></label>}<label className="text-sm">Lote<input className="field" value={lot} onChange={e => setLot(e.target.value)} /></label><label className="text-sm">Vencimiento<input className="field" type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></label></div>
      <Button disabled={busy || !supplyId || !(Number(qty) > 0) || (cost !== '' && !(Number(cost) >= 0))} onClick={() => void save()}>Guardar con PIN</Button></fieldset>}
  </div>;
}
