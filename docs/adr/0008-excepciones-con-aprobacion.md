# ADR-0008 — Pedidos con condición especial requieren aprobación de superAdmin

- **Estado:** Aceptada
- **Fecha:** 23-10-2026

## Contexto

Los vendedores negociaban precios, cortes, pagos o entregas especiales por WhatsApp y Ciro se enteraba tarde.

## Decisión

- El vendedor marca la condición especial con su nota, o el sistema la detecta (líneas sobre 25 kg o 60 u). El pedido queda con `approval.status = 'pendiente'`.
- Arriba del Tablero aparece «Pedidos por aprobar». El superAdmin aprueba o rechaza con su PIN, y rechazar anula el pedido con el motivo.
- La regla `canPack` impide armar un pedido pendiente de aprobación.

## Consecuencias

- Ciro pasa a ser un paso del flujo: si no aprueba a tiempo, el pedido se atrasa.
- Los umbrales viven en `app/src/domain/exceptions.ts`.
