import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { DEMO_PASSWORD, demoUsers } from '@/data/demo-users';
import { signInWithPassword, ROLE_LABEL } from '@/data/auth';
import Logo from '@/components/ui/Logo';
const ROLE_ORDER = ['vendedor', 'despacho', 'produccion', 'admin', 'superAdmin'];
export default function Login() {
    const [pending, setPending] = useState(null);
    const [error, setError] = useState(null);
    async function loginAs(user) {
        setPending(user.uid);
        setError(null);
        try {
            await signInWithPassword(user.email, DEMO_PASSWORD);
        }
        catch {
            setError('No se pudo iniciar sesión. Verifique que los usuarios estén sembrados en el proyecto.');
            setPending(null);
        }
    }
    return (_jsx("main", { className: "min-h-screen bg-cream-50", children: _jsxs("div", { className: "mx-auto max-w-lg px-6 pt-12 pb-16", children: [_jsx("header", { className: "text-center mb-10", children: _jsxs("div", { className: "flex flex-col items-center gap-4", children: [_jsx(Logo, { size: 68 }), _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "La Charcuter\u00EDa Artesanal" }), _jsx("h1", { className: "mt-1 text-3xl font-semibold text-charcoal-900 tracking-display uppercase", children: "Comandas" }), _jsx("p", { className: "mt-2 text-xs text-charcoal-300 tracking-display uppercase", children: "Barrio Franklin \u00B7 Santiago" })] })] }) }), _jsxs("section", { className: "space-y-6", children: [_jsx("div", { className: "text-center", children: _jsx("p", { className: "eyebrow", children: "Elija su perfil" }) }), _jsx("div", { className: "space-y-5", children: ROLE_ORDER.map((role) => {
                                const users = demoUsers.filter((u) => u.role === role);
                                if (users.length === 0)
                                    return null;
                                return (_jsx(RoleGroup, { role: role, users: users, pending: pending, onPick: loginAs }, role));
                            }) }), error && (_jsx("div", { className: "rounded-md border border-red-200 bg-red-50 text-red-800 text-sm px-3 py-2", children: error })), _jsxs("p", { className: "text-[11px] text-charcoal-300 text-center tracking-[0.03em]", children: ["Contrase\u00F1a demo: ", _jsx("code", { className: "font-mono text-charcoal-500", children: DEMO_PASSWORD })] })] })] }) }));
}
function RoleGroup({ role, users, pending, onPick, }) {
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-2 mb-2 px-1", children: [_jsx("span", { className: "h-px flex-1 bg-charcoal-100" }), _jsx("span", { className: "eyebrow whitespace-nowrap", children: ROLE_LABEL[role] }), _jsx("span", { className: "h-px flex-1 bg-charcoal-100" })] }), _jsx("div", { className: "grid grid-cols-2 sm:grid-cols-3 gap-2", children: users.map((u) => {
                    const isPending = pending === u.uid;
                    return (_jsxs("button", { type: "button", onClick: () => onPick(u), disabled: pending !== null, className: "group card p-3 text-left transition hover:border-brass-500 hover:shadow-lift active:scale-[0.98] disabled:opacity-50", children: [_jsx("div", { className: "font-semibold text-charcoal-700 text-sm", children: u.displayName }), _jsx("div", { className: "text-[11px] text-charcoal-300 mt-0.5 tracking-[0.02em]", children: isPending ? 'Ingresando…' : ROLE_LABEL[u.role] })] }, u.uid));
                }) })] }));
}
