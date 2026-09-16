/**
 * Aihousekeeper outbound loop — plan §F2 + §F3.
 *
 * Two halves:
 *
 *   PRODUCER: `enqueueOutboundLoop(env)` runs from the scheduled handler at
 *     minute 0/15/30/45, enumerates eligible households, and fans out one
 *     AIHOUSEKEEPER_OUTBOUND_QUEUE message per household (chunked by 50). Guarded
 *     by `aihousekeeper_outbound_loop_enabled` KV flag.
 *
 *   CONSUMER: `handleOutboundMessage(env, msg)` is called per-message by
 *     the queue consumer in backend/src/index.ts. It re-checks the KV kill
 *     switch (retry on disabled so messages replay when re-enabled), then
 *     evaluates triggers for the household, routes TriggerResults to the
 *     right dispatcher path, and ack()s on success. Any throw falls through
 *     to msg.retry() so Cloudflare handles backoff + DLQ.
 *
 * BRIEFING SCHEDULER: `composeBriefingsDueThisHour(env, now)` also lives
 * here (plan §F3). Called from the scheduled handler at minute 0, it matches
 * households whose local hour == briefing_time hour and composes a briefing
 * row via BriefingComposer. Push is handled separately by BriefingDispatcher
 * when it sees a fresh row.
 *
 * Idempotency: the queue producer is called multiple times per 15-minute
 * window by cron, so duplicate enqueues can happen; `OutboundDispatcher`
 * de-dupes via its per-idempotency-key gate (check 8 in §B4).
 */

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { createProviderAdapter } from '../../ai/provider-factory';
import * as schema from '../../db/schema';
import { households, householdMembers } from '../../db/schema';
import {
  assistantBriefings,
  assistantIdentity,
} from '../../db/schema-aihousekeeper';
import { pushTokens } from '../../db/schema-notifications';
import type { AihousekeeperOutboundMessage, Database, Env } from '../../types';
import { AIAccessError } from '../../utils/errors';
import { generateId, now as nowIso } from '../../utils/id';
import { ApprovalQueueShim } from '../ai/approval-queue-shim';
import { resolveProviderApiKey } from '../ai-credential-resolver';
import { usageRecorderFor } from '../ai-usage-service';
import { assertCanUseAI } from '../entitlement-service';
import { createSendGridClient } from '../integrations/sendgrid';
import { localFirstHouseholdIds } from '../local-first-household-gate';
import { getHouseholdWeather } from '../weather-service';

import { BriefingComposer } from './briefing-composer';
import { BriefingDispatcher } from './briefing-dispatcher';
import { AihousekeeperEventBus, sha256Hex } from './event-bus';
import { ExpoPushClient } from './expo-push';
import { FollowupRunner } from './followup-runner';
import { MemoryService } from './memory-service';
import { OutboundDispatcher } from './outbound-dispatcher';
import { dateInTimezone, hourInTimezone } from './timezone';
import { TRIGGERS, type TriggerResult } from './triggers';
import { TrustLedgerService } from './trust-ledger-service';

// ============================================================================
// Runtime container — built lazily per invocation so we don't hold sockets
// across the scheduled / queue boundary.
// ============================================================================

interface AihousekeeperRuntime {
  db: Database;
  env: Env;
  events: AihousekeeperEventBus;
  ledger: TrustLedgerService;
  memory: MemoryService;
  dispatcher: OutboundDispatcher;
  briefingDispatcher: BriefingDispatcher;
  briefingComposer: BriefingComposer;
  followupRunner: FollowupRunner;
}

