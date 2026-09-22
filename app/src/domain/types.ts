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
  | 'traslado_tienda';

export interface ProductFormat {
  formatId: string;
  label: string;
  unit: Unit;
  grams?: number;
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

export interface StockDoc {
  productId: string;
  formatId: string;
  onHand: number;
  reserved: number;
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
  deliveredBy?: string;
  deliveryProof?: DeliveryProof;
  source: 'app' | 'pasted';
  rawText?: string;
  invoicingComplete: boolean;
  createdAt: number;
  updatedAt: number;
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

export interface Settings {
  cutoffHour: number;
  timezone: 'America/Santiago';
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

export const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  recibido: ['confirmado', 'confirmado_parcial', 'anulado'],
  confirmado: ['en_armado', 'anulado'],
  confirmado_parcial: ['confirmado', 'en_armado', 'anulado'],
  en_armado: ['armado', 'anulado'],
  armado: ['facturado', 'anulado'],
  facturado: ['despachado'],
  despachado: ['entregado'],
};
