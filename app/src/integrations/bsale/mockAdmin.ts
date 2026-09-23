import { collection, doc, runTransaction } from 'firebase/firestore';
import { db } from '@/data/firebase';
import type { Order } from '@/domain/types';
import type { BsaleDocument, BsaleDocumentType, BsaleReception } from './BsaleClient';
import { MOCK_OFFICE_ID, type BsaleMockStockDoc } from './MockBsaleClient';

// Simulated Bsale-side actions for the demo (Consola Bsale, superAdmin).
// In production these things happen *in Bsale* — the factory loads finished
// goods, the cashier emits the document at the POS — and the app only reads
// the result through BsaleClient. Nothing here is called by the operational
// flow except `emitDocumentForOrder`, which is the "Simular emisión en POS"
// shortcut inside Vincular documento.

export interface EmitLine { sku: string; description: string; quantity: number; subtotalCLP: number; }

const stockRef = () => doc(db, 'bsaleMock', 'stock');
const countersRef = () => doc(db, 'bsaleMock', 'counters');

// Production received into Bsale (fábrica → bodega). Only touches the mock
// Bsale stock; the app learns about it on the next sync.
export async function receiveProduction(sku: string, quantity: number, by: string, note?: string): Promise<void> {
  if (quantity <= 0) throw new Error('Cantidad debe ser mayor a cero');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(stockRef());
    const prev: BsaleMockStockDoc = snap.exists() ? (snap.data() as BsaleMockStockDoc) : { quantities: {}, updatedAt: 0 };
    const now = Date.now();
    tx.set(stockRef(), { quantities: { ...prev.quantities, [sku]: (prev.quantities[sku] ?? 0) + quantity }, updatedAt: now });
    const recRef = doc(collection(db, 'bsaleReceptions'));
    const rec: BsaleReception = { id: recRef.id, sku, quantity, note, at: now, by };
    tx.set(recRef, rec);
  });
}

// A document emitted at the POS: discounts Bsale stock for each line and
// appends the document. `reference` is what the cashier typed (usually the
// pedido id) so the app can suggest the match.
export async function emitDocument(input: {
  type: BsaleDocumentType;
  clientName: string;
  clientRut?: string;
  lines: EmitLine[];
  reference?: string;
}): Promise<BsaleDocument> {
  if (input.lines.length === 0) throw new Error('El documento necesita al menos una línea');
  return await runTransaction(db, async (tx) => {
    const stockSnap = await tx.get(stockRef());
    const counterSnap = await tx.get(countersRef());
    const prev: BsaleMockStockDoc = stockSnap.exists() ? (stockSnap.data() as BsaleMockStockDoc) : { quantities: {}, updatedAt: 0 };
    const counters = (counterSnap.data() ?? {}) as Partial<Record<BsaleDocumentType, number>>;
    const nextN = (counters[input.type] ?? 0) + 1;
    const prefix = input.type === 'factura' ? 'FA' : input.type === 'boleta' ? 'BO' : 'GD';
    const number = `${prefix}-${String(nextN).padStart(6, '0')}`;

    const quantities = { ...prev.quantities };
    for (const l of input.lines) quantities[l.sku] = (quantities[l.sku] ?? 0) - l.quantity;
    const now = Date.now();
    tx.set(stockRef(), { quantities, updatedAt: now });
    tx.set(countersRef(), { ...counters, [input.type]: nextN }, { merge: true });

    const docRef = doc(collection(db, 'bsaleDocuments'));
    const document: BsaleDocument = {
      id: docRef.id,
      type: input.type,
      number,
      officeId: MOCK_OFFICE_ID,
      emissionDate: new Date(now).toISOString().slice(0, 10),
      emittedAt: now,
      clientRut: input.clientRut,
      clientName: input.clientName,
      totalCLP: Math.round(input.lines.reduce((s, l) => s + l.subtotalCLP, 0)),
      details: input.lines.map((l) => ({
        variantId: `v-${l.sku}`,
        sku: l.sku,
        description: l.description,
        quantity: l.quantity,
        netUnitValue: l.quantity > 0 ? Math.round(l.subtotalCLP / 1.19 / l.quantity) : 0,
      })),
      reference: input.reference,
    };
    tx.set(docRef, document);
    return document;
  });
}

// Shortcut for the demo: the cashier emits the document for a packed order.
export function emitDocumentForOrder(order: Order, type: BsaleDocumentType = 'factura'): Promise<BsaleDocument> {
  return emitDocument({
    type,
    clientName: order.clientSnapshot.name,
    clientRut: order.clientSnapshot.rut,
    reference: order.id,
    lines: order.lines
      .filter((l) => (l.packedQty ?? l.reservedQty) > 0)
      .map((l) => ({
        sku: `${l.productId}__${l.formatId}`,
        description: `${l.productName} · ${l.formatLabel}`,
        quantity: l.packedQty ?? l.reservedQty,
        subtotalCLP: l.subtotalCLP ?? 0,
      })),
  });
}
