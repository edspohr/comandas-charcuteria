import { Link, useLocation } from 'react-router-dom';
import { ROLE_LABEL, signOut, type CurrentUser } from '@/data/auth';
import type { Role } from '@/domain/types';

interface NavItem { to: string; label: string; roles: Role[]; }

const NAV: NavItem[] = [
  { to: '/vendedor/nuevo',    label: 'Nuevo pedido',   roles: ['vendedor', 'admin', 'superAdmin'] },
  { to: '/vendedor/mis',      label: 'Mis pedidos',    roles: ['vendedor', 'admin', 'superAdmin'] },
  { to: '/despacho/cola',     label: 'Cola de despacho', roles: ['despacho', 'admin', 'superAdmin'] },
  { to: '/produccion',        label: 'Producción',     roles: ['produccion', 'admin', 'superAdmin'] },
  { to: '/admin/facturacion', label: 'Facturación',    roles: ['admin', 'superAdmin'] },
  { to: '/admin/panel',       label: 'Panel',          roles: ['admin', 'superAdmin'] },
  { to: '/admin/catalogo',    label: 'Catálogo',       roles: ['admin', 'superAdmin'] },
  { to: '/admin/usuarios',    label: 'Usuarios',       roles: ['superAdmin'] },
];

export default function AppShell({ current, children }: { current: CurrentUser; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const items = NAV.filter((n) => n.roles.includes(current.appUser.role));

  return (
    <div className="min-h-screen bg-brand-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="font-semibold text-brand-700">Comandas</Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-700">
              {current.appUser.displayName}
              <span className="text-slate-400 ml-2">· {ROLE_LABEL[current.appUser.role]}</span>
            </span>
            <button
              onClick={signOut}
              className="text-sm text-slate-600 hover:text-slate-900 px-2 py-1 rounded"
            >
              Salir
            </button>
          </div>
        </div>
        {items.length > 1 && (
          <nav className="max-w-5xl mx-auto px-2 overflow-x-auto">
            <ul className="flex gap-1 py-1">
              {items.map((item) => {
                const active = pathname === item.to || pathname.startsWith(item.to + '/');
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className={
                        'px-3 py-1.5 rounded-full text-sm whitespace-nowrap ' +
                        (active
                          ? 'bg-brand-500 text-white'
                          : 'text-slate-600 hover:bg-slate-100')
                      }
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto p-4">{children}</main>
    </div>
  );
}
