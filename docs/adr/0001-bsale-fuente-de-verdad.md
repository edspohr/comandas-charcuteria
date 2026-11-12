# ADR-0001 — Bsale es la fuente de verdad; Comandas es dueño de los pedidos

- **Estado:** Aceptada
- **Fecha:** 18-10-2026

## Contexto

La empresa factura, lleva stock por sucursal y mantiene sus clientes en Bsale. Comandas nace para reemplazar el grupo de WhatsApp de pedidos. Si los dos sistemas fueran dueños del mismo dato, habría que conciliarlos a mano.

## Decisión

- **Bsale** es dueño del catálogo, los precios, los clientes (datos tributarios), el stock por sucursal y los documentos. Comandas guarda **espejos** de solo lectura (`bsale/**`, `stock.onHand`, `clients`).
- **Comandas** es dueño de los pedidos, reservas, estados, responsables, pesos empacados, cartera, horarios de entrega, aprobaciones, muestras y la bitácora de producción.
- Comandas solo escribe en Bsale hechos que nacen en la app (ver [ADR-0004](0004-escrituras-bsale-servidor.md)).

## Consecuencias

- El stock que se ve en la app es el de Bsale con hasta 10 minutos de atraso (sincronización por cron + webhooks).
- Los cambios de precio o de cliente se hacen en Bsale; la app los toma en la siguiente sincronización.
- Solo los cruces de `catalogMap` con estado `confirmado` mueven stock: un producto sin cruce no tiene stock en la app.

## Aclaración del 12-11-2026

La razón social y los datos de contacto se leen de Bsale por separado. El nombre comercial es un dato propio de Comandas cuando la cuenta de Bsale no dispone de un atributo de fantasía; nunca se escribe sobre el contacto. Se sincronizan todos los clientes activos.

Cada pedido elige fábrica o tienda como origen. Las reservas de Comandas se mantienen por separado (`reserved` / `storeReserved`), y no modifican los saldos de Bsale. Al vincular la factura del POS, el servidor valida la sucursal, lee los saldos posteriores a la venta y libera la reserva en una sola transacción. Los pedidos anteriores sin origen explícito corresponden a fábrica.
