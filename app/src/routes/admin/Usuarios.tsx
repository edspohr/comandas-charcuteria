import { resetUserPin } from '@/data/pin';
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '@/data/firebase';
import { useCurrentUser } from '@/data/auth';
import { useClients } from '@/data/clients';
import { useUsers } from '@/data/users';
import { callableMessage, deleteInvite, inviteUser, resendPasswordEmail, updateUser, useInvites } from '@/data/userAdmin';
import DataTable, { Pill } from '@/components/ui/DataTable';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { ModalShell } from '@/components/orders/OrderDialogs';
import { ROLES, ROLE_DESCRIPTION, ROLE_LABEL, can, isSeller } from '@/domain/permissions';
import { addDaysIso, formatDateShort, todayInSantiago } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';
import type { AppUser, Order, Role } from '@/domain/types';

const ROLE_ORDER: Role[] = ['superAdmin', 'admin', 'consultor', 'produccion', 'despacho', 'reparto', 'tienda', 'vendedor'];
const ROLE_TONE: Record<Role, 'ok' | 'warn' | 'bad' | 'muted' | 'info'> = {
  superAdmin: 'bad', admin: 'warn', consultor: 'muted', produccion: 'info', despacho: 'info', reparto: 'info', tienda: 'ok', vendedor: 'ok',
};

interface UserRow extends AppUser {
  cartera: number;
  creados30: number;
  ventas30: number;
  armados30: number;
  lastActivity: string | null;
  anulados30: number;
}

