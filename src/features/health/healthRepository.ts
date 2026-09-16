import { recordE2EPersistEntry } from '@api/e2eTestObservability';
import { healthApi, type HealthPushChanges, type HealthPushCollection } from '@api/health';
import { storageHelpers } from '@services/storage';

/**
 * Read-through cache for the Symply Health domain.
 *
 * Parity phase P1 moved the record of truth from the device to the
 * `symply-health-api` Worker. The screens still call the same
 * `load*` / `save*` functions they always did — those functions now talk to the
 * API and mirror the result into MMKV.
 *
 * Why keep MMKV at all:
 *  - **Offline.** Health logging happens in gyms, on planes and in basements. A
 *    failed GET falls back to the last-known snapshot instead of an empty
 *    screen, and a failed WRITE still updates the cache so the UI reflects what
 *    the user just did (the next successful sync reconciles it).
 *  - **Cold start.** The cached snapshot renders instantly while the network
 *    request is still in flight.
 *
 * The cache is never authoritative: any successful server read replaces it
 * wholesale, so a delete on another device cannot be resurrected by stale local
 * rows.
 *
 * ── THE OUTBOX: WHAT "IT WILL SYNC WHEN YOU ARE BACK ONLINE" ACTUALLY MEANS ──
 *
 * Every Health screen tells the member exactly that when a write fails
 * (`…_OFFLINE_MESSAGE`). Until now it was not true: a failed write updated the
 * local cache and NOTHING ever sent it. `POST /health/sync/push` — the write
 * half of the delta-sync contract — has been deployed since P1 with no caller at
 * all, so the first successful read simply overwrote the member's unsynced
 * changes with the server's older copy and they were gone without a word.
 *
 * `writeThrough` now takes an OPTIONAL `queue` descriptor. When a write fails
 * and one was supplied, the row is appended to a persisted outbox, and the next
 * time anything on this device reaches the Worker the outbox is flushed through
 * `syncPush`. That is the whole mechanism:
 *
 *   failed write ─► outbox (persisted) ─► any later successful call ─► push
 *
 * ### It is opt-in, and that is deliberate
 *
 * `write` is an opaque closure — the repository cannot know WHAT row a caller
 * just sent, so it cannot queue anything the caller has not described. A store
 * that passes no `queue` behaves exactly as it did before, which is what keeps
 * ten storage modules working unchanged. A store opts in with one extra
 * argument:
 *
 * ```ts
 * writeThrough(KEY, write, after, optimistic, detail, {
 *   queue: { collection: 'weight_entries', row: { id, date, weight, unit } },
 * })
 * ```
 *
 * Only the twelve `PUSH_COLLECTIONS` the Worker accepts can be queued; anything
 * else (custom foods, recipes, injuries, fridge items, files) has no push writer
 * on the server and must not pretend to have one.
 *
 * ### Every queued row is eventually dropped
 *
 * A push answers with a per-row verdict, and EVERY verdict is final —
 * `applied`, `unchanged`, `stale`, `tombstoned`, `forbidden` and `invalid` all
 * mean "the server has decided", and re-sending would either change nothing or
 * lose the same argument again. So a row that gets any verdict leaves the
 * outbox. Only a request that never landed keeps its rows, and the outbox is
 * capped so a device that is offline for a fortnight cannot grow one without
 * bound.
 */

/** Set by tests to force the offline path deterministically. */
let forceOfflineForTests = false;

export function __setHealthOfflineForTests(offline: boolean): void {
  forceOfflineForTests = offline;
}

/* ==================================================================== */
/* Outbox                                                               */
/* ==================================================================== */

/**
 * Where queued offline changes live. Registered in `healthCacheKeys.ts` —
 * it holds real health rows and MUST be cleared on sign-out.
 */
export const HEALTH_OUTBOX_KEY = 'health.outbox.v1';

