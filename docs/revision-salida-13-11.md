# Revisión para salida del viernes 13 de noviembre de 2026

## Diagnóstico del 11 de noviembre

- Los 40 RUT del listado de Gabriela existen tanto en Bsale como en Comandas. El filtro inicial «Mi cartera», la búsqueda de RUT sin normalizar y el contacto presentado como fantasía dificultan encontrarlos.
- Bsale tiene 5.979 clientes activos; 2.104 están vinculados en el espejo de Comandas. Hay 3.875 activos fuera del espejo debido al filtro de antigüedad/compras. Comandas contiene además 120 fichas locales/históricas, sumando 2.224.
- La API real confirma: `company` = razón social; `firstName` / `lastName` = persona/contacto. Los atributos adicionales presentes son «Vendedor» y «Direccion Entrega»; esta cuenta no tiene atributo de fantasía.
- Bilbao Restobar, Andar Café y Zulu tienen fichas fiscales existentes. Hay copias históricas sin RUT y algunas mezclan nombres. Andar/Ananda/Teluz quedan sin fusionar por acuerdo con Edmundo.
- La captura del horario corresponde a una validación ya flexibilizada en el código: se permite una hora o una nota. El video reproduce la diferencia entre selección manual y detección en mensajes cortos con IA.
- La nota de voz trata el mismo problema de Zulu, según confirmación de Edmundo; no se transcribió automáticamente.
- Las reservas de producción leídas coinciden con los pedidos abiertos. No había saldos comprometidos en el momento de la lectura.
- Producción está con integración de lectura habilitada, escrituras apagadas y simulacro activado. No se modificaron estos interruptores ni datos productivos durante el diagnóstico.

## Cambios implementados

1. Sincronizar todos los clientes activos; mantener los campos propios de Comandas y evitar resolver identidades ambiguas por RUT.
2. Separar contacto y nombre comercial. No escribir fantasía sobre `firstName`. Mantener el alias comercial en Comandas; permitir su edición aunque las escrituras a Bsale estén apagadas.
3. Abrir el directorio en «Todos», buscar RUT con/sin puntos o guion, ordenar coincidencias de Bsale primero y mostrar el contacto como tal. El directorio carga 100 filas visibles y permite mostrar más.
4. Revisar duplicados antes de crear y ofrecer seleccionar la ficha existente. Bsale también se consulta por RUT antes de un alta real.
5. Reconocer nombres de clientes en mensajes cortos incluso con el intérprete local («10 pastrami para andar cafe»). Ante empate, pedir selección. Respetar un RUT explícito contradictorio.
6. Elegir fábrica o tienda al tomar un pedido. Cada origen tiene su saldo y reserva independiente. Los pedidos anteriores siguen usando fábrica y las reposiciones salen de fábrica.
7. Validar el documento del POS en el servidor: vigente, factura/boleta, número, RUT cuando está presente y sucursal del pedido. Bloquear reutilización concurrente. Leer los saldos reales y liberar la reserva en la misma transacción; no descontar otra vez la venta.
8. Proteger los saldos de Bsale frente a escrituras de vendedores; evitar que una sincronización iniciada antes sobrescriba una lectura más reciente. Una variante sin filas de stock queda en cero.
9. Mostrar las reservas/disponibilidad de tienda y el origen del pedido en las pantallas operativas.

## Plan de reparación aplicado el 12-11-2026

`private/revision-2026-11-11/plan-reparacion.json` incluye los valores originales completos para revisión y reversión. Las cinco operaciones se aplicaron el 12-11 después de revalidar los documentos y guardar un respaldo. El pedido de Zulu ya estaba en armado: se conservaron su avance, armador e historial.

- Asignar «Lola Bar» como alias comercial de la ficha Bsale de Bilbao Restobar.
- Marcar las copias históricas de Lola y Zulu con su ficha canónica para retirarlas del selector de pedidos nuevos, conservando los registros históricos.
- Corregir el cliente del pedido abierto PED-2026-0004 a la ficha fiscal de Zulu, conservando líneas y reservas.
- Retirar «Fernando Pacheco» como fantasía del encabezado del pedido PED-2026-0002, conservando la razón social Domo Gastronómico.

