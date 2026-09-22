import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/data/firebase';
import Button from '@/components/ui/Button';
import { useCurrentUser } from '@/data/auth';
import { demoUsers } from '@/data/demo-users';
import { addDaysIso, todayInSantiago } from '@/lib/format';
import { bsale } from '@/integrations/bsale/MockBsaleClient';
const VENDEDOR_NAME = Object.fromEntries(demoUsers.filter((u) => u.role === 'vendedor').map((u) => [u.uid, u.displayName]));
// Convert a line's qty to a comparable kg number when possible.
// For kg-unit lines, qty is already in kg. For sachet formats we use grams
// metadata if present; otherwise 0 (we skip it in kg totals).
function toKg(line, gramsByFormat) {
    if (line.unit === 'kg')
        return line.qty;
    const g = gramsByFormat.get(`${line.productId}::${line.formatId}`);
    if (g == null)
        return 0;
    return (g * line.qty) / 1000;
}
function packedKg(line, gramsByFormat) {
    if (line.packedWeightKg != null)
        return line.packedWeightKg;
    const packed = line.packedQty ?? 0;
    if (line.unit === 'kg')
        return packed;
    const g = gramsByFormat.get(`${line.productId}::${line.formatId}`);
    if (g == null)
        return 0;
    return (g * packed) / 1000;
}
export default function Panel() {
    const { current } = useCurrentUser();
    const isSuperAdmin = current.appUser.role === 'superAdmin';
    const [range, setRange] = useState('7');
    const [orders, setOrders] = useState([]);
    const [gramsByFormat, setGramsByFormat] = useState(new Map());
    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'orders'), (snap) => {
            const list = [];
            snap.forEach((d) => list.push(d.data()));
            setOrders(list);
        });
        return unsub;
    }, []);
    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'products'), (snap) => {
            const m = new Map();
            snap.forEach((d) => {
                const p = d.data();
                for (const f of p.formats)
                    m.set(`${p.id}::${f.formatId}`, f.grams);
            });
            setGramsByFormat(m);
        });
        return unsub;
    }, []);
    const fromDate = useMemo(() => {
        if (range === 'all')
            return '2020-01-01';
        return addDaysIso(todayInSantiago(), -(range === '7' ? 7 : 30));
    }, [range]);
    const filtered = useMemo(() => orders.filter((o) => o.requestedDate >= fromDate), [orders, fromDate]);
    const metrics = useMemo(() => {
        let totalOrders = 0;
        let anuladas = 0;
        let incompleteInvoicing = 0;
        let pendingProductionSum = 0; // pending kg or units total (mixed; we show count of lines)
        let pendingProductionLines = 0;
        let deltaLines = [];
        let byVendedor = new Map();
        let byProduct = new Map();
        for (const o of filtered) {
            totalOrders++;
            if (o.status === 'anulado')
                anuladas++;
            if (!o.invoicingComplete)
                incompleteInvoicing++;
            const vName = VENDEDOR_NAME[o.createdBy] ?? o.createdBy;
            const v = byVendedor.get(vName) ?? { orders: 0, kg: 0 };
            v.orders++;
            let orderKg = 0;
            for (const l of o.lines) {
                if (l.pendingProductionQty > 0) {
                    pendingProductionLines++;
                    pendingProductionSum += l.pendingProductionQty;
                }
                const kg = toKg(l, gramsByFormat);
                orderKg += kg;
                const pByKey = byProduct.get(l.productId) ?? { name: l.productName, kg: 0 };
                pByKey.kg += kg;
                byProduct.set(l.productId, pByKey);
                // Delta packed vs sold — only when we have real packedWeightKg for a unidad line,
                // or when packedQty differs from qty on a kg line.
                if (l.packedQty != null) {
                    const sold = toKg(l, gramsByFormat);
                    const pk = packedKg(l, gramsByFormat);
                    if (sold > 0 && Math.abs(pk - sold) >= 0.1) {
                        deltaLines.push({
                            orderId: o.id,
                            productName: l.productName,
                            formatLabel: l.formatLabel,
                            sold,
                            packed: pk,
                        });
                    }
                }
            }
            v.kg += orderKg;
            byVendedor.set(vName, v);
        }
        const vendedorArr = [...byVendedor.entries()]
            .map(([name, v]) => ({ name, orders: v.orders, kg: Number(v.kg.toFixed(1)) }))
            .sort((a, b) => b.kg - a.kg);
        const productArr = [...byProduct.values()]
            .map((p) => ({ name: p.name, kg: Number(p.kg.toFixed(1)) }))
            .filter((p) => p.kg > 0)
            .sort((a, b) => b.kg - a.kg)
            .slice(0, 8);
        deltaLines.sort((a, b) => Math.abs(b.sold - b.packed) - Math.abs(a.sold - a.packed));
        deltaLines = deltaLines.slice(0, 5);
        return { totalOrders, anuladas, incompleteInvoicing, pendingProductionSum, pendingProductionLines, deltaLines, vendedorArr, productArr };
    }, [filtered, gramsByFormat]);
    const [syncModal, setSyncModal] = useState(null);
    async function syncBsale() {
        const openOrders = orders.filter((o) => o.status === 'facturado' || o.status === 'despachado');
        const payloads = [];
        for (const o of openOrders.slice(0, 20)) {
            const { docNumber, payload } = await bsale.createDocument(o).catch(() => ({ docNumber: '(no emitido)', payload: null }));
            payloads.push({ docNumber, order: o.id, payload });
        }
        setSyncModal({ payload: payloads });
    }
    return (_jsxs("div", { children: [_jsxs("header", { className: "mb-6 flex items-end justify-between gap-3 flex-wrap", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Administraci\u00F3n" }), _jsx("h1", { className: "text-2xl font-semibold text-charcoal-900 tracking-display uppercase", children: "Panel de due\u00F1os" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(RangeChip, { range: "7", current: range, setRange: setRange, children: "7 d\u00EDas" }), _jsx(RangeChip, { range: "30", current: range, setRange: setRange, children: "30 d\u00EDas" }), _jsx(RangeChip, { range: "all", current: range, setRange: setRange, children: "Todo" })] })] }), _jsxs("div", { className: "grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6", children: [_jsx(MetricCard, { label: "Pedidos", value: metrics.totalOrders, sublabel: metrics.anuladas > 0 ? `${metrics.anuladas} anulados` : undefined }), _jsx(MetricCard, { label: "Facturaci\u00F3n incompleta", value: metrics.incompleteInvoicing, tone: metrics.incompleteInvoicing > 0 ? 'warn' : 'ok' }), _jsx(MetricCard, { label: "L\u00EDneas a producci\u00F3n", value: metrics.pendingProductionLines, sublabel: metrics.pendingProductionSum > 0 ? `${metrics.pendingProductionSum} u/kg pendientes` : undefined }), _jsx(MetricCard, { label: "Delta empacado/vendido", value: metrics.deltaLines.length, sublabel: "l\u00EDneas con diferencia" })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6", children: [_jsx(ChartCard, { title: "Kg por vendedor", children: _jsx(ResponsiveContainer, { width: "100%", height: 220, children: _jsxs(BarChart, { data: metrics.vendedorArr, margin: { top: 8, right: 8, left: 0, bottom: 24 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#e5e2dd", vertical: false }), _jsx(XAxis, { dataKey: "name", stroke: "#8b8177", fontSize: 11, tickLine: false, axisLine: false, interval: 0, angle: -25, textAnchor: "end", dy: 4 }), _jsx(YAxis, { stroke: "#8b8177", fontSize: 11, tickLine: false, axisLine: false }), _jsx(Tooltip, { contentStyle: { borderRadius: 8, border: '1px solid #e5e2dd', fontSize: 12 }, formatter: (v) => [`${v} kg`, 'Kg'] }), _jsx(Bar, { dataKey: "kg", radius: [3, 3, 0, 0], children: metrics.vendedorArr.map((_, i) => _jsx(Cell, { fill: i === 0 ? '#a8834a' : '#4d3b28' }, i)) })] }) }) }), _jsx(ChartCard, { title: "Kg por producto (top 8)", children: _jsx(ResponsiveContainer, { width: "100%", height: 220, children: _jsxs(BarChart, { data: metrics.productArr, layout: "vertical", margin: { top: 8, right: 16, left: 0, bottom: 8 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#e5e2dd", horizontal: false }), _jsx(XAxis, { type: "number", stroke: "#8b8177", fontSize: 11, tickLine: false, axisLine: false }), _jsx(YAxis, { dataKey: "name", type: "category", stroke: "#8b8177", fontSize: 11, tickLine: false, axisLine: false, width: 130 }), _jsx(Tooltip, { contentStyle: { borderRadius: 8, border: '1px solid #e5e2dd', fontSize: 12 }, formatter: (v) => [`${v} kg`, 'Kg'] }), _jsx(Bar, { dataKey: "kg", fill: "#7a5f42", radius: [0, 3, 3, 0] })] }) }) })] }), metrics.deltaLines.length > 0 && (_jsxs("section", { className: "mb-6", children: [_jsx("p", { className: "eyebrow mb-2", children: "Diferencia peso empacado vs vendido" }), _jsx("div", { className: "card divide-y divide-charcoal-100", children: metrics.deltaLines.map((d) => {
                            const diff = d.packed - d.sold;
                            return (_jsxs("div", { className: "flex items-center justify-between gap-3 p-3 text-sm", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "text-charcoal-700 font-medium truncate", children: d.productName }), _jsxs("div", { className: "text-xs text-charcoal-300 truncate", children: [_jsx("span", { className: "font-mono", children: d.orderId }), " \u00B7 ", d.formatLabel] })] }), _jsxs("div", { className: "text-right shrink-0", children: [_jsxs("div", { className: "text-xs text-charcoal-300", children: ["Vendido ", d.sold.toFixed(1), " kg"] }), _jsxs("div", { className: 'text-sm font-semibold ' + (diff < 0 ? 'text-red-700' : 'text-brass-700'), children: ["Empacado ", d.packed.toFixed(1), " kg", _jsxs("span", { className: "ml-1 text-[10px] uppercase tracking-display", children: ["(", diff > 0 ? '+' : '', diff.toFixed(1), ")"] })] })] })] }, `${d.orderId}-${d.productName}`));
                        }) })] })), isSuperAdmin && (_jsx("section", { className: "mt-8 pt-6 border-t border-charcoal-100", children: _jsxs("div", { className: "card p-4 flex items-start justify-between gap-3 flex-wrap", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Solo Super Administrador" }), _jsx("h3", { className: "text-base font-semibold text-charcoal-900 tracking-display uppercase mt-0.5", children: "Sincronizar con Bsale" }), _jsx("p", { className: "text-xs text-charcoal-300 mt-1", children: "Simulado. Muestra los payloads que se enviar\u00EDan para pedidos facturados/despachados." })] }), _jsx(Button, { onClick: syncBsale, children: "Sincronizar" })] }) })), syncModal && (_jsx("div", { className: "fixed inset-0 z-20 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4", children: _jsxs("div", { className: "w-full max-w-2xl bg-cream-50 rounded-t-xl sm:rounded-xl shadow-lift p-5 max-h-[90vh] overflow-hidden flex flex-col", children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Simulado" }), _jsx("h2", { className: "text-lg font-semibold text-charcoal-900 tracking-display uppercase mt-0.5", children: "Payload Bsale" })] }), _jsx("button", { onClick: () => setSyncModal(null), className: "text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center", children: "\u00D7" })] }), _jsx("pre", { className: "rounded-md bg-charcoal-900 text-cream-100 text-[11px] leading-relaxed p-3 overflow-auto flex-1", children: JSON.stringify(syncModal.payload, null, 2) })] }) }))] }));
}
function MetricCard({ label, value, sublabel, tone }) {
    return (_jsxs("div", { className: 'card p-4 ' + (tone === 'warn' ? 'border-brass-300' : ''), children: [_jsx("p", { className: "eyebrow", children: label }), _jsx("p", { className: 'text-3xl font-semibold mt-1 tracking-display ' + (tone === 'warn' ? 'text-brass-700' : 'text-charcoal-900'), children: value }), sublabel && _jsx("p", { className: "text-[11px] text-charcoal-300 mt-1 uppercase tracking-display", children: sublabel })] }));
}
function ChartCard({ title, children }) {
    return (_jsxs("div", { className: "card p-4", children: [_jsx("p", { className: "eyebrow mb-3", children: title }), children] }));
}
function RangeChip({ range, current, setRange, children }) {
    const active = range === current;
    return (_jsx("button", { onClick: () => setRange(range), className: 'rounded-md px-3 py-1.5 text-xs uppercase tracking-display font-medium border transition ' +
            (active
                ? 'bg-charcoal-900 border-charcoal-900 text-cream-50'
                : 'bg-white border-charcoal-200 text-charcoal-500 hover:border-charcoal-300'), children: children }));
}
