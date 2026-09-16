import { healthApi, type HealthEntry } from '@api/health';

import { todayDateKey } from './healthLocalStorage';
import { readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — the nightly SLEEP log.
 *
 * Sleep already existed in three half-places in this app and nowhere a member
 * could see it: a habit preset ("Sleep 7+ hours"), a HealthKit read type that
 * imports into `/health/entries` as `entry_type: 'sleep'`, and a 1–10 "sleep
 * quality" self-check buried on the Vitality tab. The donor's dashboard opens a
 * whole `SleepDetailView` from a sleep tile; Home here had no sleep at all.
 *
 * WHY MANUAL LOGGING. The donor's sleep is HealthKit-only, because on that app
 * HealthKit is connected. Here it is not — "Apple Health sync" is still on
 * Home's COMING SOON list — so a read-only sleep card would say "no data" on
 * every device forever. The wire already supports the write: `POST
 * /health/entries` takes `entry_type: 'sleep'`, and the HealthKit importer skips
 * any day that already carries a MANUAL row for the same type
 * (`'manual-entry-exists'`), so hand-logged nights are not clobbered when sync
 * eventually lands. No migration, no new route.
 *
 * MINUTES, NOT HOURS, ON THE WIRE. `healthKitTypes.ts` declares sleep's
 * `dataKey` as `minutes`, and `mapSamplesToPayloads` writes
 * `{ minutes: <int> }`. Manual rows use the identical payload so an imported
 * night and a typed one are the same record — a second key ("hours") would have
 * made every future sync a reconciliation problem. Hours are a DISPLAY unit,
 * converted at the edge exactly like `healthWeightStorage` converts kilograms.
 *
 * ONE NIGHT PER DATE, NOT A SUM. Each stored row is already a whole-day total
 * (the importer aggregates every sleep sample for a day into one payload), so
 * adding two rows for the same date would double-count a night. When a date has
 * more than one row the manual one wins — it is the figure the member typed —
 * and otherwise the most recently updated.
 */

export const HEALTH_SLEEP_KEY = 'health.sleep.v1';

/** Used until the member's goal row carries a `daily_sleep_hours`. */
export const DEFAULT_SLEEP_GOAL_HOURS = 8;

const MINUTES_PER_HOUR = 60;
const MAX_SLEEP_MINUTES = 24 * MINUTES_PER_HOUR;
const MAX_SLEEP_NIGHTS = 400;
const MIN_GOAL_HOURS = 1;
const MAX_GOAL_HOURS = 14;

export interface SleepNight {
  /** The `/health/entries` row this app would edit for the date. */
  id: string;
  /** `YYYY-MM-DD` — the day you woke up, matching the HealthKit importer. */
  date: string;
  minutes: number;
  source: 'manual' | 'healthkit';
  /** ISO stamp the row was written, for the recency ordering. */
  loggedAt: string;
}

/**
 * The cached snapshot: the nights AND the goal they are measured against.
 *
 * One cache key rather than two because the goal is fetched in the same
 * round-trip and is meaningless without the nights — the same call
 * `loadWaterHistory` makes for the water target.
 */
export interface SleepLog {
  /** Newest night first. */
  nights: SleepNight[];
  goalHours: number;
}

export const EMPTY_SLEEP_LOG: SleepLog = {
  nights: [],
  goalHours: DEFAULT_SLEEP_GOAL_HOURS,
};

/* ------------------------------------------------------------------ */
/* Parsing + formatting                                                */
/* ------------------------------------------------------------------ */

export function clampSleepMinutes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_SLEEP_MINUTES, Math.round(value));
}

export function clampSleepGoalHours(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_SLEEP_GOAL_HOURS;
  return Math.max(MIN_GOAL_HOURS, Math.min(MAX_GOAL_HOURS, Math.round(value * 10) / 10));
}

/**
 * Keep a typed duration to digits and ONE decimal separator.
 *
 * `keyboardType="decimal-pad"` picks a keyboard, it does not constrain the
 * value — letters still arrive by paste, hardware keyboard or UI automation.
 * Same guard `sanitizeWeightInput` applies to the weight field.
 */
