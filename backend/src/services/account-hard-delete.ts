/**
 * Account deletion → HARD delete. No row, no file, no evidence.
 *
 * ## Why this replaces the soft delete
 *
 * `deleteAccount` used to stamp `users.deleted_at` and stop. That leaves the
 * whole account in place: every task, project, appliance, message and receipt
 * the person ever wrote, still keyed to a `users` row that merely claims to be
 * gone. It also has a visible symptom — the email stays taken. Observed on
 * production 2026-09-04: an account was deleted, and every subsequent sign-up
 * with the same address answered `409 Conflict`, because the uniqueness check
 * does not exclude soft-deleted rows. The person could neither sign in (their
 * credentials were revoked) nor sign up (their own tombstone was in the way).
 *
 * The requirement is therefore literal: after this runs, zero records remain.
 *
 * ## Why the table list is DERIVED, never hand-written
 *
 * The fleet schema is 244 tables, of which 134 reference a user and 104 are
 * scoped to a household. A hand-written list of deletes would be wrong the day
 * after it was written — a new feature adds a table, nobody remembers this file,
 * and that table quietly retains data through every future deletion. Worse, it
 * would fail silently: there is no test that can notice a table nobody listed.
 *
 * So the sweep reads the Drizzle schema at runtime and deletes from every table
 * that carries a `user_id` (rows the person authored) or a `household_id` (rows
 * belonging to a home nobody is left in). A table added tomorrow is covered the
 * moment it has either column, with no edit here.
 *
 * ## What is deliberately NOT deleted
 *
 * A household with other members left in it. Their tasks and their history are
 * not this person's to erase — they only lose the departing member, and
 * `detachUserFromAllHouseholds` already promotes a new owner so the home stays
 * manageable. Only homes left with NOBODY are erased outright.
 *
 * ## Order, and why it is not arbitrary
 *
 * Children before parents, always: household-scoped rows, then the households,
 * then user-scoped rows, then the `users` row last. D1 rejects `PRAGMA
 * defer_foreign_keys` over the HTTP API, so ordering is the only tool available
 * — a parent deleted first would fail the whole sweep on a foreign key and
 * leave the account half-erased, which is worse than not starting.
 */
import { getTableColumns, getTableName, inArray, eq, or, sql } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';

import { allTables } from '../db/all-tables';
import * as schema from '../db/schema';
import type { Database } from '../types';

import { detachUserFromAllHouseholds } from './household-detach';

export interface HardDeleteSummary {
  /** Households erased outright because the account was their last member. */
  erasedHouseholdIds: string[];
  /** Households the account merely left — other members keep their data. */
  detachedHouseholdIds: string[];
  /** `table → rows removed`, for the audit line the caller logs (not stored). */
  rowsByTable: Record<string, number>;
  /** Total rows removed across every table, the `users` row included. */
  totalRows: number;
  /** R2 objects deleted. `null` when no bucket was supplied to delete them. */
  r2ObjectsDeleted: number | null;
}

/**
 * Is this failure just "that table does not exist here"?
 *
 * The CAUSE CHAIN is the whole point. Drizzle wraps driver errors, so the
 * top-level message reads `Failed query: delete from "household_invitations"…`
 * and the SQLite reason — `no such table` — is only reachable through
 * `error.cause`, sometimes two levels down (Drizzle wraps, then D1 wraps). A
 * check against `error.message` alone silently matches nothing, which is worse
 * than having no check: every missing table would abort the sweep and leave an
 * account half-erased, exactly the failure the tolerance exists to prevent.
 */
function isMissingTable(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (/no such table/i.test(message)) return true;
    current = current instanceof Error ? (current.cause as unknown) : undefined;
  }
  return false;
}

/**
 * Columns that mean "this row IS the person's" — the row goes.
 *
 * `user_id` alone is not enough and assuming it was is how the first version of
 * this sweep silently missed ~39 tables: `tasks` has no `user_id` at all, it has
 * `assigned_to`, and 33 further tables key their author as `created_by`.
 */
const OWNERSHIP_COLUMNS = [
  'user_id',
  'created_by',
  'owner_user_id',
  'author_user_id',
  'uploaded_by',
  'sender_user_id',
] as const;

/**
 * Columns that merely POINT AT the person from somebody else's row.
 *
 * A task assigned to the leaver but written by a member who is staying is that
 * member's row, in that member's home. Deleting it to erase a foreign key would
 * destroy data belonging to someone who did not ask to be deleted. Clearing the
 * reference removes the evidence without taking the row — which is what "no
 * record of the user" actually requires.
 *
 * Only when the column is NOT NULL is the row deleted instead, because a
 * reference that cannot be cleared cannot be anonymised.
 */
const REFERENCE_COLUMNS = ['assigned_to', 'actor_user_id', 'member_user_id', 'recipient_user_id'] as const;

