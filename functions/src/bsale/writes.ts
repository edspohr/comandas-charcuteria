import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { BsaleHttpError, type BsaleApi, type RawClient } from './api';
import { requireFactory, type BsaleSettings } from './config';
import { confirmedMap, customerFromRaw, stripUndefined } from './sync';
import { loadCosts } from './facts';

// Escrituras hacia Bsale. Solo hechos que nacen en Comandas:
//   - recepción de producción terminada (fábrica)
//   - alta / corrección de clientes
//   - traslado fábrica → tienda
// Nunca ajustes directos de stock. Cada intento queda en bsale/writes/log
// (auditoría para el consultor) y, con dryRun, NO se envía: se registra el
// payload que se habría mandado.

export interface WriteResult<T = unknown> { dryRun: boolean; logId: string; response?: T }

async function logWrite(entry: Record<string, unknown>): Promise<string> {
  const ref = getFirestore().collection('bsale').doc('writes').collection('log').doc();
  await ref.set(stripUndefined({ id: ref.id, at: Date.now(), ...entry }));
  return ref.id;
}

export async function send<T>(api: BsaleApi, s: BsaleSettings, kind: string, by: string, method: 'POST' | 'PUT', path: string, body: unknown, ref?: string): Promise<WriteResult<T>> {
  if (!s.writesEnabled) throw new HttpsError('failed-precondition', 'Las escrituras hacia Bsale están desactivadas (Bsale → Configuración).');
  if (s.dryRun) {
    const logId = await logWrite({ kind, by, method, path, body, ref, dryRun: true, status: 'simulado' });
    return { dryRun: true, logId };
  }
  try {
    const response = method === 'POST' ? await api.post<T>(path, body) : await api.put<T>(path, body);
    const logId = await logWrite({ kind, by, method, path, body, ref, dryRun: false, status: 'ok', responseId: (response as { id?: unknown })?.id ?? null });
    return { dryRun: false, logId, response };
  } catch (e) {
    const detail = e instanceof BsaleHttpError ? { status: e.status, body: e.body } : { message: (e as Error).message };
    await logWrite({ kind, by, method, path, body, ref, dryRun: false, status: 'error', error: detail });
    logger.error(`[bsale] ${kind} falló`, detail);
    throw new HttpsError('unavailable', `Bsale rechazó la operación (${kind}). Quedó registrada en la bitácora de escrituras.`, detail);
  }
}

export interface QtyLine { productId: string; formatId: string; qty: number }

export async function variantsFor(lines: QtyLine[]): Promise<Array<QtyLine & { variantId: number }>> {
  const map = await confirmedMap(getFirestore());
  const reverse = new Map<string, string>();
  for (const [v, k] of map) if (!reverse.has(k)) reverse.set(k, v);
  const missing: string[] = [];
  const out = lines.filter((l) => l.qty > 0).map((l) => {
    const v = reverse.get(`${l.productId}__${l.formatId}`);
    if (!v) missing.push(`${l.productId} · ${l.formatId}`);
    return { ...l, variantId: Number(v) };
  });
  if (missing.length) throw new HttpsError('failed-precondition', `Sin cruce con Bsale: ${missing.join(', ')}. Confírmelos en Catálogo → Cruce con Bsale.`);
  return out;
}

// Receptions carry the variant's current average cost (bsale/facts.costs):
// a reception at cost 0 would drag Bsale's average cost down and erase the
// Panel margin. Without a known cost the field is left out.
async function withCosts<T extends { variantId: number }>(details: T[]): Promise<Array<T & { cost?: number }>> {
  const costs = await loadCosts();
  return details.map((d) => (costs[String(d.variantId)] ? { ...d, cost: costs[String(d.variantId)] } : d));
}

