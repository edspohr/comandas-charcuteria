# Deuda técnica

Actualizado al 24-10-2026, versión 1.0. Prioridad: **Alta** = riesgo de datos o seguridad, o bloquea un paso del plan · **Media** = costo de mantención o confusión del usuario · **Baja** = higiene.

| ID | Prioridad | Tema | Resumen |
|---|---|---|---|
| DT-01 | Alta | Seguridad | El PIN de acciones en la app no lo exigen las reglas de Firestore |
| DT-02 | Media | Mantención | Matriz de permisos triplicada a mano |
| DT-03 | Media | Consistencia | Reasignación FIFO implementada en cliente y servidor |
| DT-04 | Media | Consistencia | Bitácora de producción no atómica con la recepción en Bsale |
| DT-05 | Alta | Operación | Escrituras apagadas dejan tareas manuales sin cola visible (muestras, traslados, clientes) |
| DT-06 | Media | Producto | Dos definiciones de salud de cliente |
| DT-07 | Alta | Datos | Calidad del dato en Bsale (precios $0, stock absurdo, variantes sin cruce, 119 clientes sin vínculo) |
| DT-08 | Media | Calidad | Sin tests unitarios ni e2e; solo 15 tests de reglas |
| DT-09 | Media | Mantención | Componentes muy grandes |
| DT-10 | Media | Operación | Alertas de errores no configuradas y sin acceso a Cloud Scheduler |
| DT-11 | Alta | Seguridad | `service-account.json` local sin rotar |
| DT-12 | Baja | Correctitud | Fechas con hora local del navegador en algunos cálculos |
| DT-13 | Media | IA | Lectura de foto sin verificar; Gemini no habilitado en staging |
| DT-14 | Baja | UX | Unidades mezcladas en mensajes («u/kg») y totales |
| DT-15 | Baja | Higiene | Restos del modo demo y del historial de WhatsApp |
| DT-16 | Baja | Higiene | Scripts de una sola vez en `scripts/` |

---

### DT-01 · El PIN de acciones en la app no lo exigen las reglas · Alta
En anular, vincular, enviar pedido, cargar producción con Bsale apagado, despachar sin factura y aprobar, la app llama a `verifyPin` y **después** escribe en Firestore. Las reglas no comprueban que hubo un PIN reciente: un cliente modificado podría escribir sin PIN, aunque solo dentro de lo que su perfil ya permite. Las escrituras a Bsale sí verifican el PIN en el servidor.
**Propuesta:** mover estas acciones a Cloud Functions que verifiquen el PIN y escriban, o hacer que `verifyPin` emita un sello de corta duración (`pinProofs/{uid}` con `at` y `action`) que las reglas exijan.

### DT-02 · Matriz de permisos triplicada · Media
`app/src/domain/permissions.ts`, `firestore.rules` (helpers `canPack`, `canSync`…) y `functions/src/common.ts` se mantienen a mano y pueden divergir.
**Propuesta:** generar los helpers de reglas y la lista de perfiles de las funciones desde `permissions.ts` con un script en CI, o al menos un test que compare las tres.

### DT-03 · Reasignación FIFO duplicada · Media
`absorbAllPending` (servidor, modo real) y `absorbPendingForKey` (cliente, modo simulado y sincronización manual) implementan lo mismo. La versión del cliente lee los pedidos candidatos fuera de la transacción.
**Propuesta:** una sola implementación en el servidor; en modo simulado, llamar a la misma función contra el emulador.

### DT-04 · Bitácora de producción no atómica · Media
`loadProduction` primero llama a `bsaleReceiveProduction` y después escribe `productionLog` desde el cliente. Si se corta la conexión entre ambos pasos, Bsale tiene la recepción y Comandas no la muestra. Al revés no pasa, porque la bitácora se escribe al final.
**Propuesta:** que `bsaleReceiveProduction` escriba la bitácora en el servidor (con `bsale/writes/log` como referencia) y que el cliente solo la escriba cuando Bsale está apagado.

### DT-05 · Tareas manuales sin cola visible con las escrituras apagadas · Alta
Con `writesEnabled = false`:
- la producción queda «Por cargar en Bsale», que sí tiene pantalla;
- los consumos de muestras quedan `samplesConsumption.skipped`, sin pantalla;
- los traslados a tienda quedan solo en la app;
- los clientes nuevos quedan «por revisar».

La oficina no tiene una lista única de lo que debe replicar en Bsale.
**Propuesta:** una pantalla «Pendiente en Bsale» para administración que reúna los cuatro tipos y permita marcarlos como hechos. O, mejor, encender las escrituras de a una (ver backlog).

### DT-06 · Dos definiciones de salud de cliente · Media
Clientes, la ficha y el Panel de pedidos usan días fijos sobre los pedidos de Comandas (14/30). El Panel de gestión usa el ritmo propio de cada cliente sobre las ventas de Bsale. Un mismo cliente puede verse «activo» en una pantalla y «en riesgo» en otra. Ver [ADR-0015](adr/0015-salud-de-cliente.md).
**Propuesta:** una función de dominio única, con el ritmo propio cuando haya al menos 3 compras y los días fijos en otro caso, alimentada por ventas de Bsale + pedidos de Comandas.

