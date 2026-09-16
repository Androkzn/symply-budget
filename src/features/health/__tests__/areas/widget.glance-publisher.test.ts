/**
 * WIDGET area — `healthWidgetStorage.ts`, the glance publisher.
 *
 * This module is the reconciliation layer between ONE set of facts and TWO
 * incompatible native contracts:
 *
 *   `widget_health_today` — `move_pct` is a Double FRACTION, `next_reminder` is
 *     an OBJECT `{ title, at }`, and there is no `date` field at all.
 *   `watch_health_today`  — `move_goal_percent` is an Int 0–100, `next_reminder`
 *     is a STRING (the title), `next_reminder_time` is pre-formatted, and `date`
 *     is required.
 *
 * Both Swift sides are shipped and decode with `try?`, so a wrong shape is not
 * an error anywhere — it is a silently blank tile on a lock screen. Nothing
 * type-checks across that boundary, which is why every mapping below is pinned
 * against the CodingKeys parsed out of the Swift sources themselves.
 *
 * It also owns the widget-preference client (`GET/PUT /health/widget/preferences`)
 * and the server→App-Group sync that makes both faces live without a screen
 * being open (`app/_layout.tsx` calls it on launch for the Health brand).
 *
 * The module had NO test file when this area was audited.
 */
import fs from 'fs';
import path from 'path';

import type { HealthWidgetPreferences, HealthWidgetSnapshot } from '@api/healthAssets';
import { healthAssetsApi } from '@api/healthAssets';
import { storageHelpers } from '@services/storage';
import { widgetSync } from '@services/widget-sync';

import { loadActivityGoals } from '../../healthActivityStorage';
import { readThrough } from '../../healthRepository';
import {
  DEFAULT_HEALTH_WIDGET_PREFERENCES,
  describeWidgetPreferences,
  factsFromWidgetSnapshot,
  formatReminderTime,
  HEALTH_GLANCE_EXTRAS_KEY,
  HEALTH_GLANCE_REMINDER_KEY,
  HEALTH_WATCH_KEY,
  HEALTH_WIDGET_KEY,
  HEALTH_WIDGET_PREFS_KEY,
  loadHealthGlanceReminder,
  loadWidgetPreferences,
  moveFraction,
  publishHealthGlance,
  saveWidgetPreferences,
  setHealthGlanceReminder,
  syncHealthGlanceFromServer,
  toHealthWatchPayload,
  toHealthWidgetPayload,
  WIDGET_PREFS_OFFLINE_MESSAGE,
  type HealthGlanceFacts,
} from '../../healthWidgetStorage';

jest.mock('@services/widget-sync', () => ({
  widgetSync: { setSnapshot: jest.fn(), clear: jest.fn(), reload: jest.fn() },
}));

jest.mock('@services/storage', () => ({
  storageHelpers: { getObject: jest.fn(), setObject: jest.fn(), delete: jest.fn() },
}));

// Keep the exported enums/constants real — they are the contract the settings
// UI and the Worker's zod schema share.
jest.mock('@api/healthAssets', () => {
  const actual = jest.requireActual('@api/healthAssets');
  return {
    ...actual,
    healthAssetsApi: {
      getWidgetPreferences: jest.fn(),
      saveWidgetPreferences: jest.fn(),
      getWidgetSnapshot: jest.fn(),
    },
  };
});

jest.mock('../../healthActivityStorage', () => {
  const actual = jest.requireActual('../../healthActivityStorage');
  return { ...actual, loadActivityGoals: jest.fn() };
});

jest.mock('../../healthRepository', () => ({ readThrough: jest.fn() }));

const mockSetSnapshot = widgetSync.setSnapshot as jest.Mock;
const mockGetObject = storageHelpers.getObject as jest.Mock;
const mockSetObject = storageHelpers.setObject as jest.Mock;
const mockDelete = storageHelpers.delete as jest.Mock;
const mockGetPrefs = healthAssetsApi.getWidgetPreferences as jest.Mock;
const mockSavePrefs = healthAssetsApi.saveWidgetPreferences as jest.Mock;
const mockGetSnapshot = healthAssetsApi.getWidgetSnapshot as jest.Mock;
const mockLoadActivityGoals = loadActivityGoals as jest.Mock;
const mockReadThrough = readThrough as jest.Mock;

const ROOT = path.resolve(__dirname, '../../../../..');
const NOW = new Date('2026-07-13T09:00:00.000Z');
const LATER_ISO = '2026-07-13T18:30:00.000Z';
const EARLIER_ISO = '2026-07-13T06:00:00.000Z';

function facts(over: Partial<HealthGlanceFacts> = {}): HealthGlanceFacts {
  return {
    date: '2026-07-13',
    steps: 7240,
    stepsGoal: 10000,
    waterMl: 1200,
    waterGoalMl: 2000,
    movePct: 0.5,
    nextReminder: null,
    weight: null,
    weightTrend: null,
    nutrition: null,
    nutritionTrend: null,
    workouts: null,
    preferences: null,
    ...over,
  };
}

