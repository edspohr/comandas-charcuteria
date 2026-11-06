# ADR-0018 — Pedidos que cambian: edición hasta facturar, avisos en ambos sentidos y eliminación

- **Estado:** Aceptada
- **Fecha:** 06-11-2026
- **Reemplaza:** la regla «el vendedor no edita líneas después de crear el pedido» (decisiones previas al hito 1).

## Contexto

En la visita del 05-11, el equipo pidió tres cosas:
- Los vendedores agregan o quitan productos a pedido del cliente.
- Quien arma rebaja ítems que no están disponibles.
- Hasta ahora el único camino era anular y crear otro pedido. Así se perdía el historial, y nadie se enteraba del cambio.

También se pidió poder eliminar pedidos: los de prueba, los duplicados o los que el cliente canceló antes de que se trabajaran.

## Decisión

### Edición de líneas por el vendedor
- **Quién:** el creador del pedido (perfiles que toman pedidos) y superAdmin. Requiere PIN.
- **Hasta cuándo:** en los estados recibido, confirmado, confirmado parcial, en armado y armado. Con documento (facturado en adelante) el pedido no se edita.
- **Reservas en una sola transacción** ([`data/orders.ts`](../../app/src/data/orders.ts) `editOrderLines`), comparando por línea (producto, formato y si es muestra):
  - Si se sube la cantidad, se reserva lo disponible y el resto queda pendiente de producción. Las muestras no generan demanda de producción.
  - Si se baja, primero se descuenta lo pendiente de producción y después se libera lo reservado.
  - Una línea quitada libera su reserva. Una línea nueva se reserva igual que al crear.
  - Cada reserva o liberación queda en `stockMovements` con el motivo «modificación».
- **Estado:**
  - Antes de armar, se recalcula entre confirmado y confirmado parcial.
  - Un pedido ya armado vuelve a «en armado» con el mismo armador, porque hay que volver a empacarlo. Las líneas que no cambiaron conservan lo empacado.
- **Valor:** se recalcula con el precio guardado en el pedido. Una línea nueva toma el precio del catálogo.

### Avisos
- Cada cambio se agrega a `order.changes` (antes → después por línea, quién y cuándo) y abre `order.changeNotice` para el otro lado:
  - si cambió el vendedor, el aviso es para armado;
  - si armado rebajó, el aviso es para el vendedor.
- La tarjeta del tablero se pinta naranja y muestra el cambio: en verde lo que subió, en rojo lo que bajó.
- El aviso se cierra con «Visto» por el lado al que va dirigido (o por un supervisor).
- **Rebaja en el armado:** cuenta como cambio una línea marcada «Faltó», o una de unidades empacada con menos de lo pedido. En el granel la diferencia de peso es normal y no avisa.

### Eliminación
- **Quién:**
  - el creador, sus pedidos;
  - superAdmin, cualquiera (capacidad `order.delete`);
  - administración no elimina.
- **Hasta cuándo:** hasta armado, igual que la edición. Pide PIN y motivo.
- **Borrado lógico:**
  - el pedido queda anulado (libera reservas igual que anular) y con `deleted = { at, by, reason }`;
  - desaparece de todas las pantallas, informes y del Panel;
  - el documento sigue en la base como historia.

## Consecuencias

- Se dejó de anular y rehacer pedidos, y el historial del pedido queda completo.
- Las reglas de Firestore permiten al creador modificar su pedido antes de facturar, pero no cambiar el creador, el cliente, el tipo ni el documento.
- Los análisis que cuentan pedidos anulados no incluyen los eliminados.
- **Pendiente:** que armado pueda agregar productos (por ahora armado solo rebaja) y las notificaciones push (fuera de alcance).
