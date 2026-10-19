import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '@/data/firebase';
import Button from '@/components/ui/Button';
import { formatCLP } from '@/lib/pricing';

// "Su mes en números": el grupo de WhatsApp de pedidos (15-09 → 18-10-2026)
// medido. Lo calcula scripts/import-whatsapp.ts y lo deja en
// insights/whatsapp. Es la apertura de la demo: primero el caos con sus
// propias frases, después el mismo mes ordenado en Comandas.

interface Quote { author: string; ts: string; quote: string }
export interface WhatsappInsights {
  period: { from: string; to: string };
  messages: number;
  orders: number;
  cancelled: number;
  clients: number;
  newClients: number;
  sellers: Array<{ name: string; orders: number }>;
  byHour: number[];
  offHours: number;
  lines: number;
  linesWithIssue: number;
  linesWithoutQty: number;
  ordersWithoutDate: number;
  ordersWithoutClient?: number;
  ordersWithBilling: number;
  readyWithoutReference: number;
  storeLists: number;
  consumptions: number;
  estimatedCLP: number;
  kg: number;
  friction: Array<{ key: string; label: string; count: number; quotes: Quote[] }>;
  upcoming: Array<{ id: string; client: string; date: string; seller: string; summary: string }>;
  topClients: Array<{ name: string; orders: number }>;
  topProducts: Array<{ name: string; times: number }>;
}

const GOLD = '#a8834a';
const MUTED = '#c4bfb7';
const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });

