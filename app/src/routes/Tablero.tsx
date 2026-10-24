import { Icon } from '@/components/ui/Icon';
import { windowKey } from '@/domain/delivery';
import { isStrictStock } from '@/domain/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/data/firebase';
import { useCurrentUser } from '@/data/auth';
import { assignPacker } from '@/data/orders';
import { useClients } from '@/data/clients';
import { syncStockFromBsale, useAllStock, useSyncState } from '@/data/stock';
import { useSettings } from '@/data/settings';
import { useUsers } from '@/data/users';
import { CompactRow, OrderDrawer, OrderList, SummaryStrip, type BoardView } from '@/components/orders/BoardViews';
import { can, isReadOnly, isSeller } from '@/domain/permissions';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import SampleTag from '@/components/orders/SampleTag';
import SampleFollowups from '@/components/orders/SampleFollowups';
import { lineKey, sampleLabel } from '@/domain/samples';
import { ApprovalDialog, AnularDialog, DeliverDialog, DispatchDialog, TrasladoDialog, SalidaMuestrasDialog, VincularDocumentoDialog } from '@/components/orders/OrderDialogs';
import { COLUMNS, actionForDrop, cardTone, columnFor, nextAction, type ActionKind, type ColumnId, type Tone } from '@/domain/kanban';
import { DEFAULT_KANBAN_THRESHOLDS, ORDER_STATUS_LABEL, type Order, type OrderStatus, type Role } from '@/domain/types';
import { addDaysIso, formatDateShort, todayInSantiago } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';
import { describeFirestoreError } from '@/lib/errors';


type DateFilter = 'todos' | 'hoy' | 'manana' | 'atrasados';

const TONE_STRIPE: Record<Tone, string> = {
  red: 'border-l-red-600',
  amber: 'border-l-brass-500',
  neutral: 'border-l-charcoal-200',
  gray: 'border-l-charcoal-100 opacity-70',
};
const TONE_DOT: Record<Tone, string> = { red: 'bg-red-600', amber: 'bg-brass-500', neutral: 'bg-emerald-500', gray: 'bg-charcoal-200' };

