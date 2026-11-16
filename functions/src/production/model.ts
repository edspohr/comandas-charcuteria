// Modelo puro compartido por servidor, interfaz y pruebas. Costos netos de insumos.
export interface Ingredient { supplyId: string; qty: number }
export interface LotBalance { id: string; supplyId: string; supplyName: string; kg: number; units: number; consumedKg?: number; consumedUnits?: number; receivedAt: number; expiry?: string; costPerKg?: number; purchaseId?: string }
export interface Consumption { lotId: string; supplyId: string; supplyName: string; unit: 'kg' | 'unidad'; qty: number; costCLP: number | null; purchaseId?: string }
export interface ProducedLine { productId: string; formatId: string; productName: string; formatLabel: string; unit: 'kg' | 'g' | 'unidad'; qty: number; outputKg: number }
export interface ProductionBatch {
  id: string; process: string; status: 'en_proceso' | 'terminada' | 'anulada';
  at: number; by: string; byName: string; note: string;
  inputs: Consumption[]; inputKg: number; knownCostCLP: number; costComplete: boolean;
  outputs?: ProducedLine[]; outputKg?: number; closedAt?: number; closedBy?: string; productionEntryId?: string;
  cancelledAt?: number; cancelledBy?: string;
}
export function remaining(lot: LotBalance, unit: 'kg' | 'unidad'): number {
  return Math.max(0, Math.round(((unit === 'kg' ? lot.kg - (lot.consumedKg ?? 0) : lot.units - (lot.consumedUnits ?? 0))) * 1000) / 1000);
}
export function allocateIngredients(inputs: Ingredient[], lots: LotBalance[], units: Map<string, 'kg' | 'unidad'>, today: string): Consumption[] {
  if (!inputs.length || inputs.length > 40) throw new Error('Seleccione entre 1 y 40 insumos.');
  const result: Consumption[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const unit = units.get(input.supplyId);
    if (!unit || seen.has(input.supplyId) || !Number.isFinite(input.qty) || input.qty <= 0 || input.qty > 1e6 || Math.abs(input.qty * 1000 - Math.round(input.qty * 1000)) > 1e-6 || (unit === 'unidad' && !Number.isInteger(input.qty))) throw new Error('Revise los insumos y sus cantidades (máximo tres decimales, sin repetir).');
    seen.add(input.supplyId);
    let needed = input.qty;
    const eligible = lots.filter(l => l.supplyId === input.supplyId && (!l.expiry || l.expiry >= today)).sort((a, b) => a.receivedAt - b.receivedAt || a.id.localeCompare(b.id));
    for (const lot of eligible) {
      const qty = Math.min(needed, remaining(lot, unit));
      if (qty <= 0) continue;
      const costCLP = unit === 'kg' && Number.isFinite(lot.costPerKg) && lot.costPerKg! >= 0 ? qty * lot.costPerKg! : null;
      result.push({ lotId: lot.id, supplyId: lot.supplyId, supplyName: lot.supplyName, unit, qty, costCLP, ...(lot.purchaseId ? { purchaseId: lot.purchaseId } : {}) });
      needed = Math.round((needed - qty) * 1000) / 1000;
      if (needed === 0) break;
    }
    if (needed > 0) throw new Error(`Stock insuficiente o vencido para ${eligible[0]?.supplyName ?? input.supplyId}. Faltan ${needed} ${unit}.`);
  }
  if (result.length > 180) throw new Error('La elaboración utiliza demasiados lotes. Divídala en dos elaboraciones.');
  return result;
}
export function batchMetrics(batch: ProductionBatch) {
  const outputKg = batch.outputKg ?? 0;
  return {
    yieldPct: batch.inputKg > 0 && batch.status === 'terminada' ? outputKg / batch.inputKg * 100 : null,
    lossKg: batch.status === 'terminada' ? batch.inputKg - outputKg : null,
    costPerKg: batch.costComplete && outputKg > 0 ? batch.knownCostCLP / outputKg : null,
  };
}
