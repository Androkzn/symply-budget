/**
 * Aihousekeeper memory-prefix builder — plan §B2.
 *
 * Produces the `region 3` content (the dynamic per-turn memory block) that
 * is prepended to the user turn alongside a cached system+identity prefix.
 *
 * **PII invariant (plan §B2 W1/W3):** every string that leaves this builder
 * and every candidate string fed to the Haiku relevance scorer MUST be
 * `redacted_body`, never `body`. The raw `body` column is for the user's
 * audit surface (Settings → Aihousekeeper → What I remember) only.
 *
 * Shape:
 *   <aihousekeeper_memory>
 *     <facts>top-3 `fact` entries (redacted_body)</facts>
 *     <open_questions>all open `unresolved_question` entries (≤5)</open_questions>
 *     <relevant>top-(8 - fixed) from Haiku scorer</relevant>
 *   </aihousekeeper_memory>
 *
 * Caps: ≤8 entries total, ≤1200 rendered tokens (≈4800 chars).
 */

import type { AIProvider } from '../../../ai/provider';
import type { Env } from '../../../types';
import type { MemoryService } from '../../aihousekeeper/memory-service';

const MAX_ENTRIES = 8;
const MAX_RENDERED_CHARS = 1200 * 4; // ~4 chars/token heuristic
const CANDIDATE_POOL_SIZE = 20;

interface Scored {
  id: string;
  text: string; // redacted_body only
  confidence: number;
  kind: 'fact' | 'open_question' | 'relevant';
}

const RELEVANCE_SYSTEM = `You rank memory snippets by relevance to a user message. Return an array of indexes (0-based), most relevant first. Output only the selected indexes, up to the count requested.`;

const RELEVANCE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['indexes'],
  properties: {
    indexes: {
      type: 'array',
      items: { type: 'integer', minimum: 0 },
    },
  },
};

export class MemoryPrefixBuilder {
  private memory: MemoryService;
  private ai: AIProvider;
  private env: Env;

  constructor(memory: MemoryService, ai: AIProvider, env: Env) {
    this.memory = memory;
    this.ai = ai;
    this.env = env;
  }

  /**
   * Build the region-3 block. Returns the rendered string and the count of
   * entries actually included after cap enforcement.
   */
  async build(
    householdId: string,
    userMessage: string
  ): Promise<{ region3: string; scoredCount: number }> {
    // ---------- 1. Top-3 highest-confidence facts (redacted_body only) ----------
    const allFacts = await this.memory.list(householdId, {
      type: 'fact',
      limit: 50,
    });
    const facts = [...allFacts]
      .filter((f) => !!f.redacted_body)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, 3);

    // ---------- 2. Open unresolved_question entries (≤5) ----------
    const openQuestions = (
      await this.memory.list(householdId, { type: 'unresolved_question', limit: 5 })
    ).filter((q) => !!q.redacted_body);

    const fixed: Scored[] = [
      ...facts.map<Scored>((m) => ({
        id: m.id,
        text: m.redacted_body ?? '',
        confidence: m.confidence ?? 0,
        kind: 'fact',
      })),
      ...openQuestions.map<Scored>((m) => ({
        id: m.id,
        text: m.redacted_body ?? '',
        confidence: m.confidence ?? 0,
        kind: 'open_question',
      })),
    ];

    const relevantSlotCount = Math.max(0, MAX_ENTRIES - fixed.length);

    // ---------- 3. Relevance candidates via recall, scored by Haiku ----------
    const candidates = relevantSlotCount > 0
      ? await this.memory.recall(householdId, userMessage, CANDIDATE_POOL_SIZE)
      : [];

    // PII invariant — project redacted_body only. If a memory somehow lacks
    // redacted_body (migration backfill gap), skip it rather than leak body.
    const scorable = candidates
      .filter((c) => !!c.redacted_body)
      .filter((c) => !fixed.some((f) => f.id === c.id));

