/**
 * Symply Health — the WEIGHT GOAL store and the Weight-tab layout.
 *
 * Two contracts live here, and the first one is the reason this file exists:
 *
 * 1. **The pre-0125 Worker.** Migration 0125 adds the goal columns but is not
 *    applied yet, and the deployed Worker's `PUT /goals` validates with a
 *    `z.object`, which STRIPS unknown keys and answers 200. So a member can set
 *    a goal today and the server will discard it silently. The store tells the
 *    two server generations apart by KEY PRESENCE — an absent
 *    `target_weight_kg` means "this Worker cannot store a goal, keep the cached
 *    one", an explicit `null` means "the member cleared it, drop it". Collapsing
 *    those two would either lose every goal until deploy day or make "clear my
 *    goal" impossible. Both halves are pinned below.
 *
 * 2. **Units.** The target is stored in canonical kilograms while a weight ENTRY
 *    keeps whatever unit was typed. A member who sets 165 lb and then reads it
 *    back must see 165 lb, not 74.8 kg or a drifted 164.9 lb.
 */

import { healthApi, type HealthGoal } from '@api/health';
import { storageHelpers } from '@services/storage';

import { __setHealthOfflineForTests } from '../healthRepository';
import { HEALTH_WEIGHT_GOAL_KEY } from '../healthWeightStorage';
import {
  DEFAULT_WEIGHT_LAYOUT,
  HEALTH_WEIGHT_LAYOUT_KEY,
  clearWeightGoal,
  hasServerWeightGoalSupport,
  kgToLb,
  lbToKg,
  loadWeightGoal,
  loadWeightLayout,
  moveWidget,
  saveWeightGoal,
  saveWeightLayout,
  toggleWidget,
  weightInUnit,
  weightToKg,
} from '../healthWeightStorage';
import { goalRow, ok, type MockedHealthApi } from '../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

/** A goal row from a Worker that HAS 0125 — every key present, null when unset. */
function modernGoal(over: Partial<HealthGoal> = {}): HealthGoal {
  return goalRow({
    target_weight_kg: null,
    weight_goal_type: null,
    starting_weight_kg: null,
    starting_weight_date: null,
    height_cm: null,
    gender: null,
    birth_year: null,
    activity_level: null,
    ...over,
  });
}

/** A goal row from the DEPLOYED Worker — the 0125 keys simply do not exist. */
function legacyGoal(): HealthGoal {
  return goalRow();
}

/** A `PUT /goals` that MERGES like the real service, so a patch is not a replace. */
function fakeGoalServer(initial: HealthGoal) {
  const state = { goal: initial };
  api.getGoal.mockImplementation(() => Promise.resolve(ok({ goal: state.goal })));
  api.saveGoal.mockImplementation((body) => {
    state.goal = { ...state.goal, ...body } as HealthGoal;
    return Promise.resolve(ok({ goal: state.goal }));
  });
  return state;
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
  __setHealthOfflineForTests(false);
  await storageHelpers.delete(HEALTH_WEIGHT_GOAL_KEY);
  await storageHelpers.delete(HEALTH_WEIGHT_LAYOUT_KEY);
  fakeGoalServer(modernGoal());
});

afterEach(() => {
  jest.useRealTimers();
  __setHealthOfflineForTests(false);
});

/* ------------------------------------------------------------------ */
/* Unit conversion                                                     */
/* ------------------------------------------------------------------ */

