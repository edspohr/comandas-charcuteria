import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@/components/ui/Button';
import { useCurrentUser } from '@/data/auth';
import { useProducts } from '@/data/products';
import { parseLocal } from '@/domain/parse/local';
import { saveDraft } from '@/lib/draft';
import { defaultRequestedDate } from '@/domain/cutoff';
import { formatQty } from '@/lib/format';
const SAMPLE = `Buenos días! Para mañana necesito:
- 3 kg de jamón cocido laminado fino
- 12 sachet 500g longaniza chillán
- 2 piezas de coppa
- 500g pastrami vacuno sin jugo`;
export default function PegarPedido() {
    const { current } = useCurrentUser();
    const uid = current.appUser.uid;
    const navigate = useNavigate();
    const { products, loading } = useProducts();
    const [text, setText] = useState('');
    const [parsed, setParsed] = useState(null);
    function interpret() {
        setParsed(parseLocal(text, products));
    }
    function useSample() {
        setText(SAMPLE);
    }
    function selectSuggestion(idx, productId, catalog) {
        setParsed((prev) => {
            if (!prev)
                return prev;
            const copy = [...prev];
            const line = copy[idx];
            const prod = catalog.find((p) => p.id === productId);
            if (!prod)
                return prev;
            const fmt = prod.formats.find((f) => f.formatId === line.formatId) ?? prod.formats[0];
            copy[idx] = {
                ...line,
                productId: prod.id,
                productName: prod.name,
                formatId: fmt.formatId,
                formatLabel: fmt.label,
                unit: fmt.unit,
                status: 'review',
            };
            return copy;
        });
    }
    function updateFormat(idx, formatId) {
        setParsed((prev) => {
            if (!prev)
                return prev;
            const copy = [...prev];
            const line = copy[idx];
            const prod = products.find((p) => p.id === line.productId);
            const fmt = prod?.formats.find((f) => f.formatId === formatId);
            if (!fmt)
                return prev;
            copy[idx] = { ...line, formatId, formatLabel: fmt.label, unit: fmt.unit };
            return copy;
        });
    }
    function updateQty(idx, qty) {
        setParsed((prev) => {
            if (!prev)
                return prev;
            const copy = [...prev];
            copy[idx] = { ...copy[idx], qty };
            return copy;
        });
    }
    function removeLine(idx) {
        setParsed((prev) => prev ? prev.filter((_, i) => i !== idx) : prev);
    }
    function transferToWizard() {
        const usable = (parsed ?? []).filter((l) => l.productId && l.formatId && l.unit && l.qty && l.qty > 0);
        if (usable.length === 0)
            return;
        const draft = {
            clientId: null,
            lines: usable.map((l) => ({
                productId: l.productId,
                productName: l.productName,
                formatId: l.formatId,
                formatLabel: l.formatLabel,
                unit: l.unit,
                qty: l.qty,
                notes: l.notes,
            })),
            requestedDate: defaultRequestedDate(15),
            deliveryMode: 'despacho',
            deliveryAddress: '',
            receivingHours: '',
            step: 1,
        };
        saveDraft(uid, draft);
        navigate('/vendedor/nuevo');
    }
    return (_jsxs("div", { className: "max-w-2xl mx-auto", children: [_jsxs("header", { className: "mb-6", children: [_jsx("p", { className: "eyebrow", children: "Vendedor" }), _jsx("h1", { className: "text-2xl font-semibold text-charcoal-900 tracking-display uppercase", children: "Pegar pedido" }), _jsx("p", { className: "text-xs text-charcoal-300 mt-1", children: "Pegue el mensaje del cliente. Interpretamos productos, formatos y cantidades. Ustd revisa antes de continuar." })] }), _jsxs("div", { className: "card p-4 mb-4", children: [_jsx("textarea", { value: text, onChange: (e) => setText(e.target.value), rows: 8, placeholder: "Pegue aqu\u00ED el mensaje del cliente\u2026", className: "field h-auto py-3 text-sm resize-y" }), _jsxs("div", { className: "flex items-center gap-2 mt-3", children: [_jsx(Button, { onClick: interpret, disabled: loading || text.trim().length < 3, className: "flex-1", children: "Interpretar" }), _jsx(Button, { variant: "secondary", onClick: useSample, children: "Ejemplo" })] })] }), parsed && parsed.length > 0 && (_jsxs("section", { children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsxs("p", { className: "eyebrow", children: ["L\u00EDneas propuestas \u00B7 ", parsed.length] }), _jsxs("span", { className: "text-[10px] uppercase tracking-display text-charcoal-300", children: [parsed.filter((l) => l.status === 'verified').length, " verificadas \u00B7 ", parsed.filter((l) => l.status === 'review').length, " a revisar \u00B7 ", parsed.filter((l) => l.status === 'not_found').length, " no encontradas"] })] }), _jsx("ul", { className: "space-y-2 mb-4", children: parsed.map((line, i) => (_jsx("li", { children: _jsx(ParsedLineCard, { line: line, products: products, onSelectSuggestion: (pid) => selectSuggestion(i, pid, products), onFormatChange: (fid) => updateFormat(i, fid), onQtyChange: (q) => updateQty(i, q), onRemove: () => removeLine(i) }) }, i))) }), _jsx(Button, { onClick: transferToWizard, disabled: !parsed.some((l) => l.productId && l.formatId && (l.qty ?? 0) > 0), className: "w-full", children: "Continuar en el wizard \u2192" })] })), parsed && parsed.length === 0 && (_jsx("div", { className: "card p-6 text-center text-sm text-charcoal-500", children: "No se pudieron identificar l\u00EDneas. Ajuste el texto e intente de nuevo." }))] }));
}
const STATUS_STYLE = {
    verified: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    review: 'bg-brass-50 text-brass-700 border-brass-300',
    not_found: 'bg-red-50 text-red-800 border-red-200',
};
const STATUS_LABEL = {
    verified: 'Verificado',
    review: 'Revisar',
    not_found: 'No encontrado',
};
function ParsedLineCard({ line, products, onSelectSuggestion, onFormatChange, onQtyChange, onRemove, }) {
    const prod = products.find((p) => p.id === line.productId);
    return (_jsxs("div", { className: "card p-4", children: [_jsxs("div", { className: "flex items-start justify-between gap-2 mb-2", children: [_jsxs("p", { className: "text-xs text-charcoal-300 italic truncate", children: ["\"", line.raw, "\""] }), _jsx("span", { className: `shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-display font-semibold ${STATUS_STYLE[line.status]}`, children: STATUS_LABEL[line.status] })] }), line.status === 'not_found' ? (_jsx("p", { className: "text-sm text-red-800", children: "No encontramos un producto para esta l\u00EDnea. Borre y agregue manualmente en el wizard." })) : (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1", children: "Producto" }), _jsx("select", { value: line.productId ?? '', onChange: (e) => onSelectSuggestion(e.target.value), className: "field h-10 text-sm", children: line.suggestions?.map((s) => (_jsx("option", { value: s.productId, children: s.productName }, s.productId))) })] }), prod && (_jsxs("div", { children: [_jsx("label", { className: "eyebrow block mb-1", children: "Formato" }), _jsx("select", { value: line.formatId ?? '', onChange: (e) => onFormatChange(e.target.value), className: "field h-10 text-sm", children: prod.formats.map((f) => (_jsx("option", { value: f.formatId, children: f.label }, f.formatId))) })] })), _jsxs("div", { children: [_jsxs("label", { className: "eyebrow block mb-1", children: ["Cantidad ", line.unit && `(${line.unit === 'kg' ? 'kg' : line.unit === 'g' ? 'g' : 'u'})`] }), _jsx("input", { type: "number", inputMode: "decimal", step: line.unit === 'kg' ? '0.1' : '1', value: line.qty ?? '', onChange: (e) => onQtyChange(parseFloat(e.target.value)), className: "field h-10 text-sm" }), line.qty && line.unit && _jsx("p", { className: "text-[11px] text-charcoal-300 mt-1", children: formatQty(line.qty, line.unit) })] }), line.notes && (_jsxs("p", { className: "text-xs text-charcoal-500", children: ["Notas: ", _jsx("em", { children: line.notes })] }))] })), _jsx("div", { className: "mt-3 pt-3 border-t border-charcoal-100 text-right", children: _jsx("button", { onClick: onRemove, className: "text-[11px] uppercase tracking-display text-charcoal-300 hover:text-red-700", children: "Quitar l\u00EDnea" }) })] }));
}
