/**
 * Symply Health — HealthKit integration service (parity phase P3).
 *
 * ## What this is
 *
 * The donor read HealthKit directly from Swift. The RN port has shipped with
 * "Apple Health — not connected" as a first-class OFF state since P1, and that
 * does not change here: this service is an OPTIONAL, OPT-IN, READ-ONLY, SCOPED
 * source of extra data. Everything in Symply Health keeps working when it is
 * unavailable, un-requested, or denied — manual entry is never removed, never
 * degraded, and never hidden behind a permission prompt.
 *
 * ## Four rules this file exists to enforce
 *
 * 1. **Scope.** Only the five types in `healthKitTypes.ts` are ever requested.
 *    Identifiers a bridge hands back are filtered through `isScopedIdentifier`,
 *    so a native module cannot widen our footprint from the outside.
 * 2. **Read-only.** Nothing here writes to HealthKit. `HEALTHKIT_WRITE_IDENTIFIERS`
 *    is empty and the bridge interface has no write method to call.
 * 3. **Denied is not an error.** Unavailable, un-requested and denied are three
 *    ordinary states with their own copy. Nothing in this file throws for them,
 *    and no OS/system string ever leaves this module (see the no-raw-error-leaks
 *    rule) — bridge failures degrade to a state, not a toast.
 * 4. **Manual data wins.** A day the user typed is never overwritten, and a
 *    re-import never stacks: the import is planned against what the server
 *    already has, one row per (day, type).
 *
 * ## Why there is a bridge interface instead of a dependency
 *
 * Everything below is written against `HealthKitBridge` — a four-method interface
 * — rather than against a HealthKit library. The real implementation lives in
 * `healthKitBridge.ts` over the local Expo module `modules/symply-healthkit`
 * (chosen over a community package: `modules/widget-sync` and `modules/roomplan`
 * already establish the pattern, and a fifty-line read-only adapter is a smaller
 * surface than a dependency that requests types we do not want). `nullHealthKitBridge`
 * is still the fallback whenever a real one cannot exist — another brand, Android,
 * a build without the entitlement — and it honestly reports `unavailable`.
 *
 * ## iOS read-permission honesty
 *
 * HealthKit deliberately refuses to tell an app whether READ access was granted
 * — `authorizationStatus(for:)` keeps returning `notDetermined` for read-only
 * requests even after the user says yes, precisely so an app cannot infer that
 * someone is hiding a condition. That is modelled here as the `'undisclosed'`
 * per-type status rather than papered over: we say "connected" once the sheet
 * has been answered without an explicit denial, and we never claim a grant we
 * cannot see.
 */

import { healthApi, type HealthEntry, type HealthNutritionEntry, type HealthWeightEntry } from '@api/health';
import { storageHelpers } from '@services/storage';

import { resolveHealthKitBridge } from './healthKitBridge';
import {
  HEALTHKIT_DATA_TYPES,
  HEALTHKIT_DESCRIPTORS,
  HEALTHKIT_NUTRITION_TYPES,
  HEALTHKIT_READ_IDENTIFIERS,
  HEALTHKIT_TYPES,
  HEALTHKIT_WEIGHT_TYPES,
  isScopedIdentifier,
  type HealthKitAggregation,
  type HealthKitDataType,
  type HealthKitEntryPayload,
  type HealthKitEntryType,
  type HealthKitNutritionPayload,
  type HealthKitSample,
  type HealthKitWeightPayload,
  type HealthKitWeightUnit,
  type HealthKitWorkoutPayload,
  type HealthKitWorkoutSample,
} from './healthKitTypes';
import { loadHealthPrefs } from './healthLocalStorage';

/* ============================== Availability ============================= */

export type HealthKitUnavailableReason =
  /** No native bridge wired yet — the current state of this repo. */
  | 'no-bridge'
  /** Android / web / simulator without Health data. */
  | 'unsupported-device'
  /** The bridge itself failed. Never surfaced verbatim. */
  | 'bridge-error';

export interface HealthKitAvailability {
  readonly available: boolean;
  readonly reason: HealthKitUnavailableReason | null;
}

const AVAILABLE: HealthKitAvailability = { available: true, reason: null };

function unavailable(reason: HealthKitUnavailableReason): HealthKitAvailability {
  return { available: false, reason };
}

/* ============================= Authorisation ============================= */

/** Exactly the three states iOS reports, normalised at the bridge boundary. */
export type HealthKitRawAuthorization = 'notDetermined' | 'sharingDenied' | 'sharingAuthorized';

/**
 * Our per-type view.
 *
 * `'undisclosed'` is the honest one: the permission sheet has been answered and
 * iOS will not say whether read access was granted. It is NOT a synonym for
 * granted and NOT a synonym for denied.
 */
export type HealthKitAuthorization =
  | 'unavailable'
  | 'not-requested'
  | 'undisclosed'
  | 'granted'
  | 'denied';

/** The four states the connect card renders. */
export type HealthKitConnectionState = 'unavailable' | 'not-requested' | 'denied' | 'connected';

export type HealthKitAuthorizationMap = Readonly<Record<HealthKitDataType, HealthKitAuthorization>>;

export interface HealthKitStatus {
  readonly state: HealthKitConnectionState;
  readonly availability: HealthKitAvailability;
  readonly perType: HealthKitAuthorizationMap;
  /** ISO instant the permission sheet was last answered, or `null`. */
  readonly requestedAt: string | null;
  /** ISO instant of the last successful import, or `null`. */
  readonly lastSyncedAt: string | null;
}

/** Every type at the same status — used for the unavailable/never-asked cases. */
export function uniformAuthorization(status: HealthKitAuthorization): HealthKitAuthorizationMap {
  return Object.fromEntries(
    HEALTHKIT_DATA_TYPES.map((type) => [type, status]),
  ) as HealthKitAuthorizationMap;
}

/**
 * Raw iOS status → our per-type status.
 *
 * `notDetermined` means two different things depending on whether we have ever
 * shown the sheet, which is why `requestedAt` is an input rather than something
 * inferred from the status alone.
 */
export function mapRawAuthorization(
  raw: HealthKitRawAuthorization | undefined,
  requestedAt: string | null,
): HealthKitAuthorization {
  if (raw === 'sharingAuthorized') return 'granted';
  // `sharingDenied` is `authorizationStatus(for:)` reporting WRITE (share)
  // authorization, not read — and every identifier here is READ-only
  // (`HEALTHKIT_WRITE_IDENTIFIERS` is empty). Confirmed on a real device
  // 2026-07-27: a member who had just granted all five read toggles in
  // Settings still got `sharingDenied` back from the bridge for every one of
  // them, because iOS answers "not authorized to WRITE this" — which is
  // trivially true, since this app never asks to write — regardless of the
  // READ answer. Treating it as an explicit decline was the bug (it showed
  // "Apple Health access is off" to someone who had just said yes); it must
  // fold into the same "answered, iOS won't say more" bucket as
  // `notDetermined`, or a bridge that omitted the type entirely.
  return requestedAt ? 'undisclosed' : 'not-requested';
}

/**
 * The state machine, kept pure so every branch is testable without a bridge.
 *
 * Order matters, and it is ordered by what iOS actually tells us rather than by
 * what we remember asking:
 *
 * 1. unavailable wins over everything — an un-askable permission is not "denied".
 * 2. any type explicitly granted → `connected`, even with no local record of a
 *    request. A reinstall keeps the OS grant but loses our timestamp, and the
 *    user should not be asked again for something they already said yes to.
 * 3. every type explicitly denied → `denied`, again regardless of our record:
 *    revoking in Settings › Health is a denial we must honour immediately.
 * 4. never asked → `not-requested`; the card offers Connect.
 * 5. otherwise → `connected`. The sheet was answered and iOS will not disclose
 *    read grants (see the note at the top of this file).
 */
export function deriveConnectionState(input: {
  availability: HealthKitAvailability;
  perType: HealthKitAuthorizationMap;
  requestedAt: string | null;
}): HealthKitConnectionState {
  if (!input.availability.available) return 'unavailable';

  const statuses = HEALTHKIT_DATA_TYPES.map((type) => input.perType[type]);
  if (statuses.some((status) => status === 'granted')) return 'connected';
  if (statuses.every((status) => status === 'denied')) return 'denied';
  if (!input.requestedAt) return 'not-requested';
  return 'connected';
}

/* ================================ Bridge ================================ */

export interface HealthKitQuery {
  readonly type: HealthKitDataType;
  /** Inclusive ISO instant. */
  readonly start: string;
  /** Exclusive ISO instant. */
  readonly end: string;
}

/** A workout query has no `type` — there is only one workout sample type. */
export interface HealthKitWorkoutQuery {
  /** Inclusive ISO instant. */
  readonly start: string;
  /** Exclusive ISO instant. */
  readonly end: string;
}

/**
 * The whole native surface: read-only, no write method anywhere.
 *
 * `queryWorkouts` is separate from `querySamples` because a workout carries
 * several facets at once (type, duration, calories, distance, Apple's own
 * `uuid`) rather than one scalar `value` — see `HealthKitWorkoutSample`.
 * Background-wake-up concerns (the `onHealthDataChanged` event,
 * `consumePendingSync`) are deliberately NOT here — see the doc comment on
 * `HealthKitNativeModule` in `healthKitBridge.ts` for why.
 */
