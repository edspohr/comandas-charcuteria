export type Role = 'vendedor' | 'despacho' | 'produccion' | 'admin' | 'superAdmin';

export type Unit = 'g' | 'kg' | 'unidad';

export type DeliveryMode = 'retiro' | 'despacho';

export type OrderStatus =
  | 'recibido'
  | 'confirmado'
  | 'confirmado_parcial'
  | 'en_armado'
  | 'armado'
  | 'facturado'
  | 'despachado'
  | 'entregado'
  | 'anulado';

export type StockMovementType =
  | 'reserva'
  | 'liberacion'
  | 'consumo'
  | 'produccion'
  | 'ajuste'
  | 'traslado_tienda'
  | 'sync_bsale'      // onHand overwritten with the quantity Bsale reports
  | 'venta_bsale';    // reservation released because a Bsale document was linked

export interface ProductFormat {
  formatId: string;
  label: string;
  unit: Unit;
  grams?: number;
  // Pricing (CLP con IVA). Two possible shapes depending on the format:
  //   - Fixed-weight sachets / units → `priceCLP` per unit (qty × priceCLP).
  //   - Weight-based formats (granel-kg, pieza) → `pricePerKgCLP` × weight.
  // For `pieza` formats we also carry `avgWeightKg` so the UI can preview a
  // valorization at order time before the packer weighs the piece.
  priceCLP?: number;
  pricePerKgCLP?: number;
  avgWeightKg?: number;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  active: boolean;
  discontinued: boolean;
  formats: ProductFormat[];
  aliases?: string[];
}

// Stock is a *mirror* of Bsale, not a source of truth. `onHand` is the last
// quantity Bsale reported for the variant (see syncStockFromBsale); the app
// never moves it on its own except to pre-apply a sale that was just linked
// (the next sync overwrites it anyway). `reserved` is app-only: Bsale has no
// notion of reservations, so open orders hold their quantity here and
// available = onHand − reserved.
export interface StockDoc {
  productId: string;
  formatId: string;
  onHand: number;
  reserved: number;
  bsaleVariantId?: string;
  syncedAt?: number;
}

export function stockDocId(productId: string, formatId: string): string {
  return `${productId}__${formatId}`;
}

export function available(stock: Pick<StockDoc, 'onHand' | 'reserved'>): number {
  return stock.onHand - stock.reserved;
}

export interface Client {
  id: string;
  name: string;
  fantasyName?: string;
  rut?: string;
  giro?: string;
  address?: string;
  contactPhone?: string;
  email?: string;
  deliveryMode: DeliveryMode;
  receivingHours?: string;
  notes?: string;
  isInternalShop?: boolean;
  invoicingComplete: boolean;
  // Alta rápida desde el wizard / parser. Queda pendiente de revisión por
  // administración hasta completar los datos de facturación.
  source?: 'seed' | 'app';
  createdBy?: string;
  createdAt?: number;
  needsReview?: boolean;
  // Vendedor responsable de la cuenta (cartera). Drives the sales-force
  // supervision block in the dashboard.
  ownerUid?: string;
  // Bsale is the master for client data: this doc is a mirror refreshed by
  // syncFromBsale. App-only fields (ownerUid, deliveryMode, receivingHours,
  // notes, isInternalShop) survive the sync.
  bsaleClientId?: string;
  bsaleSyncedAt?: number;
  // Future CRM link (HubSpot Company). The app only caches a copy.
  hubspotCompanyId?: string;
}

export interface OrderLine {
  productId: string;
  productName: string;
  formatId: string;
  formatLabel: string;
  unit: Unit;
  qty: number;
  notes?: string;
  reservedQty: number;
  pendingProductionQty: number;
  packedQty?: number;
  packedWeightKg?: number;
  // Valorization snapshot (CLP con IVA). Stored so historic orders keep
  // their price even if the catalog moves later. For pieza formats the
  // estimated subtotal at order time uses `avgWeightKg`; on markArmado we
  // overwrite with the actual `packedWeightKg`-based figure.
  unitPriceSnapshotCLP?: number;
  subtotalCLP?: number;
}

export interface StatusEvent {
  status: OrderStatus;
  by: string;
  at: number;
  note?: string;
}

export interface DeliveryProof {
  note?: string;
}

export interface Order {
  id: string;
  createdBy: string;
  clientId: string;
  clientSnapshot: Pick<Client, 'name' | 'fantasyName' | 'rut' | 'address'>;
  lines: OrderLine[];
  requestedDate: string;
  deliveryMode: DeliveryMode;
  deliveryAddress?: string;
  receivingHours?: string;
  status: OrderStatus;
  assignedPackerId?: string;
  statusHistory: StatusEvent[];
  invoiceRef?: string;
  // Id of the Bsale document (factura/boleta emitted at the POS) that was
  // linked to this order. The number lives in invoiceRef for display.
  bsaleDocumentId?: string;
  deliveredBy?: string;
  deliveryProof?: DeliveryProof;
  source: 'app' | 'pasted';
  rawText?: string;
  invoicingComplete: boolean;
  createdAt: number;
  updatedAt: number;
  // Sum of lines[].subtotalCLP. Kept as a denormalized snapshot so the Panel
  // aggregations don't need to look up the catalog.
  totalCLP?: number;
}

export interface StockMovement {
  id: string;
  productId: string;
  formatId: string;
  qty: number;
  type: StockMovementType;
  orderId?: string;
  by: string;
  at: number;
  reason?: string;
}

export interface AppUser {
  uid: string;
  displayName: string;
  role: Role;
  email: string;
}

// Thresholds that drive the kanban card colours. Editable in settings/app
// without a deploy.
export interface KanbanThresholds {
  armadoSinDocHoras: number;        // armado hace > N h sin documento → ámbar
  despachadoSinEntregaHoras: number; // despachado hace > N h sin entregar → ámbar
  sinAsignarHoras: number;          // pendiente sin armador hace > N h → ámbar
  cerradoDias: number;              // cuántos días de entregados mostrar en Cerrado
}

export const DEFAULT_KANBAN_THRESHOLDS: KanbanThresholds = {
  armadoSinDocHoras: 4,
  despachadoSinEntregaHoras: 24,
  sinAsignarHoras: 2,
  cerradoDias: 7,
};

export interface Settings {
  cutoffHour: number;
  timezone: 'America/Santiago';
  kanban?: KanbanThresholds;
  // Días sin pedir que definen activo / en riesgo / inactivo.
  clientHealth?: { activoDias: number; riesgoDias: number };
  // Bsale office whose stock backs the pedidos (fábrica Franklin).
  bsaleOfficeId?: number;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  recibido: 'Recibido',
  confirmado: 'Confirmado',
  confirmado_parcial: 'Confirmado parcial',
  en_armado: 'En armado',
  armado: 'Armado',
  facturado: 'Facturado',
  despachado: 'Despachado',
  entregado: 'Entregado',
  anulado: 'Anulado',
};

