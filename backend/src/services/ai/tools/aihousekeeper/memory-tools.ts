/**
 * Aihousekeeper memory tools — plan §4 / §C1.
 *
 * Four tools exposed to Aihousekeeper across every chat mode. All four wrap a
 * `MemoryService` method. The `recall` tool is the load-bearing PII safety
 * surface: it MUST NEVER return the raw `body` — only `redacted_body`. The
 * only non-LLM path to raw `body` is the Settings → Aihousekeeper → What I remember
 * screen, which queries D1 directly (not via a tool).
 *
 * Tool kinds:
 *   - recall          → READ
 *   - remember        → LOW_WRITE   (service emits `memory_written`)
 *   - forget          → LOW_WRITE   (ledger audit via dispatch context)
 *   - update_memory   → LOW_WRITE   (service emits on supersede/write)
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { assistantMemory } from '../../../../db/schema-aihousekeeper';
import type { AssistantMemory } from '../../../../db/schema-aihousekeeper';
import { sha256Hex } from '../../../aihousekeeper/event-bus';
import type { MemoryType, MemorySource } from '../../../aihousekeeper/memory-service';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

// ---------- shared input pieces ----------

const MEMORY_TYPES = [
  'fact',
  'preference',
  'history',
  'decision',
  'unresolved_question',
] as const;

type RecalledRow = {
  id: string;
  type: MemoryType;
  subject_kind: string | null;
  subject_id: string | null;
  redacted_body: string | null;
  confidence: number;
  created_at: string;
  is_anniversary_tracked: boolean;
};

/**
 * Strip the raw `body` / `source_ref` / `source` fields before ever handing a
 * memory row back to the LLM. `redacted_body` is nullable in the schema for
 * legacy rows; we fall back to a literal placeholder rather than leaking the
 * raw body.
 */
function toSafeRecalledRow(row: AssistantMemory): RecalledRow {
  return {
    id: row.id,
    type: row.type as MemoryType,
    subject_kind: row.subject_kind ?? null,
    subject_id: row.subject_id ?? null,
    // Never include `body`; if redacted_body is missing (null), substitute a
    // placeholder. This guarantees the returned record never contains raw PII.
    redacted_body: row.redacted_body ?? '[redacted]',
    confidence: row.confidence,
    created_at: row.created_at,
    is_anniversary_tracked: Boolean(row.is_anniversary_tracked),
  };
}

// ============ recall ============

