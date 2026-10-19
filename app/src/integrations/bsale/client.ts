import type { BsaleClient } from './BsaleClient';
import { bsale as mock } from './MockBsaleClient';
import { RealBsaleClient, REAL_DOCS_PATH } from './RealBsaleClient';

// Selector del cliente Bsale. `mock` (default, desarrollo local) lee y
// escribe el "lado Bsale" simulado en Firestore (bsaleMock/*, bsaleClients,
// bsaleDocuments) y la Consola Bsale lo opera. `real` usa la API a través de
// Cloud Functions. Todo el resto de la app importa desde acá.
export const BSALE_MODE: 'mock' | 'real' = (import.meta.env.VITE_BSALE_MODE ?? 'mock').toLowerCase() === 'real' ? 'real' : 'mock';
export const isRealBsale = BSALE_MODE === 'real';

export const bsale: BsaleClient = isRealBsale ? new RealBsaleClient() : mock;

// Where linked-document state lives (vincularDocumento writes linkedOrderId).
export const DOCUMENTS_PATH: string[] = isRealBsale ? [...REAL_DOCS_PATH] : ['bsaleDocuments'];
