import {
  healthApi,
  HEALTH_SYNC_PUSH_MAX_ROWS,
  type HealthPushChanges,
  type HealthPushCollection,
  type HealthSyncDelta,
} from '@api/health';
import { healthAssetsApi } from '@api/healthAssets';
import { healthFoodApi } from '@api/healthFood';
import { healthFridgeApi } from '@api/healthFridge';
import { healthInjuriesApi } from '@api/healthInjuries';

import { HEALTH_CACHE_KEYS } from './healthCacheKeys';
import { clearHealthCache } from './healthRepository';
import { syncHealthGlanceFromServer } from './healthWidgetStorage';

/**
 * Symply Health — "Clear all data".
 *
 * The donor shipped this row with an empty body (`// Clear data functionality`
 * in `MainTabView.swift`). This is the real thing, and it is the most
 * destructive verb in the app, so the mechanics are spelled out here rather than
 * hidden behind a single endpoint that does not exist.
 *
 * ## Why a sync PUSH and not a new endpoint
 *
 * Every tracking table already carries `deleted_at`, and `POST /health/sync/push`
 * already writes tombstones into it — that is how a delete made on one device
 * propagates to another. Erasing the account is therefore the SAME operation the
 * app performs every day, applied to every row at once:
 *
 *  - it needs no migration and no new route (this ships without touching the
 *    Worker, so it works against what is already deployed);
 *  - a tombstone PROPAGATES. A hard delete would leave the member's other phone
 *    holding rows it can never learn about, and the next push from that device
 *    would resurrect them. The tombstone is what makes the erase stick;
 *  - it is idempotent. A retry after a dropped response re-sends the same rows
 *    and the Worker answers `unchanged`, so a half-finished erase is finished by
 *    running it again rather than by cleaning up by hand.
 *
 * The P2 collections (custom foods, recipes, injuries, fridge, files) have no
 * push writer — the Worker answers `unsupported` for them by design — but each
 * has its own DELETE route, which is likewise a soft delete. Files are the one
 * place where bytes really are removed: the R2 object is destroyed and the row
 * keeps the tombstone.
 *
 * ## What is deliberately NOT erased
 *
 *  - **The account itself.** Signing out and deleting an account are different
 *    verbs, live elsewhere, and are shared across the fleet.
 *  - **Preferences** — units, notification switches, widget layout. They are not
 *    health records, and a member who erases their history usually wants their
 *    settings intact. {@link HEALTH_CLEAR_KEPT} says so on the screen.
 *  - **`cycle_length` / `period_length`.** Cycle SETTINGS cannot be tombstoned
 *    (the table has no `deleted_at` — it is a singleton, not a log), so the one
 *    piece of history it holds, `last_period_start`, is cleared and the two
 *    lengths are left at whatever the member configured.
 *  - **The daily calorie target.** `health_goals.daily_calories` is NOT NULL on
 *    the deployed schema, so it cannot be cleared, only replaced. Every other
 *    field on every goal row — the weight target, the starting weight, height,
 *    gender, birth year, activity level and the macro/water/step targets — IS
 *    nulled, because those are body facts rather than app settings.
 *
 * Every count this module returns is real. Nothing reports success for work it
 * did not do: a partial run says so, and the local cache is only dropped after
 * the server has been reached, so "cleared" never means "hidden on this phone".
 */

/* ==================================================================== */
/* Vocabulary for the confirmation copy                                  */
/* ==================================================================== */

/** Rendered as the bullet list the member confirms against. Keep it TRUE. */
export const HEALTH_CLEAR_DELETES: readonly string[] = [
  'Weight, water and food entries',
  'Workouts, steps and sleep records',
  'Body measurements',
  'Habits and their history',
  'Cycle, period and symptom records',
  'Vitality records',
  'Custom foods, recipes and fridge items',
  'Injuries',
  'Files you uploaded',
  'Your weight goal and body details (height, birth year)',
  'The AI coach conversation stored on this device',
];

export const HEALTH_CLEAR_KEPT: readonly string[] = [
  'Your account and profile',
  'Units, notification and widget settings',
];

/* ==================================================================== */
/* Tombstone planning (pure)                                             */
/* ==================================================================== */

interface TombstoneSpec {
  /** Bucket name in the delta AND collection name in the push — they match. */
  collection: HealthPushCollection;
  /**
   * UNIQUE natural-key columns the Worker reconciles this table on. They must
   * ride along on the tombstone or the row cannot be found (`user_id` is bound
   * to the token server-side, so it is never sent).
   */
  naturalKeys: readonly string[];
}

