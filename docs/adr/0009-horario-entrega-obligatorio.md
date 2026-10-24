# ADR-0009 — Horario de entrega desde–hasta obligatorio

- **Estado:** Aceptada
- **Fecha:** 23-10-2026

## Contexto

Despacho y reparto no sabían a qué hora recibe cada cliente, y los pedidos se armaban sin un orden útil.

## Decisión

- Todo pedido lleva `deliveryWindow {from, to, note}` validado (`from < to`). El último horario queda como habitual del cliente.
- Las columnas del Tablero y la pantalla de Producción ordenan por fecha + hora de entrega.
- El nombre de fantasía es opcional; el vendedor solo puede completarlo si el cliente no lo tiene.

## Consecuencias

- Un paso más para el vendedor, que se compensa con los horarios rápidos y el habitual del cliente.
