/**
 * Symply Health — the Goals screen's storage layer.
 *
 * `healthGoalsStorage.ts` is mostly PURE (macro math, the suggestion engine,
 * input parsing/validation) plus one piece of real I/O it owns outright — the
 * per-weekday calorie plan — and one aggregator (`loadHealthGoals`) that fans
 * out to loaders four OTHER modules already own and test their own wire
 * contract for. So this file:
 *
 *   - drives the pure functions directly, no mocking;
 *   - drives `loadCalorieWeek` / `saveCalorieWeek` against a mocked
 *     `@api/health` (the one wire contract this module owns);
 *   - drives `loadHealthGoals` against mocked SIBLING loaders, the same way a
 *     screen test would, so this suite is about the AGGREGATION, not a second
 *     copy of each sibling's own wire test.
 */

import { healthApi } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  DEFAULT_ACTIVITY_GOALS,
  loadActivityGoals,
  type ActivityGoals,
} from '../healthActivityStorage';
import {
  ageFor,
  BASELINE_DATE_MESSAGE,
  CALORIE_MAX,
  CALORIE_MIN,
  CALORIE_WEEK_DAYS,
  checkBound,
  copyMacroDayToAll,
  EMPTY_CALORIE_WEEK,
  EMPTY_GOALS_SNAPSHOT,
  EMPTY_MACRO_WEEK,
  GOAL_BOUNDS,
  HEALTH_CALORIE_WEEK_KEY,
  HEALTH_MACRO_WEEK_KEY,
  KCAL_PER_GRAM,
  loadCalorieWeek,
  loadHealthGoals,
  loadMacroWeek,
  MACRO_DIFFERENCE_TOLERANCE,
  MACRO_GRAMS_MAX,
  MACRO_LABELS,
  MACRO_WEEK_DAYS,
  macroSplit,
  missingSuggestionInputs,
  parseDayKey,
  parseWholeNumber,
  rebalanceMacros,
  sanitizeDayKey,
  sanitizeWholeNumber,
  saveCalorieWeek,
  saveMacroWeek,
  seedCalorieWeek,
  seedMacroWeek,
  setEveryCalorieDay,
  STEPS_MAX,
  suggestGoals,
  suggestionInputsFor,
  WATER_CUPS_MAX,
  weekdayIndexOf,
  weeklyAverageCalories,
  WORKOUT_MINUTES_MAX,
  type CalorieWeek,
  type MacroWeek,
  type SuggestionInputs,
} from '../healthGoalsStorage';
import {
  DEFAULT_WATER_TARGET,
  loadHealthPrefs,
  loadWaterToday,
  loadWeightLog,
  type HealthPrefs,
  type WaterDay,
  type WeightEntry,
} from '../healthLocalStorage';
import { DEFAULT_NUTRITION_GOALS, loadNutritionGoals, type NutritionGoals } from '../healthNutritionStorage';
import { __setHealthOfflineForTests, clearHealthCache, healthSyncStateFor } from '../healthRepository';
import { EMPTY_WEIGHT_GOAL, loadWeightGoal, type WeightGoal } from '../healthWeightStorage';
import { fakeGoalServer, ok, type MockedHealthApi } from '../test-utils/healthApiTestKit';

jest.mock('@api/health');

jest.mock('../healthActivityStorage', () => {
  const actual = jest.requireActual('../healthActivityStorage');
  return { ...actual, loadActivityGoals: jest.fn() };
});
jest.mock('../healthNutritionStorage', () => {
  const actual = jest.requireActual('../healthNutritionStorage');
  return { ...actual, loadNutritionGoals: jest.fn() };
});
jest.mock('../healthLocalStorage', () => {
  const actual = jest.requireActual('../healthLocalStorage');
  return {
    ...actual,
    loadHealthPrefs: jest.fn(),
    loadWaterToday: jest.fn(),
    loadWeightLog: jest.fn(),
  };
});
jest.mock('../healthWeightStorage', () => {
  const actual = jest.requireActual('../healthWeightStorage');
  return { ...actual, loadWeightGoal: jest.fn() };
});

const api = healthApi as unknown as MockedHealthApi;

const mockLoadActivityGoals = loadActivityGoals as jest.Mock;
const mockLoadNutritionGoals = loadNutritionGoals as jest.Mock;
const mockLoadHealthPrefs = loadHealthPrefs as jest.Mock;
const mockLoadWaterToday = loadWaterToday as jest.Mock;
const mockLoadWeightLog = loadWeightLog as jest.Mock;
const mockLoadWeightGoal = loadWeightGoal as jest.Mock;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0); // Monday
const TODAY = '2026-07-13';

function nutritionGoals(over: Partial<NutritionGoals> = {}): NutritionGoals {
  return { ...DEFAULT_NUTRITION_GOALS, ...over };
}

function activityGoals(over: Partial<ActivityGoals> = {}): ActivityGoals {
  return { ...DEFAULT_ACTIVITY_GOALS, ...over };
}

function prefs(over: Partial<HealthPrefs> = {}): HealthPrefs {
  return {
    unitSystem: 'metric',
    preferredUnit: 'kg',
    healthKitEnabled: false,
    aiEnabled: false,
    ...over,
  };
}

