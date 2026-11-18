import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ api: vi.fn(), settings: { enabled: true, writesEnabled: true, dryRun: false, paymentsEnabled: false } }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ doc: () => ({ get: async () => ({ exists: true, get: (k: string) => k === 'role' ? 'vendedor' : undefined }) }) }) }));
vi.mock('../../functions/src/bsale/api', () => ({ BSALE_TOKEN: {}, apiFromSecret: mocks.api }));
vi.mock('../../functions/src/bsale/config', () => ({ requireRole: () => ({ uid: 'seller', role: 'vendedor' }), loadSettings: async () => mocks.settings, requireEnabled: vi.fn() }));
vi.mock('../../functions/src/pin', () => ({ checkPin: vi.fn() }));
import { bsaleRecordPayment } from '../../functions/src/bsale/receivables';
it('bloquea el callable de pagos antes de construir un cliente Bsale aunque la escritura general esté activa', async () => {
  await expect(bsaleRecordPayment.run({ data: { amount: 100 } } as never)).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(mocks.api).not.toHaveBeenCalled();
});