export interface HealthKitBridge {
  /** `HKHealthStore.isHealthDataAvailable()`. */
  isAvailable(): Promise<boolean> | boolean;
  /** Current status for each identifier, without prompting. */
  getAuthorizationStatus(
    identifiers: readonly string[],
  ): Promise<Readonly<Record<string, HealthKitRawAuthorization>>>;
  /** Show the OS sheet for exactly `identifiers`, READ only. */
  requestAuthorization(
    identifiers: readonly string[],
  ): Promise<Readonly<Record<string, HealthKitRawAuthorization>>>;
  /** Samples in `[start, end)`, already normalised to the type's unit. */
  querySamples(query: HealthKitQuery): Promise<readonly HealthKitSample[]>;
  /** Workout sessions in `[start, end)`, oldest-first. */
  queryWorkouts(query: HealthKitWorkoutQuery): Promise<readonly HealthKitWorkoutSample[]>;
}

/**
 * The null object: a complete, honest bridge that reports `unavailable`.
 *
 * This is what ships until a native module is added. It never throws, so every
 * caller — service, screen, card — behaves exactly as it would on an Android
 * handset or a device with Health switched off.
 */
export const nullHealthKitBridge: HealthKitBridge = {
  isAvailable: () => false,
  getAuthorizationStatus: async () => ({}),
  requestAuthorization: async () => ({}),
  querySamples: async () => [],
  queryWorkouts: async () => [],
};

/* ============================== Persistence ============================= */

export interface HealthKitPersistedState {
  requestedAt: string | null;
  lastSyncedAt: string | null;
}

export const EMPTY_HEALTHKIT_STATE: HealthKitPersistedState = {
  requestedAt: null,
  lastSyncedAt: null,
};

export interface HealthKitStateStore {
  read(): Promise<HealthKitPersistedState>;
  write(next: HealthKitPersistedState): Promise<void>;
}

/**
 * Default store. In-memory on purpose: nothing this module does should touch
 * the disk unless the app deliberately opts in, so tests stay hermetic and a
 * library import never leaves a trace behind.
 */
export function createInMemoryHealthKitStore(
  initial: HealthKitPersistedState = EMPTY_HEALTHKIT_STATE,
): HealthKitStateStore {
  let state: HealthKitPersistedState = { ...initial };
  return {
    read: async () => ({ ...state }),
    write: async (next) => {
      state = { ...next };
    },
  };
}

/**
 * Persistence key for the opt-in store below.
 *
 * NOTE for whoever wires this into the app: add this key to
 * `HEALTH_CACHE_KEYS` in `healthCacheKeys.ts` in the same commit, so sign-out
 * clears it. It holds no health data — just two timestamps — but leaving one
 * user's "last synced" visible to the next person on the handset is exactly the
 * leak `privacy-cross-user-leak.yaml` guards against.
 */
export const HEALTHKIT_STATE_KEY = 'health.healthKit.v1';

/** Storage-backed store, for when the app wants "last synced" to survive a relaunch. */
export function createStoredHealthKitStore(key: string = HEALTHKIT_STATE_KEY): HealthKitStateStore {
  return {
    read: async () => {
      const stored = await storageHelpers.getObject<Partial<HealthKitPersistedState>>(key);
      return {
        requestedAt: typeof stored?.requestedAt === 'string' ? stored.requestedAt : null,
        lastSyncedAt: typeof stored?.lastSyncedAt === 'string' ? stored.lastSyncedAt : null,
      };
    },
    write: async (next) => {
      await storageHelpers.setObject(key, next);
    },
  };
}

/* =============================== Windowing ============================== */

export interface HealthKitWindow {
  /** Inclusive ISO instant — the start of the first local day in the window. */
  readonly start: string;
  /** Exclusive ISO instant — "now". */
  readonly end: string;
}

/**
 * Donor parity: `HealthKitBackgroundDeliveryManager.initialSyncDays = 7` and
 * `HealthKitSyncService.fallbackSyncDays = 7`. Seven days is also the smallest
 * window that survives a weekend offline, which is the point.
 */
export const HEALTHKIT_DEFAULT_WINDOW_DAYS = 7;

/**
 * Hard ceiling. A first connect must not vacuum up years of history: that is a
 * privacy decision as much as a performance one, and the donor's own initial
 * sync was capped for the same reason.
 */
export const HEALTHKIT_MAX_WINDOW_DAYS = 30;

/** Local midnight for an instant, as a `Date`. */
function startOfLocalDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0);
}

/** `YYYY-MM-DD` in LOCAL time — a sample at 23:30 belongs to that evening. */
export function localDayKey(instant: string | Date): string | null {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * A whole-day window ending now: `days` calendar days INCLUDING today.
 *
 * Days are clamped into `[1, HEALTHKIT_MAX_WINDOW_DAYS]` and a non-finite value
 * falls back to the default, so a bad caller can never ask iOS for everything.
 */
export function healthKitWindow(
  days: number = HEALTHKIT_DEFAULT_WINDOW_DAYS,
  now: Date = new Date(),
): HealthKitWindow {
  const requested = Number.isFinite(days) ? Math.floor(days) : HEALTHKIT_DEFAULT_WINDOW_DAYS;
  const clamped = Math.min(HEALTHKIT_MAX_WINDOW_DAYS, Math.max(1, requested));

  const start = startOfLocalDay(now);
  start.setDate(start.getDate() - (clamped - 1));

  return { start: start.toISOString(), end: now.toISOString() };
}

/** True when the sample's start instant falls inside `[start, end)`. */
export function isSampleInWindow(sample: HealthKitSample, window: HealthKitWindow): boolean {
  const at = new Date(sample.startedAt).getTime();
  if (Number.isNaN(at)) return false;
  return at >= new Date(window.start).getTime() && at < new Date(window.end).getTime();
}

/** One calendar-month chunk of {@link healthKitHistoricalWindows}. */
export interface HealthKitHistoricalChunk {
  /** e.g. `"June"` — the label a progress UI shows while this chunk is read. */
  readonly label: string;
  readonly window: HealthKitWindow;
}

/**
 * The two-chunk historical backfill `importNow()` reads by default: the whole
 * of last calendar month, then this month to date.
 *
 * `HEALTHKIT_DEFAULT_WINDOW_DAYS` (a rolling seven days) is a catch-up window,
 * good for a device that already has recent history. It is the wrong shape for
 * the FIRST thing a member ever sees after connecting, which should look like
 * their real month, not the last week of it. Two calendar months stays a
 * deliberate, bounded exception to `HEALTHKIT_MAX_WINDOW_DAYS` rather than a
 * loophole around it — never more than ~62 days, by construction, however far
 * this function is called from a month boundary.
 */
export function healthKitHistoricalWindows(now: Date = new Date()): readonly HealthKitHistoricalChunk[] {
  const startOfThisMonth = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const startOfPreviousMonth = startOfLocalDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const monthLabel = (at: Date) => at.toLocaleDateString(undefined, { month: 'long' });

  return [
    {
      label: monthLabel(startOfPreviousMonth),
      window: { start: startOfPreviousMonth.toISOString(), end: startOfThisMonth.toISOString() },
    },
    {
      label: monthLabel(startOfThisMonth),
      window: { start: startOfThisMonth.toISOString(), end: now.toISOString() },
    },
  ];
}

/* ============================ Sample → payload ========================== */

/**
 * The LOCAL day a sample belongs to, or `null` when the sample is unusable.
 *
 * One function rather than a boolean guard plus a separate day-key derivation:
 * every caller needs the key anyway, and having the guard hand it back means no
 * caller has to re-check a value the guard already proved good.
 */
function usableDayKey(sample: HealthKitSample): string | null {
  const descriptor = HEALTHKIT_TYPES[sample.type];
  if (!descriptor) return null;
  // A unit mismatch means the bridge did not normalise — dropping is the only
  // safe answer, because guessing turns 70 kg into 70 lb in someone's log.
  if (sample.unit !== descriptor.unit) return null;
  if (typeof sample.value !== 'number' || !Number.isFinite(sample.value)) return null;
  if (sample.value < 0) return null;
  return localDayKey(sample.startedAt);
}

function isUsableSample(sample: HealthKitSample): boolean {
  return usableDayKey(sample) !== null;
}

function aggregate(values: readonly number[], how: HealthKitAggregation): number {
  // Unreachable: a bucket only comes into existence once a sample has been
  // pushed into it, so `values` is never empty. Kept because `average` would
  // divide by zero and `latest` would read past the end of the array.
  /* istanbul ignore next */
  if (values.length === 0) return 0;
  if (how === 'sum') return values.reduce((total, value) => total + value, 0);
  if (how === 'average') return values.reduce((total, value) => total + value, 0) / values.length;
  return values[values.length - 1];
}

/**
 * Collapse raw samples into at most ONE payload per (local day, type).
 *
 * This is the first half of "a re-import does not stack": a day with 400 step
 * samples and a day with one both produce exactly one row. Samples the bridge
 * should never have sent (out-of-scope type, wrong unit, negative, unparseable
 * date) are dropped rather than thrown over — a malformed sample must not take
 * a whole import down with it.
 *
 * `bodyMass` has no `entryType`, so it produces no payload at all. It is read
 * for display only; see the note in `healthKitTypes.ts`.
 */
export function mapSamplesToPayloads(
  samples: readonly HealthKitSample[],
): HealthKitEntryPayload[] {
  const buckets = new Map<
    string,
    {
      date: string;
      entryType: HealthKitEntryType;
      dataKey: string;
      aggregation: HealthKitAggregation;
      values: number[];
    }
  >();

  for (const sample of samples) {
    const date = usableDayKey(sample);
    if (!date) continue;

    const descriptor = HEALTHKIT_TYPES[sample.type];
    // `bodyMass` states neither, because it is a weight-log row rather than an
    // `/health/entries` one. Resolving both here — and carrying them on the
    // bucket — is what keeps the payload loop below free of a second check.
    if (!descriptor.entryType || !descriptor.dataKey) continue;

    const key = `${sample.type}|${date}`;
    const bucket = buckets.get(key) ?? {
      date,
      entryType: descriptor.entryType,
      dataKey: descriptor.dataKey,
      aggregation: descriptor.aggregation,
      values: [],
    };
    bucket.values.push(sample.value);
    buckets.set(key, bucket);
  }

  const payloads: HealthKitEntryPayload[] = [];
  for (const bucket of buckets.values()) {
    payloads.push({
      date: bucket.date,
      entry_type: bucket.entryType,
      data: { [bucket.dataKey]: Math.round(aggregate(bucket.values, bucket.aggregation)) },
      source: 'healthkit',
    });
  }

  // Stable output: oldest day first, then the card's type order. Tests and the
  // server both benefit from an import that is byte-identical run to run.
  const typeOrder = (entryType: HealthKitEntryType): number =>
    HEALTHKIT_DESCRIPTORS.findIndex((descriptor) => descriptor.entryType === entryType);
  return payloads.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return typeOrder(a.entry_type) - typeOrder(b.entry_type);
  });
}

