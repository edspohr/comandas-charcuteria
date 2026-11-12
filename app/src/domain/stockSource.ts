import type { StockDoc } from './types';
export type StockSource = 'fabrica' | 'tienda';
export const reserveField = (source?: StockSource) => source === 'tienda' ? 'storeReserved' : 'reserved';
export const sourceStock = (s: StockDoc, source?: StockSource): { onHand: number; reserved: number } => source === 'tienda'
  ? { onHand: s.storeOnHand ?? 0, reserved: s.storeReserved ?? 0 }
  : { onHand: s.onHand, reserved: s.reserved };
export const sourceAvailable = (s: StockDoc, source?: StockSource) => { const x = sourceStock(s, source); return Math.max(0, x.onHand - x.reserved); };
export function stockForSource(stock: Map<string, StockDoc>, source?: StockSource): Map<string, StockDoc> {
  if (source !== 'tienda') return stock;
  return new Map([...stock].map(([id, s]) => [id, { ...s, ...sourceStock(s, source) }]));
}