/**
 * Columns that hold an R2 object key.
 *
 * Derived by SHAPE rather than listed, for the same reason the table sweep is:
 * 13 tables carry one today under 17 different names (`file_key`,
 * `original_file_key`, `crop_image_key`, `storage_key`…), and a hand-written
 * list would miss the fourteenth. A row deleted without its object leaves the
 * file orphaned in the bucket forever — invisible to every later audit, because
 * the row that named it is gone.
 */
function r2KeyColumns(columns: Record<string, unknown>): string[] {
  return Object.keys(columns).filter((c) =>
    /^(r2_key|storage_key|object_key)$|_(file|image)_key$|^(file|image)_key$/.test(c)
  );
}

interface ScopedTable {
  table: SQLiteTable;
  name: string;
  /** Columns whose match means the row belongs to the user. */
  ownership: string[];
  /** Columns that only reference the user from another member's row. */
  references: string[];
  /** Columns naming an R2 object that must die with the row. */
  r2Keys: string[];
  hasHousehold: boolean;
}

/** Every Drizzle table in the schema, with the columns this sweep keys on. */
function scopedTables(): ScopedTable[] {
  const out: ScopedTable[] = [];
  // `allTables()`, never `Object.values(schema)`: the barrel re-exports only 14
  // of 36 schema files, so iterating it silently skipped 22 files' worth of
  // tables — and a table the sweep cannot see is one it can never fail on.
  for (const value of allTables()) {
    const columns = getTableColumns(value);
    const ownership = OWNERSHIP_COLUMNS.filter((c) => c in columns);
    const references = REFERENCE_COLUMNS.filter((c) => c in columns);
    const hasHousehold = 'household_id' in columns;
    if (!ownership.length && !references.length && !hasHousehold) continue;
    out.push({
      table: value,
      name: getTableName(value),
      ownership,
      references,
      r2Keys: r2KeyColumns(columns),
      hasHousehold,
    });
  }
  return out;
}

/**
 * Erase everything belonging to `userId`.
 *
 * Idempotent: a second call finds no memberships and no rows, and returns a
 * summary of zeroes rather than throwing. That matters because the caller is an
 * HTTP handler a client may retry.
 */
