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
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Cargando…
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={current ? <Navigate to={ROLE_HOME[current.appUser.role]} replace /> : <Login />} />

        <Route
          path="/"
          element={current ? <Navigate to={ROLE_HOME[current.appUser.role]} replace /> : <Navigate to="/login" replace />}
        />

        <Route
          path="/vendedor/nuevo"
          element={
            <RouteGuard current={current} allow={['vendedor', 'admin', 'superAdmin']}>
              <AppShell current={current!}>
                <NuevoPedido />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/vendedor/pegar"
          element={
            <RouteGuard current={current} allow={['vendedor', 'admin', 'superAdmin']}>
              <AppShell current={current!}>
                <PegarPedido />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/vendedor/mis"
          element={
            <RouteGuard current={current} allow={['vendedor', 'admin', 'superAdmin']}>
              <AppShell current={current!}>
                <MisPedidos />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/vendedor/mis/:orderId"
          element={
            <RouteGuard current={current} allow={['vendedor', 'admin', 'superAdmin']}>
              <AppShell current={current!}>
                <DetallePedido />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/despacho/cola"
          element={
            <RouteGuard current={current} allow={['despacho', 'admin', 'superAdmin']}>
              <AppShell current={current!}>
                <ColaDespacho />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/despacho/cola/:orderId"
          element={
            <RouteGuard current={current} allow={['despacho', 'admin', 'superAdmin']}>
              <AppShell current={current!}>
                <DetalleArmado />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/produccion"
          element={
            <RouteGuard current={current} allow={['produccion', 'admin', 'superAdmin']}>
              <AppShell current={current!}>
                <Produccion />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/admin/panel"
          element={
            <RouteGuard current={current} allow={['admin', 'superAdmin']}>
              <AppShell current={current!}>
                <Panel />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/admin/facturacion"
          element={
            <RouteGuard current={current} allow={['admin', 'superAdmin']}>
              <AppShell current={current!}>
                <Facturacion />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/admin/catalogo"
          element={
            <RouteGuard current={current} allow={['admin', 'superAdmin']}>
              <AppShell current={current!}>
                <Catalogo />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/admin/usuarios"
          element={
            <RouteGuard current={current} allow={['superAdmin']}>
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