// POST /v1/stocks/receptions.json — producción terminada entra a la fábrica.
export async function receiveProduction(api: BsaleApi, s: BsaleSettings, by: string, lines: QtyLine[], note?: string) {
  const officeId = requireFactory(s);
  const items = await variantsFor(lines);
  if (!items.length) throw new HttpsError('invalid-argument', 'No hay cantidades para registrar.');
  const body = {
    document: 'Producción',
    officeId,
    documentNumber: `COM-${Date.now()}`,
    note: `Comandas · producción${note ? ` · ${note}` : ''}`,
    details: await withCosts(items.map((i) => ({ variantId: i.variantId, quantity: i.qty }))),
  };
  return send(api, s, 'recepcion_produccion', by, 'POST', '/v1/stocks/receptions.json', body);
}

// Traslado fábrica → tienda. Modo por defecto: consumo en fábrica +
// recepción en tienda (mueve el stock sin emitir un DTE). Modo 'guia': guía
// de despacho de traslado interno (requiere tipo de documento y de despacho
// configurados; verificar con el diagnóstico antes de activarlo).
export async function transferToStore(api: BsaleApi, s: BsaleSettings, by: string, orderId: string, lines: QtyLine[]) {
  const from = requireFactory(s);
  if (!s.storeOfficeId) throw new HttpsError('failed-precondition', 'Falta elegir la sucursal de tienda en Bsale → Configuración.');
  const items = await variantsFor(lines);
  if (!items.length) throw new HttpsError('invalid-argument', 'El traslado no tiene cantidades.');
  const note = `Comandas · traslado a tienda · ${orderId}`;
  if (s.transferMode === 'guia') {
    if (!s.transferDocumentTypeId || !s.transferShippingTypeId) throw new HttpsError('failed-precondition', 'Para trasladar con guía configure el tipo de documento y de despacho.');
    const body = {
      documentTypeId: s.transferDocumentTypeId,
      officeId: from,
      destinationOfficeId: s.storeOfficeId,
      emissionDate: Math.floor(Date.now() / 1000),
      shippingTypeId: s.transferShippingTypeId,
      declareSii: 1,
      details: items.map((i) => ({ variantId: i.variantId, quantity: i.qty })),
      note,
    };
    return { guia: await send(api, s, 'traslado_guia', by, 'POST', '/v1/shippings.json', body, orderId) };
  }
  const details = items.map((i) => ({ variantId: i.variantId, quantity: i.qty }));
  const consumo = await send(api, s, 'traslado_consumo', by, 'POST', '/v1/stocks/consumptions.json', { officeId: from, note, details }, orderId);
  const recepcion = await send(api, s, 'traslado_recepcion', by, 'POST', '/v1/stocks/receptions.json', {
    document: 'Traslado', officeId: s.storeOfficeId, documentNumber: orderId, note, details: await withCosts(details),
  }, orderId);
  return { consumo, recepcion };
}

export interface CustomerInput { name: string; fantasyName?: string; rut?: string; giro?: string; address?: string; city?: string; phone?: string; email?: string }

function clientBody(i: Partial<CustomerInput>) {
  // Bsale: company = razón social, activity = giro, code = RUT.
  return stripUndefined({
    company: i.name,
    firstName: i.fantasyName ?? i.name,
    code: i.rut,
    activity: i.giro,
    address: i.address,
    city: i.city,
    phone: i.phone,
    email: i.email,
    companyOrPerson: i.rut ? 1 : 0,
  });
}

export async function createClient(api: BsaleApi, s: BsaleSettings, by: string, input: CustomerInput) {
  const r = await send<RawClient>(api, s, 'cliente_alta', by, 'POST', '/v1/clients.json', clientBody(input));
  return { ...r, customer: r.response ? customerFromRaw(r.response) : null };
}

export async function updateClient(api: BsaleApi, s: BsaleSettings, by: string, bsaleId: string, patch: Partial<CustomerInput>) {
  const r = await send<RawClient>(api, s, 'cliente_edicion', by, 'PUT', `/v1/clients/${bsaleId}.json`, { id: Number(bsaleId), ...clientBody(patch) });
  return { ...r, customer: r.response ? customerFromRaw(r.response) : null };
}
