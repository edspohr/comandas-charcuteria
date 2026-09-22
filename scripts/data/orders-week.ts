import type { Order, OrderLine, OrderStatus, DeliveryMode } from '../../app/src/domain/types.ts';
import { clients } from './clients.ts';
import { products } from './products.ts';
import { users } from './users.ts';

const byId = <T extends { id: string }>(arr: T[], id: string): T => {
  const found = arr.find((x) => x.id === id);
  if (!found) throw new Error(`missing seed reference: ${id}`);
  return found;
};

const line = (productId: string, formatId: string, qty: number, reserved: number, pending = 0, notes?: string, packedQty?: number, packedWeightKg?: number): OrderLine => {
  const prod = byId(products, productId);
  const fmt = prod.formats.find((f) => f.formatId === formatId);
  if (!fmt) throw new Error(`missing format ${formatId} on ${productId}`);
  return {
    productId,
    productName: prod.name,
    formatId,
    formatLabel: fmt.label,
    unit: fmt.unit,
    qty,
    reservedQty: reserved,
    pendingProductionQty: pending,
    notes,
    packedQty,
    packedWeightKg,
  };
};

const DAY = (dayOfMonth: number) => `2026-09-${String(dayOfMonth).padStart(2, '0')}`;

const asTs = (dayOfMonth: number, hour: number, min: number) =>
  Date.parse(`2026-09-${String(dayOfMonth).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`);

// Helper to build a full order with plausible statusHistory
const mk = (
  id: string,
  createdByUid: string,
  clientId: string,
  requestedDay: number,
  createdDay: number,
  createdHour: number,
  status: OrderStatus,
  lines: OrderLine[],
  extra: Partial<Order> = {},
): Order => {
  const client = byId(clients, clientId);
  const createdAt = asTs(createdDay, createdHour, 5);
  const updatedAt = asTs(Math.min(requestedDay + 1, 22), 14, 0);
  const flow: OrderStatus[] = ['recibido'];
  const chain: OrderStatus[] = ['confirmado', 'confirmado_parcial', 'en_armado', 'armado', 'facturado', 'despachado', 'entregado'];
  for (const s of chain) {
    if (flow.includes(status)) break;
    flow.push(s);
    if (s === status) break;
  }
  if (status === 'anulado') flow.push('anulado');
  const statusHistory = flow.map((s, i) => ({
    status: s,
    by: i === 0 ? createdByUid : (extra.assignedPackerId ?? 'u-edu'),
    at: asTs(Math.min(createdDay + Math.floor(i / 2), 22), createdHour + i, 15),
  }));
  return {
    id,
    createdBy: createdByUid,
    clientId,
    clientSnapshot: { name: client.name, fantasyName: client.fantasyName, rut: client.rut, address: client.address },
    lines,
    requestedDate: DAY(requestedDay),
    deliveryMode: (extra.deliveryMode ?? client.deliveryMode) as DeliveryMode,
    deliveryAddress: extra.deliveryAddress ?? client.address,
    receivingHours: extra.receivingHours ?? client.receivingHours,
    status,
    assignedPackerId: extra.assignedPackerId,
    statusHistory,
    invoiceRef: extra.invoiceRef,
    deliveredBy: extra.deliveredBy,
    deliveryProof: extra.deliveryProof,
    source: extra.source ?? 'app',
    rawText: extra.rawText,
    invoicingComplete: extra.invoicingComplete ?? client.invoicingComplete,
    createdAt,
    updatedAt,
    ...extra,
  } as Order;
};

