/**
 * The shared write helper every Health local api module goes through.
 *
 * One place enforces the rules the plan calls non-negotiable, so the He3a–He3d
 * facades cannot each get them subtly wrong:
 *
 *  - **Bulk writes emit ONE op per chunk, never one op per row.**
 *    `mutateLocalHealthLedger` captures and diffs the WHOLE ledger per call
 *    (`engine.ts:930-932`), so a loop of single writes is quadratic. Health's
 *    bulk paths are worse than House's: the He11 HealthKit drain imports months
 *    of steps, workouts and weight in one pass, and `bulkCreateNutrition` /
 *    `copyNutritionDay` exist precisely to write a day of meals at once.
 *  - **Reads never copy the ledger.** A read returns the live array filtered;
 *    the ledger is the source of truth and screens re-hydrate off the refresh
 *    bridge (plan §7), not off a snapshot.
 *  - **Tombstones are dropped by default.** Every remote list query this
 *    replaces carries `isNull(...deleted_at)` — `listWeight`
 *    (`health-service.ts:202-212`), `listWater` (`:422-431`), `listNutrition`
 *    (`:518-528`), `listHealthEntries` (`:1168-1183`), `listMeasurements`
 *    (`:1071-1079`), `listHabits` (`:1508-1526`). A local read that returns
 *    tombstoned rows is not "the same signature"; it is a deleted meal
 *    reappearing on Home. `allRowsOf` is there for sync, export and the window
 *    tests, which do need them.
 *  - **Every row is checked against the ledger's `user_id`.** Health keeps one
 *    ledger for one user, so the column is defensive rather than authoritative
 *    — but an account switch that leaves rows behind must read as empty, not as
 *    someone else's weight log.
 *
 * WHAT HEALTH DOES **NOT** INHERIT FROM HOUSE
 * -------------------------------------------
 * House's `requireActiveProperty(householdId)` has no counterpart here, and its
 * absence is deliberate rather than unfinished. It exists because a House member
 * can hold several properties and every remote method takes a `householdId`, so
 * a facade handed a background property's id would write the edit into the wrong
 * home. Health is a personal ledger — one user, N devices, exactly one
 * household, and He5 makes the control plane refuse a second `user_id` (plan
 * §1.2). No Health api method takes a household id, there is nothing to
 * activate, and there is no wrong home to write into.
 */
import { chunkRowsForOp } from '@symply/local-first';

import {
  ensureHealthRowsResident,
  getLocalHealthLedger,
  mutateLocalHealthLedger,
  type HealthLedger,
  type HealthResidencyNeed,
} from './engine';
import type { HealthLedgerTableName } from './schema';
import type { HealthLedgerRowBase } from './types';

export type LocalOpDescriptor = {
  opType: string;
  entityType: string;
  entityId: string;
  payload?: unknown;
};

/**
 * Where a write came from, passed straight through to the engine.
 *
 * `'local'` (the default) is a no-op for refresh subscribers — the screen that
 * saved already rendered it, and fanning out there refetches on every save.
 * `'ingest'` is the He11 HealthKit drain: it writes through this device, so it
 * is technically a local echo, but **no screen rendered it**, which is the whole
 * premise of the `'local'` no-op. Tag a drain `'ingest'` or Home will not
 * repaint after a background sync (plan §7, `engine.ts:914-917`).
 */
export type LocalWriteOptions = { origin?: 'local' | 'ingest' };

/** Read the ledger. Never mutate what this returns. */
export function ledger(): HealthLedger {
  return getLocalHealthLedger();
}

/** The personal household's id — one per device, per plan §1.2. */
export function activeHouseholdId(): string {
  return getLocalHealthLedger().household.id;
}

/** The user this ledger belongs to. Every row is checked against it. */
export function activeUserId(): string {
  return getLocalHealthLedger().household.userId;
}

