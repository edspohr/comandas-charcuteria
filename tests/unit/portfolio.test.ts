import { expect, it } from 'vitest';
import { matchSeller, suggestPortfolio, type PortfolioSale } from '../../scripts/portfolio-suggestions';
const sale = (id: string, sellerId: string, patch: Partial<PortfolioSale> = {}): PortfolioSale => ({ id, sellerId, clientId: 'c', date: '2026-11-10', kind: 'factura', total: 100, ...patch });
it('requires a strict majority and does not count duplicates, credits, guides or out-of-period sales', () => {
  const result = suggestPortfolio([sale('1', 'a'), sale('1', 'a'), sale('2', 'b'), sale('3', 'a', { kind: 'nota_credito' }), sale('4', 'a', { kind: 'guia' }), sale('5', 'a', { date: '2026-01-01' })], '2026-05-18', '2026-11-18');
  expect(result.get('c')?.sellerId).toBeNull();
  expect(result.get('c')?.total).toBe(2);
  expect(suggestPortfolio([sale('1', 'a'), sale('2', 'a'), sale('3', 'b')], '2026-05-18', '2026-11-18').get('c')?.sellerId).toBe('a');
});
it('matches unique emails, normalized names and shortened app names without guessing surnames', () => {
  expect(matchSeller({ name: 'Rafael  Araújo' }, [{ uid: 'r', displayName: 'Rafael Araujo' }])).toBe('r');
  expect(matchSeller({ name: 'Ramiro García' }, [{ uid: 'r', displayName: 'Ramiro' }])).toBe('r');
  expect(matchSeller({ name: 'Luis Alvarez' }, [{ uid: 'l', displayName: 'Luis Orsini' }])).toBeNull();
  expect(matchSeller({ name: 'Juan Urriola' }, [{ uid: 'a', displayName: 'Juan' }, { uid: 'b', displayName: 'Juan' }])).toBeNull();
  expect(matchSeller({ name: 'Distinto', email: 'A@TEST.CL' }, [{ uid: 'a', displayName: 'Ana', email: 'a@test.cl' }])).toBe('a');
});
