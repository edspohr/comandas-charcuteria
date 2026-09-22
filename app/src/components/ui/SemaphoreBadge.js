import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const STYLE = {
    ok: 'bg-emerald-100 text-emerald-800',
    partial: 'bg-amber-100 text-amber-800',
    none: 'bg-red-100 text-red-800',
};
const LABEL = {
    ok: 'Stock OK',
    partial: 'Stock parcial',
    none: 'Sin stock',
};
export default function SemaphoreBadge({ level, note }) {
    return (_jsxs("span", { className: `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[level]}`, children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-current opacity-70" }), note ?? LABEL[level]] }));
}