/**
 * Collapse the four dietary macro samples into at most ONE nutrition payload
 * per local day — HealthKit gives per-day TOTALS (`dietaryEnergy`/`Protein`/
 * `Carbs`/`Fat` each aggregate as `'sum'`, same as `activeEnergy`), not
 * individual foods, so this cannot recover which meal or which food a macro
 * came from. It lands as one `'Apple Health'`-named, `'snack'`-slotted row per
 * day rather than four separate `/health/entries` rows, because a nutrition
 * diary row IS several macros at once — see `HealthKitNutritionPayload`.
 */
export function mapSamplesToNutritionPayloads(
  samples: readonly HealthKitSample[],
): HealthKitNutritionPayload[] {
  const buckets = new Map<
    string,
    { date: string; calories: number; proteins: number; carbohydrates: number; fats: number }
  >();

  for (const sample of samples) {
    if (!HEALTHKIT_NUTRITION_TYPES.includes(sample.type)) continue;
    const date = usableDayKey(sample);
    if (!date) continue;

    const descriptor = HEALTHKIT_TYPES[sample.type];
    if (!descriptor.dataKey) continue;

    const bucket = buckets.get(date) ?? {
      date,
      calories: 0,
      proteins: 0,
      carbohydrates: 0,
      fats: 0,
    };
    bucket[descriptor.dataKey as 'calories' | 'proteins' | 'carbohydrates' | 'fats'] += sample.value;
    buckets.set(date, bucket);
  }

  const payloads: HealthKitNutritionPayload[] = [];
  for (const bucket of buckets.values()) {
    // A day with only, say, protein logged (no calorie figure) is not a usable
    // diary row — every food has calories, so a zero here means nothing was
    // actually totalled for the day, not that the meal was calorie-free.
    if (bucket.calories <= 0) continue;
    payloads.push({
      date: bucket.date,
      food_name: 'Apple Health',
      meal_type: 'snack',
      calories: Math.round(bucket.calories),
      proteins: Math.round(bucket.proteins),
      carbohydrates: Math.round(bucket.carbohydrates),
      fats: Math.round(bucket.fats),
      source: 'healthkit',
    });
  }

  return payloads.sort((a, b) => a.date.localeCompare(b.date));
}

/* ============================== Import plan ============================= */

export type HealthKitSkipReason =
  /** The user typed this day themselves. Their entry always wins. */
  | 'manual-entry-exists'
  /** We already imported exactly this figure. */
  | 'unchanged';

export interface HealthKitSkippedDay {
  readonly date: string;
  readonly entry_type: HealthKitEntryType;
  readonly reason: HealthKitSkipReason;
}

export interface HealthKitImportPlan {
  readonly create: readonly HealthKitEntryPayload[];
  /** Ids of stale HealthKit rows the creates replace — delete these first. */
  readonly supersede: readonly string[];
  readonly skipped: readonly HealthKitSkippedDay[];
}

/** The subset of a `/health/entries` row the planner needs. */
export interface HealthKitExistingEntry {
  readonly id: string;
  readonly date: string;
  readonly entry_type: string;
  readonly source: 'healthkit' | 'manual';
  /** JSON string as the API returns it, or an already-parsed object. */
  readonly data: string | Record<string, unknown> | null;
  readonly deleted_at?: string | null;
}

function parseEntryData(data: HealthKitExistingEntry['data']): Record<string, unknown> {
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  if (typeof data !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    // A row we cannot read is treated as "different", so the import replaces it
    // rather than skipping a day forever because of one bad blob.
    return {};
  }
}

function sameFigure(payload: HealthKitEntryPayload, existing: HealthKitExistingEntry): boolean {
  const previous = parseEntryData(existing.data);
  return Object.entries(payload.data).every(([key, value]) => previous[key] === value);
}

/**
 * Turn payloads + what the server already has into an idempotent plan.
 *
 * This is the second half of de-duplication, and the half that protects manual
 * data. `POST /health/entries` inserts unconditionally (only `/entries/steps`
 * upserts), so running an import twice would otherwise stack a duplicate row per
 * day, per type, per run.
 *
 * Precedence, per (day, type):
 *   1. a MANUAL row exists  → skip. The user typed it; we do not touch it.
 *   2. a HealthKit row with the same figure → skip. Nothing changed.
 *   3. a HealthKit row with a different figure → replace (supersede + create).
 *   4. nothing there → create.
 *
 * Soft-deleted rows (`deleted_at`) are ignored, so a row the user deleted can be
 * re-imported rather than blocking that day forever.
 */
export function planImport(
  payloads: readonly HealthKitEntryPayload[],
  existing: readonly HealthKitExistingEntry[],
): HealthKitImportPlan {
  const byDayType = new Map<string, HealthKitExistingEntry[]>();
  for (const entry of existing) {
    if (entry.deleted_at) continue;
    const key = `${entry.entry_type}|${entry.date}`;
    const list = byDayType.get(key) ?? [];
    list.push(entry);
    byDayType.set(key, list);
  }

  const create: HealthKitEntryPayload[] = [];
  const supersede: string[] = [];
  const skipped: HealthKitSkippedDay[] = [];
  const planned = new Set<string>();

  for (const payload of payloads) {
    const key = `${payload.entry_type}|${payload.date}`;
    // Defensive: `mapSamplesToPayloads` cannot emit a duplicate key, but a
    // caller assembling payloads by hand could.
    if (planned.has(key)) continue;
    planned.add(key);

    const rows = byDayType.get(key) ?? [];

    if (rows.some((row) => row.source === 'manual')) {
      skipped.push({ date: payload.date, entry_type: payload.entry_type, reason: 'manual-entry-exists' });
      continue;
    }

    const imported = rows.filter((row) => row.source === 'healthkit');
    if (imported.length > 0 && imported.every((row) => sameFigure(payload, row))) {
      skipped.push({ date: payload.date, entry_type: payload.entry_type, reason: 'unchanged' });
      continue;
    }

    supersede.push(...imported.map((row) => row.id));
    create.push(payload);
  }

  return { create, supersede, skipped };
}

/* ============================= Weight import ============================ */

/**
 * The weight log is a SECOND import track, not a fifth entry type.
 *
 * `/health/entries` has no weight `entry_type`, so a body-mass reading goes to
 * `POST /health/weight/entries` — a different table, a different row shape and its
 * own soft-delete. Everything else is the same promise as the entries track: one
 * row per local day, a day the user typed is never touched, and a re-import does
 * not stack.
 */

export interface HealthKitExistingWeight {
  readonly id: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly weight: number;
  /** `'kg' | 'lb' | 'lbs'` — the API still accepts the donor's `'lbs'`. */
  readonly unit: string;
  /**
   * 0122. Optional in this type on purpose: a row written before that migration —
   * or by a server that has not been deployed yet — has no origin, and the only
   * safe reading of "unknown origin" is `'manual'`, i.e. leave it alone.
   */
  readonly source?: string | null;
  readonly deleted_at?: string | null;
}

export interface HealthKitSkippedWeightDay {
  readonly date: string;
  readonly reason: HealthKitSkipReason;
}

export interface HealthKitWeightPlan {
  readonly create: readonly HealthKitWeightPayload[];
  /** Ids of stale HealthKit weight rows the creates replace — delete these first. */
  readonly supersede: readonly string[];
  readonly skipped: readonly HealthKitSkippedWeightDay[];
}

/** Exact, by definition (international pound). */
export const KILOGRAMS_PER_POUND = 0.45359237;

/**
 * Kilograms (HealthKit's unit for us) → the unit the user's log is kept in.
 *
 * One decimal place, which is what a bathroom scale reports and what the weight
 * screens render. Rounding here rather than at display time is what makes
 * "unchanged" comparable: 82.3 kg re-read tomorrow must equal the 82.3 already
 * stored, or every sync would supersede every row.
 */
export function convertKilograms(kilograms: number, unit: HealthKitWeightUnit): number {
  const value = unit === 'lb' ? kilograms / KILOGRAMS_PER_POUND : kilograms;
  return Math.round(value * 10) / 10;
}

