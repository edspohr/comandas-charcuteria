import type { Order, OrderLine, Product, ProductFormat } from './types';

// Muestras: líneas a $0 dentro de un pedido (o un pedido solo de muestras).
// Salen del formato a granel del producto (80 g reservan 0,08 kg del
// granel); si el producto no tiene granel, una unidad de su formato más
// chico (un fuet, un paté). No generan demanda de producción, no van en la
// factura y se descuentan en Bsale como consumo interno al facturar o al
// registrar la salida. Después de la entrega el vendedor hace el seguimiento
// a los 7 días y la conversión se mide a 60 días.

export const SAMPLE_DEFAULT_GRAMS = 80;
export const SAMPLE_GRAM_OPTIONS = [50, 80, 100, 150];
export const SAMPLE_FOLLOWUP_DAYS = 7;
export const SAMPLE_CONVERSION_DAYS = 60;

export interface SampleSource { format: ProductFormat; byWeight: boolean }

export function sampleSourceFor(p: Product): SampleSource | null {
  const kg = p.formats.filter((f) => f.unit === 'kg');
  const bulk = kg.find((f) => !/pieza/i.test(`${f.formatId} ${f.label}`)) ?? kg[0];
  if (bulk) return { format: bulk, byWeight: true };
  const units = p.formats.filter((f) => f.unit !== 'kg').sort((a, b) => (a.grams ?? 1e9) - (b.grams ?? 1e9));
  return units[0] ? { format: units[0], byWeight: false } : null;
}

export interface SampleDraft {
  productId: string; productName: string; formatId: string; formatLabel: string;
  unit: OrderLine['unit']; qty: number; sample: true; sampleGrams?: number; notes?: string;
}

export function sampleLine(p: Product, grams = SAMPLE_DEFAULT_GRAMS, notes?: string): SampleDraft | null {
  const src = sampleSourceFor(p);
  if (!src) return null;
  if (src.byWeight) {
    return { productId: p.id, productName: p.name, formatId: src.format.formatId, formatLabel: `Muestra ${grams} g`, unit: 'kg', qty: grams / 1000, sample: true, sampleGrams: grams, notes };
  }
  return { productId: p.id, productName: p.name, formatId: src.format.formatId, formatLabel: `Muestra · ${src.format.label}`, unit: src.format.unit, qty: 1, sample: true, sampleGrams: src.format.grams, notes };
}

// A line's identity inside an order: a sample of Coppa comes out of the same
// bulk format as a regular Coppa line, so product+format alone collide.
export const lineKey = (l: Pick<OrderLine, 'productId' | 'formatId' | 'sample'>) => `${l.productId}::${l.formatId}${l.sample ? '::muestra' : ''}`;

export const isSampleLine = (l: Pick<OrderLine, 'sample'>) => !!l.sample;
export const hasSamples = (o: Pick<Order, 'lines'>) => o.lines.some(isSampleLine);
export const isSampleOnly = (o: Pick<Order, 'lines' | 'kind'>) => o.kind === 'muestras' || (o.lines.length > 0 && o.lines.every(isSampleLine));
export const sampleLabel = (l: Pick<OrderLine, 'sampleGrams' | 'qty' | 'unit'>) =>
  l.sampleGrams ? `${l.sampleGrams} g` : l.unit === 'kg' ? `${Math.round(l.qty * 1000)} g` : `${l.qty} u`;

// Kilos a descontar de Bsale (consumo interno): el peso empacado.
export const sampleShippedQty = (l: OrderLine) => (l.shortReason ? 0 : l.packedQty ?? l.reservedQty);

// "Incluir muestra de roast beef 80 gr", "muestra lomo kassler 80 gramos".
// Returns the product text and grams for each sample mention in free text.
export function parseSampleMentions(text: string): Array<{ raw: string; product: string; grams?: number }> {
  const out: Array<{ raw: string; product: string; grams?: number }> = [];
  const re = /(?:incluir\s+|agregar\s+|enviar\s+|mandar\s+)?muestras?\s+(?:de\s+|del\s+)?([^\n,;.]+?)(?:\s+(?:de\s+)?(\d{2,4})\s*(?:g|gr|grs|gramos)\b)?\s*(?=[\n,;.]|$)/gi;
  for (const m of text.matchAll(re)) {
    const product = m[1].trim().replace(/\s+(?:de\s+)?\d{2,4}\s*(?:g|gr|grs|gramos)$/i, '');
    if (product.length < 3) continue;
    out.push({ raw: m[0].trim(), product, grams: m[2] ? Number(m[2]) : undefined });
  }
  return out;
}

// ---------- Seguimiento y conversión ----------

