/**
 * Kaizen — User Memory schema (server-side mirror)
 *
 * Mirrors the `kaizen_user_memory` table (migration 088) and the v1 memory
 * categories / sensitivity model from the implementation plan
 * ("Continuously updated user memory").
 *
 * This file is OWNED by the coach-chat / kaizen-brain stack. It intentionally
 * defines its own types instead of importing from `services/kaizen/ai/*` or
 * `services/kaizen/assessment/*` so the coach surface stays self-contained.
 *
 * Backend compatibility rules (see project memory):
 *   - snake_case column names
 *   - INTEGER booleans stored as 0/1 (is_approved, is_archived, use_in_ai_context)
 *   - TEXT for everything else; JSON lives inside TEXT where needed
 */

/** v1 memory categories (plan: "Memory categories for v1"). */
export const MEMORY_CATEGORIES = [
  'goal',
  'preference',
  'constraint',
  'habit_pattern',
  'motivation',
  'career_context',
  'technical_weakness',
  'behavioral_story',
  'mental_energy_pattern',
  'health_context',
  'communication_style',
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/**
 * Sensitivity tiers. `sensitive` memories (health/mental/career fears, personal
 * documents) require explicit consent and are redacted from the standard
 * coach-chat prompt unless the user has opted them in.
 */
export type MemorySensitivity = 'normal' | 'sensitive';

/** How a memory originated. */
export type MemorySourceKind =
  | 'coach_chat'
  | 'assessment'
  | 'import'
  | 'review'
  | 'manual'
  | 'derived'
  | string;

/**
 * Server-side memory record. INTEGER booleans use 0/1 to match D1 storage; the
 * route reads/writes these directly so we keep the wire shape identical to the
 * `kaizen_user_memory` row.
 */
export interface MemoryRecord {
  id: string;
  user_id: string;
  category: MemoryCategory | string;
  fact: string;
  confidence: number | null;
  /** 'normal' | 'sensitive' */
  sensitivity: MemorySensitivity | string;
  source_kind: MemorySourceKind | null;
  source_ref: string | null;
  source_session_id: string | null;
  /** 0/1 — proposed memory is ALWAYS is_approved=0 until the user approves it. */
  is_approved: number;
  /** 0/1 */
  is_archived: number;
  last_seen_at: string | null;
  expires_at: string | null;
  /** 0/1 — operator/user toggle for "used by Kaizen Master". */
  use_in_ai_context: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * A memory update PROPOSED by the coach. The route never persists these as
 * approved — they are returned to the client as `proposedMemoryUpdates` and (if
 * the surface chooses to persist a pending row) written with is_approved = 0.
 *
 * This is the guardrail encoding for "remember_about_user only PROPOSES memory".
 */
export interface ProposedMemoryUpdate {
  /** Stable id so the client can de-dupe / approve a specific proposal. */
  proposalId: string;
  category: MemoryCategory | string;
  fact: string;
  /** Model self-reported confidence 0..1. */
  confidence: number;
  sensitivity: MemorySensitivity;
  /** Why the coach thinks this is worth remembering (shown in the approval UI). */
  rationale?: string;
  /** Always 0 — proposals are never auto-approved. Present for an explicit contract. */
  is_approved: 0;
  /** Session that produced the proposal, for source attribution. */
  source_session_id?: string | null;
  source_kind: 'coach_chat';
}

export function isMemoryCategory(value: string): value is MemoryCategory {
  return (MEMORY_CATEGORIES as readonly string[]).includes(value);
}

/** Clamp + default a model-supplied confidence into 0..1. */
export function normalizeConfidence(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}
