/**
 * BUDGET-HH-026 / BUDGET-HH-028 — invite + remove household members (happy path).
 */
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../db/schema';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { HouseholdService } from '../household-service';

const testEnv = env as unknown as Env;
const db = drizzle(testEnv.DB, { schema });

const HID = 'hh_invite_test';
const OWNER = 'u_owner';
const MEMBER = 'u_member';
const INVITEE = 'invitee@example.com';

async function createInvitationTable(): Promise<void> {
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS household_invitations (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, invited_by TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, accepted_at TEXT, declined_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`
  );
}

async function seed(): Promise<void> {
  const ts = new Date().toISOString();
  await db.insert(schema.users).values([
    { id: OWNER, email: 'owner@example.com', display_name: 'Owner', created_at: ts, updated_at: ts },
    { id: MEMBER, email: 'member@example.com', display_name: 'Member', created_at: ts, updated_at: ts },
  ] as never);
  await db.insert(schema.households).values({
    id: HID,
    name: 'Invite House',
    created_at: ts,
    updated_at: ts,
  } as never);
  await db.insert(schema.householdMembers).values([
    { id: 'm_owner', household_id: HID, user_id: OWNER, role: 'owner', joined_at: ts },
    { id: 'm_member', household_id: HID, user_id: MEMBER, role: 'member', joined_at: ts },
  ] as never);
}

function service(): HouseholdService {
  return new HouseholdService(testEnv, testEnv.DB);
}

beforeEach(async () => {
  await resetAllTables(testEnv.DB);
  await createCoreTables(testEnv.DB);
  await createInvitationTable();
  await seed();
});

describe('HouseholdService invite + remove', () => {
  it('inviteMember creates a pending invitation for a new email', async () => {
    const result = await service().inviteMember(HID, OWNER, {
      email: INVITEE,
      role: 'member',
    });
    expect(result.token).toBeTruthy();
    expect(result.invitation_id).toBeTruthy();

    const invitations = await service().getInvitations(HID, OWNER);
    expect(invitations.some((i) => i.email === INVITEE.toLowerCase())).toBe(true);
  });

  it('removeMember soft-deletes a member from the household', async () => {
    await service().removeMember(HID, MEMBER, OWNER);

    const rows = await db
      .select()
      .from(schema.householdMembers)
      .where(eq(schema.householdMembers.user_id, MEMBER))
      .all();
    expect(rows[0]?.deleted_at).toBeTruthy();
  });
});
