import { format as fmt, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

export function formatQty(qty: number, unit: 'g' | 'kg' | 'unidad'): string {
  if (unit === 'unidad') return `${qty} u`;
  if (unit === 'kg') return `${qty.toLocaleString('es-CL', { maximumFractionDigits: 2 })} kg`;
  return `${qty} g`;
}

export function formatDateShort(iso: string): string {
  return fmt(parseISO(iso), "d 'de' MMM", { locale: es });
}

export function formatDateLong(iso: string): string {
  return fmt(parseISO(iso), "EEEE d 'de' MMMM", { locale: es });
}

export function todayInSantiago(): string {
  const now = new Date();
  // The app is used in Chile only; store date as YYYY-MM-DD in Santiago time.
  const chile = new Date(now.toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  const y = chile.getFullYear();
  const m = String(chile.getMonth() + 1).padStart(2, '0');
  const d = String(chile.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return fmt(d, 'yyyy-MM-dd');
}