/** `'lbs'` is the donor's spelling of `'lb'`; everything else is compared as-is. */
function normaliseWeightUnit(unit: string): string {
  return unit === 'lbs' ? 'lb' : unit;
}

/**
 * Collapse body-mass samples into at most ONE weight payload per local day.
 *
 * `bodyMass` aggregates as `'latest'`, so a day with a morning and an evening
 * weigh-in imports the evening one — the same rule the donor's
 * `BodyCompositionRepository` used when it collapsed a day to a single entry.
 */
export function mapSamplesToWeightPayloads(
  samples: readonly HealthKitSample[],
  unit: HealthKitWeightUnit = 'kg',
): HealthKitWeightPayload[] {
  const buckets = new Map<
    string,
    {
      date: string;
      aggregation: HealthKitAggregation;
      readings: Array<{ at: number; value: number }>;
    }
  >();

  for (const sample of samples) {
    if (!HEALTHKIT_WEIGHT_TYPES.includes(sample.type)) continue;
    const date = usableDayKey(sample);
    if (!date) continue;

    const bucket = buckets.get(date) ?? {
      date,
      aggregation: HEALTHKIT_TYPES[sample.type].aggregation,
      readings: [],
    };
    // The instant is kept, not just the value: `'latest'` has to mean the latest
    // READING, not whichever one the bridge listed last. `usableDayKey` has
    // already proved this timestamp parses.
    bucket.readings.push({ at: new Date(sample.startedAt).getTime(), value: sample.value });
    buckets.set(date, bucket);
  }

  const payloads: HealthKitWeightPayload[] = [];
  for (const bucket of buckets.values()) {
    const ordered = [...bucket.readings].sort((a, b) => a.at - b.at).map((reading) => reading.value);
    const kilograms = aggregate(ordered, bucket.aggregation);
    const weight = convertKilograms(kilograms, unit);
    // A non-positive weight is not a reading; the route would 400 on it anyway.
    if (!(weight > 0)) continue;
    payloads.push({ date: bucket.date, weight, unit, source: 'healthkit' });
  }

  return payloads.sort((a, b) => a.date.localeCompare(b.date));
}

function sameWeight(payload: HealthKitWeightPayload, existing: HealthKitExistingWeight): boolean {
  if (normaliseWeightUnit(existing.unit) !== payload.unit) return false;
  // Both sides are already rounded to one decimal; the epsilon is only here so
  // float arithmetic on the wire (82.30000000000001) cannot force a re-import.
  return Math.abs(existing.weight - payload.weight) < 0.05;
}

/**
 * Turn weight payloads + what the weight log already holds into an idempotent plan.
 *
 * Precedence, per day — identical to `planImport`, and for the same reasons:
 *   1. a MANUAL row (or a row with no recorded origin) → skip. Their number stands.
 *   2. a HealthKit row with the same figure and unit → skip. Nothing changed.
 *   3. a HealthKit row that now reads differently → replace (supersede + create).
 *   4. nothing there → create.
 *
 * Treating an origin-less row as manual is deliberate: every row written before
 * migration 0122 WAS typed in, and mis-reading one as ours would let an import
 * overwrite a number the user entered by hand.
 */
export function planWeightImport(
  payloads: readonly HealthKitWeightPayload[],
  existing: readonly HealthKitExistingWeight[],
): HealthKitWeightPlan {
  const byDay = new Map<string, HealthKitExistingWeight[]>();
  for (const row of existing) {
    if (row.deleted_at) continue;
    const list = byDay.get(row.date) ?? [];
    list.push(row);
    byDay.set(row.date, list);
  }

  const create: HealthKitWeightPayload[] = [];
  const supersede: string[] = [];
  const skipped: HealthKitSkippedWeightDay[] = [];
  const planned = new Set<string>();

  for (const payload of payloads) {
    if (planned.has(payload.date)) continue;
    planned.add(payload.date);

    const rows = byDay.get(payload.date) ?? [];

    if (rows.some((row) => row.source !== 'healthkit')) {
      skipped.push({ date: payload.date, reason: 'manual-entry-exists' });
      continue;
    }

    const imported = rows.filter((row) => row.source === 'healthkit');
    if (imported.length > 0 && imported.every((row) => sameWeight(payload, row))) {
      skipped.push({ date: payload.date, reason: 'unchanged' });
      continue;
    }

    supersede.push(...imported.map((row) => row.id));
    create.push(payload);
  }

  return { create, supersede, skipped };
}

/* ============================ Nutrition import ============================ */

/** The subset of a `/health/nutrition/entries` row the planner needs. */
export interface HealthKitExistingNutrition {
  readonly id: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly food_name: string;
  readonly calories: number;
  readonly proteins: number;
  readonly carbohydrates: number;
  readonly fats: number;
  /** Absent on any row written before this column existed — reads as "not ours". */
  readonly source?: string | null;
  readonly deleted_at?: string | null;
}

export interface HealthKitNutritionPlan {
  readonly create: readonly HealthKitNutritionPayload[];
  /** Ids of the stale `'Apple Health'` rows the creates replace. */
  readonly supersede: readonly string[];
  readonly skipped: readonly HealthKitSkippedWeightDay[];
}

function sameNutrition(
  payload: HealthKitNutritionPayload,
  existing: HealthKitExistingNutrition,
): boolean {
  return (
    existing.calories === payload.calories &&
    existing.proteins === payload.proteins &&
    existing.carbohydrates === payload.carbohydrates &&
    existing.fats === payload.fats
  );
}

/**
 * Turn nutrition payloads + what the diary already holds into an idempotent
 * plan.
 *
 * Unlike `planImport`/`planWeightImport`, there is no "a manual row exists so
 * skip the whole day" rule: a diary day can hold several MANUAL meals plus one
 * imported `'Apple Health'` summary row, coexisting rather than competing for
 * one figure. The only thing this plan de-duplicates against is a PREVIOUS
 * import of the same sentinel row — found by (day, `source: 'healthkit'`,
 * `food_name: 'Apple Health'`), never by matching a hand-typed entry.
 */
export function planNutritionImport(
  payloads: readonly HealthKitNutritionPayload[],
  existing: readonly HealthKitExistingNutrition[],
): HealthKitNutritionPlan {
  const byDay = new Map<string, HealthKitExistingNutrition[]>();
  for (const row of existing) {
    if (row.deleted_at) continue;
    if (row.source !== 'healthkit' || row.food_name !== 'Apple Health') continue;
    const list = byDay.get(row.date) ?? [];
    list.push(row);
    byDay.set(row.date, list);
  }

  const create: HealthKitNutritionPayload[] = [];
  const supersede: string[] = [];
  const skipped: HealthKitSkippedWeightDay[] = [];
  const planned = new Set<string>();

  for (const payload of payloads) {
    if (planned.has(payload.date)) continue;
    planned.add(payload.date);

    const rows = byDay.get(payload.date) ?? [];
    if (rows.length > 0 && rows.every((row) => sameNutrition(payload, row))) {
      skipped.push({ date: payload.date, reason: 'unchanged' });
      continue;
    }

    supersede.push(...rows.map((row) => row.id));
    create.push(payload);
  }

  return { create, supersede, skipped };
}

/* ============================= Workout import ============================ */

/**
 * A `POST /health/entries` body for `entry_type: 'workout'` — rides the SAME
 * table and route as steps/sleep/heart-rate, but is planned differently: a day
 * can hold more than one session, so de-duplication keys on Apple's own
 * `healthkit_uuid` (carried in `data`) rather than on (day, type).
 */
export interface HealthKitWorkoutPlan {
  readonly create: readonly HealthKitWorkoutPayload[];
  readonly skipped: readonly { readonly uuid: string; readonly reason: HealthKitSkipReason }[];
}

/** One workout payload per session — never aggregated, unlike every scalar type. */
export function mapWorkoutSamplesToPayloads(
  samples: readonly HealthKitWorkoutSample[],
): HealthKitWorkoutPayload[] {
  const payloads: HealthKitWorkoutPayload[] = [];
  for (const sample of samples) {
    // Defensive, same rule as every other mapper in this file: a bridge is not
    // trusted to have normalised already, so a non-positive duration is dropped
    // here too, not just at the `toWorkoutSamples` bridge boundary.
    if (!(sample.minutes > 0)) continue;
    const date = localDayKey(sample.startedAt);
    if (!date) continue;

    payloads.push({
      date,
      entry_type: 'workout',
      data: {
        workout_type: sample.workoutType,
        minutes: Math.round(sample.minutes),
        calories: Math.round(sample.calories),
        note: '',
        ...(sample.distanceMeters ? { distance_m: sample.distanceMeters } : {}),
        started_at: sample.startedAt,
        healthkit_uuid: sample.uuid,
      },
      source: 'healthkit',
    });
  }
  return payloads.sort((a, b) => a.data.started_at.localeCompare(b.data.started_at));
}

/**
 * Turn workout payloads + the workout rows already on `/health/entries` into
 * an idempotent plan. A session HealthKit's own `uuid` has already been
 * imported is skipped; everything else is created — there is no "supersede",
 * because a workout session's own facts (type, duration, calories) do not
 * change once recorded the way a re-measured weight or a corrected macro can.
 */