describe('weight goal — units', () => {
  it('HEALTH-WEIGHT-200: kg↔lb round-trips through ONE factor, in both directions', () => {
    // Two independently rounded constants (2.205 and 0.4536) drift by ~40 g at
    // 80 kg, which is enough to move a one-decimal display.
    expect(kgToLb(1)).toBeCloseTo(2.2046226218, 9);
    expect(lbToKg(kgToLb(74.8))).toBeCloseTo(74.8, 9);
  });

  it('HEALTH-WEIGHT-201: a goal typed in pounds reads back in pounds, unchanged', async () => {
    await saveWeightGoal({ target: 165, unit: 'lb' });
    const goal = await loadWeightGoal();
    expect(goal.unit).toBe('lb');
    expect(weightInUnit(goal.targetKg as number, 'lb')).toBe(165);
  });

  it('HEALTH-WEIGHT-202: the wire value is canonical KILOGRAMS whatever was typed', async () => {
    await saveWeightGoal({ target: 165, unit: 'lb' });
    // Full precision on the wire, not a one-decimal kg: rounding 74.84 to 74.8
    // reads back as 164.9 lb, so the member's own number would change under them.
    expect(api.saveGoal).toHaveBeenCalledWith(
      expect.objectContaining({ target_weight_kg: weightToKg(165, 'lb') })
    );
    expect((api.saveGoal.mock.calls[0][0] as { target_weight_kg: number }).target_weight_kg)
      .toBeCloseTo(74.84, 2);
  });
});

/* ------------------------------------------------------------------ */
/* Server generations                                                  */
/* ------------------------------------------------------------------ */

describe('weight goal — the pre-0125 Worker', () => {
  it('HEALTH-WEIGHT-210: KEY PRESENCE is what identifies a 0125-capable server', () => {
    expect(hasServerWeightGoalSupport(modernGoal())).toBe(true);
    expect(hasServerWeightGoalSupport(legacyGoal())).toBe(false);
    expect(hasServerWeightGoalSupport(null)).toBe(false);
  });

  it('HEALTH-WEIGHT-211: a server that omits the keys does NOT wipe the cached goal', async () => {
    // Otherwise a member sets a target, the next read answers "no target", and
    // the goal line disappears the moment the screen refreshes.
    await storageHelpers.setObject(HEALTH_WEIGHT_GOAL_KEY, {
      targetKg: 74,
      unit: 'kg',
      goalType: null,
      startingKg: null,
      startingDate: null,
      heightCm: 178,
      gender: null,
      birthYear: null,
      activityLevel: null,
    });
    fakeGoalServer(legacyGoal());

    const goal = await loadWeightGoal();
    expect(goal.targetKg).toBe(74);
    expect(goal.heightCm).toBe(178);
  });

  it('HEALTH-WEIGHT-212: an explicit NULL from a 0125 server DOES clear the cached goal', async () => {
    await storageHelpers.setObject(HEALTH_WEIGHT_GOAL_KEY, {
      ...DEFAULT_GOAL_SHAPE,
      targetKg: 74,
    });
    fakeGoalServer(modernGoal({ target_weight_kg: null }));

    // Otherwise "clear my goal" is undone by the next read.
    expect((await loadWeightGoal()).targetKg).toBeNull();
  });

  it('HEALTH-WEIGHT-213: a goal set against a pre-0125 server still shows on THIS device', async () => {
    fakeGoalServer(legacyGoal());
    const saved = await saveWeightGoal({ target: 74, unit: 'kg' });
    expect(saved.targetKg).toBe(74);
    expect((await loadWeightGoal()).targetKg).toBe(74);
  });
});

