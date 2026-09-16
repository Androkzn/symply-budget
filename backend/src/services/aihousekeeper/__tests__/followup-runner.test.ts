/**
 * followup-runner.ts — plan §B7
 *
 * Covers: fire path with notify decision dispatches push, silent_close
 * decision does not, malformed output defaults to silent_close.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AIProvider, GenerateResult } from '../../../ai/provider';
import * as schema from '../../../db/schema';
import {
  assistantFollowups,
  assistantIdentity,
} from '../../../db/schema-aihousekeeper';
import type { Env } from '../../../types';
import { ApprovalQueueShim } from '../../ai/approval-queue-shim';
import type { SendGridClient } from '../../integrations/sendgrid';
import { AihousekeeperEventBus } from '../event-bus';
import type { ExpoPushClient } from '../expo-push';
import { FollowupRunner } from '../followup-runner';
import { MemoryService } from '../memory-service';
import { OutboundDispatcher } from '../outbound-dispatcher';

import {
  createAihousekeeperTables,
  createCoreTables,
  createMemoryFtsTable,
  resetAllTables,
} from './test-helpers';

const testEnv = env as unknown as Env;
const HID = 'hh_fu_01';

function notifyToolUse(): GenerateResult {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'tu_notify',
        name: 'notify_user',
        input: { message: 'Still waiting on that quote?', rationale: 'user-requested followup' },
      },
    ],
    model: 'm',
    stopReason: 'tool_use',
  } as unknown as GenerateResult;
}

function silentToolUse(): GenerateResult {
  return {
    content: [
      { type: 'tool_use', id: 'tu_silent', name: 'silent_close', input: { reason: 'already_handled' } },
    ],
    model: 'm',
    stopReason: 'tool_use',
  } as unknown as GenerateResult;
}

function malformed(): GenerateResult {
  return {
    content: [{ type: 'text', text: 'no tool call here' }],
    model: 'm',
    stopReason: 'end_turn',
  } as unknown as GenerateResult;
}

async function seed() {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await createMemoryFtsTable(testEnv.DB);
  await resetAllTables(testEnv.DB);
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.households).values({ id: HID, name: 'FU Test' });
  await db.insert(assistantIdentity).values({
    household_id: HID,
    timezone: 'UTC',
    briefing_time: '07:00',
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    daily_interrupt_budget: 10,
    channels_enabled_json:
      '{"push":true,"sms":false,"email_weekly":false,"watch":true}',
  });
  await testEnv.CONFIG_KV.put('aihousekeeper_enabled', 'true');
  await testEnv.CONFIG_KV.put('aihousekeeper_outbound_loop_enabled', 'true');
  await testEnv.CONFIG_KV.put('aihousekeeper_conservative_mode', 'false');
  await testEnv.CONFIG_KV.put('aihousekeeper_memory_ai_redaction_enabled', 'false');
}

function mkSupportingServices(aiGenerate: AIProvider['generate']) {
  const db = drizzle(testEnv.DB, { schema });
  const ai = {
    generate: aiGenerate,
    generateStructured: vi.fn(async () => ({})),
  } as unknown as AIProvider;
  const events = new AihousekeeperEventBus();
  const memory = new MemoryService({
    db,
    d1: testEnv.DB,
    ai,
    events,
    env: testEnv,
  });
  const pushMock = vi.fn(async () => [{ status: 'ok' as const, id: 'ticket-1' }]);
  const expoPush = { sendBatch: pushMock } as unknown as ExpoPushClient;
  const dispatcher = new OutboundDispatcher({
    db,
    env: testEnv,
    events,
    expoPush,
    sendgrid: {
      sendHtml: vi.fn(async () => ({ messageId: 'mid' })),
    } as unknown as SendGridClient,
  });
  return { db, ai, events, memory, dispatcher, pushMock };
}

describe('FollowupRunner.runDue', () => {
  beforeEach(async () => {
    await seed();
  });

  it('fires notify decision — dispatches push and marks followup fired', async () => {
    const { db, ai, events, memory, dispatcher, pushMock } = mkSupportingServices(
      vi.fn(async () => notifyToolUse())
    );
    await db.insert(assistantFollowups).values({
      id: 'fu_notify_01',
      household_id: HID,
      scheduled_for: new Date('2025-06-01T09:00:00Z').toISOString(),
      prompt: 'Check on quote from Acme.',
      origin: 'self_scheduled',
      status: 'pending',
    });
    const runner = new FollowupRunner({
      db,
      env: testEnv,
      ai,
      memory,
      dispatcher,
      events,
      approvals: new ApprovalQueueShim(testEnv.DB),
      resolvePushRecipient: async () => ({
        memberId: 'm-owner',
        expoToken: 'ExponentPushToken[x]',
      }),
    });
    const res = await runner.runDue(new Date('2025-06-01T14:00:00Z'));
    expect(res.fired).toBe(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
    const fired = await db
      .select()
      .from(assistantFollowups)
      .where(eq(assistantFollowups.id, 'fu_notify_01'))
      .get();
    expect(fired?.status).toBe('fired');
  });

  it('silent_close decision does NOT dispatch a push', async () => {
    const { db, ai, events, memory, dispatcher, pushMock } = mkSupportingServices(
      vi.fn(async () => silentToolUse())
    );
    await db.insert(assistantFollowups).values({
      id: 'fu_silent_01',
      household_id: HID,
      scheduled_for: new Date('2025-06-01T09:00:00Z').toISOString(),
      prompt: 'p',
      origin: 'self_scheduled',
      status: 'pending',
    });
    const runner = new FollowupRunner({
      db,
      env: testEnv,
      ai,
      memory,
      dispatcher,
      events,
      approvals: new ApprovalQueueShim(testEnv.DB),
      resolvePushRecipient: async () => ({
        memberId: 'm',
        expoToken: 'ExponentPushToken[x]',
      }),
    });
    await runner.runDue(new Date('2025-06-01T14:00:00Z'));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('malformed output retries once and defaults to silent_close', async () => {
    const generateSpy = vi.fn(async () => malformed());
    const { db, ai, events, memory, dispatcher, pushMock } = mkSupportingServices(generateSpy);
    await db.insert(assistantFollowups).values({
      id: 'fu_malformed_01',
      household_id: HID,
      scheduled_for: new Date('2025-06-01T09:00:00Z').toISOString(),
      prompt: 'p',
      origin: 'self_scheduled',
      status: 'pending',
    });
    const runner = new FollowupRunner({
      db,
      env: testEnv,
      ai,
      memory,
      dispatcher,
      events,
      approvals: new ApprovalQueueShim(testEnv.DB),
      resolvePushRecipient: async () => ({
        memberId: 'm',
        expoToken: 'ExponentPushToken[x]',
      }),
    });
    await runner.runDue(new Date('2025-06-01T14:00:00Z'));
    // Retry once — expect exactly 2 ai.generate calls.
    expect(generateSpy).toHaveBeenCalledTimes(2);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
