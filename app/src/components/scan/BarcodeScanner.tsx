import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReadInputBarcodeFormat, ReadResult } from 'zxing-wasm/reader';
import { useScrollLock } from '@/lib/scrollLock';

// Lector de códigos con la cámara (zxing-wasm: funciona en Android y en
// iPhone, donde Safari no trae BarcodeDetector). Modo continuo para las cajas
// y modo de una lectura para el timbre. «Foto» lee una imagen a resolución
// completa: sirve para el PDF417 del timbre cuando el video no alcanza.

export interface ScanHit { text: string; format: string; symbology: string; source: 'video' | 'foto' | 'archivo' }

export const LABEL_FORMATS: ReadInputBarcodeFormat[] = ['Code128', 'DataBarExpanded', 'DataBar', 'DataMatrix', 'QRCode', 'EAN-13', 'EAN-8', 'UPC-A', 'ITF'];
export const TIMBRE_FORMATS: ReadInputBarcodeFormat[] = ['PDF417'];

let readerPromise: Promise<typeof import('zxing-wasm/reader')> | null = null;
function loadReader() {
  readerPromise ??= (async () => {
    const [mod, wasm] = await Promise.all([import('zxing-wasm/reader'), import('zxing-wasm/reader/zxing_reader.wasm?url')]);
    // El wasm se sirve desde el hosting (no desde el CDN por defecto).
    mod.prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm.default : prefix + path) }, fireImmediately: true });
    return mod;
  })();
  return readerPromise;
}

const toHits = (rs: ReadResult[], source: ScanHit['source']): ScanHit[] =>
  rs.filter((r) => r.isValid && r.text).map((r) => ({ text: r.text, format: r.format, symbology: r.symbologyIdentifier, source }));

export async function readImage(file: Blob, formats: ReadInputBarcodeFormat[]): Promise<ScanHit[]> {
  const { readBarcodes } = await loadReader();
  return toHits(await readBarcodes(file, { formats, tryHarder: true, tryRotate: true, tryInvert: true, maxNumberOfSymbols: 8 }), 'foto');
}

let audio: AudioContext | null = null;
export function beep(ok = true) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(); const g = audio.createGain();
    o.frequency.value = ok ? 1320 : 330; g.gain.value = 0.08;
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.07 : 0.2));
  } catch { /* sin audio */ }
  try { navigator.vibrate?.(ok ? 40 : [60, 40, 60]); } catch { /* sin vibración */ }
}

interface Props {
  title: string;
  formats: ReadInputBarcodeFormat[];
  continuous?: boolean;
  /** Devuelve false para marcar la lectura como rechazada (pitido de error). */
  onHit: (hit: ScanHit) => boolean | void;
  onClose: () => void;
  /** Foto: además de leer los códigos, la recibe quien llama (p. ej. para Gemini). */
  onPhoto?: (file: File, hits: ScanHit[]) => void;
  photoLabel?: string;
  hint?: string;
  children?: React.ReactNode;
}

