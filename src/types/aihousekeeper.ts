// Aihousekeeper (AI Housekeeper) shared types.
// Column names match backend Drizzle schema (snake_case) per plan §A1–§A4.

import type { AssistantUIBlock } from '@/types/aihousekeeperUiBlocks';

/**
 * A single Aihousekeeper chat bubble as rendered in `AihousekeeperChatScreen`.
 *
 * Lives in this shared module (not the screen) so the Zustand store can
 * persist messages to MMKV without pulling a screen-level dependency into
 * the store module.
 */
export interface AihousekeeperUIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  parked?: Array<{ pendingId: string; toolName: string }>;
  imagePreviews?: string[];
  uiBlocks?: AssistantUIBlock[];
  documentKindPrompt?: boolean;
}

export type AssistantTone = 'warm_brief' | 'direct' | 'playful';

export interface AssistantChannelsEnabled {
  push: boolean;
  sms: boolean;
  email_weekly: boolean;
  watch: boolean;
}

/** One row per household — plan §A1 `assistant_identity`. */
export interface AssistantIdentity {
  household_id: string;
  name: string;
  tone: AssistantTone;
  pronouns: string | null;
  briefing_time: string; // 'HH:MM'
  quiet_hours_start: string; // 'HH:MM'
  quiet_hours_end: string; // 'HH:MM'
  daily_interrupt_budget: number;
  /**
   * JSON-parsed. Backend stores as `channels_enabled_json` TEXT; Stream E is
   * expected to parse before returning. If the backend returns the raw string,
   * the client handles both shapes (see aihousekeeperApi.getIdentity).
   */
  channels_enabled: AssistantChannelsEnabled;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export type AssistantIdentityPatch = Partial<
  Pick<
    AssistantIdentity,
    | 'name'
    | 'tone'
    | 'pronouns'
    | 'briefing_time'
    | 'quiet_hours_start'
    | 'quiet_hours_end'
    | 'daily_interrupt_budget'
    | 'channels_enabled'
    | 'timezone'
  >
>;

export type BriefingEmptyReason =
  | 'no_signals'
  | 'all_quiet'
  | 'recently_briefed'
  | 'fallback_failed'
  | null;

/** Plan §A2 `assistant_briefings` — shape returned to client. */
export interface AssistantBriefing {
  id: string;
  household_id: string;
  date: string; // YYYY-MM-DD
  composed_at: string; // ISO8601
  paragraph: string;
  /** JSON array of bullet strings, parsed by backend before return. */
  bullets: string[];
  push_sent: boolean;
  push_message_id: string | null;
  read_at: string | null;
  empty_reason: BriefingEmptyReason;
  /** JSON array of source signal records — opaque to client. */
  source_signals: Array<Record<string, unknown>>;
  composed_by_model: string | null;
  prompt_version: string | null;
}

// ---------------------------------------------------------------------------
// Home insight — the dynamic, actionable Mira Home hero (GET /home-insight)
// ---------------------------------------------------------------------------

/** Severity/mood of the Home hero insight; drives the accent color + icon. */
export type InsightTone = 'urgent' | 'attention' | 'info' | 'calm' | 'celebrate';

/** A single deep-link action. `route` is an expo-router path (e.g. "/tasks"). */
export interface InsightCta {
  label: string;
  route: string;
  params?: Record<string, string>;
}

/** Compact secondary signal shown as a chip beneath the primary insight. */
export interface InsightChip {
  /** Ionicons name. */
  icon: string;
  label: string;
  /** Relative timing, e.g. "in 3 days" / "2d overdue", or null. */
  dueLabel: string | null;
}

/**
 * The fully-composed Home hero insight. All copy, formatting, ranking and
 * routing are decided server-side — the client renders this verbatim and
 * navigates to `cta.route` on tap.
 */
export interface HomeInsight {
  /** Time-of-day greeting computed in the household's zone, e.g. "Good evening". */
  greeting: string;
  /** Short headline, e.g. "1 task overdue". */
  title: string;
  /** Mira-voice sentence including the relative days counter. */
  message: string;
  tone: InsightTone;
  /** Ionicons name for the card accent. */
  icon: string;
  /** Relative due label for the primary signal, e.g. "Due tomorrow". */
  dueLabel: string | null;
  /** ISO date (YYYY-MM-DD) of the primary signal's due date, or null. */
  dueDate: string | null;
  /** Single deep-link action, or null (card falls back to opening Mira chat). */
  cta: InsightCta | null;
  /** How many things need attention right now (drives an optional badge). */
  attentionCount: number;
  /** Up to 3 secondary signals shown as compact chips. */
  chips: InsightChip[];
  /** ISO timestamp this insight was composed. */
  generatedAt: string;
}

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

/** Plan §A1 `assistant_memory` — redacted_body is the only body client may see. */
export interface AssistantMemory {
  id: string;
  household_id: string;
  type: MemoryType;
  subject_kind: string | null;
  subject_id: string | null;
  /**
   * PII-redacted prompt-safe version. Raw `body` is intentionally not exposed
   * to the client (plan §W1 — redacted_body only).
   */
  redacted_body: string | null;
  confidence: number;
  source: MemorySource;
  source_ref: string | null;
  is_anniversary_tracked: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  superseded_by_id: string | null;
}

export interface ListMemoryOptions {
  q?: string;
  type?: MemoryType;
  limit?: number;
}

export type AssistantLedgerCategory =
  | 'decision'
  | 'message_sent'
  | 'task_changed'
  | 'memory_added'
  | 'followup_scheduled'
  | 'assignment';

/** Plan §A4 `assistant_trust_ledger`. */
export interface AssistantTrustLedgerEntry {
  id: string;
  household_id: string;
  occurred_at: string;
  category: AssistantLedgerCategory;
  summary: string;
  rationale: string;
  reversible: boolean;
  undo_token: string | null;
  related_refs: Array<Record<string, unknown>> | null;
  user_dismissed_at: string | null;
  event_idempotency_key: string | null;
}

export interface ListLedgerOptions {
  since?: string;
  category?: AssistantLedgerCategory;
  includeDismissed?: boolean;
  limit?: number;
}

export type UndoLedgerStatus =
  | 'undone'
  | 'irreversible'
  | 'not_found'
  | 'already_undone';

export interface UndoLedgerResult {
  status: UndoLedgerStatus;
  message?: string;
}

export type FollowupStatus = 'pending' | 'fired' | 'cancelled' | 'skipped';
export type FollowupOrigin = 'self_scheduled' | 'user_requested';

/** Plan §A2 `assistant_followups`. */
export interface AssistantFollowup {
  id: string;
  household_id: string;
  scheduled_for: string;
  prompt: string;
  context_ref: Record<string, unknown> | null;
  origin: FollowupOrigin;
  status: FollowupStatus;
  fired_at: string | null;
  outcome: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Cached shape stored per-hid in MMKV `aihousekeeper_last_briefing_<hid>`. */
export interface CachedBriefingPayload {
  date: string;
  paragraph: string;
  bullets: string[];
  cachedAt: string; // ISO
}

/** v1.2 `ai_tool_pending` row (plan §B19, ADR-32 — HIGH_WRITE approval). */
export type AIToolPendingStatus =
  | 'pending'
  | 'approved'
  | 'cancelled'
  | 'executed'
  | 'expired'
  | 'failed';

export interface AIToolPending {
  id: string;
  household_id: string;
  user_id: string;
  tool_name: string;
  input_json: string; // JSON string; client parses on demand
  idempotency_key: string;
  status: AIToolPendingStatus;
  approved_at: string | null;
  approved_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  executed_at: string | null;
  execution_result_json: string | null;
  execution_error: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}
