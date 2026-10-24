# ADR-0002 — Stock en colección propia y reserva en la misma transacción que el pedido

- **Estado:** Aceptada
- **Fecha:** 09-2026

## Contexto

El brief original guardaba la cantidad en el formato del producto y dejaba editar pedidos confirmados. Eso produce condiciones de carrera entre vendedores y mezcla la bitácora con el estado vigente.

## Decisión

- `stock/{productId__formatId}` con `onHand` (espejo de Bsale) y `reserved` (solo de la app); `available = onHand − reserved`.
- Crear un pedido y reservar sus líneas ocurre en **una transacción**. Lo que no alcanza queda en `pendingProductionQty`.
- Cuando entra stock, `absorbPendingForKey` reasigna lo pendiente **FIFO por fecha de entrega** y promueve el pedido a `confirmado`.
- `stockMovements` es append-only y solo de auditoría.
- El vendedor no edita líneas después de confirmar: anula y crea otro («Repetir último pedido»).

## Consecuencias

- Sin carreras entre vendedores en la reserva.
- La reasignación FIFO está implementada dos veces: en el servidor (`absorbAllPending` en `functions/src/bsale/sync.ts`, modo real) y en el cliente (`absorbPendingForKey`, modo simulado). Ver deuda técnica DT-03.
- Las reservas duplicadas por leer dos veces el mismo documento se corrigieron con `readStocks`/`releaseReserved` (24-10).
