import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { withPin } from './pin';
export interface ReceivableInvoice { id: string; number: string; issued: string; due: string | null; total: number; balance: number; applied: number; overdue: boolean }
export interface ReceivableClient { id: string; name: string; rut: string; ownerUid: string | null; invoices: ReceivableInvoice[]; error: string | null }
export interface ReceivablePage { clients: ReceivableClient[]; totalClients: number; page: number; checkedAt: number; writesEnabled: boolean }
export const getReceivables = httpsCallable<{ search: string; ownerUid: string; page: number }, ReceivablePage>(functions, 'bsaleReceivables', { timeout: 180_000 });
export const getClientInvoices = httpsCallable<{ clientId: string }, { invoices: ReceivableInvoice[]; checkedAt: number; truncated: boolean }>(functions, 'bsaleClientInvoices', { timeout: 180_000 });
const pay = httpsCallable<{ clientId: string; documentId: string; amount: number; date: string; paymentTypeId: number; requestId: string; pin?: string }, { ok: true; paymentId: number }>(functions, 'bsaleRecordPayment', { timeout: 180_000 });
export async function recordPayment(input: { clientId: string; documentId: string; amount: number; date: string; paymentTypeId: number; requestId: string }) {
  return withPin('Registrar pago en Bsale', (pin) => pay({ ...input, pin }));
}