export default function Usuarios() {
  const { current } = useCurrentUser();
  const me = current!.appUser;
  const manage = can(me.role, 'users.manage');
  const { users, loading } = useUsers();
  const invites = useInvites();
  const [orders, setOrders] = useState<Order[]>([]);
  const { clients } = useClients();
  const [adding, setAdding] = useState<false | { displayName?: string; role?: Role; legacyUid?: string }>(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // People from the WhatsApp history without an account stay out of the way
  // until someone has to invite them with their history.
  const [showPlaceholders, setShowPlaceholders] = useState(false);
  const placeholderCount = users.filter((u) => u.placeholder && !u.mergedInto).length;

  useEffect(() => onSnapshot(collection(db, 'orders'), (snap) => { const l: Order[] = []; snap.forEach((d) => l.push(d.data() as Order)); setOrders(l); }), []);

  const rows = useMemo<UserRow[]>(() => {
    const since = addDaysIso(todayInSantiago(), -30);
    return users.filter((u) => !u.mergedInto && (showPlaceholders || !u.placeholder)).map((u) => {
      const created = orders.filter((o) => o.createdBy === u.uid);
      const packed = orders.filter((o) => o.assignedPackerId === u.uid && o.statusHistory.some((h) => h.status === 'armado' && h.by === u.uid));
      const touched = orders.filter((o) => o.statusHistory.some((h) => h.by === u.uid));
      const lastAt = touched.reduce((m, o) => Math.max(m, ...o.statusHistory.filter((h) => h.by === u.uid && Number.isFinite(h.at)).map((h) => h.at)), 0);
      const c30 = created.filter((o) => o.requestedDate >= since && o.status !== 'anulado');
      return {
        ...u,
        cartera: clients.filter((c) => c.ownerUid === u.uid).length,
        creados30: c30.length,
        ventas30: c30.filter((o) => ['facturado', 'despachado', 'entregado'].includes(o.status)).reduce((s, o) => s + (o.totalCLP ?? 0), 0),
        armados30: packed.filter((o) => o.requestedDate >= since).length,
        anulados30: created.filter((o) => o.requestedDate >= since && o.status === 'anulado').length,
        lastActivity: lastAt ? new Date(lastAt).toISOString().slice(0, 10) : null,
      };
    }).sort((a, b) => Number(a.active === false) - Number(b.active === false) || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.displayName.localeCompare(b.displayName, 'es'));
  }, [users, orders, clients, showPlaceholders]);

  const byRole = useMemo(() => ROLE_ORDER.map((r) => [r, users.filter((u) => u.role === r && u.active !== false).length] as const), [users]);

  async function act(fn: () => Promise<string | void>) {
    setError(null); setFlash(null);
    try { const m = await fn(); if (m) setFlash(m); } catch (e) { setError(callableMessage(e)); }
  }

  return (
    <div>
      <header className="mb-4 flex items-end justify-between gap-3 flex-wrap">
        <div>
          {!manage && <p className="eyebrow">Consulta · solo lectura</p>}
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Usuarios</h1>
          <p className="text-xs text-charcoal-300 mt-1">
            {users.filter((u) => u.active !== false && !u.placeholder).length} con cuenta{users.some((u) => u.placeholder && !u.mergedInto) ? ` · ${users.filter((u) => u.placeholder && !u.mergedInto).length} sin cuenta (historial WhatsApp)` : ''} · {byRole.filter(([, n]) => n > 0).map(([r, n]) => `${ROLE_LABEL[r]} ${n}`).join(' · ')}
          </p>
        </div>
        {manage && <Button size="sm" onClick={() => setAdding({})}>+ Agregar persona</Button>}
      </header>

      {flash && <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm mb-3">{flash}</div>}
      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}
      {loading && <p className="text-sm text-charcoal-300">Cargando…</p>}

      {invites.length > 0 && (
        <section className="mb-4">
          <p className="eyebrow mb-2">Invitaciones pendientes</p>
          <div className="card divide-y divide-charcoal-100/70">
            {invites.map((inv) => (
              <div key={inv.email} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold text-charcoal-900">{inv.displayName} <Pill tone={ROLE_TONE[inv.role]}>{ROLE_LABEL[inv.role]}</Pill></p>
                  <p className="text-[11px] text-charcoal-300 truncate">{inv.email} · aún no entra · {formatDateShort(new Date(inv.createdAt).toISOString().slice(0, 10))}</p>
                </div>
                {manage && <Button size="sm" variant="ghost" onClick={() => act(async () => { await deleteInvite(inv.email); return 'Invitación eliminada.'; })}>Quitar</Button>}
              </div>
            ))}
          </div>
        </section>
      )}

      {placeholderCount > 0 && (
        <div className="mb-2 flex justify-end">
          <button onClick={() => setShowPlaceholders((v) => !v)} className="text-[11px] uppercase tracking-display text-charcoal-500 hover:text-charcoal-900 underline">
            {showPlaceholders ? 'Ocultar' : 'Mostrar'} personas del historial sin cuenta ({placeholderCount})
          </button>
        </div>
      )}

      <DataTable<UserRow>
        rows={rows}
        rowKey={(r) => r.uid}
        rowTone={(r) => (r.active === false ? 'bad' : undefined)}
        emptyText="Todavía no hay usuarios. Agregue a la primera persona."
        columns={[
          { key: 'name', label: 'Usuario', mobile: true, render: (r) => <div><p className="font-semibold text-charcoal-900">{r.displayName}{r.active === false && <span className="ml-2 text-[10px] uppercase text-red-700">desactivado</span>}{r.placeholder && <span className="ml-2 text-[10px] uppercase text-brass-700">sin cuenta</span>}{!r.placeholder && r.pinDisabled && <span className="ml-2 text-[10px] uppercase text-red-700">PIN desactivado</span>}{!r.placeholder && !r.hasPin && !r.pinDisabled && <span className="ml-2 text-[10px] uppercase text-charcoal-300">sin PIN</span>}</p><p className="text-[11px] text-charcoal-300 truncate">{r.placeholder ? 'Aparece en el historial de WhatsApp' : r.email}</p><span className="md:hidden mt-1 inline-block"><Pill tone={ROLE_TONE[r.role]}>{ROLE_LABEL[r.role]}</Pill></span></div> },
          { key: 'role', label: 'Perfil', render: (r) => <Pill tone={ROLE_TONE[r.role]}>{ROLE_LABEL[r.role]}</Pill> },
          { key: 'cartera', label: 'Cartera', align: 'right', render: (r) => isSeller(r.role) ? r.cartera : '—', muted: true },
          { key: 'creados', label: 'Pedidos 30 d', align: 'right', render: (r) => r.creados30 || '—' },
          { key: 'ventas', label: 'Ventas 30 d', align: 'right', mobile: true, render: (r) => r.ventas30 ? <span className="font-semibold">{formatCLP(r.ventas30)}</span> : '—' },
          { key: 'armados', label: 'Armados 30 d', align: 'right', render: (r) => r.armados30 || '—' },
          { key: 'anulados', label: 'Anulados', align: 'right', render: (r) => r.anulados30 ? <span className="text-red-700">{r.anulados30}</span> : '—', muted: true },
          { key: 'last', label: 'Última actividad', align: 'right', render: (r) => r.lastActivity ? <span className="first-letter:uppercase whitespace-nowrap">{formatDateShort(r.lastActivity)}</span> : '—', muted: true },
        ]}
        expand={(r) => (
          <div className="text-xs text-charcoal-500 flex flex-wrap items-center gap-x-6 gap-y-2">
            <span>{ROLE_DESCRIPTION[r.role]}</span>
            {isSeller(r.role) && <Link to={`/tablero?vendedor=${r.uid}`} className="underline hover:text-charcoal-900">Ver sus pedidos →</Link>}
            {manage && r.placeholder && (
              <Button size="sm" onClick={(e) => { e.stopPropagation(); setAdding({ displayName: r.displayName, role: r.role, legacyUid: r.uid }); }}>Invitar con su historial</Button>
            )}
            {manage && !r.placeholder && (
              <span className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setEditing(r); }}>Editar</Button>
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void act(async () => { await resendPasswordEmail(r.email); return `Se envió a ${r.email} el correo para crear o cambiar su contraseña.`; }); }}>Enviar correo de contraseña</Button>
              </span>
            )}
          </div>
        )}
      />

      <section className="mt-6">
        <p className="eyebrow mb-2">Perfiles</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {ROLES.map((r) => (
            <div key={r} className="card p-3 text-xs">
              <p className="font-semibold text-charcoal-900 mb-0.5">{ROLE_LABEL[r]}</p>
              <p className="text-charcoal-500">{ROLE_DESCRIPTION[r]}</p>
            </div>
          ))}
        </div>
      </section>

      {adding && <AgregarDialog preset={adding} onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); setFlash(m); }} />}
      {editing && <EditarDialog user={editing} isSelf={editing.uid === me.uid} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); setFlash(m); }} />}
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="space-y-1.5">
      {ROLES.map((r) => (
        <label key={r} className={'flex gap-2 items-start rounded-md border p-2 cursor-pointer ' + (value === r ? 'border-charcoal-700 bg-white' : 'border-charcoal-100')}>
          <input type="radio" name="role" checked={value === r} onChange={() => onChange(r)} className="mt-0.5" />
          <span><span className="text-sm font-semibold text-charcoal-900">{ROLE_LABEL[r]}</span><span className="block text-[11px] text-charcoal-500">{ROLE_DESCRIPTION[r]}</span></span>
        </label>
      ))}
    </div>
  );
}

