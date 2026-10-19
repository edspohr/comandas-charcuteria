# Comandas — La Charcutería Artesanal

Toma y seguimiento de pedidos para **Cecinas Marcosi SpA** (La Charcutería Artesanal, Barrio Franklin, Santiago).
Reemplaza el grupo de WhatsApp sin formato por una app móvil que muestra el stock real de Bsale, deja un responsable en cada etapa del pedido y le da a los dueños las cifras del negocio.

---

## Live

- **App:** <https://comandas-charcuteria.web.app>
- **Consola Firebase:** <https://console.firebase.google.com/project/comandas-charcuteria>
- **Repo:** <https://github.com/edspohr/comandas-charcuteria>

---

## Fuente de la verdad

| Dato | Dueño | Comandas… |
|---|---|---|
| Catálogo, precios, clientes (datos tributarios), stock por sucursal, documentos | **Bsale** | lo lee y guarda espejos |
| Pedidos, reservas, estados, responsables, pesos empacados, cartera por vendedor | **Comandas** | es el dueño |
| Producción: insumos, procesos, rendimientos y mermas (próxima etapa) | **Comandas** | es el dueño |

Comandas **solo escribe en Bsale** hechos que nacen en la app: recepción de producción terminada, traslado fábrica → tienda y alta/corrección de clientes. Nunca ajustes de stock "a mano". Cada escritura queda en una bitácora y se puede correr en **simulacro** (registra lo que se enviaría sin enviarlo).

---

## Perfiles

Cada persona tiene **un perfil**. La matriz vive en [`app/src/domain/permissions.ts`](app/src/domain/permissions.ts) y se replica en [`firestore.rules`](firestore.rules). El perfil viaja como *custom claim* `role` en el token y solo lo escriben las Cloud Functions de usuarios.

| Perfil | Qué hace |
|---|---|
| Vendedor | Toma pedidos de sus clientes (wizard o Pedido IA), ve stock y el estado de sus pedidos, da de alta clientes. |
| Tienda | Pide reposición para la tienda y confirma lo que llega. |
| Despacho | Arma con pesos reales, registra traslados a tienda, despacha. |
| Reparto | Marca salida y entrega. |
| Producción | Ve la demanda pendiente y registra la producción terminada en Bsale (Producción IA). |
| Administración | Todo el flujo: vincula documentos Bsale, clientes, cruce de catálogo, Panel. |
| Super Administrador | Lo anterior + usuarios y configuración de Bsale. |
| Consultor | Auditor: ve todo (app y Bsale, *Ventana a Bsale*) sin modificar nada. |

**Acceso:** por invitación. Un superAdmin agrega a la persona en **Usuarios** (con Google o con contraseña; en el segundo caso le llega un correo para crearla). Los primeros accesos se crean con `scripts/bootstrap-admin.ts`.

---

## Flujo de un pedido

`Pendiente → En armado → Por facturar → Por despachar → Cerrado` (tablero kanban para todos los perfiles; cada uno ve la acción que le toca).

- **Venta:** el vendedor crea el pedido (reserva stock en una transacción; lo que falta queda *a producción* y se reasigna FIFO cuando entra stock). Despacho arma con pesos reales. Administración **vincula el documento** emitido en el POS de Bsale (libera la reserva). Reparto entrega.
- **Reposición de tienda:** la tienda pide; despacho arma y **registra el traslado** (consumo en fábrica + recepción en tienda, o guía, según configuración); la tienda **recibe**.

---

## Bsale: puesta en marcha cuando llegue el token

Todo está construido y probado contra un Bsale falso ([`scripts/fake-bsale.ts`](scripts/fake-bsale.ts)). Pasos en orden; los marcados **(usted)** requieren permisos que Claude no tiene:

1. **(usted) Token en Secret Manager:**
   ```bash
   printf "TOKEN_DE_BSALE" | gcloud secrets create BSALE_ACCESS_TOKEN --data-file=- --project=comandas-charcuteria
   ```
2. **(usted) Desplegar funciones y reglas:**
   ```bash
   firebase deploy --only functions,firestore:rules,firestore:indexes --project comandas-charcuteria
   ```
