import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useLocation } from 'react-router-dom';
import { ROLE_LABEL, signOut } from '@/data/auth';
const NAV = [
    { to: '/vendedor/nuevo', label: 'Nuevo pedido', roles: ['vendedor', 'admin'] },
    { to: '/vendedor/mis', label: 'Mis pedidos', roles: ['vendedor', 'admin'] },
    { to: '/armador/cola', label: 'Cola de armado', roles: ['armador', 'admin'] },
    { to: '/produccion', label: 'Producción', roles: ['produccion', 'admin'] },
    { to: '/admin/facturacion', label: 'Facturación', roles: ['admin'] },
    { to: '/admin/panel', label: 'Panel', roles: ['admin'] },
    { to: '/admin/catalogo', label: 'Catálogo', roles: ['admin'] },
];
export default function AppShell({ current, children }) {
    const { pathname } = useLocation();
    const items = NAV.filter((n) => n.roles.includes(current.appUser.role));
    return (_jsxs("div", { className: "min-h-screen bg-brand-50 flex flex-col", children: [_jsxs("header", { className: "bg-white border-b border-slate-200 sticky top-0 z-10", children: [_jsxs("div", { className: "max-w-5xl mx-auto px-4 h-14 flex items-center justify-between", children: [_jsx(Link, { to: "/", className: "font-semibold text-brand-700", children: "Comandas" }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("span", { className: "text-sm text-slate-700", children: [current.appUser.displayName, _jsxs("span", { className: "text-slate-400 ml-2", children: ["\u00B7 ", ROLE_LABEL[current.appUser.role]] })] }), _jsx("button", { onClick: signOut, className: "text-sm text-slate-600 hover:text-slate-900 px-2 py-1 rounded", children: "Salir" })] })] }), items.length > 1 && (_jsx("nav", { className: "max-w-5xl mx-auto px-2 overflow-x-auto", children: _jsx("ul", { className: "flex gap-1 py-1", children: items.map((item) => {
                                const active = pathname === item.to || pathname.startsWith(item.to + '/');
                                return (_jsx("li", { children: _jsx(Link, { to: item.to, className: 'px-3 py-1.5 rounded-full text-sm whitespace-nowrap ' +
                                            (active
                                                ? 'bg-brand-500 text-white'
                                                : 'text-slate-600 hover:bg-slate-100'), children: item.label }) }, item.to));
                            }) }) }))] }), _jsx("main", { className: "flex-1 max-w-5xl w-full mx-auto p-4", children: children })] }));
}
