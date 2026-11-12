import { describe, expect, it } from 'vitest';
import { sourceAvailable, sourceStock, reserveField, stockForSource } from '../../app/src/domain/stockSource';
import { planLineEdit } from '../../app/src/domain/orderEdit';
import type { StockDoc, OrderLine } from '../../app/src/domain/types';
const stock: StockDoc = { productId: 'coppa', formatId: 'kg', onHand: 10, reserved: 4, storeOnHand: 8, storeReserved: 3 };
describe('reservas independientes por sucursal', () => {
  it('resta reservas del origen elegido y mantiene fábrica para pedidos anteriores', () => {
    expect(sourceAvailable(stock)).toBe(6); expect(sourceAvailable(stock, 'tienda')).toBe(5);
    expect(reserveField()).toBe('reserved'); expect(reserveField('tienda')).toBe('storeReserved');
    expect(sourceAvailable({ ...stock, storeReserved: 12 }, 'tienda')).toBe(0);
    expect(sourceAvailable({ ...stock, storeOnHand: undefined, storeReserved: undefined }, 'tienda')).toBe(0);
  });
  it('la disponibilidad presentada al vendedor coincide con la que se reserva en tienda', () => {
    const all = new Map([['coppa__kg', stock]]);
    expect(stockForSource(all, 'tienda').get('coppa__kg')).toMatchObject({ onHand: 8, reserved: 3 });
    expect(all.get('coppa__kg')).toEqual(stock);
  });
  it('editar libera reservas y reutiliza lo liberado sin aumentar stock de Bsale', () => {
    const line: OrderLine = { productId: 'coppa', productName: 'Coppa', formatId: 'kg', formatLabel: 'Kg', unit: 'kg', qty: 3, reservedQty: 3, pendingProductionQty: 0 };
    const plan = planLineEdit([line], [{ ...line, qty: 1 }], new Map([['coppa__kg', sourceAvailable(stock, 'tienda')]]));
    expect(plan.reserveDelta.get('coppa__kg')).toBe(-2); expect(plan.lines[0].reservedQty).toBe(1);
    expect(sourceStock(stock, 'tienda').onHand).toBe(8);
  });
});
