import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import { useCurrentUser } from '@/data/auth';
import { useClients } from '@/data/clients';
import { useProducts } from '@/data/products';
import { ajustarStock, availableFor, useAllStock } from '@/data/stock';
import { formatQty } from '@/lib/format';
const norm = (s) => s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');
export default function Catalogo() {
    const [tab, setTab] = useState('productos');
    return (_jsxs("div", { children: [_jsxs("header", { className: "mb-6", children: [_jsx("p", { className: "eyebrow", children: "Administraci\u00F3n" }), _jsx("h1", { className: "text-2xl font-semibold text-charcoal-900 tracking-display uppercase", children: "Cat\u00E1logo" })] }), _jsx("nav", { className: "mb-4 flex gap-1 border-b border-charcoal-100", children: ['productos', 'clientes'].map((t) => (_jsx("button", { onClick: () => setTab(t), className: 'px-4 py-2.5 text-xs uppercase tracking-display font-medium border-b-2 transition -mb-px ' +
                        (t === tab
                            ? 'border-brass-500 text-charcoal-900'
                            : 'border-transparent text-charcoal-300 hover:text-charcoal-500 hover:border-charcoal-200'), children: t === 'productos' ? 'Productos' : 'Clientes' }, t))) }), tab === 'productos' ? _jsx(ProductosTab, {}) : _jsx(ClientesTab, {})] }));
}
function ProductosTab() {
    const { current } = useCurrentUser();
    const uid = current.appUser.uid;
    const { products, loading } = useProducts();
    const { stock } = useAllStock();
    const [q, setQ] = useState('');
    const [adjust, setAdjust] = useState(null);
    const filtered = useMemo(() => {
        if (!q.trim())
            return products;
        const query = norm(q);
        return products.filter((p) => norm(p.name).includes(query) || (p.aliases ?? []).some((a) => norm(a).includes(query)));
    }, [products, q]);
    return (_jsxs("div", { children: [_jsx("input", { value: q, onChange: (e) => setQ(e.target.value), placeholder: "Buscar producto", className: "field mb-4" }), loading && _jsx("p", { className: "text-sm text-charcoal-300", children: "Cargando\u2026" }), _jsx("div", { className: "card divide-y divide-charcoal-100", children: filtered.map((p) => (_jsxs("details", { className: "group", children: [_jsxs("summary", { className: "p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-cream-100/40", children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "font-semibold text-charcoal-900", children: p.name }), p.discontinued && (_jsx("span", { className: "text-[10px] uppercase tracking-display bg-charcoal-100 text-charcoal-500 border border-charcoal-200 px-2 py-0.5 rounded", children: "Discontinuado" })), !p.active && (_jsx("span", { className: "text-[10px] uppercase tracking-display bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded", children: "Inactivo" }))] }), _jsxs("p", { className: "text-xs text-charcoal-300 mt-0.5", children: [p.category, " \u00B7 ", p.formats.length, " formato", p.formats.length === 1 ? '' : 's'] })] }), _jsx("span", { className: "text-charcoal-300 text-sm group-open:rotate-90 transition-transform", children: "\u203A" })] }), _jsx("div", { className: "border-t border-charcoal-100 divide-y divide-charcoal-100/70", children: p.formats.map((f) => {
                                const av = availableFor(stock, p.id, f.formatId);
                                const s = stock.get(`${p.id}__${f.formatId}`);
                                return (_jsxs("div", { className: "flex items-center justify-between gap-3 p-3 pl-6 text-sm", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-charcoal-700 font-medium", children: f.label }), _jsxs("p", { className: "text-[11px] text-charcoal-300 uppercase tracking-display mt-0.5", children: ["En bodega ", formatQty(s?.onHand ?? 0, f.unit), " \u00B7 Reserv. ", formatQty(s?.reserved ?? 0, f.unit)] })] }), _jsxs("div", { className: "flex items-center gap-3 shrink-0", children: [_jsx("span", { className: 'text-sm font-semibold ' + (av > 0 ? 'text-emerald-700' : 'text-red-700'), children: formatQty(av, f.unit) }), _jsx(Button, { size: "sm", variant: "secondary", onClick: () => setAdjust({ product: p, format: f }), children: "Ajustar" })] })] }, f.formatId));
                            }) })] }, p.id))) }), adjust && (_jsx(AjusteStockDialog, { product: adjust.product, format: adjust.format, current: stock.get(`${adjust.product.id}__${adjust.format.formatId}`)?.onHand ?? 0, uid: uid, onClose: () => setAdjust(null) }))] }));
}
function AjusteStockDialog({ product, format, current, uid, onClose, }) {
    const [newQty, setNewQty] = useState(current);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const delta = newQty - current;
    async function submit() {
        setBusy(true);
        setError(null);
        try {
            await ajustarStock(product.id, format.formatId, newQty, reason, uid);
            onClose();
        }
        catch (e) {
            setError(e.message);
            setBusy(false);
        }
    }
    return (_jsx("div", { className: "fixed inset-0 z-20 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4", children: _jsxs("div", { className: "w-full max-w-md bg-cream-50 rounded-t-xl sm:rounded-xl shadow-lift p-5", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Ajuste de stock" }), _jsx("h2", { className: "text-lg font-semibold text-charcoal-900 tracking-display uppercase mt-0.5", children: product.name }), _jsx("p", { className: "text-xs text-charcoal-300 mt-0.5", children: format.label })] }), _jsx("button", { onClick: onClose, className: "text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center", children: "\u00D7" })] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Actual" }), _jsx("p", { className: "text-lg font-semibold text-charcoal-700 mt-0.5", children: formatQty(current, format.unit) })] }), _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Nuevo" }), _jsx("input", { type: "number", inputMode: "decimal", step: format.unit === 'kg' ? '0.1' : '1', min: "0", value: Number.isFinite(newQty) ? newQty : 0, onChange: (e) => setNewQty(parseFloat(e.target.value)), className: "field h-10 text-sm mt-1" })] })] }), _jsxs("p", { className: 'text-xs uppercase tracking-display ' + (delta === 0 ? 'text-charcoal-300' : delta > 0 ? 'text-emerald-700' : 'text-brass-700'), children: ["Delta ", delta > 0 ? '+' : '', delta, " ", format.unit === 'kg' ? 'kg' : format.unit === 'g' ? 'g' : 'u'] }), _jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Motivo" }), _jsx("input", { value: reason, onChange: (e) => setReason(e.target.value), placeholder: "Ej: conteo mensual, merma, traslado a tienda\u2026", className: "field h-10 text-sm" })] }), error && _jsx("div", { className: "rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm", children: error }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "secondary", onClick: onClose, className: "flex-1", children: "Cancelar" }), _jsx(Button, { onClick: submit, disabled: busy || delta === 0, className: "flex-1", children: busy ? '…' : 'Guardar' })] })] })] }) }));
}
function ClientesTab() {
    const { clients, loading } = useClients();
    const [q, setQ] = useState('');
    const filtered = useMemo(() => {
        if (!q.trim())
            return clients;
        const query = norm(q);
        return clients.filter((c) => norm(c.name).includes(query) ||
            norm(c.fantasyName ?? '').includes(query) ||
            norm(c.rut ?? '').includes(query));
    }, [clients, q]);
    return (_jsxs("div", { children: [_jsx("input", { value: q, onChange: (e) => setQ(e.target.value), placeholder: "Buscar cliente", className: "field mb-4" }), loading && _jsx("p", { className: "text-sm text-charcoal-300", children: "Cargando\u2026" }), _jsx("ul", { className: "space-y-1.5", children: filtered.map((c) => (_jsxs("li", { className: "card p-3.5", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "font-semibold text-charcoal-900", children: c.fantasyName ?? c.name }), c.isInternalShop && (_jsx("span", { className: "text-[10px] uppercase tracking-display bg-charcoal-900 text-cream-50 px-2 py-0.5 rounded", children: "Tienda" })), !c.invoicingComplete && (_jsx("span", { className: "text-[10px] uppercase tracking-display bg-brass-100 text-brass-700 border border-brass-300 px-2 py-0.5 rounded", children: "Facturaci\u00F3n incompleta" }))] }), _jsxs("div", { className: "text-xs text-charcoal-300 mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5", children: [_jsx("span", { children: c.rut ?? 'Sin RUT' }), _jsx("span", { children: c.giro ?? 'Sin giro' }), _jsx("span", { className: "truncate", children: c.address ?? 'Sin dirección' }), c.receivingHours && _jsx("span", { children: c.receivingHours }), c.email && _jsx("span", { className: "truncate", children: c.email }), c.contactPhone && _jsx("span", { children: c.contactPhone })] }), c.notes && _jsx("p", { className: "text-xs text-charcoal-500 mt-1.5 italic", children: c.notes })] }, c.id))) })] }));
}
