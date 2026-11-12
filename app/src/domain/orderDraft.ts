import type { Product, ProductFormat } from './types';

// Pasted messages and repeated orders carry product/format ids, but may not
// carry a price snapshot. Fill the format before presenting the confirmation.
export function withDraftFormats<T extends { productId: string; formatId: string; sample?: boolean; format?: ProductFormat }>(lines: T[], products: Product[]): T[] {
  let changed = false;
  const result = lines.map(line => {
    if (line.sample || line.format) return line;
    const format = products.find(p => p.id === line.productId)?.formats.find(f => f.formatId === line.formatId);
    if (!format) return line;
    changed = true;
    return { ...line, format };
  });
  return changed ? result : lines;
}