### DT-07 · Calidad del dato en Bsale · Alta
- Precios en $0 en la lista 8.
- Stock absurdo: 39.899 kg de longaniza, 999.956 de prosciutto.
- Unas 151 variantes activas sin revisar en el cruce.
- 119 clientes del historial de WhatsApp sin `bsaleClientId`, marcados «por revisar».
- Precios por kg guardados como unitarios (sobrasada, untables).

Mientras esto siga, el stock tiene que ser informativo ([ADR-0006](adr/0006-stock-informativo.md)) y el margen del Panel no es confiable.
**Propuesta:** jornada de limpieza con Miguel: precios y stock en Bsale, cruce de variantes en Catálogo y asociación de clientes en Clientes → Por revisar.

### DT-08 · Cobertura de tests · Media
Solo hay 15 tests de reglas. No hay tests unitarios del dominio (`parse/local`, `analytics`, `bsaleAnalytics`, `exceptions`, `delivery`, `samples`) ni de las funciones (`pin.ts`, `invoice.ts`, `sync.ts`), ni e2e. `scripts/verify-*` se corren a mano.
**Propuesta:** vitest para `domain/` y `functions/src/pin.ts` primero; e2e (Playwright) contra staging para el flujo de pedido completo.

### DT-09 · Componentes muy grandes · Media
`NuevoPedido.tsx` (~920 líneas), `orders.ts` (~800), `PanelGestion.tsx` (~670), `Produccion.tsx` (~575), `Tablero.tsx` (~540), `sync.ts` (~500), `OrderDialogs.tsx` (~490).
**Propuesta:** separar los pasos del wizard, dividir `orders.ts` en creación, armado, despacho y facturación, y dividir `OrderDialogs` en un archivo por diálogo. Hacerlo al tocar cada archivo, no como proyecto aparte.

### DT-10 · Alertas y Scheduler · Media
- `scripts/setup-alerts.sh` (correo ante errores de las funciones de Bsale) no se ha corrido.
- La cuenta de servicio no tiene permisos sobre Cloud Scheduler: no se puede forzar la sincronización programada desde la terminal. Hay que esperar el cron o usar «Sincronizar» en la app.

**Propuesta:** correr `bash scripts/setup-alerts.sh <correo>` con una cuenta Owner y dar `roles/cloudscheduler.admin` a quien opere.

### DT-11 · Credenciales locales · Alta
`service-account.json` (Admin SDK de producción) está en la raíz del repo local. Está ignorado por git, pero se ha usado para auditorías y conviene rotarlo.
**Propuesta:** rotar la llave, guardarla fuera del repo (`~/.config/…`) y apuntar `GOOGLE_APPLICATION_CREDENTIALS` a ella. Preferir `gcloud auth application-default login`.

### DT-12 · Zona horaria · Baja
`todayInSantiago()` es correcto, pero algunos cálculos usan `new Date('AAAA-MM-DDT00:00:00')` con la hora local del navegador: «Cargado hoy» en Producción y los días sin pedir en `analytics`. En Chile da lo mismo; fuera de Chile o en cambios de horario puede correrse una hora.
**Propuesta:** helper `startOfDaySantiago()` en `lib/format.ts`.

### DT-13 · IA sin verificar · Media
La lectura de la foto de la planilla no se ha probado con una planilla real. En staging falta «Get started» en AI Logic, así que la IA solo funciona en producción.
**Propuesta:** habilitar AI Logic + App Check en staging (`appcheck:setup` parametrizado por proyecto) y guardar 3–4 fotos reales de planillas como casos de prueba (`scripts/verify-gemini.ts`).

### DT-14 · Unidades mezcladas · Baja
Los mensajes de reasignación dicen «2 u/kg» y algunos totales suman kg y unidades del mismo producto por separado.
**Propuesta:** formatear por unidad de cada línea.

### DT-15 · Restos del modo demo e historial · Baja
- `BsaleConsolaMock.tsx` y `integrations/bsale/mockAdmin.ts` solo sirven en staging o local.
- Los placeholders `users/wa-*` siguen existiendo, ocultos.
- `insights/whatsapp` ya no tiene pantalla.

**Propuesta:** cargar las piezas solo de staging/local de forma dinámica, y borrar los placeholders cuando todos estén fusionados.

### DT-16 · Scripts de una sola vez · Baja
`golive-clean.ts`, `catalog-golive.ts`, `import-whatsapp.ts`, `migrate-claims.ts` y `bsale-load.ts` ya se aplicaron en producción.
**Propuesta:** moverlos a `scripts/archive/` con una nota de cuándo se corrieron, para que no se vuelvan a ejecutar por error.