export default function SuMes() {
  const [d, setD] = useState<WhatsappInsights | null | undefined>(undefined);
  useEffect(() => onSnapshot(doc(db, 'insights', 'whatsapp'), (s) => setD((s.data() as WhatsappInsights | undefined) ?? null), () => setD(null)), []);

  if (d === undefined) return <p className="text-sm text-charcoal-300">Cargando…</p>;
  if (d === null) return <div className="card p-6 text-sm text-charcoal-500">Todavía no se importa el historial de WhatsApp.</div>;

  const hours = d.byHour.map((n, h) => ({ h: `${h}`, n, off: h < 8 || h >= 20 }));
  const pctIssue = Math.round((d.linesWithIssue / Math.max(1, d.lines)) * 100);
  const pctBilling = Math.round((d.ordersWithBilling / Math.max(1, d.orders)) * 100);

  return (
    <div className="-mx-4 sm:-mx-6">
      {/* Hero */}
      <section className="bg-charcoal-900 text-cream-50 px-4 sm:px-6 py-10 -mt-4 sm:-mt-6">
        <p className="text-[11px] uppercase tracking-display text-brass-300 font-semibold">Su grupo de pedidos · {fmtDate(d.period.from)} al {fmtDate(d.period.to)}</p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-semibold leading-tight">Cinco semanas de pedidos,<br className="hidden sm:block" /> leídas mensaje por mensaje.</h1>
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Big n={d.messages.toLocaleString('es-CL')} label="mensajes" />
          <Big n={String(d.orders)} label="pedidos" />
          <Big n={String(d.clients)} label="clientes distintos" />
          <Big n={formatCLP(d.estimatedCLP)} label="valorizado a lista (estimado)" />
        </div>
      </section>

      <div className="px-4 sm:px-6 py-8 space-y-10">
        {/* Lo que se pierde */}
        <section>
          <p className="eyebrow text-brass-600">Lo que se pierde en el chat</p>
          <h2 className="mt-1 text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Todo pasa por una persona que lee</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {d.ordersWithoutClient
              ? <Stat n={`${Math.round((d.ordersWithoutClient / Math.max(1, d.orders)) * 100)}%`} label="de los pedidos no dicen para qué cliente son" sub={`${d.ordersWithoutClient} de ${d.orders} · más ${d.linesWithIssue} líneas ambiguas (${pctIssue}%)`} />
              : <Stat n={`${pctIssue}%`} label="de las líneas de pedido llegan incompletas o ambiguas" sub={`${d.linesWithIssue} de ${d.lines} · ${d.linesWithoutQty} sin cantidad`} />}
            <Stat n={String(d.readyWithoutReference)} label={'"Listo" sin decir de qué pedido'} sub="hay que adivinar cuál salió" />
            <Stat n={String(d.offHours)} label="mensajes antes de las 8:00 o después de las 20:00" sub="pedidos que nadie ve hasta el día siguiente" />
            <Stat n={`${100 - pctBilling}%`} label="de los pedidos sin datos para facturar" sub="RUT, giro y dirección se piden después" />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {d.friction.filter((f) => f.count > 0).map((f) => (
              <article key={f.key} className="card p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-semibold text-charcoal-900">{f.label}</h3>
                  <span className="text-2xl font-semibold text-brass-600 tabular-nums">{f.count}</span>
                </div>
                <ul className="mt-3 space-y-2">
                  {f.quotes.slice(0, 3).map((q, i) => (
                    <li key={i} className="border-l-2 border-brass-300 pl-3 text-sm text-charcoal-700">
                      “{q.quote}”
                      <span className="block text-[11px] text-charcoal-300 mt-0.5">{q.author} · {new Date(q.ts).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* Ritmo */}
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <p className="eyebrow mb-2">Mensajes por hora del día</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hours} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="h" stroke="#8b8177" fontSize={10} tickLine={false} axisLine={false} interval={1} />
                <YAxis stroke="#8b8177" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => [v, 'mensajes']} labelFormatter={(h) => `${h}:00`} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                <Bar dataKey="n" radius={[3, 3, 0, 0]}>{hours.map((x) => <Cell key={x.h} fill={x.off ? GOLD : MUTED} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-charcoal-500 mt-1">En dorado: fuera del horario de la planta.</p>
          </div>
          <div className="card p-4">
            <p className="eyebrow mb-2">Pedidos por persona</p>
            <ResponsiveContainer width="100%" height={Math.max(200, d.sellers.length * 26 + 10)}>
              <BarChart data={d.sellers} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={130} interval={0} stroke="#8b8177" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => [v, 'pedidos']} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                <Bar dataKey="orders" fill={GOLD} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <List title="Clientes que más pidieron" rows={d.topClients.map((c) => [c.name, `${c.orders} pedidos`])} />
          <List title="Lo más pedido" rows={d.topProducts.map((p) => [p.name, `${p.times} veces`])} />
        </section>

        {/* Lo que viene */}
        {d.upcoming.length > 0 && (
          <section>
            <p className="eyebrow text-brass-600">Ya comprometido</p>
            <h2 className="mt-1 text-2xl font-semibold text-charcoal-900 tracking-display uppercase">Lo que viene, en un solo lugar</h2>
            <ul className="mt-4 card divide-y divide-charcoal-100/70">
              {d.upcoming.map((u) => (
                <li key={u.id} className="px-4 py-3 flex flex-wrap justify-between gap-2 text-sm">
                  <span><span className="font-semibold text-charcoal-900">{u.client}</span> <span className="text-charcoal-500">· {u.summary}</span></span>
                  <span className="text-charcoal-500 whitespace-nowrap">{fmtDate(u.date)} · {u.seller}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Cierre */}
        <section className="rounded-xl bg-charcoal-900 text-cream-50 p-6 sm:p-8">
          <h2 className="text-2xl font-semibold">El mismo mes, ordenado.</h2>
          <p className="mt-2 text-cream-100/80 max-w-2xl text-sm">
            Cargamos los {d.orders} pedidos en Comandas con su cliente, su vendedor y sus productos. Así se ve cuando cada pedido tiene formato, estado y responsable.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/tablero"><Button>Ver el tablero</Button></Link>
            <Link to="/admin/panel?rango=30"><Button variant="secondary">Panel de dueños</Button></Link>
            <Link to="/clientes"><Button variant="secondary">Clientes y cartera</Button></Link>
            <Link to="/produccion"><Button variant="secondary">Lo que tiene que producir Yuri</Button></Link>
          </div>
          <p className="mt-4 text-[11px] text-cream-100/50">Valores estimados con la lista de precios de agosto; los estados de pedidos pasados se infieren de la fecha. Con Bsale conectado, las cifras pasan a ser las reales.</p>
        </section>
      </div>
    </div>
  );
}

function Big({ n, label }: { n: string; label: string }) {
  return <div className="rounded-lg border border-cream-100/15 bg-cream-50/[0.04] px-4 py-3"><p className="text-2xl sm:text-3xl font-semibold text-brass-300 tabular-nums">{n}</p><p className="text-xs text-cream-100/70 mt-0.5">{label}</p></div>;
}

function Stat({ n, label, sub }: { n: string; label: string; sub: string }) {
  return <div className="card p-4"><p className="text-3xl font-semibold text-charcoal-900 tabular-nums">{n}</p><p className="text-sm text-charcoal-700 mt-1">{label}</p><p className="text-[11px] text-charcoal-300 mt-1">{sub}</p></div>;
}

function List({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="card p-4">
      <p className="eyebrow mb-2">{title}</p>
      <ul className="divide-y divide-charcoal-100/70 text-sm">
        {rows.map(([a, b], i) => <li key={i} className="py-1.5 flex justify-between gap-3"><span className="text-charcoal-700 truncate">{a}</span><span className="text-charcoal-500 shrink-0">{b}</span></li>)}
      </ul>
    </div>
  );
}
