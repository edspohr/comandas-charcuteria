# Comandas — La Charcutería Artesanal

Mockup funcional de captura y fulfillment de pedidos para **Cecinas Marcosi SpA** (La Charcutería Artesanal, Barrio Franklin, Santiago).
El objetivo es reemplazar el actual grupo de WhatsApp sin formato por una app móvil-primero que, además de capturar pedidos con formato, resuelve visibilidad de stock, dueño y estado de cada pedido, planificación para Yuri, y trazabilidad hasta la facturación.

> **No es producción.** Bsale está simulado tras una interfaz que se puede reemplazar por el cliente real cuando se habilite la integración.

---

## Live

- **App:** <https://comandas-charcuteria.web.app>
- **Consola Firebase:** <https://console.firebase.google.com/project/comandas-charcuteria>
- **Repo:** <https://github.com/edspohr/comandas-charcuteria>

---

## Perfiles y usuarios sembrados

Todos los usuarios comparten la contraseña **`demo1234`** en el ambiente de demo.

| Perfil | Puede | Usuarios |
|---|---|---|
| Vendedor | Crear pedidos (wizard o **Pedido IA** desde WhatsApp), alta rápida de clientes, ver el tablero con sus pedidos, anular propios | Rafael, Ramiro, Gabriela, Juan, Tania, Elizabeth, Lucy |
| Despacho | Tablero: tomar pedidos, ingresar pesos reales, marcar armado; sincronizar stock con Bsale | Edu, Morena |
| Producción | Tabla de demanda pendiente vs. stock Bsale, sincronizar, y **Producción IA** (pegar el reporte de la fábrica → carga en Bsale) | Yuri |
| Administración | Tablero completo: vincular documento Bsale, despachar, entregar; Panel de dueños; catálogo/clientes | Miguel |
| Super Administración | Todo lo anterior + usuarios + **Consola Bsale (simulada)** | Ciro, Luis |

---

## Guión de demo (≈12 min)

Para mostrar el flujo completo en la URL en vivo. Recomiendo dos ventanas de incógnito lado a lado. Todo el mundo aterriza en el **Tablero** (kanban); cada rol ve las mismas tarjetas y solo puede mover las suyas.

1. **Login** — Tarjetas de rol y sello LC. Entrá como **Rafael** (vendedor). Aterriza en el Tablero con el filtro **Míos** activo.
2. **Nuevo pedido** — Wizard 4 pasos:
   - Cliente: buscá "Magnolia" y tocá la tarjeta. Los datos vienen de **Bsale** (razón social, RUT, dirección). Si escribís un nombre que no existe aparece **Crear cliente**: alta rápida con lo mínimo; el cliente se crea en Bsale y queda marcado *pendiente de revisión* si falta algo para facturar.
   - Productos: agregá 3 líneas mixtas (jamón cocido en sachet 200 g, mortadela pistacho en granel, queso gouda ahumado en sachet 200 g). El picker abre como bottom-sheet con precio y subtotal en vivo. El semáforo usa el stock que reporta Bsale menos las reservas de la app.
   - Entrega: fecha por defecto (mañana o pasado según el corte de las 15:00), despacho.
   - Confirmar → Enviar. Volvés al Tablero con la tarjeta nueva en **Pendiente**.
