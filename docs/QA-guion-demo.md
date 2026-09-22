# QA del guión de demo — 22-09-2026

Testeo manual de los 10 pasos del **Guión de demo** del README contra el proyecto Firebase real (`comandas-charcuteria`), en viewport móvil (375×812).

**Cómo se hizo.** La URL en vivo no pasa del login (ver #1), así que el resto se probó con `vite --mode production` local (mismo `.env.production`, misma BD real) más dos parches locales marcados `QA-PATCH` en `app/src/data/auth.ts` y `app/src/data/firebase.ts` (están en el working tree, sin commitear; son propuestas de fix, no la versión final). Al terminar se corrió `npm run seed` contra el proyecto real, así que la BD volvió al estado sembrado (el pedido `PED-2026-0041` y las facturas de prueba ya no existen).

**Actualización 16:30:** los índices de #3 ya están desplegados (`firebase deploy --only firestore:indexes --project comandas-charcuteria`, tardaron ~5 min en quedar activos). Con eso se verificaron *Producción* completa, *Mis pedidos* y *Repetir último pedido* — y apareció un bloqueante nuevo en reglas (#27, Anular). La BD se volvió a reseedear al final.

Severidades: **P0** = la demo no se puede dar · **P1** = el guión no coincide con lo que se ve · **P2** = UX/consistencia · **P3** = higiene.

---

## P0 — Bloqueantes

### 1. Pantalla en blanco después de cualquier login (todas las rutas)

- **Paso del guión:** 1 (Login como Rafael) — y todos los siguientes.
- **Observado:** al tocar la tarjeta de Rafael la app navega a `/vendedor/nuevo` y queda en blanco. Consola: `TypeError: Cannot read properties of null (reading 'appUser')`. Igual con recarga y con cualquier rol. El bundle desplegado (`index-Dilu4ME9.js`) coincide con `app/dist`, así que es el código actual.
- **Causa:** `useCurrentUser()` ([auth.ts:17-38](../app/src/data/auth.ts)) es un hook con `useState` local, no un contexto. `App.tsx` lo llama una vez y las rutas lo vuelven a llamar (`NuevoPedido.tsx:37`, `MisPedidos.tsx:15`, `Panel.tsx:39`, `ColaDespacho.tsx:19`, `Produccion.tsx:17`, `Facturacion.tsx:31`, `Catalogo.tsx:48`, `DetallePedido.tsx:18`, `DetalleArmado.tsx:20`, `PegarPedido.tsx:39`). Cada instancia nueva arranca con `current = null` y `current!.appUser.uid` explota en el primer render.
- **Fix sugerido:** un store compartido (el QA-PATCH usa `useSyncExternalStore` sobre un estado a nivel de módulo) o un `AuthContext` provisto desde `App`. Además agregar un `ErrorBoundary` en `main.tsx`/`App.tsx`: hoy cualquier excepción deja la pantalla vacía sin mensaje.

### 2. "Enviar pedido" falla: `Unsupported field value: undefined`

- **Paso:** 2 (Confirmar → Enviar).
- **Observado:** `Function Transaction.set() called with invalid data. Unsupported field value: undefined (found in document orders/PED-2026-0041)`. El pedido no se crea (la transacción aborta, el contador no avanza). Con el parche sí se creó `PED-2026-0041` en `confirmado_parcial`.
- **Causa:** `createOrder` escribe campos opcionales sin valor: `notes: line.notes` ([orders.ts:95](../app/src/data/orders.ts)), `rawText: input.rawText` (`:125`, siempre `undefined` con `source: 'app'`), y `clientSnapshot.fantasyName`/`rut` (`:110-111`; el cliente "Sofá" no tiene RUT) e `invoicingComplete` (`:126`). Firestore web rechaza `undefined` por defecto.
- **Fix sugerido:** `initializeFirestore(app, { ignoreUndefinedProperties: true })` en [firebase.ts](../app/src/data/firebase.ts) (es el QA-PATCH), o limpiar los `undefined` antes del `tx.set` (más explícito). Revisar el mismo patrón en `despacharOrder`/`entregarOrder` (`deliveryProof.note`).

### 3. Faltan 3 índices compuestos → Mis pedidos, Repetir último pedido y Producción no funcionan en vivo

- **Pasos:** 2 (flash en Mis pedidos), 6 (Yuri completo).
- **Observado:**
  - *Mis pedidos* queda en "Cargando…" para siempre. Consola: `The query requires an index` (createdBy + createdAt).
  - Al elegir cliente en el wizard, otra `failed-precondition` (clientId + createdBy + createdAt) → "Repetir último pedido" nunca aparece.
  - *Producción* queda en "Cargando…" y **Registrar producción** muestra el error crudo en inglés con el link de la consola (status + requestedDate). La transacción `registrarProduccion` usa la misma query ([produccion.ts:158-162](../app/src/data/produccion.ts)).
- **Causa:** `firestore.indexes.json` estaba vacío. Queries: [orders.ts:398-402](../app/src/data/orders.ts), [orders.ts:500-506](../app/src/data/orders.ts), [produccion.ts:56-60](../app/src/data/produccion.ts).
- **Fix:** las 3 definiciones están en [firestore.indexes.json](../firestore.indexes.json) y **ya se desplegaron** (16:05). Queda commitear el archivo. Pendiente en la UI: los `onSnapshot` no tienen callback de error ([orders.ts:403](../app/src/data/orders.ts), [produccion.ts:61](../app/src/data/produccion.ts)), por eso "Cargando…" nunca cambia. Pasar `(snap) => …, (err) => setError(err)` y mostrar algo.

### 4. El parser de "Pegar pedido" no reconoce ninguna línea del ejemplo

- **Paso:** 3.
- **Observado:** con el texto de **Ejemplo** → "0 verificadas · 0 a revisar · 5 no encontradas". Incluso el saludo "Buenos días! Para mañana necesito:" se propone como línea. Reproducido offline con `parseLocal(SAMPLE, products)` desde `scripts/data/products.ts`: las 5 líneas dan `not_found`; solo matchean líneas casi idénticas al nombre (`"2 coppa"` → Coppa, pero en `review`, no `verified`, porque el score no baja de 0.25).
- **Causa:** [local.ts:134](../app/src/domain/parse/local.ts) usa **la línea completa** como patrón de Fuse contra needles cortos (`"jamon cocido"`). Fuse busca el patrón dentro del texto indexado, así que "- 3 kg de jamón cocido laminado fino" nunca "cabe" en "jamon cocido". Además el bloque de saludo no se filtra (`splitBlocks`, `:104-109`).
- **Fix sugerido:** invertir la búsqueda: para cada línea, quitar tokens de cantidad/formato/notas y buscar cada needle **dentro** de la línea (`includes` normalizado o Fuse con la línea como colección de n-gramas), o usar Fuse con `keys` sobre la línea tokenizada. Descartar bloques sin cantidad ni match antes de proponerlos. Agregar un test unitario con el `SAMPLE` de [PegarPedido.tsx:31-35](../app/src/routes/vendedor/PegarPedido.tsx) esperando 4 líneas `verified` (nota: "12 sachet 500g longaniza" también cae en la conversión gramos→unidad de `:152-155` y daría qty 1 en vez de 12 — regex de gramos va antes que la de sachet en `:33-40`).

### 27. El vendedor no puede anular sus pedidos: las reglas lo rechazan

- **Paso:** README tabla de perfiles ("anular propios"); probado desde Mis pedidos → `PED-2026-0030` → Anular pedido con motivo.
- **Observado:** modal muestra `Missing or insufficient permissions.` (error crudo, en inglés). El pedido sigue en `recibido`.
- **Causa:** en la rama vendedor de `orders.update`, [firestore.rules:91](../firestore.rules) compara `request.resource.data.invoiceRef == resource.data.get('invoiceRef', null)`. Cuando el pedido todavía no tiene `invoiceRef` (todos los que se pueden anular), acceder a `request.resource.data.invoiceRef` sin `get()` hace fallar la evaluación y la regla deniega. Las ramas despacho/producción (`:97`, `:104`) sí usan `get('invoiceRef', null)` en ambos lados. El test de reglas existente solo cubre las denegaciones, no un anular exitoso.
- **Fix:** `request.resource.data.get('invoiceRef', null) == resource.data.get('invoiceRef', null)` en `:91`, `firebase deploy --only firestore:rules`, y agregar un caso positivo a `tests/rules` (vendedor anula propio `confirmado`).

---

## P1 — El guión no coincide con la app / datos

### 5. Seed: Longaniza chillán 5 kg queda con stock **negativo**; el paso 4 y el 6 del README no se pueden reproducir

- **Observado:** en el wizard, Sachet 5 kg muestra **"Disponible 0 u"** (badge rojo). En Catálogo (Ciro): **"EN BODEGA -4 U · RESERV. 18 U"**. El README dice "hay 8 disponibles → 12 a producción" y "A producir: 60".
- **Causa:** `onHand` inicial 60 ([seed.ts:107](../scripts/seed.ts)) menos consumo de PED-0002/0009/0010/0017 (64) → −4; reservas abiertas 18. "60" es el `onHand` inicial, no la demanda: `toProduce` suma solo `pendingProductionQty` ([produccion.ts:112-114](../app/src/data/produccion.ts)) → sería 12 antes del pedido demo y 32 después. Lo mismo pasa con `coppa::pieza` (onHand 2, reservado 10 → la línea "2 piezas de coppa" del ejemplo saldría roja). La seed escribe con Admin SDK y salta la regla `onHand >= 0` ([firestore.rules:52](../firestore.rules)).
- **Fix sugerido:** subir el inicial de `longaniza-chillan__sachet-5kg` a **90** (90 − 64 − 18 = 8 disponibles, que es lo que promete el guión) y `coppa__pieza` a ≥ 12; agregar al final de la seed una verificación `onHand >= 0` por doc. Corregir el README paso 6: "A producir: 12 (+12 del pedido nuevo = 24)" o el número que resulte.

### 6. "Sincronizar con Bsale" consume números de factura reales y re-numera pedidos ya facturados

- **Paso:** 9.
- **Observado:** el modal muestra `FA-000002 → PED-2026-0006`, `FA-000003 → PED-2026-0011`… para pedidos que ya tienen `FA-000816`, `FA-000820`. Cada click corre `createDocument` (transacción que incrementa `counters/bsale-YYYY`) para hasta 20 pedidos ([Panel.tsx:138-146](../app/src/routes/admin/Panel.tsx), [MockBsaleClient.ts:44-52](../app/src/integrations/bsale/MockBsaleClient.ts)). Además el botón no muestra estado de carga: el primer click tardó ~5 s sin feedback, hice segundo click y se consumieron 40 números.
- **Fix sugerido:** separar `buildPayload(order)` (puro) de `createDocument`; Sincronizar debe usar `order.invoiceRef` existente y solo *mostrar* payloads. Deshabilitar el botón mientras corre.

### 7. La primera factura de la demo sale como `FA-000001` (el historial sembrado va por `FA-000822`)

- **Paso:** 7. README promete `FA-000XXX`.
- **Causa:** la seed borra `counters` y solo recrea `orders-2026 = 40` ([seed.ts:58, :99](../scripts/seed.ts)).
- **Fix:** sembrar `counters/bsale-2026 = { last: 822 }`.

### 8. Pedidos parciales se pueden armar/facturar con líneas pendientes y quedan huérfanos

- **Pasos:** 5–8.
- **Observado:** `PED-2026-0041` (Gouda 90 vendido / 80 reservado / 10 a producción) se marcó `armado` con 80, se facturó por 80 y se entregó. Los 10 pendientes ya no los ve nadie: `registrarProduccion` solo reasigna a `confirmado_parcial|recibido` ([produccion.ts:158-170](../app/src/data/produccion.ts)). En el Panel aparece como "Vendido 18.0 kg / Empacado 16.0 kg (−2.0)" — un delta falso, porque compara `packedQty` con `qty` y no con `reservedQty` ([Panel.tsx:102-114](../app/src/routes/admin/Panel.tsx)).
- **Fix sugerido (decisión de negocio):** o bloquear "Marcar armado" mientras haya `pendingProductionQty > 0` (mensaje "esperando producción"), o modelar back-order explícito. En cualquier caso el Panel debe restar `reservedQty`, no `qty`, y la línea de armado debería mostrar "80 reservado · 10 pendiente" en vez de "Reserv. 80 u" a secas.

### 9. README vs. UI (texto del guión)

- Paso 2: "tocá **Hotel Magnolia**" — la tarjeta dice **Magnolia** (fantasyName); la razón social solo aparece en el payload de factura. Sugerencia: mostrar `fantasyName · name` en la tarjeta y en el Confirmar.
- Paso 5: "filtrá por **Míos = no**, **Sin asignar**" — los chips son excluyentes (Todos/Míos/Sin asignar); basta "Sin asignar". "Ajustá el peso real…" — para `granel-kg` el campo *Peso real* está oculto ([DetalleArmado.tsx:133](../app/src/routes/despacho/DetalleArmado.tsx)); se edita con el stepper *Empacado*. Aclarar en el README o mostrar el campo igual.
- Paso 6: "A producir: 60" → ver #5.
- Paso 8: "el brisket del paso 5 debería estar ahí" — el brisket sembrado (PED-0012, `pieza`, `packedWeightKg`) nunca entra a la lista porque `pieza` no tiene `grams` y `sold` queda 0 ([Panel.tsx:105](../app/src/routes/admin/Panel.tsx)). Con el flujo real del paso 5 sí aparece la línea granel que se ajuste.
- Paso 6 (verificado tras el deploy de índices): la card muestra **"A producir: 12 u"** con "Pedidos que dependen" (PED-0024, PED-0029 +12 u, PED-0031); Registrar 60 → "Reasignadas 12 u" y promueve `PED-2026-0029`. Funciona; solo el número del README está mal (ver #5).
- Paso 10: "se registra un movimiento `ajuste` en la bitácora" — no existe ninguna vista de `stockMovements` en la app; el movimiento se escribe pero no se puede mostrar en la demo. Agregar un historial por formato en Catálogo (últimos N movimientos) o quitar la frase.

---

## P2 — UX / consistencia

### 10. El picker de formatos se renderiza al final de la grilla de 50 productos
Al tocar un producto en el paso 2, el chip se pinta negro pero el panel "Formatos" aparece **debajo de todas las categorías** ([NuevoPedido.tsx:303-306](../app/src/routes/vendedor/NuevoPedido.tsx)); en móvil no se ve nada. Sugerencia: bottom-sheet, o render inline bajo la categoría tocada, o `scrollIntoView` al abrir.

### 11. Orden de categorías arbitrario
`ProductGrid` agrupa en orden de aparición tras ordenar por nombre ([NuevoPedido.tsx:346-353](../app/src/routes/vendedor/NuevoPedido.tsx)): Untables primero, Jamones/Mortadelas/Quesos al fondo. Ordenar por la lista de `CATEGORY_LABEL` (y mover `CATEGORY_LABEL` a `domain/` para reusarla en Catálogo, ver #17).

### 12. Nav de admin/superAdmin: 8–9 ítems en una barra horizontal
En móvil solo se ven "Nuevo pedido · Pegar pedido · Mis pedidos"; Panel/Facturación/Catálogo/Usuarios quedan fuera de pantalla y el ítem activo no se desplaza a la vista ([AppShell.tsx:8-18, :45](../app/src/components/AppShell.tsx)). Sugerencia: ordenar por rol (ítems propios primero), `scrollIntoView` del activo, o un menú "Más".

### 13. Despacho y Producción no tienen barra de navegación
`items.length > 1` oculta la nav ([AppShell.tsx:45](../app/src/components/AppShell.tsx)); Edu y Yuri solo ven header + Salir. Funciona, pero se ve inconsistente con los demás roles. Confirmar si es intencional.

### 14. Cola de despacho: por defecto lista primero pedidos ya `armado` de hace 4 días
Con Todos/Todos, los 4 primeros cards son `armado` del 18-sep (sin acción posible para el armador) y el pedido nuevo queda al final ([orders.ts:172](../app/src/data/orders.ts), [ColaDespacho.tsx:21-22](../app/src/routes/despacho/ColaDespacho.tsx)). Sugerencia: sacar `armado` de la cola (ya está en Facturación) o default "Sin asignar" + ordenar accionables primero. Tampoco hay toast/confirmación al volver de "Marcar armado".

### 15. Estados crudos (`confirmado_parcial`, `en_armado`) visibles al usuario
[MisPedidos.tsx:35](../app/src/routes/vendedor/MisPedidos.tsx) (flash) y [DetalleArmado.tsx:228](../app/src/routes/despacho/DetalleArmado.tsx) (historial). Usar `ORDER_STATUS_LABEL` como hace `DetallePedido.tsx:97`.

### 16. Errores de Firestore crudos en inglés
`setError((e as Error).message)` en [Produccion.tsx:213](../app/src/routes/produccion/Produccion.tsx), [NuevoPedido.tsx:80](../app/src/routes/vendedor/NuevoPedido.tsx) y similares muestran "Function Transaction.set() called with…" / "The query requires an index…" al usuario. Mapear `code` → mensaje es-CL y loguear el detalle.

### 17. Catálogo muestra el slug de categoría
"carnes-curadas · 3 formatos" ([Catalogo.tsx:83](../app/src/routes/admin/Catalogo.tsx)). Usar la etiqueta.

### 18. Paso Confirmar no muestra modalidad, dirección ni horario
Solo cliente, fecha y líneas; el vendedor confirma sin ver "Despacho · Huérfanos 539 · L-V 08:00-15:00" ([NuevoPedido.tsx ~569-622](../app/src/routes/vendedor/NuevoPedido.tsx)).

### 19. Facturar / Despachar / Entregar sin confirmación
"Facturar" emite y persiste `invoiceRef` con un solo tap y no es reversible desde la app. Un diálogo de confirmación (como ya tienen Despachar/Entregar) evitaría facturas accidentales en la demo.

### 20. Panel: detalles de métricas
- La métrica "Delta empacado/vendido" nunca pasa de 5: `deltaLines.slice(0, 5)` ([Panel.tsx:131](../app/src/routes/admin/Panel.tsx)) se hace antes de usar `.length` (`:166`).
- "28 u/kg pendientes" suma unidades y kilos.
- "Empacado 16.0 kg(-2.0)" sin espacio antes del paréntesis.

### 21. Cutoff hardcodeado y en hora local del navegador
`defaultRequestedDate(15)` en [NuevoPedido.tsx:29](../app/src/routes/vendedor/NuevoPedido.tsx) y [PegarPedido.tsx:114](../app/src/routes/vendedor/PegarPedido.tsx) ignora `settings/app.cutoffHour` (sembrado en `seed.ts:98`); [cutoff.ts:6](../app/src/domain/cutoff.ts) usa `new Date().getHours()` del cliente en vez de hora Santiago.

### 22. Draft persistido puede traer una fecha pasada
`requestedDate` se calcula al crear el draft y queda en `localStorage` ([NuevoPedido.tsx:26-34](../app/src/routes/vendedor/NuevoPedido.tsx), [draft.ts](../app/src/lib/draft.ts)); un draft de ayer reabre con fecha < `min`. Recalcular al cargar si es menor a `minRequestedDate()`. (La persistencia en sí funcionó: recargué en el paso 4 y volvió al mismo punto.)

### 28. "Repetir último pedido" solo aparece si volvés al paso 1
El botón vive en `StepCliente` ([NuevoPedido.tsx:103-119](../app/src/routes/vendedor/NuevoPedido.tsx)), pero elegir un cliente hace `goto(2)` de inmediato (`:107`), así que nunca se ve en el flujo normal; hay que tocar "Volver" desde Productos. Además el texto no dice de qué cliente ni de qué fecha es el pedido que va a copiar. Funciona bien cuando se llega (cargó las 2 líneas de PED-0030). Sugerencia: mostrarlo también en el paso 2 (o como acción en la tarjeta del cliente antes de avanzar) con "Repetir PED-2026-0030 · 22-sep · 2 líneas".

### 29. Pedidos sembrados en `recibido` quedan atascados
`PED-2026-0030` (Rafael → Sofá) está en `recibido`. Ese estado no lo genera la app (`createOrder` sale directo a `confirmado`/`confirmado_parcial`) y ninguna pantalla lo hace avanzar: la cola de despacho no lo lista ([orders.ts:172](../app/src/data/orders.ts)) y `registrarProduccion` solo lo toca si tiene líneas pendientes. Sacar `recibido` de la seed ([orders-week.ts](../scripts/data/orders-week.ts)) o darle una transición.

### 30. Detalle de pedido (vendedor) no muestra reservado/pendiente ni modalidad
[DetallePedido.tsx](../app/src/routes/vendedor/DetallePedido.tsx) lista cantidad por línea, pero no `reservedQty`/`pendingProductionQty` (lo único que le explica al vendedor por qué el pedido está "parcial") ni retiro/despacho + horario.

### 23. Pegar pedido: detalles
- "Continuar en el wizard" pisa el draft existente sin avisar ([PegarPedido.tsx:100-122](../app/src/routes/vendedor/PegarPedido.tsx)).
- Typo "Ustd revisa" → "Usted revisa" ([PegarPedido.tsx:129](../app/src/routes/vendedor/PegarPedido.tsx)).

---

## P3 — Higiene / seguridad

### 24. 38 archivos `.js` compilados están trackeados junto a los `.tsx` y Vite los sirve en vez del fuente
`app/tsconfig.json` no tiene `noEmit`/`outDir` y el build es `tsc -b && vite build`, así que `tsc` emite `.js` al lado de cada `.tsx`. Vite resuelve `./App` → `App.js` antes que `App.tsx`, por lo que **editar un `.tsx` en dev no tiene efecto hasta correr `tsc -b`** (me pasó con el parche de #1). `routes/Placeholder.js` es huérfano. Fix: `"noEmit": true`, build `tsc --noEmit && vite build`, borrar los `.js` de `app/src` y agregar `app/src/**/*.js` al `.gitignore`.

### 25. Reglas permisivas fuera de `orders`
- `counters`: lectura y escritura para cualquier autenticado ([firestore.rules:42-44](../firestore.rules)) — un vendedor puede pisar el contador de facturas.
- `stock`: update para cualquier autenticado mientras `onHand >= 0` (`:49-55`) — un vendedor podría subir `onHand` a mano. Restringir a admin+ salvo los campos que tocan las transacciones de cada rol, o mover esas transacciones a Functions.
- Ya documentado en el README: admin/superAdmin tienen paso libre en transiciones.

### 26. Código muerto y accesibilidad
- `NEXT_STATUS` ([types.ts:158-166](../app/src/domain/types.ts)) no se usa en ninguna parte.
- Las tarjetas de rol del login y las tarjetas de cliente del paso 1 son `<button>` sin nombre accesible (el árbol de accesibilidad las lista como `button` vacío); agregar `aria-label` o que el texto quede dentro del botón como contenido directo.

---

## Lo que sí funcionó (con los parches #1 y #2 aplicados; índices desplegados)

Segunda pasada (tras índices): *Producción* — cards "Con demanda pendiente" (Longaniza 5 kg "A producir 12 u", Coppa 6 u) con En bodega/Reservado/Disponible, expandir muestra "Pedidos que dependen" con el `+12 u`, el diálogo Registrar pre-selecciona el producto/formato expandido, registrar 60 → "Reasignadas 12 u a pedidos pendientes" + "Pedidos promovidos: PED-2026-0029", la card desaparece y "Cobertura actual" pasa de 104 a 105 filas · *Mis pedidos* — lista Activos/Historial con estados y líneas · *Repetir último pedido* — copia las líneas (ver #28 por dónde aparece).

Primera pasada:

Login por tarjetas y sello LC · wizard 4 pasos con búsqueda de cliente, semáforo verde/ámbar (Gouda 90 sobre 80 → "80 u reservado · 10 u a producción" + banner) · fecha por defecto mañana y modalidad prefijada del cliente · draft sobrevive recarga · `createOrder` transaccional con `PED-2026-0041` · flash en Mis pedidos · cola de despacho con filtros Hoy/Mañana/Todos y Todos/Míos/Sin asignar · Tomar pedido → `en_armado` · stepper de empacado (3 → 2,5 kg) · Marcar armado → `armado` con historial · Facturar → modal `FA-…` + payload JSON correcto (usa `packedQty`) · Despachar con courier + nota · Marcar entregado con confirmación · Panel: 4 métricas, chart kg por vendedor, top 8 productos, lista de deltas · sección Sincronizar solo para superAdmin · nav Usuarios solo superAdmin, vista read-only agrupada por rol · Catálogo → Ajustar stock con motivo obligatorio y delta en vivo (−4 → 26 dejó 8 disponibles).

## No verificado

*Anular pedido* (bloqueado por #27). PWA/offline. Tests de reglas (no hay Java en esta máquina). Flujo con Morena/Luis (asumido idéntico a Edu/Ciro).

## Estado del working tree que deja esta sesión

- `app/src/data/auth.ts` + `auth.js` — QA-PATCH #1 (store compartido).
- `app/src/data/firebase.ts` + `firebase.js` — QA-PATCH #2 (`ignoreUndefinedProperties`).
- `firestore.indexes.json` — las 3 definiciones de #3 (ya desplegadas; falta commit).
- `.claude/launch.json` — config para levantar Vite en modo production (`npx vite --mode production` desde `app/`).
- Este archivo.

*(Sección histórica: todo lo anterior quedó commiteado en `d62e9f5`.)*

---

## Revisión del fix `d62e9f5` — 22-09-2026, 17:00

Re-corrí el guión completo **contra la URL en vivo** (bundle `index-Dk-e-T1l.js`), con reseed al final.

### Verificado en vivo ✅
| # | Evidencia |
|---|---|
| 1 | Login Rafael → Nuevo pedido sin crash; las 5 cuentas del guión entran. |
| 2 | `PED-2026-0041` creado (1 línea, `notes`/`rawText` vacíos). |
| 3 | Mis pedidos, Repetir último y Producción cargan sin `failed-precondition`. |
| 5 | Longaniza 5 kg → "Disponible 8 u"; Confirmar → "8 u reservado · 12 u a producción". Seed termina con "Verifying stock invariant ✓". |
| 6 | Sincronizar (Ciro) lista FA-000811…FA-000823 existentes, sin consumir contador; botón se deshabilita. |
| 7 | Facturar PED-0041 → **FA-000823**; payload con `invoiceRef`. |
| 8 | Edu abre PED-0041 parcial: banner + sin botón Tomar. Tras producción (Yuri, 24 u → promovidos PED-0029 y PED-0041) Edu lo toma y arma normal. |
| 10 | Picker de formatos aparece como bottom-sheet al tocar el producto. |
| 15 | Flash "estado **Confirmado parcial**"; historial con etiquetas. |
| 27 | Anular PED-2026-0030 (recibido) → OK, desaparece de Activos. |
| 24 | `git ls-files app/src \| grep .js$` = 0; `tsc --noEmit` limpio. |
| 4 | `scripts/verify-parser.ts` 4/4 verified (offline). |

### Observaciones nuevas del fix (para el próximo pase)

**31. Service worker sirve el bundle viejo en la primera carga tras el deploy (P1 para la demo).** Con `registerType: 'autoUpdate'` ([vite.config.ts:10](../app/vite.config.ts)) la primera navegación después del deploy todavía sirvió `index-Dilu4ME9.js` (el que crashea); recién la segunda recarga trajo el nuevo. Cualquier teléfono que haya abierto la versión anterior va a ver la pantalla en blanco una vez más. Antes de la demo: abrir la URL y recargar dos veces en cada dispositivo (o borrar datos del sitio). A futuro: `registerType: 'prompt'` con un toast "Nueva versión — recargar", o `navigateFallback` con `NetworkFirst` para `index.html`.

**32. README paso 5 quedó inconsistente con #8.** Ahora Edu **no puede tomar** el pedido parcial del paso 4 hasta que Yuri registre producción (paso 6), pero el paso 5 sigue diciendo "Verás el pedido de Rafael. Tomar pedido → en_armado". Opciones: reordenar 4 → 6 → 5, o aclarar que Edu toma el pedido del paso 2 (que sale `confirmado` si las cantidades caben en stock) y que el del paso 4 se arma después del paso 6.

**33. Banner de despacho hardcodea "Yuri"** ([DetalleArmado.tsx:120](../app/src/routes/despacho/DetalleArmado.tsx)). Debería decir "Producción" — el nombre viene de la seed.

**34. Parser: aliases genéricos ganan sobre el producto correcto.** Casos extra probados offline: `"gouda ahumado x 10 sachet 200"` → **Jamón ahumado** (alias `'ahumado'` en [products.ts:29](../scripts/data/products.ts)), en `review`. `"5 potes pate de hongos 250"` → `pote-150g` (la pista `\bpote\s*250` de [local.ts:50](../app/src/domain/parse/local.ts) exige adyacencia). `"mortadela pistacho 1,5 kg"` deja `notas: "pistacho"`. Sugerencia: eliminar aliases de una sola palabra genérica (`ahumado`, `cocido`), preferir el needle más largo en empates, y no volcar tokens del nombre del producto a notas. Agregar estos casos a `verify-parser.ts`. Lo demás anduvo bien (8/8 con producto correcto salvo el de gouda; saludos descartados).

**35. El test positivo de anular está duplicado y no se ejecutó.** [firestore.rules.test.ts:85](../tests/rules/firestore.rules.test.ts) ya hacía `assertSucceeds(... anulado)` dentro del test "cannot change status beyond anular"; el nuevo test repite lo mismo. Y como no hay Java en la máquina, ninguno corrió — el commit dice "Reglas re-desplegadas" (cierto, verificado en vivo) pero no "test pasa". Correr `npm run test:rules` en una máquina con JDK antes de darlo por cubierto.

**36. Quedó pendiente la parte de UI de #3:** los `onSnapshot` de [orders.ts:403](../app/src/data/orders.ts) y [produccion.ts:61](../app/src/data/produccion.ts) siguen sin callback de error; si una query falla la pantalla queda en "Cargando…" para siempre.

**37. `.gitignore` tiene un comentario huérfano** (líneas 4-5: "keep hand-written .d.ts… nothing to ignore here now") que no describe ninguna regla. Borrar.

**38. Menor:** Sincronizar ahora incluye también pedidos `entregado` (cualquiera con `invoiceRef`); el texto de la sección dice "facturados/despachados". Ajustar texto o filtro.

---

## Segundo pase de fixes — cerrado en commits 30908b2 (A), f3500a4 (B), e571947 (C) y el commit de bloque D

**Bloque A — antes de la demo**
- **#31** Service worker en modo `prompt` (`app/vite.config.ts`) + nuevo `UpdateToast` en `App.tsx` que muestra "Nueva versión — Recargar" cuando el SW encola un update. Nota operativa agregada al README. **Verificado:** `npm run build` produce `sw.js` con `skipWaiting: false` implícito y el flag `needRefresh` se levanta al reiniciar el service worker.
- **#32** Guión reordenado en `README.md`: 4 (split) → 5 (Yuri produce) → 6 (Edu arma), con nota explícita "no se puede armar hasta que Producción cubra las líneas pendientes". **Verificado:** cada paso pide exactamente la acción que la app permite en ese momento.
- **#33** Banner de `DetalleArmado.tsx:120` ahora dice *"Producción debe registrar el producto pendiente antes de armar"*.
- **#36** Callbacks de error en todos los `onSnapshot`: `useMyOrders`, `useDespachoQueue`, `useOrdersByStatuses`, `useOrder`, `useLastOrderForClient`, `useProduccionData`, `useProducts`, `useClients`, `useAllStock`. Cada uno expone `{ ..., loading, error }` y las rutas consumen `error` mostrando un nuevo `ErrorBanner`. **Verificado:** `tsc --noEmit` limpio; recorrí las llamadas manualmente contra `git grep onSnapshot`.
- **#16** Helper `describeFirestoreError(err)` en `app/src/lib/errors.ts` que traduce códigos Firestore (`permission-denied`, `failed-precondition`, `unavailable`, `unauthenticated`, `aborted`, `resource-exhausted`, `deadline-exceeded`…) a mensajes es-CL. Aplicado en 6 catches (NuevoPedido, DetallePedido, DetalleArmado, Produccion, Facturacion, Catalogo); los `throw new Error("mensaje en es-CL")` propios pasan sin cambios. Detalle sigue yendo a `console.error`.

**Bloque B — UX del wizard y navegación**
- **#11 + #17** `CATEGORY_LABEL` movido a `app/src/domain/categories.ts` con `categoryOrder(slug)`. NuevoPedido ordena el picker por ese orden (Jamones → Charqui) y Catálogo muestra la etiqueta en vez del slug.
- **#28** "Repetir último pedido" ahora también aparece al inicio del paso 2 con `PED-ID · dd-mm · N líneas` cuando hay último pedido y el draft está vacío.
- **#18** Paso Confirmar muestra bloques separados: **Cliente** (fantasyName + razón social + RUT), **Entrega** (fecha + modalidad + dirección/horario). Facturación incompleta destacada aparte.
- **#12 + #13** `AppShell` reordena la nav por rol (ítems primary del rol primero) y hace `scrollIntoView` del activo en cambio de ruta. `items.length > 1` removido: despacho y producción muestran su única pestaña por consistencia.
- **#14** Cola de despacho: `armado` sacado de `DESPACHO_STATUSES` (vive en Facturación). Orden secundario pone accionables primero. Toast verde al volver de "Marcar armado" con `location.state.armadoOk` que se auto-limpia a 4.5 s.
- **#30** `DetallePedido` muestra por línea `reservedQty` (emerald, si difiere de qty) y `pendingProductionQty` (brass) además del empacado; el header ya listaba modalidad + horario.
- **#19** Facturar ahora abre `ConfirmInvoiceDialog` con cliente y # de líneas antes de emitir; matches Despachar/Entregar.

**Bloque C — parser**
- **#34** `parseLocal`:
  - Aliases genéricos removidos de `scripts/data/products.ts`: `ahumado`, `cocido`, `pistacho`. Los aliases de dos palabras (`jamon cocido`, `jamon ahumado`, `mortadela`) se quedan.
  - `FORMAT_HINTS` del formato pote acepta el número no adyacente (`pote ... 250` o `250 ... pote`) y solo cae al pote-150g cuando no hay cifra específica.
  - `extractNotes` filtra tokens que ya están en el nombre del producto → "mortadela pistacho 1,5 kg" no deja `notes: pistacho`.
  - `scoreMatch` usa la longitud del needle como tiebreaker → en empates el nombre completo gana al alias corto.
  - `scripts/verify-parser.ts` extendido a 10 casos + integración del SAMPLE del README. **Verificado:** `npx tsx scripts/verify-parser.ts` → 10/10 individuales, 4/4 usables del sample.
- La seed se re-ejecutó contra el proyecto real para reflejar los aliases actualizados.

**Bloque D — higiene y reglas**
- **#35** `tests/rules/firestore.rules.test.ts` deduplicado: el positivo de anular ahora vive en el mismo test que la negativa (línea 85). Comentario del archivo actualizado: los tests **no se ejecutaron** en esta máquina (sin JDK) y deben correrse en CI con Java antes de darlos por cubiertos.
- **#25** `firestore.rules`:
  - `counters/orders-YYYY`: escritura solo vendedor/admin/superAdmin (los que pueden crear pedidos).
  - `counters/bsale-YYYY`: escritura solo admin/superAdmin (los que facturan).
  - `stock`: vendedor puede update solo si `onHand` no cambia (deja mover `reserved` desde `createOrder`/`anular`); despacho/producción/admin pueden mover ambos campos. Invariantes `onHand >= 0` y `reserved >= 0` mantenidas. Regla desplegada en producción.
- **#21** Nuevo hook `useSettings()` (`app/src/data/settings.ts`) escucha `settings/app`. NuevoPedido y PegarPedido pasan `settings.cutoffHour` a `defaultRequestedDate` en vez del `15` hardcodeado. `cutoff.ts` calcula la hora actual en `America/Santiago` (no en el TZ del navegador).
- **#29** `scripts/data/orders-week.ts`: los 5 pedidos que estaban en `recibido` ahora se siembran como `confirmado`. La app no genera `recibido` por su cuenta y ninguna pantalla lo avanzaba.
- **#26** `NEXT_STATUS` eliminado de `app/src/domain/types.ts`. `aria-label` agregado a las tarjetas de rol del Login ("Ingresar como Rafael, Vendedor") y a las tarjetas de cliente del paso 1 ("Elegir cliente Magnolia").
- **#37** Comentario huérfano de `.gitignore` (líneas 4-5) borrado.
- **#38** Texto de la sección Sincronizar en `Panel.tsx` ajustado: *"Simulado. Muestra los payloads que se enviarían para los pedidos con documento emitido."*
- **#23** `transferToWizard` de `PegarPedido` ahora chequea si hay un draft con líneas y pide confirmación antes de reemplazarlo. El typo "Ustd" ya se había arreglado en el pase anterior.

**No hecho en este pase** (fuera del alcance solicitado):
- `mapear código → mensaje` para la sección catalogo del `Panel.tsx` cuando `Sincronizar Bsale` genera una excepción — hoy toma solo el happy path.
- Historial de `stockMovements` en Catálogo (mencionado en #9 paso 10 del README anterior) sigue sin vista; el ajuste queda registrado pero no se puede ver desde la UI.
- Tests de reglas (necesitan JDK). El archivo está actualizado y limpio de duplicados pero no corrió.
