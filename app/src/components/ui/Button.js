import { jsx as _jsx } from "react/jsx-runtime";
const BASE = 'inline-flex items-center justify-center gap-2 rounded-md font-medium tracking-[0.02em] transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brass-500/40';
const VARIANT = {
    primary: 'bg-charcoal-700 text-cream-50 hover:bg-charcoal-900 shadow-soft',
    secondary: 'bg-white border border-charcoal-200 text-charcoal-700 hover:border-charcoal-300 hover:bg-cream-50',
    ghost: 'text-charcoal-500 hover:bg-cream-100',
    danger: 'bg-red-700 text-white hover:bg-red-800 shadow-soft',
};
const SIZE = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-5 py-3 text-base',
};
export default function Button({ variant = 'primary', size = 'md', className = '', ...rest }) {
    return (_jsx("button", { ...rest, className: `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}` }));
}
