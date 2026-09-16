/**
 * WIDGET area — the `widget_health_today` PAYLOAD, driven through the real screen.
 *
 * `HealthHomeScreen` is the only producer of the Health widget snapshot
 * (`HealthHomeScreen.tsx:265-276`). Nothing type-checks across the App Group
 * boundary — the RN side writes JSON, the Swift side decodes it — so the numbers
 * in that payload are only ever as correct as a test makes them.
 *
 * This file owns the ARITHMETIC and the UNITS of that handoff:
 *   - cups → millilitres (the store keeps cups, the widget reads ml),
 *   - `move_pct` as a FRACTION in [0,1], its clamp, and its divide-by-zero guard,
 *   - the today-only workout window behind `move_pct`,
 *   - the exact key set (a widget renders on a LOCKED screen, so anything extra
 *     here is readable without unlocking the device).
 *
 * The screen is rendered for real rather than the formula re-implemented: a
 * mirrored formula is a tautology that passes after the screen regresses.
 *
 * SPLIT OF OWNERSHIP: `screens/__tests__/HealthHomeScreen.test.tsx` already pins
 * the happy-path conversion, the malformed-water fallback and the re-publish on
 * every water tap (WIDGET-001/002/003/028). Nothing here duplicates those — this
 * file covers the boundaries none of them reach.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  loadActivityGoals,
  loadStepDays,
  loadWorkouts,
  type ActivityGoals,
  type WorkoutEntry,
} from '../../healthActivityStorage';
import { loadBodyEntries } from '../../healthBodyStorage';
import { loadHabits } from '../../healthHabitsStorage';
import {
  loadHealthPrefs,
  loadNoteForDate,
  loadWaterToday,
  loadWeightLog,
  type HealthPrefs,
  type WaterDay,
  type WeightEntry,
} from '../../healthLocalStorage';
import {
  loadMealsForDate,
  loadNutritionGoals,
  type NutritionGoals,
} from '../../healthNutritionStorage';
import { HealthHomeScreen } from '../../screens/HealthHomeScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: () => ReactMock.createElement(View, { testID: 'screen-header' }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactMock = require('react');
    ReactMock.useEffect(() => callback(), [callback]);
  },
}));

// A real display name is seeded on purpose: WIDGET-035 proves it never reaches
// the App Group even though the screen has it in hand.
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'u_health_ada', display_name: 'Ada Lovelace' }, logout: jest.fn() }),
}));

const mockSetSnapshot = jest.fn();
jest.mock('@services/widget-sync', () => ({
  // Forwarded lazily — the factory is hoisted above `mockSetSnapshot`.
  widgetSync: { setSnapshot: (...args: unknown[]) => mockSetSnapshot(...args) },
}));

// Only the storage-backed reads are stubbed; every pure helper and constant
// (DEFAULT_WATER_TARGET, sumNutrition, …) stays real, so the conversion under
// test is the shipped one.
jest.mock('../../healthLocalStorage', () => {
  const actual = jest.requireActual('../../healthLocalStorage');
  return {
    ...actual,
    loadWeightLog: jest.fn(),
    loadHealthPrefs: jest.fn(),
    loadWaterToday: jest.fn(),
    loadNoteForDate: jest.fn(),
    addWeightEntry: jest.fn(),
    deleteWeightEntry: jest.fn(),
    adjustWater: jest.fn(),
    saveNoteForDate: jest.fn(),
  };
});
jest.mock('../../healthNutritionStorage', () => {
  const actual = jest.requireActual('../../healthNutritionStorage');
  return { ...actual, loadMealsForDate: jest.fn(), loadNutritionGoals: jest.fn() };
});
jest.mock('../../healthActivityStorage', () => {
  const actual = jest.requireActual('../../healthActivityStorage');
  return {
    ...actual,
    loadWorkouts: jest.fn(),
    loadStepDays: jest.fn(),
    loadActivityGoals: jest.fn(),
  };
});
jest.mock('../../healthHabitsStorage', () => {
  const actual = jest.requireActual('../../healthHabitsStorage');
  return { ...actual, loadHabits: jest.fn() };
});
jest.mock('../../healthBodyStorage', () => {
  const actual = jest.requireActual('../../healthBodyStorage');
  return { ...actual, loadBodyEntries: jest.fn() };
});

const mockLoadWeightLog = loadWeightLog as jest.Mock;
const mockLoadHealthPrefs = loadHealthPrefs as jest.Mock;
const mockLoadWaterToday = loadWaterToday as jest.Mock;
const mockLoadNoteForDate = loadNoteForDate as jest.Mock;
const mockLoadMealsForDate = loadMealsForDate as jest.Mock;
const mockLoadNutritionGoals = loadNutritionGoals as jest.Mock;
const mockLoadWorkouts = loadWorkouts as jest.Mock;
const mockLoadStepDays = loadStepDays as jest.Mock;
const mockLoadActivityGoals = loadActivityGoals as jest.Mock;
const mockLoadHabits = loadHabits as jest.Mock;
const mockLoadBodyEntries = loadBodyEntries as jest.Mock;

/** The frozen "today" every fixture below is dated against. */
const TODAY_KEY = '2026-07-13';
const YESTERDAY_KEY = '2026-07-12';

