export function stockDocId(productId, formatId) {
    return `${productId}__${formatId}`;
}
export function available(stock) {
    return stock.onHand - stock.reserved;
}
export const ORDER_STATUS_LABEL = {
    recibido: 'Recibido',
    confirmado: 'Confirmado',
    confirmado_parcial: 'Confirmado parcial',
    en_armado: 'En armado',
    armado: 'Armado',
    facturado: 'Facturado',
    despachado: 'Despachado',
    entregado: 'Entregado',
    anulado: 'Anulado',
};
export const NEXT_STATUS = {
    recibido: ['confirmado', 'confirmado_parcial', 'anulado'],
    confirmado: ['en_armado', 'anulado'],
    confirmado_parcial: ['confirmado', 'en_armado', 'anulado'],
    en_armado: ['armado', 'anulado'],
    armado: ['facturado', 'anulado'],
    facturado: ['despachado'],
    despachado: ['entregado'],
};
