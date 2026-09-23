import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, where } from 'firebase/firestore';
import { db } from '@/data/firebase';
import type { Order } from '@/domain/types';
import type {
  BsaleClient, BsaleCustomer, BsaleCustomerInput, BsaleDocument, BsaleVariantStock,
} from './BsaleClient';

// MockBsaleClient — plays the role of the Bsale API using a small "Bsale
// side" kept in Firestore:
//   bsaleMock/stock        { quantities: { [sku]: qty }, updatedAt }
//   bsaleMock/counters     { factura, boleta }
//   bsaleDocuments/{id}    documents emitted at the (simulated) POS
//   bsaleReceptions/{id}   production received into Bsale
//   bsaleClients/{id}      the client master (what /v1/clients.json returns)
// The simulated POS / factory actions live in ./mockAdmin.ts (Consola Bsale).
// Swapping this class for the real client = same interface, token in a Cloud
// Function, no UI changes.

export const MOCK_OFFICE_ID = 1;

export interface BsaleMockStockDoc { quantities: Record<string, number>; updatedAt: number; }

export class MockBsaleClient implements BsaleClient {
  async getStocks(officeId: number = MOCK_OFFICE_ID): Promise<BsaleVariantStock[]> {
    const snap = await getDoc(doc(db, 'bsaleMock', 'stock'));
    if (!snap.exists()) return [];
    const data = snap.data() as BsaleMockStockDoc;
    return Object.entries(data.quantities).map(([sku, quantity]) => ({
      variantId: `v-${sku}`,
      sku,
      officeId,
      quantity,
      quantityAvailable: quantity,
    }));
  }

  async getDocuments(params: { sinceMs?: number; unlinkedOnly?: boolean; limit?: number } = {}): Promise<BsaleDocument[]> {
    const clauses = [];
    if (params.sinceMs != null) clauses.push(where('emittedAt', '>=', params.sinceMs));
    const q = query(collection(db, 'bsaleDocuments'), ...clauses, orderBy('emittedAt', 'desc'), limit(params.limit ?? 100));
    const snap = await getDocs(q);
    const out: BsaleDocument[] = [];
    snap.forEach((d) => out.push(d.data() as BsaleDocument));
    return params.unlinkedOnly ? out.filter((d) => !d.linkedOrderId) : out;
  }

  async getDocument(id: string): Promise<BsaleDocument | null> {
    const snap = await getDoc(doc(db, 'bsaleDocuments', id));
    return snap.exists() ? (snap.data() as BsaleDocument) : null;
  }

  async getClients(): Promise<BsaleCustomer[]> {
    const snap = await getDocs(collection(db, 'bsaleClients'));
    const out: BsaleCustomer[] = [];
    snap.forEach((d) => out.push(d.data() as BsaleCustomer));
    return out;
  }

  async createClient(input: BsaleCustomerInput): Promise<BsaleCustomer> {
    const ref = doc(collection(db, 'bsaleClients'));
    const created: BsaleCustomer = { id: ref.id, ...input, updatedAt: Date.now() };
    await setDoc(ref, created);
    return created;
  }

  // netUnitValue matches how the real Bsale API expects it: neto (sin IVA)
  // por unidad. For sachet/unit formats it's the snapshot price / 1.19; for
  // weight-based formats we divide the line subtotal by the actual quantity.
  buildPayload(order: Order, invoiceRef?: string): unknown {
    return {
      documentTypeId: 1,       // Factura Electrónica
      officeId: MOCK_OFFICE_ID,
      emissionDate: new Date().toISOString().slice(0, 10),
      invoiceRef: invoiceRef ?? order.invoiceRef ?? null,
      client: {
        rut: order.clientSnapshot.rut ?? null,
        name: order.clientSnapshot.name,
        address: order.clientSnapshot.address ?? null,
      },
      details: order.lines
        .filter((l) => (l.packedQty ?? l.reservedQty) > 0)
        .map((l) => {
          const invoicedQty = l.packedQty ?? l.reservedQty;
          const subtotal = l.subtotalCLP ?? 0;
          const netUnitValue = subtotal > 0 ? Math.round(subtotal / 1.19 / invoicedQty) : 0;
          return {
            netUnitValue,
            quantity: invoicedQty,
            taxId: [1],
            comment: `${l.productName} · ${l.formatLabel}${l.notes ? ` · ${l.notes}` : ''}`,
            variant: { sku: `${l.productId}__${l.formatId}` },
          };
        }),
      totalCLP: order.totalCLP ?? null,
      references: [{ documentReference: order.id, reason: 'Comandas' }],
    };
  }
}

// Singleton for the app — swap for a real client behind the same interface.
export const bsale: BsaleClient = new MockBsaleClient();
