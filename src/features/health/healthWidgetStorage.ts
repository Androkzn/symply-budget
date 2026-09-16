import {
  healthAssetsApi,
  HEALTH_MEDIUM_WIDGET_LAYOUTS,
  HEALTH_MEDIUM_WIDGET_METRICS,
  HEALTH_SMALL_WIDGET_METRICS,
  HEALTH_SMALL_WIDGET_STYLES,
  HEALTH_WIDGET_CHART_METRICS,
  HEALTH_WIDGET_CHART_TYPES,
  type HealthMediumWidgetLayout,
  type HealthMediumWidgetMetric,
  type HealthSmallWidgetMetric,
  type HealthSmallWidgetStyle,
  type HealthWidgetChartMetric,
  type HealthWidgetChartType,
  type HealthWidgetPreferences,
  type HealthWidgetSnapshot,
} from '@api/healthAssets';
import { storageHelpers } from '@services/storage';
import { widgetSync } from '@services/widget-sync';

import { loadActivityGoals } from './healthActivityStorage';
import { todayDateKey } from './healthLocalStorage';
import { readThrough } from './healthRepository';

/**
 * Symply Health — the ONE producer for the Home Screen widget and the Apple
 * Watch face, plus the client for the widget-preference routes.
 *
 * ## Why this module exists
 *
 * Two native surfaces read Symply Health data out of the shared App Group and,
 * before this, neither had a complete producer:
 *
 *  - `ios/SymplyEcosystemWidget/SymplyHealthWidgetContent.swift` reads
 *    `widget_health_today`. `HealthHomeScreen` wrote FIVE of its six fields;
 *    `next_reminder` was never written by anything.
 *  - `ios/SymplyEcosystemWatch/Views/SymplyHealthWatchView.swift` reads
 *    `watch_health_today`. **Nothing in JS wrote that key at all**, so the watch
 *    face could only ever render its empty state.
 *
 * ## THE TWO CONTRACTS DISAGREE — and this file is where they are reconciled
 *
 * The Swift sides were written independently and do NOT share a schema. Both
 * are already shipped and decoding is `try?`-based, so neither can be "fixed"
 * from JS without a native rebuild. One set of facts is therefore mapped into
 * two shapes here, so the phone, the widget and the watch can never disagree
 * about today:
 *
 * | fact              | `widget_health_today`            | `watch_health_today`               |
 * |-------------------|----------------------------------|------------------------------------|
 * | steps             | `steps` Int                      | `steps` Int                        |
 * | step goal         | `steps_goal` Int                 | `steps_goal` Int                   |
 * | water             | `water_ml` Int                   | `water_ml` Int                     |
 * | water goal        | `water_goal_ml` Int              | `water_goal_ml` Int                |
 * | move progress     | `move_pct` **Double FRACTION**   | `move_goal_percent` **Int 0–100**  |
 * | next reminder     | `next_reminder` **object**       | `next_reminder` **String** (title) |
 * |                   | `{ title, at }` (`at` = ISO)     | `next_reminder_time` String (local)|
 * | day               | — (absent from the widget model) | `date` `YYYY-MM-DD`                |
 *
 * `move_pct` is the trap. `HealthWidgetData.resolvedMovePct` treats the value as
 * a fraction when `<= 1.0` and as a percentage otherwise, so sending `85` for
 * "85%" renders a ring 85× over target. It is clamped to [0,1] here, and the
 * watch's integer percent is derived from THAT SAME clamped fraction — which is
 * why a 150%-of-goal day reads as 100% on both surfaces rather than as 100% on
 * one and 150% on the other.
 *
 * ## Nothing NEW lands in the App Group
 *
 * Both keys are already in the `clear()` allow-list of
 * `modules/widget-sync/ios/WidgetSyncModule.swift`, so sign-out wipes them.
 * Adding a THIRD key would require adding it there in the same commit — a
 * snapshot that survives sign-out shows the next person on the handset the
 * previous member's day (the `WATCH-014` class of bug). The domains below
 * widen what rides inside the EXISTING `widget_health_today` key; they do not
 * add a new one, so the sign-out wipe already covers them.
 *
 * ## The widget now carries weight, nutrition and workouts — deliberately
 *
 * Until this change, `widget_health_today` carried only steps, water, a move
 * fraction and a reminder title: `HealthWidgetData.load()` on the Swift side
 * would decode a payload with those fields set and everything else absent.
 * That was a deliberate privacy stance — "a widget renders on a LOCKED
 * screen" — enforced on BOTH sides: the backend's `widgetSnapshot()` already
 * computed weight/nutrition/workouts behind their `show_*` toggles, and this
 * file discarded them before they ever reached the App Group.
 *
 * That stance has been reversed for the WIDGET on explicit product decision:
 * the Home Screen widget now matches the donor app's feature set, including
 * today's weight, nutrition macros, workout minutes, and the weekly
 * weight/calories trend — still gated behind the SAME `show_weight` /
 * `show_nutrition` / `show_workouts` toggles the settings screen already
 * exposes, so a member who wants the old, sparser widget still gets it by
 * switching those off.
 *
 * The WATCH payload (`watch_health_today` / `HealthWatchPayload`) is
 * UNCHANGED — it is a separate, smaller surface and this decision was scoped
 * to the widget only. It still carries only counts, a goal, a fraction and a
 * reminder title; no cycle, no vitality and no file of any kind reaches
 * either surface.
 */