3. **(usted) Login con Google:** Consola Firebase → Authentication → Sign-in method → habilitar **Google**. Verificar que `comandas-charcuteria.web.app` esté en *Authorized domains*.
4. **Arranque limpio** (borra pedidos y usuarios de demo; ver sección más abajo) y **primeros accesos** con `bootstrap-admin.ts`.
5. **Modo real en el build:** agregar `VITE_BSALE_MODE=real` a `app/.env.production` y `npm run deploy`.
6. En la app, **Conexión Bsale → Correr diagnóstico**. Trae sucursales, catálogo, precios, stock, clientes, vendedores y 90 días de documentos, y propone fábrica, tienda y lista de precios.
7. **Configuración:** confirmar sucursal de fábrica, tienda y lista de precios.
8. **Catálogo → Cruce con Bsale:** confirmar las sugerencias (en la prueba acertó 96 de 97) y resolver las que queden. Opcional: *Traer precios de Bsale*.
9. Encender **Sincronización** (cron cada 10 min de 06:00 a 23:00 + webhooks). Botón **Webhook** → pedirle a soporte de Bsale que registre esa URL.
10. Encender **Escrituras** con **Simulacro**; revisar la **Bitácora**; cuando todo calce, apagar Simulacro.

Funciones: `bsaleDiagnose`, `bsaleSyncNow`, `bsaleScheduledSync`, `bsaleWebhook`, `bsaleWebhookInfo`, `bsaleReceiveProduction`, `bsaleTransferToStore`, `bsaleCreateClient`, `bsaleUpdateClient`, `bsaleProxy` (solo GET). Código en [`functions/src/bsale/`](functions/src/bsale). Los supuestos sobre la API (rutas, paginación, nombres de campos) están anotados en `api.ts`; el diagnóstico guarda las respuestas para verificarlos.

### Colecciones

| Colección | Qué es | Quién escribe |
|---|---|---|
| `stock/{productId__formatId}` | `onHand` = fábrica según Bsale, `storeOnHand` = tienda, `reserved` = reservas de la app | servidor (sync) + transacciones de pedido |
| `clients/*` | espejo de Bsale + cartera, modalidad, horario, notas | servidor + alta rápida |
| `catalogMap/{variantId}` | cruce variante Bsale ↔ producto/formato | administración |
| `bsale/catalog/variants`, `bsale/stock/byVariant`, `bsale/sales/documents`, `bsale/master/*`, `bsale/meta` | espejos y diagnóstico | servidor |
| `bsale/writes/log`, `bsale/webhooks/log` | bitácoras | servidor |
| `settings/bsale` | configuración de la integración | superAdmin |

---

## Desarrollo local

Requiere Node 20+ y Java para los emuladores (`brew install openjdk@21`, sin sudo; es *keg-only*, así que se antepone a `PATH`).

```bash
npm install
npm run emulators            # Auth, Firestore, Functions (necesita Java en PATH)
npm run seed                 # datos de demo: catálogo, clientes, 16 usuarios (demo1234), ~40 pedidos
```

App contra emuladores (con tarjetas de usuarios de desarrollo en el login):

```bash
cd app && VITE_USE_EMULATORS=true VITE_DEMO_LOGIN=true VITE_FIREBASE_PROJECT_ID=comandas-charcuteria-demo npx vite
```

**Probar Bsale real sin token:** `npx tsx scripts/fake-bsale.ts` levanta un Bsale falso en `:4010` con la misma forma de la API. Con `functions/.env.local` = `BSALE_BASE_URL=http://127.0.0.1:4010` y `functions/.secret.local` = `BSALE_ACCESS_TOKEN=fake`, las funciones del emulador le hablan a él. Agregar `VITE_BSALE_MODE=real` al comando de la app. Las configuraciones de `.claude/launch.json` (`emulators`, `fake-bsale`, `app-emulators`, `app-emulators-real`) hacen todo esto.

**Tests de reglas** (11 casos: pedidos, reposición, consultor, usuarios, espejos de Bsale):

```bash
npm run test:rules:emu
```

---

## Arranque limpio del proyecto real

```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/reset-real.ts                                  # muestra qué borraría
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/reset-real.ts --confirm comandas-charcuteria   # borra
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/bootstrap-admin.ts ciro@lacharcuteriartesanal.cl "Ciro" superAdmin luisorsini7@gmail.com "Luis" superAdmin
```

Borra pedidos, bitácora, contadores, espejos de stock y clientes, el Bsale simulado y los usuarios `@charcuteria.demo`. Conserva el catálogo (destino del cruce; `--products` lo borra), la configuración y los usuarios reales. La seed de demo ya no corre contra el proyecto real.

---

## Deploy

