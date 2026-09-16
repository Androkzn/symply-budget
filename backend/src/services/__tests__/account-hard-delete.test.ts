/**
 * Account deletion must leave ZERO records.
 *
 * The soft delete this replaces was not merely incomplete, it was actively
 * harmful: stamping `users.deleted_at` left every row the person wrote in place
 * AND kept their email permanently taken, because the sign-up uniqueness check
 * does not exclude soft-deleted rows. Production, 2026-09-04: the same address
 * answered `409 Conflict` on every retry while its credentials were already
 * revoked — the account could neither be signed into nor recreated.
 *
 * So the assertions here are deliberately about ABSENCE, and the last one is
 * the one that matters: the email must be free afterwards. A sweep that deletes
 * a lot of rows but leaves the `users` tombstone would satisfy every other test
 * in this file and still reproduce the bug.
 */
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../db/schema';
import type { Env } from '../../types';
import { countRemainingUserRows, hardDeleteUser } from '../account-hard-delete';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';

const testEnv = env as unknown as Env;
const db = drizzle(testEnv.DB, { schema });

const TS = '2026-01-01T00:00:00.000Z';

/**
 * `detachUserFromAllHouseholds` withdraws pending join requests, and
 * `createCoreTables` does not create that table. Same fixture as
 * `household-detach.test.ts` — without it the sweep fails before it starts.
 */
async function createJoinRequestTable(): Promise<void> {
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS household_join_requests (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, invite_link_id TEXT, user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', requested_at TEXT NOT NULL DEFAULT (datetime('now')), decided_by TEXT, decided_at TEXT)`
  );
}

