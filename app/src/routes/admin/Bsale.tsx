import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import Stepper from '@/components/ui/Stepper';
import { useCurrentUser } from '@/data/auth';
import { useProducts } from '@/data/products';
import { useBsaleDocuments, useBsaleMockStock, useBsaleReceptions } from '@/data/bsale';
import { syncStockFromBsale, useAllStock, useSyncState } from '@/data/stock';
import { emitDocument, receiveProduction } from '@/integrations/bsale/mockAdmin';
import { describeFirestoreError } from '@/lib/errors';
import { formatQty } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';
import type { ProductFormat } from '@/domain/types';

// "Consola Bsale (simulada)" — the Bsale side of the demo. Lets the presenter
// do what in real life happens inside Bsale: the factory receives finished
// goods, the cashier sells at the counter. superAdmin only.
export default function BsaleConsola() {
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const { products } = useProducts();
  const bsaleStock = useBsaleMockStock();
  const { stock } = useAllStock();
  const { documents } = useBsaleDocuments({ limit: 15 });
  const receptions = useBsaleReceptions(10);
  const sync = useSyncState();
  const [tab, setTab] = useState<'recepcion' | 'venta' | 'documentos'>('recepcion');
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active = useMemo(() => products.filter((p) => p.active && !p.discontinued), [products]);

  // Recepción
  const [productId, setProductId] = useState('');
  const product = active.find((p) => p.id === productId) ?? active[0];
  const [formatId, setFormatId] = useState('');
  const format: ProductFormat | undefined = product?.formats.find((f) => f.formatId === formatId) ?? product?.formats[0];
  const [qty, setQty] = useState(0);
  const [note, setNote] = useState('');

  async function doReceive(andSync: boolean) {
    if (!product || !format || qty <= 0) { setError('Elija producto, formato y cantidad'); return; }
    setBusy(true); setError(null); setFlash(null);
    try {
      const sku = `${product.id}__${format.formatId}`;
      await receiveProduction(sku, qty, uid, note || undefined);
      let msg = `Bsale recibió ${formatQty(qty, format.unit)} de ${product.name} · ${format.label}.`;
      if (andSync) {
        const r = await syncStockFromBsale(uid);
        msg += r.promoted.length ? ` Sync: promovidos ${r.promoted.join(', ')}.` : r.absorbed > 0 ? ` Sync: reasignadas ${r.absorbed}.` : ' Sync OK.';
      }
      setFlash(msg); setQty(0); setNote('');
    } catch (e) { setError(describeFirestoreError(e)); } finally { setBusy(false); }
  }

  // Venta mostrador
  const [saleProductId, setSaleProductId] = useState('');
  const saleProduct = active.find((p) => p.id === saleProductId) ?? active[0];
  const [saleFormatId, setSaleFormatId] = useState('');
  const saleFormat = saleProduct?.formats.find((f) => f.formatId === saleFormatId) ?? saleProduct?.formats[0];
  const [saleQty, setSaleQty] = useState(0);
  const [saleClient, setSaleClient] = useState('Cliente mostrador');

  async function doSale(andSync: boolean) {
    if (!saleProduct || !saleFormat || saleQty <= 0) { setError('Elija producto, formato y cantidad'); return; }
    setBusy(true); setError(null); setFlash(null);
    try {
      const unit = saleFormat.priceCLP ?? ((saleFormat.pricePerKgCLP ?? 0) * (saleFormat.unit === 'kg' ? 1 : (saleFormat.avgWeightKg ?? 1)));
      const d = await emitDocument({
        type: 'boleta',
        clientName: saleClient || 'Cliente mostrador',
        lines: [{ sku: `${saleProduct.id}__${saleFormat.formatId}`, description: `${saleProduct.name} · ${saleFormat.label}`, quantity: saleQty, subtotalCLP: unit * saleQty }],
      });
      let msg = `Boleta ${d.number} emitida en el POS por ${formatCLP(d.totalCLP)}.`;
      if (andSync) {
        const r = await syncStockFromBsale(uid);
        msg += r.compromised.length ? ` ⚠ Stock comprometido en ${r.compromised.length} formato${r.compromised.length === 1 ? '' : 's'}.` : ' Sync OK.';
      }
      setFlash(msg); setSaleQty(0);
    } catch (e) { setError(describeFirestoreError(e)); } finally { setBusy(false); }
  }

  const skuLabel = (sku: string) => {
    const [pid, fid] = sku.split('__');
    const p = products.find((x) => x.id === pid);
    const f = p?.formats.find((x) => x.formatId === fid);
    return p && f ? `${p.name} · ${f.label}` : sku;
  };

  return (
    <div>
      <header className="mb-5">
        <p className="eyebrow">Solo Super Administrador · Simulado</p>
        <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Consola Bsale</h1>
        <p className="text-xs text-charcoal-300 mt-1 max-w-2xl">
          Reemplaza a Bsale durante la demo. Acá pasa lo que en la operación real ocurre dentro de Bsale: la fábrica carga producción terminada y el POS emite boletas/facturas que descuentan stock. La app solo lee el resultado al sincronizar.
          {sync?.at && <> Última sincronización {new Date(sync.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}.</>}
        </p>
      </header>

      <nav className="mb-4 flex gap-1 border-b border-charcoal-100">
        {([['recepcion', 'Recepción de producción'], ['venta', 'Venta en mostrador'], ['documentos', 'Documentos emitidos']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={'px-4 py-2.5 text-xs uppercase tracking-display font-medium border-b-2 transition -mb-px ' + (t === tab ? 'border-brass-500 text-charcoal-900' : 'border-transparent text-charcoal-300 hover:text-charcoal-500')}>{label}</button>
        ))}
      </nav>

      {flash && <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm mb-4">{flash}</div>}
      {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-3 text-sm mb-4">{error}</div>}

      {tab === 'recepcion' && product && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-4 space-y-4">
            <p className="eyebrow">Fábrica → bodega Bsale</p>
            <div>
              <label className="eyebrow block mb-1.5">Producto</label>
              <select value={product.id} onChange={(e) => { setProductId(e.target.value); setFormatId(''); }} className="field">
                {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="eyebrow block mb-1.5">Formato</label>
              <select value={format?.formatId ?? ''} onChange={(e) => setFormatId(e.target.value)} className="field">
                {product.formats.map((f) => <option key={f.formatId} value={f.formatId}>{f.label} · Bsale {formatQty(bsaleStock[`${product.id}__${f.formatId}`] ?? 0, f.unit)}</option>)}
              </select>
            </div>
            <div>
              <label className="eyebrow block mb-1.5">Cantidad recibida</label>
              <Stepper value={qty} onChange={setQty} step={format?.unit === 'kg' ? 0.5 : 1} decimals={format?.unit === 'kg' ? 2 : 0} quick={format?.unit === 'kg' ? [1, 5, 10] : [1, 5, 10, 25]} />
            </div>
            <div>
              <label className="eyebrow block mb-1.5">Lote / nota</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: turno mañana" className="field h-10 text-sm" />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => doReceive(false)} disabled={busy || qty <= 0} className="flex-1">Cargar en Bsale</Button>
              <Button onClick={() => doReceive(true)} disabled={busy || qty <= 0} className="flex-1">Cargar y sincronizar</Button>
            </div>
          </div>
          <div className="card p-4">
            <p className="eyebrow mb-2">Últimas recepciones</p>
            {receptions.length === 0 && <p className="text-xs text-charcoal-300">Sin recepciones simuladas todavía.</p>}
            <ul className="divide-y divide-charcoal-100 text-xs">
              {receptions.map((r) => (
                <li key={r.id} className="py-2 flex justify-between gap-2">
                  <span className="text-charcoal-700 truncate">{skuLabel(r.sku)}{r.note ? <span className="text-charcoal-300"> · {r.note}</span> : null}</span>
                  <span className="shrink-0 text-charcoal-500">+{r.quantity} · {new Date(r.at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab === 'venta' && saleProduct && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-4 space-y-4">
            <p className="eyebrow">POS tienda → boleta</p>
            <p className="text-xs text-charcoal-500">Una venta de mostrador descuenta stock en Bsale. Si toca producto que la app tenía reservado, al sincronizar el pedido queda en rojo (“stock comprometido”).</p>
            <div>
              <label className="eyebrow block mb-1.5">Producto</label>
              <select value={saleProduct.id} onChange={(e) => { setSaleProductId(e.target.value); setSaleFormatId(''); }} className="field">
                {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="eyebrow block mb-1.5">Formato</label>
              <select value={saleFormat?.formatId ?? ''} onChange={(e) => setSaleFormatId(e.target.value)} className="field">
                {saleProduct.formats.map((f) => {
                  const s = stock.get(`${saleProduct.id}__${f.formatId}`);
                  return <option key={f.formatId} value={f.formatId}>{f.label} · Bsale {formatQty(bsaleStock[`${saleProduct.id}__${f.formatId}`] ?? 0, f.unit)} · reservado app {formatQty(s?.reserved ?? 0, f.unit)}</option>;
                })}
              </select>
            </div>
            <div>
              <label className="eyebrow block mb-1.5">Cantidad vendida</label>
              <Stepper value={saleQty} onChange={setSaleQty} step={saleFormat?.unit === 'kg' ? 0.5 : 1} decimals={saleFormat?.unit === 'kg' ? 2 : 0} quick={saleFormat?.unit === 'kg' ? [0.5, 1, 5] : [1, 5, 10]} />
            </div>
            <div>
              <label className="eyebrow block mb-1.5">Cliente</label>
              <input value={saleClient} onChange={(e) => setSaleClient(e.target.value)} className="field h-10 text-sm" />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => doSale(false)} disabled={busy || saleQty <= 0} className="flex-1">Emitir boleta</Button>
              <Button onClick={() => doSale(true)} disabled={busy || saleQty <= 0} className="flex-1">Emitir y sincronizar</Button>
            </div>
          </div>
          <div className="card p-4">
            <p className="eyebrow mb-2">Stock Bsale vs. reservas app</p>
            <ul className="divide-y divide-charcoal-100 text-xs max-h-[28rem] overflow-y-auto">
              {[...stock.values()].filter((s) => s.reserved > 0).sort((a, b) => (a.onHand - a.reserved) - (b.onHand - b.reserved)).map((s) => {
                const sku = `${s.productId}__${s.formatId}`;
                const remote = bsaleStock[sku];
                const comp = (remote ?? s.onHand) < s.reserved;
                return (
                  <li key={sku} className="py-2 flex justify-between gap-2">
                    <span className="text-charcoal-700 truncate">{skuLabel(sku)}</span>
                    <span className={'shrink-0 ' + (comp ? 'text-red-700 font-semibold' : 'text-charcoal-500')}>Bsale {remote ?? '—'} · reserv. {s.reserved}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {tab === 'documentos' && (
        <div className="card divide-y divide-charcoal-100">
          {documents.length === 0 && <p className="p-4 text-xs text-charcoal-300">Sin documentos.</p>}
          {documents.map((d) => (
            <div key={d.id} className="p-3 flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm text-charcoal-900">{d.number}</span>
                  <span className="text-[10px] uppercase tracking-display text-charcoal-300">{d.type}</span>
                  {d.linkedOrderId ? <span className="text-[10px] uppercase tracking-display bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 rounded">{d.linkedOrderId}</span> : <span className="text-[10px] uppercase tracking-display bg-brass-50 text-brass-700 border border-brass-300 px-1.5 rounded">Sin vincular</span>}
                </div>
                <p className="text-charcoal-500 truncate">{d.clientName}{d.clientRut ? ` · ${d.clientRut}` : ''} · {new Date(d.emittedAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}{d.reference ? ` · ref ${d.reference}` : ''}</p>
              </div>
              <span className="font-semibold text-charcoal-900 shrink-0">{formatCLP(d.totalCLP)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
