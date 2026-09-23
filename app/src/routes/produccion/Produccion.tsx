import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import DataTable, { Pill } from '@/components/ui/DataTable';
import { useCurrentUser } from '@/data/auth';
import { useProducts } from '@/data/products';
import { needsProduction, useProduccionData, type DemandRow } from '@/data/produccion';
import { syncStockFromBsale, useSyncState } from '@/data/stock';
import { receiveProduction } from '@/integrations/bsale/mockAdmin';
import { parseLocal, type ParsedLine } from '@/domain/parse/local';
import { geminiEnabled, parseWithGemini } from '@/domain/parse/gemini';
import { formatDateShort, formatQty } from '@/lib/format';
import { describeFirestoreError } from '@/lib/errors';

type Tab = 'demanda' | 'ia';

// Producción: what the open orders still need vs. what Bsale reports, plus
// «Producción IA»: paste the factory's report, the AI turns it into stock
// lines, Yuri confirms → recepción en Bsale (mock hoy, API después) + sync.
export default function Produccion() {
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const { rows, loading, error } = useProduccionData();
  const sync = useSyncState();
  const [tab, setTab] = useState<Tab>('demanda');
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);

  const urgentCount = useMemo(() => needsProduction(rows).length, [rows]);
  const visible = useMemo(() => (onlyPending ? rows.filter((r) => r.toProduce > 0) : rows), [rows, onlyPending]);

  async function doSync() {
    setSyncing(true); setSyncError(null); setFlash(null);
    try {
      const r = await syncStockFromBsale(uid);
      setFlash(r.updated === 0 && r.promoted.length === 0 ? 'Bsale no reporta cambios de stock.'
        : `Stock actualizado en ${r.updated} formato${r.updated === 1 ? '' : 's'}.` + (r.absorbed > 0 ? ` Reasignadas ${r.absorbed} u/kg a pedidos pendientes.` : '') + (r.promoted.length > 0 ? ` Promovidos: ${r.promoted.join(', ')}.` : ''));
    } catch (e) { setSyncError(describeFirestoreError(e)); } finally { setSyncing(false); }
  }

  return (
    <div>
      <header className="mb-4 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">Producción</p>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">{tab === 'demanda' ? 'Demanda vs. stock Bsale' : 'Producción IA'}</h1>
          <p className="text-xs text-charcoal-300 mt-1">
            La producción terminada se carga en Bsale. {sync?.at ? `Última sincronización ${new Date(sync.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}.` : 'Aún sin sincronizar.'}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={doSync} disabled={syncing}>{syncing ? 'Consultando Bsale…' : 'Sincronizar con Bsale'}</Button>
      </header>

      <nav className="mb-4 flex gap-1 border-b border-charcoal-100">
        {([['demanda', `Demanda y stock${urgentCount ? ` · ${urgentCount} a producir` : ''}`], ['ia', 'Producción IA']] as Array<[Tab, string]>).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={'px-4 py-2.5 text-xs uppercase tracking-display font-medium border-b-2 transition -mb-px ' + (t === tab ? 'border-brass-500 text-charcoal-900' : 'border-transparent text-charcoal-300 hover:text-charcoal-500')}>{label}</button>
        ))}
      </nav>

      {flash && <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm mb-4">{flash}</div>}
      {syncError && <div className="mb-4"><ErrorBanner message={syncError} /></div>}
      {loading && !error && <p className="text-sm text-charcoal-300">Cargando…</p>}
      {error && <ErrorBanner message={error} />}

      {tab === 'demanda' && !loading && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <button onClick={() => setOnlyPending((v) => !v)} className={'rounded-md px-2.5 py-1.5 text-[11px] uppercase tracking-display font-medium border transition ' + (onlyPending ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500 hover:border-charcoal-300')}>
              Solo con demanda pendiente{urgentCount > 0 && <span className="ml-1 rounded-full bg-brass-100 text-brass-700 px-1.5">{urgentCount}</span>}
            </button>
            <span className="text-xs text-charcoal-300">{visible.length} formatos · tocá una fila para ver los pedidos que dependen</span>
          </div>
          <DataTable<DemandRow>
            rows={visible}
            rowKey={(r) => `${r.productId}::${r.formatId}`}
            dense
            rowTone={(r) => (r.onHand < r.reserved ? 'bad' : r.toProduce > 0 ? 'warn' : undefined)}
            columns={[
              { key: 'product', label: 'Producto', mobile: true, render: (r) => <div><p className="font-semibold text-charcoal-900">{r.productName}</p><p className="text-[11px] text-charcoal-300">{r.formatLabel}</p></div> },
              { key: 'toProduce', label: 'A producir', align: 'right', mobile: true, render: (r) => r.toProduce > 0 ? <span className="font-semibold text-brass-700">{formatQty(r.toProduce, r.unit)}</span> : <span className="text-charcoal-300">—</span> },
              { key: 'onHand', label: 'Bsale', align: 'right', render: (r) => formatQty(r.onHand, r.unit) },
              { key: 'reserved', label: 'Reservado', align: 'right', render: (r) => formatQty(r.reserved, r.unit), muted: true },
              { key: 'available', label: 'Disponible', align: 'right', mobile: true, render: (r) => r.onHand < r.reserved ? <Pill tone="bad">comprometido</Pill> : <span className={r.available > 0 ? 'text-emerald-700 font-semibold' : 'text-charcoal-500'}>{formatQty(r.available, r.unit)}</span> },
              { key: 'demand', label: 'Demanda abierta', align: 'right', render: (r) => formatQty(r.confirmedDemand + r.pendingProduction, r.unit), muted: true },
              { key: 'orders', label: 'Pedidos', align: 'right', render: (r) => r.affectingOrders.length || '—', muted: true },
            ]}
            expand={(r) => (
              <div>
                <p className="eyebrow mb-1">Pedidos que dependen de este formato</p>
                {r.affectingOrders.length === 0 ? <p className="text-xs text-charcoal-300">Ninguno.</p> : (
                  <ul className="text-xs divide-y divide-charcoal-100">
                    {r.affectingOrders.map((a) => (
                      <li key={a.orderId} className="py-1 flex items-center justify-between gap-2">
                        <span className="text-charcoal-700"><span className="font-mono text-charcoal-300">{a.orderId}</span> · {a.clientName}</span>
                        <span className="text-charcoal-500 shrink-0 first-letter:uppercase">{formatDateShort(a.requestedDate)} · reservado {formatQty(a.reservedQty, r.unit)}{a.pendingProductionQty > 0 && <span className="text-brass-700"> · faltan {formatQty(a.pendingProductionQty, r.unit)}</span>}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          />
        </>
      )}

      {tab === 'ia' && <ProduccionIA uid={uid} onDone={(msg) => { setFlash(msg); setTab('demanda'); }} />}
    </div>
  );
}

// ---------- Producción IA ----------

const SAMPLE = `Reporte turno mañana 23/09
Salieron 20 kg de longaniza chillán granel
Jamón cocido: 60 sachet de 200 g y 8 kg laminado
6 piezas de coppa
Mortadela pistacho 12 kg
Gouda ahumado 40 sachet`;

interface StockLine { productId: string; productName: string; formatId: string; formatLabel: string; unit: 'g' | 'kg' | 'unidad'; qty: number; raw: string; ok: boolean; }

function ProduccionIA({ uid, onDone }: { uid: string; onDone: (msg: string) => void }) {
  const { products } = useProducts();
  const [text, setText] = useState('');
  const [lines, setLines] = useState<StockLine[] | null>(null);
  const [engine, setEngine] = useState<'ai' | 'local' | null>(null);
  const [aiFallback, setAiFallback] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const toLines = (parsed: ParsedLine[]): StockLine[] => parsed
    .filter((l) => l.status !== 'not_found')
    .map((l) => ({ productId: l.productId ?? '', productName: l.productName ?? '', formatId: l.formatId ?? '', formatLabel: l.formatLabel ?? '', unit: l.unit ?? 'unidad', qty: l.qty ?? 0, raw: l.raw, ok: l.status === 'verified' }));

  async function interpret() {
    if (busy || text.trim().length < 3) return;
    setBusy(true); setError(null); setEngine(null); setAiFallback(false);
    let usedFallback = false;
    try {
      if (geminiEnabled()) {
        try {
          const remote = await parseWithGemini(text, products);
          if (remote.length > 0) { setLines(toLines(remote)); setEngine('ai'); return; }
        } catch (e) { console.warn('[produccion-ia] Gemini failed, local fallback', e); usedFallback = true; }
      }
      setLines(toLines(parseLocal(text, products)));
      setEngine('local');
      if (usedFallback) setAiFallback(true);
    } finally { setBusy(false); }
  }

  function update(i: number, patch: Partial<StockLine>) {
    setLines((prev) => prev ? prev.map((l, j) => (j === i ? { ...l, ...patch } : l)) : prev);
  }
  function setProduct(i: number, productId: string) {
    const p = products.find((x) => x.id === productId); if (!p) return;
    const f = p.formats.find((x) => x.formatId === lines?.[i].formatId) ?? p.formats[0];
    update(i, { productId: p.id, productName: p.name, formatId: f.formatId, formatLabel: f.label, unit: f.unit, ok: true });
  }
  function setFormat(i: number, formatId: string) {
    const p = products.find((x) => x.id === lines?.[i].productId); const f = p?.formats.find((x) => x.formatId === formatId); if (!f) return;
    update(i, { formatId: f.formatId, formatLabel: f.label, unit: f.unit });
  }

  const usable = (lines ?? []).filter((l) => l.productId && l.formatId && l.qty > 0);

  async function confirm() {
    if (usable.length === 0) return;
    setBusy(true); setError(null);
    try {
      for (const l of usable) await receiveProduction(`${l.productId}__${l.formatId}`, l.qty, uid, note || undefined);
      const r = await syncStockFromBsale(uid);
      onDone(`Cargadas ${usable.length} línea${usable.length === 1 ? '' : 's'} en Bsale.` + (r.absorbed > 0 ? ` Reasignadas ${r.absorbed} u/kg a pedidos pendientes.` : '') + (r.promoted.length > 0 ? ` Promovidos: ${r.promoted.join(', ')}.` : ''));
    } catch (e) { setError(describeFirestoreError(e)); setBusy(false); }
  }

  return (
    <div className="max-w-2xl">
      <div className="card p-4 mb-4">
        <p className="text-sm text-charcoal-700 mb-2">Pegá el reporte de la fábrica (WhatsApp, planilla, lo que sea). La IA lo convierte en líneas producto · formato · cantidad; vos revisás y confirmás. La carga se registra <strong>en Bsale</strong> y la app se sincroniza.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder="Ej: salieron 20 kg de longaniza chillán granel, 60 sachet de jamón cocido…" className="field h-auto py-3 text-sm resize-y" />
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Button onClick={interpret} disabled={busy || text.trim().length < 3} className="flex-1">{busy && !lines ? 'Interpretando…' : 'Interpretar con IA'}</Button>
          <Button variant="ghost" size="sm" onClick={() => setText(SAMPLE)} disabled={busy}>Cargar texto de ejemplo</Button>
        </div>
      </div>

      {aiFallback && (
        <div className="mb-3 rounded-md bg-brass-50 border border-brass-300 text-brass-700 px-3 py-2 text-xs">
          Se usó el intérprete local (Gemini no disponible en este momento). Revisá cada línea antes de cargar en Bsale.
        </div>
      )}

      {lines && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-1">
            <p className="eyebrow">Líneas propuestas · {lines.length}{engine === 'ai' && <span className="ml-2 normal-case tracking-normal text-brass-700">· Gemini</span>}{engine === 'local' && <span className="ml-2 normal-case tracking-normal text-charcoal-300">· parser local</span>}</p>
            <span className="text-[10px] uppercase tracking-display text-charcoal-300">{lines.filter((l) => l.ok).length} verificadas · {lines.filter((l) => !l.ok).length} a revisar</span>
          </div>
          {lines.length === 0 && <p className="text-sm text-charcoal-500">No se identificaron productos. Ajustá el texto e intentá de nuevo.</p>}
          <ul className="divide-y divide-charcoal-100">
            {lines.map((l, i) => {
              const p = products.find((x) => x.id === l.productId);
              return (
                <li key={i} className="py-2 grid grid-cols-[1fr,auto] sm:grid-cols-[2fr,2fr,1fr,auto] gap-2 items-center text-sm">
                  <select value={l.productId} onChange={(e) => setProduct(i, e.target.value)} className={'field h-9 text-xs ' + (!l.ok ? 'border-brass-300' : '')}>
                    {!l.productId && <option value="">— producto —</option>}
                    {products.filter((x) => x.active && !x.discontinued).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <select value={l.formatId} onChange={(e) => setFormat(i, e.target.value)} className="field h-9 text-xs">
                    {(p?.formats ?? []).map((f) => <option key={f.formatId} value={f.formatId}>{f.label}</option>)}
                  </select>
                  <input type="number" inputMode="decimal" step={l.unit === 'kg' ? '0.5' : '1'} value={l.qty || ''} onChange={(e) => update(i, { qty: parseFloat(e.target.value) || 0 })} className="field h-9 text-xs text-right" />
                  <button onClick={() => setLines((prev) => prev ? prev.filter((_, j) => j !== i) : prev)} className="text-[10px] uppercase tracking-display text-charcoal-300 hover:text-red-700">Quitar</button>
                  <p className="col-span-full text-[11px] text-charcoal-300 italic truncate">"{l.raw}"</p>
                </li>
              );
            })}
          </ul>
          {lines.length > 0 && (
            <>
              <div>
                <label className="eyebrow block mb-1">Lote / nota (opcional)</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: turno mañana 23/09" className="field h-9 text-sm" />
              </div>
              {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
              <Button onClick={confirm} disabled={busy || usable.length === 0} className="w-full">{busy ? 'Cargando en Bsale…' : `Cargar ${usable.length} línea${usable.length === 1 ? '' : 's'} en Bsale y sincronizar`}</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

