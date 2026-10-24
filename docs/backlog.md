# Backlog

Actualizado al 24-10-2026. Tres partes:
1. lo que falta para que la 1.0 funcione con todos el lunes 26-10;
2. el plan del contrato hasta el 30-11;
3. el backlog fuera de alcance, que no está cotizado.

La deuda técnica está en [deuda-tecnica.md](deuda-tecnica.md).

## 1. Puesta en marcha 1.0 (semana del 26-10)

| # | Pendiente | Quién | Estado |
|---|---|---|---|
| 1 | Correos y perfiles del equipo: Rafael, Gabriela, Ramiro, Juan, Tania, Lucy, Edu, Morena, Miguel y reparto. Invitarlos con «Invitar con su historial» | Edmundo / Ciro | Pendiente |
| 2 | Ciro y Luis ingresan y crean su PIN (la invitación de Luis sigue sin usar) | Ciro, Luis | Pendiente |
| 3 | Yury prueba Producción con datos reales (foto de la planilla + carga a mano) | Yury | En curso (24-10) |
| 4 | Decidir si la producción (y luego los traslados) se escriben en Bsale desde la semana 1. Hoy: escrituras apagadas, la oficina carga a mano | Edmundo / Ciro | Por decidir |
| 5 | Corregir en Bsale los precios en $0 y el stock absurdo (DT-07) | Miguel | Pendiente |
| 6 | Revisar el cruce de variantes pendiente y asociar los 119 clientes «por revisar» | Miguel / Edmundo | Pendiente |
| 7 | Correr `scripts/setup-alerts.sh` y rotar `service-account.json` (DT-10, DT-11) | Edmundo | Pendiente |
| 8 | Grupo de soporte (WhatsApp) para reportar fallas con captura | Edmundo | Pendiente |
| 9 | Habilitar AI Logic en staging y verificar la foto de la planilla (DT-13) | Edmundo | Pendiente |
| 10 | Probar el PIN al enviar un pedido de punta a punta con un vendedor real | Equipo | Pendiente |
| 11 | Elizabeth: reactivar su cuenta cuando corresponda (fue desactivada el 24-10) | Ciro | Por decidir |

### Encendido gradual de escrituras a Bsale
Una a la vez, primero con simulacro y revisando la bitácora unos días:

1. **Recepción de producción.** Es la de mayor ahorro y la de menor riesgo.
2. **Consumo de muestras y traslados a tienda.**
3. **Alta y edición de clientes**, después de asociar los 119 clientes.
4. **Facturación desde Comandas** (`invoicesEnabled`), tras una semana estable con el POS.
5. **Stock estricto** (`settings/app.stockMode = 'estricto'`), cuando el stock de Bsale sea confiable.

### Mejoras cortas propuestas (no comprometidas)
- Pantalla «Pendiente en Bsale» para la oficina (DT-05).
- Unificar las reglas de salud de cliente (DT-06), a decidir con Ciro.
- Notificar al vendedor cuando su pedido se aprueba o rechaza, y a Ciro cuando hay pedidos por aprobar. Hoy solo se ve en el Tablero.
- Producción: plan del día imprimible y meta de producción por producto.

## 2. Plan del contrato (a 30-11-2026)

Según el plan del 08-10, reajustado por el atraso del token de Bsale (llegó el 19-10):

| Período | Entregable | Estado |
|---|---|---|
| hasta 19-10 | Bsale real + usuarios | Hecho (lectura, cruce, Panel) |
| 24-10 → 31-10 | Comandas en marcha blanca, todos los perfiles en paralelo a WhatsApp | En curso (1.0 desde el 26-10) |
| 1-11 → 15-11 | Comandas completa + capacitación + 2.ª visita a la planta | Pendiente |
| 16-11 → 30-11 | Panel con cifras reales + compras con foto (piloto) | Pendiente |
| dic → ene | Kilos por proceso, stock de materia prima, rendimientos y mermas (alcance original: compras/insumos + procesos 80 % de los kilos) | Próxima etapa |

## 3. Fuera de alcance (no cotizado)

Backlog interno estimado en ~CLP 5,2 M; requiere cotización aparte:
- metas de venta y venta predictiva;
- comisiones de vendedores;
- cobranza / integración con Chipax, cuentas por pagar y por cobrar;
- pago de despachos;
- fotos como prueba de entrega;
- notificaciones push;
- CRM / fuerza de ventas: HubSpot quedó pausado y la idea es que viva dentro de Comandas.

El PIN personal estaba en esta lista y se entregó en la 1.0 (24-10).