function prefs(over: Partial<HealthWidgetPreferences> = {}): HealthWidgetPreferences {
  return { ...DEFAULT_HEALTH_WIDGET_PREFERENCES, ...over };
}

function serverSnapshot(over: Partial<HealthWidgetSnapshot> = {}): HealthWidgetSnapshot {
  return {
    date: '2026-07-13',
    generated_at: NOW.toISOString(),
    preferences: prefs(),
    small: { metric: 'steps', value: 7240, goal: 10000 },
    steps: { value: 7240, goal: 10000 },
    water: { total_ml: 1200, goal_ml: 2000 },
    weight: { value: 70.5, unit: 'kg', date: '2026-07-13' },
    weight_trend: {
      unit: 'kg',
      entries: [{ date: '2026-07-13', weight: 70.5 }],
      avg_this_week: 70.8,
      avg_last_week: 71.2,
      starting_weight_kg: 80,
      starting_weight_date: '2026-01-01',
      progress_from_start: -9.5,
      progress_percentage: -11.9,
    },
    nutrition: null,
    nutrition_trend: null,
    workouts: { count: 1, minutes: 15, calories: 250, goal_minutes: 30 },
    ...over,
  };
}

/** Payload pushed under `key` by the most recent publish. */
function snapshotFor(key: string): Record<string, unknown> {
  const call = [...mockSetSnapshot.mock.calls].reverse().find((c) => c[0] === key);
  if (!call) throw new Error(`no setSnapshot('${key}', …) call recorded`);
  return call[1] as Record<string, unknown>;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(NOW);
  mockGetObject.mockResolvedValue(null);
  mockSetObject.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
  mockLoadActivityGoals.mockResolvedValue({ minutes: 30, steps: 10000 });
  // Default: behave like the real read-through — fetch, else fall back.
  mockReadThrough.mockImplementation(
    async (_key: string, fetcher: () => Promise<unknown>, fallback: unknown) => {
      try {
        return await fetcher();
      } catch {
        return fallback;
      }
    },
  );
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// HEALTH-WIDGET-045 — the two payload shapes ARE the two Swift contracts
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-045 — payload shapes match the Swift CodingKeys', () => {
  /** Wire keys declared by a Swift `CodingKeys` enum, in declaration order. */
  function codingKeys(rel: string): string[] {
    const swift = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const block = swift.match(/enum CodingKeys:\s*String,\s*CodingKey\s*\{([\s\S]*?)\n\s*\}/);
    if (!block) throw new Error(`no CodingKeys enum in ${rel}`);
    return block[1]
      .split('\n')
      .map((line) => line.match(/^\s*case\s+(\w+)\s*(?:=\s*"([^"]+)")?\s*$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => m[2] ?? m[1]);
  }

  it('HEALTH-WIDGET-045: the widget payload declares every field the widget decodes', () => {
    // An extra key is not harmless: `HealthWidgetData` is a plain `Codable`, so
    // the whole decode is best-effort and a shape mismatch blanks the widget
    // rather than one tile.
    const declared = codingKeys('ios/SymplyEcosystemWidget/SymplyHealthWidgetContent.swift');
    expect(Object.keys(toHealthWidgetPayload(facts())).sort()).toEqual([...declared].sort());
  });

  it('HEALTH-WIDGET-045: the watch payload declares every field the watch decodes', () => {
    const declared = codingKeys('ios/SymplyEcosystemWatch/Views/SymplyHealthWatchView.swift');
    expect(Object.keys(toHealthWatchPayload(facts())).sort()).toEqual([...declared].sort());
  });

  it('HEALTH-WIDGET-045: move progress crosses the boundary as a fraction AND as a percent', () => {
    // The single most dangerous divergence between the two: sending the watch's
    // `85` to the widget renders a ring 85× over target, and sending the
    // widget's `0.85` to the watch renders "1%".
    const f = facts({ movePct: 0.85 });
    expect(toHealthWidgetPayload(f).move_pct).toBe(0.85);
    expect(toHealthWatchPayload(f).move_goal_percent).toBe(85);
  });

  it('HEALTH-WIDGET-045: an over-goal day reads 100% on BOTH faces, never 150%', () => {
    const f = facts({ movePct: 1.5 });
    expect(toHealthWidgetPayload(f).move_pct).toBe(1);
    expect(toHealthWatchPayload(f).move_goal_percent).toBe(100);
  });

  it('HEALTH-WIDGET-045: a negative or non-finite fraction never reaches either face', () => {
    expect(toHealthWidgetPayload(facts({ movePct: -0.4 })).move_pct).toBe(0);
    expect(toHealthWatchPayload(facts({ movePct: -0.4 })).move_goal_percent).toBe(0);
    expect(toHealthWidgetPayload(facts({ movePct: Number.NaN })).move_pct).toBeNull();
    expect(toHealthWatchPayload(facts({ movePct: Number.NaN })).move_goal_percent).toBeNull();
    expect(toHealthWidgetPayload(facts({ movePct: null })).move_pct).toBeNull();
    expect(toHealthWatchPayload(facts({ movePct: null })).move_goal_percent).toBeNull();
  });

  it('HEALTH-WIDGET-045: the reminder is an object on one face and a string pair on the other', () => {
    const f = facts({ nextReminder: { title: 'Evening walk', at: LATER_ISO } });
    expect(toHealthWidgetPayload(f).next_reminder).toEqual({
      title: 'Evening walk',
      at: LATER_ISO,
    });
    const watch = toHealthWatchPayload(f);
    expect(watch.next_reminder).toBe('Evening walk');
    // Pre-formatted for the watch, which has no formatter of its own.
    expect(watch.next_reminder_time).toBe(formatReminderTime(LATER_ISO));
    expect(watch.next_reminder_time).not.toBe(LATER_ISO);
  });

  it('HEALTH-WIDGET-045: no reminder means null on both faces, never an empty object', () => {
    const widget = toHealthWidgetPayload(facts({ nextReminder: null }));
    const watch = toHealthWatchPayload(facts({ nextReminder: null }));
    expect(widget.next_reminder).toBeNull();
    expect(watch.next_reminder).toBeNull();
    expect(watch.next_reminder_time).toBeNull();
  });

  it('HEALTH-WIDGET-045: the widget payload carries no date, the watch payload must', () => {
    // `HealthWidgetData` has no `date` field — sending one would be an unknown
    // key. The watch's schema requires it (and then never checks it, WATCH-009).
    expect(toHealthWidgetPayload(facts())).not.toHaveProperty('date');
    expect(toHealthWatchPayload(facts({ date: '2026-07-13' })).date).toBe('2026-07-13');
  });
});

