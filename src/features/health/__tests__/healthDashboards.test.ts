/**
 * Symply Health — dashboard derivation maths.
 *
 * Every figure the two chart dashboards render is computed by a pure function
 * in `../healthDashboards.ts`, and every one of them is pinned here against a
 * hand-computed expectation rather than against whatever the implementation
 * happens to return. These numbers are read by a member as meaningful, so a
 * silent drift is a correctness bug, not a cosmetic one.
 *
 * The five invariants that earned their own cases:
 *   · a weight axis never mixes kg and lb          (HEALTH-DASH-020..023)
 *   · an axis is labelled by DATE, never row index (HEALTH-DASH-014, 041)
 *   · an empty range is empty, not a zero series   (HEALTH-DASH-001, 030, 060)
 *   · averages divide by LOGGED days only          (HEALTH-DASH-011, 033)
 *   · rounded shares still total exactly 100       (HEALTH-DASH-050..054)
 */

import { heatmapWeekStart } from '@components/ui/CalendarHeatmap';

import {
  calorieBars,
  caloriesVsTarget,
  healthChartPalette,
  labelEveryFor,
  loggingConsistency,
  macroSplit,
  movingAverage,
  summarizeConsistency,
  tallyDays,
  weeklyAverages,
  weeklyBars,
  weeklyMacroSplits,
  weightDailyValues,
  weightExtremes,
  MACRO_KCAL_PER_GRAM,
  MAX_AXIS_LABELS,
} from '../healthDashboards';
import { type WeightEntry } from '../healthLocalStorage';
import { type MealEntry, type NutritionTotals } from '../healthNutritionStorage';
import { buildWeightSeries, formatAxisDate } from '../healthTrends';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** `2026-07-13` is a Monday, so `2026-07-12` closes the previous week. */
const MONDAY = '2026-07-13';

function days(from: string, count: number): string[] {
  const [y, m, d] = from.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    return date.toISOString().slice(0, 10);
  });
}

function meal(over: Partial<MealEntry> = {}): MealEntry {
  return {
    id: over.id ?? `m-${over.date ?? MONDAY}-${over.calories ?? 0}`,
    date: over.date ?? MONDAY,
    slot: over.slot ?? 'lunch',
    name: over.name ?? 'Soup',
    calories: over.calories ?? 500,
    protein: over.protein ?? 0,
    carbs: over.carbs ?? 0,
    fat: over.fat ?? 0,
    loggedAt: over.loggedAt ?? `${over.date ?? MONDAY}T10:00:00.000Z`,
  };
}

/** Local noon keeps `dateKeyOf` on the intended calendar day in any timezone. */
function weight(date: string, value: number, unit: WeightEntry['unit'] = 'kg'): WeightEntry {
  const [y, m, d] = date.split('-').map(Number);
  return {
    id: `${date}-${value}`,
    value,
    unit,
    loggedAt: new Date(y, m - 1, d, 12, 0, 0).toISOString(),
    date,
    note: '',
    source: 'manual',
  };
}

function totals(over: Partial<NutritionTotals> = {}): NutritionTotals {
  return {
    calories: over.calories ?? 0,
    protein: over.protein ?? 0,
    carbs: over.carbs ?? 0,
    fat: over.fat ?? 0,
  };
}

const points = (values: number[]) => values.map((value) => ({ value }));
const valuesOf = (series: Array<{ value: number }>) => series.map((p) => p.value);

/* ------------------------------------------------------------------ */
/* movingAverage                                                       */
/* ------------------------------------------------------------------ */

