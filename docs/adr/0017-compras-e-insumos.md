# ADR-0017 — Compras e insumos: recepción con el celular escaneando el documento y las etiquetas

- **Estado:** Aceptada (prototipo, solo super administración)
- **Fecha:** 03-11-2026

## Contexto

El contrato pide registrar los insumos de entrada desde las facturas y guías de compra (ítem I-1) y medir el tiempo que toma registrar un documento (KPI-3). Esto es la base del costo real y del rendimiento por proceso (KPI-1 y KPI-2). Hoy no hay compras en Comandas: la materia prima no se registra en ninguna parte.

Lo que más importa son los productos cárnicos. Llegan a la fábrica en cajas rotuladas y con una factura o una guía de despacho. Decisiones de Edmundo (03-11):
- **Los insumos se crean a medida que se registran.** No hay un catálogo previo. Más adelante habrá una carga masiva del inventario inicial.
- **Bsale no recibe las compras.** En Bsale entra solo el stock de venta (producto terminado). El stock de insumos vive en Comandas.
- **Cualquiera de la fábrica recibe.** Durante el prototipo, la pantalla queda solo para super administración, para depurarla con etiquetas reales en la fábrica.

## Decisión

Una pantalla, **Compras** (`/compras`), con la recepción en tres pasos, más el historial, el stock de insumos y un laboratorio de escaneo.

### 1. Documento

- **El timbre electrónico** (PDF417) de la factura (33/34) o la guía (52) trae el RUT del emisor, el tipo, el folio, la fecha y el monto total ([`domain/ted.ts`](../../app/src/domain/ted.ts)). Leerlo no usa IA y no tiene errores de lectura.
- **Las líneas** (descripción, cantidad, unidad, precio) no están en el timbre: las lee Gemini desde una foto del documento. La foto también intenta leer el timbre a máxima resolución, porque el PDF417 es denso y en video a veces no se lee.
- **Foto o archivo:** el documento se puede fotografiar o elegir desde el teléfono o el computador (fotos de la galería o PDF, varias páginas). Un PDF se dibuja página a página con `pdfjs-dist` para buscar el timbre, y Gemini lo recibe tal cual.
- **Sin documento** (decisión de Edmundo, 03-11): una compra o un insumo nuevo se puede registrar sin factura ni guía (`docKind: 'ninguno'`, id `SD-…`, proveedor opcional). El cuadre con el documento es opcional en todos los casos. Los insumos también se crean directo en «Stock de insumos».
- **El documento se guarda** (decisión de Edmundo, 03-11): cuando hay factura o guía, se recomienda adjuntar la foto o el PDF, que también se puede agregar después. Se sube a Cloud Storage en `purchases/{id}/…` (foto reducida a JPEG de 2.400 px, PDF tal cual, hasta 14 MB) y queda en `purchases/{id}.documents` para consultarlo en el historial. A una compra ya registrada se le pueden agregar más archivos, nunca quitar ni reemplazar.
- **Sin duplicados:** el id de la compra es `RUT-tipo-folio`. La compra se crea en una transacción que falla si ya existe.
- **Factura de una guía ya recibida:** se registra con «cobra mercadería que llegó con guía» y no suma stock.

### 2. Cajas

- **Escaneo continuo** con `zxing-wasm`, que funciona en Android y en iPhone (Safari no trae `BarcodeDetector`). Lee Code 128, GS1 DataBar, DataMatrix, QR y EAN.
- **GS1-128** ([`domain/gs1.ts`](../../app/src/domain/gs1.ts)) entrega:
  - (01) el GTIN;
  - (310n) el peso neto en kg, o (320n) en libras;
  - (10) el lote;
  - (11), (13) y (17) las fechas de producción, envasado y vencimiento;
  - (21) la serie, que detecta una caja escaneada dos veces.
- **EAN-13 de peso variable** (prefijo 2): la posición del peso depende de la balanza del proveedor. Se lee como «peso supuesto» y la app pide confirmarlo.
- **La primera vez que aparece un código**, la app pregunta qué insumo es y lo recuerda: guarda el código en `supplies/{id}.codes`.
- **Sin código legible:** foto de la etiqueta para que la lea Gemini, o el peso escrito a mano.

### 3. Confirmación (cuadre opcional)

