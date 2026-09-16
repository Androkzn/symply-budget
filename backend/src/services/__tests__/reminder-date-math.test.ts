/**
 * Recurring-task date arithmetic on ReminderService. These are the two private
 * date helpers the cron completion path relies on — the month-overflow and
 * leap-day rollovers are exactly where naive `setMonth`/`setFullYear` math bites.
 *
 * The Workers runtime is UTC, so `YYYY-MM-DD` inputs (parsed as UTC midnight)
 * and the `setMonth`/`getDate` math line up with the UTC calendar.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import type { Env } from '../../types';
import { ReminderService } from '../reminder-service';

// Constructor only stores env/db; the date helpers touch neither.
const svc = new ReminderService({} as Env, {} as D1Database);
const nextDue = (from: string, freq: string): string =>
  (svc as unknown as { calculateNextDueDate(d: Date, f: string): string }).calculateNextDueDate(
    new Date(from),
    freq
  );
const daysUntil = (due: string): number =>
  (svc as unknown as { calculateDaysUntilDue(d: string): number }).calculateDaysUntilDue(due);

describe('calculateNextDueDate — frequency rollovers', () => {
  it('daily / weekly add whole days', () => {
    expect(nextDue('2026-03-10', 'daily')).toBe('2026-03-11');
    expect(nextDue('2026-03-10', 'weekly')).toBe('2026-03-17');
  });

  it('monthly advances one month for an in-range day', () => {
    expect(nextDue('2026-03-10', 'monthly')).toBe('2026-04-10');
  });

  it('monthly from Jan 31 overflows through February (non-leap year → Mar 3)', () => {
    expect(nextDue('2026-01-31', 'monthly')).toBe('2026-03-03');
  });

  it('monthly from Jan 31 overflows through February (leap year → Mar 2)', () => {
    expect(nextDue('2024-01-31', 'monthly')).toBe('2024-03-02');
  });

  it('monthly rolls into the next year', () => {
    expect(nextDue('2026-12-15', 'monthly')).toBe('2027-01-15');
  });

  it('quarterly adds three months, crossing the year boundary', () => {
    expect(nextDue('2026-01-15', 'quarterly')).toBe('2026-04-15');
    expect(nextDue('2026-11-15', 'quarterly')).toBe('2027-02-15');
  });

  it('yearly adds a year', () => {
    expect(nextDue('2026-03-10', 'yearly')).toBe('2027-03-10');
  });

  it('yearly from a leap day rolls Feb 29 into the next March 1', () => {
    expect(nextDue('2024-02-29', 'yearly')).toBe('2025-03-01');
  });

  it('multi-year frequencies advance the year', () => {
    expect(nextDue('2026-03-10', '3_years')).toBe('2029-03-10');
    expect(nextDue('2026-03-10', '5_years')).toBe('2031-03-10');
  });

  it('an unknown frequency defaults to monthly', () => {
    expect(nextDue('2026-03-10', 'fortnightly?')).toBe('2026-04-10');
  });
});

describe('calculateDaysUntilDue — ceil semantics', () => {
  afterEach(() => vi.useRealTimers());

  it('counts whole days to a future date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
    expect(daysUntil('2026-07-20')).toBe(5);
  });

  it('rounds a partial day UP (any time today toward tomorrow is 1)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    expect(daysUntil('2026-07-16')).toBe(1);
  });

  it('returns 0 on the due date itself (at midnight)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
    expect(daysUntil('2026-07-15')).toBe(0);
  });

  it('goes negative for an overdue date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
    expect(daysUntil('2026-07-10')).toBe(-5);
  });
});
