import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ErrorBanner from '@/components/ui/ErrorBanner';
import DataTable, { Pill } from '@/components/ui/DataTable';
import { useProducts } from '@/data/products';
import { availableFor, useAllStock, useStockMovements, useSyncState } from '@/data/stock';
import { categoryLabel, categoryOrder } from '@/domain/categories';
import { formatQty } from '@/lib/format';
import { formatCLP, unitPriceLabel } from '@/lib/pricing';
import type { Product, ProductFormat, StockDoc } from '@/domain/types';

const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');

const MOV_LABEL: Record<string, string> = {
  reserva: 'Reserva', liberacion: 'Liberación', consumo: 'Consumo', produccion: 'Producción', ajuste: 'Ajuste',
  traslado_tienda: 'Traslado', sync_bsale: 'Sync Bsale', venta_bsale: 'Venta Bsale',
};

interface FormatRow {
  key: string;
  product: Product;
  format: ProductFormat;
  first: boolean;         // first format of its product → show the product name
  stock: StockDoc | undefined;
  available: number;
}

// One row per product+format so a single scroll shows price, Bsale stock,
// reservations and availability for the whole catalog. Row click → bitácora.
export default function Catalogo() {
  const { products, loading, error: productsError } = useProducts();
  const { stock, error: stockError } = useAllStock();
  const sync = useSyncState();
  const error = productsError ?? stockError;
  const [q, setQ] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);

  const rows = useMemo<FormatRow[]>(() => {
    const needle = norm(q.trim());
    const list = products
      .filter((p) => !needle || norm(p.name).includes(needle) || (p.aliases ?? []).some((a) => norm(a).includes(needle)) || norm(categoryLabel(p.category)).includes(needle))
      .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category) || a.name.localeCompare(b.name, 'es'));
    const out: FormatRow[] = [];
    for (const p of list) {
      p.formats.forEach((f, i) => {
        const s = stock.get(`${p.id}__${f.formatId}`);
        const av = availableFor(stock, p.id, f.formatId);
        const compromised = !!s && s.onHand < s.reserved;
        if (onlyIssues && !(compromised || av <= 0)) return;
        out.push({ key: `${p.id}__${f.formatId}`, product: p, format: f, first: i === 0, stock: s, available: av });
      });
    }
    return out;
  }, [products, stock, q, onlyIssues]);

  const issues = useMemo(() => rows.filter((r) => r.stock && (r.stock.onHand < r.stock.reserved || r.available <= 0)).length, [rows]);

  return (
    <div>
      <header className="mb-4 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">Administración</p>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Catálogo</h1>
          <p className="text-xs text-charcoal-300 mt-1">
            {products.length} productos · {rows.length} formatos · stock según Bsale{sync?.at ? ` (sincronizado ${new Date(sync.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })})` : ''} · los ajustes se hacen en Bsale · tocá una fila para ver la bitácora
          </p>
        </div>
        <Link to="/clientes" className="text-[11px] uppercase tracking-display text-charcoal-500 hover:text-charcoal-900 border border-charcoal-200 rounded-md px-3 py-1.5">Clientes →</Link>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Producto, alias o categoría" className="field h-9 text-sm w-full sm:w-72" />
        <button onClick={() => setOnlyIssues((v) => !v)} className={'rounded-md px-2.5 py-1.5 text-[11px] uppercase tracking-display font-medium border transition ' + (onlyIssues ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500 hover:border-charcoal-300')}>
          Solo sin stock / comprometidos{issues > 0 && <span className="ml-1 rounded-full bg-brass-100 text-brass-700 px-1.5">{issues}</span>}
        </button>
      </div>

      {loading && !error && <p className="text-sm text-charcoal-300">Cargando…</p>}
      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}

      <DataTable<FormatRow>
        rows={rows}
        rowKey={(r) => r.key}
        dense
        rowTone={(r) => (r.stock && r.stock.onHand < r.stock.reserved ? 'bad' : r.available <= 0 ? 'warn' : undefined)}
        columns={[
          { key: 'product', label: 'Producto', mobile: true, render: (r) => r.first ? (
            <div>
              <p className="font-semibold text-charcoal-900">{r.product.name}</p>
              <p className="text-[10px] uppercase tracking-display text-charcoal-300">{categoryLabel(r.product.category)}{r.product.discontinued ? ' · discontinuado' : ''}{!r.product.active ? ' · inactivo' : ''}</p>
            </div>
          ) : <span className="text-charcoal-200">↳</span> },
          { key: 'format', label: 'Formato', mobile: true, render: (r) => <span className="text-charcoal-700">{r.format.label}</span> },
          { key: 'price', label: 'Precio', align: 'right', render: (r) => <span className="text-xs">{unitPriceLabel(r.format) || '—'}</span>, muted: true },
          { key: 'bsale', label: 'Bsale', align: 'right', render: (r) => formatQty(r.stock?.onHand ?? 0, r.format.unit) },
          { key: 'reserved', label: 'Reserv.', align: 'right', render: (r) => formatQty(r.stock?.reserved ?? 0, r.format.unit), muted: true },
          { key: 'available', label: 'Disp.', align: 'right', mobile: true, render: (r) => {
            const comp = !!r.stock && r.stock.onHand < r.stock.reserved;
            return comp ? <Pill tone="bad">comprometido</Pill> : <span className={'font-semibold ' + (r.available > 0 ? 'text-emerald-700' : 'text-red-700')}>{formatQty(r.available, r.format.unit)}</span>;
          } },
          { key: 'value', label: 'Valor disp.', align: 'right', render: (r) => {
            const unit = r.format.priceCLP ?? (r.format.pricePerKgCLP != null ? (r.format.unit === 'kg' ? r.format.pricePerKgCLP : (r.format.avgWeightKg ?? 0) * r.format.pricePerKgCLP) : undefined);
            return unit && r.available > 0 ? <span className="text-xs">{formatCLP(unit * r.available)}</span> : <span className="text-charcoal-300">—</span>;
          }, muted: true },
        ]}
        expand={(r) => <Bitacora productId={r.product.id} formatId={r.format.formatId} unit={r.format.unit} />}
      />
    </div>
  );
}

function Bitacora({ productId, formatId, unit }: { productId: string; formatId: string; unit: ProductFormat['unit'] }) {
  const movements = useStockMovements(productId, formatId, 20);
  return (
    <div>
      <p className="eyebrow mb-1">Bitácora · últimos {movements.length} movimientos</p>
      {movements.length === 0 ? <p className="text-xs text-charcoal-300">Sin movimientos.</p> : (
        <ul className="divide-y divide-charcoal-100 text-xs">
          {movements.map((m) => (
            <li key={m.id} className="py-1 flex items-center justify-between gap-2">
              <span className="text-charcoal-700"><span className="uppercase tracking-display text-[10px] text-charcoal-300 mr-2">{MOV_LABEL[m.type] ?? m.type}</span>{m.orderId ? <span className="font-mono">{m.orderId}</span> : null}{m.reason ? <span className="text-charcoal-300"> · {m.reason}</span> : null}</span>
              <span className="shrink-0 text-charcoal-500">{m.qty > 0 ? '+' : ''}{formatQty(m.qty, unit)} · {new Date(m.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
