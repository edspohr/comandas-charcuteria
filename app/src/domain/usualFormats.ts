import type { Order, Product } from './types';
export function usualFormats(orders: Order[], products: Product[]): Map<string, { formatId: string; date: number }> {
  const out = new Map<string, { formatId: string; date: number }>();
  for (const order of [...orders].filter(o => !o.deleted && o.status !== 'anulado').sort((a, b) => b.createdAt - a.createdAt)) {
    for (const line of order.lines) {
      if (line.sample || out.has(line.productId)) continue;
      const p = products.find(p => p.id === line.productId && p.active && !p.discontinued && p.sellable !== false);
      if (p?.formats.some(f => f.formatId === line.formatId)) out.set(line.productId, { formatId: line.formatId, date: order.createdAt });
    }
  }
  return out;
}
