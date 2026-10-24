# ADR-0014 — Bitácora de producción en Comandas, independiente de las escrituras a Bsale

- **Estado:** Aceptada
- **Fecha:** 24-10-2026

## Contexto

Con las escrituras a Bsale apagadas, «Registrar producción» fallaba: Producción no podía registrar nada y la oficina no sabía qué cargar.

## Decisión

- Toda carga pasa por `loadProduction`: PIN → recepción en Bsale **solo si** `writesEnabled` → documento en `productionLog` con `bsaleStatus` (`ok`, `simulado`, `por_cargar`, `cargado_manual`).
- Administración marca «Ya la cargué en Bsale» en las cargas `por_cargar`.

## Consecuencias

- Producción trabaja aunque Bsale esté apagado, y queda la historia de lo cargado por persona.
- El stock de la app recién sube cuando la carga llega a Bsale y se sincroniza.
- La bitácora se escribe desde el cliente después de Bsale: no es atómica (deuda técnica DT-04).