function AgregarDialog({ preset, onClose, onDone }: { preset: { displayName?: string; role?: Role; legacyUid?: string }; onClose: () => void; onDone: (msg: string) => void }) {
  const [displayName, setDisplayName] = useState(preset.displayName ?? '');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(preset.role ?? 'vendedor');
  const [withPassword, setWithPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = displayName.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  async function submit() {
    setBusy(true); setError(null);
    try { onDone(await inviteUser({ email, displayName, role, withPassword, legacyUid: preset.legacyUid })); } catch (e) { setError(callableMessage(e)); setBusy(false); }
  }

  return (
    <ModalShell eyebrow="Usuarios" title={preset.legacyUid ? `Invitar a ${preset.displayName}` : 'Agregar persona'} onClose={onClose} wide>
      <div className="space-y-3">
        {preset.legacyUid && <p className="rounded-md bg-cream-100 p-2.5 text-xs text-charcoal-700">Al entrar por primera vez recibe sus pedidos y su cartera del historial de WhatsApp.</p>}
        <label className="block"><span className="text-xs text-charcoal-500">Nombre</span><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="field mt-1 w-full" autoFocus /></label>
        <label className="block"><span className="text-xs text-charcoal-500">Correo</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1 w-full" /></label>
        <div>
          <p className="text-xs text-charcoal-500 mb-1">Cómo va a entrar</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setWithPassword(false)} className={'flex-1 rounded-md border p-2 text-xs text-left ' + (!withPassword ? 'border-charcoal-700 bg-white' : 'border-charcoal-100')}><strong className="block text-sm">Con Google</strong>Su correo es Gmail o Google Workspace.</button>
            <button type="button" onClick={() => setWithPassword(true)} className={'flex-1 rounded-md border p-2 text-xs text-left ' + (withPassword ? 'border-charcoal-700 bg-white' : 'border-charcoal-100')}><strong className="block text-sm">Con contraseña</strong>Le llega un correo para crearla.</button>
          </div>
        </div>
        <div><p className="text-xs text-charcoal-500 mb-1">Perfil</p><RoleSelect value={role} onChange={setRole} /></div>
        <p className="text-[11px] text-charcoal-300">En su primer ingreso la persona crea su propio PIN de 4 dígitos y acepta la declaración de responsabilidad. Nadie más lo conoce.</p>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={!valid || busy}>{busy ? 'Guardando…' : 'Agregar'}</Button>
        </div>
      </div>
    </ModalShell>
  );
}

