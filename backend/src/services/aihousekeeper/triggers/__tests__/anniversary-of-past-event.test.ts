/**
 * anniversary_of_past_event trigger — plan §D9
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../../../db/schema';
import {
  assistantIdentity,
  assistantMemory,
} from '../../../../db/schema-aihousekeeper';
import type { Env } from '../../../../types';
import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from '../../__tests__/test-helpers';
import { anniversaryOfPastEventTrigger } from '../anniversary-of-past-event';

const testEnv = env as unknown as Env;
const HID = 'hh_ape_01';

async function seed(tz: string = 'UTC') {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.households).values({ id: HID, name: 'APE' });
  await db.insert(assistantIdentity).values({
    household_id: HID,
    timezone: tz,
  });
  await testEnv.CONFIG_KV.delete(`aihousekeeper:trigger-guard:${HID}:anniversary_of_past_event`);
}

describe('anniversaryOfPastEventTrigger', () => {
  beforeEach(async () => {
    await seed();
  });

  it('fires on the same month-day as an anniversary_tracked memory from a prior year', async () => {
    const db = drizzle(testEnv.DB, { schema });
    // Today: 2026-04-23. Anniversary created on 2024-04-23 (2 years ago).
    await db.insert(assistantMemory).values({
      id: 'mem_ann',
      household_id: HID,
      type: 'history',
      body: 'Furnace replaced',
      redacted_body: 'Furnace replaced',
      source: 'user_said',
      is_anniversary_tracked: true,
      created_at: '2024-04-23T15:00:00Z',
    });
    const now = new Date('2026-04-23T12:00:00Z');
    const result = await anniversaryOfPastEventTrigger.evaluate(testEnv, HID, now);
    expect(result).not.toBeNull();
    if (result) expect(result.severity).toBe(2);
  });

  it('does not fire on the same day (same calendar day, not a prior year)', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(assistantMemory).values({
      id: 'mem_today',
      household_id: HID,
      type: 'history',
      body: 'Today',
      redacted_body: 'Today',
      source: 'user_said',
      is_anniversary_tracked: true,
      created_at: '2026-04-23T09:00:00Z',
    });
    const now = new Date('2026-04-23T12:00:00Z');
    const result = await anniversaryOfPastEventTrigger.evaluate(testEnv, HID, now);
    expect(result).toBeNull();
  });
});
