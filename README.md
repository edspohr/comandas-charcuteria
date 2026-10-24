# Comandas — La Charcutería Artesanal

Toma y seguimiento de pedidos para **Cecinas Marcosi SpA** (La Charcutería Artesanal, Barrio Franklin, Santiago).
Reemplaza el grupo de WhatsApp sin formato por una app móvil (PWA) que muestra el stock real de Bsale, deja un responsable en cada etapa del pedido y le da a los dueños las cifras del negocio.

**Estado (24-10-2026):** versión **1.0** en marcha blanca, con todos los perfiles desde el lunes 26-10. Bsale conectado en lectura; las escrituras hacia Bsale están **apagadas** (simulacro) y la facturación se hace en el POS de Bsale y se vincula en Comandas.

---

## Enlaces

| | |
|---|---|
| App (producción) | <https://comandas-charcuteria.web.app> |
| App (staging, Bsale simulado) | <https://comandas-staging.web.app> |
| Consola Firebase | [comandas-charcuteria](https://console.firebase.google.com/project/comandas-charcuteria) · [comandas-staging](https://console.firebase.google.com/project/comandas-staging) |
| Repo | <https://github.com/edspohr/comandas-charcuteria> |

## Documentación

| Documento | Para qué |
|---|---|
| [docs/operacion.md](docs/operacion.md) | Runbook: deploy, staging, usuarios y PIN, interruptores de Bsale, scripts, alertas |
| [docs/adr/](docs/adr/README.md) | Decisiones de arquitectura (ADR) y por qué se tomaron |
| [docs/deuda-tecnica.md](docs/deuda-tecnica.md) | Deuda técnica conocida, priorizada |
| [docs/backlog.md](docs/backlog.md) | Pendientes de la puesta en marcha, plan a noviembre y backlog fuera de alcance |
| [docs/QA-guion-demo.md](docs/QA-guion-demo.md) | QA de la demo del 22-09 (histórico) |
| En la app: Mi cuenta → **Guía de uso** | Guía de una página por perfil ([`app/src/routes/Ayuda.tsx`](app/src/routes/Ayuda.tsx)) |

---

## Fuente de la verdad ([ADR-0001](docs/adr/0001-bsale-fuente-de-verdad.md))

| Dato | Dueño | Comandas… |
|---|---|---|
| Catálogo, precios, clientes (datos tributarios), stock por sucursal, documentos | **Bsale** | lo lee y guarda espejos |
| Pedidos, reservas, estados, responsables, pesos empacados, cartera, horario de entrega, aprobaciones, muestras | **Comandas** | es el dueño |
| Producción cargada (bitácora), insumos y rendimientos (próxima etapa) | **Comandas** | es el dueño |

Comandas **solo escribe en Bsale** hechos que nacen en la app, desde Cloud Functions, con bitácora, simulacro y PIN ([ADR-0004](docs/adr/0004-escrituras-bsale-servidor.md)). Nunca ajusta stock "a mano".

---

## Perfiles ([ADR-0003](docs/adr/0003-un-perfil-por-usuario.md))

Cada persona tiene **un perfil**, que viaja como *custom claim* `role`. La matriz vive en [`app/src/domain/permissions.ts`](app/src/domain/permissions.ts) y se replica a mano en [`firestore.rules`](firestore.rules) y [`functions/src/common.ts`](functions/src/common.ts): **cambiar las tres juntas**.

| Perfil | Qué hace |
|---|---|
| Vendedor | Toma pedidos de su cartera (paso a paso o pegando el mensaje, con IA), muestras, alta de clientes, sigue sus pedidos. |
| Tienda | Pide reposición, recibe traslados; también vende. |
| Despacho | Arma con pesos reales, registra traslados y salidas de muestras, despacha. |
| Reparto | Marca salida y entrega. |
| Producción | Ve qué producir por fecha de entrega y carga lo producido (foto de la planilla o a mano). |
| Administración | Todo el flujo operativo: vincula documentos de Bsale, clientes, catálogo, Panel. |
| Super Administrador | Lo anterior + usuarios, aprobación de excepciones, configuración de Bsale, despachar sin factura y facturar después de entregar. |
| Consultor | Auditor: ve todo (app y Bsale) sin modificar nada. |

## Acceso y PIN ([ADR-0007](docs/adr/0007-pin-personal.md))

- **Por invitación.** Un superAdmin agrega a la persona en **Usuarios**, con «Agregar persona» o con «Invitar con su historial», que trae sus pedidos y cartera de WhatsApp.
- **Primer ingreso** con Google o contraseña. La app pide crear un **PIN de 4 dígitos** y aceptar la declaración de responsabilidad (versión `v1-2026-10-24`).
- **Uso diario:** correo + PIN. La app se **bloquea** al abrirla y tras 30 minutos sin uso.
- **Acciones clave con PIN**, verificado en el servidor y registrado en `pinLog`:
  - enviar pedido, cargar producción, anular, vincular documento;
  - traslado, salida de muestras, despachar sin factura, aprobar o rechazar excepciones;
  - toda escritura a Bsale.
- **Intentos fallidos:** 5 bloquean el PIN 15 minutos y 10 lo desactivan. El superAdmin solo puede **borrar** un PIN; nunca lo ve ni lo asigna.

---

## Flujo de un pedido

`Pendiente → En armado → Por facturar → Por despachar → Cerrado`: un tablero para todos los perfiles, donde cada uno ve la acción que le toca.

- **Venta.**
  1. El vendedor crea el pedido con un **horario de entrega obligatorio** desde–hasta ([ADR-0009](docs/adr/0009-horario-entrega-obligatorio.md)). La reserva de stock se hace en la misma transacción ([ADR-0002](docs/adr/0002-stock-reservas-transaccionales.md)).
  2. Lo que falta queda *a producción* y se reasigna por orden de llegada (FIFO) cuando entra stock.
  3. Despacho arma con los pesos reales.
  4. Administración emite en el POS de Bsale y **vincula el documento** ([ADR-0005](docs/adr/0005-facturacion-pos-y-vincular.md)), lo que libera la reserva.
  5. Reparto entrega.
- **Stock informativo** (por defecto): un faltante avisa pero no impide armar. `settings/app.stockMode = 'estricto'` lo vuelve bloqueante ([ADR-0006](docs/adr/0006-stock-informativo.md)).
- **Excepciones:** precio, corte, pago o entrega fuera de lo normal, o líneas sobre 25 kg / 60 u. El pedido queda **por aprobar** hasta que un superAdmin lo aprueba con su PIN, y las reglas impiden armarlo antes ([ADR-0008](docs/adr/0008-excepciones-con-aprobacion.md)).
- **Reposición de tienda:** la tienda pide, despacho arma y registra el traslado, y la tienda recibe.
- **Muestras** ([ADR-0010](docs/adr/0010-muestras-consumo-interno.md)):
  - el vendedor agrega «+ Muestra», 80 g por defecto, a $0;
  - despacho las rotula;
  - al facturar o con «Registrar salida» (`MU-…`) se registran como consumo interno en Bsale;
  - a los 7 días el vendedor responde «¿Qué le pareció…?»;
  - se cuenta conversión si el cliente compra el producto dentro de 60 días;
  - Panel → Muestras muestra los kg por cliente nuevo ganado.

## Producción ([ADR-0014](docs/adr/0014-bitacora-produccion.md))

La pantalla diaria de Producción tiene cuatro partes:
- **Qué producir:** lo que esperan los pedidos, agrupado en para hoy, para mañana y próximos días, con el primer pedido de cada producto y su horario.
- **Carga de lo producido:** con **foto de la planilla** (Gemini lee las cantidades) o **a mano**, siempre con PIN.
- **Cargado hoy:** la bitácora del día (`productionLog`).
- **Todo el stock:** stock de Bsale, reservado y disponible.

Si las escrituras a Bsale están apagadas, la carga queda «Por cargar en Bsale»: la oficina la pasa a Bsale y la marca.

## Bsale

**Lectura** (activa desde el 19-10-2026):
- sincronización cada 10 minutos de 06:00 a 23:00, más webhooks;
- catálogo y cruce de variantes (`catalogMap`), stock por sucursal (1 = fábrica «MARCOSI (SALA DE PROCESO)», 2 = tienda), lista de precios 8, clientes compradores y documentos;
- historia de ventas comprimida por mes para el Panel ([ADR-0012](docs/adr/0012-hechos-venta-por-mes.md)) y costos promedio diarios a las 05:30.

**Escrituras** (código listo; apagadas en producción, ver [docs/operacion.md](docs/operacion.md#interruptores-de-bsale)):

| En Comandas | En Bsale | Interruptor |
|---|---|---|
| Cargar producción | recepción en fábrica, a costo promedio vigente | `writesEnabled` + `dryRun` |
| Traslado a tienda | consumo en fábrica + recepción en tienda (o guía) | `writesEnabled` + `dryRun` |
| Salida de muestras | consumo interno `MU-…` | `writesEnabled` + `dryRun` |
| Alta / edición de cliente | cliente | `writesEnabled` + `dryRun` |
| Facturar desde Comandas | factura o boleta con pesos del armado | `invoicesEnabled` (+ los anteriores) |

Cada intento queda en `bsale/writes/log`. Funciones en [`functions/src/bsale/`](functions/src/bsale); los supuestos sobre la API están anotados en `api.ts`.

**Cloud Functions:**
- usuarios: `claimInvite`, `adminInviteUser`, `adminUpdateUser`, `adminDeleteInvite`;
- PIN: `setOwnPin`, `pinLogin`, `verifyPin`, `adminResetPin`;
- IA: `parseOrder`;
- Bsale:
  - lectura y sincronización: `bsaleDiagnose`, `bsaleSyncNow`, `bsaleScheduledSync`, `bsaleWebhook`, `bsaleWebhookInfo`;
  - escrituras: `bsaleReceiveProduction`, `bsaleTransferToStore`, `bsaleCreateClient`, `bsaleUpdateClient`, `bsaleConsumeSamples`;
  - facturación: `bsaleInvoicePreview`, `bsaleEmitInvoice`;
  - historia y costos: `bsaleFactsBackfill`, `bsaleRefreshCosts`, `bsaleDailyCosts`;
  - proxy de solo lectura: `bsaleProxy` (solo GET).

## Panel de gestión

Corre sobre las ventas de Bsale (facturas + boletas − notas de crédito, neto), no sobre los pedidos. Pestañas:
- Resumen y Ventas;
- Productos: ABC y margen con costo promedio;
- Clientes: ritmo de compra, en riesgo, perdidos;
- Vendedores: la tienda cuenta como vendedora;
- Stock;
- Muestras;
- Explorador: tabla dinámica + CSV;
- Pedidos.

Reglas de salud de cliente: ver [ADR-0015](docs/adr/0015-salud-de-cliente.md) (hay dos definiciones; ver deuda técnica).

## IA (Gemini)

Firebase AI Logic (`@firebase/ai`, gemini-2.5-flash, *thinking* apagado) con **App Check reCAPTCHA Enterprise**, que solo se exige en AI Logic ([ADR-0011](docs/adr/0011-gemini-con-fallback.md)). Se usa para:
- **Pegar mensaje (IA)** en Nuevo pedido;
- la **foto de la planilla** en Producción.

Si Gemini falla, el texto cae a un intérprete determinista (`domain/parse/local.ts`); la foto, en cambio, requiere la IA. Para reproducir la configuración: `npm run appcheck:setup` (ver [docs/operacion.md](docs/operacion.md#gemini-y-app-check)).

---

## Colecciones

| Colección | Qué es | Quién escribe |
|---|---|---|
| `orders/*` | pedidos (líneas, reservas, estados, ventana, aprobación, muestras) | app (transacciones) |
| `stock/{productId__formatId}` | `onHand` = fábrica según Bsale, `storeOnHand`, `reserved` = reservas de la app | servidor (sync) + transacciones de pedido |
| `stockMovements/*` | bitácora de stock, append-only | app |
| `productionLog/*` | producción cargada desde Comandas y su estado en Bsale | Producción (crea), supervisión (marca «cargado») |
| `clients/*` | espejo de Bsale + cartera, horario habitual, notas | servidor + alta rápida |
| `products/*`, `catalogMap/{variantId}` | catálogo de la app (`sellable`) y cruce con Bsale | administración |
| `users/*`, `invites/*` | perfiles e invitaciones | solo Cloud Functions |
| `userPins/*` | hash scrypt del PIN | solo servidor (deny-all a clientes) |
| `pinLog/*` | auditoría de cada uso del PIN | solo servidor |
| `sampleFeedback/*` | seguimiento de muestras | vendedor |
| `settings/app`, `settings/bsale`, `settings/bsaleSync` | configuración y estado de sincronización | superAdmin / servidor |
| `bsale/**` | espejos, hechos de venta, bitácoras de escrituras y webhooks | servidor |

---

## Desarrollo local

Requiere Node 22 y Java 21 para los emuladores (`brew install openjdk@21`; es *keg-only*, así que se antepone a `PATH`).

```bash
npm install
npm run emulators            # Auth, Firestore, Functions
npm run seed                 # demo: catálogo, clientes, usuarios (demo1234), ~40 pedidos
cd app && VITE_USE_EMULATORS=true VITE_DEMO_LOGIN=true VITE_FIREBASE_PROJECT_ID=comandas-charcuteria-demo npx vite
```

- **Bsale falso:** `npx tsx scripts/fake-bsale.ts` (`:4010`), con `functions/.env.local` → `BSALE_BASE_URL=http://127.0.0.1:4010`, `functions/.secret.local` → `BSALE_ACCESS_TOKEN=fake` y `VITE_BSALE_MODE=real` en la app. `.claude/launch.json` trae estas configuraciones.
- **Tests de reglas** (15 casos), solo con emuladores propios:
  ```bash
  npm run test:rules:emu
  ```
- **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): typecheck de funciones, build de la app y tests de reglas en cada push.
- `app/tsconfig` tiene `noEmit`: no generar `.js` junto a los `.tsx`.

## Deploy

```bash
npm run deploy                                                          # build + hosting (producción)
npm run deploy:rules                                                    # reglas + índices
firebase deploy --only functions --project comandas-charcuteria         # funciones
cd app && npx vite build --mode staging && cd .. && firebase deploy --only hosting --project staging   # staging
```

Hosting sirve `index.html`, `sw.js` y el manifest sin caché y `/assets/**` como inmutables. Tras cada deploy, los dispositivos ven «Nueva versión disponible — Recargar». Detalle y checklist en [docs/operacion.md](docs/operacion.md).

## Estructura

```
app/src/
  domain/        tipos, permisos, kanban, delivery, exceptions, samples, analytics, bsaleAnalytics, parse/
  data/          hooks Firestore, transacciones de pedido, auth, pin, productionLog, bsaleOps, bsaleAdmin
  integrations/bsale/  BsaleClient (interfaz), Mock (staging/local) y Real (vía funciones)
  components/    AppShell (menú agrupado + barra inferior), AppLock, PinPrompt, InstallButton, orders/, panel/, ui/
  routes/        Login (landing), Tablero, Ayuda, vendedor/, despacho/, produccion/, clientes/, admin/, bsale/
  lib/           format, image, install, scrollLock, draft, csv, rut
functions/src/
  users.ts, pin.ts, common.ts, bsaleProxy.ts, index.ts (parseOrder)
  bsale/         api, config, sync, diagnose, facts, writes, invoice, samples, index
scripts/         seed, bootstrap-admin, reset-real, bsale-load, bsale-probe, fake-bsale, import-whatsapp,
                 golive-clean, catalog-golive, migrate-claims, appcheck-setup, setup-alerts, verify-*
tests/rules/     reglas por perfil
private/         datos extraídos y auditorías (gitignored, nunca al repo)
```

## Fuera de alcance

Ver [docs/backlog.md](docs/backlog.md#fuera-de-alcance-no-cotizado). La línea de producción (insumos, procesos, rendimientos y mermas) es la siguiente etapa del contrato.
