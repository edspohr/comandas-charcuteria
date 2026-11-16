import { usePersistentForm } from '@/lib/persistentForm';
import { downloadCsv } from '@/lib/csv';
import { todayInSantiago } from '@/lib/format';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { useSupplies, useSupplyLots } from '@/data/purchases';
import { useProducts } from '@/data/products';
import { batchCall, batchMetrics, remaining, useProductionBatches, type ProductionBatch } from '@/data/productionBatches';
import { formatCLP } from '@/lib/pricing';
import { PinCancelled } from '@/data/pin';

type Output = { productId: string; formatId: string; qty: number; outputKg: number };
export default function Elaboraciones({ canWrite, supervisor, uid }: { canWrite: boolean; supervisor: boolean; uid: string }) {
  const { batches, error: loadError, loading } = useProductionBatches();
  const supplies = useSupplies(); const lots = useSupplyLots(); const { products } = useProducts();
  const fresh = () => ({ id: crypto.randomUUID(), process: '', note: '', quantities: {} as Record<string, string> });
  const [draft, setDraft] = usePersistentForm(`production-start:${uid}`, fresh);
  const { process, note, quantities } = draft;
  const [creating, setCreating] = useState(false);
  const setProcess = (process: string) => setDraft(d => ({ ...d, process }));
  const setNote = (note: string) => setDraft(d => ({ ...d, note }));
  const setQuantities = (fn: (q: Record<string, string>) => Record<string, string>) => setDraft(d => ({ ...d, quantities: fn(d.quantities) }));
  const [selected, setSelected] = useState<ProductionBatch | null>(null);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [error, setError] = useState<string | null>(null); const [flash, setFlash] = useState(''); const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'open' | 'closed'>('open');
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError(null); setFlash('');
    try { await fn(); } catch (e) { if (!(e instanceof PinCancelled)) setError((e as Error).message); } finally { setBusy(false); }
  }
  async function start() {
    const inputs = Object.entries(quantities).filter(([, q]) => Number(q) > 0).map(([supplyId, q]) => ({ supplyId, qty: Number(q) }));
    await batchCall('productionStart', 'Descontar insumos e iniciar elaboración', { id: draft.id, process, inputs, note });
    setDraft(fresh()); setCreating(false); setFlash('Elaboración iniciada. Los insumos ya están descontados del stock.');
  }
  async function close() {
    if (!selected) return;
    const { entryId } = await batchCall<{ entryId: string }>('productionClose', 'Terminar elaboración y cargar producción', { id: selected.id, outputs });
    setSelected(null); setOutputs([]);
    setFlash('Elaboración terminada y producción guardada.');
    try {
      const result = await batchCall<{ message: string }>('productionSendToBsale', 'Cargar producción terminada en Bsale', { entryId });
      setFlash(result.message);
    } catch (e) { setFlash(`La producción quedó guardada. El envío a Bsale no se confirmó; revise Pendiente en Bsale. ${e instanceof PinCancelled ? '' : (e as Error).message}`); }
  }
  function patch(i: number, value: Partial<Output>) { setOutputs(rows => rows.map((r, j) => j === i ? { ...r, ...value } : r)); }
  const shown = batches.filter(b => filter === 'open' ? b.status === 'en_proceso' : b.status !== 'en_proceso');
  const closed = batches.filter(b => b.status === 'terminada');
  const inputKg = closed.reduce((n, b) => n + b.inputKg, 0), outputKg = closed.reduce((n, b) => n + (b.outputKg ?? 0), 0);
  return <section className="space-y-4">
    <p className="text-sm text-charcoal-500">Primero registre los insumos que usará. Al terminar, cargue los productos y los kilos obtenidos de esa elaboración.</p>
    {(error || loadError || supplies.error || lots.error) && <ErrorBanner message={error || loadError || supplies.error || lots.error || ''} />}
    {flash && <p role="status" className="card p-3 bg-emerald-50 text-sm">{flash}</p>}
    {canWrite && !selected && <Button variant="secondary" disabled={busy} onClick={() => setCreating(v => !v)}>{creating ? 'Cerrar formulario' : process || Object.values(quantities).some(q => Number(q) > 0) ? 'Continuar borrador de elaboración' : 'Iniciar elaboración'}</Button>}
    {canWrite && creating && !selected && <fieldset disabled={busy} className="card p-4 space-y-3">
      <h2 className="font-semibold">Iniciar elaboración</h2>
      <label className="block text-sm">Proceso<input className="field mt-1" placeholder="Ej.: cocción de jamón" maxLength={120} value={process} onChange={e => setProcess(e.target.value)} /></label>
      {supplies.loading || lots.loading ? <p>Cargando insumos…</p> : <div className="grid gap-2 sm:grid-cols-2">{supplies.items.map(s => {
        const balance = lots.items.filter(l => l.supplyId === s.id && (!l.expiry || l.expiry >= todayInSantiago())).reduce((n, l) => n + remaining(l, s.unit), 0);
        return <label key={s.id} className="text-sm">{s.name} · {balance.toLocaleString('es-CL')} {s.unit} disponibles<input aria-label={`Consumir ${s.name}`} className="field mt-1" type="number" min="0" step={s.unit === 'kg' ? '.001' : '1'} value={quantities[s.id] ?? ''} onChange={e => setQuantities(q => ({ ...q, [s.id]: e.target.value }))} placeholder={s.unit} /></label>;
      })}</div>}
      {!supplies.loading && !supplies.items.length && <p className="text-sm">Registre primero los insumos y su recepción en Compras.</p>}
      <label className="block text-sm">Nota (opcional)<input className="field mt-1" value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label>
      <Button disabled={busy || !process.trim() || !Object.values(quantities).some(q => Number(q) > 0) || !!supplies.error || !!lots.error} onClick={() => void action(start)}>Descontar insumos e iniciar</Button>
    </fieldset>}
    {selected && <fieldset disabled={busy} className="card p-4 space-y-3">
      <h2 className="font-semibold">Terminar: {selected.process}</h2>
      <p className="text-xs text-charcoal-500">Los insumos se descontaron al iniciar. Aquí se registra solamente lo obtenido.</p>
      {outputs.map((row, i) => {
        const product = products.find(p => p.id === row.productId); const fmt = product?.formats.find(f => f.formatId === row.formatId);
        return <div key={i} className="border-t pt-3 space-y-2">
          <label className="block text-sm">Producto<select className="field" value={row.productId} onChange={e => { const p = products.find(p => p.id === e.target.value); patch(i, { productId: e.target.value, formatId: p?.formats[0]?.formatId ?? '', qty: 0, outputKg: 0 }); }}><option value="">Seleccione</option>{products.filter(p => p.active && !p.discontinued).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="block text-sm">Formato<select className="field" value={row.formatId} onChange={e => patch(i, { formatId: e.target.value, qty: 0, outputKg: 0 })}>{product?.formats.map(f => <option key={f.formatId} value={f.formatId}>{f.label}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2"><label className="text-sm">Cantidad ({fmt?.unit ?? '—'})<input className="field" type="number" min="0" step={fmt?.unit === 'unidad' ? '1' : '.001'} value={row.qty || ''} onChange={e => { const qty = Number(e.target.value); patch(i, { qty, outputKg: fmt?.unit === 'kg' ? qty : fmt?.unit === 'g' ? qty / 1000 : fmt?.grams ? qty * fmt.grams / 1000 : row.outputKg }); }} /></label><label className="text-sm">Kilos obtenidos<input className="field" type="number" min="0" step=".001" disabled={fmt?.unit === 'kg' || fmt?.unit === 'g'} value={row.outputKg || ''} onChange={e => patch(i, { outputKg: Number(e.target.value) })} /></label></div>
          <button disabled={busy} className="text-sm underline" onClick={() => setOutputs(o => o.filter((_, j) => i !== j))}>Quitar producto</button>
        </div>;
      })}
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => setOutputs(o => [...o, { productId: '', formatId: '', qty: 0, outputKg: 0 }])}>Agregar producto</Button><Button disabled={busy || !outputs.length || outputs.some(o => !o.productId || !o.formatId || o.qty <= 0 || o.outputKg <= 0)} onClick={() => void action(close)}>Confirmar producción</Button><Button variant="secondary" disabled={busy} onClick={() => setSelected(null)}>Volver</Button></div>
    </fieldset>}
    <div className="flex gap-2"><Button variant={filter === 'open' ? 'primary' : 'secondary'} onClick={() => setFilter('open')}>En proceso</Button><Button variant={filter === 'closed' ? 'primary' : 'secondary'} onClick={() => setFilter('closed')}>Resultados</Button></div>
    {filter === 'closed' && closed.length > 0 && <Button variant="secondary" onClick={() => downloadCsv('resultados-produccion', closed.flatMap(b => (b.outputs ?? []).map(o => {
      const m = batchMetrics(b);
      return { elaboracion: b.id, proceso: b.process, fecha: new Date(b.at).toLocaleDateString('es-CL'), producto: o.productName, formato: o.formatLabel, cantidad: o.qty, kgProducto: o.outputKg, kgEntradaElaboracion: b.inputKg, kgSalidaElaboracion: b.outputKg, rendimientoElaboracionPct: m.yieldPct, diferenciaElaboracionKg: m.lossKg, costoInsumosPorKg: m.costPerKg, costoAsignadoPorPeso: m.costPerKg == null ? null : m.costPerKg * o.outputKg, costosCompletos: b.costComplete ? 'sí' : 'no', compras: [...new Set(b.inputs.map(c => c.purchaseId).filter(Boolean))].join(', ') };
    })))}>Exportar resultados</Button>}
    {filter === 'closed' && <div className="card p-3 text-sm space-y-1"><p>{batches.length} elaboraciones registradas · {closed.length} terminadas</p><p>Entrada: {inputKg.toLocaleString('es-CL')} kg · Salida: {outputKg.toLocaleString('es-CL')} kg · Diferencia: {(inputKg - outputKg).toLocaleString('es-CL')} kg</p><p className="text-xs text-charcoal-500">Costo neto de insumos, distribuido entre productos por kilos obtenidos. Un rendimiento superior al 100 % puede indicar ingredientes no registrados. La diferencia de peso no distingue por sí sola merma, subproductos y otros destinos.</p></div>}
    {loading && <p>Cargando elaboraciones…</p>}
    {!loading && !shown.length && <p className="text-sm text-charcoal-500">No hay elaboraciones en esta vista.</p>}
    {shown.map(b => {
      const m = batchMetrics(b);
      return <article className="card p-4 space-y-2" key={b.id}>
        <div className="flex justify-between gap-2"><h3 className="font-semibold">{b.process}</h3><span className="text-xs">{b.status === 'en_proceso' ? 'En proceso' : b.status === 'terminada' ? 'Terminada' : 'Anulada'}</span></div>
        <p className="text-xs text-charcoal-500">{new Date(b.at).toLocaleString('es-CL')} · {b.byName}</p>
        {b.note && <p className="text-sm">{b.note}</p>}
        <details className="text-sm"><summary>Insumos: {b.inputKg.toLocaleString('es-CL')} kg</summary><ul>{b.inputs.map(c => <li key={c.lotId}>{c.supplyName}: {c.qty} {c.unit} · {c.purchaseId ? <a className="underline" href={`/compras?tab=compras&recepcion=${encodeURIComponent(c.purchaseId)}`}>Compra {c.purchaseId}</a> : 'Inventario inicial'}</li>)}</ul></details>
        {b.status === 'terminada' && <><ul className="text-sm">{b.outputs?.map(o => <li key={`${o.productId}_${o.formatId}`}>{o.productName} · {o.formatLabel}: {o.qty} {o.unit} · {o.outputKg} kg</li>)}</ul><p className="text-sm">Rendimiento: {m.yieldPct?.toFixed(1) ?? '—'} % · Diferencia de peso: {m.lossKg?.toFixed(3)} kg · Costo: {m.costPerKg == null ? 'Incompleto: faltan costos de insumos' : `${formatCLP(m.costPerKg)}/kg`}</p></>}
        {b.status === 'en_proceso' && <div className="flex gap-2">{canWrite && <Button disabled={busy} onClick={() => { setSelected(b); setOutputs([{ productId: '', formatId: '', qty: 0, outputKg: 0 }]); }}>Cargar producción</Button>}{supervisor && <Button variant="secondary" disabled={busy} onClick={() => { if (window.confirm('¿Anular la elaboración y devolver todos sus insumos al stock?')) void action(async () => { await batchCall('productionCancel', 'Anular elaboración y devolver insumos', { id: b.id }); setFlash('Elaboración anulada. Los insumos volvieron al stock.'); }); }}>Anular y devolver insumos</Button>}</div>}
      </article>;
    })}
  </section>;
}
