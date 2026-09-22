import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export default function Placeholder({ title, hint }) {
    return (_jsxs("div", { className: "rounded-xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsx("h2", { className: "text-lg font-semibold text-slate-900", children: title }), _jsx("p", { className: "text-sm text-slate-500 mt-1", children: hint ?? 'Pantalla pendiente en próximo hito.' })] }));
}