export function planWorkoutImport(
  payloads: readonly HealthKitWorkoutPayload[],
  existing: readonly HealthKitExistingEntry[],
): HealthKitWorkoutPlan {
  const importedUuids = new Set<string>();
  for (const row of existing) {
    if (row.deleted_at || row.entry_type !== 'workout' || row.source !== 'healthkit') continue;
    const data = parseEntryData(row.data);
    if (typeof data.healthkit_uuid === 'string') importedUuids.add(data.healthkit_uuid);
  }

  const create: HealthKitWorkoutPayload[] = [];
  const skipped: { uuid: string; reason: HealthKitSkipReason }[] = [];
  const planned = new Set<string>();

  for (const payload of payloads) {
    const uuid = payload.data.healthkit_uuid;
    if (planned.has(uuid)) continue;
    planned.add(uuid);

    if (importedUuids.has(uuid)) {
      skipped.push({ uuid, reason: 'unchanged' });
      continue;
    }
    create.push(payload);
  }

  return { create, skipped };
}

/* ================================= Sink ================================= */

/**
 * Where a plan is executed. Injectable so the whole import is testable without
 * a network, and so the app can swap in an offline queue later.
 */
export interface HealthKitImportSink {
  listExisting(window: { from: string; to: string }): Promise<readonly HealthKitExistingEntry[]>;
  create(payload: HealthKitEntryPayload): Promise<void>;
  remove(id: string): Promise<void>;
  /**
   * The weight track. OPTIONAL: a sink that does not implement all three skips
   * body-mass import entirely rather than half-importing it. Optional rather than
   * required so an offline queue (or a test) can adopt one track at a time.
   */
  listExistingWeight?(window: {
    from: string;
    to: string;
  }): Promise<readonly HealthKitExistingWeight[]>;
  createWeight?(payload: HealthKitWeightPayload): Promise<void>;
  removeWeight?(id: string): Promise<void>;
  /**
   * The workout track. Reuses `listExisting`/`remove` (workouts are ordinary
   * `/health/entries` rows) — the only thing that needs its OWN shape is
   * create, because `HealthKitWorkoutPayload.data` is not the
   * `Record<string, number>` `HealthKitEntryPayload.create` promises.
   */
  createWorkout?(payload: HealthKitWorkoutPayload): Promise<void>;
  /** The nutrition track. Same optional-trio shape as weight. */
  listExistingNutrition?(window: {
    from: string;
    to: string;
  }): Promise<readonly HealthKitExistingNutrition[]>;
  createNutrition?(payload: HealthKitNutritionPayload): Promise<void>;
  removeNutrition?(id: string): Promise<void>;

  /* ------------------------- Bulk creates (He11a) ------------------------ */

  /**
   * ONE call for everything a plan decided to create on a track — optional, and
   * absent on the remote sink.
   *
   * `POST /health/entries` takes one row per request, so `createApiImportSink()`
   * implements none of these and every track falls back to the per-payload loop
   * below, byte for byte as before. The LEDGER sink implements all four, because
   * on device the cost profile inverts: *"bulk callers must pre-chunk … one op
   * per row is quadratic: every call re-captures and re-diffs the whole ledger"*
   * (`local/engine.ts:908-912`), and a first connect creates several hundred
   * rows in one pass across two calendar months and nine scoped types.
   *
   * They take the plan's `create` array VERBATIM. A bulk implementation must not
   * re-filter, re-order or re-key it: de-duplication happened in
   * `plan*Import` above, and a second copy of that logic in an executor is how
   * the two drift into duplicate rows.
   *
   * All-or-nothing on failure, unlike the loop: a bulk call that rejects counts
   * every payload as failed. That is honest rather than pessimistic — the plan
   * is idempotent, so the next pass re-creates whatever did not land, and no
   * partially-written batch can be reported as imported.
   *
   * There is deliberately **no bulk remove**. A supersede is issued only for a
   * day whose figure actually changed, and every one is paired with a create in
   * the same plan — so the list is empty on a first import and a handful of rows
   * on a steady-state sync. The case bulking exists for does not arise there.
   */
  createAll?(payloads: readonly HealthKitEntryPayload[]): Promise<void>;
  createWeightAll?(payloads: readonly HealthKitWeightPayload[]): Promise<void>;
  createWorkoutAll?(payloads: readonly HealthKitWorkoutPayload[]): Promise<void>;
  createNutritionAll?(payloads: readonly HealthKitNutritionPayload[]): Promise<void>;
}

/**
 * The REMOTE sink — one of two, and the one a flag-0 device gets.
 *
 * Its local-first counterpart is `local/healthKitIngest.ts`;
 * `resolveHealthKitImportSink()` below picks between them. Nothing about the
 * plan changes with the choice — only where its rows land.
 *
 * Entries: `GET /health/entries` to plan against, `POST /health/entries` with
 * `source: 'healthkit'` to import, `DELETE /health/entries/:id` to retire a
 * superseded row. Weight: the same three verbs on `/health/weight/entries`.
 *
 * Everything goes through `healthApi`, which calls `apiClient` directly. The Health
 * Worker answers `c.json({ entry })` with no wrapping middleware, so the `api.*`
 * helpers in `client.ts` — which type the body as `{ data: T }` — silently resolve
 * `undefined` against the live server. `src/api/__tests__/healthEnvelope.test.ts`
 * pins that rule; this sink used to be the one place in the Health feature that
 * broke it.
 */
export function createApiImportSink(): HealthKitImportSink {
  return {
    listExisting: async ({ from, to }) => {
      const response = await healthApi.listEntries({ from, to });
      const entries: readonly HealthEntry[] = response.entries ?? [];
      return entries;
    },
    create: async (payload) => {
      await healthApi.createEntry(payload);
    },
    remove: async (id) => {
      await healthApi.deleteEntry(id);
    },
    listExistingWeight: async ({ from, to }) => {
      const response = await healthApi.listWeight({ from, to });
      const entries: readonly HealthWeightEntry[] = response.entries ?? [];
      return entries;
    },
    createWeight: async (payload) => {
      await healthApi.createWeight(payload);
    },
    removeWeight: async (id) => {
      await healthApi.deleteWeight(id);
    },
    createWorkout: async (payload) => {
      // `HealthEntryType` in `@api/health` DOES include `'workout'` (unlike the
      // narrower `HealthKitEntryType` alias this file otherwise uses), so the
      // generic entries endpoint accepts this payload as-is.
      await healthApi.createEntry(payload);
    },
    listExistingNutrition: async ({ from, to }) => {
      const response = await healthApi.listNutrition({ from, to });
      const entries: readonly HealthNutritionEntry[] = response.entries ?? [];
      return entries;
    },
    createNutrition: async (payload) => {
      await healthApi.createNutrition(payload);
    },
    removeNutrition: async (id) => {
      await healthApi.deleteNutrition(id);
    },
  };
}

/**
 * Which sink a build gets — **He11a, plan §1.6 Wave B**.
 *
 * On a local-first device an import must land in the ledger, not in D1. That is
 * not a preference: `/health/entries`, `/health/weight/entries` and
 * `/health/nutrition/entries` are on the He0 410 reject-list and the
 * `X-Health-Local-First` header is armed on `/health/*` the moment a session
 * opens (`local/sync/headers.ts`, attached by the interceptor in
 * `src/api/client.ts`), so the D1 path answers **410 Gone**. A drain pointed
 * there imports nothing at all.
 *
 * Two implementation notes, both copied from `localApiProxy.ts`'s own lessons:
 *
 *  - **The requires are NARROW and LAZY.** `./local/flag` is the only module a
 *    non-local-first build ever loads from here; `./local/healthKitIngest`
 *    (which pulls three facades, the engine and `@noble`) is reached only when
 *    the flag is actually on. House, Budget and Kaizen ship from this same
 *    `src/` and must not pay for any of it.
 *  - **A throw falls back to the API sink.** The feature not being wired in this
 *    build (or this test) is the ordinary state off Health, and it is exactly
 *    what the remote sink is for. It is NOT the silent-empty failure mode
 *    `localApiProxy.ts` warns about: a flag-0 device genuinely holds its rows in
 *    D1.
 */
export function resolveHealthKitImportSink(): HealthKitImportSink {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isHealthLocalFirst } = require('./local/flag') as typeof import('./local/flag');
    if (!isHealthLocalFirst()) return createApiImportSink();

    const { createLedgerHealthKitImportSink } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./local/healthKitIngest') as typeof import('./local/healthKitIngest');
    return createLedgerHealthKitImportSink();
  } catch (error) {
    if (__DEV__) console.warn('[HealthKit] local sink unavailable, using the API sink', error);
    return createApiImportSink();
  }
}

/* =============================== Service ================================ */

export interface HealthKitImportResult {
  readonly state: HealthKitConnectionState;
  /** Rows written to `/health/entries`. */
  readonly imported: number;
  /** Stale HealthKit rows retired to make room for a corrected figure. */
  readonly superseded: number;
  readonly skipped: readonly HealthKitSkippedDay[];
  /** Rows the server refused. Counted, never surfaced verbatim. */
  readonly failed: number;
  /** Rows written to `/health/weight/entries`. Counted apart because it is a different table. */
  readonly weightImported: number;
  readonly weightSuperseded: number;
  readonly weightSkipped: readonly HealthKitSkippedWeightDay[];
  readonly weightFailed: number;
  /** Sessions written to `/health/entries` as `entry_type: 'workout'`. */
  readonly workoutImported: number;
  readonly workoutSkipped: number;
  readonly workoutFailed: number;
  /** Rows written to `/health/nutrition/entries`. */
  readonly nutritionImported: number;
  readonly nutritionSuperseded: number;
  readonly nutritionSkipped: number;
  readonly nutritionFailed: number;
  /** Samples the bridge returned across all scoped types. */
  readonly samplesRead: number;
  /** ISO instant, or `null` when nothing was imported (denied/unavailable). */
  readonly syncedAt: string | null;
}

