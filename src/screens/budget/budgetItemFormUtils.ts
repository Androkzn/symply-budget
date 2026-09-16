import type { BudgetItem } from '@api/budget';

export type WhenMode =
  | 'asap'
  | 'this_week'
  | 'next_week'
  | 'this_month'
  | 'next_month'
  | 'next_year'
  | 'when_possible'
  | 'specific_date';

export interface WhenOption {
  value: WhenMode;
  label: string;
  /**
   * Frequently-used options shown as always-visible chips ("fixed panel").
   * The rest live behind the "More" dropdown so the screen stays uncluttered.
   */
  primary?: boolean;
}

// Ordered soonest → furthest out, with the undated + custom options last. The
// dropdown renders this full list; the form's quick row renders only `primary`.
export const WHEN_OPTIONS: WhenOption[] = [
  { value: 'asap', label: 'ASAP', primary: true },
  { value: 'this_week', label: 'This week', primary: true },
  { value: 'next_week', label: 'Next week' },
  { value: 'this_month', label: 'This month', primary: true },
  { value: 'next_month', label: 'Next month' },
  { value: 'next_year', label: 'Next year' },
  { value: 'when_possible', label: 'When possible' },
  { value: 'specific_date', label: 'Specific date', primary: true },
];

export function toDollarsString(cents: number | null): string {
  if (cents === null) return '';
  return (cents / 100).toString();
}

export function toCents(dollars: string): number | undefined {
  const n = parseFloat(dollars);
  if (Number.isNaN(n)) return undefined;
  return Math.round(n * 100);
}

export function defaultDateForMonth(year: number, month: number): Date {
  const now = new Date();
  if (now.getFullYear() === year && now.getMonth() + 1 === month) return now;
  return new Date(year, month - 1, 1);
}

export function monthDateBounds(year: number, month: number): { minimumDate: Date; maximumDate: Date } {
  // A recorded spending can land on any day of the month it belongs to, including
  // future days and future months — the selected month already scopes the picker,
  // so we span its full [1st, last-day] range instead of clamping to today.
  const minimumDate = startOfLocalDay(new Date(year, month - 1, 1));
  const maximumDate = startOfLocalDay(new Date(year, month, 0));
  return { minimumDate, maximumDate };
}

export function clampToMonthBounds(date: Date, year: number, month: number): Date {
  const { minimumDate, maximumDate } = monthDateBounds(year, month);
  const d = startOfLocalDay(date);
  if (d < minimumDate) return minimumDate;
  if (d > maximumDate) return maximumDate;
  return d;
}

export function toLocalYMD(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseLocalYMD(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function dateForThisWeek(from = new Date()): Date {
  const today = startOfLocalDay(from);
  const day = today.getDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  const end = new Date(today);
  end.setDate(today.getDate() + daysUntilSunday);
  return end;
}

export function dateForNextWeek(from = new Date()): Date {
  const end = dateForThisWeek(from);
  end.setDate(end.getDate() + 7);
  return end;
}

export function dateForThisMonth(year: number, month: number): Date {
  return new Date(year, month, 0);
}

// Last day of the month after the selected one (JS Date handles Dec → Jan rollover).
export function dateForNextMonth(year: number, month: number): Date {
  return new Date(year, month + 1, 0);
}

// Last day of the selected month, one calendar year out.
export function dateForNextYear(year: number, month: number): Date {
  return new Date(year + 1, month, 0);
}

export function dateForAsap(): Date {
  return startOfLocalDay();
}

/**
 * Resolve a "When" choice to the target date that buckets the spending into a
 * month. Returns `null` for "when possible" — an undated spending that stays on
 * the list until it's scheduled or recorded (never consumes a month's budget).
 */
export function resolveWhenDate(
  mode: WhenMode,
  specificDate: Date,
  year: number,
  month: number,
): Date | null {
  switch (mode) {
    case 'asap':
      return dateForAsap();
    case 'this_week':
      return dateForThisWeek();
    case 'next_week':
      return dateForNextWeek();
    case 'this_month':
      return dateForThisMonth(year, month);
    case 'next_month':
      return dateForNextMonth(year, month);
    case 'next_year':
      return dateForNextYear(year, month);
    case 'when_possible':
      return null;
    case 'specific_date':
      return startOfLocalDay(specificDate);
  }
}

export function inferWhenMode(
  stored: Date | null,
  year: number,
  month: number,
): { mode: WhenMode; specificDate: Date } {
  const fallback = defaultDateForMonth(year, month);
  // No stored date means an undated ("Anytime") spending — surfaced as "when possible".
  if (!stored) {
    return { mode: 'when_possible', specificDate: fallback };
  }
  const ymd = toLocalYMD(stored);
  // Relative anchors first (this_week before asap so an end-of-week "today"
  // resolves to the more specific chip), then fall back to a custom date.
  if (ymd === toLocalYMD(dateForThisWeek())) {
    return { mode: 'this_week', specificDate: stored };
  }
  if (ymd === toLocalYMD(dateForNextWeek())) {
    return { mode: 'next_week', specificDate: stored };
  }
  if (ymd === toLocalYMD(dateForThisMonth(year, month))) {
    return { mode: 'this_month', specificDate: stored };
  }
  if (ymd === toLocalYMD(dateForNextMonth(year, month))) {
    return { mode: 'next_month', specificDate: stored };
  }
  if (ymd === toLocalYMD(dateForNextYear(year, month))) {
    return { mode: 'next_year', specificDate: stored };
  }
  if (ymd === toLocalYMD(dateForAsap())) {
    return { mode: 'asap', specificDate: stored };
  }
  return { mode: 'specific_date', specificDate: stored };
}

export function whenHelperText(mode: WhenMode, targetDate: Date | null): string {
  if (mode === 'when_possible' || !targetDate) {
    return 'No date yet — stays on your list until you schedule or record it.';
  }
  switch (mode) {
    case 'asap':
      return 'Planned for today — counts toward this month’s budget.';
    case 'this_week':
    case 'next_week':
      return `Planned by ${targetDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}.`;
    case 'this_month':
    case 'next_month':
    case 'next_year':
      return `Planned for ${targetDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}.`;
    case 'specific_date':
      return `Counts toward ${targetDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}’s budget.`;
  }
}

/**
 * Short, at-a-glance hint for each option in the "When" dropdown (e.g. the
 * resolved month or day), so users can pick without opening a date picker.
 */
export function whenOptionSubtitle(mode: WhenMode, year: number, month: number): string {
  if (mode === 'when_possible') return 'No date';
  if (mode === 'specific_date') return 'Pick a day';
  const resolved = resolveWhenDate(mode, defaultDateForMonth(year, month), year, month);
  if (!resolved) return '';
  if (mode === 'asap') return 'Today';
  if (mode === 'this_week' || mode === 'next_week') {
    return resolved.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return resolved.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export const PRIORITIES: Array<{ value: BudgetItem['priority']; label: string }> = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];
