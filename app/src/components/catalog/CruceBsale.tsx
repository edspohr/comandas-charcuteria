import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import DataTable, { Pill } from '@/components/ui/DataTable';
import { useCurrentUser } from '@/data/auth';
import { useProducts } from '@/data/products';
import {
  confirmMany, ignoreMany, createProductFromBsale, pullPricesFromBsale, setMapping, useBsaleVariants, useCatalogMap,
  type BsaleVariantMirror, type CatalogMapEntry, type MapStatus,
} from '@/data/catalogMap';
import { can } from '@/domain/permissions';
import { formatCLP } from '@/lib/pricing';
import { useVariantSales, useVariantStock } from '@/data/facts';
import { describeFirestoreError } from '@/lib/errors';

type Filter = 'pendientes' | 'sin_match' | 'confirmado' | 'ignorado' | 'todas';

interface Row { v: BsaleVariantMirror; m: CatalogMapEntry | undefined }

const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Catálogo → Cruce con Bsale. Cada variante de Bsale (un SKU vendible) se
// asocia a un producto + formato de la app. Sin cruce confirmado una variante
// no mueve stock en la app ni se puede usar en recepciones o traslados.
export default function CruceBsale() {
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const editable = can(current!.appUser.role, 'catalog.map');
  const variants = useBsaleVariants();
  const map = useCatalogMap();
  const { products } = useProducts();
  const [filter, setFilter] = useState<Filter>('pendientes');
  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const { sold, ready: salesReady } = useVariantSales(90);
  const stockRows = useVariantStock();
  const stockOf = useMemo(() => new Map(stockRows.map((s) => [s.variantId, Object.values(s.offices).reduce((a, o) => a + (o.quantity ?? 0), 0)])), [stockRows]);
  // Activity = sold in the last 90 days or stock on hand. Variants without
  // either are the first candidates to ignore (old SKUs, one-off items).
  const moving = (id: string) => (sold.get(id) ?? 0) > 0 || (stockOf.get(id) ?? 0) > 0;
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mapById = useMemo(() => new Map(map.map((m) => [m.variantId, m])), [map]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const rows = useMemo<Row[]>(() => {
    const needle = norm(q.trim());
    return variants
      .filter((v) => v.active)
      .map((v) => ({ v, m: mapById.get(v.variantId) }))
      .filter(({ v, m }) => {
        const st = m?.status ?? 'sugerido';
        const matched = !!m?.productId;
        if (filter === 'pendientes' && !(st === 'sugerido' && matched)) return false;
        if (filter === 'sin_match' && !(st === 'sugerido' && !matched)) return false;
        if ((filter === 'confirmado' || filter === 'ignorado') && st !== filter) return false;
        if (needle && !norm(`${v.label} ${v.code ?? ''} ${v.barCode ?? ''}`).includes(needle)) return false;
        if (onlyActive && salesReady && !moving(v.variantId)) return false;
        return true;
      })
      .sort((a, b) => (salesReady ? (sold.get(b.v.variantId) ?? 0) - (sold.get(a.v.variantId) ?? 0) : 0) || (b.m?.score ?? 0) - (a.m?.score ?? 0) || a.v.label.localeCompare(b.v.label, 'es'));
  }, [variants, mapById, filter, q, onlyActive, salesReady, sold, stockOf]);
  const idle = salesReady ? rows.filter((r) => r.m?.status !== 'confirmado' && r.m?.status !== 'ignorado' && !moving(r.v.variantId)) : [];

  const counts = useMemo(() => {
    const c = { pendientes: 0, sin_match: 0, confirmado: 0, ignorado: 0 };
    for (const v of variants) {
      if (!v.active) continue;
      const m = mapById.get(v.variantId);
      const st = m?.status ?? 'sugerido';
      if (st === 'confirmado') c.confirmado++; else if (st === 'ignorado') c.ignorado++; else if (m?.productId) c.pendientes++; else c.sin_match++;
    }
    return c;
  }, [variants, mapById]);

  async function act(key: string, fn: () => Promise<string | void>) {
    setBusy(key); setError(null); setFlash(null);
    try { const m = await fn(); if (m) setFlash(m); } catch (e) { setError(describeFirestoreError(e)); } finally { setBusy(null); }
  }

  const strong = rows.filter((r) => r.m?.status === 'sugerido' && r.m.productId && (r.m.score ?? 0) >= 0.8);

  if (variants.length === 0) {
    return (
      <div className="card p-6 text-sm text-charcoal-500">
        Todavía no hay catálogo de Bsale. Se trae con el diagnóstico en <strong>Conexión Bsale</strong> apenas esté cargado el token.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, código o código de barras" className="field h-9 text-sm w-full sm:w-72" />
        {([['pendientes', 'Sugeridas'], ['sin_match', 'Sin match'], ['confirmado', 'Confirmadas'], ['ignorado', 'Ignoradas'], ['todas', 'Todas']] as Array<[Filter, string]>).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} className={'rounded-md px-2.5 py-1.5 text-[11px] uppercase tracking-display font-medium border ' + (filter === f ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500')}>
            {label}{f !== 'todas' && <span className="ml-1 opacity-70">{counts[f]}</span>}
          </button>
        ))}
        {salesReady && (
          <label className="flex items-center gap-1.5 text-xs text-charcoal-500">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Solo con venta (90 d) o stock
          </label>
        )}
        {editable && (
          <div className="ml-auto flex gap-2 flex-wrap">
            {idle.length > 0 && !onlyActive && (
              <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => {
                if (!window.confirm(`¿Ignorar ${idle.length} variantes sin venta en 90 días ni stock? Se pueden volver a pendiente después.`)) return;
                void act('idle', async () => { await ignoreMany(idle.map((r) => r.v.variantId), uid); return `${idle.length} variantes sin movimiento ignoradas.`; });
              }}>Ignorar {idle.length} sin movimiento</Button>
            )}
            {strong.length > 0 && <Button size="sm" disabled={busy != null} onClick={() => act('bulk', async () => { await confirmMany(strong.map((r) => r.m!), uid); return `${strong.length} cruces confirmados.`; })}>Confirmar {strong.length} con puntaje alto</Button>}
            {filter === 'pendientes' && rows.length > strong.length && (
              <Button size="sm" variant="secondary" disabled={busy != null} onClick={() => {
                if (!window.confirm(`¿Confirmar las ${rows.length} sugerencias de este filtro? Revise la columna "Producto · formato" antes.`)) return;
                void act('all', async () => { await confirmMany(rows.map((r) => r.m!).filter(Boolean), uid); return `${rows.length} cruces confirmados.`; });
              }}>Confirmar las {rows.length} sugeridas</Button>
            )}
            <Button size="sm" variant="secondary" disabled={busy != null || counts.confirmado === 0} onClick={() => act('prices', async () => { const n = await pullPricesFromBsale(products, map, variants); return n ? `${n} precios actualizados desde la lista de Bsale.` : 'Los precios ya coinciden con Bsale.'; })}>Traer precios de Bsale</Button>
          </div>
        )}
      </div>

      {flash && <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm mb-3">{flash}</div>}
      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}

      <DataTable<Row>
        rows={rows}
        rowKey={(r) => r.v.variantId}
        dense
        emptyText="Nada en este filtro."
        columns={[
          { key: 'bsale', label: 'Variante Bsale', mobile: true, render: ({ v }) => <div><p className="font-semibold text-charcoal-900">{v.label}</p><p className="text-[11px] text-charcoal-300">{v.code ?? '—'}{v.productType ? ` · ${v.productType}` : ''}</p></div> },
          { key: 'price', label: 'Precio Bsale', align: 'right', render: ({ v }) => (v.priceCLP != null ? formatCLP(v.priceCLP) : '—'), muted: true },
          ...(salesReady ? [{ key: 'activity', label: 'Venta 90 d · stock', align: 'right' as const, muted: true, render: ({ v }: Row) => {
            const s = sold.get(v.variantId) ?? 0; const st = stockOf.get(v.variantId) ?? 0;
            return s || st ? `${s.toLocaleString('es-CL', { maximumFractionDigits: 1 })} · ${st.toLocaleString('es-CL', { maximumFractionDigits: 1 })}` : <span className="text-charcoal-300">sin movimiento</span>;
          } }] : []),
          {
            key: 'app', label: 'Producto · formato en la app', mobile: true, render: ({ v, m }) => (
              <MappingCell v={v} m={m} products={products} disabled={!editable || busy != null}
                onChange={(productId, formatId) => act(v.variantId, () => setMapping(v.variantId, { productId, formatId, status: 'confirmado' }, uid))} />
            ),
          },
          { key: 'status', label: 'Estado', mobile: true, render: ({ v, m }) => {
            const fmt = m?.productId ? productById.get(m.productId)?.formats.find((f) => f.formatId === m.formatId) : undefined;
            return (
              <div className="flex flex-col items-start gap-1">
                <StatusPill status={m?.status ?? 'sugerido'} score={m?.score} matched={!!m?.productId} />
                {fmt?.unit === 'kg' && !v.allowDecimal && <span title="En la app se vende por kg, pero el producto en Bsale no permite cantidades con decimales: las facturas por peso fallarán. Actívelo en Bsale (producto → permitir decimales)."><Pill tone="warn">Bsale sin decimales</Pill></span>}
              </div>
            );
          } },
        ]}
        expand={editable ? ({ v, m }) => (
          <div className="flex flex-wrap gap-2 text-xs">
            {m?.productId && m.status !== 'confirmado' && <Button size="sm" onClick={() => act(v.variantId, () => setMapping(v.variantId, { status: 'confirmado' }, uid))}>Confirmar {productById.get(m.productId)?.name ?? m.productId}</Button>}
            {m?.status !== 'ignorado' && <Button size="sm" variant="ghost" onClick={() => act(v.variantId, () => setMapping(v.variantId, { status: 'ignorado' }, uid))}>Ignorar (no se vende por Comandas)</Button>}
            {m?.status === 'ignorado' && <Button size="sm" variant="ghost" onClick={() => act(v.variantId, () => setMapping(v.variantId, { status: 'sugerido' }, uid))}>Volver a pendiente</Button>}
            {!m?.productId && (
              <Button size="sm" variant="secondary" onClick={() => act(v.variantId, async () => {
                const siblings = variants.filter((x) => x.bsaleProductId === v.bsaleProductId && x.active && !mapById.get(x.variantId)?.productId);
                const id = await createProductFromBsale(siblings, uid);
                return `Producto ${id} creado con ${siblings.length} formato${siblings.length === 1 ? '' : 's'} y cruzado.`;
              })}>Crear producto en la app desde Bsale</Button>
            )}
          </div>
        ) : undefined}
      />
    </div>
  );
}

