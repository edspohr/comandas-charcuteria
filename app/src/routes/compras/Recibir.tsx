import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { Pill } from '@/components/ui/DataTable';
import { Backdrop, SHEET_ACTIONS, SHEET_PANEL } from '@/components/ui/Sheet';
import BarcodeScanner, { LABEL_FORMATS, TIMBRE_FORMATS, readImage, type ScanHit } from '@/components/scan/BarcodeScanner';
import { addSupplyCode, createSupply, DuplicatePurchase, purchaseExists, savePurchase, uploadPurchaseDocuments, useSuppliers } from '@/data/purchases';
import { DOC_ACCEPT, forGemini, isPdf, pageImages } from '@/lib/docFiles';
import { deleteFile, getFile, putFile } from '@/lib/fileStore';
import { confirmPin, PinCancelled } from '@/data/pin';
import { parseLabel } from '@/domain/gs1';
import { parseTed, DTE_LABEL } from '@/domain/ted';
import { readLabelPhoto, readPurchaseDocument } from '@/domain/parse/purchase';
import {
  DOC_KIND_LABEL, DTE_OF, docKindFromDte, kgDiff, purchaseId, suggestSupply, summarize,
  type DocKind, type DocLine, type Purchase, type ReceivedBox, type Supply, type SupplyKind, type SupplyUnit,
  applyReception, isOpenOrder, ORDER_STATUS_LABEL, orderProgress, RECEIVED_TOLERANCE, type PurchaseOrder, type PurchaseSupplyRow,
} from '@/domain/purchases';
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft';
import { describeFirestoreError } from '@/lib/errors';
import { formatCLP } from '@/lib/pricing';
import { cleanRut, formatRut, isValidRut } from '@/lib/rut';
import { todayInSantiago } from '@/lib/format';

// Recibir una compra en tres pasos (ADR-0017): documento → cajas → cuadre.
// El borrador vive en el teléfono (localStorage) para que una recepción larga
// sobreviva a que la pantalla se apague o la app se recargue.

type Step = 'doc' | 'cajas' | 'cuadre' | 'listo';
interface Head {
  docKind: DocKind; dte?: number; folio: string; issuedAt: string;
  supplierRut: string; supplierName: string; totalCLP?: number;
  againstGuide: boolean; guideFolio?: string;
}
interface DocFileMeta { id: string; name: string; type: string; size: number }
interface Draft { startedAt: number; step: Step; head: Head; lines: DocLine[]; boxes: ReceivedBox[]; read: { timbre: boolean; foto: boolean }; note: string; files?: DocFileMeta[]; orderId?: string }

// Archivos del documento: en memoria y en IndexedDB (sobreviven a una recarga).
interface FileApi { add: (files: File[]) => Promise<DocFileMeta[]>; get: (id: string) => Promise<Blob | undefined>; remove: (id: string) => void }

const emptyDraft = (): Draft => ({
  startedAt: Date.now(), step: 'doc',
  head: { docKind: 'factura', folio: '', issuedAt: todayInSantiago(), supplierRut: '', supplierName: '', againstGuide: false },
  lines: [], boxes: [], read: { timbre: false, foto: false }, note: '', files: [],
});

const kg = (n: number | undefined) => (n == null ? '—' : `${n.toLocaleString('es-CL', { maximumFractionDigits: 3 })} kg`);
// Kilos y cantidades: el punto y la coma son decimales («12.5» = «12,5»).
const dec = (v: string) => { const n = Number(v.trim().replace(',', '.')); return v.trim() === '' || !Number.isFinite(n) ? undefined : n; };
// Pesos chilenos: el punto separa miles («1.543.700»).
const num = (v: string) => { const n = Number(v.replace(/\./g, '').replace(',', '.')); return v.trim() === '' || !Number.isFinite(n) ? undefined : n; };
const uid8 = () => Math.random().toString(36).slice(2, 10);

