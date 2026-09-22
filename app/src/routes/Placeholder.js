import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export default function Placeholder({ title, hint }) {
    return (_jsxs("div", { className: "max-w-2xl mx-auto", children: [_jsxs("header", { className: "mb-6", children: [_jsx("p", { className: "eyebrow", children: "Secci\u00F3n" }), _jsx("h1", { className: "text-2xl font-semibold text-charcoal-900 tracking-display uppercase", children: title })] }), _jsxs("div", { className: "card p-8 text-center", children: [_jsx("p", { className: "eyebrow mb-2", children: "Pr\u00F3ximamente" }), _jsx("p", { className: "text-sm text-charcoal-500", children: hint ?? 'Pantalla pendiente en próximo hito.' })] })] }));
}