    let relevant: Scored[] = [];
    if (relevantSlotCount > 0 && scorable.length > 0) {
      relevant = await this.scoreRelevant(
        userMessage,
        scorable.map((c) => ({
          id: c.id,
          text: c.redacted_body ?? '',
          confidence: c.confidence ?? 0,
        })),
        relevantSlotCount
      );
    }

    // ---------- 4. Assemble under entry cap + char cap ----------
    const combined = [...fixed, ...relevant];
    const capped = this.applyCaps(combined);

    // ---------- 5. Render ----------
    const region3 = this.render(capped);
    return { region3, scoredCount: capped.length };
  }

  // ---------- internals ----------

  private async scoreRelevant(
    userMessage: string,
    pool: Array<{ id: string; text: string; confidence: number }>,
    pickCount: number
  ): Promise<Scored[]> {
    // Build a short user prompt that includes the candidate set. Candidates
    // are `redacted_body` only — the scorer never sees raw body.
    const candidatesBlock = pool
      .map((p, idx) => `[${idx}] ${p.text}`)
      .join('\n');
    const prompt = `User message:\n${userMessage}\n\nCandidates:\n${candidatesBlock}\n\nReturn the top ${pickCount} most relevant candidate indexes.`;

    try {
      const result = await this.ai.generateStructured<{ indexes: number[] }>({
        model: this.env.AIHOUSEKEEPER_NUDGE_MODEL,
        systemPrompt: RELEVANCE_SYSTEM,
        userPrompt: prompt,
        schema: RELEVANCE_SCHEMA,
        maxTokens: 256,
      });
      const picks = (result.indexes ?? [])
        .filter((i) => Number.isInteger(i) && i >= 0 && i < pool.length)
        .slice(0, pickCount);
      return picks.map((i) => ({
        id: pool[i].id,
        text: pool[i].text,
        confidence: pool[i].confidence,
        kind: 'relevant',
      }));
    } catch {
      // On scorer failure, fall back to BM25 order (already sorted by the
      // MemoryService.recall call). Take the first `pickCount`.
      return pool.slice(0, pickCount).map((p) => ({
        id: p.id,
        text: p.text,
        confidence: p.confidence,
        kind: 'relevant',
      }));
    }
  }

  private applyCaps(entries: Scored[]): Scored[] {
    // Entry cap first.
    const byEntry = entries.slice(0, MAX_ENTRIES);
    // Char cap: if over, drop lowest-confidence entries until under.
    let running = byEntry.map((e) => e.text.length).reduce((a, b) => a + b, 0);
    if (running <= MAX_RENDERED_CHARS) return byEntry;

    const sortedByConfidenceDesc = [...byEntry].sort(
      (a, b) => b.confidence - a.confidence
    );
    const kept: Scored[] = [];
    running = 0;
    for (const e of sortedByConfidenceDesc) {
      if (running + e.text.length > MAX_RENDERED_CHARS) continue;
      kept.push(e);
      running += e.text.length;
    }
    // Preserve the original grouping order (facts → questions → relevant).
    return byEntry.filter((e) => kept.some((k) => k.id === e.id));
  }

  private render(entries: Scored[]): string {
    const facts = entries.filter((e) => e.kind === 'fact');
    const questions = entries.filter((e) => e.kind === 'open_question');
    const relevant = entries.filter((e) => e.kind === 'relevant');
    const renderList = (items: Scored[]) =>
      items.map((i) => `  - ${i.text.replace(/\s+/g, ' ').trim()}`).join('\n');
    return [
      '<aihousekeeper_memory>',
      '  <facts>',
      renderList(facts) || '  (none)',
      '  </facts>',
      '  <open_questions>',
      renderList(questions) || '  (none)',
      '  </open_questions>',
      '  <relevant>',
      renderList(relevant) || '  (none)',
      '  </relevant>',
      '</aihousekeeper_memory>',
    ].join('\n');
  }
}