export default function Recibir({ me, supplies, orders, startOrderId, onStarted }: {
  me: { uid: string; name: string }; supplies: Supply[];
  // Compras por recibir (Fase 4): la recepción se liga a una de ellas.
  orders: PurchaseOrder[]; startOrderId?: string | null; onStarted?: () => void;
}) {
  const draftKey = `compra-${me.uid}`;
  const [d, setD] = useState<Draft>(() => loadDraft<Draft>(draftKey) ?? emptyDraft());
  useEffect(() => { if (d.step !== 'listo') saveDraft(draftKey, d); }, [d, draftKey]);
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const patchHead = (p: Partial<Head>) => setD((x) => ({ ...x, head: { ...x.head, ...p } }));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Purchase | null>(null);
  const openOrders = useMemo(() => orders.filter(isOpenOrder).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)), [orders]);
  const order = d.orderId ? orders.find((o) => o.id === d.orderId) ?? null : null;
  function pickOrder(id: string | undefined) {
    const po = id ? orders.find((o) => o.id === id) : undefined;
    setD((x) => ({
      ...x, orderId: po?.id,
      head: po && !x.head.supplierName && !x.head.supplierRut ? { ...x.head, supplierName: po.supplierName, supplierRut: po.supplierRut ? formatRut(po.supplierRut) : '' } : x.head,
    }));
  }
  // «Recibir» desde Compras por recibir: abre la recepción con esa compra.
  useEffect(() => {
    if (!startOrderId || !orders.some((o) => o.id === startOrderId)) return;
    if (d.step === 'listo') { setD({ ...emptyDraft(), orderId: undefined }); setSaved(null); }
    pickOrder(startOrderId);
    onStarted?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startOrderId, orders.length]);

  const blobs = useRef(new Map<string, Blob>());
  const fileKey = (id: string) => `${draftKey}-${id}`;
  const files: FileApi = {
    add: async (list) => {
      const metas = list.map((f) => ({ id: uid8(), name: f.name || 'foto.jpg', type: f.type || (isPdf(f) ? 'application/pdf' : 'image/jpeg'), size: f.size }));
      await Promise.all(metas.map((m, i) => { blobs.current.set(m.id, list[i]); return putFile(fileKey(m.id), list[i]); }));
      setD((x) => ({ ...x, files: [...(x.files ?? []), ...metas] }));
      return metas;
    },
    get: async (id) => blobs.current.get(id) ?? (await getFile(fileKey(id))),
    remove: (id) => { blobs.current.delete(id); void deleteFile(fileKey(id)); setD((x) => ({ ...x, files: (x.files ?? []).filter((f) => f.id !== id) })); },
  };
  function dropFiles() { for (const f of d.files ?? []) { blobs.current.delete(f.id); void deleteFile(fileKey(f.id)); } }

  function restart() { dropFiles(); clearDraft(draftKey); setD(emptyDraft()); setSaved(null); setError(null); }

  const steps: Array<[Step, string]> = [['doc', '1 · Documento'], ['cajas', '2 · Cajas'], ['cuadre', '3 · Confirmar']];
  return (
    <div className="space-y-4">
      {d.step !== 'listo' && (
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-display">
          {steps.map(([s, label]) => (
            <span key={s} className={`rounded-md px-2 py-1 border ${d.step === s ? 'bg-charcoal-900 text-cream-50 border-charcoal-900' : 'border-charcoal-200 text-charcoal-500'}`}>{label}</span>
          ))}
          {(d.head.folio || d.boxes.length > 0) && <button className="ml-auto text-charcoal-300 underline normal-case tracking-normal text-xs" onClick={() => { if (window.confirm('¿Descartar esta recepción?')) restart(); }}>Descartar</button>}
        </div>
      )}
      {error && <ErrorBanner message={error} />}
      {d.step !== 'listo' && <OrderBanner order={order} openOrders={openOrders} canChange={d.step === 'doc'} onChange={pickOrder} />}
      {d.step === 'doc' && <DocStep d={d} patch={patch} update={setD} patchHead={patchHead} supplies={supplies} setError={setError} files={files} />}
      {d.step === 'cajas' && <BoxesStep d={d} patch={patch} supplies={supplies} me={me} setError={setError} />}
      {d.step === 'cuadre' && <ReconcileStep d={d} order={order} patch={patch} supplies={supplies} me={me} setError={setError} files={files} onSaved={(p) => { dropFiles(); clearDraft(draftKey); setSaved(p); patch({ step: 'listo' }); }} />}
      {d.step === 'listo' && saved && (
        <div className="card p-4 space-y-3">
          <p className="text-lg font-semibold text-emerald-800">Compra registrada</p>
          <p className="text-sm text-charcoal-700">{DOC_KIND_LABEL[saved.docKind]} {saved.folio} · {saved.supplierName}</p>
          <ul className="text-sm">
            {saved.summary.map((r) => <li key={r.supplyId}><span className="font-semibold">{r.unit === 'kg' ? kg(r.kg) : `${r.units} un.`}</span> {r.name} <span className="text-charcoal-300 text-xs">· {r.boxes} caja{r.boxes === 1 ? '' : 's'}</span></li>)}
          </ul>
          {saved.documents?.length ? <p className="text-xs text-charcoal-500">Documento guardado ({saved.documents.length} archivo{saved.documents.length === 1 ? '' : 's'}): se ve en la pestaña Compras.</p> : null}
          {saved.againstGuide && <p className="text-xs text-charcoal-500">Factura de mercadería recibida con guía: no sumó stock.</p>}
          {saved.orderId && (() => { const po = orders.find((o) => o.id === saved.orderId); return po ? <p className="text-sm text-charcoal-700">Compra {po.number}: <b>{ORDER_STATUS_LABEL[po.status].toLowerCase()}</b>{po.status === 'parcial' ? ' (falta parte; se completa en la próxima entrega)' : ''}.</p> : null; })()}
          {saved.durationSec != null && <p className="text-xs text-charcoal-300">Tiempo de registro: {Math.round(saved.durationSec / 60)} min</p>}
          <Button onClick={restart}>Recibir otra compra</Button>
        </div>
      )}
    </div>
  );
}

