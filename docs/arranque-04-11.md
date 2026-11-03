# Arranque con el equipo — miércoles 04-11-2026

La 1.0 no arrancó el 26-10. El miércoles 04-11 es el primer día con el equipo completo.

Decisiones de Edmundo (03-11):
- **Escrituras a Bsale encendidas, sin simulacro:** producción, traslados a tienda, muestras y clientes.
- **Facturación en el POS de Bsale.** Comandas sugiere el documento de cada pedido y la oficina lo confirma con su PIN.
- **Cuentas:** las crea Ciro en Usuarios.

Abajo están el checklist del día y la guía de arranque por perfil.

---

## 1. Checklist

### Martes 03-11 (antes de irse)

| ✓ | Qué | Quién |
|---|---|---|
| ☐ | Publicar las funciones (reintento de muestras) y después el hosting (Pendiente en Bsale y sugerencia de documento). No cambian reglas ni índices.<br>`firebase deploy --only functions --project comandas-charcuteria`<br>`npm run deploy` | Edmundo |
| ☐ | Abrir la app en un teléfono y confirmar que aparece **Pedidos → Pendiente en Bsale** (si no aparece, cerrar y volver a abrir la app) | Edmundo |
| ☐ | Revisar **Pendiente en Bsale → Producción por cargar**. Lo que está ahí se registró con las escrituras apagadas: cargarlo a mano en Bsale y marcar «Ya la cargué en Bsale». Si no, al encender las escrituras queda fuera de Bsale | Miguel |
| ☐ | **Catálogo → Cruce con Bsale:** confirmar el cruce de los productos que fabrica Yury. Una carga con un producto sin cruce no llega a Bsale: queda en Pendiente en Bsale con el motivo «Sin cruce con Bsale» | Miguel |
| ☐ | Crear el grupo de WhatsApp «Soporte Comandas» (Edmundo, Ciro, Miguel). Ahí se reportan las fallas, con una captura de pantalla | Edmundo |
| ☐ | Mandar a Ciro la tabla de cuentas (sección 3) con los correos que faltan | Edmundo |
| ☐ | Subir el informe de oportunidades: `npx tsx scripts/import-oportunidades.ts tools/oportunidades/output/oportunidades_resumen.csv --confirm comandas-charcuteria` (hoy el piloto de 10 clientes) | Edmundo |

### Miércoles 04-11, antes de abrir

| ✓ | Qué | Quién |
|---|---|---|
| ☐ | Crear las cuentas en **Usuarios** (sección 3). Quien vendía por WhatsApp entra con **«Invitar con su historial»**, eligiendo su nombre del historial, para que traiga sus pedidos y su cartera | Ciro |
| ☐ | Reactivar a Elizabeth, si corresponde (fue desactivada el 24-10) | Ciro |
| ☐ | Ciro y Luis entran por primera vez y crean su PIN | Ciro, Luis |
| ☐ | En **Conexión Bsale → Configuración**, dejar:<ul><li>`Escrituras` encendido;</li><li>`Simulacro` apagado;</li><li>`Facturar desde Comandas` apagado.</li></ul>Revisar que las oficinas sigan en 1 (fábrica) y 2 (tienda) | Ciro (superAdmin) |
| ☐ | Tocar «Sincronizar» una vez y revisar que el stock se ve | Ciro |
| ☐ | **Oportunidades → Del informe:** elegir qué clientes trabajar y a qué ejecutivo. Crear también las visitas que quiera asignar («+ Oportunidad») | Ciro |

### Durante el día: primeras veces (revisarlas en Bsale apenas ocurran)

| ✓ | Primera vez que… | Qué revisar | Quién |
|---|---|---|---|
| ☐ | **Yury carga producción** (foto o a mano) | En Bsale, una **recepción** en «MARCOSI (SALA DE PROCESO)» con los mismos productos y cantidades. En Conexión Bsale → Bitácora, la línea «recepcion_produccion» con estado **ok**. En Comandas, el stock sube tras la sincronización y se reasignan los pedidos que esperaban | Yury + Miguel |
| ☐ | **Despacho registra un traslado** a la tienda | En Bsale, un **consumo** en la fábrica y una **recepción** en «LA CHARCUTERIA» con las cantidades empacadas | Edu + Miguel |
| ☐ | **Sale una muestra** (al vincular el documento o con «Registrar salida») | En Bsale, un consumo interno con la nota «Muestra · cliente · pedido» | Miguel |
| ☐ | **Un vendedor crea un cliente** nuevo | El cliente aparece en Bsale con el RUT, el giro y la dirección | Miguel |
| ☐ | **Cada documento que se vincula** (mañana y pasado) | En el diálogo de vincular, «Ver cómo lo facturaría Comandas»: comparar las líneas, los precios, los kilos, el tipo de documento y el total con lo emitido en el POS. Anotar en soporte las diferencias | Miguel |
| ☐ | **Un pedido completo:** vendedor (PIN) → despacho arma → POS de Bsale → Pendiente en Bsale «Confirmar» (PIN) → despachar → entregar | Que en cada paso aparezca el botón que corresponde y que el vendedor vea el estado | Equipo |

**Si una escritura falla:** la app muestra el error y queda en **Pendiente en Bsale → Escrituras con error**.

**Si algo sale mal en Bsale** (cantidades o productos equivocados), hay que volver atrás:
1. En Conexión Bsale → Configuración, apagar `Escrituras`.
2. Corregir a mano en Bsale.
3. Avisar en el grupo de soporte.

