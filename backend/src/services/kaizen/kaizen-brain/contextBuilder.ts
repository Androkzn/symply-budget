/**
 * Kaizen — Kaizen Brain context builder
 *
 * Central context assembler for Kaizen Master and future Kaizen AI surfaces
 * (plan: "Kaizen Brain context assembly"). Mirrors the `Simple Language`
 * `ai-brain` central context builder.
 *
 * Responsibilities:
 *   1. Take the deterministic `KaizenContextSnapshot` provided by the client.
 *   2. Render a surface-tuned snapshot under a strict token budget.
 *   3. Retrieve relevant (already redacted) memory/knowledge chunks for the turn.
 *   4. Return { systemContextBlock, snapshot, retrievedKnowledge, trace }.
 *
 * It does NOT call the LLM and it does NOT compute any deterministic Kaizen
 * state — it only assembles context. The actual Kaizen Master persona prompt is
 * built by coach-chat/promptBuilder.ts; this brain produces the dynamic,
 * evidence-bearing CONTEXT block that the persona prompt wraps.
 */

import type { MemoryRecord } from '../context/memorySchema';
import { redactMemories, type RedactionResult } from '../context/redaction';
import {
  renderKaizenSnapshot,
  renderFreshnessBanner,
  type KaizenContextSnapshot,
  type SnapshotFreshnessMeta,
  type ContextPrivacyScope,
} from '../context/snapshotRenderer';

import { budgetForSurface, fitToBudget, estimateTokens } from './tokenBudget';

/** A retrieved knowledge/memory chunk rendered into the prompt (read-only). */
export interface RetrievedChunk {
  kind: 'memory' | 'knowledge';
  category?: string;
  text: string;
  /** Source attribution, e.g. "approved memory" or "PARA: Resource". */
  source?: string;
}

export interface KaizenContextInput {
  scope: ContextPrivacyScope;
  snapshot?: KaizenContextSnapshot;
  freshness?: SnapshotFreshnessMeta;
  /** Approved + opted-in user memories (already loaded; redaction applied here). */
  memories?: MemoryRecord[];
  /** Read-only knowledge chunks (resume facts, notes) already retrieved. */
  knowledge?: RetrievedChunk[];
  /** The latest user turn text, used only for cheap relevance ranking of memory. */
  latestUserText?: string;
  /** Allow opted-in sensitive memory through (only when disclosure acknowledged). */
  allowOptedInSensitive?: boolean;
}

/** Context-assembly trace, emitted for every turn (success and failure). */
export interface ContextAssemblyTrace {
  scope: ContextPrivacyScope;
  freshness: string;
  snapshotProvided: boolean;
  budgetTokens: number;
  estimatedTokens: number;
  truncated: boolean;
  memoriesConsidered: number;
  memoriesIncluded: number;
  memoryDropped: RedactionResult['droppedCounts'];
  knowledgeIncluded: number;
}

export interface KaizenContextResult {
  /** The assembled CONTEXT block to embed in the system prompt. */
  systemContextBlock: string;
  /** Echo of the snapshot consumed (never recomputed). */
  snapshot?: KaizenContextSnapshot;
  /** Read-only chunks that made it into the prompt. */
  retrievedKnowledge: RetrievedChunk[];
  trace: ContextAssemblyTrace;
}

/**
 * Cheap relevance score: count of shared lowercased word stems between the
 * memory fact and the latest user turn. Deterministic, no embeddings (v1).
 */
function relevanceScore(fact: string, query: string | undefined): number {
  if (!query) return 0;
  const terms = new Set(
    query
      .toLowerCase()
      .split(/[^a-zа-я0-9]+/i)
      .filter((w) => w.length > 3)
  );
  if (terms.size === 0) return 0;
  let score = 0;
  for (const w of fact.toLowerCase().split(/[^a-zа-я0-9]+/i)) {
    if (w.length > 3 && terms.has(w)) score++;
  }
  return score;
}

const MAX_MEMORY_CHUNKS = 12;

/**
 * Build the dynamic context block. Order matters: the renderer emits sections
 * highest-priority-first, and fitToBudget trims from the end, so the snapshot is
 * placed before the lower-priority retrieved memory/knowledge.
 */
export function buildKaizenContext(input: KaizenContextInput): KaizenContextResult {
  const scope = input.scope;
  const budgetTokens = budgetForSurface(scope);

  // 1. Render snapshot + freshness (deterministic, consumed not recomputed).
  const freshnessBanner = renderFreshnessBanner(input.freshness);
  const snapshotText = renderKaizenSnapshot(input.snapshot, scope);

  // 2. Redact + rank memories.
  const redaction = redactMemories(input.memories ?? [], {
    allowOptedInSensitive: input.allowOptedInSensitive,
  });
  const ranked = redaction.allowed
    .map((m) => ({ m, score: relevanceScore(m.fact, input.latestUserText) }))
    .sort((a, b) => b.score - a.score || (b.m.confidence ?? 0) - (a.m.confidence ?? 0))
    .slice(0, MAX_MEMORY_CHUNKS);

  const memoryChunks: RetrievedChunk[] = ranked.map(({ m }) => ({
    kind: 'memory',
    category: m.category,
    text: m.fact,
    source: 'approved memory',
  }));

  const knowledgeChunks = (input.knowledge ?? []).slice(0, MAX_MEMORY_CHUNKS);
  const retrievedKnowledge = [...memoryChunks, ...knowledgeChunks];

  // 3. Compose the full context block (snapshot first, then retrieval).
  const blocks: string[] = [freshnessBanner, snapshotText];
  if (memoryChunks.length > 0) {
    blocks.push(
      'KNOWN_ABOUT_USER (approved memory; treat as facts the user confirmed):\n' +
        memoryChunks.map((c) => `- [${c.category}] ${c.text}`).join('\n')
    );
  }
  if (knowledgeChunks.length > 0) {
    blocks.push(
      'RETRIEVED_KNOWLEDGE (read-only reference):\n' +
        knowledgeChunks.map((c) => `- ${c.source ? `(${c.source}) ` : ''}${c.text}`).join('\n')
    );
  }

  const composed = blocks.join('\n\n');
  const fitted = fitToBudget(composed, budgetTokens);

  const trace: ContextAssemblyTrace = {
    scope,
    freshness: input.freshness?.freshness ?? 'partial',
    snapshotProvided: Boolean(input.snapshot),
    budgetTokens,
    estimatedTokens: fitted.estimatedTokens,
    truncated: fitted.truncated,
    memoriesConsidered: (input.memories ?? []).length,
    memoriesIncluded: memoryChunks.length,
    memoryDropped: redaction.droppedCounts,
    knowledgeIncluded: knowledgeChunks.length,
  };

  return {
    systemContextBlock: fitted.text,
    snapshot: input.snapshot,
    retrievedKnowledge,
    trace,
  };
}

/** Exposed for callers that want to size the persona prompt against the budget. */
export { estimateTokens };