export function sanitizeSleepInput(raw: string): string {
  if (typeof raw !== 'string') return '';
  const kept = raw.replace(/[^0-9.,]/g, '');
  const firstSeparator = kept.search(/[.,]/);
  if (firstSeparator === -1) return kept;
  const head = kept.slice(0, firstSeparator + 1);
  const tail = kept.slice(firstSeparator + 1).replace(/[.,]/g, '');
  return head + tail;
}

/** Typed HOURS → stored MINUTES. `null` when it cannot be a night's sleep. */
export function parseSleepHoursInput(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().replace(',', '.');
  if (normalized.length === 0) return null;
  const hours = Number(normalized);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return null;
  const minutes = Math.round(hours * MINUTES_PER_HOUR);
  return minutes > 0 ? minutes : null;
}

/** Minutes → hours with one decimal, for a figure that has to read as a number. */
export function sleepHours(minutes: number): number {
  return Math.round((clampSleepMinutes(minutes) / MINUTES_PER_HOUR) * 10) / 10;
}

/** `7h 20m` — the same shape `formatDuration` gives a workout. */
export function formatSleepDuration(minutes: number): string {
  const total = clampSleepMinutes(minutes);
  const hours = Math.floor(total / MINUTES_PER_HOUR);
  const rest = total % MINUTES_PER_HOUR;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`;
}

/* ------------------------------------------------------------------ */
/* Wire                                                                */
/* ------------------------------------------------------------------ */

function minutesFromRow(row: HealthEntry): number | null {
  try {
    const parsed = JSON.parse(row.data ?? '{}') as { minutes?: unknown };
    const minutes = Number(parsed?.minutes ?? 0);
    return Number.isFinite(minutes) && minutes > 0 ? clampSleepMinutes(minutes) : null;
  } catch {
    // A row whose blob will not parse is dropped rather than thrown over: one
    // corrupt night must not blank the whole card.
    return null;
  }
}

/**
 * Collapse the server's rows into one night per date.
 *
 * Precedence is manual-then-newest, NOT a sum — see the module header.
 */
export function nightsFromEntries(entries: readonly HealthEntry[]): SleepNight[] {
  const byDate = new Map<string, SleepNight>();

  for (const row of entries) {
    if (!row || row.deleted_at) continue;
    if (row.entry_type !== 'sleep') continue;
    const minutes = minutesFromRow(row);
    if (minutes === null) continue;

    const night: SleepNight = {
      id: row.id,
      date: row.date,
      minutes,
      source: row.source === 'healthkit' ? 'healthkit' : 'manual',
      loggedAt: row.updated_at || row.created_at || '',
    };

    const held = byDate.get(night.date);
    if (!held) {
      byDate.set(night.date, night);
      continue;
    }
    const heldWins =
      held.source === 'manual' && night.source !== 'manual'
        ? true
        : held.source !== 'manual' && night.source === 'manual'
          ? false
          : held.loggedAt.localeCompare(night.loggedAt) >= 0;
    if (!heldWins) byDate.set(night.date, night);
  }

  return [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_SLEEP_NIGHTS);
}

async function fetchSleepLog(): Promise<SleepLog> {
  const [entries, goal] = await Promise.all([
    healthApi.listEntries({ type: 'sleep', limit: MAX_SLEEP_NIGHTS }),
    healthApi.getGoal(),
  ]);
  const goalHours = goal.goal?.daily_sleep_hours;
  return {
    nights: nightsFromEntries(entries.entries ?? []),
    goalHours:
      typeof goalHours === 'number' && goalHours > 0
        ? clampSleepGoalHours(goalHours)
        : DEFAULT_SLEEP_GOAL_HOURS,
  };
}

export async function loadSleepLog(): Promise<SleepLog> {
  const log = await readThrough(HEALTH_SLEEP_KEY, fetchSleepLog, EMPTY_SLEEP_LOG);
  return {
    nights: (Array.isArray(log.nights) ? log.nights : [])
      .filter(
        (night): night is SleepNight =>
          !!night && typeof night.date === 'string' && Number.isFinite(night.minutes)
      )
      .sort((a, b) => b.date.localeCompare(a.date)),
    goalHours: clampSleepGoalHours(log.goalHours ?? DEFAULT_SLEEP_GOAL_HOURS),
  };
}

/**
 * Record (or correct) one night.
 *
 * `POST /health/entries` INSERTS unconditionally, so re-logging the same date
 * would stack a second row; when this handset already knows a manual row for the
 * date the write is an UPDATE instead. `PUT /health/entries/:id` replaces the
 * `data` blob wholesale, which is exactly right for a single-field payload.
 */
export async function logSleep(minutes: number, date = todayDateKey()): Promise<SleepLog> {
  const clamped = clampSleepMinutes(minutes);
  if (clamped <= 0) return loadSleepLog();

  const current = await loadSleepLog();
  const existing = current.nights.find(
    (night) => night.date === date && night.source === 'manual'
  );

  const pending: SleepNight = {
    id: existing?.id ?? `sleep-${date}`,
    date,
    minutes: clamped,
    source: 'manual',
    loggedAt: new Date().toISOString(),
  };
  const optimistic: SleepLog = {
    ...current,
    nights: [pending, ...current.nights.filter((night) => night.date !== date)].sort((a, b) =>
      b.date.localeCompare(a.date)
    ),
  };

  return writeThrough(
    HEALTH_SLEEP_KEY,
    () =>
      existing
        ? healthApi.updateEntry(existing.id, { data: { minutes: clamped } })
        : healthApi.createEntry({
            date,
            entry_type: 'sleep',
            data: { minutes: clamped },
            source: 'manual',
          }),
    fetchSleepLog,
    optimistic,
    `date=${date} minutes=${clamped}`,
    {
      // `id: sleep-${date}` is this module's OWN stable local id for a night —
      // it is what stops a re-log of the same date from stacking a second row
      // even server-side, and it is what makes the offline queue idempotent
      // across a create-then-correct of the SAME not-yet-synced night too.
      queue: {
        collection: 'health_entries',
        row: {
          id: pending.id,
          date,
          entry_type: 'sleep',
          source: 'manual',
          data: JSON.stringify({ minutes: clamped }),
        },
      },
    }
  );
}

export async function deleteSleepNight(id: string): Promise<SleepLog> {
  const current = await loadSleepLog();
  const found = current.nights.find((night) => night.id === id);
  const optimistic: SleepLog = {
    ...current,
    nights: current.nights.filter((night) => night.id !== id),
  };
  return writeThrough(
    HEALTH_SLEEP_KEY,
    () => healthApi.deleteEntry(id),
    fetchSleepLog,
    optimistic,
    `delete=${id}`,
    found
      ? {
          queue: {
            collection: 'health_entries',
            row: {
              id,
              date: found.date,
              entry_type: 'sleep',
              source: 'manual',
              data: JSON.stringify({ minutes: found.minutes }),
              deleted_at: new Date().toISOString(),
            },
          },
        }
      : undefined
  );
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

export interface SleepSummary {
  /** The most recent night inside the window, or `null` when none was logged. */
  last: SleepNight | null;
  /** Mean of the nights ACTUALLY logged — never divided by the window width. */
  averageMinutes: number | null;
  /** How many of the window's days carry a night. */
  nightsLogged: number;
  /** Longest night in the window. */
  bestMinutes: number | null;
}

/**
 * Summarise a window.
 *
 * The average divides by the nights logged, not by `dayKeys.length`: three good
 * nights in a week are three good nights, not "3.4 h a night".
 */
export function summarizeSleep(nights: readonly SleepNight[], dayKeys: string[]): SleepSummary {
  const inRange = new Set(dayKeys);
  const window = nights
    .filter((night) => inRange.has(night.date) && night.minutes > 0)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (window.length === 0) {
    return { last: null, averageMinutes: null, nightsLogged: 0, bestMinutes: null };
  }

  const total = window.reduce((sum, night) => sum + night.minutes, 0);
  return {
    last: window[0],
    averageMinutes: Math.round(total / window.length),
    nightsLogged: window.length,
    bestMinutes: window.reduce((best, night) => Math.max(best, night.minutes), 0),
  };
}

/** Minutes logged for one date, or `null` when that night was not logged. */
export function sleepMinutesOn(nights: readonly SleepNight[], date: string): number | null {
  return nights.find((night) => night.date === date)?.minutes ?? null;
}