// Week 15–21 Sep 2026. Today = 22 (Mon).
// Approx 40 orders across statuses. Ids: PED-2026-0001..0040.
export const weekOrders: Order[] = [
  // --- Mon 15 Sep (entregado/despachado — closed) ---
  mk('PED-2026-0001', 'u-rafael', 'hotel-magnolia', 15, 15, 8, 'entregado', [
    line('jamon-cocido', 'sachet-500g', 12, 12),
    line('mortadela-pistacho', 'granel-kg', 3, 3, 0, 'laminado fino'),
    line('gouda-ahumado', 'sachet-200g', 20, 20),
  ], { assignedPackerId: 'u-edu', invoiceRef: 'FA-000811', deliveredBy: 'Ciro (retiro)', deliveryProof: { note: 'Recibido por chef Andrés' } }),

  mk('PED-2026-0002', 'u-ramiro', 'santa-brasa-central', 15, 12, 10, 'entregado', [
    line('longaniza-chillan', 'sachet-5kg', 24, 24, 0, 'Pedido semanal'),
  ], { assignedPackerId: 'u-morena', invoiceRef: 'FA-000812', deliveredBy: 'Courier Chilexpress', deliveryProof: { note: 'Firmado por bodega' } }),

  mk('PED-2026-0003', 'u-gabriela', 'emporio-dulce-vida', 15, 14, 16, 'entregado', [
    line('salame-italiano', 'granel-kg', 2, 2),
    line('coppa', 'granel-kg', 1.5, 1.5),
    line('fuet-tradicional', 'pieza', 6, 6),
  ], { assignedPackerId: 'u-edu', invoiceRef: 'FA-000813' }),

  mk('PED-2026-0004', 'u-juan', 'carloto', 15, 14, 18, 'entregado', [
    line('bacon-ahumado', 'granel-kg', 4, 4),
    line('guanciale', 'pieza', 2, 2, 0, 'para carbonara'),
  ], { assignedPackerId: 'u-morena', invoiceRef: 'FA-000814' }),

  // --- Tue 16 Sep ---
  mk('PED-2026-0005', 'u-tania', 'hotel-costanera', 16, 15, 9, 'entregado', [
    line('jamon-ahumado', 'granel-kg', 5, 5),
    line('pastrami-vacuno', 'granel-kg', 3, 3),
  ], { assignedPackerId: 'u-edu', invoiceRef: 'FA-000815' }),

  mk('PED-2026-0006', 'u-elizabeth', 'impasto', 16, 15, 11, 'despachado', [
    line('mortadela-pistacho', 'granel-kg', 4, 4, 0, 'lonjas gruesas'),
    line('prosciutto', 'granel-kg', 2, 2),
  ], { assignedPackerId: 'u-morena', invoiceRef: 'FA-000816', deliveredBy: 'Repartidor propio' }),

  mk('PED-2026-0007', 'u-lucy', 'bakery-to-go', 16, 15, 13, 'entregado', [
    line('jamon-cocido', 'sachet-200g', 30, 30),
    line('gouda-ahumado', 'sachet-200g', 30, 30),
  ], { assignedPackerId: 'u-edu', invoiceRef: 'FA-000817' }),

  mk('PED-2026-0008', 'u-rafael', 'tienda', 16, 16, 8, 'entregado', [
    line('salame-milano', 'pieza', 8, 8, 0, 'Reposición vitrina'),
    line('chorizo-espanol', 'pieza', 10, 10),
    line('fuet-cranberries', 'pieza', 6, 6),
  ], { assignedPackerId: 'u-morena', deliveredBy: 'Traslado interno' }),

  // --- Wed 17 Sep ---
  mk('PED-2026-0009', 'u-ramiro', 'santa-brasa-vitacura', 17, 16, 10, 'entregado', [
    line('longaniza-chillan', 'sachet-5kg', 6, 6),
  ], { assignedPackerId: 'u-edu', invoiceRef: 'FA-000818' }),

  mk('PED-2026-0010', 'u-ramiro', 'santa-brasa-nueva-costanera', 17, 16, 10, 'entregado', [
    line('longaniza-chillan', 'sachet-5kg', 6, 6),
  ], { assignedPackerId: 'u-edu', invoiceRef: 'FA-000819' }),

  mk('PED-2026-0011', 'u-gabriela', 'charcuteria-garcia', 17, 16, 15, 'despachado', [
    line('salame-italiano', 'pieza', 4, 4),
    line('salame-angus', 'pieza', 4, 4),
    line('coppa', 'pieza', 2, 2),
    line('lardo', 'granel-kg', 1, 1),
  ], { assignedPackerId: 'u-morena', invoiceRef: 'FA-000820' }),

  mk('PED-2026-0012', 'u-juan', 'oven-chile', 17, 16, 16, 'facturado', [
    line('brisket', 'pieza', 1, 1, 0, 'sold ~3.8 kg', 1, 2.6),
  ], { assignedPackerId: 'u-edu', invoiceRef: 'FA-000821' }),

  // --- Thu 18 Sep ---
  mk('PED-2026-0013', 'u-tania', 'yamba', 18, 17, 9, 'facturado', [
    line('cabanossi-x12', 'sachet-x12', 20, 20),
    line('salchicha-parrillera', 'sachet-1kg', 8, 8),
  ], { assignedPackerId: 'u-morena', invoiceRef: 'FA-000822' }),

  mk('PED-2026-0014', 'u-elizabeth', 'hotel-magnolia', 18, 17, 10, 'armado', [
    line('jamon-cocido', 'sachet-500g', 10, 10),
    line('pastrami-cerdo', 'granel-kg', 2, 2, 0, 'sin jugo'),
  ], { assignedPackerId: 'u-edu' }),

  mk('PED-2026-0015', 'u-lucy', 'emporio-dulce-vida', 18, 17, 11, 'armado', [
    line('gouda-ahumado', 'granel-kg', 3, 3),
    line('cabra-ahumado', 'granel-kg', 2, 2),
  ], { assignedPackerId: 'u-morena' }),

  mk('PED-2026-0016', 'u-rafael', 'cafeteria-sofa', 18, 18, 8, 'armado', [
    line('jamon-cocido', 'sachet-200g', 20, 20),
    line('mortadela-clasica', 'sachet-200g', 10, 10),
  ], { assignedPackerId: 'u-edu', invoicingComplete: false }),

  // --- Fri 19 Sep ---
  mk('PED-2026-0017', 'u-ramiro', 'santa-brasa-central', 19, 17, 10, 'armado', [
    line('longaniza-chillan', 'sachet-5kg', 28, 28, 0, 'Pedido semanal principal'),
    line('chistorra', 'sachet-1kg', 6, 6),
  ], { assignedPackerId: 'u-morena' }),

  mk('PED-2026-0018', 'u-gabriela', 'impasto', 19, 18, 9, 'en_armado', [
    line('guanciale', 'granel-kg', 3, 3),
    line('mortadela-pistacho', 'granel-kg', 2, 2),
  ], { assignedPackerId: 'u-edu' }),

  mk('PED-2026-0019', 'u-juan', 'hotel-costanera', 19, 18, 10, 'en_armado', [
    line('lomo-kassler', 'granel-kg', 3, 3),
    line('speck', 'granel-kg', 2, 2),
    line('bacon-ahumado', 'sachet-500g', 12, 12),
  ], { assignedPackerId: 'u-morena' }),

  mk('PED-2026-0020', 'u-tania', 'carloto', 19, 18, 11, 'en_armado', [
    line('bacon-ahumado', 'granel-kg', 3, 3),
    line('mortadela-clasica', 'granel-kg', 2, 2),
  ], { assignedPackerId: 'u-edu' }),

  mk('PED-2026-0021', 'u-elizabeth', 'fran-gc', 19, 18, 12, 'confirmado', [
    line('salame-italiano', 'pieza', 12, 12),
    line('salame-milano', 'pieza', 12, 12),
    line('salame-angus', 'pieza', 8, 8),
    line('coppa', 'pieza', 6, 6),
  ]),

  // --- Sat 20 Sep ---
  mk('PED-2026-0022', 'u-lucy', 'bakery-to-go', 20, 18, 14, 'confirmado', [
    line('jamon-cocido', 'sachet-200g', 40, 40),
    line('gouda-ahumado', 'sachet-200g', 40, 40),
  ]),

  mk('PED-2026-0023', 'u-rafael', 'yamba', 20, 19, 8, 'confirmado', [
    line('pastrami-vacuno', 'granel-kg', 4, 4, 0, 'para sándwich del día'),
    line('cabra-ahumado', 'granel-kg', 2, 2),
  ]),

  mk('PED-2026-0024', 'u-ramiro', 'santa-brasa-la-dehesa', 20, 19, 9, 'confirmado', [
    line('longaniza-chillan', 'sachet-5kg', 6, 6),
    line('choricillo', 'sachet-1kg', 10, 10),
  ]),

  mk('PED-2026-0025', 'u-gabriela', 'tienda', 20, 19, 10, 'confirmado', [
    line('tabla-150', 'tabla-150', 30, 30, 0, 'Reposición fin de semana'),
    line('tabla-200', 'tabla-200', 20, 20),
    line('pate-campesino', 'pote-150g', 15, 15),
    line('rillette-cerdo', 'pote-150g', 15, 15),
  ]),

  // --- Sun 21 Sep ---
  mk('PED-2026-0026', 'u-juan', 'oven-chile', 21, 19, 15, 'confirmado', [
    line('brisket', 'pieza', 2, 2, 0, 'preparar ~4 kg c/u'),
    line('bacon-ahumado', 'granel-kg', 4, 4),
  ]),

  mk('PED-2026-0027', 'u-tania', 'hotel-magnolia', 21, 20, 8, 'confirmado', [
    line('jamon-ahumado', 'granel-kg', 3, 3),
    line('mortadela-pistacho', 'granel-kg', 2, 2, 0, 'lonjas finas'),
    line('gouda-ahumado', 'sachet-500g', 12, 12),
  ]),

  mk('PED-2026-0028', 'u-elizabeth', 'emporio-dulce-vida', 21, 20, 10, 'confirmado', [
    line('fuet-tradicional', 'pieza', 10, 10),
    line('fuet-cranberries', 'pieza', 6, 6),
    line('cabanossi-x3', 'sachet-x3', 20, 20),
  ]),

  // --- Today Mon 22 Sep — active + edge cases ---
  mk('PED-2026-0029', 'u-lucy', 'charcuteria-garcia', 22, 22, 9, 'confirmado_parcial', [
    // Longaniza chillán sachet 5 kg — pediron 20, hay 8 disponibles, 12 quedan a producción
    line('longaniza-chillan', 'sachet-5kg', 20, 8, 12, 'Split parcial: 8 hoy, 12 a producir'),
    line('chorizo-espanol', 'pieza', 6, 6),
  ]),

  mk('PED-2026-0030', 'u-rafael', 'cafeteria-sofa', 22, 22, 10, 'recibido', [
    line('jamon-cocido', 'sachet-200g', 10, 10),
    line('mortadela-clasica', 'sachet-200g', 6, 6),
  ], { invoicingComplete: false, source: 'pasted', rawText: '10 sachets jamón cocido 200g y 6 mortadela clásica 200g' }),

  mk('PED-2026-0031', 'u-ramiro', 'santa-brasa-central', 22, 22, 8, 'confirmado', [
    line('longaniza-chillan', 'sachet-5kg', 4, 4, 0, 'Repos rápida sitios centro'),
  ]),

  mk('PED-2026-0032', 'u-gabriela', 'yamba', 22, 22, 11, 'recibido', [
    line('salame-picante', 'pieza', 6, 6),
    line('sopressata', 'pieza', 4, 4),
    line('nduja', 'pote-150g', 8, 8, 0, 'preguntar por acidez'),
  ]),

  mk('PED-2026-0033', 'u-juan', 'impasto', 22, 22, 11, 'confirmado', [
    line('guanciale', 'granel-kg', 2, 2, 0, 'entero mejor'),
    line('mortadela-pistacho', 'granel-kg', 3, 3),
  ]),

  mk('PED-2026-0034', 'u-tania', 'oven-chile', 22, 22, 12, 'recibido', [
    line('cecina-chilena', 'granel-kg', 2, 2),
    line('charqui-vacuno', 'sachet-200g', 20, 20),
  ]),

  mk('PED-2026-0035', 'u-elizabeth', 'tienda', 22, 22, 13, 'confirmado', [
    line('tabla-120', 'tabla-120', 40, 40, 0, 'Reposición vitrina'),
    line('tabla-250', 'tabla-250', 10, 10),
    line('mantequilla-tocino', 'pote-150g', 8, 8),
  ]),

  mk('PED-2026-0036', 'u-lucy', 'hotel-costanera', 22, 22, 14, 'recibido', [
    line('jamon-cocido', 'sachet-1kg', 6, 6),
    line('lomo-kassler', 'granel-kg', 2, 2),
  ]),

  mk('PED-2026-0037', 'u-rafael', 'fran-gc', 22, 21, 16, 'confirmado_parcial', [
    // Coppa: piden 10 piezas, hay 4, 6 a producción
    line('coppa', 'pieza', 10, 4, 6),
    line('lardo', 'granel-kg', 2, 2),
  ]),

  mk('PED-2026-0038', 'u-ramiro', 'bakery-to-go', 22, 22, 7, 'confirmado', [
    line('jamon-ahumado', 'sachet-200g', 30, 30),
    line('gouda-ahumado', 'sachet-200g', 30, 30),
  ]),

  mk('PED-2026-0039', 'u-gabriela', 'hotel-magnolia', 22, 22, 8, 'recibido', [
    line('jamon-cocido', 'sachet-500g', 8, 8),
    line('pastrami-cerdo', 'granel-kg', 2, 2, 0, 'lonjas medianas'),
  ]),

  mk('PED-2026-0040', 'u-juan', 'carloto', 20, 18, 17, 'anulado', [
    line('bacon-ahumado', 'granel-kg', 4, 0, 0, 'Cliente canceló por evento reprogramado'),
  ], { assignedPackerId: undefined }),
];

export { users };
