// Oportunidades comerciales: a quién visitar, qué ofrecerle y en qué quedó.
// La crea super administración (asignada a un ejecutivo), el propio ejecutivo,
// la carga desde el informe de oportunidades o, más adelante, un canal de
// adquisición. El ejecutivo la gestiona: visitas, llamadas, muestras y
// pedidos quedan en su historial. Se gana sola cuando un pedido ligado se
// factura (functions/src/opportunities.ts); se posterga con fecha para
// retomarla o se pierde con un motivo de la lista.

export type OpportunityStatus = 'abierta' | 'en_gestion' | 'postergada' | 'ganada' | 'perdida';
export type OpportunityOrigin = 'asignada' | 'propia' | 'informe' | 'canal';
export type NextActionType = 'visita' | 'llamada' | 'muestra' | 'otro';
export type ActivityType = 'visita' | 'llamada' | 'muestra' | 'pedido' | 'nota' | 'estado';
export type LostReason = 'precio' | 'tiene_proveedor' | 'producto' | 'sin_respuesta' | 'no_aplica' | 'otro';

export interface OpportunityActivity {
  type: ActivityType;
  at: number;
  by: string;          // uid, o 'sistema'
  note?: string;
  orderId?: string;
}

export interface Opportunity {
  id: string;
  clientId: string;
  clientSnapshot: { name: string; fantasyName?: string; rut?: string };
  title: string;
  origin: OpportunityOrigin;
  // Sin ejecutivo = bandeja «Sin asignar» de super administración.
  ownerUid: string | null;
  createdBy: string;
  productsOfInterest: string[];
  notes?: string;
  status: OpportunityStatus;
  nextAction?: { type: NextActionType; date: string; note?: string };
  postponedUntil?: string;
  lostReason?: LostReason;
  lostNote?: string;
  orderIds: string[];
  wonOrderId?: string;
  wonAt?: number;
  closedAt?: number;
  candidateId?: string;
  activity: OpportunityActivity[];
  createdAt: number;
  updatedAt: number;
}

// Fila del informe de oportunidades (tools/oportunidades) que super
// administración puede cargar como oportunidad.
export interface OpportunityCandidate {
  id: string;
  rank: number;
  score: number;
  rut: string;
  razonSocial: string;
  fantasyName: string;
  comuna?: string;
  ventas12mCLP?: number;
  productosSugeridos: string[];
  propuesta?: string;
  vendedorActual?: string;
  clientId?: string;
  status: 'pendiente' | 'cargada' | 'descartada';
  opportunityId?: string;
  loadedBy?: string;
  loadedAt?: number;
}

export const STATUS_LABEL: Record<OpportunityStatus, string> = {
  abierta: 'Abierta', en_gestion: 'En gestión', postergada: 'Postergada', ganada: 'Ganada', perdida: 'Perdida',
};
export const ORIGIN_LABEL: Record<OpportunityOrigin, string> = {
  asignada: 'Asignada', propia: 'Propia', informe: 'Informe', canal: 'Canal',
};
export const NEXT_ACTION_LABEL: Record<NextActionType, string> = {
  visita: 'Visita', llamada: 'Llamada', muestra: 'Muestra', otro: 'Otro',
};
export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  visita: 'Visita', llamada: 'Llamada', muestra: 'Muestra', pedido: 'Pedido', nota: 'Nota', estado: 'Estado',
};
export const LOST_REASONS: Array<[LostReason, string]> = [
  ['precio', 'Precio'],
  ['tiene_proveedor', 'Ya tiene proveedor'],
  ['producto', 'No le convenció el producto'],
  ['sin_respuesta', 'Sin respuesta'],
  ['no_aplica', 'No aplica a su negocio'],
  ['otro', 'Otro'],
];
export const LOST_REASON_LABEL = Object.fromEntries(LOST_REASONS) as Record<LostReason, string>;

export const isOpen = (o: Pick<Opportunity, 'status'>) => o.status === 'abierta' || o.status === 'en_gestion' || o.status === 'postergada';

// Fecha en que la oportunidad vuelve a la agenda: la próxima acción, o la
// fecha para retomarla si está postergada.
export function dueDate(o: Opportunity): string | undefined {
  if (!isOpen(o)) return undefined;
  return o.status === 'postergada' ? o.postponedUntil : o.nextAction?.date;
}

// Agenda: abiertas con fecha hasta hoy (vencidas incluidas), más antiguas primero.
export function agendaFor(list: Opportunity[], today: string): Opportunity[] {
  return list.filter((o) => { const d = dueDate(o); return !!d && d <= today; })
    .sort((a, b) => (dueDate(a) ?? '').localeCompare(dueDate(b) ?? ''));
}

export const isOverdue = (o: Opportunity, today: string) => { const d = dueDate(o); return !!d && d < today; };

// Avisos para el ejecutivo (globo en el menú y recordatorio al entrar):
// nuevas = asignadas y todavía sin gestión; vencidas, hoy y mañana por fecha.
// El globo cuenta lo que pide acción ya (nuevas, vencidas y de hoy, sin
// repetir); mañana solo se recuerda.
export interface OpportunityAlerts { nuevas: number; vencidas: number; hoy: number; manana: number; badge: number }
export function opportunityAlerts(list: Opportunity[], today: string, tomorrow: string): OpportunityAlerts {
  const r: OpportunityAlerts = { nuevas: 0, vencidas: 0, hoy: 0, manana: 0, badge: 0 };
  for (const o of list) {
    if (!isOpen(o)) continue;
    const d = dueDate(o);
    const nueva = o.status === 'abierta';
    const late = !!d && d < today;
    const isToday = d === today;
    if (nueva) r.nuevas++;
    if (late) r.vencidas++;
    if (isToday) r.hoy++;
    if (d === tomorrow) r.manana++;
    if (nueva || late || isToday) r.badge++;
  }
  return r;
}

export interface TeamRow { uid: string; open: number; overdue: number; postponed: number; won: number; lost: number; samples: number; conversion: number | null }

// Resumen por ejecutivo. Ganadas y perdidas: cerradas desde `sinceMs`.
export function teamSummary(list: Opportunity[], today: string, sinceMs: number): TeamRow[] {
  const rows = new Map<string, TeamRow>();
  for (const o of list) {
    const uid = o.ownerUid ?? '';
    const r = rows.get(uid) ?? { uid, open: 0, overdue: 0, postponed: 0, won: 0, lost: 0, samples: 0, conversion: null };
    if (isOpen(o)) { r.open++; if (isOverdue(o, today)) r.overdue++; if (o.status === 'postergada') r.postponed++; }
    const closedRecently = (o.closedAt ?? 0) >= sinceMs;
    if (o.status === 'ganada' && closedRecently) r.won++;
    if (o.status === 'perdida' && closedRecently) r.lost++;
    r.samples += o.activity.filter((a) => a.type === 'muestra' && a.at >= sinceMs).length;
    rows.set(uid, r);
  }
  for (const r of rows.values()) r.conversion = r.won + r.lost > 0 ? r.won / (r.won + r.lost) : null;
  return [...rows.values()].sort((a, b) => b.open - a.open);
}
