/**
 * Aihousekeeper trust ledger — plan §B6.
 *
 * Subscribes to AihousekeeperEventBus at construction. Every event becomes at-most
 * one `assistant_trust_ledger` row (partial unique index on
 * `event_idempotency_key` makes replay safe). Individual services NEVER
 * write to the ledger directly — enforced by convention; grep `.write(` on
 * this module in CI.
 *
 * `list` / `dismiss` / `undo` power the `/aihousekeeper/trust-ledger/*` routes
 * (Stream E).
 */

import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';

import { tasks } from '../../db/schema';
import type {
  AssistantTrustLedgerEntry,
  NewAssistantTrustLedgerEntry,
} from '../../db/schema-aihousekeeper';
import { assistantMemory, assistantTrustLedger } from '../../db/schema-aihousekeeper';
import { assistantOutboundLog } from '../../db/schema-aihousekeeper';
import type { Database } from '../../types';
import { generateId, now as nowIso } from '../../utils/id';

import type { AihousekeeperEvent } from './event-bus';
import { AihousekeeperEventBus } from './event-bus';

export type TrustLedgerCategory =
  | 'decision'
  | 'message_sent'
  | 'task_changed'
  | 'memory_added'
  | 'followup_scheduled'
  | 'assignment';

interface ListOpts {
  since?: string;
  category?: TrustLedgerCategory;
  includeDismissed?: boolean;
  limit?: number;
}

export interface UndoResult {
  status: 'undone' | 'irreversible' | 'not_found' | 'already_undone';
  message?: string;
}

export class TrustLedgerService {
  private db: Database;

  constructor(db: Database, bus: AihousekeeperEventBus) {
    this.db = db;
    bus.subscribe(async (event) => {
      await this.writeFromEvent(event);
    });
  }

  /**
   * Map a AihousekeeperEvent to a ledger row. Idempotent via
   * onConflictDoNothing({ target: event_idempotency_key }).
   */
  async writeFromEvent(event: AihousekeeperEvent): Promise<void> {
    const mapped = this.mapEvent(event);
    if (!mapped) return; // kind not ledger-visible

    const row: NewAssistantTrustLedgerEntry = {
      id: generateId(),
      household_id: event.householdId,
      occurred_at: nowIso(),
      category: mapped.category,
      summary: mapped.summary,
      rationale: mapped.rationale,
      reversible: mapped.reversible,
      undo_token: mapped.undoToken,
      related_refs_json: mapped.relatedRefs
        ? JSON.stringify(mapped.relatedRefs)
        : undefined,
      event_idempotency_key: event.eventIdempotencyKey,
    };
    try {
      // Empty-target onConflictDoNothing matches any unique constraint. Using
      // a targeted conflict spec against the partial unique index
      // (WHERE event_idempotency_key IS NOT NULL) can fail to match on SQLite,
      // which would swallow the INSERT entirely. The null-target form below is
      // strictly broader and still correctly no-ops on the intended dedup key.
      await this.db
        .insert(assistantTrustLedger)
        .values(row)
        .onConflictDoNothing();
    } catch (err) {
      console.error('[TrustLedgerService] write failed', {
        kind: event.kind,
        householdIdPrefix: event.householdId.slice(0, 8),
        error: (err as Error).message,
      });
    }
  }

  async list(
    householdId: string,
    opts: ListOpts = {}
  ): Promise<AssistantTrustLedgerEntry[]> {
    const conditions = [eq(assistantTrustLedger.household_id, householdId)];
    if (opts.since) {
      conditions.push(gte(assistantTrustLedger.occurred_at, opts.since));
    }
    if (opts.category) {
      conditions.push(eq(assistantTrustLedger.category, opts.category));
    }
    if (!opts.includeDismissed) {
      conditions.push(isNull(assistantTrustLedger.user_dismissed_at));
    }
    const limit = opts.limit ?? 100;
    return this.db
      .select()
      .from(assistantTrustLedger)
      .where(and(...conditions))
      .orderBy(desc(assistantTrustLedger.occurred_at))
      .limit(limit)
      .all();
  }

