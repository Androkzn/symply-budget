import type {
  HealthCycleSettings,
  HealthCycleSymptomEntry,
  HealthEntry,
  HealthGoal,
  HealthHabit,
  HealthMeasurement,
  HealthMensEntry,
  HealthNutritionEntry,
  HealthPeriodEntry,
  HealthWaterEntry,
  HealthWaterSummary,
  HealthWeightEntry,
} from '@api/health';

/**
 * Shared wire fixtures for the Symply Health store suites.
 *
 * Parity phase P1 moved the record of truth from MMKV to the
 * `symply-health-api` Worker, so every store suite now has to (a) assert the
 * EXACT method + payload each writer sends and (b) feed real-shaped rows back
 * through the `fromWire*` mappers. Hand-writing full donor rows (user_id,
 * created_at, updated_at, deleted_at, …) in every test would bury the one field
 * each case is actually about, so the row builders below fill the boilerplate
 * and take a `Partial` override for the interesting column.
 *
 * Only side-effect-free fixtures live here — `jest.mock('@api/health')` stays in
 * each test file (same rule as `kaizenScreenTestKit`).
 */

/** The api client resolves the `{ data }` envelope, not the raw axios response. */
/**
 * A successful response body.
 *
 * The Health Worker returns the payload BARE — `c.json({ entries })` — with no
 * wrapping middleware, and `src/api/health.ts` calls `apiClient` directly, so
 * the body IS the payload. This helper used to wrap in `{ data }`, which made
 * every repository test pass while every live read resolved `undefined`. It is
 * an identity function now, kept so call sites still read as "an OK response"
 * and so there is one obvious place to change if the envelope ever gains a
 * wrapper for real.
 */
export function ok<T>(data: T): T {
  return data;
}

/**
 * A failed request. The repository must swallow this and fall back to the
 * cache — a network error may never blank a screen or leak a raw error string.
 */
export const NETWORK_ERROR = new Error('Network request failed');

export type MockedHealthApi = jest.Mocked<typeof import('@api/health').healthApi>;

const ISO = '2026-07-13T08:00:00.000Z';

export function weightRow(over: Partial<HealthWeightEntry> = {}): HealthWeightEntry {
  return {
    id: 'weight-1',
    user_id: 'user-1',
    date: '2026-07-13',
    weight: 70,
    unit: 'kg',
    note: null,
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
    ...over,
  };
}

export function waterEntryRow(over: Partial<HealthWaterEntry> = {}): HealthWaterEntry {
  return {
    id: 'water-1',
    user_id: 'user-1',
    date: '2026-07-13',
    amount_ml: 240,
    beverage_type: 'water',
    container: null,
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
    ...over,
  };
}

export function waterSummaryRow(over: Partial<HealthWaterSummary> = {}): HealthWaterSummary {
  return {
    date: '2026-07-13',
    total_ml: 0,
    goal_ml: null,
    entry_count: 0,
    ...over,
  };
}

export function nutritionRow(over: Partial<HealthNutritionEntry> = {}): HealthNutritionEntry {
  return {
    id: 'meal-1',
    user_id: 'user-1',
    date: '2026-07-13',
    food_name: 'Soup',
    portion: 1,
    unit: 'serving',
    meal_type: 'lunch',
    calories: 300,
    proteins: 10,
    carbohydrates: 40,
    fats: 5,
    // 0124 provenance + basis. NULL by default, which is what a hand-typed row
    // and every pre-0124 row look like — a fixture that wants the re-portionable
    // shape has to say so, so a test cannot pass on a basis it never set up.
    food_id: null,
    base_calories_per_100: null,
    base_proteins_per_100: null,
    base_carbs_per_100: null,
    base_fats_per_100: null,
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
    ...over,
  };
}

export function measurementRow(over: Partial<HealthMeasurement> = {}): HealthMeasurement {
  return {
    id: 'measure-1',
    user_id: 'user-1',
    date: '2026-07-13',
    chest: null,
    waist: null,
    hips: null,
    left_arm: null,
    right_arm: null,
    left_thigh: null,
    right_thigh: null,
    neck: null,
    shoulders: null,
    left_calf: null,
    right_calf: null,
    left_forearm: null,
    right_forearm: null,
    body_fat_percentage: null,
    unit: 'cm',
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
    ...over,
  };
}