- Por insumo, se comparan los kilos del documento con los kilos escaneados, y se marcan las diferencias.
- Cada línea del documento se asocia a un insumo. La descripción queda como alias para sugerirla la próxima vez.
- **Costo por kg** = total de las líneas del insumo ÷ kg del documento (neto, sin IVA).
- Se confirma con el PIN (`confirmPin('compra', id)`).

### Datos

| Colección | Qué guarda | Escritura |
|---|---|---|
| `suppliers/{rut}` | Proveedor: RUT y nombre | Se crea en la primera compra |
| `supplies/{id}` | Insumo: nombre, tipo (carne u otro), unidad (kg o unidad), códigos y alias | Se crea al recibir |
| `purchases/{RUT-tipo-folio}` | Compra: cabecera, líneas del documento, cajas, resumen por insumo, documentos y quién la recibió | Solo se crea; después solo se le agregan documentos |
| Storage `purchases/{id}/*` | Foto o PDF del documento | Solo se crea, nunca se reemplaza ni se borra |
| `supplyLots/{id}` | Lote de insumo: kg, lote, vencimiento, costo por kg y compra de origen (`origin: 'compra'`) | Solo se crea |
| `scanTests/{id}` | Laboratorio: lectura cruda, formato y resultado del intérprete | Solo se crea |

El stock de un insumo es la suma de sus lotes. Todavía no hay consumo.

### Permisos

- Capacidad `purchase.receive`, hoy solo superAdmin. El helper `canReceivePurchases()` de `firestore.rules` replica la matriz (DT-02).
- Para abrirlo a la fábrica, basta con agregar los perfiles en los dos lugares.

## Lo que viene después

1. **Depurar con etiquetas reales** en la fábrica, usando el laboratorio. `scripts/export-scan-tests.ts` baja las lecturas para ajustar el intérprete.
2. **Abrir la recepción** a producción y despacho.
3. **Carga masiva del inventario inicial**, como lotes con `origin: 'inventario'`.
4. **Consumo:** al registrar producción, Yury declara qué insumos usó y cuántos kg. Se descuentan por lote, del más antiguo al más nuevo (FIFO), con `supplyMovements`, y eso da el costo real por kg producido. Después vienen las recetas y los rendimientos por proceso, para calcular la merma.
5. **Documento electrónico:** leer el XML del DTE (correo de intercambio o registro de compras del SII). Daría las líneas exactas sin depender de la foto.

## Consecuencias

- Una dependencia nueva, `zxing-wasm` (~1 MB de wasm). Se descarga solo al abrir Compras y queda servida desde el hosting, sin CDN.
- Es el primer uso de Cloud Storage en el proyecto: `storage.rules` (solo superAdmin, hasta 15 MB, imágenes y PDF) y el emulador de Storage. En producción hay que activar Storage en la consola de Firebase antes de publicar las reglas.
- El borrador de la recepción guarda los archivos en IndexedDB del teléfono, para que no se pierdan si la pantalla se apaga.
- Las fotos de etiquetas que lee Gemini no se guardan; solo el documento tributario.
- La lectura del timbre depende de la impresión: si el papel térmico está gastado, la foto y la escritura a mano son el respaldo.

## Actualización 06-11-2026: compras separadas de la recepción

A partir de la visita del 05-11, compra y recepción quedan separadas:

- **Administración crea la compra.** Gabriela y Miguel (perfil administración) y los superAdmin registran lo que compraron en `purchaseOrders/*`: proveedor, fecha en que llega y, por insumo, la cantidad en kg o unidades (precio opcional). La compra queda «por recibir».
- **La fábrica recibe contra la compra.** Producción, despacho y superAdmin reciben con el flujo de siempre (documento → cajas → confirmar). La recepción se liga a la compra (`purchase.orderId`) y suma lo recibido por insumo en la misma transacción.
- **Entregas parciales.** La compra queda «parcial» hasta completarse. Cada insumo se da por completo con el 98 % de lo comprado. Si el proveedor no entregará el resto, administración la cierra con la diferencia («cerrada»). Una compra sin recepciones se puede anular.
- **Recepción sin compra.** Sigue permitida, para lo que llega sin compra registrada.
- **Permisos** (`firestore.rules` y `storage.rules`):
  - `canReceivePurchases` = producción, despacho y superAdmin.
  - `canOrderPurchases` = administración y superAdmin.
  - Administración y el consultor leen todo.
  - Quien recibe solo puede cambiar lo recibido, las recepciones y el estado (a parcial o recibida).
- **Laboratorio.** Queda solo para superAdmin.
