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
| Vendedor | Crear pedidos, ver stock, ver sus pedidos, anular propios | Rafael, Ramiro, Gabriela, Juan, Tania, Elizabeth, Lucy |
| Despacho | Tomar pedidos, ingresar pesos reales, marcar armado | Edu, Morena |
| Producción | Ver demanda + registrar producción (reasigna FIFO) | Yuri |
| Administración | Facturar, despachar, entregar, catálogo/clientes, panel | Miguel |
| Super Administración | Todo lo anterior + usuarios + sincronizar Bsale | Ciro, Luis |

---

## Guión de demo (≈10 min)

Para mostrar el flujo completo en la URL en vivo. Recomiendo dos ventanas de incógnito lado a lado.

1. **Login** — Muestra las tarjetas de rol y el sello LC. Entrá como **Rafael** (vendedor).
2. **Nuevo pedido** — Wizard 4 pasos:
   - Cliente: buscá "Magnolia" y tocá la tarjeta **Magnolia** (razón social *Hotel Magnolia*).
   - Productos: agregá 3 líneas mixtas (jamón cocido en sachet 200 g, mortadela pistacho en granel, queso gouda ahumado en sachet 200 g). El picker de formatos abre como bottom-sheet, muestra **el precio por formato** debajo del label y un **subtotal en vivo** mientras se mueve el stepper.
   - Entrega: dejá la fecha por defecto (mañana), despacho.
   - Confirmar → Enviar. Se ve el **total estimado** destacado. Flash en Mis pedidos con `PED-2026-XXXX` y el monto.
3. **Pegar pedido (opcional)** — Volvé a Nuevo pedido → **Pegar pedido**. Cargá el ejemplo, "Interpretar" (por defecto va a **Gemini 2.5 Flash** via Firebase AI Logic; si falla, fallback local). Un chip en el header dice qué motor corrió. Revisá y "Continuar en el wizard".
4. **Split a producción** — Elegí un cliente y pedí `20 kg` de **Longaniza chillán** en granel (hay 8 kg disponibles). Ves el aviso "12 kg a producción" en Confirmar. Este pedido queda `confirmado_parcial` — todavía **no** se puede armar hasta que producción cubra las líneas pendientes.
5. **Cambiá a Yuri (producción)** — Ves la card **Longaniza chillán · Granel laminado (kg)** en "Con demanda pendiente".
   - Tocá la card para ver los pedidos que dependen; Registrar producción abre pre-seleccionado el producto+formato.
   - Ingresá una cantidad ≥ pendiente y "Registrar". El pedido parcial se promueve a `confirmado` y aparece en el aviso "Pedidos promovidos".
6. **Cambiá a Edu (despacho)** — Nueva ventana incógnito.
   - Cola: aplicá el filtro **Sin asignar**. Ves los pedidos listos para armar — el del paso 2 y el del paso 4 (que ya se promovió tras el paso 5).
   - Tomá uno → estado `en_armado`.
   - En una línea `Granel laminado (kg)` bajá el stepper *Empacado* respecto al vendido para simular la merma (p. ej. 3 kg vendidos → 2,5 kg empacados). El **subtotal se recalcula en vivo**. Para líneas `pieza` (Pastrami Americano, Bresaola, Coppa) también podés ingresar `Peso real (kg)` — la factura se ajusta a ese peso × precio/kg.
   - "Marcar armado". Repetí para el otro pedido si querés ver dos facturas en el paso 7.
7. **Cambiá a Miguel (admin)** — Facturación:
   - Cards muestran total CLP por pedido.
   - Tab **Por facturar**: `Facturar` → confirmación → modal muestra `FA-000XXX` **+ payload JSON con `netUnitValue` calculado** (subtotal / 1,19 / cantidad).
   - Tab **Por despachar**: `Despachar` con courier + nota.
   - Tab **Por entregar**: `Marcar entregado`.
8. **Panel** — Métricas valorizadas:
   - **Ventas facturadas** con ticket promedio.
   - Chart **Ventas por vendedor (CLP)**.
   - Chart **Top 8 productos por venta**.
   - Lista de deltas empacado/vendido (el granel del paso 5 aparece con delta negativo).
9. **Cambiá a Ciro (super admin)** — Aparece la sección **Sincronizar con Bsale** al fondo del Panel + nav item **Usuarios**. Tocá Sincronizar para ver el batch de payloads.
10. **Catálogo → Ajustar stock** — Elegí un producto, expandí un formato, tocá **Ajustar**, cambiá la cantidad con un motivo → la disponibilidad se actualiza en vivo. El movimiento `ajuste` queda registrado como bitácora en Firestore (no hay vista de historial en esta versión).

---

## Arquitectura

