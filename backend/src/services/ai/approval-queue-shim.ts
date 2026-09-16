/**
 * Aihousekeeper HIGH_WRITE tool approval queue — plan §B19, v1.2 ADR-32.
 *
 * Writes parked tool invocations to `ai_tool_pending` (migration 0034) and
 * exposes list / approve / cancel / mark-executed operations. Class name kept
 * as `ApprovalQueueShim` so existing Stream C tool imports continue to work;
 * it is no longer a shim — the real table is live.
 *
 * Execution-on-approve is NOT wired in this module. Approving a parked row
 * flips status to `approved`; a downstream dispatcher (future session) reads
 * approved rows and runs the actual mutation by keying on `tool_name`. Until
 * that dispatcher lands, the approval is recorded but the mutation does not
 * automatically fire.
 */

import { and, desc, eq, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import type { AIToolPending, AIToolPendingStatus } from '../../db/schema';
import { aiToolPending } from '../../db/schema-ai-chat';
import { generateId, nowIso } from '../../utils/id';

export interface ParkForApprovalArgs {
  householdId: string;
  userId: string;
  toolName: string;
  input: Record<string, unknown>;
  idempotencyKey: string;
  /** Optional override; default is 72 hours from park time. */
  ttlSeconds?: number;
}

export interface ParkForApprovalResult {
  pendingId: string;
  /** 'parked' when a new row was written, 'deduplicated' when an existing pending row matched. */
  status: 'parked' | 'deduplicated';
  expiresAt: string;
}

const DEFAULT_TTL_SECONDS = 72 * 60 * 60; // 72 hours per plan §B19.

export class ApprovalQueueShim {
  private db: ReturnType<typeof drizzle>;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  /**
   * Park a HIGH_WRITE tool invocation for user approval.
   *
   * Idempotent on `(householdId, idempotencyKey)` — a second call with the same
   * key returns the existing row's id with `status: 'deduplicated'`.
   */
  async park(args: ParkForApprovalArgs): Promise<ParkForApprovalResult> {
    const ttlSec = args.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSec * 1000).toISOString();

    // Look up any existing row first so we can return a deduplicated result.
    const existing = await this.db
      .select()
      .from(aiToolPending)
      .where(
        and(
          eq(aiToolPending.household_id, args.householdId),
          eq(aiToolPending.idempotency_key, args.idempotencyKey)
        )
      )
      .get();

    if (existing) {
      return {
        pendingId: existing.id,
        status: 'deduplicated',
        expiresAt: existing.expires_at,
      };
    }

    const id = generateId();
    await this.db.insert(aiToolPending).values({
      id,
      household_id: args.householdId,
      user_id: args.userId,
      tool_name: args.toolName,
      input_json: JSON.stringify(args.input),
      idempotency_key: args.idempotencyKey,
      status: 'pending',
      expires_at: expiresAt,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    return { pendingId: id, status: 'parked', expiresAt };
  }

  /**
   * List pending approvals for a household (newest first). Defaults to
   * `status='pending'` but callers can pass any status filter.
   */
  async list(
    householdId: string,
    opts: { status?: AIToolPendingStatus; limit?: number } = {}
  ): Promise<AIToolPending[]> {
    const status = opts.status ?? 'pending';
    const limit = Math.min(opts.limit ?? 50, 200);
    const rows = await this.db
      .select()
      .from(aiToolPending)
      .where(
        and(
          eq(aiToolPending.household_id, householdId),
          eq(aiToolPending.status, status)
        )
      )
      .orderBy(desc(aiToolPending.created_at))
      .limit(limit)
      .all();
    return rows;
  }

  async get(pendingId: string): Promise<AIToolPending | null> {
    const row = await this.db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, pendingId))
      .get();
    return row ?? null;
  }

  /**
   * User approves a pending tool invocation. Status → 'approved'. Does NOT
   * execute the underlying mutation; a separate dispatcher (future session)
   * reads approved rows and runs the tool.
   */
  async approve(
    pendingId: string,
    approvingUserId: string
  ): Promise<AIToolPending | null> {
    const now = nowIso();
    const existing = await this.get(pendingId);
    if (!existing) return null;
    if (existing.status !== 'pending') return existing;

    await this.db
      .update(aiToolPending)
      .set({
        status: 'approved',
        approved_at: now,
        approved_by: approvingUserId,
        updated_at: now,
      })
      .where(eq(aiToolPending.id, pendingId));

    return { ...existing, status: 'approved', approved_at: now, approved_by: approvingUserId, updated_at: now };
  }

  /** User dismisses a pending tool invocation. Status → 'cancelled'. */
  async cancel(
    pendingId: string,
    cancellingUserId: string
  ): Promise<AIToolPending | null> {
    const now = nowIso();
    const existing = await this.get(pendingId);
    if (!existing) return null;
    if (existing.status !== 'pending') return existing;

    await this.db
      .update(aiToolPending)
      .set({
        status: 'cancelled',
        cancelled_at: now,
        cancelled_by: cancellingUserId,
        updated_at: now,
      })
      .where(eq(aiToolPending.id, pendingId));

    return {
      ...existing,
      status: 'cancelled',
      cancelled_at: now,
      cancelled_by: cancellingUserId,
      updated_at: now,
    };
  }

  /**
   * Dispatcher-side: after running an approved tool, record the outcome.
   * `result` becomes `execution_result_json`; `error` becomes
   * `execution_error` and sets status='failed'.
   *
   * Pass `options.requireStatus = 'approved'` to make the write a CAS — the
   * row is only flipped if it's still in that status. Used by the queue
   * handler so a delayed write can't clobber a state the user already
   * transitioned (e.g. via `/cancel`). Returns `true` when the row was
   * actually updated.
   */
  async markExecuted(
    pendingId: string,
    outcome:
      | { ok: true; result: Record<string, unknown> }
      | { ok: false; error: string },
    options?: { requireStatus?: AIToolPendingStatus }
  ): Promise<boolean> {
    const now = nowIso();
    const baseClauses = [eq(aiToolPending.id, pendingId)];
    if (options?.requireStatus) {
      baseClauses.push(eq(aiToolPending.status, options.requireStatus));
    }
    const where = baseClauses.length === 1 ? baseClauses[0] : and(...baseClauses);
    const setValues = outcome.ok
      ? {
          status: 'executed' as const,
          executed_at: now,
          execution_result_json: JSON.stringify(outcome.result),
          updated_at: now,
        }
      : {
          status: 'failed' as const,
          executed_at: now,
          execution_error: outcome.error,
          updated_at: now,
        };
    const result = await this.db
      .update(aiToolPending)
      .set(setValues)
      .where(where)
      .run();
    const changes =
      (result as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
    return changes > 0;
  }

  /**
   * Sweep pending rows whose `expires_at` has passed. Run from a cron job.
   * Returns the number of rows marked expired.
   */
  async sweepExpired(now: Date = new Date()): Promise<number> {
    const nowIso = now.toISOString();
    const result = await this.db
      .update(aiToolPending)
      .set({ status: 'expired', updated_at: nowIso })
      .where(
        and(
          eq(aiToolPending.status, 'pending'),
          lte(aiToolPending.expires_at, nowIso)
        )
      )
      .run();
    // D1 returns `meta.changes` via the underlying run() — drizzle wraps it.
    const changes = (result as { meta?: { changes?: number } } | undefined)?.meta?.changes;
    return typeof changes === 'number' ? changes : 0;
  }
}