Con las escrituras apagadas la producción vuelve a quedar «Por cargar en Bsale» y nada se pierde.

### Al cierre

| ✓ | Qué | Quién |
|---|---|---|
| ☐ | **Pendiente en Bsale en cero**, o con una explicación para cada pendiente | Miguel |
| ☐ | Anotar las fallas y dudas del día en el grupo de soporte | Todos |
| ☐ | Revisar la Bitácora de Bsale del día (todas las líneas en «ok») | Edmundo |

---

### Facturar desde Comandas (después)

La facturación sigue en el POS. Para encender «Facturar desde Comandas»:
1. Dos o tres días seguidos en que la vista previa calce con el POS.
2. Encender `Facturar desde Comandas` y emitir una primera factura real a Fran GC; revisarla en Bsale.
3. Si sale bien, la oficina factura desde Comandas y el POS queda de respaldo.

---

## 2. Guía de arranque (capacitación de 15 minutos por persona)

**Para todos:**
1. **Instalar.** Abrir <https://comandas-charcuteria.web.app> en el teléfono → «Instalar app».
   - En iPhone: Safari → ••• → Compartir → «Agregar a inicio».
2. **Primer ingreso.** Entrar con «Continuar con Google» o con el correo de contraseña que le llegó.
3. **Crear el PIN.** Crear un PIN de 4 dígitos y aceptar la declaración de responsabilidad.
   - El PIN es personal: todo lo que se haga con él queda a su nombre.
4. **Uso diario.** Desde ahora se entra con correo + PIN. La app se bloquea al abrirla y después de 30 minutos sin uso.
5. **Si olvida el PIN o se bloquea:** pedir a Ciro que lo borre en Usuarios.
6. **La guía completa** está en la app: menú de su nombre → **Guía de uso**.

**Primera tarea de cada perfil**, hecha con la persona al lado:

| Perfil | Primera tarea | Lo que tiene que entender |
|---|---|---|
| Vendedor | **Oportunidades → Agenda:** abrir una oportunidad asignada, registrar la visita con su siguiente paso y crear las muestras o el pedido desde ahí. Después, un pedido con «＋» → Paso a paso (o «Pegar mensaje» desde WhatsApp) | <ul><li>El horario de entrega es obligatorio.</li><li>Al enviar se pide el PIN.</li><li>Si hay una condición especial, el pedido espera la aprobación de Ciro.</li><li>Las muestras se agregan con «+ Muestra».</li></ul> |
| Tienda (Lucy) | Una reposición con «＋» y, cuando llegue, «Recibir en tienda» | <ul><li>El traslado ahora se registra solo en Bsale.</li><li>Lucy también puede tomar pedidos de clientes.</li></ul> |
| Despacho | «Tomar» → «Armar» un pedido con el peso real | <ul><li>Se registra lo que realmente se empacó.</li><li>Un pedido «por aprobar» no se arma.</li><li>Las muestras se rotulan.</li><li>El traslado a la tienda pide el PIN y escribe en Bsale.</li></ul> |
| Reparto | «Entregar» con quién recibió | Fijarse en el horario de recepción del cliente |
| Producción (Yury) | Cargar lo producido hoy (foto de la planilla o a mano) | <ul><li>Cada carga pide el PIN y **entra a Bsale como recepción**.</li><li>Antes de cargar, revisar bien las cantidades leídas de la foto.</li></ul> |
| Administración (Miguel) | Emitir en el POS → **Pendiente en Bsale** → «Confirmar» el documento sugerido | <ul><li>Si no hay sugerencia, usar «Vincular» y elegir el documento.</li><li>Escribir el número del pedido en la referencia del POS hace que la sugerencia sea segura.</li><li>Dejar la lista en cero al cierre.</li></ul> |
| Super administración (Ciro, Luis) | <ul><li>Aprobar o rechazar un pedido «por aprobar».</li><li>Crear una cuenta en Usuarios.</li><li>Asignar una oportunidad y revisar **Oportunidades → Equipo**.</li></ul> | <ul><li>Borrar un PIN olvidado.</li><li>Los interruptores de Bsale están en Conexión Bsale.</li><li>Una oportunidad se gana sola cuando su pedido se factura; postergar pide fecha y dar por perdida pide motivo.</li></ul> |

**Consejo para la oficina:** en el POS, poner en la **referencia** del documento el número del pedido (por ejemplo `PED-2026-0042`). Con eso Comandas sugiere el documento sin dudar, aunque el cliente no tenga RUT o el total cambie.

---

## 3. Cuentas que crea Ciro

En el backlog (24-10) faltaban estas personas. Hay que completar el correo y **confirmar el perfil**: los marcados con «?» son supuestos.

| Persona | Perfil | Correo | Con historial de WhatsApp |
|---|---|---|---|
| Rafael | vendedor ? | | sí, si vendía por el grupo |
| Gabriela | ? | | |
| Ramiro | ? | | |
| Juan | ? | | |
| Tania | ? | | |
| Lucy | tienda | | sí, si vendía por el grupo |
| Edu | despacho ? | | |
| Morena | ? | | |
| Miguel | admin | | |
| Reparto (nombre) | reparto | | |
| Elizabeth | vendedor (reactivar) | e.teran@lacharcuteriartesanal.cl | ya fusionada |

Cómo crearlas, en Usuarios:
- **«Invitar con su historial»:** para quien aparece en el historial de WhatsApp. Trae sus pedidos y su cartera.
- **«+ Agregar persona»:** para el resto. Si la persona usa contraseña, le llega un correo para crearla.