// ---------------------------------------------------------------------------
// HEALTH-WIDGET-046 — counts that reach a native Int field
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-046 — count normalisation', () => {
  it.each([
    ['a fractional count is rounded', 7240.6, 7241],
    ['a negative count becomes 0', -5, 0],
    ['NaN becomes 0', Number.NaN, 0],
    ['Infinity becomes 0', Number.POSITIVE_INFINITY, 0],
  ])('HEALTH-WIDGET-046: %s', (_label, input, expected) => {
    // `steps` / `water_ml` decode into Swift `Int?`. A Double with a fractional
    // part, or a JSON `null` from a NaN, drops the field — the tile blanks.
    expect(toHealthWidgetPayload(facts({ steps: input })).steps).toBe(expected);
    expect(toHealthWidgetPayload(facts({ waterMl: input })).water_ml).toBe(expected);
  });

  it('HEALTH-WIDGET-046: a non-numeric count is coerced, not passed through', () => {
    const bad = facts({ steps: '7240' as unknown as number });
    expect(toHealthWidgetPayload(bad).steps).toBe(0);
    // A string reaching a Swift `Int?` fails the decode for the WHOLE struct.
    expect(typeof toHealthWidgetPayload(bad).steps).toBe('number');
  });

  it('HEALTH-WIDGET-046: an ABSENT goal stays null — it is not a goal of zero', () => {
    // The Swift drops the "/ goal" caption when the goal is nil. Coercing null
    // to 0 would render "7,240 / 0 steps" and make the water tint's
    // divide-by-zero guard the only thing standing between a user and "goal met".
    const f = facts({ stepsGoal: null, waterGoalMl: null });
    expect(toHealthWidgetPayload(f)).toMatchObject({ steps_goal: null, water_goal_ml: null });
    expect(toHealthWatchPayload(f)).toMatchObject({ steps_goal: null, water_goal_ml: null });
  });

  it('HEALTH-WIDGET-046: a zero or negative goal is reported as absent, not as met', () => {
    expect(toHealthWidgetPayload(facts({ stepsGoal: 0 })).steps_goal).toBeNull();
    expect(toHealthWidgetPayload(facts({ waterGoalMl: -100 })).water_goal_ml).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HEALTH-WIDGET-047 — moveFraction + formatReminderTime
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-047 — the two exported helpers', () => {
  it.each([
    [15, 30, 0.5],
    [30, 30, 1],
    [45, 30, 1],
    [0, 30, 0],
    [-10, 30, 0],
  ])('HEALTH-WIDGET-047: moveFraction(%s, %s) === %s', (done, goal, expected) => {
    expect(moveFraction(done, goal)).toBe(expected);
  });

  it('HEALTH-WIDGET-047: moveFraction has no goal, so it has no ring', () => {
    // Null rather than 0: "no move goal set" is not "you did nothing".
    expect(moveFraction(20, 0)).toBeNull();
    expect(moveFraction(20, -30)).toBeNull();
    expect(moveFraction(Number.NaN, 30)).toBeNull();
    expect(moveFraction(20, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('HEALTH-WIDGET-047: formatReminderTime renders a local label, never an ISO stamp', () => {
    const label = formatReminderTime(LATER_ISO);
    expect(label).not.toBeNull();
    expect(label).not.toContain('T');
    expect(label).not.toContain('Z');
    expect(label).toBe(new Date(LATER_ISO).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }));
  });

  it('HEALTH-WIDGET-047: an unparseable timestamp yields null rather than "Invalid Date"', () => {
    expect(formatReminderTime('soon')).toBeNull();
    expect(formatReminderTime('')).toBeNull();
  });

  it('HEALTH-WIDGET-047: a build without Intl falls back to 24-hour HH:MM', () => {
    // Hermes ships Intl, but a stripped build can lack it and
    // `toLocaleTimeString` throws. The fallback keeps the watch row honest
    // instead of printing an ISO stamp at the member.
    const spy = jest
      .spyOn(Date.prototype, 'toLocaleTimeString')
      .mockImplementation(() => {
        throw new Error('no Intl in this build');
      });
    try {
      const local = new Date(LATER_ISO);
      const expected = `${String(local.getHours()).padStart(2, '0')}:${String(
        local.getMinutes(),
      ).padStart(2, '0')}`;
      expect(formatReminderTime(LATER_ISO)).toBe(expected);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// HEALTH-WIDGET-048 — the reminder mirror
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-048 — setHealthGlanceReminder / loadHealthGlanceReminder', () => {
  it('HEALTH-WIDGET-048: a valid reminder is trimmed and stored under its own key', async () => {
    await setHealthGlanceReminder({ title: '  Evening walk  ', at: LATER_ISO });
    expect(mockSetObject).toHaveBeenCalledWith(HEALTH_GLANCE_REMINDER_KEY, {
      title: 'Evening walk',
      at: LATER_ISO,
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('HEALTH-WIDGET-048: null CLEARS the mirror — a fired reminder must not linger', async () => {
    // A stale "Evening walk at 18:30" on a lock screen at midnight is worse than
    // an empty row: it is wrong, and the member cannot dismiss it.
    await setHealthGlanceReminder(null);
    expect(mockDelete).toHaveBeenCalledWith(HEALTH_GLANCE_REMINDER_KEY);
    expect(mockSetObject).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty title', { title: '   ', at: LATER_ISO }],
    ['an unparseable time', { title: 'Walk', at: 'later today' }],
  ])('HEALTH-WIDGET-048: %s is rejected, not stored half-formed', async (_label, reminder) => {
    await setHealthGlanceReminder(reminder);
    expect(mockDelete).toHaveBeenCalledWith(HEALTH_GLANCE_REMINDER_KEY);
    expect(mockSetObject).not.toHaveBeenCalled();
  });

  it('HEALTH-WIDGET-048: an overlong title is truncated to 120 characters', async () => {
    // The title is user-written and lands verbatim on a lock screen row.
    await setHealthGlanceReminder({ title: 'x'.repeat(400), at: LATER_ISO });
    const stored = mockSetObject.mock.calls[0][1] as { title: string };
    expect(stored.title).toHaveLength(120);
  });

  it('HEALTH-WIDGET-048: passing facts republishes immediately', async () => {
    // A newly scheduled reminder must reach the lock screen now, not at the next
    // Home render.
    await setHealthGlanceReminder({ title: 'Evening walk', at: LATER_ISO }, facts());
    expect(snapshotFor(HEALTH_WIDGET_KEY).next_reminder).toEqual({
      title: 'Evening walk',
      at: LATER_ISO,
    });
    expect(snapshotFor(HEALTH_WATCH_KEY).next_reminder).toBe('Evening walk');
  });

  it('HEALTH-WIDGET-048: a reminder already in the past does not load as "next"', async () => {
    mockGetObject.mockResolvedValue({ title: 'Morning walk', at: EARLIER_ISO });
    expect(await loadHealthGlanceReminder()).toBeNull();
  });

  it('HEALTH-WIDGET-048: a future reminder loads clean', async () => {
    mockGetObject.mockResolvedValue({ title: ' Evening walk ', at: LATER_ISO });
    expect(await loadHealthGlanceReminder()).toEqual({ title: 'Evening walk', at: LATER_ISO });
  });

  it('HEALTH-WIDGET-048: a storage failure degrades to no reminder, never a throw', async () => {
    mockGetObject.mockRejectedValue(new Error('MMKV unavailable'));
    await expect(loadHealthGlanceReminder()).resolves.toBeNull();
  });

  it('HEALTH-WIDGET-048: a corrupt stored value is discarded', async () => {
    mockGetObject.mockResolvedValue({ title: 42, at: 99 });
    expect(await loadHealthGlanceReminder()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HEALTH-WIDGET-049 — publishHealthGlance writes BOTH keys
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-049 — publishHealthGlance', () => {
  it('HEALTH-WIDGET-049: one call feeds the widget AND the watch', async () => {
    // Before this module the watch key had NO writer anywhere in the repo, so
    // the Health watch face could only ever render its empty state (WATCH-005).
    await publishHealthGlance(facts());
    const keys = mockSetSnapshot.mock.calls.map((c) => c[0]);
    expect(keys).toEqual([HEALTH_WIDGET_KEY, HEALTH_WATCH_KEY]);
    expect(keys).toEqual(['widget_health_today', 'watch_health_today']);
  });

  it('HEALTH-WIDGET-049: an omitted date defaults to the local day, not a UTC slice', async () => {
    await publishHealthGlance({
      steps: 1,
      stepsGoal: 10,
      waterMl: 1,
      waterGoalMl: 10,
      movePct: 0,
    });
    // `todayDateKey()` is the device's LOCAL day — the same key every other
    // Health store writes under, so the watch's `date` cannot disagree with it.
    const local = new Date(NOW);
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
      local.getDate(),
    ).padStart(2, '0')}`;
    expect(snapshotFor(HEALTH_WATCH_KEY).date).toBe(expected);
  });

  it('HEALTH-WIDGET-049: an omitted reminder falls back to the mirror', async () => {
    mockGetObject.mockResolvedValue({ title: 'Evening walk', at: LATER_ISO });
    await publishHealthGlance({
      steps: 1,
      stepsGoal: 10,
      waterMl: 1,
      waterGoalMl: 10,
      movePct: 0,
    });
    expect(snapshotFor(HEALTH_WATCH_KEY).next_reminder).toBe('Evening walk');
  });

  it('HEALTH-WIDGET-049: an EXPLICIT null states there is no reminder and skips the mirror', async () => {
    mockGetObject.mockResolvedValue({ title: 'Evening walk', at: LATER_ISO });
    await publishHealthGlance(facts({ nextReminder: null }));
    expect(mockGetObject).not.toHaveBeenCalled();
    expect(snapshotFor(HEALTH_WIDGET_KEY).next_reminder).toBeNull();
  });

  it('HEALTH-WIDGET-049: a failure inside the publish never reaches the caller', async () => {
    // Every call site is a side effect of rendering or of signing in. A glance
    // surface must not be able to break a screen, and there is no message a
    // member could act on.
    mockSetSnapshot.mockImplementationOnce(() => {
      throw new Error('native module exploded');
    });
    await expect(publishHealthGlance(facts())).resolves.toBeUndefined();
  });

  it('HEALTH-WIDGET-049: the widget payload is the full set of ten wire fields, gated by null', async () => {
    // The widget's App Group snapshot now DOES carry weight, nutrition and
    // workouts (see the file header: "The widget now carries weight,
    // nutrition and workouts — deliberately"). `facts()` leaves those five
    // domains at their default `null` — a caller with nothing to report still
    // publishes a snapshot shaped like every other one, not a truncated one.
    await publishHealthGlance(facts({ nextReminder: { title: 'Evening walk', at: LATER_ISO } }));
    const widget = Object.keys(snapshotFor(HEALTH_WIDGET_KEY)).sort();
    expect(widget).toEqual([
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
  });

  it('HEALTH-WIDGET-049: the watch payload is UNCHANGED — no weight, nutrition, cycle or vitality', async () => {
    // The watch is a separate, smaller surface; the privacy-reversal decision
    // was scoped to the widget only (see the file header).
    await publishHealthGlance(facts({ nextReminder: { title: 'Evening walk', at: LATER_ISO } }));
    const watch = Object.keys(snapshotFor(HEALTH_WATCH_KEY)).sort();
    expect(watch).toEqual([
      'date',
      'move_goal_percent',
      'next_reminder',
      'next_reminder_time',
      'steps',
      'steps_goal',
      'water_goal_ml',
      'water_ml',
    ]);
    const serialised = JSON.stringify(snapshotFor(HEALTH_WATCH_KEY));
    for (const forbidden of ['weight', 'calories', 'nutrition', 'cycle', 'period', 'libido']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('HEALTH-WIDGET-049: cycle, period and vitality words never reach EITHER payload', async () => {
    // Weight/nutrition/calories are now legitimate WIDGET keys (asserted
    // above), but the domains this app never puts on a lock screen at all —
    // cycle, period, vitality — must still be absent everywhere.
    await publishHealthGlance(
      facts({
        nextReminder: { title: 'Evening walk', at: LATER_ISO },
        weight: { value: 70.5, unit: 'kg', date: '2026-07-13' },
        nutrition: {
          calories: 1800,
          proteins: 90,
          carbohydrates: 200,
          fats: 60,
          goalCalories: 2000,
          proteinTarget: 120,
          carbsTarget: 250,
          fatsTarget: 65,
        },
      })
    );
    const serialised = JSON.stringify(mockSetSnapshot.mock.calls);
    for (const forbidden of ['cycle', 'period', 'libido', 'symptom']) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// HEALTH-WIDGET-050 — server snapshot → facts → both faces
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-050 — factsFromWidgetSnapshot / syncHealthGlanceFromServer', () => {
  it('HEALTH-WIDGET-050: the server snapshot maps onto the glance facts', async () => {
    const f = factsFromWidgetSnapshot(serverSnapshot(), 30);
    expect(f).toEqual({
      date: '2026-07-13',
      steps: 7240,
      stepsGoal: 10000,
      waterMl: 1200,
      waterGoalMl: 2000,
      movePct: 0.5, // 15 workout minutes against a 30-minute device goal
      nextReminder: null,
      weight: { value: 70.5, unit: 'kg', date: '2026-07-13' },
      weightTrend: {
        unit: 'kg',
        entries: [{ date: '2026-07-13', weight: 70.5 }],
        avgThisWeek: 70.8,
        avgLastWeek: 71.2,
        startingWeightKg: 80,
        startingWeightDate: '2026-01-01',
        progressFromStart: -9.5,
        progressPercentage: -11.9,
      },
      nutrition: null,
      nutritionTrend: null,
      workouts: { count: 1, minutes: 15, calories: 250, goalMinutes: 30 },
      preferences: prefs(),
    });
  });

  it('HEALTH-WIDGET-050: move needs BOTH sides — the server has minutes, the device has the goal', async () => {
    // The snapshot carries today's workout MINUTES; the move goal lives in
    // `health.activityGoals.v1` on the device. Neither can draw the ring alone.
    expect(factsFromWidgetSnapshot(serverSnapshot(), 0).movePct).toBeNull();
    expect(factsFromWidgetSnapshot(serverSnapshot({ workouts: null }), 30).movePct).toBeNull();
  });

  it('HEALTH-WIDGET-050: show_workouts=false legitimately removes the ring', () => {
    // `workouts: null` is the member's privacy toggle doing its job, not a
    // missing read — so the ring is absent rather than zero.
    const f = factsFromWidgetSnapshot(serverSnapshot({ workouts: null }), 30);
    expect(toHealthWidgetPayload(f).move_pct).toBeNull();
    expect(toHealthWatchPayload(f).move_goal_percent).toBeNull();
  });

  it('HEALTH-WIDGET-050: a cold account maps to zeros with null goals', () => {
    const f = factsFromWidgetSnapshot(
      serverSnapshot({
        steps: { value: 0, goal: null },
        water: { total_ml: 0, goal_ml: null },
        workouts: { count: 0, minutes: 0, calories: 0, goal_minutes: null },
      }),
      30,
    );
    expect(f).toMatchObject({ steps: 0, stepsGoal: null, waterMl: 0, waterGoalMl: null });
    expect(f.movePct).toBe(0);
  });

  it('HEALTH-WIDGET-050: a server payload missing whole blocks still maps to zeros', async () => {
    // The Worker always sends `steps` and `water`, but an older/newer deploy or
    // a truncated response must not throw inside a render side effect. The
    // optional chains are the only thing between that and a blank glance.
    const partial = { date: '2026-07-13' } as unknown as HealthWidgetSnapshot;
    expect(factsFromWidgetSnapshot(partial, 30)).toMatchObject({
      steps: 0,
      stepsGoal: null,
      waterMl: 0,
      waterGoalMl: null,
      movePct: null,
    });
  });

  it('HEALTH-WIDGET-050: sync pulls the snapshot and publishes both faces', async () => {
    mockGetSnapshot.mockResolvedValue({ snapshot: serverSnapshot() });
    await expect(syncHealthGlanceFromServer('2026-07-13')).resolves.toBe(true);
    expect(mockGetSnapshot).toHaveBeenCalledWith('2026-07-13');
    expect(mockSetSnapshot.mock.calls.map((c) => c[0])).toEqual([
      HEALTH_WIDGET_KEY,
      HEALTH_WATCH_KEY,
    ]);
    expect(snapshotFor(HEALTH_WIDGET_KEY)).toMatchObject({ steps: 7240, move_pct: 0.5 });
  });

  it('HEALTH-WIDGET-050: a failed request keeps the LAST published snapshot', async () => {
    // Offline or signed out. Overwriting a good glance with zeros would make the
    // lock screen claim the member did nothing today.
    mockGetSnapshot.mockRejectedValue(new Error('offline'));
    await expect(syncHealthGlanceFromServer()).resolves.toBe(false);
    expect(mockSetSnapshot).not.toHaveBeenCalled();
  });

  it('HEALTH-WIDGET-050: an empty envelope is treated as a failure, not as an empty day', async () => {
    mockGetSnapshot.mockResolvedValue({});
    await expect(syncHealthGlanceFromServer()).resolves.toBe(false);
    expect(mockSetSnapshot).not.toHaveBeenCalled();
  });

  it('HEALTH-WIDGET-050: an unreadable move goal drops the ring but still publishes', async () => {
    // The goal is a device preference; losing it must not cost the member their
    // steps and water too.
    mockGetSnapshot.mockResolvedValue({ snapshot: serverSnapshot() });
    mockLoadActivityGoals.mockRejectedValue(new Error('MMKV unavailable'));
    await expect(syncHealthGlanceFromServer()).resolves.toBe(true);
    expect(snapshotFor(HEALTH_WIDGET_KEY)).toMatchObject({ move_pct: null, steps: 7240 });
  });

  it('HEALTH-WIDGET-050: the sync carries the mirrored reminder', async () => {
    mockGetSnapshot.mockResolvedValue({ snapshot: serverSnapshot() });
    mockGetObject.mockResolvedValue({ title: 'Evening walk', at: LATER_ISO });
    await syncHealthGlanceFromServer();
    expect(snapshotFor(HEALTH_WIDGET_KEY).next_reminder).toEqual({
      title: 'Evening walk',
      at: LATER_ISO,
    });
  });
});

// ---------------------------------------------------------------------------
// HEALTH-WIDGET-052 — a lightweight publish must not blank a fuller one
// ---------------------------------------------------------------------------
//
// `HealthHomeScreen`'s steps/water effect calls `publishHealthGlance` with
// only the lightweight facts on nearly every render — far more often than a
// full `syncHealthGlanceFromServer()` runs. Before the extras mirror existed,
// that lightweight call defaulted the five widget-only domains to `null`,
// so the Large widget's nutrition/trend sections went blank moments after
// being populated (the widget rendered as just a ring row on an otherwise
// empty card).

describe('HEALTH-WIDGET-052 — the extras mirror survives a lightweight publish', () => {
  const nutrition = {
    calories: 1450,
    proteins: 90,
    carbohydrates: 140,
    fats: 50,
    goalCalories: 2000,
    proteinTarget: 120,
    carbsTarget: 250,
    fatsTarget: 65,
  };

  it('HEALTH-WIDGET-052: an omitted domain falls back to the mirror, not null', async () => {
    mockGetObject.mockImplementation(async (key: string) =>
      key === HEALTH_GLANCE_EXTRAS_KEY
        ? { weight: null, weightTrend: null, nutrition, nutritionTrend: null, workouts: null, preferences: null }
        : null,
    );
    // The lightweight Home-screen shape: steps/water/move only.
    await publishHealthGlance({ steps: 1, stepsGoal: 10, waterMl: 1, waterGoalMl: 10, movePct: 0 });
    expect(snapshotFor(HEALTH_WIDGET_KEY).nutrition).toEqual({
      calories: 1450,
      proteins: 90,
      carbohydrates: 140,
      fats: 50,
      goal_calories: 2000,
      protein_target: 120,
      carbs_target: 250,
      fats_target: 65,
    });
  });

  it('HEALTH-WIDGET-052: an EXPLICIT null (e.g. a show_* toggle switching off) still clears it', async () => {
    mockGetObject.mockImplementation(async (key: string) =>
      key === HEALTH_GLANCE_EXTRAS_KEY
        ? { weight: null, weightTrend: null, nutrition, nutritionTrend: null, workouts: null, preferences: null }
        : null,
    );
    await publishHealthGlance(facts({ nutrition: null }));
    expect(snapshotFor(HEALTH_WIDGET_KEY).nutrition).toBeNull();
  });

  it('HEALTH-WIDGET-052: a full publish updates the mirror for the next lightweight one', async () => {
    await publishHealthGlance(factsFromWidgetSnapshot(serverSnapshot({ nutrition: { calories: 1450, proteins: 90, carbohydrates: 140, fats: 50, goal_calories: 2000, protein_target: 120, carbs_target: 250, fats_target: 65 } }), 30));
    expect(mockSetObject).toHaveBeenCalledWith(
      HEALTH_GLANCE_EXTRAS_KEY,
      expect.objectContaining({ nutrition: expect.objectContaining({ calories: 1450 }) }),
    );
  });

  it('HEALTH-WIDGET-052: every domain provided explicitly skips the mirror read entirely', async () => {
    await publishHealthGlance(facts());
    expect(mockGetObject).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HEALTH-WIDGET-051 — the widget-preference client
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-051 — widget preferences client', () => {
  it('HEALTH-WIDGET-051: the client defaults mirror the migration-0120/0144 columns', () => {
    // A client default that disagrees with the column default makes the settings
    // screen show a choice the server never stored.
    expect(DEFAULT_HEALTH_WIDGET_PREFERENCES).toEqual({
      small_widget_metric: 'steps',
      chart_type: 'bar',
      chart_metric: 'weight',
      show_weight: true,
      show_nutrition: true,
      show_workouts: true,
      small_widget_style: 'standard',
      medium_widget_layout: 'standard',
      medium_primary_metric: 'steps',
      medium_secondary_metric: 'calories',
      medium_show_all_metrics: true,
    });
  });

  it('HEALTH-WIDGET-051: a server read is merged onto the defaults', async () => {
    mockGetPrefs.mockResolvedValue({ preferences: prefs({ small_widget_metric: 'water' }) });
    await expect(loadWidgetPreferences()).resolves.toEqual(prefs({ small_widget_metric: 'water' }));
    expect(mockReadThrough).toHaveBeenCalledWith(
      HEALTH_WIDGET_PREFS_KEY,
      expect.any(Function),
      DEFAULT_HEALTH_WIDGET_PREFERENCES,
    );
  });

  it('HEALTH-WIDGET-051: a partial server payload keeps the defaults for the rest', async () => {
    // An older Worker that does not know a newer key must not blank it.
    mockGetPrefs.mockResolvedValue({
      preferences: { small_widget_metric: 'calories', chart_type: 'line', show_weight: false },
    });
    await expect(loadWidgetPreferences()).resolves.toEqual(
      prefs({ small_widget_metric: 'calories', chart_type: 'line', show_weight: false }),
    );
  });

  it('HEALTH-WIDGET-051: a garbage payload degrades to the defaults', async () => {
    mockGetPrefs.mockResolvedValue({ preferences: 'not an object' });
    await expect(loadWidgetPreferences()).resolves.toEqual(DEFAULT_HEALTH_WIDGET_PREFERENCES);
  });

  it('HEALTH-WIDGET-051: an offline read falls back through the cache to the defaults', async () => {
    mockGetPrefs.mockRejectedValue(new Error('offline'));
    await expect(loadWidgetPreferences()).resolves.toEqual(DEFAULT_HEALTH_WIDGET_PREFERENCES);
  });

  it('HEALTH-WIDGET-051: a stale cache of the wrong shape degrades to the defaults', async () => {
    // `readThrough` hands back whatever the cache holds when the network fails.
    // A row written by an older build (or a corrupt MMKV value) must not reach
    // the settings screen as if it were current.
    mockReadThrough.mockResolvedValue({ small_widget_metric: 'water' });
    await expect(loadWidgetPreferences()).resolves.toEqual(DEFAULT_HEALTH_WIDGET_PREFERENCES);
  });

  it('HEALTH-WIDGET-051: a save sends ONLY the changed keys', async () => {
    // The route PATCH-merges. A client that posted the whole object would
    // overwrite a field a newer build knows about and this one does not.
    mockGetPrefs.mockResolvedValue({ preferences: prefs() });
    mockSavePrefs.mockResolvedValue({ preferences: prefs({ show_weight: false }) });
    mockGetSnapshot.mockResolvedValue({ snapshot: serverSnapshot() });

    const result = await saveWidgetPreferences({ show_weight: false });
    expect(mockSavePrefs).toHaveBeenCalledWith({ show_weight: false });
    expect(result.status).toBe('saved');
    expect(result.message).toBeNull();
    expect(result.preferences.show_weight).toBe(false);
    expect(mockSetObject).toHaveBeenCalledWith(HEALTH_WIDGET_PREFS_KEY, result.preferences);
  });

  it('HEALTH-WIDGET-051: a save republishes the glance so the lock screen updates now', async () => {
    mockGetPrefs.mockResolvedValue({ preferences: prefs() });
    mockSavePrefs.mockResolvedValue({ preferences: prefs({ show_workouts: false }) });
    mockGetSnapshot.mockResolvedValue({ snapshot: serverSnapshot({ workouts: null }) });

    await saveWidgetPreferences({ show_workouts: false });
    // The republish is fire-and-forget, so let its microtasks drain.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockGetSnapshot).toHaveBeenCalled();
  });

  it('HEALTH-WIDGET-051: an offline save keeps the choice and says so in plain words', async () => {
    // No raw error string may ever reach the UI (the no-raw-error-leaks rule).
    mockGetPrefs.mockResolvedValue({ preferences: prefs() });
    mockSavePrefs.mockRejectedValue(new Error('Network Error: ECONNREFUSED 127.0.0.1:8787'));

    const result = await saveWidgetPreferences({ chart_type: 'line' });
    expect(result.status).toBe('offline');
    expect(result.message).toBe(WIDGET_PREFS_OFFLINE_MESSAGE);
    expect(result.message).not.toMatch(/error|ECONNREFUSED|undefined/i);
    expect(result.preferences.chart_type).toBe('line');
    // The optimistic value is cached so the settings row shows the member's own
    // choice back to them; the next successful read replaces it wholesale.
    expect(mockSetObject).toHaveBeenCalledWith(HEALTH_WIDGET_PREFS_KEY, result.preferences);
  });

  it('HEALTH-WIDGET-051: a nonsense server response falls back to the optimistic value', async () => {
    mockGetPrefs.mockResolvedValue({ preferences: prefs() });
    mockSavePrefs.mockResolvedValue({ preferences: null });
    mockGetSnapshot.mockResolvedValue({ snapshot: serverSnapshot() });

    const result = await saveWidgetPreferences({ small_widget_metric: 'water' });
    expect(result.status).toBe('saved');
    expect(result.preferences.small_widget_metric).toBe('water');
  });

  it.each([
    ['everything on', prefs(), 'Steps, plus weight, nutrition, workouts'],
    [
      'one domain hidden',
      prefs({ small_widget_metric: 'water', show_nutrition: false }),
      'Water, plus weight, workouts',
    ],
    [
      'every domain hidden',
      prefs({ show_weight: false, show_nutrition: false, show_workouts: false }),
      'Steps only',
    ],
  ])(
    'HEALTH-WIDGET-051: describeWidgetPreferences summarises %s',
    (_label, input, expected) => {
      expect(describeWidgetPreferences(input as HealthWidgetPreferences)).toBe(expected);
    },
  );

  it('HEALTH-WIDGET-051: an unknown stored metric still produces a readable summary', () => {
    // Defends the settings subtitle against a value a newer build introduced.
    expect(
      describeWidgetPreferences({
        ...prefs(),
        small_widget_metric: 'bpm' as never,
      }),
    ).toBe('Steps, plus weight, nutrition, workouts');
  });
});