/** Millilitres per cup, as written at `HealthHomeScreen.tsx:267`. */
const CUP_ML = 240;

const healthPrefs: HealthPrefs = {
  unitSystem: 'metric',
  preferredUnit: 'kg',
  healthKitEnabled: false,
  aiEnabled: false,
};
const nutritionGoals: NutritionGoals = { calories: 2000, protein: 120, carbs: 220, fat: 65 };

function water(over: Partial<WaterDay> = {}): WaterDay {
  return { date: TODAY_KEY, cups: 0, target: 8, ...over };
}

function goals(over: Partial<ActivityGoals> = {}): ActivityGoals {
  return { minutes: 30, steps: 8000, ...over };
}

function workout(over: Partial<WorkoutEntry> = {}): WorkoutEntry {
  return {
    id: over.id ?? 'w1',
    date: over.date ?? TODAY_KEY,
    type: over.type ?? 'run',
    minutes: over.minutes ?? 10,
    calories: over.calories ?? 100,
    intensity: over.intensity ?? 'steady',
    // `null` is a real state — the widget never reads distance, but the type
    // requires it and a 0 would be a different (wrong) fact.
    distanceM: over.distanceM ?? null,
    startedAt: over.startedAt ?? `${TODAY_KEY}T07:00:00.000Z`,
    note: over.note ?? '',
    loggedAt: over.loggedAt ?? `${TODAY_KEY}T07:00:00.000Z`,
  };
}

function weightEntry(): WeightEntry {
  return {
    id: `${TODAY_KEY}T08:00:00.000Z`,
    value: 71.4,
    unit: 'kg',
    loggedAt: `${TODAY_KEY}T08:00:00.000Z`,
    date: TODAY_KEY,
    note: 'felt heavy',
    source: 'manual',
  };
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthHomeScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

/**
 * The most recent payload the screen pushed under `key`.
 *
 * Home no longer writes the App Group itself — it hands facts to
 * `publishHealthGlance`, which maps them onto BOTH native contracts. That module
 * is deliberately NOT mocked here: the point of this file is the whole path from
 * a rendered screen to the bytes in the App Group.
 */
function lastSnapshot(key = 'widget_health_today'): Record<string, unknown> {
  const call = [...mockSetSnapshot.mock.calls].reverse().find((c) => c[0] === key);
  if (!call) throw new Error(`no setSnapshot('${key}', …) call recorded`);
  return call[1] as Record<string, unknown>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadWeightLog.mockResolvedValue([]);
  mockLoadHealthPrefs.mockResolvedValue(healthPrefs);
  mockLoadWaterToday.mockResolvedValue(water());
  mockLoadNoteForDate.mockResolvedValue('');
  mockLoadMealsForDate.mockResolvedValue([]);
  mockLoadNutritionGoals.mockResolvedValue(nutritionGoals);
  mockLoadWorkouts.mockResolvedValue([]);
  mockLoadStepDays.mockResolvedValue([]);
  mockLoadActivityGoals.mockResolvedValue(goals());
  mockLoadHabits.mockResolvedValue([]);
  mockLoadBodyEntries.mockResolvedValue([]);
  jest.useFakeTimers().setSystemTime(new Date(2026, 6, 13, 9, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// move_pct — a fraction, clamped, and never a divide-by-zero
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-029…032 — move_pct is a bounded fraction', () => {
  it('HEALTH-WIDGET-029: move_pct is minutes ÷ goal as a FRACTION, not a percentage', async () => {
    // The Swift reader treats `move_pct <= 1.0` as a fraction and multiplies by
    // 100 (`SymplyHealthWidgetContent.swift:81`). Emitting 50 for "half a goal"
    // would render a 50× ring, so the units are the whole contract here.
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 15 })]);
    await renderScreen();
    expect(lastSnapshot().move_pct).toBe(0.5);
  });

  it('HEALTH-WIDGET-030: a met goal is exactly 1, and a partial day is strictly below it', async () => {
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 30 })]);
    await renderScreen();
    expect(lastSnapshot().move_pct).toBe(1);

    jest.clearAllMocks();
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 29 })]);
    await renderScreen();
    expect(lastSnapshot().move_pct as number).toBeLessThan(1);
  });

  it('HEALTH-WIDGET-031: an over-goal day CLAMPS to 1 instead of overflowing the ring', async () => {
    // 90 minutes against a 30-minute goal is 3.0. Unclamped, the widget would
    // draw a ring 3× over target (and the ">= 100% → green" tint would still be
    // right, so the bug would look like a rendering glitch, not a data bug).
    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'w1', minutes: 45 }),
      workout({ id: 'w2', minutes: 45 }),
    ]);
    await renderScreen();
    expect(lastSnapshot().move_pct).toBe(1);
  });

  it('HEALTH-WIDGET-032: a zero move goal cannot divide by zero — the ring is ABSENT', async () => {
    // `moveFraction` returns null when the goal is not positive, and null decodes
    // to a nil `Double?` so the widget renders "—". That is the right answer:
    // "no move goal set" is not "you did nothing", and it is also not a closed
    // ring. (An earlier revision substituted a goal of 1 minute, which made any
    // movement at all read as 100%.)
    mockLoadActivityGoals.mockResolvedValue(goals({ minutes: 0 }));
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 20 })]);
    await renderScreen();
    expect(lastSnapshot().move_pct).toBeNull();
    expect(lastSnapshot('watch_health_today').move_goal_percent).toBeNull();
  });

  it('HEALTH-WIDGET-032: a negative move goal takes the same path', async () => {
    // Not reachable through the Activity UI, but a corrupt MMKV payload can hold
    // one — and `minutes / -30` would be a NEGATIVE fraction the ring cannot draw.
    mockLoadActivityGoals.mockResolvedValue(goals({ minutes: -30 }));
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 10 })]);
    await renderScreen();
    expect(lastSnapshot().move_pct).toBeNull();
  });
});