/**
 * Every push collection that carries `deleted_at`, children first.
 *
 * `cycle_settings` and `health_goals` are absent on purpose: both are
 * `softDelete: false` server-side, so a tombstone for either is silently
 * ignored. They are handled by {@link clearGoalHistory} instead.
 */
export const HEALTH_TOMBSTONE_SPECS: readonly TombstoneSpec[] = [
  { collection: 'habit_logs', naturalKeys: ['habit_id', 'date'] },
  { collection: 'habits', naturalKeys: [] },
  { collection: 'weight_entries', naturalKeys: [] },
  { collection: 'water_entries', naturalKeys: [] },
  { collection: 'nutrition_entries', naturalKeys: [] },
  { collection: 'body_measurements', naturalKeys: [] },
  { collection: 'health_entries', naturalKeys: [] },
  { collection: 'period_entries', naturalKeys: ['date'] },
  { collection: 'cycle_symptom_entries', naturalKeys: ['date'] },
  { collection: 'mens_health_entries', naturalKeys: ['date'] },
];

function isLiveRow(row: unknown): row is Record<string, unknown> {
  if (row === null || typeof row !== 'object') return false;
  const deletedAt = (row as { deleted_at?: unknown }).deleted_at;
  if (typeof deletedAt === 'string' && deletedAt.length > 0) return false; // already gone
  return typeof (row as { id?: unknown }).id === 'string';
}

/**
 * Delta → the minimal tombstone rows, split into requests the Worker accepts.
 *
 * Minimal on purpose: an id, the two stamps, and the natural key. Echoing the
 * whole row back would re-send columns the erase does not change and would give
 * a malformed cached row a way to be written back on its way out.
 *
 * The cap is across ALL collections in one request (`MAX_PUSH_ROWS`), so the
 * batches are filled greedily rather than one collection at a time.
 */
export function planHealthTombstones(
  delta: Partial<HealthSyncDelta> | null | undefined,
  deletedAt: string,
  maxRowsPerPush: number = HEALTH_SYNC_PUSH_MAX_ROWS
): HealthPushChanges[] {
  const source = (delta ?? {}) as Record<string, unknown>;
  const batches: HealthPushChanges[] = [];
  let current: HealthPushChanges = {};
  let currentRows = 0;

  const flush = () => {
    if (currentRows > 0) batches.push(current);
    current = {};
    currentRows = 0;
  };

  for (const spec of HEALTH_TOMBSTONE_SPECS) {
    const rows = source[spec.collection];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!isLiveRow(row)) continue;
      const tombstone: Record<string, unknown> = {
        id: row.id,
        // The conflict clock is the CLIENT's stamp (see the sync service): the
        // erase must be strictly newer than the row it targets, and equal-stamp
        // ties already go to the tombstone.
        updated_at: deletedAt,
        deleted_at: deletedAt,
      };
      for (const key of spec.naturalKeys) {
        if (row[key] !== undefined) tombstone[key] = row[key];
      }
      const bucket = current[spec.collection] ?? [];
      bucket.push(tombstone);
      current[spec.collection] = bucket;
      currentRows += 1;
      if (currentRows >= maxRowsPerPush) flush();
    }
  }
  flush();
  return batches;
}

/** Fields on a goal row that are body facts rather than app configuration. */
const CLEARABLE_GOAL_FIELDS = {
  target_weight_kg: null,
  weight_goal_type: null,
  starting_weight_kg: null,
  starting_weight_date: null,
  height_cm: null,
  gender: null,
  birth_year: null,
  activity_level: null,
  daily_protein_grams: null,
  daily_carbs_grams: null,
  daily_fats_grams: null,
  daily_water_ml: null,
  daily_steps: null,
  daily_workout_minutes: null,
  daily_sleep_hours: null,
} as const;

/* ==================================================================== */
/* The verb                                                              */
/* ==================================================================== */

export interface HealthClearResult {
  status: 'cleared' | 'partial' | 'failed';
  /** Friendly copy for the UI. NEVER a system or network error string. */
  message: string;
  /** Rows the server confirmed it tombstoned or deleted. */
  deleted: number;
  /** Rows that could not be reached — a retry picks exactly these up. */
  failed: number;
}

export const HEALTH_CLEAR_UNREACHABLE_MESSAGE =
  'We could not reach your health data just now, so nothing was deleted. Check your connection and try again.';

export const HEALTH_CLEAR_PARTIAL_MESSAGE =
  'Most of your health data was deleted, but some records could not be reached. Run it again to finish.';

export const HEALTH_CLEAR_DONE_MESSAGE = 'Your health data has been deleted.';

