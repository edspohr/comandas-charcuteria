import { useMemo, useState } from 'react';
import { useClients } from '@/data/clients';
import { useProducts } from '@/data/products';
import { availableFor, useAllStock, useSyncState } from '@/data/stock';
import { formatQty } from '@/lib/format';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { categoryLabel } from '@/domain/categories';
import type { Client } from '@/domain/types';

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
  const { products, loading, error: productsError } = useProducts();
  const { stock, error: stockError } = useAllStock();
  const sync = useSyncState();
  const error = productsError ?? stockError;
  const [q, setQ] = useState('');

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
      <p className="text-xs text-charcoal-300 mb-3">
        Stock según Bsale{sync?.at ? ` · sincronizado ${new Date(sync.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}. Los ajustes se hacen en Bsale.
      </p>
      {loading && !error && <p className="text-sm text-charcoal-300">Cargando…</p>}
      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}
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
                <p className="text-xs text-charcoal-300 mt-0.5">{categoryLabel(p.category)} · {p.formats.length} formato{p.formats.length === 1 ? '' : 's'}</p>
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
                        Bsale {formatQty(s?.onHand ?? 0, f.unit)} · Reserv. {formatQty(s?.reserved ?? 0, f.unit)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={'text-sm font-semibold ' + (av > 0 ? 'text-emerald-700' : 'text-red-700')}>
                        {formatQty(av, f.unit)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </div>

    </div>
  );
}

function ClientesTab() {
  const { clients, loading, error } = useClients();
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
      {loading && !error && <p className="text-sm text-charcoal-300">Cargando…</p>}
      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}
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
