import { withPin } from './pin';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { isRealBsale } from '@/integrations/bsale/client';
import { receiveProduction } from '@/integrations/bsale/mockAdmin';
import { syncStockFromBsale, type SyncSummary } from './stock';

// Operaciones que escriben en Bsale, con el mismo contrato en ambos modos.
// En real pasan por Cloud Functions (bitácora + simulacro); en mock tocan el
// Bsale simulado y sincronizan.

export interface QtyLine { productId: string; formatId: string; qty: number }
export interface BsaleWriteOutcome { dryRun: boolean; summary: SyncSummary | null }

const receiveFn = httpsCallable<{ lines: QtyLine[]; note?: string; pin?: string }, { dryRun: boolean; summary: SyncSummary | null }>(functions, 'bsaleReceiveProduction');
const transferFn = httpsCallable<{ orderId: string; lines: QtyLine[]; pin?: string }, unknown>(functions, 'bsaleTransferToStore');

export async function registerProduction(lines: QtyLine[], uid: string, note?: string): Promise<BsaleWriteOutcome> {
  if (isRealBsale) {
    const r = await withPin('Registrar producción en Bsale', async (pin) => (await receiveFn({ lines, note, pin })).data);
    return { dryRun: r.dryRun, summary: r.summary };
  }
  for (const l of lines) await receiveProduction(`${l.productId}__${l.formatId}`, l.qty, uid, note);
  return { dryRun: false, summary: await syncStockFromBsale(uid) };
}

// Traslado fábrica → tienda (pedidos de reposición). En mock no hay tienda
// simulada en Bsale: el traslado queda solo en la app.
export async function registerTransfer(orderId: string, lines: QtyLine[]): Promise<{ dryRun: boolean; skipped?: boolean }> {
  if (!isRealBsale) return { dryRun: false, skipped: true };
  const r = (await withPin(`Traslado a tienda ${orderId}`, async (pin) => (await transferFn({ orderId, lines, pin })).data)) as { consumo?: { dryRun: boolean }; guia?: { dryRun: boolean } };
  return { dryRun: !!(r.consumo?.dryRun ?? r.guia?.dryRun) };
}

// Muestras → consumo interno en Bsale (una vez por pedido; el servidor lo
// recuerda en order.samplesConsumption). En mock no hay nada que descontar.
const samplesFn = httpsCallable<{ orderId: string; pin?: string }, { dryRun?: boolean; skipped?: boolean; already?: boolean; reason?: string }>(functions, 'bsaleConsumeSamples');
export async function consumeSamples(orderId: string): Promise<{ dryRun?: boolean; skipped?: boolean; already?: boolean; reason?: string }> {
  if (!isRealBsale) return { skipped: true, reason: 'Bsale simulado' };
  return withPin(`Muestras de ${orderId} a Bsale`, async (pin) => (await samplesFn({ orderId, pin })).data);
}

export function writeOutcomeText(o: BsaleWriteOutcome, what: string): string {
  if (o.dryRun) return `${what}: Bsale está en simulacro, quedó registrado en la bitácora sin enviarse.`;
  const r = o.summary;
  if (!r) return `${what} en Bsale.`;
  return `${what} en Bsale.` + (r.absorbed > 0 ? ` Reasignadas ${r.absorbed} u/kg a pedidos pendientes.` : '') + (r.promoted.length > 0 ? ` Promovidos: ${r.promoted.join(', ')}.` : '');
}

// ---------- Facturación desde Comandas ----------

export interface InvoiceLine { productName: string; formatLabel: string; variantId: string; variantLabel: string; quantity: number; unitLabel: string; netUnitValue: number; netCLP: number; totalCLP: number; priceSource: 'bsale' | 'pedido' }
export interface InvoicePreview {
  orderId: string; kind: 'factura' | 'boleta' | 'guia' | 'nota_credito' | 'otro'; documentTypeId?: number; documentTypeName?: string;
  client: { name: string; rut?: string; bsaleClientId?: string }; seller?: { id: number; name: string };
  lines: InvoiceLine[]; netCLP: number; totalCLP: number; orderTotalCLP?: number; warnings: string[]; blocking: string[]; payload: Record<string, unknown>;
}
const previewFn = httpsCallable<{ orderId: string; kind?: 'factura' | 'boleta' }, { preview: InvoicePreview; writesEnabled: boolean; dryRun: boolean }>(functions, 'bsaleInvoicePreview');
const emitFn = httpsCallable<{ orderId: string; kind?: 'factura' | 'boleta'; pin?: string }, { dryRun: boolean; number?: string; urlPdf?: string; preview: InvoicePreview }>(functions, 'bsaleEmitInvoice', { timeout: 120_000 });

export async function previewInvoice(orderId: string, kind?: 'factura' | 'boleta') { return (await previewFn({ orderId, kind })).data; }
export async function emitInvoice(orderId: string, kind?: 'factura' | 'boleta') {
  return withPin(`Emitir ${kind ?? 'documento'} del pedido ${orderId}`, async (pin) => (await emitFn({ orderId, kind, pin })).data);
}
