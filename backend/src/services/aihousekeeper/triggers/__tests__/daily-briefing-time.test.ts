/**
 * daily-briefing-time trigger — plan §D2
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../../../db/schema';
import { assistantIdentity } from '../../../../db/schema-aihousekeeper';
import type { Env } from '../../../../types';
import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from '../../__tests__/test-helpers';
import { dailyBriefingTimeTrigger } from '../daily-briefing-time';

const testEnv = env as unknown as Env;
const HID = 'hh_dbt_01';

async function seed(briefingTime: string, tz: string = 'UTC') {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.households).values({ id: HID, name: 'DBT' });
  await db.insert(assistantIdentity).values({
    household_id: HID,
    briefing_time: briefingTime,
    timezone: tz,
  });
  // Clear any prior trigger guard.
  await testEnv.CONFIG_KV.delete(`aihousekeeper:trigger-guard:${HID}:daily_briefing_time`);
}

describe('dailyBriefingTimeTrigger', () => {
  beforeEach(async () => {
    await seed('07:00');
  });

  it('fires when local hour matches briefing_time', async () => {
    const now = new Date('2026-04-23T07:15:00Z');
    const result = await dailyBriefingTimeTrigger.evaluate(testEnv, HID, now);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.triggerId).toBe('daily_briefing_time');
      expect(result.severity).toBe(2);
      expect(result.kind).toBe('briefing');
    }
  });

  it('does not fire when local hour does not match', async () => {
    // Clear the guard (set during previous test's evaluate call in same file).
    await testEnv.CONFIG_KV.delete(`aihousekeeper:trigger-guard:${HID}:daily_briefing_time`);
    const now = new Date('2026-04-23T12:00:00Z'); // 12 UTC != 07
    const result = await dailyBriefingTimeTrigger.evaluate(testEnv, HID, now);
    expect(result).toBeNull();
  });

  it('the trigger guard prevents re-fires within the hour', async () => {
    // First evaluate claims the guard.
    const now = new Date('2026-04-23T07:10:00Z');
    await dailyBriefingTimeTrigger.evaluate(testEnv, HID, now);
    // Second evaluate within the same hour returns null because of the guard.
    const again = await dailyBriefingTimeTrigger.evaluate(testEnv, HID, now);
    expect(again).toBeNull();
  });
});
