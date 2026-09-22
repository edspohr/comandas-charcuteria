import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useLocation } from 'react-router-dom';
import { ROLE_LABEL, signOut } from '@/data/auth';
import Logo from '@/components/ui/Logo';
const NAV = [
    { to: '/vendedor/nuevo', label: 'Nuevo pedido', roles: ['vendedor', 'admin', 'superAdmin'] },
    { to: '/vendedor/mis', label: 'Mis pedidos', roles: ['vendedor', 'admin', 'superAdmin'] },
    { to: '/despacho/cola', label: 'Cola de despacho', roles: ['despacho', 'admin', 'superAdmin'] },
    { to: '/produccion', label: 'Producción', roles: ['produccion', 'admin', 'superAdmin'] },
    { to: '/admin/facturacion', label: 'Facturación', roles: ['admin', 'superAdmin'] },
    { to: '/admin/panel', label: 'Panel', roles: ['admin', 'superAdmin'] },
    { to: '/admin/catalogo', label: 'Catálogo', roles: ['admin', 'superAdmin'] },
    { to: '/admin/usuarios', label: 'Usuarios', roles: ['superAdmin'] },
];
export default function AppShell({ current, children }) {
    const { pathname } = useLocation();
    const items = NAV.filter((n) => n.roles.includes(current.appUser.role));
    return (_jsxs("div", { className: "min-h-screen bg-cream-50 flex flex-col", children: [_jsxs("header", { className: "bg-charcoal-900 text-cream-50 sticky top-0 z-10 shadow-lift", children: [_jsxs("div", { className: "max-w-5xl mx-auto px-4 h-14 flex items-center justify-between", children: [_jsxs(Link, { to: "/", className: "flex items-center gap-2.5 group", children: [_jsx(Logo, { size: 30 }), _jsx("span", { className: "font-semibold tracking-display uppercase text-sm", children: "Comandas" })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("div", { className: "text-right leading-tight hidden sm:block", children: [_jsx("div", { className: "text-sm font-medium", children: current.appUser.displayName }), _jsx("div", { className: "text-[10px] text-cream-100/70 uppercase tracking-display", children: ROLE_LABEL[current.appUser.role] })] }), _jsx("button", { onClick: signOut, className: "text-[11px] uppercase tracking-display text-cream-100/80 hover:text-cream-50 border border-cream-100/20 hover:border-cream-100/50 rounded-md px-3 py-1.5 transition", children: "Salir" })] })] }), items.length > 1 && (_jsx("nav", { className: "border-t border-cream-100/10", children: _jsx("div", { className: "max-w-5xl mx-auto px-2 overflow-x-auto", children: _jsx("ul", { className: "flex gap-0 py-0", children: items.map((item) => {
                                    const active = pathname === item.to || pathname.startsWith(item.to + '/');
                                    return (_jsx("li", { children: _jsx(Link, { to: item.to, className: 'inline-block px-3.5 py-2.5 text-[11px] uppercase tracking-display whitespace-nowrap border-b-2 transition ' +
                                                (active
                                                    ? 'text-brass-300 border-brass-500'
                                                    : 'text-cream-100/70 border-transparent hover:text-cream-50 hover:border-cream-100/30'), children: item.label }) }, item.to));
                                }) }) }) }))] }), _jsx("main", { className: "flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6", children: children }), _jsx("footer", { className: "text-center py-6 text-[10px] uppercase tracking-display text-charcoal-300", children: "La Charcuter\u00EDa Artesanal \u00B7 Barrio Franklin" })] }));
}
