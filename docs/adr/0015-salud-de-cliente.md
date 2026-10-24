# ADR-0015 — Reglas de salud de cliente (activo, en riesgo, inactivo/perdido)

- **Estado:** Aceptada, con revisión pendiente
- **Fecha:** 19-10-2026

## Contexto

Los dueños quieren saber qué clientes dejaron de comprar. Hay dos fuentes: los pedidos de Comandas (historia corta) y las ventas de Bsale (2 años).

## Decisión

- **Clientes, ficha y Panel de pedidos** (pedidos de Comandas, días desde el último pedido tomado):
  - activo ≤ 14 días;
  - en riesgo 15–30 días;
  - inactivo > 30 días;
  - nuevo = primer pedido en los últimos 90 días y como máximo 2 pedidos.

  Los umbrales se configuran en `settings/app.clientHealth`.
- **Panel de gestión → Clientes** (ventas de Bsale, ritmo propio = promedio de días entre compras, 30 si solo compró una vez):
  - en riesgo > máx(21, 1,5 × ritmo);
  - perdido > máx(60, 3 × ritmo), o compró en el período anterior y no en el actual;
  - nuevo = primera compra dentro del período.

## Consecuencias

- Un mismo cliente puede aparecer con estados distintos en cada pantalla (deuda técnica DT-06). Propuesta: unificar con el ritmo propio cuando haya historia suficiente en Comandas.
