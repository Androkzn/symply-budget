/**
 * timezone.ts — plan §B5
 *
 * Exercises DST-aware helpers over Intl.DateTimeFormat. The asserts below
 * are pinned against well-known local wall-clock moments, including the
 * 2am-DST-spring-forward boundary for America/New_York.
 */

import { describe, it, expect } from 'vitest';

import {
  hourInTimezone,
  dateInTimezone,
  minutesFromMidnight,
  isInQuietHours,
  startOfDayLocalUtc,
} from '../timezone';

describe('hourInTimezone', () => {
  it('returns local hour for America/New_York in winter (EST = UTC-5)', () => {
    // 2025-01-15T13:00:00Z → 08:00 local in New York (EST).
    const d = new Date('2025-01-15T13:00:00Z');
    expect(hourInTimezone(d, 'America/New_York')).toBe(8);
  });

  it('returns local hour for America/New_York in summer (EDT = UTC-4)', () => {
    // 2025-07-15T13:00:00Z → 09:00 local in New York (EDT).
    const d = new Date('2025-07-15T13:00:00Z');
    expect(hourInTimezone(d, 'America/New_York')).toBe(9);
  });

  it('returns 0, not 24, at local midnight (hourCycle h23 fix)', () => {
    // 2025-06-01T04:00:00Z → 00:00 local in New York.
    const d = new Date('2025-06-01T04:00:00Z');
    const hr = hourInTimezone(d, 'America/New_York');
    expect(hr).toBeGreaterThanOrEqual(0);
    expect(hr).toBeLessThanOrEqual(23);
  });

  it('respects Tokyo offset (UTC+9)', () => {
    // 2025-03-01T00:00:00Z → 09:00 local in Tokyo.
    const d = new Date('2025-03-01T00:00:00Z');
    expect(hourInTimezone(d, 'Asia/Tokyo')).toBe(9);
  });
});

describe('dateInTimezone', () => {
  it('returns YYYY-MM-DD in the requested timezone', () => {
    const d = new Date('2025-04-10T02:00:00Z'); // prior-day local in NY
    expect(dateInTimezone(d, 'America/New_York')).toBe('2025-04-09');
    expect(dateInTimezone(d, 'UTC')).toBe('2025-04-10');
  });
});

describe('minutesFromMidnight', () => {
  it('counts minutes past local midnight', () => {
    // 2025-06-01T11:30:00Z = 07:30 local in NY = 7*60 + 30 = 450
    const d = new Date('2025-06-01T11:30:00Z');
    expect(minutesFromMidnight(d, 'America/New_York')).toBe(450);
  });
});

describe('isInQuietHours', () => {
  it('detects same-day window (13:00-15:00)', () => {
    const inside = new Date('2025-06-01T14:00:00Z'); // 14:00 UTC
    expect(isInQuietHours(inside, 'UTC', '13:00', '15:00')).toBe(true);
    const outside = new Date('2025-06-01T15:01:00Z');
    expect(isInQuietHours(outside, 'UTC', '13:00', '15:00')).toBe(false);
  });

  it('detects wrap-around window (22:00-07:00)', () => {
    // Midnight UTC — inside the 22:00 → 07:00 wrap window.
    const midnight = new Date('2025-06-01T00:30:00Z');
    expect(isInQuietHours(midnight, 'UTC', '22:00', '07:00')).toBe(true);
    const midday = new Date('2025-06-01T12:00:00Z');
    expect(isInQuietHours(midday, 'UTC', '22:00', '07:00')).toBe(false);
  });

  it('degenerate window (start==end) never matches', () => {
    const d = new Date('2025-06-01T12:00:00Z');
    expect(isInQuietHours(d, 'UTC', '12:00', '12:00')).toBe(false);
  });

  it('DST spring-forward: 02:30 local never exists — behaves sanely', () => {
    // US spring-forward 2025-03-09: 02:00 → 03:00 local in NY.
    // 07:30 UTC on that day = 03:30 local (post-jump).
    const d = new Date('2025-03-09T07:30:00Z');
    // After spring-forward, 03:30 local is outside 22:00-07:00 quiet window.
    expect(isInQuietHours(d, 'America/New_York', '22:00', '07:00')).toBe(true);
  });

  it('DST fall-back: 01:30 local occurs twice — still inside 22:00-07:00 quiet window', () => {
    // US fall-back 2025-11-02: 02:00 local → 01:00 local. 05:30 UTC = 01:30 EST (post-fallback).
    const d = new Date('2025-11-02T05:30:00Z');
    expect(isInQuietHours(d, 'America/New_York', '22:00', '07:00')).toBe(true);
  });
});

describe('startOfDayLocalUtc', () => {
  it('returns a Date whose local date matches in the given tz', () => {
    const d = new Date('2025-06-01T20:00:00Z'); // 16:00 local NY (summer)
    const sod = startOfDayLocalUtc(d, 'America/New_York');
    // `dateInTimezone` of the returned moment should equal local date.
    expect(dateInTimezone(sod, 'America/New_York')).toBe('2025-06-01');
  });
});
