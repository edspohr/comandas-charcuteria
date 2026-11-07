import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/DataTable';
import { ModalShell } from '@/components/orders/OrderDialogs';
import NuevoClienteDialog from '@/components/clients/NuevoClienteDialog';
import VoiceOpportunity from '@/components/opportunities/VoiceOpportunity';
import { useProducts } from '@/data/products';
import { matchClients, matchExecutive } from '@/domain/oppMatch';
import { clientAltName } from '@/domain/parse/client';
import type { DictatedOpportunity } from '@/domain/parse/opportunity';
import { useCurrentUser } from '@/data/auth';
import { searchClients, useClients } from '@/data/clients';
import { useUsers } from '@/data/users';
import {
  createOpportunity, dismissCandidate, loadCandidates, logActivity, markLost, postpone, reassign, reopen, setNextAction,
  useCandidates, useOpportunities,
} from '@/data/opportunities';
import {
  ACTIVITY_LABEL, LOST_REASON_LABEL, LOST_REASONS, NEXT_ACTION_LABEL, ORIGIN_LABEL, STATUS_LABEL,
  agendaFor, dueDate, isOpen, isOverdue, teamSummary,
  type LostReason, type NextActionType, type Opportunity, type OpportunityCandidate, type OpportunityStatus,
} from '@/domain/opportunities';
import { can } from '@/domain/permissions';
import type { AppUser, Client } from '@/domain/types';
import { describeFirestoreError } from '@/lib/errors';
import { addDaysIso, formatDateShort, todayInSantiago } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';

// Oportunidades comerciales. El ejecutivo ve su agenda (lo que toca hoy o
// está vencido) y gestiona las suyas; super administración ve todas, asigna,
// reasigna, revisa al equipo y carga el informe de oportunidades.

type Tab = 'agenda' | 'abiertas' | 'cerradas' | 'equipo' | 'sinAsignar' | 'informe';

const STATUS_TONE: Record<OpportunityStatus, 'ok' | 'warn' | 'bad' | 'muted' | 'info'> = {
  abierta: 'info', en_gestion: 'info', postergada: 'muted', ganada: 'ok', perdida: 'bad',
};

