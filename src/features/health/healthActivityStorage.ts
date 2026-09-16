import { healthApi, type HealthWorkoutIntensity } from '@api/health';
import { storageHelpers } from '@services/storage';

import { dateKeyOf, todayDateKey, type HealthUnitSystem } from './healthLocalStorage';
import { shiftDateKey } from './healthNutritionStorage';
import { readThrough, writeThrough } from './healthRepository';
import { moveWidget, toggleWidget } from './healthWeightStorage';
import { isWorkoutType, normalizeWorkoutType, type WorkoutType } from './healthWorkoutTypes';

/**
 * Symply Health — Activity (donor "Workouts" tab).
 *
 * Donor parity: workout sessions (type + duration + burned calories + how hard
 * it felt) plus a daily step count. Both ride the donor's generic
 * `health_entries` table via `/health/entries` — one row per session, one
 * upserted row per step-day.
 *
 * HealthKit is deliberately NOT the source here: the manual path has to work
 * standalone (migration.md: "HealthKit-off path required"), so steps are typed
 * in until a scoped, privacy-reviewed HealthKit phase lands. The server records
 * `source: 'manual'` so a later HealthKit import can be told apart.
 *
 * TWO BACKEND GAPS CLOSED IN 0124, and what they used to cost:
 *  - a session can now be EDITED (`PUT /health/entries/workouts/:id`). Before,
 *    editing meant re-recording — write the replacement, then tombstone the
 *    original — which kept the data safe but minted a new id and moved the
 *    logged time, so an edited session jumped to the top of its day.
 *  - intensity is a real COLUMN. Before, it rode the note as a `[hard]` tag,
 *    because the route's zod schema stripped every key it did not name.
 */

export const HEALTH_WORKOUTS_KEY = 'health.workouts.v1';
export const HEALTH_STEPS_KEY = 'health.steps.v1';
export const HEALTH_ACTIVITY_GOALS_KEY = 'health.activityGoals.v1';

/**
 * The session vocabulary moved to `healthWorkoutTypes.ts` when it grew from the
 * 7 types this app shipped to the donor's **61**, grouped into its eight
 * categories. It is pure data with no I/O, and the picker, the exercise
 * catalogue and the Home dashboard all read it without needing the API client.
 *
 * RE-EXPORTED HERE VERBATIM so every existing importer — `healthExerciseStorage`,
 * `HealthDashboardCards`, the Activity screen — keeps working unchanged.
 */
export {
  DEFAULT_WORKOUT_TYPE,
  DISTANCE_WORKOUT_TYPES,
  isWorkoutType,
  normalizeWorkoutType,
  QUICK_WORKOUT_TYPES,
  searchWorkoutTypes,
  WORKOUT_CATEGORIES,
  WORKOUT_CATEGORY_ICONS,
  WORKOUT_CATEGORY_LABELS,
  WORKOUT_TYPE_CATEGORY,
  WORKOUT_TYPE_ICONS,
  WORKOUT_TYPE_LABELS,
  WORKOUT_TYPES,
  WORKOUT_TYPES_BY_CATEGORY,
  workoutSupportsDistance,
  workoutTypeCategory,
  workoutTypeGroups,
  workoutTypeIcon,
  workoutTypeLabel,
} from './healthWorkoutTypes';
export type { WorkoutCategory, WorkoutType, WorkoutTypeGroup } from './healthWorkoutTypes';

/**
 * How hard the session felt. A real `health_entries.intensity` column since
 * 0124 — see the module header for what it replaced.
 */
export const WORKOUT_INTENSITIES = ['easy', 'steady', 'hard', 'max'] as const;
export type WorkoutIntensity = HealthWorkoutIntensity;

export const WORKOUT_INTENSITY_LABELS: Record<WorkoutIntensity, string> = {
  easy: 'Easy',
  steady: 'Steady',
  hard: 'Hard',
  max: 'All out',
};

