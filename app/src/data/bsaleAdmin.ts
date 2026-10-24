import { useEffect, useState } from 'react';
import { collection, doc, limit as qLimit, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';

// Configuración, diagnóstico y bitácoras de la integración real con Bsale.
// Las formas replican functions/src/bsale/{config,diagnose}.ts.

export type DocKind = 'factura' | 'boleta' | 'guia' | 'nota_credito' | 'otro';

export interface BsaleSettings {
  enabled: boolean;
  writesEnabled: boolean;
  dryRun: boolean;
  invoicesEnabled?: boolean;
  factoryOfficeId?: number;
  storeOfficeId?: number;
  priceListId?: number;
  docTypeKinds?: Record<string, DocKind>;
  transferMode?: 'consumo_recepcion' | 'guia';
  transferShippingTypeId?: number;
  transferDocumentTypeId?: number;
  documentsSyncedUntil?: number;
  clientsSyncedAt?: number;
}

export const DEFAULT_BSALE_SETTINGS: BsaleSettings = { enabled: false, writesEnabled: false, dryRun: true, transferMode: 'consumo_recepcion' };

export interface DiagnosticSummary {
  at: number;
  by: string;
  durationMs: number;
  apiCalls: number;
  offices: Array<{ id: number; name: string; isVirtual: boolean; variantsWithStock: number }>;
  documentTypes: Array<{ id: number; name: string; codeSii?: string; kind: DocKind; count90d: number }>;
  priceLists: Array<{ id: number; name: string }>;
  productTypes: Array<{ id: number; name: string; products: number }>;
  products: number;
  variants: number;
  activeVariants: number;
  clients: number;
  users: Array<{ id: number; name: string; email?: string; documents90d: number }>;
  documents90d: number;
  sales90dCLP: number;
  topVariants90d: Array<{ variantId: string; label: string; quantity: number; totalCLP: number }>;
  mapping: { suggested: number; confirmed: number; unmatched: number };
  warnings: string[];
  suggestedSettings: { factoryOfficeId?: number; storeOfficeId?: number; priceListId?: number };
}

export interface WriteLogEntry {
  id: string; at: number; kind: string; by: string; method: string; path: string; body: unknown; ref?: string;
  dryRun: boolean; status: 'simulado' | 'ok' | 'error'; error?: unknown; responseId?: unknown;
}

export interface WebhookLogEntry { id: string; at: number; topic?: string; action?: string; resourceId?: string; status?: string; error?: string }

export function useBsaleSettings(): { settings: BsaleSettings; loading: boolean } {
  const [state, setState] = useState<{ settings: BsaleSettings; loading: boolean }>({ settings: DEFAULT_BSALE_SETTINGS, loading: true });
  useEffect(() => onSnapshot(doc(db, 'settings', 'bsale'),
    (s) => setState({ settings: { ...DEFAULT_BSALE_SETTINGS, ...(s.data() as Partial<BsaleSettings> | undefined) }, loading: false }),
    () => setState((p) => ({ ...p, loading: false }))), []);
  return state;
}

export async function saveBsaleSettings(patch: Partial<BsaleSettings>) {
  await setDoc(doc(db, 'settings', 'bsale'), patch, { merge: true });
}

export function useDiagnostic(): DiagnosticSummary | null | undefined {
  const [d, setD] = useState<DiagnosticSummary | null | undefined>(undefined);
  useEffect(() => onSnapshot(doc(db, 'bsale', 'meta'), (s) => setD((s.data()?.diagnostic as DiagnosticSummary | undefined) ?? null), () => setD(null)), []);
  return d;
}

function useLog<T>(path: string[], max: number): T[] {
  const [items, setItems] = useState<T[]>([]);
  const key = path.join('/');
  useEffect(() => onSnapshot(query(collection(db, key), orderBy('at', 'desc'), qLimit(max)),
    (s) => { const l: T[] = []; s.forEach((d) => l.push(d.data() as T)); setItems(l); }, () => setItems([])), [key, max]);
  return items;
}
export const useWriteLog = (max = 30) => useLog<WriteLogEntry>(['bsale', 'writes', 'log'], max);
export const useWebhookLog = (max = 20) => useLog<WebhookLogEntry>(['bsale', 'webhooks', 'log'], max);

const diagnoseFn = httpsCallable<void, { summary: DiagnosticSummary }>(functions, 'bsaleDiagnose', { timeout: 540_000 });
const webhookFn = httpsCallable<void, { url: string; topics: string[] }>(functions, 'bsaleWebhookInfo');
const proxyFn = httpsCallable<{ path: string }, { status: number; data: unknown }>(functions, 'bsaleProxy');

export async function runDiagnostic(): Promise<DiagnosticSummary> { return (await diagnoseFn()).data.summary; }
export async function webhookInfo() { return (await webhookFn()).data; }
export async function bsaleGet(path: string): Promise<unknown> { return (await proxyFn({ path })).data.data; }