/** Generic `health_entries` row — `data` is a JSON STRING, as D1 stores it. */
export function healthEntryRow(over: Partial<HealthEntry> = {}): HealthEntry {
  return {
    id: 'entry-1',
    user_id: 'user-1',
    date: '2026-07-13',
    entry_type: 'workout',
    data: '{}',
    source: 'manual',
    // 0124. NULL is "not recorded", which is also what every pre-0124 row and
    // every default-picker session looks like.
    intensity: null,
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
    ...over,
  };
}

export function workoutRow(
  payload: { workout_type?: string; minutes?: number; calories?: number; note?: string },
  over: Partial<HealthEntry> = {}
): HealthEntry {
  return healthEntryRow({ entry_type: 'workout', data: JSON.stringify(payload), ...over });
}

export function stepsRow(steps: number, over: Partial<HealthEntry> = {}): HealthEntry {
  return healthEntryRow({ entry_type: 'steps', data: JSON.stringify({ steps }), ...over });
}

export function habitRow(over: Partial<HealthHabit> = {}): HealthHabit {
  return {
    id: 'habit-1',
    user_id: 'user-1',
    name: 'Sleep 7+ hours',
    icon: 'sleep-habit',
    category: 'wellness',
    sort_order: 0,
    days: [],
    streak: 0,
    created_at: ISO,
    updated_at: ISO,
    ...over,
  };
}

export function goalRow(over: Partial<HealthGoal> = {}): HealthGoal {
  return {
    id: 'goal-1',
    user_id: 'user-1',
    effective_date: '2026-07-01',
    daily_calories: 2000,
    use_per_day_calories: false,
    daily_protein_grams: null,
    daily_carbs_grams: null,
    daily_fats_grams: null,
    daily_water_ml: null,
    daily_steps: null,
    daily_workout_minutes: null,
    daily_sleep_hours: null,
    ...over,
  };
}

export function cycleSettingsRow(over: Partial<HealthCycleSettings> = {}): HealthCycleSettings {
  return {
    id: 'cycle-1',
    user_id: 'user-1',
    cycle_length: 28,
    period_length: 5,
    last_period_start: null,
    ...over,
  };
}

export function periodRow(over: Partial<HealthPeriodEntry> = {}): HealthPeriodEntry {
  return {
    id: 'period-1',
    user_id: 'user-1',
    date: '2026-07-13',
    flow_level: 3,
    notes: null,
    updated_at: ISO,
    deleted_at: null,
    ...over,
  };
}

export function cycleSymptomRow(
  over: Partial<HealthCycleSymptomEntry> = {}
): HealthCycleSymptomEntry {
  return {
    id: 'symptom-1',
    user_id: 'user-1',
    date: '2026-07-13',
    mood: null,
    energy: null,
    cramps: null,
    headache: null,
    bloating: null,
    breast_tenderness: null,
    back_pain: null,
    acne: null,
    nausea: null,
    anxiety: null,
    irritability: null,
    sadness: null,
    cravings: null,
    sleep_quality: null,
    libido: null,
    notes: null,
    updated_at: ISO,
    ...over,
  };
}

export function mensRow(over: Partial<HealthMensEntry> = {}): HealthMensEntry {
  return {
    id: 'mens-1',
    user_id: 'user-1',
    date: '2026-07-13',
    libido: null,
    had_partner_sex: false,
    had_masturbation: false,
    had_orgasm: false,
    overall_satisfaction: null,
    had_morning_erection: false,
    morning_erection_quality: null,
    erection_quality: null,
    had_erotic_dream: false,
    sexual_desire_level: null,
    had_erection_difficulty: false,
    had_maintenance_difficulty: false,
    had_premature_ejaculation: false,
    had_delayed_ejaculation: false,
    had_performance_anxiety: false,
    had_low_desire: false,
    had_pain_or_discomfort: false,
    energy_level: null,
    mental_clarity: null,
    mood: null,
    sleep_quality: null,
    stress_level: null,
    exercised: false,
    kegel_sets: null,
    notes: null,
    updated_at: ISO,
    ...over,
  };
}

