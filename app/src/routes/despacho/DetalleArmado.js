import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/ui/Button';
import Stepper from '@/components/ui/Stepper';
import StatusPill from '@/components/ui/StatusPill';
import { useCurrentUser } from '@/data/auth';
import { assignPacker, markArmado, useOrder } from '@/data/orders';
import { formatDateLong, formatQty } from '@/lib/format';
import { demoUsers } from '@/data/demo-users';
const NAME_BY_UID = Object.fromEntries(demoUsers.map((u) => [u.uid, u.displayName]));
export default function DetalleArmado() {
    const { orderId } = useParams();
    const { current } = useCurrentUser();
    const uid = current.appUser.uid;
    const navigate = useNavigate();
    const { order, loading } = useOrder(orderId ?? null);
    const [state, setState] = useState({});
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    useEffect(() => {
        if (!order)
            return;
        // Initialize inputs from reservedQty (assumed default packed amount).
        setState(Object.fromEntries(order.lines.map((l) => [
            `${l.productId}::${l.formatId}`,
            {
                packedQty: l.packedQty ?? l.reservedQty,
                packedWeightKg: l.packedWeightKg != null ? String(l.packedWeightKg) : '',
            },
        ])));
    }, [order]);
    const mine = order?.assignedPackerId === uid;
    const canTake = order && (!order.assignedPackerId || mine) && (order.status === 'confirmado' || order.status === 'confirmado_parcial');
    const canPack = order && mine && order.status === 'en_armado';
    const isDone = order && (order.status === 'armado' || order.status === 'facturado' || order.status === 'despachado' || order.status === 'entregado');
    const anyPacked = useMemo(() => order?.lines.some((l) => (state[`${l.productId}::${l.formatId}`]?.packedQty ?? 0) > 0) ?? false, [order, state]);
    async function take() {
        if (!order)
            return;
        setError(null);
        try {
            await assignPacker(order.id, uid);
        }
        catch (e) {
            setError(e.message);
        }
    }
    async function done() {
        if (!order)
            return;
        setSubmitting(true);
        setError(null);
        try {
            await markArmado(order.id, order.lines.map((l) => {
                const k = `${l.productId}::${l.formatId}`;
                const s = state[k];
                const parsedWeight = s?.packedWeightKg ? Number(s.packedWeightKg) : undefined;
                return {
                    productId: l.productId,
                    formatId: l.formatId,
                    packedQty: s?.packedQty ?? l.reservedQty,
                    packedWeightKg: Number.isFinite(parsedWeight) ? parsedWeight : undefined,
                };
            }), uid);
            navigate('/despacho/cola');
        }
        catch (e) {
            setError(e.message);
            setSubmitting(false);
        }
    }
    if (loading || !order)
        return _jsx("p", { className: "text-sm text-charcoal-300", children: "Cargando\u2026" });
    return (_jsxs("div", { className: "max-w-2xl mx-auto", children: [_jsx("div", { className: "mb-4", children: _jsx(Link, { to: "/despacho/cola", className: "text-[11px] uppercase tracking-display text-charcoal-300 hover:text-charcoal-700", children: "\u2190 Cola" }) }), _jsxs("header", { className: "mb-5", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "font-mono text-[11px] text-charcoal-300 uppercase tracking-display", children: order.id }), _jsx(StatusPill, { status: order.status })] }), _jsx("h1", { className: "text-xl font-semibold text-charcoal-900 tracking-display uppercase mt-1", children: order.clientSnapshot.fantasyName ?? order.clientSnapshot.name }), _jsxs("p", { className: "text-xs text-charcoal-300 mt-1 first-letter:uppercase", children: ["Solicitado para ", formatDateLong(order.requestedDate), " \u00B7 ", order.deliveryMode === 'retiro' ? 'Retiro' : (order.deliveryAddress ?? 'Despacho')] })] }), canTake && (_jsxs("div", { className: "card p-4 mb-4 bg-brass-50 border-brass-300", children: [_jsx("p", { className: "text-sm text-charcoal-700 mb-3", children: order.assignedPackerId ? 'Este pedido está asignado a usted.' : 'Este pedido está sin asignar.' }), _jsx(Button, { onClick: take, className: "w-full", children: order.assignedPackerId ? 'Comenzar armado' : 'Tomar este pedido' })] })), !canTake && !canPack && order.assignedPackerId && !mine && (_jsx("div", { className: "card p-4 mb-4", children: _jsxs("p", { className: "text-sm text-charcoal-500", children: ["Asignado a ", _jsx("span", { className: "font-semibold text-charcoal-700", children: NAME_BY_UID[order.assignedPackerId] ?? 'otro armador' }), "."] }) })), _jsxs("div", { className: "card divide-y divide-charcoal-100", children: [_jsx("div", { className: "p-4", children: _jsx("p", { className: "eyebrow", children: "L\u00EDneas a armar" }) }), order.lines.map((line) => {
                        const k = `${line.productId}::${line.formatId}`;
                        const s = state[k] ?? { packedQty: line.reservedQty, packedWeightKg: '' };
                        const packed = s.packedQty;
                        const readOnly = !canPack;
                        const showWeight = line.unit !== 'kg'; // extra field only when line's unit isn't already kg
                        const parsedWeight = s.packedWeightKg ? Number(s.packedWeightKg) : undefined;
                        const showWeightDelta = readOnly && line.packedWeightKg != null;
                        return (_jsxs("div", { className: "p-4", children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "font-semibold text-charcoal-900", children: line.productName }), _jsx("p", { className: "text-xs text-charcoal-300 mt-0.5", children: line.formatLabel }), line.notes && _jsx("p", { className: "text-xs text-charcoal-500 mt-1 italic", children: line.notes })] }), _jsxs("div", { className: "text-right shrink-0", children: [_jsx("p", { className: "eyebrow", children: "Vendido" }), _jsx("p", { className: "font-semibold text-charcoal-700 mt-0.5", children: formatQty(line.qty, line.unit) }), line.reservedQty !== line.qty && (_jsxs("p", { className: "text-[10px] uppercase tracking-display text-brass-700 mt-0.5", children: ["Reserv. ", formatQty(line.reservedQty, line.unit)] }))] })] }), _jsxs("div", { className: "mt-3 pt-3 border-t border-charcoal-100", children: [_jsx("p", { className: "eyebrow mb-2", children: "Empacado" }), readOnly ? (_jsxs("p", { className: "text-sm text-charcoal-700 font-medium", children: [line.packedQty != null ? formatQty(line.packedQty, line.unit) : '—', showWeightDelta && (_jsxs("span", { className: "ml-2 text-xs text-charcoal-300", children: ["\u00B7 peso real ", line.packedWeightKg, " kg"] }))] })) : (_jsxs("div", { className: "space-y-3", children: [_jsx(Stepper, { value: packed, onChange: (v) => setState((prev) => ({ ...prev, [k]: { ...s, packedQty: v } })), step: line.unit === 'kg' ? 0.5 : 1, decimals: line.unit === 'kg' ? 2 : 0, quick: line.unit === 'kg' ? [0.5, 1, 5] : [1, 5, 10] }), showWeight && (_jsxs("div", { children: [_jsx("label", { className: "text-[11px] uppercase tracking-display text-charcoal-300 block mb-1", children: "Peso real (kg) \u2014 opcional" }), _jsx("input", { type: "number", inputMode: "decimal", step: "0.1", placeholder: "Solo si difiere del vendido", value: s.packedWeightKg, onChange: (e) => setState((prev) => ({ ...prev, [k]: { ...s, packedWeightKg: e.target.value } })), className: "field h-10 text-sm" }), Number.isFinite(parsedWeight) && parsedWeight !== undefined && line.unit === 'unidad' && (_jsxs("p", { className: "text-[11px] text-charcoal-300 mt-1", children: ["Registrar\u00E1 peso real de ", parsedWeight, " kg"] }))] }))] }))] })] }, k));
                    })] }), error && (_jsx("div", { className: "rounded-md bg-red-50 border border-red-200 text-red-800 p-3 text-sm mt-4", children: error })), canPack && (_jsx("div", { className: "mt-5 sticky bottom-0 bg-cream-50 border-t border-charcoal-100 pt-4 pb-2", children: _jsx(Button, { onClick: done, disabled: submitting || !anyPacked, size: "lg", className: "w-full", children: submitting ? 'Registrando…' : 'Marcar armado' }) })), isDone && (_jsxs("div", { className: "card p-4 mt-4", children: [_jsx("p", { className: "eyebrow mb-2", children: "Historial" }), _jsx("ol", { className: "space-y-1 text-xs", children: order.statusHistory.map((h, i) => (_jsxs("li", { className: "flex justify-between gap-2", children: [_jsx("span", { className: "text-charcoal-700 font-medium", children: h.status }), _jsxs("span", { className: "text-charcoal-300", children: [NAME_BY_UID[h.by] ?? h.by, " \u00B7 ", new Date(h.at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })] })] }, i))) })] }))] }));
}