/* ==================================================================== */
/* App Group keys                                                        */
/* ==================================================================== */

/** Read by `SymplyHealthWidgetContent.swift`. */
export const HEALTH_WIDGET_KEY = 'widget_health_today';

/** Read by `SymplyHealthWatchView.swift`. */
export const HEALTH_WATCH_KEY = 'watch_health_today';

/* ==================================================================== */
/* Cache keys                                                            */
/* ==================================================================== */

/** Widget preferences mirror, so a settings screen renders before the network. */
export const HEALTH_WIDGET_PREFS_KEY = 'health.widgetPrefs.v1';

/**
 * The next scheduled reminder, mirrored so the widget/watch writer can include
 * it without the caller having to plumb it through every publish site.
 * Registered in `healthCacheKeys` — it holds a user-written reminder title.
 */
export const HEALTH_GLANCE_REMINDER_KEY = 'health.glanceReminder.v1';

/**
 * Last-known weight/nutrition/workouts (+ trends, + widget layout prefs),
 * mirrored for the SAME reason `HEALTH_GLANCE_REMINDER_KEY` is: most publish
 * sites (e.g. `HealthHomeScreen`'s steps/water effect) only have the
 * lightweight facts on hand and never fetch a full server snapshot. Without
 * this mirror, `publishHealthGlance` defaulted every field the caller didn't
 * pass to `null` — so the Home screen's steps/water publish, which runs on
 * nearly every render, wiped out the nutrition/weight/workout sections a
 * `syncHealthGlanceFromServer()` call had just populated, leaving the Large
 * widget's whole lower half blank. Registered in `healthCacheKeys`.
 */
export const HEALTH_GLANCE_EXTRAS_KEY = 'health.glanceExtras.v1';

/* ==================================================================== */
/* Facts — the single normalised shape both surfaces are built from      */
/* ==================================================================== */

/** The next scheduled reminder as the glance surfaces need it. */
export interface HealthGlanceReminder {
  /** What the reminder is called, e.g. "Evening walk". Shown verbatim. */
  title: string;
  /** When it fires, ISO-8601. The widget formats it; the watch gets it pre-formatted. */
  at: string;
}

/** Today's weight — widget-only (the watch has no weight tile). */
export interface HealthGlanceWeight {
  value: number;
  unit: string;
  date: string;
}

/** This week's weight trend — widget-only. Mirrors `HealthWidgetSnapshot['weight_trend']`. */
export interface HealthGlanceWeightTrend {
  unit: string;
  /** LOGGED days only this week — a week is rarely weighed in daily. */
  entries: Array<{ date: string; weight: number }>;
  avgThisWeek: number | null;
  avgLastWeek: number | null;
  startingWeightKg: number | null;
  startingWeightDate: string | null;
  progressFromStart: number | null;
  progressPercentage: number | null;
}

/** Today's nutrition — widget-only. Mirrors `HealthWidgetSnapshot['nutrition']`. */
export interface HealthGlanceNutrition {
  calories: number;
  proteins: number;
  carbohydrates: number;
  fats: number;
  goalCalories: number | null;
  proteinTarget: number | null;
  carbsTarget: number | null;
  fatsTarget: number | null;
}