/**
 * What an unrecorded session reads as.
 *
 * The column is nullable and the picker defaults here, so the client sends
 * `intensity` only when the user actually moved off it — a plain "log a walk"
 * keeps writing exactly the payload it always has, and "not recorded" stays a
 * real state on the row rather than being backfilled with a guess.
 */
export const DEFAULT_INTENSITY: WorkoutIntensity = 'steady';

export function isWorkoutIntensity(value: unknown): value is WorkoutIntensity {
  return typeof value === 'string' && (WORKOUT_INTENSITIES as readonly string[]).includes(value);
}

export interface WorkoutEntry {
  id: string;
  date: string; // YYYY-MM-DD (local)
  type: WorkoutType;
  minutes: number;
  calories: number;
  intensity: WorkoutIntensity;
  /**
   * How far the session went, in METRES — always metres on the wire, converted
   * for display only (the donor stores metres too: `WorkoutEntry.distance`).
   *
   * `null` is a REAL STATE and is not the same as `0`: it means the session did
   * not record a distance, either because the type does not measure one (yoga)
   * or because the member left the field blank. Every total, tile and chart
   * built from this must skip nulls rather than add them as zero — a 0 km bar
   * on a day someone ran says they stood still.
   */
  distanceM: number | null;
  /**
   * When the session actually happened, ISO local-offset — the donor's
   * `WorkoutEntry.startDate`.
   *
   * `null` on every session logged before the log form had a time field, and
   * on any row a HealthKit import writes without one. Distinct from `loggedAt`,
   * which is the server's `created_at`: that is when the ROW was written, and
   * for a back-dated session the two are days apart.
   */
  startedAt: string | null;
  note: string;
  loggedAt: string; // ISO timestamp
}

export interface StepDay {
  date: string;
  steps: number;
}

export interface ActivityGoals {
  minutes: number;
  steps: number;
}

export const DEFAULT_ACTIVITY_GOALS: ActivityGoals = {
  minutes: 30,
  steps: 8000,
};

const MAX_WORKOUT_ENTRIES = 400;
const MAX_STEP_DAYS = 400;
const MAX_MINUTES = 1440;
const MAX_WORKOUT_CALORIES = 5000;
const MAX_STEPS = 200000;
const MAX_NOTE_LENGTH = 80;
/**
 * 500 km. Comfortably above an ultra or a long ride and far below anything a
 * mistyped figure produces, so a slipped decimal point is refused in words
 * rather than silently owning the y-axis of every distance chart.
 */
const MAX_DISTANCE_M = 500_000;

/* ============================== Distance ============================== */

export const DISTANCE_UNITS = ['km', 'mi'] as const;
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];

const METRES_PER_MILE = 1609.344;

/**
 * Distance follows the ONE unit switch this app has.
 *
 * There is no separate distance preference and this deliberately does not add
 * one: Settings → Units offers Metric/Imperial (0141, `health_goals.unit_system`),
 * and someone on Imperial does not then run in kilometres. Deriving it keeps a
 * single control honest instead of letting units drift apart.
 */
export function distanceUnitFor(system: HealthUnitSystem): DistanceUnit {
  return system === 'imperial' ? 'mi' : 'km';
}

export function metresToDisplay(metres: number, unit: DistanceUnit): number {
  return unit === 'mi' ? metres / METRES_PER_MILE : metres / 1000;
}

export function displayToMetres(value: number, unit: DistanceUnit): number {
  return unit === 'mi' ? value * METRES_PER_MILE : value * 1000;
}

/**
 * `4.2 km`. One decimal is the resolution a phone-logged distance actually has;
 * two would imply a precision nobody typed.
 */
export function formatDistance(metres: number | null, unit: DistanceUnit): string {
  if (metres === null || !Number.isFinite(metres) || metres < 0) return '—';
  return `${metresToDisplay(metres, unit).toFixed(1)} ${unit}`;
}

/**
 * Keep a distance field numeric as it is typed — the weight field's rule, for
 * the same reason: `keyboardType` picks a keyboard, it does not constrain paste,
 * a hardware keyboard, autofill or UI automation.
 */
