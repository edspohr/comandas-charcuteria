# Cierre técnico: compras, insumos y producción

Implementación local del 16-11-2026. No modifica configuración ni datos productivos.

## Flujo

1. Compras mantiene el flujo existente de compra y recepción (factura/guía, cajas, lotes, costos netos y adjuntos).
2. Administración puede registrar existencias iniciales desde Stock de insumos. La operación exige PIN en servidor y conserva un identificador para reintentos.
3. Producción inicia una elaboración indicando proceso e insumos. El servidor consume saldos FIFO de lotes sin vencer en una transacción. Compra, lotes y movimientos conservan su identidad.
4. Al terminar carga productos, formatos, cantidades y kilos obtenidos. El cierre y productionLog se escriben en una transacción; el reintento no crea otra carga.
5. La recepción de producto terminado en Bsale conserva los interruptores existentes. Con escrituras apagadas/simulacro queda pendiente; con escrituras reales hay un único intento, identificado con EL-{batchId}. Un resultado incierto exige conciliación manual, nunca reenvío automático. El stock de producto terminado se lee de Bsale, no se incrementa también en el navegador.
6. Los resultados muestran rendimiento, diferencia de peso y costo neto de insumos. Costos faltantes no se convierten en cero. El CSV distribuye el costo entre los productos resultantes proporcionalmente a sus kilos. No incluye mano de obra ni energía.

Las cargas directas anteriores con planilla/foto siguen disponibles y se identifican expresamente como cargas sin consumo de insumos. Para cerrar una elaboración se utiliza su botón Cargar producción.

## Correcciones operativas

- Familias comerciales independientes de categorías heredadas de presentación; búsqueda por nombres de variantes.
- Catálogo permite agregar una variante Bsale como formato nuevo de un producto existente, conservando identificadores e historia. Los cruces específicos de la cuenta se revisan y completan en Catálogo → Cruce con Bsale; no se inventan equivalencias por similitud.
- Autoasignación de clientes sin dueño, protegida frente a cambios concurrentes y sin acceso a reasignar otra cartera.
- Formatos sugeridos desde el historial válido del cliente, sin agregar cantidades automáticamente. Repetir último excluye anulados/borrados y considera el cliente aunque cambie el vendedor.
- Instrucciones de primer ingreso, estados vacíos y ayuda actualizados.

## Verificación

- 31 pruebas unitarias.
- 44 pruebas de reglas/servicios en Firestore emulado, incluyendo concurrencia, devoluciones, cierre y envío únicos, timeout externo, permisos y PIN en servidor.
- 8 flujos de pedidos con SDK y Auth/Firestore emulados.
- Compilación de app/PWA y funciones; git diff --check.

Bsale es ficticio en las pruebas; no se emitieron documentos ni se cambiaron existencias reales. No se hizo despliegue.

## Publicación

Publicar funciones, reglas y hosting de la misma revisión. Nuevas funciones: productionStart, productionClose, productionCancel, productionSendToBsale, productionMarkManual y supplyInitialStock. Mantener los interruptores actuales de Bsale: esta entrega no autoriza su activación automática. Las colecciones nuevas son productionBatches y supplyMovements; los lotes antiguos sin consumedKg/consumedUnits empiezan con consumo cero. No se requiere migración destructiva.

Fuera de esta entrega: cobranza, cotizaciones, recetas completas y nuevas funciones comerciales.
