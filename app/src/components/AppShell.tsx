import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ROLE_LABEL, lockNow, signOut, type CurrentUser } from '@/data/auth';
import Logo from '@/components/ui/Logo';
import { ROUTE_ACCESS, can, canAny, type RouteKey } from '@/domain/permissions';
import IntegrationHealth from '@/components/IntegrationHealth';
import PinPrompt from '@/components/PinPrompt';
import InstallButton from '@/components/InstallButton';
import AppLock from '@/components/AppLock';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useScrollLock } from '@/lib/scrollLock';

// Navegación con grupos y orden fijos (cada perfil ve solo lo suyo):
//   Pedidos · Clientes · Producción · Gestión · Administración · Mi cuenta
// Escritorio: barra lateral con «＋ Nuevo pedido» destacado y el menú de la
// cuenta abajo. Teléfono: barra inferior al pulgar (hasta 4 accesos con «＋»
// al centro) y «Más» con el resto, agrupado. Pedido IA vive en Nuevo pedido.

type Group = 'pedidos' | 'clientes' | 'produccion' | 'gestion' | 'admin';
interface NavItem { to: string; label: string; short?: string; route: RouteKey; group: Group; icon: IconName }

const GROUP_LABEL: Record<Group, string> = { pedidos: 'Pedidos', clientes: 'Clientes', produccion: 'Producción', gestion: 'Gestión', admin: 'Administración' };
const GROUP_ORDER: Group[] = ['pedidos', 'clientes', 'produccion', 'gestion', 'admin'];

const NAV: NavItem[] = [
  { to: '/tablero', label: 'Tablero de pedidos', short: 'Pedidos', route: 'tablero', group: 'pedidos', icon: 'board' },
  { to: '/clientes', label: 'Clientes', route: 'clientes', group: 'clientes', icon: 'users' },
  { to: '/produccion', label: 'Producción', route: 'produccion', group: 'produccion', icon: 'factory' },
  { to: '/admin/panel', label: 'Panel de gestión', short: 'Panel', route: 'panel', group: 'gestion', icon: 'chart' },
  { to: '/bsale', label: 'Ventana a Bsale', short: 'Bsale', route: 'bsaleExplorer', group: 'gestion', icon: 'window' },
  { to: '/admin/catalogo', label: 'Catálogo y stock', short: 'Catálogo', route: 'catalogo', group: 'gestion', icon: 'box' },
  { to: '/admin/usuarios', label: 'Usuarios', route: 'usuarios', group: 'admin', icon: 'key' },
  { to: '/admin/bsale', label: 'Conexión Bsale', route: 'bsaleConsola', group: 'admin', icon: 'plug' },
];
const NEW_ORDER = '/vendedor/nuevo';

// Phone bottom bar: the first of these the role can see.
const BOTTOM_PRIORITY = ['/tablero', '/admin/panel', '/clientes', '/produccion', '/bsale', '/admin/catalogo'];

const isActive = (pathname: string, to: string) => pathname === to || pathname.startsWith(to + '/');
const isNewOrder = (pathname: string) => pathname.startsWith('/vendedor/nuevo') || pathname.startsWith('/vendedor/pegar');