/**
 * Ceiling on queued rows.
 *
 * The Worker refuses a push carrying more than 500 rows in one request, and a
 * device that has been offline long enough to queue 200 changes has a bigger
 * problem than a lost row. Overflow drops the OLDEST entry: the newest edit to
 * a given thing is the one the member would expect to survive.
 */
export const MAX_OUTBOX_ROWS = 200;

/** One queued write. `row` is the payload `POST /health/sync/push` will carry. */
export interface HealthQueuedChange {
  collection: HealthPushCollection;
  row: Record<string, unknown>;
}

/** As stored: the change plus when it was queued, for ordering and ageing. */
interface OutboxEntry extends HealthQueuedChange {
  queued_at: string;
}

/**
 * Cheap "is there anything to flush" hint.
 *
 * `readThrough` runs on nearly every screen mount, and hitting storage on each
 * one to discover an empty outbox would be a read per render for nothing. Starts
 * TRUE so the first successful call after a cold start probes once (there may be
 * rows left from the previous session — that is exactly the case the outbox
 * exists for), and is set false as soon as a probe finds it empty.
 */
let outboxMayHaveRows = true;

/** Guards against two flushes racing on a burst of parallel loaders. */
let flushInFlight: Promise<void> | null = null;

async function readOutbox(): Promise<OutboxEntry[]> {
  const stored = await storageHelpers.getObject<OutboxEntry[]>(HEALTH_OUTBOX_KEY);
  return Array.isArray(stored) ? stored.filter(isOutboxEntry) : [];
}

function isOutboxEntry(value: unknown): value is OutboxEntry {
  if (value === null || typeof value !== 'object') return false;
  const entry = value as Partial<OutboxEntry>;
  return (
    typeof entry.collection === 'string' &&
    entry.row !== null &&
    typeof entry.row === 'object' &&
    !Array.isArray(entry.row)
  );
}

/**
 * The row FIELDS a collection reconciles on, mirroring
 * `backend/src/services/health-sync-service.ts`'s `TABLE_SPECS[...].naturalKey`
 * EXACTLY, with `'user_id'` dropped from every list — it is never a value the
 * client sends (the Worker binds it from the auth token, never the payload),
 * so it contributes nothing to a CLIENT-SIDE dedup key.
 *
 * A collection absent from this map is id-keyed: `habits`, `weight_entries`,
 * `water_entries`, `nutrition_entries`, `body_measurements`, `health_entries`.
 * `cycle_settings` maps to `[]` deliberately — it is a natural-key table whose
 * only key column IS `user_id`, so once that is dropped there is nothing left
 * to key on: every account has at most one, and every queued edit to it
 * collapses onto the SAME outbox slot.
 *
 * KEEP IN STEP WITH THE SERVER. A collection added to `PUSH_COLLECTIONS` with a
 * natural key needs an entry here, or two offline edits to the same day queue as
 * two separate rows instead of one superseding the other.
 */
const OUTBOX_NATURAL_KEY_FIELDS: Partial<Record<HealthPushCollection, readonly string[]>> = {
  habit_logs: ['habit_id', 'date'],
  cycle_settings: [],
  period_entries: ['date'],
  cycle_symptom_entries: ['date'],
  mens_health_entries: ['date'],
  health_goals: ['effective_date'],
};

/**
 * The handle a queued row is deduplicated on: the collection's real natural key
 * when it has a client-facing one, an explicit `id` otherwise.
 *
 * Two offline edits to the same day (or the same id) must collapse to the LAST
 * one, or the push replays a superseded value on top of the real one — the
 * outbox holds INTENT ("what should this row say"), not a log of edits.
 */
function outboxHandle(entry: HealthQueuedChange): string {
  const fields = OUTBOX_NATURAL_KEY_FIELDS[entry.collection];
  if (fields !== undefined) {
    // Missing a key field is not this function's problem to reject — a
    // malformed queued row is caught by the server's own `invalid` verdict.
    // Joining with a separator the values cannot themselves contain (the field
    // NAMES are in the key too) keeps `['', 'x']` from colliding with `['x', '']`.
    const parts = fields.map((field) => {
      const value = entry.row[field];
      return `${field}=${typeof value === 'string' ? value : ''}`;
    });
    return `${entry.collection}#${parts.join('|')}`;
  }
  const id = entry.row.id;
  return `${entry.collection}#id=${typeof id === 'string' ? id : ''}`;
}

