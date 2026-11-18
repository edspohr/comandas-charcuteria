import type { ReceivableClient, ReceivableInvoice } from '../data/receivables';
export type CollectionFilter = 'all' | 'overdue' | 'due7' | 'partial' | 'over90';
export type CollectionSort = 'priority' | 'balance' | 'due' | 'client';
export type CollectionInvoice = ReceivableInvoice & { client: ReceivableClient; daysLate: number };
export function daysLate(due: string | null, today: string): number {
  if (!due) return 0;
  return Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400_000));
}
export function collectionRows(clients: ReceivableClient[], today: string): CollectionInvoice[] {
  return clients.filter(c => !c.error).flatMap(client => client.invoices.filter(i => i.balance > 0).map(i => ({ ...i, overdue: daysLate(i.due, today) > 0, client, daysLate: daysLate(i.due, today) })));
}
export function filterCollection(rows: CollectionInvoice[], filter: CollectionFilter, sort: CollectionSort, search: string, today: string) {
  const key = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const q = key(search.trim());
  const until = Date.parse(`${today}T00:00:00Z`) + 7 * 86400_000;
  return rows.filter(i => (!q || key(`${i.number} ${i.client.name} ${i.client.rut}`).includes(q)) && (
    filter === 'all' || filter === 'overdue' && i.daysLate > 0 || filter === 'over90' && i.daysLate > 90 ||
    filter === 'partial' && i.applied > 0 || filter === 'due7' && !!i.due && i.due >= today && Date.parse(`${i.due}T00:00:00Z`) <= until
  )).sort((a, b) => {
    if (sort === 'balance') return b.balance - a.balance || b.daysLate - a.daysLate;
    if (sort === 'client') return a.client.name.localeCompare(b.client.name, 'es') || b.daysLate - a.daysLate;
    if (sort === 'due') return (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.balance - a.balance;
    return b.daysLate - a.daysLate || b.balance - a.balance || a.number.localeCompare(b.number);
  });
}
export function collectionSummary(rows: CollectionInvoice[], today: string) {
  const sum = (r: CollectionInvoice[]) => r.reduce((s, i) => s + i.balance, 0);
  const overdueRows = rows.filter(i => i.daysLate > 0);
  return { total: sum(rows), overdue: sum(overdueRows), overdueCount: overdueRows.length, clients: new Set(rows.map(i => i.client.id)).size,
    due7: sum(filterCollection(rows, 'due7', 'priority', '', today)), over90: sum(rows.filter(i => i.daysLate > 90)),
    buckets: [
      { label: 'Por vencer / sin fecha', rows: rows.filter(i => i.daysLate === 0), tone: 'bg-emerald-600' },
      { label: '1–30 días', rows: rows.filter(i => i.daysLate >= 1 && i.daysLate <= 30), tone: 'bg-amber-500' },
      { label: '31–60 días', rows: rows.filter(i => i.daysLate >= 31 && i.daysLate <= 60), tone: 'bg-orange-500' },
      { label: '61–90 días', rows: rows.filter(i => i.daysLate >= 61 && i.daysLate <= 90), tone: 'bg-red-500' },
      { label: 'Más de 90 días', rows: rows.filter(i => i.daysLate > 90), tone: 'bg-red-800' },
    ].map(b => ({ label: b.label, total: sum(b.rows), count: b.rows.length, tone: b.tone })),
  };
}
