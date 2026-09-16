/**
 * Aihousekeeper outbound dispatcher — plan §B4.
 *
 * Single chokepoint for every outbound Aihousekeeper message (push, email).
 * Enforces the ordered gate from §B4 (aihousekeeper_disabled, channel_killed,
 * conservative_mode, channel_disabled, quiet_hours, budget_exhausted, duplicate).
 * Writes an assistant_outbound_log row for every outcome (allow or deny).
 *
 * Server-side SMS (Twilio) was removed — the `sms` channel enum value remains
 * for historical outbound_log rows but canSend always denies it.
 *
 * Followup kind + quiet-hours deny: re-schedules the followup to
 * quiet_hours_end + 5min rather than silently dropping.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';

import { assistantFollowups, assistantIdentity, assistantOutboundLog } from '../../db/schema-aihousekeeper';
import type {
  NewAssistantOutboundLogEntry,
} from '../../db/schema-aihousekeeper';
import type { Database, Env } from '../../types';
import { generateId } from '../../utils/id';
import type { SendGridClient } from '../integrations/sendgrid';

import { AihousekeeperEventBus, sha256Hex } from './event-bus';
import type { CanSendDenyReason, Channel } from './event-bus';
import type { ExpoPushClient } from './expo-push';
import { isInQuietHours, localTimeToUtc, startOfDayLocalUtc } from './timezone';

export type Severity = 1 | 2 | 3 | 4 | 5;
export type DispatchKind = 'briefing' | 'nudge' | 'followup' | 'digest';

interface CanSendInput {
  householdId: string;
  channel: Channel;
  severity: Severity;
  now: Date;
  kind?: DispatchKind;
  toMemberId?: string;
  idempotencyKey?: string;
}

export type CanSendResult =
  | { allow: true }
  | { allow: false; reason: CanSendDenyReason };

export interface DispatchResultSent {
  status: 'sent';
  externalMessageId: string;
}
export interface DispatchResultSkipped {
  status: 'skipped';
  reason: CanSendDenyReason | 'empty' | 'kill_switch';
}
export type DispatchResult = DispatchResultSent | DispatchResultSkipped;

export interface PushInput {
  householdId: string;
  toMemberId?: string;
  toExpoToken: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  template: string;
  severity: Severity;
  kind?: DispatchKind;
  idempotencyKey: string;
  composedByModel?: string;
  promptVersion?: string;
  triggerRef?: Record<string, unknown>;
  now?: Date;
}

export interface EmailInput {
  householdId: string;
  toMemberId?: string;
  toEmail: string;
  subject: string;
  html: string;
  template: string;
  severity: Severity;
  kind?: DispatchKind;
  idempotencyKey: string;
  composedByModel?: string;
  promptVersion?: string;
  triggerRef?: Record<string, unknown>;
  now?: Date;
}

interface IdentityChannels {
  push: boolean;
  sms: boolean;
  email_weekly: boolean;
  watch: boolean;
}

export class OutboundDispatcher {
  private db: Database;
  private env: Env;
  private events: AihousekeeperEventBus;
  private expoPush: ExpoPushClient;
  private sendgrid: SendGridClient;

  constructor(params: {
    db: Database;
    env: Env;
    events: AihousekeeperEventBus;
    expoPush: ExpoPushClient;
    sendgrid: SendGridClient;
  }) {
    this.db = params.db;
    this.env = params.env;
    this.events = params.events;
    this.expoPush = params.expoPush;
    this.sendgrid = params.sendgrid;
  }

  /**
   * Ordered, fail-closed gating. See §B4 table for full semantics.
   */
  async canSend(input: CanSendInput): Promise<CanSendResult> {
    // Server-side SMS removed — deny before any other checks.
    if (input.channel === 'sms') {
      return { allow: false, reason: 'channel_killed' };
    }

    // 1. Global kill — always wins, including severity=5.
    const globalEnabled = await this.env.CONFIG_KV.get('aihousekeeper_enabled');
    if (globalEnabled !== null && globalEnabled !== 'true') {
      return { allow: false, reason: 'aihousekeeper_disabled' };
    }

    // 2. Per-channel kill switches.
    const channelKillKey = this.channelKillKey(input.channel);
    if (channelKillKey) {
      const channelEnabled = await this.env.CONFIG_KV.get(channelKillKey);
      if (channelEnabled !== null && channelEnabled !== 'true') {
        return { allow: false, reason: 'channel_killed' };
      }
    }

    // 3. Conservative mode (severity<5 denied; severity=5 passes).
    const conservative = await this.env.CONFIG_KV.get('aihousekeeper_conservative_mode');
    if (conservative === 'true' && input.severity < 5) {
      return { allow: false, reason: 'conservative_mode' };
    }

    // Load identity once for checks 4, 5, 6.
    const identity = await this.db
      .select()
      .from(assistantIdentity)
      .where(eq(assistantIdentity.household_id, input.householdId))
      .get();
    if (!identity) {
      return { allow: false, reason: 'aihousekeeper_disabled' };
    }
    const channels = this.parseChannels(identity.channels_enabled_json);

    // 4. Per-household channel disabled.
    if (!this.isChannelEnabled(channels, input.channel)) {
      return { allow: false, reason: 'channel_disabled' };
    }

    // 5. Household quiet hours (severity=5 bypasses unless kind='followup').
    const inHouseholdQuiet = isInQuietHours(
      input.now,
      identity.timezone || 'UTC',
      identity.quiet_hours_start,
      identity.quiet_hours_end
    );
    if (inHouseholdQuiet) {
      if (input.kind === 'followup') {
        return { allow: false, reason: 'quiet_hours' };
      }
      if (input.severity < 5) {
        return { allow: false, reason: 'quiet_hours' };
      }
    }

    // 6. Daily budget (severity=5 bypasses).
    if (input.severity < 5) {
      const startOfDay = startOfDayLocalUtc(input.now, identity.timezone || 'UTC');
      const sentToday = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(assistantOutboundLog)
        .where(
          and(
            eq(assistantOutboundLog.household_id, input.householdId),
            eq(assistantOutboundLog.status, 'sent'),
            gte(assistantOutboundLog.created_at, startOfDay.toISOString())
          )
        )
        .get();
      const used = sentToday?.count ?? 0;
      if (used >= identity.daily_interrupt_budget) {
        return { allow: false, reason: 'budget_exhausted' };
      }
    }

    // 7. Idempotency (last 24h).
    if (input.idempotencyKey) {
      const twentyFourHoursAgo = new Date(
        input.now.getTime() - 24 * 3600 * 1000
      ).toISOString();
      const dup = await this.db
        .select({ id: assistantOutboundLog.id })
        .from(assistantOutboundLog)
        .where(
          and(
            eq(assistantOutboundLog.household_id, input.householdId),
            eq(assistantOutboundLog.idempotency_key, input.idempotencyKey),
            // Only an actually-SENT message dedupes. A transient push failure logs
            // a 'failed' row (and a quiet-hours defer logs a 'skipped' row) under
            // the same key — without this filter those non-deliveries would block
            // every retry for 24h, silently dropping the notification.
            eq(assistantOutboundLog.status, 'sent'),
            gte(assistantOutboundLog.created_at, twentyFourHoursAgo)
          )
        )
        .orderBy(desc(assistantOutboundLog.created_at))
        .limit(1)
        .get();
      if (dup) {
        return { allow: false, reason: 'duplicate' };
      }
    }

    return { allow: true };
  }

  async sendPush(input: PushInput): Promise<DispatchResult> {
    const now = input.now ?? new Date();
    const gate = await this.canSend({
      householdId: input.householdId,
      channel: 'push',
      severity: input.severity,
      now,
      kind: input.kind,
      toMemberId: input.toMemberId,
      idempotencyKey: input.idempotencyKey,
    });
    if (!gate.allow) {
      await this.handleFollowupDeferral(input, gate.reason, now);
      await this.logSkipped({
        householdId: input.householdId,
        channel: 'push',
        toMemberId: input.toMemberId,
        template: input.template,
        body: input.body,
        idempotencyKey: input.idempotencyKey,
        composedByModel: input.composedByModel,
        promptVersion: input.promptVersion,
        triggerRef: input.triggerRef,
        reason: gate.reason,
      });
      await this.emitSkipped(input.householdId, 'push', gate.reason, input.idempotencyKey);
      return { status: 'skipped', reason: gate.reason };
    }

    try {
      const tickets = await this.expoPush.sendBatch([
        {
          to: input.toExpoToken,
          title: input.title,
          body: input.body,
          data: input.data,
          sound: 'default',
        },
      ]);
      const ticket = tickets[0];
      const externalId: string =
        ticket && ticket.status === 'ok' && typeof ticket.id === 'string'
          ? ticket.id
          : '';
      await this.logSent({
        householdId: input.householdId,
        channel: 'push',
        toMemberId: input.toMemberId,
        template: input.template,
        body: input.body,
        externalMessageId: externalId,
        idempotencyKey: input.idempotencyKey,
        composedByModel: input.composedByModel,
        promptVersion: input.promptVersion,
        triggerRef: input.triggerRef,
      });
      await this.emitSent(
        input.householdId,
        'push',
        input.template,
        input.idempotencyKey
      );
      return { status: 'sent', externalMessageId: externalId };
    } catch (err) {
      console.error('[OutboundDispatcher] push failed', {
        householdIdPrefix: input.householdId.slice(0, 8),
        template: input.template,
        error: (err as Error).message,
      });
      await this.logStatus({
        householdId: input.householdId,
        channel: 'push',
        toMemberId: input.toMemberId,
        template: input.template,
        body: input.body,
        status: 'failed',
        idempotencyKey: input.idempotencyKey,
        composedByModel: input.composedByModel,
        promptVersion: input.promptVersion,
        triggerRef: input.triggerRef,
      });
      throw err;
    }
  }

  async sendEmail(input: EmailInput): Promise<DispatchResult> {
    const now = input.now ?? new Date();
    const gate = await this.canSend({
      householdId: input.householdId,
      channel: 'email',
      severity: input.severity,
      now,
      kind: input.kind,
      toMemberId: input.toMemberId,
      idempotencyKey: input.idempotencyKey,
    });
    if (!gate.allow) {
      await this.logSkipped({
        householdId: input.householdId,
        channel: 'email',
        toMemberId: input.toMemberId,
        template: input.template,
        body: input.html,
        idempotencyKey: input.idempotencyKey,
        composedByModel: input.composedByModel,
        promptVersion: input.promptVersion,
        triggerRef: input.triggerRef,
        reason: gate.reason,
      });
      await this.emitSkipped(input.householdId, 'email', gate.reason, input.idempotencyKey);
      return { status: 'skipped', reason: gate.reason };
    }

    const result = await this.sendgrid.sendHtml({
      to: input.toEmail,
      from: this.env.SENDGRID_FROM_EMAIL,
      subject: input.subject,
      html: input.html,
    });
    await this.logSent({
      householdId: input.householdId,
      channel: 'email',
      toMemberId: input.toMemberId,
      template: input.template,
      body: input.html,
      externalMessageId: result.messageId,
      idempotencyKey: input.idempotencyKey,
      composedByModel: input.composedByModel,
      promptVersion: input.promptVersion,
      triggerRef: input.triggerRef,
    });
    await this.emitSent(input.householdId, 'email', input.template, input.idempotencyKey);
    return { status: 'sent', externalMessageId: result.messageId };
  }

  private channelKillKey(channel: Channel): string | null {
    switch (channel) {
      case 'email':
        return 'aihousekeeper_email_digest_enabled';
      case 'push':
      case 'watch':
        return 'aihousekeeper_outbound_loop_enabled';
      default:
        return null;
    }
  }

  private parseChannels(json: string): IdentityChannels {
    try {
      const parsed = JSON.parse(json) as Partial<IdentityChannels>;
      return {
        push: Boolean(parsed.push ?? true),
        sms: Boolean(parsed.sms ?? false),
        email_weekly: Boolean(parsed.email_weekly ?? false),
        watch: Boolean(parsed.watch ?? true),
      };
    } catch {
      return { push: true, sms: false, email_weekly: false, watch: true };
    }
  }

  private isChannelEnabled(channels: IdentityChannels, channel: Channel): boolean {
    switch (channel) {
      case 'push':
        return channels.push;
      case 'sms':
        return false;
      case 'email':
        return channels.email_weekly;
      case 'watch':
        return channels.watch;
      default:
        return false;
    }
  }

  private async handleFollowupDeferral(
    input: { householdId: string; kind?: DispatchKind; triggerRef?: Record<string, unknown> },
    reason: CanSendDenyReason,
    now: Date
  ): Promise<void> {
    if (input.kind !== 'followup') return;
    if (reason !== 'quiet_hours') return;
    const followupId = (input.triggerRef?.followupId as string | undefined) ?? undefined;
    if (!followupId) return;
    const identity = await this.db
      .select({
        quiet_hours_end: assistantIdentity.quiet_hours_end,
        timezone: assistantIdentity.timezone,
      })
      .from(assistantIdentity)
      .where(eq(assistantIdentity.household_id, input.householdId))
      .get();
    if (!identity) return;
    const nextScheduled = this.computeQuietHoursEndPlus5(
      now,
      identity.timezone || 'UTC',
      identity.quiet_hours_end
    );
    await this.db
      .update(assistantFollowups)
      // Reset status to 'pending' — runOne marked it 'fired' before dispatch, and
      // FollowupRunner.runDue / the followup_due trigger only re-select 'pending'
      // rows. Without this the deferred nudge is orphaned and never re-fires.
      .set({ status: 'pending', scheduled_for: nextScheduled, updated_at: now.toISOString() })
      .where(eq(assistantFollowups.id, followupId));
  }

  private computeQuietHoursEndPlus5(now: Date, tz: string, endHhmm: string): string {
    const [h, m] = endHhmm.split(':').map((v) => parseInt(v, 10));
    // quiet_hours_end is a LOCAL wall-clock time; convert (local date, h, m+5) in
    // `tz` to the correct UTC instant. Building it with Date.UTC directly treated
    // the local time as UTC and rescheduled hours too early — still inside quiet
    // hours — so the nudge just kept re-deferring.
    let candidate = localTimeToUtc(now, tz, h || 0, (m || 0) + 5);
    if (candidate.getTime() <= now.getTime()) {
      // Past today's quiet-hours-end already → target tomorrow's local date.
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      candidate = localTimeToUtc(tomorrow, tz, h || 0, (m || 0) + 5);
    }
    return candidate.toISOString();
  }

  private async logSent(params: {
    householdId: string;
    channel: Channel;
    toMemberId?: string;
    template: string;
    body: string;
    externalMessageId: string;
    idempotencyKey: string;
    composedByModel?: string;
    promptVersion?: string;
    triggerRef?: Record<string, unknown>;
  }): Promise<void> {
    await this.insertLog({ ...params, status: 'sent' });
  }

  private async logSkipped(params: {
    householdId: string;
    channel: Channel;
    toMemberId?: string;
    template: string;
    body: string;
    idempotencyKey: string;
    composedByModel?: string;
    promptVersion?: string;
    triggerRef?: Record<string, unknown>;
    reason: CanSendDenyReason;
  }): Promise<void> {
    const status = this.mapDenyToStatus(params.reason);
    await this.insertLog({ ...params, status });
  }

  private async logStatus(params: {
    householdId: string;
    channel: Channel;
    toMemberId?: string;
    template: string;
    body: string;
    status: string;
    idempotencyKey: string;
    composedByModel?: string;
    promptVersion?: string;
    triggerRef?: Record<string, unknown>;
  }): Promise<void> {
    await this.insertLog(params);
  }

  private async insertLog(params: {
    householdId: string;
    channel: Channel;
    toMemberId?: string;
    template: string;
    body: string;
    status: string;
    externalMessageId?: string;
    idempotencyKey?: string;
    composedByModel?: string;
    promptVersion?: string;
    triggerRef?: Record<string, unknown>;
  }): Promise<void> {
    const row: NewAssistantOutboundLogEntry = {
      id: generateId(),
      household_id: params.householdId,
      channel: params.channel,
      to_member_id: params.toMemberId,
      template: params.template,
      body: params.body,
      external_message_id: params.externalMessageId,
      idempotency_key: params.idempotencyKey,
      status: params.status,
      trigger_ref_json: params.triggerRef ? JSON.stringify(params.triggerRef) : undefined,
      composed_by_model: params.composedByModel,
      prompt_version: params.promptVersion,
    };
    await this.db.insert(assistantOutboundLog).values(row);
  }

  private mapDenyToStatus(reason: CanSendDenyReason): string {
    switch (reason) {
      case 'aihousekeeper_disabled':
        return 'skipped_aihousekeeper_disabled';
      case 'channel_killed':
        return 'skipped_channel_killed';
      case 'conservative_mode':
        return 'skipped_conservative_mode';
      case 'channel_disabled':
        return 'skipped_channel_disabled';
      case 'tcpa_quiet_hours':
        return 'skipped_tcpa_quiet_hours';
      case 'quiet_hours':
        return 'skipped_quiet_hours';
      case 'budget_exhausted':
        return 'skipped_budget';
      case 'duplicate':
        return 'skipped_duplicate';
      default:
        return 'skipped_other';
    }
  }

  private async emitSent(
    householdId: string,
    channel: Channel,
    template: string,
    idempotencyKey: string
  ): Promise<void> {
    const eventIdem = await sha256Hex(
      `outbound_sent:${householdId}:${channel}:${idempotencyKey}`
    );
    await this.events.emit({
      kind: 'outbound_sent',
      householdId,
      eventIdempotencyKey: eventIdem,
      channel,
      template,
      idempotencyKey,
    });
  }

  private async emitSkipped(
    householdId: string,
    channel: Channel,
    reason: CanSendDenyReason,
    idempotencyKey?: string
  ): Promise<void> {
    const eventIdem = await sha256Hex(
      `outbound_skipped:${householdId}:${channel}:${reason}:${idempotencyKey ?? ''}`
    );
    await this.events.emit({
      kind: 'outbound_skipped',
      householdId,
      eventIdempotencyKey: eventIdem,
      channel,
      reason,
    });
  }
}
