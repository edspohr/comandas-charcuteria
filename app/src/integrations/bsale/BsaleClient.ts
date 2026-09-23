import type { Order } from '@/domain/types';

// External-facing types for the Bsale ERP, shaped after the real REST API
// (https://docs.bsale.cl): a *variant* is one sellable SKU (our
// producto+formato), stock is reported per variant per office, and a sale is a
// *document* (factura / boleta) emitted at a point of sale. Bsale discounts
// stock when the document is emitted — the app never writes stock in Bsale.
export interface BsaleVariantStock {
  variantId: string;       // Bsale variant id
  sku: string;             // our `${productId}__${formatId}`
  officeId: number;
  quantity: number;        // physical quantity in the office
  quantityAvailable: number;
}

export type BsaleDocumentType = 'factura' | 'boleta' | 'guia';

export interface BsaleDocumentDetail {
  variantId: string;
  sku: string;
  description: string;
  quantity: number;
  netUnitValue: number;
}

export interface BsaleDocument {
  id: string;
  type: BsaleDocumentType;
  number: string;          // FA-000823 / BO-004102
  officeId: number;
  emissionDate: string;    // YYYY-MM-DD
  emittedAt: number;       // ms epoch
  clientRut?: string;
  clientName: string;
  totalCLP: number;
  details: BsaleDocumentDetail[];
  reference?: string;      // free-text reference the cashier typed (often the PED id)
  linkedOrderId?: string;  // app-side: which pedido consumed this document
}

export interface BsaleReception {
  id: string;
  sku: string;
  quantity: number;
  note?: string;
  at: number;
  by: string;
}

// GET /v1/clients.json — Bsale is the master for client data.
export interface BsaleCustomer {
  id: string;
  rut?: string;
  name: string;          // razón social (companyName) or persona
  fantasyName?: string;  // "activity"/alias in Bsale, nombre comercial para nosotros
  giro?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  updatedAt?: number;
}

export interface BsaleCustomerInput {
  name: string;
  fantasyName?: string;
  rut?: string;
  giro?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
}

export interface BsaleClient {
  // GET /v1/stocks.json?officeid=… — one row per variant.
  getStocks(officeId?: number): Promise<BsaleVariantStock[]>;
  // GET /v1/documents.json?emissiondate=… — documents emitted at the POS.
  getDocuments(params?: { sinceMs?: number; unlinkedOnly?: boolean; limit?: number }): Promise<BsaleDocument[]>;
  getDocument(id: string): Promise<BsaleDocument | null>;
  // GET /v1/clients.json (paginated) — full client list for the mirror.
  getClients(): Promise<BsaleCustomer[]>;
  // POST /v1/clients.json — alta rápida desde la app crea el cliente en Bsale.
  createClient(input: BsaleCustomerInput): Promise<BsaleCustomer>;
  // Pure — the payload a real integration would POST to /v1/documents.json.
  // Kept so stakeholders can see the contract from the app.
  buildPayload(order: Order, invoiceRef?: string): unknown;
}
