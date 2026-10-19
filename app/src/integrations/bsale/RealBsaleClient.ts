import { httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db, functions } from '@/data/firebase';
import type { Order } from '@/domain/types';
import type {
  BsaleClient, BsaleCustomer, BsaleCustomerInput, BsaleDocument, BsaleVariantStock,
} from './BsaleClient';
import { bsale as mock } from './MockBsaleClient';

// Bsale real. El browser nunca habla con la API: todo pasa por Cloud
// Functions (functions/src/bsale), que tienen el token, sincronizan los
// espejos en Firestore y registran cada escritura en bsale/writes/log.
//   - Stock y clientes: los sincroniza el servidor (cron + webhooks +
//     bsaleSyncNow). La app lee stock/* y clients/*.
//   - Documentos: espejo en bsale/sales/documents (para vincular y analizar).
//   - Altas/ediciones de clientes: callables con modo simulacro.

export const REAL_DOCS_PATH = ['bsale', 'sales', 'documents'] as const;

const createFn = httpsCallable<BsaleCustomerInput, { dryRun: boolean; customer: BsaleCustomer | null }>(functions, 'bsaleCreateClient');
const updateFn = httpsCallable<{ bsaleClientId: string; patch: Partial<BsaleCustomerInput> }, { dryRun: boolean; customer: BsaleCustomer | null }>(functions, 'bsaleUpdateClient');

export class RealBsaleClient implements BsaleClient {
  async getStocks(): Promise<BsaleVariantStock[]> {
    throw new Error('En modo real el stock lo sincroniza el servidor (bsaleSyncNow).');
  }

  async getDocuments(params: { sinceMs?: number; unlinkedOnly?: boolean; limit?: number } = {}): Promise<BsaleDocument[]> {
    const clauses = params.sinceMs != null ? [where('emittedAt', '>=', params.sinceMs)] : [];
    const q = query(collection(db, ...REAL_DOCS_PATH), ...clauses, orderBy('emittedAt', 'desc'), limit(params.limit ?? 100));
    const snap = await getDocs(q);
    const out: BsaleDocument[] = [];
    snap.forEach((d) => out.push(d.data() as BsaleDocument));
    return params.unlinkedOnly ? out.filter((d) => !d.linkedOrderId) : out;
  }

  async getDocument(id: string): Promise<BsaleDocument | null> {
    const snap = await getDoc(doc(db, ...REAL_DOCS_PATH, id));
    return snap.exists() ? (snap.data() as BsaleDocument) : null;
  }

  async getClients(): Promise<BsaleCustomer[]> {
    throw new Error('En modo real los clientes los sincroniza el servidor (bsaleSyncNow).');
  }

  // null = Bsale está en simulacro: el alta quedó en la bitácora sin enviarse.
  async createClient(input: BsaleCustomerInput): Promise<BsaleCustomer | null> {
    return (await createFn(input)).data.customer;
  }

  async updateClient(id: string, patch: Partial<BsaleCustomerInput>): Promise<BsaleCustomer | null> {
    return (await updateFn({ bsaleClientId: id, patch })).data.customer;
  }

  buildPayload(order: Order, invoiceRef?: string): unknown {
    // El contrato del documento no depende del modo.
    return mock.buildPayload(order, invoiceRef);
  }
}
