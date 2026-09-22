import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/data/firebase';
import Button from '@/components/ui/Button';
import { useCurrentUser } from '@/data/auth';
import { demoUsers } from '@/data/demo-users';
import { addDaysIso, todayInSantiago } from '@/lib/format';
import { formatCLP } from '@/lib/pricing';
import { bsale } from '@/integrations/bsale/MockBsaleClient';
import type { Order, OrderLine } from '@/domain/types';

const VENDEDOR_NAME: Record<string, string> = Object.fromEntries(
  demoUsers.filter((u) => u.role === 'vendedor').map((u) => [u.uid, u.displayName]),
);

// Convert a line's qty to a comparable kg number when possible.
// For kg-unit lines, qty is already in kg. For sachet formats we use grams
// metadata if present; otherwise 0 (we skip it in kg totals).
function toKg(line: OrderLine, gramsByFormat: Map<string, number | undefined>): number {
  if (line.unit === 'kg') return line.qty;
  const g = gramsByFormat.get(`${line.productId}::${line.formatId}`);
  if (g == null) return 0;
  return (g * line.qty) / 1000;
}

function packedKg(line: OrderLine, gramsByFormat: Map<string, number | undefined>): number {
  if (line.packedWeightKg != null) return line.packedWeightKg;
  const packed = line.packedQty ?? 0;
  if (line.unit === 'kg') return packed;
  const g = gramsByFormat.get(`${line.productId}::${line.formatId}`);
  if (g == null) return 0;
  return (g * packed) / 1000;
}

type Range = '7' | '30' | 'all';

