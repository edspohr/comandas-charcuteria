import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { ModalShell } from '@/components/orders/OrderDialogs';
import { blobToBase64, readDictatedOpportunity, type DictatedOpportunity } from '@/domain/parse/opportunity';
import { todayInSantiago } from '@/lib/format';

// «Dictar oportunidad» (Fase 5): grabar un audio o escribir, leerlo con
// Gemini y pasar el resultado a la pantalla de confirmación.

const MAX_SEC = 120;
const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
const pickMime = () => (typeof MediaRecorder !== 'undefined' ? MIME.find((m) => MediaRecorder.isTypeSupported?.(m)) : undefined);

export default function VoiceOpportunity({ executives, products, onRead, onClose }: {
  executives: string[]; products: string[];
  onRead: (d: DictatedOpportunity) => void; onClose: () => void;
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'reading'>('idle');
  const [secs, setSecs] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!pickMime();

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMime()!;
      const r = new MediaRecorder(stream, { mimeType });
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void read({ audio: new Blob(chunks.current, { type: mimeType.split(';')[0] }) });
      };
      rec.current = r;
      r.start();
      setSecs(0); setState('recording');
      timer.current = window.setInterval(() => setSecs((s) => { if (s + 1 >= MAX_SEC) stop(); return s + 1; }), 1000);
    } catch {
      setError('No se pudo usar el micrófono. Revise el permiso del navegador o escriba la oportunidad.');
    }
  }

  function stop() {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (rec.current?.state === 'recording') rec.current.stop();
  }

  async function read(input: { audio?: Blob; text?: string }) {
    setState('reading'); setError(null);
    try {
      const audio = input.audio ? { base64: await blobToBase64(input.audio), mimeType: input.audio.type || 'audio/webm' } : undefined;
      if (audio && audio.base64.length < 1000) throw new Error('El audio quedó vacío. Grabe un poco más y hable cerca del teléfono.');
      const d = await readDictatedOpportunity({ audio, text: input.text }, { today: todayInSantiago(), executives, products });
      onRead(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer la oportunidad.');
      setState('idle');
    }
  }

  return (
    <ModalShell title="Dictar oportunidad" eyebrow="Oportunidades" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-charcoal-600">Diga a quién se asigna, el cliente, qué se busca y cuándo. Por ejemplo: «Que Rafael visite al Bistró Ñuñoa el jueves para ofrecer guanciale y prosciutto; preguntar por el chef Martín».</p>
        {canRecord && state !== 'reading' && (
          <div className="flex flex-col items-center gap-2">
            {state === 'idle'
              ? <button type="button" onClick={start} className="w-20 h-20 rounded-full bg-red-600 text-white text-3xl shadow-lift" aria-label="Empezar a grabar">🎤</button>
              : <button type="button" onClick={stop} className="w-20 h-20 rounded-full bg-charcoal-900 text-white text-sm font-semibold shadow-lift animate-pulse" aria-label="Terminar la grabación">Listo</button>}
            <p className="text-xs text-charcoal-500">{state === 'recording' ? `Grabando… ${secs} s (máx. ${MAX_SEC} s). Toque «Listo» al terminar.` : 'Toque para grabar'}</p>
          </div>
        )}
        {state === 'reading' && <p className="text-sm text-charcoal-700 text-center py-6">Leyendo la oportunidad…</p>}
        {state === 'idle' && (
          <div>
            <label className="eyebrow block mb-1">{canRecord ? 'O escríbala' : 'Escriba la oportunidad'}</label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="field h-auto py-2 text-sm resize-none" placeholder="Rafael visita Bistró Ñuñoa el jueves: guanciale y prosciutto…" />
            <Button variant="secondary" className="w-full mt-2" disabled={!text.trim()} onClick={() => read({ text: text.trim() })}>Ordenar el texto</Button>
          </div>
        )}
        {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm">{error}</div>}
      </div>
    </ModalShell>
  );
}
