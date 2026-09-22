import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Login from './routes/Login';
import NuevoPedido from './routes/vendedor/NuevoPedido';
import MisPedidos from './routes/vendedor/MisPedidos';
import DetallePedido from './routes/vendedor/DetallePedido';
import PegarPedido from './routes/vendedor/PegarPedido';
import ColaDespacho from './routes/despacho/ColaDespacho';
import DetalleArmado from './routes/despacho/DetalleArmado';
import Produccion from './routes/produccion/Produccion';
import Facturacion from './routes/admin/Facturacion';
import Panel from './routes/admin/Panel';
import Catalogo from './routes/admin/Catalogo';
import Usuarios from './routes/admin/Usuarios';
import AppShell from './components/AppShell';
import RouteGuard from './components/RouteGuard';
import { useCurrentUser, ROLE_HOME } from './data/auth';
export default function App() {
    const { current, loading } = useCurrentUser();
    if (loading) {
        return (_jsx("div", { className: "min-h-screen flex items-center justify-center text-slate-500", children: "Cargando\u2026" }));
    }
    return (_jsx(BrowserRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: current ? _jsx(Navigate, { to: ROLE_HOME[current.appUser.role], replace: true }) : _jsx(Login, {}) }), _jsx(Route, { path: "/", element: current ? _jsx(Navigate, { to: ROLE_HOME[current.appUser.role], replace: true }) : _jsx(Navigate, { to: "/login", replace: true }) }), _jsx(Route, { path: "/vendedor/nuevo", element: _jsx(RouteGuard, { current: current, allow: ['vendedor', 'admin', 'superAdmin'], children: _jsx(AppShell, { current: current, children: _jsx(NuevoPedido, {}) }) }) }), _jsx(Route, { path: "/vendedor/pegar", element: _jsx(RouteGuard, { current: current, allow: ['vendedor', 'admin', 'superAdmin'], children: _jsx(AppShell, { current: current, children: _jsx(PegarPedido, {}) }) }) }), _jsx(Route, { path: "/vendedor/mis", element: _jsx(RouteGuard, { current: current, allow: ['vendedor', 'admin', 'superAdmin'], children: _jsx(AppShell, { current: current, children: _jsx(MisPedidos, {}) }) }) }), _jsx(Route, { path: "/vendedor/mis/:orderId", element: _jsx(RouteGuard, { current: current, allow: ['vendedor', 'admin', 'superAdmin'], children: _jsx(AppShell, { current: current, children: _jsx(DetallePedido, {}) }) }) }), _jsx(Route, { path: "/despacho/cola", element: _jsx(RouteGuard, { current: current, allow: ['despacho', 'admin', 'superAdmin'], children: _jsx(AppShell, { current: current, children: _jsx(ColaDespacho, {}) }) }) }), _jsx(Route, { path: "/despacho/cola/:orderId", element: _jsx(RouteGuard, { current: current, allow: ['despacho', 'admin', 'superAdmin'], children: _jsx(AppShell, { current: current, children: _jsx(DetalleArmado, {}) }) }) }), _jsx(Route, { path: "/produccion", element: _jsx(RouteGuard, { current: current, allow: ['produccion', 'admin', 'superAdmin'], children: _jsx(AppShell, { current: current, children: _jsx(Produccion, {}) }) }) }), _jsx(Route, { path: "/admin/panel", element: _jsx(RouteGuard, { current: current, allow: ['admin', 'superAdmin'], children: _jsx(AppShell, { current: current, children: _jsx(Panel, {}) }) }) }), _jsx(Route, { path: "/admin/facturacion", element: _jsx(RouteGuard, { current: current, allow: ['admin', 'superAdmin'], children: _jsx(AppShell, { current: current, children: _jsx(Facturacion, {}) }) }) }), _jsx(Route, { path: "/admin/catalogo", element: _jsx(RouteGuard, { current: current, allow: ['admin', 'superAdmin'], children: _jsx(AppShell, { current: current, children: _jsx(Catalogo, {}) }) }) }), _jsx(Route, { path: "/admin/usuarios", element: _jsx(RouteGuard, { current: current, allow: ['superAdmin'], children: _jsx(AppShell, { current: current, children: _jsx(Usuarios, {}) }) }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }) }));
}
