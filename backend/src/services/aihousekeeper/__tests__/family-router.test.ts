/**
 * family-router.ts — plan §B8
 *
 * Covers scoring, tiebreak by joined_at (most recent wins), and owner
 * fallback when no member declared a responsibility for the category.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../../db/schema';
import type { Env } from '../../../types';
import { FamilyRouter } from '../family-router';

import { createCoreTables, resetAllTables } from './test-helpers';

const testEnv = env as unknown as Env;
const HID = 'hh_fr_01';

async function seedHouseholdWithMembers(
  members: Array<{
    id: string;
    userId: string;
    role: 'owner' | 'member';
    responsibilities: string[];
    joinedAt: string;
  }>
) {
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.households).values({ id: HID, name: 'FR Test' });
  for (const m of members) {
    await db.insert(schema.users).values({
      id: m.userId,
      email: `${m.userId}@example.com`,
      email_verified: true,
    });
    await db.insert(schema.householdMembers).values({
      id: m.id,
      household_id: HID,
      user_id: m.userId,
      role: m.role,
      joined_at: m.joinedAt,
      responsibilities_json: JSON.stringify(m.responsibilities),
    });
  }
}

describe('FamilyRouter.pickAssignee', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
  });

  it('picks the member with an exact responsibility match', async () => {
    await seedHouseholdWithMembers([
      {
        id: 'm_alice',
        userId: 'u_alice',
        role: 'owner',
        responsibilities: ['hvac', 'plumbing'],
        joinedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'm_bob',
        userId: 'u_bob',
        role: 'member',
        responsibilities: ['electrical'],
        joinedAt: '2024-02-01T00:00:00Z',
      },
    ]);
    const db = drizzle(testEnv.DB, { schema });
    const router = new FamilyRouter(db);
    const pick = await router.pickAssignee(HID, 'hvac');
    expect(pick.memberId).toBe('m_alice');
    expect(pick.reason).toContain('exact match');
  });

  it('tiebreak: on identical scores, picks the most recently joined', async () => {
    await seedHouseholdWithMembers([
      {
        id: 'm_carol',
        userId: 'u_carol',
        role: 'owner',
        responsibilities: ['hvac'],
        joinedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'm_dan',
        userId: 'u_dan',
        role: 'member',
        responsibilities: ['hvac'],
        joinedAt: '2024-06-01T00:00:00Z',
      },
    ]);
    const db = drizzle(testEnv.DB, { schema });
    const router = new FamilyRouter(db);
    const pick = await router.pickAssignee(HID, 'hvac');
    expect(pick.memberId).toBe('m_dan');
  });

  it('falls back to owner when no member matches the category', async () => {
    await seedHouseholdWithMembers([
      {
        id: 'm_owner',
        userId: 'u_owner',
        role: 'owner',
        responsibilities: ['cleaning'],
        joinedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'm_kid',
        userId: 'u_kid',
        role: 'member',
        responsibilities: ['pets'],
        joinedAt: '2024-02-01T00:00:00Z',
      },
    ]);
    const db = drizzle(testEnv.DB, { schema });
    const router = new FamilyRouter(db);
    const pick = await router.pickAssignee(HID, 'hvac');
    expect(pick.memberId).toBe('m_owner');
    expect(pick.reason).toContain('owner');
    expect(pick.confidence).toBeLessThan(0.5);
  });

  it('throws when no eligible members exist', async () => {
    // Seed only the household — no members.
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.households).values({ id: HID, name: 'empty' });
    const router = new FamilyRouter(db);
    await expect(router.pickAssignee(HID, 'hvac')).rejects.toThrow(/no eligible members/);
  });
});
