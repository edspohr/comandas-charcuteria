import { addDaysIso, todayInSantiago } from '@/lib/format';

// Default requestedDate rule: orders placed before cutoffHour default to
// tomorrow; after cutoff, default to day+2. Vendedor can override to any
// future date (min = tomorrow) — admin can go same-day.
export function defaultRequestedDate(cutoffHour: number, nowHour = new Date().getHours()): string {
  const today = todayInSantiago();
  const offset = nowHour < cutoffHour ? 1 : 2;
  return addDaysIso(today, offset);
}

export function minRequestedDate(): string {
  return addDaysIso(todayInSantiago(), 1);
}
