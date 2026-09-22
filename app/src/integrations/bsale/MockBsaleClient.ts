import { getDocs, collection, doc, runTransaction } from 'firebase/firestore';
import { db } from '@/data/firebase';
import type { BsaleClient, BsaleCustomer, BsaleProduct } from './BsaleClient';
import type { Order, StockMovement } from '@/domain/types';

// MockBsaleClient — reads/writes local Firestore in the shape a future
// real Bsale integration would use. No external network calls. The demo
// admin screens surface the JSON payload the client WOULD send, so
// stakeholders can see the contract.
export class MockBsaleClient implements BsaleClient {
  async getProducts(): Promise<BsaleProduct[]> {
    const snap = await getDocs(collection(db, 'products'));
    const out: BsaleProduct[] = [];
    snap.forEach((d) => {
      const p = d.data() as { id: string; name: string };
      out.push({ id: p.id, sku: p.id, name: p.name });
    });
    return out;
  }

  async getStock(): Promise<Record<string, number>> {
    const snap = await getDocs(collection(db, 'stock'));
    const out: Record<string, number> = {};
    snap.forEach((d) => {
      const s = d.data() as { onHand: number };
      out[d.id] = s.onHand;
    });
    return out;
  }

  async getCustomers(): Promise<BsaleCustomer[]> {
    const snap = await getDocs(collection(db, 'clients'));
    const out: BsaleCustomer[] = [];
    snap.forEach((d) => {
      const c = d.data() as { id: string; name: string; rut?: string };
      out.push({ id: c.id, name: c.name, rut: c.rut });
    });
    return out;
  }

  // Pure payload builder. Passes through invoiceRef so previews can show the
  // number that will (or already did) get assigned. Kept separate from
  // createDocument so the Sincronizar preview doesn't accidentally consume
  // invoice numbers.
  //
  // netUnitValue matches how the real Bsale API expects it: neto (sin IVA)
  // por unidad. For sachet/unit formats it's the snapshot price / 1.19; for
  // weight-based formats we divide the line subtotal by the actual quantity
  // (packedWeightKg si aplica, si no packedQty).
  buildPayload(order: Order, invoiceRef?: string): unknown {
    return {
      documentTypeId: 1,       // Factura Electrónica
      officeId: 1,
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
            product: { id: l.productId, sku: l.productId },
          };
        }),
      totalCLP: order.totalCLP ?? null,
      references: [{ documentReference: order.id, reason: 'Comandas' }],
    };
  }

  // Bumps counters/bsale-YYYY transactionally and returns the new invoice
  // number + the payload that was built with it. Only used from Facturar.
  async createDocument(order: Order): Promise<{ docNumber: string; payload: unknown }> {
    const year = new Date().getFullYear();
    const counterRef = doc(db, 'counters', `bsale-${year}`);
    const docNumber = await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const nextN = ((snap.data()?.last as number | undefined) ?? 0) + 1;
      tx.set(counterRef, { last: nextN }, { merge: true });
      return `FA-${String(nextN).padStart(6, '0')}`;
    });
    return { docNumber, payload: this.buildPayload(order, docNumber) };
  }

  async postStockConsumption(_movements: StockMovement[]): Promise<void> {
    // In the real integration, this would POST to /stocks/consumptions.
    // For the mockup, consumo movements are already written by markArmado()
    // in the local audit log. Nothing to send.
    return;
  }
}

// Singleton for the app — swap for a real client behind the same interface.
export const bsale: BsaleClient = new MockBsaleClient();