function buildRuntime(
  env: Env,
  anthropicKey?: string,
  usage?: { householdId?: string | null; userId?: string | null }
): AihousekeeperRuntime {
  const db = drizzle(env.DB, { schema });
  const events = new AihousekeeperEventBus();
  // TrustLedgerService subscribes to the bus in its constructor (§B6).
  const ledger = new TrustLedgerService(db, events);
  // `anthropicKey` lets the caller run proactive/briefing AI on the household
  // owner's own BYOK key; omitted → SimpleHouse-managed key.
  const ai = createProviderAdapter({
    provider: 'anthropic',
    apiKey: anthropicKey ?? env.ANTHROPIC_API_KEY ?? '',
    options: {
      // Proactive Mira is queue-driven, so the household is only known at the
      // call site — without threading it through here every proactive call was
      // written with a null household_id and never appeared in any report.
      onUsage: usageRecorderFor(env, {
        feature: 'aihousekeeper_proactive',
        householdId: usage?.householdId ?? null,
        userId: usage?.userId ?? null,
      }),
    },
  });
  const memory = new MemoryService({ db, d1: env.DB, ai, events, env });
  const expoPush = new ExpoPushClient();
  const sendgrid = createSendGridClient({
    SENDGRID_API_KEY: env.SENDGRID_API_KEY,
    SENDGRID_DIGEST_TEMPLATE_ID: env.SENDGRID_DIGEST_TEMPLATE_ID,
    SENDGRID_FROM_EMAIL: env.SENDGRID_FROM_EMAIL,
  });
  const dispatcher = new OutboundDispatcher({
    db,
    env,
    events,
    expoPush,
    sendgrid,
  });
  const briefingDispatcher = new BriefingDispatcher({
    db,
    env,
    dispatcher,
    events,
  });
  const briefingComposer = new BriefingComposer({
    ai,
    env,
    deps: buildBriefingDeps(db, env),
  });
  const followupRunner = new FollowupRunner({
    db,
    env,
    ai,
    memory,
    dispatcher,
    events,
    approvals: new ApprovalQueueShim(env.DB),
    resolvePushRecipient: async (householdId) => {
      const recipient = await resolveOwnerPushToken(db, householdId);
      return recipient
        ? { memberId: recipient.memberId, expoToken: recipient.token }
        : null;
    },
  });
  return {
    db,
    env,
    events,
    ledger,
    memory,
    dispatcher,
    briefingDispatcher,
    briefingComposer,
    followupRunner,
  };
}

/**
 * Minimal BriefingDeps stub: returns empty sets so the composer produces an
 * "empty" briefing when no other Aihousekeeper data surfaces. Real deps will be
 * injected by the host service layer as Stream C lands more signal sources.
 */
function buildBriefingDeps(db: Database, env: Env) {
  return {
    async listOverdueTasks() {
      return [];
    },
    async listAppointments() {
      return [];
    },
    async getWeather(householdId: string) {
      // Real weather via WeatherKit when configured; null otherwise (feature off).
      return getHouseholdWeather(env, db, householdId);
    },
    async topMaintenanceSuggestion() {
      return null;
    },
    async listOpenQuestions() {
      return [];
    },
    async listRecentHistory() {
      return [];
    },
  };
}

// ============================================================================
// PRODUCER
// ============================================================================

/**
 * Enumerate eligible households and enqueue one message per household.
 * Idempotent on the queue: the consumer uses OutboundDispatcher's per-key
 * duplicate check to swallow same-slot replays.
 */
export async function enqueueOutboundLoop(env: Env): Promise<void> {
  const enabled = await env.CONFIG_KV.get('aihousekeeper_outbound_loop_enabled');
  if (enabled !== 'true') return;

  const db = drizzle(env.DB, { schema });
  const eligible = await listEligibleHouseholds(db);
  if (eligible.length === 0) return;

  for (const chunk of chunksOf(eligible, 50)) {
    try {
      await env.AIHOUSEKEEPER_OUTBOUND_QUEUE.sendBatch(
        chunk.map((hid) => ({
          body: { householdId: hid, enqueuedAt: Date.now() },
        }))
      );
    } catch (err) {
      console.error('[aihousekeeper-outbound-loop] sendBatch failed', {
        error: (err as Error).message,
        chunkSize: chunk.length,
      });
    }
  }
}

async function listEligibleHouseholds(db: Database): Promise<string[]> {
  // Criteria: household is not soft-deleted AND has an assistant_identity row.
  const rows = await db
    .select({ id: households.id })
    .from(households)
    .innerJoin(
      assistantIdentity,
      eq(assistantIdentity.household_id, households.id)
    )
    .where(
      and(
        // households has a soft-delete column on the root schema; if absent
        // we still filter through the identity-row gate.
        sql`${households.deleted_at} IS NULL`
      )
    )
    .all();
  return rows.map((r) => r.id);
}

// ============================================================================
// CONSUMER
// ============================================================================

