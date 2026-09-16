/**
 * followup_due trigger — plan §D6
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../../../db/schema';
import { assistantFollowups } from '../../../../db/schema-aihousekeeper';
import type { Env } from '../../../../types';
import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from '../../__tests__/test-helpers';
import { followupDueTrigger } from '../followup-due';

const testEnv = env as unknown as Env;
const HID = 'hh_fd_01';

async function seed() {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.households).values({ id: HID, name: 'FD' });
  await testEnv.CONFIG_KV.delete(`aihousekeeper:trigger-guard:${HID}:followup_due`);
}

describe('followupDueTrigger', () => {
  beforeEach(async () => {
    await seed();
  });

  it('fires when a pending followup is due', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(assistantFollowups).values({
      id: 'fu_due_01',
      household_id: HID,
      scheduled_for: new Date('2025-01-01T00:00:00Z').toISOString(),
      prompt: 'Check contractor quote.',
      origin: 'user_requested',
      status: 'pending',
    });
    const result = await followupDueTrigger.evaluate(
      testEnv,
      HID,
      new Date('2026-04-23T12:00:00Z')
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result.severity).toBe(3);
      expect(result.kind).toBe('followup');
    }
  });

  it('does not fire when followups are all fired/cancelled', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(assistantFollowups).values({
      id: 'fu_done_01',
      household_id: HID,
      scheduled_for: new Date('2025-01-01T00:00:00Z').toISOString(),
      prompt: 'p',
      origin: 'user_requested',
      status: 'fired',
    });
    const result = await followupDueTrigger.evaluate(
      testEnv,
      HID,
      new Date('2026-04-23T12:00:00Z')
    );
    expect(result).toBeNull();
  });
});
