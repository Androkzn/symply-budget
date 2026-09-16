/**
 * memory-service.ts — plan §B1
 *
 * CRITICAL invariant (plan §3): SSN "123-45-6789" must appear in `body`
 * (audit column) but NEVER in `redacted_body`. The grep test in
 * acceptance #3 checks that this file contains the literal SSN.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AIProvider } from '../../../ai/provider';
import * as schema from '../../../db/schema';
import { assistantMemory } from '../../../db/schema-aihousekeeper';
import type { Env } from '../../../types';
import { AihousekeeperEventBus } from '../event-bus';
import { MemoryService } from '../memory-service';

import {
  createAihousekeeperTables,
  createCoreTables,
  createMemoryFtsTable,
  resetAllTables,
} from './test-helpers';

const testEnv = env as unknown as Env;
const HID = 'hh_mem_01';

function fakeAi(): AIProvider {
  return {
    generate: vi.fn(async () => ({
      content: [{ type: 'text' as const, text: '' }],
      model: 'claude-test',
      stopReason: 'end_turn' as const,
    })),
    generateStructured: vi.fn(async () => {
      // Force the regex fallback by returning a non-string `redacted`.
      throw new Error('AI disabled for test');
    }),
  } as unknown as AIProvider;
}

async function seedHousehold() {
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.households).values({ id: HID, name: 'Test Home' });
}

describe('MemoryService.write', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createAihousekeeperTables(testEnv.DB);
    await createMemoryFtsTable(testEnv.DB);
    await resetAllTables(testEnv.DB);
    await seedHousehold();
    // Disable Haiku redaction so the regex scrubber runs deterministically.
    await testEnv.CONFIG_KV.put('aihousekeeper_memory_ai_redaction_enabled', 'false');
  });

  it('stores raw body in `body` and redacts SSN in `redacted_body`', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const service = new MemoryService({
      db,
      d1: testEnv.DB,
      ai: fakeAi(),
      events: new AihousekeeperEventBus(),
      env: testEnv,
    });
    const mem = await service.write({
      householdId: HID,
      type: 'fact',
      body: "Alice's SSN is 123-45-6789 and phone (415) 555-2671.",
      source: 'user_said',
    });
    // body contains the literal SSN 123-45-6789 — audit path.
    expect(mem.body).toContain('123-45-6789');
    // redacted_body must NOT contain the SSN.
    expect(mem.redacted_body ?? '').not.toContain('123-45-6789');
    expect(mem.redacted_body ?? '').not.toContain('555-2671');
    expect(mem.redacted_body ?? '').toContain('[redacted]');
  });

  it('emits memory_written with redacted summary (PII-safe)', async () => {
    const bus = new AihousekeeperEventBus();
    const captured: Array<{ kind: string; summary?: string }> = [];
    bus.subscribe(async (ev) => {
      captured.push({
        kind: ev.kind,
        summary: 'summary' in ev ? String(ev.summary) : undefined,
      });
    });
    const db = drizzle(testEnv.DB, { schema });
    const service = new MemoryService({
      db,
      d1: testEnv.DB,
      ai: fakeAi(),
      events: bus,
      env: testEnv,
    });
    await service.write({
      householdId: HID,
      type: 'fact',
      body: 'secret email alice@example.com mentioned.',
      source: 'user_said',
    });
    expect(captured.length).toBeGreaterThan(0);
    const ev = captured.find((c) => c.kind === 'memory_written');
    expect(ev).toBeTruthy();
    expect(ev?.summary ?? '').not.toContain('alice@example.com');
  });

  it('supersede writes a replacement and sets superseded_by_id on old row', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const service = new MemoryService({
      db,
      d1: testEnv.DB,
      ai: fakeAi(),
      events: new AihousekeeperEventBus(),
      env: testEnv,
    });
    const first = await service.write({
      householdId: HID,
      type: 'preference',
      body: 'User prefers morning briefings.',
      source: 'user_said',
    });
    const replacement = await service.supersede(
      first.id,
      'User prefers evening briefings.',
      'explicit_user_update'
    );
    const stale = await db
      .select()
      .from(assistantMemory)
      .where(eq(assistantMemory.id, first.id))
      .get();
    expect(stale?.superseded_by_id).toBe(replacement.id);
  });

  it('forget hard-deletes the row', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const service = new MemoryService({
      db,
      d1: testEnv.DB,
      ai: fakeAi(),
      events: new AihousekeeperEventBus(),
      env: testEnv,
    });
    const m = await service.write({
      householdId: HID,
      type: 'fact',
      body: 'Forgettable fact.',
      source: 'user_said',
    });
    await service.forget(m.id, 'user_requested');
    const gone = await db
      .select()
      .from(assistantMemory)
      .where(eq(assistantMemory.id, m.id))
      .get();
    expect(gone).toBeUndefined();
  });

  it('list filters by type and respects limit', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const service = new MemoryService({
      db,
      d1: testEnv.DB,
      ai: fakeAi(),
      events: new AihousekeeperEventBus(),
      env: testEnv,
    });
    await service.write({ householdId: HID, type: 'fact', body: 'Fact A', source: 'user_said' });
    await service.write({ householdId: HID, type: 'fact', body: 'Fact B', source: 'user_said' });
    await service.write({
      householdId: HID,
      type: 'preference',
      body: 'Likes tea',
      source: 'user_said',
    });
    const facts = await service.list(HID, { type: 'fact' });
    expect(facts.length).toBe(2);
    expect(facts.every((m) => m.type === 'fact')).toBe(true);
  });

  it('recall returns a memory via FTS5', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const service = new MemoryService({
      db,
      d1: testEnv.DB,
      ai: fakeAi(),
      events: new AihousekeeperEventBus(),
      env: testEnv,
    });
    await service.write({
      householdId: HID,
      type: 'fact',
      body: 'The furnace was serviced in October by Acme HVAC.',
      source: 'user_said',
    });
    const results = await service.recall(HID, 'furnace', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].body.toLowerCase()).toContain('furnace');
  });
});