/**
 * Per-message queue consumer handler. Wrapped in try/catch so one household
 * failure doesn't poison the batch; we ack/retry per plan §F2.
 */
export async function handleOutboundMessage(
  env: Env,
  msg: Message<AihousekeeperOutboundMessage>
): Promise<void> {
  try {
    const enabled = await env.CONFIG_KV.get('aihousekeeper_outbound_loop_enabled');
    if (enabled !== 'true') {
      // Mid-loop kill switch — retry instead of ack so the work replays when
      // the operator re-enables. 60s delay keeps retries cheap.
      msg.retry({ delaySeconds: 60 });
      return;
    }

    const ownerUserId = await resolveOwnerUserId(env, msg.body.householdId);
    if (!ownerUserId) {
      console.warn('[aihousekeeper-outbound-loop] no owner; skipping', {
        householdIdPrefix: msg.body.householdId.slice(0, 8),
      });
      msg.ack();
      return;
    }
    try {
      await assertCanUseAI(ownerUserId, env);
    } catch (err) {
      if (err instanceof AIAccessError || (err as Error).name === 'AIAccessError') {
        console.warn('[aihousekeeper-outbound-loop] entitlement denied; skipping', {
          householdIdPrefix: msg.body.householdId.slice(0, 8),
          code: (err as AIAccessError).code,
        });
        msg.ack();
        return;
      }
      throw err;
    }

    // Proactive Mira runs on the household owner's own key when connected (BYOK).
    const { apiKey: ownerKey } = await resolveProviderApiKey(env, ownerUserId, 'anthropic');
    const runtime = buildRuntime(env, ownerKey, {
      householdId: msg.body.householdId,
      userId: ownerUserId,
    });
    await processHousehold(runtime, msg.body.householdId);
    msg.ack();
  } catch (err) {
    console.error('[aihousekeeper-outbound-loop] handleOne failed', {
      householdIdPrefix: msg.body.householdId.slice(0, 8),
      error: (err as Error).message,
    });
    msg.retry();
  }
}

/**
 * Evaluate all triggers for a household, aggregate results, enforce the
 * per-household daily interrupt budget, and route dispatches. Each dispatch
 * call is wrapped in try/catch so one bad trigger doesn't stall the rest.
 */
async function processHousehold(
  runtime: AihousekeeperRuntime,
  householdId: string
): Promise<void> {
  const now = new Date();
  const results: TriggerResult[] = [];
  for (const trigger of TRIGGERS) {
    try {
      const result = await trigger.evaluate(runtime.env, householdId, now);
      if (result) results.push(result);
    } catch (err) {
      console.error('[aihousekeeper-outbound-loop] trigger eval failed', {
        triggerId: trigger.id,
        householdIdPrefix: householdId.slice(0, 8),
        error: (err as Error).message,
      });
    }
  }

  if (results.length === 0) return;

  // Highest-severity first, clip to the daily interrupt budget. Budget
  // enforcement within OutboundDispatcher.canSend (§B4 check 7) is the
  // authoritative gate — this is a pre-filter to avoid unnecessary work.
  results.sort((a, b) => b.severity - a.severity);
  const budget = await resolveDailyBudget(runtime.db, householdId);
  const topN = results.slice(0, Math.max(1, budget));

  for (const result of topN) {
    try {
      await routeResult(runtime, result, now);
    } catch (err) {
      console.error('[aihousekeeper-outbound-loop] routeResult failed', {
        triggerId: result.triggerId,
        householdIdPrefix: householdId.slice(0, 8),
        error: (err as Error).message,
      });
    }
  }
}

/**
 * Route one trigger result to the appropriate service. Briefing and followup
 * triggers drop through to their own services; everything else composes a
 * short push body.
 */
