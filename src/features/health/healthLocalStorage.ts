import { recordE2EPersistEntry } from '@api/e2eTestObservability';
import { healthApi, type HealthGoal, type HealthUnitSystem } from '@api/health';
import { storageHelpers } from '@services/storage';

import { readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — weight / water / notes / preferences.
 *
 * Parity phase P1 moved the record of truth to the `symply-health-api` Worker
 * (see documents/apps/symply-health/PARITY_PLAN.md). These functions keep their
 * original signatures — the screens are unchanged — but now read and write the
 * API through `healthRepository`, with MMKV as an offline read-through cache.
 *
 * Privacy stance (BRD §7) is unchanged in substance: health data is per-USER,
 * never household-shared, never sent to another Symply app, and never sent to
 * an AI provider. It now lives in Health's own isolated D1 rather than only on
 * the handset, which is what makes multi-device and the Watch/Widget possible.
 *
 * The note stays device-local. `preferredUnit` USED to as well — it is now
 * DERIVED from the global `unitSystem` switch (0141, `health_goals.unit_system`),
 * synced server-side for the same reason `water_unit` (0140) is: a choice made
 * once during onboarding should not have to be repeated on a second device.
 */

export const HEALTH_WEIGHT_LOG_KEY = 'health.weightLog.v1';
export const HEALTH_PREFS_KEY = 'health.prefs.v1';
export const HEALTH_UNIT_SYSTEM_KEY = 'health.unitSystem.v1';

export const WEIGHT_UNITS = ['kg', 'lb'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

/**
 * Wheel range per unit for `NumberWheelPickerSheet` — a realistic adult
 * body-weight span, not `MAX_REASONABLE_WEIGHT`'s much looser sanity bound.
 * `WEIGHT_WHEEL_STEP` gives the wheel 1-decimal precision. Shared by the
 * onboarding weight-goal screen and the Home weight widget so both wheels
 * cover the same range and default to the same value.
 */
export const WEIGHT_WHEEL_BOUNDS: Record<WeightUnit, { min: number; max: number; defaultValue: number }> = {
  kg: { min: 30, max: 250, defaultValue: 70 },
  lb: { min: 66, max: 550, defaultValue: 154 },
};
export const WEIGHT_WHEEL_STEP = 0.1;

/** cm or (whole) inches — height has no third unit the way water does. */
export const HEIGHT_UNITS = ['cm', 'in'] as const;
export type HeightUnit = (typeof HEIGHT_UNITS)[number];

export const HEALTH_UNIT_SYSTEMS: readonly HealthUnitSystem[] = ['metric', 'imperial'];
export type { HealthUnitSystem };

function isUnitSystem(value: unknown): value is HealthUnitSystem {
  return typeof value === 'string' && (HEALTH_UNIT_SYSTEMS as readonly string[]).includes(value);
}

/** 'imperial' → lb, 'metric' → kg — the global switch's weight side. */
export function weightUnitFor(system: HealthUnitSystem): WeightUnit {
  return system === 'imperial' ? 'lb' : 'kg';
}

/** 'imperial' → in, 'metric' → cm — the global switch's height side. */
export function heightUnitFor(system: HealthUnitSystem): HeightUnit {
  return system === 'imperial' ? 'in' : 'cm';
}

/** Where a reading came from. `healthkit` rows were imported, not typed. */
export const WEIGHT_SOURCES = ['manual', 'healthkit'] as const;
export type WeightSource = (typeof WEIGHT_SOURCES)[number];

/** A single weight reading. */
export interface WeightEntry {
  id: string;
  value: number;
  unit: WeightUnit;
  loggedAt: string; // ISO timestamp
  /**
   * The DAY the reading belongs to (`YYYY-MM-DD`), which is not always the day
   * it was typed: back-dating an entry is the donor's `AddWeightEntrySheet`
   * date picker, and `loggedAt` would then point at the wrong day. Every chart
   * and every window filter buckets on this, never on `loggedAt`.
   */
  date: string;
  /** Free text the member attached to the reading; `''` when there is none. */
  note: string;
  /**
   * Manual vs imported (0122). Kept on the row rather than inferred so the UI
   * can mark an imported reading — an unexplained number a member did not type
   * is the one they most need to be able to identify before correcting it.
   * A Worker older than 0122 omits it, which reads as `'manual'` (correct: no
   * import path had run when those rows were written).
   */
  source: WeightSource;
}

/**
 * Shell preferences. `healthKitEnabled` and `aiEnabled` are always `false` in
 * the shell — they are surfaced as first-class OFF states, not hidden defaults.
 *
 * `preferredUnit` is DERIVED from `unitSystem` (never independently stored) so
 * the many existing `prefs.preferredUnit` read sites did not all need
 * rewriting when the unit switch moved server-side.
 */
export interface HealthPrefs {
  unitSystem: HealthUnitSystem;
  preferredUnit: WeightUnit;
  healthKitEnabled: boolean;
  aiEnabled: boolean;
}

export const DEFAULT_HEALTH_PREFS: HealthPrefs = {
  unitSystem: 'metric',
  preferredUnit: 'kg',
  healthKitEnabled: false,
  aiEnabled: false,
};

/**
 * How much weight history one read pulls.
 *
 * Raised from 100 for the Weight tab's PAST-window navigation: every range
 * picker in the app used to be trailing-only ("last 30 days"), so an entry from
 * last March was unreachable — and a 100-row window is roughly three months for
 * a daily weigher, which would have made the ◀ button run out of data almost
 * immediately. 500 rows is ~16 months of daily weigh-ins, and the whole log is
 * one cached snapshot the windows are sliced from client-side, so widening it
 * costs one read rather than one read per window.
 */
export const MAX_WEIGHT_ENTRIES = 500;
const MAX_REASONABLE_WEIGHT = 1000; // sanity bound (kg or lb)

export function todayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Local YYYY-MM-DD for an ISO timestamp. */
export function dateKeyOf(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Every day-key field in this feature used to run on
 * `keyboardType="numbers-and-punctuation"` purely to buy the two dashes — the
 * same letters-capable keypad (it carries an `ABC` key) as the Budget
 * savings-goal defect, so a member could type "abc" straight into a date. The
 * fields are `number-pad` now and the dashes are inserted by the mask instead of
 * being typed, which is what keeps the field usable without reopening letters.
 *
 * The masks moved to `@utils/dateInput` once the same fix was owed to the
 * property-tax and utility-bill date fields outside this feature; they are
 * re-exported here so health's own screens keep importing from one place.
 */
export { maskClockInput, maskDayKeyInput } from '@utils/dateInput';

/**
 * True only for a `YYYY-MM-DD` that is a real calendar day.
 *
 * The shape regex on its own is not enough, and became less so once the fields
 * auto-insert their dashes: any eight digits now arrive punctuated, so
 * `0101-20-26` (a pasted `01/01/2026`) matches `^\d{4}-\d{2}-\d{2}$` happily. V8
 * also ROLLS an out-of-range day OVER rather than failing — `2026-02-30` parses
 * as 2 March — so the round-trip comparison is the part that actually refuses
 * one. Both checks are exactly what `parseInjuryDateInput` and the fridge's
 * `parseExpiryInput` already do; this is the same guard for the screens that
 * validate their date field inline.
 */
export function isRealDayKey(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ts = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ts) && new Date(ts).toISOString().slice(0, 10) === value;
}

/**
 * Keep a weight field numeric as it is typed.
 *
 * `keyboardType="decimal-pad"` only picks the on-screen keyboard — it does not
 * constrain the value, so letters still arrive via paste, a hardware keyboard,
 * autofill or UI automation. Strip anything that is not a digit or a decimal
 * separator, and allow at most one separator (the first one entered).
 */
export function sanitizeWeightInput(raw: string): string {
  if (typeof raw !== 'string') return '';
  const digitsAndSeparators = raw.replace(/[^0-9.,]/g, '');
  const firstSeparator = digitsAndSeparators.search(/[.,]/);
  if (firstSeparator === -1) return digitsAndSeparators;
  const head = digitsAndSeparators.slice(0, firstSeparator + 1);
  const tail = digitsAndSeparators.slice(firstSeparator + 1).replace(/[.,]/g, '');
  return head + tail;
}

/**
 * Parse free-text weight input into a clean, bounded number.
 * Accepts comma or dot decimals; returns null for empty / invalid / out-of-range.
 */
export function parseWeightInput(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().replace(',', '.');
  if (normalized.length === 0) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_REASONABLE_WEIGHT) {
    return null;
  }
  return Math.round(value * 10) / 10; // one decimal place
}

/** Human display of a weight value without a trailing `.0`. */
export function formatWeightValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * The DAY a reading belongs to.
 *
 * Prefers the row's own `date` and falls back to the timestamp's local day.
 * The fallback is not decoration: `date` arrived after `HEALTH_WEIGHT_LOG_KEY`
 * did, so a handset that has not synced since carries cached rows without it,
 * and deriving the day from `loggedAt` is exactly what every screen used to do.
 */
export function weightDayOf(entry: Pick<WeightEntry, 'loggedAt'> & { date?: string }): string {
  return entry.date ?? dateKeyOf(entry.loggedAt);
}

/**
 * Entries newest-first, by the day they BELONG to.
 *
 * Ordering by `loggedAt` alone was right while every entry was "now", but the
 * add sheet can back-date: a reading typed today for last Tuesday would sort to
 * the top and be read as the member's current weight. The timestamp stays as the
 * tie-break so two readings on one day still order by when they were taken.
 */
export function sortEntriesDesc(entries: WeightEntry[]): WeightEntry[] {
  return [...entries].sort(
    (a, b) => weightDayOf(b).localeCompare(weightDayOf(a)) || b.loggedAt.localeCompare(a.loggedAt)
  );
}

export function latestWeight(entries: WeightEntry[]): WeightEntry | null {
  return entries.length > 0 ? entries[0] : null;
}

/**
 * Change between the two most recent readings, only when they share a unit.
 * Mixed units return null rather than a misleading converted delta.
 */
export function weightDelta(
  entries: WeightEntry[],
): { value: number; unit: WeightUnit } | null {
  if (entries.length < 2) return null;
  const [latest, previous] = entries;
  if (latest.unit !== previous.unit) return null;
  const diff = Math.round((latest.value - previous.value) * 10) / 10;
  return { value: diff, unit: latest.unit };
}

/** Relative label for an entry timestamp: Today / Yesterday / YYYY-MM-DD. */
export function formatLoggedAt(iso: string): string {
  const entryKey = dateKeyOf(iso);
  if (entryKey === todayDateKey()) return 'Today';
  const yd = new Date();
  yd.setDate(yd.getDate() - 1);
  const yesterdayKey = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, '0')}-${String(
    yd.getDate(),
  ).padStart(2, '0')}`;
  if (entryKey === yesterdayKey) return 'Yesterday';
  return entryKey;
}

/**
 * Same as `formatLoggedAt`, but a same-day entry reads as its time of day
 * ("8:08 AM") instead of the bare word "Today" — for lists (Home's recent-
 * weights row) where more than one entry can land on the same day and would
 * otherwise be indistinguishable from one another.
 */
export function formatLoggedAtTime(iso: string): string {
  const entryKey = dateKeyOf(iso);
  if (entryKey === todayDateKey()) {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return formatLoggedAt(iso);
}

/** Wire row → the shape the screens have always rendered. */
function fromWireWeight(row: {
  id: string;
  weight: number;
  unit: string;
  date: string;
  note?: string | null;
  source?: string | null;
  created_at: string;
}): WeightEntry {
  return {
    id: row.id,
    value: row.weight,
    // The server accepts the donor's 'lbs'; the app has only ever shown 'lb'.
    unit: row.unit === 'lbs' ? 'lb' : (row.unit as WeightUnit),
    loggedAt: row.created_at ?? `${row.date}T12:00:00.000Z`,
    date: row.date,
    note: row.note ?? '',
    // Anything other than an explicit 'healthkit' is a typed reading — a Worker
    // older than 0122 sends no `source` at all, and every row it holds WAS typed.
    source: row.source === 'healthkit' ? 'healthkit' : 'manual',
  };
}

async function fetchWeightLog(): Promise<WeightEntry[]> {
  const res = await healthApi.listWeight({ limit: MAX_WEIGHT_ENTRIES });
  const rows = res.entries ?? [];
  return sortEntriesDesc(rows.map(fromWireWeight));
}

/**
 * Repair a snapshot written by an older build.
 *
 * `date`, `note` and `source` landed after the cache key did, so a device that
 * has not synced since carries rows without them. Deriving the day from
 * `loggedAt` is exactly what the pre-0125 screens did, so this is a no-op for
 * those rows rather than a guess.
 */
function normalizeCachedEntry(entry: WeightEntry): WeightEntry {
  return {
    ...entry,
    date: entry.date ?? dateKeyOf(entry.loggedAt),
    note: entry.note ?? '',
    source: entry.source === 'healthkit' ? 'healthkit' : 'manual',
  };
}

export async function loadWeightLog(): Promise<WeightEntry[]> {
  const entries = await readThrough(HEALTH_WEIGHT_LOG_KEY, fetchWeightLog, []);
  return sortEntriesDesc(
    entries.filter((e) => e && Number.isFinite(e.value)).map(normalizeCachedEntry)
  );
}

/** Optional extras on a new reading — the donor's date picker and note field. */
export interface WeightEntryDraft {
  /** `YYYY-MM-DD`; defaults to today. The donor refuses a FUTURE day. */
  date?: string;
  note?: string;
}

export async function addWeightEntry(
  value: number,
  unit: WeightUnit,
  draft: WeightEntryDraft = {}
): Promise<WeightEntry[]> {
  const loggedAt = new Date().toISOString();
  const date = draft.date ?? todayDateKey();
  const note = (draft.note ?? '').trim();
  const optimistic = sortEntriesDesc([
    { id: loggedAt, value, unit, loggedAt, date, note, source: 'manual' },
    ...(await loadWeightLog()),
  ]);
  return writeThrough(
    HEALTH_WEIGHT_LOG_KEY,
    () =>
      healthApi.createWeight({
        date,
        weight: value,
        unit,
        // Omitted rather than sent empty: the column is nullable and an empty
        // string is not the same as "no note" once it is read back.
        ...(note.length > 0 ? { note } : {}),
      }),
    fetchWeightLog,
    optimistic,
    `insert weight=${value}${unit} date=${date}`,
    {
      // `loggedAt` is the optimistic row's own id (above), so a retried push
      // lands on the SAME row a later edit of this not-yet-synced entry would
      // also target — never a duplicate.
      queue: {
        collection: 'weight_entries',
        row: { id: loggedAt, date, weight: value, unit, note: note.length > 0 ? note : null },
      },
    }
  );
}

/**
 * Edit a reading in place — the donor's `saveEditedEntry`.
 *
 * A weigh-in gets corrected (fat-fingered decimal, wrong unit, logged on the
 * wrong day), and before this the only way to fix one was delete-then-re-add:
 * a new row id, a new `created_at`, and the entry jumping to the top of the
 * list. `PUT /weight/entries/:id` has existed since P1; nothing called it.
 *
 * `note: null` un-records the note; omitting the key keeps whatever is stored.
 */
export async function updateWeightEntry(
  id: string,
  patch: { value?: number; unit?: WeightUnit; date?: string; note?: string | null }
): Promise<WeightEntry[]> {
  const current = await loadWeightLog();
  const optimistic = sortEntriesDesc(
    current.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            value: patch.value ?? entry.value,
            unit: patch.unit ?? entry.unit,
            date: patch.date ?? entry.date,
            note: patch.note === undefined ? entry.note : (patch.note ?? ''),
            // Correcting a FIGURE claims the reading — see below.
            source: patch.value !== undefined ? 'manual' : entry.source,
          }
        : entry
    )
  );
  // Changing the figure re-origins the row to `manual`.
  //
  // Rows imported from Apple Health carry `source: 'healthkit'`, and the import
  // planner protects only rows whose origin is NOT healthkit. So a member who
  // corrected an imported reading used to have it silently overwritten on the
  // next sync — the importer saw "a HealthKit row whose figure changed" and
  // superseded it, undoing the correction. Typing over a figure is the clearest
  // statement of ownership there is, so the row becomes theirs.
  //
  // Re-dating or annotating alone does NOT re-origin it: the reading is still
  // the one the scale recorded, and the sync should keep maintaining it.
  const claimsOwnership = patch.value !== undefined;
  const found = current.find((entry) => entry.id === id);
  return writeThrough(
    HEALTH_WEIGHT_LOG_KEY,
    () =>
      healthApi.updateWeight(id, {
        ...(patch.value !== undefined ? { weight: patch.value } : {}),
        ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
        ...(patch.date !== undefined ? { date: patch.date } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        ...(claimsOwnership ? { source: 'manual' as const } : {}),
      }),
    fetchWeightLog,
    optimistic,
    `update id=${id}`,
    // A PATCH re-sent as a PUSH row needs the WHOLE row, not the partial
    // patch — the push writer has no "leave alone" semantics like the PUT
    // route does, so an offline edit is queued from the ALREADY-MERGED
    // optimistic row rather than from `patch` alone.
    found
      ? {
          queue: {
            collection: 'weight_entries',
            row: {
              id,
              date: patch.date ?? found.date,
              weight: patch.value ?? found.value,
              unit: patch.unit ?? found.unit,
              note: patch.note === undefined ? found.note || null : patch.note,
              source: claimsOwnership ? 'manual' : found.source,
            },
          },
        }
      : undefined
  );
}

export async function deleteWeightEntry(id: string): Promise<WeightEntry[]> {
  const current = await loadWeightLog();
  const found = current.find((entry) => entry.id === id);
  const optimistic = current.filter((e) => e.id !== id);
  return writeThrough(
    HEALTH_WEIGHT_LOG_KEY,
    () => healthApi.deleteWeight(id),
    fetchWeightLog,
    optimistic,
    `delete id=${id}`,
    found
      ? {
          queue: {
            collection: 'weight_entries',
            row: {
              id,
              date: found.date,
              weight: found.value,
              unit: found.unit,
              deleted_at: new Date().toISOString(),
            },
          },
        }
      : undefined
  );
}

/**
 * True once the answer came from a Worker that has migration 0141.
 *
 * Presence of the KEY is the signal, not its value — same reasoning
 * `hasServerWaterUnitSupport` documents in `healthWaterStorage.ts`.
 */
function hasServerUnitSystemSupport(goal: HealthGoal | null | undefined): boolean {
  return goal !== null && goal !== undefined && 'unit_system' in goal;
}

async function fetchUnitSystem(): Promise<HealthUnitSystem> {
  const { goal } = await healthApi.getGoal();
  const cached = await storageHelpers.getObject<HealthUnitSystem>(HEALTH_UNIT_SYSTEM_KEY);
  const cachedSystem = isUnitSystem(cached) ? cached : null;

  // A Worker without 0141 cannot answer the question, so its silence must not
  // be read as "reset to metric" — keep whatever this handset last knew.
  if (!hasServerUnitSystemSupport(goal)) {
    return cachedSystem ?? DEFAULT_HEALTH_PREFS.unitSystem;
  }
  const system = goal?.unit_system;
  return isUnitSystem(system) ? system : DEFAULT_HEALTH_PREFS.unitSystem;
}

/**
 * The local-only shell invariants (`healthKitEnabled`/`aiEnabled`, always
 * forced off) MERGED with the server-synced unit system (0141) and its two
 * derived units.
 */
export async function loadHealthPrefs(): Promise<HealthPrefs> {
  const unitSystem = await readThrough(
    HEALTH_UNIT_SYSTEM_KEY,
    fetchUnitSystem,
    DEFAULT_HEALTH_PREFS.unitSystem
  );
  return {
    ...DEFAULT_HEALTH_PREFS,
    unitSystem,
    preferredUnit: weightUnitFor(unitSystem),
    // Shell invariants: these stay off regardless of what was persisted.
    healthKitEnabled: false,
    aiEnabled: false,
  };
}

/**
 * Set the ONE global unit-system switch, synced to the shared, effective-dated
 * `health_goals` row — see `saveWeightGoal`'s own header comment (in
 * `healthWeightStorage.ts`) for why a queued offline write MERGES with
 * whatever else is already queued at the same `(collection, effective_date)`
 * handle rather than clobbering a sibling feature's edit.
 */
export async function setUnitSystem(system: HealthUnitSystem): Promise<HealthPrefs> {
  const next: HealthUnitSystem = isUnitSystem(system) ? system : DEFAULT_HEALTH_PREFS.unitSystem;
  const written = await writeThrough(
    HEALTH_UNIT_SYSTEM_KEY,
    () => healthApi.saveGoal({ unit_system: next }),
    // Re-read so a server that silently dropped the key (pre-0141) is caught
    // on the next read rather than believed.
    async () => {
      const { goal } = await healthApi.getGoal();
      const fresh = goal?.unit_system;
      return hasServerUnitSystemSupport(goal) && isUnitSystem(fresh) ? fresh : next;
    },
    next,
    `unit_system=${next}`,
    {
      queue: {
        collection: 'health_goals',
        row: { unit_system: next, effective_date: todayDateKey() },
      },
    }
  );
  return {
    ...DEFAULT_HEALTH_PREFS,
    unitSystem: written,
    preferredUnit: weightUnitFor(written),
    healthKitEnabled: false,
    aiEnabled: false,
  };
}

/**
 * Compatibility shim for the many existing weight-unit call sites: setting a
 * `WeightUnit` directly now just flips the same global `unitSystem` switch
 * `setUnitSystem` writes — kg/lb was never a second, independent preference.
 */
export function setPreferredUnit(unit: WeightUnit): Promise<HealthPrefs> {
  return setUnitSystem(unit === 'lb' ? 'imperial' : 'metric');
}

/* ------------------------------------------------------------------ */
/* Water intake — local-only daily counter                            */
/* ------------------------------------------------------------------ */

export const HEALTH_WATER_KEY = 'health.water.v1';
export const DEFAULT_WATER_TARGET = 8;
const MAX_CUPS = 30;

export interface WaterDay {
  date: string;
  cups: number;
  target: number;
}

export function clampCups(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_CUPS, Math.round(n)));
}

export function clampTarget(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WATER_TARGET;
  return Math.max(1, Math.min(MAX_CUPS, Math.round(n)));
}

export function createEmptyWaterDay(
  date = todayDateKey(),
  target = DEFAULT_WATER_TARGET,
): WaterDay {
  return { date, cups: 0, target: clampTarget(target) };
}

/** A cup is 240 ml — the donor's constant; the server stores millilitres. */
export const CUP_ML = 240;

async function fetchWaterToday(): Promise<WaterDay> {
  const today = todayDateKey();
  const res = await healthApi.waterSummary(today);
  const summary = res.summary;
  const cachedTarget = (await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY))?.target;
  return {
    date: today,
    cups: clampCups(Math.round((summary?.total_ml ?? 0) / CUP_ML)),
    // The goal lives on the effective-dated goal row; fall back to the last
    // known local target so an unset goal does not reset the ring to 8 daily.
    target: clampTarget(
      summary?.goal_ml ? summary.goal_ml / CUP_ML : (cachedTarget ?? DEFAULT_WATER_TARGET)
    ),
  };
}

export async function loadWaterToday(): Promise<WaterDay> {
  const today = todayDateKey();
  const day = await readThrough(
    HEALTH_WATER_KEY,
    fetchWaterToday,
    createEmptyWaterDay(today, DEFAULT_WATER_TARGET)
  );
  if (day.date !== today) {
    // A cached snapshot from a previous day: reset the count, carry the target.
    return createEmptyWaterDay(today, day.target ?? DEFAULT_WATER_TARGET);
  }
  return { date: day.date, cups: clampCups(day.cups), target: clampTarget(day.target) };
}

/**
 * Rolling per-day water history.
 *
 * `HEALTH_WATER_KEY` only ever holds TODAY (it resets at midnight), so the
 * Trends tab would have nothing to average.
 *
 * The history is derived from the SERVER's per-entry water rows, grouped by day
 * — not from a device-local log. Deriving it locally would leave Trends blank on
 * a new device and wrong after a reinstall, because it would only ever contain
 * days that this handset happened to log.
 */
export const HEALTH_WATER_HISTORY_KEY = 'health.waterHistory.v1';
const MAX_WATER_HISTORY_DAYS = 400;

async function fetchWaterHistory(): Promise<WaterDay[]> {
  const to = todayDateKey();
  const from = dateKeyOf(new Date(Date.now() - MAX_WATER_HISTORY_DAYS * 86_400_000).toISOString());
  const res = await healthApi.listWater({ from, to });
  const goal = (await healthApi.getGoal()).goal;
  const target = clampTarget(
    goal?.daily_water_ml ? goal.daily_water_ml / CUP_ML : DEFAULT_WATER_TARGET
  );

  const mlByDay = new Map<string, number>();
  for (const row of res.entries ?? []) {
    mlByDay.set(row.date, (mlByDay.get(row.date) ?? 0) + row.amount_ml);
  }
  return [...mlByDay.entries()]
    .map(([date, ml]) => ({ date, cups: clampCups(Math.round(ml / CUP_ML)), target }))
    .filter((d) => d.cups > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_WATER_HISTORY_DAYS);
}

export async function loadWaterHistory(): Promise<WaterDay[]> {
  const history = await readThrough(HEALTH_WATER_HISTORY_KEY, fetchWaterHistory, []);
  return history
    .filter((d) => d && typeof d.date === 'string' && Number.isFinite(d.cups))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Optimistically fold today into the cached history after a write.
 *
 * Reads the CACHE directly rather than `loadWaterHistory()` — that would fire a
 * second network round-trip (water list + goal) on every single cup tap. The
 * next successful read-through replaces this with the server's own grouping.
 */
async function recordWaterHistory(day: WaterDay): Promise<void> {
  const cached = (await storageHelpers.getObject<WaterDay[]>(HEALTH_WATER_HISTORY_KEY)) ?? [];
  const others = cached.filter((d) => d && d.date !== day.date);
  const next = (day.cups > 0 ? [day, ...others] : others)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_WATER_HISTORY_DAYS);
  await storageHelpers.setObject(HEALTH_WATER_HISTORY_KEY, next);
}

/**
 * ± one cup. "Minus" is an UNDO of the last sip rather than a negative entry —
 * a negative volume would corrupt every downstream average.
 */
export async function adjustWater(delta: number): Promise<WaterDay> {
  const day = await loadWaterToday();
  // A non-finite delta must be a no-op, not a destructive one. `NaN > 0` is
  // false, which would route to `undoWater` and silently delete the user's most
  // recent sip; `Infinity > 0` is true, which would put a non-serialisable
  // amount on the wire.
  if (!Number.isFinite(delta) || delta === 0) return day;

  const clamped = clampCups(day.cups + delta);
  // At either clamp bound the display cannot move, so a tap there must be a
  // true no-op: without this check, a `+1` at the 30-cup ceiling still POSTed
  // a real row to the server (the ring stayed pinned at 30 for two taps while
  // the underlying total quietly grew), and a `-1` at zero still asked the
  // server to undo a sip that does not exist.
  if (clamped === day.cups) return day;

  const optimistic: WaterDay = { ...day, cups: clamped };
  const today = todayDateKey();
  // Random suffix, not just the timestamp: two taps inside the same
  // millisecond must still mint DISTINCT rows, or the second queued entry
  // would be read as an EDIT of the first and one sip would be lost.
  const queuedId = `wq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const next = await writeThrough(
    HEALTH_WATER_KEY,
    () =>
      delta > 0
        ? healthApi.addWater({ date: today, amount_ml: CUP_ML * delta })
        : healthApi.undoWater(today),
    fetchWaterToday,
    optimistic,
    `date=${today} cups=${optimistic.cups}`,
    // Only the ADD half is queueable. "Minus" asks the server to remove
    // whichever row is currently its most recent for the day — a target this
    // device cannot name while offline, so a `delta < 0` failure is NOT queued
    // and simply stays an optimistic local change until the next successful
    // sync reconciles it.
    delta > 0
      ? {
          queue: {
            collection: 'water_entries',
            row: { id: queuedId, date: today, amount_ml: CUP_ML * delta },
          },
        }
      : undefined
  );
  await recordWaterHistory(next);
  return next;
}