export type SampleResult = 'gusto' | 'pidio' | 'no_interesa' | 'sin_respuesta';
export const SAMPLE_RESULT_LABEL: Record<SampleResult, string> = { gusto: 'Le gustó', pidio: 'Ya lo pidió', no_interesa: 'No le interesó', sin_respuesta: 'Sin respuesta aún' };

export interface SampleFeedback { id: string; orderId: string; productId: string; formatId: string; result: SampleResult; note?: string; by: string; at: number }
export const feedbackId = (orderId: string, l: Pick<OrderLine, 'productId' | 'formatId'>) => `${orderId}__${l.productId}__${l.formatId}`;

export type SampleStage = 'en_camino' | 'esperando' | 'por_seguir' | 'respondida';
export interface SampleRow {
  id: string; orderId: string; clientId: string; clientName: string; productId: string; productName: string; formatId: string;
  label: string; kg: number; sellerUid: string; createdAt: number; deliveredAt: number | null; dueAt: number | null; stage: SampleStage;
  feedback?: SampleFeedback; converted: { at: number; ref: string; revenue: number } | null; daysOverdue: number;
}

// A purchase of the sampled product by the same client in the 60 days after
// delivery. Sources: Comandas orders (always) and, when the Panel has them,
// Bsale sales (clients without an order in the app).
export interface Purchase { clientId: string; productId: string; at: number; ref: string; revenue: number }

const DAY = 86_400_000;
const deliveredAtOf = (o: Order) => [...o.statusHistory].reverse().find((h) => h.status === 'entregado')?.at ?? null;

export function purchasesFromOrders(orders: Order[]): Purchase[] {
  const out: Purchase[] = [];
  for (const o of orders) {
    if (o.status === 'anulado' || isSampleOnly(o)) continue;
    for (const l of o.lines) if (!l.sample && (l.packedQty ?? l.qty) > 0) out.push({ clientId: o.clientId, productId: l.productId, at: o.createdAt, ref: o.id, revenue: l.subtotalCLP ?? 0 });
  }
  return out;
}

export function sampleRows(orders: Order[], feedback: SampleFeedback[], purchases: Purchase[], now = Date.now()): SampleRow[] {
  const fb = new Map(feedback.map((f) => [f.id, f]));
  const byClientProduct = new Map<string, Purchase[]>();
  for (const p of purchases) { const k = `${p.clientId}|${p.productId}`; const l = byClientProduct.get(k) ?? []; l.push(p); byClientProduct.set(k, l); }
  const rows: SampleRow[] = [];
  for (const o of orders) {
    if (o.status === 'anulado') continue;
    for (const l of o.lines) {
      if (!l.sample || l.shortReason) continue;
      const deliveredAt = deliveredAtOf(o);
      const dueAt = deliveredAt ? deliveredAt + SAMPLE_FOLLOWUP_DAYS * DAY : null;
      const id = feedbackId(o.id, l);
      const f = fb.get(id);
      const from = deliveredAt ?? o.createdAt;
      const hit = (byClientProduct.get(`${o.clientId}|${l.productId}`) ?? [])
        .filter((p) => p.at > from && p.at <= from + SAMPLE_CONVERSION_DAYS * DAY && p.ref !== o.id)
        .sort((a, b) => a.at - b.at);
      const converted = hit.length ? { at: hit[0].at, ref: hit[0].ref, revenue: hit.reduce((s, p) => s + p.revenue, 0) } : null;
      // "Sin respuesta aún" snoozes the follow-up another 7 days.
      const snoozed = f?.result === 'sin_respuesta' && now < f.at + SAMPLE_FOLLOWUP_DAYS * DAY;
      const stage: SampleStage = f && f.result !== 'sin_respuesta' ? 'respondida'
        : snoozed ? 'esperando'
        : !deliveredAt ? 'en_camino'
        : now < dueAt! ? 'esperando' : 'por_seguir';
      rows.push({
        id, orderId: o.id, clientId: o.clientId, clientName: o.clientSnapshot.fantasyName ?? o.clientSnapshot.name,
        productId: l.productId, productName: l.productName, formatId: l.formatId, label: sampleLabel(l),
        kg: l.unit === 'kg' ? (l.packedQty ?? l.reservedQty) : ((l.sampleGrams ?? 0) / 1000) * (l.packedQty ?? l.reservedQty),
        sellerUid: o.createdBy, createdAt: o.createdAt, deliveredAt, dueAt, stage, feedback: f, converted,
        daysOverdue: dueAt && now > dueAt ? Math.floor((now - dueAt) / DAY) : 0,
      });
    }
  }
  return rows.sort((a, b) => (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0));
}
