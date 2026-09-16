/**
 * Aihousekeeper memory service — plan §B1.
 *
 * Responsible for:
 *  - Writing memories with PII redaction (Haiku-preferred, regex fallback).
 *  - FTS5-backed two-pass recall (D1 pass 1, TS pass 2 for recency).
 *  - Supersede / forget / list.
 *  - 500-entry-per-household cap with LRU + decay-by-confidence eviction
 *    (unresolved questions are immune).
 *
 * Emits AihousekeeperEvents (`memory_written`, `memory_evicted`) via the injected
 * AihousekeeperEventBus. The ledger subscriber turns these into ledger rows.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import type { AIProvider } from '../../ai/provider';
import { assistantMemory } from '../../db/schema-aihousekeeper';
import type { AssistantMemory, NewAssistantMemory } from '../../db/schema-aihousekeeper';
import type { Database, Env } from '../../types';
import { generateId, now as nowIso } from '../../utils/id';

import { AihousekeeperEventBus, sha256Hex } from './event-bus';
import { regexScrub } from './regex-scrubber';

export type MemoryType =
  | 'fact'
  | 'preference'
  | 'history'
  | 'decision'
  | 'unresolved_question';

export type MemorySource =
  | 'user_said'
  | 'inferred'
  | 'tool_result'
  | 'external_signal';

export interface WriteInput {
  householdId: string;
  type: MemoryType;
  body: string;
  subjectKind?: string;
  subjectId?: string;
  confidence?: number;
  source: MemorySource;
  sourceRef?: string;
  expiresInDays?: number;
  isAnniversaryTracked?: boolean;
}

export interface MemoryListOpts {
  type?: MemoryType;
  limit?: number;
  includeSuperseded?: boolean;
}

export interface RecallCandidate extends AssistantMemory {
  bm25: number;
  score: number;
}

const MEMORY_CAP = 500;

const HAIKU_REDACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['redacted'],
  properties: {
    redacted: {
      type: 'string',
      description:
        'The body text with PII (names, phone, SSN, email, address, credit card, DOB) replaced by the literal token [redacted].',
    },
  },
};

const HAIKU_REDACTION_SYSTEM = `You redact PII from user-authored memory text. Return the same text with names, phone numbers, SSNs, emails, physical addresses, credit card numbers, and dates of birth replaced by the literal token "[redacted]". Preserve all other words verbatim. Never add commentary or rephrase.`;

export class MemoryService {
  private db: Database;
  private d1: D1Database;
  private ai: AIProvider;
  private events: AihousekeeperEventBus;
  private env: Env;
  private redactionModel: string;

  constructor(params: {
    db: Database;
    d1: D1Database;
    ai: AIProvider;
    events: AihousekeeperEventBus;
    env: Env;
  }) {
    this.db = params.db;
    this.d1 = params.d1;
    this.ai = params.ai;
    this.events = params.events;
    this.env = params.env;
    // Redaction uses the nudge (Haiku-class) model to keep costs low.
    this.redactionModel = params.env.AIHOUSEKEEPER_NUDGE_MODEL;
  }

  /**
   * Write a new memory. Produces `redacted_body` via Haiku (flag-gated) or
   * regex scrubber. Inserts both `body` (audit) and `redacted_body` (prompt
   * injection). Triggers eviction sweep at the end.
   */
  async write(input: WriteInput): Promise<AssistantMemory> {
    const redactedBody = await this.buildRedactedBody(input.body);
    const id = generateId();
    const ts = nowIso();

    const row: NewAssistantMemory = {
      id,
      household_id: input.householdId,
      type: input.type,
      subject_kind: input.subjectKind,
      subject_id: input.subjectId,
      body: input.body,
      redacted_body: redactedBody,
      confidence: input.confidence ?? 0.7,
      source: input.source,
      source_ref: input.sourceRef,
      is_anniversary_tracked: input.isAnniversaryTracked ?? false,
      created_at: ts,
      last_used_at: null,
      expires_at:
        input.expiresInDays != null
          ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
          : null,
      superseded_by_id: null,
    };

    await this.db.insert(assistantMemory).values(row);

    const inserted = await this.db
      .select()
      .from(assistantMemory)
      .where(eq(assistantMemory.id, id))
      .get();

    // Emit event for ledger.
    const idem = await sha256Hex(`memory_written:${id}`);
    await this.events.emit({
      kind: 'memory_written',
      householdId: input.householdId,
      eventIdempotencyKey: idem,
      memoryId: id,
      memoryType: input.type,
      // Summary uses redacted_body to avoid leaking PII into the ledger.
      summary: redactedBody.slice(0, 120),
    });

    // Cap enforcement runs after every write.
    await this.evictIfOverCap(input.householdId);

    // `inserted` cannot reasonably be undefined right after a successful
    // insert, but narrow for TS.
    if (!inserted) {
      throw new Error(`MemoryService.write: insert succeeded but row not found (${id})`);
    }
    return inserted;
  }

  /**
   * Mark `id` as superseded by a new memory with `newBody`. Writes the new
   * memory first, then UPDATEs the old row's `superseded_by_id`.
   */
  async supersede(
    id: string,
    newBody: string,
    reason: string
  ): Promise<AssistantMemory> {
    const existing = await this.db
      .select()
      .from(assistantMemory)
      .where(eq(assistantMemory.id, id))
      .get();
    if (!existing) {
      throw new Error(`MemoryService.supersede: memory ${id} not found`);
    }
    const replacement = await this.write({
      householdId: existing.household_id,
      type: existing.type as MemoryType,
      body: newBody,
      subjectKind: existing.subject_kind ?? undefined,
      subjectId: existing.subject_id ?? undefined,
      confidence: existing.confidence,
      source: existing.source as MemorySource,
      sourceRef: `supersede:${id}:${reason}`,
      isAnniversaryTracked: existing.is_anniversary_tracked,
    });
    await this.db
      .update(assistantMemory)
      .set({ superseded_by_id: replacement.id })
      .where(eq(assistantMemory.id, id));
    return replacement;
  }

  /**
   * Hard-delete a memory. Used for the `forget` tool + for user-initiated
   * deletions via Settings → Aihousekeeper → What I remember.
   */
  async forget(id: string, _reason: string): Promise<void> {
    await this.db.delete(assistantMemory).where(eq(assistantMemory.id, id));
  }

  /**
   * Non-superseded memories, optionally filtered by type.
   */
  async list(
    householdId: string,
    opts: MemoryListOpts = {}
  ): Promise<AssistantMemory[]> {
    const conditions = [eq(assistantMemory.household_id, householdId)];
    if (!opts.includeSuperseded) {
      conditions.push(isNull(assistantMemory.superseded_by_id));
    }
    if (opts.type) {
      conditions.push(eq(assistantMemory.type, opts.type));
    }
    const q = this.db
      .select()
      .from(assistantMemory)
      .where(and(...conditions));
    const rows = await (opts.limit ? q.limit(opts.limit).all() : q.all());
    return rows;
  }

  /**
   * Two-pass FTS5-backed recall.
   *
   * Pass 1 (D1 raw SQL — FTS5 virtual table is not Drizzle-modeled):
   *   bm25 + confidence rank over non-superseded household memories.
   *   LIMIT = 3 × target.
   *
   * Pass 2 (TS): re-rank with recency boost (exp(-ageDays/30)), slice.
   */
  async recall(
    householdId: string,
    query: string,
    limit = 8
  ): Promise<AssistantMemory[]> {
    const passOneLimit = Math.max(limit * 3, 12);
    const ftsQuery = this.sanitizeFtsQuery(query);
    if (!ftsQuery) return [];

    // Raw SQL for FTS5 — see schema-aihousekeeper.ts comment: assistant_memory_fts is
    // SQL-only, not mirrored in Drizzle.
    const sqlText = `
      SELECT m.id, m.household_id, m.type, m.subject_kind, m.subject_id,
             m.body, m.redacted_body, m.confidence, m.source, m.source_ref,
             m.is_anniversary_tracked, m.created_at, m.last_used_at,
             m.expires_at, m.superseded_by_id,
             bm25(assistant_memory_fts) AS bm25
      FROM assistant_memory m
      JOIN assistant_memory_fts f ON f.rowid = m.rowid
      WHERE assistant_memory_fts MATCH ?
        AND m.household_id = ?
        AND m.superseded_by_id IS NULL
      ORDER BY (bm25 * -1) + (m.confidence * 2.0) DESC
      LIMIT ?;
    `;
    const result = await this.d1
      .prepare(sqlText)
      .bind(ftsQuery, householdId, passOneLimit)
      .all<
        AssistantMemory & {
          bm25: number;
          is_anniversary_tracked: number | boolean;
        }
      >();
    const candidates = result.results ?? [];

    const now = new Date();
    const scored = candidates.map((c) => {
      const recency = this.recencyBoost(c.created_at, now);
      const score = -1 * (c.bm25 ?? 0) + (c.confidence ?? 0) * 2.0 + recency;
      return { row: c, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => ({
      ...s.row,
      // Drizzle types `is_anniversary_tracked` as boolean; raw SQL returns
      // 0/1. Normalize so callers don't see a leaking int.
      is_anniversary_tracked: Boolean(s.row.is_anniversary_tracked),
    }));
  }

  /**
   * Enforce the 500-per-household cap. Scored by (confidence, recency, last-used).
   * Unresolved questions are immune.
   */
  async evictIfOverCap(householdId: string): Promise<{ evicted: number }> {
    const countRow = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(assistantMemory)
      .where(
        and(
          eq(assistantMemory.household_id, householdId),
          isNull(assistantMemory.superseded_by_id)
        )
      )
      .get();
    const count = countRow?.count ?? 0;
    if (count <= MEMORY_CAP) return { evicted: 0 };
    const excess = count - MEMORY_CAP;

    // Pull candidate set (everything non-superseded, non-unresolved). Score
    // in TS so we can use exp() / normalized last_used.
    const candidates = await this.db
      .select()
      .from(assistantMemory)
      .where(
        and(
          eq(assistantMemory.household_id, householdId),
          isNull(assistantMemory.superseded_by_id)
        )
      )
      .all();

    const now = new Date();
    const evictable = candidates.filter((m) => m.type !== 'unresolved_question');
    if (evictable.length === 0) return { evicted: 0 };

    // Compute recency_01 and last_used_01 as 0..1 values relative to the
    // oldest (0) and newest (1) in the set. Confidence is already 0..1.
    const createdAtMs = evictable.map((m) => Date.parse(m.created_at));
    const minC = Math.min(...createdAtMs);
    const maxC = Math.max(...createdAtMs);
    const cSpan = Math.max(1, maxC - minC);

    const lastUsedMs = evictable.map((m) =>
      m.last_used_at ? Date.parse(m.last_used_at) : Date.parse(m.created_at)
    );
    const minU = Math.min(...lastUsedMs);
    const maxU = Math.max(...lastUsedMs);
    const uSpan = Math.max(1, maxU - minU);

    const scored = evictable.map((m, idx) => {
      const recency01 = (createdAtMs[idx] - minC) / cSpan;
      const lastUsed01 = (lastUsedMs[idx] - minU) / uSpan;
      const score =
        0.4 * (m.confidence ?? 0) + 0.3 * recency01 + 0.3 * lastUsed01;
      return { m, score };
    });
    scored.sort((a, b) => a.score - b.score); // ascending: lowest first is evicted
    const victims = scored.slice(0, excess).map((s) => s.m);
    if (victims.length === 0) return { evicted: 0 };

    // Batch delete. D1 does not expose a true batched Drizzle delete for an
    // IN-list of ids without building a placeholder string; iterate.
    for (const victim of victims) {
      await this.db
        .delete(assistantMemory)
        .where(eq(assistantMemory.id, victim.id));
    }
    // Mark used times on `now` — not relevant after DELETE; skipped.
    void now;

    const idem = await sha256Hex(
      `memory_evicted:${householdId}:${nowIso().slice(0, 13)}`
    );
    await this.events.emit({
      kind: 'memory_evicted',
      householdId,
      eventIdempotencyKey: idem,
      count: victims.length,
    });

    return { evicted: victims.length };
  }

  // ---------- internals ----------

  private async buildRedactedBody(body: string): Promise<string> {
    const aiEnabled =
      (await this.env.CONFIG_KV.get('aihousekeeper_memory_ai_redaction_enabled')) !== 'false';
    if (!aiEnabled) return regexScrub(body);
    try {
      const result = await this.ai.generateStructured<{ redacted: string }>({
        model: this.redactionModel,
        systemPrompt: HAIKU_REDACTION_SYSTEM,
        userPrompt: body,
        schema: HAIKU_REDACTION_SCHEMA,
        maxTokens: 1024,
      });
      if (typeof result?.redacted === 'string' && result.redacted.length > 0) {
        return result.redacted;
      }
      return regexScrub(body);
    } catch {
      // Any AI failure falls through to regex. Don't log the body.
      return regexScrub(body);
    }
  }

  private recencyBoost(createdAt: string, now: Date): number {
    const ageDays = (now.getTime() - Date.parse(createdAt)) / 86_400_000;
    if (!Number.isFinite(ageDays) || ageDays < 0) return 1;
    return Math.exp(-ageDays / 30); // half-life ~21d; tune after observation
  }

  /**
   * FTS5 MATCH accepts a query syntax that overlaps with user input. Strip
   * characters that would produce syntax errors and wrap tokens so the
   * search remains forgiving.
   */
  private sanitizeFtsQuery(query: string): string {
    const cleaned = query
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .slice(0, 12); // cap token count to bound cost
    if (cleaned.length === 0) return '';
    // OR-join; FTS5 MATCH default is AND, which is too strict for recall.
    return cleaned.map((t) => `"${t}"`).join(' OR ');
  }
}
