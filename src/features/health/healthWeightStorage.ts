import {
  healthApi,
  type HealthActivityLevel,
  type HealthGender,
  type HealthGoal,
  type HealthWeightGoalType,
} from '@api/health';
import { storageHelpers } from '@services/storage';

import { todayDateKey, type HeightUnit, type WeightUnit } from './healthLocalStorage';
import { readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — the WEIGHT GOAL and the biometrics its maths needs.
 *
 * The donor keeps a target weight, a starting weight (with its date) and the
 * member's height / sex / age / activity level on `UserProfile`, and every
 * weight surface it ships reads one of them: the goal RULE on both weight
 * charts, the goal-progress ring, the "to go" figure, the BMI tracker, the BMR
 * and TDEE explainer, the lean-mass widget. None of it existed here —
 * `goalWeight` was zero hits across `src/` — because there was nowhere on the
 * wire to put a target.
 *
 * WHERE IT LIVES. Migration 0125 adds the eight donor columns to `health_goals`
 * rather than to `users`: `users` is the SHARED ecosystem identity table that
 * House, Budget and Kaizen also read, and a height and a sex stored there would
 * be visible to every other brand — the exact cross-app leak BRD §7 forbids.
 * `health_goals` is already the per-user, Health-only, effective-dated "what
 * this person is aiming at" row, which also means a chart of last spring draws
 * last spring's goal line instead of retro-scoring it against today's target.
 *
 * ── The pre-0125 Worker, and why `undefined` is not `null` ──────────────────
 *
 * The Worker is deployed; 0125 is written but not applied. A Worker without it
 * OMITS these keys (`c.json` serialises the columns it has) and `PUT /goals`
 * strips them, answering 200. A Worker WITH it always sends the keys, using an
 * explicit `null` for "not set".
 *
 * So the two states are distinguishable, and this module treats them
 * differently on purpose:
 *
 *   key ABSENT  → this server cannot store a goal yet. KEEP the cached goal, so
 *                 a member who sets one today still sees it, and it reconciles
 *                 the moment the migration lands.
 *   key `null`  → the server can store one and the member has none (or cleared
 *                 it). DROP the cached goal — otherwise "clear my goal" would
 *                 be undone by the next read.
 *
 * Collapsing the two would pick one broken behaviour or the other, which is why
 * `hasServerWeightGoalSupport` is a real branch rather than a `?? null`.
 *
 * UNITS. `target_weight_kg` and `starting_weight_kg` are canonical kilograms,
 * unlike `weight_entries.weight`, which keeps whatever unit was typed. A
 * measurement must not be converted — that invents precision the member never
 * entered, which is why `weightDailyValues` drops the minority unit rather than
 * converting it. A TARGET is a single scalar the member chose, and storing it
 * canonically is what lets them switch display units without losing it. The
 * conversion happens once, here, at the edge.
 */

export const HEALTH_WEIGHT_GOAL_KEY = 'health.weightGoal.v1';

/** Exact factor, both directions — never two independently rounded constants. */
export const LB_PER_KG = 2.2046226218;

export function kgToLb(kg: number): number {
  return kg * LB_PER_KG;
}

export function lbToKg(lb: number): number {
  return lb / LB_PER_KG;
}

/** Convert a canonical-kg figure into the unit a screen is displaying. */
export function weightInUnit(kg: number, unit: WeightUnit): number {
  return round1(unit === 'lb' ? kgToLb(kg) : kg);
}

/** Convert a member-entered figure in `unit` back to canonical kilograms. */
export function weightToKg(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? lbToKg(value) : value;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export const CM_PER_INCH = 2.54;

/**
 * Convert a canonical-cm figure into the unit a screen is displaying.
 *
 * Rounded to the nearest WHOLE inch, not `round1`'s one-decimal — a height
 * wheel steps in whole inches (see `HEIGHT_WHEEL_BOUNDS`), and a fractional
 * inch on a value nobody typed that precisely would just be display noise.
 */
export function heightInUnit(cm: number, unit: HeightUnit): number {
  return unit === 'in' ? Math.round(cm / CM_PER_INCH) : Math.round(cm);
}

/** Convert a member-entered figure in `unit` back to canonical centimetres. */
export function heightToCm(value: number, unit: HeightUnit): number {
  return unit === 'in' ? value * CM_PER_INCH : value;
}

export type { HealthActivityLevel, HealthGender, HealthWeightGoalType };

/**
 * The member's weight goal + biometrics, in the shape the screens render.
 *
 * `targetKg`/`startingKg` are canonical; `unit` is the unit the member SET the
 * goal in, carried so the goal is echoed back in the same unit they typed
 * rather than silently re-expressed.
 */
export interface WeightGoal {
  targetKg: number | null;
  /** The unit the target was entered in — display only, never storage. */
  unit: WeightUnit;
  goalType: HealthWeightGoalType | null;
  startingKg: number | null;
  /** `YYYY-MM-DD` the baseline was taken; only meaningful with `startingKg`. */
  startingDate: string | null;
  heightCm: number | null;
  gender: HealthGender | null;
  birthYear: number | null;
  activityLevel: HealthActivityLevel | null;
}

export const EMPTY_WEIGHT_GOAL: WeightGoal = {
  targetKg: null,
  unit: 'kg',
  goalType: null,
  startingKg: null,
  startingDate: null,
  heightCm: null,
  gender: null,
  birthYear: null,
  activityLevel: null,
};

/**
 * True when the answer came from a Worker that has migration 0125.
 *
 * Presence of the KEY is the signal, not its value — see the module header.
 */
export function hasServerWeightGoalSupport(goal: HealthGoal | null | undefined): boolean {
  return goal !== null && goal !== undefined && 'target_weight_kg' in goal;
}

/** Wire goal row → the weight-goal shape, or `null` when the server predates 0125. */
export function fromWireWeightGoal(
  goal: HealthGoal | null | undefined,
  displayUnit: WeightUnit
): WeightGoal | null {
  if (!hasServerWeightGoalSupport(goal)) return null;
  const row = goal as HealthGoal;
  return {
    targetKg: numberOrNull(row.target_weight_kg),
    unit: displayUnit,
    goalType: row.weight_goal_type ?? null,
    startingKg: numberOrNull(row.starting_weight_kg),
    startingDate: row.starting_weight_date ?? null,
    heightCm: numberOrNull(row.height_cm),
    gender: row.gender ?? null,
    birthYear: numberOrNull(row.birth_year),
    activityLevel: row.activity_level ?? null,
  };
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function fetchWeightGoal(): Promise<WeightGoal> {
  const { goal } = await healthApi.getGoal();
  const cached = await storageHelpers.getObject<WeightGoal>(HEALTH_WEIGHT_GOAL_KEY);
  const displayUnit = cached?.unit ?? 'kg';
  const server = fromWireWeightGoal(goal, displayUnit);

  // A Worker without 0125 cannot answer the question, so its silence must not
  // be read as "no goal". Keep whatever this handset last knew.
  if (server === null) return cached ?? EMPTY_WEIGHT_GOAL;
  return server;
}

export async function loadWeightGoal(): Promise<WeightGoal> {
  const goal = await readThrough(HEALTH_WEIGHT_GOAL_KEY, fetchWeightGoal, EMPTY_WEIGHT_GOAL);
  return { ...EMPTY_WEIGHT_GOAL, ...goal };
}

/** What a screen may change. Every field is optional; omitted keys are kept. */
export interface WeightGoalPatch {
  /** Target in `unit`; `null` clears the goal. */
  target?: number | null;
  unit?: WeightUnit;
  goalType?: HealthWeightGoalType | null;
  /** Baseline in `unit`; `null` clears it and progress falls back to the first entry. */
  starting?: number | null;
  startingDate?: string | null;
  heightCm?: number | null;
  gender?: HealthGender | null;
  birthYear?: number | null;
  activityLevel?: HealthActivityLevel | null;
}

/**
 * Save the goal.
 *
 * The wire payload carries only the keys the caller actually changed —
 * `saveGoal` merges server-side and an omitted key keeps its stored value, so
 * sending the whole object would let a screen that never asked about height
 * overwrite it. An explicit `null` is the one way to clear a field, which is
 * why `undefined` and `null` are handled separately throughout.
 */
export async function saveWeightGoal(patch: WeightGoalPatch): Promise<WeightGoal> {
  const current = await loadWeightGoal();
  const unit = patch.unit ?? current.unit;

  // NOT rounded to one decimal on the way in. 165 lb is 74.84 kg, and rounding
  // that to 74.8 reads back as 164.9 lb — the member's own number changing
  // under them for no reason they can see. Canonical storage keeps full
  // precision; `weightInUnit` rounds once, at display.
  const targetKg =
    patch.target === undefined
      ? current.targetKg
      : patch.target === null
        ? null
        : weightToKg(patch.target, unit);
  const startingKg =
    patch.starting === undefined
      ? current.startingKg
      : patch.starting === null
        ? null
        : weightToKg(patch.starting, unit);

  const next: WeightGoal = {
    targetKg,
    unit,
    goalType: patch.goalType === undefined ? current.goalType : patch.goalType,
    startingKg,
    startingDate:
      patch.startingDate === undefined
        ? // A baseline WEIGHT with no date is undated progress ("40% complete"
          // since when?), so stamp today when the member sets one and never
          // leave a stale date behind a cleared baseline.
          startingKg === null
          ? null
          : (current.startingDate ?? todayDateKey())
        : patch.startingDate,
    heightCm: patch.heightCm === undefined ? current.heightCm : patch.heightCm,
    gender: patch.gender === undefined ? current.gender : patch.gender,
    birthYear: patch.birthYear === undefined ? current.birthYear : patch.birthYear,
    activityLevel:
      patch.activityLevel === undefined ? current.activityLevel : patch.activityLevel,
  };

  const body: Partial<HealthGoal> = {};
  if (patch.target !== undefined) body.target_weight_kg = next.targetKg;
  if (patch.goalType !== undefined) body.weight_goal_type = next.goalType;
  if (patch.starting !== undefined) {
    body.starting_weight_kg = next.startingKg;
    body.starting_weight_date = next.startingDate;
  } else if (patch.startingDate !== undefined) {
    body.starting_weight_date = next.startingDate;
  }
  if (patch.heightCm !== undefined) body.height_cm = next.heightCm;
  if (patch.gender !== undefined) body.gender = next.gender;
  if (patch.birthYear !== undefined) body.birth_year = next.birthYear;
  if (patch.activityLevel !== undefined) body.activity_level = next.activityLevel;

  // `saveGoal` omits `effective_date`, so the ONLINE route applies it to the
  // server's own UTC "today". The offline queue names it EXPLICITLY as the
  // device's local today — the same day every other date field in this app
  // uses — because a queued push has no other way to say which day's goal row
  // this patch belongs to.
  const effectiveDate = todayDateKey();
  return writeThrough(
    HEALTH_WEIGHT_GOAL_KEY,
    () => healthApi.saveGoal(body),
    // Re-read so an effective-dated row written for TODAY is what comes back,
    // and so a server that silently dropped the keys is caught on the next read
    // rather than believed.
    async () => {
      const { goal } = await healthApi.getGoal();
      // The unit is a DISPLAY preference that lives only in the cache, so the
      // re-read is told which unit the member just used — otherwise a goal typed
      // in pounds would come straight back labelled kg.
      const fresh = fromWireWeightGoal(goal, next.unit);
      // A pre-0125 Worker answers WITHOUT the keys, so it cannot confirm any of
      // this, and the cache it would fall back to is still the PRE-write one
      // (the cache is only written after this returns). Believe what the member
      // just entered — testing the answer instead ("did the target come back
      // null?") rescued only the target, so a sex, an activity level or a height
      // set against the deployed Worker was silently discarded on the way back.
      return fresh ?? next;
    },
    next,
    `target=${next.targetKg ?? 'none'}kg`,
    { queue: { collection: 'health_goals', row: { ...body, effective_date: effectiveDate } } }
  );
}

/** Clear the target (and its goal type) but keep the biometrics. */
export async function clearWeightGoal(): Promise<WeightGoal> {
  return saveWeightGoal({ target: null, goalType: null });
}

/* ------------------------------------------------------------------ */
/* Dashboard layout — which widgets, in what order                     */
/* ------------------------------------------------------------------ */

/**
 * The donor's `WeightDashboardLayoutManager`, minus its server half.
 *
 * The donor persists the layout to UserDefaults AND to its own
 * `SDWeightDashboardLayout` row. There is no route for that here and inventing
 * one would be a second schema change for a pure UI preference, so this stays
 * DEVICE-LOCAL — the same call `preferredUnit` and the daily note already make.
 * It is still registered in `healthCacheKeys` and cleared on sign-out: a layout
 * is not a health record, but leaving one behind would tell the next person on
 * a shared handset which widgets the previous one cared about.
 */
export const HEALTH_WEIGHT_LAYOUT_KEY = 'health.weightLayout.v1';

export interface WeightLayout {
  /** Enabled widget keys, in render order. */
  widgets: string[];
  /** `'trend'` (line) or `'change'` (bars) — the donor's chart-type toggle. */
  chartMode: 'trend' | 'change';
  /** Draw the goal rule on the trend chart. */
  showGoalLine: boolean;
  /** Draw the window-average rule on the trend chart. */
  showAverageLine: boolean;
  /** Print each point's own value above it on the trend chart. */
  showValues: boolean;
  /** Window width in days. */
  windowDays: number;
}

export const DEFAULT_WEIGHT_LAYOUT: WeightLayout = {
  // `goalProgress` is a fixed section on the screen, not a dashboard card;
  // `weeklyChange` ("This week") and `dataStack` ("Averages") are both
  // dropped — see `DEFAULT_WEIGHT_WIDGETS`.
  widgets: ['mainChart', 'aiInsights'],
  chartMode: 'trend',
  showGoalLine: true,
  showAverageLine: true,
  // The donor's `WeightDashboardLayoutManager.showValues` also defaults off —
  // a label on every point is clutter until asked for.
  showValues: false,
  windowDays: 30,
};

export async function loadWeightLayout(): Promise<WeightLayout> {
  const stored = await storageHelpers.getObject<Partial<WeightLayout>>(HEALTH_WEIGHT_LAYOUT_KEY);
  const widgets = Array.isArray(stored?.widgets)
    ? stored!.widgets.filter((key): key is string => typeof key === 'string')
    : DEFAULT_WEIGHT_LAYOUT.widgets;
  return {
    ...DEFAULT_WEIGHT_LAYOUT,
    ...stored,
    // An empty list would render a blank tab with no way back, so it degrades
    // to the default rather than being honoured.
    widgets: widgets.length > 0 ? widgets : DEFAULT_WEIGHT_LAYOUT.widgets,
  };
}

export async function saveWeightLayout(patch: Partial<WeightLayout>): Promise<WeightLayout> {
  const next = { ...(await loadWeightLayout()), ...patch };
  await storageHelpers.setObject(HEALTH_WEIGHT_LAYOUT_KEY, next);
  return next;
}

/** Move a widget one slot up (`-1`) or down (`+1`). Out-of-range moves are no-ops. */
export function moveWidget(widgets: string[], key: string, delta: number): string[] {
  const index = widgets.indexOf(key);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= widgets.length) return widgets;
  const next = [...widgets];
  next.splice(index, 1);
  next.splice(target, 0, key);
  return next;
}

/** Show or hide a widget. Hiding the LAST one is refused — see `loadWeightLayout`. */
export function toggleWidget(widgets: string[], key: string): string[] {
  if (!widgets.includes(key)) return [...widgets, key];
  return widgets.length <= 1 ? widgets : widgets.filter((w) => w !== key);
}