/** This week's nutrition trend — widget-only. Mirrors `HealthWidgetSnapshot['nutrition_trend']`. */
export interface HealthGlanceNutritionTrend {
  /** All 7 days this week, ZERO-FILLED — unlike `HealthGlanceWeightTrend.entries`. */
  entries: Array<{ date: string; calories: number }>;
  avgThisWeek: number;
  avgLastWeek: number;
}

/** Today's workouts — widget-only. Mirrors `HealthWidgetSnapshot['workouts']`. */
export interface HealthGlanceWorkouts {
  count: number;
  minutes: number;
  calories: number;
  goalMinutes: number | null;
}

/**
 * Everything both native surfaces render, in ONE shape.
 *
 * `stepsGoal` / `waterGoalMl` are nullable because the server's daily summary
 * returns `null` when no goal row exists — the Swift then drops the "/ goal"
 * caption rather than inventing a target.
 *
 * `weight` / `weightTrend` / `nutrition` / `nutritionTrend` / `workouts` are
 * WIDGET-ONLY domains (the watch face doesn't render them — see the file
 * header). They are still required here, not optional, so this remains ONE
 * fully-populated internal shape; callers that don't have them (like
 * `HealthHomeScreen`'s lightweight steps/water publish) go through
 * `HealthGlanceInput` below, which makes exactly these six optional and
 * defaults each to `null`.
 *
 * `preferences` is the one field that is not DATA — it's the small/medium
 * LAYOUT choice (`small_widget_style`, `medium_widget_layout`, …) the widget
 * needs to know which of its several layouts to draw. It rides in the same
 * key as everything else rather than a second one, for the same "nothing NEW
 * lands in the App Group" reason as the rest of this file.
 */
export interface HealthGlanceFacts {
  /** `YYYY-MM-DD`, the CLIENT's local day. */
  date: string;
  steps: number;
  stepsGoal: number | null;
  waterMl: number;
  waterGoalMl: number | null;
  /** Move-goal progress as a FRACTION in [0,1], or null when there is no goal. */
  movePct: number | null;
  nextReminder: HealthGlanceReminder | null;
  weight: HealthGlanceWeight | null;
  weightTrend: HealthGlanceWeightTrend | null;
  nutrition: HealthGlanceNutrition | null;
  nutritionTrend: HealthGlanceNutritionTrend | null;
  workouts: HealthGlanceWorkouts | null;
  /** Layout choice. `null` falls back to the Swift side's own "standard everything" default. */
  preferences: HealthWidgetPreferences | null;
}

/** `widget_health_today`, exactly as `HealthWidgetData` decodes it. */
export interface HealthWidgetPayload {
  steps: number;
  steps_goal: number | null;
  water_ml: number;
  water_goal_ml: number | null;
  move_pct: number | null;
  next_reminder: { title: string; at: string } | null;
  weight: { value: number; unit: string; date: string } | null;
  weight_trend: {
    unit: string;
    entries: Array<{ date: string; weight: number }>;
    avg_this_week: number | null;
    avg_last_week: number | null;
    starting_weight_kg: number | null;
    starting_weight_date: string | null;
    progress_from_start: number | null;
    progress_percentage: number | null;
  } | null;
  nutrition: {
    calories: number;
    proteins: number;
    carbohydrates: number;
    fats: number;
    goal_calories: number | null;
    protein_target: number | null;
    carbs_target: number | null;
    fats_target: number | null;
  } | null;
  nutrition_trend: {
    entries: Array<{ date: string; calories: number }>;
    avg_this_week: number;
    avg_last_week: number;
  } | null;
  workouts: { count: number; minutes: number; calories: number; goal_minutes: number | null } | null;
  preferences: HealthWidgetPreferences | null;
}

/** `watch_health_today`, exactly as `HealthTodaySnapshot` decodes it. */
export interface HealthWatchPayload {
  move_goal_percent: number | null;
  steps: number;
  steps_goal: number | null;
  water_ml: number;
  water_goal_ml: number | null;
  next_reminder: string | null;
  next_reminder_time: string | null;
  date: string;
}

/* ==================================================================== */
/* Normalisation                                                         */
/* ==================================================================== */

/** A count that reaches a native Int field: finite, non-negative, whole. */
function wholeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