export default function Panel() {
  const { current } = useCurrentUser();
  const isSuperAdmin = current!.appUser.role === 'superAdmin';
  const [range, setRange] = useState<Range>('7');
  const [orders, setOrders] = useState<Order[]>([]);
  const [gramsByFormat, setGramsByFormat] = useState<Map<string, number | undefined>>(new Map());

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'orders'), (snap) => {
      const list: Order[] = [];
      snap.forEach((d) => list.push(d.data() as Order));
      setOrders(list);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'products'), (snap) => {
      const m = new Map<string, number | undefined>();
      snap.forEach((d) => {
        const p = d.data() as { id: string; formats: { formatId: string; grams?: number }[] };
        for (const f of p.formats) m.set(`${p.id}::${f.formatId}`, f.grams);
      });
      setGramsByFormat(m);
    });
    return unsub;
  }, []);

  const fromDate = useMemo(() => {
    if (range === 'all') return '2020-01-01';
    return addDaysIso(todayInSantiago(), -(range === '7' ? 7 : 30));
  }, [range]);

  const filtered = useMemo(() => orders.filter((o) => o.requestedDate >= fromDate), [orders, fromDate]);

  const metrics = useMemo(() => {
    let totalOrders = 0;
    let anuladas = 0;
    let incompleteInvoicing = 0;
    let pendingProductionLines = 0;
    let deltaLines: Array<{ orderId: string; productName: string; formatLabel: string; sold: number; packed: number }> = [];
    let byVendedor = new Map<string, { orders: number; kg: number; clp: number }>();
    let byProduct = new Map<string, { name: string; kg: number; clp: number }>();
    let totalRevenueCLP = 0;
    let invoicedOrdersCount = 0;

    for (const o of filtered) {
      totalOrders++;
      if (o.status === 'anulado') anuladas++;
      if (!o.invoicingComplete) incompleteInvoicing++;
      const vName = VENDEDOR_NAME[o.createdBy] ?? o.createdBy;
      const v = byVendedor.get(vName) ?? { orders: 0, kg: 0, clp: 0 };
      v.orders++;
      let orderKg = 0;
      const isInvoiced = ['facturado', 'despachado', 'entregado'].includes(o.status);
      if (isInvoiced && o.totalCLP != null) {
        totalRevenueCLP += o.totalCLP;
        invoicedOrdersCount++;
      }
      if (o.status !== 'anulado' && o.totalCLP != null) v.clp += o.totalCLP;
      for (const l of o.lines) {
        if (l.pendingProductionQty > 0) {
          pendingProductionLines++;
        }
        const kg = toKg(l, gramsByFormat);
        orderKg += kg;
        const pByKey = byProduct.get(l.productId) ?? { name: l.productName, kg: 0, clp: 0 };
        pByKey.kg += kg;
        pByKey.clp += l.subtotalCLP ?? 0;
        byProduct.set(l.productId, pByKey);
        // Delta packed vs reserved — reserved is what despacho committed to
        // deliver in this run (pending-production quantities stay outside).
        // Comparing against `qty` would show a phantom -12 delta on every
        // confirmado_parcial we ever armed after Registrar Producción.
        if (l.packedQty != null && l.reservedQty > 0) {
          const kgReserved = l.unit === 'kg'
            ? l.reservedQty
            : (gramsByFormat.get(`${l.productId}::${l.formatId}`) ?? 0) * l.reservedQty / 1000;
          const pk = packedKg(l, gramsByFormat);
          if (kgReserved > 0 && Math.abs(pk - kgReserved) >= 0.1) {
            deltaLines.push({
              orderId: o.id,
              productName: l.productName,
              formatLabel: l.formatLabel,
              sold: kgReserved,
              packed: pk,
            });
          }
        }
      }
      v.kg += orderKg;
      byVendedor.set(vName, v);
    }

    const vendedorArr = [...byVendedor.entries()]
      .map(([name, v]) => ({ name, orders: v.orders, kg: Number(v.kg.toFixed(1)), clp: Math.round(v.clp) }))
      .sort((a, b) => b.clp - a.clp);

    const productArr = [...byProduct.values()]
      .map((p) => ({ name: p.name, kg: Number(p.kg.toFixed(1)), clp: Math.round(p.clp) }))
      .filter((p) => p.clp > 0)
      .sort((a, b) => b.clp - a.clp)
      .slice(0, 8);

    deltaLines.sort((a, b) => Math.abs(b.sold - b.packed) - Math.abs(a.sold - a.packed));
    const deltaCount = deltaLines.length;
    const deltaTop = deltaLines.slice(0, 5);

    const avgTicketCLP = invoicedOrdersCount > 0 ? totalRevenueCLP / invoicedOrdersCount : 0;

    return { totalOrders, anuladas, incompleteInvoicing, pendingProductionLines, deltaCount, deltaLines: deltaTop, vendedorArr, productArr, totalRevenueCLP, avgTicketCLP };
  }, [filtered, gramsByFormat]);

  const [syncModal, setSyncModal] = useState<null | { payload: unknown }>(null);

  const [syncing, setSyncing] = useState(false);
  async function syncBsale() {
    if (syncing) return;
    setSyncing(true);
    try {
      // Preview only: build payloads with each order's existing invoiceRef.
      // Does NOT call createDocument, so no invoice numbers are consumed.
      const invoiced = orders.filter((o) => !!o.invoiceRef).slice(0, 20);
      const payloads = invoiced.map((o) => ({
        docNumber: o.invoiceRef!,
        order: o.id,
        payload: bsale.buildPayload(o),
      }));
      setSyncModal({ payload: payloads });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <header className="mb-6 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">Administración</p>
          <h1 className="text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Panel de dueños</h1>
        </div>
        <div className="flex items-center gap-2">
          <RangeChip range="7"   current={range} setRange={setRange}>7 días</RangeChip>
          <RangeChip range="30"  current={range} setRange={setRange}>30 días</RangeChip>
          <RangeChip range="all" current={range} setRange={setRange}>Todo</RangeChip>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <MetricCard label="Pedidos" value={metrics.totalOrders} sublabel={metrics.anuladas > 0 ? `${metrics.anuladas} anulados` : undefined} />
        <MetricCard label="Ventas facturadas" value={formatCLP(metrics.totalRevenueCLP)} sublabel={metrics.avgTicketCLP > 0 ? `Ticket ~${formatCLP(metrics.avgTicketCLP)}` : undefined} />
        <MetricCard label="Facturación incompleta" value={metrics.incompleteInvoicing} tone={metrics.incompleteInvoicing > 0 ? 'warn' : 'ok'} />
        <MetricCard label="Delta empacado/vendido" value={metrics.deltaCount} sublabel="líneas con diferencia" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ChartCard title="Ventas por vendedor (CLP)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={metrics.vendedorArr} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e2dd" vertical={false} />
              <XAxis dataKey="name" stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} interval={0} angle={-25} textAnchor="end" dy={4} />
              <YAxis stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${Math.round((v as number) / 1000)}k`} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e2dd', fontSize: 12 }} formatter={(v) => [formatCLP(v as number), 'Ventas']} />
              <Bar dataKey="clp" radius={[3, 3, 0, 0]}>
                {metrics.vendedorArr.map((_, i) => <Cell key={i} fill={i === 0 ? '#a8834a' : '#4d3b28'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Top productos por venta (top 8)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={metrics.productArr} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e2dd" horizontal={false} />
              <XAxis type="number" stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${Math.round((v as number) / 1000)}k`} />
              <YAxis dataKey="name" type="category" stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} width={140} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e2dd', fontSize: 12 }} formatter={(v) => [formatCLP(v as number), 'Ventas']} />
              <Bar dataKey="clp" fill="#7a5f42" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {metrics.deltaLines.length > 0 && (
        <section className="mb-6">
          <p className="eyebrow mb-2">Diferencia peso empacado vs vendido</p>
          <div className="card divide-y divide-charcoal-100">
            {metrics.deltaLines.map((d) => {
              const diff = d.packed - d.sold;
              return (
                <div key={`${d.orderId}-${d.productName}`} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="text-charcoal-700 font-medium truncate">{d.productName}</div>
                    <div className="text-xs text-charcoal-300 truncate">
                      <span className="font-mono">{d.orderId}</span> · {d.formatLabel}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-charcoal-300">Vendido {d.sold.toFixed(1)} kg</div>
                    <div className={'text-sm font-semibold ' + (diff < 0 ? 'text-red-700' : 'text-brass-700')}>
                      Empacado {d.packed.toFixed(1)} kg
                      <span className="ml-2 text-[10px] uppercase tracking-display">
                        ({diff > 0 ? '+' : ''}{diff.toFixed(1)})
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {isSuperAdmin && (
        <section className="mt-8 pt-6 border-t border-charcoal-100">
          <div className="card p-4 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="eyebrow">Solo Super Administrador</p>
              <h3 className="text-base font-semibold text-charcoal-900 tracking-display uppercase mt-0.5">Sincronizar con Bsale</h3>
              <p className="text-xs text-charcoal-300 mt-1">
                Simulado. Muestra los payloads que se enviarían para los pedidos con documento emitido.
              </p>
            </div>
            <Button onClick={syncBsale} disabled={syncing}>
              {syncing ? 'Preparando…' : 'Sincronizar'}
            </Button>
          </div>
        </section>
      )}

      {syncModal && (
        <div className="fixed inset-0 z-20 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-2xl bg-cream-50 rounded-t-xl sm:rounded-xl shadow-lift p-5 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="eyebrow">Simulado</p>
                <h2 className="text-lg font-semibold text-charcoal-900 tracking-display uppercase mt-0.5">Payload Bsale</h2>
              </div>
              <button onClick={() => setSyncModal(null)} className="text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center">×</button>
            </div>
            <pre className="rounded-md bg-charcoal-900 text-cream-100 text-[11px] leading-relaxed p-3 overflow-auto flex-1">
{JSON.stringify(syncModal.payload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, sublabel, tone }: { label: string; value: number | string; sublabel?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className={'card p-4 ' + (tone === 'warn' ? 'border-brass-300' : '')}>
      <p className="eyebrow">{label}</p>
      <p className={'text-3xl font-semibold mt-1 tracking-display ' + (tone === 'warn' ? 'text-brass-700' : 'text-charcoal-900')}>
        {value}
      </p>
      {sublabel && <p className="text-[11px] text-charcoal-300 mt-1 uppercase tracking-display">{sublabel}</p>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <p className="eyebrow mb-3">{title}</p>
      {children}
    </div>
  );
}

function RangeChip({ range, current, setRange, children }: { range: Range; current: Range; setRange: (r: Range) => void; children: React.ReactNode }) {
  const active = range === current;
  return (
    <button
      onClick={() => setRange(range)}
      className={
        'rounded-md px-3 py-1.5 text-xs uppercase tracking-display font-medium border transition ' +
        (active
          ? 'bg-charcoal-900 border-charcoal-900 text-cream-50'
          : 'bg-white border-charcoal-200 text-charcoal-500 hover:border-charcoal-300')
      }
    >
      {children}
    </button>
  );
}

