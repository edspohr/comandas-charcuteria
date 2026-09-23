import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import StatusPill from '@/components/ui/StatusPill';
import EditarClienteDialog from '@/components/clients/EditarClienteDialog';
import { useCurrentUser } from '@/data/auth';
import { useClient, useClientOrders } from '@/data/clients';
import { useProducts } from '@/data/products';
import { demoUsers } from '@/data/demo-users';
import { gramsMap, lineKg } from '@/domain/analytics';
import { saveDraft } from '@/lib/draft';
import { defaultRequestedDate } from '@/domain/cutoff';
import { useSettings } from '@/data/settings';
import { formatDateShort, formatQty, todayInSantiago } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';

const NAME: Record<string, string> = Object.fromEntries(demoUsers.map((u) => [u.uid, u.displayName]));
const INVOICED = ['facturado', 'despachado', 'entregado'];
const DAY = 24 * 60 * 60 * 1000;

export default function FichaCliente() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { current } = useCurrentUser();
  const uid = current!.appUser.uid;
  const role = current!.appUser.role;
  const isAdmin = role === 'admin' || role === 'superAdmin';
  const { client, loading, error } = useClient(clientId ?? null);
  const { orders } = useClientOrders(clientId ?? null);
  const { products } = useProducts();
  const { settings } = useSettings();
  const [editing, setEditing] = useState(false);

  const grams = useMemo(() => gramsMap(products), [products]);
  const kpi = useMemo(() => {
    const valid = orders.filter((o) => o.status !== 'anulado');
    const invoiced = valid.filter((o) => INVOICED.includes(o.status));
    const revenue = invoiced.reduce((s, o) => s + (o.totalCLP ?? 0), 0);
    const sorted = [...valid].sort((a, b) => a.createdAt - b.createdAt);
    const last = sorted[sorted.length - 1];
    const daysSince = last ? Math.max(0, Math.round((Date.now() - last.createdAt) / DAY)) : null;
    let interval: number | null = null;
    if (sorted.length >= 2) interval = (sorted[sorted.length - 1].createdAt - sorted[0].createdAt) / DAY / (sorted.length - 1);
    const top = new Map<string, { name: string; format: string; unit: 'g' | 'kg' | 'unidad'; qty: number; kg: number; times: number }>();
    for (const o of valid) for (const l of o.lines) {
      const k = `${l.productId}::${l.formatId}`;
      const t = top.get(k) ?? { name: l.productName, format: l.formatLabel, unit: l.unit, qty: 0, kg: 0, times: 0 };
      t.qty += l.qty; t.kg += lineKg(l, grams); t.times++; top.set(k, t);
    }
    const habituales = [...top.values()].sort((a, b) => b.times - a.times || b.kg - a.kg).slice(0, 6);
    const open = valid.filter((o) => !['entregado'].includes(o.status));
    const late = open.filter((o) => o.requestedDate < todayInSantiago()).length;
    return { count: valid.length, revenue, ticket: invoiced.length ? revenue / invoiced.length : 0, last, daysSince, interval, habituales, open: open.length, late, anulados: orders.length - valid.length };
  }, [orders, grams]);

  function nuevoPedido() {
    if (!client) return;
    saveDraft(uid, {
      clientId: client.id, lines: [], requestedDate: defaultRequestedDate(settings.cutoffHour),
      deliveryMode: client.deliveryMode, deliveryAddress: '', receivingHours: '', step: 2,
    });
    navigate('/vendedor/nuevo');
  }

  if (error) return <div className="max-w-3xl mx-auto"><ErrorBanner message={error} /></div>;
  if (loading) return <p className="text-sm text-charcoal-300">Cargando…</p>;
  if (!client) return <div className="max-w-3xl mx-auto card p-6 text-sm text-charcoal-500">Cliente no encontrado.</div>;

  const health = kpi.daysSince == null ? 'Sin pedidos' : kpi.daysSince <= 14 ? 'Activo' : kpi.daysSince <= 30 ? 'En riesgo' : 'Inactivo';
  const healthStyle = health === 'Activo' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : health === 'En riesgo' ? 'bg-brass-50 text-brass-700 border-brass-300' : health === 'Inactivo' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-charcoal-50 text-charcoal-500 border-charcoal-100';

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-4"><Link to="/clientes" className="text-[11px] uppercase tracking-display text-charcoal-300 hover:text-charcoal-700">← Clientes</Link></div>

      <header className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-display ' + healthStyle}>{health}</span>
            {client.needsReview && <span className="rounded px-2 py-0.5 text-[10px] uppercase tracking-display bg-brass-50 text-brass-700 border border-brass-300">Pendiente de revisión</span>}
            {!client.invoicingComplete && !client.needsReview && <span className="rounded px-2 py-0.5 text-[10px] uppercase tracking-display bg-brass-50 text-brass-700 border border-brass-300">Facturación incompleta</span>}
            {client.isInternalShop && <span className="rounded px-2 py-0.5 text-[10px] uppercase tracking-display bg-charcoal-900 text-cream-50">Tienda</span>}
          </div>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase mt-1">{client.fantasyName ?? client.name}</h1>
          {client.fantasyName && client.fantasyName !== client.name && <p className="text-sm text-charcoal-500">{client.name}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          {(role === 'vendedor' || isAdmin) && <Button size="sm" onClick={nuevoPedido}>Nuevo pedido</Button>}
          {isAdmin && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Editar</Button>}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-5 mb-4">
        <section className="card p-4 md:col-span-3">
          <p className="eyebrow mb-2">Datos</p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
            <Row k="RUT" v={client.rut ?? 'Sin RUT'} warn={!client.rut} />
            <Row k="Giro" v={client.giro ?? '—'} warn={!client.giro} />
            <Row k="Dirección" v={client.address ?? '—'} warn={!client.address} />
            <Row k="Entrega" v={`${client.deliveryMode === 'retiro' ? 'Retiro en tienda' : 'Despacho'}${client.receivingHours ? ` · ${client.receivingHours}` : ''}`} />
            <Row k="Contacto" v={[client.contactPhone, client.email].filter(Boolean).join(' · ') || '—'} />
            <Row k="Vendedor" v={client.ownerUid ? NAME[client.ownerUid] ?? client.ownerUid : 'Sin asignar'} />
            {client.notes && <Row k="Notas" v={client.notes} />}
          </dl>
          <p className="text-[10px] uppercase tracking-display text-charcoal-300 mt-3">
            {client.bsaleClientId ? `Bsale · sincronizado ${client.bsaleSyncedAt ? new Date(client.bsaleSyncedAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : ''}` : 'Solo local'}
            {client.source === 'app' && client.createdBy ? ` · creado por ${NAME[client.createdBy] ?? client.createdBy}` : ''}
          </p>
        </section>
        <section className="card p-4 md:col-span-2 grid grid-cols-2 gap-3 content-start">
          <K label="Pedidos" v={kpi.count} sub={kpi.anulados ? `${kpi.anulados} anulados` : undefined} />
          <K label="Ventas" v={formatCLP(kpi.revenue)} sub={kpi.ticket ? `ticket ${formatCLP(kpi.ticket)}` : undefined} />
          <K label="Último pedido" v={kpi.last ? formatDateShort(kpi.last.requestedDate) : '—'} sub={kpi.daysSince != null ? `hace ${kpi.daysSince} d` : undefined} />
          <K label="Frecuencia" v={kpi.interval != null ? `cada ${Math.round(kpi.interval)} d` : '—'} sub={kpi.open ? `${kpi.open} abierto${kpi.open === 1 ? '' : 's'}${kpi.late ? ` · ${kpi.late} atrasado${kpi.late === 1 ? '' : 's'}` : ''}` : undefined} />
        </section>
      </div>

      {kpi.habituales.length > 0 && (
        <section className="card p-4 mb-4">
          <p className="eyebrow mb-2">Productos habituales</p>
          <ul className="divide-y divide-charcoal-100 text-sm">
            {kpi.habituales.map((h) => (
              <li key={`${h.name}-${h.format}`} className="py-1.5 flex items-center justify-between gap-3">
                <span className="text-charcoal-700 truncate">{h.name} <span className="text-charcoal-300">{h.format}</span></span>
                <span className="text-charcoal-500 shrink-0 text-xs">{h.times}× · {formatQty(h.qty, h.unit)}{h.kg > 0 && h.unit !== 'kg' ? ` (~${h.kg.toFixed(1)} kg)` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="p-4"><p className="eyebrow">Historial de pedidos</p></div>
        {orders.length === 0 && <p className="px-4 pb-4 text-sm text-charcoal-500">Todavía sin pedidos.</p>}
        <ul className="divide-y divide-charcoal-100">
          {orders.map((o) => (
            <li key={o.id}>
              <Link to={`/vendedor/mis/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-cream-100/40 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] text-charcoal-300">{o.id}</span>
                    <StatusPill status={o.status} />
                    {o.invoiceRef && <span className="font-mono text-[11px] text-charcoal-500">{o.invoiceRef}</span>}
                  </div>
                  <p className="text-xs text-charcoal-500 truncate mt-0.5">{o.lines.map((l) => `${l.qty} ${l.productName}`).join(' · ')}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-charcoal-700 first-letter:uppercase">{formatDateShort(o.requestedDate)}</p>
                  <p className="text-xs text-charcoal-300">{NAME[o.createdBy] ?? o.createdBy}{o.totalCLP ? ` · ${formatCLP(o.totalCLP)}` : ''}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {editing && <EditarClienteDialog client={client} uid={uid} onClose={() => setEditing(false)} />}
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (<><dt className="eyebrow pt-0.5">{k}</dt><dd className={warn ? 'text-brass-700' : 'text-charcoal-700'}>{v}</dd></>);
}
function K({ label, v, sub }: { label: string; v: string | number; sub?: string }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="text-lg font-semibold text-charcoal-900 mt-0.5">{v}</p>
      {sub && <p className="text-[10px] uppercase tracking-display text-charcoal-300">{sub}</p>}
    </div>
  );
}