export function sanitizeDecimalInput(raw: string): string {
  if (typeof raw !== 'string') return '';
  const kept = raw.replace(/[^0-9.,]/g, '');
  const first = kept.search(/[.,]/);
  if (first === -1) return kept;
  return kept.slice(0, first + 1) + kept.slice(first + 1).replace(/[.,]/g, '');
}

/**
 * A typed distance → metres.
 *
 * Blank is VALID and returns `null` — "I did not measure it" is a real answer,
 * and the column stays absent rather than becoming a zero. Anything unparseable,
 * negative or past `MAX_DISTANCE_M` returns `undefined`, which the caller
 * surfaces as a refusal; the two cases must not be conflated.
 */
export function parseDistanceInput(
  raw: string,
  unit: DistanceUnit
): number | null | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return undefined;
  const metres = Math.round(displayToMetres(value, unit));
  if (metres > MAX_DISTANCE_M) return undefined;
  // A typed 0 means "no distance", not "zero metres" — same reading as blank.
  return metres === 0 ? null : metres;
}

/** Digits only — durations, steps and burned calories are whole numbers. */
export function sanitizeIntegerInput(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^0-9]/g, '');
}

/** Parse a required whole-number field: blank/invalid/out-of-range → null. */
export function parseIntegerInput(raw: string, max: number): number | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim();
  if (normalized.length === 0) return null;
  const value = Number(normalized);
  if (!Number.isInteger(value) || value <= 0 || value > max) return null;
  return value;
}

export function parseMinutesInput(raw: string): number | null {
  return parseIntegerInput(raw, MAX_MINUTES);
}

export function parseWorkoutCaloriesInput(raw: string): number | null {
  if (typeof raw === 'string' && raw.trim().length === 0) return 0; // optional
  return parseIntegerInput(raw, MAX_WORKOUT_CALORIES);
}

export function parseStepsInput(raw: string): number | null {
  if (typeof raw === 'string' && raw.trim().length === 0) return 0; // clearing is valid
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0 || value > MAX_STEPS) return null;
  return value;
}

