import { Link, useLocation } from 'react-router-dom';
import { ROLE_LABEL, signOut, type CurrentUser } from '@/data/auth';
import Logo from '@/components/ui/Logo';
import type { Role } from '@/domain/types';

interface NavItem { to: string; label: string; roles: Role[]; }

const NAV: NavItem[] = [
  { to: '/vendedor/nuevo',    label: 'Nuevo pedido',     roles: ['vendedor', 'admin', 'superAdmin'] },
  { to: '/vendedor/mis',      label: 'Mis pedidos',      roles: ['vendedor', 'admin', 'superAdmin'] },
  { to: '/despacho/cola',     label: 'Cola de despacho', roles: ['despacho', 'admin', 'superAdmin'] },
  { to: '/produccion',        label: 'Producción',       roles: ['produccion', 'admin', 'superAdmin'] },
  { to: '/admin/facturacion', label: 'Facturación',      roles: ['admin', 'superAdmin'] },
  { to: '/admin/panel',       label: 'Panel',            roles: ['admin', 'superAdmin'] },
  { to: '/admin/catalogo',    label: 'Catálogo',         roles: ['admin', 'superAdmin'] },
  { to: '/admin/usuarios',    label: 'Usuarios',         roles: ['superAdmin'] },
];

export default function AppShell({ current, children }: { current: CurrentUser; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const items = NAV.filter((n) => n.roles.includes(current.appUser.role));

  return (
    <div className="min-h-screen bg-cream-50 flex flex-col">
      <header className="bg-charcoal-900 text-cream-50 sticky top-0 z-10 shadow-lift">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <Logo size={30} />
            <span className="font-semibold tracking-display uppercase text-sm">Comandas</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight hidden sm:block">
              <div className="text-sm font-medium">{current.appUser.displayName}</div>
              <div className="text-[10px] text-cream-100/70 uppercase tracking-display">{ROLE_LABEL[current.appUser.role]}</div>
            </div>
            <button
              onClick={signOut}
              className="text-[11px] uppercase tracking-display text-cream-100/80 hover:text-cream-50 border border-cream-100/20 hover:border-cream-100/50 rounded-md px-3 py-1.5 transition"
            >
              Salir
            </button>
          </div>
        </div>
        {items.length > 1 && (
          <nav className="border-t border-cream-100/10">
            <div className="max-w-5xl mx-auto px-2 overflow-x-auto">
              <ul className="flex gap-0 py-0">
                {items.map((item) => {
                  const active = pathname === item.to || pathname.startsWith(item.to + '/');
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        className={
                          'inline-block px-3.5 py-2.5 text-[11px] uppercase tracking-display whitespace-nowrap border-b-2 transition ' +
                          (active
                            ? 'text-brass-300 border-brass-500'
                            : 'text-cream-100/70 border-transparent hover:text-cream-50 hover:border-cream-100/30')
                        }
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>
        )}
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6">{children}</main>
      <footer className="text-center py-6 text-[10px] uppercase tracking-display text-charcoal-300">
        La Charcutería Artesanal · Barrio Franklin
      </footer>
    </div>
  );
}