Antes de aplicar, volver a leer cada documento y comprobar que coincide con el original del plan; si cambió, revisar el caso. No sobrescribir datos nuevos.

El cruce de los 40 clientes, las respuestas crudas y los respaldos están en `private/revision-2026-11-11/` (excluido de Git).

## Validación

- Build de app y funciones.
- 21 pruebas unitarias: mapeo, RUT, búsqueda, detección local, duplicados, reservas por origen y lógica existente.
- 35 pruebas en emulador: reglas y flujos, clientes antiguos, stock en cero, FIFO de tienda, vinculación sin doble descuento y dos pedidos intentando usar una misma factura.
- Sin pruebas de venta real ni de facturación tributaria en producción. Falta aceptación visual con usuarios después del despliegue autorizado.

## Secuencia de puesta en marcha

1. Revisar y autorizar despliegue de funciones, reglas y hosting y las cinco operaciones del plan.
2. Desplegar backend, reglas y app juntos; mantener la facturación en Bsale y sus interruptores actuales.
3. Forzar sincronización completa de clientes y stock. Revisar errores parciales y confirmar cobertura de 5.979 clientes activos (el total puede cambiar).
4. Aplicar el plan con comprobación de originales, conservando el respaldo y registrando quién lo aplica y cuándo.
5. Aceptación con Rafael y Gabriela: buscar por razón social, contacto y RUT; comprobar los 40 clientes del listado, Lola y Zulu; revisar las ambigüedades históricas sin crear fichas nuevas.
6. Aceptación de stock en fábrica y tienda: tomar un pedido, observar la reserva en otra sesión, editar/anular, facturar en la misma sucursal del POS, sincronizar y vincular. Confirmar que no se descuenta dos veces ni se vuelve a ofrecer stock ya facturado.

El POS de Bsale no conoce las reservas exclusivas de Comandas: una venta de mesón puede consumir stock comprometido. La app detecta el conflicto al leer Bsale; el equipo debe revisar el aviso. Mientras no se vincule una factura al pedido, puede mantenerse una reserva conservadora adicional. El enlace requiere intervención de administración; no se asignan facturas automáticamente por similitud de montos.

Muestras, producción y traslados conservan sus flujos e interruptores existentes; si las escrituras están apagadas, la oficina debe registrar sus movimientos pendientes en Bsale. No habilitar facturación desde Comandas durante esta salida.

Documentación primaria consultada: https://apichile.bsalelab.com/lista-de-endpoints/clientes (campos y expansión de atributos/contactos), contrastada con GET de la cuenta real.

## Despliegue de prueba del jueves 12-11-2026

Autorizado por Edmundo para probar con el equipo antes de la sesión de ajustes de la noche.

- Cuenta de Firebase y gcloud: `edmundo@spohr.cl`.
- Proyecto explícito: `comandas-charcuteria`, número `38015945283`.
- Hosting remoto y configuración del build: `comandas-charcuteria.web.app`, app `1:38015945283:web:dc4efa199eb001f2afe2f6`; Bsale real y emuladores desactivados.
- Despliegue de funciones, reglas y hosting terminado correctamente. Se creó `bsaleLinkDocument`.
- Verificación posterior: el HTML y cuatro archivos principales publicados coinciden con el build local; la nueva función rechaza peticiones sin sesión con HTTP 401.
- Compilaciones correctas y 56 pruebas aprobadas (21 unitarias, 35 de reglas y flujos en emulador). Las unitarias también quedan incluidas en CI.
- Reparaciones aplicadas en una transacción, con respaldo de los originales y comprobación contra cambios concurrentes.
- Las respuestas de despliegue, verificaciones y respaldos quedan en `private/revision-2026-11-11/`, fuera del repositorio.

No se borraron pedidos de prueba ni historial. Andar/Ananda/Teluz siguen separados hasta aclarar su identidad. La aceptación funcional con Rafael, Gabriela y despacho queda a cargo del equipo sobre esta versión publicada.

Verificación de datos posterior al despliegue: 5980 fichas vinculadas a Bsale, 6099 registros de clientes en total y los 40 RUT del listado de Gabriela presentes. Las cinco reparaciones coinciden con el plan. Escrituras a Bsale apagadas, simulacro activado y emisión de facturas desde Comandas deshabilitada. La sincronización de stock terminó sin formatos comprometidos.
