import { useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { photoToJpegBase64 } from '@/lib/image';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import DataTable, { Pill } from '@/components/ui/DataTable';
import { can } from '@/domain/permissions';
import type { Product } from '@/domain/types';
import { useCurrentUser } from '@/data/auth';
import { useProducts } from '@/data/products';
import { useProduccionData, type DemandRow } from '@/data/produccion';
import { syncStockFromBsale, useSyncState } from '@/data/stock';
import { loadProduction, loadResultText, markLoadedInBsale, useProductionLog, type ProductionEntry, type ProductionLine } from '@/data/productionLog';
import { parseLocal, type ParsedLine } from '@/domain/parse/local';
import { geminiEnabled, parseWithGemini } from '@/domain/parse/gemini';
import { addDaysIso, formatDateLong, formatDateShort, formatQty, todayInSantiago } from '@/lib/format';
import { describeFirestoreError } from '@/lib/errors';

type View = 'hoy' | 'stock' | 'foto' | 'mano';
type Photo = { base64: string; mimeType: 'image/jpeg'; dataUrl: string };

// Producción: la herramienta diaria de la planta. «Hoy» dice qué producir
// (lo que los pedidos esperan, por fecha de entrega), permite cargar lo
// producido con foto de la planilla o a mano (siempre con PIN) y muestra lo
// ya cargado. «Todo el stock» es el detalle Bsale vs. reservas.
export default function Produccion() {
  const { current } = useCurrentUser();
  const me = current!.appUser;
  const canReceive = can(me.role, 'production.receive');
  const supervisor = me.role === 'admin' || me.role === 'superAdmin';
  const { rows, loading, error } = useProduccionData();
  const { products } = useProducts();
  const sync = useSyncState();
  const [view, setView] = useState<View>('hoy');
  const [prefill, setPrefill] = useState<ProductionLine[]>([]);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);

  const today = todayInSantiago();
  const tomorrow = addDaysIso(today, 1);
  const startToday = useMemo(() => new Date(`${today}T00:00:00`).getTime(), [today]);
  const since = useMemo(() => startToday - 6 * 86_400_000, [startToday]);
  const log = useProductionLog(since);
  const loadedToday = log.entries.filter((e) => e.at >= startToday);
  const toBsale = log.entries.filter((e) => e.bsaleStatus === 'por_cargar');

  const todo = useMemo(() => rows.filter((r) => r.toProduce > 0).map((r) => {
    const waiting = r.affectingOrders.filter((a) => a.pendingProductionQty > 0).sort((a, b) => (a.requestedDate + (a.window ?? '')).localeCompare(b.requestedDate + (b.window ?? '')));
    return { row: r, waiting, first: waiting[0] ?? r.affectingOrders[0] };
  }).sort((a, b) => (a.first?.requestedDate ?? '9').localeCompare(b.first?.requestedDate ?? '9') || b.row.toProduce - a.row.toProduce), [rows]);
  const groups = [
    { key: 'hoy', title: 'Para hoy', items: todo.filter((t) => (t.first?.requestedDate ?? today) <= today) },
    { key: 'manana', title: 'Para mañana', items: todo.filter((t) => t.first?.requestedDate === tomorrow) },
    { key: 'despues', title: 'Próximos días', items: todo.filter((t) => (t.first?.requestedDate ?? today) > tomorrow) },
  ].filter((g) => g.items.length > 0);
  const waitingOrders = new Set(todo.flatMap((t) => t.waiting.map((w) => w.orderId))).size;

  const lineOf = (r: DemandRow, qty = r.toProduce): ProductionLine => ({ productId: r.productId, formatId: r.formatId, productName: r.productName, formatLabel: r.formatLabel, unit: r.unit, qty });
  function registerFor(lines: ProductionLine[]) { setPrefill(lines); setFlash(null); setView('mano'); window.scrollTo(0, 0); }
  function done(msg: string) { setFlash(msg); setPrefill([]); setPhoto(null); setView('hoy'); window.scrollTo(0, 0); }

  async function takePhoto(file: File | undefined) {
    if (!file) return;
    setPageError(null);
    try { setPhoto(await photoToJpegBase64(file)); setFlash(null); setView('foto'); window.scrollTo(0, 0); } catch (e) { setPageError((e as Error).message); }
  }

  async function doSync() {
    setSyncing(true); setPageError(null); setFlash(null);
    try {
      const r = await syncStockFromBsale(me.uid);
      setFlash(r.updated === 0 && r.promoted.length === 0 ? 'Bsale no reporta cambios de stock.'
        : `Stock actualizado en ${r.updated} formato${r.updated === 1 ? '' : 's'}.` + (r.absorbed > 0 ? ` Se asignaron ${r.absorbed} u/kg a pedidos que esperaban.` : '') + (r.promoted.length > 0 ? ` Listos para armar: ${r.promoted.join(', ')}.` : ''));
    } catch (e) { setPageError(describeFirestoreError(e)); } finally { setSyncing(false); }
  }

  const user = { uid: me.uid, name: me.displayName };
  const cameraInput = <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void takePhoto(e.target.files?.[0]); e.target.value = ''; }} />;

  if (view === 'foto' || view === 'mano') {
    return (
      <div className="max-w-2xl">
        {cameraInput}
        <button onClick={() => { setView('hoy'); setPhoto(null); setPrefill([]); }} className="mb-3 inline-flex items-center gap-1 text-sm text-charcoal-500 hover:text-charcoal-900">
          <Icon name="chevron" size={16} className="rotate-90" /> Volver a Producción
        </button>
        <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase mb-1">{view === 'foto' ? 'Cargar con foto' : 'Cargar producción'}</h1>
        <p className="text-xs text-charcoal-300 mb-4">Revise las cantidades y confirme con su PIN. Queda registrado a su nombre.</p>
        {view === 'foto'
          ? <ProduccionIA user={user} photo={photo} onRetake={() => camera.current?.click()} onClearPhoto={() => setPhoto(null)} onDone={done} />
          : <RegistrarProduccion user={user} products={products} initial={prefill} suggestions={todo.map((t) => lineOf(t.row))} onDone={done} />}
      </div>
    );
  }

  return (
    <div>
      {cameraInput}
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Producción</h1>
          <p className="text-xs text-charcoal-300 mt-1 first-letter:uppercase">
            {formatDateLong(today)} · {sync?.at ? `stock Bsale ${new Date(sync.at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : 'sin sincronizar'}
          </p>
        </div>
        {can(me.role, 'stock.sync') && (
          <button onClick={doSync} disabled={syncing} aria-label="Sincronizar con Bsale" title="Sincronizar con Bsale" className="h-10 w-10 shrink-0 rounded-md border border-charcoal-200 bg-white text-charcoal-500 hover:text-charcoal-900 flex items-center justify-center disabled:opacity-50">
            <Icon name="sync" size={18} className={syncing ? 'animate-spin' : ''} />
          </button>
        )}
      </header>

      {canReceive && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button onClick={() => camera.current?.click()} className="rounded-xl bg-charcoal-900 text-cream-50 p-4 text-left shadow-soft active:scale-[0.98] transition">
            <Icon name="camera" size={26} className="text-brass-300" />
            <p className="mt-2 font-semibold">Fotografiar planilla</p>
            <p className="text-[11px] text-cream-200/80">La IA lee las cantidades</p>
          </button>
          <button onClick={() => registerFor([])} className="rounded-xl bg-white border border-charcoal-200 p-4 text-left shadow-soft active:scale-[0.98] transition">
            <Icon name="pencil" size={26} className="text-brass-600" />
            <p className="mt-2 font-semibold text-charcoal-900">Registrar a mano</p>
            <p className="text-[11px] text-charcoal-300">Producto y cantidad</p>
          </button>
        </div>
      )}

      {flash && <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm mb-4">{flash}</div>}
      {pageError && <div className="mb-4"><ErrorBanner message={pageError} /></div>}
      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      <div className="grid grid-cols-3 gap-2 mb-4">
        <Kpi label="Por producir" value={loading ? '…' : String(todo.length)} sub={todo.length ? totals(todo.map((t) => lineOf(t.row))) : 'todo cubierto'} tone={todo.length ? 'warn' : 'ok'} />
        <Kpi label="Pedidos esperando" value={loading ? '…' : String(waitingOrders)} sub={waitingOrders ? 'sin stock' : 'ninguno'} />
        <Kpi label="Cargado hoy" value={log.loading ? '…' : String(loadedToday.length)} sub={loadedToday.length ? totals(loadedToday.flatMap((e) => e.lines)) : 'aún nada'} />
      </div>

      {toBsale.length > 0 && (
        <div className="mb-4 rounded-md bg-brass-50 border border-brass-300 text-brass-800 px-3 py-2 text-xs">
          {toBsale.length} carga{toBsale.length === 1 ? '' : 's'} por pasar a Bsale. Las escrituras hacia Bsale están apagadas: la oficina las carga en Bsale{supervisor ? ' y las marca aquí abajo' : ''}; el stock se actualiza con la sincronización.
        </div>
      )}

      <nav className="mb-4 flex gap-1 border-b border-charcoal-100">
        {([['hoy', 'Qué producir'], ['stock', 'Todo el stock']] as Array<[View, string]>).map(([v, label]) => (
          <button key={v} onClick={() => setView(v)} className={'px-4 py-2.5 text-xs uppercase tracking-display font-medium border-b-2 transition -mb-px ' + (v === view ? 'border-brass-500 text-charcoal-900' : 'border-transparent text-charcoal-300 hover:text-charcoal-500')}>{label}</button>
        ))}
      </nav>

      {loading && !error && <p className="text-sm text-charcoal-300">Cargando…</p>}

      {view === 'hoy' && !loading && (
        <div className="space-y-6">
          {groups.length === 0 && (
            <div className="card p-6 text-center">
              <p className="font-semibold text-charcoal-900">No hay pedidos esperando producción</p>
              <p className="text-sm text-charcoal-500 mt-1">Todo lo pedido tiene stock en Bsale. Revise «Todo el stock» para planificar.</p>
            </div>
          )}
          {groups.map((g) => (
            <section key={g.key}>
              <div className="flex items-center justify-between mb-2">
                <p className="eyebrow">{g.title} · {g.items.length}</p>
                {canReceive && g.items.length > 1 && <button onClick={() => registerFor(g.items.map((t) => lineOf(t.row)))} className="text-xs underline text-charcoal-500 hover:text-charcoal-900">Registrar todo esto</button>}
              </div>
              <ul className="space-y-2">
                {g.items.map((t) => <TodoCard key={`${t.row.productId}::${t.row.formatId}`} item={t} today={today} tomorrow={tomorrow} onRegister={canReceive ? () => registerFor([lineOf(t.row)]) : undefined} />)}
              </ul>
            </section>
          ))}
          <ProductionHistory entries={log.entries} startToday={startToday} canMark={supervisor} uid={me.uid} />
        </div>
      )}

      {view === 'stock' && !loading && <StockTable rows={rows} />}
    </div>
  );
}

function totals(lines: Array<{ unit: 'g' | 'kg' | 'unidad'; qty: number }>): string {
  const kg = lines.reduce((s, l) => s + (l.unit === 'kg' ? l.qty : l.unit === 'g' ? l.qty / 1000 : 0), 0);
  const u = lines.reduce((s, l) => s + (l.unit === 'unidad' ? l.qty : 0), 0);
  return [kg > 0 && formatQty(Math.round(kg * 10) / 10, 'kg'), u > 0 && formatQty(u, 'unidad')].filter(Boolean).join(' · ') || '—';
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'warn' | 'ok' }) {
  return (
    <div className="card p-3 min-w-0">
      <p className="text-[10px] uppercase tracking-display text-charcoal-300 leading-tight">{label}</p>
      <p className={'text-2xl font-semibold mt-0.5 ' + (tone === 'warn' ? 'text-brass-700' : tone === 'ok' ? 'text-emerald-700' : 'text-charcoal-900')}>{value}</p>
      <p className="text-[11px] text-charcoal-500 truncate">{sub}</p>
    </div>
  );
}

function dayLabel(iso: string, today: string, tomorrow: string) {
  if (iso < today) return `atrasado (${formatDateShort(iso)})`;
  if (iso === today) return 'hoy';
  if (iso === tomorrow) return 'mañana';
  return formatDateShort(iso);
}

function TodoCard({ item, today, tomorrow, onRegister }: { item: { row: DemandRow; waiting: DemandRow['affectingOrders']; first?: DemandRow['affectingOrders'][number] }; today: string; tomorrow: string; onRegister?: () => void }) {
  const [open, setOpen] = useState(false);
  const { row: r, waiting, first } = item;
  const late = !!first && first.requestedDate < today;
  return (
    <li className={'card p-3 ' + (late ? 'border-l-4 border-l-red-600' : '')}>
      <div className="flex items-start gap-3">
        <button onClick={() => setOpen((v) => !v)} className="flex-1 min-w-0 text-left">
          <p className="font-semibold text-charcoal-900 leading-snug">{r.productName}</p>
          <p className="text-[11px] text-charcoal-300">{r.formatLabel}</p>
          {first && (
            <p className={'text-xs mt-1 ' + (late ? 'text-red-700' : 'text-charcoal-500')}>
              {waiting.length} pedido{waiting.length === 1 ? '' : 's'} · primero {first.clientName}, {dayLabel(first.requestedDate, today, tomorrow)}{first.window ? ` ${first.window}` : ''}
            </p>
          )}
          <p className="text-[11px] text-charcoal-300 mt-0.5">Bsale {formatQty(r.onHand, r.unit)} · reservado {formatQty(r.reserved, r.unit)} <span className="underline ml-1">{open ? 'ocultar' : 'ver pedidos'}</span></p>
        </button>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-display text-charcoal-300">Producir</p>
          <p className="text-xl font-semibold text-brass-700 leading-tight">{formatQty(r.toProduce, r.unit)}</p>
          {onRegister && <Button size="sm" variant="secondary" className="mt-1.5" onClick={onRegister}>Registrar</Button>}
        </div>
      </div>
      {open && (
        <ul className="mt-2 pt-2 border-t border-charcoal-100 text-xs divide-y divide-charcoal-100">
          {r.affectingOrders.map((a) => (
            <li key={a.orderId} className="py-1.5 flex items-center justify-between gap-2">
              <span className="text-charcoal-700 min-w-0 truncate"><span className="font-mono text-charcoal-300">{a.orderId}</span> · {a.clientName}</span>
              <span className="text-charcoal-500 shrink-0">{dayLabel(a.requestedDate, today, tomorrow)}{a.window ? ` ${a.window}` : ''}{a.pendingProductionQty > 0 && <span className="text-brass-700 font-semibold"> · faltan {formatQty(a.pendingProductionQty, r.unit)}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

const STATUS_PILL: Record<ProductionEntry['bsaleStatus'], [string, 'ok' | 'warn' | 'muted' | 'info']> = {
  ok: ['En Bsale', 'ok'], cargado_manual: ['Cargado en Bsale', 'ok'], simulado: ['Simulacro', 'muted'], por_cargar: ['Por cargar en Bsale', 'warn'],
};
const SOURCE: Record<ProductionEntry['source'], string> = { foto: 'foto', texto: 'texto', manual: 'a mano' };

function ProductionHistory({ entries, startToday, canMark, uid }: { entries: ProductionEntry[]; startToday: number; canMark: boolean; uid: string }) {
  const [showOld, setShowOld] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const today = entries.filter((e) => e.at >= startToday);
  const older = entries.filter((e) => e.at < startToday);
  const list = showOld ? entries : today;
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <p className="eyebrow">Cargado hoy · {today.length}</p>
        {older.length > 0 && <button onClick={() => setShowOld((v) => !v)} className="text-xs underline text-charcoal-500">{showOld ? 'Solo hoy' : `Ver últimos 7 días (${older.length})`}</button>}
      </div>
      {list.length === 0 ? <p className="text-sm text-charcoal-300">Aún no se carga producción hoy.</p> : (
        <ul className="space-y-2">
          {list.map((e) => {
            const [label, tone] = STATUS_PILL[e.bsaleStatus];
            return (
              <li key={e.id} className="card p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs text-charcoal-500">
                    <span className="font-semibold text-charcoal-900">{new Date(e.at).toLocaleString('es-CL', e.at >= startToday ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> · {e.byName} · {SOURCE[e.source]}
                  </p>
                  <Pill tone={tone}>{label}</Pill>
                </div>
                <ul className="mt-1.5 text-sm text-charcoal-800 space-y-0.5">
                  {e.lines.map((l, i) => <li key={i}><span className="font-semibold">{formatQty(l.qty, l.unit)}</span> {l.productName} <span className="text-charcoal-300 text-xs">· {l.formatLabel}</span></li>)}
                </ul>
                {e.note && <p className="text-[11px] text-charcoal-300 mt-1">{e.note}</p>}
                {canMark && e.bsaleStatus === 'por_cargar' && (
                  <Button size="sm" variant="secondary" className="mt-2" disabled={busy === e.id} onClick={async () => { setBusy(e.id); try { await markLoadedInBsale(e.id, uid); } finally { setBusy(null); } }}>Ya la cargué en Bsale</Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function StockTable({ rows }: { rows: DemandRow[] }) {
  const [q, setQ] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const visible = rows.filter((r) => (!onlyPending || r.toProduce > 0) && (!q.trim() || norm(`${r.productName} ${r.formatLabel}`).includes(norm(q.trim()))));
  return (
    <>
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[12rem]">
          <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-300" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto" className="field h-10 pl-9 text-sm" />
        </div>
        <button onClick={() => setOnlyPending((v) => !v)} className={'rounded-md px-2.5 py-2 text-[11px] uppercase tracking-display font-medium border transition ' + (onlyPending ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500')}>Solo por producir</button>
      </div>
      <p className="text-xs text-charcoal-300 mb-2">{visible.length} formatos · toque una fila para ver los pedidos</p>
      <DataTable<DemandRow>
        rows={visible}
        rowKey={(r) => `${r.productId}::${r.formatId}`}
        dense
        rowTone={(r) => (r.onHand < r.reserved ? 'bad' : r.toProduce > 0 ? 'warn' : undefined)}
        columns={[
          { key: 'product', label: 'Producto', mobile: true, render: (r) => <div><p className="font-semibold text-charcoal-900">{r.productName}</p><p className="text-[11px] text-charcoal-300">{r.formatLabel}</p></div> },
          { key: 'toProduce', label: 'A producir', align: 'right', mobile: true, render: (r) => r.toProduce > 0 ? <span className="font-semibold text-brass-700">{formatQty(r.toProduce, r.unit)}</span> : <span className="text-charcoal-300">—</span> },
          { key: 'onHand', label: 'Bsale', align: 'right', render: (r) => formatQty(r.onHand, r.unit) },
          { key: 'reserved', label: 'Reservado', align: 'right', render: (r) => formatQty(r.reserved, r.unit), muted: true },
          { key: 'available', label: 'Disponible', align: 'right', mobile: true, render: (r) => r.onHand < r.reserved ? <Pill tone="bad">comprometido</Pill> : <span className={r.available > 0 ? 'text-emerald-700 font-semibold' : 'text-charcoal-500'}>{formatQty(r.available, r.unit)}</span> },
          { key: 'orders', label: 'Pedidos', align: 'right', render: (r) => r.affectingOrders.length || '—', muted: true },
        ]}
        expand={(r) => (
          <div>
            <p className="eyebrow mb-1">Pedidos que dependen de este formato</p>
            {r.affectingOrders.length === 0 ? <p className="text-xs text-charcoal-300">Ninguno.</p> : (
              <ul className="text-xs divide-y divide-charcoal-100">
                {r.affectingOrders.map((a) => (
                  <li key={a.orderId} className="py-1 flex items-center justify-between gap-2">
                    <span className="text-charcoal-700"><span className="font-mono text-charcoal-300">{a.orderId}</span> · {a.clientName}</span>
                    <span className="text-charcoal-500 shrink-0 first-letter:uppercase">{formatDateShort(a.requestedDate)}{a.window ? ` ${a.window}` : ''} · reservado {formatQty(a.reservedQty, r.unit)}{a.pendingProductionQty > 0 && <span className="text-brass-700"> · faltan {formatQty(a.pendingProductionQty, r.unit)}</span>}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      />
    </>
  );
}

// ---------- Cargar con foto o texto (IA) ----------

interface StockLine { productId: string; productName: string; formatId: string; formatLabel: string; unit: 'g' | 'kg' | 'unidad'; qty: number; raw: string; ok: boolean; }

function ProduccionIA({ user, photo, onRetake, onClearPhoto, onDone }: { user: { uid: string; name: string }; photo: Photo | null; onRetake: () => void; onClearPhoto: () => void; onDone: (msg: string) => void }) {
  const { products } = useProducts();
  const [text, setText] = useState('');
  const [lines, setLines] = useState<StockLine[] | null>(null);
  const [engine, setEngine] = useState<'ai' | 'local' | null>(null);
  const [aiFallback, setAiFallback] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const toLines = (parsed: ParsedLine[]): StockLine[] => parsed
    .filter((l) => l.status !== 'not_found')
    .map((l) => ({ productId: l.productId ?? '', productName: l.productName ?? '', formatId: l.formatId ?? '', formatLabel: l.formatLabel ?? '', unit: l.unit ?? 'unidad', qty: l.qty ?? 0, raw: l.raw, ok: l.status === 'verified' }));

  async function interpret() {
    if (busy || (text.trim().length < 3 && !photo)) return;
    setBusy(true); setError(null); setEngine(null); setAiFallback(false);
    let usedFallback = false;
    try {
      if (geminiEnabled()) {
        try {
          const remote = await parseWithGemini(text, products, photo ?? undefined);
          if (remote.length > 0) { setLines(toLines(remote)); setEngine('ai'); return; }
        } catch (e) { console.warn('[produccion-ia] Gemini failed, local fallback', e); usedFallback = true; }
      }
      if (photo && text.trim().length < 3) {
        // The local parser can't read photos.
        setError(usedFallback ? 'La IA no está disponible en este momento: no se pudo leer la foto. Use «Registrar a mano» o intente de nuevo en unos minutos.' : 'No se identificaron productos en la foto. Tome otra con mejor luz y la planilla completa, o escriba las cantidades.');
        return;
      }
      setLines(toLines(parseLocal(text, products)));
      setEngine('local');
      if (usedFallback) setAiFallback(true);
    } finally { setBusy(false); }
  }

  function update(i: number, patch: Partial<StockLine>) {
    setLines((prev) => prev ? prev.map((l, j) => (j === i ? { ...l, ...patch } : l)) : prev);
  }
  function setProduct(i: number, productId: string) {
    const p = products.find((x) => x.id === productId); if (!p) return;
    const f = p.formats.find((x) => x.formatId === lines?.[i].formatId) ?? p.formats[0];
    update(i, { productId: p.id, productName: p.name, formatId: f.formatId, formatLabel: f.label, unit: f.unit, ok: true });
  }
  function setFormat(i: number, formatId: string) {
    const p = products.find((x) => x.id === lines?.[i].productId); const f = p?.formats.find((x) => x.formatId === formatId); if (!f) return;
    update(i, { formatId: f.formatId, formatLabel: f.label, unit: f.unit });
  }

  const usable = (lines ?? []).filter((l) => l.productId && l.formatId && l.qty > 0);

  async function confirm() {
    if (usable.length === 0) return;
    setBusy(true); setError(null);
    try {
      const r = await loadProduction(usable.map((l) => ({ productId: l.productId, formatId: l.formatId, productName: l.productName, formatLabel: l.formatLabel, unit: l.unit, qty: l.qty })), user, photo ? 'foto' : 'texto', note.trim() || undefined);
      onDone(loadResultText(r));
    } catch (e) { setError(describeFirestoreError(e)); setBusy(false); }
  }

  return (
    <div>
      <div className="card p-4 mb-4">
        {photo ? (
          <div className="mb-3 flex items-start gap-3">
            <img src={photo.dataUrl} alt="Foto de la planilla" className="w-28 h-28 object-cover rounded-md border border-charcoal-100" />
            <div className="text-xs text-charcoal-500 space-y-2">
              <p>Foto lista. Si quiere, aclare algo abajo (ej.: «la última fila es de ayer»).</p>
              <div className="flex gap-3">
                <button onClick={onRetake} className="underline hover:text-charcoal-900">Tomar otra</button>
                <button onClick={onClearPhoto} className="underline hover:text-red-700">Quitar foto</button>
              </div>
            </div>
          </div>
        ) : (
          <Button onClick={onRetake} disabled={busy} className="w-full mb-3"><Icon name="camera" size={18} /> Fotografiar planilla</Button>
        )}
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={photo ? 2 : 6} placeholder={photo ? 'Aclaración (opcional)' : 'O pegue el reporte: salieron 20 kg de longaniza chillán granel, 60 sachet de jamón cocido…'} className="field h-auto py-3 text-sm resize-y" />
        <Button size="lg" onClick={interpret} disabled={busy || (text.trim().length < 3 && !photo)} className="w-full mt-3">{busy && !lines ? (photo ? 'Leyendo la foto…' : 'Interpretando…') : photo ? 'Leer la foto' : 'Interpretar'}</Button>
      </div>

      {error && !lines && <div className="mb-3 rounded-md bg-red-50 border border-red-200 text-red-800 p-3 text-sm">{error}</div>}

      {aiFallback && (
        <div className="mb-3 rounded-md bg-brass-50 border border-brass-300 text-brass-700 px-3 py-2 text-xs">
          Se usó el intérprete local (la IA no está disponible en este momento). Revise cada línea antes de cargar.
        </div>
      )}

      {lines && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-1">
            <p className="eyebrow">Revise lo que leyó la IA · {lines.length}{engine === 'local' && <span className="ml-2 normal-case tracking-normal text-charcoal-300">· intérprete local</span>}</p>
            <span className="text-[10px] uppercase tracking-display text-charcoal-300">{lines.filter((l) => !l.ok).length} a revisar</span>
          </div>
          {lines.length === 0 && <p className="text-sm text-charcoal-500">No se identificaron productos. Tome otra foto o use «Registrar a mano».</p>}
          <ul className="divide-y divide-charcoal-100">
            {lines.map((l, i) => {
              const p = products.find((x) => x.id === l.productId);
              return (
                <li key={i} className="py-2.5 grid grid-cols-[1fr,6rem] sm:grid-cols-[2fr,2fr,6rem,auto] gap-2 items-center text-sm">
                  <select value={l.productId} onChange={(e) => setProduct(i, e.target.value)} className={'field h-11 text-sm col-span-2 sm:col-span-1 ' + (!l.ok ? 'border-brass-300 bg-brass-50' : '')}>
                    {!l.productId && <option value="">— producto —</option>}
                    {products.filter((x) => x.active && !x.discontinued).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <select value={l.formatId} onChange={(e) => setFormat(i, e.target.value)} className="field h-11 text-sm">
                    {(p?.formats ?? []).map((f) => <option key={f.formatId} value={f.formatId}>{f.label}</option>)}
                  </select>
                  <div className="relative">
                    <input type="number" inputMode="decimal" step={l.unit === 'kg' ? '0.1' : '1'} value={l.qty || ''} onChange={(e) => update(i, { qty: parseFloat(e.target.value) || 0 })} className="field h-11 text-base text-right pr-8 font-semibold" aria-label="Cantidad" />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-charcoal-300">{l.unit === 'unidad' ? 'u' : l.unit}</span>
                  </div>
                  <button onClick={() => setLines((prev) => prev ? prev.filter((_, j) => j !== i) : prev)} className="text-xs text-charcoal-300 hover:text-red-700 justify-self-start sm:justify-self-auto">Quitar</button>
                  {l.raw && <p className="col-span-full text-[11px] text-charcoal-300 italic truncate">Leído: «{l.raw}»</p>}
                </li>
              );
            })}
          </ul>
          {lines.length > 0 && (
            <>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lote o turno (opcional)" className="field h-11 text-sm" />
              {error && <ErrorBanner message={error} />}
              <Button size="lg" onClick={confirm} disabled={busy || usable.length === 0} className="w-full"><Icon name="lock" size={18} /> {busy ? 'Cargando… (unos segundos)' : `Cargar ${usable.length} línea${usable.length === 1 ? '' : 's'} · ${totals(usable)}`}</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Registrar a mano ----------

interface Row { productId: string; formatId: string; qty: string }

function RegistrarProduccion({ user, products, initial, suggestions, onDone }: { user: { uid: string; name: string }; products: Product[]; initial: ProductionLine[]; suggestions: ProductionLine[]; onDone: (msg: string) => void }) {
  const active = useMemo(() => products.filter((p) => p.active && !p.discontinued).sort((a, b) => a.name.localeCompare(b.name, 'es')), [products]);
  const [rows, setRows] = useState<Row[]>(() => initial.length ? initial.map((l) => ({ productId: l.productId, formatId: l.formatId, qty: String(l.qty) })) : [{ productId: '', formatId: '', qty: '' }]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const qtyOf = (r: Row) => Number(r.qty.replace(',', '.'));
  const lines: ProductionLine[] = rows.flatMap((r) => {
    const p = active.find((x) => x.id === r.productId); const f = p?.formats.find((x) => x.formatId === r.formatId);
    return p && f && qtyOf(r) > 0 ? [{ productId: p.id, formatId: f.formatId, productName: p.name, formatLabel: f.label, unit: f.unit, qty: qtyOf(r) }] : [];
  });
  const pending = suggestions.filter((s) => !rows.some((r) => r.productId === s.productId && r.formatId === s.formatId));

  function addSuggestion(s: ProductionLine) {
    setRows((x) => [...x.filter((r) => r.productId), { productId: s.productId, formatId: s.formatId, qty: String(s.qty) }]);
  }

  async function submit() {
    setBusy(true); setError(null);
    try { onDone(loadResultText(await loadProduction(lines, user, 'manual', note.trim() || undefined))); } catch (e) { setError(describeFirestoreError(e)); setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {pending.length > 0 && (
        <div>
          <p className="eyebrow mb-1.5">Lo que esperan los pedidos · toque para agregar</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {pending.map((s) => (
              <button key={`${s.productId}::${s.formatId}`} onClick={() => addSuggestion(s)} className="shrink-0 rounded-full border border-brass-300 bg-brass-50 text-brass-800 px-3 py-1.5 text-xs whitespace-nowrap">
                + {s.productName} · {s.formatLabel} <span className="font-semibold">{formatQty(s.qty, s.unit)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {rows.map((r, i) => {
        const p = active.find((x) => x.id === r.productId);
        const f = p?.formats.find((x) => x.formatId === r.formatId);
        return (
          <div key={i} className="card p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              {p ? (
                <div className="min-w-0">
                  <p className="font-semibold text-charcoal-900">{p.name}</p>
                  <button className="text-xs underline text-charcoal-500" onClick={() => set(i, { productId: '', formatId: '' })}>Cambiar producto</button>
                </div>
              ) : (
                <ProductPicker products={active} onPick={(np) => set(i, { productId: np.id, formatId: np.formats[0]?.formatId ?? '' })} />
              )}
              {rows.length > 1 && <button className="text-charcoal-300 hover:text-red-700 text-2xl leading-none px-1" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Quitar línea">×</button>}
            </div>
            {p && (
              <>
                {p.formats.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {p.formats.map((x) => (
                      <button key={x.formatId} onClick={() => set(i, { formatId: x.formatId })} className={'rounded-md px-3 py-2 text-xs border ' + (x.formatId === r.formatId ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-700')}>{x.label}</button>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <input autoFocus={!r.qty} className="field h-12 text-xl font-semibold text-right pr-14" inputMode="decimal" placeholder="0" value={r.qty} onChange={(e) => set(i, { qty: e.target.value.replace(/[^\d.,]/g, '') })} aria-label="Cantidad producida" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-charcoal-500">{f?.unit === 'unidad' ? 'unid.' : f?.unit ?? ''}</span>
                </div>
              </>
            )}
          </div>
        );
      })}
      <Button variant="secondary" className="w-full" onClick={() => setRows((x) => [...x, { productId: '', formatId: '', qty: '' }])}><Icon name="plus" size={16} /> Agregar otro producto</Button>
      <input className="field h-11 text-sm" placeholder="Lote o turno (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <ErrorBanner message={error} />}
      <Button size="lg" className="w-full" onClick={submit} disabled={busy || lines.length === 0}><Icon name="lock" size={18} /> {busy ? 'Cargando… (unos segundos)' : lines.length ? `Cargar ${lines.length} línea${lines.length === 1 ? '' : 's'} · ${totals(lines)}` : 'Cargar producción'}</Button>
      <p className="text-[11px] text-charcoal-300 text-center">Se pide su PIN. El stock nuevo se asigna solo a los pedidos que esperaban.</p>
    </div>
  );
}

function ProductPicker({ products, onPick }: { products: Product[]; onPick: (p: Product) => void }) {
  const [q, setQ] = useState('');
  const t = norm(q.trim());
  const list = t.length >= 2 ? products.filter((p) => norm([p.name, ...(p.aliases ?? [])].join(' ')).includes(t)).slice(0, 8) : [];
  return (
    <div className="flex-1 min-w-0">
      <div className="relative">
        <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-300" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto (ej.: longaniza)" className="field h-11 pl-9 text-base" />
      </div>
      {list.length > 0 && (
        <ul className="mt-1 rounded-md border border-charcoal-100 bg-white divide-y divide-charcoal-100 overflow-hidden">
          {list.map((p) => <li key={p.id}><button onClick={() => onPick(p)} className="w-full text-left px-3 py-3 text-sm hover:bg-cream-50">{p.name}</button></li>)}
        </ul>
      )}
      {t.length >= 2 && list.length === 0 && <p className="text-xs text-charcoal-300 mt-1">Sin resultados.</p>}
    </div>
  );
}
