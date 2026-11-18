import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '@/data/auth';
import { useUsers } from '@/data/users';
import { callableMessage } from '@/data/userAdmin';
import { getReceivables, getClientInvoices, recordPayment, type ReceivablePage, type ReceivableClient, type ReceivableInvoice } from '@/data/receivables';
import { collectionRows, collectionSummary, filterCollection, type CollectionFilter, type CollectionSort, type CollectionInvoice } from '@/domain/receivables';
import { downloadCsv } from '@/lib/csv';
import { formatCLP } from '@/lib/pricing';
import { formatDateShort, todayInSantiago } from '@/lib/format';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
import DataTable, { Pill } from '@/components/ui/DataTable';
import { ModalShell } from '@/components/orders/OrderDialogs';

export default function CuentasPorCobrar() {
  const { current } = useCurrentUser();
  const { users, nameOf } = useUsers();
  const isSuper = current!.appUser.role === 'superAdmin';
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ search: '', ownerUid: '', page: 0 });
  const [data, setData] = useState<ReceivablePage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<'invoices' | 'clients'>('invoices');
  const [status, setStatus] = useState<CollectionFilter>('all');
  const [sort, setSort] = useState<CollectionSort>('priority');
  const [localSearch, setLocalSearch] = useState('');
  const [history, setHistory] = useState<ReceivableClient | null>(null);
  const [payment, setPayment] = useState<{ client: ReceivableClient; invoice: ReceivableInvoice } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBusy(true); setError('');
    if (filters.page === 0) setData(null);
    void getReceivables(filters).then(r => {
      if (cancelled) return;
      setData(previous => {
        if (filters.page === 0 || !previous) return r.data;
        const clients = new Map(previous.clients.map(c => [c.id, c]));
        r.data.clients.forEach(c => clients.set(c.id, c));
        return { ...r.data, clients: [...clients.values()] };
      });
    }).catch(e => { if (!cancelled) setError(callableMessage(e)); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [filters, version, current?.appUser.uid]);
  const today = todayInSantiago();
  const rows = collectionRows(data?.clients ?? [], today);
  const summary = collectionSummary(rows, today);
  const visible = filterCollection(rows, status, sort, localSearch, today);
  const visibleIds = new Set(visible.map(i => i.client.id));
  const failed = data?.clients.filter(c => c.error).length ?? 0;
  const hasMore = !!data && (data.page + 1) * 20 < data.totalClients;
  const scope = data ? `${data.clients.length} de ${data.totalClients} clientes consultados` : 'Consultando cartera';
  const onPay = (client: ReceivableClient, invoice: ReceivableInvoice) => setPayment({ client, invoice });
  const refresh = () => { setFilters(f => ({ ...f, page: 0 })); setVersion(v => v + 1); };
  const resetLocal = () => { setStatus('all'); setLocalSearch(''); };
  function exportList() {
    const text = (s: string) => /^[=+@-]/.test(s) ? `'${s}` : s;
    downloadCsv('cobranza', visible.map(i => ({ Cliente: text(i.client.name), RUT: text(i.client.rut), Vendedor: text(i.client.ownerUid ? nameOf(i.client.ownerUid) : 'Sin asignar'), Factura: text(i.number), Emision: i.issued, Vencimiento: i.due ?? '', Dias_atraso: i.daysLate, Total_CLP: i.total, Abonos_y_ajustes_CLP: i.applied, Saldo_CLP: i.balance })), undefined, `${scope}; filtro: ${FILTER_LABEL[status]}`);
  }
  return <div className="space-y-4">
    <header className="flex items-start justify-between gap-3 flex-wrap">
      <div><p className="eyebrow mb-1">Gestión de cobranza</p><h1 className="text-2xl font-semibold text-charcoal-900 uppercase tracking-display">Cuentas por cobrar</h1><p className="text-xs text-charcoal-500 mt-1">{isSuper ? 'Todas las carteras' : 'Mi cartera'} · priorice facturas vencidas y próximos cobros.</p></div>
      <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy || !visible.length} onClick={exportList}>Exportar listado</Button><Button size="sm" disabled={busy} onClick={refresh}>{busy ? 'Consultando…' : 'Actualizar saldos'}</Button></div>
    </header>
    <section className="card p-3 sm:p-4">
      <form className="flex gap-2 items-end flex-wrap" onSubmit={e => { e.preventDefault(); resetLocal(); setFilters(f => ({ ...f, search: search.trim(), page: 0 })); }}>
        <label className="flex-1 min-w-[180px] text-xs text-charcoal-500">Buscar cliente en la cartera<input placeholder="Nombre o RUT" className="field w-full mt-1" value={search} onChange={e => setSearch(e.target.value)} /></label>
        {isSuper && <label className="text-xs text-charcoal-500 min-w-0 max-w-full">Vendedor<select className="field block mt-1 max-w-full" value={filters.ownerUid} onChange={e => { resetLocal(); setFilters(f => ({ ...f, ownerUid: e.target.value, page: 0 })); }}><option value="">Todas las carteras</option>{users.filter(u => !u.placeholder && !u.mergedInto).map(u => <option key={u.uid} value={u.uid}>{u.displayName}{u.active === false ? ' (desactivado)' : ''}</option>)}</select></label>}
        <Button type="submit" size="sm" disabled={busy}>Consultar</Button>
        {(filters.search || filters.ownerUid) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setSearch(''); resetLocal(); setFilters({ search: '', ownerUid: '', page: 0 }); }}>Limpiar cartera</Button>}
      </form>
      <div className="mt-3 pt-3 border-t border-charcoal-100 flex justify-between items-center gap-2 flex-wrap text-xs text-charcoal-500">
        <span>{scope}{data ? ` · ${data.checkedAt ? new Date(data.checkedAt).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' }) : ''}` : ''}</span>
        <Pill tone={data?.writesEnabled ? 'ok' : 'muted'}>{data?.writesEnabled ? 'Registro de pagos habilitado' : 'Bsale · solo consulta'}</Pill>
      </div>
      {data && hasMore && <p className="text-xs text-brass-700 mt-2">Vista parcial de la cartera. Los indicadores y filtros consideran solo los clientes consultados. Cargue más clientes para ampliar la revisión.</p>}
    </section>
    {error && <ErrorBanner message={error} />}
    {busy && !data && <div className="card p-8 text-center text-sm text-charcoal-500" role="status">Consultando saldos actuales en Bsale…</div>}
    {data && <>
      {failed > 0 && <ErrorBanner message={`${failed} clientes sin saldo confirmado. Se muestran por separado y no se incluyen en los indicadores. Actualice para reintentar.`} />}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: 'Saldo por cobrar', value: summary.total, sub: `${rows.length} facturas · ${summary.clients} clientes con deuda`, filter: 'all' as const, red: false },
          { label: 'Saldo vencido', value: summary.overdue, sub: `${summary.overdueCount} facturas fuera de plazo`, filter: 'overdue' as const, red: true },
          { label: 'Vence hoy o en 7 días', value: summary.due7, sub: 'Cobros próximos a vencer', filter: 'due7' as const, red: false },
          { label: 'Más de 90 días', value: summary.over90, sub: 'Prioridad de recuperación', filter: 'over90' as const, red: true },
        ].map(k => <button key={k.label} type="button" onClick={() => { setStatus(k.filter); setView('invoices'); }} aria-pressed={status === k.filter} className={`card p-3 sm:p-4 text-left transition hover:border-charcoal-300 ${status === k.filter ? 'ring-1 ring-charcoal-500' : ''}`}><p className="text-xs text-charcoal-500">{k.label}</p><p className={`text-lg sm:text-2xl font-semibold tabular-nums mt-1 ${k.red && k.value ? 'text-red-800' : 'text-charcoal-900'}`}>{formatCLP(k.value)}</p><p className="text-[11px] text-charcoal-500 mt-1">{k.sub}</p></button>)}
      </div>
      <section className="card p-3 sm:p-4">
        <div className="flex justify-between gap-2 mb-3"><h2 className="eyebrow">Antigüedad del saldo</h2><span className="text-xs text-charcoal-500">Clientes consultados</span></div>
        <div className="flex h-2 rounded-full overflow-hidden bg-charcoal-100" aria-hidden="true">{summary.buckets.filter(b => b.total > 0).map(b => <div key={b.label} className={b.tone} style={{ width: `${summary.total ? b.total / summary.total * 100 : 0}%` }} />)}</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3">{summary.buckets.map(b => <div key={b.label}><p className="text-[11px] text-charcoal-500 flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${b.tone}`} />{b.label}</p><p className="text-sm font-semibold text-charcoal-900 mt-1">{formatCLP(b.total)}</p><p className="text-[10px] text-charcoal-500">{b.count} facturas</p></div>)}</div>
      </section>
      <section className="space-y-3">
        <div className="flex justify-between gap-3 items-center flex-wrap"><div className="flex gap-1" role="group" aria-label="Agrupar cobranza"><Button size="sm" variant={view === 'invoices' ? 'primary' : 'secondary'} onClick={() => setView('invoices')}>Por factura</Button><Button size="sm" variant={view === 'clients' ? 'primary' : 'secondary'} onClick={() => setView('clients')}>Por cliente</Button></div><span className="text-xs text-charcoal-500">{visible.length} facturas · {formatCLP(visible.reduce((s, i) => s + i.balance, 0))} en este listado</span></div>
        <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Filtrar facturas">{(Object.entries(FILTER_LABEL) as Array<[CollectionFilter, string]>).map(([key, label]) => <button type="button" key={key} aria-pressed={status === key} onClick={() => setStatus(key)} className={`rounded-full px-3 py-1.5 border text-xs ${status === key ? 'bg-charcoal-900 text-white border-charcoal-900' : 'bg-white border-charcoal-200 text-charcoal-500'}`}>{label}</button>)}</div>
        <div className="flex gap-2 flex-wrap"><input aria-label="Filtrar facturas consultadas" className="field flex-1 min-w-[180px]" placeholder="Filtrar por Nº de factura, cliente o RUT" value={localSearch} onChange={e => setLocalSearch(e.target.value)} /><select aria-label="Ordenar cobranza" className="field" value={sort} onChange={e => setSort(e.target.value as CollectionSort)}><option value="priority">Mayor atraso primero</option><option value="balance">Mayor saldo primero</option><option value="due">Vencimiento más próximo</option><option value="client">Nombre del cliente</option></select></div>
        {!visible.length ? <div className="card p-7 text-center"><p className="font-semibold text-charcoal-700">{rows.length ? 'No hay facturas que coincidan con estos filtros.' : 'Sin facturas pendientes en los clientes consultados.'}</p><p className="text-xs text-charcoal-500 mt-1">{hasMore ? 'Puede cargar más clientes para continuar revisando la cartera.' : 'Los saldos corresponden a la consulta actual de Bsale.'}</p>{(status !== 'all' || localSearch) && <Button size="sm" variant="ghost" className="mt-2" onClick={resetLocal}>Ver todas las pendientes</Button>}</div> : view === 'invoices' ? <DataTable<CollectionInvoice> rows={visible} rowKey={i => `${i.client.id}:${i.id}`} rowTone={i => i.daysLate > 90 ? 'bad' : undefined} columns={[
          { key: 'client', label: 'Cliente / Factura', mobile: true, render: i => <div><p className="font-semibold text-charcoal-900">{i.client.name}</p><p className="text-xs text-charcoal-500">Nº {i.number}{isSuper ? ` · ${i.client.ownerUid ? nameOf(i.client.ownerUid) : 'Sin vendedor'}` : ''}</p></div> },
          { key: 'due', label: 'Vencimiento', mobile: true, render: i => <div><p className="whitespace-nowrap">{i.due ? formatDateShort(i.due) : 'Sin fecha'}</p><span className={`text-xs ${i.daysLate ? 'text-red-700' : 'text-charcoal-500'}`}>{i.daysLate ? `${i.daysLate} días de atraso` : !i.due ? 'Sin vencimiento' : i.due === today ? 'Vence hoy' : 'Por vencer'}</span></div> },
          { key: 'partial', label: 'Abonos y ajustes', align: 'right', render: i => <span>{formatCLP(i.applied)}{i.applied > 0 && <span className="block text-[10px] text-charcoal-500">Saldo parcial</span>}</span> },
          { key: 'balance', label: 'Saldo por cobrar', mobile: true, align: 'right', render: i => <strong className="whitespace-nowrap">{formatCLP(i.balance)}</strong> },
          { key: 'action', label: '', mobile: true, render: i => <button type="button" className="text-xs underline text-charcoal-700" aria-label={`Gestionar factura ${i.number}`}>Gestionar</button> },
        ]} expand={i => <div className="flex gap-3 items-center flex-wrap text-xs"><span>Emisión: {formatDateShort(i.issued)} · Total: {formatCLP(i.total)}</span><Link to={`/clientes/${i.client.id}`} className="underline">Ficha del cliente</Link><Button size="sm" variant="ghost" onClick={() => setHistory(i.client)}>Historial</Button><Button size="sm" variant="secondary" onClick={() => onPay(i.client, i)}>{data.writesEnabled ? 'Registrar pago' : 'Ver formulario de pago'}</Button></div>} /> : <DataTable<ReceivableClient> rows={data.clients.filter(c => visibleIds.has(c.id)).sort((a, b) => visible.findIndex(i => i.client.id === a.id) - visible.findIndex(i => i.client.id === b.id))} rowKey={c => c.id} columns={[
          { key: 'client', label: 'Cliente', mobile: true, render: c => <div><p className="font-semibold text-charcoal-900">{c.name}</p><p className="text-xs text-charcoal-500">{c.rut}{isSuper ? ` · ${c.ownerUid ? nameOf(c.ownerUid) : 'Sin vendedor'}` : ''}</p></div> },
          { key: 'invoices', label: 'Facturas', align: 'right', render: c => visible.filter(i => i.client.id === c.id).length },
          { key: 'late', label: 'Mayor atraso', mobile: true, render: c => { const late = Math.max(...visible.filter(i => i.client.id === c.id).map(i => i.daysLate)); return late ? <Pill tone="bad">{late} días</Pill> : <Pill tone="ok">En plazo</Pill>; } },
          { key: 'overdue', label: 'Saldo vencido', align: 'right', render: c => formatCLP(visible.filter(i => i.client.id === c.id && i.daysLate > 0).reduce((s, i) => s + i.balance, 0)) },
          { key: 'balance', label: 'Saldo filtrado', align: 'right', mobile: true, render: c => <strong>{formatCLP(visible.filter(i => i.client.id === c.id).reduce((s, i) => s + i.balance, 0))}</strong> },
        ]} expand={c => <div className="space-y-2"><div className="flex gap-3 items-center"><Link className="underline text-xs" to={`/clientes/${c.id}`}>Ficha y datos de contacto</Link><Button size="sm" variant="ghost" onClick={() => setHistory(c)}>Historial de facturas</Button></div><InvoiceTable invoices={visible.filter(i => i.client.id === c.id)} onPay={invoice => onPay(c, invoice)} /></div>} />}
      </section>
      {data.clients.some(c => !c.error && !c.invoices.length) && <details className="card p-3"><summary className="text-sm text-charcoal-700 cursor-pointer">Clientes sin facturas pendientes ({data.clients.filter(c => !c.error && !c.invoices.length).length})</summary><div className="mt-2 divide-y divide-charcoal-100">{data.clients.filter(c => !c.error && !c.invoices.length).map(c => <div key={c.id} className="py-2 flex justify-between gap-2 items-center"><div><Link to={`/clientes/${c.id}`} className="text-sm font-semibold text-charcoal-900 hover:underline">{c.name}</Link><p className="text-xs text-charcoal-500">Sin saldo pendiente según Bsale</p></div><Button size="sm" variant="ghost" onClick={() => setHistory(c)}>Historial</Button></div>)}</div></details>}
      {failed > 0 && <details className="card p-3"><summary className="text-sm font-semibold text-red-800 cursor-pointer">Clientes por verificar ({failed})</summary><ul className="mt-2 space-y-2">{data.clients.filter(c => c.error).map(c => <li key={c.id} className="text-xs flex justify-between gap-2"><Link className="underline" to={`/clientes/${c.id}`}>{c.name}</Link><span>{c.error}</span></li>)}</ul></details>}
      <footer className="card p-4 flex items-center justify-between gap-3 flex-wrap"><div><p className="text-sm font-semibold text-charcoal-700">{scope}</p><p className="text-xs text-charcoal-500 mt-1">{hasMore ? 'Cargue los siguientes clientes para ampliar los indicadores y la lista de trabajo.' : 'Se consultaron todos los clientes de la cartera o búsqueda seleccionada.'}</p></div>{hasMore && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setFilters(f => ({ ...f, page: data.page + 1 }))}>{busy ? 'Consultando…' : 'Cargar 20 clientes más'}</Button>}</footer>
    </>}
    {history && <History client={history} onClose={() => setHistory(null)} />}
    {payment && <Payment client={payment.client} invoice={payment.invoice} enabled={!!data?.writesEnabled} onClose={() => setPayment(null)} onDone={() => { setPayment(null); refresh(); }} />}
  </div>;
}
const FILTER_LABEL: Record<CollectionFilter, string> = { all: 'Todas las pendientes', overdue: 'Vencidas', due7: 'Vencen en 7 días', partial: 'Con abonos / ajustes', over90: 'Más de 90 días' };
function InvoiceTable({ invoices, onPay }: { invoices: ReceivableInvoice[]; onPay?: (invoice: ReceivableInvoice) => void }) {
  return <DataTable rows={invoices} rowKey={i => i.id} emptyText="No hay facturas para este filtro." expand={i => <span className="text-xs text-charcoal-500">Total {formatCLP(i.total)} · saldo {formatCLP(i.balance)}</span>} columns={[
    { key: 'number', label: 'Factura', mobile: true, render: i => <span className="font-semibold">Nº {i.number}</span> },
    { key: 'issued', label: 'Emisión', render: i => formatDateShort(i.issued) },
    { key: 'due', label: 'Vencimiento', render: i => i.due ? formatDateShort(i.due) : '—' },
    { key: 'status', label: 'Estado', mobile: true, render: i => <Pill tone={i.balance === 0 ? 'ok' : i.overdue ? 'bad' : 'warn'}>{i.balance === 0 ? 'Saldada' : i.overdue ? 'Vencida' : i.applied > 0 ? 'Pago parcial' : 'Pendiente'}</Pill> },
    { key: 'total', label: 'Total', align: 'right', render: i => formatCLP(i.total) },
    { key: 'applied', label: 'Abonos y ajustes', align: 'right', render: i => formatCLP(i.applied) },
    { key: 'balance', label: 'Saldo', mobile: true, align: 'right', render: i => <strong>{formatCLP(i.balance)}</strong> },
    ...(onPay ? [{ key: 'pay', label: '', mobile: true, render: (i: ReceivableInvoice) => <Button size="sm" variant="secondary" onClick={() => onPay(i)}>Registrar pago</Button> }] : []),
  ]} />;
}
function History({ client, onClose }: { client: ReceivableClient; onClose: () => void }) {
  const [invoices, setInvoices] = useState<ReceivableInvoice[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  useEffect(() => { let stop = false; void getClientInvoices({ clientId: client.id }).then(r => { if (!stop) { if (r.data.truncated) setError('El historial es muy extenso y está incompleto. Consulte Bsale.'); setInvoices(r.data.invoices); } }).catch(e => { if (!stop) setError(callableMessage(e)); }); return () => { stop = true; }; }, [client.id]);
  return <ModalShell title={client.name} eyebrow="Historial de facturas en Bsale" onClose={onClose} wide>
    <p className="text-xs text-charcoal-500 mb-3">Saldada significa sin saldo pendiente en Bsale; puede incluir pagos y notas de crédito.</p>
    {error && <ErrorBanner message={error} />}
    {!invoices && !error && <p className="text-sm py-4">Consultando historial…</p>}
    {invoices && <><select aria-label="Estado de las facturas" className="field mb-3" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todas</option><option value="pending">Con saldo</option><option value="settled">Saldadas</option></select><InvoiceTable invoices={invoices.filter(i => filter === 'all' || (filter === 'settled' ? i.balance === 0 : i.balance > 0))} /></>}
  </ModalShell>;
}
function Payment({ client, invoice, enabled, onClose, onDone }: { client: ReceivableClient; invoice: ReceivableInvoice; enabled: boolean; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(invoice.balance));
  const [date, setDate] = useState(todayInSantiago());
  const [type, setType] = useState('8');
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  async function submit() {
    if (!enabled || attempted || busy) return;
    setBusy(true); setError(''); setAttempted(true);
    try { await recordPayment({ clientId: client.id, documentId: invoice.id, amount: Number(amount), date, paymentTypeId: Number(type), requestId }); onDone(); }
    catch (e) { setError(`${callableMessage(e)} Si inició el envío, revise Bsale antes de volver a intentarlo.`); }
    finally { setBusy(false); }
  }
  return <ModalShell title={`Pago · Factura Nº ${invoice.number}`} eyebrow={client.name} onClose={busy ? () => {} : onClose}>
    <div className="space-y-3"><p className="text-sm">Saldo pendiente: <strong>{formatCLP(invoice.balance)}</strong></p>
      {!enabled && <p className="rounded-md bg-brass-50 text-brass-700 p-3 text-sm">Registro desactivado. Este formulario no guarda ni envía pagos a Bsale.</p>}
      <label className="block text-xs">Monto del abono (CLP)<input type="number" min="1" max={invoice.balance} step="1" className="field mt-1 w-full" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy || attempted} /></label>
      <label className="block text-xs">Fecha del pago<input type="date" min={invoice.issued} max={todayInSantiago()} className="field mt-1 w-full" value={date} onChange={e => setDate(e.target.value)} disabled={busy || attempted} /></label>
      <label className="block text-xs">Forma de pago<select className="field mt-1 w-full" value={type} onChange={e => setType(e.target.value)} disabled={busy || attempted}><option value="8">Transferencia bancaria</option><option value="1">Efectivo</option></select></label>
      {error && <ErrorBanner message={error} />}
      <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onClose}>Cerrar</Button><Button disabled={!enabled || busy || attempted || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0 || Number(amount) > invoice.balance || !date || date < invoice.issued || date > todayInSantiago()} onClick={() => void submit()}>{busy ? 'Registrando…' : 'Guardar en Bsale'}</Button></div>
    </div>
  </ModalShell>;
}