function StatusPill({ status, score, matched }: { status: MapStatus; score?: number; matched: boolean }) {
  if (status === 'confirmado') return <Pill tone="ok">Confirmado</Pill>;
  if (status === 'ignorado') return <Pill tone="muted">Ignorado</Pill>;
  if (!matched) return <Pill tone="bad">Sin match</Pill>;
  return <Pill tone={(score ?? 0) >= 0.8 ? 'info' : 'warn'}>Sugerido · {Math.round((score ?? 0) * 100)}%</Pill>;
}

function MappingCell({ v, m, products, disabled, onChange }: {
  v: BsaleVariantMirror; m: CatalogMapEntry | undefined; products: ReturnType<typeof useProducts>['products'];
  disabled: boolean; onChange: (productId: string, formatId: string) => void;
}) {
  const value = m?.productId && m.formatId ? `${m.productId}__${m.formatId}` : '';
  return (
    <select
      aria-label={`Producto de la app para ${v.label}`}
      className="field h-9 text-xs w-full max-w-xs"
      value={value}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => { const [p, f] = e.target.value.split('__'); if (p && f) onChange(p, f); }}
    >
      <option value="">— elegir —</option>
      {products.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {p.formats.map((f) => <option key={f.formatId} value={`${p.id}__${f.formatId}`}>{p.name} · {f.label}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
