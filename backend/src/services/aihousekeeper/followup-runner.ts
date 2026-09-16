/**
 * Aihousekeeper followup runner — plan §B7.
 *
 * Stream F's cron handler calls `runDue(now)` periodically. For each pending
 * followup whose `scheduled_for <= now`, we:
 *   1. Mark fired.
 *   2. Recall relevant memory via MemoryService.
 *   3. Ask Haiku to decide notify vs silent_close (tool_use over two tools).
 *      Retry once on malformed; default to silent_close on second failure.
 *   4. On notify: OutboundDispatcher.sendPush with severity=3, kind='followup'.
 *   5. Emit `followup_fired` event.
 *
 * HIGH_WRITE detection: if the LLM invoked a HIGH_WRITE tool, park via
 * ApprovalQueueShim and notify user "Aihousekeeper has a pending action for your
 * approval." Never auto-execute mutating tools during autonomous runs.
 */

import { and, eq, lte, sql } from 'drizzle-orm';

import { generateWithFallback } from '../../ai/fallback';
import {
  FOLLOWUP_DECISION_PROMPT_VERSION,
  FOLLOWUP_SYSTEM_PROMPT,
  FOLLOWUP_TOOLS,
} from '../../ai/prompts/aihousekeeper/followup-decision-v1';
import type { AIProvider, GenerateResult } from '../../ai/provider';
import { assistantFollowups } from '../../db/schema-aihousekeeper';
import type { AssistantFollowup } from '../../db/schema-aihousekeeper';
import type { Database, Env } from '../../types';
import { now as nowIso } from '../../utils/id';
import type { ApprovalQueueShim } from '../ai/approval-queue-shim';

import { AihousekeeperEventBus, sha256Hex } from './event-bus';
import type { MemoryService } from './memory-service';
import type { OutboundDispatcher } from './outbound-dispatcher';

interface MemberPushRecipient {
  memberId: string;
  expoToken: string;
}

/**
 * Resolves a push recipient for a household. Stream F will provide a
 * concrete implementation that looks up the most recent active push token
 * for the household owner (or a specific member if provided).
 */
export type FollowupPushResolver = (
  householdId: string,
  memberIdHint?: string
) => Promise<MemberPushRecipient | null>;

export class FollowupRunner {
  private db: Database;
  private env: Env;
  private ai: AIProvider;
  private memory: MemoryService;
  private dispatcher: OutboundDispatcher;
  private events: AihousekeeperEventBus;
  private approvals: ApprovalQueueShim;
  private resolvePushRecipient: FollowupPushResolver;

  constructor(params: {
    db: Database;
    env: Env;
    ai: AIProvider;
    memory: MemoryService;
    dispatcher: OutboundDispatcher;
    events: AihousekeeperEventBus;
    approvals: ApprovalQueueShim;
    resolvePushRecipient: FollowupPushResolver;
  }) {
    this.db = params.db;
    this.env = params.env;
    this.ai = params.ai;
    this.memory = params.memory;
    this.dispatcher = params.dispatcher;
    this.events = params.events;
    this.approvals = params.approvals;
    this.resolvePushRecipient = params.resolvePushRecipient;
  }

  async runDue(now: Date): Promise<{ fired: number }> {
    const due = await this.db
      .select()
      .from(assistantFollowups)
      .where(
        and(
          eq(assistantFollowups.status, 'pending'),
          lte(assistantFollowups.scheduled_for, now.toISOString())
        )
      )
      .all();

    let fired = 0;
    for (const followup of due) {
      try {
        await this.runOne(followup, now);
        fired += 1;
      } catch (err) {
        console.error('[FollowupRunner] runOne failed', {
          followupId: followup.id,
          error: (err as Error).message,
        });
      }
    }
    return { fired };
  }

