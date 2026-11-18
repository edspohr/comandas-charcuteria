import { afterEach, expect, it, vi } from 'vitest';
import { BsaleApi, BsaleHttpError } from '../../functions/src/bsale/api';
afterEach(() => vi.unstubAllGlobals());
it('no reintenta un POST de pago ante una respuesta ambigua del proveedor', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));
  vi.stubGlobal('fetch', fetch);
  await expect(new BsaleApi('test').postOnce('/payments.json', { amount: 1 })).rejects.toBeInstanceOf(BsaleHttpError);
  expect(fetch).toHaveBeenCalledTimes(1);
});