/* ------------------------------------------------------------------ */
/* Patching                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_GOAL_SHAPE = {
  targetKg: null,
  unit: 'kg' as const,
  goalType: null,
  startingKg: null,
  startingDate: null,
  heightCm: null,
  gender: null,
  birthYear: null,
  activityLevel: null,
};

describe('weight goal — patching', () => {
  it('HEALTH-WEIGHT-220: sends ONLY the keys the caller changed', async () => {
    await saveWeightGoal({ heightCm: 178 });
    expect(api.saveGoal).toHaveBeenCalledWith({ height_cm: 178 });
    // A screen that never asked about the target must not be able to clear it.
    expect(api.saveGoal.mock.calls[0][0]).not.toHaveProperty('target_weight_kg');
  });

  it('HEALTH-WEIGHT-221: an omitted key keeps its stored value; an explicit null clears it', async () => {
    fakeGoalServer(modernGoal({ target_weight_kg: 74, height_cm: 178 }));

    await saveWeightGoal({ heightCm: 180 });
    expect((await loadWeightGoal()).targetKg).toBe(74);

    await saveWeightGoal({ target: null });
    expect((await loadWeightGoal()).targetKg).toBeNull();
    expect((await loadWeightGoal()).heightCm).toBe(180);
  });

  it('HEALTH-WEIGHT-222: setting a baseline stamps TODAY, and clearing it drops the date', async () => {
    // A baseline weight with no date renders as an undated "40% complete".
    await saveWeightGoal({ starting: 90, unit: 'kg' });
    expect(api.saveGoal).toHaveBeenCalledWith(
      expect.objectContaining({ starting_weight_kg: 90, starting_weight_date: TODAY })
    );

    api.saveGoal.mockClear();
    await saveWeightGoal({ starting: null });
    expect(api.saveGoal).toHaveBeenCalledWith(
      expect.objectContaining({ starting_weight_kg: null, starting_weight_date: null })
    );
  });

  it('HEALTH-WEIGHT-223: clearWeightGoal drops the target and its type, keeping biometrics', async () => {
    fakeGoalServer(modernGoal({ target_weight_kg: 74, height_cm: 178, gender: 'female' }));
    const cleared = await clearWeightGoal();
    expect(cleared.targetKg).toBeNull();
    expect(cleared.goalType).toBeNull();
    expect(cleared.heightCm).toBe(178);
    expect(cleared.gender).toBe('female');
  });

  it('HEALTH-WEIGHT-224: an offline write still shows the value the member just entered', async () => {
    __setHealthOfflineForTests(true);
    const saved = await saveWeightGoal({ target: 74, unit: 'kg' });
    expect(saved.targetKg).toBe(74);
    // …and survives to the next read from the cache, never as a raw error.
    __setHealthOfflineForTests(true);
    expect((await loadWeightGoal()).targetKg).toBe(74);
  });

  it('HEALTH-WEIGHT-225: a read with no goal at all yields the empty shape, not undefined fields', async () => {
    api.getGoal.mockResolvedValue(ok({ goal: null }));
    expect(await loadWeightGoal()).toEqual(DEFAULT_GOAL_SHAPE);
  });

  it('HEALTH-WEIGHT-226: the body-details pickers each send their own column, and it sticks', async () => {
    // Sex and activity are their own one-tap rows in Goal & body details, so
    // each arrives as a patch of one key. Sending the whole object instead would
    // let the Sex row clear a height the member typed on the row above it.
    await saveWeightGoal({ gender: 'female' });
    expect(api.saveGoal).toHaveBeenCalledWith({ gender: 'female' });

    api.saveGoal.mockClear();
    const saved = await saveWeightGoal({ birthYear: 1990, activityLevel: 'veryActive' });
    expect(api.saveGoal).toHaveBeenCalledWith({ birth_year: 1990, activity_level: 'veryActive' });

    // …and all three are still there afterwards — this is what BMR and daily
    // burn are computed from, so losing one blanks both figures.
    expect(saved).toMatchObject({ gender: 'female', birthYear: 1990, activityLevel: 'veryActive' });
    expect(await loadWeightGoal()).toMatchObject({
      gender: 'female',
      birthYear: 1990,
      activityLevel: 'veryActive',
    });
  });

  it('HEALTH-WEIGHT-227: correcting the baseline DATE alone leaves the baseline weight alone', async () => {
    fakeGoalServer(modernGoal({ starting_weight_kg: 90, starting_weight_date: TODAY }));

    const saved = await saveWeightGoal({ startingDate: '2026-01-05' });
    // Only the date travels: re-sending the weight would let a screen that is
    // fixing a typo in the date overwrite the baseline itself.
    expect(api.saveGoal).toHaveBeenCalledWith({ starting_weight_date: '2026-01-05' });
    expect(saved.startingDate).toBe('2026-01-05');
    expect(saved.startingKg).toBe(90);
  });

  it('HEALTH-WEIGHT-228: a pre-0125 server does not swallow the biometric just entered', async () => {
    // The deployed Worker strips these keys and answers 200, so the re-read can
    // only echo the PRE-write cache back. Believing it discarded everything the
    // member had just chosen except a target weight: picking "Female" on the
    // Sex row reverted to unset the moment the row re-rendered.
    fakeGoalServer(legacyGoal());

    const saved = await saveWeightGoal({ gender: 'female' });
    expect(saved.gender).toBe('female');
    expect((await loadWeightGoal()).gender).toBe('female');

    const withHeight = await saveWeightGoal({ heightCm: 178, activityLevel: 'sedentary' });
    expect(withHeight).toMatchObject({ heightCm: 178, activityLevel: 'sedentary', gender: 'female' });
  });
});

/* ------------------------------------------------------------------ */
/* Dashboard layout                                                    */
/* ------------------------------------------------------------------ */

