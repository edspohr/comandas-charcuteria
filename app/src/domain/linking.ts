import type { Order } from './types';
import type { BsaleDocument } from '@/integrations/bsale/BsaleClient';

// Sugerencia de documento para vincular. La oficina emite en el POS de Bsale
// y Comandas propone el documento que calza con el pedido; la oficina lo
// confirma con su PIN (nunca se vincula solo).
//
// Puntaje: referencia = id del pedido (100), mismo RUT (20), total a ±5 % (10).
// Se sugiere cuando es referencia exacta, o mismo RUT + total parecido, y no
// hay otro documento con el mismo puntaje (si hay dos, que elija la oficina).

export const DOC_REF_SCORE = 100;
const STRONG = 30;
// El cajero puede emitir un poco antes de que el pedido quede armado, pero
// no antes de que exista.
const SLACK_MS = 60 * 60 * 1000;

export function documentScore(order: Order, d: BsaleDocument): number {
  let s = 0;
  if (d.reference && d.reference.trim().toUpperCase() === order.id.toUpperCase()) s += DOC_REF_SCORE;
  if (d.clientRut && order.clientSnapshot.rut && normRut(d.clientRut) === normRut(order.clientSnapshot.rut)) s += 20;
  if (order.totalCLP && Math.abs(d.totalCLP - order.totalCLP) / order.totalCLP < 0.05) s += 10;
  return s;
}

export function rankDocuments(order: Order, documents: BsaleDocument[]): Array<{ d: BsaleDocument; s: number }> {
  return documents
    .filter((d) => !d.linkedOrderId)
    .map((d) => ({ d, s: documentScore(order, d) }))
    .sort((a, b) => b.s - a.s || b.d.emittedAt - a.d.emittedAt);
}

export function suggestDocument(order: Order, documents: BsaleDocument[]): BsaleDocument | null {
  const ranked = rankDocuments(order, documents).filter(({ d }) => d.emittedAt >= order.createdAt - SLACK_MS);
  const [first, second] = ranked;
  if (!first || first.s < STRONG) return null;
  if (second && second.s === first.s) return null;
  return first.d;
}

// Pedido de venta que todavía espera su documento: armado, o despachado /
// entregado sin factura. Reposiciones y pedidos solo de muestras no se facturan.
export function awaitsDocument(o: Order): boolean {
  if (o.invoiceRef || o.archived || o.historical) return false;
  if (o.kind === 'reposicion' || o.kind === 'muestras') return false;
  return o.status === 'armado' || o.status === 'despachado' || o.status === 'entregado';
}

const normRut = (r: string) => r.replace(/[^0-9kK]/g, '').toUpperCase();