/** One write, one op. The ordinary path. */
export async function writeLocal(
  mutator: (draft: HealthLedger) => void,
  op: LocalOpDescriptor,
  opts?: LocalWriteOptions,
): Promise<void> {
  await mutateLocalHealthLedger(
    mutator,
    {
      opType: op.opType,
      entityType: op.entityType,
      entityId: op.entityId,
      payload: op.payload ?? {},
    },
    opts,
  );
}

/**
 * A bulk write, chunked so each op stays under the relay's plaintext budget.
 *
 * `chunkRowsForOp` packs by bytes AND row count, and never drops a row that is
 * bigger than the budget on its own. Each chunk is one op, so a 600-row
 * HealthKit backfill is ~3 ops rather than 600 — and 600 ops would each
 * re-capture and re-diff the whole ledger.
 */
export async function writeLocalBulk<TRow>(
  rows: TRow[],
  apply: (draft: HealthLedger, chunk: TRow[]) => void,
  op: (chunk: TRow[], index: number) => LocalOpDescriptor,
  opts?: LocalWriteOptions,
): Promise<void> {
  if (rows.length === 0) return;
  const chunks = chunkRowsForOp(rows);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;

    await writeLocal((draft) => apply(draft, chunk), op(chunk, index), opts);
  }
}

/**
 * Make sure the rows a read is about to answer from are actually in memory.
 *
 * **`rowsOf` is synchronous and cannot do this for you.** It returns the live
 * ledger array, and under the He10 §4 resident window (`schema.ts`,
 * `HEALTH_RESIDENT_WINDOW_DAYS`) that array holds ~420 days of the five dated
 * log tables — everything older is sealed on disk and not in it. So the rule for
 * every facade method that can address a date outside that window is:
 *
 *     await ensureResident([...]);   // then read
 *
 * A read that skips it does not fail loudly. It returns a shorter answer: a
 * weight chart that stops fourteen months ago, a meal day that renders empty.
 * That is the §1.3 failure mode, so this is a correctness call and not a
 * performance one — the same status `windows.ts` has.
 *
 * Free on a fully-resident ledger, which is every Jest session built by
 * `openLocalHealthSessionForTests` and every session a checkpoint install has
 * replaced whole.
 */
export async function ensureResident(needs: readonly HealthResidencyNeed[]): Promise<void> {
  await ensureHealthRowsResident(needs);
}

export type { HealthResidencyNeed };

/** Every row of one table, tombstones included — for sync, export and windows. */
export function allRowsOf<T extends HealthLedgerRowBase>(table: HealthLedgerTableName): T[] {
  const current = ledger();
  const userId = current.household.userId;
  const rows = (current as unknown as Record<string, unknown>)[table] as T[] | undefined;
  if (!rows) return [];
  // A row with no `user_id` belongs to the ledger it is in — the column is
  // defensive, not authoritative, because the ledger is already per user.
  return rows.filter((row) => row.user_id == null || row.user_id === userId);
}

/**
 * Live rows of one table — what a facade replacing a remote list read wants.
 *
 * Tombstones are dropped here rather than at each call site, because every
 * remote query being replaced dropped them server-side. See the header.
 */
export function rowsOf<T extends HealthLedgerRowBase>(table: HealthLedgerTableName): T[] {
  return allRowsOf<T>(table).filter((row) => row.deleted_at == null);
}

/**
 * One live row by id, or null.
 *
 * A writer that needs to find and revive a tombstoned row — an upsert on a
 * deterministic id, which is exactly what `habitLogs` and `healthGoals` do —
 * must go through `allRowsOf`, or it will mint a duplicate id that LWW then has
 * to reconcile.
 */
export function rowById<T extends HealthLedgerRowBase>(
  table: HealthLedgerTableName,
  id: string,
): T | null {
  return rowsOf<T>(table).find((row) => row.id === id) ?? null;
}

/** ISO timestamp for `created_at` / `updated_at`. */
export function nowIso(): string {
  return new Date().toISOString();
}