// Campo numérico que guarda el texto mientras se escribe («12,» todavía no
// es un número) y entrega el valor ya interpretado.
function NumField({ value, onValue, className, placeholder, label }: { value: number | undefined; onValue: (v: number | undefined) => void; className: string; placeholder?: string; label?: string }) {
  const show = (v: number | undefined) => (v == null ? '' : String(v).replace('.', ','));
  const [text, setText] = useState(show(value));
  useEffect(() => { if (dec(text) !== value) setText(show(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input className={className} inputMode="decimal" value={text} placeholder={placeholder} aria-label={label} onChange={(e) => { setText(e.target.value); onValue(dec(e.target.value)); }} />;
}

// ─── Paso 1: documento ───────────────────────────────────────────────────

function DocStep({ d, patch, update, patchHead, supplies, setError, files }: { d: Draft; patch: (p: Partial<Draft>) => void; update: (fn: (d: Draft) => Draft) => void; patchHead: (p: Partial<Head>) => void; supplies: Supply[]; setError: (e: string | null) => void; files: FileApi }) {
  const { items: suppliers } = useSuppliers();
  const [scanning, setScanning] = useState(false);
  const [reading, setReading] = useState(false);
  const [dup, setDup] = useState<Purchase | null>(null);
  const photo = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const h = d.head;

  const knownName = (rut: string) => suppliers.find((s) => cleanRut(s.rut) === cleanRut(rut))?.name;
  const id = h.supplierRut && h.folio ? purchaseId(h.supplierRut, h.docKind, h.dte ?? DTE_OF[h.docKind], h.folio) : null;
  useEffect(() => {
    setDup(null);
    if (!id) return;
    let alive = true;
    purchaseExists(id).then((p) => { if (alive) setDup(p); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  function applyTimbre(text: string): boolean {
    const t = parseTed(text);
    if (!t) return false;
    patch({
      read: { ...d.read, timbre: true },
      head: { ...h, docKind: docKindFromDte(t.tipo), dte: t.tipo, folio: t.folio, issuedAt: t.fecha ?? h.issuedAt, supplierRut: formatRut(t.rutEmisor), supplierName: knownName(t.rutEmisor) ?? h.supplierName, totalCLP: t.monto ?? h.totalCLP },
    });
    return true;
  }

  // Foto de la cámara o archivos del teléfono (fotos de la galería o PDF):
  // quedan adjuntos como el documento de la compra y se leen todos juntos.
  async function onFiles(list: File[]) {
    if (!list.length) return;
    setReading(true); setError(null);
    try {
      await files.add(list);
      const all = [...(await Promise.all((d.files ?? []).map((f) => files.get(f.id)))).filter((b): b is Blob => !!b), ...list].slice(0, 6);
      let ted: ReturnType<typeof parseTed> = null;
      for (const f of all) {
        for (const img of await pageImages(f).catch(() => [] as Blob[])) {
          const hits = await readImage(img, TIMBRE_FORMATS).catch(() => [] as ScanHit[]);
          ted = hits.map((x) => parseTed(x.text)).find(Boolean) ?? null;
          if (ted) break;
        }
        if (ted) break;
      }
      // El timbre se aplica de inmediato; las líneas llegan después con la IA.
      if (ted) setDocFromReads(ted, null);
      // Si la IA falla, igual queda lo leído del timbre y el archivo adjunto.
      let r: Awaited<ReturnType<typeof readPurchaseDocument>> | null = null;
      try { r = await readPurchaseDocument(await Promise.all(all.map(forGemini))); }
      catch (e) { setError(`No se pudieron leer las líneas con IA (${e instanceof Error ? e.message : 'error'}). Complete los datos a mano; el documento quedó adjunto.`); }
      setDocFromReads(ted, r);
    } catch (e) { setError(e instanceof Error ? e.message : describeFirestoreError(e)); } finally { setReading(false); }
  }

  // Combina las lecturas con el borrador ACTUAL (la IA tarda y la persona
  // puede haber escrito mientras tanto): el timbre manda; la IA solo completa
  // lo que está vacío.
  function setDocFromReads(ted: ReturnType<typeof parseTed>, read: Awaited<ReturnType<typeof readPurchaseDocument>> | null) {
    const lines: DocLine[] = (read?.lines ?? []).map((l) => ({ ...l, supplyId: suggestSupply(l.description, supplies)?.id }));
    update((x) => {
      const cur = x.head;
      const fill = <T,>(current: T | undefined, ai: T | undefined): T | undefined => (current != null && current !== '' ? current : ai);
      const rut = ted?.rutEmisor ?? fill(cur.supplierRut, read?.supplierRut) ?? '';
      return {
        ...x,
        read: { timbre: x.read.timbre || !!ted, foto: x.read.foto || !!read },
        lines: x.lines.length === 0 && lines.length ? lines : x.lines,
        head: {
          ...cur,
          docKind: ted ? docKindFromDte(ted.tipo) : cur.folio ? cur.docKind : read?.docKind ?? cur.docKind,
          dte: ted?.tipo ?? cur.dte,
          folio: ted?.folio ?? fill(cur.folio, read?.folio) ?? '',
          issuedAt: ted?.fecha ?? (x.read.timbre ? cur.issuedAt : read?.issuedAt ?? cur.issuedAt),
          supplierRut: rut ? formatRut(rut) : '',
          supplierName: fill(cur.supplierName, (rut && knownName(rut)) || read?.supplierName) ?? '',
          totalCLP: ted?.monto ?? fill(cur.totalCLP, read?.totalCLP),
          guideFolio: fill(cur.guideFolio, read?.guideFolio),
        },
      };
    });
  }

  const rutOk = isValidRut(h.supplierRut);
  const attached = d.files ?? [];
  const noDoc = h.docKind === 'ninguno';
  // Con documento: RUT, folio y proveedor (la foto y las líneas son opcionales).
  // Sin documento: el proveedor es opcional; si se escribe un RUT, que sea válido.
  const canGo = noDoc ? !h.supplierRut || rutOk : rutOk && h.folio.trim() && h.supplierName.trim() && !dup;
  const setLine = (i: number, p: Partial<DocLine>) => patch({ lines: d.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {([[false, 'Con factura o guía'], [true, 'Sin documento']] as const).map(([v, label]) => (
          <button key={label} onClick={() => patchHead(v ? { docKind: 'ninguno', dte: undefined, againstGuide: false } : { docKind: 'factura' })}
            className={'rounded-md px-3 py-1.5 text-sm border ' + (noDoc === v ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500')}>{label}</button>
        ))}
      </div>
      {noDoc && (
        <div className="card p-4 grid grid-cols-2 gap-3">
          <p className="col-span-2 text-sm text-charcoal-700">Registre lo que llegó sin cuadrar con un documento. La foto o el PDF de la factura se puede agregar después desde «Compras».</p>
          <label className="col-span-2 text-xs text-charcoal-500">Proveedor (opcional)<input className="field mt-1" value={h.supplierName} onChange={(e) => patchHead({ supplierName: e.target.value })} placeholder="Nombre del proveedor" /></label>
          <label className="text-xs text-charcoal-500">RUT (opcional)
            <input className={`field mt-1 font-mono ${h.supplierRut && !rutOk ? 'border-red-400' : ''}`} value={h.supplierRut} onChange={(e) => patchHead({ supplierRut: e.target.value })} onBlur={() => { if (rutOk) patchHead({ supplierRut: formatRut(h.supplierRut), supplierName: h.supplierName || knownName(h.supplierRut) || '' }); }} />
            {h.supplierRut && !rutOk && <span className="text-[11px] text-red-700">RUT inválido</span>}
          </label>
          <label className="text-xs text-charcoal-500">Fecha<input className="field mt-1" type="date" value={h.issuedAt} onChange={(e) => patchHead({ issuedAt: e.target.value })} /></label>
        </div>
      )}
      {!noDoc && <>
      <div className="card p-4 space-y-2">
        <p className="text-sm text-charcoal-700">Saque una <b>foto</b> del documento completo o elija un <b>archivo</b> (foto de la galería o PDF): queda guardado con la compra y la app lee sus líneas. Si el timbre (el código ancho al pie) no se lee solo, escanéelo.</p>
        <div className="flex gap-2 flex-wrap">
          <Button disabled={reading} onClick={() => photo.current?.click()}>{reading ? 'Leyendo el documento…' : 'Foto del documento'}</Button>
          <Button variant="secondary" disabled={reading} onClick={() => picker.current?.click()}>Desde archivo</Button>
          <Button variant="ghost" onClick={() => setScanning(true)}>Escanear timbre</Button>
        </div>
        {attached.length > 0 && <DocThumbs metas={attached} files={files} />}
        <div className="flex gap-1.5 flex-wrap text-xs">
          {d.read.timbre && <Pill tone="ok">Timbre leído</Pill>}
          {d.read.foto && <Pill tone="ok">Foto leída</Pill>}
        </div>
        <input ref={photo} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void onFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <input ref={picker} type="file" accept={DOC_ACCEPT} multiple className="hidden" onChange={(e) => { void onFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </div>

      <div className="card p-4 grid grid-cols-2 gap-3">
        <label className="col-span-2 sm:col-span-1 text-xs text-charcoal-500">Documento
          <select className="field mt-1" value={h.docKind} onChange={(e) => patchHead({ docKind: e.target.value as DocKind, dte: undefined })}>
            {(Object.keys(DOC_KIND_LABEL) as DocKind[]).filter((k) => k !== 'ninguno').map((k) => <option key={k} value={k}>{DOC_KIND_LABEL[k]}</option>)}
          </select>
          {h.dte && DTE_LABEL[h.dte] && <span className="text-[11px] text-charcoal-300">{DTE_LABEL[h.dte]} (tipo {h.dte})</span>}
        </label>
        <label className="text-xs text-charcoal-500">Folio<input className="field mt-1 font-mono" inputMode="numeric" value={h.folio} onChange={(e) => patchHead({ folio: e.target.value.replace(/\D/g, '') })} /></label>
        <label className="text-xs text-charcoal-500">Fecha<input className="field mt-1" type="date" value={h.issuedAt} onChange={(e) => patchHead({ issuedAt: e.target.value })} /></label>
        <label className="text-xs text-charcoal-500">RUT proveedor
          <input className={`field mt-1 font-mono ${h.supplierRut && !rutOk ? 'border-red-400' : ''}`} value={h.supplierRut} onChange={(e) => patchHead({ supplierRut: e.target.value })} onBlur={() => { if (rutOk) patchHead({ supplierRut: formatRut(h.supplierRut), supplierName: h.supplierName || knownName(h.supplierRut) || '' }); }} />
          {h.supplierRut && !rutOk && <span className="text-[11px] text-red-700">RUT inválido</span>}
        </label>
        <label className="col-span-2 text-xs text-charcoal-500">Proveedor<input className="field mt-1" value={h.supplierName} onChange={(e) => patchHead({ supplierName: e.target.value })} placeholder="Razón social" /></label>
        <label className="text-xs text-charcoal-500">Total (con IVA)<input className="field mt-1" inputMode="numeric" value={h.totalCLP ?? ''} onChange={(e) => patchHead({ totalCLP: num(e.target.value) })} /></label>
        {h.docKind === 'factura' && (
          <label className="col-span-2 flex items-start gap-2 text-sm text-charcoal-700">
            <input type="checkbox" className="mt-1" checked={h.againstGuide} onChange={(e) => patchHead({ againstGuide: e.target.checked })} />
            <span>Cobra mercadería que ya llegó con guía (no suma stock){h.againstGuide && <input className="field mt-1 h-9 text-sm font-mono" placeholder="Folio de la guía" value={h.guideFolio ?? ''} onChange={(e) => patchHead({ guideFolio: e.target.value })} />}</span>
          </label>
        )}
      </div>
      {dup && <ErrorBanner message={`Esta compra ya está registrada: la recibió ${dup.receivedByName} el ${new Date(dup.receivedAt).toLocaleDateString('es-CL')}.`} />}

      <div className="card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Líneas del documento</p>
          <button className="text-xs underline text-charcoal-500" onClick={() => patch({ lines: [...d.lines, { description: '', unit: 'kg' }] })}>+ Línea</button>
        </div>
        {d.lines.length === 0 && <p className="text-sm text-charcoal-300">La foto del documento llena las líneas. También puede agregarlas a mano, o seguir sin líneas.</p>}
        {d.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-6 gap-1.5 items-center">
            <input className="field h-9 text-sm col-span-6 sm:col-span-3" value={l.description} placeholder="Descripción" onChange={(e) => setLine(i, { description: e.target.value })} />
            <NumField className="field h-9 text-sm col-span-2 sm:col-span-1" value={l.qty} placeholder="Cant." onValue={(v) => setLine(i, { qty: v })} />
            <select className="field h-9 text-sm col-span-1 px-1" value={l.unit ?? 'kg'} onChange={(e) => setLine(i, { unit: e.target.value as DocLine['unit'] })}><option value="kg">kg</option><option value="unidad">un</option><option value="otro">otro</option></select>
            <input className="field h-9 text-sm col-span-2 sm:col-span-1" inputMode="numeric" value={l.total ?? ''} placeholder="Total neto" onChange={(e) => setLine(i, { total: num(e.target.value) })} />
            <button className="text-charcoal-300 text-lg col-span-1" aria-label="Quitar línea" onClick={() => patch({ lines: d.lines.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
      </div>
      {attached.length === 0 && <p className="text-xs text-charcoal-500">Recomendado: adjunte la foto o el PDF para consultarlo después. También se puede agregar más tarde desde «Compras».</p>}
      </>}

      <Button size="lg" className="w-full" disabled={!canGo} onClick={() => patch({ step: h.againstGuide ? 'cuadre' : 'cajas', head: { ...h, supplierRut: h.supplierRut ? formatRut(h.supplierRut) : '' } })}>
        {h.againstGuide ? 'Seguir a confirmar' : 'Seguir: escanear cajas'}
      </Button>
      {scanning && <BarcodeScanner title="Timbre del documento" formats={TIMBRE_FORMATS} onHit={(hit) => applyTimbre(hit.text)} onClose={() => setScanning(false)}
        hint="Acerque el timbre hasta que llene el recuadro. Si no se lee, use «Foto del timbre»: la foto tiene más resolución."
        photoLabel="Foto del timbre" />}
    </div>
  );
}

function DocThumbs({ metas, files }: { metas: DocFileMeta[]; files: FileApi }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true; const made: string[] = [];
    (async () => {
      const next: Record<string, string> = {};
      for (const m of metas) { const b = await files.get(m.id); if (b) { const u = URL.createObjectURL(b); made.push(u); next[m.id] = u; } }
      if (alive) setUrls(next);
    })();
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metas.map((m) => m.id).join()]);
  return (
    <ul className="flex gap-2 flex-wrap">
      {metas.map((m) => (
        <li key={m.id} className="relative w-20 h-24 rounded-md border border-charcoal-200 bg-white overflow-hidden">
          <a href={urls[m.id]} target="_blank" rel="noreferrer" className="block w-full h-full" title={m.name}>
            {m.type.startsWith('image/') && urls[m.id]
              ? <img src={urls[m.id]} alt={m.name} className="w-full h-full object-cover" />
              : <span className="w-full h-full grid place-items-center text-xs font-semibold text-charcoal-500">PDF</span>}
          </a>
          <button className="absolute top-0.5 right-0.5 rounded-full bg-charcoal-900/70 text-cream-50 w-5 h-5 text-xs leading-none" aria-label={`Quitar ${m.name}`} onClick={() => files.remove(m.id)}>×</button>
        </li>
      ))}
    </ul>
  );
}

// ─── Paso 2: cajas ───────────────────────────────────────────────────────

function BoxesStep({ d, patch, supplies, me, setError }: { d: Draft; patch: (p: Partial<Draft>) => void; supplies: Supply[]; me: { uid: string; name: string }; setError: (e: string | null) => void }) {
  const [scanning, setScanning] = useState(false);
  const [assigning, setAssigning] = useState<{ code?: string; keys: string[]; hint?: string } | null>(null);
  const [manual, setManual] = useState(false);
  const [reading, setReading] = useState(false);
  const photo = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const boxesRef = useRef(d.boxes); boxesRef.current = d.boxes;
  const byCode = useMemo(() => { const m = new Map<string, Supply>(); for (const s of supplies) for (const c of s.codes) m.set(c, s); return m; }, [supplies]);
  const byId = useMemo(() => new Map(supplies.map((s) => [s.id, s])), [supplies]);

  const addBoxes = (bs: ReceivedBox[]) => { boxesRef.current = [...boxesRef.current, ...bs]; patch({ boxes: boxesRef.current }); };
  const setBox = (key: string, p: Partial<ReceivedBox>) => patch({ boxes: d.boxes.map((b) => (b.key === key ? { ...b, ...p } : b)) });

  function onHit(hit: ScanHit): boolean {
    const l = parseLabel(hit.text, hit.format);
    if (l.serial && boxesRef.current.some((b) => b.code === l.code && b.serial === l.serial)) return false; // misma caja
    // Una caja con el mismo código que una ya asignada en esta recepción toma ese insumo.
    const known = l.code ? byCode.get(l.code) ?? byId.get(boxesRef.current.find((b) => b.code === l.code && b.supplyId)?.supplyId ?? '') : undefined;
    addBoxes([{
      key: uid8(), supplyId: known?.id ?? '', kg: l.netKg, lot: l.lot, expiry: l.expiry, prodDate: l.prodDate ?? l.packDate,
      code: l.code, serial: l.serial, source: l.kind === 'otro' ? 'ean' : l.kind, raw: hit.text, weightAssumed: l.weightAssumed,
      units: known?.unit === 'unidad' ? l.count ?? 1 : undefined,
    }]);
    return true;
  }

  async function onLabelFiles(list: File[]) {
    for (const f of list) await onLabelPhoto(f);
  }

  async function onLabelPhoto(file: File | undefined) {
    if (!file) return;
    setReading(true); setError(null);
    try {
      const pages = await pageImages(file);
      const hits = (await Promise.all(pages.map((p) => readImage(p, LABEL_FORMATS).catch(() => [] as ScanHit[])))).flat();
      const img = await forGemini(file);
      // Si la foto trae un GS1 con peso, basta con el código: no se gasta IA.
      const gs1 = hits.find((h) => { const l = parseLabel(h.text, h.format); return l.kind === 'gs1' && l.netKg != null; });
      if (gs1) { onHit(gs1); return; }
      const r = await readLabelPhoto(img);
      const code = hits[0] ? parseLabel(hits[0].text, hits[0].format).code : r.code;
      const known = code ? byCode.get(code) : undefined;
      addBoxes([{ key: uid8(), supplyId: known?.id ?? '', kg: r.netKg, lot: r.lot, expiry: r.expiry, prodDate: r.prodDate, code, source: 'foto', description: r.description }]);
    } catch (e) { setError(e instanceof Error ? e.message : describeFirestoreError(e)); } finally { setReading(false); }
  }

  // Grupos: por insumo asignado, y los sin asignar por código (o por caja).
  const groups = useMemo(() => {
    const assigned = new Map<string, ReceivedBox[]>(); const pending = new Map<string, ReceivedBox[]>();
    for (const b of d.boxes) {
      if (b.supplyId) assigned.set(b.supplyId, [...(assigned.get(b.supplyId) ?? []), b]);
      else { const k = b.code ?? `caja-${b.key}`; pending.set(k, [...(pending.get(k) ?? []), b]); }
    }
    return { assigned: [...assigned.entries()], pending: [...pending.entries()] };
  }, [d.boxes]);
  const missingKg = d.boxes.filter((b) => b.supplyId && byId.get(b.supplyId)?.unit !== 'unidad' && !(b.kg && b.kg > 0)).length;
  const totalKg = d.boxes.reduce((a, b) => a + (b.kg ?? 0), 0);

  async function assign(s: Supply) {
    if (!assigning) return;
    if (assigning.code && !s.codes.includes(assigning.code)) await addSupplyCode(s.id, assigning.code);
    patch({ boxes: d.boxes.map((b) => (assigning.keys.includes(b.key) ? { ...b, supplyId: s.id, units: s.unit === 'unidad' ? b.units ?? 1 : b.units } : b)) });
    setAssigning(null);
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-2">
        <p className="text-sm text-charcoal-700">Escanee el código de cada caja. Con un código GS1 la app lee el peso, el lote y el vencimiento. La primera vez que aparece un código, le pregunta qué insumo es.</p>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => setScanning(true)}>Escanear cajas</Button>
          <Button variant="secondary" disabled={reading} onClick={() => photo.current?.click()}>{reading ? 'Leyendo la etiqueta…' : 'Foto de etiqueta'}</Button>
          <Button variant="secondary" disabled={reading} onClick={() => picker.current?.click()}>Desde archivo</Button>
          <Button variant="ghost" onClick={() => setManual(true)}>A mano</Button>
        </div>
        <input ref={photo} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void onLabelPhoto(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={picker} type="file" accept={DOC_ACCEPT} multiple className="hidden" onChange={(e) => { void onLabelFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <p className="text-xs text-charcoal-500">{d.boxes.length} caja{d.boxes.length === 1 ? '' : 's'} · {kg(Math.round(totalKg * 1000) / 1000)}</p>
      </div>

      {groups.pending.length > 0 && (
        <div className="space-y-2">
          <p className="eyebrow text-brass-700">Sin insumo asignado</p>
          {groups.pending.map(([k, bs]) => (
            <div key={k} className="card p-3 border-brass-300 flex items-center justify-between gap-2">
              <div className="min-w-0 text-sm">
                <p className="font-mono text-xs break-all">{bs[0].code ?? 'Sin código'}</p>
                <p className="text-charcoal-500 text-xs">{bs.length} caja{bs.length === 1 ? '' : 's'} · {kg(bs.reduce((a, b) => a + (b.kg ?? 0), 0))}{bs[0].description ? ` · «${bs[0].description}»` : ''}</p>
              </div>
              <Button size="sm" onClick={() => setAssigning({ code: bs[0].code, keys: bs.map((b) => b.key), hint: bs[0].description })}>¿Qué insumo es?</Button>
            </div>
          ))}
        </div>
      )}

      {groups.assigned.map(([sid, bs]) => {
        const s = byId.get(sid);
        return (
          <div key={sid} className="card p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-semibold text-charcoal-900 text-sm">{s?.name ?? sid}</p>
              <p className="text-xs text-charcoal-500">{bs.length} caja{bs.length === 1 ? '' : 's'} · {s?.unit === 'unidad' ? `${bs.reduce((a, b) => a + (b.units ?? 0), 0)} un.` : kg(Math.round(bs.reduce((a, b) => a + (b.kg ?? 0), 0) * 1000) / 1000)}</p>
            </div>
            <ul className="mt-2 divide-y divide-charcoal-100">
              {bs.map((b) => (
                <li key={b.key} className="py-1.5 flex items-center gap-2 text-xs">
                  {s?.unit === 'unidad'
                    ? <NumField className="field h-8 w-20 text-sm" value={b.units} onValue={(v) => setBox(b.key, { units: v })} label="Unidades" />
                    : <NumField className={`field h-8 w-24 text-sm ${!(b.kg && b.kg > 0) ? 'border-red-400' : ''}`} value={b.kg} placeholder="kg" onValue={(v) => setBox(b.key, { kg: v, weightAssumed: false })} label="Kilos" />}
                  <span className="min-w-0 flex-1 text-charcoal-500 truncate">
                    {b.lot ? `Lote ${b.lot}` : 'Sin lote'}{b.expiry ? ` · vence ${b.expiry}` : ''} · {b.source}
                  </span>
                  {b.weightAssumed && <Pill tone="warn">Verificar peso</Pill>}
                  <button className="text-charcoal-300 text-base" aria-label="Quitar caja" onClick={() => patch({ boxes: d.boxes.filter((x) => x.key !== b.key) })}>×</button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => patch({ step: 'doc' })}>Atrás</Button>
        <Button size="lg" className="flex-1" disabled={d.boxes.length === 0 || groups.pending.length > 0 || missingKg > 0} onClick={() => patch({ step: 'cuadre' })}>
          {groups.pending.length > 0 ? 'Asigne los insumos' : missingKg > 0 ? `Falta el peso de ${missingKg}` : 'Seguir a confirmar'}
        </Button>
      </div>

      {scanning && (
        <BarcodeScanner title="Cajas" formats={LABEL_FORMATS} continuous onHit={onHit} onClose={() => setScanning(false)}
          hint="Apunte al código de barras de cada caja. Suena al leerla; una caja ya leída suena grave."
          onPhoto={(file, hits) => { if (hits.length) hits.forEach(onHit); else void onLabelPhoto(file); }} photoLabel="Foto de etiqueta">
          <p className="text-sm font-semibold">{d.boxes.length} caja{d.boxes.length === 1 ? '' : 's'} · {kg(Math.round(totalKg * 1000) / 1000)}</p>
        </BarcodeScanner>
      )}
      {assigning && <SupplyPicker supplies={supplies} lines={d.lines} hint={assigning.hint} code={assigning.code} me={me} onPick={assign} onClose={() => setAssigning(null)} setError={setError} />}
      {manual && <ManualBox supplies={supplies} lines={d.lines} me={me} setError={setError} onAdd={(bs) => { addBoxes(bs); setManual(false); }} onClose={() => setManual(false)} />}
    </div>
  );
}

function SupplyPicker({ supplies, lines, hint, code, me, onPick, onClose, setError }: {
  supplies: Supply[]; lines: DocLine[]; hint?: string; code?: string; me: { uid: string; name: string };
  onPick: (s: Supply) => void | Promise<void>; onClose: () => void; setError: (e: string | null) => void;
}) {
  const [q, setQ] = useState('');
  const [name, setName] = useState(hint ?? '');
  const [kind, setKind] = useState<SupplyKind>('carne');
  const [unit, setUnit] = useState<SupplyUnit>('kg');
  const [busy, setBusy] = useState(false);
  const list = supplies.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()));
  const lineNames = [...new Set(lines.map((l) => l.description).filter(Boolean))].filter((n) => !supplies.some((s) => s.name.toLowerCase() === n.toLowerCase()));

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(describeFirestoreError(e)); } finally { setBusy(false); }
  }
  return (
    <Backdrop onClose={onClose} label="Elegir insumo">
      <div className={`${SHEET_PANEL} sm:max-w-md`} onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold text-charcoal-900">¿Qué insumo es?</p>
        {code && <p className="text-xs text-charcoal-500 mt-1">Código <span className="font-mono break-all">{code}</span>: la app lo recordará.</p>}
        {supplies.length > 0 && (
          <>
            <input className="field mt-3 h-9 text-sm" placeholder="Buscar insumo" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="mt-2 max-h-48 overflow-y-auto divide-y divide-charcoal-100">
              {list.map((s) => <li key={s.id}><button disabled={busy} className="w-full text-left py-2 text-sm hover:bg-cream-100" onClick={() => run(async () => { await onPick(s); })}>{s.name} <span className="text-xs text-charcoal-300">· {s.kind} · {s.unit}</span></button></li>)}
            </ul>
          </>
        )}
        <p className="eyebrow mt-4">Insumo nuevo</p>
        {lineNames.length > 0 && <div className="flex gap-1.5 flex-wrap mt-1">{lineNames.slice(0, 8).map((n) => <button key={n} className="rounded border border-charcoal-200 px-2 py-0.5 text-xs" onClick={() => setName(n)}>{n}</button>)}</div>}
        <input className="field mt-2" placeholder="Nombre (p. ej. Pulpa de cerdo)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-2 mt-2">
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value as SupplyKind)}><option value="carne">Carne</option><option value="otro">Otro insumo</option></select>
          <select className="field" value={unit} onChange={(e) => setUnit(e.target.value as SupplyUnit)}><option value="kg">Por kg</option><option value="unidad">Por unidad</option></select>
        </div>
        <div className={SHEET_ACTIONS}>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" disabled={busy || !name.trim()} onClick={() => run(async () => { const s = await createSupply({ name, kind, unit, code }, me.uid); await onPick(s); })}>Crear y asignar</Button>
        </div>
      </div>
    </Backdrop>
  );
}

function ManualBox({ supplies, lines, me, onAdd, onClose, setError }: { supplies: Supply[]; lines: DocLine[]; me: { uid: string; name: string }; onAdd: (b: ReceivedBox[]) => void; onClose: () => void; setError: (e: string | null) => void }) {
  const [supply, setSupply] = useState<Supply | null>(null);
  const [picking, setPicking] = useState(false);
  const [count, setCount] = useState('1');
  const [weight, setWeight] = useState('');
  const [lot, setLot] = useState('');
  const [expiry, setExpiry] = useState('');
  const n = Math.max(1, Math.floor(num(count) ?? 1));
  const w = dec(weight);
  if (picking) return <SupplyPicker supplies={supplies} lines={lines} me={me} setError={setError} onPick={(s) => { setSupply(s); setPicking(false); }} onClose={() => setPicking(false)} />;
  return (
    <Backdrop onClose={onClose} label="Agregar cajas a mano">
      <div className={`${SHEET_PANEL} sm:max-w-md`} onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold text-charcoal-900">Agregar a mano</p>
        <button className="field mt-3 text-left" onClick={() => setPicking(true)}>{supply ? supply.name : 'Elegir insumo…'}</button>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <label className="text-xs text-charcoal-500">Cajas<input className="field mt-1" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></label>
          <label className="text-xs text-charcoal-500">{supply?.unit === 'unidad' ? 'Unidades por caja' : 'Kg por caja'}<input className="field mt-1" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
          <label className="text-xs text-charcoal-500">Lote<input className="field mt-1" value={lot} onChange={(e) => setLot(e.target.value)} /></label>
          <label className="text-xs text-charcoal-500">Vence<input className="field mt-1" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
        </div>
        <div className={SHEET_ACTIONS}>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" disabled={!supply || !w} onClick={() => onAdd(Array.from({ length: n }, () => ({
            key: uid8(), supplyId: supply!.id, source: 'manual' as const, lot: lot || undefined, expiry: expiry || undefined,
            ...(supply!.unit === 'unidad' ? { units: w } : { kg: w }),
          })))}>Agregar {n} caja{n === 1 ? '' : 's'}</Button>
        </div>
      </div>
    </Backdrop>
  );
}

// ─── Paso 3: cuadre ──────────────────────────────────────────────────────

function ReconcileStep({ d, order, patch, supplies, me, setError, files, onSaved }: { d: Draft; order: PurchaseOrder | null; patch: (p: Partial<Draft>) => void; supplies: Supply[]; me: { uid: string; name: string }; setError: (e: string | null) => void; files: FileApi; onSaved: (p: Purchase) => void }) {
  const [busy, setBusy] = useState(false);
  const used = new Set(d.boxes.map((b) => b.supplyId));
  const ordered = [...supplies.filter((s) => used.has(s.id)), ...supplies.filter((s) => !used.has(s.id))];
  // Primera vez en el cuadre: sugerir el insumo de cada línea.
  useEffect(() => {
    if (d.lines.some((l) => !l.supplyId && suggestSupply(l.description, supplies))) {
      patch({ lines: d.lines.map((l) => (l.supplyId ? l : { ...l, supplyId: suggestSupply(l.description, supplies)?.id })) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const summary = useMemo(() => summarize(d.head.againstGuide ? [] : d.boxes, d.lines, supplies), [d, supplies]);
  const h = d.head;
  // Las columnas del documento aparecen solo si se cuadró alguna línea.
  const withDoc = summary.some((r) => r.docKg != null || r.docTotal != null);

  async function confirm() {
    setBusy(true); setError(null);
    const noDoc = h.docKind === 'ninguno';
    const id = noDoc ? `SD-${Date.now().toString(36)}-${uid8()}` : purchaseId(h.supplierRut, h.docKind, h.dte ?? DTE_OF[h.docKind], h.folio);
    try {
      await confirmPin('compra', noDoc ? `Confirme la recepción${h.supplierName.trim() ? ` de ${h.supplierName.trim()}` : ''} (sin documento)` : `Confirme la recepción de ${DOC_KIND_LABEL[h.docKind].toLowerCase()} ${h.folio}`, id);
      if (await purchaseExists(id)) throw new Error('Esta compra ya está registrada.');
      const blobs = (await Promise.all((d.files ?? []).map(async (f) => ({ blob: await files.get(f.id), name: f.name }))))
        .filter((f): f is { blob: Blob; name: string } => !!f.blob);
      if (blobs.length < (d.files ?? []).length) throw new Error('No se encontró la foto o el PDF del documento en este teléfono. Vuelva al paso 1 y adjúntelo de nuevo.');
      const documents = await uploadPurchaseDocuments(id, blobs, me.uid);
      const now = Date.now();
      const p: Purchase = {
        id, supplierRut: h.supplierRut, supplierName: h.supplierName.trim() || (noDoc ? 'Sin proveedor' : ''), docKind: h.docKind, dte: h.dte ?? (DTE_OF[h.docKind] || undefined),
        folio: noDoc ? '' : h.folio, issuedAt: h.issuedAt || undefined, totalCLP: h.totalCLP, againstGuide: h.againstGuide || undefined, guideFolio: h.againstGuide ? h.guideFolio : undefined,
        lines: noDoc ? [] : d.lines.filter((l) => l.description.trim()),
        boxes: h.againstGuide ? [] : d.boxes.map(({ key: _k, ...b }) => b),
        summary, read: d.read, documents, note: d.note.trim() || undefined,
        receivedBy: me.uid, receivedByName: me.name, receivedAt: now, durationSec: Math.round((now - d.startedAt) / 1000),
        orderId: order?.id,
      };
      await savePurchase(p, h.againstGuide ? [] : d.boxes);
      onSaved(p);
    } catch (e) {
      if (e instanceof PinCancelled) return;
      setError(e instanceof DuplicatePurchase ? e.message : describeFirestoreError(e));
    } finally { setBusy(false); }
  }

  const setLine = (i: number, supplyId: string) => patch({ lines: d.lines.map((l, j) => (j === i ? { ...l, supplyId: supplyId || undefined } : l)) });
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="text-sm"><span className="font-semibold text-charcoal-900">{DOC_KIND_LABEL[h.docKind]} {h.folio}</span>{h.supplierName ? ` · ${h.supplierName}` : ''}</p>
        <p className="text-xs text-charcoal-500">{[h.supplierRut && formatRut(h.supplierRut), h.issuedAt, h.totalCLP ? `total ${formatCLP(h.totalCLP)}` : ''].filter(Boolean).join(' · ')}</p>
      </div>

      {d.lines.length > 0 && (
        <div className="card p-4 space-y-2">
          <p className="eyebrow">Cuadre con el documento (opcional)</p>
          <p className="text-xs text-charcoal-500">Asocie cada línea a su insumo para comparar los kilos y calcular el costo por kg. Puede confirmar sin hacerlo.</p>
          {d.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm">
              <p className="text-charcoal-700">{l.description} <span className="text-xs text-charcoal-300">{l.qty != null ? `· ${l.qty} ${l.unit ?? ''}` : ''}{l.total ? ` · ${formatCLP(l.total)}` : ''}</span></p>
              <select className="field h-9 text-sm" value={l.supplyId ?? ''} onChange={(e) => setLine(i, e.target.value)}>
                <option value="">— Sin asociar —</option>
                {ordered.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-display text-charcoal-500"><th className="p-2">Insumo</th><th className="p-2 text-right">Recibido</th>{withDoc && <><th className="p-2 text-right">Documento</th><th className="p-2 text-right">Dif.</th><th className="p-2 text-right">$/kg</th></>}</tr></thead>
          <tbody className="divide-y divide-charcoal-100">
            {summary.map((r) => {
              const diff = kgDiff(r);
              return (
                <tr key={r.supplyId}>
                  <td className="p-2">{r.name}<span className="block text-[11px] text-charcoal-300">{r.boxes} caja{r.boxes === 1 ? '' : 's'}</span></td>
                  <td className="p-2 text-right whitespace-nowrap">{r.unit === 'unidad' ? `${r.units} un.` : kg(r.kg)}</td>
                  {withDoc && <><td className="p-2 text-right whitespace-nowrap">{kg(r.docKg)}</td>
                  <td className="p-2 text-right whitespace-nowrap">{diff ? <Pill tone={diff.ok ? 'ok' : 'bad'}>{diff.diff > 0 ? '+' : ''}{diff.diff.toLocaleString('es-CL')}</Pill> : '—'}</td>
                  <td className="p-2 text-right whitespace-nowrap">{r.costPerKg ? formatCLP(r.costPerKg) : '—'}</td></>}
                </tr>
              );
            })}
            {summary.length === 0 && <tr><td className="p-3 text-charcoal-300" colSpan={withDoc ? 5 : 2}>Sin cajas ni líneas asociadas.</td></tr>}
          </tbody>
        </table>
      </div>
      {order && <OrderReconcile order={order} summary={h.againstGuide ? [] : summary} />}
      {summary.some((r) => kgDiff(r)?.ok === false) && <p className="text-xs text-red-700">Hay diferencias entre lo recibido y el documento. Revise las cajas o anótelo en la nota (se puede confirmar igual).</p>}

      <textarea className="field h-auto py-2 text-sm" rows={2} placeholder="Nota (opcional): faltó una caja, temperatura, etc." value={d.note} onChange={(e) => patch({ note: e.target.value })} />
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => patch({ step: h.againstGuide ? 'doc' : 'cajas' })}>Atrás</Button>
        <Button size="lg" className="flex-1" disabled={busy || (!h.againstGuide && d.boxes.length === 0)} onClick={confirm}>{busy ? 'Guardando…' : 'Confirmar con PIN'}</Button>
      </div>
    </div>
  );
}

// ---------- Compra por recibir (Fase 4) ----------

const qtyOf = (n: number, unit: 'kg' | 'unidad') => (unit === 'unidad' ? `${n.toLocaleString('es-CL')} un.` : kg(n));

function OrderBanner({ order, openOrders, canChange, onChange }: { order: PurchaseOrder | null; openOrders: PurchaseOrder[]; canChange: boolean; onChange: (id: string | undefined) => void }) {
  if (!order && (!canChange || openOrders.length === 0)) return null;
  return (
    <div className={'card p-3 ' + (order ? 'border-brass-300 bg-brass-50' : '')}>
      {order ? (
        <>
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm"><span className="eyebrow">Recibiendo la compra</span><br /><span className="font-semibold text-charcoal-900">{order.supplierName}</span> <span className="font-mono text-[11px] text-charcoal-400">{order.number}</span></p>
            {canChange && <button type="button" onClick={() => onChange(undefined)} className="text-xs underline text-charcoal-500">Sin compra</button>}
          </div>
          <ul className="mt-1 text-xs text-charcoal-700">
            {orderProgress(order).map((r) => <li key={r.supplyId}>{r.done ? '✓ ' : ''}{r.name}: {r.received > 0 ? `${qtyOf(r.received, r.unit)} ya recibido de ` : ''}<b>{qtyOf(r.qty, r.unit)}</b></li>)}
          </ul>
        </>
      ) : (
        <label className="text-sm text-charcoal-700 block">¿Es de una compra registrada?
          <select value="" onChange={(e) => onChange(e.target.value || undefined)} className="field h-10 text-sm mt-1">
            <option value="">No, recibir sin compra</option>
            {openOrders.map((o) => <option key={o.id} value={o.id}>{o.supplierName} · {o.number} · llega {o.expectedDate.split('-').reverse().slice(0, 2).join('-')}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

function OrderReconcile({ order, summary }: { order: PurchaseOrder; summary: PurchaseSupplyRow[] }) {
  const after = applyReception(order, summary);
  const rows = orderProgress(order);
  const now = new Map(summary.map((r) => [r.supplyId, r.unit === 'unidad' ? r.units : r.kg]));
  const extra = summary.filter((r) => !order.items.some((i) => i.supplyId === r.supplyId));
  return (
    <div className="card p-4 space-y-2">
      <p className="eyebrow">Contra la compra {order.number}</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[11px] uppercase tracking-display text-charcoal-500"><th className="py-1">Insumo</th><th className="py-1 text-right">Comprado</th><th className="py-1 text-right">Antes</th><th className="py-1 text-right">Ahora</th><th className="py-1 text-right">Falta</th></tr></thead>
        <tbody className="divide-y divide-charcoal-100">
          {rows.map((r) => {
            const add = now.get(r.supplyId) ?? 0;
            const left = Math.max(0, Math.round((r.qty - r.received - add) * 1000) / 1000);
            return (
              <tr key={r.supplyId}>
                <td className="py-1">{r.name}</td>
                <td className="py-1 text-right whitespace-nowrap">{qtyOf(r.qty, r.unit)}</td>
                <td className="py-1 text-right whitespace-nowrap text-charcoal-400">{r.received ? qtyOf(r.received, r.unit) : '—'}</td>
                <td className="py-1 text-right whitespace-nowrap font-semibold">{add ? qtyOf(add, r.unit) : '—'}</td>
                <td className="py-1 text-right whitespace-nowrap">{left > 0 && (r.received + add) < r.qty * RECEIVED_TOLERANCE ? <span className="text-brass-700">{qtyOf(left, r.unit)}</span> : <span className="text-emerald-700">✓</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {extra.length > 0 && <p className="text-xs text-charcoal-500">Llegó también, fuera de la compra: {extra.map((r) => r.name).join(', ')}.</p>}
      <p className="text-xs text-charcoal-700">Al confirmar, la compra queda <b>{after.status === 'recibida' ? 'recibida' : 'parcial'}</b>{after.status === 'parcial' ? ': lo que falta se recibe en la próxima entrega o administración la cierra con la diferencia' : ''}.</p>
    </div>
  );
}
