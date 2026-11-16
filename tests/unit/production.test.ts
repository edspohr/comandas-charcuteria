import { describe, expect, it } from 'vitest';
import { allocateIngredients, batchMetrics, remaining, type ProductionBatch } from '../../functions/src/production/model';
const lot = (id: string, kg: number, receivedAt: number, costPerKg?: number) => ({ id, supplyId: 'carne', supplyName: 'Carne', kg, units: 0, receivedAt, costPerKg });
const units = new Map([['carne', 'kg' as const]]);
describe('consumo de insumos', () => {
  it('usa saldo FIFO, conserva la compra de origen y suma costos de distintos lotes', () => {
    const result = allocateIngredients([{ supplyId: 'carne', qty: 8 }], [{ ...lot('old', 10, 1, 1000), consumedKg: 5, purchaseId: 'factura-1' }, lot('new', 20, 2, 2000)], units, '2026-11-16');
    expect(result).toMatchObject([{ lotId: 'old', qty: 5, costCLP: 5000, purchaseId: 'factura-1' }, { lotId: 'new', qty: 3, costCLP: 6000 }]);
    expect(remaining({ ...lot('old', 10, 1), consumedKg: 5 }, 'kg')).toBe(5);
  });
  it('no usa insumos vencidos ni inventa saldos', () => {
    expect(() => allocateIngredients([{ supplyId: 'carne', qty: 6 }], [{ ...lot('old', 10, 1), expiry: '2026-11-15' }, lot('new', 5, 2)], units, '2026-11-16')).toThrow('Stock insuficiente');
  });
  it('rechaza insumos repetidos, cantidades negativas, NaN y unidades fraccionarias', () => {
    for (const qty of [-1, NaN, Infinity, 0, 0.0001]) expect(() => allocateIngredients([{ supplyId: 'carne', qty }], [lot('a', 20, 1)], units, '2026-11-16')).toThrow();
    expect(() => allocateIngredients([{ supplyId: 'carne', qty: 2 }, { supplyId: 'carne', qty: 2 }], [lot('a', 20, 1)], units, '2026-11-16')).toThrow();
    expect(() => allocateIngredients([{ supplyId: 'carne', qty: 1.5 }], [lot('a', 20, 1)], new Map([['carne', 'unidad']]), '2026-11-16')).toThrow();
  });
  it('distingue costos faltantes de costo cero', () => {
    expect(allocateIngredients([{ supplyId: 'carne', qty: 1 }], [lot('a', 20, 1)], units, '2026-11-16')[0].costCLP).toBeNull();
    expect(allocateIngredients([{ supplyId: 'carne', qty: 1 }], [lot('a', 20, 1, 0)], units, '2026-11-16')[0].costCLP).toBe(0);
  });
  it('calcula rendimiento y costo sólo con información completa', () => {
    const batch = { status: 'terminada', inputKg: 10, outputKg: 8, knownCostCLP: 16000, costComplete: true } as ProductionBatch;
    expect(batchMetrics(batch)).toEqual({ yieldPct: 80, lossKg: 2, costPerKg: 2000 });
    expect(batchMetrics({ ...batch, costComplete: false }).costPerKg).toBeNull();
    expect(batchMetrics({ ...batch, status: 'en_proceso' }).yieldPct).toBeNull();
  });
});
