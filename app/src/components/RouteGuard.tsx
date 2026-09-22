import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '@/domain/types';
import type { CurrentUser } from '@/data/auth';
import { ROLE_HOME } from '@/data/auth';

export default function RouteGuard({
  current, allow, children,
}: {
  current: CurrentUser | null;
  allow: Role[];
  children: React.ReactNode;
}) {
  const location = useLocation();
  if (!current) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!allow.includes(current.appUser.role)) return <Navigate to={ROLE_HOME[current.appUser.role]} replace />;
  return <>{children}</>;
}