- **App:** Vite + React + TypeScript + Tailwind (Montserrat, paleta charcoal/crema/oro apagado inspirada en la web del cliente).
- **Backend:** Firebase (Firestore + Auth + Hosting; Firebase AI Logic con Vertex AI para el parseo IA).
- **Catálogo:** 48 productos transcritos del pricelist oficial de agosto + catálogo de fotos. Cada `ProductFormat` lleva `priceCLP` (sachet/unidad) o `pricePerKgCLP` + `avgWeightKg` (granel / pieza). Los pedidos guardan `subtotalCLP` por línea y `totalCLP` en snapshot.
- **Parser IA:** Gemini 2.5 Flash via Firebase AI Logic (`@firebase/ai`, backend `VertexAIBackend` region `us-central1`). Un manifest compacto del catálogo se inyecta como contexto y un JSON schema estructurado obliga a devolver IDs exactos. Timeout 8 s → si falla, el parser determinista (Fuse.js + regex) toma el relevo automáticamente.
- **Modelo de stock:** colección `stock/{productId__formatId}` con `{ onHand, reserved }` mutada solo en transacciones. `stockMovements` es bitácora append-only para auditoría — nunca se agrega en cliente.
- **Transacciones que tocan stock:**
  - `createOrder` — reserva + creación de pedido + contador `PED-YYYY-NNNN` en una sola transacción.
  - `markArmado` (despacho) — libera reserva, decrementa `onHand` por `packedQty`, escribe consumo.
  - `registrarProduccion` (producción) — sube `onHand` y reasigna FIFO a pedidos parciales.
  - `anularOrder` (vendedor/admin) — libera reservas.
  - `ajustarStock` (admin) — ajuste absoluto con motivo obligatorio.
- **Adaptador Bsale:** `BsaleClient` + `MockBsaleClient`. El botón *Sincronizar* en el Panel muestra el payload que se enviaría.
- **PWA:** instalable, service worker cachea el shell, drafts del wizard viven en `localStorage` (funciona offline).

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
firebase deploy --only hosting                # UI
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
│   │   ├── domain/                 tipos, cutoff, parser local
│   │   ├── data/                   hooks Firestore, transacciones
│   │   ├── integrations/bsale/     BsaleClient + MockBsaleClient
│   │   ├── components/ui/          Button, Stepper, Semaphore, Logo, StatusPill
│   │   ├── routes/
│   │   │   ├── vendedor/           NuevoPedido, PegarPedido, MisPedidos, DetallePedido
│   │   │   ├── despacho/           ColaDespacho, DetalleArmado
│   │   │   ├── produccion/         Produccion
│   │   │   └── admin/              Facturacion, Panel, Catalogo, Usuarios
│   │   └── lib/                    format, draft (localStorage)
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
- Parser de pedidos pegados (fallback determinista + hueco listo para Claude).
- Cola de despacho con pesos reales y transacción de consumo.
- Registrar producción con reasignación FIFO y promoción automática de pedidos parciales.
- Facturación/despacho/entrega con MockBsaleClient (payload JSON visible).
- Panel de dueños con métricas + charts + Sincronizar Bsale para superAdmin.
- Catálogo/clientes read-only + ajuste de stock con motivo (auditoría).
- PWA instalable con drafts offline en `localStorage`.

**Fuera de alcance:**
- Precios, márgenes, pagos.
- API real de Bsale (solo interfaz + mock).
- Fotos como prueba de entrega (por ahora sólo texto).
- Notificaciones push.
- Multi-idioma (todo en es-CL formal).
- Rules tests más allá de los 3 críticos.

---

## Habilitar Gemini (una sola vez)

Firebase AI Logic requiere las APIs de Vertex AI habilitadas en el proyecto Google Cloud. En la consola:

1. Ir a **Firebase Console → Build → AI Logic** y aceptar el bootstrap (habilita `firebaseml.googleapis.com` y `aiplatform.googleapis.com`).
2. Alternativa CLI:
   ```bash
   gcloud services enable aiplatform.googleapis.com firebaseml.googleapis.com --project=comandas-charcuteria
   ```
3. Verificar en **Vertex AI → Model Garden** que `gemini-2.5-flash` esté disponible en `us-central1` (default).

El costo aproximado al volumen del cliente (≈5 M tokens/mes) es de USD 1–2. Cabe en la cuota gratuita mensual de Vertex AI.

Si la llamada a Gemini falla por cualquier motivo (API deshabilitada, timeout, red, etc.), la app usa el parser determinista automáticamente y sigue funcionando.

## Notas operativas

- Las reglas actuales son las mínimas necesarias para que cada rol pueda hacer su trabajo. Antes de exponer la URL a usuarios reales, considerar:
  - Rotar contraseñas — hoy todos son `demo1234`.
  - Habilitar App Check para bloquear cliente no oficial.
  - Reglas más específicas por transición de estado (hoy admin/superAdmin tienen paso libre).
- El bundle actual es ~730 KB pre-gzip. Optimización con code-splitting queda para producción.
- **Service worker:** el bundle se cachea por PWA. Tras cada `firebase deploy`, los dispositivos que ya abrieron la app antes ven un toast **"Nueva versión disponible — Recargar"** cuando el SW detecta el nuevo build; hasta que se toque *Recargar* siguen viendo el bundle anterior. Si en la demo alguien no ve un fix reciente, hacer *Recargar* una vez.

