import { expect, it } from 'vitest';
import { debtInvoices, ownsReceivable, paymentWritesAllowed, validPayment } from '../../functions/src/bsale/receivableModel';
import { ROUTE_ACCESS } from '../../app/src/domain/permissions';

it('usa el saldo oficial, incluye abonos/ajustes y no suma notas de venta ni duplica documentos', () => {
  const document = { id: 1, name: 'Factura electrónica', number: 30, emissionDate: Date.parse('2026-09-01') / 1000, expirationDate: Date.parse('2026-09-30') / 1000, totalAmount: 10000, totalAmountOwed: 2500 };
  const rows = debtInvoices({ overdue_documents: [document, { ...document, id: 2, name: 'Nota de venta' }], upcoming_documents: [document] }, '2026-11-18');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ balance: 2500, applied: 7500, overdue: true });
  expect(() => debtInvoices({ overdue_documents: [{ ...document, totalAmountOwed: NaN }] }, '2026-11-18')).toThrow();
});
it('los vendedores solo ven su cartera y solo superadmin ve todas', () => {
  expect(ownsReceivable('vendedor', 'a', 'a')).toBe(true);
  expect(ownsReceivable('vendedor', 'a', 'b')).toBe(false);
  expect(ownsReceivable('admin', 'a', 'b')).toBe(false);
  expect(ownsReceivable('superAdmin', 'a', undefined)).toBe(true);
  expect(ROUTE_ACCESS.cuentasPorCobrar('vendedor')).toBe(true);
  expect(ROUTE_ACCESS.cuentasPorCobrar('consultor')).toBe(false);
});
it('la escritura exige activación explícita, conexión activa y simulacro apagado', () => {
  const enabled = { enabled: true, writesEnabled: true, paymentsEnabled: true, dryRun: false };
  expect(paymentWritesAllowed(enabled)).toBe(true);
  expect(paymentWritesAllowed({ ...enabled, paymentsEnabled: undefined })).toBe(false);
  for (const patch of [{ enabled: false }, { writesEnabled: false }, { paymentsEnabled: false }, { dryRun: true }]) expect(paymentWritesAllowed({ ...enabled, ...patch })).toBe(false);
});
it('rechaza sobrepagos, montos no enteros y fechas inválidas o futuras', () => {
  expect(validPayment(2500, 2500, '2026-11-18', '2026-11-18')).toBe(true);
  for (const amount of [0, -1, 2501, 0.5, NaN, '1']) expect(validPayment(amount, 2500, '2026-11-18', '2026-11-18')).toBe(false);
  for (const date of ['2026-02-30', '2026-11-19', '']) expect(validPayment(1, 10, date, '2026-11-18')).toBe(false);
});
