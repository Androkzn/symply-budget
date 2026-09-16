/**
 * Settings Service
 * Data access layer for settings using Drizzle ORM
 */

import { eq, and, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { settings } from '../db/schema-settings';

function getDb(d1: D1Database) {
  return drizzle(d1);
}

export async function fetchAllSettings(
  d1: D1Database,
  userId: string,
  householdId?: string
) {
  const db = getDb(d1);
  const conditions = householdId
    ? and(eq(settings.user_id, userId), eq(settings.household_id, householdId))
    : eq(settings.user_id, userId);

  return await db.select().from(settings).where(conditions);
}

export async function upsertSetting(
  d1: D1Database,
  userId: string,
  householdId: string | undefined,
  key: string,
  value: any
) {
  const db = getDb(d1);
  // Stringify value for SQLite storage
  const valueStr = typeof value === 'string' ? value : JSON.stringify(value);

  const existing = await db
    .select()
    .from(settings)
    .where(
      householdId
        ? and(
            eq(settings.user_id, userId),
            eq(settings.household_id, householdId),
            eq(settings.key, key)
          )
        : and(eq(settings.user_id, userId), eq(settings.key, key))
    )
    .get();

  if (existing) {
    return await db
      .update(settings)
      .set({
        value: valueStr,
        updated_at: sql`(datetime('now'))`,
      })
      .where(eq(settings.id, existing.id))
      .returning()
      .get();
  }

  return await db
    .insert(settings)
    .values({
      id: crypto.randomUUID(),
      user_id: userId,
      household_id: householdId,
      key,
      value: valueStr,
    })
    .returning()
    .get();
}

export async function deleteSetting(
  d1: D1Database,
  userId: string,
  householdId: string | undefined,
  key: string
) {
  const db = getDb(d1);
  const conditions = householdId
    ? and(
        eq(settings.user_id, userId),
        eq(settings.household_id, householdId),
        eq(settings.key, key)
      )
    : and(eq(settings.user_id, userId), eq(settings.key, key));

  return await db.delete(settings).where(conditions).returning().get();
}
