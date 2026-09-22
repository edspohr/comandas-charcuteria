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
import type { Client, Product, ProductFormat } from '@/domain/types';

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

  const [draft, setDraft] = useState<Draft>(() => loadDraft<Draft>(uid) ?? emptyDraft());
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

  // Autosave to localStorage on every change
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
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Nuevo pedido</h1>
        <button
          onClick={() => { if (confirm('¿Descartar borrador?')) { clearDraft(uid); setDraft(emptyDraft()); } }}
          className="text-xs text-slate-500 hover:text-slate-800"
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

// ---------- Step 1: Cliente ----------

function Steps({ current, onGo }: { current: number; onGo: (n: number) => void }) {
  const labels = ['Cliente', 'Productos', 'Entrega', 'Confirmar'];
  return (
    <ol className="flex items-center gap-1 mb-4 text-xs">
      {labels.map((label, i) => {
        const n = i + 1;
        const active = current === n;
        const done = current > n;
        return (
          <li key={label} className="flex-1">
            <button
              onClick={() => onGo(n)}
              disabled={n > current}
              className={
                'w-full px-2 py-2 rounded-lg font-medium disabled:cursor-not-allowed ' +
                (active ? 'bg-brand-500 text-white'
                       : done ? 'bg-brand-100 text-brand-700'
                              : 'bg-slate-100 text-slate-500')
              }
            >
              {n}. {label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

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
    <section className="space-y-3">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar cliente por nombre, fantasía o RUT"
        className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-white shadow-sm outline-none focus:border-brand-500"
      />
      {canRepeat && selectedId && (
        <Button variant="secondary" size="md" onClick={onRepeat} className="w-full">
          Repetir último pedido de este cliente
        </Button>
      )}
      <ul className="space-y-1">
        {results.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c)}
              className={
                'w-full text-left rounded-xl border p-3 bg-white shadow-sm ' +
                (c.id === selectedId ? 'border-brand-500' : 'border-slate-200 hover:border-slate-300')
              }
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">{c.fantasyName ?? c.name}</span>
                {c.isInternalShop && <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full">Tienda</span>}
                {!c.invoicingComplete && <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Datos facturación incompletos</span>}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
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
  stock: Map<string, import('@/domain/types').StockDoc>;
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
      productId: product.id,
      productName: product.name,
      formatId: format.formatId,
      formatLabel: format.label,
      unit: format.unit,
      qty,
      notes,
    };
    if (idx >= 0) {
      const copy = [...lines];
      copy[idx] = next;
      onLines(copy);
    } else {
      onLines([...lines, next]);
    }
  }

  return (
    <section className="space-y-3">
      <ProductGrid products={active} openId={openProductId} onOpen={setOpenProductId} />

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

      <SelectedLines lines={lines} onRemove={(l) => onLines(lines.filter((x) => !(x.productId === l.productId && x.formatId === l.formatId)))} />

      <div className="flex gap-2 pt-2 sticky bottom-0 bg-brand-50 py-3">
        <Button variant="secondary" onClick={onBack} className="flex-1">Volver</Button>
        <Button onClick={onNext} disabled={lines.length === 0} className="flex-1">
          Siguiente ({lines.length} {lines.length === 1 ? 'línea' : 'líneas'})
        </Button>
      </div>
    </section>
  );
}

function ProductGrid({ products, openId, onOpen }: { products: Product[]; openId: string | null; onOpen: (id: string) => void }) {
  const byCat = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of products) {
      const list = m.get(p.category) ?? [];
      list.push(p);
      m.set(p.category, list);
    }
    return m;
  }, [products]);

  return (
    <div className="space-y-3">
      {[...byCat.entries()].map(([cat, list]) => (
        <div key={cat}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1 px-1">{cat}</p>
          <div className="flex flex-wrap gap-1.5">
            {list.map((p) => (
              <button
                key={p.id}
                onClick={() => onOpen(p.id)}
                className={
                  'rounded-full border px-3 py-1.5 text-sm shadow-sm ' +
                  (openId === p.id ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-slate-200 hover:border-slate-300')
                }
              >
                {p.name}
              </button>
            ))}
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
  stock: Map<string, import('@/domain/types').StockDoc>;
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
    <div className="rounded-xl border border-brand-500 bg-white p-4 shadow">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-slate-900">{product.name}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg" aria-label="Cerrar">×</button>
      </div>
      <ul className="space-y-3">
        {product.formats.map((fmt) => {
          const av = availableFor(stock, product.id, fmt.formatId);
          const current = pending[fmt.formatId] ?? { qty: 0, notes: '' };
          const sem = semaphore(av, current.qty || 1);
          return (
            <li key={fmt.formatId} className="border-t pt-3 first:border-none first:pt-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-medium text-slate-800">{fmt.label}</span>
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
                placeholder="Notas (opcional) — laminado fino, sin jugo…"
                className="mt-2 w-full h-9 px-3 rounded-lg border border-slate-200 text-sm outline-none focus:border-brand-500"
              />
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2 mt-4">
        <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
        <Button onClick={commit} className="flex-1">Agregar</Button>
      </div>
    </div>
  );
}

function SelectedLines({ lines, onRemove }: { lines: DraftLine[]; onRemove: (l: DraftLine) => void }) {
  if (lines.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold text-slate-500 mb-2">Líneas en este pedido</p>
      <ul className="space-y-1">
        {lines.map((l) => (
          <li key={`${l.productId}-${l.formatId}`} className="flex items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <div className="text-slate-900 truncate">{l.productName} · {l.formatLabel}</div>
              {l.notes && <div className="text-xs text-slate-500 truncate">{l.notes}</div>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-medium text-slate-700">{formatQty(l.qty, l.unit)}</span>
              <button onClick={() => onRemove(l)} className="text-slate-400 hover:text-red-600 text-sm">Quitar</button>
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
    <section className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Fecha solicitada</label>
        <input
          type="date"
          value={draft.requestedDate}
          min={minRequestedDate()}
          onChange={(e) => onUpdate('requestedDate', e.target.value)}
          className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white outline-none focus:border-brand-500"
        />
        <p className="text-xs text-slate-500 mt-1">{formatDateLong(draft.requestedDate)}</p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Modalidad</label>
        <div className="grid grid-cols-2 gap-2">
          {(['retiro', 'despacho'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onUpdate('deliveryMode', m)}
              className={
                'h-11 rounded-xl border font-medium ' +
                (draft.deliveryMode === m ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-slate-200 text-slate-700')
              }
            >
              {m === 'retiro' ? 'Retiro en tienda' : 'Despacho'}
            </button>
          ))}
        </div>
      </div>

      {draft.deliveryMode === 'despacho' && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Dirección de despacho</label>
          <input
            value={draft.deliveryAddress || client.address || ''}
            onChange={(e) => onUpdate('deliveryAddress', e.target.value)}
            placeholder="Dirección (prefijada del cliente)"
            className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white outline-none focus:border-brand-500"
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Horario de recepción</label>
        <input
          value={draft.receivingHours || client.receivingHours || ''}
          onChange={(e) => onUpdate('receivingHours', e.target.value)}
          placeholder="Ej: L-V 09:00-14:00"
          className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white outline-none focus:border-brand-500"
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
  stock: Map<string, import('@/domain/types').StockDoc>;
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
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold text-slate-500 mb-1">Cliente</p>
        <p className="font-medium text-slate-900">{client.fantasyName ?? client.name}</p>
        <p className="text-xs text-slate-500">{client.rut ?? 'Sin RUT'} · {draft.deliveryMode === 'retiro' ? 'Retiro' : (draft.deliveryAddress || client.address)}</p>
        <p className="text-xs text-slate-500 mt-1">Solicitado para {formatDateLong(draft.requestedDate)}</p>
        {!client.invoicingComplete && (
          <p className="mt-2 text-xs text-amber-800 bg-amber-50 rounded px-2 py-1">
            Datos de facturación incompletos — se creará igual y el pedido se marcará para completar.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold text-slate-500 mb-2">Líneas ({preview.length})</p>
        <ul className="space-y-2">
          {preview.map((p) => (
            <li key={`${p.line.productId}-${p.line.formatId}`} className="text-sm">
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-slate-900 truncate">{p.line.productName} · {p.line.formatLabel}</div>
                  {p.line.notes && <div className="text-xs text-slate-500 truncate">{p.line.notes}</div>}
                </div>
                <div className="font-medium text-slate-700 shrink-0">{formatQty(p.line.qty, p.line.unit)}</div>
              </div>
              {p.pending > 0 && (
                <p className="text-xs text-amber-800 mt-0.5">
                  {formatQty(p.reserved, p.line.unit)} reservado · {formatQty(p.pending, p.line.unit)} a producción
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {anyPending && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 p-3 text-sm">
          Alguna línea no tiene stock suficiente. Se enviará lo disponible y el resto quedará a producción (Yuri lo verá).
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 p-3 text-sm">{error}</div>
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
