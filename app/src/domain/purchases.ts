// Compras e insumos (ADR-0017). Una compra es un documento (factura o guía)
// con las cajas que llegaron; al confirmarla se crean los lotes de insumo.

export type SupplyKind = 'carne' | 'otro';
export type SupplyUnit = 'kg' | 'unidad';

export interface Supplier { id: string; rut: string; name: string; createdAt: number; createdBy: string }

export interface Supply {
  id: string;
  name: string;
  kind: SupplyKind;
  unit: SupplyUnit;
  /** Códigos de etiqueta que identifican el insumo: GTIN, EAN o prefijo de peso variable. */
  codes: string[];
  /** Descripciones de documentos de compra ya asociadas (normalizadas). */
  aliases: string[];
  createdAt: number;
  createdBy: string;
  updatedAt: number;
}

// 'ninguno': compra registrada sin documento tributario (el cuadre con la
// factura es opcional; el documento se puede adjuntar después).
export type DocKind = 'factura' | 'guia' | 'otro' | 'ninguno';
export const DOC_KIND_LABEL: Record<DocKind, string> = { factura: 'Factura', guia: 'Guía de despacho', otro: 'Otro documento', ninguno: 'Sin documento' };
export const docKindFromDte = (td: number): DocKind => (td === 52 ? 'guia' : [33, 34, 46].includes(td) ? 'factura' : 'otro');
export const DTE_OF: Record<DocKind, number> = { factura: 33, guia: 52, otro: 0, ninguno: 0 };

export interface DocLine {
  description: string;
  code?: string;
  qty?: number;
  unit?: 'kg' | 'unidad' | 'otro';
  unitPrice?: number;
  total?: number;
  supplyId?: string;
}

export type BoxSource = 'gs1' | 'peso_variable' | 'ean' | 'foto' | 'manual';
export interface ReceivedBox {
  key: string;           // id local (React)
  supplyId: string;
  kg?: number;
  units?: number;
  lot?: string;
  expiry?: string;
  prodDate?: string;
  code?: string;
  serial?: string;
  source: BoxSource;
  raw?: string;
  /** Texto leído de la etiqueta (foto), para ayudar a elegir el insumo. */
  description?: string;
  /** Peso de un EAN de peso variable: la posición es supuesta, hay que confirmarlo. */
  weightAssumed?: boolean;
}

export interface PurchaseSupplyRow { supplyId: string; name: string; unit: SupplyUnit; boxes: number; kg: number; units: number; docKg?: number; docTotal?: number; costPerKg?: number }

// Foto o PDF del documento guardado en Storage (purchases/{id}/…).
export interface PurchaseDocument { path: string; name: string; contentType: string; size: number; uploadedAt: number; uploadedBy: string }

export interface Purchase {
  id: string;
  supplierRut: string;
  supplierName: string;
  docKind: DocKind;
  dte?: number;
  folio: string;
  issuedAt?: string;
  totalCLP?: number;
  /** Factura que cobra mercadería ya recibida con guía: no suma stock. */
  againstGuide?: boolean;
  guideFolio?: string;
  lines: DocLine[];
  boxes: Omit<ReceivedBox, 'key'>[];
  summary: PurchaseSupplyRow[];
  read: { timbre: boolean; foto: boolean };
  /** Imágenes o PDF del documento recibido, para consultarlo después. */
  documents?: PurchaseDocument[];
  note?: string;
  receivedBy: string;
  receivedByName: string;
  receivedAt: number;
  /** Segundos desde que se empezó la recepción (KPI-3). */
  durationSec?: number;
  /** Compra (purchaseOrders) contra la que se recibió, si había una. */
  orderId?: string;
}

export interface SupplyLot {
  id: string;
  supplyId: string;
  supplyName: string;
  origin: 'compra' | 'inventario';
  purchaseId?: string;
  supplierName?: string;
  kg: number;
  units: number;
  boxes: number;
  lot?: string;
  expiry?: string;
  costPerKg?: number;
  receivedAt: number;
  receivedBy: string;
}

export const purchaseId = (rut: string, kind: DocKind, dte: number | undefined, folio: string) =>
  `${rut.replace(/[^0-9kK]/g, '').toUpperCase()}-${dte || kind}-${folio.replace(/\s+/g, '').replace(/^0+/, '')}`;

