/**
 * Account deletion detaches the user from every household — owner or member.
 */
import { env } from 'cloudflare:test';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../db/schema';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { AuthService } from '../auth-service';
import { detachUserFromAllHouseholds } from '../household-detach';

const testEnv = env as unknown as Env;
const db = drizzle(testEnv.DB, { schema });

const TS = '2026-01-01T00:00:00.000Z';

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

async function addUser(id: string): Promise<void> {
  await db
    .insert(schema.users)
    .values({ id, email: `${id}@example.com`, created_at: TS, updated_at: TS } as never);
}

async function addHousehold(id: string): Promise<void> {
  await db
    .insert(schema.households)
    .values({ id, name: id, created_at: TS, updated_at: TS } as never);
}

async function addMember(
  householdId: string,
  userId: string,
  role: 'owner' | 'member',
  joinedAt = TS
): Promise<void> {
  await db.insert(schema.householdMembers).values({
    id: `m_${householdId}_${userId}`,
    household_id: householdId,
    user_id: userId,
    role,
    joined_at: joinedAt,
  } as never);
}

function activeMembers(householdId: string) {
  return db
    .select()
    .from(schema.householdMembers)
    .where(
      and(
        eq(schema.householdMembers.household_id, householdId),
        isNull(schema.householdMembers.deleted_at)
      )
    )
    .all();
}

beforeEach(async () => {
  await resetAllTables(testEnv.DB);
  await createCoreTables(testEnv.DB);
  await createJoinRequestTable();
  await createRefreshTokenTable();
});

describe('detachUserFromAllHouseholds', () => {
  it('detaches the user from every household, as member and as owner alike', async () => {
    await addUser('u_gone');
    await addUser('u_other');
    await addHousehold('hh_owned');
    await addHousehold('hh_joined');
    await addMember('hh_owned', 'u_gone', 'owner');
    await addMember('hh_owned', 'u_other', 'member');
    await addMember('hh_joined', 'u_other', 'owner');
    await addMember('hh_joined', 'u_gone', 'member');

    const summary = await detachUserFromAllHouseholds(db, 'u_gone');

    expect(summary.detachedHouseholdIds.sort()).toEqual(['hh_joined', 'hh_owned']);
    const stillIn = await db
      .select()
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.user_id, 'u_gone'),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .all();
    expect(stillIn).toHaveLength(0);
  });

  it('promotes the longest-tenured remaining member when the last owner is deleted', async () => {
    await addUser('u_owner');
    await addUser('u_early');
    await addUser('u_late');
    await addHousehold('hh');
    await addMember('hh', 'u_owner', 'owner');
    await addMember('hh', 'u_late', 'member', '2026-03-01T00:00:00.000Z');
    await addMember('hh', 'u_early', 'member', '2026-02-01T00:00:00.000Z');

    const summary = await detachUserFromAllHouseholds(db, 'u_owner');

    expect(summary.promotedOwners).toEqual([{ householdId: 'hh', userId: 'u_early' }]);
    const members = await activeMembers('hh');
    expect(members.find((m) => m.user_id === 'u_early')?.role).toBe('owner');
    expect(members.find((m) => m.user_id === 'u_late')?.role).toBe('member');
  });

  it('leaves the roles alone when another owner remains', async () => {
    await addUser('u_gone');
    await addUser('u_coowner');
    await addUser('u_member');
    await addHousehold('hh');
    await addMember('hh', 'u_gone', 'owner');
    await addMember('hh', 'u_coowner', 'owner');
    await addMember('hh', 'u_member', 'member');

    const summary = await detachUserFromAllHouseholds(db, 'u_gone');

    expect(summary.promotedOwners).toEqual([]);
    const members = await activeMembers('hh');
    expect(members.find((m) => m.user_id === 'u_member')?.role).toBe('member');
  });

  it('soft-deletes a household left with no members at all', async () => {
    await addUser('u_solo');
    await addHousehold('hh_solo');
    await addMember('hh_solo', 'u_solo', 'owner');

    const summary = await detachUserFromAllHouseholds(db, 'u_solo');

    expect(summary.emptiedHouseholdIds).toEqual(['hh_solo']);
    const household = await db
      .select()
      .from(schema.households)
      .where(eq(schema.households.id, 'hh_solo'))
      .get();
    expect(household?.deleted_at).toBeTruthy();
  });

  it('withdraws the pending join requests the deleted user had open', async () => {
    await addUser('u_gone');
    await addHousehold('hh');
    await db.insert(schema.householdJoinRequests).values({
      id: 'jr_pending',
      household_id: 'hh',
      user_id: 'u_gone',
      status: 'pending',
      requested_at: TS,
    } as never);

    const summary = await detachUserFromAllHouseholds(db, 'u_gone');

    expect(summary.withdrawnJoinRequests).toBe(1);
    const request = await db
      .select()
      .from(schema.householdJoinRequests)
      .where(eq(schema.householdJoinRequests.id, 'jr_pending'))
      .get();
    expect(request?.status).toBe('denied');
    expect(request?.decided_at).toBeTruthy();
  });

  it('is idempotent', async () => {
    await addUser('u_gone');
    await addUser('u_other');
    await addHousehold('hh');
    await addMember('hh', 'u_gone', 'owner');
    await addMember('hh', 'u_other', 'member');

    await detachUserFromAllHouseholds(db, 'u_gone');
    const second = await detachUserFromAllHouseholds(db, 'u_gone');

    expect(second.detachedHouseholdIds).toEqual([]);
    expect(second.promotedOwners).toEqual([]);
    const members = await activeMembers('hh');
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe('owner');
  });
});

describe('AuthService.deleteAccount', () => {
  it('removes the account from its households', async () => {
    await addUser('u_gone');
    await addUser('u_other');
    await addHousehold('hh');
    await addMember('hh', 'u_gone', 'owner');
    await addMember('hh', 'u_other', 'member');

    await new AuthService(testEnv, testEnv.DB).deleteAccount('u_gone');

    // This used to assert `deleted_at` was stamped. `deleteAccount` is a HARD
    // delete now — the row is gone, not tombstoned — because the tombstone kept
    // the account's email permanently taken (production 2026-09-04: `409
    // Conflict` on every re-signup with an address whose credentials were
    // already revoked). See `account-hard-delete.ts`.
    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, 'u_gone'))
      .get();
    expect(user).toBeUndefined();

    const members = await activeMembers('hh');
    expect(members.map((m) => m.user_id)).toEqual(['u_other']);
    expect(members[0]?.role).toBe('owner');
  });
});
