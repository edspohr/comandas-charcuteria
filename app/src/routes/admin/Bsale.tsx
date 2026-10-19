import { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { Pill } from '@/components/ui/DataTable';
import { useCurrentUser } from '@/data/auth';
import { syncStockFromBsale, useSyncState } from '@/data/stock';
import {
  runDiagnostic, saveBsaleSettings, useBsaleSettings, useDiagnostic, useWebhookLog, useWriteLog, webhookInfo,
  type BsaleSettings, type DiagnosticSummary, type DocKind,
} from '@/data/bsaleAdmin';
import { BSALE_MODE, isRealBsale } from '@/integrations/bsale/client';
import { can } from '@/domain/permissions';
import { callableMessage } from '@/data/userAdmin';
import { backfillFacts, monthsBack, refreshCosts, useFactsIndex } from '@/data/facts';
import { formatCLP } from '@/lib/pricing';
import BsaleConsolaMock from './BsaleConsolaMock';

type Tab = 'conexion' | 'bitacora' | 'consola';

const KIND_LABEL: Record<DocKind, string> = { factura: 'Factura', boleta: 'Boleta', guia: 'Guía', nota_credito: 'Nota de crédito', otro: 'Otro' };
const when = (ms?: number) => (ms ? new Date(ms).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '—');

// Bsale → Configuración y salud de la integración (superAdmin). En modo
// mock agrega la consola que simula lo que pasa dentro de Bsale.
export default function Bsale() {
  const [tab, setTab] = useState<Tab>('conexion');
  const tabs: Array<[Tab, string]> = [['conexion', 'Conexión'], ['bitacora', 'Bitácora'], ...(isRealBsale ? [] : [['consola', 'Consola simulada'] as [Tab, string]])];
  return (
    <div>
      <header className="mb-4">
        <p className="eyebrow">Super Administración · modo {BSALE_MODE === 'real' ? 'Bsale real' : 'Bsale simulado'}</p>
        <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Bsale</h1>
      </header>
      <nav className="mb-4 flex gap-1 border-b border-charcoal-100">
        {tabs.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={'px-4 py-2.5 text-xs uppercase tracking-display font-medium border-b-2 transition -mb-px ' + (t === tab ? 'border-brass-500 text-charcoal-900' : 'border-transparent text-charcoal-300 hover:text-charcoal-500')}>{label}</button>
        ))}
      </nav>
      {tab === 'conexion' && <Conexion />}
      {tab === 'bitacora' && <Bitacora />}
      {tab === 'consola' && <BsaleConsolaMock />}
    </div>
  );
}

