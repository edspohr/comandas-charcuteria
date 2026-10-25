# Análisis contrato vs. entrega — Cecinas Marcosi SpA

Al 25-10-2026. Contrato: «Propuesta y Aceptación — Control del Proceso Productivo: Primera Versión Operativa» (28-08-2026, firmado el 29-08). Plazo: 3 meses, con término nominal el 28-11-2026. Precio: 4 cuotas de CLP 550.000 + IVA, cada una ligada a un hito.

Fuentes: este repositorio (README, `docs/`, ADR, código, `git log`, con 89 commits entre el 22-09 y el 24-10) y los hechos de correo y reuniones que resumió Edmundo. Lo que solo consta en correo o reunión se marca **(fuera del repo)**. Lo que no se puede verificar se dice tal cual.

---

## 1. Resumen ejecutivo

- **Hito Mes 2 («plataforma operativa, conectada a Bsale, con datos reales en marcha blanca»).** Se puede afirmar para la plataforma que se construyó, que es Comandas:
  - está en producción y conectada a Bsale en lectura real desde el 19-10;
  - tiene datos reales (catálogo, stock, 25 meses de ventas y 382 pedidos históricos de WhatsApp);
  - la versión 1.0 corre en marcha blanca desde el 24/26-10.
- **Pero esa plataforma no es la que describe el contrato.** El contrato pide el control del proceso productivo (insumos, procesos y rendimientos). Lo entregado es gestión de pedidos y ventas.
- **Contrato completo, hoy:** los 4 ítems productivos del alcance («Incluye» 1 y 2, y las métricas 1 a 3) **no están cumplidos**. Hay piezas parciales: la bitácora de producción y el costo promedio leído de Bsale.
- **El cambio de alcance se acordó de palabra y por etapas,** pero **no tiene aceptación escrita** en los términos del §9. El plan del 08-10 dejó el alcance original «por conversar».
- **El calendario propio** (`docs/backlog.md`) pasa el alcance original a **dic–ene**, fuera del plazo del contrato.
- **Conclusión:** la cuota 3 es defendible si se entrega como «plataforma operativa en su etapa 1 (Comandas)» y se pide al mismo tiempo la aceptación escrita de la sustitución. La cuota 4 y el cierre requieren resolver antes qué pasa con el alcance productivo.

---

## 2. Tabla contrato vs. entrega

