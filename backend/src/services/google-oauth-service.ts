import { and, eq, isNull } from 'drizzle-orm';

import { householdMembers } from '../db/schema';
import { googleCalendarTokens } from '../db/schema-aihousekeeper';
import { NotFoundError } from '../utils/errors';

import { createDb } from './db';

export async function findHouseholdMemberId(
  d1: D1Database,
  householdId: string,
  userId: string
): Promise<string> {
  const db = createDb(d1);
  const member = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.household_id, householdId),
        eq(householdMembers.user_id, userId),
        isNull(householdMembers.deleted_at)
      )
    )
    .get();
  if (!member) {
    throw new NotFoundError('Household member');
  }
  return member.id;
}

export async function findMemberByIdAndUser(
  d1: D1Database,
  memberId: string,
  userId: string
): Promise<{ id: string }> {
  const db = createDb(d1);
  const member = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.id, memberId),
        eq(householdMembers.user_id, userId),
        isNull(householdMembers.deleted_at)
      )
    )
    .get();
  if (!member) {
    throw new NotFoundError('Household member');
  }
  return member;
}

export async function upsertGoogleCalendarTokens(
  d1: D1Database,
  memberId: string,
  tokens: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    scope: string;
  }
): Promise<void> {
  const db = createDb(d1);
  await db
    .insert(googleCalendarTokens)
    .values({
      member_id: memberId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at,
      scope: tokens.scope,
    })
    .onConflictDoUpdate({
      target: googleCalendarTokens.member_id,
      set: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        scope: tokens.scope,
      },
    });
}

export async function getGoogleOAuthStatus(
  d1: D1Database,
  householdId: string,
  userId: string
): Promise<{ connected: boolean; linked_at: string | null }> {
  const db = createDb(d1);
  const row = await db
    .select({
      member_id: householdMembers.id,
      scope: googleCalendarTokens.scope,
      created_at: googleCalendarTokens.created_at,
    })
    .from(householdMembers)
    .leftJoin(googleCalendarTokens, eq(googleCalendarTokens.member_id, householdMembers.id))
    .where(
      and(
        eq(householdMembers.household_id, householdId),
        eq(householdMembers.user_id, userId),
        isNull(householdMembers.deleted_at)
      )
    )
    .get();

  if (!row) {
    throw new NotFoundError('Household member');
  }

  return {
    connected: Boolean(row.scope),
    linked_at: row.created_at ?? null,
  };
}

export async function deleteGoogleCalendarTokens(
  d1: D1Database,
  householdId: string,
  userId: string
): Promise<void> {
  const memberId = await findHouseholdMemberId(d1, householdId, userId);
  const db = createDb(d1);
  await db.delete(googleCalendarTokens).where(eq(googleCalendarTokens.member_id, memberId)).run();
}
