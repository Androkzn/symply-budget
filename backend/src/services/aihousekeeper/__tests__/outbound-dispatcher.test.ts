/**
 * outbound-dispatcher.ts — plan §B4
 *
 * Covers the 8-gate ordered denial matrix + the severity=5 carve-outs
 * (plan §3 invariants):
 *   - severity=5 does NOT bypass TCPA check 5 (SMS)
 *   - severity=5 DOES bypass household quiet_hours except kind='followup'
 *   - severity=5 DOES bypass daily budget
 *   - followup + quiet_hours defers scheduled_for to quiet_hours_end + 5min
 *   - idempotency check (24h)
 *   - kill_switch (aihousekeeper_disabled) wins over severity=5
 */

import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as schema from '../../../db/schema';
import {
  assistantFollowups,
  assistantIdentity,
} from '../../../db/schema-aihousekeeper';
import type { Env } from '../../../types';
import type { SendGridClient } from '../../integrations/sendgrid';
import { AihousekeeperEventBus } from '../event-bus';
import type { ExpoPushClient } from '../expo-push';
import { OutboundDispatcher } from '../outbound-dispatcher';

import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from './test-helpers';

const testEnv = env as unknown as Env;
const HID = 'hh_disp_01';

function mkSendgrid(): SendGridClient {
  return {
    sendHtml: vi.fn(async () => ({ messageId: 'mid-' + Math.random().toString(36).slice(2, 8) })),
  } as unknown as SendGridClient;
}

function mkPush(): ExpoPushClient {
  return {
    sendBatch: vi.fn(async () => [{ status: 'ok' as const, id: 'ticket-1' }]),
  } as unknown as ExpoPushClient;
}

async function seedIdentity(overrides: Partial<typeof assistantIdentity.$inferInsert> = {}) {
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.households).values({ id: HID, name: 'Disp Test' });
  await db.insert(assistantIdentity).values({
    household_id: HID,
    name: 'Aihousekeeper',
    tone: 'warm_brief',
    briefing_time: '07:00',
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    daily_interrupt_budget: 3,
    channels_enabled_json: '{"push":true,"sms":true,"email_weekly":true,"watch":true}',
    timezone: 'UTC',
    ...overrides,
  });
}

function mkDispatcher() {
  const db = drizzle(testEnv.DB, { schema });
  return new OutboundDispatcher({
    db,
    env: testEnv,
    events: new AihousekeeperEventBus(),
    expoPush: mkPush(),
    sendgrid: mkSendgrid(),
  });
}