function Conexion() {
  const { current } = useCurrentUser();
  const role = current!.appUser.role;
  const uid = current!.appUser.uid;
  const editable = can(role, 'bsale.configure');
  const { settings } = useBsaleSettings();
  const diagnostic = useDiagnostic();
  const sync = useSyncState();
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webhook, setWebhook] = useState<{ url: string; topics: string[] } | null>(null);

  async function act(key: string, fn: () => Promise<string | void>) {
    setBusy(key); setError(null); setFlash(null);
    try { const m = await fn(); if (m) setFlash(m); } catch (e) { setError(callableMessage(e)); } finally { setBusy(null); }
  }
  const save = (patch: Partial<BsaleSettings>) => act('save', async () => { await saveBsaleSettings(patch); });

  const steps: Array<{ done: boolean; text: React.ReactNode }> = [
    { done: isRealBsale, text: <>App compilada en modo real (<code>VITE_BSALE_MODE=real</code>)</> },
    { done: !!diagnostic, text: 'Token cargado y diagnóstico corrido' },
    { done: !!settings.factoryOfficeId && !!settings.storeOfficeId && !!settings.priceListId, text: 'Sucursal de fábrica, tienda y lista de precios elegidas' },
    { done: (diagnostic?.mapping.confirmed ?? 0) > 0, text: <>Catálogo cruzado con Bsale (<Link className="underline" to="/admin/catalogo?tab=cruce">Catálogo → Cruce</Link>)</> },
    { done: settings.enabled, text: 'Sincronización encendida (cada 10 min + webhooks)' },
    { done: settings.writesEnabled && !settings.dryRun, text: 'Escrituras hacia Bsale en vivo (primero probar en simulacro)' },
  ];

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm">{flash}</div>}
      {error && <ErrorBanner message={error} />}

      <section className="card p-4">
        <p className="eyebrow mb-2">Puesta en marcha</p>
        <ol className="space-y-1.5 text-sm">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2 items-start">
              <span className={'mt-0.5 w-5 h-5 rounded-full text-[11px] flex items-center justify-center shrink-0 ' + (s.done ? 'bg-emerald-600 text-white' : 'bg-charcoal-100 text-charcoal-500')}>{s.done ? '✓' : i + 1}</span>
              <span className={s.done ? 'text-charcoal-500' : 'text-charcoal-900'}>{s.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <p className="eyebrow">Diagnóstico de la cuenta Bsale</p>
            <p className="text-xs text-charcoal-500 mt-0.5">{diagnostic ? `Último: ${when(diagnostic.at)} · ${diagnostic.apiCalls} llamadas · ${Math.round(diagnostic.durationMs / 1000)} s` : 'Aún no se corre. Lee sucursales, catálogo, precios, stock, clientes, vendedores y 90 días de documentos.'}</p>
          </div>
          <Button size="sm" disabled={!isRealBsale || busy != null} onClick={() => act('diag', async () => { const d = await runDiagnostic(); return `Diagnóstico listo: ${d.variants} variantes, ${d.clients} clientes, ${d.documents90d} documentos en 90 días.`; })}>
            {busy === 'diag' ? 'Leyendo Bsale…' : diagnostic ? 'Volver a diagnosticar' : 'Correr diagnóstico'}
          </Button>
        </div>
        {!isRealBsale && <p className="text-xs text-brass-700">En modo simulado el diagnóstico no aplica: se corre contra la API real.</p>}
        {diagnostic && <DiagnosticView d={diagnostic} />}
      </section>

      <section className="card p-4 space-y-3">
        <p className="eyebrow">Configuración</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <OfficeSelect label="Sucursal de fábrica (stock de pedidos)" value={settings.factoryOfficeId} options={diagnostic?.offices ?? []} disabled={!editable} onChange={(v) => save({ factoryOfficeId: v })} />
          <OfficeSelect label="Tienda (recibe traslados)" value={settings.storeOfficeId} options={diagnostic?.offices ?? []} disabled={!editable} onChange={(v) => save({ storeOfficeId: v })} />
          <label className="block text-xs text-charcoal-500">Lista de precios
            <select className="field mt-1 h-10 text-sm" disabled={!editable} value={settings.priceListId ?? ''} onChange={(e) => save({ priceListId: Number(e.target.value) || undefined })}>
              <option value="">—</option>
              {(diagnostic?.priceLists ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Toggle label="Sincronización encendida" hint="Cron cada 10 min (06–23 h) y webhooks." checked={settings.enabled} disabled={!editable} onChange={(v) => save({ enabled: v })} />
          <Toggle label="Escrituras hacia Bsale" hint="Recepciones de producción, traslados y clientes." checked={settings.writesEnabled} disabled={!editable} onChange={(v) => save({ writesEnabled: v })} />
          <Toggle label="Simulacro" hint="Registra lo que se enviaría, sin enviarlo." checked={settings.dryRun} disabled={!editable} onChange={(v) => save({ dryRun: v })} />
        </div>
        <label className="block text-xs text-charcoal-500 max-w-md">Cómo registrar el traslado a tienda
          <select className="field mt-1 h-10 text-sm" disabled={!editable} value={settings.transferMode ?? 'consumo_recepcion'} onChange={(e) => save({ transferMode: e.target.value as BsaleSettings['transferMode'] })}>
            <option value="consumo_recepcion">Consumo en fábrica + recepción en tienda</option>
            <option value="guia">Guía de despacho de traslado interno</option>
          </select>
        </label>
      </section>

      {isRealBsale && <HistoriaVentas editable={editable} enabled={settings.enabled} />}

      <section className="card p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="eyebrow">Sincronización</p>
            <p className="text-xs text-charcoal-500 mt-0.5">
              {sync?.at ? <>Última: {when(sync.at)} · {sync.updated} formatos cambiaron{sync.promoted?.length ? ` · ${sync.promoted.length} pedidos promovidos` : ''}{(sync as { unmappedVariantsWithStock?: number }).unmappedVariantsWithStock ? ` · ${(sync as { unmappedVariantsWithStock?: number }).unmappedVariantsWithStock} variantes con stock sin cruce` : ''}</> : 'Nunca.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={busy != null || (isRealBsale && !settings.enabled)} onClick={() => act('sync', async () => { const r = await syncStockFromBsale(uid); return `Sincronizado: ${r.updated} formatos cambiaron, ${r.promoted.length} pedidos promovidos.`; })}>{busy === 'sync' ? 'Sincronizando…' : 'Sincronizar ahora'}</Button>
            {isRealBsale && editable && <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => act('wh', async () => setWebhook(await webhookInfo()))}>Webhook</Button>}
          </div>
        </div>
        {webhook && (
          <div className="mt-3 rounded-md bg-cream-100 p-3 text-xs space-y-1">
            <p>Pídale a soporte de Bsale registrar esta URL para los tópicos <strong>{webhook.topics.join(', ')}</strong>:</p>
            <code className="block break-all bg-white rounded border border-charcoal-100 p-2 select-all">{webhook.url}</code>
            <p className="text-charcoal-500">La URL lleva una clave: no la comparta por canales abiertos.</p>
          </div>
        )}
      </section>
    </div>
  );
}

// Historia de ventas del Panel: carga mes a mes desde Bsale (una llamada
// por mes) y costos promedio para el margen.
function HistoriaVentas({ editable, enabled }: { editable: boolean; enabled: boolean }) {
  const { months, costs, costsUpdatedAt } = useFactsIndex();
  // 25 months: "últimos 12 meses vs. año anterior" needs one more than two years.
  const wanted = monthsBack(25);
  const complete = wanted.filter((m) => months[m]?.complete).length;
  const docs = wanted.reduce((s, m) => s + (months[m]?.docCount ?? 0), 0);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress != null && !progress.startsWith('Listo');

  async function load() {
    // Incomplete months, plus the last two (late documents and credit notes).
    const todo = wanted.filter((m, i) => !months[m]?.complete || i >= wanted.length - 2);
    setError(null); setProgress(`Cargando 0 de ${todo.length} meses…`);
    try {
      await backfillFacts(todo, (n, last) => setProgress(`Cargando ${n} de ${todo.length} meses… (${last?.month}: ${last?.documents} documentos)`));
      setProgress(`Listo: ${todo.length} meses cargados.`);
    } catch (e) { setError(callableMessage(e)); setProgress(null); }
  }
  async function loadCosts() {
    setError(null); setProgress('Leyendo costos de Bsale…');
    try { const r = await refreshCosts(); setProgress(`Listo: ${r.withCost} de ${r.total} variantes con costo informado.`); }
    catch (e) { setError(callableMessage(e)); setProgress(null); }
  }

  return (
    <section className="card p-4 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">Historia de ventas (Panel)</p>
          <p className="text-xs text-charcoal-500 mt-0.5">
            {complete} de {wanted.length} meses cargados · {docs.toLocaleString('es-CL')} documentos · costos de {Object.keys(costs).length} variantes{costsUpdatedAt ? ` (${when(costsUpdatedAt)})` : ''}.
            Luego se mantiene sola con cada sincronización.
          </p>
        </div>
        {editable && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={busy || !enabled} onClick={load}>{complete < wanted.length ? 'Cargar 2 años' : 'Recargar últimos meses'}</Button>
            <Button size="sm" variant="ghost" disabled={busy || !enabled} onClick={loadCosts}>Actualizar costos</Button>
          </div>
        )}
      </div>
      {progress && <p className="text-xs text-charcoal-700">{progress}</p>}
      {error && <ErrorBanner message={error} />}
    </section>
  );
}

