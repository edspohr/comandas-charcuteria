import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { DEMO_PASSWORD, demoUsers } from '@/data/demo-users';
import { signInWithPassword } from '@/data/auth';
import { ROLE_LABEL } from '@/data/auth';
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
        catch (e) {
            setError('No se pudo iniciar sesión. ¿Corrió el seed contra el emulador?');
            setPending(null);
        }
    }
    return (_jsx("main", { className: "min-h-screen bg-brand-50 p-6 flex flex-col items-center", children: _jsxs("div", { className: "w-full max-w-lg", children: [_jsxs("header", { className: "text-center mb-8 mt-4", children: [_jsx("h1", { className: "text-3xl font-semibold text-brand-700", children: "Comandas" }), _jsx("p", { className: "text-sm text-slate-600 mt-1", children: "La Charcuter\u00EDa Artesanal" })] }), _jsxs("section", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs uppercase tracking-wide text-slate-500 font-medium mb-2 px-1", children: "Ingrese como usuario de demo" }), _jsx("div", { className: "space-y-4", children: ROLE_ORDER.map((role) => (_jsx(RoleGroup, { role: role, users: demoUsers.filter((u) => u.role === role), pending: pending, onPick: loginAs }, role))) })] }), error && (_jsx("div", { className: "rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm p-3", children: error })), _jsxs("p", { className: "text-xs text-slate-500 text-center", children: ["Contrase\u00F1a de todos los usuarios: ", _jsx("code", { className: "font-mono", children: DEMO_PASSWORD })] })] })] }) }));
}
function RoleGroup({ role, users, pending, onPick, }) {
    return (_jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold text-slate-700 mb-2 px-1", children: ROLE_LABEL[role] }), _jsx("div", { className: "grid grid-cols-2 sm:grid-cols-3 gap-2", children: users.map((u) => {
                    const isPending = pending === u.uid;
                    return (_jsxs("button", { type: "button", onClick: () => onPick(u), disabled: pending !== null, className: "rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm active:scale-[0.98] transition disabled:opacity-50", children: [_jsx("div", { className: "font-medium text-slate-900", children: u.displayName }), _jsx("div", { className: "text-xs text-slate-500 mt-0.5", children: isPending ? 'Ingresando…' : ROLE_LABEL[u.role] })] }, u.uid));
                }) })] }));
}