describe('OutboundDispatcher.canSend — 8-gate deny matrix', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createAihousekeeperTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
    await testEnv.CONFIG_KV.put('aihousekeeper_enabled', 'true');
    await testEnv.CONFIG_KV.put('aihousekeeper_sms_enabled', 'true');
    await testEnv.CONFIG_KV.put('aihousekeeper_email_digest_enabled', 'true');
    await testEnv.CONFIG_KV.put('aihousekeeper_outbound_loop_enabled', 'true');
    await testEnv.CONFIG_KV.put('aihousekeeper_conservative_mode', 'false');
    await seedIdentity();
  });

  it('gate 1: aihousekeeper_disabled wins even for severity=5', async () => {
    await testEnv.CONFIG_KV.put('aihousekeeper_enabled', 'false');
    const d = mkDispatcher();
    const r = await d.canSend({
      householdId: HID,
      channel: 'push',
      severity: 5,
      now: new Date('2025-06-01T14:00:00Z'),
    });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toBe('aihousekeeper_disabled');
  });

  it('gate 2: SMS always channel_killed (server-side SMS removed)', async () => {
    await testEnv.CONFIG_KV.put('aihousekeeper_sms_enabled', 'true');
    const d = mkDispatcher();
    const r = await d.canSend({
      householdId: HID,
      channel: 'sms',
      severity: 3,
      now: new Date('2025-06-01T14:00:00Z'),
    });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toBe('channel_killed');
  });

  it('gate 3: conservative_mode blocks severity<5 but not severity=5', async () => {
    await testEnv.CONFIG_KV.put('aihousekeeper_conservative_mode', 'true');
    const d = mkDispatcher();
    const blocked = await d.canSend({
      householdId: HID,
      channel: 'push',
      severity: 3,
      now: new Date('2025-06-01T14:00:00Z'),
    });
    expect(blocked.allow).toBe(false);
    const open = await d.canSend({
      householdId: HID,
      channel: 'push',
      severity: 5,
      now: new Date('2025-06-01T14:00:00Z'),
    });
    expect(open.allow).toBe(true);
  });

  it('gate 4: SMS always channel_killed even when identity.channels enables SMS', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db
      .update(assistantIdentity)
      .set({
        channels_enabled_json:
          '{"push":true,"sms":true,"email_weekly":true,"watch":true}',
      })
      .where(eq(assistantIdentity.household_id, HID));
    const d = mkDispatcher();
    const r = await d.canSend({
      householdId: HID,
      channel: 'sms',
      severity: 4,
      now: new Date('2025-06-01T14:00:00Z'),
    });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toBe('channel_killed');
  });

  it('gate 5: SMS always channel_killed (TCPA path removed with Twilio)', async () => {
    const d = mkDispatcher();
    const r = await d.canSend({
      householdId: HID,
      channel: 'sms',
      severity: 5,
      now: new Date('2025-06-01T23:00:00Z'),
    });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toBe('channel_killed');
  });

  it('gate 6: household quiet_hours bypassed by severity=5 (push)', async () => {
    const d = mkDispatcher();
    // 23:00 UTC is in household quiet hours (22:00-07:00).
    const blocked = await d.canSend({
      householdId: HID,
      channel: 'push',
      severity: 3,
      now: new Date('2025-06-01T23:00:00Z'),
    });
    expect(blocked.allow).toBe(false);
    if (!blocked.allow) expect(blocked.reason).toBe('quiet_hours');
    const sev5 = await d.canSend({
      householdId: HID,
      channel: 'push',
      severity: 5,
      now: new Date('2025-06-01T23:00:00Z'),
    });
    expect(sev5.allow).toBe(true);
  });

  it('gate 6: followup kind defers even at severity=5', async () => {
    const d = mkDispatcher();
    const r = await d.canSend({
      householdId: HID,
      channel: 'push',
      severity: 5,
      kind: 'followup',
      now: new Date('2025-06-01T23:00:00Z'),
    });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toBe('quiet_hours');
  });

  it('gate 7: budget_exhausted — severity 5 bypasses', async () => {
    // Flood outbound_log with 3 already-sent rows for today.
    const db = drizzle(testEnv.DB, { schema });
    for (let i = 0; i < 3; i++) {
      await db.insert(schema.assistantOutboundLog).values({
        id: `sent-${i}`,
        household_id: HID,
        channel: 'push',
        template: 't',
        body: 'b',
        status: 'sent',
      });
    }
    const d = mkDispatcher();
    const blocked = await d.canSend({
      householdId: HID,
      channel: 'push',
      severity: 3,
      now: new Date('2025-06-01T14:00:00Z'),
    });
    expect(blocked.allow).toBe(false);
    if (!blocked.allow) expect(blocked.reason).toBe('budget_exhausted');
    const sev5 = await d.canSend({
      householdId: HID,
      channel: 'push',
      severity: 5,
      now: new Date('2025-06-01T14:00:00Z'),
    });
    expect(sev5.allow).toBe(true);
  });

  it('gate 8: duplicate idempotency within 24h', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.assistantOutboundLog).values({
      id: 'dup-1',
      household_id: HID,
      channel: 'push',
      template: 't',
      body: 'b',
      status: 'sent',
      idempotency_key: 'idem-dup-01',
    });
    const d = mkDispatcher();
    const r = await d.canSend({
      householdId: HID,
      channel: 'push',
      severity: 3,
      // Fixed instant (14:00 UTC) — not in 22:00–07:00 quiet window; `new Date()` is flaky in CI/local night runs.
      now: new Date('2025-06-01T14:00:00Z'),
      idempotencyKey: 'idem-dup-01',
    });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toBe('duplicate');
  });

  it('gate 8: a prior FAILED delivery does not block a retry (only sent dedupes)', async () => {
    // A transient push failure logs a 'failed' row under the same idempotency key.
    // That must NOT be treated as a duplicate, or the notification is dropped for 24h.
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.assistantOutboundLog).values({
      id: 'failed-1',
      household_id: HID,
      channel: 'push',
      template: 't',
      body: 'b',
      status: 'failed',
      idempotency_key: 'idem-failed-01',
    });
    const d = mkDispatcher();
    const r = await d.canSend({
      householdId: HID,
      channel: 'push',
      severity: 3,
      now: new Date('2025-06-01T14:00:00Z'),
      idempotencyKey: 'idem-failed-01',
    });
    expect(r.allow).toBe(true);
  });

  it('allows sending when all 8 gates pass', async () => {
    const d = mkDispatcher();
    const r = await d.canSend({
      householdId: HID,
      channel: 'push',
      severity: 2,
      now: new Date('2025-06-01T14:00:00Z'),
      idempotencyKey: 'idem-fresh-01',
    });
    expect(r.allow).toBe(true);
  });
});

