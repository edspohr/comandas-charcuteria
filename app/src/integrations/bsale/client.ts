import type { BsaleClient } from './BsaleClient';
import { bsale as mock } from './MockBsaleClient';
import { RealBsaleClient } from './RealBsaleClient';

// Selector del cliente Bsale a usar. Por defecto (y en la demo) es el mock
// que lee/escribe las colecciones bsaleMock/*, bsaleClients y bsaleDocuments.
// Con `VITE_BSALE_MODE=real` se usa RealBsaleClient (requiere la Cloud
// Function `bsaleProxy` desplegada + secret `BSALE_ACCESS_TOKEN`).
//
// Migración: cambiar el import a `@/integrations/bsale/client` en los
// consumidores (data/stock.ts, data/clients.ts, components/orders/OrderDialogs.tsx)
// para que respeten el flag. La demo sigue funcionando idéntica.
const MODE = (import.meta.env.VITE_BSALE_MODE ?? 'mock').toLowerCase();

export const bsale: BsaleClient = MODE === 'real' ? new RealBsaleClient() : mock;
export const BSALE_MODE = MODE;
