import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { BsaleApi, RawDocument } from './api';
import { docKindFor, type BsaleSettings, type DocKind } from './config';
import { fetchDocumentsInRange, stripUndefined } from './sync';

// Hechos de venta para el Panel de gestión, construidos desde los documentos
// de Bsale (fuente de la verdad de lo vendido). Un documento por mes:
//
//   bsale/facts/months/{YYYY-MM}
//     { month, updatedAt, complete, docCount, lineCount, dayHash, data: Bytes }
//
// `data` es JSON gzip { docs, lines, clients, sellers } — 24 meses son 24
// lecturas (~50–150 KB cada una) en vez de ~48.000 documentos.
//   docs:  [day, docId, kind, officeId, sellerId, clientId, net, total]
//   lines: [day, kind, officeId, sellerId, clientId, variantId, qty, net]  (agregadas)
// Notas de crédito van con signo negativo; documentos anulados (state ≠ 0)
// no entran. `dayHash` permite reescribir solo cuando un día cambió.
//
//   bsale/facts  { costsUpdatedAt, costs: { variantId: costoPromedioNeto } }

export type DocRow = [number, string, DocKind, number, string, string, number, number];
export type LineRow = [number, DocKind, number, string, string, string, number, number];
interface MonthData { docs: DocRow[]; lines: LineRow[]; clients: Record<string, string>; sellers: Record<string, string> }

const MONTHS = 'bsale/facts/months';
// What counts as a sale: invoices, receipts and credit notes (negative).
// Dispatch guides don't add up (they are usually invoiced later).
export const SALES_KINDS = new Set<DocKind>(['factura', 'boleta', 'nota_credito', 'otro']);
export const dayOf = (emissionS: number) => new Date(Number(emissionS) * 1000).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 1000) / 1000;

function rowsForDay(raws: RawDocument[], s: BsaleSettings) {
  const docs: DocRow[] = [];
  const agg = new Map<string, LineRow>();
  const clients: Record<string, string> = {};
  const sellers: Record<string, string> = {};
  for (const d of raws) {
    if (Number(d.state ?? 0) !== 0) continue;
    const kind = docKindFor(s, d.document_type?.id, d.document_type?.codeSii, d.document_type?.name);
    const sign = kind === 'nota_credito' ? -1 : 1;
    const day = Number(dayOf(d.emissionDate).slice(8, 10));
    const office = Number(d.office?.id ?? 0);
    const seller = d.sellers?.items?.[0] ?? d.user;
    const sellerId = seller?.id != null ? String(seller.id) : '0';
    if (seller?.id != null) sellers[sellerId] = [seller.firstName, seller.lastName].filter(Boolean).join(' ').trim() || `Usuario ${sellerId}`;
    const clientId = d.client?.id != null ? String(d.client.id) : '0';
    if (d.client?.id != null) {
      const name = (d.client.company || [d.client.firstName, d.client.lastName].filter(Boolean).join(' ') || '').trim();
      clients[clientId] = `${name}|${d.client.code ?? ''}`;
    }
    const total = Number(d.totalAmount ?? 0);
    const net = Number(d.netAmount ?? Math.round(total / 1.19));
    docs.push([day, String(d.id), kind, office, sellerId, clientId, sign * net, sign * total]);
    for (const it of d.details?.items ?? []) {
      const v = String(it.variant?.id ?? '0');
      const qty = Number(it.quantity ?? 0);
      const lineNet = it.netAmount != null ? Number(it.netAmount) : Number(it.netUnitValue ?? 0) * qty;
      const key = `${day}|${kind}|${office}|${sellerId}|${clientId}|${v}`;
      const row = agg.get(key) ?? [day, kind, office, sellerId, clientId, v, 0, 0];
      row[6] = r2(row[6] + sign * qty);
      row[7] = Math.round(row[7] + sign * lineNet);
      agg.set(key, row);
    }
  }
  return { docs, lines: [...agg.values()], clients, sellers };
}

const hashOf = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('base64').slice(0, 12);

function decode(buf: unknown): MonthData {
  if (!buf) return { docs: [], lines: [], clients: {}, sellers: {} };
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from((buf as { toUint8Array?: () => Uint8Array }).toUint8Array?.() ?? (buf as Uint8Array));
  return JSON.parse(gunzipSync(bytes).toString('utf8')) as MonthData;
}

