import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import { useCurrentUser } from '@/data/auth';
import { useClients } from '@/data/clients';
import { useProducts } from '@/data/products';
import { ajustarStock, availableFor, useAllStock } from '@/data/stock';
import { formatQty } from '@/lib/format';
import type { Product, ProductFormat, Client } from '@/domain/types';

type Tab = 'productos' | 'clientes';

const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function Catalogo() {
  const [tab, setTab] = useState<Tab>('productos');

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Administración</p>
        <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Catálogo</h1>
      </header>

      <nav className="mb-4 flex gap-1 border-b border-charcoal-100">
        {(['productos', 'clientes'] as const).map((t) => (
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
            {t === 'productos' ? 'Productos' : 'Clientes'}
          </button>
        ))}
      </nav>

      {tab === 'productos' ? <ProductosTab /> : <ClientesTab />}
    </div>
  );
}

function ProductosTab() {
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const { products, loading } = useProducts();
  const { stock } = useAllStock();
  const [q, setQ] = useState('');
  const [adjust, setAdjust] = useState<{ product: Product; format: ProductFormat } | null>(null);

  const filtered = useMemo(() => {
    if (!q.trim()) return products;
    const query = norm(q);
    return products.filter((p) => norm(p.name).includes(query) || (p.aliases ?? []).some((a) => norm(a).includes(query)));
  }, [products, q]);

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar producto"
        className="field mb-4"
      />
      {loading && <p className="text-sm text-charcoal-300">Cargando…</p>}
      <div className="card divide-y divide-charcoal-100">
        {filtered.map((p) => (
          <details key={p.id} className="group">
            <summary className="p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-cream-100/40">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-charcoal-900">{p.name}</span>
                  {p.discontinued && (
                    <span className="text-[10px] uppercase tracking-display bg-charcoal-100 text-charcoal-500 border border-charcoal-200 px-2 py-0.5 rounded">Discontinuado</span>
                  )}
                  {!p.active && (
                    <span className="text-[10px] uppercase tracking-display bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded">Inactivo</span>
                  )}
                </div>
                <p className="text-xs text-charcoal-300 mt-0.5">{p.category} · {p.formats.length} formato{p.formats.length === 1 ? '' : 's'}</p>
              </div>
              <span className="text-charcoal-300 text-sm group-open:rotate-90 transition-transform">›</span>
            </summary>
            <div className="border-t border-charcoal-100 divide-y divide-charcoal-100/70">
              {p.formats.map((f) => {
                const av = availableFor(stock, p.id, f.formatId);
                const s = stock.get(`${p.id}__${f.formatId}`);
                return (
                  <div key={f.formatId} className="flex items-center justify-between gap-3 p-3 pl-6 text-sm">
                    <div className="min-w-0">
                      <p className="text-charcoal-700 font-medium">{f.label}</p>
                      <p className="text-[11px] text-charcoal-300 uppercase tracking-display mt-0.5">
                        En bodega {formatQty(s?.onHand ?? 0, f.unit)} · Reserv. {formatQty(s?.reserved ?? 0, f.unit)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={'text-sm font-semibold ' + (av > 0 ? 'text-emerald-700' : 'text-red-700')}>
                        {formatQty(av, f.unit)}
                      </span>
                      <Button size="sm" variant="secondary" onClick={() => setAdjust({ product: p, format: f })}>
                        Ajustar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </div>

      {adjust && (
        <AjusteStockDialog
          product={adjust.product}
          format={adjust.format}
          current={stock.get(`${adjust.product.id}__${adjust.format.formatId}`)?.onHand ?? 0}
          uid={uid}
          onClose={() => setAdjust(null)}
        />
      )}
    </div>
  );
}

function AjusteStockDialog({
  product, format, current, uid, onClose,
}: {
  product: Product;
  format: ProductFormat;
  current: number;
  uid: string;
  onClose: () => void;
}) {
  const [newQty, setNewQty] = useState<number>(current);
  const [reason, setReason] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const delta = newQty - current;

  async function submit() {
    setBusy(true); setError(null);
    try { await ajustarStock(product.id, format.formatId, newQty, reason, uid); onClose(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-20 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-cream-50 rounded-t-xl sm:rounded-xl shadow-lift p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="eyebrow">Ajuste de stock</p>
            <h2 className="text-lg font-semibold text-charcoal-900 tracking-display uppercase mt-0.5">{product.name}</h2>
            <p className="text-xs text-charcoal-300 mt-0.5">{format.label}</p>
          </div>
          <button onClick={onClose} className="text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center">×</button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="eyebrow">Actual</p>
              <p className="text-lg font-semibold text-charcoal-700 mt-0.5">{formatQty(current, format.unit)}</p>
            </div>
            <div>
              <p className="eyebrow">Nuevo</p>
              <input
                type="number"
                inputMode="decimal"
                step={format.unit === 'kg' ? '0.1' : '1'}
                min="0"
                value={Number.isFinite(newQty) ? newQty : 0}
                onChange={(e) => setNewQty(parseFloat(e.target.value))}
                className="field h-10 text-sm mt-1"
              />
            </div>
          </div>

          <p className={'text-xs uppercase tracking-display ' + (delta === 0 ? 'text-charcoal-300' : delta > 0 ? 'text-emerald-700' : 'text-brass-700')}>
            Delta {delta > 0 ? '+' : ''}{delta} {format.unit === 'kg' ? 'kg' : format.unit === 'g' ? 'g' : 'u'}
          </p>

          <div>
            <label className="eyebrow block mb-1.5">Motivo</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: conteo mensual, merma, traslado a tienda…"
              className="field h-10 text-sm"
            />
          </div>

          {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button onClick={submit} disabled={busy || delta === 0} className="flex-1">{busy ? '…' : 'Guardar'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ClientesTab() {
  const { clients, loading } = useClients();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    if (!q.trim()) return clients;
    const query = norm(q);
    return clients.filter((c: Client) =>
      norm(c.name).includes(query) ||
      norm(c.fantasyName ?? '').includes(query) ||
      norm(c.rut ?? '').includes(query)
    );
  }, [clients, q]);

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar cliente"
        className="field mb-4"
      />
      {loading && <p className="text-sm text-charcoal-300">Cargando…</p>}
      <ul className="space-y-1.5">
        {filtered.map((c) => (
          <li key={c.id} className="card p-3.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-charcoal-900">{c.fantasyName ?? c.name}</span>
              {c.isInternalShop && (
                <span className="text-[10px] uppercase tracking-display bg-charcoal-900 text-cream-50 px-2 py-0.5 rounded">Tienda</span>
              )}
              {!c.invoicingComplete && (
                <span className="text-[10px] uppercase tracking-display bg-brass-100 text-brass-700 border border-brass-300 px-2 py-0.5 rounded">Facturación incompleta</span>
              )}
            </div>
            <div className="text-xs text-charcoal-300 mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
              <span>{c.rut ?? 'Sin RUT'}</span>
              <span>{c.giro ?? 'Sin giro'}</span>
              <span className="truncate">{c.address ?? 'Sin dirección'}</span>
              {c.receivingHours && <span>{c.receivingHours}</span>}
              {c.email && <span className="truncate">{c.email}</span>}
              {c.contactPhone && <span>{c.contactPhone}</span>}
            </div>
            {c.notes && <p className="text-xs text-charcoal-500 mt-1.5 italic">{c.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
