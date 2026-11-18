import { expect, it } from 'vitest';
import { collectionRows, collectionSummary, filterCollection, daysLate } from '../../app/src/domain/receivables';
import type { ReceivableClient, ReceivableInvoice } from '../../app/src/data/receivables';
const today = '2026-11-18';
const invoice = (id: string, due: string | null, balance = 100, applied = 0): ReceivableInvoice => ({ id, number: id, due, issued: '2026-01-01', balance, applied, total: balance + applied, overdue: false });
const clients: ReceivableClient[] = [
  { id: 'a', name: 'José Alimentos', rut: '1-9', ownerUid: 'seller', error: null, invoices: [invoice('1', '2026-11-17', 200), invoice('2', '2026-08-20', 300, 50), invoice('3', '2026-08-18', 400), invoice('4', today, 100), invoice('5', '2026-11-25', 50), invoice('6', '2026-11-26', 25), invoice('7', null, 10)] },
  { id: 'b', name: 'Cliente B', rut: '', ownerUid: null, error: 'No disponible', invoices: [invoice('8', '2026-01-01', 100000)] },
];
it('agrupa saldos por antigüedad sin perder montos ni incluir clientes fallidos', () => {
  const rows = collectionRows(clients, today);
  const result = collectionSummary(rows, today);
  expect(result.total).toBe(1085);
  expect(result.overdue).toBe(900);
  expect(result.clients).toBe(1);
  expect(result.buckets.map(b => b.total)).toEqual([185, 200, 0, 300, 400]);
  expect(result.buckets.reduce((s, b) => s + b.total, 0)).toBe(result.total);
  expect(result.due7).toBe(150);
});
it('respeta los límites de 90 días y distingue vencimiento de hoy de atraso', () => {
  expect(daysLate('2026-08-20', today)).toBe(90);
  expect(daysLate(today, today)).toBe(0);
  const rows = collectionRows(clients, today);
  expect(filterCollection(rows, 'over90', 'priority', '', today).map(i => i.id)).toEqual(['3']);
  expect(filterCollection(rows, 'partial', 'priority', '', today).map(i => i.id)).toEqual(['2']);
});
it('ordena urgencias y permite buscar sin tildes o por folio', () => {
  const rows = collectionRows(clients, today);
  expect(filterCollection(rows, 'all', 'priority', 'jose', today)[0].id).toBe('3');
  expect(filterCollection(rows, 'all', 'balance', '', today)[0].balance).toBe(400);
  expect(filterCollection(rows, 'all', 'due', '', today).at(-1)?.due).toBeNull();
  expect(filterCollection(rows, 'all', 'priority', '5', today).map(i => i.id)).toEqual(['5']);
});
