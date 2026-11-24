# Investigación de direcciones en Bsale — 12-11-2026

## Conclusión y límites

El repositorio contiene riesgos de sobrescritura de datos de clientes, pero no se encontró una rutina de borrado masivo de direcciones ni evidencia que vincule esos riesgos con los casos reportados. Las escrituras actuales están apagadas. La comparación entre el respaldo del 11-11 a las 16:48 y la lectura del 12-11 no detectó vaciados nuevos del campo principal `address` en los 5.979 clientes originales; los seis vacíos ya existían. Esto no prueba el estado anterior al respaldo ni cubre las direcciones adicionales.

Las fechas siguientes son fechas de commits; no prueban cuándo se desplegó o ejecutó cada versión. No se modificaron datos productivos ni código de ejecución durante este análisis.

## Historial relevante

| Commit | Fecha | Cambio e implicación |
| --- | --- | --- |
| `e61394e` | 23-09 | Proxy Bsale que aceptaba GET/POST/PUT sobre clientes para usuarios autenticados, sin interruptores ni bitácora de escrituras actual. El código lo describía como pendiente de desplegar. No se ha acreditado que esta versión operara en producción. |
| `7421288` | 19-10 | Proxy pasa a sólo GET; altas y ediciones se hacen en funciones específicas con interruptores y bitácora. Defaults: escrituras apagadas, simulacro encendido. |
| `e450828` | 04-11 | Se infieren comuna y ciudad a partir de la dirección, usando Santiago por defecto. Se aplica tanto al alta como a la edición. |
| `de0ec0d` | 06-11 | El editor deja de llamar a Bsale cuando las escrituras están apagadas; sólo guarda datos propios de Comandas. El servidor ya rechazaba las escrituras deshabilitadas. |
| `118fbf9` | 12-11 | Se deja de escribir el nombre comercial sobre `firstName` (contacto); se previenen altas con RUT existente. No añade borrado de direcciones. |
| `aa8d766` | 12-11 | Cambios de concurrencia, precios y origen de stock. No modifica las rutas de escritura de clientes Bsale. |

## Hipótesis técnicas

### 1. Reenvío de una dirección antigua al guardar otro campo

`EditarClienteDialog` inicializa el formulario con el espejo local. `updateClientAdmin` construye y envía nombre, RUT, giro, dirección, teléfono y correo completos, aunque sólo se haya cambiado uno. `updateClient` no consulta primero la ficha actual de Bsale ni compara una versión o fecha.

Si una dirección se corrigió directamente en Bsale y alguien guardó un formulario antiguo de Comandas, con escrituras habilitadas y sin simulacro, podría reponer la dirección anterior. Está demostrado por el flujo de código; no se ha demostrado su ejecución en producción. No explica por sí mismo un `address` vacío: el parser actual elimina cadenas vacías del payload.

Fuentes: `app/src/components/clients/EditarClienteDialog.tsx`, `app/src/data/clients.ts:224`, `functions/src/bsale/writes.ts:145`.

### 2. Sobrescritura de comuna y ciudad por Santiago

`bsaleLocality` reconoce un conjunto de comunas de la Región Metropolitana sólo en segmentos posteriores a una coma. Ante otra localidad, o una dirección sin ese formato, usa Santiago. El editor no conserva comuna y ciudad como campos independientes; al reenviar una dirección recalcula esos datos.

Reproducción local usando el generador actual de payload: `Dirección antigua 123, Valparaíso` produce `address` con ese texto, pero `municipality: Santiago` y `city: Santiago`. Una dirección válida puede quedar geográficamente incorrecta. No borra la calle. Sin evidencia de que se haya enviado a producción.

Fuentes: `functions/src/bsale/comuna.ts`, `functions/src/bsale/writes.ts:117`.

### 3. Confusión entre dirección principal, despacho y dirección concatenada

El alta rápida pide «Dirección de entrega» y la envía al campo principal `address` del cliente de Bsale. La lectura concatena calle, comuna y ciudad en un único campo local. Las direcciones adicionales de Bsale no se integran en esa ficha. Al editar y reenviar la copia local, la dirección principal puede recibir el texto concatenado; incluso una ficha sin calle puede mostrar sólo comuna y ciudad como si fuera una dirección.

Esto puede explicar diferencias entre pantallas o entre dirección tributaria y despacho, y sobrescrituras de contenido si se activan escrituras. No hay llamadas de producción a DELETE/PUT de `/clients/{id}/addresses/{id}.json` en el código revisado.

Fuentes: `app/src/components/clients/NuevoClienteDialog.tsx:66`, `functions/src/bsale/customers.ts:16`, `functions/src/bsale/writes.ts:124`.

### 4. Proxy histórico sin auditoría actual

