import { expect, it } from 'vitest';
import { usualFormats } from '../../app/src/domain/usualFormats';
import type { Order, Product } from '../../app/src/domain/types';
it('recomienda el último formato vigente, excluyendo anulados, borrados y muestras', () => {
  const products = [{ id: 'p', active: true, formats: [{ formatId: '200' }, { formatId: 'kg' }] }] as Product[];
  const order = (createdAt: number, formatId: string, extra = {}, lineExtra = {}) => ({ createdAt, status: 'entregado', lines: [{ productId: 'p', formatId, ...lineExtra }], ...extra } as Order);
  expect(usualFormats([order(1, '200'), order(2, 'retirado'), order(3, 'kg', { status: 'anulado' }), order(4, 'kg', { deleted: {} }), order(5, 'kg', {}, { sample: {} })], products).get('p')?.formatId).toBe('200');
});