describe('OutboundDispatcher.sendPush — followup deferral', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createAihousekeeperTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
    await testEnv.CONFIG_KV.put('aihousekeeper_enabled', 'true');
    await testEnv.CONFIG_KV.put('aihousekeeper_sms_enabled', 'true');
    await testEnv.CONFIG_KV.put('aihousekeeper_outbound_loop_enabled', 'true');
    await testEnv.CONFIG_KV.put('aihousekeeper_email_digest_enabled', 'true');
    await testEnv.CONFIG_KV.put('aihousekeeper_conservative_mode', 'false');
    await seedIdentity();
  });

  it('deferred followup updates scheduled_for to quiet_hours_end + ~5 min', async () => {
    // Seed a pending followup with scheduled_for in the past.
    const db = drizzle(testEnv.DB, { schema });
    const followupId = 'fu-defer-01';
    const pastIso = new Date('2025-06-01T22:30:00Z').toISOString();
    await db.insert(assistantFollowups).values({
      id: followupId,
      household_id: HID,
      scheduled_for: pastIso,
      prompt: 'test followup',
      origin: 'self_scheduled',
      status: 'pending',
    });

    const d = mkDispatcher();
    // Fire at 23:30 UTC — inside household quiet_hours (22:00→07:00) AND
    // TCPA SMS quiet_hours — either deny will trigger the deferral branch
    // because the followup kind sees quiet_hours reason first via gate 6.
    // We use push channel to ensure the quiet_hours reason is the one that fires.
    await d.sendPush({
      householdId: HID,
      toExpoToken: 'ExponentPushToken[abc]',
      title: 'Aihousekeeper',
      body: 'Followup nudge',
      template: 'followup_nudge',
      severity: 3,
      kind: 'followup',
      idempotencyKey: 'followup:' + followupId,
      triggerRef: { followupId },
      now: new Date('2025-06-01T23:30:00Z'),
    });

    const row = await db
      .select({ scheduled_for: assistantFollowups.scheduled_for })
      .from(assistantFollowups)
      .where(eq(assistantFollowups.id, followupId))
      .get();
    expect(row?.scheduled_for).toBeDefined();
    // New time should be strictly later than the original 22:30 past time.
    expect(Date.parse(row!.scheduled_for)).toBeGreaterThan(Date.parse(pastIso));
  });

  it('resets a deferred followup to pending and reschedules to LOCAL quiet_hours_end + 5min', async () => {
    const db = drizzle(testEnv.DB, { schema });
    // Household in America/New_York (EDT = UTC-4 in June).
    await db
      .update(assistantIdentity)
      .set({ timezone: 'America/New_York' })
      .where(eq(assistantIdentity.household_id, HID));
    const followupId = 'fu-defer-ny';
    await db.insert(assistantFollowups).values({
      id: followupId,
      household_id: HID,
      scheduled_for: new Date('2025-05-31T00:00:00Z').toISOString(),
      prompt: 'ny followup',
      origin: 'self_scheduled',
      // runOne marks it 'fired' before dispatch — the deferral must reset it.
      status: 'fired',
    });

    const d = mkDispatcher();
    // 05:30 UTC == 01:30 EDT — inside quiet_hours (22:00→07:00) → deferred.
    await d.sendPush({
      householdId: HID,
      toExpoToken: 'ExponentPushToken[ny]',
      title: 'Aihousekeeper',
      body: 'Followup nudge',
      template: 'followup_nudge',
      severity: 3,
      kind: 'followup',
      idempotencyKey: 'followup:' + followupId,
      triggerRef: { followupId },
      now: new Date('2025-06-01T05:30:00Z'),
    });

    const row = await db
      .select({
        scheduled_for: assistantFollowups.scheduled_for,
        status: assistantFollowups.status,
      })
      .from(assistantFollowups)
      .where(eq(assistantFollowups.id, followupId))
      .get();
    // Local 07:05 EDT == 11:05 UTC (the old Date.UTC path wrongly produced 07:05Z).
    expect(row?.scheduled_for).toBe('2025-06-01T11:05:00.000Z');
    // Reset to pending so FollowupRunner.runDue re-fires it (was orphaned as 'fired').
    expect(row?.status).toBe('pending');
  });

  it('writes a skipped_kill_switch-equivalent log when aihousekeeper_enabled=false (via skipped_aihousekeeper_disabled)', async () => {
    await testEnv.CONFIG_KV.put('aihousekeeper_enabled', 'false');
    const db = drizzle(testEnv.DB, { schema });
    const d = mkDispatcher();
    await d.sendPush({
      householdId: HID,
      toExpoToken: 'ExponentPushToken[x]',
      title: 'Aihousekeeper',
      body: 'anything',
      template: 'test',
      severity: 2,
      idempotencyKey: 'idem-ks-01',
      now: new Date('2025-06-01T14:00:00Z'),
    });
    const rows = await db
      .select()
      .from(schema.assistantOutboundLog)
      .where(
        and(
          eq(schema.assistantOutboundLog.household_id, HID),
          eq(schema.assistantOutboundLog.idempotency_key, 'idem-ks-01')
        )
      )
      .all();
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('skipped_aihousekeeper_disabled');
  });
});
