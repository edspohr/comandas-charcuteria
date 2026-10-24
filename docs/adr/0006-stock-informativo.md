# ADR-0006 — Stock informativo por defecto

- **Estado:** Aceptada
- **Fecha:** 23-10-2026

## Contexto

El stock de Bsale tiene valores poco confiables (cantidades absurdas, productos sin cruce) y la cámara suele tener más de lo que dice el sistema. Bloquear el armado por stock detendría la operación.

## Decisión

- `settings/app.stockMode` sin valor o `'informativo'`: un faltante **avisa** («Sin stock en Bsale») pero se puede armar con lo que haya en cámara.
- `'estricto'` impide armar sin stock.

## Consecuencias

- Las reservas y la demanda de producción siguen calculándose igual.
- Hay que volver a `estricto` cuando el stock de Bsale sea confiable (ver backlog).
