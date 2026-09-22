import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
export default function Stepper({ value, onChange, min = 0, step = 1, quick = [1, 5, 10], decimals = 0 }) {
    const [raw, setRaw] = useState(value.toString());
    function commit(next) {
        const clamped = Math.max(min, Number.isFinite(next) ? next : min);
        const rounded = decimals > 0 ? Number(clamped.toFixed(decimals)) : Math.round(clamped);
        onChange(rounded);
        setRaw(rounded.toString());
    }
    return (_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsxs("div", { className: "inline-flex items-center rounded-xl border border-slate-200 bg-white overflow-hidden", children: [_jsx("button", { type: "button", onClick: () => commit(value - step), className: "w-10 h-10 text-lg text-slate-700 hover:bg-slate-50 active:bg-slate-100", "aria-label": "Restar", children: "\u2212" }), _jsx("input", { type: "number", inputMode: "decimal", value: raw, onChange: (e) => setRaw(e.target.value), onBlur: () => commit(parseFloat(raw)), className: "w-16 h-10 text-center outline-none border-x border-slate-200" }), _jsx("button", { type: "button", onClick: () => commit(value + step), className: "w-10 h-10 text-lg text-slate-700 hover:bg-slate-50 active:bg-slate-100", "aria-label": "Sumar", children: "+" })] }), _jsx("div", { className: "flex gap-1", children: quick.map((q) => (_jsxs("button", { type: "button", onClick: () => commit(value + q), className: "rounded-full bg-slate-100 hover:bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700", children: ["+", q] }, q))) })] }));
}
