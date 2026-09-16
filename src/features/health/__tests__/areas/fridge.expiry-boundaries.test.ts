/**
 * Symply Health — FRIDGE, the expiry CALENDAR.
 *
 * `healthFridgeStorage.test.ts` proves the buckets exist and that the deployed
 * window includes the past. This file owns the arithmetic underneath them: the
 * exact day a row changes bucket, and which CLOCK decides that day.
 *
 * Why it is worth its own suite. Every date on this surface is day-grained, and
 * three different mechanisms produce those days:
 *
 *   1. `todayDateKey()` — the DEVICE's LOCAL calendar day (`getFullYear/Month/Date`);
 *   2. `daysUntil()` — both keys re-parsed at `T00:00:00Z`, i.e. pure UTC
 *      arithmetic on two day labels, which is what makes it immune to DST;
 *   3. `shiftDateKey()` — LOCAL date arithmetic (`new Date(y, m, d)` +
 *      `setDate`), which is what produces the cutoff the summary card prints.
 *
 * If (1) and (3) ever disagree with (2), the fridge tells the user about the
 * wrong day: an item bucketed `expired` while its own label still reads
 * "Expires today", or a cutoff date printed on the card that does not match the
 * rows underneath it. Every boundary below is one instant either side of a
 * transition, because a bucket that is right in the middle of a week and wrong
 * at midnight is exactly the bug a fixture-at-noon suite cannot see.
 */

import {
  daysUntil,
  EXPIRING_SOON_DAYS,
  expiringWithin,
  expiryBucketOf,
  EXPIRY_BUCKET_HINTS,
  EXPIRY_BUCKET_LABELS,
  EXPIRY_QUICK_PICKS,
  formatExpiry,
  formatQuantity,
  groupByExpiry,
  quickPickDate,
  summarizeFridge,
  type FridgeItem,
} from '../../healthFridgeStorage';
import { todayDateKey } from '../../healthLocalStorage';

// The store module reaches the network through this client; every assertion in
// this file is pure, so the module is stubbed rather than exercised.
jest.mock('@api/healthFridge');

const ISO = '2026-07-13T08:00:00.000Z';

function item(over: Partial<FridgeItem> = {}): FridgeItem {
  return {
    id: 'fr_1',
    name: 'Milk',
    quantity: 1,
    unit: 'L',
    category: 'Dairy',
    expiryDate: '2026-07-15',
    isFavorite: false,
    notes: '',
    source: 'manual',
    nutrition: null,
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  };
}

/**
 * NOTE ON ZONES. These specs cannot pin the runner to Kiritimati and Honolulu
 * and compare: Jest's sandbox hands the test a COPY of `process.env`, so
 * assigning `TZ` never reaches Node's timezone-change notification and the ICU
 * cache keeps the machine's own zone. Everything below is therefore written as
 * a zone-INDEPENDENT invariant — a straddling instant derived from whatever
 * offset the runner actually has, and a year-long sweep that necessarily
 * crosses that zone's own DST transitions. Both fail on a UTC-derived day in
 * every zone except UTC itself, which is the strongest honest statement
 * available in-process.
 */

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* The day the device is on                                            */
/* ------------------------------------------------------------------ */

