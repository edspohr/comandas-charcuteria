# ADR-0013 — Proyecto de staging separado con Bsale simulado

- **Estado:** Aceptada
- **Fecha:** 24-10-2026

## Contexto

Probar en producción con datos reales arriesgaba ensuciar la operación y la contabilidad. Los emuladores no reproducen Auth con custom tokens, Hosting ni el comportamiento de producción.

## Decisión

- Proyecto `comandas-staging` (Firestore nam5, Hosting, Functions) con Bsale simulado (`bsaleMock`), login de demo (`VITE_DEMO_LOGIN`) y seed explícita (`SEED_TARGET=staging`). Alias `staging` en `.firebaserc`.
- La seed se niega a correr contra producción.
- En producción solo se hacen revisiones de datos de solo lectura.

## Consecuencias

- Cada cambio visible se prueba primero en staging (build `--mode staging`).
- Las APIs y la configuración de Gemini/App Check de staging están por completarse.
