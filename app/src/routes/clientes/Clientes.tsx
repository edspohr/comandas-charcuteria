import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/data/firebase';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import NuevoClienteDialog from '@/components/clients/NuevoClienteDialog';
import { useCurrentUser } from '@/data/auth';
import { useClients } from '@/data/clients';
import { demoUsers } from '@/data/demo-users';
import { clientRows, rangeFor, HEALTH_LABEL, DEFAULT_CLIENT_HEALTH, type ClientHealth } from '@/domain/analytics';
import { useSettings } from '@/data/settings';
import { formatDateShort } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';
import type { Order } from '@/domain/types';

const NAME: Record<string, string> = Object.fromEntries(demoUsers.map((u) => [u.uid, u.displayName]));
const HEALTH_STYLE: Record<ClientHealth, string> = {
  nuevo: 'bg-emerald-50 text-emerald-800 border-emerald-200', activo: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  en_riesgo: 'bg-brass-50 text-brass-700 border-brass-300', inactivo: 'bg-red-50 text-red-700 border-red-200', sin_pedidos: 'bg-charcoal-50 text-charcoal-500 border-charcoal-100',
};
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

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'orders'), (snap) => { const l: Order[] = []; snap.forEach((d) => l.push(d.data() as Order)); setOrders(l); });
    return unsub;
  }, []);

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
        const c = clients.find((x) => x.id === r.id);
        const hay = norm(`${r.name} ${c?.name ?? ''} ${c?.rut ?? ''}`);
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, filter, q, uid, clients]);

  return (
    <div>
      <header className="mb-5 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">{role === 'vendedor' ? 'Vendedor' : 'Administración'}</p>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Clientes</h1>
          <p className="text-xs text-charcoal-300 mt-1">Datos desde Bsale · salud según los pedidos de los últimos 90 días</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>+ Nuevo cliente</Button>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, razón social o RUT" className="field h-9 text-sm w-full sm:w-64" />
        <div className="flex flex-wrap gap-1.5">
          <Chip active={filter === 'todos'} onClick={() => setFilter('todos')}>Todos</Chip>
          <Chip active={filter === 'cartera'} onClick={() => setFilter('cartera')}>Mi cartera</Chip>
          <Chip active={filter === 'riesgo'} onClick={() => setFilter('riesgo')}>En riesgo / inactivos{riskCount > 0 && <span className="ml-1 rounded-full bg-brass-100 text-brass-700 px-1.5">{riskCount}</span>}</Chip>
          <Chip active={filter === 'revision'} onClick={() => setFilter('revision')}>Pendientes de revisión{reviewCount > 0 && <span className="ml-1 rounded-full bg-brass-100 text-brass-700 px-1.5">{reviewCount}</span>}</Chip>
        </div>
      </div>

      {loading && !error && <p className="text-sm text-charcoal-300">Cargando…</p>}
      {error && <ErrorBanner message={error} />}
      {!loading && filtered.length === 0 && <div className="card p-8 text-center text-sm text-charcoal-500">Sin clientes con este filtro.</div>}

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((r) => {
          const c = clients.find((x) => x.id === r.id);
          return (
            <li key={r.id}>
              <Link to={`/clientes/${r.id}`} className="block card p-3.5 hover:border-brass-500 hover:shadow-lift transition h-full">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-charcoal-900 truncate">{r.name}</p>
                    <p className="text-xs text-charcoal-300 truncate">{c?.rut ?? 'Sin RUT'}{c?.address ? ` · ${c.address}` : ''}</p>
                  </div>
                  <span className={'shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-display ' + HEALTH_STYLE[r.health]}>{HEALTH_LABEL[r.health]}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-charcoal-500">
                  <span>{r.orders} pedido{r.orders === 1 ? '' : 's'} · {formatCLP(r.revenue)}</span>
                  <span>{r.lastDate ? `último ${formatDateShort(r.lastDate)}` : '—'}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] uppercase tracking-display">
                  <span className="text-charcoal-300">{r.owner !== '—' ? r.owner : 'sin vendedor'}</span>
                  {r.needsReview && <span className="rounded px-1.5 bg-brass-50 text-brass-700 border border-brass-300">Revisar</span>}
                  {!r.invoicingComplete && !r.needsReview && <span className="rounded px-1.5 bg-brass-50 text-brass-700 border border-brass-300">Fact. incompleta</span>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {creating && <NuevoClienteDialog uid={uid} onClose={() => setCreating(false)} onCreated={() => setCreating(false)} />}
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
