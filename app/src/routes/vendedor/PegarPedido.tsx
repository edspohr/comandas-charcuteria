import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@/components/ui/Button';
import { useCurrentUser } from '@/data/auth';
import { useProducts } from '@/data/products';
import { parseLocal, type ParsedLine, type MatchStatus } from '@/domain/parse/local';
import { geminiEnabled, parseWithGeminiFull } from '@/domain/parse/gemini';
import { extractClientHints, hintsHaveSomething, isClientInfoLine, matchExistingClient, type ClientHints } from '@/domain/parse/client';
import { useClients } from '@/data/clients';
import NuevoClienteDialog from '@/components/clients/NuevoClienteDialog';
import type { Client } from '@/domain/types';
import { loadDraft, saveDraft } from '@/lib/draft';
import { defaultRequestedDate } from '@/domain/cutoff';
import { useSettings } from '@/data/settings';
import { formatQty } from '@/lib/format';
import type { Product } from '@/domain/types';

// Same shape used by the wizard's Draft.
interface WizardDraft {
  clientId: string | null;
  lines: Array<{
    productId: string;
    productName: string;
    formatId: string;
    formatLabel: string;
    unit: 'g' | 'kg' | 'unidad';
    qty: number;
    notes?: string;
  }>;
  requestedDate: string;
  deliveryMode: 'retiro' | 'despacho';
  deliveryAddress: string;
  receivingHours: string;
  step: number;
}

const SAMPLE = `Buenos días! Para mañana necesito:
- 3 kg de jamón cocido laminado fino
- 12 sachet 500g longaniza chillán
- 2 piezas de coppa
- 500g pastrami vacuno sin jugo`;

const SAMPLE_NUEVO = `Hola, soy Camila del Café Botánico. Queremos empezar a comprarles:
- 2 kg de jamón cocido laminado
- 6 sachet de queso gouda ahumado
- 1 pieza de coppa
Dirección: Av. Italia 1450, Ñuñoa. Recibimos de 9 a 13 hrs.
RUT 77.845.210-3, fono +56 9 6123 4455. Gracias!`;