describe('HEALTH-WIDGET-033 — the move ring counts TODAY only', () => {
  it('HEALTH-WIDGET-033: yesterday’s workouts do not inflate today’s move_pct', async () => {
    // `moveMinutes` filters on `w.date === today`. A rolling total would make the
    // widget's ring permanently closed for anyone who trains regularly.
    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'old', date: YESTERDAY_KEY, minutes: 120 }),
      workout({ id: 'new', date: TODAY_KEY, minutes: 6 }),
    ]);
    await renderScreen();
    expect(lastSnapshot().move_pct).toBeCloseTo(0.2, 10);
  });

  it('HEALTH-WIDGET-033: a log with nothing dated today reads 0, not the last session', async () => {
    mockLoadWorkouts.mockResolvedValue([workout({ id: 'old', date: YESTERDAY_KEY, minutes: 45 })]);
    await renderScreen();
    expect(lastSnapshot().move_pct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Units and pass-through
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-034…036 — units and pass-through', () => {
  it('HEALTH-WIDGET-034: steps and steps_goal are passed through verbatim, uncapped', async () => {
    // Unlike move, steps are NOT a fraction: the widget formats the raw counts
    // ("7,240 / 10,000 steps"). Clamping or rounding them here would silently
    // cap a big day at the goal.
    mockLoadStepDays.mockResolvedValue([{ date: TODAY_KEY, steps: 14_321 }]);
    mockLoadActivityGoals.mockResolvedValue(goals({ steps: 10_000 }));
    await renderScreen();
    expect(lastSnapshot()).toMatchObject({ steps: 14_321, steps_goal: 10_000 });
  });

  it('HEALTH-WIDGET-035: the payload is exactly the eleven wire fields and leaks nothing else', async () => {
    // A widget renders on a LOCKED screen and the App Group container is shared
    // with this brand's widget and watch targets, so every field here is
    // readable without unlocking the device. This screen's own publish call
    // (`HealthHomeScreen`'s steps/water effect) only ever supplies steps, water
    // and move — the five widget-only domains (weight/nutrition/workouts +
    // their trends) are still present as KEYS (so the payload is always the
    // same shape), just `null` here: the daily note and the signed-in user's
    // name are in scope on this screen and still must never travel.
    mockLoadWeightLog.mockResolvedValue([weightEntry()]);
    mockLoadNoteForDate.mockResolvedValue('bloodwork at 4pm');
    mockLoadWaterToday.mockResolvedValue(water({ cups: 2 }));
    await renderScreen();

    const payload = lastSnapshot();
    expect(Object.keys(payload).sort()).toEqual([
      'move_pct',
      'next_reminder',
      'nutrition',
      'nutrition_trend',
      'preferences',
      'steps',
      'steps_goal',
      'water_goal_ml',
      'water_ml',
      'weight',
      'weight_trend',
      'workouts',
    ]);
    // Every numeric field must survive `JSON.stringify` as a NUMBER: the Swift
    // struct types them Int/Double, so a string fails the decode and blanks the
    // WHOLE widget, not just one tile. The six widget-only domains are all
    // `null` from this screen — this test never seeds `HealthWidgetSettingsScreen`
    // data, only what `HealthHomeScreen` itself knows.
    const {
      next_reminder: reminder,
      weight,
      weight_trend,
      nutrition,
      nutrition_trend,
      workouts,
      preferences,
      ...numbers
    } = payload as Record<string, unknown>;
    expect(reminder).toBeNull();
    expect(weight).toBeNull();
    expect(weight_trend).toBeNull();
    expect(nutrition).toBeNull();
    expect(nutrition_trend).toBeNull();
    expect(workouts).toBeNull();
    expect(preferences).toBeNull();
    Object.values(numbers).forEach((value) => expect(typeof value).toBe('number'));

    const serialised = JSON.stringify(payload);
    for (const secret of ['71.4', 'bloodwork', 'Ada', 'u_health_ada', 'kg', 'note']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('HEALTH-WIDGET-035: Home feeds the WATCH face too, from the same facts', async () => {
    // Until 2026-07-26 `watch_health_today` had no writer anywhere in the repo,
    // so the Health watch glance was empty by construction. Home now publishes
    // through the shared glance publisher, which writes both keys from one set
    // of facts — that is what stops the two faces disagreeing about a day.
    mockLoadWaterToday.mockResolvedValue(water({ cups: 5, target: 8 }));
    mockLoadStepDays.mockResolvedValue([{ date: TODAY_KEY, steps: 7240 }]);
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 15 })]);
    await renderScreen();

    expect(mockSetSnapshot.mock.calls.map((c) => c[0])).toEqual([
      'widget_health_today',
      'watch_health_today',
    ]);
    const widget = lastSnapshot();
    const watch = lastSnapshot('watch_health_today');
    expect(widget).toMatchObject({ steps: 7240, water_ml: 1200, move_pct: 0.5 });
    // Same facts, the watch's own schema: an Int percent, not a fraction.
    expect(watch).toMatchObject({ steps: 7240, water_ml: 1200, move_goal_percent: 50 });
  });

  it('HEALTH-WIDGET-036: cups → ml is ×240 on BOTH the value and the goal', async () => {
    // The store counts CUPS; the widget's fields are `water_ml` / `water_goal_ml`
    // and it formats them as litres (`ml / 1000`). Converting the value but not
    // the goal — or vice versa — renders "0.5L / 8L", which looks plausible.
    mockLoadWaterToday.mockResolvedValue(water({ cups: 5, target: 10 }));
    await renderScreen();
    expect(lastSnapshot()).toMatchObject({
      water_ml: 5 * CUP_ML,
      water_goal_ml: 10 * CUP_ML,
    });
  });

  it('HEALTH-WIDGET-036: a fractional stored cup count converts without rounding', async () => {
    // Reachable only through a corrupt store (the counter clamps to integers),
    // but the conversion must not silently floor to zero.
    mockLoadWaterToday.mockResolvedValue(water({ cups: 0.5, target: 8 }));
    await renderScreen();
    expect(lastSnapshot().water_ml).toBe(120);
  });

  it('HEALTH-WIDGET-036: an over-target day is NOT clamped — only move_pct is', async () => {
    // Water is an absolute reading, not a fraction, so 12 of 8 cups must reach
    // the widget as 2880 ml. The widget's own tint rule ("green at or above the
    // goal") depends on that being reported honestly.
    mockLoadWaterToday.mockResolvedValue(water({ cups: 12, target: 8 }));
    await renderScreen();
    expect(lastSnapshot()).toMatchObject({ water_ml: 2880, water_goal_ml: 1920 });
  });
});