3. **Pedido IA** — Tocá **Pedido de cliente nuevo** para cargar el ejemplo de Café Botánico, "Interpretar con IA". Además de las líneas, la app detecta al cliente (nombre, RUT, teléfono, dirección, horario) y ofrece **Crear cliente con estos datos**. Con Gemini activo el bloque `client` lo devuelve el modelo; si no, lo extrae el parser determinista. "Continuar con Café Botánico" salta directo a Productos.
4. **Split a producción** — Elegí un cliente y pedí `20 kg` de **Longaniza chillán** en granel (hay 18 kg disponibles según Bsale). Ves "12 kg a producción" en Confirmar. La tarjeta queda en Pendiente con la etiqueta **Espera stock** y nadie puede armarla todavía.
5. **Cambiá a Ciro (super admin) → Bsale** — La *Consola Bsale (simulada)* hace lo que en la vida real pasa dentro de Bsale. En **Recepción de producción** cargá 20 kg de Longaniza chillán granel y tocá **Cargar y sincronizar**: la app trae el stock nuevo, reasigna FIFO y promueve el pedido parcial a `confirmado`. Yuri ve lo mismo en **Producción** (tabla de demanda vs. stock). Alternativa sin salir de su pantalla: pestaña **Producción IA**, pegá el reporte de la fábrica (hay un ejemplo), "Interpretar con IA", confirmá → la recepción se registra en Bsale y se sincroniza.
6. **Cambiá a Edu (despacho)** — Tablero, filtro **Sin asignar**. Tocá **Tomar** en la tarjeta (o arrastrala a *En armado* en desktop). Abrí el detalle, bajá el stepper *Empacado* de una línea granel (3 kg → 2,5 kg) y **Marcar armado**. La tarjeta pasa a **Por facturar**; si pasan más de 4 h sin documento se pone ámbar.
7. **Cambiá a Miguel (admin)** — En **Por facturar** tocá **Vincular doc.** La venta se emite en el POS de Bsale; el diálogo lista los documentos sin vincular (primero los que traen el pedido como referencia). Para la demo tocá **Simular emisión en POS**: emite la factura en el mock con las cantidades empacadas y la vincula. Se libera la reserva y la tarjeta pasa a **Por despachar**. Después **Despachar** (courier + nota) y **Entregar**.
8. **Stock comprometido** — Con Ciro, en Consola Bsale → **Venta en mostrador**, vendé por boleta un producto que la app tenga reservado y tocá **Emitir y sincronizar**. Las tarjetas que dependen de ese stock se ponen **rojas** ("Stock comprometido"): es la señal de que la tienda vendió lo que el pedido tenía apartado.
9. **Panel de dueños** — Cinco pestañas con rango 7/30/90 días vs. período anterior y **Exportar CSV** en cada tabla: **Ventas** (serie diaria, por vendedor, categoría, cliente, producto), **Fuerza de ventas** (cartera por vendedor: activos, en riesgo, inactivos, nuevos, anulados), **Operación** (tiempos por etapa, entregas a tiempo, backlog, carga por armador), **Stock** (cobertura en días, quiebres, comprometido, merma) y **Clientes** (salud, frecuencia, concentración, pendientes de revisión).
10. **Catálogo** — Productos con el stock según Bsale (solo lectura: los ajustes se hacen en Bsale) y la ficha de clientes.

---

## Arquitectura

- **App:** Vite + React + TypeScript + Tailwind (Montserrat, paleta charcoal/crema/oro apagado inspirada en la web del cliente).
- **Backend:** Firebase (Firestore + Auth + Hosting; Firebase AI Logic con Vertex AI para el parseo IA).
- **Catálogo:** 48 productos transcritos del pricelist oficial de agosto + catálogo de fotos. Cada `ProductFormat` lleva `priceCLP` (sachet/unidad) o `pricePerKgCLP` + `avgWeightKg` (granel / pieza). Los pedidos guardan `subtotalCLP` por línea y `totalCLP` en snapshot.
- **Parser IA:** Gemini 2.5 Flash via Firebase AI Logic. Devuelve líneas con IDs exactos del catálogo **y un bloque `client`** con lo que el mensaje revela del cliente. Timeout 8 s → fallback al parser determinista (Fuse.js + regex) y al extractor de RUT/teléfono/dirección.

### Bsale es la fuente de la verdad

La fábrica carga la producción terminada en Bsale y las ventas se emiten en los puntos de venta de Bsale. La app **no escribe stock ni documentos en Bsale**; lo lee y mantiene espejos locales:

| Colección | Qué es | Quién la escribe |
|---|---|---|
| `stock/{productId__formatId}` | Espejo: `onHand` = lo que reportó Bsale para la variante, `reserved` = reservas de pedidos abiertos (Bsale no conoce reservas), `syncedAt` | `syncFromBsale` (onHand), transacciones de pedido (reserved) |
| `clients/{id}` | Espejo del maestro de clientes de Bsale + campos propios (`ownerUid` vendedor responsable, modalidad, horario, notas, `needsReview`) | `syncFromBsale`, alta rápida |
| `stockMovements` | Bitácora append-only: `reserva`, `liberacion`, `sync_bsale`, `venta_bsale` | transacciones |

Disponible = `onHand − reserved`. Si Bsale reporta menos de lo reservado (vendieron en mostrador lo apartado), los pedidos afectados se marcan **stock comprometido**.