describe('weight dashboard layout', () => {
  it('HEALTH-WEIGHT-230: defaults to two dashboard widgets, in order — goalProgress, weeklyChange and dataStack are not among them', async () => {
    expect((await loadWeightLayout()).widgets).toEqual(['mainChart', 'aiInsights']);
    expect(DEFAULT_WEIGHT_LAYOUT.chartMode).toBe('trend');
    // Matches the donor's own `WeightDashboardLayoutManager.showValues` default.
    expect(DEFAULT_WEIGHT_LAYOUT.showValues).toBe(false);
  });

  it('HEALTH-WEIGHT-356: showValues persists like every other layout flag', async () => {
    const layout = await saveWeightLayout({ showValues: true });
    expect(layout.showValues).toBe(true);
    expect((await loadWeightLayout()).showValues).toBe(true);
  });

  it('HEALTH-WEIGHT-231: a patch persists and merges with what is already stored', async () => {
    await saveWeightLayout({ chartMode: 'change' });
    const layout = await saveWeightLayout({ windowDays: 90 });
    expect(layout.chartMode).toBe('change');
    expect(layout.windowDays).toBe(90);
    expect((await loadWeightLayout()).windowDays).toBe(90);
  });

  it('HEALTH-WEIGHT-232: an EMPTY stored widget list degrades to the default', async () => {
    // An empty dashboard would render a blank tab with no way back to it.
    await storageHelpers.setObject(HEALTH_WEIGHT_LAYOUT_KEY, { widgets: [] });
    expect((await loadWeightLayout()).widgets).toEqual(DEFAULT_WEIGHT_LAYOUT.widgets);
  });

  it('HEALTH-WEIGHT-233: a corrupt stored list is filtered rather than rendered', async () => {
    await storageHelpers.setObject(HEALTH_WEIGHT_LAYOUT_KEY, {
      widgets: ['mainChart', 42, null, 'streaks'],
    });
    expect((await loadWeightLayout()).widgets).toEqual(['mainChart', 'streaks']);
  });

  it('HEALTH-WEIGHT-234: moveWidget reorders, and refuses to walk off either end', () => {
    const list = ['a', 'b', 'c'];
    expect(moveWidget(list, 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveWidget(list, 'a', -1)).toBe(list);
    expect(moveWidget(list, 'c', 1)).toBe(list);
    expect(moveWidget(list, 'missing', 1)).toBe(list);
  });

  it('HEALTH-WEIGHT-235: toggleWidget adds, removes, and refuses to hide the LAST one', () => {
    expect(toggleWidget(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleWidget(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleWidget(['a'], 'a')).toEqual(['a']);
  });
});