/**
 * Stateful stand-in for the effective-dated goal row.
 *
 * `saveGoal` PATCHes a subset of columns and every goal reader re-reads the
 * whole row afterwards, so a static `getGoal` mock would report a freshly saved
 * goal as lost. Shared by the nutrition, activity and water goal suites.
 */
export function fakeGoalServer(
  api: MockedHealthApi,
  initial: Partial<HealthGoal> = {}
): { goal: HealthGoal } {
  const state = { goal: goalRow(initial) };
  api.getGoal.mockImplementation(() => Promise.resolve(ok({ goal: state.goal })));
  api.saveGoal.mockImplementation((body) => {
    state.goal = { ...state.goal, ...body } as HealthGoal;
    return Promise.resolve(ok({ goal: state.goal }));
  });
  return state;
}

/**
 * Give every endpoint a benign "empty account" answer.
 *
 * Without this an unstubbed method resolves `undefined`, the store reads
 * `res.data` off it, throws, and the repository silently swallows it as an
 * OFFLINE result — which would make an online test pass for the wrong reason.
 */
export function installHealthApiDefaults(api: MockedHealthApi): void {
  api.listWeight.mockResolvedValue(ok({ entries: [] }));
  api.createWeight.mockResolvedValue(ok({ entry: weightRow() }));
  api.deleteWeight.mockResolvedValue(ok({ deleted: true }));

  api.listWater.mockResolvedValue(ok({ entries: [] }));
  api.waterSummary.mockResolvedValue(ok({ summary: waterSummaryRow() }));
  api.addWater.mockResolvedValue(ok({ entry: waterEntryRow() }));
  api.undoWater.mockResolvedValue(ok({ removed: true }));

  api.listNutrition.mockResolvedValue(ok({ entries: [] }));
  api.createNutrition.mockResolvedValue(ok({ entry: nutritionRow() }));
  api.deleteNutrition.mockResolvedValue(ok({ deleted: true }));

  api.listMeasurements.mockResolvedValue(ok({ measurements: [] }));
  api.createMeasurement.mockResolvedValue(ok({ measurement: measurementRow() }));
  api.deleteMeasurement.mockResolvedValue(ok({ deleted: true }));

  api.listEntries.mockResolvedValue(ok({ entries: [] }));
  api.setSteps.mockResolvedValue(ok({ entry: healthEntryRow({ entry_type: 'steps' }) }));
  api.logWorkout.mockResolvedValue(ok({ entry: healthEntryRow() }));
  api.deleteEntry.mockResolvedValue(ok({ deleted: true }));

  api.getGoal.mockResolvedValue(ok({ goal: null }));
  api.saveGoal.mockResolvedValue(ok({ goal: null }));

  api.listHabits.mockResolvedValue(ok({ habits: [] }));
  api.createHabit.mockResolvedValue(ok({ habit: habitRow() }));
  api.deleteHabit.mockResolvedValue(ok({ deleted: true }));
  api.toggleHabit.mockResolvedValue(ok({ done: true, habits: [] }));

  api.getCycleSettings.mockResolvedValue(ok({ settings: null }));
  api.saveCycleSettings.mockResolvedValue(ok({ settings: cycleSettingsRow() }));
  api.listPeriods.mockResolvedValue(ok({ periods: [] }));
  api.logPeriodDay.mockResolvedValue(ok({ periods: [], settings: null }));
  api.removePeriodDay.mockResolvedValue(ok({ deleted: true, periods: [] }));
  api.listCycleSymptoms.mockResolvedValue(ok({ symptoms: [] }));
  api.saveCycleSymptoms.mockResolvedValue(ok({ entry: cycleSymptomRow() }));

  api.listMensHealth.mockResolvedValue(ok({ entries: [] }));
  api.saveMensHealth.mockResolvedValue(ok({ entry: mensRow() }));
}