describe('fridge — which clock decides "today"', () => {
  it('HEALTH-FRIDGE-201: a same-day item is "today" at 00:00:00.000 and at 23:59:59.999', () => {
    // Both ends of the day, not a comfortable noon. `todayDateKey()` builds the
    // key from LOCAL parts, so an off-by-one hour anywhere in that chain shows
    // up here and nowhere else — and "use today" is the single most actionable
    // thing this screen says.
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 13, 0, 0, 0, 0));
    expect(todayDateKey()).toBe('2026-07-13');
    expect(expiryBucketOf('2026-07-13')).toBe('today');
    expect(formatExpiry('2026-07-13')).toBe('Expires today');

    jest.setSystemTime(new Date(2026, 6, 13, 23, 59, 59, 999));
    expect(todayDateKey()).toBe('2026-07-13');
    expect(expiryBucketOf('2026-07-13')).toBe('today');
    expect(formatExpiry('2026-07-13')).toBe('Expires today');
  });

  it('HEALTH-FRIDGE-202: one millisecond past midnight the same row is EXPIRED', () => {
    // The rollover is the whole point: an item does not stop being food at
    // midnight, but it does stop being "use today". Reading "Expires today" on
    // the morning after is the donor bug this bucketing replaced.
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 13, 23, 59, 59, 999));
    expect(expiryBucketOf('2026-07-13')).toBe('today');

    jest.setSystemTime(new Date(2026, 6, 14, 0, 0, 0, 0));
    expect(todayDateKey()).toBe('2026-07-14');
    expect(expiryBucketOf('2026-07-13')).toBe('expired');
    expect(formatExpiry('2026-07-13')).toBe('Expired yesterday');
    // …and the row that WAS "tomorrow" is now the urgent one.
    expect(expiryBucketOf('2026-07-14')).toBe('today');
  });

  it('HEALTH-FRIDGE-203: the day is the DEVICE local day, not the UTC day', () => {
    // A STRADDLING instant, derived from the runner's own offset: west of
    // Greenwich local 23:00 is already tomorrow in UTC; east of it local 00:30
    // is still yesterday. Either way the fridge must answer with the LOCAL day —
    // that is why `loadExpiringSoon(days, today)` sends the client's own key
    // instead of letting the Worker default to UTC.
    const offsetMinutes = new Date(2026, 6, 13, 12, 0, 0).getTimezoneOffset();
    const straddling =
      offsetMinutes > 0
        ? new Date(2026, 6, 13, 23, 0, 0) // west → UTC has rolled to the 14th
        : new Date(2026, 6, 13, 0, 30, 0); // east → UTC is still the 12th
    jest.useFakeTimers().setSystemTime(straddling);

    expect(todayDateKey()).toBe('2026-07-13');
    expect(expiryBucketOf('2026-07-13')).toBe('today');
    expect(summarizeFridge([]).cutoff).toBe('2026-07-20');

    // On any runner that is not exactly UTC the two clocks really do disagree
    // at this instant — and THAT is the case a UTC-derived day gets wrong: it
    // would bucket today's food as expired (west) or as still to come (east).
    if (offsetMinutes !== 0) {
      const utcDay = straddling.toISOString().slice(0, 10);
      expect(utcDay).not.toBe('2026-07-13');
      expect(expiryBucketOf(utcDay)).not.toBe('today');
    }
  });

  it('HEALTH-FRIDGE-204: every defaulted helper crosses midnight together', () => {
    // The screen calls `todayDateKey()` once and passes it down, but the STORE
    // helpers each default independently. If any of them captured the day at
    // module load — or read a different clock — the card's cutoff would keep
    // pointing at yesterday's window while the rows underneath had moved on.
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 13, 23, 59, 59, 999));
    const before = {
      today: todayDateKey(),
      cutoff: summarizeFridge([]).cutoff,
      pick: quickPickDate(EXPIRING_SOON_DAYS),
      group: groupByExpiry([item({ expiryDate: '2026-07-13' })])[0].bucket,
    };
    expect(before).toEqual({
      today: '2026-07-13',
      cutoff: '2026-07-20',
      pick: '2026-07-20',
      group: 'today',
    });

    jest.setSystemTime(new Date(2026, 6, 14, 0, 0, 0, 0));
    expect({
      today: todayDateKey(),
      cutoff: summarizeFridge([]).cutoff,
      pick: quickPickDate(EXPIRING_SOON_DAYS),
      group: groupByExpiry([item({ expiryDate: '2026-07-13' })])[0].bucket,
    }).toEqual({
      today: '2026-07-14',
      cutoff: '2026-07-21',
      pick: '2026-07-21',
      group: 'expired',
    });
  });
});

/* ------------------------------------------------------------------ */
/* Every bucket edge                                                   */
/* ------------------------------------------------------------------ */

