// Horario de entrega del pedido: rango desde–hasta obligatorio (lo que el
// cliente prefiere para recibir) más una nota. El cliente guarda el suyo
// habitual y el pedido viene prellenado; despacho y reparto ordenan por hora.

export interface DeliveryWindow { from: string; to: string; note?: string }

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
  w?.from && w?.to ? `${w.from}–${w.to}${w.note ? ` · ${w.note}` : ''}` : '';

// Sort key: orders without a window go last.
export const windowKey = (w?: Partial<DeliveryWindow> | null) => w?.from ?? '99:99';
