import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { Pill } from '@/components/ui/DataTable';
import BarcodeScanner, { LABEL_FORMATS, TIMBRE_FORMATS, readImage, type ScanHit } from '@/components/scan/BarcodeScanner';
import { DOC_ACCEPT, pageImages } from '@/lib/docFiles';
import { describeFirestoreError } from '@/lib/errors';
import { useCurrentUser } from '@/data/auth';
import { addPurchaseDocuments, createSupply, documentUrl, saveScanTest, usePurchases, useScanTests, useSupplies, useSupplyLots } from '@/data/purchases';
import { parseLabel, visibleRaw } from '@/domain/gs1';
import { parseTed } from '@/domain/ted';
import { DOC_KIND_LABEL, type Purchase, type PurchaseDocument, type Supply, type SupplyLot } from '@/domain/purchases';
import { formatCLP } from '@/lib/pricing';
import { addDaysIso, todayInSantiago } from '@/lib/format';
import Recibir from './Recibir';

// Compras e insumos (ADR-0017). Prototipo: solo super administración.

type Tab = 'recibir' | 'compras' | 'insumos' | 'laboratorio';
const kg = (n: number) => `${n.toLocaleString('es-CL', { maximumFractionDigits: 1 })} kg`;

export default function Compras() {
  const { current } = useCurrentUser();
  const me = { uid: current!.appUser.uid, name: current!.appUser.displayName };
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'recibir';
  const setTab = (t: Tab) => setParams((p) => { p.set('tab', t); return p; }, { replace: true });
  const { items: supplies, error } = useSupplies();

  const tabs: Array<[Tab, string]> = [['recibir', 'Recibir'], ['compras', 'Compras'], ['insumos', 'Stock de insumos'], ['laboratorio', 'Laboratorio']];
  return (
    <div>
      <header className="mb-3">
        <h1 className="text-xl sm:text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Compras e insumos</h1>
        <p className="text-xs text-charcoal-300 mt-1">Prototipo · solo super administración · el stock de insumos vive en Comandas, no en Bsale</p>
      </header>
      <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 mb-4">
        {tabs.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={'shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px] uppercase tracking-display font-medium border transition ' + (tab === t ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500 hover:border-charcoal-300')}>{label}</button>
        ))}
      </div>
      {error && <ErrorBanner message={error} />}
      {tab === 'recibir' && <Recibir me={me} supplies={supplies} />}
      {tab === 'compras' && <PurchaseList uid={me.uid} />}
      {tab === 'insumos' && <SupplyStock supplies={supplies} uid={me.uid} />}
      {tab === 'laboratorio' && <Laboratorio uid={me.uid} />}
    </div>
  );
}

function PurchaseList({ uid }: { uid: string }) {
  const { items, loading, error } = usePurchases(100);
  const [open, setOpen] = useState<string | null>(null);
  if (loading) return <p className="text-sm text-charcoal-300">Cargando…</p>;
  if (error) return <ErrorBanner message={error} />;
  if (!items.length) return <p className="text-sm text-charcoal-300">Todavía no hay compras registradas.</p>;
  return (
    <ul className="space-y-2">
      {items.map((p) => <PurchaseCard key={p.id} p={p} uid={uid} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />)}
    </ul>
  );
}

