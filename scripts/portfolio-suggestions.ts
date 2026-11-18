// Pure ranking logic shared by the production migration and unit tests.
export interface PortfolioSale { clientId: string; sellerId: string; date: string; kind: string; total: number; id: string }
export function suggestPortfolio(sales: PortfolioSale[], since: string, until: string) {
  const counts = new Map<string, Map<string, number>>();
  const seen = new Set<string>();
  for (const sale of sales) {
    if (sale.date < since || sale.date > until || !['factura', 'boleta'].includes(sale.kind) || sale.total <= 0 || !sale.clientId || sale.clientId === '0' || !sale.sellerId || sale.sellerId === '0' || seen.has(sale.id)) continue;
    seen.add(sale.id);
    const sellers = counts.get(sale.clientId) ?? new Map<string, number>();
    sellers.set(sale.sellerId, (sellers.get(sale.sellerId) ?? 0) + 1);
    counts.set(sale.clientId, sellers);
  }
  return new Map([...counts].map(([id, counts]) => {
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((sum, [, n]) => sum + n, 0);
    const [sellerId, documents] = ranked[0];
    return [id, { sellerId: documents > total / 2 ? sellerId : null, documents, total, candidates: ranked }];
  }));
}
export const normalizedName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
export function matchSeller(seller: { name: string; email?: string }, users: Array<{ uid: string; displayName: string; email?: string }>): string | null {
  const email = seller.email?.trim().toLowerCase();
  const byEmail = email ? users.filter((u) => u.email?.trim().toLowerCase() === email) : [];
  if (byEmail.length) return byEmail.length === 1 ? byEmail[0].uid : null;
  const name = normalizedName(seller.name);
  if (!name) return null;
  const exact = users.filter((u) => normalizedName(u.displayName) === name);
  if (exact.length) return exact.length === 1 ? exact[0].uid : null;
  // Accept a shortened app name only when it is an unambiguous first name.
  const short = users.filter((u) => {
    const userName = normalizedName(u.displayName);
    return userName.split(' ').length === 1 && userName === name.split(' ')[0];
  });
  return short.length === 1 ? short[0].uid : null;
}
