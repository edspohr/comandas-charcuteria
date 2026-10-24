import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@/components/ui/Button';
import NuevoClienteDialog from '@/components/clients/NuevoClienteDialog';
import SemaphoreBadge from '@/components/ui/SemaphoreBadge';
import Stepper from '@/components/ui/Stepper';
import SampleTag from '@/components/orders/SampleTag';
import { useCurrentUser } from '@/data/auth';
import { useClients, searchClients } from '@/data/clients';
import { useProducts } from '@/data/products';
import { useAllStock, availableFor, semaphore } from '@/data/stock';
import { createOrder, useLastOrderForClient, type DraftLine } from '@/data/orders';
import { useSettings } from '@/data/settings';
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft';
import { defaultRequestedDate, minRequestedDate } from '@/domain/cutoff';
import { formatDateLong, formatDateShort, formatQty } from '@/lib/format';
import { describeFirestoreError } from '@/lib/errors';
import { categoryLabel, categoryOrder } from '@/domain/categories';
import { computeLineSubtotal, formatCLP, unitPriceLabel } from '@/lib/pricing';
import { formatWindow, parseWindow, windowValid } from '@/domain/delivery';
import { SAMPLE_DEFAULT_GRAMS, SAMPLE_GRAM_OPTIONS, lineKey, sampleLabel, sampleLine, sampleSourceFor } from '@/domain/samples';
import type { Client, Product, ProductFormat, StockDoc } from '@/domain/types';

interface Draft {
  clientId: string | null;
  lines: DraftLine[];
  requestedDate: string;
  deliveryMode: 'retiro' | 'despacho';
  deliveryAddress: string;
  receivingHours: string;
  // Horario de entrega (obligatorio) y nombre de fantasía (opcional). Pueden
  // faltar en borradores guardados antes de la 1.0.
  deliveryFrom?: string;
  deliveryTo?: string;
  deliveryNote?: string;
  fantasyName?: string;
  step: number;
}

function emptyDraft(cutoffHour: number): Draft {
  return {
    clientId: null,
    lines: [],
    requestedDate: defaultRequestedDate(cutoffHour),
    deliveryMode: 'despacho',
    deliveryAddress: '',
    receivingHours: '',
    step: 1,
  };
}

