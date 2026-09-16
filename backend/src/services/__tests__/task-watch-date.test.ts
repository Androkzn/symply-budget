/**
 * toWatchDate — date normalization for the Apple Watch feed (GET /tasks/watch).
 *
 * The Watch decodes dates with a default `ISO8601DateFormatter`, which rejects
 * BOTH fractional seconds and bare `YYYY-MM-DD` values. These previously caused
 * every due date to silently drop out, hiding tasks from the Watch's date
 * filters. This locks the contract: emit `...Z` with no fractional seconds, and
 * promote date-only values to noon UTC.
 */
import { describe, it, expect } from 'vitest';

import { toWatchDate } from '../task-service';

describe('toWatchDate', () => {
  it('returns null for empty / nullish input', () => {
    expect(toWatchDate(null)).toBeNull();
    expect(toWatchDate(undefined)).toBeNull();
    expect(toWatchDate('')).toBeNull();
  });

  it('promotes a date-only value to noon UTC', () => {
    expect(toWatchDate('2026-07-10')).toBe('2026-07-10T12:00:00Z');
  });

  it('strips fractional seconds from a full ISO timestamp', () => {
    expect(toWatchDate('2026-07-10T08:30:00.000Z')).toBe('2026-07-10T08:30:00Z');
  });

  it('passes through a timestamp that already has no fractional seconds', () => {
    expect(toWatchDate('2026-07-10T08:30:00Z')).toBe('2026-07-10T08:30:00Z');
  });

  it('normalizes a non-UTC offset to Z with no fractional seconds', () => {
    // 2026-07-10T00:00:00-07:00 === 2026-07-10T07:00:00Z
    expect(toWatchDate('2026-07-10T00:00:00-07:00')).toBe('2026-07-10T07:00:00Z');
  });

  it('never emits fractional seconds (Watch ISO8601 parser rejects them)', () => {
    const out = toWatchDate('2026-01-01T23:59:59.123Z');
    expect(out).not.toBeNull();
    expect(out).not.toMatch(/\.\d+/);
    expect(out!.endsWith('Z')).toBe(true);
  });

  it('returns null for an unparseable value', () => {
    expect(toWatchDate('not-a-date')).toBeNull();
  });
});
