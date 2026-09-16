/**
 * task_overdue_critical trigger — plan §D3
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../../../db/schema';
import type { Env } from '../../../../types';
import {
  createCoreTables,
  resetAllTables,
} from '../../__tests__/test-helpers';
import { taskOverdueCriticalTrigger } from '../task-overdue-critical';

const testEnv = env as unknown as Env;
const HID = 'hh_toc_01';

async function seed() {
  await createCoreTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.households).values({ id: HID, name: 'TOC' });
  await testEnv.CONFIG_KV.delete(`aihousekeeper:trigger-guard:${HID}:task_overdue_critical`);
}

describe('taskOverdueCriticalTrigger', () => {
  beforeEach(async () => {
    await seed();
  });

  it('fires when overdue critical task exists', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.tasks).values({
      id: 't1',
      household_id: HID,
      title: 'Replace smoke detector battery',
      frequency: 'yearly',
      is_active: true,
      priority_severity: 'critical',
      next_due_date: new Date('2025-01-01T00:00:00Z').toISOString(),
    });
    const result = await taskOverdueCriticalTrigger.evaluate(
      testEnv,
      HID,
      new Date('2026-04-23T12:00:00Z')
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result.severity).toBe(4);
      const payload = result.payload as { overdueCount: number };
      expect(payload.overdueCount).toBeGreaterThan(0);
    }
  });

  it('does not fire when no critical overdue tasks', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.tasks).values({
      id: 't_low',
      household_id: HID,
      title: 'low prio',
      frequency: 'yearly',
      is_active: true,
      priority_severity: 'low',
      next_due_date: new Date('2025-01-01T00:00:00Z').toISOString(),
    });
    const result = await taskOverdueCriticalTrigger.evaluate(
      testEnv,
      HID,
      new Date('2026-04-23T12:00:00Z')
    );
    expect(result).toBeNull();
  });

  it('snoozed tasks are skipped', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.tasks).values({
      id: 't_snoozed',
      household_id: HID,
      title: 'snoozed critical',
      frequency: 'yearly',
      is_active: true,
      priority_severity: 'critical',
      next_due_date: new Date('2025-01-01T00:00:00Z').toISOString(),
      snooze_until: new Date('2027-01-01T00:00:00Z').toISOString(),
    });
    const result = await taskOverdueCriticalTrigger.evaluate(
      testEnv,
      HID,
      new Date('2026-04-23T12:00:00Z')
    );
    expect(result).toBeNull();
  });
});