function DiagnosticView({ d }: { d: DiagnosticSummary }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label="Productos / variantes" value={`${d.products} / ${d.variants}`} />
        <Kpi label="Clientes" value={String(d.clients)} />
        <Kpi label="Documentos 90 días" value={String(d.documents90d)} />
        <Kpi label="Ventas 90 días" value={formatCLP(d.sales90dCLP)} />
      </div>
      {d.warnings.length > 0 && (
        <ul className="rounded-md bg-brass-50 border border-brass-300 text-brass-700 p-3 text-xs space-y-1">
          {d.warnings.map((w) => <li key={w}>⚠︎ {w}</li>)}
        </ul>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <MiniTable title="Sucursales" rows={d.offices.map((o) => [o.name + (o.isVirtual ? ' (virtual)' : ''), `${o.variantsWithStock} variantes con stock`])} />
        <MiniTable title="Tipos de documento (90 días)" rows={d.documentTypes.map((t) => [`${t.name}${t.codeSii ? ` · SII ${t.codeSii}` : ''}`, `${KIND_LABEL[t.kind]} · ${t.count90d}`])} />
        <MiniTable title="Usuarios / vendedores Bsale" rows={d.users.map((u) => [u.name || `#${u.id}`, `${u.documents90d} doc.`])} />
        <MiniTable title="Más vendido (90 días)" rows={d.topVariants90d.slice(0, 10).map((t) => [t.label, formatCLP(t.totalCLP)])} />
      </div>
      <p className="text-xs text-charcoal-500">
        Cruce de catálogo: <Pill tone="ok">{d.mapping.confirmed} confirmadas</Pill> <Pill tone="warn">{d.mapping.suggested} sugeridas</Pill> <Pill tone="bad">{d.mapping.unmatched} sin match</Pill>{' '}
        <Link to="/admin/catalogo?tab=cruce" className="underline">Revisar cruce →</Link>
      </p>
    </div>
  );
}

function Bitacora() {
  const writes = useWriteLog(40);
  const hooks = useWebhookLog(20);
  return (
    <div className="space-y-5">
      <section>
        <p className="eyebrow mb-2">Escrituras hacia Bsale</p>
        <div className="card divide-y divide-charcoal-100/70">
          {writes.length === 0 && <p className="p-3 text-xs text-charcoal-300">Sin escrituras todavía.</p>}
          {writes.map((w) => (
            <details key={w.id} className="p-3 text-xs">
              <summary className="cursor-pointer flex flex-wrap gap-2 items-center">
                <Pill tone={w.status === 'ok' ? 'ok' : w.status === 'simulado' ? 'muted' : 'bad'}>{w.status}</Pill>
                <span className="font-semibold text-charcoal-900">{w.kind.replace(/_/g, ' ')}</span>
                <span className="text-charcoal-500">{w.method} {w.path}{w.ref ? ` · ${w.ref}` : ''}</span>
                <span className="text-charcoal-300 ml-auto">{when(w.at)}</span>
              </summary>
              <pre className="mt-2 rounded bg-charcoal-900 text-cream-100 p-2 overflow-auto max-h-48 text-[11px]">{JSON.stringify({ body: w.body, error: w.error, responseId: w.responseId }, null, 2)}</pre>
            </details>
          ))}
        </div>
      </section>
      <section>
        <p className="eyebrow mb-2">Webhooks recibidos</p>
        <div className="card divide-y divide-charcoal-100/70">
          {hooks.length === 0 && <p className="p-3 text-xs text-charcoal-300">Sin avisos de Bsale todavía.</p>}
          {hooks.map((h) => (
            <div key={h.id} className="p-2.5 text-xs flex gap-2 flex-wrap">
              <Pill tone={h.status === 'ok' ? 'ok' : h.status === 'error' ? 'bad' : 'muted'}>{h.status ?? 'recibido'}</Pill>
              <span className="text-charcoal-900">{h.topic} {h.action}</span>
              <span className="text-charcoal-500">#{h.resourceId}</span>
              {h.error && <span className="text-red-700">{h.error}</span>}
              <span className="text-charcoal-300 ml-auto">{when(h.at)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-charcoal-100 p-2.5"><p className="text-[10px] uppercase tracking-display text-charcoal-300">{label}</p><p className="text-base font-semibold text-charcoal-900">{value}</p></div>;
}

function MiniTable({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div>
      <p className="eyebrow mb-1">{title}</p>
      <ul className="rounded-md border border-charcoal-100 divide-y divide-charcoal-100/70 text-xs">
        {rows.length === 0 && <li className="p-2 text-charcoal-300">—</li>}
        {rows.map(([a, b], i) => <li key={i} className="px-2.5 py-1.5 flex justify-between gap-3"><span className="text-charcoal-700 truncate">{a}</span><span className="text-charcoal-500 shrink-0">{b}</span></li>)}
      </ul>
    </div>
  );
}

function OfficeSelect({ label, value, options, disabled, onChange }: { label: string; value?: number; options: Array<{ id: number; name: string }>; disabled: boolean; onChange: (v: number | undefined) => void }) {
  return (
    <label className="block text-xs text-charcoal-500">{label}
      <select className="field mt-1 h-10 text-sm" disabled={disabled} value={value ?? ''} onChange={(e) => onChange(Number(e.target.value) || undefined)}>
        <option value="">—</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        {value && !options.some((o) => o.id === value) && <option value={value}>Sucursal #{value}</option>}
      </select>
    </label>
  );
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={'flex gap-2 items-start rounded-md border p-2.5 ' + (checked ? 'border-charcoal-700 bg-white' : 'border-charcoal-100')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span><span className="text-sm font-semibold text-charcoal-900 block">{label}</span><span className="text-[11px] text-charcoal-500">{hint}</span></span>
    </label>
  );
}
