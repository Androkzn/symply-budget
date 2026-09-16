/**
 * digest-composer.ts — plan §B12
 *
 * Covers: composeFor produces HTML (fallback when AI throws), dispatcher
 * sendEmail invoked with severity 2 / kind 'digest'.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AIProvider } from '../../../ai/provider';
import * as schema from '../../../db/schema';
import {
  assistantBriefings,
  assistantFollowups,
  assistantIdentity,
  assistantTrustLedger,
} from '../../../db/schema-aihousekeeper';
import type { Env } from '../../../types';
import { DigestComposer } from '../digest-composer';
import type { OutboundDispatcher } from '../outbound-dispatcher';

import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from './test-helpers';

const testEnv = env as unknown as Env;
const HID = 'hh_dig_01';

async function seed() {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({
    id: 'u_owner',
    email: 'owner@example.com',
    email_verified: true,
  });
  await db.insert(schema.households).values({ id: HID, name: 'Digest Test' });
  await db.insert(schema.householdMembers).values({
    id: 'm_owner',
    household_id: HID,
    user_id: 'u_owner',
    role: 'owner',
    joined_at: '2024-01-01T00:00:00Z',
  });
  await db.insert(assistantIdentity).values({
    household_id: HID,
    timezone: 'UTC',
  });
  await db.insert(assistantBriefings).values({
    id: 'brief_01',
    household_id: HID,
    date: '2026-04-20',
    paragraph: 'Quiet Monday.',
    bullets_json: '[]',
    source_signals_json: '[]',
  });
  await db.insert(assistantTrustLedger).values({
    id: 'led_01',
    household_id: HID,
    category: 'message_sent',
    summary: 'Push sent',
    rationale: 'r',
  });
  await db.insert(assistantFollowups).values({
    id: 'fu_01',
    household_id: HID,
    scheduled_for: '2026-04-30T09:00:00Z',
    prompt: 'Check furnace',
    origin: 'self_scheduled',
    status: 'pending',
  });
}

describe('DigestComposer.composeFor', () => {
  beforeEach(async () => {
    await seed();
  });

  it('dispatches a digest email with severity 2 and kind=digest', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const ai = {
      generate: vi.fn(async () => ({
        content: [{ type: 'text', text: '<p>Your week.</p>' }],
        model: 'claude-test',
        stopReason: 'end_turn',
      })),
      generateStructured: vi.fn(async () => ({})),
    } as unknown as AIProvider;
    const sendEmail = vi.fn(async () => ({ status: 'sent' as const, externalMessageId: 'mid' }));
    const dispatcher = { sendEmail } as unknown as OutboundDispatcher;

    const composer = new DigestComposer({ db, env: testEnv, ai, dispatcher });
    const html = await composer.composeFor(HID, '2026-04-20');
    expect(html).toBeTruthy();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const calls = sendEmail.mock.calls as unknown as Array<[{ severity: number; kind: string; toEmail: string }]>;
    const arg = calls[0][0];
    expect(arg.severity).toBe(2);
    expect(arg.kind).toBe('digest');
    expect(arg.toEmail).toBe('owner@example.com');
  });

  it('falls back to "Quiet week" HTML when AI.generate throws', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const ai = {
      generate: vi.fn(async () => {
        throw new Error('ai blew up');
      }),
      generateStructured: vi.fn(async () => ({})),
    } as unknown as AIProvider;
    const sendEmail = vi.fn(async () => ({ status: 'sent' as const, externalMessageId: 'mid' }));
    const dispatcher = { sendEmail } as unknown as OutboundDispatcher;
    const composer = new DigestComposer({ db, env: testEnv, ai, dispatcher });
    const html = await composer.composeFor(HID, '2026-04-20');
    expect(html).toContain('Quiet week');
  });
});

describe('DigestComposer.runDueThisHour — timezone coverage', () => {
  beforeEach(async () => {
    await seed();
  });

  function mkComposer() {
    const db = drizzle(testEnv.DB, { schema });
    const ai = {
      generate: vi.fn(async () => ({
        content: [{ type: 'text', text: '<p>Week.</p>' }],
        model: 'claude-test',
        stopReason: 'end_turn',
      })),
      generateStructured: vi.fn(async () => ({})),
    } as unknown as AIProvider;
    const sendEmail = vi.fn(async () => ({ status: 'sent' as const, externalMessageId: 'mid' }));
    const dispatcher = { sendEmail } as unknown as OutboundDispatcher;
    return { composer: new DigestComposer({ db, env: testEnv, ai, dispatcher }), sendEmail };
  }

  it('dispatches for a household at LOCAL Sunday 18:00 even when that is not UTC Sunday 18:00', async () => {
    const db = drizzle(testEnv.DB, { schema });
    // America/Chicago (CST, UTC-6): local Sun 2026-01-18 18:00 == UTC Mon 2026-01-19 00:00.
    // The old `getUTCDay()===0 && getUTCHours()>=18` cron guard dropped this household.
    await db
      .update(assistantIdentity)
      .set({ timezone: 'America/Chicago' })
      .where(eq(assistantIdentity.household_id, HID));
    const { composer, sendEmail } = mkComposer();
    const res = await composer.runDueThisHour(new Date('2026-01-19T00:00:00Z'));
    expect(res.dispatched).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch outside the local Sunday 18:00 hour', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db
      .update(assistantIdentity)
      .set({ timezone: 'America/Chicago' })
      .where(eq(assistantIdentity.household_id, HID));
    const { composer, sendEmail } = mkComposer();
    // UTC Mon 01:00 == local Chicago Sun 19:00 → hour !== 18 → no dispatch.
    const res = await composer.runDueThisHour(new Date('2026-01-19T01:00:00Z'));
    expect(res.dispatched).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
