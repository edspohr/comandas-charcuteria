# ADR-0011 — Gemini vía Firebase AI Logic con App Check, e intérprete determinista de respaldo

- **Estado:** Aceptada
- **Fecha:** 23-09-2026

## Contexto

Los vendedores reciben pedidos en texto libre y Producción anota en planillas en papel. Hacía falta interpretar ambos sin montar un backend propio de IA.

## Decisión

- Se usa Firebase AI Logic (`@firebase/ai`, gemini-2.5-flash, *thinking* apagado) desde el cliente, con App Check reCAPTCHA Enterprise exigido solo en AI Logic.
- Si falla, el texto cae a `domain/parse/local.ts` y se avisa «Se usó el intérprete local». La foto no tiene respaldo y se sugiere registrar a mano.
- Toda línea propuesta por la IA se revisa antes de guardar.

## Consecuencias

- Costo de USD 1–2 al mes al volumen actual.
- Cada proyecto (staging incluido) debe habilitar AI Logic en la consola.
- La lectura de la foto de la planilla aún no está verificada con una planilla real.