export default function AppShell({ current, children }: { current: CurrentUser; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const role = current.appUser.role;
  const [more, setMore] = useState(false);
  useScrollLock(more);
  const [account, setAccount] = useState(false);
  useEffect(() => { setMore(false); setAccount(false); }, [pathname]);

  const visible = useMemo(() => NAV.filter((n) => ROUTE_ACCESS[n.route](role)), [role]);
  const canCreate = ROUTE_ACCESS.nuevoPedido(role);
  const groups = useMemo(() => GROUP_ORDER.map((g) => [g, visible.filter((n) => n.group === g)] as const).filter(([, items]) => items.length > 0), [visible]);
  const bottom = useMemo(() => BOTTOM_PRIORITY.map((to) => visible.find((n) => n.to === to)).filter((n): n is NavItem => !!n).slice(0, canCreate ? 3 : 4), [visible, canCreate]);
  const inMore = visible.filter((n) => !bottom.includes(n));
  const moreActive = inMore.some((n) => isActive(pathname, n.to));
  const name = current.appUser.displayName;

  return (
    <div className="min-h-screen bg-cream-50 lg:flex">
      {/* ---------- Barra lateral (escritorio) ---------- */}
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 bg-charcoal-900 text-cream-50 h-screen sticky top-0">
        <Link to="/" className="flex items-center gap-2.5 px-5 h-16 border-b border-cream-100/10">
          <Logo size={28} />
          <span className="font-semibold tracking-display uppercase text-sm">Comandas</span>
        </Link>
        {canCreate && (
          <div className="px-3 pt-4">
            <Link to={NEW_ORDER} className={'flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold transition ' + (isNewOrder(pathname) ? 'bg-brass-300 text-charcoal-900' : 'bg-brass-500 text-charcoal-900 hover:bg-brass-300')}>
              <Icon name="plus" size={16} /> Nuevo pedido
            </Link>
          </div>
        )}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4" aria-label="Principal">
          {groups.map(([g, items]) => (
            <div key={g}>
              <p className="px-2 mb-1 text-[10px] uppercase tracking-display text-cream-100/40 font-semibold">{GROUP_LABEL[g]}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = isActive(pathname, item.to);
                  return (
                    <li key={item.to}>
                      <Link to={item.to} aria-current={active ? 'page' : undefined}
                        className={'relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition ' + (active ? 'bg-cream-50/10 text-cream-50 font-medium' : 'text-cream-100/70 hover:bg-cream-50/5 hover:text-cream-50')}>
                        {active && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-brass-500" />}
                        <Icon name={item.icon} size={16} className={active ? 'text-brass-300' : 'text-cream-100/50'} />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="relative border-t border-cream-100/10 px-3 py-3">
          <button onClick={() => setAccount((v) => !v)} className="w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-cream-50/5" aria-expanded={account}>
            <Avatar name={name} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-sm font-medium truncate">{name}</span>
              <span className="block text-[10px] text-cream-100/60 uppercase tracking-display truncate">{ROLE_LABEL[role]}</span>
            </span>
            <Icon name="chevron" size={14} className={'text-cream-100/50 transition ' + (account ? 'rotate-180' : '')} />
          </button>
          {account && <AccountMenu className="absolute bottom-full left-3 right-3 mb-2" />}
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* ---------- Encabezado (teléfono / tablet) ---------- */}
        <header className="lg:hidden bg-charcoal-900 text-cream-50 sticky top-0 z-20 shadow-lift">
          <div className="px-4 h-14 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2.5">
              <Logo size={28} />
              <span className="font-semibold tracking-display uppercase text-sm">Comandas</span>
            </Link>
            <div className="relative">
              <button onClick={() => setAccount((v) => !v)} className="flex items-center gap-2 rounded-md pl-1 pr-2 py-1 hover:bg-cream-50/5" aria-expanded={account} aria-label="Mi cuenta">
                <Avatar name={name} />
                <span className="hidden sm:block text-sm">{name.split(' ')[0]}</span>
                <Icon name="chevron" size={14} className="text-cream-100/60" />
              </button>
              {account && <AccountMenu className="absolute right-0 top-full mt-2 w-64" name={name} roleLabel={ROLE_LABEL[role]} />}
            </div>
          </div>
        </header>

        <main className="flex-1 w-full mx-auto px-4 pt-4 pb-28 sm:px-6 sm:pt-6 lg:pb-6 max-w-5xl lg:max-w-7xl">
          {canAny(role, ['stock.sync', 'order.link', 'bsale.configure']) && <IntegrationHealth canFix={can(role, 'bsale.configure')} />}
          {children}
        </main>
        <footer className="hidden lg:block text-center py-6 text-[10px] uppercase tracking-display text-charcoal-300">
          La Charcutería Artesanal · Barrio Franklin
        </footer>

        {/* ---------- Barra inferior (teléfono) ---------- */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-charcoal-900 text-cream-50 border-t border-cream-100/10 pb-[env(safe-area-inset-bottom)]" aria-label="Principal">
          <ul className="flex items-stretch justify-around h-16">
            {bottom.slice(0, 1).map((n) => <BottomItem key={n.to} item={n} active={isActive(pathname, n.to)} />)}
            {canCreate && (
              <li className="flex-1 flex items-center justify-center">
                <Link to={NEW_ORDER} aria-label="Nuevo pedido" className={'-mt-6 w-14 h-14 rounded-full flex items-center justify-center shadow-lift ring-4 ring-cream-50 transition ' + (isNewOrder(pathname) ? 'bg-brass-300 text-charcoal-900' : 'bg-brass-500 text-charcoal-900')}>
                  <Icon name="plus" size={26} />
                </Link>
              </li>
            )}
            {bottom.slice(1).map((n) => <BottomItem key={n.to} item={n} active={isActive(pathname, n.to)} />)}
            <li className="flex-1">
              <button onClick={() => setMore(true)} className={'w-full h-full flex flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-display ' + (moreActive ? 'text-brass-300' : 'text-cream-100/70')}>
                <Icon name="more" size={20} /> Más
              </button>
            </li>
          </ul>
        </nav>

        {more && (
          <div className="lg:hidden fixed inset-0 z-30 bg-charcoal-900/50 overscroll-contain" onClick={() => setMore(false)}>
            <div className="absolute bottom-0 inset-x-0 bg-cream-50 rounded-t-2xl shadow-lift p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-h-[80dvh] overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-charcoal-200" />
              {GROUP_ORDER.map((g) => {
                const items = inMore.filter((n) => n.group === g);
                if (!items.length) return null;
                return (
                  <div key={g} className="mb-3">
                    <p className="eyebrow mb-1.5 px-1">{GROUP_LABEL[g]}</p>
                    <ul className="card divide-y divide-charcoal-100">
                      {items.map((n) => (
                        <li key={n.to}>
                          <Link to={n.to} className={'flex items-center gap-3 px-3 py-3 text-sm ' + (isActive(pathname, n.to) ? 'text-charcoal-900 font-semibold' : 'text-charcoal-700')}>
                            <Icon name={n.icon} size={18} className="text-brass-600" /> {n.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              <p className="eyebrow mb-1.5 px-1">Mi cuenta · {name}</p>
              <AccountMenu className="" light />
            </div>
          </div>
        )}

        <PinPrompt />
        <AppLock />
      </div>
    </div>
  );
}

function BottomItem({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <li className="flex-1">
      <Link to={item.to} aria-current={active ? 'page' : undefined} className={'h-full flex flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-display ' + (active ? 'text-brass-300' : 'text-cream-100/70')}>
        <Icon name={item.icon} size={20} /> {item.short ?? item.label}
      </Link>
    </li>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '·';
  return <span aria-hidden className="w-8 h-8 shrink-0 rounded-full bg-brass-500 text-charcoal-900 text-xs font-semibold flex items-center justify-center">{initials}</span>;
}

// Mi cuenta: instalar, bloquear ahora y cerrar sesión.
function AccountMenu({ className, light = false, name, roleLabel }: { className: string; light?: boolean; name?: string; roleLabel?: string }) {
  const item = 'w-full flex items-center gap-3 px-3 py-3 text-sm text-left hover:bg-cream-100';
  return (
    <div className={(light ? 'card ' : 'rounded-lg bg-cream-50 text-charcoal-800 shadow-lift z-30 ') + 'divide-y divide-charcoal-100 overflow-hidden ' + className}>
      {name && (
        <div className="px-3 py-2.5">
          <p className="text-sm font-semibold text-charcoal-900">{name}</p>
          <p className="text-[10px] uppercase tracking-display text-charcoal-400">{roleLabel}</p>
        </div>
      )}
      <Link to="/ayuda" className={item + ' text-charcoal-800'}><Icon name="help" size={18} className="text-brass-600" /> Guía de uso</Link>
      <InstallButton variant="menu" className={item + ' text-charcoal-800'} />
      <button className={item + ' text-charcoal-800'} onClick={() => lockNow()}><Icon name="lock" size={18} className="text-brass-600" /> Bloquear ahora</button>
      <button className={item + ' text-red-700'} onClick={() => void signOut()}><Icon name="logout" size={18} /> Cerrar sesión</button>
    </div>
  );
}
