import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, type Bytes } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
import type { DocKind } from './bsaleAdmin';

// Hechos de venta de Bsale para el Panel (functions/src/bsale/facts.ts):
// un documento por mes con las filas comprimidas en gzip. El mes en curso
// se escucha en vivo; los anteriores se leen una vez y quedan en memoria.

export interface FactDoc { date: string; docId: string; kind: DocKind; officeId: number; sellerId: string; clientId: string; net: number; total: number }
export interface FactLine { date: string; kind: DocKind; officeId: number; sellerId: string; clientId: string; variantId: string; qty: number; net: number }
export interface MonthIndexEntry { docCount: number; bytes: number; complete: boolean; updatedAt: number; net?: number; netByOffice?: Record<string, number> }

// Mirrors functions/src/bsale/facts.ts SALES_KINDS.
export const SALES_KINDS = new Set<DocKind>(['factura', 'boleta', 'nota_credito', 'otro']);

export interface SalesFacts {
  docs: FactDoc[];
  lines: FactLine[];
  clients: Map<string, { name: string; rut: string }>;
  sellers: Map<string, string>;
  months: string[];
}

type RawDoc = [number, string, DocKind, number, string, string, number, number];
type RawLine = [number, DocKind, number, string, string, string, number, number];
interface MonthData { docs: RawDoc[]; lines: RawLine[]; clients: Record<string, string>; sellers: Record<string, string> }

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

async function decodeMonth(data: Bytes | undefined): Promise<MonthData> {
  if (!data) return { docs: [], lines: [], clients: {}, sellers: {} };
  return JSON.parse(await gunzip(data.toUint8Array())) as MonthData;
}

const cache = new Map<string, MonthData>();

export function monthsBack(n: number, until = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(until.getFullYear(), until.getMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}
export const currentMonth = () => monthsBack(1)[0];

export function useFactsIndex(): { months: Record<string, MonthIndexEntry>; costs: Record<string, number>; costsUpdatedAt?: number; loading: boolean } {
  const [state, setState] = useState<{ months: Record<string, MonthIndexEntry>; costs: Record<string, number>; costsUpdatedAt?: number; loading: boolean }>({ months: {}, costs: {}, loading: true });
  useEffect(() => onSnapshot(doc(db, 'bsale', 'facts'), (s) => {
    const d = s.data() as { months?: Record<string, MonthIndexEntry>; costs?: Record<string, number>; costsUpdatedAt?: number } | undefined;
    setState({ months: d?.months ?? {}, costs: d?.costs ?? {}, costsUpdatedAt: d?.costsUpdatedAt, loading: false });
  }, () => setState((p) => ({ ...p, loading: false }))), []);
  return state;
}

// Loads the given months (YYYY-MM). Months not in the index are skipped
// without a read.
export function useSalesFacts(months: string[], index: Record<string, MonthIndexEntry>): { facts: SalesFacts; loading: boolean } {
  const key = months.filter((m) => index[m]).join(',');
  const [loaded, setLoaded] = useState<Record<string, MonthData>>({});
  const [loading, setLoading] = useState(true);
  const live = currentMonth();

  useEffect(() => {
    let cancelled = false;
    const wanted = key ? key.split(',') : [];
    const past = wanted.filter((m) => m !== live);
    setLoading(true);
    Promise.all(past.map(async (m) => {
      if (!cache.has(m)) cache.set(m, await decodeMonth((await getDoc(doc(db, 'bsale', 'facts', 'months', m))).data()?.data as Bytes | undefined));
      return [m, cache.get(m)!] as const;
    })).then((rows) => {
      if (cancelled) return;
      setLoaded((prev) => ({ ...Object.fromEntries(Object.entries(prev).filter(([m]) => m === live)), ...Object.fromEntries(rows) }));
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    let unsub = () => {};
    if (wanted.includes(live)) {
      unsub = onSnapshot(doc(db, 'bsale', 'facts', 'months', live), async (s) => {
        const data = await decodeMonth(s.data()?.data as Bytes | undefined);
        if (!cancelled) setLoaded((prev) => ({ ...prev, [live]: data }));
      });
    }
    return () => { cancelled = true; unsub(); };
  }, [key, live]);

  const facts = useMemo<SalesFacts>(() => {
    const out: SalesFacts = { docs: [], lines: [], clients: new Map(), sellers: new Map(), months: [] };
    for (const m of (key ? key.split(',') : [])) {
      const d = loaded[m];
      if (!d) continue;
      out.months.push(m);
      const date = (day: number) => `${m}-${String(day).padStart(2, '0')}`;
      for (const r of d.docs) out.docs.push({ date: date(r[0]), docId: r[1], kind: r[2], officeId: r[3], sellerId: r[4], clientId: r[5], net: r[6], total: r[7] });
      for (const r of d.lines) out.lines.push({ date: date(r[0]), kind: r[1], officeId: r[2], sellerId: r[3], clientId: r[4], variantId: r[5], qty: r[6], net: r[7] });
      for (const [id, v] of Object.entries(d.clients)) { const [name, rut] = v.split('|'); out.clients.set(id, { name, rut }); }
      for (const [id, v] of Object.entries(d.sellers)) out.sellers.set(id, v);
    }
    return out;
  }, [loaded, key]);

  return { facts, loading };
}

const backfillFn = httpsCallable<{ month: string }, { month: string; documents: number; bytes?: number }>(functions, 'bsaleFactsBackfill', { timeout: 540_000 });
const costsFn = httpsCallable<void, { withCost: number; total: number }>(functions, 'bsaleRefreshCosts', { timeout: 540_000 });

// Historical load, oldest month first so the Panel fills up as it goes.
export async function backfillFacts(months: string[], onProgress: (done: number, last?: { month: string; documents: number }) => void) {
  let done = 0;
  for (const month of months) {
    const r = (await backfillFn({ month })).data;
    cache.delete(month);
    onProgress(++done, r);
  }
}
export async function refreshCosts() { return (await costsFn()).data; }

// Stock per Bsale variant and office (bsale/stock/byVariant, ~270 docs).
export interface VariantStock { variantId: string; offices: Record<string, { quantity: number; reserved: number; available: number }> }
export function useVariantStock(): VariantStock[] {
  const [rows, setRows] = useState<VariantStock[]>([]);
  useEffect(() => onSnapshot(collection(db, 'bsale', 'stock', 'byVariant'), (s) => { const l: VariantStock[] = []; s.forEach((d) => l.push(d.data() as VariantStock)); setRows(l); }, () => setRows([])), []);
  return rows;
}

// Units sold per variant in the last `days` (default 90), from the facts.
export function useVariantSales(days = 90): { sold: Map<string, number>; ready: boolean } {
  const { months: index, loading: idx } = useFactsIndex();
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const months = useMemo(() => monthsBack(Math.ceil(days / 30) + 1), [days]);
  const { facts, loading } = useSalesFacts(months, index);
  const sold = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of facts.lines) if (l.date >= since && SALES_KINDS.has(l.kind)) m.set(l.variantId, (m.get(l.variantId) ?? 0) + l.qty);
    return m;
  }, [facts, since]);
  return { sold, ready: !idx && !loading && Object.keys(index).length > 0 };
}