/**
 * A one-line toast summary of what an `importNow()` call actually added.
 * `null` when nothing was — a no-op sync gets no toast rather than an empty
 * one. Shared by the event-driven background sync (`healthKitBackgroundSync`)
 * and the connect/onboarding flow (`useHealthKitConnection`), so the same
 * import landing two different ways still reads as one voice.
 */
export function summarizeHealthKitImport(result: HealthKitImportResult): string | null {
  const total =
    result.imported + result.weightImported + result.workoutImported + result.nutritionImported;
  if (total <= 0) return null;

  const parts: string[] = [];
  if (result.workoutImported > 0) {
    parts.push(result.workoutImported === 1 ? '1 workout' : `${result.workoutImported} workouts`);
  }
  if (result.weightImported > 0) parts.push('weight');
  if (result.nutritionImported > 0) parts.push('nutrition');
  if (result.imported > 0) parts.push('activity');

  return `Apple Health synced: ${parts.join(', ')}.`;
}

/* ============================ Sync progress ============================== */

/** Where one scoped type is in a running `importNow()` call. */
export type HealthKitSyncAreaStatus = 'pending' | 'reading' | 'done';

export interface HealthKitSyncAreaProgress {
  readonly type: HealthKitDataType;
  readonly label: string;
  readonly icon: string;
  /** Samples read for this type so far, summed across every chunk. */
  readonly samplesRead: number;
  readonly status: HealthKitSyncAreaStatus;
}

export type HealthKitSyncStage = 'reading' | 'saving' | 'done';

/**
 * One frame of `importNow()`'s progress, for a UI that wants to show more
 * than a spinner while a sync runs. Areas move through `pending` → `reading`
 * → `done` one at a time, in `HEALTHKIT_DATA_TYPES` order, so a progress
 * surface can fill each row in turn instead of jumping around.
 */
export interface HealthKitSyncProgress {
  readonly stage: HealthKitSyncStage;
  readonly areas: readonly HealthKitSyncAreaProgress[];
  readonly completedAreas: number;
  readonly totalAreas: number;
  /** Set only once `stage` is `'done'` — the same value `importNow()` resolves to. */
  readonly result: HealthKitImportResult | null;
}

export type HealthKitSyncProgressListener = (progress: HealthKitSyncProgress) => void;

export interface HealthKitServiceConfig {
  /** Defaults to `nullHealthKitBridge` — i.e. honestly unavailable. */
  bridge?: HealthKitBridge | null;
  store?: HealthKitStateStore;
  /**
   * Where the plan is executed. Defaults to `resolveHealthKitImportSink()` —
   * the ledger on a local-first device, `healthApi` otherwise — resolved on
   * first use rather than at construction (see `activeSink`).
   */
  sink?: HealthKitImportSink;
  now?: () => Date;
  /**
   * The unit imported weights are stored in. Defaults to the user's own display
   * preference (`health.prefs.v1`), because the weight log keeps a unit per row and
   * `weightDelta()` refuses to compare across units — importing kilograms into a
   * log kept in pounds would silently flatten someone's trend line.
   */
  weightUnit?: () => Promise<HealthKitWeightUnit> | HealthKitWeightUnit;
}

export interface HealthKitService {
  checkAvailability(): Promise<HealthKitAvailability>;
  getStatus(): Promise<HealthKitStatus>;
  requestPermission(): Promise<HealthKitStatus>;
  readWindow(
    type: HealthKitDataType,
    window?: HealthKitWindow,
  ): Promise<readonly HealthKitSample[]>;
  importNow(options?: {
    days?: number;
    onProgress?: HealthKitSyncProgressListener;
  }): Promise<HealthKitImportResult>;
  /** Forget local HealthKit state. Cannot revoke the OS grant — Settings does that. */
  forget(): Promise<void>;
}

function emptyResult(state: HealthKitConnectionState): HealthKitImportResult {
  return {
    state,
    imported: 0,
    superseded: 0,
    skipped: [],
    failed: 0,
    weightImported: 0,
    weightSuperseded: 0,
    weightSkipped: [],
    weightFailed: 0,
    workoutImported: 0,
    workoutSkipped: 0,
    workoutFailed: 0,
    nutritionImported: 0,
    nutritionSuperseded: 0,
    nutritionSkipped: 0,
    nutritionFailed: 0,
    samplesRead: 0,
    syncedAt: null,
  };
}