// Replaces the given days (YYYY-MM-DD) with the rows built from `raws`. Days
// listed without documents become empty. Only months whose day hashes
// changed are rewritten.
export async function writeFactDays(raws: RawDocument[], s: BsaleSettings, days: string[], opts: { complete?: boolean } = {}): Promise<number> {
  const db = getFirestore();
  const byMonth = new Map<string, Map<string, RawDocument[]>>();
  for (const day of days) {
    const m = day.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, new Map());
    byMonth.get(m)!.set(day, []);
  }
  for (const d of raws) {
    const day = dayOf(d.emissionDate);
    byMonth.get(day.slice(0, 7))?.get(day)?.push(d);
  }
  let written = 0;
  for (const [month, perDay] of byMonth) {
    const ref = db.doc(`${MONTHS}/${month}`);
    const snap = await ref.get();
    const prev = snap.data() as { dayHash?: Record<string, string>; data?: unknown; complete?: boolean } | undefined;
    const dayHash = { ...(prev?.dayHash ?? {}) };
    const fresh = new Map<number, ReturnType<typeof rowsForDay>>();
    // A historical load (complete) always rewrites: it is an explicit request
    // and also rebuilds the month's entry in the index.
    let changed = !snap.exists || !!opts.complete;
    for (const [day, list] of perDay) {
      const rows = rowsForDay(list, s);
      const dd = day.slice(8, 10);
      const h = hashOf([rows.docs, rows.lines]);
      if (dayHash[dd] !== h) { dayHash[dd] = h; changed = true; }
      fresh.set(Number(dd), rows);
    }
    if (!changed) continue;
    const data = decode(prev?.data);
    const out: MonthData = {
      docs: data.docs.filter((r) => !fresh.has(r[0])),
      lines: data.lines.filter((r) => !fresh.has(r[0])),
      clients: data.clients,
      sellers: data.sellers,
    };
    for (const rows of fresh.values()) {
      out.docs.push(...rows.docs); out.lines.push(...rows.lines);
      Object.assign(out.clients, rows.clients); Object.assign(out.sellers, rows.sellers);
    }
    const gz = gzipSync(Buffer.from(JSON.stringify(out)));
    if (gz.length > 950_000) logger.error(`[bsale] hechos ${month}: ${gz.length} bytes, cerca del límite de Firestore`);
    await ref.set(stripUndefined({
      month, updatedAt: Date.now(), complete: !!(opts.complete || prev?.complete),
      docCount: out.docs.length, lineCount: out.lines.length, bytes: gz.length, dayHash, data: gz,
    }));
    // Cheap index for the app: which months exist, how complete they are and
    // their net sales per office (the 24-month chart reads only this).
    const netByOffice: Record<string, number> = {};
    for (const r of out.docs) if (SALES_KINDS.has(r[2])) netByOffice[r[3]] = (netByOffice[r[3]] ?? 0) + r[6];
    const net = Object.values(netByOffice).reduce((a, b) => a + b, 0);
    await db.doc('bsale/facts').set({ months: { [month]: { docCount: out.docs.length, bytes: gz.length, net, netByOffice, complete: !!(opts.complete || prev?.complete), updatedAt: Date.now() } } }, { merge: true });
    written++;
  }
  return written;
}

export function daysBetween(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${fromDay}T00:00:00Z`); t <= Date.parse(`${toDay}T00:00:00Z`); t += 86400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// Rebuilds a whole month from Bsale (historical load, one call per month
// from the app so each stays well under the function timeout).
export async function backfillMonth(api: BsaleApi, s: BsaleSettings, month: string): Promise<{ month: string; documents: number; bytes?: number }> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Mes inválido: ${month}`);
  const [y, m] = month.split('-').map(Number);
  const from = Date.UTC(y, m - 1, 1) / 1000;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const to = Math.min(Date.UTC(y, m, 1) / 1000 - 1, Math.floor(Date.now() / 1000));
  const raws = await fetchDocumentsInRange(api, from, to);
  await writeFactDays(raws, s, daysBetween(`${month}-01`, last < today ? last : today), { complete: true });
  const snap = await getFirestore().doc(`${MONTHS}/${month}`).get();
  return { month, documents: raws.length, bytes: snap.data()?.bytes };
}

// Costo promedio neto por variante (GET /v1/variants/{id}/costs.json). Bsale
// lo calcula de las recepciones; si las recepciones van sin costo el margen
// sale vacío, y el Panel lo muestra como "costo no informado".
export async function refreshCosts(api: BsaleApi, variantIds: string[]): Promise<{ withCost: number; total: number }> {
  const costs: Record<string, number> = {};
  for (const id of variantIds) {
    try {
      const r = await api.get<{ averageCost?: number; history?: Array<{ cost?: number }> }>(`/variants/${id}/costs.json`);
      const c = Number(r?.averageCost ?? r?.history?.[0]?.cost ?? 0);
      if (c > 0) costs[id] = Math.round(c * 100) / 100;
    } catch (e) {
      logger.warn(`[bsale] costo variante ${id}`, (e as Error).message);
    }
  }
  await getFirestore().doc('bsale/facts').set({ costs, costsUpdatedAt: Date.now() }, { merge: true });
  await getFirestore().doc('bsale/facts').update({ costs });
  return { withCost: Object.keys(costs).length, total: variantIds.length };
}

export async function loadCosts(): Promise<Record<string, number>> {
  return ((await getFirestore().doc('bsale/facts').get()).data()?.costs ?? {}) as Record<string, number>;
}
