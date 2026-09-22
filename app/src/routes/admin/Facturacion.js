import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import StatusPill from '@/components/ui/StatusPill';
import { useCurrentUser } from '@/data/auth';
import { despacharOrder, entregarOrder, facturarOrder, useOrdersByStatuses, } from '@/data/orders';
import { formatDateShort, formatQty } from '@/lib/format';
import { bsale } from '@/integrations/bsale/MockBsaleClient';
const TAB_STATUSES = {
    facturar: ['armado'],
    despachar: ['facturado'],
    entregar: ['despachado'],
};
const TAB_LABEL = {
    facturar: 'Por facturar',
    despachar: 'Por despachar',
    entregar: 'Por entregar',
};
export default function Facturacion() {
    const { current } = useCurrentUser();
    const uid = current.appUser.uid;
    const [tab, setTab] = useState('facturar');
    const { orders, loading } = useOrdersByStatuses(TAB_STATUSES[tab]);
    const [busyId, setBusyId] = useState(null);
    const [message, setMessage] = useState(null);
    const [dispatchModal, setDispatchModal] = useState(null);
    const [deliverModal, setDeliverModal] = useState(null);
    const [payloadModal, setPayloadModal] = useState(null);
    const incompleteInvoicing = useMemo(() => orders.filter((o) => !o.invoicingComplete), [orders]);
    async function factura(o) {
        setBusyId(o.id);
        setMessage(null);
        try {
            const res = await facturarOrder(o.id, uid, (order) => bsale.createDocument(order));
            setPayloadModal({ docNumber: res.invoiceRef, payload: res.payload, orderId: o.id });
        }
        catch (e) {
            setMessage({ orderId: o.id, text: e.message });
        }
        finally {
            setBusyId(null);
        }
    }
    return (_jsxs("div", { children: [_jsxs("header", { className: "mb-6", children: [_jsx("p", { className: "eyebrow", children: "Administraci\u00F3n" }), _jsx("h1", { className: "text-2xl font-semibold text-charcoal-900 tracking-display uppercase", children: "Facturaci\u00F3n y despacho" })] }), _jsx("nav", { className: "mb-4 flex gap-1 border-b border-charcoal-100", children: ['facturar', 'despachar', 'entregar'].map((t) => (_jsx("button", { onClick: () => setTab(t), className: 'px-4 py-2.5 text-xs uppercase tracking-display font-medium border-b-2 transition -mb-px ' +
                        (t === tab
                            ? 'border-brass-500 text-charcoal-900'
                            : 'border-transparent text-charcoal-300 hover:text-charcoal-500 hover:border-charcoal-200'), children: TAB_LABEL[t] }, t))) }), tab === 'facturar' && incompleteInvoicing.length > 0 && (_jsxs("div", { className: "rounded-md bg-brass-50 border border-brass-300 text-brass-700 p-3 text-sm mb-4", children: [incompleteInvoicing.length, " pedido", incompleteInvoicing.length === 1 ? '' : 's', " con datos de facturaci\u00F3n incompletos \u2014 se facturar\u00E1 con los datos disponibles."] })), loading && _jsx("p", { className: "text-sm text-charcoal-300", children: "Cargando\u2026" }), !loading && orders.length === 0 && (_jsx("div", { className: "card p-8 text-center", children: _jsxs("p", { className: "text-sm text-charcoal-500", children: ["Nada por hacer en ", TAB_LABEL[tab].toLowerCase(), "."] }) })), _jsx("ul", { className: "space-y-2", children: orders.map((o) => (_jsx("li", { children: _jsxs("div", { className: "card p-4", children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "font-mono text-[11px] text-charcoal-300 uppercase tracking-display", children: o.id }), _jsx(StatusPill, { status: o.status }), o.invoiceRef && (_jsx("span", { className: "font-mono text-[11px] text-charcoal-500", children: o.invoiceRef })), !o.invoicingComplete && tab === 'facturar' && (_jsx("span", { className: "text-[10px] uppercase tracking-display bg-brass-100 text-brass-700 border border-brass-300 px-2 py-0.5 rounded", children: "Facturaci\u00F3n incompleta" }))] }), _jsx("p", { className: "font-semibold text-charcoal-900 mt-1 truncate", children: o.clientSnapshot.fantasyName ?? o.clientSnapshot.name }), _jsxs("p", { className: "text-xs text-charcoal-300 mt-0.5 first-letter:uppercase", children: ["Solicitado ", formatDateShort(o.requestedDate), " \u00B7 ", o.lines.length, " ", o.lines.length === 1 ? 'línea' : 'líneas'] }), _jsxs("details", { className: "mt-2", children: [_jsx("summary", { className: "text-[11px] uppercase tracking-display text-charcoal-300 hover:text-charcoal-500 cursor-pointer", children: "Ver l\u00EDneas" }), _jsx("ul", { className: "mt-2 space-y-1", children: o.lines.map((l) => (_jsxs("li", { className: "flex items-center justify-between gap-2 text-xs", children: [_jsxs("span", { className: "text-charcoal-500 truncate", children: [l.productName, " \u00B7 ", l.formatLabel] }), _jsxs("span", { className: "text-charcoal-700 font-medium shrink-0", children: [formatQty(l.packedQty ?? l.reservedQty, l.unit), l.packedWeightKg != null && _jsxs("span", { className: "text-charcoal-300 ml-1", children: ["\u00B7 ", l.packedWeightKg, " kg reales"] })] })] }, `${l.productId}-${l.formatId}`))) })] })] }), _jsxs("div", { className: "shrink-0", children: [tab === 'facturar' && (_jsx(Button, { size: "md", onClick: () => factura(o), disabled: busyId === o.id, children: busyId === o.id ? '…' : 'Facturar' })), tab === 'despachar' && (_jsx(Button, { size: "md", onClick: () => setDispatchModal(o), children: "Despachar" })), tab === 'entregar' && (_jsx(Button, { size: "md", onClick: () => setDeliverModal(o), children: "Marcar entregado" }))] })] }), message?.orderId === o.id && (_jsx("div", { className: "mt-3 rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-xs", children: message.text })), o.deliveredBy && (_jsxs("p", { className: "mt-2 text-[11px] text-charcoal-300 uppercase tracking-display", children: ["Despachado por ", o.deliveredBy, o.deliveryProof?.note ? ` · ${o.deliveryProof.note}` : ''] }))] }) }, o.id))) }), payloadModal && (_jsx(PayloadDialog, { docNumber: payloadModal.docNumber, orderId: payloadModal.orderId, payload: payloadModal.payload, onClose: () => setPayloadModal(null) })), dispatchModal && (_jsx(DispatchDialog, { order: dispatchModal, uid: uid, onClose: () => setDispatchModal(null) })), deliverModal && (_jsx(DeliverDialog, { order: deliverModal, uid: uid, onClose: () => setDeliverModal(null) }))] }));
}
function ModalShell({ title, eyebrow, onClose, children }) {
    return (_jsx("div", { className: "fixed inset-0 z-20 bg-charcoal-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4", children: _jsxs("div", { className: "w-full max-w-md bg-cream-50 rounded-t-xl sm:rounded-xl shadow-lift p-5 max-h-[90vh] overflow-y-auto", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: eyebrow }), _jsx("h2", { className: "text-lg font-semibold text-charcoal-900 tracking-display uppercase mt-0.5", children: title })] }), _jsx("button", { onClick: onClose, className: "text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center", children: "\u00D7" })] }), children] }) }));
}
function PayloadDialog({ docNumber, orderId, payload, onClose }) {
    return (_jsx(ModalShell, { title: "Documento generado", eyebrow: "Mock Bsale", onClose: onClose, children: _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 text-sm", children: [_jsx("span", { className: "font-mono", children: docNumber }), " emitido para ", _jsx("span", { className: "font-mono", children: orderId }), "."] }), _jsx("p", { className: "eyebrow", children: "Payload enviado (simulado)" }), _jsx("pre", { className: "rounded-md bg-charcoal-900 text-cream-100 text-[11px] leading-relaxed p-3 overflow-auto max-h-64", children: JSON.stringify(payload, null, 2) }), _jsx(Button, { onClick: onClose, className: "w-full", children: "Cerrar" })] }) }));
}
const COURIERS = ['Retiro cliente', 'Repartidor propio', 'Courier Chilexpress', 'Courier Starken'];
function DispatchDialog({ order, uid, onClose }) {
    const [deliveredBy, setDeliveredBy] = useState(order.deliveryMode === 'retiro' ? 'Retiro cliente' : 'Repartidor propio');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function submit() {
        setBusy(true);
        setError(null);
        try {
            await despacharOrder(order.id, uid, deliveredBy, note || undefined);
            onClose();
        }
        catch (e) {
            setError(e.message);
            setBusy(false);
        }
    }
    return (_jsx(ModalShell, { title: "Despachar pedido", eyebrow: order.id, onClose: onClose, children: _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Entregado por" }), _jsx("select", { value: deliveredBy, onChange: (e) => setDeliveredBy(e.target.value), className: "field", children: COURIERS.map((c) => _jsx("option", { value: c, children: c }, c)) })] }), _jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Nota (opcional)" }), _jsx("input", { value: note, onChange: (e) => setNote(e.target.value), placeholder: "Gu\u00EDa, patente, referencia interna\u2026", className: "field h-10 text-sm" })] }), error && _jsx("div", { className: "rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm", children: error }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "secondary", onClick: onClose, className: "flex-1", children: "Cancelar" }), _jsx(Button, { onClick: submit, disabled: busy, className: "flex-1", children: busy ? '…' : 'Despachar' })] })] }) }));
}
function DeliverDialog({ order, uid, onClose }) {
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function submit() {
        setBusy(true);
        setError(null);
        try {
            await entregarOrder(order.id, uid, note || undefined);
            onClose();
        }
        catch (e) {
            setError(e.message);
            setBusy(false);
        }
    }
    return (_jsx(ModalShell, { title: "Marcar entregado", eyebrow: order.id, onClose: onClose, children: _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Confirmaci\u00F3n de entrega" }), _jsx("input", { value: note, onChange: (e) => setNote(e.target.value), placeholder: "Ej: recibido por chef Andr\u00E9s", className: "field h-10 text-sm" })] }), error && _jsx("div", { className: "rounded-md bg-red-50 border border-red-200 text-red-800 p-2 text-sm", children: error }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "secondary", onClick: onClose, className: "flex-1", children: "Cancelar" }), _jsx(Button, { onClick: submit, disabled: busy, className: "flex-1", children: busy ? '…' : 'Confirmar entrega' })] })] }) }));
}
