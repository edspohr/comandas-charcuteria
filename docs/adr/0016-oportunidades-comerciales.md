# ADR-0016 — Oportunidades comerciales dentro de Comandas

- **Estado:** Aceptada
- **Fecha:** 03-11-2026

## Contexto

El problema central de los dueños es la gestión comercial. Ciro dirige al equipo de ventas y necesita:
- decidir a quién visitar y asignarlo a un ejecutivo;
- que cada ejecutivo cree sus propias oportunidades;
- ver en qué quedó cada una.

Las muestras ya tenían seguimiento a 7 días y conversión a 60 días, pero solo por cliente. HubSpot se había pausado: la fuerza de ventas iba a vivir dentro de Comandas. Hay un informe de venta cruzada (`tools/oportunidades`) del que Ciro quiere elegir qué clientes trabajar.

## Decisión

- Colección `opportunities/*` ([`domain/opportunities.ts`](../../app/src/domain/opportunities.ts)).
  - **Estados:**
    - abierta;
    - en gestión;
    - postergada, con fecha obligatoria para retomarla;
    - ganada;
    - perdida, con un motivo de una lista fija y un detalle opcional.
  - **Orígenes:** asignada, propia, informe y canal (este último, para los canales de adquisición futuros).
  - Las oportunidades sin ejecutivo forman la bandeja «Sin asignar».
- **Quién hace qué:**
  - el ejecutivo (vendedor o tienda) crea y gestiona las suyas;
  - superAdmin ve todas, asigna, reasigna, gestiona cualquiera y carga el informe;
  - administración y consultor solo leen.
- **Se gana al facturar**, no al crear el pedido. La función `opportunityWonOnInvoice` marca la oportunidad «ganada» cuando un pedido de venta ligado recibe su documento. Las reglas impiden que la app la marque ganada. Los pedidos de muestras (`MU-…`) no ganan.
- **Pedidos y muestras:** se crean desde la oportunidad («Muestras o pedido») o se eligen en el paso Confirmar de Nuevo pedido. `order.opportunityId` liga el pedido, y la misma transacción de `createOrder` agrega la actividad «muestra» o «pedido».
- **Informe:** `scripts/import-oportunidades.ts` sube el resumen a `opportunityCandidates/*`. Ciro elige en Oportunidades → Del informe qué filas cargar y a qué ejecutivo asignarlas.
- **Agenda:** la oportunidad aparece el día de su próxima acción o cuando vuelve de una postergación. Si esa fecha ya pasó, aparece como vencida.

## Consecuencias

- Una nueva capacidad en la matriz (`opportunity.manageOwn/manageAll/viewAll`), replicada en `firestore.rules` (DT-02).
- La actividad se guarda como un arreglo dentro de la oportunidad. Basta para el volumen esperado; si crece, conviene moverla a una subcolección.
- Sin notificaciones push: el ejecutivo ve su agenda al abrir la app.
- Estaba en el backlog fuera de alcance (CRM / fuerza de ventas). El cliente decidió adelantarlo el 03-11.