/** Same, but `null` survives — an absent goal is not a goal of zero. */
function optionalCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/**
 * Move progress as a FRACTION in [0,1].
 *
 * Clamped at both ends: `HealthWidgetData` reads anything `> 1.0` as an already-
 * scaled percentage, so an unclamped 1.5 would silently become "2%".
 */
export function moveFraction(done: number, goal: number): number | null {
  if (!Number.isFinite(done) || !Number.isFinite(goal) || goal <= 0) return null;
  return Math.max(0, Math.min(1, done / goal));
}

/**
 * Local time label for the watch, which has no formatter of its own.
 *
 * `toLocaleTimeString` needs Intl, which Hermes ships but which a stripped build
 * can lack, so a 24-hour `HH:MM` fallback keeps the row honest rather than
 * printing an ISO stamp at the member.
 */
export function formatReminderTime(at: string): string | null {
  const ts = Date.parse(at);
  if (Number.isNaN(ts)) return null;
  const date = new Date(ts);
  try {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}

function cleanReminder(reminder: HealthGlanceReminder | null | undefined): HealthGlanceReminder | null {
  if (!reminder) return null;
  const title = typeof reminder.title === 'string' ? reminder.title.trim() : '';
  const at = typeof reminder.at === 'string' ? reminder.at.trim() : '';
  if (title.length === 0 || Number.isNaN(Date.parse(at))) return null;
  return { title: title.slice(0, 120), at };
}

/** The six widget-only domains, mirrored under {@link HEALTH_GLANCE_EXTRAS_KEY}. */
type HealthGlanceExtras = Pick<
  HealthGlanceFacts,
  'weight' | 'weightTrend' | 'nutrition' | 'nutritionTrend' | 'workouts' | 'preferences'
>;

const EMPTY_GLANCE_EXTRAS: HealthGlanceExtras = {
  weight: null,
  weightTrend: null,
  nutrition: null,
  nutritionTrend: null,
  workouts: null,
  preferences: null,
};

/** The mirrored extras, or all-null when nothing has been published yet. Never throws. */
async function loadHealthGlanceExtras(): Promise<HealthGlanceExtras> {
  try {
    const stored = await storageHelpers.getObject<HealthGlanceExtras>(HEALTH_GLANCE_EXTRAS_KEY);
    return stored ? { ...EMPTY_GLANCE_EXTRAS, ...stored } : { ...EMPTY_GLANCE_EXTRAS };
  } catch {
    return { ...EMPTY_GLANCE_EXTRAS };
  }
}

/* ==================================================================== */
/* Mappers                                                               */
/* ==================================================================== */

/**
 * Facts → the widget's shape. `move_pct` stays a fraction.
 *
 * `weight` / `nutrition` / `workouts` (+ their trends) pass through close to
 * verbatim — they are already normalised server-side by `widgetSnapshot()`,
 * so this is camelCase → snake_case renaming, not re-derivation. That keeps
 * one source of truth for every figure: the Worker computes it once, and
 * every surface (phone, widget, watch) just relays the same numbers.
 */
export function toHealthWidgetPayload(facts: HealthGlanceFacts): HealthWidgetPayload {
  return {
    steps: wholeCount(facts.steps),
    steps_goal: optionalCount(facts.stepsGoal),
    water_ml: wholeCount(facts.waterMl),
    water_goal_ml: optionalCount(facts.waterGoalMl),
    move_pct:
      facts.movePct === null || !Number.isFinite(facts.movePct)
        ? null
        : Math.max(0, Math.min(1, facts.movePct)),
    next_reminder: facts.nextReminder ? { ...facts.nextReminder } : null,
    weight: facts.weight ? { ...facts.weight } : null,
    weight_trend: facts.weightTrend
      ? {
          unit: facts.weightTrend.unit,
          entries: facts.weightTrend.entries,
          avg_this_week: facts.weightTrend.avgThisWeek,
          avg_last_week: facts.weightTrend.avgLastWeek,
          starting_weight_kg: facts.weightTrend.startingWeightKg,
          starting_weight_date: facts.weightTrend.startingWeightDate,
          progress_from_start: facts.weightTrend.progressFromStart,
          progress_percentage: facts.weightTrend.progressPercentage,
        }
      : null,
    nutrition: facts.nutrition
      ? {
          calories: facts.nutrition.calories,
          proteins: facts.nutrition.proteins,
          carbohydrates: facts.nutrition.carbohydrates,
          fats: facts.nutrition.fats,
          goal_calories: facts.nutrition.goalCalories,
          protein_target: facts.nutrition.proteinTarget,
          carbs_target: facts.nutrition.carbsTarget,
          fats_target: facts.nutrition.fatsTarget,
        }
      : null,
    nutrition_trend: facts.nutritionTrend
      ? {
          entries: facts.nutritionTrend.entries,
          avg_this_week: facts.nutritionTrend.avgThisWeek,
          avg_last_week: facts.nutritionTrend.avgLastWeek,
        }
      : null,
    workouts: facts.workouts
      ? {
          count: facts.workouts.count,
          minutes: facts.workouts.minutes,
          calories: facts.workouts.calories,
          goal_minutes: facts.workouts.goalMinutes,
        }
      : null,
    preferences: facts.preferences ?? null,
  };
}

/**
 * Facts → the watch's shape.
 *
 * `move_goal_percent` is derived from the SAME clamped fraction the widget gets,
 * so the two faces can never print different numbers for one day.
 */
export function toHealthWatchPayload(facts: HealthGlanceFacts): HealthWatchPayload {
  const fraction =
    facts.movePct === null || !Number.isFinite(facts.movePct)
      ? null
      : Math.max(0, Math.min(1, facts.movePct));
  return {
    move_goal_percent: fraction === null ? null : Math.round(fraction * 100),
    steps: wholeCount(facts.steps),
    steps_goal: optionalCount(facts.stepsGoal),
    water_ml: wholeCount(facts.waterMl),
    water_goal_ml: optionalCount(facts.waterGoalMl),
    next_reminder: facts.nextReminder ? facts.nextReminder.title : null,
    next_reminder_time: facts.nextReminder ? formatReminderTime(facts.nextReminder.at) : null,
    date: facts.date,
  };
}

/* ==================================================================== */
/* The reminder seam                                                     */
/* ==================================================================== */

/**
 * Record the next scheduled reminder for the glance surfaces.
 *
 * The reminders engine owns WHEN something fires; this is only the mirror the
 * widget and the watch read from. Call it with the next pending reminder after
 * scheduling, and with `null` once it has fired or been cancelled — a stale
 * "Evening walk at 18:30" on a lock screen is worse than an empty row.
 *
 * Republishes immediately when `facts` is supplied, so a newly scheduled
 * reminder appears without waiting for the next Home render.
 */
export async function setHealthGlanceReminder(
  reminder: HealthGlanceReminder | null,
  facts?: HealthGlanceFacts
): Promise<void> {
  const clean = cleanReminder(reminder);
  if (clean) await storageHelpers.setObject(HEALTH_GLANCE_REMINDER_KEY, clean);
  else await storageHelpers.delete(HEALTH_GLANCE_REMINDER_KEY);
  if (facts) await publishHealthGlance({ ...facts, nextReminder: clean });
}

/** The mirrored reminder, or null. Never throws — a glance is best-effort. */
export async function loadHealthGlanceReminder(): Promise<HealthGlanceReminder | null> {
  try {
    const stored = await storageHelpers.getObject<HealthGlanceReminder>(
      HEALTH_GLANCE_REMINDER_KEY
    );
    const clean = cleanReminder(stored);
    // A reminder in the past is not "next" — it fired, and nothing cleared it.
    if (clean && Date.parse(clean.at) < Date.now()) return null;
    return clean;
  } catch {
    return null;
  }
}

/* ==================================================================== */
/* Publishing                                                            */
/* ==================================================================== */

/**
 * What a caller may leave out; `nextReminder` falls back to the mirror, and
 * the five widget-only domains default to `null` — a lightweight local
 * publish (e.g. `HealthHomeScreen`'s steps/water effect) never has weight or
 * nutrition on hand, and must not be forced to fetch a whole snapshot just to
 * keep steps up to date.
 */
type OptionalGlanceKeys =
  | 'date'
  | 'nextReminder'
  | 'weight'
  | 'weightTrend'
  | 'nutrition'
  | 'nutritionTrend'
  | 'workouts'
  | 'preferences';

export type HealthGlanceInput = Omit<HealthGlanceFacts, OptionalGlanceKeys> &
  Partial<Pick<HealthGlanceFacts, OptionalGlanceKeys>>;

/**
 * Write BOTH App Group snapshots from one set of facts.
 *
 * Omit `nextReminder` and the value last recorded by
 * {@link setHealthGlanceReminder} is used; pass `null` to state outright that
 * there is no upcoming reminder.
 *
 * No-op on Android / Expo Go, where `widgetSync.setSnapshot` is already a safe
 * no-op. Never throws: a glance surface must not be able to break a screen.
 */
export async function publishHealthGlance(input: HealthGlanceInput): Promise<void> {
  try {
    // Per-field, same contract as `nextReminder` below: omitting a widget-only
    // domain (`undefined`) keeps whatever was last published for it; passing it
    // (including explicit `null`, e.g. a `show_*` toggle switching off) replaces
    // it. Without this, a lightweight publish that only knows steps/water would
    // otherwise null out nutrition/weight/workouts that a fuller sync just set.
    const needsMirror =
      input.weight === undefined ||
      input.weightTrend === undefined ||
      input.nutrition === undefined ||
      input.nutritionTrend === undefined ||
      input.workouts === undefined ||
      input.preferences === undefined;
    const mirror = needsMirror ? await loadHealthGlanceExtras() : EMPTY_GLANCE_EXTRAS;
    const extras: HealthGlanceExtras = {
      weight: input.weight === undefined ? mirror.weight : input.weight,
      weightTrend: input.weightTrend === undefined ? mirror.weightTrend : input.weightTrend,
      nutrition: input.nutrition === undefined ? mirror.nutrition : input.nutrition,
      nutritionTrend:
        input.nutritionTrend === undefined ? mirror.nutritionTrend : input.nutritionTrend,
      workouts: input.workouts === undefined ? mirror.workouts : input.workouts,
      preferences: input.preferences === undefined ? mirror.preferences : input.preferences,
    };
    await storageHelpers.setObject(HEALTH_GLANCE_EXTRAS_KEY, extras);

    const facts: HealthGlanceFacts = {
      date: input.date ?? todayDateKey(),
      steps: input.steps,
      stepsGoal: input.stepsGoal,
      waterMl: input.waterMl,
      waterGoalMl: input.waterGoalMl,
      movePct: input.movePct,
      nextReminder:
        input.nextReminder === undefined
          ? await loadHealthGlanceReminder()
          : cleanReminder(input.nextReminder),
      ...extras,
    };
    widgetSync.setSnapshot(HEALTH_WIDGET_KEY, toHealthWidgetPayload(facts));
    widgetSync.setSnapshot(HEALTH_WATCH_KEY, toHealthWatchPayload(facts));
  } catch {
    // Deliberately swallowed. Every caller is a side effect of rendering or of
    // signing in; a failed glance write must never surface, and there is no
    // message a member could act on anyway.
  }
}

/**
 * Map the server's glance snapshot onto the facts both surfaces need.
 *
 * `move_pct` is the one figure the snapshot cannot supply on its own: it
 * carries today's workout MINUTES but no move goal (the goal is a device
 * preference, `health.activityGoals.v1`). The two are combined here rather than
 * dropping the ring — and when `show_workouts` is off, `workouts` is null and
 * the ring is legitimately absent, which is the preference doing its job.
 *
 * `weight` / `weightTrend` / `nutrition` / `nutritionTrend` pass through
 * near-verbatim (camelCase renaming only) — `widgetSnapshot()` already
 * computed and toggle-gated them server-side, so there is nothing left to
 * derive here.
 */
export function factsFromWidgetSnapshot(
  snapshot: HealthWidgetSnapshot,
  moveGoalMinutes: number
): HealthGlanceFacts {
  return {
    date: snapshot.date,
    steps: snapshot.steps?.value ?? 0,
    stepsGoal: snapshot.steps?.goal ?? null,
    waterMl: snapshot.water?.total_ml ?? 0,
    waterGoalMl: snapshot.water?.goal_ml ?? null,
    movePct: snapshot.workouts ? moveFraction(snapshot.workouts.minutes, moveGoalMinutes) : null,
    // Filled in by `publishHealthGlance` from the reminder mirror.
    nextReminder: null,
    weight: snapshot.weight
      ? { value: snapshot.weight.value, unit: snapshot.weight.unit, date: snapshot.weight.date }
      : null,
    weightTrend: snapshot.weight_trend
      ? {
          unit: snapshot.weight_trend.unit,
          entries: snapshot.weight_trend.entries,
          avgThisWeek: snapshot.weight_trend.avg_this_week,
          avgLastWeek: snapshot.weight_trend.avg_last_week,
          startingWeightKg: snapshot.weight_trend.starting_weight_kg,
          startingWeightDate: snapshot.weight_trend.starting_weight_date,
          progressFromStart: snapshot.weight_trend.progress_from_start,
          progressPercentage: snapshot.weight_trend.progress_percentage,
        }
      : null,
    nutrition: snapshot.nutrition
      ? {
          calories: snapshot.nutrition.calories,
          proteins: snapshot.nutrition.proteins,
          carbohydrates: snapshot.nutrition.carbohydrates,
          fats: snapshot.nutrition.fats,
          goalCalories: snapshot.nutrition.goal_calories,
          proteinTarget: snapshot.nutrition.protein_target,
          carbsTarget: snapshot.nutrition.carbs_target,
          fatsTarget: snapshot.nutrition.fats_target,
        }
      : null,
    nutritionTrend: snapshot.nutrition_trend
      ? {
          entries: snapshot.nutrition_trend.entries,
          avgThisWeek: snapshot.nutrition_trend.avg_this_week,
          avgLastWeek: snapshot.nutrition_trend.avg_last_week,
        }
      : null,
    workouts: snapshot.workouts
      ? {
          count: snapshot.workouts.count,
          minutes: snapshot.workouts.minutes,
          calories: snapshot.workouts.calories,
          goalMinutes: snapshot.workouts.goal_minutes,
        }
      : null,
    preferences: snapshot.preferences ?? null,
  };
}

/**
 * Pull today's glance from the Worker and publish it to widget + watch.
 *
 * This is the path that makes both surfaces live WITHOUT a screen being open —
 * the snapshot obeys the member's widget preferences server-side, so what the
 * lock screen shows is what they chose. Returns false when the request failed
 * (offline, signed out); the last-published snapshot simply stays.
 */
export async function syncHealthGlanceFromServer(date = todayDateKey()): Promise<boolean> {
  try {
    const [payload, goals] = await Promise.all([
      healthAssetsApi.getWidgetSnapshot(date),
      loadActivityGoals().catch(() => null),
    ]);
    const snapshot = payload?.snapshot;
    if (!snapshot) return false;
    const facts = factsFromWidgetSnapshot(snapshot, goals?.minutes ?? 0);
    await publishHealthGlance({ ...facts, nextReminder: undefined });
    return true;
  } catch {
    return false;
  }
}

/* ==================================================================== */
/* Widget preferences                                                    */
/* ==================================================================== */

/** Mirrors the column defaults of migrations 0120 + 0144 / `WIDGET_PREFERENCE_DEFAULTS`. */
export const DEFAULT_HEALTH_WIDGET_PREFERENCES: HealthWidgetPreferences = {
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
};

export const SMALL_WIDGET_METRIC_LABELS: Record<HealthSmallWidgetMetric, string> = {
  steps: 'Steps',
  calories: 'Calories',
  water: 'Water',
};

export const WIDGET_CHART_TYPE_LABELS: Record<HealthWidgetChartType, string> = {
  bar: 'Bars',
  line: 'Line',
};

export const WIDGET_CHART_METRIC_LABELS: Record<HealthWidgetChartMetric, string> = {
  weight: 'Weight',
  nutrition: 'Nutrition',
  both: 'Weight and nutrition',
};

export const SMALL_WIDGET_STYLE_LABELS: Record<HealthSmallWidgetStyle, string> = {
  standard: 'Standard',
  compact: 'Compact ring',
  minimal: 'Minimal',
};

export const MEDIUM_WIDGET_LAYOUT_LABELS: Record<HealthMediumWidgetLayout, string> = {
  standard: 'Standard',
  dual: 'Dual focus',
  grid: 'Grid',
};

export const MEDIUM_WIDGET_METRIC_LABELS: Record<HealthMediumWidgetMetric, string> = {
  steps: 'Steps',
  calories: 'Calories',
  water: 'Water',
  workout: 'Exercise',
};

export const SMALL_WIDGET_METRIC_OPTIONS = HEALTH_SMALL_WIDGET_METRICS;
export const WIDGET_CHART_TYPE_OPTIONS = HEALTH_WIDGET_CHART_TYPES;
export const WIDGET_CHART_METRIC_OPTIONS = HEALTH_WIDGET_CHART_METRICS;
export const SMALL_WIDGET_STYLE_OPTIONS = HEALTH_SMALL_WIDGET_STYLES;
export const MEDIUM_WIDGET_LAYOUT_OPTIONS = HEALTH_MEDIUM_WIDGET_LAYOUTS;
export const MEDIUM_WIDGET_METRIC_OPTIONS = HEALTH_MEDIUM_WIDGET_METRICS;

function isWidgetPreferences(value: unknown): value is HealthWidgetPreferences {
  if (value === null || typeof value !== 'object') return false;
  const prefs = value as Partial<HealthWidgetPreferences>;
  return (
    typeof prefs.small_widget_metric === 'string' &&
    typeof prefs.chart_type === 'string' &&
    typeof prefs.show_weight === 'boolean'
  );
}

async function fetchWidgetPreferences(): Promise<HealthWidgetPreferences> {
  const payload = await healthAssetsApi.getWidgetPreferences();
  const prefs = payload?.preferences;
  return isWidgetPreferences(prefs)
    ? { ...DEFAULT_HEALTH_WIDGET_PREFERENCES, ...prefs }
    : { ...DEFAULT_HEALTH_WIDGET_PREFERENCES };
}

/** Read-through: the cache renders instantly, the server replaces it. */
export async function loadWidgetPreferences(): Promise<HealthWidgetPreferences> {
  const prefs = await readThrough(HEALTH_WIDGET_PREFS_KEY, fetchWidgetPreferences, {
    ...DEFAULT_HEALTH_WIDGET_PREFERENCES,
  });
  return isWidgetPreferences(prefs)
    ? { ...DEFAULT_HEALTH_WIDGET_PREFERENCES, ...prefs }
    : { ...DEFAULT_HEALTH_WIDGET_PREFERENCES };
}

export interface WidgetPreferenceWriteResult {
  preferences: HealthWidgetPreferences;
  status: 'saved' | 'offline';
  /** Friendly copy, or null when there is nothing to say. Never a raw error. */
  message: string | null;
}

export const WIDGET_PREFS_OFFLINE_MESSAGE =
  'Saved on this device — your widget will update when you are back online.';

/**
 * PATCH one or more preferences.
 *
 * Only the changed keys are sent: the route merges, so a client that posted the
 * whole object would overwrite a field a newer build knows about and this one
 * does not.
 *
 * On success the glance is republished, so the Home Screen widget reflects the
 * new choice immediately instead of at the next app launch.
 */
export async function saveWidgetPreferences(
  patch: Partial<HealthWidgetPreferences>
): Promise<WidgetPreferenceWriteResult> {
  const before = await loadWidgetPreferences();
  const optimistic: HealthWidgetPreferences = { ...before, ...patch };
  try {
    const payload = await healthAssetsApi.saveWidgetPreferences(patch);
    const preferences = isWidgetPreferences(payload?.preferences)
      ? { ...DEFAULT_HEALTH_WIDGET_PREFERENCES, ...payload.preferences }
      : optimistic;
    await storageHelpers.setObject(HEALTH_WIDGET_PREFS_KEY, preferences);
    void syncHealthGlanceFromServer();
    return { preferences, status: 'saved', message: null };
  } catch {
    // The optimistic value is kept: this is a display preference, so showing the
    // member's own choice back to them offline is right, and the next successful
    // read replaces it wholesale. No error string is ever surfaced.
    await storageHelpers.setObject(HEALTH_WIDGET_PREFS_KEY, optimistic);
    return { preferences: optimistic, status: 'offline', message: WIDGET_PREFS_OFFLINE_MESSAGE };
  }
}

/** One-line summary of what the widget will show, for a settings row subtitle. */
export function describeWidgetPreferences(prefs: HealthWidgetPreferences): string {
  const shown = [
    prefs.show_weight ? 'weight' : null,
    prefs.show_nutrition ? 'nutrition' : null,
    prefs.show_workouts ? 'workouts' : null,
  ].filter((value): value is string => value !== null);
  const metric = SMALL_WIDGET_METRIC_LABELS[prefs.small_widget_metric] ?? 'Steps';
  if (shown.length === 0) return `${metric} only`;
  return `${metric}, plus ${shown.join(', ')}`;
}
