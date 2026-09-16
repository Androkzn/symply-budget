import {
  clampToMonthBounds,
  dateForAsap,
  dateForNextWeek,
  dateForThisMonth,
  dateForThisWeek,
  defaultDateForMonth,
  inferWhenMode,
  monthDateBounds,
  resolveWhenDate,
  toCents,
  toDollarsString,
  toLocalYMD,
  whenHelperText,
} from '../budgetItemFormUtils';

describe('toDollarsString / toCents — currency conversion', () => {
  it('toDollarsString: null → "", cents → dollar string', () => {
    expect(toDollarsString(null)).toBe('');
    expect(toDollarsString(0)).toBe('0');
    expect(toDollarsString(1050)).toBe('10.5');
    expect(toDollarsString(99)).toBe('0.99');
    expect(toDollarsString(-500)).toBe('-5');
  });

  it('toCents: parses dollars → integer cents, rounding to the nearest cent', () => {
    expect(toCents('10')).toBe(1000);
    expect(toCents('10.5')).toBe(1050);
    expect(toCents('10.555')).toBe(1056); // 1055.5 rounds up
    expect(toCents('0')).toBe(0);
    expect(toCents('-5')).toBe(-500);
  });

  it('toCents: junk / empty input → undefined (never NaN cents)', () => {
    expect(toCents('')).toBeUndefined();
    expect(toCents('abc')).toBeUndefined();
    expect(toCents('  ')).toBeUndefined();
  });

  it('round-trips a whole-cent value', () => {
    expect(toCents(toDollarsString(1234))).toBe(1234);
  });
});

describe('monthDateBounds / clampToMonthBounds', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Local-constructed so startOfLocalDay() reads 2026-07-15 in any timezone.
    jest.setSystemTime(new Date(2026, 6, 15, 9, 0, 0));
  });
  afterEach(() => jest.useRealTimers());

  const ymd = (d: Date) => toLocalYMD(d);

  it('current month: spans the full month (1st → last day), not just up to today', () => {
    const { minimumDate, maximumDate } = monthDateBounds(2026, 7);
    expect(ymd(minimumDate)).toBe('2026-07-01');
    expect(ymd(maximumDate)).toBe('2026-07-31');
  });

  it('past month: full [1st, last day] range', () => {
    const { minimumDate, maximumDate } = monthDateBounds(2026, 6);
    expect(ymd(minimumDate)).toBe('2026-06-01');
    expect(ymd(maximumDate)).toBe('2026-06-30');
  });

  it('future month: full [1st, last day] range so future spendings can be dated any day', () => {
    const { minimumDate, maximumDate } = monthDateBounds(2026, 8);
    expect(ymd(minimumDate)).toBe('2026-08-01');
    expect(ymd(maximumDate)).toBe('2026-08-31');
  });

  it('clampToMonthBounds pins a date into [1st, last day] of the selected month', () => {
    expect(ymd(clampToMonthBounds(new Date(2026, 6, 20), 2026, 7))).toBe('2026-07-20'); // in range → unchanged (future day allowed)
    expect(ymd(clampToMonthBounds(new Date(2026, 5, 25), 2026, 7))).toBe('2026-07-01'); // below min → 1st
    expect(ymd(clampToMonthBounds(new Date(2026, 7, 10), 2026, 7))).toBe('2026-07-31'); // above max → last day
    expect(ymd(clampToMonthBounds(new Date(2026, 7, 15), 2026, 8))).toBe('2026-08-15'); // future month, in range → unchanged
  });
});

