import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Login from './routes/Login';
import Placeholder from './routes/Placeholder';
import NuevoPedido from './routes/vendedor/NuevoPedido';
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
          path="/vendedor/mis"
          element={
            <RouteGuard current={current} allow={['vendedor', 'admin', 'superAdmin']}>
              <AppShell current={current!}>
                <Placeholder title="Mis pedidos" hint="Llega en el hito 9." />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/despacho/cola"
          element={
            <RouteGuard current={current} allow={['despacho', 'admin', 'superAdmin']}>
              <AppShell current={current!}>
                <Placeholder title="Cola de despacho" hint="Llega en el hito 5." />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/produccion"
          element={
            <RouteGuard current={current} allow={['produccion', 'admin', 'superAdmin']}>
              <AppShell current={current!}>
                <Placeholder title="Producción" hint="Llega en el hito 6." />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/admin/panel"
          element={
            <RouteGuard current={current} allow={['admin', 'superAdmin']}>
              <AppShell current={current!}>
                <Placeholder title="Panel de dueños" hint="Llega en el hito 8." />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/admin/facturacion"
          element={
            <RouteGuard current={current} allow={['admin', 'superAdmin']}>
              <AppShell current={current!}>
                <Placeholder title="Facturación y despacho" hint="Llega en el hito 7." />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/admin/catalogo"
          element={
            <RouteGuard current={current} allow={['admin', 'superAdmin']}>
              <AppShell current={current!}>
                <Placeholder title="Catálogo y clientes" hint="Llega en el hito 11." />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/admin/usuarios"
          element={
            <RouteGuard current={current} allow={['superAdmin']}>
              <AppShell current={current!}>
                <Placeholder title="Usuarios" hint="Solo Super Administrador. Llega en el hito 11." />
              </AppShell>
            </RouteGuard>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