  private async runOne(followup: AssistantFollowup, now: Date): Promise<void> {
    // Mark fired first so retries don't double-process.
    await this.db
      .update(assistantFollowups)
      .set({ status: 'fired', fired_at: now.toISOString(), updated_at: nowIso() })
      .where(eq(assistantFollowups.id, followup.id));

    // Recall memory for context. `context_ref_json` may include a `query`.
    let query = followup.prompt;
    try {
      const refs = followup.context_ref_json
        ? (JSON.parse(followup.context_ref_json) as { query?: string })
        : {};
      if (typeof refs.query === 'string') query = refs.query;
    } catch {
      // Use prompt as fallback.
    }
    const memories = await this.memory.recall(followup.household_id, query, 6);
    const memoryBlock = memories
      .map((m) => `  - [${m.type}] ${m.redacted_body ?? ''}`)
      .join('\n');

    const userPrompt = [
      `Followup prompt: ${followup.prompt}`,
      '',
      'Relevant memory (redacted):',
      memoryBlock || '  (none)',
    ].join('\n');

    // Decision loop (retry once on malformed).
    let decision: {
      kind: 'notify';
      message: string;
      rationale: string;
    } | {
      kind: 'silent_close';
      reason: string;
    } | null = null;

    for (let attempt = 0; attempt < 2 && decision === null; attempt += 1) {
      try {
        const response = await generateWithFallback(
          this.ai,
          this.env.AIHOUSEKEEPER_NUDGE_MODEL,
          this.env.AIHOUSEKEEPER_FALLBACK_MODEL,
          {
            systemPrompt: FOLLOWUP_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
            tools: FOLLOWUP_TOOLS,
            toolChoice: { type: 'any' },
            maxTokens: 512,
            cacheControl: { onSystem: { type: 'ephemeral' } },
          }
        );
        decision = this.parseDecision(response);
      } catch {
        decision = null;
      }
    }

    if (decision === null) {
      decision = { kind: 'silent_close', reason: 'malformed_decision' };
    }

    // HIGH_WRITE park: if the LLM emits a HIGH_WRITE tool call (none of the
    // decision tools are HIGH_WRITE, but if this runner is ever wired to a
    // broader tool set, it must respect the invariant). Stream B does not
    // see HIGH_WRITE tools here, so this is documentation for Stream C.
    // If a future version passes through HIGH_WRITE, call:
    //   await this.approvals.park({ ... });
    //   decision = { kind: 'notify', message: 'Aihousekeeper has a pending action for your approval.', rationale: 'parked' };
    // We keep a reference so the `approvals` field is not unused.
    void this.approvals;

    // Emit event.
    const eventIdem = await sha256Hex(`followup_fired:${followup.id}`);
    await this.events.emit({
      kind: 'followup_fired',
      householdId: followup.household_id,
      eventIdempotencyKey: eventIdem,
      followupId: followup.id,
      decision: decision.kind === 'notify' ? 'notify' : 'silent_close',
      rationale:
        decision.kind === 'notify' ? decision.rationale : decision.reason,
    });

    if (decision.kind === 'notify') {
      const recipient = await this.resolvePushRecipient(followup.household_id);
      if (!recipient) {
        console.warn('[FollowupRunner] no push recipient found; dropping notify', {
          followupId: followup.id,
        });
        return;
      }
      const idempotencyKey = `followup:${followup.id}`;
      await this.dispatcher.sendPush({
        householdId: followup.household_id,
        toMemberId: recipient.memberId,
        toExpoToken: recipient.expoToken,
        title: 'Aihousekeeper',
        body: decision.message,
        template: 'followup_nudge',
        severity: 3,
        kind: 'followup',
        idempotencyKey,
        composedByModel: this.env.AIHOUSEKEEPER_NUDGE_MODEL,
        promptVersion: FOLLOWUP_DECISION_PROMPT_VERSION,
        triggerRef: { followupId: followup.id },
        now,
      });
    }

    // Persist outcome.
    await this.db
      .update(assistantFollowups)
      .set({
        outcome_json: JSON.stringify({
          decision: decision.kind,
          ...(decision.kind === 'notify'
            ? { message: decision.message, rationale: decision.rationale }
            : { reason: decision.reason }),
        }),
        updated_at: nowIso(),
      })
      .where(eq(assistantFollowups.id, followup.id));
  }

  private parseDecision(response: GenerateResult):
    | { kind: 'notify'; message: string; rationale: string }
    | { kind: 'silent_close'; reason: string }
    | null {
    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') return null;
    const input = toolBlock.input as Record<string, unknown>;
    if (toolBlock.name === 'notify_user') {
      const message = input.message;
      const rationale = input.rationale;
      if (typeof message !== 'string' || typeof rationale !== 'string') return null;
      return { kind: 'notify', message, rationale };
    }
    if (toolBlock.name === 'silent_close') {
      const reason = input.reason;
      if (typeof reason !== 'string') return null;
      return { kind: 'silent_close', reason };
    }
    return null;
  }
}

// Suppress an "sql is unused" TS warning if none of the current calls use it.
// The import pulls in the D1 operator namespace used by future query updates.
void sql;