export default function Oportunidades() {
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const role = current!.appUser.role;
  const manageAll = can(role, 'opportunity.manageAll');
  const viewAll = can(role, 'opportunity.viewAll');
  const canCreate = can(role, 'opportunity.manageOwn');
  const { opportunities, loading, error } = useOpportunities(viewAll ? { all: true } : { ownerUid: uid });
  const { users, nameOf, sellers } = useUsers();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? (viewAll && !canCreate ? 'equipo' : 'agenda');
  const setTab = (t: Tab) => setParams((p) => { p.set('tab', t); return p; }, { replace: true });
  const [owner, setOwner] = useState<string>(manageAll ? 'todos' : uid);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [dictated, setDictated] = useState<DictatedOpportunity | null>(null);
  const { products: catalog } = useProducts();
  const today = todayInSantiago();

  const executives = useMemo(() => sellers.filter((u) => !u.placeholder).concat(users.filter((u) => u.role === 'superAdmin' && u.active !== false && !u.placeholder)), [sellers, users]);
  const mine = useMemo(() => (owner === 'todos' ? opportunities : opportunities.filter((o) => (o.ownerUid ?? '') === owner)), [opportunities, owner]);
  const agenda = useMemo(() => agendaFor(mine, today), [mine, today]);
  const open = useMemo(() => mine.filter((o) => isOpen(o) && o.ownerUid).sort((a, b) => (dueDate(a) ?? '9').localeCompare(dueDate(b) ?? '9')), [mine]);
  const closed = useMemo(() => mine.filter((o) => !isOpen(o)), [mine]);
  const unassigned = useMemo(() => opportunities.filter((o) => isOpen(o) && !o.ownerUid), [opportunities]);
  const selected = opportunities.find((o) => o.id === openId) ?? null;

  const tabs: Array<[Tab, string, number?]> = [
    ['agenda', 'Agenda', agenda.length],
    ['abiertas', 'Abiertas', open.length],
    ['cerradas', 'Cerradas'],
    ...(viewAll ? [['equipo', 'Equipo'] as [Tab, string]] : []),
    ...(manageAll ? [['sinAsignar', 'Sin asignar', unassigned.length] as [Tab, string, number], ['informe', 'Del informe'] as [Tab, string]] : []),
  ];

  return (
    <div>
      {/* Título y botones: en pantallas angostas los botones bajan a su propia
          fila en vez de apretar (y tapar) el título. */}
      <header className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h1 className="text-xl sm:text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Oportunidades</h1>
          <p className="text-xs text-charcoal-300 mt-1">{viewAll ? 'Todo el equipo' : 'Sus oportunidades'} · {opportunities.filter(isOpen).length} abiertas</p>
        </div>
        {canCreate && (
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="secondary" onClick={() => setDictating(true)} title="Grabar o escribir la oportunidad y ordenarla con IA" aria-label="Dictar oportunidad">🎤 Dictar</Button>
            <Button size="sm" onClick={() => { setDictated(null); setCreating(true); }}><Icon name="plus" size={14} /> Oportunidad</Button>
          </div>
        )}
      </header>

      <div className="mb-3 space-y-2">
        <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          {tabs.map(([t, label, n]) => (
            <Chip key={t} active={tab === t} onClick={() => setTab(t)}>{label}{n ? <span className="ml-1 rounded-full bg-brass-100 text-brass-700 px-1.5">{n}</span> : null}</Chip>
          ))}
        </div>
        {viewAll && (tab === 'agenda' || tab === 'abiertas' || tab === 'cerradas') && (
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="field h-9 text-sm sm:max-w-xs">
            <option value="todos">Todos los ejecutivos</option>
            {executives.map((u) => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
          </select>
        )}
      </div>

      {loading && <p className="text-sm text-charcoal-300">Cargando…</p>}
      {error && <ErrorBanner message={error} />}

      {!loading && tab === 'agenda' && <OppList items={agenda} today={today} nameOf={nameOf} showOwner={viewAll} onOpen={setOpenId} empty="Nada pendiente para hoy. Las oportunidades aparecen aquí el día de su próxima acción o cuando vuelven de una postergación." />}
      {!loading && tab === 'abiertas' && <OppList items={open} today={today} nameOf={nameOf} showOwner={viewAll} onOpen={setOpenId} empty="Sin oportunidades abiertas." />}
      {!loading && tab === 'cerradas' && <OppList items={closed} today={today} nameOf={nameOf} showOwner={viewAll} onOpen={setOpenId} empty="Todavía no hay oportunidades ganadas ni perdidas." />}
      {!loading && tab === 'sinAsignar' && <OppList items={unassigned} today={today} nameOf={nameOf} showOwner onOpen={setOpenId} empty="Todas las oportunidades tienen ejecutivo." />}
      {!loading && tab === 'equipo' && <TeamView opportunities={opportunities} today={today} nameOf={nameOf} onPick={(u) => { setOwner(u || 'todos'); setTab('abiertas'); }} />}
      {tab === 'informe' && manageAll && <CandidatesView uid={uid} executives={executives} />}

      {selected && <OpportunityDetail o={selected} uid={uid} canManage={manageAll || (canCreate && selected.ownerUid === uid)} manageAll={manageAll} executives={executives} nameOf={nameOf} onClose={() => setOpenId(null)} />}
      {dictating && (
        <VoiceOpportunity
          executives={(manageAll ? executives : executives.filter((u) => u.uid === uid)).map((u) => u.displayName)}
          products={catalog.filter((p) => p.active && !p.discontinued).map((p) => p.name)}
          onClose={() => setDictating(false)}
          onRead={(d) => { setDictating(false); setDictated(d); setCreating(true); }}
        />
      )}
      {creating && <NewOpportunityDialog uid={uid} manageAll={manageAll} executives={executives} dictated={dictated} onClose={() => { setCreating(false); setDictated(null); }} onCreated={(id) => { setCreating(false); setDictated(null); setOpenId(id); }} />}
    </div>
  );
}

// ---------- Listas ----------

function OppList({ items, today, nameOf, showOwner, onOpen, empty }: { items: Opportunity[]; today: string; nameOf: (u?: string) => string; showOwner: boolean; onOpen: (id: string) => void; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-charcoal-300">{empty}</p>;
  return (
    <ul className="card divide-y divide-charcoal-100">
      {items.map((o) => {
        const due = dueDate(o);
        const late = isOverdue(o, today);
        return (
          <li key={o.id}>
            <button onClick={() => onOpen(o.id)} className={'w-full text-left p-3 flex items-start justify-between gap-3 hover:bg-cream-100/60 ' + (late ? 'border-l-4 border-red-500' : '')}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-charcoal-900 truncate">{o.clientSnapshot.fantasyName ?? o.clientSnapshot.name}</p>
                <p className="text-xs text-charcoal-500 truncate">{o.title}</p>
                <p className="text-[11px] text-charcoal-300 mt-0.5">
                  {ORIGIN_LABEL[o.origin]}{showOwner ? ` · ${o.ownerUid ? nameOf(o.ownerUid) : 'sin asignar'}` : ''}{o.orderIds.length ? ` · ${o.orderIds.length} pedido${o.orderIds.length === 1 ? '' : 's'}` : ''}
                </p>
              </div>
              <div className="text-right shrink-0 space-y-1">
                <Pill tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Pill>
                {due && <p className={'text-[11px] ' + (late ? 'text-red-700 font-semibold' : 'text-charcoal-500')}>{o.status === 'postergada' ? 'Retomar' : o.nextAction ? NEXT_ACTION_LABEL[o.nextAction.type] : ''} {due === today ? 'hoy' : formatDateShort(due)}</p>}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TeamView({ opportunities, today, nameOf, onPick }: { opportunities: Opportunity[]; today: string; nameOf: (u?: string) => string; onPick: (uid: string) => void }) {
  const since = useMemo(() => Date.now() - 90 * 86_400_000, []);
  const rows = useMemo(() => teamSummary(opportunities, today, since), [opportunities, today, since]);
  if (rows.length === 0) return <p className="text-sm text-charcoal-300">Todavía no hay oportunidades.</p>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-display text-charcoal-300">
            <th className="p-3">Ejecutivo</th><th className="p-3 text-right">Abiertas</th><th className="p-3 text-right">Vencidas</th><th className="p-3 text-right">Postergadas</th>
            <th className="p-3 text-right">Ganadas</th><th className="p-3 text-right">Perdidas</th><th className="p-3 text-right">Conversión</th><th className="p-3 text-right">Muestras</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-charcoal-100">
          {rows.map((r) => (
            <tr key={r.uid} onClick={() => onPick(r.uid)} className="cursor-pointer hover:bg-cream-100/60">
              <td className="p-3 font-semibold text-charcoal-900">{r.uid ? nameOf(r.uid) : 'Sin asignar'}</td>
              <td className="p-3 text-right">{r.open}</td>
              <td className={'p-3 text-right ' + (r.overdue ? 'text-red-700 font-semibold' : '')}>{r.overdue}</td>
              <td className="p-3 text-right">{r.postponed}</td>
              <td className="p-3 text-right">{r.won}</td>
              <td className="p-3 text-right">{r.lost}</td>
              <td className="p-3 text-right">{r.conversion == null ? '—' : `${Math.round(r.conversion * 100)} %`}</td>
              <td className="p-3 text-right">{r.samples}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-charcoal-300 p-3 border-t border-charcoal-100">Ganadas, perdidas, conversión y muestras: últimos 90 días. Toque un ejecutivo para ver sus abiertas.</p>
    </div>
  );
}

// ---------- Ficha ----------

function OpportunityDetail({ o, uid, canManage, manageAll, executives, nameOf, onClose }: {
  o: Opportunity; uid: string; canManage: boolean; manageAll: boolean; executives: AppUser[]; nameOf: (u?: string) => string; onClose: () => void;
}) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<null | 'actividad' | 'proxima' | 'postergar' | 'perder' | 'reabrir'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayInSantiago();
  const open = isOpen(o);
  const canOrder = canManage && open && !!o.ownerUid && (o.ownerUid === uid || manageAll);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); setMode(null); } catch (e) { setError(describeFirestoreError(e)); } finally { setBusy(false); }
  }

  return (
    <ModalShell title={o.clientSnapshot.fantasyName ?? o.clientSnapshot.name} eyebrow={`Oportunidad · ${ORIGIN_LABEL[o.origin]}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Pill>
          <span className="text-xs text-charcoal-500">{o.ownerUid ? nameOf(o.ownerUid) : 'Sin asignar'}</span>
          <Link to={`/clientes/${o.clientId}`} className="text-xs underline text-charcoal-500">Ficha del cliente</Link>
        </div>
        <div>
          <p className="font-semibold text-charcoal-900">{o.title}</p>
          {o.productsOfInterest.length > 0 && <p className="text-xs text-charcoal-500 mt-1">Productos: {o.productsOfInterest.join(' · ')}</p>}
          {o.notes && <p className="text-sm text-charcoal-700 mt-2 whitespace-pre-line">{o.notes}</p>}
        </div>

        {open && (
          <div className="rounded-md border border-charcoal-100 p-3 text-sm">
            {o.status === 'postergada'
              ? <p>Postergada: retomar el <strong>{o.postponedUntil ? formatDateShort(o.postponedUntil) : '—'}</strong></p>
              : o.nextAction
                ? <p className={isOverdue(o, today) ? 'text-red-700' : ''}>Próxima acción: <strong>{NEXT_ACTION_LABEL[o.nextAction.type]}</strong> el {formatDateShort(o.nextAction.date)}{o.nextAction.note ? ` · ${o.nextAction.note}` : ''}</p>
                : <p className="text-charcoal-500">Sin próxima acción.</p>}
          </div>
        )}
        {o.status === 'perdida' && <p className="text-sm text-red-700">Perdida: {o.lostReason ? LOST_REASON_LABEL[o.lostReason] : ''}{o.lostNote ? ` · ${o.lostNote}` : ''}</p>}

        {canManage && mode === null && (
          <div className="flex flex-wrap gap-2">
            {open && <Button size="sm" onClick={() => setMode('actividad')}>Registrar visita o llamada</Button>}
            {canOrder && <Button size="sm" variant="secondary" onClick={() => navigate(`/vendedor/nuevo?oportunidad=${o.id}`)}>Muestras o pedido</Button>}
            {open && <Button size="sm" variant="secondary" onClick={() => setMode('proxima')}>Próxima acción</Button>}
            {open && <Button size="sm" variant="ghost" onClick={() => setMode('postergar')}>Postergar</Button>}
            {open && <Button size="sm" variant="ghost" onClick={() => setMode('perder')}>Perdida</Button>}
            {!open && o.status !== 'ganada' && <Button size="sm" variant="secondary" onClick={() => setMode('reabrir')}>Reabrir</Button>}
          </div>
        )}
        {!canManage && open && <p className="text-xs text-charcoal-300">Solo lectura.</p>}

        {mode === 'actividad' && <ActivityForm busy={busy} onCancel={() => setMode(null)} onSave={(type, note, next) => run(() => logActivity(o, uid, type, note, next))} />}
        {mode === 'proxima' && <NextActionForm busy={busy} initial={o.nextAction} onCancel={() => setMode(null)} onSave={(n) => run(() => setNextAction(o, uid, n))} />}
        {mode === 'reabrir' && <NextActionForm busy={busy} title="Reabrir con una próxima acción" onCancel={() => setMode(null)} onSave={(n) => run(() => reopen(o, uid, n))} />}
        {mode === 'postergar' && <PostponeForm busy={busy} onCancel={() => setMode(null)} onSave={(until, note) => run(() => postpone(o, uid, until, note))} />}
        {mode === 'perder' && <LostForm busy={busy} onCancel={() => setMode(null)} onSave={(r, note) => run(() => markLost(o, uid, r, note))} />}
        {error && <ErrorBanner message={error} />}

        {manageAll && open && (
          <label className="block">
            <span className="eyebrow block mb-1">Ejecutivo</span>
            <select value={o.ownerUid ?? ''} disabled={busy} onChange={(e) => { const u = executives.find((x) => x.uid === e.target.value); if (u) void run(() => reassign(o, uid, u.uid, u.displayName)); }} className="field h-9 text-sm w-full sm:max-w-xs">
              {!o.ownerUid && <option value="">Sin asignar</option>}
              {executives.map((u) => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
            </select>
          </label>
        )}

        {o.orderIds.length > 0 && (
          <div>
            <p className="eyebrow mb-1">Pedidos</p>
            <div className="flex flex-wrap gap-2">{o.orderIds.map((id) => <Link key={id} to={`/vendedor/mis/${id}`} className="font-mono text-xs underline">{id}{o.wonOrderId === id ? ' · ganó' : ''}</Link>)}</div>
          </div>
        )}

        <div>
          <p className="eyebrow mb-1">Historial</p>
          <ul className="space-y-1.5">
            {[...o.activity].sort((a, b) => b.at - a.at).map((a, i) => (
              <li key={i} className="text-xs text-charcoal-700">
                <span className="text-charcoal-300">{new Date(a.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</span>{' '}
                <span className="font-semibold">{ACTIVITY_LABEL[a.type]}</span>{a.by !== 'sistema' ? ` · ${nameOf(a.by)}` : ''}{a.orderId ? ` · ${a.orderId}` : ''}{a.note ? ` · ${a.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </ModalShell>
  );
}

function ActivityForm({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (type: 'visita' | 'llamada' | 'nota', note: string, next: { type: NextActionType; date: string } | null) => void }) {
  const [type, setType] = useState<'visita' | 'llamada' | 'nota'>('visita');
  const [note, setNote] = useState('');
  const [nextType, setNextType] = useState<NextActionType>('llamada');
  const [nextDate, setNextDate] = useState(addDaysIso(todayInSantiago(), 7));
  return (
    <div className="rounded-md border border-charcoal-100 p-3 space-y-2">
      <div className="flex gap-1.5">{(['visita', 'llamada', 'nota'] as const).map((t) => <Chip key={t} active={type === t} onClick={() => setType(t)}>{ACTIVITY_LABEL[t]}</Chip>)}</div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Qué pasó? ¿Qué dijo el cliente?" className="field text-sm w-full min-h-20 py-2" />
      <NextFields type={nextType} date={nextDate} onType={setNextType} onDate={setNextDate} label="Siguiente paso" />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !note.trim() || !nextDate} onClick={() => onSave(type, note, { type: nextType, date: nextDate })}>{busy ? '…' : 'Guardar'}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

function NextActionForm({ busy, initial, title = 'Próxima acción', onCancel, onSave }: { busy: boolean; initial?: { type: NextActionType; date: string; note?: string }; title?: string; onCancel: () => void; onSave: (n: { type: NextActionType; date: string; note?: string }) => void }) {
  const [type, setType] = useState<NextActionType>(initial?.type ?? 'visita');
  const [date, setDate] = useState(initial?.date ?? addDaysIso(todayInSantiago(), 1));
  const [note, setNote] = useState(initial?.note ?? '');
  return (
    <div className="rounded-md border border-charcoal-100 p-3 space-y-2">
      <NextFields type={type} date={date} onType={setType} onDate={setDate} label={title} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" className="field h-9 text-sm w-full" />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !date} onClick={() => onSave({ type, date, ...(note.trim() ? { note: note.trim() } : {}) })}>{busy ? '…' : 'Guardar'}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

function NextFields({ type, date, onType, onDate, label }: { type: NextActionType; date: string; onType: (t: NextActionType) => void; onDate: (d: string) => void; label: string }) {
  return (
    <div>
      <p className="eyebrow mb-1">{label}</p>
      <div className="flex flex-wrap gap-2">
        <select value={type} onChange={(e) => onType(e.target.value as NextActionType)} className="field h-9 text-sm">
          {(Object.keys(NEXT_ACTION_LABEL) as NextActionType[]).map((t) => <option key={t} value={t}>{NEXT_ACTION_LABEL[t]}</option>)}
        </select>
        <input type="date" value={date} min={todayInSantiago()} onChange={(e) => onDate(e.target.value)} className="field h-9 text-sm" />
      </div>
    </div>
  );
}

function PostponeForm({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (until: string, note: string) => void }) {
  const tomorrow = addDaysIso(todayInSantiago(), 1);
  const [until, setUntil] = useState(addDaysIso(todayInSantiago(), 30));
  const [note, setNote] = useState('');
  return (
    <div className="rounded-md border border-charcoal-100 p-3 space-y-2">
      <p className="eyebrow">Postergar hasta</p>
      <input type="date" value={until} min={tomorrow} onChange={(e) => setUntil(e.target.value)} className="field h-9 text-sm" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo (opcional)" className="field h-9 text-sm w-full" />
      <p className="text-[11px] text-charcoal-300">Ese día vuelve a su agenda.</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !until || until < tomorrow} onClick={() => onSave(until, note)}>{busy ? '…' : 'Postergar'}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

function LostForm({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (r: LostReason, note: string) => void }) {
  const [reason, setReason] = useState<LostReason | ''>('');
  const [note, setNote] = useState('');
  return (
    <div className="rounded-md border border-charcoal-100 p-3 space-y-2">
      <p className="eyebrow">Motivo</p>
      <select value={reason} onChange={(e) => setReason(e.target.value as LostReason)} className="field h-9 text-sm w-full sm:max-w-xs">
        <option value="">Elija un motivo</option>
        {LOST_REASONS.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Detalle (opcional)" className="field h-9 text-sm w-full" />
      <div className="flex gap-2">
        <Button size="sm" variant="danger" disabled={busy || !reason} onClick={() => reason && onSave(reason, note)}>{busy ? '…' : 'Marcar perdida'}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

// ---------- Nueva oportunidad ----------

function NewOpportunityDialog({ uid, manageAll, executives, dictated, onClose, onCreated }: { uid: string; manageAll: boolean; executives: AppUser[]; dictated?: DictatedOpportunity | null; onClose: () => void; onCreated: (id: string) => void }) {
  const { clients } = useClients();
  // Dictado (Fase 5): todo viene prellenado y se confirma aquí.
  const dictOwner = dictated && manageAll ? matchExecutive(dictated.ownerName, executives) : null;
  const [q, setQ] = useState(dictated?.clientName ?? '');
  const [client, setClient] = useState<Client | null>(null);
  const [newClient, setNewClient] = useState(false);
  const [title, setTitle] = useState(dictated?.title ?? '');
  const [products, setProducts] = useState(dictated?.products.join(', ') ?? '');
  const [notes, setNotes] = useState(dictated?.notes ?? '');
  const [owner, setOwner] = useState<string>(manageAll ? dictOwner ?? '' : uid);
  const [nextType, setNextType] = useState<NextActionType>(dictated?.actionType ?? 'visita');
  const [nextDate, setNextDate] = useState(dictated?.date && dictated.date >= todayInSantiago() ? dictated.date : addDaysIso(todayInSantiago(), 2));
  const dictClients = useMemo(() => (dictated ? matchClients(dictated.clientName, dictated.clientRut, clients.filter((c) => !c.isInternalShop)) : []), [dictated, clients]);
  const review = dictated ? [
    !client && 'cliente',
    manageAll && !owner && (dictated.ownerName ? `ejecutivo («${dictated.ownerName}» no calza)` : 'ejecutivo'),
    !dictated.date && 'fecha',
  ].filter(Boolean) as string[] : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const results = useMemo(() => (q.trim() ? searchClients(clients.filter((c) => !c.isInternalShop), q).slice(0, 8) : []), [clients, q]);

  async function save() {
    if (!client) return;
    setBusy(true); setError(null);
    try {
      const id = await createOpportunity({
        client, title: title.trim() || 'Visita comercial',
        ownerUid: owner || null,
        origin: owner === uid ? 'propia' : 'asignada',
        productsOfInterest: products.split(/[,\n]/).map((p) => p.trim()).filter(Boolean),
        notes, nextAction: { type: nextType, date: nextDate },
      }, uid);
      onCreated(id);
    } catch (e) { setError(describeFirestoreError(e)); setBusy(false); }
  }

  return (
    <ModalShell title={dictated ? 'Confirmar oportunidad dictada' : 'Nueva oportunidad'} eyebrow="Oportunidades" onClose={onClose}>
      <div className="space-y-3">
        {dictated && (
          <div className="card p-3 bg-cream-100/60">
            <p className="eyebrow mb-1">Lo que se dictó</p>
            <p className="text-xs text-charcoal-700 italic">«{dictated.transcript}»</p>
            {review.length > 0 && <p className="text-xs text-brass-700 mt-1.5">Revise: {review.join(', ')}.</p>}
          </div>
        )}
        {!client && dictClients.length > 0 && (
          <div>
            <p className="eyebrow mb-1">¿Es alguno de estos clientes?</p>
            <ul className="card divide-y divide-charcoal-100">
              {dictClients.map((c) => <li key={c.id}><button className="w-full text-left p-2.5 text-sm hover:bg-cream-100/60" onClick={() => setClient(c)}>{c.fantasyName ?? c.name}{clientAltName(c) ? <span className="text-[11px] text-charcoal-500"> · {clientAltName(c)}</span> : null} <span className="text-[11px] text-charcoal-300">{c.rut ?? ''}</span></button></li>)}
            </ul>
          </div>
        )}
        {client ? (
          <div className="card p-3 flex items-center justify-between gap-2">
            <div className="min-w-0"><p className="text-sm font-semibold truncate">{client.fantasyName ?? client.name}</p><p className="text-[11px] text-charcoal-300">{client.rut ?? 'Sin RUT'}</p></div>
            <button className="text-xs underline" onClick={() => setClient(null)}>Cambiar</button>
          </div>
        ) : (
          <div>
            <label className="eyebrow block mb-1">Cliente</label>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, razón social o RUT" className="field h-10 text-sm w-full" />
            {results.length > 0 && (
              <ul className="card divide-y divide-charcoal-100 mt-1">
                {results.map((c) => <li key={c.id}><button className="w-full text-left p-2.5 text-sm hover:bg-cream-100/60" onClick={() => setClient(c)}>{c.fantasyName ?? c.name}{clientAltName(c) ? <span className="text-[11px] text-charcoal-500"> · {clientAltName(c)}</span> : null} <span className="text-[11px] text-charcoal-300">{c.rut ?? ''}</span></button></li>)}
              </ul>
            )}
            <button className="text-xs underline mt-1.5" onClick={() => setNewClient(true)}>+ Cliente nuevo (prospecto)</button>
          </div>
        )}
        <div>
          <label className="eyebrow block mb-1">Qué se busca</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Ofrecer prosciutto y guanciale para la carta" className="field h-10 text-sm w-full" />
        </div>
        <div>
          <label className="eyebrow block mb-1">Productos de interés</label>
          <input value={products} onChange={(e) => setProducts(e.target.value)} placeholder="Separados por coma" className="field h-10 text-sm w-full" />
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas (opcional)" className="field text-sm w-full min-h-16 py-2" />
        {manageAll && (
          <div>
            <label className="eyebrow block mb-1">Ejecutivo</label>
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className="field h-10 text-sm w-full">
              <option value="">Sin asignar (bandeja)</option>
              {executives.map((u) => <option key={u.uid} value={u.uid}>{u.displayName}{u.uid === uid ? ' (yo)' : ''}</option>)}
            </select>
          </div>
        )}
        <NextFields type={nextType} date={nextDate} onType={setNextType} onDate={setNextDate} label="Fecha y primera acción *" />
        {error && <ErrorBanner message={error} />}
        <Button className="w-full" disabled={busy || !client || !nextDate} onClick={save}>{busy ? 'Guardando…' : 'Crear oportunidad'}</Button>
      </div>
      {newClient && <NuevoClienteDialog uid={uid} initial={{ fantasyName: q }} onClose={() => setNewClient(false)} onCreated={(c) => { setClient(c); setNewClient(false); }} />}
    </ModalShell>
  );
}

// ---------- Informe de oportunidades ----------

function CandidatesView({ uid, executives }: { uid: string; executives: AppUser[] }) {
  const { candidates, loading } = useCandidates(true);
  const { clients } = useClients();
  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const byRut = useMemo(() => new Map(clients.filter((c) => c.rut).map((c) => [normRut(c.rut!), c])), [clients]);
  const [show, setShow] = useState<'pendiente' | 'todas'>('pendiente');
  const [picked, setPicked] = useState<Record<string, string>>({}); // candidateId → ownerUid
  const [visitBy, setVisitBy] = useState(addDaysIso(todayInSantiago(), 7));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientFor = (c: OpportunityCandidate) => (c.clientId ? byId.get(c.clientId) : undefined) ?? byRut.get(normRut(c.rut));
  const defaultOwner = (c: OpportunityCandidate) => {
    const first = (c.vendedorActual ?? '').split(' ')[0]?.toLowerCase();
    return (first && executives.find((u) => u.displayName.toLowerCase().startsWith(first))?.uid) || '';
  };
  const list = candidates.filter((c) => show === 'todas' || c.status === 'pendiente');
  const n = Object.keys(picked).length;

  async function load() {
    setBusy(true); setError(null); setMsg(null);
    try {
      const picks = Object.entries(picked).map(([id, owner]) => {
        const candidate = candidates.find((c) => c.id === id)!;
        return { candidate, client: clientFor(candidate)!, ownerUid: owner || null };
      });
      await loadCandidates(picks, visitBy, uid);
      setPicked({}); setMsg(`${picks.length} oportunidad${picks.length === 1 ? '' : 'es'} cargada${picks.length === 1 ? '' : 's'}.`);
    } catch (e) { setError(describeFirestoreError(e)); } finally { setBusy(false); }
  }

  if (loading) return <p className="text-sm text-charcoal-300">Cargando…</p>;
  if (candidates.length === 0) return <p className="text-sm text-charcoal-300">El informe todavía no está cargado. Edmundo lo sube con <code>scripts/import-oportunidades.ts</code>.</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-charcoal-500">Elija qué clientes del informe pasan a ser oportunidades y a qué ejecutivo. Se crean con una visita como primera acción.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Chip active={show === 'pendiente'} onClick={() => setShow('pendiente')}>Por revisar</Chip>
        <Chip active={show === 'todas'} onClick={() => setShow('todas')}>Todas</Chip>
        <label className="ml-auto text-xs text-charcoal-500">Visitar antes del <input type="date" value={visitBy} min={todayInSantiago()} onChange={(e) => setVisitBy(e.target.value)} className="field h-9 text-sm ml-1" /></label>
        <Button size="sm" disabled={busy || n === 0 || !visitBy} onClick={load}>{busy ? 'Cargando…' : `Cargar ${n} seleccionada${n === 1 ? '' : 's'}`}</Button>
      </div>
      {msg && <p className="text-sm text-emerald-800">{msg}</p>}
      {error && <ErrorBanner message={error} />}
      <ul className="card divide-y divide-charcoal-100">
        {list.map((c) => {
          const client = clientFor(c);
          const isPicked = c.id in picked;
          const pending = c.status === 'pendiente';
          return (
            <li key={c.id} className="p-3 flex items-start gap-3">
              <input type="checkbox" className="mt-1" disabled={!pending || !client} checked={isPicked}
                onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[c.id] = defaultOwner(c); else delete n[c.id]; return n; })} />
              <div className="min-w-0 flex-1">
                <p className="text-sm"><span className="text-charcoal-300">#{c.rank}</span> <span className="font-semibold text-charcoal-900">{c.fantasyName || c.razonSocial}</span> <span className="text-[11px] text-charcoal-300">{c.comuna ?? ''}{c.ventas12mCLP ? ` · ${formatCLP(c.ventas12mCLP)} en 12 meses` : ''}</span></p>
                <p className="text-xs text-charcoal-500">{c.productosSugeridos.slice(0, 5).join(' · ')}</p>
                {c.propuesta && <details className="text-xs text-charcoal-700 mt-1"><summary className="cursor-pointer text-charcoal-500">Propuesta</summary><p className="mt-1 whitespace-pre-line">{c.propuesta}</p></details>}
                {!client && <p className="text-[11px] text-red-700 mt-1">No está en Clientes (RUT {c.rut}).</p>}
                {c.status !== 'pendiente' && <p className="text-[11px] text-charcoal-300 mt-1">{c.status === 'cargada' ? 'Cargada' : 'Descartada'}</p>}
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1">
                {isPicked && (
                  <select value={picked[c.id]} onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.value }))} className="field h-8 text-xs">
                    <option value="">Sin asignar</option>
                    {executives.map((u) => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
                  </select>
                )}
                {pending && !isPicked && <button className="text-[11px] underline text-charcoal-300" onClick={() => void dismissCandidate(c.id, uid)}>Descartar</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const normRut = (r: string) => r.replace(/[^0-9kK]/g, '').toUpperCase();

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={'shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px] uppercase tracking-display font-medium border transition ' + (active ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500 hover:border-charcoal-300')}>
      {children}
    </button>
  );
}
