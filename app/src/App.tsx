import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
// Screens load on demand: the first paint (login, tablero for most roles)
// doesn't pay for the Panel's charts or the admin tools.
import Login from './routes/Login';
const NuevoPedido = lazy(() => import('./routes/vendedor/NuevoPedido'));
const DetallePedido = lazy(() => import('./routes/vendedor/DetallePedido'));
const PegarPedido = lazy(() => import('./routes/vendedor/PegarPedido'));
const DetalleArmado = lazy(() => import('./routes/despacho/DetalleArmado'));
const Produccion = lazy(() => import('./routes/produccion/Produccion'));
const Tablero = lazy(() => import('./routes/Tablero'));
const Clientes = lazy(() => import('./routes/clientes/Clientes'));
const FichaCliente = lazy(() => import('./routes/clientes/FichaCliente'));
const BsaleConsola = lazy(() => import('./routes/admin/Bsale'));
const Panel = lazy(() => import('./routes/admin/PanelGestion'));
const Ayuda = lazy(() => import('./routes/Ayuda'));
const Catalogo = lazy(() => import('./routes/admin/Catalogo'));
const Usuarios = lazy(() => import('./routes/admin/Usuarios'));
const Explorador = lazy(() => import('./routes/bsale/Explorador'));
import UpdateToast from './components/UpdateToast';
import AppShell from './components/AppShell';
import RouteGuard from './components/RouteGuard';
import { useCurrentUser } from './data/auth';
import { ROLE_HOME } from './domain/permissions';

export default function App() {
  const { current, loading } = useCurrentUser();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Cargando…
      </div>
    );
  }

  return (
    <BrowserRouter>
      <UpdateToast />
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-charcoal-300 text-sm">Cargando…</div>}>
      <Routes>
        <Route path="/login" element={current ? <Navigate to={ROLE_HOME[current.appUser.role]} replace /> : <Login />} />

        <Route
          path="/"
          element={current ? <Navigate to={ROLE_HOME[current.appUser.role]} replace /> : <Navigate to="/login" replace />}
        />

        <Route
          path="/vendedor/nuevo"
          element={
            <RouteGuard current={current} route="nuevoPedido">
              <AppShell current={current!}>
                <NuevoPedido />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/vendedor/pegar"
          element={
            <RouteGuard current={current} route="pedidoIA">
              <AppShell current={current!}>
                <PegarPedido />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route path="/vendedor/mis" element={<Navigate to="/tablero" replace />} />
        <Route
          path="/vendedor/mis/:orderId"
          element={
            <RouteGuard current={current} route="detallePedido">
              <AppShell current={current!}>
                <DetallePedido />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route path="/despacho/cola" element={<Navigate to="/tablero" replace />} />
        <Route
          path="/despacho/cola/:orderId"
          element={
            <RouteGuard current={current} route="armado">
              <AppShell current={current!}>
                <DetalleArmado />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/produccion"
          element={
            <RouteGuard current={current} route="produccion">
              <AppShell current={current!}>
                <Produccion />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/admin/panel"
          element={
            <RouteGuard current={current} route="panel">
              <AppShell current={current!}>
                <Panel />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route path="/admin/facturacion" element={<Navigate to="/tablero" replace />} />
        <Route
          path="/tablero"
          element={
            <RouteGuard current={current} route="tablero">
              <AppShell current={current!}>
                <Tablero />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/clientes"
          element={
            <RouteGuard current={current} route="clientes">
              <AppShell current={current!}>
                <Clientes />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/clientes/:clientId"
          element={
            <RouteGuard current={current} route="fichaCliente">
              <AppShell current={current!}>
                <FichaCliente />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/admin/bsale"
          element={
            <RouteGuard current={current} route="bsaleConsola">
              <AppShell current={current!}>
                <BsaleConsola />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/admin/catalogo"
          element={
            <RouteGuard current={current} route="catalogo">
              <AppShell current={current!}>
                <Catalogo />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/ayuda"
          element={
            <RouteGuard current={current} route="ayuda">
              <AppShell current={current!}>
                <Ayuda />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/admin/usuarios"
          element={
            <RouteGuard current={current} route="usuarios">
              <AppShell current={current!}>
                <Usuarios />
              </AppShell>
            </RouteGuard>
          }
        />

        <Route
          path="/bsale"
          element={
            <RouteGuard current={current} route="bsaleExplorer">
              <AppShell current={current!}>
                <Explorador />
              </AppShell>
            </RouteGuard>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
