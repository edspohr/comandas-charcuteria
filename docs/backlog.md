# Backlog

Actualizado al 03-11-2026. Tres partes:
1. lo que falta para que la 1.0 funcione con todos (no arrancó el 26-10; arranca el jueves 05-11 en la tarde, ver [arranque-05-11.md](arranque-05-11.md));
2. el plan del contrato hasta el 30-11;
3. el backlog fuera de alcance, que no está cotizado.

La deuda técnica está en [deuda-tecnica.md](deuda-tecnica.md).

## 1. Puesta en marcha 1.0 (desde el 04-11)

| # | Pendiente | Quién | Estado |
|---|---|---|---|
| 1 | Correos y perfiles del equipo: Rafael, Gabriela, Ramiro, Juan, Tania, Lucy, Edu, Morena, Miguel y reparto. Ciro los crea en Usuarios (tabla en arranque-05-11.md §3) | Ciro | 04-11 |
| 2 | Ciro y Luis ingresan y crean su PIN (la invitación de Luis sigue sin usar) | Ciro, Luis | Pendiente |
| 3 | Yury prueba Producción con datos reales (foto de la planilla + carga a mano) | Yury | En curso (24-10) |
| 4 | Escrituras a Bsale desde el día 1, sin simulacro: producción, traslados, muestras y clientes. La facturación sigue en el POS + vincular con sugerencia | Edmundo | Decidido 03-11; se encienden el 04-11 |
| 5 | Corregir en Bsale los precios en $0 y el stock absurdo (DT-07) | Miguel | Pendiente |
| 6 | Revisar el cruce de variantes pendiente y asociar los 119 clientes «por revisar» | Miguel / Edmundo | Pendiente |
| 7 | Correr `scripts/setup-alerts.sh` (hecho 24-10) y rotar `service-account.json` (DT-11) | Edmundo | Alertas listas; rotación pendiente |
| 8 | Grupo de soporte (WhatsApp) para reportar fallas con captura | Edmundo | 03-11 |
| 9 | Habilitar AI Logic en staging y verificar la foto de la planilla (DT-13) | Edmundo | Pendiente |
| 10 | Probar el PIN al enviar un pedido de punta a punta con un vendedor real | Equipo | Pendiente |
| 11 | Elizabeth: reactivar su cuenta cuando corresponda (fue desactivada el 24-10) | Ciro | Por decidir |

### Encendido de escrituras a Bsale
El plan original era encenderlas una a la vez y con simulacro. El 03-11 Edmundo decidió encender los pasos 1 a 3 juntos y en real desde el arranque (05-11), revisando en Bsale la primera vez de cada una (checklist en arranque-05-11.md). Siguen pendientes los pasos 4 y 5:

1. **Recepción de producción.** Es la de mayor ahorro y la de menor riesgo.
2. **Consumo de muestras y traslados a tienda.**
3. **Alta y edición de clientes**, después de asociar los 119 clientes.
4. **Facturación desde Comandas** (`invoicesEnabled`): desde el 04-11 la oficina compara la vista previa («Ver cómo lo facturaría Comandas») con el POS; tras 2–3 días calzando, primera factura real a Fran GC y luego encender.
5. **Stock estricto** (`settings/app.stockMode = 'estricto'`), cuando el stock de Bsale sea confiable.

### Mejoras cortas propuestas (no comprometidas)
- Unificar las reglas de salud de cliente (DT-06), a decidir con Ciro.
- Notificar al vendedor cuando su pedido se aprueba o rechaza, y a Ciro cuando hay pedidos por aprobar. Hoy solo se ve en el Tablero.
- Producción: plan del día imprimible y meta de producción por producto.

### Visita del 05-11: plan acordado el 06-11
Fuente: notas y transcripción de la visita (Google Doc «20261105 La Charcutería»). Decisiones de Edmundo el 06-11:

| Fase | Contenido | Estado |
|---|---|---|
| Urgente | Horario de entrega flexible: basta con una hora, un rango o una nota | Hecho y en producción (06-11) |
| Urgente | Todas las escrituras a Bsale apagadas hasta la marcha blanca (ya lo estaban); traslados y edición de clientes funcionan sin Bsale y quedan en Pendiente en Bsale | Hecho y en producción (06-11) |
| 1 | Producción incluye despacho (Yurij y Eduanis con el mismo acceso) · globo y aviso de oportunidades · fecha obligatoria al crear · «Total en armado» · muestras a nombre del vendedor sin cliente | Hecho y en producción (06-11) |
| 2 | Edición de pedidos hasta antes de facturar, tarjeta naranja con cambios (+ verde, − rojo) en ambos sentidos, eliminar pedidos (vendedor los propios, superAdmin cualquiera; invisible en la app, queda en la base) — [ADR-0018](adr/0018-edicion-y-eliminacion-de-pedidos.md) | Hecho y en producción (06-11) |
| 3 | Comanda impresa de 80 mm (o 58 mm) por pedido, en lote desde «Total en armado» o al tomar: tablet Android + térmica ESC/POS WiFi/Bluetooth + app RawBT; alternativa con el diálogo del navegador | Hecho 06-11; falta probar con la impresora real (comprar térmica, instalar RawBT) |
| 4 | Compras (Gabriela, administración) separadas de la recepción en la fábrica: compra → por recibir → recepción contra la compra, con entregas parciales; reciben producción, despacho y superAdmin ([ADR-0017](adr/0017-compras-e-insumos.md), actualización 06-11) | Hecho y en producción (06-11) |
| 5 | Oportunidades por dictado de voz para Ciro (Gemini) con vista de confirmación | Pendiente |
| 6 | Consumo de insumos en producción (FIFO por lote) | Etapa dic → ene |

Pendiente de la fase 1: un informe en el Panel con las muestras que tiene cada vendedor.

## 2. Plan del contrato (a 30-11-2026)

Según el plan del 08-10, reajustado por el atraso del token de Bsale (llegó el 19-10):

| Período | Entregable | Estado |
|---|---|---|
| hasta 19-10 | Bsale real + usuarios | Hecho (lectura, cruce, Panel) |
| 24-10 → 31-10 | Comandas en marcha blanca, todos los perfiles en paralelo a WhatsApp | En curso (1.0 desde el 26-10) |
| 1-11 → 15-11 | Comandas completa + capacitación + 2.ª visita a la planta | Pendiente |
| 16-11 → 30-11 | Panel con cifras reales + compras e insumos (piloto). Prototipo listo el 03-11 ([ADR-0017](adr/0017-compras-e-insumos.md)), solo superAdmin: depurar con etiquetas reales en la fábrica (Laboratorio) y abrirlo a la fábrica | En curso |
| dic → ene | Kilos por proceso, stock de materia prima, rendimientos y mermas (alcance original: compras/insumos + procesos 80 % de los kilos) | Próxima etapa |

## 3. Fuera de alcance (no cotizado)

Backlog interno estimado en ~CLP 5,2 M; requiere cotización aparte:
- metas de venta y venta predictiva;
- comisiones de vendedores;
- cobranza / integración con Chipax, cuentas por pagar y por cobrar;
- pago de despachos;
- fotos como prueba de entrega;
- notificaciones push;
- CRM / fuerza de ventas: HubSpot quedó pausado y la idea es que viva dentro de Comandas. **Adelantado el 03-11:** la gestión de oportunidades se entregó con el arranque ([ADR-0016](adr/0016-oportunidades-comerciales.md)); quedan las notificaciones y la asignación automática de los canales de adquisición.

El PIN personal estaba en esta lista y se entregó en la 1.0 (24-10).