- **Sincronización** (`syncFromBsale`, botón en Tablero/Producción y automática al abrir el tablero si pasaron > 5 min): trae stock y clientes, sobrescribe los espejos, reasigna FIFO el stock nuevo a los pedidos parciales y promueve a `confirmado` los que quedan cubiertos.
- **Transacciones de pedido:** `createOrder` (reserva + `PED-YYYY-NNNN`), `assignPacker`, `markArmado` (solo pesos y subtotales; no toca stock), `vincularDocumento` (libera reserva, pre-aplica la venta al espejo, guarda `invoiceRef` + `bsaleDocumentId`), `despacharOrder`, `entregarOrder`, `anularOrder` (libera reserva).
- **Adaptador Bsale:** `BsaleClient` con la forma de la API real (variantes por SKU, oficinas, `GET/POST /v1/clients.json`, `GET /v1/documents.json`, `GET /v1/stocks.json`). `MockBsaleClient` lee un "lado Bsale" simulado en Firestore (`bsaleMock/*`, `bsaleClients`, `bsaleDocuments`, `bsaleReceptions`); `mockAdmin.ts` simula la recepción de producción y la emisión en POS (Consola Bsale). Cambiar al cliente real = mismo interfaz, token en una Cloud Function.
- **Tablero kanban:** `/tablero` para todos los roles. Columnas Pendiente · En armado · Por facturar · Por despachar · Cerrado; acción siguiente por rol en la tarjeta; drag & drop en desktop; colores por umbrales configurables en `settings/app.kanban` (rojo: atrasado o stock comprometido; ámbar: vence hoy, sin asignar > 2 h, armado sin documento > 4 h, despachado sin entrega > 24 h).
- **PWA:** instalable, service worker con aviso de nueva versión, drafts del wizard en `localStorage`.

---

## Correr localmente

