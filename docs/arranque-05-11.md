# Puesta en marcha con el equipo — jueves 05-11-2026, en la tarde

La 1.0 no arrancó el 26-10 ni el 04-11. Se acordó con Ciro partir el **jueves 05-11 en la tarde** con el equipo completo.
Versión para ir marcando: `docs/checklist-puesta-en-marcha-05-11.docx`.

Decisiones de Edmundo (03-11):
- **Escrituras a Bsale encendidas, sin simulacro:** producción, traslados a tienda, muestras y clientes.
- **Facturación en el POS de Bsale.** Comandas sugiere el documento de cada pedido y la oficina lo confirma con su PIN.
- **Cuentas:** las crea Ciro en Usuarios.
- **Compras e insumos:** piloto solo para super administración ([ADR-0017](adr/0017-compras-e-insumos.md)).

Estado al 04-11: todo publicado en producción (reglas de Firestore y de Storage, funciones y hosting). Oportunidades: 10 clientes del informe cargados.

---

## 1. Checklist

### Miércoles 04-11: probar producción en un teléfono real

| ✓ | Qué | Quién |
|---|---|---|
| ☐ | Abrir <https://comandas-charcuteria.web.app>: aparece la landing nueva (si no, cerrar y volver a abrir) | Edmundo |
| ☐ | Instalar la app en Android y en iPhone; entrar con correo + PIN | Edmundo |
| ☐ | **Pedido IA:** pegar un mensaje real de WhatsApp; lo interpreta Gemini, no el intérprete de respaldo | Edmundo |
| ☐ | **Producción:** una foto de la planilla de Yury se lee con IA | Edmundo |
| ☐ | **Compras «Sin documento»:** registrar una compra de prueba | Ciro (superAdmin) |
| ☐ | **Compras con foto o PDF:** registrarla y abrir el documento desde «Compras» (primer uso de Storage en producción) | Ciro (superAdmin) |
| ☐ | **Laboratorio:** escanear 2 o 3 etiquetas reales | Ciro (superAdmin) |

### Miércoles 04-11: Bsale

| ✓ | Qué | Quién |
|---|---|---|
| ☐ | **Catálogo → Cruce con Bsale:** cruzados todos los productos que fabrica Yury. Sin cruce, la carga no llega a Bsale | Miguel |
| ☐ | **Pendiente en Bsale → Producción por cargar:** cargar a mano en Bsale lo acumulado y marcar «Ya la cargué en Bsale» | Miguel |
| ☐ | **Conexión Bsale:** oficinas en 1 (fábrica) y 2 (tienda); tocar «Sincronizar» y ver el stock | Miguel |

### Miércoles 04-11: personas

| ✓ | Qué | Quién |
|---|---|---|
| ☐ | Mandar a Ciro la tabla de cuentas (sección 3) con correos y perfiles confirmados | Edmundo |
| ☐ | Crear el grupo de WhatsApp «Soporte Comandas» (Edmundo, Ciro, Miguel) | Edmundo |
| ☐ | Confirmar quiénes están el jueves en la tarde (uno por perfil) y que traigan el teléfono cargado | Ciro |

### Jueves 05-11, en la mañana

| ✓ | Qué | Quién |
|---|---|---|
| ☐ | **Congelar:** no publicar cambios hasta después de la sesión | Edmundo |
| ☐ | Crear las cuentas en **Usuarios**. Quien vendía por WhatsApp: «Invitar con su historial». Reactivar a Elizabeth, si corresponde | Ciro |
| ☐ | **Conexión Bsale → Configuración:** `Escrituras` encendido, `Simulacro` apagado, `Facturar desde Comandas` apagado | Ciro |
| ☐ | **Oportunidades → Del informe:** elegir cuáles de los 10 clientes trabajar y a qué ejecutivo, para que haya agenda en la sesión | Ciro |

### Jueves 05-11, en la tarde: la sesión

**Para todos (15 minutos):** instalar la app, primer ingreso, crear el PIN y mostrar «Guía de uso» (sección 2).

**Un pedido real de punta a punta, revisando en Bsale cada primera vez:**

| ✓ | Paso | Quién | Qué revisar |
|---|---|---|---|
| ☐ | El vendedor crea un pedido con PIN, idealmente desde una oportunidad | Vendedor | Aparece en el Tablero con su horario de entrega |
| ☐ | Producción carga lo producido (foto o a mano) | Yury + Miguel | Bsale: recepción en «MARCOSI (SALA DE PROCESO)». Bitácora: «recepcion_produccion» en ok |
| ☐ | Despacho toma y arma el pedido con el peso real | Edu | Queda «armado» con los pesos empacados |
| ☐ | La oficina emite en el POS con el número del pedido en la referencia | Miguel | Pendiente en Bsale sugiere ese documento. Comparar con «Ver cómo lo facturaría Comandas» |
| ☐ | La oficina confirma el documento con su PIN | Miguel | Pedido «facturado». Si venía de una oportunidad, queda «ganada» |
| ☐ | El repartidor marca la salida y la entrega | Reparto | El vendedor ve el estado |
| ☐ | Un traslado a la tienda | Edu + Lucy | Bsale: consumo en la fábrica y recepción en «LA CHARCUTERIA» |
| ☐ | Una muestra | Vendedor + Edu | Bsale: consumo interno «Muestra · cliente · pedido» |
| ☐ | Un cliente nuevo | Vendedor | Aparece en Bsale con RUT, giro y dirección |

**Si una escritura falla:** la app muestra el error y queda en **Pendiente en Bsale → Escrituras con error**.

**Si algo sale mal en Bsale** (cantidades o productos equivocados):
1. Ciro apaga `Escrituras` en Conexión Bsale → Configuración.
2. Se corrige a mano en Bsale.
3. Se avisa en el grupo de soporte.

Con las escrituras apagadas, la producción queda «por cargar» y nada se pierde.

### Al cierre del jueves

| ✓ | Qué | Quién |
|---|---|---|
| ☐ | **Pendiente en Bsale en cero**, o con una explicación para cada pendiente | Miguel |
| ☐ | Bitácora de Bsale del día: todas las líneas en «ok» | Edmundo |
| ☐ | Anotar las fallas y dudas en el grupo de soporte | Todos |

### Riesgos a vigilar

- **Gemini** no se ha probado en producción desde los últimos cambios. Si falla, Pedido IA y la foto de la planilla caen al intérprete de respaldo o a la carga a mano.
- **Las escrituras reales a Bsale** desde Comandas nunca se han ejecutado. Por eso se revisa en Bsale cada primera vez con el equipo presente.

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
