# Decisiones de arquitectura (ADR)

Formato corto: contexto, decisión y consecuencias. Una decisión nueva que reemplace a otra la marca como *Reemplazada por ADR-NNNN*.

| ADR | Decisión | Estado | Fecha |
|---|---|---|---|
| [0001](0001-bsale-fuente-de-verdad.md) | Bsale es la fuente de verdad; Comandas es dueño de los pedidos | Aceptada | 18-10-2026 |
| [0002](0002-stock-reservas-transaccionales.md) | Stock en colección propia y reserva en la misma transacción que el pedido | Aceptada | 09-2026 |
| [0003](0003-un-perfil-por-usuario.md) | Un perfil por usuario como custom claim | Aceptada | 19-10-2026 |
| [0004](0004-escrituras-bsale-servidor.md) | Escrituras a Bsale solo desde Cloud Functions, con bitácora, simulacro y PIN | Aceptada | 18-10-2026 |
| [0005](0005-facturacion-pos-y-vincular.md) | Semana 1: facturar en el POS de Bsale y vincular en Comandas | Aceptada | 23-10-2026 |
| [0006](0006-stock-informativo.md) | Stock informativo por defecto | Aceptada | 23-10-2026 |
| [0007](0007-pin-personal.md) | PIN personal autoasignado, ingreso con correo + PIN y reverificación en acciones clave | Aceptada | 24-10-2026 |
| [0008](0008-excepciones-con-aprobacion.md) | Pedidos con condición especial requieren aprobación de superAdmin | Aceptada | 23-10-2026 |
| [0009](0009-horario-entrega-obligatorio.md) | Horario de entrega desde–hasta obligatorio | Aceptada | 23-10-2026 |
| [0010](0010-muestras-consumo-interno.md) | Muestras como consumo interno en Bsale, seguimiento a 7 días y conversión a 60 | Aceptada | 19-10-2026 |
| [0011](0011-gemini-con-fallback.md) | Gemini vía Firebase AI Logic con App Check, e intérprete determinista de respaldo | Aceptada | 23-09-2026 |
| [0012](0012-hechos-venta-por-mes.md) | Hechos de venta de Bsale comprimidos por mes para el Panel | Aceptada | 19-10-2026 |
| [0013](0013-staging-separado.md) | Proyecto de staging separado con Bsale simulado | Aceptada | 24-10-2026 |
| [0014](0014-bitacora-produccion.md) | Bitácora de producción en Comandas, independiente de las escrituras a Bsale | Aceptada | 24-10-2026 |
| [0015](0015-salud-de-cliente.md) | Reglas de salud de cliente (activo, en riesgo, inactivo/perdido) | Aceptada, con revisión pendiente | 19-10-2026 |