/**
 * Queue one change for the next successful connection.
 *
 * Exported so a store can enqueue outside a `writeThrough` (a bulk import, say),
 * but the ordinary path is the `queue` option on `writeThrough` itself.
 *
 * Never throws. A queue that cannot be written is a lost background retry, not a
 * reason to fail the user's action a second time — they have already been told
 * it saved locally.
 */
export async function enqueueHealthChange(change: HealthQueuedChange): Promise<void> {
  try {
    const existing = await readOutbox();
    const handle = outboxHandle({ collection: change.collection, row: change.row });
    const priorAtHandle = existing.find(
      (e) => e.collection === change.collection && outboxHandle(e) === handle
    );

    const entry: OutboxEntry = {
      collection: change.collection,
      // MERGED with whatever was already queued at this handle, not replaced.
      //
      // `health_goals` is the reason this matters: it is ONE effective-dated row
      // that FOUR unrelated features (weight goal, water target, calorie week,
      // activity goals) each patch a few columns of, and none of them reads the
      // others' fields before writing. A wholesale replace here would let a
      // water-target edit queued after a weight-goal edit on the same day
      // silently drop the weight-goal columns from the push — exactly the
      // partial-PATCH semantics `HealthService.saveGoal`'s `onConflictDoUpdate`
      // gives the ONLINE path, which the outbox must not narrow.
      //
      // Every other collection queued here already reads-merges its own full
      // state before building `row` (`{...current, ...patch}`), so for those
      // this spread is a same-value no-op, not a behaviour change.
      row: {
        ...(priorAtHandle?.row ?? {}),
        ...change.row,
        // The push resolves conflicts by `updated_at` and refuses rows stamped
        // more than five minutes in the future. A row queued without one would
        // lose every tie against the server copy it is meant to replace.
        updated_at:
          typeof change.row.updated_at === 'string'
            ? change.row.updated_at
            : new Date().toISOString(),
      },
      queued_at: new Date().toISOString(),
    };

    // The newer edit's queue slot moves to the END — a flush pushes queue order,
    // and a row just touched again should retry no later than a fresher one.
    const next = [...existing.filter((e) => outboxHandle(e) !== handle), entry];

    await storageHelpers.setObject(
      HEALTH_OUTBOX_KEY,
      next.length > MAX_OUTBOX_ROWS ? next.slice(next.length - MAX_OUTBOX_ROWS) : next
    );
    outboxMayHaveRows = true;
  } catch {
    // Deliberately silent — see above.
  }
}

/** How many changes are waiting. Exposed so a screen can show a badge. */
export async function healthOutboxSize(): Promise<number> {
  return (await readOutbox()).length;
}

/**
 * Push everything queued, and drop every row the server ruled on.
 *
 * Returns the number of rows that LEFT the outbox, which is not the same as the
 * number written — `stale` and `invalid` are also final answers.
 *
 * Rows in a collection the Worker reports as `unsupported` are KEPT: that means
 * a newer client queued a table this deploy has no writer for, and the sync
 * contract is explicit that those must stay dirty rather than be dropped.
 */
