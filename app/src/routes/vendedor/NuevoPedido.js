import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@/components/ui/Button';
import SemaphoreBadge from '@/components/ui/SemaphoreBadge';
import Stepper from '@/components/ui/Stepper';
import { useCurrentUser } from '@/data/auth';
import { useClients, searchClients } from '@/data/clients';
import { useProducts } from '@/data/products';
import { useAllStock, availableFor, semaphore } from '@/data/stock';
import { createOrder, useLastOrderForClient } from '@/data/orders';
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft';
import { defaultRequestedDate, minRequestedDate } from '@/domain/cutoff';
import { formatDateLong, formatQty } from '@/lib/format';
const emptyDraft = () => ({
    clientId: null,
    lines: [],
    requestedDate: defaultRequestedDate(15),
    deliveryMode: 'despacho',
    deliveryAddress: '',
    receivingHours: '',
    step: 1,
});
export default function NuevoPedido() {
    const { current } = useCurrentUser();
    const navigate = useNavigate();
    const uid = current.appUser.uid;
    const [draft, setDraft] = useState(() => loadDraft(uid) ?? emptyDraft());
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const { clients } = useClients();
    const { products } = useProducts();
    const { stock } = useAllStock();
    const client = useMemo(() => clients.find((c) => c.id === draft.clientId) ?? null, [clients, draft.clientId]);
    const lastOrder = useLastOrderForClient(uid, draft.clientId);
    // Autosave to localStorage on every change
    useEffect(() => { saveDraft(uid, draft); }, [draft, uid]);
    function update(key, value) {
        setDraft((d) => ({ ...d, [key]: value }));
    }
    function goto(step) { update('step', step); }
    async function submit() {
        if (!client)
            return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await createOrder(uid, {
                client,
                lines: draft.lines,
                requestedDate: draft.requestedDate,
                deliveryMode: draft.deliveryMode,
                deliveryAddress: draft.deliveryAddress || client.address,
                receivingHours: draft.receivingHours || client.receivingHours,
                source: 'app',
            });
            clearDraft(uid);
            navigate('/vendedor/mis', {
                state: { justCreated: res.orderId, status: res.status, parcialLines: res.parcialLines },
            });
        }
        catch (e) {
            const msg = e.message ?? 'Error al crear el pedido';
            setError(msg);
            setSubmitting(false);
        }
    }
    return (_jsxs("div", { className: "max-w-2xl mx-auto", children: [_jsxs("header", { className: "mb-4 flex items-center justify-between", children: [_jsx("h1", { className: "text-xl font-semibold text-slate-900", children: "Nuevo pedido" }), _jsx("button", { onClick: () => { if (confirm('¿Descartar borrador?')) {
                            clearDraft(uid);
                            setDraft(emptyDraft());
                        } }, className: "text-xs text-slate-500 hover:text-slate-800", children: "Descartar" })] }), _jsx(Steps, { current: draft.step, onGo: goto }), draft.step === 1 && (_jsx(StepCliente, { clients: clients, selectedId: draft.clientId, onSelect: (c) => { update('clientId', c.id); update('deliveryMode', c.deliveryMode); goto(2); }, onRepeat: () => {
                    if (!lastOrder)
                        return;
                    update('lines', lastOrder.lines.map((l) => ({
                        productId: l.productId, productName: l.productName,
                        formatId: l.formatId, formatLabel: l.formatLabel,
                        unit: l.unit, qty: l.qty, notes: l.notes,
                    })));
                    goto(2);
                }, canRepeat: !!lastOrder })), draft.step === 2 && client && (_jsx(StepProductos, { products: products, stock: stock, lines: draft.lines, onLines: (lines) => update('lines', lines), onNext: () => goto(3), onBack: () => goto(1) })), draft.step === 3 && client && (_jsx(StepEntrega, { client: client, draft: draft, onUpdate: update, onNext: () => goto(4), onBack: () => goto(2) })), draft.step === 4 && client && (_jsx(StepConfirmar, { client: client, draft: draft, stock: stock, submitting: submitting, error: error, onBack: () => goto(3), onSubmit: submit }))] }));
}
// ---------- Step 1: Cliente ----------
function Steps({ current, onGo }) {
    const labels = ['Cliente', 'Productos', 'Entrega', 'Confirmar'];
    return (_jsx("ol", { className: "flex items-center gap-1 mb-4 text-xs", children: labels.map((label, i) => {
            const n = i + 1;
            const active = current === n;
            const done = current > n;
            return (_jsx("li", { className: "flex-1", children: _jsxs("button", { onClick: () => onGo(n), disabled: n > current, className: 'w-full px-2 py-2 rounded-lg font-medium disabled:cursor-not-allowed ' +
                        (active ? 'bg-brand-500 text-white'
                            : done ? 'bg-brand-100 text-brand-700'
                                : 'bg-slate-100 text-slate-500'), children: [n, ". ", label] }) }, label));
        }) }));
}
function StepCliente({ clients, selectedId, onSelect, onRepeat, canRepeat, }) {
    const [q, setQ] = useState('');
    const results = useMemo(() => searchClients(clients, q), [clients, q]);
    return (_jsxs("section", { className: "space-y-3", children: [_jsx("input", { autoFocus: true, value: q, onChange: (e) => setQ(e.target.value), placeholder: "Buscar cliente por nombre, fantas\u00EDa o RUT", className: "w-full h-12 px-4 rounded-xl border border-slate-200 bg-white shadow-sm outline-none focus:border-brand-500" }), canRepeat && selectedId && (_jsx(Button, { variant: "secondary", size: "md", onClick: onRepeat, className: "w-full", children: "Repetir \u00FAltimo pedido de este cliente" })), _jsx("ul", { className: "space-y-1", children: results.map((c) => (_jsx("li", { children: _jsxs("button", { onClick: () => onSelect(c), className: 'w-full text-left rounded-xl border p-3 bg-white shadow-sm ' +
                            (c.id === selectedId ? 'border-brand-500' : 'border-slate-200 hover:border-slate-300'), children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-medium text-slate-900", children: c.fantasyName ?? c.name }), c.isInternalShop && _jsx("span", { className: "text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full", children: "Tienda" }), !c.invoicingComplete && _jsx("span", { className: "text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full", children: "Datos facturaci\u00F3n incompletos" })] }), _jsxs("div", { className: "text-xs text-slate-500 mt-0.5", children: [c.rut ?? 'Sin RUT', " \u00B7 ", c.address ?? 'Sin dirección'] })] }) }, c.id))) })] }));
}
// ---------- Step 2: Productos ----------
function StepProductos({ products, stock, lines, onLines, onNext, onBack, }) {
    const [openProductId, setOpenProductId] = useState(null);
    const active = products.filter((p) => p.active && !p.discontinued);
    function addOrUpdate(product, format, qty, notes) {
        const idx = lines.findIndex((l) => l.productId === product.id && l.formatId === format.formatId);
        if (qty <= 0) {
            if (idx >= 0)
                onLines(lines.filter((_, i) => i !== idx));
            return;
        }
        const next = {
            productId: product.id,
            productName: product.name,
            formatId: format.formatId,
            formatLabel: format.label,
            unit: format.unit,
            qty,
            notes,
        };
        if (idx >= 0) {
            const copy = [...lines];
            copy[idx] = next;
            onLines(copy);
        }
        else {
            onLines([...lines, next]);
        }
    }
    return (_jsxs("section", { className: "space-y-3", children: [_jsx(ProductGrid, { products: active, openId: openProductId, onOpen: setOpenProductId }), openProductId && (_jsx(FormatPicker, { product: active.find((p) => p.id === openProductId), stock: stock, existing: lines.filter((l) => l.productId === openProductId), onCommit: (fmt, qty, notes) => {
                    const prod = active.find((p) => p.id === openProductId);
                    addOrUpdate(prod, fmt, qty, notes);
                }, onClose: () => setOpenProductId(null) })), _jsx(SelectedLines, { lines: lines, onRemove: (l) => onLines(lines.filter((x) => !(x.productId === l.productId && x.formatId === l.formatId))) }), _jsxs("div", { className: "flex gap-2 pt-2 sticky bottom-0 bg-brand-50 py-3", children: [_jsx(Button, { variant: "secondary", onClick: onBack, className: "flex-1", children: "Volver" }), _jsxs(Button, { onClick: onNext, disabled: lines.length === 0, className: "flex-1", children: ["Siguiente (", lines.length, " ", lines.length === 1 ? 'línea' : 'líneas', ")"] })] })] }));
}
function ProductGrid({ products, openId, onOpen }) {
    const byCat = useMemo(() => {
        const m = new Map();
        for (const p of products) {
            const list = m.get(p.category) ?? [];
            list.push(p);
            m.set(p.category, list);
        }
        return m;
    }, [products]);
    return (_jsx("div", { className: "space-y-3", children: [...byCat.entries()].map(([cat, list]) => (_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1 px-1", children: cat }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: list.map((p) => (_jsx("button", { onClick: () => onOpen(p.id), className: 'rounded-full border px-3 py-1.5 text-sm shadow-sm ' +
                            (openId === p.id ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-slate-200 hover:border-slate-300'), children: p.name }, p.id))) })] }, cat))) }));
}
function FormatPicker({ product, stock, existing, onCommit, onClose, }) {
    const [pending, setPending] = useState(() => {
        const initial = {};
        for (const l of existing)
            initial[l.formatId] = { qty: l.qty, notes: l.notes ?? '' };
        return initial;
    });
    function commit() {
        for (const fmt of product.formats) {
            const p = pending[fmt.formatId];
            if (p)
                onCommit(fmt, p.qty, p.notes || undefined);
        }
        onClose();
    }
    return (_jsxs("div", { className: "rounded-xl border border-brand-500 bg-white p-4 shadow", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("h3", { className: "font-semibold text-slate-900", children: product.name }), _jsx("button", { onClick: onClose, className: "text-slate-400 hover:text-slate-700 text-lg", "aria-label": "Cerrar", children: "\u00D7" })] }), _jsx("ul", { className: "space-y-3", children: product.formats.map((fmt) => {
                    const av = availableFor(stock, product.id, fmt.formatId);
                    const current = pending[fmt.formatId] ?? { qty: 0, notes: '' };
                    const sem = semaphore(av, current.qty || 1);
                    return (_jsxs("li", { className: "border-t pt-3 first:border-none first:pt-0", children: [_jsxs("div", { className: "flex items-center justify-between mb-1.5", children: [_jsx("span", { className: "font-medium text-slate-800", children: fmt.label }), _jsx(SemaphoreBadge, { level: sem, note: `Disponible ${formatQty(av, fmt.unit)}` })] }), _jsx(Stepper, { value: current.qty, onChange: (qty) => setPending((s) => ({ ...s, [fmt.formatId]: { ...current, qty } })), step: fmt.unit === 'kg' ? 0.5 : 1, decimals: fmt.unit === 'kg' ? 2 : 0, quick: fmt.unit === 'kg' ? [0.5, 1, 5] : [1, 5, 10] }), _jsx("input", { value: current.notes, onChange: (e) => setPending((s) => ({ ...s, [fmt.formatId]: { ...current, notes: e.target.value } })), placeholder: "Notas (opcional) \u2014 laminado fino, sin jugo\u2026", className: "mt-2 w-full h-9 px-3 rounded-lg border border-slate-200 text-sm outline-none focus:border-brand-500" })] }, fmt.formatId));
                }) }), _jsxs("div", { className: "flex gap-2 mt-4", children: [_jsx(Button, { variant: "secondary", onClick: onClose, className: "flex-1", children: "Cancelar" }), _jsx(Button, { onClick: commit, className: "flex-1", children: "Agregar" })] })] }));
}
function SelectedLines({ lines, onRemove }) {
    if (lines.length === 0)
        return null;
    return (_jsxs("div", { className: "rounded-xl border border-slate-200 bg-white p-3", children: [_jsx("p", { className: "text-xs font-semibold text-slate-500 mb-2", children: "L\u00EDneas en este pedido" }), _jsx("ul", { className: "space-y-1", children: lines.map((l) => (_jsxs("li", { className: "flex items-center justify-between gap-2 text-sm", children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "text-slate-900 truncate", children: [l.productName, " \u00B7 ", l.formatLabel] }), l.notes && _jsx("div", { className: "text-xs text-slate-500 truncate", children: l.notes })] }), _jsxs("div", { className: "flex items-center gap-2 shrink-0", children: [_jsx("span", { className: "font-medium text-slate-700", children: formatQty(l.qty, l.unit) }), _jsx("button", { onClick: () => onRemove(l), className: "text-slate-400 hover:text-red-600 text-sm", children: "Quitar" })] })] }, `${l.productId}-${l.formatId}`))) })] }));
}
// ---------- Step 3: Entrega ----------
function StepEntrega({ client, draft, onUpdate, onNext, onBack, }) {
    return (_jsxs("section", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-xs font-semibold text-slate-500 mb-1", children: "Fecha solicitada" }), _jsx("input", { type: "date", value: draft.requestedDate, min: minRequestedDate(), onChange: (e) => onUpdate('requestedDate', e.target.value), className: "w-full h-11 px-3 rounded-xl border border-slate-200 bg-white outline-none focus:border-brand-500" }), _jsx("p", { className: "text-xs text-slate-500 mt-1", children: formatDateLong(draft.requestedDate) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-semibold text-slate-500 mb-1", children: "Modalidad" }), _jsx("div", { className: "grid grid-cols-2 gap-2", children: ['retiro', 'despacho'].map((m) => (_jsx("button", { onClick: () => onUpdate('deliveryMode', m), className: 'h-11 rounded-xl border font-medium ' +
                                (draft.deliveryMode === m ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-slate-200 text-slate-700'), children: m === 'retiro' ? 'Retiro en tienda' : 'Despacho' }, m))) })] }), draft.deliveryMode === 'despacho' && (_jsxs("div", { children: [_jsx("label", { className: "block text-xs font-semibold text-slate-500 mb-1", children: "Direcci\u00F3n de despacho" }), _jsx("input", { value: draft.deliveryAddress || client.address || '', onChange: (e) => onUpdate('deliveryAddress', e.target.value), placeholder: "Direcci\u00F3n (prefijada del cliente)", className: "w-full h-11 px-3 rounded-xl border border-slate-200 bg-white outline-none focus:border-brand-500" })] })), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-semibold text-slate-500 mb-1", children: "Horario de recepci\u00F3n" }), _jsx("input", { value: draft.receivingHours || client.receivingHours || '', onChange: (e) => onUpdate('receivingHours', e.target.value), placeholder: "Ej: L-V 09:00-14:00", className: "w-full h-11 px-3 rounded-xl border border-slate-200 bg-white outline-none focus:border-brand-500" })] }), _jsxs("div", { className: "flex gap-2 pt-2", children: [_jsx(Button, { variant: "secondary", onClick: onBack, className: "flex-1", children: "Volver" }), _jsx(Button, { onClick: onNext, className: "flex-1", children: "Siguiente" })] })] }));
}
// ---------- Step 4: Confirmar ----------
function StepConfirmar({ client, draft, stock, submitting, error, onBack, onSubmit, }) {
    const preview = useMemo(() => draft.lines.map((l) => {
        const av = availableFor(stock, l.productId, l.formatId);
        return { line: l, available: av, reserved: Math.min(av, l.qty), pending: Math.max(0, l.qty - av) };
    }), [draft.lines, stock]);
    const anyPending = preview.some((p) => p.pending > 0);
    return (_jsxs("section", { className: "space-y-4", children: [_jsxs("div", { className: "rounded-xl border border-slate-200 bg-white p-3", children: [_jsx("p", { className: "text-xs font-semibold text-slate-500 mb-1", children: "Cliente" }), _jsx("p", { className: "font-medium text-slate-900", children: client.fantasyName ?? client.name }), _jsxs("p", { className: "text-xs text-slate-500", children: [client.rut ?? 'Sin RUT', " \u00B7 ", draft.deliveryMode === 'retiro' ? 'Retiro' : (draft.deliveryAddress || client.address)] }), _jsxs("p", { className: "text-xs text-slate-500 mt-1", children: ["Solicitado para ", formatDateLong(draft.requestedDate)] }), !client.invoicingComplete && (_jsx("p", { className: "mt-2 text-xs text-amber-800 bg-amber-50 rounded px-2 py-1", children: "Datos de facturaci\u00F3n incompletos \u2014 se crear\u00E1 igual y el pedido se marcar\u00E1 para completar." }))] }), _jsxs("div", { className: "rounded-xl border border-slate-200 bg-white p-3", children: [_jsxs("p", { className: "text-xs font-semibold text-slate-500 mb-2", children: ["L\u00EDneas (", preview.length, ")"] }), _jsx("ul", { className: "space-y-2", children: preview.map((p) => (_jsxs("li", { className: "text-sm", children: [_jsxs("div", { className: "flex justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "text-slate-900 truncate", children: [p.line.productName, " \u00B7 ", p.line.formatLabel] }), p.line.notes && _jsx("div", { className: "text-xs text-slate-500 truncate", children: p.line.notes })] }), _jsx("div", { className: "font-medium text-slate-700 shrink-0", children: formatQty(p.line.qty, p.line.unit) })] }), p.pending > 0 && (_jsxs("p", { className: "text-xs text-amber-800 mt-0.5", children: [formatQty(p.reserved, p.line.unit), " reservado \u00B7 ", formatQty(p.pending, p.line.unit), " a producci\u00F3n"] }))] }, `${p.line.productId}-${p.line.formatId}`))) })] }), anyPending && (_jsx("div", { className: "rounded-xl bg-amber-50 border border-amber-200 text-amber-900 p-3 text-sm", children: "Alguna l\u00EDnea no tiene stock suficiente. Se enviar\u00E1 lo disponible y el resto quedar\u00E1 a producci\u00F3n (Yuri lo ver\u00E1)." })), error && (_jsx("div", { className: "rounded-xl bg-red-50 border border-red-200 text-red-800 p-3 text-sm", children: error })), _jsxs("div", { className: "flex gap-2 pt-2", children: [_jsx(Button, { variant: "secondary", onClick: onBack, disabled: submitting, className: "flex-1", children: "Volver" }), _jsx(Button, { onClick: onSubmit, disabled: submitting, className: "flex-1", children: submitting ? 'Enviando…' : 'Enviar pedido' })] })] }));
}