export default function NuevoPedido() {
  const { current } = useCurrentUser();
  const navigate = useNavigate();
  const uid = current!.appUser.uid;
  const { settings } = useSettings();

  const [draft, setDraft] = useState<Draft>(() => {
    const loaded = loadDraft<Draft>(uid);
    if (!loaded) return emptyDraft(settings.cutoffHour);
    // Drafts persisted from a previous day would open with a requestedDate
    // that's now in the past; snap it forward to the current default.
    const min = minRequestedDate();
    if (loaded.requestedDate < min) {
      return { ...loaded, requestedDate: defaultRequestedDate(settings.cutoffHour) };
    }
    return loaded;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { clients: allClients } = useClients();
  // Tienda solo pide reposición para la tienda propia: el cliente viene dado.
  const isTienda = current!.appUser.role === 'tienda';
  const clients = useMemo(() => (isTienda ? allClients.filter((c) => c.isInternalShop) : allClients), [allClients, isTienda]);
  useEffect(() => {
    if (!isTienda || draft.clientId || clients.length === 0) return;
    setDraft((d) => ({ ...d, clientId: clients[0].id, deliveryMode: 'despacho', step: Math.max(d.step, 2) }));
  }, [isTienda, clients, draft.clientId]);
  const { products } = useProducts();
  const { stock } = useAllStock();
  const client = useMemo(
    () => clients.find((c) => c.id === draft.clientId) ?? null,
    [clients, draft.clientId],
  );
  const lastOrder = useLastOrderForClient(uid, draft.clientId);

  useEffect(() => { saveDraft(uid, draft); }, [draft, uid]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }
  function goto(step: number) { update('step', step); }

  async function submit() {
    if (!client) return;
    const window = { from: draft.deliveryFrom ?? '', to: draft.deliveryTo ?? '', note: draft.deliveryNote };
    if (!windowValid(window)) { setError('Indique el horario de entrega: desde y hasta (el primero antes que el segundo).'); goto(3); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await createOrder(uid, {
        client,
        lines: draft.lines,
        requestedDate: draft.requestedDate,
        deliveryMode: draft.deliveryMode,
        deliveryAddress: draft.deliveryAddress || client.address,
        receivingHours: draft.receivingHours || client.receivingHours,
        deliveryWindow: window,
        fantasyName: draft.fantasyName?.trim() || undefined,
        source: 'app',
      });
      clearDraft(uid);
      navigate('/tablero', {
        state: { justCreated: res.orderId, status: res.status, parcialLines: res.parcialLines },
      });
    } catch (e: unknown) {
      setError(describeFirestoreError(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <p className="eyebrow">{isTienda ? 'Tienda' : 'Vendedor'}</p>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">{isTienda ? 'Pedir reposición' : 'Nuevo pedido'}</h1>
        </div>
        <button
          onClick={() => { if (confirm('¿Descartar borrador?')) { clearDraft(uid); setDraft(emptyDraft(settings.cutoffHour)); } }}
          className="text-[11px] uppercase tracking-display text-charcoal-300 hover:text-charcoal-700"
        >
          Descartar
        </button>
      </header>

      <Steps current={draft.step} onGo={goto} />

      {draft.step === 1 && (
        <StepCliente
          clients={clients}
          uid={uid}
          selectedId={draft.clientId}
          onSelect={(c) => {
            // A different client brings its own usual window and fantasy name.
            if (c.id !== draft.clientId) setDraft((d) => ({ ...d, deliveryFrom: undefined, deliveryTo: undefined, deliveryNote: undefined, fantasyName: undefined }));
            update('clientId', c.id); update('deliveryMode', c.deliveryMode); goto(2);
          }}
          onRepeat={() => {
            if (!lastOrder) return;
            update('lines', lastOrder.lines.filter((l) => !l.sample).map((l) => ({
              productId: l.productId, productName: l.productName,
              formatId: l.formatId, formatLabel: l.formatLabel,
              unit: l.unit, qty: l.qty, notes: l.notes,
            })));
            goto(2);
          }}
          canRepeat={!!lastOrder}
        />
      )}

      {draft.step === 2 && client && (
        <StepProductos
          products={products}
          stock={stock}
          lines={draft.lines}
          onLines={(lines) => update('lines', lines)}
          onNext={() => goto(3)}
          onBack={() => goto(1)}
          lastOrder={lastOrder}
          onRepeat={lastOrder ? () => {
            update('lines', lastOrder.lines.filter((l) => !l.sample).map((l) => ({
              productId: l.productId, productName: l.productName,
              formatId: l.formatId, formatLabel: l.formatLabel,
              unit: l.unit, qty: l.qty, notes: l.notes,
            })));
          } : undefined}
        />
      )}

      {draft.step === 3 && client && (
        <StepEntrega
          client={client}
          draft={draft}
          onUpdate={update}
          onNext={() => goto(4)}
          onBack={() => goto(2)}
        />
      )}

      {draft.step === 4 && client && (
        <StepConfirmar
          client={client}
          draft={draft}
          stock={stock}
          submitting={submitting}
          error={error}
          onBack={() => goto(3)}
          onSubmit={submit}
        />
      )}
    </div>
  );
}

// ---------- Stepper header ----------

const STEP_LABELS = ['Cliente', 'Productos', 'Entrega', 'Confirmar'];

function Steps({ current, onGo }: { current: number; onGo: (n: number) => void }) {
  return (
    <ol className="flex items-center gap-3 mb-8">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const active = current === n;
        const done = current > n;
        return (
          <li key={label} className="flex-1 min-w-0">
            <button
              onClick={() => onGo(n)}
              disabled={n > current}
              className="w-full text-left group disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-3">
                <span
                  className={
                    'shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border transition ' +
                    (active
                      ? 'bg-charcoal-900 border-charcoal-900 text-cream-50'
                      : done
                        ? 'bg-brass-500 border-brass-500 text-cream-50'
                        : 'bg-white border-charcoal-200 text-charcoal-300')
                  }
                >
                  {String(n).padStart(2, '0')}
                </span>
                <span
                  className={
                    'hidden sm:block text-[11px] uppercase tracking-display font-medium truncate ' +
                    (active ? 'text-charcoal-900' : done ? 'text-brass-600' : 'text-charcoal-300')
                  }
                >
                  {label}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Step 1: Cliente ----------

function StepCliente({
  clients, uid, selectedId, onSelect, onRepeat, canRepeat,
}: {
  clients: Client[];
  uid: string;
  selectedId: string | null;
  onSelect: (c: Client) => void;
  onRepeat: () => void;
  canRepeat: boolean;
}) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const results = useMemo(() => searchClients(clients, q), [clients, q]);

  return (
    <section className="space-y-4">
      <div>
        <label className="eyebrow block mb-1.5">Buscar cliente <span className="normal-case tracking-normal font-normal text-charcoal-300">· datos desde Bsale</span></label>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nombre, fantasía o RUT"
          className="field h-12 text-base"
        />
      </div>

      {canRepeat && selectedId && (
        <Button variant="secondary" size="md" onClick={onRepeat} className="w-full">
          Repetir último pedido de este cliente
        </Button>
      )}

      {results.length === 0 ? (
        <div className="card p-5 text-center">
          <p className="text-sm text-charcoal-500 mb-3">No hay clientes que coincidan con «{q}».</p>
          <Button onClick={() => setCreating(true)} className="w-full">+ Crear cliente «{q.trim()}»</Button>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="w-full text-left rounded-md border border-dashed border-charcoal-200 px-3.5 py-2.5 text-xs uppercase tracking-display text-charcoal-500 hover:border-brass-500 hover:text-charcoal-900">
          + Cliente nuevo
        </button>
      )}

      {creating && (
        <NuevoClienteDialog
          uid={uid}
          initial={{ fantasyName: q.trim() || undefined }}
          onClose={() => setCreating(false)}
          onCreated={(c) => { setCreating(false); onSelect(c); }}
        />
      )}

      <ul className="space-y-1.5">
        {results.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c)}
              aria-label={`Elegir cliente ${c.fantasyName ?? c.name}`}
              className={
                'w-full text-left card p-3.5 transition hover:border-brass-500 hover:shadow-lift ' +
                (c.id === selectedId ? 'border-brass-500 shadow-lift' : '')
              }
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-charcoal-700">{c.fantasyName ?? c.name}</span>
                {c.isInternalShop && (
                  <span className="text-[10px] uppercase tracking-display bg-charcoal-900 text-cream-50 px-2 py-0.5 rounded">Tienda</span>
                )}
                {!c.invoicingComplete && (
                  <span className="text-[10px] uppercase tracking-display bg-brass-100 text-brass-700 border border-brass-300 px-2 py-0.5 rounded">Facturación incompleta</span>
                )}
              </div>
              <div className="text-xs text-charcoal-300 mt-1">
                {c.rut ?? 'Sin RUT'} · {c.address ?? 'Sin dirección'}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Step 2: Productos ----------

function StepProductos({
  products, stock, lines, onLines, onNext, onBack, lastOrder, onRepeat,
}: {
  products: Product[];
  stock: Map<string, StockDoc>;
  lines: DraftLine[];
  onLines: (lines: DraftLine[]) => void;
  onNext: () => void;
  onBack: () => void;
  lastOrder: import('@/domain/types').Order | null;
  onRepeat?: () => void;
}) {
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const [sampleOpen, setSampleOpen] = useState(false);
  const active = products.filter((p) => p.active && !p.discontinued);
  const showRepeat = !!(lastOrder && onRepeat && lines.length === 0);

  function addOrUpdate(product: Product, format: ProductFormat, qty: number, notes?: string) {
    const idx = lines.findIndex((l) => !l.sample && l.productId === product.id && l.formatId === format.formatId);
    if (qty <= 0) {
      if (idx >= 0) onLines(lines.filter((_, i) => i !== idx));
      return;
    }
    const next: DraftLine = {
      productId: product.id, productName: product.name,
      formatId: format.formatId, formatLabel: format.label,
      unit: format.unit, qty, notes,
      format,
    };
    if (idx >= 0) {
      const copy = [...lines]; copy[idx] = next; onLines(copy);
    } else {
      onLines([...lines, next]);
    }
  }

  return (
    <section className="space-y-5">
      {showRepeat && lastOrder && (
        <button
          type="button"
          onClick={onRepeat}
          className="w-full card p-3 border-brass-300 bg-brass-50 hover:bg-brass-100 text-left"
        >
          <p className="eyebrow">Repetir último pedido</p>
          <p className="text-sm font-semibold text-charcoal-900 mt-0.5">
            <span className="font-mono">{lastOrder.id}</span> · {formatDateShort(lastOrder.requestedDate)} · {lastOrder.lines.length} {lastOrder.lines.length === 1 ? 'línea' : 'líneas'}
          </p>
        </button>
      )}

      <ProductGrid products={active} lines={lines} openId={openProductId} onOpen={setOpenProductId} />

      <button type="button" onClick={() => setSampleOpen(true)} className="w-full rounded-md border border-dashed border-brass-300 bg-white px-3 py-2.5 text-sm text-brass-700 hover:bg-brass-50 text-left">
        <span className="font-semibold">+ Muestra</span> <span className="text-charcoal-500">· sin cargo, {SAMPLE_DEFAULT_GRAMS} g por defecto, sale del granel</span>
      </button>

      <SelectedLines lines={lines} onRemove={(l) => onLines(lines.filter((x) => lineKey(x) !== lineKey(l)))} />


      <div className="flex gap-2 pt-2 sticky bottom-0 bg-cream-50 py-3 border-t border-charcoal-100">
        <Button variant="secondary" onClick={onBack} className="flex-1">Volver</Button>
        <Button onClick={onNext} disabled={lines.length === 0} className="flex-1">
          Siguiente ({lines.length} {lines.length === 1 ? 'línea' : 'líneas'})
        </Button>
      </div>

      {sampleOpen && (
        <SamplePicker
          products={active}
          stock={stock}
          onAdd={(line) => { onLines([...lines.filter((x) => lineKey(x) !== lineKey(line)), line]); setSampleOpen(false); }}
          onClose={() => setSampleOpen(false)}
        />
      )}

      {openProductId && (
        <FormatPicker
          product={active.find((p) => p.id === openProductId)!}
          stock={stock}
          existing={lines.filter((l) => !l.sample && l.productId === openProductId)}
          onCommit={(fmt, qty, notes) => {
            const prod = active.find((p) => p.id === openProductId)!;
            addOrUpdate(prod, fmt, qty, notes);
          }}
          onClose={() => setOpenProductId(null)}
        />
      )}
    </section>
  );
}

function ProductGrid({ products, lines, openId, onOpen }: { products: Product[]; lines: DraftLine[]; openId: string | null; onOpen: (id: string) => void }) {
  const byCat = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of products) {
      const list = m.get(p.category) ?? [];
      list.push(p); m.set(p.category, list);
    }
    // Sort categories by the canonical CATEGORY_LABEL order — the map
    // insertion order would otherwise depend on which product loaded first.
    const entries = [...m.entries()].sort(([a], [b]) => categoryOrder(a) - categoryOrder(b));
    return new Map(entries);
  }, [products]);

  return (
    <div className="space-y-4">
      {[...byCat.entries()].map(([cat, list]) => (
        <div key={cat}>
          <p className="eyebrow mb-2 px-0.5">{categoryLabel(cat)}</p>
          <div className="flex flex-wrap gap-1.5">
            {list.map((p) => {
              const has = lines.some((l) => !l.sample && l.productId === p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => onOpen(p.id)}
                  className={
                    'rounded-md border px-3 py-1.5 text-sm transition ' +
                    (openId === p.id
                      ? 'bg-charcoal-900 text-cream-50 border-charcoal-900'
                      : has
                        ? 'bg-brass-50 border-brass-300 text-brass-700'
                        : 'bg-white border-charcoal-200 text-charcoal-700 hover:border-charcoal-300')
                  }
                >
                  {p.name}
                  {has && <span className="ml-1.5 text-[10px]">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function FormatPicker({
  product, stock, existing, onCommit, onClose,
}: {
  product: Product;
  stock: Map<string, StockDoc>;
  existing: DraftLine[];
  onCommit: (format: ProductFormat, qty: number, notes?: string) => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState<Record<string, { qty: number; notes: string }>>(() => {
    const initial: Record<string, { qty: number; notes: string }> = {};
    for (const l of existing) initial[l.formatId] = { qty: l.qty, notes: l.notes ?? '' };
    return initial;
  });

  function commit() {
    for (const fmt of product.formats) {
      const p = pending[fmt.formatId];
      if (p) onCommit(fmt, p.qty, p.notes || undefined);
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-20 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-cream-50 rounded-t-xl sm:rounded-xl shadow-lift p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="eyebrow">Formatos</p>
          <h3 className="font-semibold text-charcoal-900 tracking-display uppercase mt-0.5">{product.name}</h3>
        </div>
        <button onClick={onClose} className="text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center" aria-label="Cerrar">×</button>
      </div>
      <ul className="space-y-4">
        {product.formats.map((fmt) => {
          const av = availableFor(stock, product.id, fmt.formatId);
          const current = pending[fmt.formatId] ?? { qty: 0, notes: '' };
          const sem = semaphore(av, current.qty || 1);
          return (
            <li key={fmt.formatId} className="border-t border-charcoal-100 pt-4 first:border-none first:pt-0">
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <div className="min-w-0">
                  <span className="font-medium text-charcoal-700">{fmt.label}</span>
                  {unitPriceLabel(fmt) && (
                    <span className="ml-2 text-[11px] uppercase tracking-display text-charcoal-500">
                      {unitPriceLabel(fmt)}
                    </span>
                  )}
                </div>
                <SemaphoreBadge level={sem} note={`Disponible ${formatQty(av, fmt.unit)}`} />
              </div>
              <Stepper
                value={current.qty}
                onChange={(qty) => setPending((s) => ({ ...s, [fmt.formatId]: { ...current, qty } }))}
                step={fmt.unit === 'kg' ? 0.5 : 1}
                decimals={fmt.unit === 'kg' ? 2 : 0}
                quick={fmt.unit === 'kg' ? [0.5, 1, 5] : [1, 5, 10]}
              />
              {current.qty > 0 && computeLineSubtotal(fmt, current.qty) != null && (
                <p className="mt-2 text-xs text-charcoal-500">
                  Subtotal · <span className="font-semibold text-charcoal-700">{formatCLP(computeLineSubtotal(fmt, current.qty))}</span>
                </p>
              )}
              <input
                value={current.notes}
                onChange={(e) => setPending((s) => ({ ...s, [fmt.formatId]: { ...current, notes: e.target.value } }))}
                placeholder="Notas — laminado fino, sin jugo…"
                className="field mt-2.5 h-10 text-sm"
              />
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2 mt-5">
        <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
        <Button onClick={commit} className="flex-1">Agregar</Button>
      </div>
      </div>
    </div>
  );
}

// "+ Muestra": product + size. Comes out of the product's bulk format (or one
// unit of its smallest format when it has no bulk).
function SamplePicker({ products, stock, onAdd, onClose }: { products: Product[]; stock: Map<string, StockDoc>; onAdd: (l: DraftLine) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [productId, setProductId] = useState<string | null>(null);
  const [grams, setGrams] = useState(SAMPLE_DEFAULT_GRAMS);
  const [notes, setNotes] = useState('');
  const norm = (x: string) => x.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const candidates = products.filter((p) => sampleSourceFor(p) && (!q || norm(`${p.name} ${(p.aliases ?? []).join(' ')}`).includes(norm(q)))).slice(0, 30);
  const product = products.find((p) => p.id === productId);
  const src = product ? sampleSourceFor(product) : null;
  const line = product ? sampleLine(product, grams, notes.trim() || undefined) : null;
  const av = product && src ? availableFor(stock, product.id, src.format.formatId) : 0;
  return (
    <div className="fixed inset-0 z-20 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-cream-50 rounded-t-xl sm:rounded-xl shadow-lift p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="eyebrow">Sin cargo</p>
            <h3 className="font-semibold text-charcoal-900 tracking-display uppercase mt-0.5">Agregar muestra</h3>
          </div>
          <button onClick={onClose} className="text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center" aria-label="Cerrar">×</button>
        </div>
        {!product ? (
          <>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto…" className="field h-10 text-sm mb-3" />
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((p) => (
                <button key={p.id} onClick={() => setProductId(p.id)} className="rounded-md border border-charcoal-200 bg-white px-3 py-1.5 text-sm text-charcoal-700 hover:border-charcoal-300">{p.name}</button>
              ))}
              {candidates.length === 0 && <p className="text-xs text-charcoal-300">Sin productos que coincidan.</p>}
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-charcoal-900">{product.name}</p>
              <button onClick={() => setProductId(null)} className="text-[11px] uppercase tracking-display text-charcoal-500 underline">Cambiar</button>
            </div>
            {src?.byWeight ? (
              <div>
                <p className="eyebrow mb-1.5">Tamaño</p>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {SAMPLE_GRAM_OPTIONS.map((g) => (
                    <button key={g} onClick={() => setGrams(g)} className={'rounded-md border px-3 py-1.5 text-sm ' + (grams === g ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-700')}>{g} g</button>
                  ))}
                  <input type="number" min={10} max={1000} step={10} value={grams} onChange={(e) => setGrams(Math.max(10, Math.min(1000, Number(e.target.value) || SAMPLE_DEFAULT_GRAMS)))} className="field h-9 w-24 text-sm" aria-label="Gramos" />
                </div>
                <p className="text-xs text-charcoal-500 mt-2">Sale de {src.format.label.toLowerCase()} · disponible {formatQty(av, 'kg')}{av < grams / 1000 ? ' — sin stock: despacho decide al armar' : ''}</p>
              </div>
            ) : (
              <p className="text-sm text-charcoal-700">Este producto no tiene granel: la muestra es <strong>1 × {src?.format.label}</strong>. Disponible {formatQty(av, src?.format.unit ?? 'unidad')}.</p>
            )}
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nota para despacho — laminado fino, para el chef…" className="field h-10 text-sm" />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button onClick={() => line && onAdd(line)} disabled={!line} className="flex-1">Agregar muestra</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SelectedLines({ lines, onRemove }: { lines: DraftLine[]; onRemove: (l: DraftLine) => void }) {
  if (lines.length === 0) return null;
  const total = lines.reduce((s, l) => s + (l.format ? (computeLineSubtotal(l.format, l.qty) ?? 0) : 0), 0);
  return (
    <div className="card p-4">
      <p className="eyebrow mb-2">Líneas en este pedido</p>
      <ul className="divide-y divide-charcoal-100">
        {lines.map((l) => {
          const sub = l.format ? computeLineSubtotal(l.format, l.qty) : undefined;
          return (
          <li key={lineKey(l)} className="flex items-center justify-between gap-2 text-sm py-2 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="text-charcoal-700 truncate font-medium">{l.sample && <SampleTag />}{l.productName}</div>
              <div className="text-xs text-charcoal-300 truncate">
                {l.formatLabel}{l.notes ? ` · ${l.notes}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <div className="font-semibold text-charcoal-700">{l.sample ? sampleLabel(l) : formatQty(l.qty, l.unit)}</div>
                {l.sample ? <div className="text-[11px] text-charcoal-500">sin cargo</div> : sub != null && <div className="text-[11px] text-charcoal-500">{formatCLP(sub)}</div>}
              </div>
              <button onClick={() => onRemove(l)} className="text-[11px] uppercase tracking-display text-charcoal-300 hover:text-red-700">Quitar</button>
            </div>
          </li>
          );
        })}
      </ul>
      {total > 0 && (
        <div className="mt-3 pt-3 border-t border-charcoal-100 flex items-center justify-between text-sm">
          <span className="eyebrow">Total estimado</span>
          <span className="font-semibold text-charcoal-900">{formatCLP(total)}</span>
        </div>
      )}
    </div>
  );
}

// ---------- Step 3: Entrega ----------

const QUICK_WINDOWS: Array<[string, string, string]> = [['09:00', '13:00', 'Mañana 9–13'], ['10:00', '12:00', '10–12'], ['14:00', '18:00', 'Tarde 14–18'], ['09:00', '18:00', 'Todo el día']];

function StepEntrega({
  client, draft, onUpdate, onNext, onBack,
}: {
  client: Client;
  draft: Draft;
  onUpdate: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const valid = windowValid({ from: draft.deliveryFrom ?? '', to: draft.deliveryTo ?? '' });
  // Prefill: the client's usual window (or what the message/ficha says) and
  // its fantasy name. Only once, when the draft has nothing yet.
  useEffect(() => {
    if (!draft.deliveryFrom && !draft.deliveryTo) {
      const w = client.deliveryWindow ?? parseWindow(draft.receivingHours) ?? parseWindow(client.receivingHours);
      if (w) { onUpdate('deliveryFrom', w.from); onUpdate('deliveryTo', w.to); }
    }
    if (draft.fantasyName === undefined) onUpdate('fantasyName', client.fantasyName ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);
  return (
    <section className="space-y-5">
      <div>
        <label className="eyebrow block mb-1.5">Fecha solicitada</label>
        <input
          type="date"
          value={draft.requestedDate}
          min={minRequestedDate()}
          onChange={(e) => onUpdate('requestedDate', e.target.value)}
          className="field"
        />
        <p className="text-xs text-charcoal-300 mt-1.5 first-letter:uppercase">{formatDateLong(draft.requestedDate)}</p>
      </div>

      <div>
        <label className="eyebrow block mb-1.5">Modalidad</label>
        <div className="grid grid-cols-2 gap-2">
          {(['retiro', 'despacho'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onUpdate('deliveryMode', m)}
              className={
                'h-12 rounded-md border text-sm font-medium uppercase tracking-display transition ' +
                (draft.deliveryMode === m
                  ? 'bg-charcoal-900 text-cream-50 border-charcoal-900'
                  : 'bg-white border-charcoal-200 text-charcoal-500 hover:border-charcoal-300')
              }
            >
              {m === 'retiro' ? 'Retiro en tienda' : 'Despacho'}
            </button>
          ))}
        </div>
      </div>

      {draft.deliveryMode === 'despacho' && (
        <div>
          <label className="eyebrow block mb-1.5">Dirección de despacho</label>
          <input
            value={draft.deliveryAddress || client.address || ''}
            onChange={(e) => onUpdate('deliveryAddress', e.target.value)}
            placeholder="Dirección (prefijada del cliente)"
            className="field"
          />
        </div>
      )}

      <div>
        <label className="eyebrow block mb-1.5">Horario de entrega *</label>
        <div className="flex items-center gap-2">
          <input type="time" aria-label="Desde" value={draft.deliveryFrom ?? ''} onChange={(e) => onUpdate('deliveryFrom', e.target.value)} className={'field ' + (touched && !draft.deliveryFrom ? 'border-red-400' : '')} />
          <span className="text-sm text-charcoal-500">a</span>
          <input type="time" aria-label="Hasta" value={draft.deliveryTo ?? ''} onChange={(e) => onUpdate('deliveryTo', e.target.value)} className={'field ' + (touched && !draft.deliveryTo ? 'border-red-400' : '')} />
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {QUICK_WINDOWS.map(([f, t, label]) => (
            <button key={label} type="button" onClick={() => { onUpdate('deliveryFrom', f); onUpdate('deliveryTo', t); }}
              className={'rounded-md border px-2.5 py-1 text-xs ' + (draft.deliveryFrom === f && draft.deliveryTo === t ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-600')}>{label}</button>
          ))}
        </div>
        <input value={draft.deliveryNote ?? ''} onChange={(e) => onUpdate('deliveryNote', e.target.value)} placeholder="Nota opcional — no antes de las 10, tocar timbre, preguntar por el chef…" className="field mt-2 h-10 text-sm" />
        {touched && !valid && <p className="text-xs text-red-700 mt-1">Indique desde y hasta qué hora puede recibir el cliente.</p>}
        <p className="text-[11px] text-charcoal-300 mt-1">Horario preferido por el cliente para recibir. Queda como habitual en su ficha.</p>
      </div>

      <div>
        <label className="eyebrow block mb-1.5">Nombre de fantasía <span className="normal-case tracking-normal text-charcoal-300">(opcional)</span></label>
        <input value={draft.fantasyName ?? ''} onChange={(e) => onUpdate('fantasyName', e.target.value)} placeholder={`Cómo lo conoce despacho — ${client.name}`} className="field" />
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="secondary" onClick={onBack} className="flex-1">Volver</Button>
        <Button onClick={() => { setTouched(true); if (valid) onNext(); }} className="flex-1">Siguiente</Button>
      </div>
    </section>
  );
}

// ---------- Step 4: Confirmar ----------

function StepConfirmar({
  client, draft, stock, submitting, error, onBack, onSubmit,
}: {
  client: Client;
  draft: Draft;
  stock: Map<string, StockDoc>;
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const preview = useMemo(() => draft.lines.map((l) => {
    const av = availableFor(stock, l.productId, l.formatId);
    const subtotalCLP = l.sample ? undefined : l.format ? computeLineSubtotal(l.format, l.qty) : undefined;
    // Samples never go to production: without stock despacho decides.
    return { line: l, available: av, reserved: Math.min(av, l.qty), pending: l.sample ? 0 : Math.max(0, l.qty - av), subtotalCLP };
  }), [draft.lines, stock]);

  const anyPending = preview.some((p) => p.pending > 0);
  const totalCLP = preview.reduce((s, p) => s + (p.subtotalCLP ?? 0), 0);

  return (
    <section className="space-y-4">
      <div className="card p-4 space-y-2">
        <div>
          <p className="eyebrow">Cliente</p>
          <p className="font-semibold text-charcoal-900 mt-1">{draft.fantasyName?.trim() || client.fantasyName || client.name}</p>
          {(draft.fantasyName?.trim() || client.fantasyName) && client.name !== (draft.fantasyName?.trim() || client.fantasyName) && (
            <p className="text-xs text-charcoal-300 mt-0.5">Razón social: {client.name}</p>
          )}
          <p className="text-xs text-charcoal-300 mt-0.5">{client.rut ?? 'Sin RUT'}</p>
        </div>

        <div className="border-t border-charcoal-100 pt-2">
          <p className="eyebrow">Entrega</p>
          <p className="text-sm text-charcoal-700 mt-1 first-letter:uppercase">
            {formatDateLong(draft.requestedDate)}
          </p>
          <p className="text-xs text-charcoal-500 mt-0.5">
            {draft.deliveryMode === 'retiro'
              ? 'Retiro en tienda'
              : `Despacho · ${draft.deliveryAddress || client.address || 'sin dirección'}`}
          </p>
          {windowValid({ from: draft.deliveryFrom ?? '', to: draft.deliveryTo ?? '' }) ? (
            <p className="text-xs text-charcoal-700 mt-0.5 font-medium">
              Horario · {formatWindow({ from: draft.deliveryFrom, to: draft.deliveryTo, note: draft.deliveryNote })}
            </p>
          ) : (
            <p className="text-xs text-red-700 mt-0.5">Falta el horario de entrega (paso Entrega).</p>
          )}
        </div>

        {!client.invoicingComplete && (
          <p className="text-xs text-brass-700 bg-brass-50 border border-brass-300 rounded px-2 py-1.5">
            Datos de facturación incompletos — se creará y quedará marcado.
          </p>
        )}
      </div>

      <div className="card p-4">
        <p className="eyebrow mb-2">Líneas ({preview.length})</p>
        <ul className="divide-y divide-charcoal-100">
          {preview.map((p) => (
            <li key={lineKey(p.line)} className="py-2.5 first:pt-0 last:pb-0 text-sm">
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-charcoal-700 truncate font-medium">{p.line.sample && <SampleTag />}{p.line.productName}</div>
                  <div className="text-xs text-charcoal-300 truncate">
                    {p.line.formatLabel}{p.line.notes ? ` · ${p.line.notes}` : ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold text-charcoal-700">{p.line.sample ? sampleLabel(p.line) : formatQty(p.line.qty, p.line.unit)}</div>
                  {p.line.sample && <div className="text-[11px] text-charcoal-500">sin cargo{p.available < p.line.qty ? ' · sin stock en granel' : ''}</div>}
                  {p.subtotalCLP != null && (
                    <div className="text-[11px] text-charcoal-500">{formatCLP(p.subtotalCLP)}</div>
                  )}
                </div>
              </div>
              {p.pending > 0 && (
                <p className="text-[11px] uppercase tracking-display text-brass-700 mt-1">
                  {formatQty(p.reserved, p.line.unit)} reservado · {formatQty(p.pending, p.line.unit)} a producción
                </p>
              )}
            </li>
          ))}
        </ul>
        {totalCLP > 0 && (
          <div className="mt-3 pt-3 border-t border-charcoal-100 flex items-center justify-between">
            <span className="eyebrow">Total estimado</span>
            <span className="text-lg font-semibold text-charcoal-900 tracking-display">{formatCLP(totalCLP)}</span>
          </div>
        )}
      </div>

      {anyPending && (
        <div className="rounded-md bg-brass-50 border border-brass-300 text-brass-700 p-3 text-sm">
          Alguna línea no tiene stock suficiente. Se enviará lo disponible y el resto queda a producción.
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-3 text-sm">{error}</div>
      )}

      <div className="flex gap-2 pt-2">
        <Button variant="secondary" onClick={onBack} disabled={submitting} className="flex-1">Volver</Button>
        <Button onClick={onSubmit} disabled={submitting} className="flex-1">
          {submitting ? 'Enviando…' : 'Enviar pedido'}
        </Button>
      </div>
    </section>
  );
}