export default function BarcodeScanner({ title, formats, continuous, onHit, onClose, onPhoto, photoLabel = 'Foto', hint, children }: Props) {
  useScrollLock(true);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const seen = useRef(new Map<string, number>());
  const onHitRef = useRef(onHit); onHitRef.current = onHit;
  const photo = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'cargando' | 'leyendo' | 'sin_camara'>('cargando');
  const [camError, setCamError] = useState<string | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [last, setLast] = useState<{ text: string; ok: boolean } | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    let stop = false; let timer: number | undefined; let stream: MediaStream | null = null;
    (async () => {
      const reader = await loadReader();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      } catch (e) {
        setStatus('sin_camara'); setCamError((e as Error)?.name === 'NotAllowedError' ? 'La app no tiene permiso para usar la cámara. Actívelo en los ajustes del navegador o use «Foto».' : 'No se pudo abrir la cámara. Use «Foto».');
        return;
      }
      if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
      const t = stream.getVideoTracks()[0]; track.current = t;
      const caps = (t.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
      if (caps.torch) setTorch(false);
      if (caps.focusMode?.includes('continuous')) t.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
      const v = video.current!; v.srcObject = stream; await v.play().catch(() => {});
      setStatus('leyendo');
      const tick = async () => {
        if (stop) return;
        if (v.readyState >= 2 && v.videoWidth) {
          const c = (canvas.current ??= document.createElement('canvas'));
          c.width = v.videoWidth; c.height = v.videoHeight;
          const ctx = c.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(v, 0, 0);
          try {
            const rs = await reader.readBarcodes(ctx.getImageData(0, 0, c.width, c.height), { formats, tryHarder: true, maxNumberOfSymbols: 4 });
            for (const hit of toHits(rs, 'video')) handle(hit);
          } catch { /* cuadro ilegible */ }
        }
        timer = window.setTimeout(tick, 120);
      };
      void tick();
    })();
    return () => { stop = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handle(hit: ScanHit) {
    const now = Date.now();
    // La misma etiqueta frente a la cámara se lee muchas veces por segundo:
    // se ignora hasta que pasen 2,5 s sin verla.
    const prev = seen.current.get(hit.text);
    seen.current.set(hit.text, now);
    if (prev && now - prev < 2500) return;
    const res = onHitRef.current(hit);
    const ok = res !== false;
    beep(ok);
    setLast({ text: hit.text, ok });
    if (!continuous && ok) onClose();
  }

  async function takePhoto(file: File | undefined) {
    if (!file) return;
    setReading(true);
    try {
      const hits = await readImage(file, formats);
      if (onPhoto) onPhoto(file, hits);
      else if (hits.length === 0) { beep(false); setLast({ text: 'La foto no tiene un código legible.', ok: false }); }
      for (const h of hits) handle(h);
    } finally { setReading(false); }
  }

  async function toggleTorch() {
    if (!track.current || torch == null) return;
    try { await track.current.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); } catch { setTorch(null); }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex items-center justify-between gap-2 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-2">
        <p className="font-semibold text-sm">{title}</p>
        <button type="button" className="rounded-md bg-white/15 px-3 py-1.5 text-sm" onClick={onClose}>{continuous ? 'Listo' : 'Cerrar'}</button>
      </div>
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <video ref={video} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        {status === 'leyendo' && <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-1/3 border-2 border-white/70 rounded-lg pointer-events-none" />}
        {status === 'cargando' && <p className="absolute inset-0 grid place-items-center text-sm text-white/70">Abriendo la cámara…</p>}
        {status === 'sin_camara' && <p className="absolute inset-0 grid place-items-center text-sm text-white/80 px-8 text-center">{camError}</p>}
        {reading && <p className="absolute inset-0 grid place-items-center text-sm bg-black/60">Leyendo la foto…</p>}
        {last && (
          <p className={`absolute left-3 right-3 bottom-3 rounded-md px-3 py-2 text-xs font-mono break-all ${last.ok ? 'bg-emerald-700/90' : 'bg-red-700/90'}`}>
            {last.text.replace(/\u001d/g, '␝').slice(0, 160)}
          </p>
        )}
      </div>
      <div className="bg-black px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] space-y-2">
        {hint && <p className="text-xs text-white/70">{hint}</p>}
        {children}
        <div className="flex gap-2">
          <button type="button" className="flex-1 rounded-md bg-white text-black py-2.5 text-sm font-medium" onClick={() => photo.current?.click()}>{photoLabel}</button>
          {torch != null && <button type="button" className={`rounded-md px-4 py-2.5 text-sm ${torch ? 'bg-brass-500 text-black' : 'bg-white/15'}`} onClick={toggleTorch}>Linterna</button>}
        </div>
        <input ref={photo} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void takePhoto(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </div>,
    document.body,
  );
}
