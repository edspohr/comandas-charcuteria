import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/data/firebase';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import DataTable, { Pill } from '@/components/ui/DataTable';
import NuevoClienteDialog from '@/components/clients/NuevoClienteDialog';
import EditarClienteDialog from '@/components/clients/EditarClienteDialog';
import { useCurrentUser } from '@/data/auth';
import { useClients } from '@/data/clients';
import { useSettings } from '@/data/settings';
import { demoUsers } from '@/data/demo-users';
import { clientRows, rangeFor, HEALTH_LABEL, DEFAULT_CLIENT_HEALTH, type ClientHealth, type ClientRow } from '@/domain/analytics';
import { formatDateShort } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';
import type { Client, Order } from '@/domain/types';

const NAME: Record<string, string> = Object.fromEntries(demoUsers.map((u) => [u.uid, u.displayName]));
const HEALTH_TONE: Record<ClientHealth, 'ok' | 'warn' | 'bad' | 'muted'> = { nuevo: 'ok', activo: 'ok', en_riesgo: 'warn', inactivo: 'bad', sin_pedidos: 'muted' };
const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');

type Filter = 'todos' | 'cartera' | 'riesgo' | 'revision';

export default function Clientes() {
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const role = current!.appUser.role;
  const { clients, loading, error } = useClients();
  const { settings } = useSettings();
  const [orders, setOrders] = useState<Order[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>(role === 'vendedor' ? 'cartera' : 'todos');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const isAdmin = role === 'admin' || role === 'superAdmin';

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'orders'), (snap) => { const l: Order[] = []; snap.forEach((d) => l.push(d.data() as Order)); setOrders(l); });
    return unsub;
  }, []);

  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const rows = useMemo(() => clientRows(clients, orders, rangeFor('90').current, (u) => NAME[u] ?? u, undefined, settings.clientHealth ?? DEFAULT_CLIENT_HEALTH), [clients, orders, settings.clientHealth]);
  const reviewCount = useMemo(() => rows.filter((r) => r.needsReview || !r.invoicingComplete).length, [rows]);
  const riskCount = useMemo(() => rows.filter((r) => r.health === 'en_riesgo' || r.health === 'inactivo').length, [rows]);

  const filtered = useMemo(() => {
    const needle = norm(q.trim());
    return rows.filter((r) => {
      if (filter === 'cartera' && r.ownerUid !== uid) return false;
      if (filter === 'riesgo' && r.health !== 'en_riesgo' && r.health !== 'inactivo') return false;
      if (filter === 'revision' && !r.needsReview && r.invoicingComplete) return false;
      if (needle) {
        const c = byId.get(r.id);
        if (!norm(`${r.name} ${c?.name ?? ''} ${c?.rut ?? ''} ${c?.address ?? ''}`).includes(needle)) return false;
      }
      return true;
    });
  }, [rows, filter, q, uid, byId]);

  // Habituales por cliente (top 3 por veces), para el detalle inline.
  const habituales = useMemo(() => {
    const m = new Map<string, Map<string, { name: string; times: number }>>();
    for (const o of orders) {
      if (o.status === 'anulado') continue;
      const inner = m.get(o.clientId) ?? new Map();
      for (const l of o.lines) { const t = inner.get(l.productId) ?? { name: l.productName, times: 0 }; t.times++; inner.set(l.productId, t); }
      m.set(o.clientId, inner);
    }
    return (id: string) => [...(m.get(id)?.values() ?? [])].sort((a, b) => b.times - a.times).slice(0, 3);
  }, [orders]);

  return (
    <div>
      <header className="mb-4 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">{role === 'vendedor' ? 'Vendedor' : 'Administración'}</p>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Clientes</h1>
          <p className="text-xs text-charcoal-300 mt-1">{filtered.length} de {rows.length} · datos desde Bsale · salud según pedidos de los últimos 90 días · tocá una fila para ver el detalle</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>+ Nuevo cliente</Button>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, razón social, RUT o dirección" className="field h-9 text-sm w-full sm:w-72" />
        <div className="flex flex-wrap gap-1.5">
          <Chip active={filter === 'todos'} onClick={() => setFilter('todos')}>Todos</Chip>
          <Chip active={filter === 'cartera'} onClick={() => setFilter('cartera')}>Mi cartera</Chip>
          <Chip active={filter === 'riesgo'} onClick={() => setFilter('riesgo')}>En riesgo / inactivos{riskCount > 0 && <span className="ml-1 rounded-full bg-brass-100 text-brass-700 px-1.5">{riskCount}</span>}</Chip>
          <Chip active={filter === 'revision'} onClick={() => setFilter('revision')}>Pendientes de revisión{reviewCount > 0 && <span className="ml-1 rounded-full bg-brass-100 text-brass-700 px-1.5">{reviewCount}</span>}</Chip>
        </div>
      </div>

      {loading && !error && <p className="text-sm text-charcoal-300">Cargando…</p>}
      {error && <ErrorBanner message={error} />}

      <DataTable<ClientRow>
        rows={filtered}
        rowKey={(r) => r.id}
        rowTone={(r) => (r.health === 'inactivo' ? 'bad' : r.health === 'en_riesgo' || r.needsReview ? 'warn' : undefined)}
        emptyText="Sin clientes con este filtro."
        columns={[
          { key: 'name', label: 'Cliente', mobile: true, render: (r) => {
            const c = byId.get(r.id);
            return (
              <div className="min-w-0">
                <Link to={`/clientes/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-charcoal-900 hover:text-brass-700">{r.name}</Link>
                <p className="text-[11px] text-charcoal-300 truncate">{c?.rut ?? 'Sin RUT'}{c?.fantasyName && c.fantasyName !== c.name ? ` · ${c.name}` : ''}</p>
              </div>
            );
          } },
          { key: 'health', label: 'Estado', mobile: true, render: (r) => <span className="flex flex-col gap-1 items-start"><Pill tone={HEALTH_TONE[r.health]}>{HEALTH_LABEL[r.health]}</Pill>{(r.needsReview || !r.invoicingComplete) && <Pill tone="warn">{r.needsReview ? 'Revisar' : 'Fact. incompleta'}</Pill>}</span> },
          { key: 'owner', label: 'Vendedor', render: (r) => r.owner, muted: true },
          { key: 'orders', label: 'Pedidos', align: 'right', render: (r) => r.orders },
          { key: 'revenue', label: 'Ventas 90 d', align: 'right', mobile: true, render: (r) => <span className="font-semibold">{formatCLP(r.revenue)}</span> },
          { key: 'ticket', label: 'Ticket', align: 'right', render: (r) => formatCLP(r.ticket), muted: true },
          { key: 'last', label: 'Último', align: 'right', render: (r) => r.lastDate ? <span className="first-letter:uppercase whitespace-nowrap">{formatDateShort(r.lastDate)}<span className="text-charcoal-300"> · {r.daysSince} d</span></span> : '—' },
          { key: 'freq', label: 'Cada', align: 'right', render: (r) => r.avgIntervalDays != null ? `${Math.round(r.avgIntervalDays)} d` : '—', muted: true },
          { key: 'address', label: 'Dirección', render: (r) => <span className="text-xs">{byId.get(r.id)?.address ?? '—'}</span>, muted: true },
        ]}
        expand={(r) => <ClientDetail client={byId.get(r.id)} row={r} habituales={habituales(r.id)} onEdit={isAdmin ? (c) => setEditing(c) : undefined} />}
      />

      {creating && <NuevoClienteDialog uid={uid} onClose={() => setCreating(false)} onCreated={() => setCreating(false)} />}
      {editing && <EditarClienteDialog client={editing} uid={uid} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ClientDetail({ client, row, habituales, onEdit }: { client: Client | undefined; row: ClientRow; habituales: Array<{ name: string; times: number }>; onEdit?: (c: Client) => void }) {
  if (!client) return null;
  return (
    <div className="grid gap-3 md:grid-cols-3 text-xs">
      <div>
        <p className="eyebrow mb-1">Contacto y entrega</p>
        <p className="text-charcoal-700">{client.address ?? 'Sin dirección'}</p>
        <p className="text-charcoal-500">{client.deliveryMode === 'retiro' ? 'Retiro en tienda' : 'Despacho'}{client.receivingHours ? ` · ${client.receivingHours}` : ''}</p>
        <p className="text-charcoal-500">{[client.contactPhone, client.email].filter(Boolean).join(' · ') || '—'}</p>
        {client.giro && <p className="text-charcoal-500">Giro: {client.giro}</p>}
        {client.notes && <p className="text-charcoal-500 italic mt-1">{client.notes}</p>}
      </div>
      <div>
        <p className="eyebrow mb-1">Habituales</p>
        {habituales.length === 0 ? <p className="text-charcoal-300">Sin pedidos aún.</p> : (
          <ul className="space-y-0.5">{habituales.map((h) => <li key={h.name} className="text-charcoal-700">{h.name} <span className="text-charcoal-300">· {h.times}×</span></li>)}</ul>
        )}
      </div>
      <div className="flex flex-col gap-1.5 md:items-end">
        <p className="text-charcoal-500">{row.orders} pedidos en 90 d · ticket {formatCLP(row.ticket)}</p>
        <div className="flex gap-1.5">
          {onEdit && <button onClick={(e) => { e.stopPropagation(); onEdit(client); }} className="rounded-md border border-charcoal-200 px-2.5 py-1 text-[11px] uppercase tracking-display text-charcoal-700 hover:border-brass-500">Editar</button>}
          <Link to={`/clientes/${client.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex rounded-md border border-charcoal-200 px-2.5 py-1 text-[11px] uppercase tracking-display text-charcoal-700 hover:border-brass-500">Ficha completa →</Link>
        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={'rounded-md px-2.5 py-1.5 text-[11px] uppercase tracking-display font-medium border transition ' + (active ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500 hover:border-charcoal-300')}>
      {children}
    </button>
  );
}
