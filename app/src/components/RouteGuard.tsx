import { Navigate, useLocation } from 'react-router-dom';
import type { CurrentUser } from '@/data/auth';
import { ROLE_HOME, ROUTE_ACCESS, type RouteKey } from '@/domain/permissions';

export default function RouteGuard({
  current, route, children,
}: {
  current: CurrentUser | null;
  route: RouteKey;
  children: React.ReactNode;
}) {
  const location = useLocation();
  if (!current) return <Navigate to="/login" replace state={{ from: location }} />;
  const role = current.appUser.role;
  if (!ROUTE_ACCESS[route](role)) return <Navigate to={ROLE_HOME[role]} replace />;
  return <>{children}</>;
}