/** Small fan-out so a thousand rows do not open a thousand sockets at once. */
async function deleteEach(
  ids: string[],
  remove: (id: string) => Promise<unknown>
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  const CONCURRENCY = 6;
  for (let index = 0; index < ids.length; index += CONCURRENCY) {
    const slice = ids.slice(index, index + CONCURRENCY);
    const results = await Promise.allSettled(slice.map((id) => remove(id)));
    for (const result of results) {
      if (result.status === 'fulfilled') deleted += 1;
      else failed += 1;
    }
  }
  return { deleted, failed };
}

function liveIds(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(isLiveRow).map((row) => String(row.id));
}

/** Null out the body facts on every goal row the account holds. */
async function clearGoalHistory(
  delta: Partial<HealthSyncDelta>
): Promise<{ deleted: number; failed: number }> {
  const rows = Array.isArray(delta.health_goals) ? delta.health_goals : [];
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    const effectiveDate = (row as { effective_date?: unknown }).effective_date;
    if (typeof effectiveDate !== 'string') continue;
    try {
      await healthApi.saveGoal({ effective_date: effectiveDate, ...CLEARABLE_GOAL_FIELDS });
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
}

/**
 * Erase everything this account holds, then drop the copy on this device.
 *
 * ORDER MATTERS. The server is emptied first and the local cache only after:
 * clearing the cache first would blank the screens while the rows were still on
 * the server, and the next read-through would pull every one of them back — an
 * erase that appears to work and then silently undoes itself.
 */
export async function clearAllHealthData(): Promise<HealthClearResult> {
  let delta: HealthSyncDelta;
  try {
    delta = await healthApi.sync('1970-01-01T00:00:00.000Z');
  } catch {
    // Nothing has been touched — say exactly that rather than half-clearing.
    return { status: 'failed', message: HEALTH_CLEAR_UNREACHABLE_MESSAGE, deleted: 0, failed: 0 };
  }

  const now = new Date().toISOString();
  let deleted = 0;
  let failed = 0;

  // 1. Tombstone every tracking row through the sync contract.
  for (const changes of planHealthTombstones(delta, now)) {
    const rowCount = Object.values(changes).reduce((sum, rows) => sum + (rows?.length ?? 0), 0);
    try {
      const response = await healthApi.syncPush(changes);
      // `applied` and `unchanged` are BOTH successes here: unchanged means the
      // server already holds this exact tombstone (a replay), which is the
      // outcome the caller wanted. Anything else is left for a retry.
      const applied = (response?.summary?.applied ?? 0) + (response?.summary?.unchanged ?? 0);
      deleted += applied;
      failed += Math.max(0, rowCount - applied);
    } catch {
      failed += rowCount;
    }
  }

  // 2. The P2 collections, each through its own soft-delete route.
  const perCollection = await Promise.all([
    deleteEach(liveIds(delta.custom_foods), (id) => healthFoodApi.deleteCustomFood(id)),
    deleteEach(liveIds(delta.recipes), (id) => healthFoodApi.deleteRecipe(id)),
    deleteEach(liveIds(delta.injuries), (id) => healthInjuriesApi.deleteInjury(id)),
    deleteEach(liveIds(delta.fridge_items), (id) => healthFridgeApi.deleteFridgeItem(id)),
    deleteEach(liveIds(delta.user_files), (id) => healthAssetsApi.deleteFile(id)),
  ]);
  for (const result of perCollection) {
    deleted += result.deleted;
    failed += result.failed;
  }

  // 3. The singletons that cannot be tombstoned.
  const goals = await clearGoalHistory(delta);
  deleted += goals.deleted;
  failed += goals.failed;

  if (Array.isArray(delta.cycle_settings) && delta.cycle_settings.length > 0) {
    try {
      await healthApi.saveCycleSettings({ last_period_start: null });
      deleted += 1;
    } catch {
      failed += 1;
    }
  }

  // 4. Only now the device copy — including the coach transcript, which is the
  //    single most revealing thing Symply Health holds and lives nowhere else.
  await clearHealthCache(HEALTH_CACHE_KEYS);

  // 5. The App Group snapshot the Home Screen widget and the Watch face read.
  //    It is NOT one of the cache keys (it lives outside this app's storage),
  //    so without this the lock screen would keep showing figures derived from
  //    data the member just deleted until the next launch. Re-publishing from
  //    the now-empty server is the honest refresh; a failure here leaves a stale
  //    glance rather than breaking the erase, so it never changes the verdict.
  await syncHealthGlanceFromServer().catch(() => false);

  if (failed > 0) {
    return { status: 'partial', message: HEALTH_CLEAR_PARTIAL_MESSAGE, deleted, failed };
  }
  return { status: 'cleared', message: HEALTH_CLEAR_DONE_MESSAGE, deleted, failed };
}
