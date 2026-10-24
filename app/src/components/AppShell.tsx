import { useEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ROLE_LABEL, signOut, type CurrentUser } from '@/data/auth';
import Logo from '@/components/ui/Logo';
import type { Role } from '@/domain/types';
import { ROUTE_ACCESS, can, canAny, type RouteKey } from '@/domain/permissions';
import IntegrationHealth from '@/components/IntegrationHealth';
import PinPrompt from '@/components/PinPrompt';
import AppLock from '@/components/AppLock';

// Navegación en dos formas:
//   - Escritorio (lg+): sidebar fijo con grupos. El superadmin tiene 11
//     pantallas; en una barra horizontal no caben.
//   - Teléfono: header + pestañas desplazables (vendedores y despacho trabajan
//     desde el celular y tienen pocos ítems).
// `demo`: pantallas de presentación, no del producto: van primero y con marca.

type Group = 'demo' | 'operacion' | 'gestion' | 'config';
interface NavItem { to: string; label: string; route: RouteKey; group: Group; primaryFor?: Role[]; demo?: boolean }

const GROUP_LABEL: Record<Group, string> = { demo: 'Demo', operacion: 'Operación', gestion: 'Gestión', config: 'Configuración' };
const GROUP_ORDER: Group[] = ['demo', 'operacion', 'gestion', 'config'];

// `primaryFor` lists the roles where this item is that user's "own" work; on
// mobile those go first so they're reachable without scrolling the tabs.
// Visibility comes from ROUTE_ACCESS so the menu never offers a screen the
// guard would bounce.
const NAV: NavItem[] = [
  { to: '/tablero',        label: 'Tablero',        route: 'tablero',       group: 'operacion', primaryFor: ['despacho', 'reparto', 'admin', 'superAdmin'] },
  { to: '/vendedor/nuevo', label: 'Nuevo pedido',   route: 'nuevoPedido',   group: 'operacion', primaryFor: ['vendedor', 'tienda'] },
  { to: '/vendedor/pegar', label: 'Pedido IA',      route: 'pedidoIA',      group: 'operacion', primaryFor: ['vendedor'] },
  { to: '/clientes',       label: 'Clientes',       route: 'clientes',      group: 'operacion', primaryFor: ['vendedor', 'admin', 'superAdmin'] },
  { to: '/produccion',     label: 'Producción',     route: 'produccion',    group: 'operacion', primaryFor: ['produccion'] },
  { to: '/admin/panel',    label: 'Panel',          route: 'panel',         group: 'gestion', primaryFor: ['admin', 'superAdmin', 'consultor'] },
  { to: '/admin/catalogo', label: 'Catálogo',       route: 'catalogo',      group: 'gestion', primaryFor: ['admin', 'superAdmin'] },
  { to: '/bsale',          label: 'Ventana a Bsale', route: 'bsaleExplorer', group: 'gestion', primaryFor: ['consultor'] },
  { to: '/admin/usuarios', label: 'Usuarios',       route: 'usuarios',      group: 'config', primaryFor: ['superAdmin'] },
  { to: '/admin/bsale',    label: 'Conexión Bsale', route: 'bsaleConsola',  group: 'config' },
];

const isActive = (pathname: string, to: string) => pathname === to || pathname.startsWith(to + '/');

