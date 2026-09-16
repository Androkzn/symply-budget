/**
 * Kaizen Coach Chat — structured tool-result schemas
 *
 * Self-contained TypeScript types for every v1 coach tool's result. These are
 * the contract the iOS client renders as cards ("Start React assessment",
 * "Due today: 3 reps") instead of relying only on assistant prose (plan:
 * Guardrails — "Tool results are part of the response contract").
 *
 * INTENTIONALLY self-contained: do NOT import from services/kaizen/ai/* or
 * services/kaizen/assessment/*. The coach surface owns these shapes.
 *
 * Handlers may return DETERMINISTIC PLACEHOLDER data the iOS client replaces
 * (the client holds the real repositories), but the *shape* below is the real
 * contract and must not drift.
 */

import type { ProposedMemoryUpdate } from '../context/memorySchema';
import type { SnapshotFreshness } from '../context/snapshotRenderer';

/** Discriminated union tag for every tool result. */
export type CoachToolName =
  | 'get_context_snapshot'
  | 'get_progress_snapshot'
  | 'explain_progress'
  | 'recommend_next_rep'
  | 'start_assessment'
  | 'import_questions'
  | 'start_practice_session'
  | 'log_kaizen_action'
  | 'remember_about_user'
  | 'recall_about_user'
  | 'open_route';

/** Common envelope wrapping every tool result. */
export interface ToolResultEnvelope<TName extends CoachToolName, TData> {
  tool: TName;
  ok: boolean;
  /** Present when ok=false; human-readable reason (also drives a guardrail block). */
  error?: string;
  /**
   * True when the iOS client must replace this server placeholder with real
   * repository data before acting. The server never has the live repositories.
   */
  clientMustResolve: boolean;
  data: TData;
}

// --- get_context_snapshot ---------------------------------------------------
export interface ContextSnapshotData {
  freshness: SnapshotFreshness;
  /** Echo of the redacted snapshot summary the coach is allowed to see. */
  summary: string;
  sourceSummary?: Record<string, string>;
  generatedAt?: string;
}
export type GetContextSnapshotResult = ToolResultEnvelope<
  'get_context_snapshot',
  ContextSnapshotData
>;

// --- get_progress_snapshot --------------------------------------------------
// GUARDRAIL: the coach CONSUMES a provided snapshot; it never recomputes scores.
export interface ProgressSnapshotData {
  period: 'today' | 'week' | 'month' | 'custom';
  /** Read straight from the client-provided snapshot; not computed here. */
  highlights: string[];
  momentum?: string;
  regressions?: string[];
}
export type GetProgressSnapshotResult = ToolResultEnvelope<
  'get_progress_snapshot',
  ProgressSnapshotData
>;

// --- explain_progress -------------------------------------------------------
// GUARDRAIL: explains deterministic analytics already in the snapshot; the
// server returns a structured explanation scaffold, never a recomputed score.
export interface ExplainProgressData {
  subject: string;
  /** Evidence lines lifted from the provided snapshot (not recomputed). */
  evidence: string[];
  /** Plain-language explanation scaffold; the model fills prose around it. */
  explanation: string;
}
export type ExplainProgressResult = ToolResultEnvelope<
  'explain_progress',
  ExplainProgressData
>;

// --- recommend_next_rep -----------------------------------------------------
export interface NextRepData {
  /** Deterministic scheduler output; placeholder until the client resolves. */
  questionId: string | null;
  questionBank: string | null;
  kind: 'technical' | 'behavioral' | null;
  dueCount: number;
  reason: string;
}
export type RecommendNextRepResult = ToolResultEnvelope<'recommend_next_rep', NextRepData>;

// --- start_assessment -------------------------------------------------------
export interface StartAssessmentData {
  skillId: string | null;
  route: string;
  requiresConfirmation: boolean;
}
export type StartAssessmentResult = ToolResultEnvelope<'start_assessment', StartAssessmentData>;

// --- import_questions -------------------------------------------------------
export interface ImportQuestionsData {
  route: string;
  /** Destructive/import flows require explicit UI confirmation. */
  requiresConfirmation: boolean;
  note: string;
}
export type ImportQuestionsResult = ToolResultEnvelope<'import_questions', ImportQuestionsData>;

// --- start_practice_session -------------------------------------------------
export interface StartPracticeSessionData {
  source: 'due_queue' | 'question_bank';
  questionBankId: string | null;
  estimatedCount: number;
  route: string;
}
export type StartPracticeSessionResult = ToolResultEnvelope<
  'start_practice_session',
  StartPracticeSessionData
>;

// --- log_kaizen_action ------------------------------------------------------
export interface LogActionData {
  actionId: string | null;
  /** Logging is routed through the repository path on the client. */
  accepted: boolean;
  note: string;
}
export type LogActionResult = ToolResultEnvelope<'log_kaizen_action', LogActionData>;

// --- remember_about_user (a.k.a. update_user_profile_memory) ----------------
// GUARDRAIL: PROPOSE only. is_approved is always 0; never auto-persisted.
export interface RememberAboutUserData {
  proposal: ProposedMemoryUpdate;
  note: string;
}
export type RememberAboutUserResult = ToolResultEnvelope<
  'remember_about_user',
  RememberAboutUserData
>;

// --- recall_about_user ------------------------------------------------------
export interface RecallAboutUserData {
  category: string | null;
  /** Approved + opted-in memories matching the query (already redacted). */
  matches: Array<{ category: string; fact: string; confidence: number | null }>;
}
export type RecallAboutUserResult = ToolResultEnvelope<'recall_about_user', RecallAboutUserData>;

// --- open_route -------------------------------------------------------------
export interface OpenRouteData {
  route: string;
  /** Params forwarded to KaizenNavigationProviding on the client. */
  params?: Record<string, string>;
}
export type OpenRouteResult = ToolResultEnvelope<'open_route', OpenRouteData>;

/** Union of every coach tool result. */
export type AnyToolResult =
  | GetContextSnapshotResult
  | GetProgressSnapshotResult
  | ExplainProgressResult
  | RecommendNextRepResult
  | StartAssessmentResult
  | ImportQuestionsResult
  | StartPracticeSessionResult
  | LogActionResult
  | RememberAboutUserResult
  | RecallAboutUserResult
  | OpenRouteResult;

/**
 * Helper to build an error envelope without losing the discriminant.
 *
 * Error results carry no payload (`data: {}`), so the concrete data type for the
 * named tool does not apply; we assert back to `AnyToolResult` because `ok=false`
 * means the client reads `error`, never `data`. Returning `AnyToolResult` keeps
 * the handler signatures uniform.
 */
export function toolError<TName extends CoachToolName>(
  tool: TName,
  error: string
): AnyToolResult {
  return { tool, ok: false, error, clientMustResolve: false, data: {} as never } as AnyToolResult;
}