export async function flushHealthOutbox(): Promise<number> {
  if (forceOfflineForTests) return 0;

  const entries = await readOutbox();
  if (entries.length === 0) {
    outboxMayHaveRows = false;
    return 0;
  }

  // Bucketed by collection; a PARENT (a habit) still lands before its CHILD (a
  // habit log) regardless of insertion order here, because the server iterates
  // `PUSH_COLLECTIONS` in its own fixed, parents-first order and looks each
  // collection up by name — it does not depend on this object's key order.
  const changes: HealthPushChanges = {};
  for (const entry of entries) {
    const bucket = changes[entry.collection] ?? [];
    bucket.push(entry.row);
    changes[entry.collection] = bucket;
  }

  let response;
  try {
    response = await healthApi.syncPush(changes);
  } catch {
    // Never landed. Everything stays queued for the next attempt.
    return 0;
  }

  const unsupported = new Set(Array.isArray(response?.unsupported) ? response.unsupported : []);
  const decided = new Set<string>();
  for (const [collection, results] of Object.entries(response?.results ?? {})) {
    if (unsupported.has(collection)) continue;
    for (const result of results ?? []) {
      // `index` is the position within THIS collection's pushed array, which is
      // the only handle a row without an id has.
      if (typeof result?.index === 'number') decided.add(`${collection}:${result.index}`);
    }
  }

  const kept: OutboxEntry[] = [];
  const perCollectionIndex = new Map<string, number>();
  for (const entry of entries) {
    const index = perCollectionIndex.get(entry.collection) ?? 0;
    perCollectionIndex.set(entry.collection, index + 1);
    if (unsupported.has(entry.collection)) {
      kept.push(entry);
      continue;
    }
    // A row the server did NOT rule on is kept too — a truncated or partial
    // result must not silently discard a change.
    if (!decided.has(`${entry.collection}:${index}`)) kept.push(entry);
  }

  await storageHelpers.setObject(HEALTH_OUTBOX_KEY, kept);
  outboxMayHaveRows = kept.length > 0;
  return entries.length - kept.length;
}

/**
 * Flush opportunistically after any call that proved we can reach the Worker.
 *
 * Fire-and-forget on purpose: the member's read must not wait on a background
 * retry of something they were already told had saved. Deduped through
 * `flushInFlight` so a screen that mounts six loaders at once pushes once.
 */
function scheduleOutboxFlush(): void {
  if (!outboxMayHaveRows || flushInFlight !== null || forceOfflineForTests) return;
  flushInFlight = flushHealthOutbox()
    .catch(() => undefined)
    .then(() => {
      flushInFlight = null;
    });
}

/** Test hook: forget the "there might be rows" hint and any in-flight flush. */
export function __resetHealthOutboxHintForTests(): void {
  outboxMayHaveRows = true;
  flushInFlight = null;
}

/** Last network outcome per cache key — surfaced so screens can show a badge. */
const lastSyncState = new Map<string, 'synced' | 'offline'>();

export function healthSyncStateFor(key: string): 'synced' | 'offline' | 'unknown' {
  return lastSyncState.get(key) ?? 'unknown';
}

/**
 * Fetch from the API, mirror into MMKV, and fall back to the cache when the
 * network fails. `fallback` is used only when there is no cached value either.
 */
export async function readThrough<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  fallback: T
): Promise<T> {
  if (!forceOfflineForTests) {
    try {
      const fresh = await fetcher();
      await storageHelpers.setObject(cacheKey, fresh);
      lastSyncState.set(cacheKey, 'synced');
      // We just proved the Worker is reachable. Anything queued while it was not
      // goes now — no screen has to remember to ask.
      scheduleOutboxFlush();
      return fresh;
    } catch {
      // Fall through to the cache — a network failure must never blank a screen
      // or surface a raw error string (see the no-raw-error-leaks rule).
      lastSyncState.set(cacheKey, 'offline');
    }
  } else {
    lastSyncState.set(cacheKey, 'offline');
  }

  const cached = await storageHelpers.getObject<T>(cacheKey);
  return isCacheShapeValid(cached, fallback) ? (cached as T) : fallback;
}

/**
 * Reject a cached snapshot whose SHAPE no longer matches what the caller
 * expects, falling back instead of handing it on.
 *
 * Every Health loader does `(await readThrough(...)).filter(...)` or similar. A
 * cache entry that is corrupt, hand-edited, or left behind by an older schema
 * would otherwise reach that call and throw — blanking the screen with a crash
 * on exactly the offline path the cache exists to protect. The pre-parity
 * loaders each guarded with `Array.isArray`; centralising it here restores that
 * for all ten of them at once and keeps future loaders safe by default.
 *
 * The expected shape is inferred from `fallback`, so callers need no extra
 * argument: an array fallback demands an array, an object fallback demands a
 * non-null object.
 */