export default function Tablero() {
  const { current } = useCurrentUser();
  const role = current!.appUser.role;
  const uid = current!.appUser.uid;
  const { sellers: VENDEDORES, nameOf: nameOfUser } = useUsers();
  const isAdmin = can(role, 'order.cancelAny') || isReadOnly(role);
  const canSync = can(role, 'stock.sync');
  // Auto-refresh only for roles that act on the board; producción syncs by hand.
  const autoSync = can(role, 'order.pack') || can(role, 'order.link');
  const navigate = useNavigate();
  const location = useLocation();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { stock } = useAllStock();
  const { clients } = useClients();
  const internalShopIds = useMemo(() => new Set(clients.filter((c) => c.isInternalShop).map((c) => c.id)), [clients]);
  const { settings } = useSettings();
  const strictStock = isStrictStock(settings);
  const thresholds = settings.kanban ?? DEFAULT_KANBAN_THRESHOLDS;
  const sync = useSyncState();

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'orders'), (snap) => {
      const list: Order[] = [];
      snap.forEach((d) => list.push(d.data() as Order));
      setOrders(list); setError(null); setLoading(false);
    }, (err) => { setError(describeFirestoreError(err)); setLoading(false); });
    return unsub;
  }, []);

  // Flash from the wizard (pedido creado) or from DetalleArmado (armado ok).
  const flash = location.state as null | { justCreated?: string; status?: OrderStatus; parcialLines?: Array<{ productName: string; formatLabel: string; missing: number }>; armadoOk?: string; awaitingApproval?: boolean };
  const dismissFlash = () => navigate(location.pathname + location.search, { replace: true, state: null });
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(dismissFlash, 10000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash]);

  // Filters live in the URL so "Ver" → back keeps them (dueños poke into
  // several cards in a row during the demo).
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const mine = params.has('mios') ? params.get('mios') === '1' : (role === 'vendedor' || role === 'tienda');
  const vendedor = params.get('vendedor') ?? '';
  const date = (params.get('fecha') as DateFilter | null) ?? 'todos';
  const showAnulados = params.get('anulados') === '1';
  const setParam = (key: string, value: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value == null || value === '') next.delete(key); else next.set(key, value);
      return next;
    }, { replace: true });
  };
  const setQ = (v: string) => setParam('q', v);
  const setMine = (v: boolean) => setParam('mios', v ? '1' : '0');
  const setVendedor = (v: string) => setParam('vendedor', v);
  const setDate = (v: DateFilter) => setParam('fecha', v === 'todos' ? null : v);
  const setShowAnulados = (v: boolean) => setParam('anulados', v ? '1' : null);

  const today = todayInSantiago();
  const tomorrow = addDaysIso(today, 1);
  const now = Date.now();
  const closedSince = now - thresholds.cerradoDias * 24 * 60 * 60 * 1000;

  const [filtersOpen, setFiltersOpen] = useState(false);
  const extraFilters = (showAnulados ? 1 : 0) + (vendedor ? 1 : 0) + (mine && !(role === 'vendedor' || role === 'tienda') ? 1 : 0);
  const pendingApproval = useMemo(() => orders.filter((o) => !o.archived && o.approval?.status === 'pendiente' && o.status !== 'anulado'), [orders]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return orders.filter((o) => {
      // WhatsApp history archived at go-live: lives in fichas and the panel.
      if (o.archived) return false;
      if (o.status === 'anulado') return showAnulados && (!mine || o.createdBy === uid);
      if (o.status === 'entregado' && o.updatedAt < closedSince) return false;
      if (mine) {
        const isMine = (role === 'vendedor' || role === 'tienda') ? o.createdBy === uid : role === 'despacho' ? o.assignedPackerId === uid : (o.createdBy === uid || o.assignedPackerId === uid);
        if (!isMine) return false;
      }
      if (vendedor && o.createdBy !== vendedor) return false;
      if (date === 'hoy' && o.requestedDate !== today) return false;
      if (date === 'manana' && o.requestedDate !== tomorrow) return false;
      if (date === 'atrasados' && !(o.requestedDate < today && !['despachado', 'entregado'].includes(o.status))) return false;
      if (needle) {
        const hay = `${o.id} ${o.clientSnapshot.name} ${o.clientSnapshot.fantasyName ?? ''} ${o.invoiceRef ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [orders, q, mine, vendedor, date, showAnulados, uid, role, today, tomorrow, closedSince]);

  const byColumn = useMemo(() => {
    const m = new Map<ColumnId, Order[]>(COLUMNS.map((c) => [c.id, []]));
    const anulados: Order[] = [];
    for (const o of visible) {
      if (o.status === 'anulado') { anulados.push(o); continue; }
      const col = columnFor(o.status);
      if (col) m.get(col)!.push(o);
    }
    for (const list of m.values()) {
      list.sort((a, b) => {
        const ta = cardTone(a, stock, thresholds, now, today).tone;
        const tb = cardTone(b, stock, thresholds, now, today).tone;
        const rank = (t: Tone) => (t === 'red' ? 0 : t === 'amber' ? 1 : t === 'neutral' ? 2 : 3);
        if (rank(ta) !== rank(tb)) return rank(ta) - rank(tb);
        if (a.requestedDate !== b.requestedDate) return a.requestedDate.localeCompare(b.requestedDate);
        // Same day: whoever receives earliest goes first (armado and reparto).
        const wa = windowKey(a.deliveryWindow); const wb = windowKey(b.deliveryWindow);
        if (wa !== wb) return wa.localeCompare(wb);
        return a.createdAt - b.createdAt;
      });
    }
    return { columns: m, anulados };
  }, [visible, stock, thresholds, now, today]);

  // Dialogs
  const [dialog, setDialog] = useState<{ kind: ActionKind; order: Order; defer?: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(kind: ActionKind, order: Order) {
    setActionError(null);
    try {
      switch (kind) {
        case 'take': await assignPacker(order.id, uid); break;
        case 'arm': navigate(`/despacho/cola/${order.id}`); break;
        case 'link':
        case 'transfer':
        case 'samples':
        case 'approve':
        case 'dispatch':
        case 'deliver':
        case 'anular':
          setDialog({ kind, order }); break;
        default: break;
      }
    } catch (e) { setActionError(describeFirestoreError(e)); }
  }

  // Sync (roles other than vendedor). Auto-sync on mount when stale > 5 min.
  const [syncing, setSyncing] = useState(false);
  const autoSynced = useRef(false);
  async function doSync() {
    if (syncing) return;
    setSyncing(true); setActionError(null);
    try { await syncStockFromBsale(uid); } catch (e) { setActionError(describeFirestoreError(e)); } finally { setSyncing(false); }
  }
  useEffect(() => {
    if (!autoSync || autoSynced.current || sync === undefined) return;
    if (sync === null || (sync && Date.now() - sync.at > 5 * 60 * 1000)) { autoSynced.current = true; void doSync(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, autoSync]);

  // Drag & drop (desktop only)
  const dragEnabled = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<ColumnId | null>(null);
  const dragOrder = dragId ? orders.find((o) => o.id === dragId) ?? null : null;

  // Mobile column tabs
  const scroller = useRef<HTMLDivElement | null>(null);
  // Vista y etapa en la URL (volver atrás conserva el contexto); la vista
  // preferida se recuerda por dispositivo.
  const VIEW_KEY = 'comandas.tablero.vista';
  const storedView = (() => { try { return localStorage.getItem(VIEW_KEY) as BoardView | null; } catch { return null; } })();
  const view: BoardView = (params.get('vista') as BoardView | null) ?? storedView ?? 'tarjetas';
  const setView = (v: BoardView) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* sin storage */ } setParam('vista', v); };
  const etapa = (params.get('etapa') as ColumnId | null) ?? null;
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const drawerOrder = drawerId ? orders.find((o) => o.id === drawerId) ?? null : null;
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  const openOrder = (o: Order) => { if (wide) setDrawerId(o.id); else navigate(detailPath(o, role, uid)); };
  const toneOf = (o: Order) => cardTone(o, stock, thresholds, now, today);
  const actionOf = (o: Order) => nextAction(o, role, uid, { isShop: internalShopIds.has(o.clientId), strictStock });
  const [activeCol, setActiveCol] = useState<ColumnId>(can(role, 'order.link') ? 'por_facturar' : role === 'reparto' ? 'por_despachar' : 'pendiente');
  function scrollToCol(id: ColumnId) {
    setActiveCol(id);
    const el = scroller.current?.querySelector<HTMLElement>(`[data-col="${id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }

  const totalOpen = COLUMNS.slice(0, 4).reduce((s, c) => s + (byColumn.columns.get(c.id)?.length ?? 0), 0);
  const redCount = visible.filter((o) => cardTone(o, stock, thresholds, now, today).tone === 'red').length;

  return (
    <div className="-mx-4 sm:-mx-6">
      <header className="px-4 sm:px-6 mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">{mine && isSeller(role) ? 'Mis pedidos' : 'Pedidos'}</h1>
          <p className="text-xs text-charcoal-300 mt-1">
            {totalOpen} abierto{totalOpen === 1 ? '' : 's'}{redCount > 0 && <span className="text-red-700 font-semibold"> · {redCount} en rojo</span>}
            {sync?.at && <> · stock Bsale {new Date(sync.at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</>}
            {sync?.compromised?.length ? <span className="text-red-700"> · {sync.compromised.length} formato{sync.compromised.length === 1 ? '' : 's'} con stock comprometido</span> : null}
          </p>
        </div>
        {canSync && (
          <button onClick={doSync} disabled={syncing} title="Sincronizar stock y documentos con Bsale" className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-charcoal-200 bg-white px-2.5 py-1.5 text-[11px] uppercase tracking-display text-charcoal-600 hover:border-charcoal-300 disabled:opacity-60">
            <Icon name="sync" size={14} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Sincronizando' : 'Bsale'}
          </button>
        )}
      </header>

      {isSeller(role) && <div className="px-4 sm:px-6"><SampleFollowups uid={uid} /></div>}
      {can(role, 'order.approve') && pendingApproval.length > 0 && (
        <section className="mx-4 sm:mx-6 card p-4 mb-3 border-brass-300 bg-brass-50/40">
          <p className="eyebrow mb-2">Pedidos por aprobar · {pendingApproval.length}</p>
          <ul className="divide-y divide-charcoal-100">
            {pendingApproval.map((o) => (
              <li key={o.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-charcoal-900 truncate"><span className="font-mono text-[11px] text-charcoal-400">{o.id}</span> {o.clientSnapshot.fantasyName ?? o.clientSnapshot.name} · {nameOfUser(o.createdBy)}</p>
                  <p className="text-[11px] text-brass-700 truncate">{o.approval?.reasons.join(' · ')}</p>
                </div>
                <Button size="sm" onClick={() => setDialog({ kind: 'approve', order: o })}>Revisar</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {flash?.justCreated && (
        <div className="mx-4 sm:mx-6 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm mb-3 relative pr-9">
          <button onClick={dismissFlash} className="absolute right-2 top-2 text-emerald-800/60 hover:text-emerald-900" aria-label="Cerrar">×</button>
          Pedido <span className="font-mono">{flash.justCreated}</span> creado — {flash.awaitingApproval ? <strong>esperando la aprobación de Ciro (no lo confirme al cliente todavía)</strong> : <>estado <strong>{flash.status ? ORDER_STATUS_LABEL[flash.status] : ''}</strong></>}.
          {flash.parcialLines && flash.parcialLines.length > 0 && (
            <ul className="mt-1 text-xs list-disc pl-4">{flash.parcialLines.map((p, i) => <li key={i}>{p.productName} · {p.formatLabel}: {p.missing} esperando stock</li>)}</ul>
          )}
        </div>
      )}
      {flash?.armadoOk && (
        <div className="mx-4 sm:mx-6 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm mb-3 relative pr-9">
          <button onClick={dismissFlash} className="absolute right-2 top-2 text-emerald-800/60 hover:text-emerald-900" aria-label="Cerrar">×</button>
          Pedido <span className="font-mono">{flash.armadoOk}</span> marcado como <strong>armado</strong>.
        </div>
      )}
      {actionError && <div className="mx-4 sm:mx-6 mb-3"><ErrorBanner message={actionError} /></div>}
      {error && <div className="mx-4 sm:mx-6 mb-3"><ErrorBanner message={error} /></div>}

      {/* Visión general */}
      <div className="px-4 sm:px-6 mb-3">
        <SummaryStrip byColumn={byColumn.columns} toneOf={toneOf} showMoney={isAdmin || isSeller(role)} active={etapa}
          onPick={(c) => {
            // Phone + board: the strip doubles as column tabs (scroll, no filter).
            if (window.innerWidth < 1024 && view !== 'lista') { if (c) scrollToCol(c); return; }
            setParam('etapa', c); if (c && view === 'tarjetas') scrollToCol(c);
          }} />
      </div>

      {/* Filtros: búsqueda + fecha a la vista; el resto en «Filtros». */}
      <div className="px-4 sm:px-6 mb-3 space-y-2">
        <div className="flex items-center gap-2">
          <label className="relative flex-1 min-w-0 sm:max-w-sm">
            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-300" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pedido, cliente, documento…" className="field h-10 text-sm pl-9 w-full" />
          </label>
          <div className="hidden sm:flex rounded-md border border-charcoal-200 overflow-hidden" role="group" aria-label="Vista">
            {(['tarjetas', 'compacta', 'lista'] as BoardView[]).map((v) => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={'px-2.5 h-10 text-[11px] uppercase tracking-display ' + (view === v ? 'bg-charcoal-900 text-cream-50' : 'bg-white text-charcoal-500 hover:text-charcoal-900')}>{v}</button>
            ))}
          </div>
          <div className="relative">
            <button onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen} className={'h-10 inline-flex items-center gap-1.5 rounded-md border px-3 text-[11px] uppercase tracking-display ' + (extraFilters ? 'border-charcoal-900 bg-charcoal-900 text-cream-50' : 'border-charcoal-200 bg-white text-charcoal-600')}>
              <Icon name="filter" size={14} /> Filtros{extraFilters ? ` · ${extraFilters}` : ''}
            </button>
            {filtersOpen && (
              <div className="absolute right-0 top-full mt-2 z-20 w-72 card p-4 space-y-3 shadow-lift">
                <label className="flex items-center justify-between text-sm text-charcoal-800">Solo mis pedidos <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="w-4 h-4" /></label>
                <label className="flex items-center justify-between text-sm text-charcoal-800">Mostrar anulados <input type="checkbox" checked={showAnulados} onChange={(e) => setShowAnulados(e.target.checked)} className="w-4 h-4" /></label>
                {isAdmin && (
                  <label className="block text-xs text-charcoal-500">Vendedor
                    <select value={vendedor} onChange={(e) => setVendedor(e.target.value)} className="field mt-1 h-10 text-sm">
                      <option value="">Todos los vendedores</option>
                      {VENDEDORES.map((v) => <option key={v.uid} value={v.uid}>{v.displayName}</option>)}
                    </select>
                  </label>
                )}
                <div className="sm:hidden">
                  <p className="text-xs text-charcoal-500 mb-1">Vista</p>
                  <div className="flex rounded-md border border-charcoal-200 overflow-hidden" role="group" aria-label="Vista">
                    {(['tarjetas', 'compacta', 'lista'] as BoardView[]).map((v) => (
                      <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={'flex-1 py-2 text-[11px] uppercase tracking-display ' + (view === v ? 'bg-charcoal-900 text-cream-50' : 'bg-white text-charcoal-500')}>{v}</button>
                    ))}
                  </div>
                </div>
                <Button size="sm" variant="secondary" className="w-full" onClick={() => setFiltersOpen(false)}>Listo</Button>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          <Chip active={date === 'todos'} onClick={() => setDate('todos')}>Todos</Chip>
          <Chip active={date === 'hoy'} onClick={() => setDate('hoy')}>Hoy</Chip>
          <Chip active={date === 'manana'} onClick={() => setDate('manana')}>Mañana</Chip>
          <Chip active={date === 'atrasados'} onClick={() => setDate('atrasados')} tone="red">Atrasados</Chip>
        </div>
      </div>

      {loading && <p className="px-4 sm:px-6 text-sm text-charcoal-300">Cargando…</p>}

      {view === 'lista' && (
        <div className="px-4 sm:px-6 pb-4">
          <OrderList
            orders={visible.filter((o) => o.status !== 'anulado' && (etapa ? columnFor(o.status) === etapa : columnFor(o.status) !== 'cerrado'))}
            toneOf={toneOf} actionOf={actionOf} onAction={(k, o) => run(k, o)} onOpen={openOrder} showMoney={isAdmin}
          />
          {!etapa && <p className="text-[11px] text-charcoal-300 mt-1.5">Pedidos abiertos. Toque "Cerrado" en el resumen para ver los cerrados.</p>}
        </div>
      )}

      {/* Board */}
      {view !== 'lista' && <div
        ref={scroller}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory px-4 sm:px-6 pb-4 lg:grid lg:grid-cols-5 lg:overflow-visible lg:snap-none"
        onScroll={(e) => {
          if (window.innerWidth >= 1024) return;
          const el = e.currentTarget;
          const idx = Math.round(el.scrollLeft / (el.clientWidth * 0.86));
          const col = COLUMNS[Math.min(COLUMNS.length - 1, Math.max(0, idx))];
          if (col && col.id !== activeCol) setActiveCol(col.id);
        }}
      >
        {COLUMNS.map((c) => {
          const list = byColumn.columns.get(c.id) ?? [];
          const isCerrado = c.id === 'cerrado';
          const dropOk = dragOrder ? actionForDrop(dragOrder, c.id, role, uid, { isShop: internalShopIds.has(dragOrder.clientId), strictStock }) : null;
          const sumCLP = list.reduce((s, o) => s + (o.totalCLP ?? 0), 0);
          return (
            <section
              key={c.id}
              data-col={c.id}
              className={'snap-start shrink-0 w-[86vw] sm:w-[60vw] lg:w-auto rounded-lg border bg-cream-100/50 flex flex-col min-h-[40vh] lg:min-h-[60vh] transition ' + (etapa && etapa !== c.id ? 'lg:opacity-50 ' : '') + (overCol === c.id && dropOk ? 'border-brass-500 bg-brass-50' : overCol === c.id && dragOrder ? 'border-red-300' : 'border-charcoal-100')}
              onDragOver={(e) => { if (!dragOrder) return; e.preventDefault(); if (overCol !== c.id) setOverCol(c.id); }}
              onDragLeave={() => { if (overCol === c.id) setOverCol(null); }}
              onDrop={(e) => {
                e.preventDefault();
                const o = dragOrder; setDragId(null); setOverCol(null);
                if (!o) return;
                const kind = actionForDrop(o, c.id, role, uid, { isShop: internalShopIds.has(o.clientId), strictStock });
                if (kind) void run(kind, o);
              }}
            >
              <header className="px-3 pt-3 pb-2 flex items-baseline justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-display font-semibold text-charcoal-700">{c.label} <span className="text-charcoal-300 font-normal">{list.length}</span></p>
                  <p className={'text-[10px] ' + (overCol === c.id && dragOrder && !dropOk ? 'text-red-700' : 'text-charcoal-300')}>
                    {overCol === c.id && dragOrder && !dropOk ? `No se puede mover acá desde «${COLUMNS.find((x) => x.id === columnFor(dragOrder.status))?.label ?? ''}»` : (isAdmin && sumCLP > 0 ? formatCLP(sumCLP) : c.hint)}
                  </p>
                </div>
              </header>
              <div className="px-2 pb-2 space-y-2 flex-1">
                {list.length === 0 && <p className="text-[11px] text-charcoal-300 px-1 py-3">—</p>}
                {view === 'compacta' && (isCerrado ? list.slice(0, 60) : list).map((o) => (
                  <CompactRow key={o.id} order={o} tone={toneOf(o)} action={actionOf(o)} onAction={(kind) => run(kind, o)} onOpen={() => openOrder(o)} />
                ))}
                {view === 'tarjetas' && (isCerrado ? list.slice(0, 30) : list).map((o) => (
                  <KanbanCard
                    onOpen={() => openOrder(o)}
                    key={o.id}
                    order={o}
                    tone={cardTone(o, stock, thresholds, now, today)}
                    action={nextAction(o, role, uid, { isShop: internalShopIds.has(o.clientId), strictStock })}
                    onAction={(kind) => run(kind, o)}
                    detailTo={detailPath(o, role, uid)}
                    draggable={dragEnabled && !isCerrado && nextAction(o, role, uid, { isShop: internalShopIds.has(o.clientId), strictStock }).kind !== 'none' && nextAction(o, role, uid, { isShop: internalShopIds.has(o.clientId), strictStock }).kind !== 'anular'}
                    onDragStart={() => setDragId(o.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    compact={isCerrado}
                    isShop={internalShopIds.has(o.clientId)}
                  />
                ))}
                {isCerrado && list.length > 30 && <p className="text-[11px] text-charcoal-300 px-1">+ {list.length - 30} más</p>}
              </div>
            </section>
          );
        })}
      </div>}

      {showAnulados && byColumn.anulados.length > 0 && (
        <section className="px-4 sm:px-6 mt-2">
          <p className="eyebrow mb-2">Anulados ({byColumn.anulados.length})</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {byColumn.anulados.map((o) => (
              <KanbanCard key={o.id} order={o} tone={{ tone: 'gray', reasons: ['Anulado'] }} action={{ kind: 'none', label: '' }} onAction={() => {}} detailTo={detailPath(o, role, uid)} compact />
            ))}
          </div>
        </section>
      )}

      {drawerOrder && (
        <>
          <div className="fixed inset-0 z-20 bg-charcoal-900/20" onClick={() => setDrawerId(null)} />
          <OrderDrawer order={drawerOrder} tone={toneOf(drawerOrder)} action={actionOf(drawerOrder)} showMoney={isAdmin}
            onAction={(k) => { setDrawerId(null); void run(k, drawerOrder); }} onClose={() => setDrawerId(null)} detailTo={detailPath(drawerOrder, role, uid)} />
        </>
      )}

      {dialog?.kind === 'transfer' && <TrasladoDialog order={dialog.order} uid={uid} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'approve' && <ApprovalDialog order={dialog.order} uid={uid} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'samples' && <SalidaMuestrasDialog order={dialog.order} uid={uid} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'link' && <VincularDocumentoDialog order={dialog.order} uid={uid} onClose={() => setDialog(null)} onDeferDispatch={can(role, 'order.invoiceLate') ? () => setDialog({ kind: 'dispatch', order: dialog.order, defer: true }) : undefined} />}
      {dialog?.kind === 'dispatch' && <DispatchDialog order={dialog.order} uid={uid} defer={dialog.defer} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'deliver' && <DeliverDialog order={dialog.order} uid={uid} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'anular' && <AnularDialog order={dialog.order} uid={uid} onClose={() => setDialog(null)} />}
    </div>
  );
}

function detailPath(o: Order, role: Role, uid: string): string {
  if (role === 'despacho') return `/despacho/cola/${o.id}`;
  if (!can(role, 'order.pack')) return `/vendedor/mis/${o.id}`;
  // admin: armado detail is the richest view while the order is being packed.
  if (['confirmado', 'confirmado_parcial', 'en_armado', 'armado'].includes(o.status) && o.assignedPackerId === uid) return `/despacho/cola/${o.id}`;
  return `/vendedor/mis/${o.id}`;
}

function Chip({ active, onClick, children, tone }: { active: boolean; onClick: () => void; children: React.ReactNode; tone?: 'red' }) {
  return (
    <button onClick={onClick} className={'rounded-md px-2.5 py-1.5 text-[11px] uppercase tracking-display font-medium border transition ' + (active ? (tone === 'red' ? 'bg-red-700 border-red-700 text-white' : 'bg-charcoal-900 border-charcoal-900 text-cream-50') : 'bg-white border-charcoal-200 text-charcoal-500 hover:border-charcoal-300')}>
      {children}
    </button>
  );
}

function KanbanCard({ order, tone, action, onAction, onOpen, detailTo, draggable, onDragStart, onDragEnd, compact, isShop }: {
  onOpen?: () => void;
  order: Order;
  tone: { tone: Tone; reasons: string[] };
  action: { kind: ActionKind; label: string };
  onAction: (kind: ActionKind) => void;
  detailTo: string;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  compact?: boolean;
  isShop?: boolean;
}) {
  const { nameOf } = useUsers();
  const anyPending = order.lines.some((l) => l.pendingProductionQty > 0);
  const packer = order.assignedPackerId ? nameOf(order.assignedPackerId) : null;
  const vendedor = nameOf(order.createdBy);
  const late = tone.tone === 'red' && tone.reasons.includes('Atrasado');
  return (
    <article
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onDragEnd={onDragEnd}
      className={'card border-l-4 p-2.5 text-xs ' + TONE_STRIPE[tone.tone] + (draggable ? ' cursor-grab active:cursor-grabbing' : '')}
      title={tone.reasons.join(' · ') || undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <Link to={detailTo} className="font-mono text-[11px] text-charcoal-500 hover:text-charcoal-900 tracking-display">{order.id.replace(/^PED-\d{4}-/, '#')}</Link>
        <span className="flex items-center gap-1.5">
          {order.invoiceRef && <span className="font-mono text-[10px] text-charcoal-300">{order.invoiceRef}</span>}
          <span className={'w-2 h-2 rounded-full ' + TONE_DOT[tone.tone]} />
        </span>
      </div>
      <Link to={detailTo} onClick={(e) => { if (onOpen) { e.preventDefault(); onOpen(); } }} className="block font-semibold text-charcoal-900 text-sm leading-tight mt-0.5 truncate">{order.clientSnapshot.fantasyName ?? order.clientSnapshot.name}</Link>
      <div className="flex items-center justify-between gap-2 mt-1 text-[11px] text-charcoal-500">
        <span className={'first-letter:uppercase ' + (late ? 'text-red-700 font-semibold' : '')}>{formatDateShort(order.requestedDate)}{order.deliveryWindow ? ` ${order.deliveryWindow.from}–${order.deliveryWindow.to}` : ''} · {order.deliveryMode === 'retiro' ? 'retiro' : 'despacho'}</span>
        <span className="font-semibold text-charcoal-700">{order.totalCLP ? formatCLP(order.totalCLP) : `${order.lines.length} lín.`}</span>
      </div>
      {!compact && (
        <ul className="mt-1.5 text-[11px] text-charcoal-500 space-y-0.5">
          {order.lines.slice(0, 2).map((l) => (
            <li key={lineKey(l)} className="truncate">{l.sample ? <><SampleTag />{l.productName} <span className="text-charcoal-300">{sampleLabel(l)}</span></> : <>{l.qty} × {l.productName} <span className="text-charcoal-300">{l.formatLabel}</span></>}</li>
          ))}
          {order.lines.length > 2 && <li className="text-charcoal-300">+ {order.lines.length - 2} más</li>}
        </ul>
      )}
      {(tone.reasons.length > 0 || anyPending || packer || isShop || order.source === 'whatsapp') && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {order.source === 'whatsapp' && <span className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-display bg-emerald-50 text-emerald-800 border border-emerald-200" title="Importado del grupo de WhatsApp">WhatsApp</span>}
          {isShop && <span className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-display bg-charcoal-900 text-cream-50 border border-charcoal-900">Tienda</span>}
          {tone.reasons.map((r) => (
            <span key={r} className={'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-display border ' + (tone.tone === 'red' ? 'bg-red-50 text-red-700 border-red-200' : tone.tone === 'amber' ? 'bg-brass-50 text-brass-700 border-brass-300' : 'bg-charcoal-50 text-charcoal-500 border-charcoal-100')}>{r}</span>
          ))}
          {anyPending && <span className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-display bg-brass-50 text-brass-700 border border-brass-300">Espera stock</span>}
          {packer && <span className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-display bg-blue-50 text-blue-800 border border-blue-200">{packer}</span>}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-display text-charcoal-300 truncate">{vendedor}</span>
        <span className="flex items-center gap-2">
          {action.kind === 'anular' && (
            <button onClick={() => onAction('anular')} className="text-[10px] uppercase tracking-display text-charcoal-300 hover:text-red-700">Anular</button>
          )}
          {action.kind !== 'none' && action.kind !== 'anular' ? (
            <Button size="sm" className="!py-1 !px-2.5 text-[11px]" onClick={() => onAction(action.kind)}>{action.label}</Button>
          ) : (
            <Link to={detailTo} onClick={(e) => { if (onOpen) { e.preventDefault(); onOpen(); } }} className="rounded-md border border-charcoal-200 px-2.5 py-1 text-[11px] uppercase tracking-display text-charcoal-700 hover:border-brass-500">Ver</Link>
          )}
        </span>
      </div>
    </article>
  );
}