describe('fridge — bucket edges', () => {
  const TODAY = '2026-07-13';

  it('HEALTH-FRIDGE-205: each boundary is asserted on BOTH sides', () => {
    // -1 / 0 is the expired↔today edge, 0 / 1 the today↔week edge, 7 / 8 the
    // week↔later edge. A `<` written as `<=` anywhere in `expiryBucketOf` moves
    // exactly one of these and nothing else.
    const cases: Array<[string, string]> = [
      ['2026-07-11', 'expired'],
      ['2026-07-12', 'expired'],
      ['2026-07-13', 'today'],
      ['2026-07-14', 'week'],
      ['2026-07-19', 'week'],
      ['2026-07-20', 'week'], // exactly EXPIRING_SOON_DAYS out — still "week"
      ['2026-07-21', 'later'], // one day further — the first "later"
      ['2027-07-13', 'later'],
    ];
    for (const [date, bucket] of cases) {
      expect([date, expiryBucketOf(date, TODAY)]).toEqual([date, bucket]);
    }
    expect(expiryBucketOf(null, TODAY)).toBe('undated');
    expect(expiryBucketOf('', TODAY)).toBe('undated'); // falsy, not a parse
  });

  it('HEALTH-FRIDGE-206: day counting crosses months, years and a leap day', () => {
    // Every one of these is a place a hand-rolled `date + n` gets it wrong.
    expect(daysUntil('2026-08-01', '2026-07-31')).toBe(1);
    expect(daysUntil('2026-07-31', '2026-08-01')).toBe(-1);
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1);
    expect(daysUntil('2026-12-31', '2027-01-01')).toBe(-1);
    // 2028 is a leap year: 28 Feb → 29 Feb → 1 Mar is two days, not one.
    expect(daysUntil('2028-03-01', '2028-02-28')).toBe(2);
    // 2027 is not: 28 Feb → 1 Mar is one day.
    expect(daysUntil('2027-03-01', '2027-02-28')).toBe(1);
    expect(daysUntil('2026-07-13', '2026-07-13')).toBe(0);
  });

  it('HEALTH-FRIDGE-207: the LOCAL cutoff and the UTC day count never disagree, on any day of the year', () => {
    // Two different mechanisms decide the same fact. `quickPickDate` →
    // `shiftDateKey` is LOCAL calendar arithmetic (`new Date(y, m, d)` +
    // `setDate`); `daysUntil` re-parses both keys at `T00:00:00Z`. A 23- or
    // 25-hour day is exactly where a naive divide-by-86,400,000 drifts to
    // 0.958… / 1.041… and a boundary row falls out of the window.
    //
    // The runner's zone cannot be reassigned in-process (see the note at the
    // top), so instead of picking one country's transition dates this sweeps a
    // WHOLE YEAR: whatever zone the runner is in, its own DST transitions are
    // inside this range, and so are every month end and the year boundary.
    const spans = [0, 1, 3, 7, 14, 30];
    const disagreements: string[] = [];
    let cursor = '2026-01-01';
    for (let i = 0; i < 366; i += 1) {
      for (const span of spans) {
        const target = quickPickDate(span, cursor) as string;
        if (daysUntil(target, cursor) !== span) {
          disagreements.push(`${cursor} +${span} → ${target}`);
        }
      }
      cursor = quickPickDate(1, cursor) as string;
    }
    expect(disagreements).toEqual([]);
    // The sweep really did walk a year, so the emptiness above is not vacuous.
    expect(cursor).toBe('2027-01-02');
  });

  it('HEALTH-FRIDGE-208: a row dated exactly ON the printed cutoff is always inside the window', () => {
    // The card promises "everything dated on or before <cutoff>". Because the
    // cutoff is produced by one mechanism (local `shiftDateKey`) and the rows
    // are compared with a plain string `<=`, a single off-by-one day anywhere
    // in the year would make the sentence a lie on that day only.
    const misses: string[] = [];
    let cursor = '2026-01-01';
    for (let i = 0; i < 366; i += 1) {
      const cutoff = summarizeFridge([], cursor).cutoff;
      const onCutoff = item({ id: 'edge', expiryDate: cutoff });
      const dayAfter = item({ id: 'over', expiryDate: quickPickDate(1, cutoff) as string });
      const ids = expiringWithin([onCutoff, dayAfter], EXPIRING_SOON_DAYS, cursor).map((i2) => i2.id);
      if (ids.join(',') !== 'edge') misses.push(`${cursor} → [${ids.join(',')}]`);
      cursor = quickPickDate(1, cursor) as string;
    }
    expect(misses).toEqual([]);
  });

  it('HEALTH-FRIDGE-209: the expiring window is inclusive at the cutoff and exclusive one day later', () => {
    const stock = [
      item({ id: 'ancient', expiryDate: '2020-01-01' }),
      item({ id: 'yesterday', expiryDate: '2026-07-12' }),
      item({ id: 'today', expiryDate: '2026-07-13' }),
      item({ id: 'cutoff', expiryDate: '2026-07-20' }),
      item({ id: 'cutoff+1', expiryDate: '2026-07-21' }),
      item({ id: 'undated', expiryDate: null }),
    ];

    expect(expiringWithin(stock, 7, TODAY).map((i) => i.id)).toEqual([
      'ancient',
      'yesterday',
      'today',
      'cutoff',
    ]);
    // N = 0 keeps only what is already due; the day-after is never in scope.
    expect(expiringWithin(stock, 0, TODAY).map((i) => i.id)).toEqual([
      'ancient',
      'yesterday',
      'today',
    ]);
    // A ten-year horizon still refuses the undated row — it is not "far away",
    // it is unknown, and the deployed SQL says `expiry_date IS NOT NULL`.
    expect(expiringWithin(stock, 3650, TODAY).map((i) => i.id)).not.toContain('undated');
    expect(expiringWithin(stock, 3650, TODAY)).toHaveLength(5);
  });

  it('HEALTH-FRIDGE-210: the summary and the groups agree at every edge', () => {
    // Two independent counters over the same stock. The card's numbers and the
    // group headers are read on the SAME screen, so a disagreement is visible
    // to the user before it is visible to anyone reading the code.
    const stock = [
      item({ id: 'exp', expiryDate: '2026-07-12' }),
      item({ id: 'now', expiryDate: '2026-07-13' }),
      item({ id: 'edge', expiryDate: '2026-07-20' }),
      item({ id: 'over', expiryDate: '2026-07-21' }),
      item({ id: 'none', expiryDate: null }),
    ];
    const summary = summarizeFridge(stock, TODAY);
    const groups = groupByExpiry(stock, TODAY);
    const sizeOf = (bucket: string) =>
      groups.find((g) => g.bucket === bucket)?.items.length ?? 0;

    expect([summary.expired, summary.dueToday, summary.dueThisWeek, summary.undated]).toEqual([
      1, 1, 1, 1,
    ]);
    expect([sizeOf('expired'), sizeOf('today'), sizeOf('week'), sizeOf('later'), sizeOf('undated')])
      .toEqual([1, 1, 1, 1, 1]);
    expect(summary.expiringSoon).toBe(expiringWithin(stock, EXPIRING_SOON_DAYS, TODAY).length);
    expect(summary.total).toBe(5);
    // Every rendered group carries the label and hint the screen prints.
    for (const group of groups) {
      expect(group.label).toBe(EXPIRY_BUCKET_LABELS[group.bucket]);
      expect(group.hint).toBe(EXPIRY_BUCKET_HINTS[group.bucket]);
    }
  });

  it('HEALTH-FRIDGE-211: expiry copy changes wording exactly where the bucket does', () => {
    const say = (date: string) => formatExpiry(date, TODAY);
    expect(say('2026-07-11')).toBe('Expired 2 days ago');
    expect(say('2026-07-12')).toBe('Expired yesterday');
    expect(say('2026-07-13')).toBe('Expires today');
    expect(say('2026-07-14')).toBe('Expires tomorrow');
    expect(say('2026-07-15')).toBe('Expires in 2 days');
    // The last relative day, then the first absolute one. Past a week the exact
    // date is the useful fact; "in 23 days" is arithmetic the reader has to
    // redo against a calendar.
    expect(say('2026-07-20')).toBe('Expires in 7 days');
    expect(say('2026-07-21')).toBe('Expires 2026-07-21');
    // …and the long past stays plural rather than degrading to a raw number.
    expect(say('2020-01-01')).toBe('Expired 2385 days ago');
  });

  it('HEALTH-FRIDGE-212: every quick pick resolves to a date in its own bucket', () => {
    // The picks are the only date arithmetic a user can perform on this screen
    // (and the only one Maestro can drive). A pick that landed in the wrong
    // bucket would make "3 days" file something under Later.
    const expected: Record<string, string> = {
      today: 'today',
      '3d': 'week',
      '7d': 'week',
      '14d': 'later',
      '30d': 'later',
    };
    for (const pick of EXPIRY_QUICK_PICKS) {
      const date = quickPickDate(pick.days, TODAY);
      if (pick.days === null) {
        expect([pick.id, date]).toEqual(['none', null]);
        expect(expiryBucketOf(date, TODAY)).toBe('undated');
        continue;
      }
      expect(daysUntil(date as string, TODAY)).toBe(pick.days);
      expect([pick.id, expiryBucketOf(date, TODAY)]).toEqual([pick.id, expected[pick.id]]);
    }
  });

  it('HEALTH-FRIDGE-213: quantity rendering never invents precision it does not have', () => {
    // The parser keeps two decimals; the formatter prints one. That is a
    // deliberate display rounding, not a data loss — but it is worth pinning,
    // because a row stored as 2.57 renders "2.6" and a reader comparing the two
    // would otherwise file a bug against the wrong layer.
    expect(formatQuantity(2.57, 'kg')).toBe('2.6 kg');
    expect(formatQuantity(0.04, 'kg')).toBe('0.0 kg');
    expect(formatQuantity(1_000_000, 'g')).toBe('1000000 g');
    expect(formatQuantity(0, null)).toBe('0');
    // Neither of these can come from the form, but both can come from a cached
    // row written by an older build — and `NaN pc` on a fridge row is worse
    // than saying nothing.
    expect(formatQuantity(Number.NaN, 'pc')).toBe('');
    expect(formatQuantity(Number.POSITIVE_INFINITY, 'pc')).toBe('');
  });
});
