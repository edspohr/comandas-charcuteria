# ADR-0003 — Un perfil por usuario como custom claim

- **Estado:** Aceptada
- **Fecha:** 19-10-2026

## Contexto

Hacía falta separar lo que ve y hace cada persona sin un sistema de roles combinables, que es difícil de razonar en las reglas de Firestore.

## Decisión

- 8 perfiles, uno por persona: vendedor, tienda, despacho, reparto, produccion, admin, superAdmin, consultor.
- El perfil viaja como *custom claim* `role`; solo `functions/src/users.ts` y `scripts/bootstrap-admin.ts` lo escriben.
- La UI pregunta capacidades (`can(role, 'order.approve')`), nunca nombres de perfil.
- La matriz está en `app/src/domain/permissions.ts`, replicada en `firestore.rules` y `functions/src/common.ts`.

## Consecuencias

- Para que una persona tenga dos funciones, se le da el perfil más amplio (por ejemplo, Lucy en tienda también vende).
- La matriz está triplicada a mano (deuda técnica DT-02).