function EditarDialog({ user, isSelf, onClose, onDone }: { user: AppUser; isSelf: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<Role>(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = user.active !== false;

  async function save(patch: { role?: Role; active?: boolean; displayName?: string }, msg: string) {
    setBusy(true); setError(null);
    try { await updateUser(user.uid, patch); onDone(msg); } catch (e) { setError(callableMessage(e)); setBusy(false); }
  }

  return (
    <ModalShell eyebrow={user.email} title={user.displayName} onClose={onClose} wide>
      <div className="space-y-3">
        <label className="block"><span className="text-xs text-charcoal-500">Nombre</span><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="field mt-1 w-full" /></label>
        <div><p className="text-xs text-charcoal-500 mb-1">Perfil</p><RoleSelect value={role} onChange={setRole} /></div>
        <p className="text-[11px] text-charcoal-300">El cambio de perfil se aplica de inmediato en la sesión abierta de la persona.</p>
        <div className="rounded-md border border-charcoal-100 p-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-charcoal-600">
            {user.pinDisabled ? 'PIN desactivado por intentos fallidos.' : user.hasPin ? `PIN creado${user.pinAcceptedAt ? ` · aceptó la responsabilidad el ${new Date(user.pinAcceptedAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}.` : 'Todavía no crea su PIN (lo hace en su primer ingreso).'}
          </p>
          {(user.hasPin || user.pinDisabled) && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
              if (!window.confirm(`¿Borrar el PIN de ${user.displayName}? En su próximo ingreso con Google o contraseña creará uno nuevo.`)) return;
              setBusy(true); setError(null);
              try { await resetUserPin(user.uid); onDone(`PIN de ${user.displayName} borrado: creará uno nuevo al entrar con Google o contraseña.`); } catch (e) { setError(callableMessage(e)); setBusy(false); }
            }}>Borrar PIN</Button>
          )}
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-between gap-2 pt-1 flex-wrap">
          {!isSelf
            ? <Button variant={active ? 'danger' : 'secondary'} disabled={busy} onClick={() => save({ active: !active }, active ? `${user.displayName} ya no puede entrar.` : `${user.displayName} puede entrar de nuevo.`)}>{active ? 'Desactivar' : 'Reactivar'}</Button>
            : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button disabled={busy || (role === user.role && displayName.trim() === user.displayName)} onClick={() => save({ role, displayName: displayName.trim() }, 'Cambios guardados.')}>{busy ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