describe('budgetItemFormUtils', () => {
  describe('resolveWhenDate', () => {
    it('maps this_week to end of the current calendar week', () => {
      const resolved = resolveWhenDate('this_week', new Date(), 2026, 7);
      expect(toLocalYMD(resolved!)).toBe(toLocalYMD(dateForThisWeek()));
    });

    it('maps this_month to the last day of the selected budget month', () => {
      const resolved = resolveWhenDate('this_month', new Date(), 2026, 7);
      expect(toLocalYMD(resolved!)).toBe(toLocalYMD(dateForThisMonth(2026, 7)));
    });

    it('maps next_month to the last day of the month after the selected one', () => {
      const resolved = resolveWhenDate('next_month', new Date(), 2026, 7);
      expect(toLocalYMD(resolved!)).toBe('2026-08-31');
    });

    it('rolls next_month over the year boundary from December', () => {
      const resolved = resolveWhenDate('next_month', new Date(), 2026, 12);
      expect(toLocalYMD(resolved!)).toBe('2027-01-31');
    });

    it('maps next_year to the selected month one year out', () => {
      const resolved = resolveWhenDate('next_year', new Date(), 2026, 7);
      expect(toLocalYMD(resolved!)).toBe('2027-07-31');
    });

    it('maps asap to today', () => {
      const resolved = resolveWhenDate('asap', new Date(), 2026, 7);
      expect(toLocalYMD(resolved!)).toBe(toLocalYMD(dateForAsap()));
    });

    it('maps when_possible to no date (undated spending)', () => {
      expect(resolveWhenDate('when_possible', new Date(), 2026, 7)).toBeNull();
    });

    it('maps specific_date to the chosen local day', () => {
      const specific = new Date(2026, 6, 15);
      const resolved = resolveWhenDate('specific_date', specific, 2026, 7);
      expect(toLocalYMD(resolved!)).toBe('2026-07-15');
    });
  });

  describe('defaultDateForMonth', () => {
    it('returns "now" for the current month/year', () => {
      const now = new Date();
      const d = defaultDateForMonth(now.getFullYear(), now.getMonth() + 1);
      expect(toLocalYMD(d)).toBe(toLocalYMD(now));
    });

    it('returns the 1st of the month for a non-current month', () => {
      const d = defaultDateForMonth(2000, 3);
      expect(toLocalYMD(d)).toBe('2000-03-01');
    });
  });

  describe('inferWhenMode', () => {
    it('treats a missing stored date as an undated "when possible" spending', () => {
      expect(inferWhenMode(null, 2026, 7).mode).toBe('when_possible');
    });

    it('recognizes next_week anchor dates', () => {
      const stored = dateForNextWeek();
      const { mode, specificDate } = inferWhenMode(stored, 2100, 1);
      // A far-future budget month keeps next_week from colliding with this_month.
      expect(mode).toBe('next_week');
      expect(specificDate).toBe(stored);
    });

    it('recognizes next_month anchor dates', () => {
      const stored = new Date(2026, 8, 0); // last day of Aug 2026
      expect(inferWhenMode(stored, 2026, 7).mode).toBe('next_month');
    });

    it('recognizes next_year anchor dates', () => {
      const stored = new Date(2027, 7, 0); // last day of Jul 2027
      expect(inferWhenMode(stored, 2026, 7).mode).toBe('next_year');
    });

    it('recognizes this_week anchor dates', () => {
      const stored = dateForThisWeek();
      const { mode, specificDate } = inferWhenMode(stored, 2026, 7);
      // dateForThisWeek can coincide with the month's last day; accept either.
      expect(['this_week', 'this_month']).toContain(mode);
      expect(specificDate).toBe(stored);
    });

    it('recognizes this_month anchor dates', () => {
      const stored = dateForThisMonth(2026, 7);
      expect(inferWhenMode(stored, 2026, 7).mode).toBe('this_month');
    });

    it('recognizes the asap (today) anchor date', () => {
      const stored = dateForAsap();
      // Use a far-future budget month so "today" cannot match this_month.
      const { mode } = inferWhenMode(stored, 2100, 1);
      expect(['asap', 'this_week']).toContain(mode);
    });

    it('falls back to specific_date for arbitrary dates', () => {
      const stored = new Date(2026, 6, 10);
      expect(inferWhenMode(stored, 2026, 7).mode).toBe('specific_date');
    });
  });

  describe('whenHelperText', () => {
    it('describes asap as counting toward this month', () => {
      expect(whenHelperText('asap', dateForAsap())).toContain('today');
    });

    it('describes this_week with a weekday label', () => {
      const text = whenHelperText('this_week', dateForThisWeek());
      expect(text).toContain('Planned by');
    });

    it('includes the month name for this_month', () => {
      const target = dateForThisMonth(2026, 7);
      expect(whenHelperText('this_month', target)).toContain('July');
    });

    it('describes specific_date as counting toward that month', () => {
      const text = whenHelperText('specific_date', new Date(2026, 6, 15));
      expect(text).toContain('July');
    });

    it('returns the undated message for when_possible or a null target date', () => {
      expect(whenHelperText('when_possible', null)).toMatch(/No date yet/);
      // Any mode with a null target date also falls through to the undated message.
      expect(whenHelperText('asap', null)).toMatch(/No date yet/);
    });

    it('describes next_week with a weekday label', () => {
      expect(whenHelperText('next_week', dateForNextWeek())).toContain('Planned by');
    });

    it('includes the month + year for next_year', () => {
      const target = new Date(2027, 6, 31);
      expect(whenHelperText('next_year', target)).toContain('2027');
    });
  });
});