Antes de `7421288`, `RealBsaleClient.updateClient` enviaba PUT vía `bsaleProxy`. Ese proxy no generaba registros en `bsale/writes/log`. Por eso una bitácora vacía hoy no permite descartar una operación histórica realizada mediante esa versión, si alguna vez estuvo desplegada y con token operativo. Además, aquel mapeo confundía `activity` con fantasía y utilizaba `giro` como campo separado. Son defectos históricos de mapeo, no evidencia de borrado de dirección.

Para sostener esta hipótesis se requiere la fecha de afectación y evidencia de despliegue/uso de ese proxy. Los comentarios históricos dicen que aún no estaba desplegado; no se debe asumir que llegó a operar.

### 5. Ventana entre escritura remota y registro de auditoría

`send` llama a Bsale y después escribe la bitácora. Si Bsale aceptó el cambio y el proceso terminó o perdió acceso a Firestore antes del registro, podría faltar el comprobante. El catch intenta registrar el error, pero no cubre una terminación del proceso ni un fallo persistente de Firestore. Es una limitación de auditoría, no una causa autónoma de borrado.

Fuente: `functions/src/bsale/writes.ts:26`.

## Evidencia contraria a un borrado directo desde la versión actual

- `parseCustomer` transforma dirección vacía o espacios en `undefined`; `clientBody` excluye esos valores. No genera `address: null` ni `address: ''` por ese camino.
- No se encontró rutina automática que recorra clientes haciendo PUT/DELETE para vaciar direcciones. Cron y webhooks leen Bsale y actualizan Firestore.
- El importador de WhatsApp escribe clientes y pedidos en Firestore; no envía esas direcciones a Bsale.
- La vinculación de documentos existentes no edita clientes. La emisión desde Comandas usa `clientId` cuando está vinculado; la creación embebida es otro camino sujeto a sus interruptores.
- El simulador Bsale fusiona el PUT con `Object.assign`; sus pruebas no demuestran cómo trata Bsale real los campos omitidos. No se hicieron escrituras reales para comprobarlo.
- La documentación del repo es contradictoria sobre encender escrituras el 04/05-11; el backlog posterior dice que permanecieron apagadas. Esas notas no sustituyen un historial de configuración.

## Próxima verificación y mitigaciones

Con los nombres/RUT de Miguel: cotejar cliente principal, direcciones adicionales activas/inactivas, documentos antiguos y fecha aproximada del problema. Solicitar a Bsale auditoría interna con origen de la operación, usuario o integración, fecha y valores anteriores/posteriores. Si la hipótesis apunta a septiembre/octubre, verificar despliegues y logs históricos del proxy.

Antes de activar escrituras: enviar sólo campos realmente modificados; conservar calle, comuna y ciudad por separado; no recalcular localidad durante una edición ajena a esos campos; comparar contra la versión vigente en Bsale; registrar intento antes del envío y resultado después, incluyendo estado anterior y posterior. Mantener direcciones tributarias y de despacho separadas.

Evidencia local: `private/address-audit/` contiene snapshots, comparación, manifest con hashes y `payload-reproduction.json`. El análisis y las reproducciones no alteran Bsale.

## Investigación ejecutada después de autorizar el plan

- Se leyó la colección productiva `pinLog`: 80 eventos entre el 24-10 y el 12-11; ninguno con acción que contenga `bsale`. Las rutas de edición/alta exigen confirmación de PIN cuando pueden escribir. Esto debilita la hipótesis durante el periodo cubierto, pero no cubre el proxy antiguo ni versiones anteriores a la exigencia de PIN. La auditoría de PIN es asíncrona; tampoco sustituye la auditoría de Bsale.
- Se revisó la configuración actual y sus metadatos: el documento fue creado el 19-10; escrituras apagadas y simulacro encendido al leerlo. Su fecha de actualización no conserva la historia de cada interruptor.
- Se encontró `private/bsale-probe.json`, lectura del 19-10-2026 a las 15:32 UTC. Sólo contiene dos clientes (IDs 1 y 2); calle, comuna y ciudad siguen iguales en la lectura actual. No es un respaldo completo de octubre.
- Los scripts de limpieza revisados eliminan datos de Firestore/Auth, no direcciones en Bsale. `reset-real.ts` conserva la rama de bitácoras `bsale/*`. No se ejecutaron scripts de limpieza.
- Los snapshots anteriores y las notas de operación contienen señales de escrituras apagadas, pero no acreditan continuidad ininterrumpida de esa configuración.
- La lectura de Cloud Logging quedó pendiente: gcloud exige reautenticación; la cuenta de servicio existente devuelve 403 por falta de acceso a vistas de logs. No se ampliaron permisos. Se solicitó renovar la sesión de gcloud para continuar con la cronología de despliegues y llamadas. Un intento de usar la sesión existente de Firebase también fue rechazado por credencial inválida.
- Se preparó un borrador local de solicitud a soporte de Bsale (`private/address-audit/solicitud-soporte-bsale.txt`); no se envió. Faltan los clientes y el intervalo para concretarlo.