export default function AppShell({ current, children }: { current: CurrentUser; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const role = current.appUser.role;

  const visible = useMemo(() => NAV.filter((n) => ROUTE_ACCESS[n.route](role)), [role]);
  const mobileItems = useMemo(() => {
    const own = visible.filter((n) => !n.demo);
    return [
      ...visible.filter((n) => n.demo),
      ...own.filter((n) => n.primaryFor?.includes(role)),
      ...own.filter((n) => !n.primaryFor?.includes(role)),
    ];
  }, [visible, role]);
  const groups = useMemo(() => GROUP_ORDER.map((g) => [g, visible.filter((n) => n.group === g)] as const).filter(([, items]) => items.length > 0), [visible]);

  const activeRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [pathname]);

  return (
    <div className="min-h-screen bg-cream-50 lg:flex">
      {/* ---------- Sidebar (escritorio) ---------- */}
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 bg-charcoal-900 text-cream-50 h-screen sticky top-0">
        <Link to="/" className="flex items-center gap-2.5 px-5 h-16 border-b border-cream-100/10">
          <Logo size={28} />
          <span className="font-semibold tracking-display uppercase text-sm">Comandas</span>
        </Link>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Principal">
          {groups.map(([g, items]) => (
            <div key={g}>
              {g !== 'demo' && <p className="px-2 mb-1.5 text-[10px] uppercase tracking-display text-cream-100/40 font-semibold">{GROUP_LABEL[g]}</p>}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = isActive(pathname, item.to);
                  if (item.demo) {
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          title="Pantalla de demostración: no es parte de la app de operación"
                          className={'flex items-center gap-2 rounded-md border border-dashed px-2.5 py-2 text-sm transition ' + (active ? 'border-brass-300 bg-brass-500/20 text-brass-300' : 'border-brass-500/70 text-brass-300/90 hover:bg-brass-500/10')}
                        >
                          <span className="rounded-sm bg-brass-500 text-charcoal-900 px-1 text-[9px] font-semibold leading-4 uppercase tracking-display">Demo</span>
                          {item.label}
                        </Link>
                      </li>
                    );
                  }
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        aria-current={active ? 'page' : undefined}
                        className={'relative flex items-center rounded-md px-2.5 py-2 text-sm transition ' + (active ? 'bg-cream-50/10 text-cream-50 font-medium' : 'text-cream-100/70 hover:bg-cream-50/5 hover:text-cream-50')}
                      >
                        {active && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-brass-500" />}
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-cream-100/10 px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-medium truncate">{current.appUser.displayName}</p>
            <p className="text-[10px] text-cream-100/60 uppercase tracking-display truncate">{ROLE_LABEL[role]}</p>
          </div>
          <button onClick={signOut} className="shrink-0 text-[11px] uppercase tracking-display text-cream-100/80 hover:text-cream-50 border border-cream-100/20 hover:border-cream-100/50 rounded-md px-2.5 py-1.5 transition">
            Salir
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* ---------- Header + pestañas (teléfono / tablet) ---------- */}
        <header className="lg:hidden bg-charcoal-900 text-cream-50 sticky top-0 z-10 shadow-lift">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2.5">
              <Logo size={30} />
              <span className="font-semibold tracking-display uppercase text-sm">Comandas</span>
            </Link>
            <div className="flex items-center gap-3">
              <div className="text-right leading-tight hidden sm:block">
                <div className="text-sm font-medium">{current.appUser.displayName}</div>
                <div className="text-[10px] text-cream-100/70 uppercase tracking-display">{ROLE_LABEL[role]}</div>
              </div>
              <button onClick={signOut} className="text-[11px] uppercase tracking-display text-cream-100/80 hover:text-cream-50 border border-cream-100/20 hover:border-cream-100/50 rounded-md px-3 py-1.5 transition">
                Salir
              </button>
            </div>
          </div>
          {mobileItems.length > 0 && (
            <nav className="border-t border-cream-100/10" aria-label="Principal">
              <div className="max-w-5xl mx-auto px-2 overflow-x-auto">
                <ul className="flex gap-0 py-0">
                  {mobileItems.map((item) => {
                    const active = isActive(pathname, item.to);
                    if (item.demo) {
                      return (
                        <li key={item.to} className="flex items-center pr-2 mr-1 border-r border-cream-100/15">
                          <Link
                            to={item.to}
                            ref={active ? activeRef : undefined}
                            title="Pantalla de demostración: no es parte de la app de operación"
                            className={'my-1.5 inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-[11px] uppercase tracking-display whitespace-nowrap transition ' + (active ? 'border-brass-300 bg-brass-500/20 text-brass-300' : 'border-brass-500/70 text-brass-300/90 hover:bg-brass-500/10')}
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
                          className={'inline-block px-3.5 py-2.5 text-[11px] uppercase tracking-display whitespace-nowrap border-b-2 transition ' + (active ? 'text-brass-300 border-brass-500' : 'text-cream-100/70 border-transparent hover:text-cream-50 hover:border-cream-100/30')}
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

        {/* Con sidebar el contenido aprovecha el ancho (tablas, kanban). */}
        <main className="flex-1 w-full mx-auto p-4 sm:p-6 max-w-5xl lg:max-w-7xl">
          {canAny(role, ['stock.sync', 'order.link', 'bsale.configure']) && <IntegrationHealth canFix={can(role, 'bsale.configure')} />}
          {children}
        </main>
        <PinPrompt />
        <AppLock />
        <footer className="text-center py-6 text-[10px] uppercase tracking-display text-charcoal-300">
          La Charcutería Artesanal · Barrio Franklin
        </footer>
      </div>
    </div>
  );
}