async function createRefreshTokenTable(): Promise<void> {
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS refresh_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`
  );
}

async function addUser(id: string, email = `${id}@example.com`): Promise<void> {
  await db
    .insert(schema.users)
    .values({ id, email, created_at: TS, updated_at: TS } as never);
}

async function addHousehold(id: string): Promise<void> {
  await db
    .insert(schema.households)
    .values({ id, name: id, created_at: TS, updated_at: TS } as never);
}

async function addMember(householdId: string, userId: string, role = 'owner'): Promise<void> {
  await db.insert(schema.householdMembers).values({
    id: `m_${householdId}_${userId}`,
    household_id: householdId,
    user_id: userId,
    role,
    joined_at: TS,
  } as never);
}

async function addTask(id: string, householdId: string, userId: string): Promise<void> {
  await db.insert(schema.tasks).values({
    id,
    household_id: householdId,
    user_id: userId,
    title: id,
    frequency: 'once',
    created_at: TS,
    updated_at: TS,
  } as never);
}

beforeEach(async () => {
  await resetAllTables(testEnv.DB);
  await createCoreTables(testEnv.DB);
  await createJoinRequestTable();
  await createRefreshTokenTable();
});

describe('hardDeleteUser — a solo account', () => {
  it('leaves no trace of the user anywhere', async () => {
    await addUser('u1');
    await addHousehold('h1');
    await addMember('h1', 'u1');
    await addTask('t1', 'h1', 'u1');

    await hardDeleteUser(db, 'u1');

    const remaining = await countRemainingUserRows(db, 'u1');
    expect(remaining.byTable).toEqual({});
    expect(remaining.total).toBe(0);
  });

  it('frees the email — the symptom that exposed the soft delete', async () => {
    // The regression guard. Everything else can pass while this fails, and this
    // is the one a member actually hits.
    await addUser('u1', 'taken@example.com');
    await addHousehold('h1');
    await addMember('h1', 'u1');

    await hardDeleteUser(db, 'u1');

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'taken@example.com'))
      .all();
    expect(rows).toHaveLength(0);

    // And the address can genuinely be claimed again.
    await addUser('u2', 'taken@example.com');
    const reclaimed = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'taken@example.com'))
      .all();
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]!.id).toBe('u2');
  });

  it('erases the home it was the last member of', async () => {
    await addUser('u1');
    await addHousehold('h1');
    await addMember('h1', 'u1');
    await addTask('t1', 'h1', 'u1');

    const summary = await hardDeleteUser(db, 'u1');

    expect(summary.erasedHouseholdIds).toContain('h1');
    const households = await db.select().from(schema.households).all();
    expect(households).toHaveLength(0);
    const tasks = await db.select().from(schema.tasks).all();
    expect(tasks).toHaveLength(0);
  });
});

describe('hardDeleteUser — a SHARED home is not collateral', () => {
  it('keeps the home and the other member’s data', async () => {
    // The line this must not cross. Erasing a shared home would destroy data
    // belonging to somebody who did not ask to be deleted.
    await addUser('leaver');
    await addUser('stayer');
    await addHousehold('h1');
    await addMember('h1', 'leaver', 'owner');
    await addMember('h1', 'stayer', 'member');
    await addTask('mine', 'h1', 'leaver');
    await addTask('theirs', 'h1', 'stayer');

    const summary = await hardDeleteUser(db, 'leaver');

    expect(summary.erasedHouseholdIds).not.toContain('h1');

    const households = await db.select().from(schema.households).all();
    expect(households.map(h => h.id)).toEqual(['h1']);

    // BOTH tasks survive. `assigned_to` says who should DO a task, not who owns
    // it — the home still exists and still needs the work done. Deleting a task
    // out of a shared home to erase a foreign key would destroy the remaining
    // member's data, which account deletion has no right to touch.
    const tasks = await db.select().from(schema.tasks).all();
    expect(tasks.map(t => t.id).sort()).toEqual(['mine', 'theirs']);

    // What must NOT survive is the pointer at the deleted person: the task is
    // unassigned, so nothing in the home records that they ever existed.
    const orphaned = tasks.find(t => t.id === 'mine');
    expect(orphaned?.assigned_to).toBeNull();
  });

  it('still removes the leaver entirely', async () => {
    await addUser('leaver');
    await addUser('stayer');
    await addHousehold('h1');
    await addMember('h1', 'leaver', 'owner');
    await addMember('h1', 'stayer', 'member');

    await hardDeleteUser(db, 'leaver');

    const remaining = await countRemainingUserRows(db, 'leaver');
    expect(remaining.total).toBe(0);
    // …while the other member is untouched.
    const stayer = await db.select().from(schema.users).where(eq(schema.users.id, 'stayer')).all();
    expect(stayer).toHaveLength(1);
  });
});

describe('hardDeleteUser — operational properties', () => {
  it('is idempotent: a retried request does not throw', async () => {
    // The caller is an HTTP handler. A client that retries on a dropped
    // response must not get a 500 for asking twice.
    await addUser('u1');
    await addHousehold('h1');
    await addMember('h1', 'u1');

    await hardDeleteUser(db, 'u1');
    const second = await hardDeleteUser(db, 'u1');

    expect(second.totalRows).toBe(0);
    expect(second.erasedHouseholdIds).toEqual([]);
  });

  it('deletes refresh tokens outright rather than marking them revoked', async () => {
    await addUser('u1');
    await testEnv.DB.exec(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES ('r1','u1','h','${TS}','${TS}')`
    );

    await hardDeleteUser(db, 'u1');

    const rows = await testEnv.DB.prepare(
      `SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = 'u1'`
    ).first<{ n: number }>();
    expect(Number(rows?.n ?? 0)).toBe(0);
  });

  it('survives a schema table this database has not got', async () => {
    // The sweep is driven by the schema, which describes tables a given
    // environment may not have migrated yet. That must not abort the run and
    // leave an account half-erased — the account below still has to disappear.
    await addUser('u1');
    await addHousehold('h1');
    await addMember('h1', 'u1');

    await expect(hardDeleteUser(db, 'u1')).resolves.toBeDefined();

    const remaining = await countRemainingUserRows(db, 'u1');
    expect(remaining.total).toBe(0);
  });
});

