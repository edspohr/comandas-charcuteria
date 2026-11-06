// Horario de entrega del pedido: lo que el cliente prefiere para recibir.
// Obligatorio que se registre ALGO (06-11, Edmundo): un rango desde–hasta,
// una sola hora o solo texto en la nota («en la mañana», «antes de las 10»).
// El cliente guarda el rango habitual y el pedido viene prellenado; despacho
// y reparto ordenan por hora (los que no tienen hora van al final).

export interface DeliveryWindow { from?: string; to?: string; note?: string }

// Lo único exigido: que haya una hora o una nota.
export const windowFilled = (w: Partial<DeliveryWindow> | null | undefined): boolean =>
  !!(w?.from?.trim() || w?.to?.trim() || w?.note?.trim());

// Solo la parte de horas: "09:00–13:00", "desde 09:00", "hasta 13:00" o ''.
export const windowTimes = (w?: Partial<DeliveryWindow> | null): string =>
  w?.from && w?.to ? `${w.from}–${w.to}` : w?.from ? `desde ${w.from}` : w?.to ? `hasta ${w.to}` : '';

const hhmm = (h: string, m?: string) => `${String(Math.min(23, Number(h))).padStart(2, '0')}:${String(Math.min(59, Number(m ?? 0))).padStart(2, '0')}`;

// "L-V 09:00-14:00", "9 a 13", "de 10.30 hasta 12" → { from, to }.
export function parseWindow(text?: string | null): DeliveryWindow | null {
  if (!text) return null;
  const m = text.match(/(\d{1,2})(?:[:.h](\d{2}))?\s*(?:hrs?\.?)?\s*(?:-|–|a|al|hasta)\s*(\d{1,2})(?:[:.h](\d{2}))?/i);
  if (!m) return null;
  const from = hhmm(m[1], m[2]); const to = hhmm(m[3], m[4]);
  return from < to ? { from, to } : null;
}

export const windowValid = (w: Partial<DeliveryWindow> | null | undefined): w is DeliveryWindow =>
  !!w?.from && !!w?.to && /^\d{2}:\d{2}$/.test(w.from) && /^\d{2}:\d{2}$/.test(w.to) && w.from < w.to;

export const formatWindow = (w?: Partial<DeliveryWindow> | null) =>
  [windowTimes(w), w?.note?.trim() ?? ''].filter(Boolean).join(' · ');

// Sort key: orders without a window go last.
export const windowKey = (w?: Partial<DeliveryWindow> | null) => w?.from ?? '99:99';
