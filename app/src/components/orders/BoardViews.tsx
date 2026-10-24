import SampleTag from './SampleTag';
import { sampleLabel } from '@/domain/samples';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@/components/ui/Button';
import { useUsers } from '@/data/users';
import { COLUMNS, columnFor, type ActionKind, type ColumnId, type Tone } from '@/domain/kanban';
import { ORDER_STATUS_LABEL, type Order } from '@/domain/types';
import { formatDateShort, formatQty } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';

// Tablero en tres niveles: franja de resumen (visión general), vistas
// Tarjetas / Compacta / Lista, y panel lateral de detalle (zoom sin salir).

export type BoardView = 'tarjetas' | 'compacta' | 'lista';
export interface ToneInfo { tone: Tone; reasons: string[] }
export interface NextActionInfo { kind: ActionKind; label: string }

export const orderKg = (o: Order) => o.lines.reduce((s, l) => s + (l.unit === 'kg' ? (l.packedQty ?? l.qty) : (l.packedWeightKg ?? 0)), 0);
const TONE_DOT: Record<Tone, string> = { red: 'bg-red-600', amber: 'bg-brass-500', neutral: 'bg-emerald-500', gray: 'bg-charcoal-200' };

// ---------- Resumen ----------

export function SummaryStrip({ byColumn, toneOf, showMoney, active, onPick }: {
  byColumn: Map<ColumnId, Order[]>; toneOf: (o: Order) => ToneInfo; showMoney: boolean; active: ColumnId | null; onPick: (c: ColumnId | null) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 sm:grid sm:grid-cols-5 sm:overflow-visible sm:mx-0 sm:px-0 sm:pb-0">
      {COLUMNS.map((c) => {
        const list = byColumn.get(c.id) ?? [];
        const red = list.filter((o) => toneOf(o).tone === 'red').length;
        const amber = list.filter((o) => toneOf(o).tone === 'amber').length;
        const kg = list.reduce((s, o) => s + orderKg(o), 0);
        const clp = list.reduce((s, o) => s + (o.totalCLP ?? 0), 0);
        const on = active === c.id;
        return (
          <button key={c.id} onClick={() => onPick(on ? null : c.id)} aria-pressed={on}
            className={'shrink-0 min-w-[7.25rem] sm:min-w-0 text-left rounded-lg border px-3 py-2 transition ' + (on ? 'border-charcoal-900 bg-white shadow-soft' : 'border-charcoal-100 bg-white/60 hover:border-charcoal-300')}>
            <p className="text-[10px] uppercase tracking-display text-charcoal-300 font-semibold">{c.label}</p>
            <p className="text-xl font-semibold text-charcoal-900 tabular-nums leading-tight">{list.length}</p>
            <p className="text-[11px] text-charcoal-500 tabular-nums truncate">
              {showMoney && clp > 0 ? formatCLP(clp) : '—'}{kg > 0 ? ` · ${Math.round(kg)} kg` : ''}
            </p>
            <p className="text-[10px] mt-0.5 h-3.5">
              {red > 0 && <span className="text-red-700 font-semibold mr-2">● {red}</span>}
              {amber > 0 && <span className="text-brass-700">● {amber}</span>}
            </p>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Compacta ----------

export function CompactRow({ order, tone, action, onAction, onOpen }: { order: Order; tone: ToneInfo; action: NextActionInfo; onAction: (k: ActionKind) => void; onOpen: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-white border border-charcoal-100 px-2 py-1.5 text-xs" title={tone.reasons.join(' · ') || undefined}>
      <span className={'w-2 h-2 rounded-full shrink-0 ' + TONE_DOT[tone.tone]} />
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="font-semibold text-charcoal-900 truncate block">{order.clientSnapshot.fantasyName ?? order.clientSnapshot.name}</span>
        <span className="text-[10px] text-charcoal-300">{order.id.replace(/^PED-\d{4}-/, '#')} · <span className="first-letter:uppercase">{formatDateShort(order.requestedDate)}{order.deliveryWindow ? ` ${order.deliveryWindow.from}–${order.deliveryWindow.to}` : ''}</span>{order.totalCLP ? ` · ${formatCLP(order.totalCLP)}` : ''}</span>
      </button>
      {action.kind !== 'none' && action.kind !== 'anular' && (
        <button onClick={() => onAction(action.kind)} className="shrink-0 rounded bg-charcoal-700 text-cream-50 px-2 py-1 text-[10px] uppercase tracking-display hover:bg-charcoal-900">{action.label}</button>
      )}
    </div>
  );
}

// ---------- Lista ----------

type SortKey = 'fecha' | 'cliente' | 'total' | 'etapa' | 'kg';

export function OrderList({ orders, toneOf, actionOf, onAction, onOpen, showMoney }: {
  orders: Order[]; toneOf: (o: Order) => ToneInfo; actionOf: (o: Order) => NextActionInfo; onAction: (k: ActionKind, o: Order) => void; onOpen: (o: Order) => void; showMoney: boolean;
}) {
  const { nameOf } = useUsers();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'fecha', dir: 1 });
  const colIdx = (o: Order) => COLUMNS.findIndex((c) => c.id === columnFor(o.status));
  const rows = useMemo(() => [...orders].sort((a, b) => {
    const tr = (o: Order) => ({ red: 0, amber: 1, neutral: 2, gray: 3 }[toneOf(o).tone]);
    let d = 0;
    if (sort.key === 'fecha') d = a.requestedDate.localeCompare(b.requestedDate) || tr(a) - tr(b);
    if (sort.key === 'cliente') d = (a.clientSnapshot.fantasyName ?? a.clientSnapshot.name).localeCompare(b.clientSnapshot.fantasyName ?? b.clientSnapshot.name, 'es');
    if (sort.key === 'total') d = (a.totalCLP ?? 0) - (b.totalCLP ?? 0);
    if (sort.key === 'kg') d = orderKg(a) - orderKg(b);
    if (sort.key === 'etapa') d = colIdx(a) - colIdx(b) || tr(a) - tr(b);
    return d * sort.dir;
  }), [orders, sort, toneOf]);
  const head = (key: SortKey, label: string, right = false) => (
    <th className={'px-2 py-2 font-semibold whitespace-nowrap ' + (right ? 'text-right' : '')}>
      <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))} className="uppercase tracking-display hover:text-charcoal-900">
        {label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[10px] text-charcoal-300 border-b border-charcoal-100 bg-cream-100/40">
          <th className="w-3" />{head('etapa', 'Etapa')}{head('cliente', 'Cliente')}<th className="px-2 py-2 uppercase tracking-display font-semibold hidden md:table-cell">Vendedor</th>{head('fecha', 'Fecha')}{head('kg', 'Kg', true)}{showMoney && head('total', 'Total', true)}<th className="px-2 py-2 uppercase tracking-display font-semibold hidden lg:table-cell">Alertas</th><th />
        </tr></thead>
        <tbody className="divide-y divide-charcoal-100/70">
          {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-charcoal-300">Sin pedidos en este filtro.</td></tr>}
          {rows.map((o) => {
            const t = toneOf(o); const a = actionOf(o); const kg = orderKg(o);
            return (
              <tr key={o.id} className="hover:bg-cream-100/50">
                <td className="pl-2"><span className={'block w-2 h-2 rounded-full ' + TONE_DOT[t.tone]} /></td>
                <td className="px-2 py-1.5 text-xs text-charcoal-500 whitespace-nowrap">{ORDER_STATUS_LABEL[o.status]}</td>
                <td className="px-2 py-1.5"><button onClick={() => onOpen(o)} className="text-left"><span className="font-semibold text-charcoal-900">{o.clientSnapshot.fantasyName ?? o.clientSnapshot.name}</span><span className="block text-[10px] text-charcoal-300 font-mono">{o.id}{o.invoiceRef ? ` · ${o.invoiceRef}` : ''}</span></button></td>
                <td className="px-2 py-1.5 text-xs text-charcoal-500 hidden md:table-cell">{nameOf(o.createdBy)}</td>
                <td className="px-2 py-1.5 text-xs whitespace-nowrap first-letter:uppercase">{formatDateShort(o.requestedDate)}</td>
                <td className="px-2 py-1.5 text-xs text-right tabular-nums">{kg ? formatQty(kg, 'kg') : '—'}</td>
                {showMoney && <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{o.totalCLP ? formatCLP(o.totalCLP) : '—'}</td>}
                <td className="px-2 py-1.5 text-[10px] text-charcoal-500 hidden lg:table-cell">{t.reasons.join(' · ')}{o.lines.some((l) => l.pendingProductionQty > 0) ? `${t.reasons.length ? ' · ' : ''}espera stock` : ''}</td>
                <td className="px-2 py-1.5 text-right">{a.kind !== 'none' && a.kind !== 'anular' && <button onClick={() => onAction(a.kind, o)} className="rounded bg-charcoal-700 text-cream-50 px-2 py-1 text-[10px] uppercase tracking-display hover:bg-charcoal-900">{a.label}</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Detalle lateral ----------

export function OrderDrawer({ order, tone, action, onAction, onClose, detailTo, showMoney }: {
  order: Order; tone: ToneInfo; action: NextActionInfo; onAction: (k: ActionKind) => void; onClose: () => void; detailTo: string; showMoney: boolean;
}) {
  const { nameOf } = useUsers();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const kg = orderKg(order);
  return (
    <aside className="fixed right-0 top-0 bottom-0 z-30 w-full max-w-md bg-cream-50 border-l border-charcoal-100 shadow-lift flex flex-col" aria-label={`Detalle de ${order.id}`}>
      <header className="px-5 py-4 border-b border-charcoal-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{order.id} · {ORDER_STATUS_LABEL[order.status]}</p>
          <h2 className="text-lg font-semibold text-charcoal-900 leading-tight truncate">{order.clientSnapshot.fantasyName ?? order.clientSnapshot.name}</h2>
          <p className="text-xs text-charcoal-500 first-letter:uppercase">{formatDateShort(order.requestedDate)} · {order.deliveryMode === 'retiro' ? 'retiro' : 'despacho'} · {nameOf(order.createdBy)}</p>
        </div>
        <button onClick={onClose} className="text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 shrink-0" aria-label="Cerrar">×</button>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm">
        {tone.reasons.length > 0 && <div className={'rounded-md border px-3 py-2 text-xs ' + (tone.tone === 'red' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-brass-50 border-brass-300 text-brass-700')}>{tone.reasons.join(' · ')}</div>}
        <section>
          <p className="eyebrow mb-1.5">Líneas</p>
          <ul className="card divide-y divide-charcoal-100">
            {order.lines.map((l, i) => (
              <li key={i} className="px-3 py-2">
                <div className="flex justify-between gap-3">
                  <span className="text-charcoal-900">{l.sample && <SampleTag />}{l.productName} <span className="text-charcoal-300 text-xs">{l.formatLabel}</span></span>
                  <span className="tabular-nums shrink-0">{l.sample ? sampleLabel(l) : formatQty(l.qty, l.unit)}</span>
                </div>
                <p className="text-[11px] text-charcoal-500">
                  {l.packedQty != null ? `Empacado ${formatQty(l.packedQty, l.unit)}${l.packedWeightKg ? ` · ${l.packedWeightKg} kg` : ''}` : l.pendingProductionQty > 0 ? `Reservado ${formatQty(l.reservedQty, l.unit)} · a producción ${formatQty(l.pendingProductionQty, l.unit)}` : `Reservado ${formatQty(l.reservedQty, l.unit)}`}
                  {l.shortReason ? ` · faltó: ${l.shortReason}` : ''}{l.notes ? ` · ${l.notes}` : ''}
                  {showMoney && l.subtotalCLP ? <span className="float-right">{formatCLP(l.subtotalCLP)}</span> : null}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-charcoal-500 mt-1.5 flex justify-between"><span>{kg ? `${formatQty(kg, 'kg')} en total` : ''}</span>{showMoney && order.totalCLP ? <strong className="text-charcoal-900">{formatCLP(order.totalCLP)}</strong> : null}</p>
        </section>
        {(order.deliveryAddress || order.receivingHours) && (
          <section className="text-xs text-charcoal-700"><p className="eyebrow mb-1">Entrega</p>{order.deliveryAddress}{order.receivingHours ? ` · ${order.receivingHours}` : ''}</section>
        )}
        {order.invoiceRef && <section className="text-xs"><p className="eyebrow mb-1">Documento</p>{order.invoiceRef}{(order as Order & { invoiceUrl?: string }).invoiceUrl ? <> · <a className="underline" href={(order as Order & { invoiceUrl?: string }).invoiceUrl} target="_blank" rel="noreferrer">PDF</a></> : null}</section>}
        <section>
          <p className="eyebrow mb-1.5">Historial</p>
          <ol className="space-y-1 text-xs">
            {[...order.statusHistory].reverse().map((h, i) => (
              <li key={i} className="flex justify-between gap-3"><span><strong className="text-charcoal-900">{ORDER_STATUS_LABEL[h.status]}</strong>{h.note ? <span className="text-charcoal-500"> · {h.note}</span> : null}</span><span className="text-charcoal-300 shrink-0">{nameOf(h.by)} · {new Date(h.at).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></li>
            ))}
          </ol>
        </section>
        {order.rawText && <details className="text-xs"><summary className="eyebrow cursor-pointer">Mensaje original</summary><pre className="mt-1 whitespace-pre-wrap text-charcoal-500 font-sans">{order.rawText}</pre></details>}
      </div>
      <footer className="px-5 py-3 border-t border-charcoal-100 flex gap-2">
        <Link to={detailTo} className="flex-1"><Button variant="secondary" className="w-full">Abrir detalle</Button></Link>
        {action.kind !== 'none' && <Button className="flex-1" variant={action.kind === 'anular' ? 'danger' : 'primary'} onClick={() => onAction(action.kind)}>{action.label}</Button>}
      </footer>
    </aside>
  );
}