/**
 * Files must die with the rows that name them.
 *
 * This is the half that cannot be recovered from if it is skipped. Once the row
 * holding `original_file_key` is deleted, NOTHING in the database points at that
 * object any more — it sits in the bucket permanently, invisible to every later
 * audit, because the only thing that could have found it is the row that was
 * just removed. Hence the ordering assertion below: keys are collected while the
 * rows still exist, not after.
 */
interface FakeBucket {
  objects: Map<string, string>;
  deleted: string[];
  list(options?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }>;
  delete(key: string): Promise<void>;
}

function fakeBucket(keys: string[]): FakeBucket {
  const objects = new Map(keys.map(k => [k, 'x']));
  return {
    objects,
    deleted: [],
    async list(options) {
      const prefix = options?.prefix ?? '';
      return {
        objects: [...objects.keys()]
          .filter(k => k.startsWith(prefix))
          .map(key => ({ key })),
      };
    },
    async delete(key: string) {
      this.deleted.push(key);
      objects.delete(key);
    },
  };
}

async function addFloorPlan(id: string, householdId: string, fileKey: string): Promise<void> {
  await testEnv.DB.exec(
    `INSERT INTO floor_plans (id, household_id, original_file_key, display_image_key, filename, file_size, content_type, building_name) VALUES ('${id}','${householdId}','${fileKey}','${fileKey}-display','${id}.png',1,'image/png','Main')`
  );
}

describe('hardDeleteUser — R2 objects', () => {
  it('deletes the files named by rows in an erased home', async () => {
    await addUser('u1');
    await addHousehold('h1');
    await addMember('h1', 'u1');
    await addFloorPlan('fp1', 'h1', 'plans/h1/fp1');
    const bucket = fakeBucket(['plans/h1/fp1', 'plans/h1/fp1-display', 'plans/other/keep']);

    const summary = await hardDeleteUser(db, 'u1', bucket as unknown as R2Bucket);

    expect(summary.r2ObjectsDeleted).toBe(2);
    expect(bucket.deleted.sort()).toEqual(['plans/h1/fp1', 'plans/h1/fp1-display']);
    // Somebody else's object is untouched.
    expect(bucket.objects.has('plans/other/keep')).toBe(true);
  });

  it('deletes the avatar, which no row names', async () => {
    // The avatar key embeds the user id instead of being stored in a column, so
    // the row sweep alone would never find it.
    await addUser('u1');
    await addHousehold('h1');
    await addMember('h1', 'u1');
    const bucket = fakeBucket(['avatars/u1-123.jpg', 'avatars/someone-else-9.jpg']);

    await hardDeleteUser(db, 'u1', bucket as unknown as R2Bucket);

    expect(bucket.deleted).toEqual(['avatars/u1-123.jpg']);
    expect(bucket.objects.has('avatars/someone-else-9.jpg')).toBe(true);
  });

  it('reports null rather than zero when no bucket was supplied', async () => {
    // `0` would read as "there were no files". `null` says "nobody looked",
    // which is the honest answer and the one that shows up in a review.
    await addUser('u1');
    await addHousehold('h1');
    await addMember('h1', 'u1');
    await addFloorPlan('fp1', 'h1', 'plans/h1/fp1');

    const summary = await hardDeleteUser(db, 'u1');

    expect(summary.r2ObjectsDeleted).toBeNull();
  });

  it('still erases the account when the bucket cannot be listed', async () => {
    // A bucket outage must not strand a half-deleted account.
    await addUser('u1');
    await addHousehold('h1');
    await addMember('h1', 'u1');
    const broken = {
      async list() {
        throw new Error('R2 unavailable');
      },
      async delete() {
        throw new Error('R2 unavailable');
      },
    };

    await expect(
      hardDeleteUser(db, 'u1', broken as unknown as R2Bucket)
    ).resolves.toBeDefined();
    const remaining = await countRemainingUserRows(db, 'u1');
    expect(remaining.total).toBe(0);
  });
});
