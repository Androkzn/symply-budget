/**
 * Local-time date-only helpers.
 *
 * `new Date('2026-07-14')` parses as UTC midnight, so west of GMT (e.g. the
 * app's Vancouver default, UTC-7/-8) it reads back as the *previous* calendar
 * day. That made bill/utility dates render a day early and due-date math flag
 * bills "Overdue" one day too soon, and made `toISOString().split('T')[0]`
 * serialize the wrong calendar day when a picker was used in the evening.
 *
 * These helpers anchor date-only values to LOCAL time. The parse anchors at
 * noon so a DST transition can never nudge the result across a day boundary.
 */

/** Parse a 'YYYY-MM-DD' (or longer ISO) string as local noon. */
export function parseLocalDateOnly(value: string): Date {
  return new Date(value.slice(0, 10) + 'T12:00:00');
}

/** Format a Date as 'YYYY-MM-DD' using its LOCAL calendar fields (never UTC). */
export function toLocalDateKey(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Whole-day delta from local "today" to a date-only string.
 * Negative = in the past, 0 = today, positive = future. DST-safe (noon anchors).
 */
export function daysUntilLocal(value: string, now: Date = new Date()): number {
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const target = parseLocalDateOnly(value);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}