Estado: hipótesis no confirmada ni descartada globalmente. Pendientes imprescindibles: ejemplos de Miguel, logs históricos disponibles y auditoría de Bsale para atribuir una operación. Los riesgos reproducidos se corregirían antes de habilitar escrituras, pero no se deben presentar como causa del incidente sin esa atribución.

## Cloud Logging revisado tras renovar la sesión

Se consultaron los logs del proyecto explícito `comandas-charcuteria`, sin operaciones de escritura. La extracción principal contiene 925 registros y no alcanzó el límite de 20.000. Una búsqueda adicional por recurso `cloud_function` encontró 102 registros administrativos, sin ejecuciones adicionales. La búsqueda de ciclo de vida se extendió desde el 01-09.

### Fechas y llamadas observadas

- Primeras creaciones registradas de `bsaleProxy`, `bsaleCreateClient` y `bsaleUpdateClient`: **19-10-2026 03:21 UTC** (00:21 en Santiago). Se encontraron tanto inicio como término exitoso de la creación. No se encontraron creaciones/eliminaciones anteriores de esos nombres en la consulta desde septiembre.
- `bsaleEmitInvoice` fue creada el **19-10-2026 17:49 UTC**.
- **Cero solicitudes HTTP registradas** a `bsaleUpdateClient`, `bsaleCreateClient` y `bsaleEmitInvoice` en el periodo consultado. Los logs de esos servicios contienen arranques/despliegues, no ejecuciones de solicitudes.
- `bsaleProxy` tiene dos solicitudes callable POST exitosas: **19-10 17:10:57 UTC**, revisión `bsaleproxy-00005-zek`, y **21-10 02:05:55 UTC**, revisión `bsaleproxy-00006-kay`; además sus respectivos OPTIONS. El POST es el transporte de la función callable, no prueba de un POST/PUT hacia Bsale. Los logs no incluyen el payload de estas dos llamadas.
- La retención actual del bucket `_Default` es **30 días**, suficiente para abarcar desde el 19-10 hasta esta revisión del 12-11. El sink `_Default` no tiene exclusiones configuradas que eliminen logs de solicitudes de estos servicios. Esto describe la configuración actual, no una historia de todas sus modificaciones.

### Código efectivamente desplegado

Se recuperó el paquete fuente histórico del proxy del **05-11**, generación `1793844237043965`, del bucket `gcf-v2-sources-38015945283-us-central1`. Se inspeccionaron tanto TypeScript como JavaScript compilado: despacha únicamente `.get(path)` y no contiene despacho de PUT. Se respaldó localmente el paquete.

El primer build exitoso es `a2245a36-156c-4633-9d95-0d13715cfe0f` (19-10 03:20 UTC), reutilizado al crear el proxy, con hash Firebase `cc22d2ef507605dfba652224b0c83ee1650c2cc1`. Se recuperaron sus metadatos, pero la generación exacta de su fuente (`parseOrder/function-source.zip#1792380013075426`) ya no existe en el bucket. Por tanto no se pudo certificar byte a byte el proxy de las dos llamadas de octubre. El repositorio pasa a proxy de sólo lectura antes de la primera creación registrada, pero el orden de commits no sustituye el paquete fuente faltante.

### Conclusión actualizada

**No se encontró una operación que sostenga que Comandas borró las direcciones. La hipótesis de borrado por las funciones específicas de clientes queda fuertemente debilitada:** no hay solicitudes registradas desde su creación, ni escrituras en bitácora, ni confirmaciones de PIN de Bsale. El riesgo del proxy anterior al 19-10 no tiene evidencia de despliegue previo en este proyecto. Las dos llamadas de octubre al proxy y la falta de su paquete exacto se mantienen como un límite de atribución, no como evidencia de borrado.

No se declara una exoneración absoluta sin los casos de Miguel y la auditoría de Bsale: faltan dirección/campo afectado y momento del cambio, y podrían intervenir otras integraciones o escrituras directas fuera de estas funciones. El siguiente paso es contrastar esos casos con Bsale y documentos anteriores; no restaurar en bloque a partir del maestro actual.

Corrección del incidente: aún no hay causa confirmada que permita proponer una reparación específica. Si Bsale atribuye el cambio a Comandas, se restaurarán sólo los campos afectados desde valores anteriores verificables y se corregirá la ruta/payload identificado antes de volver a habilitarla. Los defectos de localidad y formularios antiguos documentados siguen siendo mitigaciones preventivas, no causas probadas de este incidente.

Nuevas evidencias locales: `cloud-history.json`, `gen1-history.json`, `function-lifecycle.json`, `log-retention.json`, `log-sink-default.json`, `first-build-full.json`, `proxy-source-2026-11-05.zip` y copias del código desplegado, dentro de `private/address-audit/`.
