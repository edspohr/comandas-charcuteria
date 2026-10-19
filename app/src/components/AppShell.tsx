import { useEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ROLE_LABEL, signOut, type CurrentUser } from '@/data/auth';
import Logo from '@/components/ui/Logo';
import type { Role } from '@/domain/types';
import { ROUTE_ACCESS, type RouteKey } from '@/domain/permissions';

// `demo`: pantallas de presentación (no son parte del producto definitivo):
// van primero y se ven distintas para que nadie las confunda con la operación.
interface NavItem { to: string; label: string; route: RouteKey; primaryFor?: Role[]; demo?: boolean; }

// `primaryFor` lists the roles where this item is that user's "own" work
// (the wizard for a vendedor, the queue for despacho, etc.). The shell
// puts those first in the nav so they're immediately reachable on mobile,
// with the shared admin/reporting items after. Visibility comes from
// ROUTE_ACCESS so the menu never offers a screen the guard would bounce.
const NAV: NavItem[] = [
  { to: '/tablero',        label: 'Tablero',      route: 'tablero',       primaryFor: ['despacho', 'reparto', 'admin', 'superAdmin'] },
  { to: '/vendedor/nuevo', label: 'Nuevo pedido', route: 'nuevoPedido',   primaryFor: ['vendedor', 'tienda'] },
  { to: '/vendedor/pegar', label: 'Pedido IA',    route: 'pedidoIA',      primaryFor: ['vendedor'] },
  { to: '/clientes',       label: 'Clientes',     route: 'clientes',      primaryFor: ['vendedor', 'admin', 'superAdmin'] },
  { to: '/produccion',     label: 'Producción',   route: 'produccion',    primaryFor: ['produccion'] },
  { to: '/bsale',          label: 'Bsale',        route: 'bsaleExplorer', primaryFor: ['consultor'] },
  { to: '/admin/mes',      label: 'Su mes',       route: 'mes',           demo: true },
  { to: '/admin/panel',    label: 'Panel',        route: 'panel',         primaryFor: ['admin', 'superAdmin', 'consultor'] },
  { to: '/admin/catalogo', label: 'Catálogo',     route: 'catalogo',      primaryFor: ['admin', 'superAdmin'] },
  { to: '/admin/usuarios', label: 'Usuarios',     route: 'usuarios',      primaryFor: ['superAdmin'] },
  { to: '/admin/bsale',    label: 'Conexión Bsale', route: 'bsaleConsola' },
];

export default function AppShell({ current, children }: { current: CurrentUser; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const role = current.appUser.role;

  const items = useMemo(() => {
    const visible = NAV.filter((n) => ROUTE_ACCESS[n.route](role));
    // Primary items (owned by this role) first, then the rest, preserving
    // NAV order within each group.
    const own = visible.filter((n) => !n.demo);
    return [
      ...visible.filter((n) => n.demo),
      ...own.filter((n) => n.primaryFor?.includes(role)),
      ...own.filter((n) => !n.primaryFor?.includes(role)),
    ];
  }, [role]);

  const activeRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [pathname]);

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
              <div className="text-[10px] text-cream-100/70 uppercase tracking-display">{ROLE_LABEL[role]}</div>
            </div>
            <button
              onClick={signOut}
              className="text-[11px] uppercase tracking-display text-cream-100/80 hover:text-cream-50 border border-cream-100/20 hover:border-cream-100/50 rounded-md px-3 py-1.5 transition"
            >
              Salir
            </button>
          </div>
        </div>
        {/*
          The nav shows even when only one item is visible (despacho and
          produccion) so those roles still get a consistent header + label,
          not just a lonely brand mark.
        */}
        {items.length > 0 && (
          <nav className="border-t border-cream-100/10">
            <div className="max-w-5xl mx-auto px-2 overflow-x-auto">
              <ul className="flex gap-0 py-0">
                {items.map((item) => {
                  const active = pathname === item.to || pathname.startsWith(item.to + '/');
                  if (item.demo) {
                    return (
                      <li key={item.to} className="flex items-center pr-2 mr-1 border-r border-cream-100/15">
                        <Link
                          to={item.to}
                          ref={active ? activeRef : undefined}
                          title="Pantalla de demostración: no es parte de la app de operación"
                          className={
                            'my-1.5 inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-[11px] uppercase tracking-display whitespace-nowrap transition ' +
                            (active ? 'border-brass-300 bg-brass-500/20 text-brass-300' : 'border-brass-500/70 text-brass-300/90 hover:bg-brass-500/10')
                          }
                        >
                          <span className="rounded-sm bg-brass-500 text-charcoal-900 px-1 text-[9px] font-semibold leading-4">Demo</span>
                          {item.label}
                        </Link>
                      </li>
                    );
                  }
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        ref={active ? activeRef : undefined}
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
