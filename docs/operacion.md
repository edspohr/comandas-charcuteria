# Operación (runbook)

Cómo desplegar, probar y operar Comandas. Actualizado al 24-10-2026.

## Proyectos

| | Producción | Staging |
|---|---|---|
| Proyecto Firebase | `comandas-charcuteria` | `comandas-staging` (alias `staging`) |
| URL | <https://comandas-charcuteria.web.app> | <https://comandas-staging.web.app> |
| Bsale | real (`VITE_BSALE_MODE=real`) | simulado (`bsaleMock`) |
| Login | invitación + PIN | además, tarjetas de demo (`VITE_DEMO_LOGIN=true`, clave `demo1234`) |
| Build | `app/.env.production` | `app/.env.staging` (gitignored), `vite build --mode staging` |
| Datos | reales; solo auditorías de lectura desde la terminal | seed: `SEED_TARGET=staging npx tsx scripts/seed.ts` |

## Deploy

1. Probar en staging:
   ```bash
   cd app && npx tsc --noEmit && npx vite build --mode staging && cd ..
   firebase deploy --only hosting --project staging
   ```
   Si cambian reglas o funciones: `firebase deploy --only firestore:rules,functions --project staging`.
2. Producción, por partes:
   ```bash
   firebase deploy --only firestore:rules --project comandas-charcuteria     # si cambiaron reglas (antes que el hosting)
   firebase deploy --only functions --project comandas-charcuteria          # si cambiaron funciones
   npm run deploy                                                           # build + hosting
   ```
   Las reglas van **antes** que el hosting cuando la app nueva escribe en una colección nueva.
3. Verificar en el teléfono. Hosting sirve `index.html`, `sw.js` y el manifest con `no-cache`; aun así, un dispositivo con la versión anterior abierta ve «Nueva versión disponible — Recargar». Si algo no aparece, cerrar la pestaña o la app y volver a abrir.
4. Actualizar la landing (`Login.tsx`) y la Guía de uso (`Ayuda.tsx`) si cambió algo visible.

Si la CLI responde con errores de autenticación: `firebase login --reauth`. Para los scripts con Admin SDK: `gcloud auth application-default login`.

## Usuarios y PIN

- **Agregar persona:** Usuarios → «+ Agregar persona», con Google o con contraseña. A quien usa contraseña le llega un correo para crearla.
- **Persona que ya vendía por WhatsApp:** usar **«Invitar con su historial»**, que trae sus pedidos y su cartera desde el placeholder `wa-*`. Si se usó «Agregar persona» por error, se puede fusionar con un script (como se hizo con Elizabeth el 24-10).
- **PIN:**
  - cada persona lo crea en su primer ingreso;
  - si lo olvida o se bloquea (5 fallos = 15 minutos; 10 = desactivado), un superAdmin lo **borra** en Usuarios;
  - la persona entra con Google o contraseña y crea uno nuevo.
- **Desactivar a alguien:** Usuarios → la persona → desactivar. No se borra: sus pedidos quedan a su nombre.
- **Auditoría del PIN:** colección `pinLog`, legible por superAdmin y consultor.

## Interruptores de Bsale

Están en Conexión Bsale → Configuración (`settings/bsale`). Estado al 24-10:

| Campo | Valor | Efecto |
|---|---|---|
| `enabled` | `true` | sincronización activa (cron cada 10 minutos de 06:00 a 23:00 + webhooks) |
| `writesEnabled` | `false` | Comandas no escribe en Bsale |
| `dryRun` | `true` | al encender las escrituras, se registran sin enviarse |
| `invoicesEnabled` | sin valor | facturar desde Comandas apagado: POS + vincular |
| `factoryOfficeId` / `storeOfficeId` | `1` / `2` | fábrica «MARCOSI (SALA DE PROCESO)» / tienda «LA CHARCUTERIA» |

En `settings/app`:
- `stockMode`: sin valor equivale a informativo;
- `clientHealth`: `{ activoDias: 14, riesgoDias: 30 }`;
- `cutoffHour`: 15;
- `kanban`: umbrales de los avisos en rojo.

**Encender una escritura:**
1. `writesEnabled = true` con `dryRun = true`.
2. Revisar la Bitácora (Conexión Bsale → Bitácora, `bsale/writes/log`) durante unos días.
3. `dryRun = false`.