function waterDay(over: Partial<WaterDay> = {}): WaterDay {
  return { date: TODAY, cups: 3, target: DEFAULT_WATER_TARGET, ...over };
}

function weightGoal(over: Partial<WeightGoal> = {}): WeightGoal {
  return { ...EMPTY_WEIGHT_GOAL, ...over };
}

function weightEntry(over: Partial<WeightEntry> = {}): WeightEntry {
  return {
    id: 'w1',
    value: 70,
    unit: 'kg',
    loggedAt: `${TODAY}T08:00:00.000Z`,
    date: TODAY,
    note: '',
    source: 'manual',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
  __setHealthOfflineForTests(false);
  mockLoadActivityGoals.mockResolvedValue(activityGoals());
  mockLoadNutritionGoals.mockResolvedValue(nutritionGoals());
  mockLoadHealthPrefs.mockResolvedValue(prefs());
  mockLoadWaterToday.mockResolvedValue(waterDay());
  mockLoadWeightLog.mockResolvedValue([]);
  mockLoadWeightGoal.mockResolvedValue(weightGoal());
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

/* ==================================================================== */
/* Per-weekday calorie plan — the field this module owns                */
/* ==================================================================== */

describe('healthGoalsStorage — CALORIE_WEEK_DAYS contract', () => {
  it('HEALTH-GOALS-001: seven days, Monday-first, matching the donor order', () => {
    expect(CALORIE_WEEK_DAYS.map((d) => d.short)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(CALORIE_WEEK_DAYS.map((d) => d.key)).toEqual([
      'monday_calories',
      'tuesday_calories',
      'wednesday_calories',
      'thursday_calories',
      'friday_calories',
      'saturday_calories',
      'sunday_calories',
    ]);
  });

  it('HEALTH-GOALS-002: EMPTY_CALORIE_WEEK is per-day OFF with seven null slots', () => {
    expect(EMPTY_CALORIE_WEEK).toEqual({
      usePerDay: false,
      days: [null, null, null, null, null, null, null],
    });
  });
});

describe('healthGoalsStorage — weekdayIndexOf', () => {
  it('HEALTH-GOALS-003: maps a real week Monday(0)..Sunday(6)', () => {
    const week = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'];
    expect(week.map(weekdayIndexOf)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('healthGoalsStorage — loadCalorieWeek / saveCalorieWeek (own wire)', () => {
  it('HEALTH-GOALS-004: with no goal row saved, reads the empty week', async () => {
    api.getGoal.mockResolvedValue(ok({ goal: null }));
    expect(await loadCalorieWeek()).toEqual(EMPTY_CALORIE_WEEK);
  });

  it('HEALTH-GOALS-005: reads usePerDay and all seven day columns off the shared goal row', async () => {
    fakeGoalServer(api, {
      use_per_day_calories: true,
      monday_calories: 1800,
      tuesday_calories: 1800,
      wednesday_calories: 2200,
      thursday_calories: 1800,
      friday_calories: 1800,
      saturday_calories: 2800,
      sunday_calories: 2800,
    });

    expect(await loadCalorieWeek()).toEqual({
      usePerDay: true,
      days: [1800, 1800, 2200, 1800, 1800, 2800, 2800],
    });
  });

  it('HEALTH-GOALS-006: a day outside the route\'s own bounds reads back as null, not the bad value', async () => {
    fakeGoalServer(api, { monday_calories: 100, tuesday_calories: 99999 });
    const week = await loadCalorieWeek();
    expect(week.days[0]).toBeNull(); // below CALORIE_MIN
    expect(week.days[1]).toBeNull(); // above CALORIE_MAX
  });

  it('HEALTH-GOALS-007: with nothing cached, the offline path falls back to the empty week', async () => {
    api.getGoal.mockRejectedValue(new Error('offline'));
    __setHealthOfflineForTests(true);
    const week = await loadCalorieWeek();
    expect(week.days).toHaveLength(7);
    expect(week.days.every((d) => d === null)).toBe(true);
  });

  it('HEALTH-GOALS-007b: a cached "days" that is not an array pads to seven nulls, not a crash', async () => {
    // A snapshot from an older build, or one hand-edited in dev tools — reading
    // `days[index]` on a non-array must not throw into the screen that renders
    // this on every open.
    await storageHelpers.setObject(HEALTH_CALORIE_WEEK_KEY, {
      usePerDay: true,
      days: 'not-an-array',
    });
    __setHealthOfflineForTests(true);

    const week = await loadCalorieWeek();
    expect(week.usePerDay).toBe(true);
    expect(week.days).toEqual([null, null, null, null, null, null, null]);
  });

  it('HEALTH-GOALS-008: saveCalorieWeek always sends all seven keys, null included', async () => {
    fakeGoalServer(api);
    const week: CalorieWeek = {
      usePerDay: true,
      days: [1800, null, 2200, null, null, 2800, null],
    };
    const saved = await saveCalorieWeek(week);

    expect(api.saveGoal).toHaveBeenCalledWith({
      use_per_day_calories: true,
      monday_calories: 1800,
      tuesday_calories: null,
      wednesday_calories: 2200,
      thursday_calories: null,
      friday_calories: null,
      saturday_calories: 2800,
      sunday_calories: null,
    });
    expect(saved).toEqual(week);
  });

  it('HEALTH-GOALS-009: saveCalorieWeek clamps an out-of-bound day to null before sending', async () => {
    fakeGoalServer(api);
    await saveCalorieWeek({ usePerDay: true, days: [50, 99999, null, null, null, null, null] });

    expect(api.saveGoal).toHaveBeenCalledWith(
      expect.objectContaining({ monday_calories: null, tuesday_calories: null })
    );
  });

  it('HEALTH-GOALS-010: a failed save still returns the optimistic week and marks offline', async () => {
    api.saveGoal.mockRejectedValue(new Error('network down'));
    const saved = await saveCalorieWeek({ usePerDay: true, days: [1800, null, null, null, null, null, null] });

    expect(saved.days[0]).toBe(1800);
    expect(healthSyncStateFor('health.calorieWeek.v1')).toBe('offline');
  });
});

describe('healthGoalsStorage — seedCalorieWeek / setEveryCalorieDay', () => {
  it('HEALTH-GOALS-011: seedCalorieWeek fills only the UNSET days, leaving set ones alone', () => {
    const week: CalorieWeek = { usePerDay: true, days: [1800, null, 2200, null, null, null, null] };
    const seeded = seedCalorieWeek(week, 2000);
    expect(seeded.days).toEqual([1800, 2000, 2200, 2000, 2000, 2000, 2000]);
    expect(seeded.usePerDay).toBe(true);
  });

  it('HEALTH-GOALS-012: seedCalorieWeek seeds nothing (stays null) if the daily figure is itself invalid', () => {
    const week: CalorieWeek = { ...EMPTY_CALORIE_WEEK };
    const seeded = seedCalorieWeek(week, 50); // below CALORIE_MIN
    expect(seeded.days.every((d) => d === null)).toBe(true);
  });

  it('HEALTH-GOALS-013: setEveryCalorieDay overwrites ALL seven, even ones already set', () => {
    const week: CalorieWeek = { usePerDay: true, days: [1800, 1800, 2200, 1800, 1800, 2800, 2800] };
    const next = setEveryCalorieDay(week, 2000);
    expect(next.days).toEqual([2000, 2000, 2000, 2000, 2000, 2000, 2000]);
  });

  it('HEALTH-GOALS-014: setEveryCalorieDay with an invalid value clears every day to null', () => {
    const week: CalorieWeek = { usePerDay: true, days: [1800, 1800, 1800, 1800, 1800, 1800, 1800] };
    const next = setEveryCalorieDay(week, 99999);
    expect(next.days.every((d) => d === null)).toBe(true);
  });
});

describe('healthGoalsStorage — weeklyAverageCalories', () => {
  it('HEALTH-GOALS-015: means the seven days, falling back to the single target for an unset day', () => {
    // Two days at 1800, one at 2200, four unset (fall back to 2000).
    const week: CalorieWeek = { usePerDay: true, days: [1800, 1800, 2200, null, null, null, null] };
    // (1800+1800+2200 + 2000*4) / 7 = (5800 + 8000)/7 = 1971.43 -> 1971
    expect(weeklyAverageCalories(week, 2000)).toBe(1971);
  });

  it('HEALTH-GOALS-016: an all-unset week averages to the single daily target', () => {
    expect(weeklyAverageCalories(EMPTY_CALORIE_WEEK, 2200)).toBe(2200);
  });

  it('HEALTH-GOALS-017: an invalid single target falls back to the app default, not NaN', () => {
    expect(weeklyAverageCalories(EMPTY_CALORIE_WEEK, 0)).toBe(DEFAULT_NUTRITION_GOALS.calories);
  });
});

/* ==================================================================== */
/* Per-weekday macro plan (0139) — protein/carbs/fat sibling of the     */
/* per-weekday calorie plan above                                       */
/* ==================================================================== */

describe('healthGoalsStorage — MACRO_WEEK_DAYS contract', () => {
  it('HEALTH-GOALS-053: seven days, Monday-first, same labels as CALORIE_WEEK_DAYS', () => {
    expect(MACRO_WEEK_DAYS.map((d) => d.short)).toEqual(CALORIE_WEEK_DAYS.map((d) => d.short));
    expect(MACRO_WEEK_DAYS.map((d) => d.label)).toEqual(CALORIE_WEEK_DAYS.map((d) => d.label));
  });

  it('HEALTH-GOALS-054: EMPTY_MACRO_WEEK is per-day OFF with seven null-triple slots', () => {
    expect(EMPTY_MACRO_WEEK).toEqual({
      usePerDay: false,
      days: Array.from({ length: 7 }, () => ({ protein: null, carbs: null, fat: null })),
    });
  });
});

describe('healthGoalsStorage — loadMacroWeek / saveMacroWeek (own wire)', () => {
  it('HEALTH-GOALS-055: with no goal row saved, reads the empty week', async () => {
    api.getGoal.mockResolvedValue(ok({ goal: null }));
    expect(await loadMacroWeek()).toEqual(EMPTY_MACRO_WEEK);
  });

  it('HEALTH-GOALS-056: reads usePerDay and all 21 gram columns off the shared goal row', async () => {
    fakeGoalServer(api, {
      use_per_day_macros: true,
      monday_protein_grams: 220,
      monday_carbs_grams: 150,
      monday_fats_grams: 70,
      sunday_protein_grams: 120,
      sunday_carbs_grams: 250,
      sunday_fats_grams: 60,
    });

    const week = await loadMacroWeek();
    expect(week.usePerDay).toBe(true);
    expect(week.days[0]).toEqual({ protein: 220, carbs: 150, fat: 70 });
    expect(week.days[6]).toEqual({ protein: 120, carbs: 250, fat: 60 });
    // Every day in between was never sent — falls back to "no override".
    expect(week.days[1]).toEqual({ protein: null, carbs: null, fat: null });
  });

  it('HEALTH-GOALS-057: a day outside the route\'s own bounds reads back as null, not the bad value', async () => {
    fakeGoalServer(api, { monday_protein_grams: -5, tuesday_carbs_grams: 99999 });
    const week = await loadMacroWeek();
    expect(week.days[0].protein).toBeNull(); // below 0
    expect(week.days[1].carbs).toBeNull(); // above MACRO_GRAMS_MAX
  });

  it('HEALTH-GOALS-057b: a cached "days" that is not an array pads to seven null-triples, not a crash', async () => {
    await storageHelpers.setObject(HEALTH_MACRO_WEEK_KEY, {
      usePerDay: true,
      days: 'not-an-array',
    });
    __setHealthOfflineForTests(true);

    const week = await loadMacroWeek();
    expect(week.usePerDay).toBe(true);
    expect(week.days).toEqual(Array.from({ length: 7 }, () => ({ protein: null, carbs: null, fat: null })));
  });

  it('HEALTH-GOALS-058: saveMacroWeek always sends all 21 gram keys, null included', async () => {
    fakeGoalServer(api);
    const week: MacroWeek = {
      usePerDay: true,
      days: [
        { protein: 220, carbs: 150, fat: 70 },
        { protein: null, carbs: null, fat: null },
        { protein: null, carbs: null, fat: null },
        { protein: null, carbs: null, fat: null },
        { protein: null, carbs: null, fat: null },
        { protein: null, carbs: null, fat: null },
        { protein: 120, carbs: 250, fat: 60 },
      ],
    };
    const saved = await saveMacroWeek(week);

    expect(api.saveGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        use_per_day_macros: true,
        monday_protein_grams: 220,
        monday_carbs_grams: 150,
        monday_fats_grams: 70,
        tuesday_protein_grams: null,
        sunday_protein_grams: 120,
        sunday_carbs_grams: 250,
        sunday_fats_grams: 60,
      })
    );
    expect(saved).toEqual(week);
  });

  it('HEALTH-GOALS-059: saveMacroWeek clamps an out-of-bound day to null before sending', async () => {
    fakeGoalServer(api);
    await saveMacroWeek({
      usePerDay: true,
      days: [
        { protein: 9999, carbs: -1, fat: 70 },
        ...Array.from({ length: 6 }, () => ({ protein: null, carbs: null, fat: null })),
      ],
    });

    expect(api.saveGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        monday_protein_grams: null,
        monday_carbs_grams: null,
        monday_fats_grams: 70,
      })
    );
  });

  it('HEALTH-GOALS-060: a failed save still returns the optimistic week and marks offline', async () => {
    api.saveGoal.mockRejectedValue(new Error('network down'));
    const week: MacroWeek = {
      usePerDay: true,
      days: [
        { protein: 220, carbs: 150, fat: 70 },
        ...Array.from({ length: 6 }, () => ({ protein: null, carbs: null, fat: null })),
      ],
    };
    const saved = await saveMacroWeek(week);

    expect(saved.days[0]).toEqual({ protein: 220, carbs: 150, fat: 70 });
    expect(healthSyncStateFor('health.macroWeek.v1')).toBe('offline');
  });
});

describe('healthGoalsStorage — seedMacroWeek / copyMacroDayToAll', () => {
  it('HEALTH-GOALS-061: seedMacroWeek fills only the UNSET fields, leaving set ones alone', () => {
    const week: MacroWeek = {
      usePerDay: true,
      days: [
        { protein: 220, carbs: null, fat: null },
        ...Array.from({ length: 6 }, () => ({ protein: null, carbs: null, fat: null })),
      ],
    };
    const seeded = seedMacroWeek(week, { protein: 150, carbs: 200, fat: 70 });
    expect(seeded.days[0]).toEqual({ protein: 220, carbs: 200, fat: 70 });
    expect(seeded.days[1]).toEqual({ protein: 150, carbs: 200, fat: 70 });
    expect(seeded.usePerDay).toBe(true);
  });

  it('HEALTH-GOALS-062: copyMacroDayToAll fans the source day across every day, including itself', () => {
    const week: MacroWeek = {
      usePerDay: true,
      days: [
        { protein: 220, carbs: 150, fat: 70 },
        { protein: 100, carbs: 100, fat: 30 },
        ...Array.from({ length: 5 }, () => ({ protein: null, carbs: null, fat: null })),
      ],
    };
    const next = copyMacroDayToAll(week, 0);
    expect(next.days.every((d) => d.protein === 220 && d.carbs === 150 && d.fat === 70)).toBe(true);
  });

  it('HEALTH-GOALS-062b: copyMacroDayToAll is a no-op for an out-of-range source index', () => {
    const week = seedMacroWeek(EMPTY_MACRO_WEEK, { protein: 150, carbs: 200, fat: 70 });
    expect(copyMacroDayToAll(week, 99)).toEqual(week);
  });
});

/* ==================================================================== */
/* Macros                                                               */
/* ==================================================================== */

describe('healthGoalsStorage — macroSplit', () => {
  it('HEALTH-GOALS-018: sums kcal per macro and expresses each as a share of the calorie target', () => {
    const split = macroSplit(nutritionGoals({ calories: 2000, protein: 150, carbs: 200, fat: 60 }));
    expect(split.calories).toEqual({
      protein: 150 * KCAL_PER_GRAM.protein,
      carbs: 200 * KCAL_PER_GRAM.carbs,
      fat: 60 * KCAL_PER_GRAM.fat,
    });
    expect(split.total).toBe(600 + 800 + 540);
    expect(split.difference).toBe(split.total - 2000);
    expect(split.share.protein).toBeCloseTo(600 / 2000, 6);
  });

  it('HEALTH-GOALS-019: a zero calorie target still yields a finite share, never Infinity', () => {
    const split = macroSplit(nutritionGoals({ calories: 0, protein: 100, carbs: 100, fat: 20 }));
    expect(Number.isFinite(split.share.protein)).toBe(true);
    expect(split.share.protein).toBe(400); // divided by the 1-kcal floor, not 0
  });
});

describe('healthGoalsStorage — rebalanceMacros', () => {
  it('HEALTH-GOALS-020: keeping one macro redistributes the OTHER two on their current ratio', () => {
    // protein anchor 150g (600 kcal) of a 2000 kcal target leaves 1400 kcal.
    // carbs currently 200g (800 kcal), fat currently 40g (360 kcal) -> ratio 800:360.
    const goals = nutritionGoals({ calories: 2000, protein: 150, carbs: 200, fat: 40 });
    const next = rebalanceMacros(goals, 'protein');
    expect(next.protein).toBe(150); // anchor untouched
    const carbsCal = next.carbs * KCAL_PER_GRAM.carbs;
    const fatCal = next.fat * KCAL_PER_GRAM.fat;
    // The two re-split kcal add back up to the 1400 kcal remaining (rounding aside).
    expect(Math.abs(carbsCal + fatCal - 1400)).toBeLessThanOrEqual(KCAL_PER_GRAM.fat);
    // And they keep roughly the 800:360 ratio the pre-rebalance macros had.
    expect(carbsCal / fatCal).toBeCloseTo(800 / 360, 1);
  });

  it('HEALTH-GOALS-021: falls back to a 60/40 split when the other two are both zero', () => {
    const goals = nutritionGoals({ calories: 2000, protein: 500, carbs: 0, fat: 0 });
    const next = rebalanceMacros(goals, 'protein');
    // anchor: 500g protein = 2000 kcal, so nothing remains to split — 60/40 of 0 is 0/0.
    expect(next.carbs).toBe(0);
    expect(next.fat).toBe(0);

    // With something left over, the 60/40 fallback shows up in the grams —
    // rounded PER MACRO (once each, not compounded), so the two kcal figures
    // land within a gram's worth of the ideal 60/40 split rather than exactly
    // on it.
    const goals2 = nutritionGoals({ calories: 2000, protein: 100, carbs: 0, fat: 0 });
    const next2 = rebalanceMacros(goals2, 'protein');
    const remaining = 2000 - 100 * KCAL_PER_GRAM.protein; // 1600 kcal
    expect(next2.carbs).toBe(Math.round(((remaining * 0.6) / KCAL_PER_GRAM.carbs)));
    expect(next2.fat).toBe(Math.round((remaining * 0.4) / KCAL_PER_GRAM.fat));
  });

  it('HEALTH-GOALS-022: clamps to zero rather than negative grams when the anchor alone exceeds the target', () => {
    const goals = nutritionGoals({ calories: 1000, protein: 400, carbs: 100, fat: 50 });
    const next = rebalanceMacros(goals, 'protein'); // 400g protein alone = 1600 kcal > 1000
    expect(next.carbs).toBe(0);
    expect(next.fat).toBe(0);
  });

  it('HEALTH-GOALS-023: works from any of the three anchors', () => {
    const goals = nutritionGoals({ calories: 2000, protein: 150, carbs: 200, fat: 60 });
    for (const anchor of ['protein', 'carbs', 'fat'] as const) {
      const next = rebalanceMacros(goals, anchor);
      expect(next[anchor]).toBe(goals[anchor]);
    }
  });
});

/* ==================================================================== */
/* Suggested targets                                                    */
/* ==================================================================== */

describe('healthGoalsStorage — missingSuggestionInputs', () => {
  const complete: SuggestionInputs = {
    weightKg: 70,
    heightCm: 175,
    age: 30,
    gender: 'male',
    activityLevel: 'moderatelyActive',
    goalType: 'maintain',
  };

  it('HEALTH-GOALS-024: nothing missing when every input is present', () => {
    expect(missingSuggestionInputs(complete)).toEqual([]);
  });

  it('HEALTH-GOALS-025: names each missing input individually, in the words the screen shows', () => {
    expect(missingSuggestionInputs({ ...complete, weightKg: null })).toContain('a weight reading');
    expect(missingSuggestionInputs({ ...complete, weightKg: 0 })).toContain('a weight reading');
    expect(missingSuggestionInputs({ ...complete, heightCm: null })).toContain('your height');
    expect(missingSuggestionInputs({ ...complete, age: null })).toContain('your birth year');
    expect(missingSuggestionInputs({ ...complete, gender: null })).toContain('your sex');
    expect(missingSuggestionInputs({ ...complete, activityLevel: null })).toContain(
      'your activity level'
    );
  });

  it('HEALTH-GOALS-026: lists every missing input at once, in order', () => {
    expect(
      missingSuggestionInputs({
        weightKg: null,
        heightCm: null,
        age: null,
        gender: null,
        activityLevel: null,
        goalType: null,
      })
    ).toEqual(['a weight reading', 'your height', 'your birth year', 'your sex', 'your activity level']);
  });
});

describe('healthGoalsStorage — suggestGoals (the donor GoalCalculator, formula for formula)', () => {
  it('HEALTH-GOALS-027: refuses to guess — null when anything required is missing', () => {
    expect(
      suggestGoals({
        weightKg: null,
        heightCm: 175,
        age: 30,
        gender: 'male',
        activityLevel: 'moderatelyActive',
        goalType: 'maintain',
      })
    ).toBeNull();
  });

  it('HEALTH-GOALS-028: a maintain-goal male at a moderate activity level — golden values', () => {
    const result = suggestGoals({
      weightKg: 70,
      heightCm: 175,
      age: 30,
      gender: 'male',
      activityLevel: 'moderatelyActive',
      goalType: 'maintain',
    });
    expect(result).toEqual({
      bmr: 1649,
      tdee: 2556,
      calories: 2556,
      protein: 84,
      fat: 85,
      carbs: 363,
      steps: 10000,
      minutes: 45,
      waterCups: 10,
    });
  });

  it('HEALTH-GOALS-029: defaults to "maintain" when no goal type has been chosen yet', () => {
    const withNull = suggestGoals({
      weightKg: 70,
      heightCm: 175,
      age: 30,
      gender: 'male',
      activityLevel: 'moderatelyActive',
      goalType: null,
    });
    const withMaintain = suggestGoals({
      weightKg: 70,
      heightCm: 175,
      age: 30,
      gender: 'male',
      activityLevel: 'moderatelyActive',
      goalType: 'maintain',
    });
    expect(withNull).toEqual(withMaintain);
  });

  it('HEALTH-GOALS-030: the 1,200 kcal floor is a safety bound a "lose" goal cannot cross', () => {
    const result = suggestGoals({
      weightKg: 40,
      heightCm: 150,
      age: 70,
      gender: 'other',
      activityLevel: 'sedentary',
      goalType: 'lose',
    });
    // Raw calculation (874 kcal) would be a medical question, not a diet.
    expect(result?.calories).toBe(1200);
    expect(result?.protein).toBe(40);
    expect(result?.fat).toBe(33);
    expect(result?.carbs).toBe(185);
    expect(result?.waterCups).toBe(5);
  });

  it('HEALTH-GOALS-031: calories and water both clamp at their own ceiling for a "gain" goal at extreme inputs', () => {
    const result = suggestGoals({
      weightKg: 400,
      heightCm: 200,
      age: 20,
      gender: 'male',
      activityLevel: 'extraActive',
      goalType: 'gain',
    });
    expect(result?.calories).toBe(CALORIE_MAX);
    expect(result?.waterCups).toBe(WATER_CUPS_MAX);
    expect(result?.steps).toBe(15000);
    expect(result?.minutes).toBe(90);
  });

  it('HEALTH-GOALS-032b: a non-finite age passes missingSuggestionInputs (only null is "missing") but still refuses a guess', () => {
    // `missingSuggestionInputs` only flags `age === null` — an age that is some
    // OTHER non-finite value (defensive: nothing in this app can produce one
    // today, since `ageFromBirthYear` only ever returns null or 0..130) is not
    // reported as missing, yet `bmrFor` still refuses to compute off it. The
    // screen must not read "nothing missing" as "a suggestion exists".
    const inputs: SuggestionInputs = {
      weightKg: 70,
      heightCm: 175,
      age: Number.NaN,
      gender: 'male',
      activityLevel: 'moderatelyActive',
      goalType: 'maintain',
    };
    expect(missingSuggestionInputs(inputs)).toEqual([]);
    expect(suggestGoals(inputs)).toBeNull();
  });

  it('HEALTH-GOALS-032: the "other" gender uses the donor\'s own average BMR constant', () => {
    const male = suggestGoals({
      weightKg: 70,
      heightCm: 175,
      age: 30,
      gender: 'male',
      activityLevel: 'sedentary',
      goalType: 'maintain',
    });
    const other = suggestGoals({
      weightKg: 70,
      heightCm: 175,
      age: 30,
      gender: 'other',
      activityLevel: 'sedentary',
      goalType: 'maintain',
    });
    const female = suggestGoals({
      weightKg: 70,
      heightCm: 175,
      age: 30,
      gender: 'female',
      activityLevel: 'sedentary',
      goalType: 'maintain',
    });
    // male +5, female -161, other -78 — three different BMRs off the same body.
    expect(male?.bmr).not.toBe(other?.bmr);
    expect(female?.bmr).not.toBe(other?.bmr);
    expect(other?.bmr).toBeGreaterThan(female?.bmr ?? 0);
    expect(other?.bmr).toBeLessThan(male?.bmr ?? 0);
  });
});

describe('healthGoalsStorage — ageFor / suggestionInputsFor', () => {
  it('HEALTH-GOALS-033: ageFor derives whole years from the stored birth year against the snapshot day', () => {
    const snapshot = {
      ...EMPTY_GOALS_SNAPSHOT,
      today: TODAY,
      weight: weightGoal({ birthYear: 1990 }),
    };
    expect(ageFor(snapshot)).toBe(36);
  });

  it('HEALTH-GOALS-034: ageFor is null without a birth year or without a loaded "today"', () => {
    expect(ageFor({ ...EMPTY_GOALS_SNAPSHOT, today: TODAY })).toBeNull();
    expect(
      ageFor({ ...EMPTY_GOALS_SNAPSHOT, today: '', weight: weightGoal({ birthYear: 1990 }) })
    ).toBeNull();
  });

  it('HEALTH-GOALS-035: suggestionInputsFor assembles weight, biometrics and goal type off one snapshot', () => {
    const snapshot = {
      ...EMPTY_GOALS_SNAPSHOT,
      today: TODAY,
      currentWeightKg: 82,
      weight: weightGoal({
        heightCm: 180,
        birthYear: 1995,
        gender: 'female' as const,
        activityLevel: 'veryActive' as const,
        goalType: 'lose' as const,
      }),
    };
    expect(suggestionInputsFor(snapshot)).toEqual({
      weightKg: 82,
      heightCm: 180,
      age: 31,
      gender: 'female',
      activityLevel: 'veryActive',
      goalType: 'lose',
    });
  });
});

/* ==================================================================== */
/* Input parsing + validation                                          */
/* ==================================================================== */

describe('healthGoalsStorage — whole-number parsing', () => {
  it('HEALTH-GOALS-036: sanitizeWholeNumber keeps digits only, capped at 7 characters', () => {
    expect(sanitizeWholeNumber('2,000 kcal')).toBe('2000');
    expect(sanitizeWholeNumber('12345678')).toBe('1234567');
    expect(sanitizeWholeNumber(undefined as unknown as string)).toBe('');
  });

  it('HEALTH-GOALS-037: parseWholeNumber is null on blank, a real number otherwise', () => {
    expect(parseWholeNumber('')).toBeNull();
    expect(parseWholeNumber('2000')).toBe(2000);
  });
});

describe('healthGoalsStorage — baseline date parsing', () => {
  it('HEALTH-GOALS-038: sanitizeDayKey keeps digits and dashes, capped to YYYY-MM-DD length', () => {
    expect(sanitizeDayKey('2026/07-13xx!!')).toBe('202607-13');
    expect(sanitizeDayKey('20260713202520')).toBe('2026071320');
    expect(sanitizeDayKey(undefined as unknown as string)).toBe('');
  });

  it('HEALTH-GOALS-039: blank is VALID and means "no explicit date"', () => {
    expect(parseDayKey('')).toEqual({ valid: true, date: null });
    expect(parseDayKey('   ')).toEqual({ valid: true, date: null });
    // A missing field (not even an empty string) reads the same as blank.
    expect(parseDayKey(undefined as unknown as string)).toEqual({ valid: true, date: null });
  });

  it('HEALTH-GOALS-040: a malformed shape is refused', () => {
    expect(parseDayKey('13-07-2026').valid).toBe(false);
    expect(parseDayKey('not-a-date').valid).toBe(false);
  });

  it('HEALTH-GOALS-041: a day that ROLLS OVER (e.g. Feb 30) is refused, not silently corrected', () => {
    // JS `Date` rolls 2026-02-30 into 2 March; the round-trip check catches it.
    expect(parseDayKey('2026-02-30').valid).toBe(false);
  });

  it('HEALTH-GOALS-041b: a shape that matches the regex but is not a real calendar date is refused', () => {
    // '0000-00-00' passes the \d{4}-\d{2}-\d{2} shape check but month/day 00 is
    // not a real date — `Date.parse` returns NaN for it, the branch a shape
    // check alone cannot catch.
    expect(parseDayKey('0000-00-00')).toEqual({ valid: false, date: null });
  });

  it('HEALTH-GOALS-042: a future date is refused; today itself is accepted', () => {
    expect(parseDayKey('2026-07-14').valid).toBe(false); // tomorrow, relative to FIXED_NOW
    expect(parseDayKey(TODAY)).toEqual({ valid: true, date: TODAY });
  });

  it('HEALTH-GOALS-043: a real past date round-trips exactly', () => {
    expect(parseDayKey('2020-01-15')).toEqual({ valid: true, date: '2020-01-15' });
  });

  it('HEALTH-GOALS-044: BASELINE_DATE_MESSAGE is the sentence the screen shows for a bad date', () => {
    expect(BASELINE_DATE_MESSAGE).toMatch(/YYYY-MM-DD/);
  });
});

describe('healthGoalsStorage — checkBound', () => {
  it('HEALTH-GOALS-045: null is always out of bounds', () => {
    expect(checkBound(null, GOAL_BOUNDS.calories)).toBe(GOAL_BOUNDS.calories.message);
  });

  it('HEALTH-GOALS-046: the min and max are themselves INSIDE the bound (inclusive)', () => {
    expect(checkBound(CALORIE_MIN, GOAL_BOUNDS.calories)).toBeNull();
    expect(checkBound(CALORIE_MAX, GOAL_BOUNDS.calories)).toBeNull();
  });

  it('HEALTH-GOALS-047: one below the min or one above the max is refused', () => {
    expect(checkBound(CALORIE_MIN - 1, GOAL_BOUNDS.calories)).toBe(GOAL_BOUNDS.calories.message);
    expect(checkBound(CALORIE_MAX + 1, GOAL_BOUNDS.calories)).toBe(GOAL_BOUNDS.calories.message);
  });

  it('HEALTH-GOALS-048: every bound key exposes the route\'s own limit, in words', () => {
    expect(GOAL_BOUNDS.macroGrams.max).toBe(MACRO_GRAMS_MAX);
    expect(GOAL_BOUNDS.steps.max).toBe(STEPS_MAX);
    expect(GOAL_BOUNDS.minutes.max).toBe(WORKOUT_MINUTES_MAX);
    expect(GOAL_BOUNDS.waterCups.max).toBe(WATER_CUPS_MAX);
    // Macro/step/minute/water floors are 1, not the route's 0 — see the bound's
    // own doc comment on why a "0" goal is not something storage can keep.
    expect(GOAL_BOUNDS.macroGrams.min).toBe(1);
    expect(GOAL_BOUNDS.steps.min).toBe(1);
    expect(GOAL_BOUNDS.minutes.min).toBe(1);
    expect(GOAL_BOUNDS.waterCups.min).toBe(1);
  });

  it('HEALTH-GOALS-049: MACRO_LABELS and MACRO_DIFFERENCE_TOLERANCE match the donor', () => {
    expect(MACRO_LABELS).toEqual({ protein: 'Protein', carbs: 'Carbs', fat: 'Fats' });
    expect(MACRO_DIFFERENCE_TOLERANCE).toBe(50);
  });
});

/* ==================================================================== */
/* One read for the whole screen                                       */
/* ==================================================================== */

describe('healthGoalsStorage — loadHealthGoals (the aggregate read)', () => {
  it('HEALTH-GOALS-050: assembles all five slices, plus today, into one snapshot', async () => {
    api.getGoal.mockResolvedValue(ok({ goal: null })); // own loadCalorieWeek call
    mockLoadNutritionGoals.mockResolvedValue(nutritionGoals({ calories: 2200 }));
    mockLoadActivityGoals.mockResolvedValue(activityGoals({ steps: 9000 }));
    mockLoadWaterToday.mockResolvedValue(waterDay({ target: 10 }));
    mockLoadWeightGoal.mockResolvedValue(weightGoal({ targetKg: 75 }));
    mockLoadHealthPrefs.mockResolvedValue(prefs({ preferredUnit: 'lb' }));
    mockLoadWeightLog.mockResolvedValue([weightEntry({ value: 154, unit: 'lb' })]);

    const snapshot = await loadHealthGoals();

    expect(snapshot.nutrition.calories).toBe(2200);
    expect(snapshot.activity.steps).toBe(9000);
    expect(snapshot.waterCups).toBe(10);
    expect(snapshot.calorieWeek).toEqual(EMPTY_CALORIE_WEEK);
    expect(snapshot.macroWeek).toEqual(EMPTY_MACRO_WEEK);
    expect(snapshot.weight.targetKg).toBe(75);
    expect(snapshot.unit).toBe('lb');
    // 154 lb -> kg, canonical regardless of the display unit.
    expect(snapshot.currentWeightKg).toBeCloseTo(154 / 2.2046226218, 3);
    expect(snapshot.today).toBe(TODAY);
  });

  it('HEALTH-GOALS-051: an empty weight log reads as no current weight, not zero', async () => {
    api.getGoal.mockResolvedValue(ok({ goal: null }));
    mockLoadWeightLog.mockResolvedValue([]);

    const snapshot = await loadHealthGoals();
    expect(snapshot.currentWeightKg).toBeNull();
  });

  it('HEALTH-GOALS-052: EMPTY_GOALS_SNAPSHOT has an empty "today", so age refuses to guess before load', () => {
    expect(EMPTY_GOALS_SNAPSHOT.today).toBe('');
    expect(ageFor(EMPTY_GOALS_SNAPSHOT)).toBeNull();
  });
});

afterAll(async () => {
  await clearHealthCache([]);
});
