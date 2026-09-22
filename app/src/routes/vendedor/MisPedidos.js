import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCurrentUser } from '@/data/auth';
import { useMyOrders } from '@/data/orders';
import StatusPill from '@/components/ui/StatusPill';
import { formatDateShort, formatQty } from '@/lib/format';
const ACTIVE = ['recibido', 'confirmado', 'confirmado_parcial', 'en_armado', 'armado', 'facturado', 'despachado'];
export default function MisPedidos() {
    const { current } = useCurrentUser();
    const uid = current.appUser.uid;
    const { orders, loading } = useMyOrders(uid);
    const [group, setGroup] = useState('activos');
    const location = useLocation();
    const flash = location.state;
    const filtered = useMemo(() => {
        if (group === 'activos')
            return orders.filter((o) => ACTIVE.includes(o.status));
        return orders.filter((o) => o.status === 'entregado' || o.status === 'anulado');
    }, [orders, group]);
    return (_jsxs("div", { children: [_jsxs("header", { className: "mb-6", children: [_jsx("p", { className: "eyebrow", children: "Vendedor" }), _jsx("h1", { className: "text-2xl font-semibold text-charcoal-900 tracking-display uppercase", children: "Mis pedidos" })] }), flash?.justCreated && (_jsxs("div", { className: "rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm mb-4", children: ["Pedido ", _jsx("span", { className: "font-mono", children: flash.justCreated }), " creado \u2014 estado ", _jsx("strong", { children: flash.status }), ".", flash.parcialLines && flash.parcialLines.length > 0 && (_jsx("ul", { className: "mt-2 text-xs list-disc pl-4", children: flash.parcialLines.map((p, i) => (_jsxs("li", { children: [p.productName, " \u00B7 ", p.formatLabel, ": ", p.missing, " a producci\u00F3n"] }, i))) }))] })), _jsx("nav", { className: "mb-4 flex gap-1 border-b border-charcoal-100", children: ['activos', 'historial'].map((g) => (_jsx("button", { onClick: () => setGroup(g), className: 'px-4 py-2.5 text-xs uppercase tracking-display font-medium border-b-2 transition -mb-px ' +
                        (g === group
                            ? 'border-brass-500 text-charcoal-900'
                            : 'border-transparent text-charcoal-300 hover:text-charcoal-500 hover:border-charcoal-200'), children: g === 'activos' ? 'Activos' : 'Historial' }, g))) }), loading && _jsx("p", { className: "text-sm text-charcoal-300", children: "Cargando\u2026" }), !loading && filtered.length === 0 && (_jsx("div", { className: "card p-8 text-center", children: _jsx("p", { className: "text-sm text-charcoal-500", children: "Sin pedidos." }) })), _jsx("ul", { className: "space-y-2", children: filtered.map((o) => (_jsx("li", { children: _jsx(OrderCard, { order: o }) }, o.id))) })] }));
}
function OrderCard({ order }) {
    const anyPending = order.lines.some((l) => l.pendingProductionQty > 0);
    return (_jsxs(Link, { to: `/vendedor/mis/${order.id}`, className: "block card p-4 hover:border-brass-500 hover:shadow-lift transition", children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "font-mono text-[11px] text-charcoal-300 uppercase tracking-display", children: order.id }), _jsx(StatusPill, { status: order.status }), order.invoiceRef && _jsx("span", { className: "font-mono text-[11px] text-charcoal-500", children: order.invoiceRef }), anyPending && _jsx("span", { className: "text-[10px] uppercase tracking-display text-brass-700", children: "\u00B7 parte a producci\u00F3n" })] }), _jsx("p", { className: "font-semibold text-charcoal-900 mt-1 truncate", children: order.clientSnapshot.fantasyName ?? order.clientSnapshot.name }), _jsxs("p", { className: "text-xs text-charcoal-300 mt-0.5", children: [order.lines.length, " ", order.lines.length === 1 ? 'línea' : 'líneas'] })] }), _jsxs("div", { className: "text-right shrink-0", children: [_jsx("p", { className: "eyebrow", children: "Solicitado" }), _jsx("p", { className: "text-sm font-semibold text-charcoal-900 mt-0.5 first-letter:uppercase", children: formatDateShort(order.requestedDate) })] })] }), _jsxs("ul", { className: "mt-3 pt-3 border-t border-charcoal-100 space-y-1", children: [order.lines.slice(0, 3).map((l) => (_jsxs("li", { className: "flex items-center justify-between gap-2 text-xs", children: [_jsxs("span", { className: "text-charcoal-500 truncate", children: [l.productName, " \u00B7 ", l.formatLabel] }), _jsx("span", { className: "text-charcoal-700 font-medium shrink-0", children: formatQty(l.qty, l.unit) })] }, `${l.productId}-${l.formatId}`))), order.lines.length > 3 && _jsxs("li", { className: "text-[11px] text-charcoal-300", children: ["+ ", order.lines.length - 3, " m\u00E1s"] })] })] }));
}
