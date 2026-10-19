import type { Role } from './types';

// Perfiles por funcionalidad. Cada usuario tiene exactamente un perfil y el
// perfil es un conjunto de capacidades: la UI (nav, rutas, botones del
// tablero) pregunta `can(role, cap)` en vez de comparar nombres de rol.
// firestore.rules replica esta misma matriz (ver helpers can*()) y el
// custom claim `role` del token es la fuente que usan ambas.

export type Capability =
  // Pedidos
  | 'order.create'          // pedido de venta a cliente (wizard + Pedido IA)
  | 'order.createTransfer'  // reposición de tienda (traslado fábrica → tienda)
  | 'order.cancelOwn'       // anular un pedido propio antes de facturar
  | 'order.cancelAny'
  | 'order.pack'            // tomar, ingresar pesos reales, marcar armado
  | 'order.link'            // vincular / emitir documento Bsale
  | 'order.dispatch'        // marcar salida (despachado)
  | 'order.deliver'         // marcar entregado con nota
  | 'transfer.receive'      // tienda confirma recepción del traslado
  // Clientes
  | 'client.quickCreate'
  | 'client.edit'           // datos de facturación (van a Bsale) + cartera
  // Stock / Bsale
  | 'stock.sync'            // pedir una sincronización con Bsale
  | 'production.receive'    // registrar producción terminada → recepción Bsale
  | 'catalog.map'           // cruzar variantes Bsale ↔ catálogo de la app
  | 'bsale.explore'         // ventana de solo lectura a los datos de Bsale
  | 'bsale.configure'       // sucursales, lista de precios, escrituras on/off
  // Gestión
  | 'panel.view'
  | 'users.manage'
  | 'settings.edit';

export const ROLES: Role[] = [
  'vendedor', 'tienda', 'despacho', 'reparto', 'produccion', 'admin', 'superAdmin', 'consultor',
];

const ROLE_CAPS: Record<Role, Capability[]> = {
  vendedor: ['order.create', 'order.cancelOwn', 'client.quickCreate'],
  tienda: ['order.createTransfer', 'order.cancelOwn', 'transfer.receive'],
  despacho: ['order.pack', 'order.dispatch', 'stock.sync'],
  reparto: ['order.dispatch', 'order.deliver'],
  produccion: ['production.receive', 'stock.sync'],
  admin: [
    'order.create', 'order.createTransfer', 'order.cancelOwn', 'order.cancelAny', 'order.pack', 'order.link',
    'order.dispatch', 'order.deliver', 'transfer.receive', 'client.quickCreate', 'client.edit', 'stock.sync',
    'production.receive', 'catalog.map', 'bsale.explore', 'panel.view',
  ],
  superAdmin: [
    'order.create', 'order.createTransfer', 'order.cancelOwn', 'order.cancelAny', 'order.pack', 'order.link',
    'order.dispatch', 'order.deliver', 'transfer.receive', 'client.quickCreate', 'client.edit', 'stock.sync',
    'production.receive', 'catalog.map', 'bsale.explore', 'bsale.configure', 'panel.view', 'users.manage',
    'settings.edit',
  ],
  // Auditor: ve todo, no escribe nada.
  consultor: ['bsale.explore', 'panel.view'],
};

export function can(role: Role | undefined | null, cap: Capability): boolean {
  return !!role && ROLE_CAPS[role]?.includes(cap) === true;
}

export function canAny(role: Role | undefined | null, caps: Capability[]): boolean {
  return caps.some((c) => can(role, c));
}

// Solo lectura total: el consultor entra a todas las pantallas pero sin
// acciones. Las pantallas lo usan para esconder botones.
export function isReadOnly(role: Role | undefined | null): boolean {
  return role === 'consultor';
}

export const ROLE_LABEL: Record<Role, string> = {
  vendedor: 'Vendedor',
  tienda: 'Tienda',
  despacho: 'Despacho',
  reparto: 'Reparto',
  produccion: 'Producción',
  admin: 'Administración',
  superAdmin: 'Super Administrador',
  consultor: 'Consultor',
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  vendedor: 'Toma pedidos de sus clientes, ve stock y el estado de sus pedidos.',
  tienda: 'Pide reposición para la tienda y confirma lo que llega.',
  despacho: 'Arma los pedidos con pesos reales y los deja listos para salir.',
  reparto: 'Marca la salida y la entrega de los pedidos en ruta.',
  produccion: 'Ve la demanda pendiente y registra la producción terminada en Bsale.',
  admin: 'Opera todo el flujo: facturación, despacho, clientes, catálogo y panel.',
  superAdmin: 'Todo lo de administración más usuarios y configuración.',
  consultor: 'Auditoría: ve todos los datos (app y Bsale) sin poder modificar nada.',
};

// Quién entra a cada pantalla. Lo usan App.tsx (RouteGuard) y AppShell (nav),
// así ruta y menú nunca se contradicen. El consultor entra a todo lo que sea
// lectura; las pantallas esconden sus acciones con `can()`.
export type RouteKey =
  | 'tablero' | 'nuevoPedido' | 'pedidoIA' | 'detallePedido' | 'armado' | 'clientes' | 'fichaCliente' | 'produccion'
  | 'panel' | 'catalogo' | 'usuarios' | 'bsaleConsola' | 'bsaleExplorer';

const everyone = () => true;
export const ROUTE_ACCESS: Record<RouteKey, (role: Role) => boolean> = {
  tablero: everyone,
  nuevoPedido: (r) => canAny(r, ['order.create', 'order.createTransfer']),
  pedidoIA: (r) => can(r, 'order.create'),
  detallePedido: everyone,
  armado: (r) => can(r, 'order.pack'),
  clientes: (r) => r !== 'tienda' && r !== 'reparto',
  fichaCliente: everyone,
  produccion: (r) => canAny(r, ['production.receive', 'panel.view']),
  panel: (r) => can(r, 'panel.view'),
  catalogo: (r) => canAny(r, ['catalog.map', 'bsale.explore']),
  usuarios: (r) => can(r, 'users.manage') || isReadOnly(r),
  bsaleConsola: (r) => can(r, 'bsale.configure'),
  bsaleExplorer: (r) => can(r, 'bsale.explore'),
};

export const ROLE_HOME: Record<Role, string> = {
  vendedor: '/tablero',
  tienda: '/tablero',
  despacho: '/tablero',
  reparto: '/tablero',
  produccion: '/produccion',
  admin: '/tablero',
  superAdmin: '/tablero',
  consultor: '/bsale',
};