```bash
npm run deploy                                                   # build + hosting
firebase deploy --only firestore:rules,firestore:indexes         # reglas + índices
firebase deploy --only functions --project comandas-charcuteria  # funciones (plan Blaze habilitado)
```

Tras cada deploy de hosting, los dispositivos ven el aviso **"Nueva versión disponible — Recargar"**.

---

## Habilitar Gemini (una sola vez)

Firebase AI Logic (`@firebase/ai`) llama a Gemini a través de `firebasevertexai.googleapis.com` con la API key web del proyecto **y un token de App Check**. Si falta cualquiera de las dos cosas, la app cae al parser determinista y muestra el aviso amarillo "Se usó el intérprete local". Sin App Check el proyecto responde `403 Firebase AI Logic has been deactivated… you must enforce Firebase App Check`: habilitar la API no alcanza.

Ya está hecho en `comandas-charcuteria` (23-09-2026). Para reproducirlo en otro proyecto:

1. **APIs**: `firebasevertexai.googleapis.com`, `aiplatform.googleapis.com`, `firebaseml.googleapis.com`.
   ```bash
   gcloud services enable firebasevertexai.googleapis.com aiplatform.googleapis.com --project comandas-charcuteria
   ```
2. **App Check con reCAPTCHA Enterprise**, todo por CLI (requiere `gcloud auth login` con una cuenta Owner/Editor):
   ```bash
   npm run appcheck:setup
   ```
   El script ([`scripts/appcheck-setup.mjs`](scripts/appcheck-setup.mjs)) es idempotente: habilita `recaptchaenterprise` + `firebaseappcheck`, crea (o reutiliza) la key *score* `comandas-appcheck-web` con dominios `comandas-charcuteria.web.app`, `comandas-charcuteria.firebaseapp.com` y `localhost`, la registra como proveedor de App Check de la web app, pone **Enforce solo en Firebase AI Logic** (`firebaseml.googleapis.com`; Firestore y Auth quedan sin enforcement para no romper clientes sin token) y escribe `VITE_RECAPTCHA_SITE_KEY` en `app/.env.production`. Se eligió Enterprise en vez de reCAPTCHA v3 clásico porque no requiere pegar una *secret key* en la consola y se administra por API.
   - La key recién creada tarda ~1 minuto en propagarse; hasta entonces el SDK loguea `AppCheck: 400 error` y reintenta solo.
   - `localhost` es dominio permitido, así que `npm run dev` funciona sin debug tokens. `VITE_APPCHECK_DEBUG=true` + `VITE_APPCHECK_DEBUG_TOKEN` quedan para CI/emuladores (registrar el token en *App Check → Apps → ⋮ → Manage debug tokens*).
3. `npm run deploy`. Verificar en Pedido IA que el chip diga **· Gemini** y no aparezca el aviso amarillo. La consola del navegador loguea `[parse] Gemini failed…` con la causa exacta cuando falla.

Costo aproximado al volumen del cliente (≈ 5 M tokens/mes, gemini-2.5-flash): USD 1–2/mes; entra en la cuota gratuita de Vertex AI. reCAPTCHA Enterprise: gratis hasta 10.000 evaluaciones/mes (un token de App Check dura 1 h, así que el equipo queda muy por debajo).

---

## Estructura

```
app/src/
  domain/        tipos, permisos (permissions.ts), kanban, cutoff, analytics, parse/
  data/          hooks Firestore, transacciones de pedido, auth, usuarios, bsaleOps, bsaleAdmin, catalogMap
  integrations/bsale/  BsaleClient (interfaz), MockBsaleClient + mockAdmin (simulado), RealBsaleClient (vía funciones)
  routes/        Login (landing), Tablero, vendedor/, despacho/, produccion/, clientes/, admin/, bsale/Explorador
functions/src/
  users.ts       claimInvite, adminInviteUser, adminUpdateUser, adminDeleteInvite
  bsale/         api, config, sync, diagnose, writes, index
  bsaleProxy.ts  GET de solo lectura
scripts/         seed (emuladores), bootstrap-admin, reset-real, fake-bsale, verify-*
tests/rules/     reglas por perfil
```

## Fuera de alcance (por ahora)

Pago de despachos, comisiones, metas y venta predictiva, cobranza vía Chipax, cuentas por pagar/cobrar, fotos como prueba de entrega, notificaciones push. La línea de producción (insumos, procesos, rendimientos) es la siguiente etapa del contrato.