/** `1h 05m` for 65, `45m` for 45 — compact enough for a summary tile. */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`;
}

/** The last `days` day-keys, oldest-first, ending today. */
export function recentDayKeys(days: number, endDate = todayDateKey()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(shiftDateKey(endDate, -i));
  }
  return out;
}

export interface ActivitySummary {
  workouts: number;
  minutes: number;
  calories: number;
  steps: number;
  /**
   * Metres across the sessions that RECORDED one — `null` when none did.
   *
   * `null` rather than `0` so the tile can say "not recorded" instead of
   * claiming the member covered no ground. `distanceSessions` is carried
   * alongside it so a partial figure can disclose how partial it is: "12.4 km
   * over 3 of 7 sessions" is a true statement, "12.4 km" on its own is not.
   */
  distanceM: number | null;
  distanceSessions: number;
}

export function summarizeActivity(
  workouts: WorkoutEntry[],
  steps: StepDay[],
  dayKeys: string[],
): ActivitySummary {
  const inRange = new Set(dayKeys);
  const w = workouts.filter((entry) => inRange.has(entry.date));
  const s = steps.filter((day) => inRange.has(day.date));
  // A type predicate rather than a plain `!== null` filter: it lets TS narrow
  // `distanceM` to `number` below, so the sum needs no `?? 0` fallback for a
  // case this filter has already ruled out.
  const measured = w.filter((e): e is WorkoutEntry & { distanceM: number } => e.distanceM !== null);
  return {
    workouts: w.length,
    minutes: w.reduce((sum, e) => sum + e.minutes, 0),
    calories: w.reduce((sum, e) => sum + e.calories, 0),
    steps: s.reduce((sum, d) => sum + d.steps, 0),
    distanceM: measured.length === 0 ? null : measured.reduce((sum, e) => sum + e.distanceM, 0),
    distanceSessions: measured.length,
  };
}

function isValidWorkout(entry: WorkoutEntry | null | undefined): entry is WorkoutEntry {
  return (
    !!entry &&
    typeof entry.id === 'string' &&
    typeof entry.date === 'string' &&
    typeof entry.type === 'string' &&
    isWorkoutType(entry.type) &&
    Number.isFinite(entry.minutes)
  );
}

/**
 * Read a session written before 0124, when intensity was smuggled into the note
 * as a leading `[hard]` tag.
 *
 * KEPT ON PURPOSE, read-only. Nothing writes a tag any more, but two sources of
 * tagged notes still exist and neither can be fixed by deploying:
 *  - rows migrated by 0124, which lifted the tag into the column WITHOUT
 *    rewriting the note (rewriting would have restamped every workout the user
 *    has ever logged and forced a full re-pull on every device);
 *  - a device still holding a pre-0124 offline cache, whose rows have no
 *    `intensity` field at all.
 * So the tag has to be stripped for display, and it is still the only intensity
 * a stale cached row carries.
 */
export function parseWorkoutNote(raw: string): { intensity: WorkoutIntensity; note: string } {
  const text = typeof raw === 'string' ? raw : '';
  const match = /^\[(easy|steady|hard|max)\]\s*/.exec(text);
  if (!match) return { intensity: DEFAULT_INTENSITY, note: text };
  return { intensity: match[1] as WorkoutIntensity, note: text.slice(match[0].length) };
}

/**
 * Read a distance out of a workout blob.
 *
 * ABSENT STAYS ABSENT. `payload.distance_m ?? 0` would turn every session
 * logged before the field existed — and every yoga class — into a 0 km reading,
 * which is a measurement nobody took. Only a finite, positive number counts;
 * anything else, including a stored `0`, reads as "not recorded".
 */
function readDistance(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_DISTANCE_M, Math.round(value));
}

/** Same contract for the start time: only a usable ISO string counts. */
function readStartedAt(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/** A `workout` health entry's JSON payload → the shape the screen renders. */
function fromWireWorkout(row: {
  id: string;
  date: string;
  data: string;
  intensity?: string | null;
  created_at: string;
}): WorkoutEntry | null {
  let payload: {
    workout_type?: string;
    minutes?: number;
    calories?: number;
    note?: string;
    distance_m?: unknown;
    started_at?: unknown;
  } = {};
  try {
    payload = JSON.parse(row.data ?? '{}');
  } catch {
    return null; // A corrupt payload is skipped, never rendered.
  }
  // `normalizeWorkoutType` rather than a bare `isWorkoutType` guard: it also
  // maps the donor's own spellings (`running`, `cycling`) home, which is what a
  // donor export or a future HKWorkout import will carry.
  const type = normalizeWorkoutType(payload.workout_type);
  // The column wins when it has a value; the legacy tag is the fallback, and is
  // stripped from the note either way so `[hard] ` never reaches the screen.
  const legacy = parseWorkoutNote(payload.note ?? '');
  return {
    id: row.id,
    date: row.date,
    type,
    minutes: Math.max(1, Math.round(payload.minutes ?? 0)),
    calories: Math.max(0, Math.round(payload.calories ?? 0)),
    intensity: isWorkoutIntensity(row.intensity) ? row.intensity : legacy.intensity,
    distanceM: readDistance(payload.distance_m),
    startedAt: readStartedAt(payload.started_at),
    note: legacy.note,
    loggedAt: row.created_at,
  };
}

async function fetchWorkouts(): Promise<WorkoutEntry[]> {
  const res = await healthApi.listEntries({ type: 'workout', limit: MAX_WORKOUT_ENTRIES });
  return (res.entries ?? [])
    .map(fromWireWorkout)
    .filter((e): e is WorkoutEntry => e !== null)
    .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
}

export async function loadWorkouts(): Promise<WorkoutEntry[]> {
  const entries = await readThrough(HEALTH_WORKOUTS_KEY, fetchWorkouts, []);
  return entries
    .filter(isValidWorkout)
    // A cache written before 0124 has no `intensity` key at all, and one written
    // before this port has neither `distanceM` nor `startedAt`. Filling them
    // here rather than at every read site keeps `WORKOUT_INTENSITY_LABELS[...]`
    // from being indexed with undefined, and keeps a missing distance reading as
    // "not recorded" instead of `undefined` leaking into an arithmetic sum.
    .map((entry) => ({
      ...entry,
      intensity: isWorkoutIntensity(entry.intensity) ? entry.intensity : DEFAULT_INTENSITY,
      distanceM: readDistance(entry.distanceM),
      startedAt: readStartedAt(entry.startedAt),
    }))
    .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
}

export interface AddWorkoutInput {
  type: WorkoutType;
  minutes: number;
  calories?: number;
  /** Omitted ⇒ not recorded. Only sent when the user moved off the default. */
  intensity?: WorkoutIntensity;
  /** Metres. `null`/omitted ⇒ not recorded — never written as a zero. */
  distanceM?: number | null;
  /** When the session happened (ISO). Omitted ⇒ now. */
  startedAt?: string | null;
  note?: string;
  date?: string;
}

/**
 * The `health_entries.data` blob for a workout, column-for-column with
 * `POST /entries/workouts` on the server — see the queue comment below for why
 * this has to be reproduced client-side rather than left to the route.
 */
function workoutDataBlob(
  entry: Pick<WorkoutEntry, 'type' | 'minutes' | 'calories' | 'note'>,
  distanceM: number | null,
  startedAt: string
): Record<string, unknown> {
  return {
    workout_type: entry.type,
    minutes: entry.minutes,
    calories: entry.calories,
    note: entry.note,
    ...(distanceM !== null && distanceM > 0 ? { distance_m: distanceM } : {}),
    started_at: startedAt,
  };
}

export async function addWorkoutEntry(input: AddWorkoutInput): Promise<WorkoutEntry[]> {
  const loggedAt = new Date().toISOString();
  const startedAt = readStartedAt(input.startedAt) ?? loggedAt;
  // The DAY is whatever the caller chose; only an absent date falls back to the
  // day the session started, which for a plain "log it now" is today.
  const date = input.date ?? dateKeyOf(startedAt);
  const distanceM = readDistance(input.distanceM);
  const entry: WorkoutEntry = {
    id: `${date}-${loggedAt}`,
    date,
    type: input.type,
    minutes: Math.max(1, Math.round(input.minutes)),
    calories: Math.max(0, Math.round(input.calories ?? 0)),
    intensity: input.intensity ?? DEFAULT_INTENSITY,
    distanceM,
    startedAt,
    note: (input.note ?? '').trim().slice(0, MAX_NOTE_LENGTH),
    loggedAt,
  };
  const optimistic = [entry, ...(await loadWorkouts())].sort((a, b) =>
    b.loggedAt.localeCompare(a.loggedAt),
  );
  return writeThrough(
    HEALTH_WORKOUTS_KEY,
    () =>
      healthApi.logWorkout({
        date: entry.date,
        workout_type: entry.type,
        minutes: entry.minutes,
        calories: entry.calories,
        note: entry.note,
        // Absent rather than 'steady': the column's NULL means "not recorded",
        // and writing the picker's default for everyone would erase that state.
        ...(input.intensity ? { intensity: input.intensity } : {}),
        // Absent rather than 0 for the same reason — see `WorkoutEntry.distanceM`.
        ...(distanceM !== null ? { distance_m: distanceM } : {}),
        started_at: startedAt,
      }),
    fetchWorkouts,
    optimistic,
    `insert type=${entry.type} min=${entry.minutes}`,
    {
      // `/entries/workouts` is a TYPED route — the server assembles the raw
      // `health_entries.data` JSON blob from the fields above. The generic push
      // writer has no such assembly step (it writes `data` as whatever TEXT the
      // row carries), so the blob is built HERE, matching
      // `HealthService.createHealthEntry`'s shape column-for-column.
      queue: {
        collection: 'health_entries',
        row: {
          id: entry.id,
          date: entry.date,
          entry_type: 'workout',
          source: 'manual',
          intensity: input.intensity ?? null,
          data: JSON.stringify(workoutDataBlob(entry, distanceM, startedAt)),
        },
      },
    }
  );
}

export interface UpdateWorkoutInput extends AddWorkoutInput {
  /**
   * An edit is EXPLICIT about intensity: `undefined` here means "back to the
   * default", which has to clear the column rather than leave the old value in
   * place. `addWorkoutEntry` can omit it because there is nothing to clear.
   *
   * `distanceM` reads the same way — an edit that leaves the field blank must
   * REMOVE the stored distance, so it is always sent (as `null` when cleared)
   * rather than omitted.
   */
  intensity?: WorkoutIntensity;
}

/**
 * Edit a session IN PLACE (0124).
 *
 * Replaces the re-record dance this store had to use while `/health/entries`
 * was create + soft-delete only: that cost two round trips, minted a new row id
 * and reset `created_at`, so an edited session jumped to the top of its day and
 * the screen had to warn the user that the logged time would move. A real PUT
 * keeps the row's identity and its place in the history.
 */
export async function updateWorkoutEntry(
  id: string,
  input: UpdateWorkoutInput
): Promise<WorkoutEntry[]> {
  const minutes = Math.max(1, Math.round(input.minutes));
  const calories = Math.max(0, Math.round(input.calories ?? 0));
  const note = (input.note ?? '').trim().slice(0, MAX_NOTE_LENGTH);
  const intensity = input.intensity ?? DEFAULT_INTENSITY;
  const distanceM = readDistance(input.distanceM);
  const startedAt = readStartedAt(input.startedAt);

  const before = await loadWorkouts();
  const found = before.find((e) => e.id === id);
  const optimistic = before.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          type: input.type,
          minutes,
          calories,
          intensity,
          distanceM,
          startedAt: startedAt ?? entry.startedAt,
          note,
          date: input.date ?? entry.date,
        }
      : entry
  );

  return writeThrough(
    HEALTH_WORKOUTS_KEY,
    () =>
      healthApi.updateWorkout(id, {
        workout_type: input.type,
        minutes,
        calories,
        note,
        // Explicit null un-records it — the one case `addWorkoutEntry` cannot
        // express, because there is no stored value to clear on a create. The
        // same applies to distance: clearing the field has to remove the stored
        // figure, not leave the old one behind.
        intensity: input.intensity ?? null,
        distance_m: distanceM,
        ...(startedAt ? { started_at: startedAt } : {}),
        ...(input.date ? { date: input.date } : {}),
      }),
    fetchWorkouts,
    optimistic,
    `update id=${id} min=${minutes}`,
    found
      ? {
          queue: {
            collection: 'health_entries',
            row: {
              id,
              date: input.date ?? found.date,
              entry_type: 'workout',
              source: 'manual',
              intensity: input.intensity ?? null,
              data: JSON.stringify(
                workoutDataBlob(
                  { type: input.type, minutes, calories, note },
                  distanceM,
                  startedAt ?? found.startedAt ?? new Date().toISOString()
                )
              ),
            },
          },
        }
      : undefined
  );
}

export async function deleteWorkoutEntry(id: string): Promise<WorkoutEntry[]> {
  const before = await loadWorkouts();
  const found = before.find((e) => e.id === id);
  const optimistic = before.filter((e) => e.id !== id);
  return writeThrough(
    HEALTH_WORKOUTS_KEY,
    () => healthApi.deleteEntry(id),
    fetchWorkouts,
    optimistic,
    `delete id=${id}`,
    found
      ? {
          queue: {
            collection: 'health_entries',
            row: {
              id,
              date: found.date,
              entry_type: 'workout',
              source: 'manual',
              data: JSON.stringify(
                workoutDataBlob(found, found.distanceM, found.startedAt ?? new Date().toISOString())
              ),
              deleted_at: new Date().toISOString(),
            },
          },
        }
      : undefined
  );
}

async function fetchStepDays(): Promise<StepDay[]> {
  const res = await healthApi.listEntries({ type: 'steps', limit: MAX_STEP_DAYS });
  return (res.entries ?? [])
    .map((row) => {
      try {
        const steps = Number(JSON.parse(row.data ?? '{}')?.steps ?? 0);
        return Number.isFinite(steps) && steps > 0 ? { date: row.date, steps } : null;
      } catch {
        return null;
      }
    })
    .filter((d): d is StepDay => d !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function loadStepDays(): Promise<StepDay[]> {
  const days = await readThrough(HEALTH_STEPS_KEY, fetchStepDays, []);
  return days
    .filter((d) => d && typeof d.date === 'string' && Number.isFinite(d.steps))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function loadStepsForDate(date = todayDateKey()): Promise<number> {
  return (await loadStepDays()).find((d) => d.date === date)?.steps ?? 0;
}

export async function setStepsForDate(steps: number, date = todayDateKey()): Promise<StepDay[]> {
  const clamped = Math.max(0, Math.min(MAX_STEPS, Math.round(steps)));
  const others = (await loadStepDays()).filter((d) => d.date !== date);
  const optimistic = (clamped === 0 ? others : [{ date, steps: clamped }, ...others])
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_STEP_DAYS);
  // The server upserts one manual `steps` row per day, so re-entering a count
  // replaces it rather than stacking.
  //
  // NOT QUEUED FOR OFFLINE RETRY. `health_entries` is ID-KEYED on the push
  // contract (no natural key) — the by-date upsert above is `HealthService`
  // logic, not something `POST /health/sync/push` performs. `StepDay` carries
  // no row id (`fetchStepDays` never returns one), so a queued write here could
  // only ever be a blind CREATE, and if a manual steps row already exists
  // server-side for this day, a queued push would insert a SECOND row rather
  // than replace the first — corrupting the day's step total instead of fixing
  // an offline gap. Left as an optimistic-only write until `StepDay` tracks its
  // id.
  return writeThrough(
    HEALTH_STEPS_KEY,
    () => healthApi.setSteps(date, clamped),
    fetchStepDays,
    optimistic,
    `date=${date} steps=${clamped}`
  );
}

async function fetchActivityGoals(): Promise<Partial<ActivityGoals>> {
  const goal = (await healthApi.getGoal()).goal;
  if (!goal) return {};
  return {
    minutes: goal.daily_workout_minutes ?? undefined,
    steps: goal.daily_steps ?? undefined,
  };
}

export async function loadActivityGoals(): Promise<ActivityGoals> {
  const stored = await readThrough<Partial<ActivityGoals>>(
    HEALTH_ACTIVITY_GOALS_KEY,
    fetchActivityGoals,
    {}
  );
  const merged = { ...DEFAULT_ACTIVITY_GOALS, ...stored };
  return {
    minutes: clampGoal(merged.minutes, DEFAULT_ACTIVITY_GOALS.minutes, MAX_MINUTES),
    steps: clampGoal(merged.steps, DEFAULT_ACTIVITY_GOALS.steps, MAX_STEPS),
  };
}

function clampGoal(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.round(value));
}

export async function saveActivityGoals(goals: Partial<ActivityGoals>): Promise<ActivityGoals> {
  const merged = { ...(await loadActivityGoals()), ...goals };
  const clean: ActivityGoals = {
    minutes: clampGoal(merged.minutes, DEFAULT_ACTIVITY_GOALS.minutes, MAX_MINUTES),
    steps: clampGoal(merged.steps, DEFAULT_ACTIVITY_GOALS.steps, MAX_STEPS),
  };
  await writeThrough(
    HEALTH_ACTIVITY_GOALS_KEY,
    () =>
      healthApi.saveGoal({
        daily_workout_minutes: clean.minutes,
        daily_steps: clean.steps,
      }),
    async () => clean,
    clean,
    `minutes=${clean.minutes} steps=${clean.steps}`,
    // `health_goals` is shared with the weight goal, water target and calorie
    // week — see `enqueueHealthChange`'s merge-at-handle behaviour.
    {
      queue: {
        collection: 'health_goals',
        row: {
          effective_date: todayDateKey(),
          daily_workout_minutes: clean.minutes,
          daily_steps: clean.steps,
        },
      },
    }
  );
  return clean;
}

/* ------------------------------------------------------------------ */
/* Dashboard layout — which of Activity's chart cards, in what order   */
/* ------------------------------------------------------------------ */

/**
 * The same "customisable dashboard" mechanism Home and Weight already use
 * (`healthHomeStorage`/`healthWeightStorage`), brought to Activity so all
 * three tabs share one editor in More → Customize Tabs instead of Activity
 * being the odd one out with a fixed card stack.
 *
 * Only the five chart-style cards below the range picker are customisable —
 * TODAY's goal bars, the log form, the range/stat-tile summary and the
 * SESSIONS history stay fixed, the same way Weight keeps its window navigator
 * and quick-log form outside the reorderable set.
 */
export const ACTIVITY_WIDGET_KEYS = [
  'activeMinutes',
  'caloriesBurned',
  'consistency',
  'byType',
  'stepsDistance',
] as const;

export type ActivityWidgetKey = (typeof ACTIVITY_WIDGET_KEYS)[number];

export interface ActivityWidgetMeta {
  key: ActivityWidgetKey;
  title: string;
  icon: string;
  description: string;
}

export const ACTIVITY_WIDGETS: readonly ActivityWidgetMeta[] = [
  {
    key: 'activeMinutes',
    title: 'Active minutes',
    icon: 'timer',
    description: 'Walk/run vs exercise minutes, bucketed against your daily goal.',
  },
  {
    key: 'caloriesBurned',
    title: 'Calories burned',
    icon: 'energy-burned',
    description: 'Burned kcal per day or block, only where a session counted one.',
  },
  {
    key: 'consistency',
    title: 'Consistency',
    icon: 'streak',
    description: 'A 12-week heatmap of active days.',
  },
  {
    key: 'byType',
    title: 'By type',
    icon: 'workouts',
    description: 'Minutes split across the workout types you logged.',
  },
  {
    key: 'stepsDistance',
    title: 'Steps & distance',
    icon: 'distance',
    description: 'A toggle between your step trend and distance bars.',
  },
] as const;

export const DEFAULT_ACTIVITY_WIDGETS: readonly ActivityWidgetKey[] = [...ACTIVITY_WIDGET_KEYS];

export const HEALTH_ACTIVITY_LAYOUT_KEY = 'health.activityLayout.v1';

export interface ActivityLayout {
  /** Enabled widget keys, in render order. */
  widgets: string[];
}

export const DEFAULT_ACTIVITY_LAYOUT: ActivityLayout = {
  widgets: [...DEFAULT_ACTIVITY_WIDGETS],
};

export async function loadActivityLayout(): Promise<ActivityLayout> {
  const stored = await storageHelpers.getObject<Partial<ActivityLayout>>(HEALTH_ACTIVITY_LAYOUT_KEY);
  const widgets = Array.isArray(stored?.widgets)
    ? stored!.widgets.filter((key): key is string => typeof key === 'string')
    : [...DEFAULT_ACTIVITY_LAYOUT.widgets];
  return { widgets: reconcileActivityWidgets(widgets) };
}

export async function saveActivityLayout(patch: Partial<ActivityLayout>): Promise<ActivityLayout> {
  const next: ActivityLayout = { ...(await loadActivityLayout()), ...patch };
  const reconciled: ActivityLayout = { widgets: reconcileActivityWidgets(next.widgets) };
  await storageHelpers.setObject(HEALTH_ACTIVITY_LAYOUT_KEY, reconciled);
  return reconciled;
}

/** Drop unknown/duplicate keys; fall back to the default when nothing is left. */
export function reconcileActivityWidgets(widgets: readonly string[]): string[] {
  const known = ACTIVITY_WIDGET_KEYS as readonly string[];
  const seen = new Set<string>();
  const kept = widgets.filter((key) => {
    if (!known.includes(key)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return kept.length > 0 ? kept : [...DEFAULT_ACTIVITY_LAYOUT.widgets];
}

export { moveWidget, toggleWidget };
