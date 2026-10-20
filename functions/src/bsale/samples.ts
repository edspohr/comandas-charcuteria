import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { BsaleApi } from './api';
import { requireFactory, type BsaleSettings } from './config';
import { stripUndefined } from './sync';
import { send, variantsFor } from './writes';

// Muestras: salen de fábrica sin factura. Se descuentan de Bsale como
// consumo interno (POST /v1/stocks/consumptions.json) con una nota que dice
// a quién y en qué pedido, una sola vez por pedido (order.samplesConsumption).
// Se llama al facturar desde Comandas, al vincular un documento del POS y al
// registrar la salida de un pedido solo de muestras.

interface Line { productId: string; formatId: string; productName: string; sample?: boolean; reservedQty: number; packedQty?: number; shortReason?: string }
interface Order { id: string; clientSnapshot?: { name?: string; fantasyName?: string }; lines: Line[]; samplesConsumption?: unknown }

export async function consumeSamples(api: BsaleApi | null, s: BsaleSettings, by: string, orderId: string) {
  const db = getFirestore();
  const ref = db.doc(`orders/${orderId}`);
  const order = (await ref.get()).data() as Order | undefined;
  if (!order) throw new HttpsError('not-found', 'Pedido no encontrado.');
  if (order.samplesConsumption) return { already: true, ...(order.samplesConsumption as object) };
  const lines = order.lines
    .filter((l) => l.sample && !l.shortReason)
    .map((l) => ({ productId: l.productId, formatId: l.formatId, qty: Math.round((l.packedQty ?? l.reservedQty) * 1000) / 1000 }))
    .filter((l) => l.qty > 0);
  const refText = `MU-${orderId}`;
  const record = (extra: Record<string, unknown>) => ref.update({ samplesConsumption: stripUndefined({ at: Date.now(), by, ref: refText, ...extra }) });
  if (!lines.length) { await record({ skipped: true }); return { skipped: true, reason: 'sin muestras empacadas' }; }
  // Selling must not stop because Bsale writes are off: the sample stays in
  // the app's history and administración can register it later.
  if (!api || !s.enabled || !s.writesEnabled) { await record({ skipped: true }); return { skipped: true, reason: 'escrituras a Bsale apagadas' }; }
  const officeId = requireFactory(s);
  const items = await variantsFor(lines);
  const client = order.clientSnapshot?.fantasyName ?? order.clientSnapshot?.name ?? '';
  const note = `Muestra · ${client} · ${orderId}`.slice(0, 200);
  const r = await send(api, s, 'muestras_consumo', by, 'POST', '/v1/stocks/consumptions.json', {
    officeId, note, details: items.map((i) => ({ variantId: i.variantId, quantity: i.qty })),
  }, orderId);
  await record({ dryRun: r.dryRun, logId: r.logId });
  return { dryRun: r.dryRun, logId: r.logId };
}
