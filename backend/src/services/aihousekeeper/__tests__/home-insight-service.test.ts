/**
 * home-insight-service — pure helper coverage.
 *
 * The Home hero's value lives in getting the "days until due" counter and the
 * money/date/copy formatting exactly right across timezones, so these are the
 * bits worth pinning down. (The ranked getInsight() path is exercised end-to-end
 * against a live household in the route tests.)
 */
import { describe, it, expect } from 'vitest';

import {
  addDaysISO,
  daysBetween,
  dueSoonLabel,
  formatMoney,
  formatWasteTypes,
  greetingForHour,
  localDateISO,
  localHour,
  localYearMonth,
  overdueLabel,
  relativeShort,
} from '../home-insight-service';

describe('daysBetween', () => {
  it('is 0 for the same day', () => {
    expect(daysBetween('2026-07-07', '2026-07-07')).toBe(0);
  });
  it('is positive for future due dates', () => {
    expect(daysBetween('2026-07-07', '2026-07-10')).toBe(3);
    expect(daysBetween('2026-07-07', '2026-07-08')).toBe(1);
  });
  it('is negative for overdue dates', () => {
    expect(daysBetween('2026-07-07', '2026-07-05')).toBe(-2);
    expect(daysBetween('2026-07-07', '2026-07-06')).toBe(-1);
  });
  it('crosses month and year boundaries', () => {
    expect(daysBetween('2026-07-31', '2026-08-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
  it('tolerates a full ISO timestamp on the target', () => {
    expect(daysBetween('2026-07-07', '2026-07-09T15:30:00.000Z')).toBe(2);
  });
});

describe('addDaysISO', () => {
  it('adds and subtracts calendar days', () => {
    expect(addDaysISO('2026-07-07', 14)).toBe('2026-07-21');
    expect(addDaysISO('2026-07-07', 30)).toBe('2026-08-06');
    expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('due-date labels (days counter)', () => {
  it('formats upcoming due labels', () => {
    expect(dueSoonLabel(0)).toBe('Due today');
    expect(dueSoonLabel(1)).toBe('Due tomorrow');
    expect(dueSoonLabel(3)).toBe('Due in 3 days');
  });
  it('formats overdue labels with pluralization', () => {
    expect(overdueLabel(1)).toBe('1 day overdue');
    expect(overdueLabel(4)).toBe('4 days overdue');
  });
  it('formats compact chip labels', () => {
    expect(relativeShort(-2)).toBe('2d overdue');
    expect(relativeShort(0)).toBe('today');
    expect(relativeShort(1)).toBe('tomorrow');
    expect(relativeShort(5)).toBe('in 5d');
  });
});

describe('greetingForHour', () => {
  it('buckets morning / afternoon / evening', () => {
    expect(greetingForHour(6)).toBe('Good morning');
    expect(greetingForHour(11)).toBe('Good morning');
    expect(greetingForHour(12)).toBe('Good afternoon');
    expect(greetingForHour(17)).toBe('Good afternoon');
    expect(greetingForHour(18)).toBe('Good evening');
    expect(greetingForHour(23)).toBe('Good evening');
  });
});

describe('timezone-aware local date/hour', () => {
  // 2026-07-07T02:30:00Z → still July 6 (evening) in Vancouver (UTC-7 in summer).
  const t = Date.parse('2026-07-07T02:30:00.000Z');
  it('resolves the local calendar date for a zone', () => {
    expect(localDateISO('America/Vancouver', t)).toBe('2026-07-06');
    expect(localDateISO('UTC', t)).toBe('2026-07-07');
  });
  it('resolves the local hour for a zone', () => {
    expect(localHour('America/Vancouver', t)).toBe(19); // 02:30Z - 7h = 19:30 prev day
    expect(localHour('UTC', t)).toBe(2);
  });
  it('resolves local year/month', () => {
    expect(localYearMonth('America/Vancouver', t)).toEqual({ year: 2026, month: 7 });
  });
});

describe('formatMoney (cents → compact dollars)', () => {
  it('rounds to whole dollars', () => {
    expect(formatMoney(7000)).toBe('$70');
    expect(formatMoney(12499)).toBe('$125');
  });
  it('groups thousands', () => {
    expect(formatMoney(124000)).toBe('$1,240');
    expect(formatMoney(500000)).toBe('$5,000');
  });
});

describe('formatWasteTypes', () => {
  it('formats a single stream', () => {
    expect(formatWasteTypes(['recycling'])).toBe('Recycling');
  });
  it('joins multiple streams naturally', () => {
    expect(formatWasteTypes(['recycling', 'organics'])).toBe('Recycling & organics');
    expect(formatWasteTypes(['garbage', 'recycling', 'organics'])).toBe(
      'Garbage, Recycling & organics'
    );
  });
  it('falls back for empty input', () => {
    expect(formatWasteTypes([])).toBe('Collection');
  });
});
