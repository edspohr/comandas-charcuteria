import type { OrderLine, Product, ProductFormat } from '@/domain/types';

// Chile displays prices without decimals: $12.500, not $12500.00.
const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

export function formatCLP(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return CLP.format(Math.round(value));
}

// Best-effort subtotal for a line + format, given optional real packed weight.
// Sachet/unit formats:    qty × priceCLP
// Granel (unit === 'kg'): qty × pricePerKgCLP
// Pieza (unit === 'unidad' + pricePerKgCLP):
//   packedWeightKg × pricePerKgCLP if we have the real weight; else
//   qty × avgWeightKg × pricePerKgCLP as a preview.
export function computeLineSubtotal(
  format: ProductFormat | undefined,
  qty: number,
  packedWeightKg?: number,
): number | undefined {
  if (!format || qty <= 0) return undefined;
  if (format.priceCLP != null) return qty * format.priceCLP;
  if (format.pricePerKgCLP != null) {
    if (format.unit === 'kg') return qty * format.pricePerKgCLP;
    if (packedWeightKg != null && packedWeightKg > 0) return packedWeightKg * format.pricePerKgCLP;
    if (format.avgWeightKg != null) return qty * format.avgWeightKg * format.pricePerKgCLP;
  }
  return undefined;
}

// Convenience: unit reference price shown in pickers (per sachet, per kg, per
// piece using avg weight). Used purely for display in the wizard.
export function referenceUnitPrice(format: ProductFormat | undefined): number | undefined {
  if (!format) return undefined;
  if (format.priceCLP != null) return format.priceCLP;
  if (format.pricePerKgCLP != null) {
    if (format.unit === 'kg') return format.pricePerKgCLP;
    if (format.avgWeightKg != null) return format.avgWeightKg * format.pricePerKgCLP;
  }
  return undefined;
}

export function unitPriceLabel(format: ProductFormat | undefined): string {
  if (!format) return '';
  if (format.priceCLP != null) return `${formatCLP(format.priceCLP)} /u`;
  if (format.pricePerKgCLP != null) {
    if (format.unit === 'kg') return `${formatCLP(format.pricePerKgCLP)} /kg`;
    if (format.avgWeightKg != null) return `${formatCLP(format.pricePerKgCLP)} /kg × ~${format.avgWeightKg} kg`;
  }
  return '';
}

// Sum a list of lines. Prefers the stored `subtotalCLP` snapshot; falls back
// to computing from the catalog for lines that don't have one (e.g. drafts).
export function sumLineSubtotals(lines: OrderLine[], productsById: Map<string, Product>): number {
  let total = 0;
  for (const l of lines) {
    if (l.subtotalCLP != null) { total += l.subtotalCLP; continue; }
    const prod = productsById.get(l.productId);
    const fmt = prod?.formats.find((f) => f.formatId === l.formatId);
    const sub = computeLineSubtotal(fmt, l.qty, l.packedWeightKg);
    if (sub != null) total += sub;
  }
  return total;
}
