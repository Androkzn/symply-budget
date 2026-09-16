/**
 * outbound-loop.ts — plan §F2
 *
 * Covers: producer idempotent enqueue gated by kill switch, and consumer
 * mid-batch kill-switch retry.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as schema from '../../../db/schema';
import { assistantIdentity } from '../../../db/schema-aihousekeeper';
import type { AihousekeeperOutboundMessage, Env } from '../../../types';
import {
  enqueueOutboundLoop,
  handleOutboundMessage,
} from '../outbound-loop';

import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from './test-helpers';

const testEnv = env as unknown as Env;

async function seedHousehold(hid: string) {
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.households).values({ id: hid, name: `h ${hid}` });
  await db.insert(assistantIdentity).values({
    household_id: hid,
    timezone: 'UTC',
  });
}

function mkMessage(hid: string) {
  const msg = {
    body: { householdId: hid, enqueuedAt: Date.now() } as AihousekeeperOutboundMessage,
    ack: vi.fn(),
    retry: vi.fn(),
  };
  return msg;
}

describe('enqueueOutboundLoop (producer)', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createAihousekeeperTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
  });

  it('no-ops when aihousekeeper_outbound_loop_enabled is not "true"', async () => {
    await testEnv.CONFIG_KV.put('aihousekeeper_outbound_loop_enabled', 'false');
    const sendBatch = vi.fn(async () => undefined);
    const envOverride = {
      ...testEnv,
      AIHOUSEKEEPER_OUTBOUND_QUEUE: { sendBatch } as unknown as Env['AIHOUSEKEEPER_OUTBOUND_QUEUE'],
    } as Env;
    await enqueueOutboundLoop(envOverride);
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('enqueues one message per eligible household when enabled', async () => {
    await testEnv.CONFIG_KV.put('aihousekeeper_outbound_loop_enabled', 'true');
    await seedHousehold('hh_loop_a');
    await seedHousehold('hh_loop_b');
    const sendBatch = vi.fn(async () => undefined);
    const envOverride = {
      ...testEnv,
      AIHOUSEKEEPER_OUTBOUND_QUEUE: { sendBatch } as unknown as Env['AIHOUSEKEEPER_OUTBOUND_QUEUE'],
    } as Env;
    await enqueueOutboundLoop(envOverride);
    expect(sendBatch).toHaveBeenCalledTimes(1);
    const calls = sendBatch.mock.calls as unknown as Array<[Array<{ body: AihousekeeperOutboundMessage }>]>;
    const arg = calls[0][0];
    expect(arg.length).toBe(2);
    const ids = arg.map((m) => m.body.householdId).sort();
    expect(ids).toEqual(['hh_loop_a', 'hh_loop_b']);
  });
});

describe('handleOutboundMessage (consumer)', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createAihousekeeperTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
  });

  it('retries (does NOT ack) when kill switch flips mid-batch', async () => {
    await testEnv.CONFIG_KV.put('aihousekeeper_outbound_loop_enabled', 'false');
    const msg = mkMessage('hh_mid_flip');
    await handleOutboundMessage(
      testEnv,
      msg as unknown as Message<AihousekeeperOutboundMessage>
    );
    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
  });
});
