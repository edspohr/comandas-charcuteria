import type { DraftLine } from '@/data/orders';
import type { Order } from './types';

// Pedidos con excepción (reunión 20-10 con Ciro): formatos, cantidades o
// condiciones comerciales fuera del estándar se confirman al cliente solo
// después de que Ciro (super administración) los aprueba. El stock se
// reserva igual; despacho no puede tomarlos hasta la aprobación. Rechazar =
// anular con el motivo (el vendedor lo ve y rehace el pedido si corresponde).

export const EXCEPTION_KINDS = [
  ['precio', 'Precio o descuento especial'],
  ['formato', 'Formato, corte o envase especial'],
  ['pago', 'Condición de pago especial'],
  ['entrega', 'Entrega o plazo especial'],
  ['otro', 'Otra condición'],
] as const;
export type ExceptionKind = typeof EXCEPTION_KINDS[number][0];

// Por línea: sobre estos umbrales el pedido pide aprobación automáticamente.
export const EXCEPTION_MAX_KG_LINE = 25;
export const EXCEPTION_MAX_UNITS_LINE = 60;

export interface Approval {
  status: 'pendiente' | 'aprobado' | 'rechazado';
  reasons: string[];
  kinds?: ExceptionKind[];
  note?: string;
  requestedBy: string; requestedAt: number;
  decidedBy?: string; decidedAt?: number; decisionNote?: string;
}

export function autoReasons(lines: DraftLine[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (l.sample) continue;
    if (l.unit === 'kg' && l.qty > EXCEPTION_MAX_KG_LINE) out.push(`${l.productName}: ${l.qty} kg (sobre ${EXCEPTION_MAX_KG_LINE} kg por línea)`);
    if (l.unit !== 'kg' && l.qty > EXCEPTION_MAX_UNITS_LINE) out.push(`${l.productName} · ${l.formatLabel}: ${l.qty} u (sobre ${EXCEPTION_MAX_UNITS_LINE} por línea)`);
  }
  return out;
}

export const awaitingApproval = (o: Pick<Order, 'approval'>) => o.approval?.status === 'pendiente';