export const recall: AihousekeeperTool = {
  name: 'recall',
  kind: 'READ',
  description:
    'Search the household memory store. Returns only redacted bodies — never raw PII. Scored by FTS5 bm25 + confidence + recency.',
  input: z.object({
    query: z.string().min(1).max(500),
    limit: z.number().int().positive().max(25).optional(),
    types: z.array(z.enum(MEMORY_TYPES)).optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    // Household membership check — shared by every Aihousekeeper tool.
    await ctx.householdService.getHousehold(ctx.householdId, ctx.userId);

    const limit = input.limit ?? 8;
    const rows = await ctx.memory.recall(ctx.householdId, input.query, limit);

    // Optional post-filter by type. We do this after recall() because the
    // MemoryService.recall signature doesn't accept a type filter — and doing
    // it here is cheap (small result set).
    const filtered = input.types
      ? rows.filter((r) => (input.types as readonly MemoryType[]).includes(r.type as MemoryType))
      : rows;

    return {
      ok: true,
      // IMPORTANT: results contain ONLY redacted_body. Grep test:
      // `grep "redacted_body" memory-tools.ts` >= 1 hit.
      results: filtered.map(toSafeRecalledRow),
    };
  },
};

// ============ remember ============

export const remember: AihousekeeperTool = {
  name: 'remember',
  kind: 'LOW_WRITE',
  description:
    'Persist a new memory about the household. The service redacts PII (Haiku or regex fallback) before storing.',
  input: z.object({
    type: z.enum(MEMORY_TYPES),
    body: z.string().min(1).max(4000),
    subject_kind: z.string().max(64).optional(),
    subject_id: z.string().max(128).optional(),
    confidence: z.number().min(0).max(1).optional(),
    expires_in_days: z.number().int().positive().max(3650).optional(),
    is_anniversary_tracked: z.boolean().optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    await ctx.householdService.getHousehold(ctx.householdId, ctx.userId);

    const source: MemorySource = 'user_said';
    const written = await ctx.memory.write({
      householdId: ctx.householdId,
      type: input.type,
      body: input.body,
      subjectKind: input.subject_kind,
      subjectId: input.subject_id,
      confidence: input.confidence,
      source,
      sourceRef: `tool:remember:${ctx.userId.slice(0, 8)}`,
      expiresInDays: input.expires_in_days,
      isAnniversaryTracked: input.is_anniversary_tracked,
    });

    // MemoryService.write already emits `memory_written`; no extra event here.
    return {
      ok: true,
      memory_id: written.id,
      type: written.type,
      // Return redacted_body (never the raw body the caller just sent).
      redacted_body: written.redacted_body ?? '[redacted]',
    };
  },
};

// ============ forget ============

export const forget: AihousekeeperTool = {
  name: 'forget',
  kind: 'LOW_WRITE',
  description:
    'Hard-delete a memory by id. Used when the user asks Aihousekeeper to "forget" something.',
  input: z.object({
    memory_id: z.string().min(1),
    reason: z.string().min(1).max(500),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    await ctx.householdService.getHousehold(ctx.householdId, ctx.userId);

    // Verify the memory belongs to this household before letting the service
    // delete it. MemoryService.forget does not cross-check household_id.
    const row = await ctx.db
      .select({
        id: assistantMemory.id,
        household_id: assistantMemory.household_id,
      })
      .from(assistantMemory)
      .where(eq(assistantMemory.id, input.memory_id))
      .get();
    if (!row || row.household_id !== ctx.householdId) {
      return { ok: false, error: 'memory_not_found' };
    }

    await ctx.memory.forget(input.memory_id, input.reason);

    // Emit an audit event so the ledger records the user-initiated deletion.
    // The reason lives in the event payload's summary (truncated).
    const idem = await sha256Hex(`memory_forgotten:${input.memory_id}:${input.reason.slice(0, 32)}`);
    await ctx.events.emit({
      kind: 'decision_made',
      householdId: ctx.householdId,
      eventIdempotencyKey: idem,
      summary: `Memory ${input.memory_id.slice(0, 8)}… forgotten`,
      rationale: input.reason.slice(0, 200),
      reversible: false,
    });

    return { ok: true, memory_id: input.memory_id };
  },
};

// ============ update_memory ============

export const updateMemory: AihousekeeperTool = {
  name: 'update_memory',
  kind: 'LOW_WRITE',
  description:
    'Replace a memory with an updated body. The old row is marked superseded_by_id; a new row is written.',
  input: z.object({
    memory_id: z.string().min(1),
    new_body: z.string().min(1).max(4000),
    reason: z.string().min(1).max(500),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    await ctx.householdService.getHousehold(ctx.householdId, ctx.userId);

    // Bounds check — supersede() throws a plain Error if the id is unknown.
    // That would surface as a tool failure; preflight so we can return a
    // predictable ToolResult shape instead.
    const existing = await ctx.db
      .select({
        id: assistantMemory.id,
        household_id: assistantMemory.household_id,
      })
      .from(assistantMemory)
      .where(
        and(
          eq(assistantMemory.id, input.memory_id),
          eq(assistantMemory.household_id, ctx.householdId),
          isNull(assistantMemory.superseded_by_id)
        )
      )
      .get();
    if (!existing) {
      return { ok: false, error: 'memory_not_found_or_superseded' };
    }

    const replacement = await ctx.memory.supersede(
      input.memory_id,
      input.new_body,
      input.reason
    );

    return {
      ok: true,
      superseded_memory_id: input.memory_id,
      new_memory_id: replacement.id,
      redacted_body: replacement.redacted_body ?? '[redacted]',
    };
  },
};

// ---------- list export for registry wiring (C6) ----------

export const memoryTools: readonly AihousekeeperTool[] = [
  recall,
  remember,
  forget,
  updateMemory,
] as const;

