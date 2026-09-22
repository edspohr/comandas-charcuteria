import { addDaysIso, todayInSantiago } from '@/lib/format';

// Current hour in America/Santiago time (0-23), independent of the browser TZ.
function santiagoHourNow(): number {
  const now = new Date();
  const formatted = now.toLocaleString('en-US', { timeZone: 'America/Santiago', hour: '2-digit', hour12: false });
  const parsed = parseInt(formatted, 10);
  return Number.isFinite(parsed) ? parsed : new Date().getHours();
}

// Default requestedDate rule: orders placed before cutoffHour default to
// tomorrow; after cutoff, default to day+2. Vendedor can override to any
// future date (min = tomorrow) — admin can go same-day.
export function defaultRequestedDate(cutoffHour: number, nowHour: number = santiagoHourNow()): string {
  const today = todayInSantiago();
  const offset = nowHour < cutoffHour ? 1 : 2;
  return addDaysIso(today, offset);
}

export function minRequestedDate(): string {
  return addDaysIso(todayInSantiago(), 1);
}
