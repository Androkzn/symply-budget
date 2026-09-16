import { parseLocalDateOnly, toLocalDateKey, daysUntilLocal } from '../localDate';

// These assertions use local Date construction (new Date(y, m, d, h)) and local
// getters, so they hold in any machine timezone — which is the whole point: the
// helpers must anchor date-only values to LOCAL time, never UTC.
describe('localDate', () => {
  describe('parseLocalDateOnly', () => {
    it('parses a YYYY-MM-DD string as the same LOCAL calendar day (not UTC)', () => {
      const d = parseLocalDateOnly('2026-07-14');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(6); // July, 0-indexed
      expect(d.getDate()).toBe(14);
    });

    it('anchors at local noon so a DST/UTC shift can never cross a day boundary', () => {
      expect(parseLocalDateOnly('2026-07-14').getHours()).toBe(12);
    });

    it('uses only the date portion of a longer ISO timestamp', () => {
      const d = parseLocalDateOnly('2026-01-31T23:30:00Z');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(0);
      expect(d.getDate()).toBe(31);
    });
  });

  describe('toLocalDateKey', () => {
    it('formats a Date using its LOCAL calendar fields', () => {
      expect(toLocalDateKey(new Date(2026, 6, 14, 9, 5))).toBe('2026-07-14');
    });

    it('does not roll to the next day for an evening local time (the toISOString bug)', () => {
      // 20 Jul 2026, 23:00 local — toISOString().split('T')[0] would yield the 21st
      // west of GMT, booking work a day late. toLocalDateKey keeps the 20th.
      expect(toLocalDateKey(new Date(2026, 6, 20, 23, 0))).toBe('2026-07-20');
    });

    it('zero-pads month and day', () => {
      expect(toLocalDateKey(new Date(2026, 0, 3))).toBe('2026-01-03');
    });
  });

  describe('daysUntilLocal', () => {
    const now = new Date(2026, 6, 14, 10, 0); // 14 Jul 2026, 10:00 local

    it('returns 0 for today', () => {
      expect(daysUntilLocal('2026-07-14', now)).toBe(0);
    });

    it('returns a negative delta for a past (overdue) date', () => {
      expect(daysUntilLocal('2026-07-13', now)).toBe(-1);
    });

    it('returns the positive day delta for a future date', () => {
      expect(daysUntilLocal('2026-07-17', now)).toBe(3);
    });

    it('treats a same-day date-only due date as due today (0), not -1 "Overdue"', () => {
      // Regression: new Date('2026-07-14') is UTC midnight → read locally it was the
      // 13th west of GMT → -1 "Overdue" a day early. Noon-anchored it is correctly 0
      // even when evaluated late in the evening.
      const evening = new Date(2026, 6, 14, 22, 0);
      expect(daysUntilLocal('2026-07-14', evening)).toBe(0);
    });
  });
});