Requiere Node 20+ y [JRE / JDK](https://adoptium.net/) para los emuladores Firestore/Auth.

```bash
# instalar
npm install

# terminal 1 — emuladores (Firestore, Auth, Functions, Hosting UI)
npm run emulators

# terminal 2 — poblar con productos, clientes, usuarios y ~40 pedidos
npm run seed

# terminal 3 — dev server
npm run dev
```

La app queda en <http://localhost:5173>, la UI de emuladores en <http://localhost:4000>.

Los usuarios sembrados usan la misma contraseña `demo1234` y aparecen en la pantalla de login como tarjetas.

## Sembrar el proyecto real

```bash
USE_REAL_FIREBASE=1 \
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
npm run seed
```

- El JSON de cuenta de servicio se descarga desde Consola Firebase → *Project settings → Service accounts → Generate new private key*.
- Está ignorado por `.gitignore` para no llegar al repo.
- La seed **borra y reescribe** productos, clientes, usuarios de Auth, stock y ~40 pedidos con la semana real 15–21 sep 2026.

## Correr los tests de reglas

Requiere emuladores corriendo (necesita Java).

```bash
npm run emulators   # en otra terminal
npm run test:rules
```

Cubre los 3 casos críticos: vendedor no edita ajenos, vendedor no cambia status más allá de anular, despacho no setea invoiceRef.

## Deploy

```bash
firebase login   # una vez
npm run deploy                                # build + hosting (siempre juntos: el deploy sube app/dist tal cual está)
npm run deploy:rules                          # reglas + índices
firebase deploy --only firestore:rules        # reglas
firebase deploy --only firestore:indexes      # índices (si se agregan)
firebase deploy --only functions              # requiere plan Blaze
```

El plan Blaze está habilitado en `comandas-charcuteria`. La función `parseOrder` está como stub que devuelve `{ fallback: true }` para que el parser determinista sea la ruta por defecto de la demo; para activar la interpretación con Claude, agregá `ANTHROPIC_API_KEY` en las variables de entorno de Functions y reemplazá el stub por el llamado real.

---

## Estructura del repo

```
comandas-charcuteria/
├── app/                            React + Vite + Tailwind
│   ├── src/
│   │   ├── domain/                 tipos, cutoff, kanban (columnas/colores), analytics, parse/ (local, gemini, client)
│   │   ├── data/                   hooks Firestore, transacciones, sync Bsale
│   │   ├── integrations/bsale/     BsaleClient, MockBsaleClient, mockAdmin (Consola)
│   │   ├── components/             ui/ (DataTable…), orders/OrderDialogs, clients/
│   │   ├── routes/
│   │   │   ├── Tablero.tsx         kanban para todos los roles
│   │   │   ├── vendedor/           NuevoPedido, PegarPedido (Pedido IA), DetallePedido
│   │   │   ├── despacho/           DetalleArmado
│   │   │   ├── produccion/         Produccion (tabla demanda + Producción IA)
│   │   │   └── admin/              Panel, Catalogo, Usuarios, Bsale (consola simulada)
│   │   └── lib/                    format, pricing, rut, csv, draft (localStorage)
│   └── public/icons/               PWA icons (SVG)
├── functions/                      Firebase Function `parseOrder` (stub)
├── scripts/                        seed + verify
│   └── data/                       products, clients, users, orders semana real
├── tests/rules/                    Reglas: 3 tests con rules-unit-testing
├── firestore.rules                 Reglas de seguridad por rol
├── firebase.json                   Config emuladores + hosting + functions
└── README.md                       (este archivo)
```

---

## Alcance del mockup

**Incluido:**
- 5 perfiles con permisos por rol y reglas Firestore.
- Wizard de creación de pedidos móvil-primero con reserva transaccional y split a producción.
- Parser de pedidos pegados (Gemini + fallback determinista) que también detecta al cliente.
- Alta rápida de cliente (wizard y parser) creada en Bsale y espejada localmente.
- Tablero kanban por etapas con acciones por rol, drag & drop y colores por umbral.
- Stock y clientes como espejo de Bsale con sincronización y reasignación FIFO automática.
- Vincular documento Bsale (emitido en POS) → despacho → entrega, con atajo de simulación.
- Consola Bsale simulada (recepción de producción, venta en mostrador, documentos).
- Panel de dueños: ventas, fuerza de ventas, operación, stock y clientes, con exportación CSV.
- PWA instalable con drafts offline en `localStorage`.

**Fuera de alcance:**
- Márgenes, pagos, cobranza.
- API real de Bsale (solo interfaz + mock; el token existe pero la integración queda para después de la demo).
- CRM externo (HubSpot): se evaluó y se pospone hasta lograr adopción; el modelo de cliente ya trae `hubspotCompanyId` para el conector futuro.
- Fotos como prueba de entrega (por ahora sólo texto).
- Notificaciones push.
- Multi-idioma (todo en es-CL formal).
- Rules tests más allá de los 3 críticos (y siguen sin poder correr en máquinas sin JDK).

---

## Habilitar Gemini (una sola vez)

El cliente `@firebase/ai` v2 usa **Firebase AI Logic** como proxy hacia Vertex AI: el browser habla con `firebasevertexai.googleapis.com` (auth por Firebase Auth), esa API llama a Vertex AI del lado del servidor. Hay que habilitar las tres:

```bash
gcloud services enable \
  firebasevertexai.googleapis.com \
  aiplatform.googleapis.com \
  firebaseml.googleapis.com \
  --project=comandas-charcuteria
```

O desde la consola: **Firebase Console → Build → AI Logic** → aceptar el bootstrap (activa las tres). Verificar en **Vertex AI → Model Garden** que `gemini-2.5-flash` esté disponible en `us-central1`.

**Sin `firebasevertexai.googleapis.com` habilitada, todas las llamadas del cliente `@firebase/ai` fallan y la app cae al parser local en silencio.** Fue justo el estado del proyecto hasta 23-09-2026: `aiplatform` y `firebaseml` estaban activas pero faltaba `firebasevertexai`. Si el chip del intérprete dice *"parser local"* en vez de *"Gemini"* y arriba aparece el banner amarillo *"Se usó el intérprete local"*, revisar la consola del browser en Pedido IA: un `[parse] Gemini failed…` con `403` o `SERVICE_DISABLED` es esta causa.

**Costo.** Pricing público de Vertex AI para `gemini-2.5-flash` en Sep-2026: USD 0.075 / 1 M tokens de input, USD 0.30 / 1 M tokens de output. Cada llamada del parser envía ~4 K tokens (catálogo + mensaje) y recibe ~500. Con 30 pedidos/día ⇒ ~3.6 M tokens/mes de input y 450 K de output ⇒ **~USD 0.40/mes**, dentro de cualquier cuota razonable.

**Verificación local.** `scripts/verify-gemini.ts` prueba el endpoint end-to-end contra la SA `firebase-adminsdk-fbsvc@…`:
```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/verify-gemini.ts
```
Requiere `roles/aiplatform.user` en esa SA (el script imprime el comando para otorgarlo si falla con 403). El browser no necesita ese rol — Firebase AI Logic autentica con la cuenta Firebase Auth del usuario.

Si la llamada a Gemini falla por cualquier motivo, la app cae al parser determinista automáticamente y muestra un banner amarillo *"Se usó el intérprete local"* para que el vendedor sepa que la línea puede ser menos precisa.

## Notas operativas

- Las reglas actuales son las mínimas necesarias para que cada rol pueda hacer su trabajo. Antes de exponer la URL a usuarios reales, considerar:
  - Rotar contraseñas — hoy todos son `demo1234`.
  - Habilitar App Check para bloquear cliente no oficial.
  - Reglas más específicas por transición de estado (hoy admin/superAdmin tienen paso libre).
- El bundle actual es ~730 KB pre-gzip. Optimización con code-splitting queda para producción.
- **Service worker:** el bundle se cachea por PWA. Tras cada `firebase deploy`, los dispositivos que ya abrieron la app antes ven un toast **"Nueva versión disponible — Recargar"** cuando el SW detecta el nuevo build; hasta que se toque *Recargar* siguen viendo el bundle anterior. Si en la demo alguien no ve un fix reciente, hacer *Recargar* una vez.

