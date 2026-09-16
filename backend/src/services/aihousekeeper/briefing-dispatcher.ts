/**
 * Aihousekeeper briefing dispatcher — plan §14 (B17).
 *
 * When a fresh `assistant_briefings` row lands for today, this service
 * pushes it to the household. On app_version < AIHOUSEKEEPER_MIN_APP_VERSION,
 * falls back to `data.type = 'cards_refresh'` — the generic legacy push
 * the mobile app already handles.
 */

import { and, desc, eq } from 'drizzle-orm';

import { householdMembers } from '../../db/schema';
import { assistantBriefings } from '../../db/schema-aihousekeeper';
import { pushTokens } from '../../db/schema-notifications';
import type { Database, Env } from '../../types';
import { isLocalFirstHousehold } from '../local-first-household-gate';

import { AihousekeeperEventBus, sha256Hex } from './event-bus';
import type { OutboundDispatcher } from './outbound-dispatcher';

const PUSH_TEMPLATE = 'daily_briefing';

export interface BriefingDispatcherParams {
  db: Database;
  env: Env;
  dispatcher: OutboundDispatcher;
  events: AihousekeeperEventBus;
}

export class BriefingDispatcher {
  private db: Database;
  private env: Env;
  private dispatcher: OutboundDispatcher;
  private events: AihousekeeperEventBus;

  constructor(params: BriefingDispatcherParams) {
    this.db = params.db;
    this.env = params.env;
    this.dispatcher = params.dispatcher;
    this.events = params.events;
  }

  /**
   * Picks up today's briefing row and pushes it (or skips if empty).
   */
  async dispatchFresh(householdId: string, date: string): Promise<void> {
    /**
     * H7 P4 (plan §9, Q8): push delivery is OFF for local-first households.
     *
     * `composeBriefingsDueThisHour` already refuses to compose for them, so in
     * steady state there is nothing here to push. This is the second half of
     * that guard and it is not redundant: a household that goes local-first
     * part-way through a day leaves behind a briefing row composed while it was
     * still a server household, and this is the only place that row would
     * become a notification. It is also the actual SEND, and a send gate
     * belongs at the send.
     *
     * One household per queue message, so this is the single-id form of the
     * gate rather than the per-tick set the composer uses.
     */
    if (await isLocalFirstHousehold(this.env, householdId)) {
      console.log(
        '[BriefingDispatcher] skipped local-first household — briefings are in-app only (H7 P4)',
        { householdIdPrefix: householdId.slice(0, 8) }
      );
      return;
    }

    const briefing = await this.db
      .select()
      .from(assistantBriefings)
      .where(
        and(
          eq(assistantBriefings.household_id, householdId),
          eq(assistantBriefings.date, date)
        )
      )
      .get();
    if (!briefing) return;

    if (briefing.empty_reason) {
      // Empty briefings are not pushed. Emit skipped event + write a log
      // entry via dispatcher's own path would require a send call — instead,
      // emit a direct `outbound_skipped` event with reason='empty'.
      const idem = await sha256Hex(
        `outbound_skipped:${householdId}:push:empty:${briefing.id}`
      );
      await this.events.emit({
        kind: 'outbound_skipped',
        householdId,
        eventIdempotencyKey: idem,
        channel: 'push',
        reason: 'empty',
      });
      return;
    }
    if (briefing.push_sent) return;

    // Resolve push recipient: owner's most recent active token.
    const recipient = await this.resolveOwnerPushToken(householdId);
    if (!recipient) {
      console.warn('[BriefingDispatcher] no owner push token', {
        householdIdPrefix: householdId.slice(0, 8),
      });
      return;
    }

    // App-version gate: if the member's device is below
    // AIHOUSEKEEPER_MIN_APP_VERSION, use the legacy cards_refresh payload so the
    // app ignores the Aihousekeeper-specific deep link and just opens to reload.
    const useLegacy = this.isBelowMinAppVersion(
      recipient.appVersion,
      this.env.AIHOUSEKEEPER_MIN_APP_VERSION
    );

    const title = 'Your morning briefing';
    const body = useLegacy
      ? 'Your morning briefing is ready.'
      : briefing.paragraph;
    const data = useLegacy
      ? { type: 'cards_refresh' }
      : { type: 'aihousekeeper_briefing', date };

    const result = await this.dispatcher.sendPush({
      householdId,
      toMemberId: recipient.memberId,
      toExpoToken: recipient.token,
      title,
      body,
      data,
      template: PUSH_TEMPLATE,
      severity: 2,
      kind: 'briefing',
      idempotencyKey: `briefing:${householdId}:${date}`,
      composedByModel: briefing.composed_by_model ?? undefined,
      promptVersion: briefing.prompt_version ?? undefined,
      triggerRef: { briefingId: briefing.id, date },
    });
    if (result.status !== 'sent') return;

    await this.db
      .update(assistantBriefings)
      .set({ push_sent: true, push_message_id: result.externalMessageId })
      .where(eq(assistantBriefings.id, briefing.id));

    const idem = await sha256Hex(`briefing_pushed:${householdId}:${date}`);
    await this.events.emit({
      kind: 'briefing_pushed',
      householdId,
      eventIdempotencyKey: idem,
      date,
      messageId: result.externalMessageId,
    });
  }

  private async resolveOwnerPushToken(
    householdId: string
  ): Promise<{
    memberId: string;
    token: string;
    appVersion: string | null;
  } | null> {
    // Owner is the member with role='owner'. Assumes at least one.
    const owner = await this.db
      .select({
        member_id: householdMembers.id,
        user_id: householdMembers.user_id,
      })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.household_id, householdId),
          eq(householdMembers.role, 'owner')
        )
      )
      .get();
    if (!owner) return null;

    const token = await this.db
      .select({
        token: pushTokens.token,
        app_version: pushTokens.app_version,
      })
      .from(pushTokens)
      .where(and(eq(pushTokens.user_id, owner.user_id), eq(pushTokens.is_active, true)))
      .orderBy(desc(pushTokens.updated_at))
      .limit(1)
      .get();
    if (!token) return null;
    return {
      memberId: owner.member_id,
      token: token.token,
      appVersion: token.app_version,
    };
  }

  private isBelowMinAppVersion(
    appVersion: string | null,
    minVersion: string | null | undefined
  ): boolean {
    if (!minVersion) return false;
    if (!appVersion) return true; // null app_version means pre-column registration.
    return compareSemver(appVersion, minVersion) < 0;
  }
}

/**
 * Minimal semver comparator (no pre-release suffixes). Returns <0 / 0 / >0.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}