export async function setWaterTarget(target: number): Promise<WaterDay> {
  const day = await loadWaterToday();
  const next: WaterDay = { ...day, target: clampTarget(target) };
  await writeThrough(
    HEALTH_WATER_KEY,
    () => healthApi.saveGoal({ daily_water_ml: clampTarget(target) * CUP_ML }),
    async () => next,
    next,
    `target=${next.target}`,
    {
      // `health_goals` is ONE effective-dated row shared by four unrelated
      // features (this one, the weight goal, the calorie week, activity
      // goals). `enqueueHealthChange` MERGES a queued row with whatever is
      // already queued at the same `(collection, effective_date)` handle
      // rather than replacing it, which is what stops this write from
      // dropping a sibling feature's offline edit to the same day's row.
      queue: {
        collection: 'health_goals',
        row: { effective_date: todayDateKey(), daily_water_ml: clampTarget(target) * CUP_ML },
      },
    }
  );
  await recordWaterHistory(next);
  return next;
}

/* ------------------------------------------------------------------ */
/* Daily note — local-only free-text reflection per day               */
/* ------------------------------------------------------------------ */

export const HEALTH_NOTES_KEY = 'health.notes.v1';
const MAX_NOTES = 60;

export interface DailyNote {
  date: string;
  text: string;
  updatedAt: string;
}

export async function loadNotes(): Promise<DailyNote[]> {
  const stored = await storageHelpers.getObject<DailyNote[]>(HEALTH_NOTES_KEY);
  if (!Array.isArray(stored)) return [];
  return [...stored].sort((a, b) => b.date.localeCompare(a.date));
}

export async function loadNoteForDate(date = todayDateKey()): Promise<string> {
  const notes = await loadNotes();
  return notes.find((n) => n.date === date)?.text ?? '';
}

export async function saveNoteForDate(
  text: string,
  date = todayDateKey(),
): Promise<DailyNote[]> {
  const others = (await loadNotes()).filter((n) => n.date !== date);
  const trimmed = text.trim();
  const next =
    trimmed.length === 0
      ? others
      : [{ date, text: trimmed, updatedAt: new Date().toISOString() }, ...others];
  next.sort((a, b) => b.date.localeCompare(a.date));
  const capped = next.slice(0, MAX_NOTES);
  await storageHelpers.setObject(HEALTH_NOTES_KEY, capped);
  recordE2EPersistEntry({
    store: HEALTH_NOTES_KEY,
    operation: trimmed.length === 0 ? 'delete' : 'upsert',
    detail: `date=${date} len=${trimmed.length}`,
  });
  return capped;
}
