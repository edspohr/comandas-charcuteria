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
    return (_jsxs("div", { className: "max-w-2xl mx-auto", children: [_jsxs("header", { className: "mb-6 flex items-end justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Vendedor" }), _jsx("h1", { className: "text-2xl font-semibold text-charcoal-900 tracking-display uppercase", children: "Nuevo pedido" })] }), _jsx("button", { onClick: () => { if (confirm('¿Descartar borrador?')) {
                            clearDraft(uid);
                            setDraft(emptyDraft());
                        } }, className: "text-[11px] uppercase tracking-display text-charcoal-300 hover:text-charcoal-700", children: "Descartar" })] }), _jsx(Steps, { current: draft.step, onGo: goto }), draft.step === 1 && (_jsx(StepCliente, { clients: clients, selectedId: draft.clientId, onSelect: (c) => { update('clientId', c.id); update('deliveryMode', c.deliveryMode); goto(2); }, onRepeat: () => {
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
// ---------- Stepper header ----------
const STEP_LABELS = ['Cliente', 'Productos', 'Entrega', 'Confirmar'];
function Steps({ current, onGo }) {
    return (_jsx("ol", { className: "flex items-center gap-3 mb-8", children: STEP_LABELS.map((label, i) => {
            const n = i + 1;
            const active = current === n;
            const done = current > n;
            return (_jsx("li", { className: "flex-1 min-w-0", children: _jsx("button", { onClick: () => onGo(n), disabled: n > current, className: "w-full text-left group disabled:cursor-not-allowed", children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: 'shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border transition ' +
                                    (active
                                        ? 'bg-charcoal-900 border-charcoal-900 text-cream-50'
                                        : done
                                            ? 'bg-brass-500 border-brass-500 text-cream-50'
                                            : 'bg-white border-charcoal-200 text-charcoal-300'), children: String(n).padStart(2, '0') }), _jsx("span", { className: 'hidden sm:block text-[11px] uppercase tracking-display font-medium truncate ' +
                                    (active ? 'text-charcoal-900' : done ? 'text-brass-600' : 'text-charcoal-300'), children: label })] }) }) }, label));
        }) }));
}
// ---------- Step 1: Cliente ----------
function StepCliente({ clients, selectedId, onSelect, onRepeat, canRepeat, }) {
    const [q, setQ] = useState('');
    const results = useMemo(() => searchClients(clients, q), [clients, q]);
    return (_jsxs("section", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Buscar cliente" }), _jsx("input", { autoFocus: true, value: q, onChange: (e) => setQ(e.target.value), placeholder: "Nombre, fantas\u00EDa o RUT", className: "field h-12 text-base" })] }), canRepeat && selectedId && (_jsx(Button, { variant: "secondary", size: "md", onClick: onRepeat, className: "w-full", children: "Repetir \u00FAltimo pedido de este cliente" })), _jsx("ul", { className: "space-y-1.5", children: results.map((c) => (_jsx("li", { children: _jsxs("button", { onClick: () => onSelect(c), className: 'w-full text-left card p-3.5 transition hover:border-brass-500 hover:shadow-lift ' +
                            (c.id === selectedId ? 'border-brass-500 shadow-lift' : ''), children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "font-semibold text-charcoal-700", children: c.fantasyName ?? c.name }), c.isInternalShop && (_jsx("span", { className: "text-[10px] uppercase tracking-display bg-charcoal-900 text-cream-50 px-2 py-0.5 rounded", children: "Tienda" })), !c.invoicingComplete && (_jsx("span", { className: "text-[10px] uppercase tracking-display bg-brass-100 text-brass-700 border border-brass-300 px-2 py-0.5 rounded", children: "Facturaci\u00F3n incompleta" }))] }), _jsxs("div", { className: "text-xs text-charcoal-300 mt-1", children: [c.rut ?? 'Sin RUT', " \u00B7 ", c.address ?? 'Sin dirección'] })] }) }, c.id))) })] }));
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
            productId: product.id, productName: product.name,
            formatId: format.formatId, formatLabel: format.label,
            unit: format.unit, qty, notes,
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
    return (_jsxs("section", { className: "space-y-5", children: [_jsx(ProductGrid, { products: active, lines: lines, openId: openProductId, onOpen: setOpenProductId }), openProductId && (_jsx(FormatPicker, { product: active.find((p) => p.id === openProductId), stock: stock, existing: lines.filter((l) => l.productId === openProductId), onCommit: (fmt, qty, notes) => {
                    const prod = active.find((p) => p.id === openProductId);
                    addOrUpdate(prod, fmt, qty, notes);
                }, onClose: () => setOpenProductId(null) })), _jsx(SelectedLines, { lines: lines, onRemove: (l) => onLines(lines.filter((x) => !(x.productId === l.productId && x.formatId === l.formatId))) }), _jsxs("div", { className: "flex gap-2 pt-2 sticky bottom-0 bg-cream-50 py-3 border-t border-charcoal-100", children: [_jsx(Button, { variant: "secondary", onClick: onBack, className: "flex-1", children: "Volver" }), _jsxs(Button, { onClick: onNext, disabled: lines.length === 0, className: "flex-1", children: ["Siguiente (", lines.length, " ", lines.length === 1 ? 'línea' : 'líneas', ")"] })] })] }));
}
const CATEGORY_LABEL = {
    'jamones': 'Jamones',
    'salames': 'Salames',
    'chorizos': 'Chorizos y fuet',
    'cabanossi': 'Cabanossi',
    'embutidos-frescos': 'Embutidos frescos',
    'mortadelas': 'Mortadelas',
    'pastramis': 'Pastramis',
    'carnes-curadas': 'Carnes curadas',
    'quesos': 'Quesos',
    'tablas': 'Tablas charcuteras',
    'untables': 'Untables y patés',
    'charqui': 'Charqui',
};
function ProductGrid({ products, lines, openId, onOpen }) {
    const byCat = useMemo(() => {
        const m = new Map();
        for (const p of products) {
            const list = m.get(p.category) ?? [];
            list.push(p);
            m.set(p.category, list);
        }
        return m;
    }, [products]);
    return (_jsx("div", { className: "space-y-4", children: [...byCat.entries()].map(([cat, list]) => (_jsxs("div", { children: [_jsx("p", { className: "eyebrow mb-2 px-0.5", children: CATEGORY_LABEL[cat] ?? cat }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: list.map((p) => {
                        const has = lines.some((l) => l.productId === p.id);
                        return (_jsxs("button", { onClick: () => onOpen(p.id), className: 'rounded-md border px-3 py-1.5 text-sm transition ' +
                                (openId === p.id
                                    ? 'bg-charcoal-900 text-cream-50 border-charcoal-900'
                                    : has
                                        ? 'bg-brass-50 border-brass-300 text-brass-700'
                                        : 'bg-white border-charcoal-200 text-charcoal-700 hover:border-charcoal-300'), children: [p.name, has && _jsx("span", { className: "ml-1.5 text-[10px]", children: "\u2713" })] }, p.id));
                    }) })] }, cat))) }));
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
    return (_jsxs("div", { className: "card p-4 border-brass-500 shadow-lift", children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Formatos" }), _jsx("h3", { className: "font-semibold text-charcoal-900 tracking-display uppercase mt-0.5", children: product.name })] }), _jsx("button", { onClick: onClose, className: "text-charcoal-300 hover:text-charcoal-700 text-xl w-8 h-8 flex items-center justify-center", "aria-label": "Cerrar", children: "\u00D7" })] }), _jsx("ul", { className: "space-y-4", children: product.formats.map((fmt) => {
                    const av = availableFor(stock, product.id, fmt.formatId);
                    const current = pending[fmt.formatId] ?? { qty: 0, notes: '' };
                    const sem = semaphore(av, current.qty || 1);
                    return (_jsxs("li", { className: "border-t border-charcoal-100 pt-4 first:border-none first:pt-0", children: [_jsxs("div", { className: "flex items-center justify-between mb-2 gap-2 flex-wrap", children: [_jsx("span", { className: "font-medium text-charcoal-700", children: fmt.label }), _jsx(SemaphoreBadge, { level: sem, note: `Disponible ${formatQty(av, fmt.unit)}` })] }), _jsx(Stepper, { value: current.qty, onChange: (qty) => setPending((s) => ({ ...s, [fmt.formatId]: { ...current, qty } })), step: fmt.unit === 'kg' ? 0.5 : 1, decimals: fmt.unit === 'kg' ? 2 : 0, quick: fmt.unit === 'kg' ? [0.5, 1, 5] : [1, 5, 10] }), _jsx("input", { value: current.notes, onChange: (e) => setPending((s) => ({ ...s, [fmt.formatId]: { ...current, notes: e.target.value } })), placeholder: "Notas \u2014 laminado fino, sin jugo\u2026", className: "field mt-2.5 h-10 text-sm" })] }, fmt.formatId));
                }) }), _jsxs("div", { className: "flex gap-2 mt-5", children: [_jsx(Button, { variant: "secondary", onClick: onClose, className: "flex-1", children: "Cancelar" }), _jsx(Button, { onClick: commit, className: "flex-1", children: "Agregar" })] })] }));
}
function SelectedLines({ lines, onRemove }) {
    if (lines.length === 0)
        return null;
    return (_jsxs("div", { className: "card p-4", children: [_jsx("p", { className: "eyebrow mb-2", children: "L\u00EDneas en este pedido" }), _jsx("ul", { className: "divide-y divide-charcoal-100", children: lines.map((l) => (_jsxs("li", { className: "flex items-center justify-between gap-2 text-sm py-2 first:pt-0 last:pb-0", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "text-charcoal-700 truncate font-medium", children: l.productName }), _jsxs("div", { className: "text-xs text-charcoal-300 truncate", children: [l.formatLabel, l.notes ? ` · ${l.notes}` : ''] })] }), _jsxs("div", { className: "flex items-center gap-3 shrink-0", children: [_jsx("span", { className: "font-semibold text-charcoal-700", children: formatQty(l.qty, l.unit) }), _jsx("button", { onClick: () => onRemove(l), className: "text-[11px] uppercase tracking-display text-charcoal-300 hover:text-red-700", children: "Quitar" })] })] }, `${l.productId}-${l.formatId}`))) })] }));
}
// ---------- Step 3: Entrega ----------
function StepEntrega({ client, draft, onUpdate, onNext, onBack, }) {
    return (_jsxs("section", { className: "space-y-5", children: [_jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Fecha solicitada" }), _jsx("input", { type: "date", value: draft.requestedDate, min: minRequestedDate(), onChange: (e) => onUpdate('requestedDate', e.target.value), className: "field" }), _jsx("p", { className: "text-xs text-charcoal-300 mt-1.5 first-letter:uppercase", children: formatDateLong(draft.requestedDate) })] }), _jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Modalidad" }), _jsx("div", { className: "grid grid-cols-2 gap-2", children: ['retiro', 'despacho'].map((m) => (_jsx("button", { onClick: () => onUpdate('deliveryMode', m), className: 'h-12 rounded-md border text-sm font-medium uppercase tracking-display transition ' +
                                (draft.deliveryMode === m
                                    ? 'bg-charcoal-900 text-cream-50 border-charcoal-900'
                                    : 'bg-white border-charcoal-200 text-charcoal-500 hover:border-charcoal-300'), children: m === 'retiro' ? 'Retiro en tienda' : 'Despacho' }, m))) })] }), draft.deliveryMode === 'despacho' && (_jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Direcci\u00F3n de despacho" }), _jsx("input", { value: draft.deliveryAddress || client.address || '', onChange: (e) => onUpdate('deliveryAddress', e.target.value), placeholder: "Direcci\u00F3n (prefijada del cliente)", className: "field" })] })), _jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1.5", children: "Horario de recepci\u00F3n" }), _jsx("input", { value: draft.receivingHours || client.receivingHours || '', onChange: (e) => onUpdate('receivingHours', e.target.value), placeholder: "Ej: L-V 09:00-14:00", className: "field" })] }), _jsxs("div", { className: "flex gap-2 pt-2", children: [_jsx(Button, { variant: "secondary", onClick: onBack, className: "flex-1", children: "Volver" }), _jsx(Button, { onClick: onNext, className: "flex-1", children: "Siguiente" })] })] }));
}
// ---------- Step 4: Confirmar ----------
function StepConfirmar({ client, draft, stock, submitting, error, onBack, onSubmit, }) {
    const preview = useMemo(() => draft.lines.map((l) => {
        const av = availableFor(stock, l.productId, l.formatId);
        return { line: l, available: av, reserved: Math.min(av, l.qty), pending: Math.max(0, l.qty - av) };
    }), [draft.lines, stock]);
    const anyPending = preview.some((p) => p.pending > 0);
    return (_jsxs("section", { className: "space-y-4", children: [_jsxs("div", { className: "card p-4", children: [_jsx("p", { className: "eyebrow", children: "Cliente" }), _jsx("p", { className: "font-semibold text-charcoal-900 mt-1", children: client.fantasyName ?? client.name }), _jsxs("p", { className: "text-xs text-charcoal-300 mt-0.5", children: [client.rut ?? 'Sin RUT', " \u00B7 ", draft.deliveryMode === 'retiro' ? 'Retiro' : (draft.deliveryAddress || client.address)] }), _jsxs("p", { className: "text-xs text-charcoal-300 mt-1.5 first-letter:uppercase", children: ["Solicitado para ", formatDateLong(draft.requestedDate)] }), !client.invoicingComplete && (_jsx("p", { className: "mt-3 text-xs text-brass-700 bg-brass-50 border border-brass-300 rounded px-2 py-1.5", children: "Datos de facturaci\u00F3n incompletos \u2014 se crear\u00E1 y quedar\u00E1 marcado." }))] }), _jsxs("div", { className: "card p-4", children: [_jsxs("p", { className: "eyebrow mb-2", children: ["L\u00EDneas (", preview.length, ")"] }), _jsx("ul", { className: "divide-y divide-charcoal-100", children: preview.map((p) => (_jsxs("li", { className: "py-2.5 first:pt-0 last:pb-0 text-sm", children: [_jsxs("div", { className: "flex justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "text-charcoal-700 truncate font-medium", children: p.line.productName }), _jsxs("div", { className: "text-xs text-charcoal-300 truncate", children: [p.line.formatLabel, p.line.notes ? ` · ${p.line.notes}` : ''] })] }), _jsx("div", { className: "font-semibold text-charcoal-700 shrink-0", children: formatQty(p.line.qty, p.line.unit) })] }), p.pending > 0 && (_jsxs("p", { className: "text-[11px] uppercase tracking-display text-brass-700 mt-1", children: [formatQty(p.reserved, p.line.unit), " reservado \u00B7 ", formatQty(p.pending, p.line.unit), " a producci\u00F3n"] }))] }, `${p.line.productId}-${p.line.formatId}`))) })] }), anyPending && (_jsx("div", { className: "rounded-md bg-brass-50 border border-brass-300 text-brass-700 p-3 text-sm", children: "Alguna l\u00EDnea no tiene stock suficiente. Se enviar\u00E1 lo disponible y el resto queda a producci\u00F3n." })), error && (_jsx("div", { className: "rounded-md bg-red-50 border border-red-200 text-red-800 p-3 text-sm", children: error })), _jsxs("div", { className: "flex gap-2 pt-2", children: [_jsx(Button, { variant: "secondary", onClick: onBack, disabled: submitting, className: "flex-1", children: "Volver" }), _jsx(Button, { onClick: onSubmit, disabled: submitting, className: "flex-1", children: submitting ? 'Enviando…' : 'Enviar pedido' })] })] }));
}
