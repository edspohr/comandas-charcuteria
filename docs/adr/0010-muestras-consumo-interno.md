# ADR-0010 — Muestras como consumo interno en Bsale, seguimiento a 7 días y conversión a 60

- **Estado:** Aceptada
- **Fecha:** 19-10-2026

## Contexto

En los pedidos reales aparecía «incluir muestra de X 80 gr» como nota libre: las muestras salían sin registro ni seguimiento.

## Decisión

- La muestra es una línea `sample` a $0, de 80 g por defecto (del granel del producto o el formato más chico). No genera demanda de producción ni entra en la factura.
- Al facturar o con «Registrar salida» (pedidos solo de muestras, `MU-…`), `bsaleConsumeSamples` hace un consumo interno en fábrica. Es idempotente vía `order.samplesConsumption`.
- A los 7 días de la entrega el vendedor responde en `sampleFeedback`.
- Hay conversión si el cliente compra el producto dentro de 60 días. El KPI es kg de muestra por cliente nuevo ganado.

## Consecuencias

- Con las escrituras apagadas, el consumo queda marcado `skipped` y hay que registrarlo en Bsale a mano.
- No hay tope de muestras por vendedor (decisión de negocio).