function PurchaseCard({ p, uid, open, onToggle }: { p: Purchase; uid: string; open: boolean; onToggle: () => void }) {
  const totalKg = p.summary.reduce((a, r) => a + r.kg, 0);
  const boxes = p.summary.reduce((a, r) => a + r.boxes, 0);
  return (
    <li className="card p-3">
      <button className="w-full text-left" onClick={onToggle}>
        <p className="text-sm"><span className="font-semibold text-charcoal-900">{p.supplierName}</span> · {DOC_KIND_LABEL[p.docKind]} <span className="font-mono">{p.folio}</span></p>
        <p className="text-xs text-charcoal-500">
          {new Date(p.receivedAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })} · {p.receivedByName} · {p.againstGuide ? 'cobra guía (sin stock)' : `${boxes} caja${boxes === 1 ? "" : "s"} · ${kg(totalKg)}`}
          {p.totalCLP ? ` · ${formatCLP(p.totalCLP)}` : ''}
          {!p.documents?.length && <> · <span className="text-red-700">sin documento</span></>}
        </p>
      </button>
      {open && (
        <div className="mt-2 text-sm space-y-1">
          {p.summary.map((r) => <p key={r.supplyId}>{r.name}: <b>{r.unit === 'unidad' ? `${r.units} un.` : kg(r.kg)}</b>{r.docKg != null ? ` (doc. ${kg(r.docKg)})` : ''}{r.costPerKg ? ` · ${formatCLP(r.costPerKg)}/kg` : ''}</p>)}
          <p className="text-xs text-charcoal-300">Lectura: {p.read.timbre ? 'timbre' : 'sin timbre'}{p.read.foto ? ' + foto' : ''}{p.durationSec != null ? ` · registrada en ${Math.max(1, Math.round(p.durationSec / 60))} min` : ''}</p>
          {p.note && <p className="text-xs text-charcoal-700">Nota: {p.note}</p>}
          <PurchaseDocs p={p} uid={uid} />
        </div>
      )}
    </li>
  );
}

