import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/ui/Button';
import StatusPill from '@/components/ui/StatusPill';
import { useCurrentUser } from '@/data/auth';
import { anularOrder, useOrder } from '@/data/orders';
import { demoUsers } from '@/data/demo-users';
import { formatDateLong, formatQty } from '@/lib/format';
import { ORDER_STATUS_LABEL } from '@/domain/types';
const NAME_BY_UID = Object.fromEntries(demoUsers.map((u) => [u.uid, u.displayName]));
const CANCELLABLE = ['recibido', 'confirmado', 'confirmado_parcial', 'en_armado'];
export default function DetallePedido() {
    const { orderId } = useParams();
    const navigate = useNavigate();
    const { current } = useCurrentUser();
    const uid = current.appUser.uid;
    const { order, loading } = useOrder(orderId ?? null);
    const [anularOpen, setAnularOpen] = useState(false);
    if (loading || !order)
        return _jsx("p", { className: "text-sm text-charcoal-300", children: "Cargando\u2026" });
    const isMine = order.createdBy === uid;
    const canAnular = isMine && CANCELLABLE.includes(order.status);
    return (_jsxs("div", { className: "max-w-2xl mx-auto", children: [_jsx("div", { className: "mb-4", children: _jsx(Link, { to: "/vendedor/mis", className: "text-[11px] uppercase tracking-display text-charcoal-300 hover:text-charcoal-700", children: "\u2190 Mis pedidos" }) }), _jsxs("header", { className: "mb-5", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "font-mono text-[11px] text-charcoal-300 uppercase tracking-display", children: order.id }), _jsx(StatusPill, { status: order.status }), order.invoiceRef && _jsx("span", { className: "font-mono text-[11px] text-charcoal-500", children: order.invoiceRef }), !order.invoicingComplete && (_jsx("span", { className: "text-[10px] uppercase tracking-display bg-brass-100 text-brass-700 border border-brass-300 px-2 py-0.5 rounded", children: "Facturaci\u00F3n incompleta" }))] }), _jsx("h1", { className: "text-xl font-semibold text-charcoal-900 tracking-display uppercase mt-1", children: order.clientSnapshot.fantasyName ?? order.clientSnapshot.name }), _jsxs("p", { className: "text-xs text-charcoal-300 mt-1 first-letter:uppercase", children: ["Solicitado para ", formatDateLong(order.requestedDate), " \u00B7 ", order.deliveryMode === 'retiro' ? 'Retiro en tienda' : (order.deliveryAddress ?? 'Despacho')] }), order.receivingHours && (_jsxs("p", { className: "text-xs text-charcoal-300", children: ["Horario \u00B7 ", order.receivingHours] }))] }), _jsxs("div", { className: "card mb-4", children: [_jsx("div", { className: "p-4", children: _jsx("p", { className: "eyebrow", children: "L\u00EDneas" }) }), _jsx("ul", { className: "divide-y divide-charcoal-100", children: order.lines.map((l) => (_jsx("li", { className: "p-4", children: _jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "font-semibold text-charcoal-900", children: l.productName }), _jsx("p", { className: "text-xs text-charcoal-300 mt-0.5", children: l.formatLabel }), l.notes && _jsx("p", { className: "text-xs text-charcoal-500 mt-1 italic", children: l.notes })] }), _jsxs("div", { className: "text-right shrink-0", children: [_jsx("p", { className: "eyebrow", children: "Cantidad" }), _jsx("p", { className: "font-semibold text-charcoal-700 mt-0.5", children: formatQty(l.qty, l.unit) }), l.pendingProductionQty > 0 && (_jsxs("p", { className: "text-[10px] uppercase tracking-display text-brass-700 mt-1", children: [formatQty(l.pendingProductionQty, l.unit), " a producci\u00F3n"] })), l.packedQty != null && (_jsxs("p", { className: "text-[10px] uppercase tracking-display text-charcoal-500 mt-1", children: ["Empacado ", formatQty(l.packedQty, l.unit), l.packedWeightKg != null && _jsxs("span", { children: [" \u00B7 ", l.packedWeightKg, " kg reales"] })] }))] })] }) }, `${l.productId}-${l.formatId}`))) })] }), _jsxs("div", { className: "card p-4 mb-4", children: [_jsx("p", { className: "eyebrow mb-2", children: "Historial" }), _jsx("ol", { className: "space-y-1.5", children: order.statusHistory.map((h, i) => (_jsxs("li", { className: "flex items-center justify-between gap-2 text-xs", children: [_jsx("span", { className: "text-charcoal-700 font-medium tracking-[0.02em]", children: ORDER_STATUS_LABEL[h.status] }), _jsxs("span", { className: "text-charcoal-300 text-right", children: [NAME_BY_UID[h.by] ?? h.by, " \u00B7 ", new Date(h.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }), h.note && _jsx("span", { className: "block text-charcoal-500 italic", children: h.note })] })] }, i))) })] }), canAnular && (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "danger", onClick: () => setAnularOpen(true), className: "w-full", children: "Anular pedido" }), anularOpen && (_jsx(AnularDialog, { orderId: order.id, uid: uid, onClose: () => setAnularOpen(false), onDone: () => navigate('/vendedor/mis') }))] }))] }));
}
function AnularDialog({ orderId, uid, onClose, onDone }) {
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function submit() {
        if (reason.trim().length < 3) {
            setError('Indique un motivo (mínimo 3 caracteres)');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await anularOrder(orderId, uid, reason.trim());
            onDone();
        }
        catch (e) {
            setError(e.message);
            setBusy(false);
        }
    }
    return (_jsx("div", { className: "fixed inset-0 z-20 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4", children: _jsxs("div", { className: "w-full max-w-md bg-cream-50 rounded-t-xl sm:rounded-xl shadow-lift p-5", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Anular" }), _jsx("h2", { className: "text-lg font-semibold text-charcoal-900 tracking-display uppercase mt-0.5", children: orderId })] }), _jsx("button", { onClick: onClose, className: "text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center", children: "\u00D7" })] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Motivo" }), _jsx("textarea", { value: reason, onChange: (e) => setReason(e.target.value), placeholder: "Ej: cliente reprogram\u00F3, error de captura\u2026", rows: 3, className: "field h-auto py-2 text-sm resize-none" })] }), error && _jsx("div", { className: "rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm", children: error }), _jsx("p", { className: "text-xs text-charcoal-300", children: "Las reservas de stock se liberan autom\u00E1ticamente." }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "secondary", onClick: onClose, className: "flex-1", children: "Cancelar" }), _jsx(Button, { variant: "danger", onClick: submit, disabled: busy, className: "flex-1", children: busy ? '…' : 'Anular' })] })] })] }) }));
}
