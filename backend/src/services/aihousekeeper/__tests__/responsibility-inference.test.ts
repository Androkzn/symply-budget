/**
 * responsibility-inference.ts — plan §B9
 *
 * Covers the "≥3 tasks in 30d, not already a responsibility, not declined"
 * flow. Each inferred candidate should produce one `preference` memory.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AIProvider } from '../../../ai/provider';
import * as schema from '../../../db/schema';
import type { Env } from '../../../types';
import { AihousekeeperEventBus } from '../event-bus';
import { MemoryService } from '../memory-service';
import { ResponsibilityInferenceRunner } from '../responsibility-inference';

import {
  createAihousekeeperTables,
  createCoreTables,
  createMemoryFtsTable,
  resetAllTables,
} from './test-helpers';

const testEnv = env as unknown as Env;
const HID = 'hh_ri_01';

async function seedBase() {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await createMemoryFtsTable(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await testEnv.CONFIG_KV.put('aihousekeeper_memory_ai_redaction_enabled', 'false');
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.households).values({ id: HID, name: 'RI Test' });
}

async function seedUserMember(id: string, userId: string, responsibilities: string[] = []) {
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    email_verified: true,
  });
  await db.insert(schema.householdMembers).values({
    id,
    household_id: HID,
    user_id: userId,
    role: 'member',
    joined_at: new Date().toISOString(),
    responsibilities_json: JSON.stringify(responsibilities),
  });
}

async function seedTasks(count: number, opts: { assignedTo: string; category: string; completedAt: string }) {
  const db = drizzle(testEnv.DB, { schema });
  for (let i = 0; i < count; i++) {
    await db.insert(schema.tasks).values({
      id: `t_${opts.category}_${i}`,
      household_id: HID,
      title: `${opts.category} task ${i}`,
      frequency: 'monthly',
      system_category: opts.category,
      assigned_to: opts.assignedTo,
      last_completed_at: opts.completedAt,
      is_active: true,
    });
  }
}

function mkMemory(): MemoryService {
  const db = drizzle(testEnv.DB, { schema });
  const ai = {
    generate: vi.fn(async () => ({ content: [], model: 'm', stopReason: 'end_turn' })),
    generateStructured: vi.fn(async () => {
      throw new Error('no-op');
    }),
  } as unknown as AIProvider;
  return new MemoryService({
    db,
    d1: testEnv.DB,
    ai,
    events: new AihousekeeperEventBus(),
    env: testEnv,
  });
}

describe('ResponsibilityInferenceRunner', () => {
  beforeEach(async () => {
    await seedBase();
  });

  it('writes a preference memory when ≥3 recent tasks match a missing category', async () => {
    await seedUserMember('m_1', 'u_1', []);
    await seedTasks(3, {
      assignedTo: 'u_1',
      category: 'hvac',
      completedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    const db = drizzle(testEnv.DB, { schema });
    const runner = new ResponsibilityInferenceRunner({ db, memory: mkMemory() });
    const res = await runner.runFor(HID);
    expect(res.length).toBe(1);
    expect(res[0].category).toBe('hvac');
    expect(res[0].completedCount).toBeGreaterThanOrEqual(3);
  });

  it('skips when the category is already a declared responsibility', async () => {
    await seedUserMember('m_2', 'u_2', ['hvac']);
    await seedTasks(4, {
      assignedTo: 'u_2',
      category: 'hvac',
      completedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    const db = drizzle(testEnv.DB, { schema });
    const runner = new ResponsibilityInferenceRunner({ db, memory: mkMemory() });
    const res = await runner.runFor(HID);
    expect(res.length).toBe(0);
  });

  it('skips when fewer than 3 recent tasks match', async () => {
    await seedUserMember('m_3', 'u_3', []);
    await seedTasks(2, {
      assignedTo: 'u_3',
      category: 'plumbing',
      completedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    const db = drizzle(testEnv.DB, { schema });
    const runner = new ResponsibilityInferenceRunner({ db, memory: mkMemory() });
    const res = await runner.runFor(HID);
    expect(res.length).toBe(0);
  });
});
