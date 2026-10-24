# ADR-0004 — Escrituras a Bsale solo desde Cloud Functions, con bitácora, simulacro y PIN

- **Estado:** Aceptada
- **Fecha:** 18-10-2026

## Contexto

El token de Bsale da acceso total a la contabilidad de la empresa. Un error de la app (cantidad duplicada, cruce equivocado) se traduciría en stock o documentos tributarios incorrectos.

## Decisión

- El token vive en Secret Manager (`BSALE_ACCESS_TOKEN`) y solo lo usan las Cloud Functions.
- Las escrituras se limitan a hechos que nacen en Comandas: recepción de producción, traslado a tienda, consumo de muestras, alta/edición de cliente y emisión de documentos. Nunca ajustes directos de stock.
- Hay dos interruptores en `settings/bsale`: `writesEnabled` (apagado = no se escribe) y `dryRun` (simulacro = se registra el payload sin enviarlo). La facturación tiene su propio interruptor, `invoicesEnabled`.
- Cada intento queda en `bsale/writes/log` y exige el PIN de quien lo hace.
- Si las escrituras están apagadas, la operación no se detiene: el dato queda en Comandas, marcado como pendiente.

## Consecuencias

- La puesta en marcha puede ir de lectura → simulacro → real, una escritura a la vez.
- Mientras estén apagadas, la oficina tiene que replicar en Bsale lo que se hace en Comandas (producción, traslados, muestras, clientes nuevos).
