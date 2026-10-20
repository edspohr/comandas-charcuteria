import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMyOrders } from '@/data/orders';
import { saveSampleFeedback, useSampleFeedback } from '@/data/samples';
import { purchasesFromOrders, sampleRows, SAMPLE_FOLLOWUP_DAYS, SAMPLE_RESULT_LABEL, type SampleResult, type SampleRow } from '@/domain/samples';
import { describeFirestoreError } from '@/lib/errors';
import SampleTag from './SampleTag';

// Tablero del vendedor: muestras entregadas hace 7 días o más sin respuesta.
// Una respuesta por muestra; si el cliente ya volvió a pedir el producto se
// sugiere "Ya lo pidió".
export default function SampleFollowups({ uid }: { uid: string }) {
  const { orders } = useMyOrders(uid);
  const feedback = useSampleFeedback();
  const rows = useMemo(() => sampleRows(orders, feedback, purchasesFromOrders(orders)), [orders, feedback]);
  const due = rows.filter((r) => r.stage === 'por_seguir');
  const waiting = rows.filter((r) => r.stage === 'esperando' || r.stage === 'en_camino').length;
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!due.length) return null;

  async function answer(r: SampleRow, result: SampleResult) {
    setBusy(r.id); setError(null);
    try {
      await saveSampleFeedback({ id: r.id, orderId: r.orderId, productId: r.productId, formatId: r.formatId, result, note: note.trim() || undefined }, uid);
      setOpen(null); setNote('');
    } catch (e) { setError(describeFirestoreError(e)); } finally { setBusy(null); }
  }

  return (
    <section className="card p-4 mb-4 border-brass-300">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
        <p className="eyebrow">Muestras por seguir · {due.length}</p>
        <p className="text-[11px] text-charcoal-300">Entregadas hace {SAMPLE_FOLLOWUP_DAYS}+ días{waiting ? ` · ${waiting} en espera` : ''}</p>
      </div>
      {error && <p className="text-xs text-red-700 mb-2">{error}</p>}
      <ul className="divide-y divide-charcoal-100">
        {due.slice(0, 8).map((r) => (
          <li key={r.id} className="py-2">
            <div className="flex items-start justify-between gap-2">
              <button className="text-left min-w-0" onClick={() => { setOpen(open === r.id ? null : r.id); setNote(''); }}>
                <p className="text-sm text-charcoal-900 truncate"><SampleTag />¿Qué le pareció <strong>{r.productName}</strong> a <strong>{r.clientName}</strong>?</p>
                <p className="text-[11px] text-charcoal-500">{r.label} · <Link className="underline" to={`/vendedor/mis/${r.orderId}`}>{r.orderId}</Link>{r.daysOverdue > 0 ? ` · hace ${r.daysOverdue + SAMPLE_FOLLOWUP_DAYS} días` : ''}{r.converted ? ` · ya volvió a pedir (${r.converted.ref})` : ''}</p>
              </button>
              {r.converted && open !== r.id && (
                <button disabled={busy != null} onClick={() => answer(r, 'pidio')} className="shrink-0 rounded bg-emerald-700 text-white px-2 py-1 text-[10px] uppercase tracking-display">Ya lo pidió</button>
              )}
            </div>
            {open === r.id && (
              <div className="mt-2 space-y-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional): qué dijo, precio, frecuencia…" className="field h-9 text-sm" />
                <div className="flex flex-wrap gap-1.5">
                  {(['gusto', 'pidio', 'no_interesa', 'sin_respuesta'] as SampleResult[]).map((k) => (
                    <button key={k} disabled={busy != null} onClick={() => answer(r, k)}
                      className={'rounded-md border px-2.5 py-1.5 text-xs ' + (k === 'no_interesa' ? 'border-charcoal-200 text-charcoal-500' : k === 'sin_respuesta' ? 'border-charcoal-200 text-charcoal-400' : 'border-brass-300 bg-brass-50 text-brass-700')}>
                      {SAMPLE_RESULT_LABEL[k]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {due.length > 8 && <p className="text-[11px] text-charcoal-300 mt-1">+ {due.length - 8} más</p>}
    </section>
  );
}