El orden recomendado está en [backlog.md](backlog.md#encendido-gradual-de-escrituras-a-bsale).

**Mientras estén apagadas, la oficina replica en Bsale:**
- producción «Por cargar en Bsale»: Producción → Cargado hoy → «Ya la cargué en Bsale»;
- traslados a tienda;
- consumos de muestras, con referencia `MU-pedido`;
- clientes nuevos «por revisar».

**Token:** Secret Manager `BSALE_ACCESS_TOKEN`. Para rotarlo:
```bash
printf "TOKEN" | gcloud secrets versions add BSALE_ACCESS_TOKEN --data-file=- --project=comandas-charcuteria
firebase deploy --only functions --project comandas-charcuteria
```
Nunca pegar el token en un chat, un commit o un archivo del repo.

## Gemini y App Check

Firebase AI Logic llama a Gemini con la API key web **y** un token de App Check (reCAPTCHA Enterprise). Sin cualquiera de los dos, el texto cae al intérprete local («Se usó el intérprete local») y la foto falla.

En producción quedó listo el 23-09. Para otro proyecto (staging incluido):
1. Consola Firebase → AI Logic → **Get started**. O bien:
   ```bash
   gcloud services enable firebasevertexai.googleapis.com aiplatform.googleapis.com firebaseml.googleapis.com --project <proyecto>
   ```
2. `npm run appcheck:setup` ([`scripts/appcheck-setup.mjs`](../scripts/appcheck-setup.mjs)) crea la key `comandas-appcheck-web`, la registra y exige App Check **solo** en AI Logic. Hoy apunta a producción; para staging hay que parametrizar el proyecto y los dominios.
3. La key nueva tarda ~1 minuto en propagarse. La consola del navegador muestra `[parse] Gemini failed…` o `[produccion-ia] Gemini failed…` con la causa.

## Scripts

Todos se corren desde la raíz. Los que tocan producción piden `--confirm comandas-charcuteria` o un flag explícito.

| Script | Para qué | Estado |
|---|---|---|
| `seed.ts` | datos de demo (emuladores o `SEED_TARGET=staging`); se niega a correr contra producción | vigente |
| `bootstrap-admin.ts` | primeros superAdmins | vigente |
| `reset-real.ts` | arranque limpio de producción (`--confirm`) | usado 19-10 |
| `bsale-probe.ts` | lecturas GET para verificar la forma de la API | vigente |
| `bsale-load.ts` | carga inicial: diagnóstico, cruce, productos faltantes, precios | aplicado 19-10 |
| `fake-bsale.ts` | Bsale falso en `:4010` para emuladores | vigente |
| `import-whatsapp.ts` | historial de pedidos de WhatsApp (idempotente) | aplicado 19-10 |
| `golive-clean.ts` | archivó el historial de WhatsApp y anuló los 9 abiertos | aplicado 23-10 |
| `catalog-golive.ts` | 13 cruces y 22 productos `sellable:false` | aplicado 23-10 |
| `migrate-claims.ts` | copia `users.role` al claim | aplicado |
| `appcheck-setup.mjs` | App Check para Gemini | aplicado (producción) |
| `setup-alerts.sh` | alerta por correo ante errores de las funciones de Bsale | **pendiente** |
| `verify-*.ts` | verificaciones manuales de datos, parser y Gemini | vigente |

Las auditorías ad hoc van en `private/` (gitignored), nunca en `scripts/`.

## Problemas conocidos y solución

| Síntoma | Causa | Solución |
|---|---|---|
| La app no muestra un cambio recién desplegado | service worker o pestaña con la versión anterior | tocar «Recargar» o cerrar y abrir; los headers ya evitan la caché larga |
| «Correo o PIN incorrecto» aunque el PIN es correcto | PIN bloqueado 15 minutos o desactivado | esperar, o pedir a un superAdmin que borre el PIN |
| «Las escrituras hacia Bsale están desactivadas» | `writesEnabled = false` | esperado; la producción queda «Por cargar en Bsale» |
| Pedido «por aprobar» que no se puede armar | excepción sin aprobar | superAdmin aprueba en el Tablero |
| `AI/api-not-enabled` en consola | AI Logic sin habilitar en ese proyecto | ver «Gemini y App Check» |
| `CONFIGURATION_NOT_FOUND` al ingresar | Authentication no habilitado en el proyecto | Consola → Authentication → Get started |
| Texto invisible en algún menú | tono de color que no existe en `tailwind.config.ts` | agregar el tono a la paleta |
| No se puede forzar el cron de sincronización | la cuenta de servicio no tiene permisos de Scheduler | usar «Sincronizar» en la app o esperar el cron |
| Tests de reglas chocan con otro proyecto | emuladores de otro proyecto en los mismos puertos | `npm run test:rules:emu` levanta los emuladores propios |