export function createHealthKitService(config: HealthKitServiceConfig = {}): HealthKitService {
  const bridge = config.bridge ?? nullHealthKitBridge;
  const store = config.store ?? createInMemoryHealthKitStore();
  const now = config.now ?? (() => new Date());
  const weightUnit =
    config.weightUnit ?? (async () => (await loadHealthPrefs()).preferredUnit);

  /**
   * Every bridge call goes through here. A native module that throws — because
   * it is half-installed, because the OS changed, because the user is on
   * Android — must read as "unavailable", never as an exception escaping into a
   * screen. This is what makes the HealthKit-OFF path unconditionally safe.
   */
  async function safely<T>(work: () => Promise<T> | T, fallback: T): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (__DEV__) console.warn('[HealthKit] swallowed error, falling back to', fallback, error);
      return fallback;
    }
  }

  /**
   * The sink, resolved on FIRST USE rather than at construction.
   *
   * `healthKit` (the app-wide instance below) is built at module load, which on
   * a Health build happens the moment any screen or the background-sync listener
   * imports this file. Resolving eagerly there would pull the whole local-first
   * stack — three facades, the engine, `@noble` — into the graph before anyone
   * has asked for an import. `localApiProxy.ts`'s lesson 1, applied to the sink:
   * narrow requires keep the cold path cold.
   *
   * Cached after the first resolution: the flag is an `EXPO_PUBLIC_*` inline
   * that cannot change within a process, and re-requiring per track would make
   * the four import functions disagree about where they are writing.
   */
  let resolvedSink: HealthKitImportSink | null = config.sink ?? null;
  function activeSink(): HealthKitImportSink {
    return (resolvedSink ??= resolveHealthKitImportSink());
  }

  /**
   * Execute one track's creates — as one batch where the sink can, row by row
   * where it cannot.
   *
   * Only the failure ACCOUNTING differs between the two arms, and it differs the
   * safe way: a rejected batch counts every payload as failed rather than
   * guessing how far it got, so nothing half-written is ever reported as
   * imported. The plan is idempotent, so the next pass re-creates whatever did
   * not land.
   */
  async function createEach<TPayload>(
    payloads: readonly TPayload[],
    bulk: ((rows: readonly TPayload[]) => Promise<void>) | undefined,
    one: (row: TPayload) => Promise<void>,
  ): Promise<{ imported: number; failed: number }> {
    if (payloads.length === 0) return { imported: 0, failed: 0 };

    if (bulk) {
      const ok = await safely(async () => {
        await bulk(payloads);
        return true;
      }, false);
      return ok
        ? { imported: payloads.length, failed: 0 }
        : { imported: 0, failed: payloads.length };
    }

    let imported = 0;
    let failed = 0;
    for (const payload of payloads) {
      const ok = await safely(async () => {
        await one(payload);
        return true;
      }, false);
      if (ok) imported += 1;
      else failed += 1;
    }
    return { imported, failed };
  }

  async function checkAvailability(): Promise<HealthKitAvailability> {
    if (bridge === nullHealthKitBridge) return unavailable('no-bridge');

    let ok: boolean | null = null;
    try {
      ok = await bridge.isAvailable();
    } catch {
      return unavailable('bridge-error');
    }
    return ok ? AVAILABLE : unavailable('unsupported-device');
  }

  /**
   * Raw statuses, filtered down to our scope and keyed by our type names.
   *
   * Returns `null` when the bridge call itself failed, so callers can tell
   * "the OS said nothing yet" apart from "we never got to ask". Conflating the
   * two is how an app ends up claiming a permission it does not have.
   */
  async function readAuthorizations(
    fetch: () => Promise<Readonly<Record<string, HealthKitRawAuthorization>>>,
    requestedAt: string | null,
  ): Promise<HealthKitAuthorizationMap | null> {
    const raw = await safely<Record<string, HealthKitRawAuthorization> | null>(fetch, null);
    if (raw === null) return null;

    const entries = HEALTHKIT_DESCRIPTORS.map((descriptor) => {
      // Belt and braces: only identifiers we asked for are ever consulted, so a
      // bridge returning extra types cannot widen what we report as granted.
      //
      // The `undefined` arm is unreachable today and deliberately untested:
      // `HEALTHKIT_READ_IDENTIFIERS` is DERIVED from these same descriptors, so
      // every identifier here is scoped by construction. It stays for the day
      // the two stop sharing one source.
      /* istanbul ignore next */
      const value = isScopedIdentifier(descriptor.identifier)
        ? raw[descriptor.identifier]
        : undefined;
      return [descriptor.type, mapRawAuthorization(value, requestedAt)];
    });

    return Object.fromEntries(entries) as HealthKitAuthorizationMap;
  }

  async function getStatus(): Promise<HealthKitStatus> {
    const availability = await checkAvailability();
    const persisted = await safely(() => store.read(), EMPTY_HEALTHKIT_STATE);

    if (!availability.available) {
      return {
        state: 'unavailable',
        availability,
        perType: uniformAuthorization('unavailable'),
        requestedAt: persisted.requestedAt,
        lastSyncedAt: persisted.lastSyncedAt,
      };
    }

    // A status probe that fails tells us nothing new, so we fall back to what
    // the user last agreed to rather than inventing a grant or a denial.
    const perType =
      (await readAuthorizations(
        () => bridge.getAuthorizationStatus(HEALTHKIT_READ_IDENTIFIERS),
        persisted.requestedAt,
      )) ?? uniformAuthorization(persisted.requestedAt ? 'undisclosed' : 'not-requested');

    return {
      state: deriveConnectionState({ availability, perType, requestedAt: persisted.requestedAt }),
      availability,
      perType,
      requestedAt: persisted.requestedAt,
      lastSyncedAt: persisted.lastSyncedAt,
    };
  }

  async function requestPermission(): Promise<HealthKitStatus> {
    const availability = await checkAvailability();
    const persisted = await safely(() => store.read(), EMPTY_HEALTHKIT_STATE);

    // Asking for a permission the device cannot grant is not an error, and must
    // not record a request that never happened.
    if (!availability.available) {
      return {
        state: 'unavailable',
        availability,
        perType: uniformAuthorization('unavailable'),
        requestedAt: persisted.requestedAt,
        lastSyncedAt: persisted.lastSyncedAt,
      };
    }

    const requestedAt = now().toISOString();
    const perType = await readAuthorizations(
      () => bridge.requestAuthorization(HEALTHKIT_READ_IDENTIFIERS),
      requestedAt,
    );

    // The sheet never completed (bridge rejected, module missing, user backed
    // out of a broken prompt). Recording `requestedAt` here would strand the
    // user in a state that offers no way to ask again, so we leave things
    // exactly as they were and let them tap Connect once more.
    if (perType === null) {
      return {
        state: deriveConnectionState({
          availability,
          perType: uniformAuthorization(persisted.requestedAt ? 'undisclosed' : 'not-requested'),
          requestedAt: persisted.requestedAt,
        }),
        availability,
        perType: uniformAuthorization(persisted.requestedAt ? 'undisclosed' : 'not-requested'),
        requestedAt: persisted.requestedAt,
        lastSyncedAt: persisted.lastSyncedAt,
      };
    }

    const next = { ...persisted, requestedAt };
    await safely(() => store.write(next), undefined);

    return {
      state: deriveConnectionState({ availability, perType, requestedAt }),
      availability,
      perType,
      requestedAt,
      lastSyncedAt: persisted.lastSyncedAt,
    };
  }

  async function readWindow(
    type: HealthKitDataType,
    window: HealthKitWindow = healthKitWindow(HEALTHKIT_DEFAULT_WINDOW_DAYS, now()),
  ): Promise<readonly HealthKitSample[]> {
    const status = await getStatus();
    if (status.state === 'unavailable' || status.state === 'denied') {
      if (__DEV__) console.log(`[HealthKit] readWindow(${type}) skipped — status ${status.state}`);
      return [];
    }
    if (status.perType[type] === 'denied') {
      if (__DEV__) console.log(`[HealthKit] readWindow(${type}) skipped — per-type denied`);
      return [];
    }

    const samples = await safely(
      () => bridge.querySamples({ type, start: window.start, end: window.end }),
      [] as readonly HealthKitSample[],
    );

    // A bridge is not trusted to honour the window or the requested type. Both
    // are re-checked here so a sloppy adapter cannot smuggle in out-of-scope or
    // out-of-window data.
    const usable = samples.filter(
      (sample) => sample.type === type && isUsableSample(sample) && isSampleInWindow(sample, window),
    );
    if (__DEV__) {
      console.log(
        `[HealthKit] readWindow(${type}, ${window.start}..${window.end}) bridge=${samples.length} usable=${usable.length}`,
      );
    }
    return usable;
  }

  /** The workout track's read — parallel to `readWindow`, not part of its loop. */
  async function readWorkoutWindow(
    window: HealthKitWindow = healthKitWindow(HEALTHKIT_DEFAULT_WINDOW_DAYS, now()),
  ): Promise<readonly HealthKitWorkoutSample[]> {
    const status = await getStatus();
    if (status.state === 'unavailable' || status.state === 'denied') return [];

    const samples = await safely(
      () => bridge.queryWorkouts({ start: window.start, end: window.end }),
      [] as readonly HealthKitWorkoutSample[],
    );

    return samples.filter((sample) => {
      const at = new Date(sample.startedAt).getTime();
      if (Number.isNaN(at)) return false;
      return at >= new Date(window.start).getTime() && at < new Date(window.end).getTime();
    });
  }

  /**
   * The `/health/entries` track: steps, active energy, sleep, heart rate.
   *
   * Returns `null` when the server baseline could not be read. No baseline means
   * we cannot tell a duplicate from a new day, and importing blind is exactly how
   * a re-import stacks, so the caller reports the truth rather than guessing.
   */
  async function importEntries(samples: readonly HealthKitSample[]): Promise<{
    imported: number;
    superseded: number;
    failed: number;
    skipped: readonly HealthKitSkippedDay[];
  } | null> {
    const sink = activeSink();
    const payloads = mapSamplesToPayloads(samples);
    if (payloads.length === 0) return { imported: 0, superseded: 0, failed: 0, skipped: [] };

    const existing = await safely(
      () =>
        sink.listExisting({
          from: payloads[0].date,
          to: payloads[payloads.length - 1].date,
        }),
      null as readonly HealthKitExistingEntry[] | null,
    );
    if (existing === null) return null;

    const plan = planImport(payloads, existing);
    if (__DEV__) {
      console.log(
        `[HealthKit] importEntries plan: payloads=${payloads.length} existing=${existing.length} create=${plan.create.length} supersede=${plan.supersede.length} skip=${plan.skipped.length}`,
        plan.skipped,
      );
    }

    let superseded = 0;
    for (const id of plan.supersede) {
      const ok = await safely(async () => {
        await sink.remove(id);
        return true;
      }, false);
      if (ok) superseded += 1;
    }

    const { imported, failed } = await createEach(
      plan.create,
      sink.createAll?.bind(sink),
      (payload) => sink.create(payload),
    );

    if (__DEV__) {
      console.log(
        `[HealthKit] importEntries done: imported=${imported} superseded=${superseded} failed=${failed} skipped=${plan.skipped.length}`,
      );
    }
    return { imported, superseded, failed, skipped: plan.skipped };
  }

  /**
   * The `/health/weight/entries` track: body mass.
   *
   * Silently absent — not failed — when the sink does not implement all three
   * weight verbs, so a partial sink degrades to "entries only" rather than to a
   * half-written weight log.
   */
  async function importWeight(samples: readonly HealthKitSample[]): Promise<{
    imported: number;
    superseded: number;
    failed: number;
    skipped: readonly HealthKitSkippedWeightDay[];
  } | null> {
    const sink = activeSink();
    const { listExistingWeight, createWeight, removeWeight } = sink;
    if (!listExistingWeight || !createWeight || !removeWeight) {
      return { imported: 0, superseded: 0, failed: 0, skipped: [] };
    }

    const unit = await safely<HealthKitWeightUnit>(() => weightUnit(), 'kg');
    const payloads = mapSamplesToWeightPayloads(samples, unit === 'lb' ? 'lb' : 'kg');
    if (payloads.length === 0) return { imported: 0, superseded: 0, failed: 0, skipped: [] };

    const existing = await safely(
      () =>
        listExistingWeight({
          from: payloads[0].date,
          to: payloads[payloads.length - 1].date,
        }),
      null as readonly HealthKitExistingWeight[] | null,
    );
    if (existing === null) return null;

    const plan = planWeightImport(payloads, existing);
    if (__DEV__) {
      console.log(
        `[HealthKit] importWeight plan: payloads=${payloads.length} existing=${existing.length} create=${plan.create.length} supersede=${plan.supersede.length} skip=${plan.skipped.length}`,
        plan.skipped,
      );
    }

    let superseded = 0;
    for (const id of plan.supersede) {
      const ok = await safely(async () => {
        await removeWeight(id);
        return true;
      }, false);
      if (ok) superseded += 1;
    }

    const { imported, failed } = await createEach(
      plan.create,
      sink.createWeightAll?.bind(sink),
      createWeight,
    );

    if (__DEV__) {
      console.log(
        `[HealthKit] importWeight done: imported=${imported} superseded=${superseded} failed=${failed} skipped=${plan.skipped.length}`,
      );
    }
    return { imported, superseded, failed, skipped: plan.skipped };
  }

  /**
   * The workout track: sessions posted to `/health/entries` with
   * `entry_type: 'workout'`. Silently absent — not failed — when the sink does
   * not implement `createWorkout`, the same "a partial sink degrades rather
   * than half-writes" rule `importWeight` follows.
   */
  async function importWorkouts(samples: readonly HealthKitWorkoutSample[]): Promise<{
    imported: number;
    failed: number;
    skipped: number;
  } | null> {
    const sink = activeSink();
    const { createWorkout } = sink;
    if (!createWorkout) return { imported: 0, failed: 0, skipped: 0 };

    const payloads = mapWorkoutSamplesToPayloads(samples);
    if (payloads.length === 0) return { imported: 0, failed: 0, skipped: 0 };

    const existing = await safely(
      () =>
        sink.listExisting({
          from: payloads[0].date,
          to: payloads[payloads.length - 1].date,
        }),
      null as readonly HealthKitExistingEntry[] | null,
    );
    if (existing === null) return null;

    const plan = planWorkoutImport(payloads, existing);
    if (__DEV__) {
      console.log(
        `[HealthKit] importWorkouts plan: payloads=${payloads.length} existing=${existing.length} create=${plan.create.length} skip=${plan.skipped.length}`,
      );
    }

    const { imported, failed } = await createEach(
      plan.create,
      sink.createWorkoutAll?.bind(sink),
      createWorkout,
    );

    if (__DEV__) {
      console.log(`[HealthKit] importWorkouts done: imported=${imported} failed=${failed} skipped=${plan.skipped.length}`);
    }
    return { imported, failed, skipped: plan.skipped.length };
  }

  /**
   * The nutrition track: `/health/nutrition/entries`, one `'Apple Health'` row
   * per day. Silently absent — not failed — when the sink does not implement
   * all three nutrition verbs, same rule as `importWeight`.
   */
  async function importNutrition(samples: readonly HealthKitSample[]): Promise<{
    imported: number;
    superseded: number;
    failed: number;
    skipped: number;
  } | null> {
    const sink = activeSink();
    const { listExistingNutrition, createNutrition, removeNutrition } = sink;
    if (!listExistingNutrition || !createNutrition || !removeNutrition) {
      return { imported: 0, superseded: 0, failed: 0, skipped: 0 };
    }

    const payloads = mapSamplesToNutritionPayloads(samples);
    if (__DEV__) {
      console.log(`[HealthKit] importNutrition day-total payloads=${payloads.length}`);
    }
    if (payloads.length === 0) return { imported: 0, superseded: 0, failed: 0, skipped: 0 };

    const existing = await safely(
      () =>
        listExistingNutrition({
          from: payloads[0].date,
          to: payloads[payloads.length - 1].date,
        }),
      null as readonly HealthKitExistingNutrition[] | null,
    );
    if (existing === null) return null;

    const plan = planNutritionImport(payloads, existing);
    if (__DEV__) {
      console.log(
        `[HealthKit] importNutrition plan: payloads=${payloads.length} existing=${existing.length} create=${plan.create.length} supersede=${plan.supersede.length} skip=${plan.skipped.length}`,
      );
    }

    let superseded = 0;
    for (const id of plan.supersede) {
      const ok = await safely(async () => {
        await removeNutrition(id);
        return true;
      }, false);
      if (ok) superseded += 1;
    }

    const { imported, failed } = await createEach(
      plan.create,
      sink.createNutritionAll?.bind(sink),
      createNutrition,
    );

    if (__DEV__) {
      console.log(
        `[HealthKit] importNutrition done: imported=${imported} superseded=${superseded} failed=${failed} skipped=${plan.skipped.length}`,
      );
    }
    return { imported, superseded, failed, skipped: plan.skipped.length };
  }

  async function importNow(
    options: { days?: number; onProgress?: HealthKitSyncProgressListener } = {},
  ): Promise<HealthKitImportResult> {
    const status = await getStatus();
    if (__DEV__) console.log(`[HealthKit] importNow start, days=${options.days ?? 'default'}, status=${status.state}`);
    if (status.state !== 'connected') return emptyResult(status.state);

    // An explicit `days` override still reads one flat, clamped window (tests,
    // and any future narrower catch-up). Leaving `days` unset — the shape every
    // real caller uses — reads the two-chunk historical backfill instead, so a
    // fresh connect fills in a real month rather than the last seven days of it.
    const chunkWindows: readonly HealthKitWindow[] =
      options.days != null
        ? [healthKitWindow(options.days, now())]
        : healthKitHistoricalWindows(now()).map((chunk) => chunk.window);
    if (__DEV__) console.log('[HealthKit] importNow windows', chunkWindows);

    const areaState = new Map<HealthKitDataType, { samplesRead: number; status: HealthKitSyncAreaStatus }>(
      HEALTHKIT_DATA_TYPES.map((type) => [type, { samplesRead: 0, status: 'pending' }]),
    );
    const totalAreas = HEALTHKIT_DATA_TYPES.length;
    let completedAreas = 0;

    const emit = (stage: HealthKitSyncStage, result: HealthKitImportResult | null = null) => {
      options.onProgress?.({
        stage,
        areas: HEALTHKIT_DESCRIPTORS.map((descriptor) => ({
          type: descriptor.type,
          label: descriptor.label,
          icon: descriptor.icon,
          ...areaState.get(descriptor.type)!,
        })),
        completedAreas,
        totalAreas,
        result,
      });
    };

    // One type at a time — not `Promise.all` — so a progress listener can fill
    // in "Steps", then "Active energy", then "Sleep" one row at a time instead
    // of every row landing at once. Each type reads every chunk (both calendar
    // months by default) before moving to the next.
    const samples: HealthKitSample[] = [];
    emit('reading');
    for (const type of HEALTHKIT_DATA_TYPES) {
      areaState.set(type, { ...areaState.get(type)!, status: 'reading' });
      emit('reading');

      let samplesForType = 0;
      for (const window of chunkWindows) {
        const read = await readWindow(type, window);
        samples.push(...read);
        samplesForType += read.length;
      }

      completedAreas += 1;
      areaState.set(type, { samplesRead: samplesForType, status: 'done' });
      emit('reading');
      // Yield so a foreground drag can finish Pressable→ScrollView handoff
      // between heavy native reads (background sync runs while Home is open).
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    // Workouts read separately — a different native query, a different sample
    // shape (see `HealthKitWorkoutSample`) — so they never join the per-type
    // loop above or its progress rows.
    const workoutSamples: HealthKitWorkoutSample[] = [];
    for (const window of chunkWindows) {
      workoutSamples.push(...(await readWorkoutWindow(window)));
    }

    emit('saving');

    // Sequential, not parallel: all four tracks share one server and one
    // session, and racing their writes buys nothing on a seven-day window while
    // doubling the chance of a rate-limited miss.
    const entries = await importEntries(samples);
    const weight = await importWeight(samples);
    const workouts = await importWorkouts(workoutSamples);
    const nutrition = await importNutrition(samples);
    if (__DEV__) {
      console.log('[HealthKit] importNow track results', { entries, weight, workouts, nutrition });
    }

    // A track that could not read its baseline reports NOTHING for that track and
    // does not stamp "last synced" — claiming a sync that skipped half the data is
    // worse than saying nothing happened.
    if (entries === null || weight === null || workouts === null || nutrition === null) {
      if (__DEV__) console.warn('[HealthKit] importNow: at least one track failed to read its baseline');
      const result: HealthKitImportResult = {
        ...emptyResult('connected'),
        imported: entries?.imported ?? 0,
        superseded: entries?.superseded ?? 0,
        skipped: entries?.skipped ?? [],
        failed: entries?.failed ?? 0,
        weightImported: weight?.imported ?? 0,
        weightSuperseded: weight?.superseded ?? 0,
        weightSkipped: weight?.skipped ?? [],
        weightFailed: weight?.failed ?? 0,
        workoutImported: workouts?.imported ?? 0,
        workoutSkipped: workouts?.skipped ?? 0,
        workoutFailed: workouts?.failed ?? 0,
        nutritionImported: nutrition?.imported ?? 0,
        nutritionSuperseded: nutrition?.superseded ?? 0,
        nutritionSkipped: nutrition?.skipped ?? 0,
        nutritionFailed: nutrition?.failed ?? 0,
        samplesRead: samples.length,
      };
      emit('done', result);
      return result;
    }

    const syncedAt = now().toISOString();
    await safely(
      () => store.write({ requestedAt: status.requestedAt, lastSyncedAt: syncedAt }),
      undefined,
    );

    const result: HealthKitImportResult = {
      state: 'connected',
      imported: entries.imported,
      superseded: entries.superseded,
      skipped: entries.skipped,
      failed: entries.failed,
      weightImported: weight.imported,
      weightSuperseded: weight.superseded,
      weightSkipped: weight.skipped,
      weightFailed: weight.failed,
      workoutImported: workouts.imported,
      workoutSkipped: workouts.skipped,
      workoutFailed: workouts.failed,
      nutritionImported: nutrition.imported,
      nutritionSuperseded: nutrition.superseded,
      nutritionSkipped: nutrition.skipped,
      nutritionFailed: nutrition.failed,
      samplesRead: samples.length,
      syncedAt,
    };
    if (__DEV__) console.log('[HealthKit] importNow result', result);
    emit('done', result);
    return result;
  }

  async function forget(): Promise<void> {
    await safely(() => store.write({ ...EMPTY_HEALTHKIT_STATE }), undefined);
  }

  return { checkAvailability, getStatus, requestPermission, readWindow, importNow, forget };
}

/**
 * The app-wide instance.
 *
 * `resolveHealthKitBridge()` answers `null` on every brand but Symply Health, on
 * Android, and in any build where the `SymplyHealthKit` module is not linked — and
 * `null` falls through to `nullHealthKitBridge`, whose availability reason is
 * `no-bridge`. So the four sibling apps, the Jest suite and Expo Go all behave
 * exactly as they did before a native module existed, while a Health build on a
 * real iPhone gets the real thing. This is the ONLY place the bridge is chosen.
 *
 * The store is storage-backed so "last synced" survives a relaunch. It holds two
 * timestamps and no health data, and `HEALTH_CACHE_KEYS` already lists
 * `health.healthKit.v1` so sign-out wipes it — otherwise the next person on the
 * handset would inherit the previous user's "connected to Apple Health" state.
 */
export const healthKit: HealthKitService = createHealthKitService({
  bridge: resolveHealthKitBridge(),
  store: createStoredHealthKitStore(),
});
