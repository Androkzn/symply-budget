/**
 * Kaizen — Kaizen Brain token budget
 *
 * Enforces a strict, surface-tuned token budget on the assembled system context
 * (plan: "Render a surface-tuned snapshot with a strict token budget").
 *
 * We use a cheap, deterministic char-based heuristic (≈4 chars/token) rather
 * than a real tokenizer — good enough to keep prompts bounded inside a Worker
 * without pulling a tokenizer dependency. The estimate is intentionally
 * conservative (rounds up).
 */

import type { ContextPrivacyScope } from '../context/snapshotRenderer';

const CHARS_PER_TOKEN = 4;

/** Approximate token count for a string. Deterministic, no allocation-heavy work. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Per-surface token budgets for the assembled context block (snapshot +
 * retrieved memory/knowledge). The chat history and tool-result payloads are
 * budgeted separately by the caller; this governs the *context* portion.
 */
export const SURFACE_CONTEXT_BUDGET: Record<ContextPrivacyScope, number> = {
  coachChat: 1200,
  assessment: 500,
  progressExplain: 700,
  memoryWrite: 300,
  importReview: 500,
};

export function budgetForSurface(scope: ContextPrivacyScope): number {
  return SURFACE_CONTEXT_BUDGET[scope] ?? SURFACE_CONTEXT_BUDGET.coachChat;
}

export interface BudgetTrimResult {
  text: string;
  estimatedTokens: number;
  budgetTokens: number;
  truncated: boolean;
}

/**
 * Trim a context block to fit a token budget. Trims whole lines from the end
 * (keeping the highest-priority sections, which the renderer emits first) and
 * appends a truncation marker so the model knows context was clipped.
 */
export function fitToBudget(text: string, budgetTokens: number): BudgetTrimResult {
  const estimated = estimateTokens(text);
  if (estimated <= budgetTokens) {
    return { text, estimatedTokens: estimated, budgetTokens, truncated: false };
  }

  const lines = text.split('\n');
  const kept: string[] = [];
  let runningTokens = 0;
  const marker = '… [context trimmed to fit budget]';
  const markerTokens = estimateTokens(marker);

  for (const l of lines) {
    const t = estimateTokens(l) + 1; // +1 for the newline
    if (runningTokens + t + markerTokens > budgetTokens) break;
    kept.push(l);
    runningTokens += t;
  }

  kept.push(marker);
  const trimmed = kept.join('\n');
  return {
    text: trimmed,
    estimatedTokens: estimateTokens(trimmed),
    budgetTokens,
    truncated: true,
  };
}