async function routeResult(
  runtime: AihousekeeperRuntime,
  result: TriggerResult,
  now: Date
): Promise<void> {
  if (result.kind === 'briefing' || result.triggerId === 'daily_briefing_time') {
    // The briefing row should already have been composed by the top-of-hour
    // scheduler. Push dispatch is the BriefingDispatcher's job.
    const date = (result.payload as { date?: string }).date;
    if (typeof date === 'string') {
      await runtime.briefingDispatcher.dispatchFresh(result.householdId, date);
    }
    return;
  }

  if (result.kind === 'followup' || result.triggerId === 'followup_due') {
    // FollowupRunner owns the whole lifecycle; just ask it to process due.
    await runtime.followupRunner.runDue(now);
    return;
  }

  // Generic nudge → compose a short body + sendPush. If no push recipient
  // is registered for the household owner, we silently skip (logged once).
  const recipient = await resolveOwnerPushToken(runtime.db, result.householdId);
  if (!recipient) return;

  const title = 'Aihousekeeper';
  const body = composeNudgeBody(result);
  const dispatch = await runtime.dispatcher.sendPush({
    householdId: result.householdId,
    toMemberId: recipient.memberId,
    toExpoToken: recipient.token,
    title,
    body,
    template: `nudge:${result.triggerId}`,
    severity: result.severity,
    kind: 'nudge',
    idempotencyKey: result.idempotencyKey,
    triggerRef: { triggerId: result.triggerId, ...result.payload },
    data: { type: 'aihousekeeper_nudge', triggerId: result.triggerId },
    now,
  });

  if (dispatch.status === 'sent') {
    const idem = await sha256Hex(`nudge_dispatched:${result.idempotencyKey}`);
    await runtime.events.emit({
      kind: 'decision_made',
      householdId: result.householdId,
      eventIdempotencyKey: idem,
      summary: `Nudged: ${result.triggerId}`,
      rationale: `Trigger ${result.triggerId} fired at severity ${result.severity}.`,
      reversible: false,
    });
  }
}

function composeNudgeBody(result: TriggerResult): string {
  // Trigger payloads vary; extract a human-readable excerpt when present.
  const payload = result.payload ?? {};
  if (typeof payload.message === 'string' && payload.message.length > 0) {
    return payload.message.slice(0, 180);
  }
  if (typeof payload.summary === 'string' && payload.summary.length > 0) {
    return payload.summary.slice(0, 180);
  }
  if (typeof payload.title === 'string' && payload.title.length > 0) {
    return payload.title.slice(0, 180);
  }
  return `New update from Aihousekeeper (${result.triggerId}).`;
}

async function resolveDailyBudget(
  db: Database,
  householdId: string
): Promise<number> {
  const row = await db
    .select({ budget: assistantIdentity.daily_interrupt_budget })
    .from(assistantIdentity)
    .where(eq(assistantIdentity.household_id, householdId))
    .get();
  return row?.budget ?? 3;
}

async function resolveOwnerUserId(
  env: Env,
  householdId: string
): Promise<string | null> {
  const db = drizzle(env.DB, { schema }) as unknown as Database;
  const owner = await db
    .select({ user_id: householdMembers.user_id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.household_id, householdId),
        eq(householdMembers.role, 'owner')
      )
    )
    .get();
  return owner?.user_id ?? null;
}

async function resolveOwnerPushToken(
  db: Database,
  householdId: string
): Promise<{ memberId: string; token: string } | null> {
  const owner = await db
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
  const token = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(
      and(eq(pushTokens.user_id, owner.user_id), eq(pushTokens.is_active, true))
    )
    .limit(1)
    .get();
  if (!token) return null;
  return { memberId: owner.member_id, token: token.token };
}

// ============================================================================
// BRIEFING SCHEDULER (§F3)
// ============================================================================

/**
 * At the top of every hour, compose briefings for households whose local
 * `briefing_time` hour matches the current local hour. Does NOT push —
 * BriefingDispatcher picks up fresh rows via the outbound loop.
 *
 * Gated by `aihousekeeper_briefings_enabled` KV flag.
 */
