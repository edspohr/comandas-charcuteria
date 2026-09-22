import type { Order, StockMovement } from '@/domain/types';

// External-facing types for the Bsale ERP.
// Kept minimal — expanded when real integration lands.
export interface BsaleCustomer { id: string; rut?: string; name: string; }
export interface BsaleProduct  { id: string; sku: string; name: string; }

export interface BsaleClient {
  getProducts(): Promise<BsaleProduct[]>;
  getStock(): Promise<Record<string, number>>;
  getCustomers(): Promise<BsaleCustomer[]>;
  createDocument(order: Order): Promise<{ docNumber: string; payload: unknown }>;
  postStockConsumption(movements: StockMovement[]): Promise<void>;
}