| # | Requerido en el papel | Evidencia en el repo / documentos | Estado | Observación |
|---|---|---|---|---|
| I-1 | Registro de insumos de entrada desde facturas y guías de compra | No hay modelo de datos ni pantalla de compras. `Product.sellable=false` excluye materia prima e insumos del catálogo de venta (`app/src/domain/types.ts`). El backlog pone «compras con foto (piloto)» del 16 al 30-11 | **No cumplido** | La foto de la planilla de Producción (Gemini, commit 697e47c del 24-10) sirve de base técnica para la foto de un documento de compra |
| I-2 | Procesos de transformación parametrizados (≥80 % de los kilos) | No hay recetas, procesos ni el análisis del 80 % en el repo. Backlog: «kilos por proceso… dic → ene» | **No cumplido** | El análisis del 80 % de los kilos (semana 2 del Mes 1) no consta en el repo |
| I-3a | Bsale: leer ventas | `functions/src/bsale/sync.ts` y `facts.ts`, `bsaleScheduledSync` (cada 10 min de 06:00 a 23:00) y webhooks; [ADR-0012](adr/0012-hechos-venta-por-mes.md) (historia por mes); Panel de gestión sobre ventas reales (6f82d0a, 19-10) | **Cumplido** | Lectura real desde el 19-10 |
| I-3b | Bsale: stock de producto terminado sincronizado, fuente única | Lectura de stock por sucursal ([ADR-0001](adr/0001-bsale-fuente-de-verdad.md)). La recepción de producción en Bsale está programada (`bsaleReceiveProduction`), pero con `writesEnabled=false` y `dryRun=true` (`docs/operacion.md`). [ADR-0006](adr/0006-stock-informativo.md): stock informativo por la mala calidad del dato (DT-07) | **Parcial** | Va en un solo sentido, de Bsale a Comandas. La producción llega a Bsale porque la oficina la carga a mano («Por cargar en Bsale», [ADR-0014](adr/0014-bitacora-produccion.md)). Las escrituras solo se probaron contra un Bsale falso |
| I-4 | Base de datos propia y auditable | Firestore con `productionLog`, `stockMovements` (solo se agregan registros, nunca se editan), `pinLog`, `bsale/writes/log` y reglas con 15 tests | **Cumplido (para pedidos)** | Es auditable para pedidos y ventas. Todavía no guarda información productiva (insumos, procesos) |
| I-5 | Capacitación del equipo que opera | Guía por perfil en la app (`app/src/routes/Ayuda.tsx`, a51c792, 24-10). Sesión con Ciro el 20-10 **(fuera del repo)**. Backlog: «capacitación» del 1 al 15-11 | **Parcial** | Falta capacitar a vendedores, despacho, Producción (Yuri) y oficina |
| M1-a | Visitas y levantamiento en planta | Solo hubo una visita, el 09-09 **(fuera del repo)**. La 2.ª visita figura pendiente del 1 al 15-11 (`docs/backlog.md`) | **Parcial** | — |
| M1-b | Informe de diagnóstico | No está en el repo | **No verificable** | La cuota 2 se pagó, lo que implica aceptación. Conviene ubicar el documento |
| M1-c | Diseño de la solución | Solo el diseño de Comandas: README y ADR 0001–0015 (escritos al 18–24-10, no en el Mes 1) | **Sustituido** | No hay diseño del sistema productivo |
| M1-d | Plan específico de implementación | Plan quincenal del 08-10 **(fuera del repo)**, reflejado en `docs/backlog.md` §2 | **Sustituido con acuerdo parcial** | Llegó en el Mes 2, no al cierre del Mes 1 |
| M1-e | Maqueta funcional | Maqueta desplegada el 22–23-09 (41 commits, de 9786d7d a 69ee82b). `docs/QA-guion-demo.md` | **Cumplido** (maqueta de Comandas) | — |
| M2 | Plataforma construida, conectada a Bsale, con datos reales en marcha blanca | Ver la sección 5 | **Cumplido para Comandas / no cumplido para el alcance productivo** | — |
| M3-a | Puesta en marcha | 1.0 en marcha blanca desde el 26-10, en paralelo a WhatsApp (`docs/backlog.md` §1) | **En curso** | Hay 11 pendientes abiertos de puesta en marcha |
| M3-b | Toma de inventario en el momento preciso | No existe en el repo una función de conteo ni un ajuste de inventario | **No cumplido** | Además, DT-07 (stock absurdo en Bsale) impide hoy partir de un stock confiable |
| M3-c | Capacitación del personal | Igual que I-5 | **Pendiente** | — |
| M3-d | Uso autónomo del equipo | Unos 8 pedidos reales y faltan las invitaciones de 10 personas (backlog §1, #1–2) | **Pendiente** | — |
| KPI-1 | Costo real de producción del 80 % del volumen | `bsaleRefreshCosts` y `bsaleDailyCosts` leen el **costo promedio** de Bsale (`functions/src/bsale/facts.ts`) y el Panel lo usa para el margen | **No cumplido** | Ese costo es el de Bsale, no un costo de producción calculado desde insumos y procesos. El margen no es confiable mientras siga DT-07 |
| KPI-2 | Rendimiento y merma por proceso | El Panel muestra «Merma (30 d)» = vendido − empacado (`app/src/domain/analytics.ts`) | **No cumplido** | Esa cifra es la diferencia de peso al armar el pedido, no la merma del proceso productivo |
| KPI-3 | Menos tiempo para registrar un documento de compra | No hay registro de compras | **No cumplido** | No existe medición de base («hoy») |
| KPI-0 | Métricas refinadas por escrito al cierre del Mes 1 | No están en el repo | **No verificable** | — |
| §9 | Supuesto: la API de Bsale permite consultar ventas y actualizar stock | Lectura verificada (`scripts/bsale-probe.ts`: documentos, stock, variantes y clientes responden 200). Recepciones y consumos sondeados en c07d1af. La escritura real nunca se ha ejecutado | **Parcial** | La lectura cumple el supuesto. La escritura está sin probar contra el Bsale real |
| §13 | Obligaciones del cliente | Acceso a Bsale: el token se esperaba el 12-10 y llegó ~19-10, con el atraso reconocido por Ciro el 18-10 **(fuera del repo)**. Acceso a la planta: falta la 2.ª visita. Personas: correos del equipo pendientes (backlog #1). Dispositivos y hosting (quién paga el proyecto Firebase y Gemini): **no verificable** en el repo | **Parcial** | — |

---

## 3. Entregado fuera de alcance

Nada de esto lo pide el contrato. Se originó en el levantamiento del 09-09 (dolor de las comandas) y en la lista de deseos de Ciro.

- **Pedidos:**
  - asistente de nuevo pedido con reserva de stock en la misma transacción y reasignación FIFO ([ADR-0002](adr/0002-stock-reservas-transaccionales.md));
  - tablero con 5 etapas y 3 vistas;
  - horario de entrega obligatorio ([ADR-0009](adr/0009-horario-entrega-obligatorio.md));
  - excepciones con aprobación ([ADR-0008](adr/0008-excepciones-con-aprobacion.md));
  - reposición de la tienda por traslado.
- **IA:** pedido pegado desde WhatsApp y foto de la planilla de producción con Gemini, con un intérprete de respaldo ([ADR-0011](adr/0011-gemini-con-fallback.md)).
- **Acceso:** 8 perfiles con gestión de usuarios e invitaciones ([ADR-0003](adr/0003-un-perfil-por-usuario.md)), y PIN personal con auditoría ([ADR-0007](adr/0007-pin-personal.md)).
- **Bsale más allá de lo pedido:**
  - facturación desde Comandas, o en el POS con vínculo del documento ([ADR-0005](adr/0005-facturacion-pos-y-vincular.md));
  - alta y edición de clientes;
  - ventana de Bsale de solo lectura para el consultor;
  - traslados a la tienda.
- **Gestión:**
  - Panel de gestión con 8 pestañas (ABC y margen, ritmo de compra, clientes en riesgo y perdidos, vendedores, explorador con exportación CSV);
  - salud de cliente ([ADR-0015](adr/0015-salud-de-cliente.md)).
- **Muestras:** consumo interno, seguimiento a 7 días, conversión a 60 días y kg por cliente nuevo ([ADR-0010](adr/0010-muestras-consumo-interno.md)).
- **Historial:** importación de 382 pedidos de WhatsApp (del 15-09 al 18-10) y fusión con los usuarios reales.
- **Infraestructura:**
  - aplicación instalable en el teléfono (PWA);
  - staging separado con Bsale simulado ([ADR-0013](adr/0013-staging-separado.md));
  - CI;
  - alertas;
  - runbook (`docs/operacion.md`).
- **Acuerdos del 20-10 (fuera del repo), entregados entre el 23 y el 24-10:**
  - foto de la planilla (697e47c);
  - excepciones con aprobación de Ciro (d816e30);
  - KPI de muestras (697e47c);
  - interfaz móvil del vendedor (504c93c, 32b5340).

**Esfuerzo relativo.** Los 89 commits y las ~16.400 líneas de `app/src` + `functions/src` son, en la práctica, todos de Comandas. Lo único que toca producción es la pantalla de Producción con su bitácora (~900 líneas: `Produccion.tsx`, `data/produccion.ts`, `productionLog.ts`). Esa pantalla registra producto terminado para cumplir pedidos, no transformación. Por eso, sobre el 95 % del esfuerzo de construcción está fuera del alcance escrito.

Lo que sigue fuera de alcance y no está cotizado (~CLP 5,2 M según `docs/backlog.md` §3):
- metas de venta y venta predictiva;
- comisiones;
- cobranza / Chipax;
- pago de despachos;
- foto como prueba de entrega;
- notificaciones push;
- CRM.

Además está la integración HubSpot↔Bsale, cotizada en CLP 1.104.354 + IVA y rechazada **(fuera del repo)**.

---

## 4. Alcance original no cubierto o sustituido

| Ítem | Qué hay en el código | Distancia a la promesa |
|---|---|---|
| Registro de insumos desde documentos de compra | Nada específico. Hay piezas reutilizables: la lectura de imágenes con Gemini (`data/produccion.ts`), el PIN y las bitácoras | Alta: falta el modelo de datos (proveedor, documento, líneas por peso, lote), la pantalla, la lectura de la foto y, quizás, la recepción en Bsale. Es el piloto planificado del 16 al 30-11 |
| Procesos de transformación (80 % de los kilos) | Nada. No hay recetas (las de Yuri «están en su cabeza», 20-10, **fuera del repo**) | Muy alta: falta el levantamiento (2.ª visita), el análisis del 80 %, el modelo insumo → proceso → producto y la carga de recetas |
| Costo real de producción | `bsaleRefreshCosts` / `bsaleDailyCosts` (costo promedio de Bsale por variante) | Alta: hay un costo de referencia, no uno calculado. Depende de los dos ítems anteriores |
| Rendimiento y merma por proceso | `productionLog` registra salidas (kg producidos por persona y fecha), sin entradas. «Merma» en el Panel = diferencia al armar | Alta: falta registrar los kg de entrada por proceso. `productionLog` sirve como el lado de la salida |
| Toma de inventario | Ninguna. Stock informativo por DT-07 | Media: una pantalla de conteo con ajuste en Bsale es acotada, pero exige que el cliente limpie antes su dato en Bsale |
| Capacitación del personal de Producción | Guía de Producción en `Ayuda.tsx`. Yuri probando desde el 24-10 (backlog #3) | Media: es alcanzable en noviembre si el cliente da el tiempo de su equipo |

---

## 5. Hito Mes 2 — lectura estricta y lectura razonable

**Lectura estricta.** Toma «plataforma operativa» en el sentido del §3, es decir, control del proceso productivo:
- no hay plataforma productiva;
- con Bsale solo se lee;
- el stock de producto terminado **no** se mantiene sincronizado en los dos sentidos, porque la producción no llega a Bsale desde la app;
- el hito no se cumple.

**Lectura razonable.** Toma el plan por etapas acordado a fines de septiembre y el 08-10, con Comandas primero:
- **«Construida y funcionando»:** sí. Producción en `comandas-charcuteria.web.app`, versión 1.0, con CI, alertas y runbook.
- **«Conectada a Bsale»:** sí, en lectura real con token, cron y webhooks, y con las sucursales mapeadas desde el 19-10.
- **«Datos reales en marcha blanca»:** sí.
  - Catálogo y stock reales.
  - 25 meses de ventas.
  - 382 pedidos históricos.
  - Marcha blanca desde el 24-10 (Elizabeth) y con todos los perfiles desde el 26-10.

**Escrituras apagadas.** Fue una decisión técnica documentada ([ADR-0004](adr/0004-escrituras-bsale-servidor.md), `docs/operacion.md`):
- se encienden de a una, con simulacro, por el riesgo de corromper el stock de Bsale con datos que ya están en mal estado (DT-07);
- el código existe;
- no se ha probado contra el Bsale real.

**«Stock sincronizado» en solo lectura.** Se cumple en un sentido: Comandas refleja el stock de Bsale con hasta 10 minutos de atraso, y Bsale sigue siendo la fuente única. **No** se cumple en el otro sentido: la producción cargada en la app no actualiza Bsale, y la oficina la replica a mano.

**Recomendación honesta.** Declarar el hito como cumplido «en modalidad de lectura y con encendido gradual de escrituras». Comprometer como primer paso del Mes 3 encender la recepción de producción (paso 1 del encendido gradual, `docs/backlog.md`). Con eso, el «sincronizado» queda cubierto sin discusión.

---

## 6. Riesgos para el cierre del Mes 3 (fin de noviembre)

1. **Alcance productivo sin resolver.**
   - Si el cliente lee el contrato literalmente, la cuota 4 queda condicionada a I-1, I-2 y las métricas, que el plan propio ubica en dic–ene.
   - Sin aceptación escrita de la sustitución (§9: el correo vale), el riesgo es de disputa, no técnico.
2. **Qué exige «Operación y equipo capacitado»:**
   - las ~10 personas invitadas y usando la app, con un pedido real de punta a punta con PIN;
   - una capacitación por perfil, con registro de asistencia;
   - una toma de inventario, que no existe;
   - al menos la recepción de producción escribiendo en Bsale.
3. **Lo que depende del cliente (§13):**
   - los correos del equipo (backlog #1);
   - el ingreso de Ciro y Luis (#2);
   - la limpieza del dato en Bsale con Miguel (#5–6, DT-07), que bloquea el stock estricto, el margen confiable y la toma de inventario;
   - la decisión de encender escrituras (#4);
   - el acceso a la planta para la 2.ª visita;
   - el tiempo de Yuri para recetas y procesos.
4. **Suspensión de plazos (§10).**
   - El atraso del token (vencía el 12-10, llegó ~19-10, reconocido por Ciro por correo el 18-10) suspende unos 7 días corridos (5 hábiles) del camino crítico de Bsale.
   - Es razonable correr el término de esa parte al ~05-12.
   - **No** cubre el cambio de alcance: el §10 suspende plazos por bloqueo, no mueve ítems de alcance.
5. **Soporte de 60 días (§7/§18).** Hay que fijar por escrito qué fecha cuenta como puesta en marcha. Si es el 26-10, el soporte gratuito vence ~25-12. Si es el cierre del Mes 3, vence a fines de enero.
6. **Riesgos técnicos con impacto en el cierre:**
   - DT-01: el PIN no lo exigen las reglas;
   - DT-05: no hay una cola visible de pendientes en Bsale;
   - DT-08: no hay tests de dominio ni e2e;
   - DT-11: credencial local sin rotar;
   - DT-13: la foto de la planilla no se ha probado con una planilla real.

---

## 7. Recomendaciones para la entrega formal y la negociación de continuidad

1. **Entregar el Mes 2 por correo**, con este informe adjunto o resumido:
   - definir el entregable como «Plataforma operativa — Etapa 1: Comandas, conectada a Bsale (lectura real), con datos reales en marcha blanca»;
   - mencionar el plazo de 5 días hábiles del §11.
2. **En el mismo correo, pedir aceptación expresa de la sustitución de alcance (§9).** Proponer una de dos opciones:
   - **(a) Cierre con alcance acotado:** el Mes 3 cierra con Comandas en operación + piloto de compras con foto + toma de inventario + escritura de producción en Bsale. Los procesos del 80 % y las métricas 1 y 2 pasan a una etapa 2 cotizada.
   - **(b) Extensión del contrato:** los procesos del 80 % y las métricas siguen dentro del contrato, con el plazo extendido a enero por el cambio de prioridades que pidió el cliente y por el §10.
3. **Dejar registro escrito del atraso del token** como suspensión del §10 (el correo del 18-10 y la respuesta de Ciro).
4. **No reclamar el trabajo fuera de alcance como «regalo».** Usarlo como argumento de valor: más del 95 % del esfuerzo cubrió el dolor real que se encontró el 09-09.
5. **Para la continuidad (noviembre):**
   - **Plan de continuidad del §18:** CLP 140.000 + IVA al mes.
   - **Etapa 2 productiva:** insumos, procesos, costo y rendimiento, cotizada por separado.
   - **Backlog de Comandas:** ~CLP 5,2 M, priorizado por paquetes.
   - **Bakery To Go:** como segundo cliente de Comandas, solo como opción futura.
6. **Antes de la reunión, ubicar** el informe de diagnóstico, el diseño y las métricas refinadas del Mes 1. Este informe no pudo verificarlos.
