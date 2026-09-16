/**
 * memory-prefix-builder.ts — plan §B2
 *
 * CRITICAL invariant (plan §3): rendered region3 MUST NOT contain raw PII
 * (SSN 123-45-6789 test). Cache-stability also verified: fixed memories
 * appear consistently when user message doesn't match relevant recall.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AIProvider } from '../../../../ai/provider';
import * as schema from '../../../../db/schema';
import type { Env } from '../../../../types';
import {
  createAihousekeeperTables,
  createCoreTables,
  createMemoryFtsTable,
  resetAllTables,
} from '../../../aihousekeeper/__tests__/test-helpers';
import { AihousekeeperEventBus } from '../../../aihousekeeper/event-bus';
import { MemoryService } from '../../../aihousekeeper/memory-service';
import { MemoryPrefixBuilder } from '../memory-prefix-builder';


const testEnv = env as unknown as Env;
const HID = 'hh_mpb_01';

function mkAi(): AIProvider {
  return {
    generate: vi.fn(async () => ({
      content: [],
      model: 'claude-test',
      stopReason: 'end_turn' as const,
    })),
    generateStructured: vi.fn(async () => ({
      indexes: [0],
    })),
  } as unknown as AIProvider;
}

async function seed() {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await createMemoryFtsTable(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await testEnv.CONFIG_KV.put('aihousekeeper_memory_ai_redaction_enabled', 'false');
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.households).values({ id: HID, name: 'MPB' });
}

describe('MemoryPrefixBuilder.build', () => {
  beforeEach(async () => {
    await seed();
  });

  it('rendered region3 does NOT contain raw PII — SSN 123-45-6789 is never exposed', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const ai = mkAi();
    const memory = new MemoryService({
      db,
      d1: testEnv.DB,
      ai,
      events: new AihousekeeperEventBus(),
      env: testEnv,
    });
    await memory.write({
      householdId: HID,
      type: 'fact',
      body: "Nina's SSN is 123-45-6789 and she handles HVAC.",
      source: 'user_said',
      confidence: 0.95,
    });

    const builder = new MemoryPrefixBuilder(memory, ai, testEnv);
    const { region3 } = await builder.build(HID, 'What do we know about Nina?');
    // The SSN 123-45-6789 must NOT appear in the rendered region3.
    expect(region3).not.toContain('123-45-6789');
    expect(region3).toContain('<aihousekeeper_memory>');
  });

  it('facts section is populated by top-confidence fact memories', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const ai = mkAi();
    const memory = new MemoryService({
      db,
      d1: testEnv.DB,
      ai,
      events: new AihousekeeperEventBus(),
      env: testEnv,
    });
    await memory.write({
      householdId: HID,
      type: 'fact',
      body: 'Home has a heat pump.',
      confidence: 0.9,
      source: 'user_said',
    });
    const builder = new MemoryPrefixBuilder(memory, ai, testEnv);
    const { region3, scoredCount } = await builder.build(HID, 'What about the heating?');
    expect(scoredCount).toBeGreaterThan(0);
    expect(region3).toContain('<facts>');
    expect(region3.toLowerCase()).toContain('heat pump');
  });

  it('is cache-stable: same inputs → same render when recall returns the same set', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const ai = mkAi();
    const memory = new MemoryService({
      db,
      d1: testEnv.DB,
      ai,
      events: new AihousekeeperEventBus(),
      env: testEnv,
    });
    await memory.write({
      householdId: HID,
      type: 'fact',
      body: 'Boiler serviced annually by Acme.',
      confidence: 0.9,
      source: 'user_said',
    });
    const builder = new MemoryPrefixBuilder(memory, ai, testEnv);
    const a = await builder.build(HID, 'tell me about the boiler');
    const b = await builder.build(HID, 'tell me about the boiler');
    expect(a.region3).toBe(b.region3);
  });
});