describe('movingAverage', () => {
  it('HEALTH-DASH-001: an empty series stays empty — never a zero-filled line', () => {
    expect(movingAverage([], 7)).toEqual([]);
  });

  it('HEALTH-DASH-002: a single point averages to itself', () => {
    expect(movingAverage(points([82]), 7)).toEqual([{ value: 82, label: undefined }]);
  });

  it('HEALTH-DASH-003: is TRAILING — the window shrinks at the head, it does not look ahead', () => {
    // Trailing 3: [10] → 10 · [10,20] → 15 · [10,20,30] → 20 · [20,30,40] → 30.
    // A CENTRED 3-window would give [—, 20, 30, —] and either drop the newest
    // point or revise it tomorrow; neither is acceptable on a weight chart.
    expect(valuesOf(movingAverage(points([10, 20, 30, 40]), 3))).toEqual([10, 15, 20, 30]);
  });

  it('HEALTH-DASH-004: the newest point is final — appending a day never revises it', () => {
    const before = movingAverage(points([70, 72, 74]), 3);
    const after = movingAverage(points([70, 72, 74, 90]), 3);
    // Every previously drawn point is byte-identical after new data lands.
    expect(valuesOf(after).slice(0, 3)).toEqual(valuesOf(before));
  });

  it('HEALTH-DASH-005: a window larger than the series degrades to a running mean', () => {
    expect(valuesOf(movingAverage(points([10, 20, 30]), 99))).toEqual([10, 15, 20]);
    expect(movingAverage(points([10, 20, 30]), 99)).toHaveLength(3);
  });

  it('HEALTH-DASH-006: output length always equals input length, so data2 stays aligned', () => {
    for (const window of [1, 2, 7, 30, 1000]) {
      expect(movingAverage(points([1, 2, 3, 4, 5]), window)).toHaveLength(5);
    }
  });

  it('HEALTH-DASH-007: a window below 1 or non-finite falls back to the raw series', () => {
    expect(valuesOf(movingAverage(points([10, 20, 30]), 0))).toEqual([10, 20, 30]);
    expect(valuesOf(movingAverage(points([10, 20, 30]), -5))).toEqual([10, 20, 30]);
    expect(valuesOf(movingAverage(points([10, 20, 30]), Number.NaN))).toEqual([10, 20, 30]);
  });

  it('HEALTH-DASH-008: fractional windows floor, so 7.9 is a 7-day average', () => {
    expect(valuesOf(movingAverage(points([10, 20, 30, 40]), 3.9))).toEqual([10, 15, 20, 30]);
  });

  it('HEALTH-DASH-009: date labels are carried through so the x-axis stays date-labelled', () => {
    const labelled = [
      { value: 10, label: '6 Jul' },
      { value: 20, label: undefined },
      { value: 30, label: '8 Jul' },
    ];
    expect(movingAverage(labelled, 2).map((p) => p.label)).toEqual(['6 Jul', undefined, '8 Jul']);
  });

  it('HEALTH-DASH-010: a non-finite reading is skipped, not spread across the window', () => {
    const dirty = [{ value: 10 }, { value: Number.NaN }, { value: 30 }];
    expect(valuesOf(movingAverage(dirty, 3))).toEqual([10, 10, 20]);
    // A window containing nothing finite falls back to 0 rather than NaN.
    expect(valuesOf(movingAverage([{ value: Number.NaN }], 3))).toEqual([0]);
  });

  it('HEALTH-DASH-011: rounds to one decimal, matching how weight is displayed', () => {
    expect(valuesOf(movingAverage(points([80, 81, 81]), 3))).toEqual([80, 80.5, 80.7]);
  });
});

/* ------------------------------------------------------------------ */
/* labelEveryFor                                                       */
/* ------------------------------------------------------------------ */

