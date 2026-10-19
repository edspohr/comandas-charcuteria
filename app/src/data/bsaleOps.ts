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

const receiveFn = httpsCallable<{ lines: QtyLine[]; note?: string }, { dryRun: boolean; summary: SyncSummary | null }>(functions, 'bsaleReceiveProduction');
const transferFn = httpsCallable<{ orderId: string; lines: QtyLine[] }, unknown>(functions, 'bsaleTransferToStore');

export async function registerProduction(lines: QtyLine[], uid: string, note?: string): Promise<BsaleWriteOutcome> {
  if (isRealBsale) {
    const r = (await receiveFn({ lines, note })).data;
    return { dryRun: r.dryRun, summary: r.summary };
  }
  for (const l of lines) await receiveProduction(`${l.productId}__${l.formatId}`, l.qty, uid, note);
  return { dryRun: false, summary: await syncStockFromBsale(uid) };
}

// Traslado fábrica → tienda (pedidos de reposición). En mock no hay tienda
// simulada en Bsale: el traslado queda solo en la app.
export async function registerTransfer(orderId: string, lines: QtyLine[]): Promise<{ dryRun: boolean; skipped?: boolean }> {
  if (!isRealBsale) return { dryRun: false, skipped: true };
  const r = (await transferFn({ orderId, lines })).data as { consumo?: { dryRun: boolean }; guia?: { dryRun: boolean } };
  return { dryRun: !!(r.consumo?.dryRun ?? r.guia?.dryRun) };
}

export function writeOutcomeText(o: BsaleWriteOutcome, what: string): string {
  if (o.dryRun) return `${what}: Bsale está en simulacro, quedó registrado en la bitácora sin enviarse.`;
  const r = o.summary;
  if (!r) return `${what} en Bsale.`;
  return `${what} en Bsale.` + (r.absorbed > 0 ? ` Reasignadas ${r.absorbed} u/kg a pedidos pendientes.` : '') + (r.promoted.length > 0 ? ` Promovidos: ${r.promoted.join(', ')}.` : '');
}
