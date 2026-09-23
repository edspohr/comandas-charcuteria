import type { KanbanThresholds, Order, OrderStatus, Role, StockDoc } from './types';
import { DEFAULT_KANBAN_THRESHOLDS } from './types';
import { orderHasCompromisedStock } from '@/data/stock';
import { todayInSantiago } from '@/lib/format';

// ---------- Columns ----------

export type ColumnId = 'pendiente' | 'en_armado' | 'por_facturar' | 'por_despachar' | 'cerrado';

export interface ColumnDef { id: ColumnId; label: string; short: string; statuses: OrderStatus[]; hint: string; }

export const COLUMNS: ColumnDef[] = [
  { id: 'pendiente',     label: 'Pendiente',      short: 'Pend.',   statuses: ['recibido', 'confirmado', 'confirmado_parcial'], hint: 'Confirmados y esperando stock' },
  { id: 'en_armado',     label: 'En armado',      short: 'Armado',  statuses: ['en_armado'],                                    hint: 'Tomados por un armador' },
  { id: 'por_facturar',  label: 'Por facturar',   short: 'Fact.',   statuses: ['armado'],                                       hint: 'Armados, sin documento Bsale' },
  { id: 'por_despachar', label: 'Por despachar',  short: 'Desp.',   statuses: ['facturado'],                                    hint: 'Con documento, listos para salir' },
  { id: 'cerrado',       label: 'Cerrado',        short: 'Cerr.',   statuses: ['despachado', 'entregado'],                      hint: 'Despachados y entregados' },
];

export function columnFor(status: OrderStatus): ColumnId | null {
  const col = COLUMNS.find((c) => c.statuses.includes(status));
  return col ? col.id : null;
}

// ---------- Card tone ----------

export type Tone = 'red' | 'amber' | 'neutral' | 'gray';

export interface ToneResult { tone: Tone; reasons: string[]; }

const H = 60 * 60 * 1000;

function lastStatusAt(order: Order, status: OrderStatus): number | null {
  for (let i = order.statusHistory.length - 1; i >= 0; i--) {
    if (order.statusHistory[i].status === status) return order.statusHistory[i].at;
  }
  return null;
}

export function cardTone(
  order: Order,
  stock: Map<string, StockDoc>,
  thresholds: KanbanThresholds = DEFAULT_KANBAN_THRESHOLDS,
  now: number = Date.now(),
  today: string = todayInSantiago(),
): ToneResult {
  if (order.status === 'anulado') return { tone: 'gray', reasons: ['Anulado'] };
  if (order.status === 'entregado') return { tone: 'gray', reasons: [] };

  const reasons: string[] = [];
  let tone: Tone = 'neutral';
  const bump = (t: Tone, why: string) => {
    reasons.push(why);
    if (t === 'red' || (t === 'amber' && tone !== 'red')) tone = t;
  };

  const open = order.status !== 'despachado';
  if (open && order.requestedDate < today) bump('red', 'Atrasado');
  if (orderHasCompromisedStock(order, stock)) bump('red', 'Stock comprometido');

  if (order.requestedDate === today && ['recibido', 'confirmado', 'confirmado_parcial', 'en_armado'].includes(order.status)) {
    bump('amber', 'Vence hoy');
  }
  if (['recibido', 'confirmado'].includes(order.status) && !order.assignedPackerId) {
    const since = lastStatusAt(order, 'confirmado') ?? order.createdAt;
    if (now - since > thresholds.sinAsignarHoras * H) bump('amber', `Sin asignar hace ${Math.floor((now - since) / H)} h`);
  }
  if (order.status === 'armado') {
    const since = lastStatusAt(order, 'armado') ?? order.updatedAt;
    if (now - since > thresholds.armadoSinDocHoras * H) bump('amber', `Armado hace ${Math.floor((now - since) / H)} h sin documento`);
  }
  if (order.status === 'despachado') {
    const since = lastStatusAt(order, 'despachado') ?? order.updatedAt;
    if (now - since > thresholds.despachadoSinEntregaHoras * H) bump('amber', `Despachado hace ${Math.floor((now - since) / H)} h sin entrega`);
  }
  return { tone, reasons };
}

// ---------- Next action per role ----------

export type ActionKind = 'take' | 'arm' | 'link' | 'dispatch' | 'deliver' | 'anular' | 'none';

export interface NextAction { kind: ActionKind; label: string; }

export function nextAction(order: Order, role: Role, uid: string): NextAction {
  const isAdmin = role === 'admin' || role === 'superAdmin';
  const anyPending = order.lines.some((l) => l.pendingProductionQty > 0);
  switch (order.status) {
    case 'recibido':
    case 'confirmado':
    case 'confirmado_parcial':
      if ((role === 'despacho' || isAdmin) && !anyPending && (!order.assignedPackerId || order.assignedPackerId === uid)) {
        return { kind: 'take', label: order.assignedPackerId ? 'Comenzar armado' : 'Tomar' };
      }
      if (role === 'vendedor' && order.createdBy === uid) return { kind: 'anular', label: 'Anular' };
      return { kind: 'none', label: '' };
    case 'en_armado':
      if ((role === 'despacho' && order.assignedPackerId === uid) || isAdmin) return { kind: 'arm', label: 'Armar' };
      if (role === 'vendedor' && order.createdBy === uid) return { kind: 'anular', label: 'Anular' };
      return { kind: 'none', label: '' };
    case 'armado':
      return isAdmin ? { kind: 'link', label: 'Vincular doc.' } : { kind: 'none', label: '' };
    case 'facturado':
      return isAdmin ? { kind: 'dispatch', label: 'Despachar' } : { kind: 'none', label: '' };
    case 'despachado':
      return isAdmin ? { kind: 'deliver', label: 'Entregar' } : { kind: 'none', label: '' };
    default:
      return { kind: 'none', label: '' };
  }
}

// Which action a drop on `target` means, if any. Only adjacent forward moves.
export function actionForDrop(order: Order, target: ColumnId, role: Role, uid: string): ActionKind | null {
  const from = columnFor(order.status);
  if (!from || from === target) return null;
  const idx = COLUMNS.findIndex((c) => c.id === from);
  if (COLUMNS[idx + 1]?.id !== target) return null;
  const a = nextAction(order, role, uid);
  const expected: Record<ColumnId, ActionKind | null> = {
    pendiente: null, en_armado: 'take', por_facturar: 'arm', por_despachar: 'link', cerrado: 'dispatch',
  };
  return a.kind === expected[target] ? a.kind : null;
}