describe('labelEveryFor', () => {
  it('HEALTH-DASH-014: thins only past the cap, and reports how much it thinned', () => {
    expect(labelEveryFor(0)).toBe(1);
    expect(labelEveryFor(8)).toBe(1); // exactly at the cap — no thinning
    expect(labelEveryFor(9)).toBe(2);
    expect(labelEveryFor(20)).toBe(3); // the 20-entry case the screen suite pins
    expect(labelEveryFor(90)).toBe(12);
    expect(MAX_AXIS_LABELS).toBe(8);
  });

  it('HEALTH-DASH-015: a nonsense count or cap never divides by zero', () => {
    expect(labelEveryFor(Number.NaN)).toBe(1);
    expect(labelEveryFor(-4)).toBe(1);
    expect(labelEveryFor(10, 0)).toBe(2);
    expect(labelEveryFor(10, Number.NaN)).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Weekly aggregation                                                  */
/* ------------------------------------------------------------------ */

describe('weeklyAverages / weeklyBars', () => {
  it('HEALTH-DASH-016: an empty range yields no weeks', () => {
    expect(weeklyAverages([])).toEqual([]);
    expect(weeklyBars([])).toEqual([]);
  });

  it('HEALTH-DASH-017: buckets on Monday, the same boundary the heatmap uses', () => {
    const result = weeklyAverages([
      { date: '2026-07-12', value: 80 }, // Sunday — closes the 6 Jul week
      { date: '2026-07-13', value: 90 }, // Monday — opens a new week
    ]);
    expect(result).toEqual([
      { weekStart: '2026-07-06', average: 80, days: 1 },
      { weekStart: '2026-07-13', average: 90, days: 1 },
    ]);
    expect(heatmapWeekStart('2026-07-12')).toBe('2026-07-06');
  });

  it('HEALTH-DASH-018: divides by the days LOGGED that week, never by seven', () => {
    const [week] = weeklyAverages([
      { date: '2026-07-13', value: 80 },
      { date: '2026-07-14', value: 90 },
    ]);
    // 170 / 2 logged days = 85. Dividing by 7 would report 24.3.
    expect(week).toEqual({ weekStart: '2026-07-13', average: 85, days: 2 });
  });

  it('HEALTH-DASH-019: skips malformed rows instead of opening a phantom week', () => {
    // `heatmapWeekStart` hands back an unparseable key UNCHANGED, so without a
    // date guard each of these would open its own bucket and sort to the front.
    const result = weeklyAverages([
      { date: '2026-07-13', value: 80 },
      { date: '2026-07-14', value: Number.NaN },
      { date: '', value: 10 },
      { date: 'yesterday', value: 10 },
      { date: '2026-02-30', value: 10 }, // valid shape, impossible day
    ]);
    expect(result).toEqual([{ weekStart: '2026-07-13', average: 80, days: 1 }]);
  });

  it('HEALTH-DASH-020: bars are labelled by the week-commencing DATE, never a bar index', () => {
    const bars = weeklyBars(weeklyAverages([{ date: '2026-07-06', value: 80 }]));
    expect(bars).toEqual([{ value: 80, label: formatAxisDate('2026-07-06') }]);
    expect(bars[0].label).toBe('6 Jul');
    expect(bars[0].label).not.toMatch(/^#?\d+$/); // never "1" or "#1"
  });

  it('HEALTH-DASH-021: thinned bars drop the label to empty, never to a positional number', () => {
    const weeks = Array.from({ length: 10 }, (_, i) => ({
      weekStart: days('2026-01-05', 70)[i * 7],
      average: 80 + i,
      days: 7,
    }));
    const bars = weeklyBars(weeks);
    expect(labelEveryFor(10)).toBe(2);
    expect(bars.map((b) => b.label !== '')).toEqual([
      true, false, true, false, true, false, true, false, true, false,
    ]);
    expect(bars.filter((b) => b.label !== '')).toHaveLength(5);
  });
});

/* ------------------------------------------------------------------ */
/* Weight                                                              */
/* ------------------------------------------------------------------ */

describe('weightDailyValues / weightExtremes', () => {
  const window = days('2026-07-06', 8); // 6 Jul .. 13 Jul

  it('HEALTH-DASH-022: an empty log has no values and no unit', () => {
    expect(weightDailyValues([], window)).toEqual({ values: [], unit: null });
    expect(weightExtremes([])).toEqual({ min: null, max: null });
  });

  it('HEALTH-DASH-023: plots ONLY the latest unit — a kg/lb mix never shares an axis', () => {
    // Newest entry is kg, so the lb readings are excluded rather than converted:
    // converting would invent a precision the member never typed, and plotting
    // both would draw a 2.2x cliff that never happened.
    const { values, unit } = weightDailyValues(
      [
        weight('2026-07-13', 80, 'kg'),
        weight('2026-07-12', 178, 'lb'),
        weight('2026-07-11', 179, 'lb'),
        weight('2026-07-10', 81, 'kg'),
      ],
      window
    );
    expect(unit).toBe('kg');
    expect(values).toEqual([
      { date: '2026-07-10', value: 81 },
      { date: '2026-07-13', value: 80 },
    ]);
    expect(valuesOf(values)).not.toContain(178);
  });

  it('HEALTH-DASH-024: the same rule holds when the newest entry is in pounds', () => {
    const { values, unit } = weightDailyValues(
      [weight('2026-07-13', 178, 'lb'), weight('2026-07-12', 80, 'kg')],
      window
    );
    expect(unit).toBe('lb');
    expect(values).toEqual([{ date: '2026-07-13', value: 178 }]);
  });

  it('HEALTH-DASH-025: the newest reading wins within a day, and out-of-range is dropped', () => {
    const { values } = weightDailyValues(
      [
        weight('2026-07-13', 79),
        { ...weight('2026-07-13', 81), id: 'early' },
        weight('2026-01-01', 99),
      ],
      window
    );
    expect(values).toEqual([{ date: '2026-07-13', value: 79 }]);
  });

  it('HEALTH-DASH-026: values match buildWeightSeries exactly — the two cannot drift', () => {
    const entries = [
      weight('2026-07-13', 79),
      weight('2026-07-12', 178, 'lb'),
      weight('2026-07-11', 81),
      weight('2026-07-08', 82.5),
    ];
    const daily = weightDailyValues(entries, window);
    const series = buildWeightSeries(entries, window);
    expect(valuesOf(daily.values)).toEqual(valuesOf(series.points));
    expect(daily.unit).toBe(series.unit);
  });

  it('HEALTH-DASH-027: extremes report the lightest and heaviest plotted reading', () => {
    expect(weightExtremes(points([81, 79, 83, 80]))).toEqual({ min: 79, max: 83 });
    expect(weightExtremes(points([80]))).toEqual({ min: 80, max: 80 });
    expect(weightExtremes([{ value: 80 }, { value: Number.NaN }])).toEqual({ min: 80, max: 80 });
  });
});

/* ------------------------------------------------------------------ */
/* Calories vs target                                                  */
/* ------------------------------------------------------------------ */

describe('caloriesVsTarget', () => {
  const window = days('2026-07-06', 8);

  it('HEALTH-DASH-030: an empty range reports nothing logged, not a zero-calorie day', () => {
    const result = caloriesVsTarget([], 2000, window);
    expect(result.days).toEqual([]);
    expect(result.daysLogged).toBe(0);
    expect(result.daysOnTarget).toBe(0);
    expect(result.averageCalories).toBe(0);
    expect(result.best).toBeNull();
    expect(result.worst).toBeNull();
  });

  it('HEALTH-DASH-031: totals each day and scores it against the target', () => {
    const result = caloriesVsTarget(
      [
        meal({ date: '2026-07-10', calories: 900 }),
        meal({ date: '2026-07-10', calories: 800, id: 'b' }),
        meal({ date: '2026-07-11', calories: 2400 }),
      ],
      2000,
      window
    );
    expect(result.days).toEqual([
      { date: '2026-07-10', calories: 1700, delta: -300, onTarget: true },
      { date: '2026-07-11', calories: 2400, delta: 400, onTarget: false },
    ]);
    expect(result.daysOnTarget).toBe(1);
  });

  it('HEALTH-DASH-032: a day exactly on the target counts as on target', () => {
    const result = caloriesVsTarget([meal({ calories: 2000 })], 2000, window);
    expect(result.days[0]).toEqual({ date: MONDAY, calories: 2000, delta: 0, onTarget: true });
    expect(result.daysOnTarget).toBe(1);
  });

  it('HEALTH-DASH-033: the average divides by LOGGED days, not by the window width', () => {
    const result = caloriesVsTarget(
      [meal({ date: '2026-07-10', calories: 1000 }), meal({ date: '2026-07-11', calories: 2000 })],
      2000,
      window // eight days wide, two of them logged
    );
    // 3000 / 2 logged days = 1500. Dividing by the 8-day window gives 375.
    expect(result.averageCalories).toBe(1500);
    expect(result.daysLogged).toBe(2);
    expect(window).toHaveLength(8);
  });

  it('HEALTH-DASH-034: best/worst are closest to and furthest from the target, either side', () => {
    const result = caloriesVsTarget(
      [
        meal({ date: '2026-07-09', calories: 400 }), // 1600 UNDER — the worst miss
        meal({ date: '2026-07-10', calories: 1950 }), // 50 under — the best day
        meal({ date: '2026-07-11', calories: 2300 }), // 300 over
      ],
      2000,
      window
    );
    expect(result.best?.date).toBe('2026-07-10');
    // Ranking by raw intake would crown the 400 kcal day; under-eating is a miss too.
    expect(result.worst?.date).toBe('2026-07-09');
    expect(result.worst?.calories).toBe(400);
  });

  it('HEALTH-DASH-035: ties resolve to the earliest day, so the figure is stable', () => {
    const result = caloriesVsTarget(
      [
        meal({ date: '2026-07-10', calories: 2100 }),
        meal({ date: '2026-07-11', calories: 1900 }),
      ],
      2000,
      window
    );
    expect(result.best?.date).toBe('2026-07-10');
    expect(result.worst?.date).toBe('2026-07-10');
  });

  it('HEALTH-DASH-036: with no target set, nothing is scored as on target', () => {
    for (const goal of [0, -100, Number.NaN]) {
      const result = caloriesVsTarget([meal({ calories: 1500 })], goal, window);
      expect(result.goal).toBe(0);
      expect(result.daysOnTarget).toBe(0);
      expect(result.days[0].onTarget).toBe(false);
      expect(result.days[0].delta).toBe(1500);
    }
  });

  it('HEALTH-DASH-037: days come out chronologically and a duplicated key emits once', () => {
    const result = caloriesVsTarget(
      [meal({ date: '2026-07-11', calories: 100 }), meal({ date: '2026-07-09', calories: 200 })],
      2000,
      ['2026-07-09', '2026-07-11', '2026-07-09']
    );
    expect(result.days.map((d) => d.date)).toEqual(['2026-07-09', '2026-07-11']);
  });

  it('HEALTH-DASH-038: meals outside the window are ignored entirely', () => {
    const result = caloriesVsTarget([meal({ date: '2020-01-01', calories: 9999 })], 2000, window);
    expect(result.daysLogged).toBe(0);
  });
});

describe('calorieBars', () => {
  const swatch = { onTarget: '#059669', over: '#EA580C' };

  it('HEALTH-DASH-041: bars carry a DATE label and the over/under fill', () => {
    const { days: rows } = caloriesVsTarget(
      [meal({ date: '2026-07-10', calories: 1500 }), meal({ date: '2026-07-11', calories: 2500 })],
      2000,
      days('2026-07-06', 8)
    );
    expect(calorieBars(rows, swatch)).toEqual([
      { value: 1500, label: '10 Jul', frontColor: swatch.onTarget },
      { value: 2500, label: '11 Jul', frontColor: swatch.over },
    ]);
  });

  it('HEALTH-DASH-042: past the cap the labels thin to empty, never to an index', () => {
    const rows = days('2026-05-01', 30).map((date) => ({
      date,
      calories: 1500,
      delta: -500,
      onTarget: true,
    }));
    const bars = calorieBars(rows, swatch);
    expect(bars).toHaveLength(30);
    expect(bars.filter((b) => b.label !== '')).toHaveLength(8);
    expect(bars[1].label).toBe('');
  });

  it('HEALTH-DASH-043: an empty day list makes no bars', () => {
    expect(calorieBars([], swatch)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Macro split                                                         */
/* ------------------------------------------------------------------ */

describe('macroSplit', () => {
  it('HEALTH-DASH-050: splits by ENERGY, not grams — fat carries 9 kcal a gram', () => {
    // 100 g protein (400) + 100 g carbs (400) + 100 g fat (900) = 1700 kcal.
    // A GRAM split would say 33/33/33; the energy split is 24/24/52.
    expect(macroSplit(totals({ protein: 100, carbs: 100, fat: 100 }))).toEqual({
      protein: 24,
      carbs: 23,
      fat: 53,
    });
    expect(MACRO_KCAL_PER_GRAM).toEqual({ protein: 4, carbs: 4, fat: 9 });
  });

  it('HEALTH-DASH-051: the classic 33.3/33.3/33.3 case still totals 100, not 99', () => {
    // Equal ENERGY from each macro: 90 g protein, 90 g carbs, 40 g fat = 360/360/360.
    const split = macroSplit(totals({ protein: 90, carbs: 90, fat: 40 }));
    expect(split.protein + split.carbs + split.fat).toBe(100);
    // Largest-remainder hands the leftover point to the first slot in the fixed
    // protein → carbs → fat order; three independent roundings would give 33/33/33.
    expect(split).toEqual({ protein: 34, carbs: 33, fat: 33 });
  });

  it('HEALTH-DASH-052: shares total exactly 100 across a wide sweep of real days', () => {
    for (let protein = 0; protein <= 220; protein += 7) {
      for (let carbs = 0; carbs <= 320; carbs += 11) {
        for (const fat of [0, 13, 37, 64, 91]) {
          const split = macroSplit(totals({ protein, carbs, fat }));
          const sum = split.protein + split.carbs + split.fat;
          // Only an all-zero day is allowed to total 0 — see HEALTH-DASH-053.
          expect(sum).toBe(protein + carbs + fat === 0 ? 0 : 100);
          expect(split.protein).toBeGreaterThanOrEqual(0);
          expect(split.carbs).toBeGreaterThanOrEqual(0);
          expect(split.fat).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('HEALTH-DASH-053: a day with nothing logged is 0/0/0, never a fabricated 100', () => {
    expect(macroSplit(totals())).toEqual({ protein: 0, carbs: 0, fat: 0 });
    expect(macroSplit(totals({ calories: 500 }))).toEqual({ protein: 0, carbs: 0, fat: 0 });
  });

  it('HEALTH-DASH-054: negative and non-finite grams are floored, not propagated', () => {
    expect(macroSplit(totals({ protein: -50, carbs: 100, fat: 0 }))).toEqual({
      protein: 0,
      carbs: 100,
      fat: 0,
    });
    const dirty = macroSplit(totals({ protein: Number.NaN, carbs: 50, fat: 50 }));
    expect(dirty.protein + dirty.carbs + dirty.fat).toBe(100);
    expect(dirty.protein).toBe(0);
  });

  it('HEALTH-DASH-055: a single macro takes the whole 100', () => {
    expect(macroSplit(totals({ protein: 120 }))).toEqual({ protein: 100, carbs: 0, fat: 0 });
    expect(macroSplit(totals({ fat: 70 }))).toEqual({ protein: 0, carbs: 0, fat: 100 });
  });
});

describe('weeklyMacroSplits', () => {
  const window = days('2026-07-06', 14);

  it('HEALTH-DASH-056: one entry per Monday week, each totalling 100', () => {
    const result = weeklyMacroSplits(
      [
        meal({ date: '2026-07-12', protein: 100, carbs: 100, fat: 0 }),
        meal({ date: '2026-07-13', protein: 0, carbs: 0, fat: 50, id: 'x' }),
      ],
      window
    );
    expect(result.map((w) => w.weekStart)).toEqual(['2026-07-06', '2026-07-13']);
    expect(result[0].split).toEqual({ protein: 50, carbs: 50, fat: 0 });
    expect(result[1].split).toEqual({ protein: 0, carbs: 0, fat: 100 });
    for (const week of result) {
      expect(week.split.protein + week.split.carbs + week.split.fat).toBe(100);
    }
  });

  it('HEALTH-DASH-057: counts the distinct days logged, and omits untouched weeks', () => {
    const result = weeklyMacroSplits(
      [
        meal({ date: '2026-07-13', protein: 10, id: 'a' }),
        meal({ date: '2026-07-13', protein: 10, id: 'b' }),
        meal({ date: '2026-07-14', protein: 10, id: 'c' }),
      ],
      window
    );
    expect(result).toHaveLength(1); // the 6 Jul week had nothing — it is absent, not 0/0/0
    expect(result[0].days).toBe(2);
  });

  it('HEALTH-DASH-058: an empty range produces no weeks', () => {
    expect(weeklyMacroSplits([], window)).toEqual([]);
    expect(weeklyMacroSplits([meal({ date: '2001-01-01' })], window)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Logging consistency                                                 */
/* ------------------------------------------------------------------ */

describe('tallyDays / loggingConsistency', () => {
  const window = days('2026-07-06', 8);

  it('HEALTH-DASH-060: nothing logged means an empty list, not a row of zeroes', () => {
    expect(tallyDays([])).toEqual({});
    expect(loggingConsistency({}, window)).toEqual([]);
  });

  it('HEALTH-DASH-061: tallies how many things landed on each day', () => {
    expect(tallyDays(['2026-07-10', '2026-07-10', '2026-07-11', null, undefined, ''])).toEqual({
      '2026-07-10': 2,
      '2026-07-11': 1,
    });
  });

  it('HEALTH-DASH-062: the output is SPARSE — an untouched day is absent, not zero', () => {
    const result = loggingConsistency({ '2026-07-10': 3 }, window);
    // Only the logged day is emitted, so CalendarHeatmap can draw the other
    // seven as "no data" outlines rather than as filled zero chips.
    expect(result).toEqual([{ date: '2026-07-10', value: 3 }]);
    expect(result).toHaveLength(1);
  });

  it('HEALTH-DASH-063: an explicit zero survives — logged-nothing is not no-data', () => {
    expect(loggingConsistency({ '2026-07-10': 0 }, window)).toEqual([
      { date: '2026-07-10', value: 0 },
    ]);
  });

  it('HEALTH-DASH-064: days outside the window are dropped and duplicates emit once', () => {
    const result = loggingConsistency(
      { '2026-07-10': 1, '2019-01-01': 9 },
      ['2026-07-10', '2026-07-10', '2026-07-11']
    );
    expect(result).toEqual([{ date: '2026-07-10', value: 1 }]);
  });

  it('HEALTH-DASH-065: values come out oldest-first and negatives/non-finite floor to zero', () => {
    const result = loggingConsistency(
      { '2026-07-12': 1, '2026-07-10': -4, '2026-07-11': Number.NaN },
      window
    );
    expect(result).toEqual([
      { date: '2026-07-10', value: 0 },
      { date: '2026-07-11', value: 0 },
      { date: '2026-07-12', value: 1 },
    ]);
  });
});

describe('summarizeConsistency', () => {
  const window = days('2026-07-06', 8);

  it('HEALTH-DASH-070: an empty window reports zero coverage without dividing by zero', () => {
    expect(summarizeConsistency([], [])).toEqual({
      daysLogged: 0,
      daysInRange: 0,
      rate: 0,
      bestStreak: 0,
    });
  });

  it('HEALTH-DASH-071: counts coverage and the longest unbroken run', () => {
    const values = loggingConsistency(
      { '2026-07-07': 1, '2026-07-08': 2, '2026-07-09': 1, '2026-07-12': 1 },
      window
    );
    expect(summarizeConsistency(values, window)).toEqual({
      daysLogged: 4,
      daysInRange: 8,
      rate: 0.5,
      bestStreak: 3,
    });
  });

  it('HEALTH-DASH-072: a gap breaks the streak, and a full window is a full streak', () => {
    const every = Object.fromEntries(window.map((date) => [date, 1]));
    expect(summarizeConsistency(loggingConsistency(every, window), window)).toMatchObject({
      rate: 1,
      bestStreak: 8,
    });
    const gapped = loggingConsistency({ '2026-07-06': 1, '2026-07-13': 1 }, window);
    expect(summarizeConsistency(gapped, window).bestStreak).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

describe('healthChartPalette', () => {
  it('HEALTH-DASH-080: dark mode is SELECTED, not flipped — only the violet re-steps', () => {
    const light = healthChartPalette(false);
    const dark = healthChartPalette(true);
    // #7C3AED measures 2.99:1 on the dark card, so dark mode takes its own step.
    expect(light.weightAverage).toBe('#7C3AED');
    expect(dark.weightAverage).toBe('#8B5CF6');
    expect(dark.macroFat).toBe(dark.weightAverage);
    // Everything else re-validated unchanged against the dark surface.
    expect(dark.weightDaily).toBe(light.weightDaily);
    expect(dark.caloriesOnTarget).toBe(light.caloriesOnTarget);
    expect(dark.caloriesOver).toBe(light.caloriesOver);
    expect(dark.consistency).toBe(light.consistency);
  });

  it('HEALTH-DASH-081: no two series in one chart share a colour', () => {
    for (const palette of [healthChartPalette(false), healthChartPalette(true)]) {
      expect(palette.weightDaily).not.toBe(palette.weightAverage);
      expect(palette.caloriesOnTarget).not.toBe(palette.caloriesOver);
      const macros = [palette.macroProtein, palette.macroCarbs, palette.macroFat];
      expect(new Set(macros).size).toBe(3);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Missing series                                                      */
/* ------------------------------------------------------------------ */

/**
 * Trends composes ~10 of these builders over four independent stores. Any one
 * of them can hand over `undefined` — an offline read that fell back to a
 * corrupt snapshot, a store that has not resolved yet, a payload whose key the
 * Worker renamed. Every builder already carries a `?? []`; these cases prove
 * the guard actually holds, because until now not one of them was ever taken.
 *
 * The bar is the EMPTY STATE, not "does not throw": a missing series must draw
 * as no data, never as a row of zeroes the member would read as "I logged 0".
 */
describe('healthDashboards — a missing series draws empty, never zeroes', () => {
  const missing = undefined as unknown as never[];

  it('HEALTH-DASH-090: weekly aggregation of a missing series yields no weeks', () => {
    expect(weeklyAverages(missing)).toEqual([]);
    expect(weeklyBars(missing)).toEqual([]);
    expect(weeklyMacroSplits(missing, days(MONDAY, 7))).toEqual([]);
  });

  it('HEALTH-DASH-091: a missing weight series reports no unit rather than crashing', () => {
    // Regression: this read `entries[0]` BEFORE its own `?? []`, so a partial
    // payload threw a TypeError out of the render instead of drawing an empty
    // chart. `unit: null` is what tells the card to print "—" instead of "0 kg".
    expect(weightDailyValues(missing, days(MONDAY, 7))).toEqual({ values: [], unit: null });
    expect(weightExtremes(missing)).toEqual({ min: null, max: null });
  });

  it('HEALTH-DASH-092: missing meals or missing day keys make an empty calorie range', () => {
    expect(caloriesVsTarget(missing, 2000, days(MONDAY, 7)).days).toEqual([]);
    expect(caloriesVsTarget([meal()], 2000, missing).days).toEqual([]);
    expect(calorieBars(missing, { onTarget: '#0a0', over: '#a00' })).toEqual([]);
  });

  it('HEALTH-DASH-093: a missing consistency input reports no coverage, not a zero streak row', () => {
    expect(tallyDays(missing)).toEqual({});
    expect(loggingConsistency({ [MONDAY]: 1 }, missing)).toEqual([]);
    expect(summarizeConsistency(missing, days(MONDAY, 7))).toMatchObject({
      daysLogged: 0,
      daysInRange: 7,
      bestStreak: 0,
      rate: 0,
    });
    // A missing WINDOW must not claim coverage of a range it cannot size, and
    // must not divide by it either.
    expect(summarizeConsistency([{ date: MONDAY, value: 1 }], missing)).toMatchObject({
      daysLogged: 1,
      daysInRange: 0,
      bestStreak: 0,
      rate: 0,
    });
  });
});