// ---------------------------------------------------------------------------
// Degradation
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-037 — the writer degrades rather than lying', () => {
  it('HEALTH-WIDGET-037: a corrupt workout duration drops the ring, never a wrong one', async () => {
    // A NaN sum reaches `moveFraction`, whose `Number.isFinite` guard answers
    // null — a real JSON null, not the `NaN` a raw division would produce (which
    // `JSON.stringify` also renders as null, but only by accident). A missing
    // reading is the honest outcome for corrupt input; this fails loudly if it
    // ever becomes a 0, i.e. a closed-at-zero ring.
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: Number.NaN })]);
    await renderScreen();

    const payload = lastSnapshot();
    expect(payload.move_pct).toBeNull();
    expect(JSON.parse(JSON.stringify(payload)).move_pct).toBeNull();
    // …and the rest of the payload is unharmed, so the other three tiles render.
    expect(payload).toMatchObject({ water_ml: 0, water_goal_ml: 1920, steps: 0, steps_goal: 8000 });
  });

  it('HEALTH-WIDGET-037: a storage read that never resolves publishes NO snapshot', async () => {
    // The `if (!waterDay) return` guard means a stalled hydrate leaves the LAST
    // GOOD snapshot on the home screen instead of overwriting it with zeros —
    // the widget shows yesterday's numbers rather than a false empty day.
    mockLoadWaterToday.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    expect(mockSetSnapshot).not.toHaveBeenCalled();
  });
});