  async dismiss(id: string): Promise<void> {
    await this.db
      .update(assistantTrustLedger)
      .set({ user_dismissed_at: sql`(datetime('now'))` })
      .where(eq(assistantTrustLedger.id, id));
  }

  /**
   * Dispatch table for reversible actions. Only covers the minimal v3.1
   * coverage noted in the plan; extension points are marked inline.
   */
  async undo(id: string): Promise<UndoResult> {
    const entry = await this.db
      .select()
      .from(assistantTrustLedger)
      .where(eq(assistantTrustLedger.id, id))
      .get();
    if (!entry) return { status: 'not_found' };
    if (!entry.reversible) {
      return {
        status: 'irreversible',
        message: 'This action cannot be undone.',
      };
    }
    // If the entry was already undone, refs_json.undone === true.
    const refs = this.parseRefs(entry.related_refs_json);
    if (refs.undone) {
      return { status: 'already_undone' };
    }

    switch (entry.category) {
      case 'assignment':
        return this.undoAssignment(entry, refs);
      case 'memory_added':
        return this.undoMemoryAdded(entry, refs);
      case 'message_sent':
        return this.undoMessageSent(entry, refs);
      default:
        return {
          status: 'irreversible',
          message: `No undo handler registered for category "${entry.category}".`,
        };
    }
  }

  // ---------- mappers ----------

  private mapEvent(event: AihousekeeperEvent): {
    category: TrustLedgerCategory;
    summary: string;
    rationale: string;
    reversible: boolean;
    undoToken?: string;
    relatedRefs?: Record<string, unknown>;
  } | null {
    switch (event.kind) {
      case 'memory_written':
        return {
          category: 'memory_added',
          summary: `Remembered: ${event.summary}`,
          rationale: `Stored as ${event.memoryType} memory.`,
          reversible: true,
          relatedRefs: { memoryId: event.memoryId, memoryType: event.memoryType },
        };
      case 'memory_evicted':
        return {
          category: 'memory_added',
          summary: `Evicted ${event.count} old memor${event.count === 1 ? 'y' : 'ies'}`,
          rationale:
            'Household memory cap of 500 entries reached; lowest-scoring non-question memories removed.',
          reversible: false,
        };
      case 'briefing_composed':
        return {
          category: 'decision',
          summary:
            event.result === 'composed'
              ? `Composed briefing for ${event.date}`
              : `Empty briefing for ${event.date}: ${event.reason ?? 'no_signals'}`,
          rationale: 'Morning briefing orchestration.',
          reversible: false,
          relatedRefs: { date: event.date, result: event.result },
        };
      case 'briefing_pushed':
        return {
          category: 'message_sent',
          summary: `Pushed briefing for ${event.date}`,
          rationale: 'Briefing delivered via push notification.',
          reversible: false,
          relatedRefs: { date: event.date, messageId: event.messageId },
        };
      case 'outbound_sent':
        return {
          category: 'message_sent',
          summary: `${event.channel.toUpperCase()} sent: ${event.template}`,
          rationale: 'Outbound message dispatched via OutboundDispatcher.',
          reversible: false,
          relatedRefs: {
            channel: event.channel,
            template: event.template,
            idempotencyKey: event.idempotencyKey,
          },
        };
      case 'outbound_skipped':
        // We still record skip outcomes so the dashboard attributes
        // non-delivery, but they are not reversible and live under `decision`.
        return {
          category: 'decision',
          summary: `${event.channel.toUpperCase()} skipped: ${event.reason}`,
          rationale: `Gate denied: ${event.reason}.`,
          reversible: false,
          relatedRefs: { channel: event.channel, reason: event.reason },
        };
      case 'followup_scheduled':
        return {
          category: 'followup_scheduled',
          summary: `Scheduled followup for ${event.scheduledFor}`,
          rationale: 'User- or self-scheduled followup.',
          reversible: true,
          relatedRefs: { followupId: event.followupId, scheduledFor: event.scheduledFor },
        };
      case 'followup_fired':
        return {
          category: 'decision',
          summary:
            event.decision === 'notify'
              ? `Fired followup: notified user`
              : `Fired followup: closed silently (${event.rationale})`,
          rationale: event.rationale,
          reversible: false,
          relatedRefs: { followupId: event.followupId, decision: event.decision },
        };
      case 'task_assigned':
        return {
          category: 'assignment',
          summary: `Assigned task to member`,
          rationale: event.reason,
          reversible: true,
          relatedRefs: { taskId: event.taskId, memberId: event.memberId },
        };
      case 'delegation_drafted':
        return {
          category: 'decision',
          summary: `Drafted ${event.tool}`,
          rationale: 'Aihousekeeper prepared an outgoing message for user approval.',
          reversible: true,
          relatedRefs: { tool: event.tool, draftId: event.draftId },
        };
      case 'delegation_sent':
        return {
          category: 'message_sent',
          summary: `Sent ${event.tool}`,
          rationale: 'User-approved delegation dispatched.',
          reversible: false,
          relatedRefs: { tool: event.tool, draftId: event.draftId },
        };
      case 'decision_made':
        return {
          category: 'decision',
          summary: event.summary,
          rationale: event.rationale,
          reversible: event.reversible,
          undoToken: event.undoToken,
        };
      default:
        return null;
    }
  }

