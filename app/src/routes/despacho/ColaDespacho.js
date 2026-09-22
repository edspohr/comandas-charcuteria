import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '@/data/auth';
import { useDespachoQueue } from '@/data/orders';
import { formatDateShort, formatQty, todayInSantiago, addDaysIso } from '@/lib/format';
import StatusPill from '@/components/ui/StatusPill';
import { demoUsers } from '@/data/demo-users';
const PACKER_NAME = Object.fromEntries(demoUsers.filter((u) => u.role === 'despacho').map((u) => [u.uid, u.displayName]));
export default function ColaDespacho() {
    const { current } = useCurrentUser();
    const uid = current.appUser.uid;
    const { orders, loading } = useDespachoQueue();
    const [day, setDay] = useState('todos');
    const [owner, setOwner] = useState('todos');
    const today = todayInSantiago();
    const tomorrow = addDaysIso(today, 1);
    const filtered = useMemo(() => {
        return orders.filter((o) => {
            if (day === 'hoy' && o.requestedDate !== today)
                return false;
            if (day === 'manana' && o.requestedDate !== tomorrow)
                return false;
            if (owner === 'mias' && o.assignedPackerId !== uid)
                return false;
            if (owner === 'sin_asignar' && !!o.assignedPackerId)
                return false;
            return true;
        });
    }, [orders, day, owner, today, tomorrow, uid]);
    return (_jsxs("div", { children: [_jsxs("header", { className: "mb-6", children: [_jsx("p", { className: "eyebrow", children: "Despacho" }), _jsx("h1", { className: "text-2xl font-semibold text-charcoal-900 tracking-display uppercase", children: "Cola de despacho" })] }), _jsxs("section", { className: "mb-4 flex flex-col gap-2", children: [_jsxs(FilterRow, { label: "Fecha", children: [_jsx(FilterChip, { active: day === 'hoy', onClick: () => setDay('hoy'), children: "Hoy" }), _jsx(FilterChip, { active: day === 'manana', onClick: () => setDay('manana'), children: "Ma\u00F1ana" }), _jsx(FilterChip, { active: day === 'todos', onClick: () => setDay('todos'), children: "Todos" })] }), _jsxs(FilterRow, { label: "Asignaci\u00F3n", children: [_jsx(FilterChip, { active: owner === 'todos', onClick: () => setOwner('todos'), children: "Todos" }), _jsx(FilterChip, { active: owner === 'mias', onClick: () => setOwner('mias'), children: "M\u00EDos" }), _jsx(FilterChip, { active: owner === 'sin_asignar', onClick: () => setOwner('sin_asignar'), children: "Sin asignar" })] })] }), loading && _jsx("p", { className: "text-sm text-charcoal-300", children: "Cargando\u2026" }), !loading && filtered.length === 0 && (_jsxs("div", { className: "card p-8 text-center", children: [_jsx("p", { className: "eyebrow mb-2", children: "Vac\u00EDo" }), _jsx("p", { className: "text-sm text-charcoal-500", children: "Nada por armar con estos filtros." })] })), _jsx("ul", { className: "space-y-2", children: filtered.map((o) => (_jsx("li", { children: _jsx(QueueCard, { order: o, currentUid: uid }) }, o.id))) })] }));
}
function FilterRow({ label, children }) {
    return (_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "eyebrow shrink-0 w-20", children: label }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: children })] }));
}
function FilterChip({ active, onClick, children }) {
    return (_jsx("button", { onClick: onClick, className: 'rounded-md px-3 py-1.5 text-xs uppercase tracking-display font-medium border transition ' +
            (active
                ? 'bg-charcoal-900 border-charcoal-900 text-cream-50'
                : 'bg-white border-charcoal-200 text-charcoal-500 hover:border-charcoal-300'), children: children }));
}
function QueueCard({ order, currentUid }) {
    const totalLines = order.lines.length;
    const anyPending = order.lines.some((l) => l.pendingProductionQty > 0);
    const mine = order.assignedPackerId === currentUid;
    const packerName = order.assignedPackerId ? PACKER_NAME[order.assignedPackerId] ?? 'Otro' : null;
    return (_jsxs(Link, { to: `/despacho/cola/${order.id}`, className: "block card p-4 hover:border-brass-500 hover:shadow-lift transition", children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "font-mono text-[11px] text-charcoal-300 uppercase tracking-display", children: order.id }), _jsx(StatusPill, { status: order.status }), anyPending && (_jsx("span", { className: "text-[10px] uppercase tracking-display text-brass-700", children: "\u00B7 parte a producci\u00F3n" }))] }), _jsx("p", { className: "font-semibold text-charcoal-900 mt-1 truncate", children: order.clientSnapshot.fantasyName ?? order.clientSnapshot.name }), _jsxs("p", { className: "text-xs text-charcoal-300 mt-0.5", children: [totalLines, " ", totalLines === 1 ? 'línea' : 'líneas', " \u00B7 ", order.deliveryMode === 'retiro' ? 'Retiro' : 'Despacho'] })] }), _jsxs("div", { className: "text-right shrink-0", children: [_jsx("p", { className: "eyebrow", children: "Solicitado" }), _jsx("p", { className: "text-sm font-semibold text-charcoal-900 mt-0.5 first-letter:uppercase", children: formatDateShort(order.requestedDate) }), packerName && (_jsx("p", { className: 'text-[10px] uppercase tracking-display mt-1 ' + (mine ? 'text-brass-700 font-semibold' : 'text-charcoal-300'), children: mine ? 'Míos' : `Asignado ${packerName}` }))] })] }), _jsxs("ul", { className: "mt-3 pt-3 border-t border-charcoal-100 space-y-1", children: [order.lines.slice(0, 3).map((l) => (_jsxs("li", { className: "flex items-center justify-between gap-2 text-xs", children: [_jsxs("span", { className: "text-charcoal-500 truncate", children: [l.productName, " \u00B7 ", l.formatLabel] }), _jsx("span", { className: "text-charcoal-700 font-medium shrink-0", children: formatQty(l.qty, l.unit) })] }, `${l.productId}-${l.formatId}`))), totalLines > 3 && _jsxs("li", { className: "text-[11px] text-charcoal-300", children: ["+ ", totalLines - 3, " m\u00E1s"] })] })] }));
}