export async function hardDeleteUser(
  db: Database,
  userId: string,
  /**
   * The reports bucket, when the caller has one.
   *
   * Optional so every existing caller and test keeps working, but a caller that
   * CAN pass it should: without the bucket the rows go and their files stay,
   * orphaned and unfindable — nothing left in the database names them, so no
   * later audit can ever discover them. The summary reports what was skipped so
   * that is visible rather than assumed.
   */
  bucket?: R2Bucket
): Promise<HardDeleteSummary> {
  // Detach FIRST, for the ownership rules it enforces: a home with members left
  // gets a promoted owner rather than being orphaned, and the set of homes left
  // with nobody comes back as `emptiedHouseholdIds` — precisely the homes this
  // sweep is allowed to erase.
  const detached = await detachUserFromAllHouseholds(db, userId);
  const erasedHouseholdIds = detached.emptiedHouseholdIds;

  const summary: HardDeleteSummary = {
    erasedHouseholdIds,
    detachedHouseholdIds: detached.detachedHouseholdIds,
    rowsByTable: {},
    totalRows: 0,
    r2ObjectsDeleted: bucket ? 0 : null,
  };

  const record = (name: string, changes: number) => {
    if (!changes) return;
    summary.rowsByTable[name] = (summary.rowsByTable[name] ?? 0) + changes;
    summary.totalRows += changes;
  };

  /**
   * Delete from one table, tolerating the table not existing.
   *
   * The sweep is driven by the SCHEMA, and the schema can legitimately describe
   * a table this database has not got: a migration not yet applied to this
   * environment, or a brand whose feature tables were never created here. The
   * fleet runs four Workers off one schema, so that is normal rather than
   * exceptional.
   *
   * Letting "no such table" abort the run is the dangerous outcome — it would
   * stop halfway and leave an account PARTLY erased, which is worse than either
   * finishing or not starting. Every other error still propagates: a failed
   * delete on a table that DOES exist means rows survived, and that must not be
   * reported as a successful erasure.
   */
  const deleteFrom = async (name: string, run: () => Promise<{ meta?: { changes?: number } }>) => {
    try {
      const result = await run();
      record(name, result.meta?.changes ?? 0);
    } catch (error) {
      if (isMissingTable(error)) return;
      throw error;
    }
  };

  const tables = scopedTables();

  // 0. R2 objects FIRST, while the rows that name them still exist. Reversing
  // this order is unrecoverable: once the row is gone nothing points at the
  // file, so it can never be found again by any means.
  if (bucket) {
    const keys = new Set<string>();
    for (const { table, ownership, r2Keys, hasHousehold } of tables) {
      if (!r2Keys.length) continue;
      const columns = getTableColumns(table);
      const clauses = [
        ...ownership.map((c) => eq(columns[c]!, userId)),
        ...(hasHousehold && erasedHouseholdIds.length
          ? [inArray(columns.household_id!, erasedHouseholdIds)]
          : []),
      ];
      if (!clauses.length) continue;
      try {
        const rows = await db
          .select(Object.fromEntries(r2Keys.map((c) => [c, columns[c]!])))
          .from(table)
          .where(clauses.length === 1 ? clauses[0] : or(...clauses))
          .all();
        for (const row of rows as Array<Record<string, unknown>>) {
          for (const c of r2Keys) {
            const value = row[c];
            if (typeof value === 'string' && value) keys.add(value);
          }
        }
      } catch (error) {
        if (!isMissingTable(error)) throw error;
      }
    }

    // Avatars are not named by any row — the key embeds the user id instead.
    try {
      const listed = await bucket.list({ prefix: `avatars/${userId}` });
      for (const object of listed.objects) keys.add(object.key);
    } catch {
      // A bucket that cannot be listed must not fail the account deletion; the
      // rows still go, and the summary shows the object count for what it is.
    }

    for (const key of keys) {
      try {
        await bucket.delete(key);
        summary.r2ObjectsDeleted = (summary.r2ObjectsDeleted ?? 0) + 1;
      } catch {
        // Deleting an object that is already gone is success for our purposes.
      }
    }
  }

  // 1. Rows belonging to homes nobody is left in.
  if (erasedHouseholdIds.length > 0) {
    for (const { table, name, hasHousehold } of tables) {
      if (!hasHousehold) continue;
      // The households table itself is a PARENT of all of these — it goes in
      // step 2, once its children are gone.
      if (name === getTableName(schema.households)) continue;
      const columns = getTableColumns(table);
      await deleteFrom(name, () =>
        db.delete(table).where(inArray(columns.household_id, erasedHouseholdIds)).run()
      );
    }

    await deleteFrom(getTableName(schema.households), () =>
      db.delete(schema.households).where(inArray(schema.households.id, erasedHouseholdIds)).run()
    );
  }

  // 2. Rows this person authored anywhere, including in homes that survive.
  for (const { table, name, ownership } of tables) {
    if (!ownership.length) continue;
    const columns = getTableColumns(table);
    // OR across every ownership column the table has: `messages` keys the
    // author as `sender_user_id`, `tasks` as `assigned_to`, most others as
    // `user_id` or `created_by`. One pass, whichever it uses.
    const match =
      ownership.length === 1
        ? eq(columns[ownership[0]!]!, userId)
        : or(...ownership.map((c) => eq(columns[c]!, userId)));
    await deleteFrom(name, () => db.delete(table).where(match).run());
  }

  // 2b. References FROM other members' rows: anonymise rather than delete.
  // Their row is not ours to remove; the pointer to a deleted person is.
  for (const { table, name, references } of tables) {
    if (!references.length) continue;
    const columns = getTableColumns(table);
    for (const column of references) {
      const col = columns[column]!;
      if (col.notNull) {
        // Cannot be cleared, so the row cannot be anonymised — it goes.
        await deleteFrom(name, () => db.delete(table).where(eq(col, userId)).run());
        continue;
      }
      await deleteFrom(name, () =>
        db
          .update(table)
          .set({ [column]: null } as never)
          .where(eq(col, userId))
          .run()
      );
    }
  }

  // 3. The account itself, last — everything above may reference it.
  await deleteFrom(getTableName(schema.users), () =>
    db.delete(schema.users).where(eq(schema.users.id, userId)).run()
  );

  return summary;
}

/**
 * Prove the erasure, for the caller to assert on.
 *
 * Deliberately counts rather than trusts: the sweep reports what it believes it
 * deleted, and a table it never visited reports nothing at all. This asks the
 * database the opposite question — is anything still keyed to this user — so a
 * gap in the sweep surfaces as a failure instead of a clean-looking summary.
 */
export async function countRemainingUserRows(
  db: Database,
  userId: string
): Promise<{ total: number; byTable: Record<string, number> }> {
  const byTable: Record<string, number> = {};
  let total = 0;
  for (const { table, name, ownership, references } of scopedTables()) {
    const keyed = [...ownership, ...references];
    if (!keyed.length) continue;
    const columns = getTableColumns(table);
    // Counts ANY surviving reference, ownership or otherwise: a cleared
    // `assigned_to` is gone, an uncleared one is exactly the evidence this is
    // meant to catch.
    const match =
      keyed.length === 1
        ? eq(columns[keyed[0]!]!, userId)
        : or(...keyed.map((c) => eq(columns[c]!, userId)));
    let n = 0;
    try {
      const row = await db
        .select({ n: sql<number>`count(*)` })
        .from(table)
        .where(match)
        .get();
      n = Number(row?.n ?? 0);
    } catch (error) {
      // Same reasoning as the sweep: a table this database has not got holds no
      // rows, so it cannot be evidence of a failed erasure.
      if (!isMissingTable(error)) throw error;
    }
    if (n > 0) {
      byTable[name] = n;
      total += n;
    }
  }
  const user = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  const users = Number(user?.n ?? 0);
  if (users > 0) {
    byTable[getTableName(schema.users)] = users;
    total += users;
  }
  return { total, byTable };
}