// Documentos guardados de la compra (fotos o PDF) y agregar más.
function PurchaseDocs({ p, uid }: { p: Purchase; uid: string }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const docs = p.documents ?? [];
  useEffect(() => {
    let alive = true;
    Promise.all(docs.map(async (d) => [d.path, await documentUrl(d.path).catch(() => '')] as const))
      .then((pairs) => { if (alive) setUrls(Object.fromEntries(pairs)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.map((d) => d.path).join()]);

  async function add(list: File[]) {
    if (!list.length) return;
    setBusy(true); setError(null);
    try { await addPurchaseDocuments(p.id, list.map((f) => ({ blob: f, name: f.name })), uid); } catch (e) { setError(describeFirestoreError(e)); } finally { setBusy(false); }
  }
  return (
    <div className="pt-2">
      <p className="eyebrow mb-1">Documento</p>
      {docs.length === 0 && <p className="text-xs text-charcoal-300">Sin foto ni PDF guardado.</p>}
      <ul className="flex gap-2 flex-wrap">
        {docs.map((d: PurchaseDocument) => (
          <li key={d.path}>
            <a href={urls[d.path] || undefined} target="_blank" rel="noreferrer" className="block w-24 h-28 rounded-md border border-charcoal-200 bg-white overflow-hidden" title={d.name}>
              {d.contentType.startsWith('image/') && urls[d.path]
                ? <img src={urls[d.path]} alt={d.name} className="w-full h-full object-cover" />
                : <span className="w-full h-full grid place-items-center text-xs text-charcoal-500 px-1 text-center">{d.contentType === 'application/pdf' ? 'PDF' : '…'}<br />{d.name.slice(0, 18)}</span>}
            </a>
          </li>
        ))}
      </ul>
      <button className="mt-2 text-xs underline text-charcoal-500" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Subiendo…' : '+ Agregar foto o PDF'}</button>
      <input ref={input} type="file" accept={DOC_ACCEPT} multiple className="hidden" onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ''; }} />
      {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
    </div>
  );
}

function SupplyStock({ supplies, uid }: { supplies: Supply[]; uid: string }) {
  const { items: lots, loading } = useSupplyLots();
  const [open, setOpen] = useState<string | null>(null);
  const soon = addDaysIso(todayInSantiago(), 7);
  const today = todayInSantiago();
  const rows = useMemo(() => {
    const by = new Map<string, SupplyLot[]>();
    for (const l of lots) by.set(l.supplyId, [...(by.get(l.supplyId) ?? []), l]);
    return supplies.map((s) => {
      const ls = (by.get(s.id) ?? []).sort((a, b) => a.receivedAt - b.receivedAt);
      const expiries = ls.map((l) => l.expiry).filter(Boolean).sort() as string[];
      return { s, lots: ls, kg: ls.reduce((a, l) => a + l.kg, 0), units: ls.reduce((a, l) => a + l.units, 0), boxes: ls.reduce((a, l) => a + l.boxes, 0), next: expiries[0] };
    });
  }, [lots, supplies]);
  if (loading) return <p className="text-sm text-charcoal-300">Cargando…</p>;
  return (
    <div className="space-y-2">
      <NewSupply uid={uid} existing={supplies} />
      {!supplies.length && <p className="text-sm text-charcoal-300">Los insumos se crean aquí o al recibir una compra.</p>}
      {supplies.length > 0 && <p className="text-xs text-charcoal-500">Stock = todo lo recibido. El consumo en producción viene en la próxima etapa.</p>}
      <ul className="space-y-2">
        {rows.map(({ s, lots: ls, kg: k, units, boxes, next }) => (
          <li key={s.id} className="card p-3">
            <button className="w-full text-left flex items-baseline justify-between gap-2" onClick={() => setOpen(open === s.id ? null : s.id)}>
              <span className="text-sm font-semibold text-charcoal-900">{s.name} <span className="text-xs font-normal text-charcoal-300">· {s.kind}</span></span>
              <span className="text-sm whitespace-nowrap">{s.unit === 'unidad' ? `${units} un.` : kg(k)}</span>
            </button>
            <p className="text-xs text-charcoal-500">
              {ls.length} lote{ls.length === 1 ? '' : 's'} · {boxes} caja{boxes === 1 ? '' : 's'} · {s.codes.length} código{s.codes.length === 1 ? '' : 's'}
              {next && <> · vence <Pill tone={next < today ? 'bad' : next <= soon ? 'warn' : 'muted'}>{next}</Pill></>}
            </p>
            {open === s.id && (
              <ul className="mt-2 divide-y divide-charcoal-100 text-xs">
                {ls.map((l) => (
                  <li key={l.id} className="py-1.5">
                    <b>{s.unit === 'unidad' ? `${l.units} un.` : kg(l.kg)}</b> · {l.lot ? `lote ${l.lot}` : 'sin lote'}{l.expiry ? ` · vence ${l.expiry}` : ''} · {l.supplierName ?? l.origin} · {new Date(l.receivedAt).toLocaleDateString('es-CL')}{l.costPerKg ? ` · ${formatCLP(l.costPerKg)}/kg` : ''}
                  </li>
                ))}
                {s.codes.length > 0 && <li className="py-1.5 text-charcoal-300 font-mono break-all">Códigos: {s.codes.join(' · ')}</li>}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Insumo nuevo sin pasar por una compra (p. ej. antes de la carga de inventario).
function NewSupply({ uid, existing }: { uid: string; existing: Supply[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'carne' | 'otro'>('carne');
  const [unit, setUnit] = useState<'kg' | 'unidad'>('kg');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dup = existing.some((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
  async function save() {
    setBusy(true); setError(null);
    try { await createSupply({ name, kind, unit }, uid); setName(''); setOpen(false); } catch (e) { setError(describeFirestoreError(e)); } finally { setBusy(false); }
  }
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>+ Insumo nuevo</Button>;
  return (
    <div className="card p-3 space-y-2">
      <input className="field" placeholder="Nombre (p. ej. Tripa natural de cerdo)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div className="grid grid-cols-2 gap-2">
        <select className="field" value={kind} onChange={(e) => setKind(e.target.value as 'carne' | 'otro')}><option value="carne">Carne</option><option value="otro">Otro insumo</option></select>
        <select className="field" value={unit} onChange={(e) => setUnit(e.target.value as 'kg' | 'unidad')}><option value="kg">Por kg</option><option value="unidad">Por unidad</option></select>
      </div>
      {dup && <p className="text-xs text-brass-700">Ya existe un insumo con ese nombre.</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button size="sm" disabled={busy || !name.trim() || dup} onClick={save}>{busy ? 'Guardando…' : 'Crear insumo'}</Button>
      </div>
    </div>
  );
}

// Laboratorio: escanear etiquetas y timbres reales y guardar lo que lee el
// lector, para ajustar el intérprete (scripts/export-scan-tests.ts).
function Laboratorio({ uid }: { uid: string }) {
  const { items } = useScanTests(50);
  const [scanning, setScanning] = useState<'etiquetas' | 'timbre' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Fotos o PDF del teléfono o del computador: se buscan todos los códigos.
  async function fromFiles(list: File[]) {
    setError(null);
    for (const f of list) {
      setReading(f.name);
      try {
        const hits = (await Promise.all((await pageImages(f)).map((img) => readImage(img, [...LABEL_FORMATS, 'PDF417'])))).flat();
        if (!hits.length) setError(`«${f.name}»: no se encontró ningún código legible.`);
        for (const h of hits) onHit({ ...h, source: 'archivo' }, f.name);
      } catch (e) { setError(`«${f.name}»: ${(e as Error).message}`); }
    }
    setReading(null);
  }

  function onHit(hit: ScanHit, fileName?: string) {
    const ted = parseTed(hit.text);
    const parsed = ted ? { lectura: 'timbre', ...ted } : (({ raw: _r, ...rest }) => rest)(parseLabel(hit.text, hit.format));
    saveScanTest({ at: Date.now(), by: uid, format: hit.format, text: hit.text, symbology: hit.symbology, source: hit.source, parsed: parsed as Record<string, unknown>, note: [note.trim(), fileName].filter(Boolean).join(' · ') || undefined, ua: navigator.userAgent })
      .catch((e) => setError(String(e)));
    return true;
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-2">
        <p className="text-sm text-charcoal-700">Escanee etiquetas y timbres reales. Cada lectura se guarda con el texto crudo y lo que entendió la app, para ajustar el intérprete. No crea compras ni stock.</p>
        <input className="field" placeholder="Nota para estas lecturas (p. ej. «Agrosuper, pulpa cerdo»)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => setScanning('etiquetas')}>Escanear etiquetas</Button>
          <Button variant="secondary" onClick={() => setScanning('timbre')}>Escanear timbre</Button>
          <Button variant="secondary" disabled={!!reading} onClick={() => picker.current?.click()}>{reading ? `Leyendo ${reading.slice(0, 20)}…` : 'Desde archivo'}</Button>
        </div>
        <input ref={picker} type="file" accept={DOC_ACCEPT} multiple className="hidden" onChange={(e) => { void fromFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </div>
      {error && <ErrorBanner message={error} />}
      <ul className="space-y-2">
        {items.map((t) => {
          const p = t.parsed as Record<string, unknown>;
          const fields = Object.entries(p).filter(([k, v]) => k !== 'ais' && v != null && v !== '');
          return (
            <li key={t.id} className="card p-3 text-xs space-y-1">
              <p className="text-charcoal-500">{new Date(t.at).toLocaleTimeString('es-CL')} · <b>{t.format}</b> {t.symbology} · {t.source}{t.note ? ` · ${t.note}` : ''}</p>
              <p className="font-mono break-all text-charcoal-900">{visibleRaw(t.text).slice(0, 400)}</p>
              <p className="text-charcoal-700">{fields.map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</p>
              {p.ais != null && Object.keys(p.ais as object).length > 0 && <p className="font-mono text-charcoal-300">{Object.entries(p.ais as Record<string, string>).map(([ai, v]) => `(${ai})${v}`).join(' ')}</p>}
            </li>
          );
        })}
        {items.length === 0 && <p className="text-sm text-charcoal-300">Sin lecturas todavía.</p>}
      </ul>
      {scanning && (
        <BarcodeScanner title={scanning === 'timbre' ? 'Laboratorio · timbre' : 'Laboratorio · etiquetas'} formats={scanning === 'timbre' ? TIMBRE_FORMATS : [...LABEL_FORMATS, 'PDF417']} continuous onHit={(h) => onHit(h)} onClose={() => setScanning(null)}
          hint="Cada lectura distinta se guarda. Si una etiqueta no se lee, pruebe con «Foto»." />
      )}
    </div>
  );
}
