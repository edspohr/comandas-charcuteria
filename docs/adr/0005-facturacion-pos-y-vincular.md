# ADR-0005 — Semana 1: facturar en el POS de Bsale y vincular en Comandas

- **Estado:** Aceptada
- **Fecha:** 23-10-2026

## Contexto

La emisión desde Comandas está construida, pero emitir documentos tributarios es lo más riesgoso de la integración y el equipo ya sabe usar el POS.

## Decisión

- Administración emite en el POS con los pesos del armado y en Comandas toca **Facturar → vincular** (sugiere el documento por referencia o número). Al vincular se liberan las reservas.
- `invoicesEnabled` queda apagado. SuperAdmin puede despachar sin factura y facturar después de entregar (`order.invoiceLate`).

## Consecuencias

- Hay doble trabajo en la oficina, pero sin riesgo tributario.
- Encender la emisión desde Comandas es una decisión aparte, posterior a una semana estable.
