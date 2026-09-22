import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@/components/ui/Button';
import SemaphoreBadge from '@/components/ui/SemaphoreBadge';
import Stepper from '@/components/ui/Stepper';
import { useCurrentUser } from '@/data/auth';
import { useClients, searchClients } from '@/data/clients';
import { useProducts } from '@/data/products';
import { useAllStock, availableFor, semaphore } from '@/data/stock';
import { createOrder, useLastOrderForClient, type DraftLine } from '@/data/orders';
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft';
import { defaultRequestedDate, minRequestedDate } from '@/domain/cutoff';
import { formatDateLong, formatQty } from '@/lib/format';
import type { Client, Product, ProductFormat, StockDoc } from '@/domain/types';

interface Draft {
  clientId: string | null;
  lines: DraftLine[];
  requestedDate: string;
  deliveryMode: 'retiro' | 'despacho';
  deliveryAddress: string;
  receivingHours: string;
  step: number;
}

const emptyDraft = (): Draft => ({
  clientId: null,
  lines: [],
  requestedDate: defaultRequestedDate(15),
  deliveryMode: 'despacho',
  deliveryAddress: '',
  receivingHours: '',
  step: 1,
});

export default function NuevoPedido() {
  const { current } = useCurrentUser();
  const navigate = useNavigate();
  const uid = current!.appUser.uid;

  const [draft, setDraft] = useState<Draft>(() => {
    const loaded = loadDraft<Draft>(uid);
    if (!loaded) return emptyDraft();
    // Drafts persisted from a previous day would open with a requestedDate
    // that's now in the past; snap it forward to the current default.
    const min = minRequestedDate();
    if (loaded.requestedDate < min) {
      return { ...loaded, requestedDate: defaultRequestedDate(15) };
    }
    return loaded;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { clients } = useClients();
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
        source: 'app',
      });
      clearDraft(uid);
      navigate('/vendedor/mis', {
        state: { justCreated: res.orderId, status: res.status, parcialLines: res.parcialLines },
      });
    } catch (e: unknown) {
      const msg = (e as Error).message ?? 'Error al crear el pedido';
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <p className="eyebrow">Vendedor</p>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Nuevo pedido</h1>
        </div>
        <button
          onClick={() => { if (confirm('¿Descartar borrador?')) { clearDraft(uid); setDraft(emptyDraft()); } }}
          className="text-[11px] uppercase tracking-display text-charcoal-300 hover:text-charcoal-700"
        >
          Descartar
        </button>
      </header>

      <Steps current={draft.step} onGo={goto} />

      {draft.step === 1 && (
        <StepCliente
          clients={clients}
          selectedId={draft.clientId}
          onSelect={(c) => { update('clientId', c.id); update('deliveryMode', c.deliveryMode); goto(2); }}
          onRepeat={() => {
            if (!lastOrder) return;
            update('lines', lastOrder.lines.map((l) => ({
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
  clients, selectedId, onSelect, onRepeat, canRepeat,
}: {
  clients: Client[];
  selectedId: string | null;
  onSelect: (c: Client) => void;
  onRepeat: () => void;
  canRepeat: boolean;
}) {
  const [q, setQ] = useState('');
  const results = useMemo(() => searchClients(clients, q), [clients, q]);

  return (
    <section className="space-y-4">
      <div>
        <label className="eyebrow block mb-1.5">Buscar cliente</label>
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

      <ul className="space-y-1.5">
        {results.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c)}
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
  products, stock, lines, onLines, onNext, onBack,
}: {
  products: Product[];
  stock: Map<string, StockDoc>;
  lines: DraftLine[];
  onLines: (lines: DraftLine[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const active = products.filter((p) => p.active && !p.discontinued);

  function addOrUpdate(product: Product, format: ProductFormat, qty: number, notes?: string) {
    const idx = lines.findIndex((l) => l.productId === product.id && l.formatId === format.formatId);
    if (qty <= 0) {
      if (idx >= 0) onLines(lines.filter((_, i) => i !== idx));
      return;
    }
    const next: DraftLine = {
      productId: product.id, productName: product.name,
      formatId: format.formatId, formatLabel: format.label,
      unit: format.unit, qty, notes,
    };
    if (idx >= 0) {
      const copy = [...lines]; copy[idx] = next; onLines(copy);
    } else {
      onLines([...lines, next]);
    }
  }

  return (
    <section className="space-y-5">
      <ProductGrid products={active} lines={lines} openId={openProductId} onOpen={setOpenProductId} />

      <SelectedLines lines={lines} onRemove={(l) => onLines(lines.filter((x) => !(x.productId === l.productId && x.formatId === l.formatId)))} />

      <div className="flex gap-2 pt-2 sticky bottom-0 bg-cream-50 py-3 border-t border-charcoal-100">
        <Button variant="secondary" onClick={onBack} className="flex-1">Volver</Button>
        <Button onClick={onNext} disabled={lines.length === 0} className="flex-1">
          Siguiente ({lines.length} {lines.length === 1 ? 'línea' : 'líneas'})
        </Button>
      </div>

      {openProductId && (
        <FormatPicker
          product={active.find((p) => p.id === openProductId)!}
          stock={stock}
          existing={lines.filter((l) => l.productId === openProductId)}
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

const CATEGORY_LABEL: Record<string, string> = {
  'jamones': 'Jamones',
  'salames': 'Salames',
  'chorizos': 'Chorizos y fuet',
  'cabanossi': 'Cabanossi',
  'embutidos-frescos': 'Embutidos frescos',
  'mortadelas': 'Mortadelas',
  'pastramis': 'Pastramis',
  'carnes-curadas': 'Carnes curadas',
  'quesos': 'Quesos',
  'tablas': 'Tablas charcuteras',
  'untables': 'Untables y patés',
  'charqui': 'Charqui',
};

function ProductGrid({ products, lines, openId, onOpen }: { products: Product[]; lines: DraftLine[]; openId: string | null; onOpen: (id: string) => void }) {
  const byCat = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of products) {
      const list = m.get(p.category) ?? [];
      list.push(p); m.set(p.category, list);
    }
    return m;
  }, [products]);

  return (
    <div className="space-y-4">
      {[...byCat.entries()].map(([cat, list]) => (
        <div key={cat}>
          <p className="eyebrow mb-2 px-0.5">{CATEGORY_LABEL[cat] ?? cat}</p>
          <div className="flex flex-wrap gap-1.5">
            {list.map((p) => {
              const has = lines.some((l) => l.productId === p.id);
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
                <span className="font-medium text-charcoal-700">{fmt.label}</span>
                <SemaphoreBadge level={sem} note={`Disponible ${formatQty(av, fmt.unit)}`} />
              </div>
              <Stepper
                value={current.qty}
                onChange={(qty) => setPending((s) => ({ ...s, [fmt.formatId]: { ...current, qty } }))}
                step={fmt.unit === 'kg' ? 0.5 : 1}
                decimals={fmt.unit === 'kg' ? 2 : 0}
                quick={fmt.unit === 'kg' ? [0.5, 1, 5] : [1, 5, 10]}
              />
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

function SelectedLines({ lines, onRemove }: { lines: DraftLine[]; onRemove: (l: DraftLine) => void }) {
  if (lines.length === 0) return null;
  return (
    <div className="card p-4">
      <p className="eyebrow mb-2">Líneas en este pedido</p>
      <ul className="divide-y divide-charcoal-100">
        {lines.map((l) => (
          <li key={`${l.productId}-${l.formatId}`} className="flex items-center justify-between gap-2 text-sm py-2 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="text-charcoal-700 truncate font-medium">{l.productName}</div>
              <div className="text-xs text-charcoal-300 truncate">
                {l.formatLabel}{l.notes ? ` · ${l.notes}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-semibold text-charcoal-700">{formatQty(l.qty, l.unit)}</span>
              <button onClick={() => onRemove(l)} className="text-[11px] uppercase tracking-display text-charcoal-300 hover:text-red-700">Quitar</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Step 3: Entrega ----------

function StepEntrega({
  client, draft, onUpdate, onNext, onBack,
}: {
  client: Client;
  draft: Draft;
  onUpdate: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
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
        <label className="eyebrow block mb-1.5">Horario de recepción</label>
        <input
          value={draft.receivingHours || client.receivingHours || ''}
          onChange={(e) => onUpdate('receivingHours', e.target.value)}
          placeholder="Ej: L-V 09:00-14:00"
          className="field"
        />
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="secondary" onClick={onBack} className="flex-1">Volver</Button>
        <Button onClick={onNext} className="flex-1">Siguiente</Button>
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
    return { line: l, available: av, reserved: Math.min(av, l.qty), pending: Math.max(0, l.qty - av) };
  }), [draft.lines, stock]);

  const anyPending = preview.some((p) => p.pending > 0);

  return (
    <section className="space-y-4">
      <div className="card p-4">
        <p className="eyebrow">Cliente</p>
        <p className="font-semibold text-charcoal-900 mt-1">{client.fantasyName ?? client.name}</p>
        <p className="text-xs text-charcoal-300 mt-0.5">
          {client.rut ?? 'Sin RUT'} · {draft.deliveryMode === 'retiro' ? 'Retiro' : (draft.deliveryAddress || client.address)}
        </p>
        <p className="text-xs text-charcoal-300 mt-1.5 first-letter:uppercase">
          Solicitado para {formatDateLong(draft.requestedDate)}
        </p>
        {!client.invoicingComplete && (
          <p className="mt-3 text-xs text-brass-700 bg-brass-50 border border-brass-300 rounded px-2 py-1.5">
            Datos de facturación incompletos — se creará y quedará marcado.
          </p>
        )}
      </div>

      <div className="card p-4">
        <p className="eyebrow mb-2">Líneas ({preview.length})</p>
        <ul className="divide-y divide-charcoal-100">
          {preview.map((p) => (
            <li key={`${p.line.productId}-${p.line.formatId}`} className="py-2.5 first:pt-0 last:pb-0 text-sm">
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-charcoal-700 truncate font-medium">{p.line.productName}</div>
                  <div className="text-xs text-charcoal-300 truncate">
                    {p.line.formatLabel}{p.line.notes ? ` · ${p.line.notes}` : ''}
                  </div>
                </div>
                <div className="font-semibold text-charcoal-700 shrink-0">{formatQty(p.line.qty, p.line.unit)}</div>
              </div>
              {p.pending > 0 && (
                <p className="text-[11px] uppercase tracking-display text-brass-700 mt-1">
                  {formatQty(p.reserved, p.line.unit)} reservado · {formatQty(p.pending, p.line.unit)} a producción
                </p>
              )}
            </li>
          ))}
        </ul>
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
