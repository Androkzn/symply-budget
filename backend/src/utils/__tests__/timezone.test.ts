/**
 * Timezone / DST date-math. These helpers anchor task deadlines to a
 * household's local calendar day, so the tests pin down the DST-offset math,
 * the west-of-UTC / east-of-UTC day shifts, and the pure calendar-day diff.
 *
 * Pure functions — no D1. Functions that read "now" are exercised with
 * `vi.setSystemTime` so the calendar boundaries are deterministic.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  todayPartsInTz,
  formatTodayInTz,
  zonedWallTimeToUtcIso,
  daysBetweenIsoDates,
  dueDateFromDaysInTz,
} from '../timezone';

describe('daysBetweenIsoDates', () => {
  it('same date → 0', () => {
    expect(daysBetweenIsoDates('2026-07-10', '2026-07-10')).toBe(0);
  });

  it('consecutive days → 1', () => {
    expect(daysBetweenIsoDates('2026-07-10', '2026-07-11')).toBe(1);
  });

  it('reversed order → negative', () => {
    expect(daysBetweenIsoDates('2026-07-10', '2026-07-01')).toBe(-9);
  });

  it('crosses a month boundary', () => {
    expect(daysBetweenIsoDates('2026-01-31', '2026-02-01')).toBe(1);
  });

  it('crosses a year boundary', () => {
    expect(daysBetweenIsoDates('2025-12-31', '2026-01-01')).toBe(1);
  });

  it('counts the leap day in a leap year (Feb 28 → Mar 1 = 2 days)', () => {
    expect(daysBetweenIsoDates('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('skips the (absent) leap day in a common year (Feb 28 → Mar 1 = 1 day)', () => {
    expect(daysBetweenIsoDates('2026-02-28', '2026-03-01')).toBe(1);
  });

  it('is unaffected by DST transitions (pure UTC-midnight calendar math)', () => {
    // Spans the US spring-forward (Mar 8 2026). A naive local-time diff would
    // be 30 days 23h; the UTC-midnight math keeps it a clean 31 calendar days.
    expect(daysBetweenIsoDates('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('handles a full year', () => {
    expect(daysBetweenIsoDates('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetweenIsoDates('2024-01-01', '2025-01-01')).toBe(366); // leap year
  });
});

describe('zonedWallTimeToUtcIso — wall-clock → UTC across DST', () => {
  it('UTC zone is an identity on the wall clock', () => {
    expect(zonedWallTimeToUtcIso(2026, 7, 10, 17, 0, 'UTC')).toBe('2026-07-10T17:00:00.000Z');
  });

  it('applies a fixed +5:30 offset (Asia/Kolkata, no DST)', () => {
    expect(zonedWallTimeToUtcIso(2026, 7, 10, 17, 0, 'Asia/Kolkata')).toBe('2026-07-10T11:30:00.000Z');
  });

  it('uses PDT (-7) in summer for America/Los_Angeles', () => {
    expect(zonedWallTimeToUtcIso(2026, 7, 10, 17, 0, 'America/Los_Angeles')).toBe(
      '2026-07-11T00:00:00.000Z'
    );
  });

  it('uses PST (-8) in winter for America/Los_Angeles', () => {
    expect(zonedWallTimeToUtcIso(2026, 1, 10, 17, 0, 'America/Los_Angeles')).toBe(
      '2026-01-11T01:00:00.000Z'
    );
  });

  it('uses CEST (+2) in summer and CET (+1) in winter for Europe/Berlin', () => {
    expect(zonedWallTimeToUtcIso(2026, 7, 10, 17, 0, 'Europe/Berlin')).toBe('2026-07-10T15:00:00.000Z');
    expect(zonedWallTimeToUtcIso(2026, 1, 10, 17, 0, 'Europe/Berlin')).toBe('2026-01-10T16:00:00.000Z');
  });

  it('falls back to a zero offset (treats as UTC) for an invalid IANA zone', () => {
    expect(zonedWallTimeToUtcIso(2026, 7, 10, 17, 0, 'Not/AZone')).toBe('2026-07-10T17:00:00.000Z');
  });

  it('round-trips: formatting the result back into the zone recovers the wall time', () => {
    const cases: Array<[number, number, number, number, string]> = [
      [2026, 7, 10, 17, 'America/Los_Angeles'],
      [2026, 1, 10, 9, 'America/Los_Angeles'],
      [2026, 7, 10, 23, 'Europe/Berlin'],
      [2026, 12, 25, 0, 'Asia/Kolkata'],
      [2026, 11, 15, 6, 'Australia/Sydney'],
    ];
    for (const [y, mo, d, h, zone] of cases) {
      const iso = zonedWallTimeToUtcIso(y, mo, d, h, 0, zone);
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(new Date(iso));
      const get = (t: string) => parts.find((p) => p.type === t)?.value;
      expect(`${get('year')}-${get('month')}-${get('day')}`).toBe(
        `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      );
      // hour "24" is the midnight edge some engines emit; normalise before compare
      const hh = get('hour') === '24' ? '00' : get('hour');
      expect(hh).toBe(String(h).padStart(2, '0'));
    }
  });

  it('is deterministic even inside the spring-forward gap (2:30 AM does not exist)', () => {
    // 2026-03-08 02:30 America/Los_Angeles is skipped by the DST jump. The
    // function must still return a stable, parseable instant.
    const a = zonedWallTimeToUtcIso(2026, 3, 8, 2, 30, 'America/Los_Angeles');
    const b = zonedWallTimeToUtcIso(2026, 3, 8, 2, 30, 'America/Los_Angeles');
    expect(a).toBe(b);
    expect(Number.isNaN(Date.parse(a))).toBe(false);
  });
});

describe('todayPartsInTz — now-relative day, honouring the zone', () => {
  afterEach(() => vi.useRealTimers());

  it('reads the local calendar day for UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    expect(todayPartsInTz('UTC')).toEqual({ year: 2026, month: 7, day: 15 });
  });

  it('shifts a day BACK for a zone west of UTC before its local midnight rolls over', () => {
    vi.useFakeTimers();
    // 06:00 UTC is still 2026-07-14 23:00 in Los Angeles.
    vi.setSystemTime(new Date('2026-07-15T06:00:00Z'));
    expect(todayPartsInTz('America/Los_Angeles')).toEqual({ year: 2026, month: 7, day: 14 });
  });

  it('shifts a day FORWARD for a zone east of UTC', () => {
    vi.useFakeTimers();
    // 20:00 UTC is already 2026-07-16 05:00 in Tokyo.
    vi.setSystemTime(new Date('2026-07-15T20:00:00Z'));
    expect(todayPartsInTz('Asia/Tokyo')).toEqual({ year: 2026, month: 7, day: 16 });
  });

  it('falls back to UTC parts for an invalid zone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    expect(todayPartsInTz('Not/AZone')).toEqual({ year: 2026, month: 7, day: 15 });
  });

  it('treats an empty zone string as UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    expect(todayPartsInTz('')).toEqual({ year: 2026, month: 7, day: 15 });
  });
});

describe('formatTodayInTz', () => {
  afterEach(() => vi.useRealTimers());

  it('returns an ISO date, a human label, and the resolved zone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const out = formatTodayInTz('UTC');
    expect(out.iso).toBe('2026-07-15');
    expect(out.human).toMatch(/July 15, 2026/);
    expect(out.zone).toBe('UTC');
  });

  it('resolves to UTC for an invalid zone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const out = formatTodayInTz('Not/AZone');
    expect(out.zone).toBe('UTC');
    expect(out.iso).toBe('2026-07-15');
  });
});

describe('dueDateFromDaysInTz', () => {
  afterEach(() => vi.useRealTimers());

  it('anchors "today" (0 days) to 17:00 local, converted to UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    // 2026-07-15 17:00 PDT → 2026-07-16 00:00 UTC
    expect(dueDateFromDaysInTz(0, 'America/Los_Angeles')).toBe('2026-07-16T00:00:00.000Z');
  });

  it('adds the day delta on the local calendar', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    expect(dueDateFromDaysInTz(1, 'America/Los_Angeles')).toBe('2026-07-17T00:00:00.000Z');
  });

  it('honours a custom local hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    // 2026-07-15 09:00 PDT → 2026-07-15 16:00 UTC
    expect(dueDateFromDaysInTz(0, 'America/Los_Angeles', 9)).toBe('2026-07-15T16:00:00.000Z');
  });

  it('respects the zone-shifted "today" when computing the delta', () => {
    vi.useFakeTimers();
    // Local day in LA is still 2026-07-14 at this instant.
    vi.setSystemTime(new Date('2026-07-15T06:00:00Z'));
    // today(LA)=07-14, +0 days → 2026-07-14 17:00 PDT → 2026-07-15 00:00 UTC
    expect(dueDateFromDaysInTz(0, 'America/Los_Angeles')).toBe('2026-07-15T00:00:00.000Z');
  });
});