export default function PegarPedido() {
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const navigate = useNavigate();
  const { products, loading } = useProducts();
  const { clients } = useClients();
  const { settings } = useSettings();
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<'ai' | 'local' | null>(null);
  // Client detected in the message: hints + either an existing match or the
  // client the vendedor just created from the hints.
  const [hints, setHints] = useState<ClientHints | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [creating, setCreating] = useState(false);

  async function interpret() {
    if (busy || text.trim().length < 3) return;
    setBusy(true);
    setEngine(null);
    setClient(null);
    // Deterministic hints always run; Gemini can enrich them.
    let h: ClientHints = extractClientHints(text);
    try {
      if (geminiEnabled()) {
        try {
          const remote = await parseWithGeminiFull(text, products);
          if (remote.client) h = { ...h, ...Object.fromEntries(Object.entries(remote.client).filter(([, v]) => v != null && v !== '')) };
          if (remote.lines.length > 0) {
            setParsed(remote.lines);
            setEngine('ai');
            return;
          }
        } catch (err) {
          // Log to console and fall back — the local parser always works offline.
          console.warn('[parse] Gemini failed, falling back to local:', err);
        }
      }
      setParsed(parseLocal(text, products).filter((l) => !isClientInfoLine(l.raw)));
      setEngine('local');
    } finally {
      setHints(hintsHaveSomething(h) ? h : null);
      setClient(hintsHaveSomething(h) ? matchExistingClient(h, clients) : null);
      setBusy(false);
    }
  }

  function useSample(which: 'existente' | 'nuevo' = 'existente') {
    setText(which === 'nuevo' ? SAMPLE_NUEVO : SAMPLE);
  }

  function selectSuggestion(idx: number, productId: string, catalog: Product[]) {
    setParsed((prev) => {
      if (!prev) return prev;
      const copy = [...prev];
      const line = copy[idx];
      const prod = catalog.find((p) => p.id === productId);
      if (!prod) return prev;
      const fmt = prod.formats.find((f) => f.formatId === line.formatId) ?? prod.formats[0];
      copy[idx] = {
        ...line,
        productId: prod.id,
        productName: prod.name,
        formatId: fmt.formatId,
        formatLabel: fmt.label,
        unit: fmt.unit,
        status: 'review',
      };
      return copy;
    });
  }

  function updateFormat(idx: number, formatId: string) {
    setParsed((prev) => {
      if (!prev) return prev;
      const copy = [...prev];
      const line = copy[idx];
      const prod = products.find((p) => p.id === line.productId);
      const fmt = prod?.formats.find((f) => f.formatId === formatId);
      if (!fmt) return prev;
      copy[idx] = { ...line, formatId, formatLabel: fmt.label, unit: fmt.unit };
      return copy;
    });
  }

  function updateQty(idx: number, qty: number) {
    setParsed((prev) => {
      if (!prev) return prev;
      const copy = [...prev];
      copy[idx] = { ...copy[idx], qty };
      return copy;
    });
  }

  function removeLine(idx: number) {
    setParsed((prev) => prev ? prev.filter((_, i) => i !== idx) : prev);
  }

  function transferToWizard(withClient: Client | null = client) {
    const usable = (parsed ?? []).filter((l) => l.productId && l.formatId && l.unit && l.qty && l.qty > 0);
    if (usable.length === 0) return;
    // If there's already a draft with lines, warn before overwriting.
    const existing = loadDraft<WizardDraft>(uid);
    if (existing && existing.lines.length > 0) {
      const proceed = confirm(`Hay un borrador con ${existing.lines.length} línea${existing.lines.length === 1 ? '' : 's'}. Reemplazarlo con estas ${usable.length}?`);
      if (!proceed) return;
    }
    const draft: WizardDraft = {
      clientId: withClient?.id ?? null,
      lines: usable.map((l) => ({
        productId: l.productId!,
        productName: l.productName!,
        formatId: l.formatId!,
        formatLabel: l.formatLabel!,
        unit: l.unit!,
        qty: l.qty!,
        notes: l.notes,
      })),
      requestedDate: defaultRequestedDate(settings.cutoffHour),
      deliveryMode: withClient?.deliveryMode ?? hints?.deliveryMode ?? 'despacho',
      deliveryAddress: withClient ? '' : (hints?.address ?? ''),
      receivingHours: withClient ? '' : (hints?.receivingHours ?? ''),
      step: withClient ? 2 : 1,
    };
    saveDraft(uid, draft);
    navigate('/vendedor/nuevo');
  }

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-6">
        <p className="eyebrow">Vendedor</p>
        <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Pegar pedido</h1>
        <p className="text-xs text-charcoal-300 mt-1">Pegue el mensaje del cliente. Interpretamos productos, formatos y cantidades. Usted revisa antes de continuar.</p>
      </header>

      <div className="card p-4 mb-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Pegue aquí el mensaje del cliente…"
          className="field h-auto py-3 text-sm resize-y"
        />
        <div className="flex items-center gap-2 mt-3">
          <Button onClick={interpret} disabled={loading || busy || text.trim().length < 3} className="flex-1">
            {busy ? 'Interpretando…' : 'Interpretar'}
          </Button>
          <Button variant="secondary" onClick={() => useSample('existente')} disabled={busy}>Ejemplo</Button>
          <Button variant="ghost" onClick={() => useSample('nuevo')} disabled={busy}>Cliente nuevo</Button>
        </div>
      </div>

      {parsed && hints && (
        <section className="mb-4">
          <p className="eyebrow mb-2">Cliente detectado en el mensaje</p>
          <div className={'card p-4 ' + (client ? 'border-emerald-200' : 'border-brass-300')}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 text-sm">
                {client ? (
                  <>
                    <p className="font-semibold text-charcoal-900">{client.fantasyName ?? client.name} <span className="ml-2 text-[10px] uppercase tracking-display bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 rounded">Cliente existente</span></p>
                    <p className="text-xs text-charcoal-500 mt-0.5">{client.rut ?? 'Sin RUT'} · {client.address ?? 'Sin dirección'}</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-charcoal-900">{hints.fantasyName ?? hints.name ?? 'Cliente nuevo'} <span className="ml-2 text-[10px] uppercase tracking-display bg-brass-50 text-brass-700 border border-brass-300 px-1.5 rounded">No está en el catálogo</span></p>
                    <p className="text-xs text-charcoal-500 mt-0.5">
                      {[hints.rut, hints.phone, hints.address, hints.receivingHours].filter(Boolean).join(' · ') || 'Sin más datos en el mensaje'}
                    </p>
                  </>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {client ? (
                  <Button size="sm" variant="secondary" onClick={() => setClient(null)}>No es este</Button>
                ) : (
                  <Button size="sm" onClick={() => setCreating(true)}>Crear cliente con estos datos</Button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {creating && hints && (
        <NuevoClienteDialog
          uid={uid}
          initial={hints}
          onClose={() => setCreating(false)}
          onCreated={(c) => { setCreating(false); setClient(c); transferToWizard(c); }}
        />
      )}

      {parsed && parsed.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
            <p className="eyebrow">
              Líneas propuestas · {parsed.length}
              {engine === 'ai' && <span className="ml-2 normal-case tracking-normal text-brass-700">· Gemini</span>}
              {engine === 'local' && <span className="ml-2 normal-case tracking-normal text-charcoal-300">· fallback local</span>}
            </p>
            <span className="text-[10px] uppercase tracking-display text-charcoal-300">
              {parsed.filter((l) => l.status === 'verified').length} verificadas · {parsed.filter((l) => l.status === 'review').length} a revisar · {parsed.filter((l) => l.status === 'not_found').length} no encontradas
            </span>
          </div>
          <ul className="space-y-2 mb-4">
            {parsed.map((line, i) => (
              <li key={i}>
                <ParsedLineCard
                  line={line}
                  products={products}
                  onSelectSuggestion={(pid) => selectSuggestion(i, pid, products)}
                  onFormatChange={(fid) => updateFormat(i, fid)}
                  onQtyChange={(q) => updateQty(i, q)}
                  onRemove={() => removeLine(i)}
                />
              </li>
            ))}
          </ul>
          <Button onClick={() => transferToWizard()} disabled={!parsed.some((l) => l.productId && l.formatId && (l.qty ?? 0) > 0)} className="w-full">
            {client ? `Continuar con ${client.fantasyName ?? client.name} →` : 'Continuar en el wizard →'}
          </Button>
        </section>
      )}
      {parsed && parsed.length === 0 && (
        <div className="card p-6 text-center text-sm text-charcoal-500">
          No se pudieron identificar líneas. Ajuste el texto e intente de nuevo.
        </div>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<MatchStatus, string> = {
  verified:  'bg-emerald-50 text-emerald-800 border-emerald-200',
  review:    'bg-brass-50 text-brass-700 border-brass-300',
  not_found: 'bg-red-50 text-red-800 border-red-200',
};
const STATUS_LABEL: Record<MatchStatus, string> = {
  verified: 'Verificado',
  review: 'Revisar',
  not_found: 'No encontrado',
};

function ParsedLineCard({
  line, products, onSelectSuggestion, onFormatChange, onQtyChange, onRemove,
}: {
  line: ParsedLine;
  products: Product[];
  onSelectSuggestion: (pid: string) => void;
  onFormatChange: (fid: string) => void;
  onQtyChange: (q: number) => void;
  onRemove: () => void;
}) {
  const prod = products.find((p) => p.id === line.productId);

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs text-charcoal-300 italic truncate">"{line.raw}"</p>
        <span className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-display font-semibold ${STATUS_STYLE[line.status]}`}>
          {STATUS_LABEL[line.status]}
        </span>
      </div>

      {line.status === 'not_found' ? (
        <p className="text-sm text-red-800">No encontramos un producto para esta línea. Borre y agregue manualmente en el wizard.</p>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="eyebrow block mb-1">Producto</label>
            <select
              value={line.productId ?? ''}
              onChange={(e) => onSelectSuggestion(e.target.value)}
              className="field h-10 text-sm"
            >
              {line.suggestions?.map((s) => (
                <option key={s.productId} value={s.productId}>{s.productName}</option>
              ))}
            </select>
          </div>

          {prod && (
            <div>
              <label className="eyebrow block mb-1">Formato</label>
              <select
                value={line.formatId ?? ''}
                onChange={(e) => onFormatChange(e.target.value)}
                className="field h-10 text-sm"
              >
                {prod.formats.map((f) => (
                  <option key={f.formatId} value={f.formatId}>{f.label}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="eyebrow block mb-1">Cantidad {line.unit && `(${line.unit === 'kg' ? 'kg' : line.unit === 'g' ? 'g' : 'u'})`}</label>
            <input
              type="number"
              inputMode="decimal"
              step={line.unit === 'kg' ? '0.1' : '1'}
              value={line.qty ?? ''}
              onChange={(e) => onQtyChange(parseFloat(e.target.value))}
              className="field h-10 text-sm"
            />
            {line.qty && line.unit && <p className="text-[11px] text-charcoal-300 mt-1">{formatQty(line.qty, line.unit)}</p>}
          </div>

          {line.notes && (
            <p className="text-xs text-charcoal-500">Notas: <em>{line.notes}</em></p>
          )}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-charcoal-100 text-right">
        <button onClick={onRemove} className="text-[11px] uppercase tracking-display text-charcoal-300 hover:text-red-700">
          Quitar línea
        </button>
      </div>
    </div>
  );
}
