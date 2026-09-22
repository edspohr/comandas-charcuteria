import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/data/firebase';
import { ROLE_LABEL } from '@/data/auth';
const ROLE_ORDER = ['superAdmin', 'admin', 'produccion', 'despacho', 'vendedor'];
export default function Usuarios() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'users'), (snap) => {
            const list = [];
            snap.forEach((d) => list.push(d.data()));
            list.sort((a, b) => {
                const ra = ROLE_ORDER.indexOf(a.role), rb = ROLE_ORDER.indexOf(b.role);
                if (ra !== rb)
                    return ra - rb;
                return a.displayName.localeCompare(b.displayName, 'es');
            });
            setUsers(list);
            setLoading(false);
        });
        return unsub;
    }, []);
    return (_jsxs("div", { children: [_jsxs("header", { className: "mb-6", children: [_jsx("p", { className: "eyebrow", children: "Super Administraci\u00F3n" }), _jsx("h1", { className: "text-2xl font-semibold text-charcoal-900 tracking-display uppercase", children: "Usuarios" }), _jsx("p", { className: "text-xs text-charcoal-300 mt-1", children: "Vista de s\u00F3lo lectura. Los permisos se gestionan en Firebase Console mientras est\u00E9 en demo." })] }), loading && _jsx("p", { className: "text-sm text-charcoal-300", children: "Cargando\u2026" }), _jsx("div", { className: "space-y-6", children: ROLE_ORDER.map((role) => {
                    const list = users.filter((u) => u.role === role);
                    if (list.length === 0)
                        return null;
                    return (_jsxs("section", { children: [_jsxs("div", { className: "flex items-center gap-2 mb-2", children: [_jsx("span", { className: "h-px flex-1 bg-charcoal-100" }), _jsxs("span", { className: "eyebrow whitespace-nowrap", children: [ROLE_LABEL[role], " \u00B7 ", list.length] }), _jsx("span", { className: "h-px flex-1 bg-charcoal-100" })] }), _jsx("ul", { className: "grid grid-cols-1 sm:grid-cols-2 gap-2", children: list.map((u) => (_jsxs("li", { className: "card p-3", children: [_jsx("p", { className: "font-semibold text-charcoal-900", children: u.displayName }), _jsx("p", { className: "text-xs text-charcoal-300 mt-0.5 truncate", children: u.email })] }, u.uid))) })] }, role));
                }) })] }));
}
