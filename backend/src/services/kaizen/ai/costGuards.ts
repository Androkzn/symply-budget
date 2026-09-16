// ============================================================================
// LIFE OS — AI COST GUARDS
// ============================================================================
//
// Per-user/day operation quotas for the Kaizen AI routes. Each call is keyed
//   kaizen:<userId>:<operation>:<YYYY-MM-DD>
// and counted in a D1 counter table. When a user is over the per-operation
// daily cap, the route returns `{ error, degraded: true }` with HTTP 429 BEFORE
// the provider call, so a seed burst can't fan out into provider spend.
//
// STORAGE NOTE: this codebase's `Env` exposes only a D1 binding (`DB`) — there
// is no KVNamespace (see src/types/env.ts). We therefore use a D1 counter table
// created lazily via `CREATE TABLE IF NOT EXISTS`. If D1 is unavailable for a
// request, we fall back to a best-effort in-memory counter scoped to the Worker
// isolate. LIMITATION: the in-memory fallback is per-isolate and not durable —
// across many isolates it under-counts, so it is a soft backstop only, not a
// hard guarantee. The D1 path is the authoritative one.
// ============================================================================

import type { Context } from 'hono';

import type { Env } from '../../../types';
import { nowIso } from '../../../utils/id';

export type KaizenAIOperation =
  | 'scoring' // interview answer scoring (LLM-as-judge)
  | 'idealGeneration' // ideal answer + rubric generation
  | 'assessmentTurn' // assessment question gen + answer evaluation
  | 'importExtraction' // document question extraction
  | 'classification' // single-question categorization
  | 'resumeAnalysis' // career resume analysis
  | 'learningPlan'; // skill learning plan generation

/** Per-operation daily caps (per user). */
const DAILY_CAPS: Record<KaizenAIOperation, number> = {
  scoring: 200,
  idealGeneration: 100,
  assessmentTurn: 150,
  importExtraction: 50,
  classification: 200,
  resumeAnalysis: 20,
  learningPlan: 50,
};

export interface CostGuardResult {
  allowed: boolean;
  remaining: number;
}

// In-memory fallback counter (per Worker isolate). Best-effort only.
const memoryCounters = new Map<string, number>();

function todayUtc(): string {
  return nowIso().slice(0, 10); // YYYY-MM-DD
}

function counterKey(userId: string, operation: KaizenAIOperation): string {
  return `kaizen:${userId}:${operation}:${todayUtc()}`;
}

let tableEnsured = false;

async function ensureTable(db: D1Database): Promise<void> {
  if (tableEnsured) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS kaizen_ai_usage (
        key   TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0
      )`
    )
    .run();
  tableEnsured = true;
}

/**
 * Enforce the per-user/day cap for `operation` and atomically increment the
 * counter when allowed. Call this BEFORE the provider call; on `allowed === false`
 * the route should return `c.json({ error, degraded: true }, 429)`.
 *
 * Counting model: we increment on each ATTEMPT (the guarded provider call is
 * about to happen). The cap is therefore a ceiling on attempts/day, which is the
 * cost-control intent.
 */
export async function kaizenCostGuard(
  c: Context<{ Bindings: Env }>,
  userId: string,
  operation: KaizenAIOperation
): Promise<CostGuardResult> {
  const cap = DAILY_CAPS[operation];
  const key = counterKey(userId, operation);

  const db = c.env.DB;
  if (db) {
    try {
      await ensureTable(db);

      const row = await db
        .prepare('SELECT count FROM kaizen_ai_usage WHERE key = ?')
        .bind(key)
        .first<{ count: number }>();
      const current = row?.count ?? 0;

      if (current >= cap) {
        return { allowed: false, remaining: 0 };
      }

      // Increment (upsert). Daily keys make stale rows harmless; no GC needed.
      await db
        .prepare(
          `INSERT INTO kaizen_ai_usage (key, count) VALUES (?, 1)
           ON CONFLICT(key) DO UPDATE SET count = count + 1`
        )
        .bind(key)
        .run();

      return { allowed: true, remaining: Math.max(0, cap - (current + 1)) };
    } catch (e) {
      // Fall through to the in-memory backstop on any D1 error.
      console.error('[kaizenCostGuard] D1 path failed, using memory fallback:', e);
    }
  }

  // Best-effort in-memory fallback (per-isolate; see file header LIMITATION).
  const current = memoryCounters.get(key) ?? 0;
  if (current >= cap) {
    return { allowed: false, remaining: 0 };
  }
  memoryCounters.set(key, current + 1);
  return { allowed: true, remaining: Math.max(0, cap - (current + 1)) };
}

/**
 * Operator-wired global-ceiling hook (stub). Returns `true` when a global cost
 * ceiling has been tripped, at which point an operator can have the Kaizen AI
 * routes degrade. Default behavior reads the `kaizenAIScoring` feature flag from
 * D1: when an operator flips it to 0 (the kill switch), this returns `true`.
 * Wire a budget/metering signal in here if a hard org-wide ceiling is needed.
 *
 * Best-effort: any failure returns `false` (do not block on a flag read).
 */
export async function optionalGlobalCeilingTripped(env: Env): Promise<boolean> {
  const db = env.DB;
  if (!db) return false;
  try {
    const row = await db
      .prepare("SELECT enabled FROM feature_flags WHERE key = 'kaizenAIScoring'")
      .first<{ enabled: number }>();
    // No row => treat as not tripped (fail-open for the ceiling check; the
    // feature flag itself still gates the surface client-side).
    if (!row) return false;
    return row.enabled === 0;
  } catch (e) {
    console.error('[optionalGlobalCeilingTripped] flag read failed:', e);
    return false;
  }
}