export async function composeBriefingsDueThisHour(
  env: Env,
  now: Date
): Promise<{ composed: number; skippedLocalFirst: number }> {
  const enabled = await env.CONFIG_KV.get('aihousekeeper_briefings_enabled');
  if (enabled !== 'true') return { composed: 0, skippedLocalFirst: 0 };

  const runtime = buildRuntime(env);
  const identities = await runtime.db
    .select({
      household_id: assistantIdentity.household_id,
      briefing_time: assistantIdentity.briefing_time,
      timezone: assistantIdentity.timezone,
    })
    .from(assistantIdentity)
    .all();

  /**
   * H7 P4 (plan §9, Q8): briefings are in-app only for local-first households.
   *
   * Every input `BriefingComposer` reasons from — overdue tasks, appointments,
   * the top maintenance suggestion, recent history — is a D1 domain row that a
   * local-first household stops writing, and `households.latitude/longitude`
   * (the weather dep) is never written by `mirrorLegacyMembership` either. So
   * the composer would run on an empty context.
   *
   * That is NOT a harmless no-op, for two reasons. The composer calls a model
   * before it knows the context is empty, so every local-first household would
   * burn an LLM call an hour; and the model, not the caller, decides whether to
   * emit `compose_briefing` or `skip_briefing`, so a chatty "nothing pressing
   * today" paragraph can be persisted and later pushed by BriefingDispatcher as
   * if it were a briefing about their home.
   *
   * Fetched once for the whole tick, exactly as `DigestComposer.runDueThisHour`
   * does — a query per identity is the thing this shape exists to avoid.
   */
  const localFirst = await localFirstHouseholdIds(env);
  let composed = 0;
  let skippedLocalFirst = 0;

  const due = identities.filter((r) => {
    const target = parseInt((r.briefing_time ?? '07:00').split(':')[0] ?? '7', 10);
    if (Number.isNaN(target)) return false;
    return hourInTimezone(now, r.timezone) === target;
  });

  for (const r of due) {
    if (localFirst.has(r.household_id)) {
      skippedLocalFirst += 1;
      continue;
    }
    try {
      const localDate = dateInTimezone(now, r.timezone);
      // Skip if a briefing row already exists for this household+date.
      const existing = await runtime.db
        .select({ id: assistantBriefings.id })
        .from(assistantBriefings)
        .where(
          and(
            eq(assistantBriefings.household_id, r.household_id),
            eq(assistantBriefings.date, localDate)
          )
        )
        .get();
      if (existing) continue;

      // Compose on the household owner's own key when connected (BYOK).
      const ownerId = await resolveOwnerUserId(env, r.household_id);
      const { apiKey: ownerKey } = await resolveProviderApiKey(env, ownerId, 'anthropic');
      const composer = buildRuntime(env, ownerKey).briefingComposer;
      const result = await composer.composeFor(r.household_id, localDate);
      composed += 1;

      // Persist the composed row.
      if (result.kind === 'composed') {
        await runtime.db.insert(assistantBriefings).values({
          id: generateId(),
          household_id: r.household_id,
          date: localDate,
          paragraph: result.paragraph,
          bullets_json: JSON.stringify(result.bullets),
          source_signals_json: JSON.stringify(result.sourceSignals),
          composed_by_model: result.composedByModel,
          prompt_version: result.promptVersion,
          composed_at: nowIso(),
        });
        const idem = await sha256Hex(
          `briefing_composed:${r.household_id}:${localDate}`
        );
        await runtime.events.emit({
          kind: 'briefing_composed',
          householdId: r.household_id,
          eventIdempotencyKey: idem,
          date: localDate,
          result: 'composed',
        });
      } else {
        await runtime.db.insert(assistantBriefings).values({
          id: generateId(),
          household_id: r.household_id,
          date: localDate,
          paragraph: '',
          bullets_json: '[]',
          source_signals_json: JSON.stringify(result.sourceSignals),
          empty_reason: result.reason,
          composed_at: nowIso(),
        });
        const idem = await sha256Hex(
          `briefing_composed:${r.household_id}:${localDate}:empty`
        );
        await runtime.events.emit({
          kind: 'briefing_composed',
          householdId: r.household_id,
          eventIdempotencyKey: idem,
          date: localDate,
          result: 'empty',
          reason: result.reason,
        });
      }
    } catch (err) {
      console.error('[aihousekeeper-briefing-scheduler] compose failed', {
        householdIdPrefix: r.household_id.slice(0, 8),
        error: (err as Error).message,
      });
    }
  }

  if (skippedLocalFirst > 0) {
    console.log(
      `[aihousekeeper-briefing-scheduler] skipped ${skippedLocalFirst} local-first household(s) — briefings are in-app only (H7 P4)`
    );
  }
  return { composed, skippedLocalFirst };
}

// ============================================================================
// Utilities
// ============================================================================

function* chunksOf<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) {
    yield arr.slice(i, i + size);
  }
}

// Suppress unused-import warnings for helpers we keep for future expansion.
void inArray;
void isNotNull;