function isCacheShapeValid<T>(cached: T | null, fallback: T): boolean {
  if (cached === null || cached === undefined) return false;
  if (Array.isArray(fallback)) return Array.isArray(cached);
  if (fallback !== null && typeof fallback === 'object') {
    return typeof cached === 'object' && !Array.isArray(cached);
  }
  return typeof cached === typeof fallback;
}

/**
 * Send a write to the API, then refresh the cache from `after`.
 *
 * When the write fails we still return the optimistic value so the UI reflects
 * the user's action; the cache keeps it until a successful read replaces it.
 *
 * `options.queue` describes the ROW that was being written, so that a failed
 * write can be retried later through `POST /health/sync/push`. It is optional
 * and every existing caller omits it — see the module header for what that costs
 * and how a store opts in.
 *
 * A REJECTION IS NOT QUEUED. `writeThrough` cannot tell a lost connection from a
 * refusal on its own, so the caller says: `options.shouldQueue(error)` returns
 * false for anything the server actively refused. Re-sending a 400 or a 404
 * forever would be a poison pill in the outbox, and the stores already make
 * exactly this distinction to choose their copy (`fridgeRejectionMessageFor`).
 * The default queues only when there was no HTTP response at all.
 */
export interface HealthWriteOptions {
  /** The row to retry later. Omit for anything the push contract cannot carry. */
  queue?: HealthQueuedChange;
  /** Default: queue only when the request got no response (a real outage). */
  shouldQueue?: (error: unknown) => boolean;
}

/** No response at all ⇒ the request never landed ⇒ worth retrying. */
function isTransportFailure(error: unknown): boolean {
  const status = (error as { response?: { status?: unknown } } | null | undefined)?.response?.status;
  return typeof status !== 'number';
}

export async function writeThrough<T>(
  cacheKey: string,
  write: () => Promise<unknown>,
  after: () => Promise<T>,
  optimistic: T,
  detail?: string,
  options?: HealthWriteOptions
): Promise<T> {
  recordE2EPersistEntry({
    store: cacheKey,
    operation: 'update',
    detail: detail ?? 'write',
  });

  if (!forceOfflineForTests) {
    try {
      await write();
      const fresh = await after();
      await storageHelpers.setObject(cacheKey, fresh);
      lastSyncState.set(cacheKey, 'synced');
      scheduleOutboxFlush();
      return fresh;
    } catch (error) {
      lastSyncState.set(cacheKey, 'offline');
      if (options?.queue) {
        const shouldQueue = options.shouldQueue ?? isTransportFailure;
        if (shouldQueue(error)) await enqueueHealthChange(options.queue);
      }
    }
  } else {
    lastSyncState.set(cacheKey, 'offline');
    // The forced-offline test path is a stand-in for a real outage, so it queues
    // too — otherwise the offline suites would exercise a code path the app
    // never actually takes.
    if (options?.queue) await enqueueHealthChange(options.queue);
  }

  await storageHelpers.setObject(cacheKey, optimistic);
  return optimistic;
}

/**
 * Drop every cached Health snapshot — used on sign-out (cross-user leak guard).
 *
 * The OUTBOX goes with them. It is in `HEALTH_CACHE_KEYS`, so passing that list
 * clears it; it is also cleared unconditionally here, because an outbox that
 * survived a sign-out would push one person's queued weight and symptom rows
 * under whoever signs in next — the exact leak this function exists to stop.
 */
export async function clearHealthCache(keys: readonly string[]): Promise<void> {
  await Promise.all(keys.map((k) => storageHelpers.delete(k)));
  await storageHelpers.delete(HEALTH_OUTBOX_KEY);
  lastSyncState.clear();
  outboxMayHaveRows = false;
  flushInFlight = null;
}
