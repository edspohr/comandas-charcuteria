# ADR-0012 — Hechos de venta de Bsale comprimidos por mes para el Panel

- **Estado:** Aceptada
- **Fecha:** 19-10-2026

## Contexto

El Panel de gestión necesita 2 años de ventas (~47 mil documentos). Leer documento por documento desde el cliente cuesta mucho y es lento.

## Decisión

- `bsaleFactsBackfill` y la sincronización escriben un documento comprimido por mes (`bsale/facts/months/{AAAA-MM}`), con un índice y costos en `bsale/facts`.
- El Panel descomprime en el navegador: 2 años equivalen a unas 25 lecturas.

## Consecuencias

- El Panel es rápido y barato.
- El margen depende del costo promedio de Bsale; sin costo se muestra «costo no informado».
