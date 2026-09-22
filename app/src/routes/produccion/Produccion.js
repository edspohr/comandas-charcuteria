import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import Stepper from '@/components/ui/Stepper';
import { useCurrentUser } from '@/data/auth';
import { needsProduction, registrarProduccion, useProductsForProduccion, useProduccionData, } from '@/data/produccion';
import { formatDateShort, formatQty } from '@/lib/format';
export default function Produccion() {
    const { current } = useCurrentUser();
    const uid = current.appUser.uid;
    const { rows, loading } = useProduccionData();
    const products = useProductsForProduccion();
    const [selectedKey, setSelectedKey] = useState(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const urgent = useMemo(() => needsProduction(rows), [rows]);
    const others = useMemo(() => rows.filter((r) => r.toProduce <= 0), [rows]);
    const selected = useMemo(() => rows.find((r) => `${r.productId}::${r.formatId}` === selectedKey) ?? null, [rows, selectedKey]);
    return (_jsxs("div", { children: [_jsxs("header", { className: "mb-6 flex items-end justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Producci\u00F3n" }), _jsx("h1", { className: "text-2xl font-semibold text-charcoal-900 tracking-display uppercase", children: "Demanda y stock" })] }), _jsx(Button, { size: "md", onClick: () => setDialogOpen(true), children: "Registrar producci\u00F3n" })] }), loading && _jsx("p", { className: "text-sm text-charcoal-300", children: "Cargando\u2026" }), !loading && (_jsxs("div", { className: "space-y-6", children: [_jsxs("section", { children: [_jsxs("div", { className: "flex items-baseline gap-2 mb-2", children: [_jsx("p", { className: "eyebrow", children: "Con demanda pendiente" }), _jsxs("span", { className: "text-[10px] text-charcoal-300", children: ["(", urgent.length, ")"] })] }), urgent.length === 0 ? (_jsx("div", { className: "card p-6 text-center", children: _jsx("p", { className: "text-sm text-charcoal-500", children: "Sin producci\u00F3n pendiente." }) })) : (_jsx("ul", { className: "space-y-2", children: urgent.map((r) => (_jsx("li", { children: _jsx(DemandCard, { row: r, isSelected: selectedKey === `${r.productId}::${r.formatId}`, onToggle: () => setSelectedKey((k) => (k === `${r.productId}::${r.formatId}` ? null : `${r.productId}::${r.formatId}`)) }) }, `${r.productId}::${r.formatId}`))) }))] }), others.length > 0 && (_jsxs("section", { children: [_jsxs("div", { className: "flex items-baseline gap-2 mb-2", children: [_jsx("p", { className: "eyebrow", children: "Cobertura actual" }), _jsxs("span", { className: "text-[10px] text-charcoal-300", children: ["(", others.length, ")"] })] }), _jsx("ul", { className: "space-y-1.5", children: others.map((r) => (_jsx("li", { children: _jsx(CoverageCard, { row: r }) }, `${r.productId}::${r.formatId}`))) })] }))] })), dialogOpen && (_jsx(RegistrarDialog, { products: products, uid: uid, initialSelection: selected ?? undefined, onClose: () => setDialogOpen(false) }))] }));
}
function DemandCard({ row, isSelected, onToggle, }) {
    return (_jsxs("button", { onClick: onToggle, className: 'block w-full text-left card p-4 transition hover:border-brass-500 hover:shadow-lift ' +
            (isSelected ? 'border-brass-500 shadow-lift' : ''), children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "eyebrow", children: row.formatLabel }), _jsx("p", { className: "font-semibold text-charcoal-900 mt-0.5", children: row.productName })] }), _jsxs("div", { className: "text-right shrink-0", children: [_jsx("p", { className: "eyebrow", children: "A producir" }), _jsx("p", { className: "text-2xl font-semibold text-brass-700 mt-0.5", children: formatQty(row.toProduce, row.unit) })] })] }), _jsxs("div", { className: "grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-charcoal-100 text-center", children: [_jsx(StatCell, { label: "En bodega", value: formatQty(row.onHand, row.unit) }), _jsx(StatCell, { label: "Reservado", value: formatQty(row.reserved, row.unit) }), _jsx(StatCell, { label: "Disponible", value: formatQty(row.available, row.unit) })] }), isSelected && row.affectingOrders.length > 0 && (_jsxs("div", { className: "mt-3 pt-3 border-t border-charcoal-100", children: [_jsx("p", { className: "eyebrow mb-1.5", children: "Pedidos que dependen" }), _jsx("ul", { className: "space-y-1", children: row.affectingOrders.map((a) => (_jsxs("li", { className: "text-xs flex items-center justify-between gap-2", children: [_jsxs("span", { className: "text-charcoal-500 truncate", children: [_jsx("span", { className: "font-mono text-charcoal-300", children: a.orderId }), " \u00B7 ", a.clientName] }), _jsxs("span", { className: "text-charcoal-700 shrink-0 first-letter:uppercase", children: [formatDateShort(a.requestedDate), a.pendingProductionQty > 0 && (_jsxs("span", { className: "ml-2 text-brass-700", children: ["+", formatQty(a.pendingProductionQty, row.unit)] }))] })] }, `${a.orderId}-${row.formatId}`))) })] }))] }));
}
function CoverageCard({ row }) {
    return (_jsxs("div", { className: "card px-4 py-2.5 flex items-center justify-between gap-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-sm text-charcoal-700 font-medium truncate", children: row.productName }), _jsx("p", { className: "text-xs text-charcoal-300 truncate", children: row.formatLabel })] }), _jsxs("div", { className: "text-right shrink-0 text-xs", children: [_jsxs("p", { className: "text-charcoal-700", children: [_jsx("span", { className: "text-charcoal-300", children: "Disp." }), " ", formatQty(row.available, row.unit)] }), _jsxs("p", { className: "text-charcoal-300", children: ["Reserv. ", formatQty(row.reserved, row.unit)] })] })] }));
}
function StatCell({ label, value }) {
    return (_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: label }), _jsx("p", { className: "text-sm font-semibold text-charcoal-700 mt-0.5", children: value })] }));
}
// ---------- Registrar Producción dialog ----------
function RegistrarDialog({ products, uid, initialSelection, onClose, }) {
    const [productId, setProductId] = useState(initialSelection?.productId ?? products[0]?.id ?? '');
    const product = products.find((p) => p.id === productId);
    const [formatId, setFormatId] = useState(initialSelection?.formatId ?? (product?.formats[0]?.formatId ?? ''));
    const format = product?.formats.find((f) => f.formatId === formatId);
    const [qty, setQty] = useState(0);
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    async function submit() {
        if (!product || !format || qty <= 0) {
            setError('Elija producto, formato y cantidad');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const r = await registrarProduccion(product.id, format.formatId, qty, uid, reason || undefined);
            setResult(r);
        }
        catch (e) {
            setError(e.message);
            setSubmitting(false);
        }
    }
    return (_jsx("div", { className: "fixed inset-0 z-20 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4", children: _jsxs("div", { className: "w-full max-w-md bg-cream-50 rounded-t-xl sm:rounded-xl shadow-lift p-5 max-h-[90vh] overflow-y-auto", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Producci\u00F3n" }), _jsx("h2", { className: "text-lg font-semibold text-charcoal-900 tracking-display uppercase mt-0.5", children: "Registrar" })] }), _jsx("button", { onClick: onClose, className: "text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center", children: "\u00D7" })] }), result ? (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm", children: ["Producci\u00F3n registrada. ", result.absorbed > 0 && `Reasignadas ${formatQty(result.absorbed, format?.unit ?? 'unidad')} a pedidos pendientes.`] }), result.promoted.length > 0 && (_jsxs("div", { children: [_jsx("p", { className: "eyebrow mb-1", children: "Pedidos promovidos a confirmado" }), _jsx("ul", { className: "text-xs space-y-0.5", children: result.promoted.map((id) => (_jsx("li", { className: "font-mono text-charcoal-700", children: id }, id))) })] })), _jsx(Button, { onClick: onClose, className: "w-full", children: "Cerrar" })] })) : (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Producto" }), _jsx("select", { value: productId, onChange: (e) => {
                                        setProductId(e.target.value);
                                        const next = products.find((p) => p.id === e.target.value);
                                        setFormatId(next?.formats[0]?.formatId ?? '');
                                    }, className: "field", children: products.map((p) => (_jsx("option", { value: p.id, children: p.name }, p.id))) })] }), _jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Formato" }), _jsx("select", { value: formatId, onChange: (e) => setFormatId(e.target.value), className: "field", children: product?.formats.map((f) => (_jsx("option", { value: f.formatId, children: f.label }, f.formatId))) })] }), _jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Cantidad producida" }), _jsx(Stepper, { value: qty, onChange: setQty, step: format?.unit === 'kg' ? 0.5 : 1, decimals: format?.unit === 'kg' ? 2 : 0, quick: format?.unit === 'kg' ? [1, 5, 10] : [1, 5, 10, 25] })] }), _jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Motivo / lote (opcional)" }), _jsx("input", { value: reason, onChange: (e) => setReason(e.target.value), placeholder: "Ej: producci\u00F3n del turno ma\u00F1ana", className: "field h-10 text-sm" })] }), error && (_jsx("div", { className: "rounded-md bg-red-50 border border-red-200 text-red-800 p-3 text-sm", children: error })), _jsxs("div", { className: "flex gap-2 pt-2", children: [_jsx(Button, { variant: "secondary", onClick: onClose, className: "flex-1", children: "Cancelar" }), _jsx(Button, { onClick: submit, disabled: submitting || qty <= 0, className: "flex-1", children: submitting ? 'Registrando…' : 'Registrar' })] })] }))] }) }));
}
