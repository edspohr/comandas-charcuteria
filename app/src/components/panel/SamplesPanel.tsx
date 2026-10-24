import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/data/firebase';
import { useSampleFeedback } from '@/data/samples';
import { useUsers } from '@/data/users';
import { newClientsWon, purchasesFromOrders, sampleRows, SAMPLE_CONVERSION_DAYS, SAMPLE_FOLLOWUP_DAYS, SAMPLE_RESULT_LABEL, type Purchase, type SampleRow } from '@/domain/samples';
import { formatCLP } from '@/lib/pricing';
import type { Order } from '@/domain/types';
import { Metric, Table } from './PanelUI';

// Panel → Muestras: cuánto se regala, quién hace el seguimiento y qué
// termina en venta (compra del mismo producto por el mismo cliente dentro de
// 60 días de la entrega). Con Bsale real también cuentan las compras hechas
// fuera de Comandas (extraPurchases) y el costo sale del costo promedio.

type Range = '90' | '365';
const DAY = 86_400_000;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const dShort = (t: number | null) => (t ? new Date(t).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : '—');

export default function SamplesPanel({ extraPurchases = [], costOf }: { extraPurchases?: Purchase[]; costOf?: (r: SampleRow) => number | null }) {
  const [range, setRange] = useState<Range>('90');
  const [orders, setOrders] = useState<Order[]>([]);
  const feedback = useSampleFeedback();
  const { nameOf } = useUsers();

  useEffect(() => {
    // One year back plus the conversion window, so late purchases count.
    const since = Date.now() - (365 + SAMPLE_CONVERSION_DAYS) * DAY;
    return onSnapshot(query(collection(db, 'orders'), where('createdAt', '>=', since)), (s) => { const l: Order[] = []; s.forEach((d) => l.push(d.data() as Order)); setOrders(l); });
  }, []);

  // With Bsale sales available they are the source for anything invoiced;
  // Comandas orders only add what hasn't reached Bsale yet (no double count).
  const purchases = useMemo(() => {
    const open = extraPurchases.length ? orders.filter((o) => !['facturado', 'despachado', 'entregado'].includes(o.status)) : orders;
    return [...purchasesFromOrders(open), ...extraPurchases];
  }, [orders, extraPurchases]);
  const all = useMemo(() => sampleRows(orders, feedback, purchases), [orders, feedback, purchases]);
  const from = Date.now() - Number(range) * DAY;
  const rows = all.filter((r) => (r.deliveredAt ?? r.createdAt) >= from);
  const delivered = rows.filter((r) => r.deliveredAt);
  const due = delivered.filter((r) => r.dueAt && r.dueAt <= Date.now());
  const answered = due.filter((r) => r.stage === 'respondida');
  const converted = delivered.filter((r) => r.converted);
  const revenue = converted.reduce((s, r) => s + (r.converted?.revenue ?? 0), 0);
  const kg = delivered.reduce((s, r) => s + r.kg, 0);
  const costs = costOf ? delivered.map((r) => costOf(r)) : [];
  const cost = costs.reduce<number>((s, c) => s + (c ?? 0), 0);
  const costKnown = costs.filter((c) => c != null).length;

  // Prior purchases count even before the range, so use the whole history.
  const won = useMemo(() => newClientsWon(all, purchases).filter((w) => w.firstSampleAt >= from), [all, purchases, from]);
  const kgPerNew = won.length ? kg / won.length : null;
  const costPerNew = won.length && costOf && costKnown ? cost / won.length : null;
  const wonBySeller = new Map<string, number>(); for (const w of won) wonBySeller.set(w.sellerUid, (wonBySeller.get(w.sellerUid) ?? 0) + 1);
  const bySeller = useMemo(() => group(delivered, (r) => r.sellerUid, (r) => nameOf(r.sellerUid) || 'Sin vendedor', costOf).map((g) => {
    const nuevos = wonBySeller.get(g.key) ?? 0;
    const kgS = delivered.filter((r) => r.sellerUid === g.key).reduce((t, r) => t + r.kg, 0);
    return { ...g, nuevos, kgPorNuevo: nuevos ? kgS / nuevos : null };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [delivered, nameOf, costOf, won]);
  const byProduct = useMemo(() => group(delivered, (r) => r.productId, (r) => r.productName, costOf), [delivered, costOf]);
  const detail = rows.map((r) => ({
    ...r, seller: nameOf(r.sellerUid) || '—', delivered: dShort(r.deliveredAt),
    answer: r.feedback ? SAMPLE_RESULT_LABEL[r.feedback.result] + (r.feedback.note ? ` · ${r.feedback.note}` : '') : r.stage === 'por_seguir' ? `Pendiente (${r.daysOverdue} d de atraso)` : r.stage === 'esperando' ? 'Aún no toca' : 'En camino',
    bought: r.converted ? `${r.converted.ref} · ${dShort(r.converted.at)}` : '',
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {(['90', '365'] as Range[]).map((k) => (
          <button key={k} onClick={() => setRange(k)} className={'rounded-md px-3 py-1.5 text-xs uppercase tracking-display font-medium border ' + (range === k ? 'bg-charcoal-900 border-charcoal-900 text-cream-50' : 'bg-white border-charcoal-200 text-charcoal-500')}>{k === '90' ? '90 días' : '12 meses'}</button>
        ))}
        <p className="text-xs text-charcoal-500">Seguimiento a los {SAMPLE_FOLLOWUP_DAYS} días de la entrega · conversión = el cliente compra ese producto dentro de {SAMPLE_CONVERSION_DAYS} días.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
        <Metric label="Muestras entregadas" value={delivered.length} sub={`${rows.length - delivered.length} en camino`} />
        <Metric label="Kilos regalados" value={`${kg.toLocaleString('es-CL', { maximumFractionDigits: 1 })} kg`} />
        <Metric label="Costo" value={costOf ? (costKnown ? formatCLP(Math.round(cost)) : '—') : '—'} sub={costOf ? `costo conocido en ${pct(costKnown, delivered.length)}` : 'con Bsale real'} />
        <Metric label="Seguimiento hecho" value={pct(answered.length, due.length)} sub={`${due.length - answered.length} pendientes`} tone={due.length - answered.length > 0 ? 'warn' : undefined} />
        <Metric label="Conversión" value={pct(converted.length, delivered.length)} sub={`${converted.length} de ${delivered.length}`} />
        <Metric label="Venta generada" value={formatCLP(revenue)} sub={cost ? `${(revenue / cost).toLocaleString('es-CL', { maximumFractionDigits: 1 })}× el costo` : undefined} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        <Metric label="Clientes nuevos conseguidos" value={won.length} sub={`no compraban y compraron ≤ ${SAMPLE_CONVERSION_DAYS} días tras la muestra`} />
        <Metric label="Kg de muestra por cliente nuevo" value={kgPerNew == null ? '—' : `${kgPerNew.toLocaleString('es-CL', { maximumFractionDigits: 2 })} kg`} sub="kilos regalados ÷ clientes nuevos" />
        <Metric label="Costo por cliente nuevo" value={costPerNew == null ? '—' : formatCLP(Math.round(costPerNew))} sub={costOf ? 'a costo promedio Bsale' : 'con Bsale real'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Table title="Por vendedor" rows={bySeller} export={{ name: 'muestras-por-vendedor', rows: bySeller }}
          cols={[['name', 'Vendedor'], ['n', 'Entregadas'], ['nuevos', 'Clientes nuevos'], ['kgPorNuevo', 'Kg por nuevo', (v) => (v == null ? '—' : `${(v as number).toLocaleString('es-CL', { maximumFractionDigits: 2 })} kg`)], ['followed', 'Seguidas', (v, r) => pct(v as number, r.due as number)], ['conv', 'Convertidas', (v, r) => pct(v as number, r.n as number)], ['revenue', 'Venta', (v) => formatCLP(v as number)], ['cost', 'Costo', (v) => (v == null ? '—' : formatCLP(v as number))]]} />
        <Table title="Por producto" rows={byProduct} export={{ name: 'muestras-por-producto', rows: byProduct }}
          cols={[['name', 'Producto'], ['n', 'Entregadas'], ['liked', 'Les gustó'], ['conv', 'Convertidas', (v, r) => pct(v as number, r.n as number)], ['revenue', 'Venta', (v) => formatCLP(v as number)]]} />
      </div>
      <Table title="Muestras" rows={detail} max={100} export={{ name: 'muestras', rows: detail }}
        cols={[['clientName', 'Cliente'], ['productName', 'Producto'], ['label', 'Tamaño'], ['seller', 'Vendedor'], ['delivered', 'Entregada'], ['answer', 'Seguimiento'], ['bought', 'Compró']]}
        rowTone={(r) => (r.stage === 'por_seguir' ? 'warn' : undefined)} />
    </div>
  );
}

function group(rows: SampleRow[], keyOf: (r: SampleRow) => string, nameOf: (r: SampleRow) => string, costOf?: (r: SampleRow) => number | null) {
  const m = new Map<string, { key: string; name: string; n: number; due: number; followed: number; liked: number; conv: number; revenue: number; cost: number | null }>();
  const now = Date.now();
  for (const r of rows) {
    const k = keyOf(r);
    const g = m.get(k) ?? { key: k, name: nameOf(r), n: 0, due: 0, followed: 0, liked: 0, conv: 0, revenue: 0, cost: costOf ? 0 : null };
    g.n++;
    if (r.dueAt && r.dueAt <= now) { g.due++; if (r.stage === 'respondida') g.followed++; }
    if (r.feedback?.result === 'gusto' || r.feedback?.result === 'pidio') g.liked++;
    if (r.converted) { g.conv++; g.revenue += r.converted.revenue; }
    if (costOf && g.cost != null) g.cost += costOf(r) ?? 0;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}
