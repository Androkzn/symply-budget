import type { Appliance } from '@api/appliances';
import { shortDay } from '@hooks/useGarbageSummary';
import { countExpiringWarranties } from '@hooks/useHomeDashboard';

const DAY = 24 * 60 * 60 * 1000;

function applianceWith(warranty: Appliance['warranty']): Appliance {
  return { warranty } as Appliance;
}

describe('countExpiringWarranties — 45-day window', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-15T00:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

  it('counts a manufacturer warranty expiring inside the window', () => {
    const list = [applianceWith({ manufacturer: { expiration: iso(10) } } as never)];
    expect(countExpiringWarranties(list, 45)).toBe(1);
  });

  it('includes the exact horizon boundary (day 45) and excludes day 46', () => {
    expect(countExpiringWarranties([applianceWith({ manufacturer: { expiration: iso(45) } } as never)], 45)).toBe(1);
    expect(countExpiringWarranties([applianceWith({ manufacturer: { expiration: iso(46) } } as never)], 45)).toBe(0);
  });

  it('excludes already-expired warranties (before now)', () => {
    expect(countExpiringWarranties([applianceWith({ manufacturer: { expiration: iso(-1) } } as never)], 45)).toBe(0);
  });

  it('counts an appliance once even if BOTH warranties expire soon', () => {
    const list = [
      applianceWith({
        manufacturer: { expiration: iso(5) },
        extended: { expiration: iso(20) },
      } as never),
    ];
    expect(countExpiringWarranties(list, 45)).toBe(1);
  });

  it('uses the extended warranty when the manufacturer one is missing', () => {
    const list = [applianceWith({ extended: { expiration: iso(3) } } as never)];
    expect(countExpiringWarranties(list, 45)).toBe(1);
  });

  it('skips missing and unparseable expiration dates', () => {
    expect(countExpiringWarranties([applianceWith(undefined as never)], 45)).toBe(0);
    expect(countExpiringWarranties([applianceWith({ manufacturer: { expiration: null } } as never)], 45)).toBe(0);
    expect(countExpiringWarranties([applianceWith({ manufacturer: { expiration: 'not-a-date' } } as never)], 45)).toBe(0);
  });

  it('returns 0 for an empty list and sums across multiple appliances', () => {
    expect(countExpiringWarranties([], 45)).toBe(0);
    const list = [
      applianceWith({ manufacturer: { expiration: iso(10) } } as never),
      applianceWith({ manufacturer: { expiration: iso(100) } } as never), // out of window
      applianceWith({ extended: { expiration: iso(2) } } as never),
    ];
    expect(countExpiringWarranties(list, 45)).toBe(2);
  });
});

describe('shortDay — Today / Tomorrow / weekday', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Local-constructed instant → toDateString() lands on 2026-07-15 in any TZ.
    jest.setSystemTime(new Date(2026, 6, 15, 9, 0, 0));
  });
  afterEach(() => jest.useRealTimers());

  // Local-time date strings (no trailing Z) so new Date() keeps the local day.
  it('labels the current day "Today"', () => {
    expect(shortDay('2026-07-15T12:00:00')).toBe('Today');
  });

  it('labels the next day "Tomorrow"', () => {
    expect(shortDay('2026-07-16T12:00:00')).toBe('Tomorrow');
  });

  it('labels any other day with its short weekday name', () => {
    expect(shortDay('2026-07-20T12:00:00')).toBe('Mon'); // Jul 20 2026 is a Monday
    expect(shortDay('2026-07-18T12:00:00')).toBe('Sat');
  });
});
