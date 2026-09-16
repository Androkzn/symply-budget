/**
 * memory-tools.ts — plan §C1
 *
 * CRITICAL invariant (plan §3): the `recall` tool MUST NEVER return raw
 * `body`. This test asserts that even when the stored `body` contains
 * SSN 123-45-6789, the tool output only ever surfaces `redacted_body`.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AIProvider } from '../../../../../ai/provider';
import * as schema from '../../../../../db/schema';
import type { Env } from '../../../../../types';
import {
  createAihousekeeperTables,
  createCoreTables,
  createMemoryFtsTable,
  resetAllTables,
} from '../../../../aihousekeeper/__tests__/test-helpers';
import { AihousekeeperEventBus } from '../../../../aihousekeeper/event-bus';
import type { FamilyRouter } from '../../../../aihousekeeper/family-router';
import { MemoryService } from '../../../../aihousekeeper/memory-service';
import type { OutboundDispatcher } from '../../../../aihousekeeper/outbound-dispatcher';
import type { HouseholdService } from '../../../../household-service';
import { ApprovalQueueShim } from '../../../approval-queue-shim';
import type { ApprovalQueueFacade, AihousekeeperToolContext } from '../../index';
import { forget, recall, remember, updateMemory } from '../memory-tools';


const testEnv = env as unknown as Env;
const HID = 'hh_mt_01';
const UID = 'u_mt_01';

function mkAi(): AIProvider {
  return {
    generate: vi.fn(async () => ({
      content: [],
      model: 'claude-test',
      stopReason: 'end_turn' as const,
    })),
    generateStructured: vi.fn(async () => {
      throw new Error('force regex');
    }),
  } as unknown as AIProvider;
}

async function seed() {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await createMemoryFtsTable(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await testEnv.CONFIG_KV.put('aihousekeeper_memory_ai_redaction_enabled', 'false');
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({
    id: UID,
    email: 'alice@example.com',
    email_verified: true,
  });
  await db.insert(schema.households).values({ id: HID, name: 'MT Test' });
  await db.insert(schema.householdMembers).values({
    id: 'm_mt',
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
}

function mkContext(): AihousekeeperToolContext {
  const db = drizzle(testEnv.DB, { schema });
  const ai = mkAi();
  const events = new AihousekeeperEventBus();
  const memory = new MemoryService({
    db,
    d1: testEnv.DB,
    ai,
    events,
    env: testEnv,
  });
  const householdService = {
    getHousehold: vi.fn(async () => ({ id: HID })),
  } as unknown as HouseholdService;
  const approvalQueue = new ApprovalQueueShim(testEnv.DB) as unknown as ApprovalQueueFacade;
  return {
    env: testEnv,
    db,
    householdId: HID,
    userId: UID,
    householdService,
    memory,
    dispatcher: {} as unknown as OutboundDispatcher,
    familyRouter: {} as unknown as FamilyRouter,
    events,
    approvalQueue,
    integrations: {
      sendgrid: {
        sendHtml: vi.fn(async () => ({ messageId: 'x' })),
      } as never,
      googleCalendar: {} as never,
    },
  };
}

describe('memory-tools', () => {
  beforeEach(async () => {
    await seed();
  });

  it('recall PII invariant: never returns raw body; redacted_body only (SSN 123-45-6789 test)', async () => {
    const ctx = mkContext();
    // Seed via MemoryService.write so redaction runs.
    await ctx.memory.write({
      householdId: HID,
      type: 'fact',
      body: 'Alice SSN is 123-45-6789 and handles hvac.',
      source: 'user_said',
    });
    const result = (await recall.execute(ctx, {
      query: 'Alice',
      limit: 5,
    })) as { ok: true; results: Array<Record<string, unknown>> };
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result);
    // Must not expose the raw SSN anywhere in the tool output.
    expect(serialized).not.toContain('123-45-6789');
    // Must NOT carry a `body` field.
    for (const row of result.results) {
      expect(row).not.toHaveProperty('body');
      expect(row).toHaveProperty('redacted_body');
    }
  });

  it('remember returns redacted_body, not the raw input body', async () => {
    const ctx = mkContext();
    const result = (await remember.execute(ctx, {
      type: 'fact',
      body: 'Carol email carol@example.com is the hvac contractor.',
    })) as { ok: true; redacted_body: string };
    expect(result.ok).toBe(true);
    expect(result.redacted_body).not.toContain('carol@example.com');
    expect(result.redacted_body).toContain('[redacted]');
  });

  it('forget: rejects cross-household memory access', async () => {
    const ctx = mkContext();
    const db = drizzle(testEnv.DB, { schema });
    // Create a memory for a different household.
    await db.insert(schema.households).values({
      id: 'hh_other',
      name: 'Other',
    });
    const otherMemory = new MemoryService({
      db,
      d1: testEnv.DB,
      ai: mkAi(),
      events: new AihousekeeperEventBus(),
      env: testEnv,
    });
    const other = await otherMemory.write({
      householdId: 'hh_other',
      type: 'fact',
      body: 'stranger danger',
      source: 'user_said',
    });
    const result = (await forget.execute(ctx, {
      memory_id: other.id,
      reason: 'test',
    })) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe('memory_not_found');
  });

  it('update_memory returns new redacted body without leaking old PII', async () => {
    const ctx = mkContext();
    const initial = await ctx.memory.write({
      householdId: HID,
      type: 'preference',
      body: 'morning briefings',
      source: 'user_said',
    });
    const result = (await updateMemory.execute(ctx, {
      memory_id: initial.id,
      new_body: 'User prefers evening briefings; phone (415) 555-2671.',
      reason: 'user_update',
    })) as { ok: true; redacted_body: string };
    expect(result.ok).toBe(true);
    expect(result.redacted_body).not.toContain('555-2671');
  });
});
