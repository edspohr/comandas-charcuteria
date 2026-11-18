export interface DebtDocument { id: number | string; name?: string; number: number | string; emissionDate: number; expirationDate?: number; totalAmount: number; totalAmountOwed: number }
export interface ClientDebt { client?: { id: number | string }; overdue_documents?: DebtDocument[]; upcoming_documents?: DebtDocument[] }
export interface ReceivableInvoice { id: string; number: string; issued: string; due: string | null; total: number; balance: number; applied: number; overdue: boolean }
export function debtInvoices(data: ClientDebt, today: string): ReceivableInvoice[] {
  const docs = [...(data.overdue_documents ?? []), ...(data.upcoming_documents ?? [])];
  const seen = new Set<string>();
  return docs.filter(d => /factura/i.test(d.name ?? '') && !seen.has(String(d.id)) && !!seen.add(String(d.id))).map(d => {
    const total = Number(d.totalAmount), balance = Number(d.totalAmountOwed);
    if (!Number.isFinite(total) || !Number.isFinite(balance) || total < 0 || balance < 0) throw Error('Bsale entregó un saldo no válido.');
    const due = d.expirationDate ? new Date(d.expirationDate * 1000).toISOString().slice(0, 10) : null;
    return { id: String(d.id), number: String(d.number), issued: new Date(d.emissionDate * 1000).toISOString().slice(0, 10), due, total, balance, applied: Math.max(0, total - balance), overdue: balance > 0 && !!due && due < today };
  }).filter(d => d.balance > 0).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
}
export function ownsReceivable(role: string, uid: string, ownerUid: unknown) { return role === 'superAdmin' || ownerUid === uid; }
export function paymentWritesAllowed(s: { enabled?: boolean; writesEnabled?: boolean; paymentsEnabled?: boolean; dryRun?: boolean }) {
  return s.enabled === true && s.writesEnabled === true && s.paymentsEnabled === true && s.dryRun === false;
}
export function validPayment(amount: unknown, balance: number, date: unknown, today: string) {
  return typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0 && amount <= balance && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date && date <= today;
}
