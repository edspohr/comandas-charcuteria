import { getDocs, collection, doc, runTransaction } from 'firebase/firestore';
import { db } from '@/data/firebase';
// MockBsaleClient — reads/writes local Firestore in the shape a future
// real Bsale integration would use. No external network calls. The demo
// admin screens surface the JSON payload the client WOULD send, so
// stakeholders can see the contract.
export class MockBsaleClient {
    async getProducts() {
        const snap = await getDocs(collection(db, 'products'));
        const out = [];
        snap.forEach((d) => {
            const p = d.data();
            out.push({ id: p.id, sku: p.id, name: p.name });
        });
        return out;
    }
    async getStock() {
        const snap = await getDocs(collection(db, 'stock'));
        const out = {};
        snap.forEach((d) => {
            const s = d.data();
            out[d.id] = s.onHand;
        });
        return out;
    }
    async getCustomers() {
        const snap = await getDocs(collection(db, 'clients'));
        const out = [];
        snap.forEach((d) => {
            const c = d.data();
            out.push({ id: c.id, name: c.name, rut: c.rut });
        });
        return out;
    }
    // Simulates document creation. Bumps counters/bsale-YYYY, assigns
    // FA-NNNNNN, returns both the number and the payload we would have
    // POSTed to Bsale.
    async createDocument(order) {
        const year = new Date().getFullYear();
        const counterRef = doc(db, 'counters', `bsale-${year}`);
        const docNumber = await runTransaction(db, async (tx) => {
            const snap = await tx.get(counterRef);
            const nextN = (snap.data()?.last ?? 0) + 1;
            tx.set(counterRef, { last: nextN }, { merge: true });
            return `FA-${String(nextN).padStart(6, '0')}`;
        });
        const payload = {
            documentTypeId: 1, // Factura Electrónica
            officeId: 1,
            emissionDate: new Date().toISOString().slice(0, 10),
            client: {
                rut: order.clientSnapshot.rut ?? null,
                name: order.clientSnapshot.name,
                address: order.clientSnapshot.address ?? null,
            },
            details: order.lines
                .filter((l) => (l.packedQty ?? l.reservedQty) > 0)
                .map((l) => ({
                netUnitValue: 0, // prices out of scope for the mockup
                quantity: l.packedQty ?? l.reservedQty,
                taxId: [1],
                comment: `${l.productName} · ${l.formatLabel}${l.notes ? ` · ${l.notes}` : ''}`,
                product: { id: l.productId, sku: l.productId },
            })),
            references: [{ documentReference: order.id, reason: 'Comandas' }],
        };
        return { docNumber, payload };
    }
    async postStockConsumption(_movements) {
        // In the real integration, this would POST to /stocks/consumptions.
        // For the mockup, consumo movements are already written by markArmado()
        // in the local audit log. Nothing to send.
        return;
    }
}
// Singleton for the app — swap for a real client behind the same interface.
export const bsale = new MockBsaleClient();
