import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Login from './routes/Login';
import NuevoPedido from './routes/vendedor/NuevoPedido';
import DetallePedido from './routes/vendedor/DetallePedido';
import PegarPedido from './routes/vendedor/PegarPedido';
import DetalleArmado from './routes/despacho/DetalleArmado';
import Produccion from './routes/produccion/Produccion';
import Tablero from './routes/Tablero';
import Clientes from './routes/clientes/Clientes';
import FichaCliente from './routes/clientes/FichaCliente';
import BsaleConsola from './routes/admin/Bsale';
import Panel from './routes/admin/Panel';
import Catalogo from './routes/admin/Catalogo';
import Usuarios from './routes/admin/Usuarios';
import PWAInstallHint from './components/PWAInstallHint';
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
      <PWAInstallHint />
      <UpdateToast />
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
          path="/admin/usuarios"
          element={
            <RouteGuard current={current} route="usuarios">
              <AppShell current={current!}>
                <Usuarios />
              </AppShell>
            </RouteGuard>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
