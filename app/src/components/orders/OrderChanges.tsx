import { useState } from 'react';
import Button from '@/components/ui/Button';
import { ackOrderChange } from '@/data/orders';
import type { Order, OrderChange, OrderChangeItem, Role } from '@/domain/types';
import { can } from '@/domain/permissions';
import { formatQty } from '@/lib/format';
import { describeFirestoreError } from '@/lib/errors';

// Avisos de cambio de un pedido (ADR-0018): naranja mientras el otro lado no
// lo ha visto; en verde lo que subió, en rojo lo que bajó.

export const lastChange = (o: Pick<Order, 'changes'>): OrderChange | undefined => o.changes?.[o.changes.length - 1];

// ¿Quién puede cerrar el aviso? El lado al que va dirigido o un supervisor.
export function canAckChange(o: Order, role: Role, uid: string): boolean {
  if (!o.changeNotice) return false;
  if (can(role, 'order.cancelAny')) return true;
  return o.changeNotice.for === 'armado' ? can(role, 'order.pack') : o.createdBy === uid;
}

const qty = (i: OrderChangeItem, n: number) => (i.sample && i.unit === 'kg' ? `${Math.round(n * 1000)} g` : formatQty(n, i.unit));

export function ChangeItems({ items, compact = false }: { items: OrderChangeItem[]; compact?: boolean }) {
  return (
    <ul className={compact ? 'space-y-0.5' : 'space-y-1'}>
      {items.map((i, k) => {
        const up = i.after > i.before;
        const tone = up ? 'text-emerald-700' : 'text-red-700';
        const what = i.before === 0 ? `+ ${qty(i, i.after)}` : i.after === 0 ? `quitado (${qty(i, i.before)})` : `${qty(i, i.before)} → ${qty(i, i.after)}`;
        return (
          <li key={k} className={(compact ? 'text-[11px] ' : 'text-xs ') + tone}>
            <span className="font-semibold">{up ? '▲' : '▼'} {i.productName}</span>
            {!compact && <span className="text-charcoal-400"> · {i.formatLabel}</span>} <span className="font-semibold">{what}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ChangeNoticeBox({ order, role, uid, nameOf }: { order: Order; role: Role; uid: string; nameOf: (uid: string) => string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = lastChange(order);
  if (!order.changeNotice || !c) return null;
  const who = c.side === 'venta' ? 'El vendedor modificó el pedido' : 'Armado rebajó el pedido';
  async function ack() {
    setBusy(true); setError(null);
    try { await ackOrderChange(order, uid); } catch (e) { setError(describeFirestoreError(e)); } finally { setBusy(false); }
  }
  return (
    <div className="card mb-4 p-4 border-orange-300 bg-orange-50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-orange-900">{who}</p>
          <p className="text-[11px] text-charcoal-500">{nameOf(c.by)} · {new Date(c.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}{c.note ? ` · ${c.note}` : ''}</p>
        </div>
        {canAckChange(order, role, uid) && <Button size="sm" onClick={ack} disabled={busy}>{busy ? '…' : 'Visto'}</Button>}
      </div>
      <div className="mt-2"><ChangeItems items={c.items} /></div>
      {c.side === 'armado' && order.createdBy === uid && <p className="text-[11px] text-charcoal-600 mt-2">Avísele al cliente lo que no va en el pedido.</p>}
      {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
    </div>
  );
}

// Historial completo de cambios (ficha del pedido).
export function ChangesHistory({ order, nameOf }: { order: Order; nameOf: (uid: string) => string }) {
  if (!order.changes?.length) return null;
  return (
    <div className="card p-4 mb-4">
      <p className="eyebrow mb-2">Cambios al pedido</p>
      <ol className="space-y-3">
        {[...order.changes].reverse().map((c, i) => (
          <li key={i}>
            <p className="text-[11px] text-charcoal-500">{c.side === 'venta' ? 'Vendedor' : 'Armado'} · {nameOf(c.by)} · {new Date(c.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}{c.note ? ` · ${c.note}` : ''}{c.seenBy ? ` · visto por ${nameOf(c.seenBy)}` : ''}</p>
            <ChangeItems items={c.items} />
          </li>
        ))}
      </ol>
    </div>
  );
}
