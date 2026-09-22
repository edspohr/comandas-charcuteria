import { jsx as _jsx } from "react/jsx-runtime";
const BASE = 'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none';
const VARIANT = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm',
    secondary: 'bg-white border border-slate-200 text-slate-900 hover:bg-slate-50 shadow-sm',
    ghost: 'text-slate-700 hover:bg-slate-100',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
};
const SIZE = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-3 text-base',
};
export default function Button({ variant = 'primary', size = 'md', className = '', ...rest }) {
    return (_jsx("button", { ...rest, className: `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}` }));
}