export const normText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Sugerencia de insumo para una línea del documento: alias exacto, o el
// insumo cuyo nombre comparte más palabras con la descripción.
export function suggestSupply(description: string, supplies: Supply[]): Supply | undefined {
  const n = normText(description);
  if (!n) return undefined;
  const exact = supplies.find((s) => s.aliases.includes(n) || normText(s.name) === n);
  if (exact) return exact;
  const words = new Set(n.split(' ').filter((w) => w.length > 2));
  let best: { s: Supply; score: number } | undefined;
  for (const s of supplies) {
    const sw = normText(s.name).split(' ').filter((w) => w.length > 2);
    const hit = sw.filter((w) => words.has(w)).length;
    const score = sw.length ? hit / sw.length : 0;
    if (hit > 0 && score >= 0.6 && (!best || score > best.score)) best = { s, score };
  }
  return best?.s;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// Cuadre por insumo: lo escaneado frente a lo que dice el documento.
export function summarize(boxes: ReceivedBox[], lines: DocLine[], supplies: Supply[]): PurchaseSupplyRow[] {
  const byId = new Map(supplies.map((s) => [s.id, s]));
  const rows = new Map<string, PurchaseSupplyRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) { const s = byId.get(id); r = { supplyId: id, name: s?.name ?? id, unit: s?.unit ?? 'kg', boxes: 0, kg: 0, units: 0 }; rows.set(id, r); }
    return r;
  };
  for (const b of boxes) { const r = row(b.supplyId); r.boxes++; r.kg = r3(r.kg + (b.kg ?? 0)); r.units += b.units ?? 0; }
  for (const l of lines) {
    if (!l.supplyId) continue;
    const r = row(l.supplyId);
    if (l.unit === 'kg' && l.qty) r.docKg = r3((r.docKg ?? 0) + l.qty);
    const total = l.total ?? (l.qty && l.unitPrice ? l.qty * l.unitPrice : undefined);
    if (total) r.docTotal = Math.round((r.docTotal ?? 0) + total);
  }
  for (const r of rows.values()) {
    const kg = r.docKg ?? r.kg;
    if (r.docTotal && kg > 0) r.costPerKg = Math.round(r.docTotal / kg);
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// Diferencia escaneado − documento, en kg. Tolerancia: 0,5 % o 100 g.
export function kgDiff(r: PurchaseSupplyRow): { diff: number; ok: boolean } | null {
  if (r.docKg == null) return null;
  const diff = r3(r.kg - r.docKg);
  return { diff, ok: Math.abs(diff) <= Math.max(0.1, r.docKg * 0.005) };
}

// Lotes que se crean al confirmar: uno por insumo + lote + vencimiento.
export function lotsFrom(boxes: ReceivedBox[], summary: PurchaseSupplyRow[]): Array<Omit<SupplyLot, 'id' | 'purchaseId' | 'supplierName' | 'receivedAt' | 'receivedBy' | 'origin'>> {
  const cost = new Map(summary.map((r) => [r.supplyId, r]));
  const out = new Map<string, Omit<SupplyLot, 'id' | 'purchaseId' | 'supplierName' | 'receivedAt' | 'receivedBy' | 'origin'>>();
  for (const b of boxes) {
    const k = `${b.supplyId}|${b.lot ?? ''}|${b.expiry ?? ''}`;
    let l = out.get(k);
    if (!l) {
      const r = cost.get(b.supplyId);
      l = { supplyId: b.supplyId, supplyName: r?.name ?? b.supplyId, kg: 0, units: 0, boxes: 0, lot: b.lot, expiry: b.expiry, costPerKg: r?.costPerKg };
      out.set(k, l);
    }
    l.kg = r3(l.kg + (b.kg ?? 0)); l.units += b.units ?? 0; l.boxes++;
  }
  return [...out.values()];
}

// ---------- Compras por recibir (Fase 4, visita del 05-11) ----------
// Administración (Gabriela) registra lo que compró; la fábrica recibe contra
// esa compra. Una compra puede llegar en varias entregas: queda «parcial»
// hasta completarse, o administración la cierra con la diferencia.

export type PurchaseOrderStatus = 'por_recibir' | 'parcial' | 'recibida' | 'cerrada' | 'anulada';
export const ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = { por_recibir: 'Por recibir', parcial: 'Parcial', recibida: 'Recibida', cerrada: 'Cerrada con diferencia', anulada: 'Anulada' };
export const isOpenOrder = (o: Pick<PurchaseOrder, 'status'>) => o.status === 'por_recibir' || o.status === 'parcial';

export interface PurchaseOrderItem { supplyId: string; supplyName: string; unit: SupplyUnit; qty: number; priceCLP?: number }

export interface PurchaseOrder {
  id: string;
  number: string;
  supplierRut?: string;
  supplierName: string;
  expectedDate: string;
  items: PurchaseOrderItem[];
  note?: string;
  status: PurchaseOrderStatus;
  /** Recibido por insumo: kg o unidades según el insumo. */
  received: Record<string, number>;
  receptions: string[];
  createdBy: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
  closedBy?: string;
  closedAt?: number;
  closedNote?: string;
}

// Se da por completo un insumo con el 98 % de lo comprado (el peso real de
// las cajas nunca calza exacto).
export const RECEIVED_TOLERANCE = 0.98;

export interface OrderProgressRow { supplyId: string; name: string; unit: SupplyUnit; qty: number; received: number; pending: number; done: boolean }
export function orderProgress(o: Pick<PurchaseOrder, 'items' | 'received'>): OrderProgressRow[] {
  return o.items.map((i) => {
    const received = r3(o.received?.[i.supplyId] ?? 0);
    return { supplyId: i.supplyId, name: i.supplyName, unit: i.unit, qty: i.qty, received, pending: r3(Math.max(0, i.qty - received)), done: received >= i.qty * RECEIVED_TOLERANCE };
  });
}

// Suma una recepción a la compra: lo recibido por insumo y el estado nuevo.
export function applyReception(o: Pick<PurchaseOrder, 'items' | 'received'>, summary: PurchaseSupplyRow[]): { received: Record<string, number>; status: 'parcial' | 'recibida' } {
  const received: Record<string, number> = { ...(o.received ?? {}) };
  for (const r of summary) {
    const add = r.unit === 'unidad' ? r.units : r.kg;
    if (add > 0) received[r.supplyId] = r3((received[r.supplyId] ?? 0) + add);
  }
  const all = orderProgress({ items: o.items, received }).every((x) => x.done);
  return { received, status: all ? 'recibida' : 'parcial' };
}

export const orderTotal = (o: Pick<PurchaseOrder, 'items'>) => o.items.reduce((s, i) => s + (i.priceCLP ? Math.round(i.priceCLP * i.qty) : 0), 0);