  // ---------- undo handlers ----------

  private async undoAssignment(
    entry: AssistantTrustLedgerEntry,
    refs: Record<string, unknown>
  ): Promise<UndoResult> {
    const taskId = typeof refs.taskId === 'string' ? refs.taskId : null;
    if (!taskId) {
      return { status: 'irreversible', message: 'Missing task reference.' };
    }
    await this.db
      .update(tasks)
      .set({ assigned_to: null })
      .where(eq(tasks.id, taskId));
    await this.markUndone(entry.id, refs);
    return { status: 'undone' };
  }

  private async undoMemoryAdded(
    entry: AssistantTrustLedgerEntry,
    refs: Record<string, unknown>
  ): Promise<UndoResult> {
    const memoryId = typeof refs.memoryId === 'string' ? refs.memoryId : null;
    if (!memoryId) {
      return { status: 'irreversible', message: 'Missing memory reference.' };
    }
    await this.db.delete(assistantMemory).where(eq(assistantMemory.id, memoryId));
    await this.markUndone(entry.id, refs);
    return { status: 'undone' };
  }

  private async undoMessageSent(
    entry: AssistantTrustLedgerEntry,
    refs: Record<string, unknown>
  ): Promise<UndoResult> {
    // Cannot un-send a delivered message; record the user's intent and
    // surface an explanation. The outbound_log row gets user_action='undone'.
    const idempotencyKey =
      typeof refs.idempotencyKey === 'string' ? refs.idempotencyKey : null;
    if (idempotencyKey) {
      await this.db
        .update(assistantOutboundLog)
        .set({ user_action: 'undone' })
        .where(
          and(
            eq(assistantOutboundLog.household_id, entry.household_id),
            eq(assistantOutboundLog.idempotency_key, idempotencyKey)
          )
        );
    }
    await this.markUndone(entry.id, refs);
    return {
      status: 'undone',
      message:
        'Marked as undone, but the message was already delivered and cannot be recalled.',
    };
  }

  private async markUndone(
    ledgerId: string,
    refs: Record<string, unknown>
  ): Promise<void> {
    const nextRefs = { ...refs, undone: true, undone_at: nowIso() };
    await this.db
      .update(assistantTrustLedger)
      .set({ related_refs_json: JSON.stringify(nextRefs) })
      .where(eq(assistantTrustLedger.id, ledgerId));
  }

  private parseRefs(raw: string | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
