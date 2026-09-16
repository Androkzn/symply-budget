/**
 * Kaizen sync (Kaizen-only) — ported from the donor `kaizen/backend`
 * `src/routes/sync.ts`, restricted to the 16 `kaizen_*` tables. The donor's
 * nutrition / health / challenge sync is intentionally NOT ported.
 *
 * Mounted at `/api/v1/sync` and brand-gated to `symply-kaizen` in src/index.ts.
 *
 * Preserves the donor's mechanics verbatim:
 *   - two-phase upsert (Phase-1 parents, then Phase-2 children) so FK targets
 *     exist before children reference them;
 *   - ONE-WAY upgrade for `kaizen_interview_attempts.scored_offline` (an AI
 *     score may overwrite an offline self-score, never the reverse);
 *   - `getServerChanges` deltas over all 16 tables via `updated_at > since`.
 */

import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth';
import type { Env } from '../types';
import { nowIso } from '../utils/id';

// ============================================================================
// Kaizen entry types (ported from the donor `src/types/env.ts`).
// ============================================================================

export interface KaizenProfileEntry {
  id: string;
  user_id: string;
  timezone: string | null;
  onboarding_complete: number;
  enabled_systems: string | null;
  system_activation_states: string | null;
  primary_system: string | null;
  daily_core_ids: string | null;
  career_setup_step: string | null;
  target_roles: string | null;
  career_goal_types: string | null;
  selected_career_skill_ids: string | null;
  resume_source_name: string | null;
  resume_summary: string | null;
  career_plan_summary: string | null;
  interaction_style: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenActionEntry {
  id: string;
  user_id: string;
  title: string;
  system: string;
  rhythm: string;
  linked_feature: string | null;
  is_daily_core: number;
  sort_order: number;
  time_of_day: string;
  stack_id: string | null;
  rotation_day: number | null;
  reminder_anchor: string | null;
  reminder_policy: string | null;
  watch_quick_log_enabled: number;
  voice_log_prompt: string | null;
  input_description: string | null;
  output_description: string | null;
  is_archived: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenActionLogEntry {
  id: string;
  user_id: string;
  action_id: string;
  date: string;
  completed_at: string | null;
  skipped: number;
  skip_reason: string | null;
  source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenWeeklyRotationEntry {
  id: string;
  user_id: string;
  weekday: number;
  focus_title: string;
  system: string | null;
  linked_skill_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenHabitStackEntry {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenHabitStackStepEntry {
  id: string;
  user_id: string;
  stack_id: string;
  action_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenDeepWorkBlockEntry {
  id: string;
  user_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  topic: string | null;
  suggest_focus_mode: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenSkillNodeEntry {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  level_raw: number;
  mastery_0_to_100: number | null;
  activation_state: string;
  concept_band: string | null;
  level_descriptions: string | null;
  is_priority: number;
  is_assessable: number;
  assessment_weight: number;
  prerequisite_ids: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenSkillProgressLogEntry {
  id: string;
  user_id: string;
  skill_id: string;
  previous_level: number | null;
  new_level: number | null;
  previous_mastery: number | null;
  new_mastery: number | null;
  evidence: string | null;
  date: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenUserMemoryEntry {
  id: string;
  user_id: string;
  category: string;
  fact: string;
  confidence: number | null;
  sensitivity: string;
  source_kind: string | null;
  source_ref: string | null;
  source_session_id: string | null;
  is_approved: number;
  is_archived: number;
  last_seen_at: string | null;
  expires_at: string | null;
  use_in_ai_context: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenInterviewPipelineEntry {
  id: string;
  user_id: string;
  title: string;
  stage: string;
  linked_skill_id: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenInterviewQuestionEntry {
  id: string;
  user_id: string;
  prompt: string;
  question_bank: string;
  kind: string | null;
  purpose: string;
  linked_skill_id: string | null;
  linked_concept_id: string | null;
  concept_band: string | null;
  difficulty_0_to_100: number | null;
  topic_tags: string | null;
  import_source: string | null;
  import_batch_id: string | null;
  source_document_name: string | null;
  source_hash: string | null;
  import_review_status: string | null;
  ideal_answer: string | null;
  rubric: string | null;
  judge_model: string | null;
  ideal_answer_version: number;
  baseline_attempt_id: string | null;
  stability: number | null;
  difficulty: number | null;
  retrievability: number | null;
  reps: number;
  lapses: number;
  last_reviewed_at: string | null;
  due_at: string | null;
  desired_retention: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenInterviewAttemptEntry {
  id: string;
  user_id: string;
  question_id: string;
  attempted_at: string;
  answer_text: string | null;
  answer_source: string;
  duration_seconds: number | null;
  is_baseline: number;
  is_diagnostic: number;
  self_confidence: number | null;
  criterion_scores: string | null;
  overall_score: number | null;
  correction_suggestions: string | null;
  lesson_learned: string | null;
  gap_vs_ideal: string | null;
  fsrs_rating: number | null;
  judge_reasoning: string | null;
  judge_model: string | null;
  provider_fingerprint: string | null;
  scored_offline: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenKnowledgeItemEntry {
  id: string;
  user_id: string;
  para_type: string;
  title: string;
  content: string | null;
  tags: string | null;
  linked_skill_id: string | null;
  book_metadata: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenGtdItemEntry {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  system: string | null;
  status: string;
  captured_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenWeeklyReviewEntry {
  id: string;
  user_id: string;
  week_start: string;
  wins: string | null;
  improvements: string | null;
  one_percent_change: string | null;
  system_adjustments: string | null;
  career_snapshot: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ----------------------------------------------------------------------------
// Book Comprehension & Retention feature (Kaizen). Six local-first tables.
// Intra-feature relations are SOFT refs (id strings; no FK) — all upserts run
// in the Phase-1 parent batch. JSON payloads ride as TEXT columns.
// ----------------------------------------------------------------------------

export interface KaizenBookEntry {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  language: string;
  source_type: string;
  file_object_key: string | null;
  file_name: string | null;
  file_hash: string | null;
  page_count: number | null;
  cover_emoji: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenBookChapterEntry {
  id: string;
  user_id: string;
  book_id: string;
  chapter_index: number;
  title: string;
  start_page: number | null;
  end_page: number | null;
  status: string;
  content_object_key: string | null;
  summary: string | null;
  read_at: string | null;
  questions_generated_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenBookQuestionEntry {
  id: string;
  user_id: string;
  book_id: string;
  chapter_id: string;
  type: string;
  prompt: string;
  options: string | null;
  answer_index: number | null;
  ideal_answer: string | null;
  rubric: string | null;
  language: string;
  difficulty_0_to_100: number | null;
  source_highlight_id: string | null;
  stability: number | null;
  difficulty: number | null;
  retrievability: number | null;
  reps: number;
  lapses: number;
  last_reviewed_at: string | null;
  due_at: string | null;
  desired_retention: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenBookAttemptEntry {
  id: string;
  user_id: string;
  question_id: string;
  book_id: string | null;
  chapter_id: string | null;
  attempted_at: string;
  answer_source: string;
  answer_text: string | null;
  selected_index: number | null;
  is_correct: number | null;
  audio_object_key: string | null;
  transcription: string | null;
  content_score: number | null;
  overall_score: number | null;
  mistakes: string | null;
  pronunciation: string | null;
  delivery: string | null;
  feedback: string | null;
  fsrs_rating: number | null;
  scored_offline: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenBookMistakeEntry {
  id: string;
  user_id: string;
  book_id: string | null;
  type: string;
  text: string;
  correction: string | null;
  explanation: string | null;
  severity: string | null;
  status: string;
  dedup_key: string | null;
  regression_count: number;
  srs_state: string | null;
  due_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KaizenBookHighlightEntry {
  id: string;
  user_id: string;
  book_id: string;
  chapter_id: string;
  text: string;
  anchor: string | null;
  color: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ============================================================================
// Sync envelope (Kaizen subset only).
// ============================================================================

export interface SyncRequest {
  last_sync_at?: string;
  changes?: {
    kaizen_profiles?: KaizenProfileEntry[];
    kaizen_actions?: KaizenActionEntry[];
    kaizen_action_logs?: KaizenActionLogEntry[];
    kaizen_weekly_rotations?: KaizenWeeklyRotationEntry[];
    kaizen_habit_stacks?: KaizenHabitStackEntry[];
    kaizen_habit_stack_steps?: KaizenHabitStackStepEntry[];
    kaizen_deep_work_blocks?: KaizenDeepWorkBlockEntry[];
    kaizen_skill_nodes?: KaizenSkillNodeEntry[];
    kaizen_skill_progress_logs?: KaizenSkillProgressLogEntry[];
    kaizen_user_memory?: KaizenUserMemoryEntry[];
    kaizen_interview_pipeline?: KaizenInterviewPipelineEntry[];
    kaizen_interview_questions?: KaizenInterviewQuestionEntry[];
    kaizen_interview_attempts?: KaizenInterviewAttemptEntry[];
    kaizen_knowledge_items?: KaizenKnowledgeItemEntry[];
    kaizen_gtd_items?: KaizenGtdItemEntry[];
    kaizen_weekly_reviews?: KaizenWeeklyReviewEntry[];
    kaizen_books?: KaizenBookEntry[];
    kaizen_book_chapters?: KaizenBookChapterEntry[];
    kaizen_book_questions?: KaizenBookQuestionEntry[];
    kaizen_book_attempts?: KaizenBookAttemptEntry[];
    kaizen_book_mistakes?: KaizenBookMistakeEntry[];
    kaizen_book_highlights?: KaizenBookHighlightEntry[];
  };
}

export interface SyncResponse {
  server_time: string;
  changes: {
    kaizen_profiles: KaizenProfileEntry[];
    kaizen_actions: KaizenActionEntry[];
    kaizen_action_logs: KaizenActionLogEntry[];
    kaizen_weekly_rotations: KaizenWeeklyRotationEntry[];
    kaizen_habit_stacks: KaizenHabitStackEntry[];
    kaizen_habit_stack_steps: KaizenHabitStackStepEntry[];
    kaizen_deep_work_blocks: KaizenDeepWorkBlockEntry[];
    kaizen_skill_nodes: KaizenSkillNodeEntry[];
    kaizen_skill_progress_logs: KaizenSkillProgressLogEntry[];
    kaizen_user_memory: KaizenUserMemoryEntry[];
    kaizen_interview_pipeline: KaizenInterviewPipelineEntry[];
    kaizen_interview_questions: KaizenInterviewQuestionEntry[];
    kaizen_interview_attempts: KaizenInterviewAttemptEntry[];
    kaizen_knowledge_items: KaizenKnowledgeItemEntry[];
    kaizen_gtd_items: KaizenGtdItemEntry[];
    kaizen_weekly_reviews: KaizenWeeklyReviewEntry[];
    kaizen_books: KaizenBookEntry[];
    kaizen_book_chapters: KaizenBookChapterEntry[];
    kaizen_book_questions: KaizenBookQuestionEntry[];
    kaizen_book_attempts: KaizenBookAttemptEntry[];
    kaizen_book_mistakes: KaizenBookMistakeEntry[];
    kaizen_book_highlights: KaizenBookHighlightEntry[];
  };
}

// `strict: false` so the mounted root handler (`sync.post('/')`) matches both
// `/api/v1/sync` and `/api/v1/sync/` — the mobile client posts without a trailing slash.
const sync = new Hono<{ Bindings: Env }>({ strict: false });

// All sync routes require authentication (target platform JWT).
sync.use('/*', authMiddleware());

// Full sync endpoint - receives client changes, returns server changes
sync.post('/', async (c) => {
  try {
    const user = c.get('user');
    const userId = user.sub;
    // Malformed/absent JSON is a client error (400), not a server error (500).
    let body: SyncRequest;
    try {
      body = await c.req.json<SyncRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Request body must be a JSON object' }, 400);
    }
    const lastSyncAt = body.last_sync_at ? new Date(body.last_sync_at) : null;
    const serverTime = nowIso();

    // Process client changes (upsert)
    if (body.changes) {
      await processClientChanges(c.env.DB, userId, body.changes);
    }

    // Get server changes since last sync
    const serverChanges = await getServerChanges(c.env.DB, userId, lastSyncAt);

    const response: SyncResponse = {
      server_time: serverTime,
      changes: serverChanges,
    };

    return c.json(response);
  } catch (error) {
    console.error('Sync error:', error);
    console.error('Error details:', error instanceof Error ? error.message : String(error));
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return c.json({
      error: 'Sync failed',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export async function processClientChanges(
  db: D1Database,
  userId: string,
  changes: SyncRequest['changes']
) {
  const now = nowIso();

  // Two-phase batch execution to respect foreign key constraints:
  // Phase 1: Parent tables
  // Phase 2: Child tables (reference the parents above)
  const parentBatchStatements: D1PreparedStatement[] = [];
  const childBatchStatements: D1PreparedStatement[] = [];

  const batchStatements = parentBatchStatements;

  // ==========================================================================
  // Kaizen — Phase 1 parents
  // ==========================================================================

  // kaizen_profiles
  if (changes?.kaizen_profiles?.length) {
    for (const entry of changes.kaizen_profiles) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_profiles (
            id, user_id, timezone, onboarding_complete, enabled_systems,
            system_activation_states, primary_system, daily_core_ids,
            career_setup_step, target_roles, career_goal_types, selected_career_skill_ids,
            resume_source_name, resume_summary, career_plan_summary, interaction_style,
            created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            timezone = excluded.timezone,
            onboarding_complete = excluded.onboarding_complete,
            enabled_systems = excluded.enabled_systems,
            system_activation_states = excluded.system_activation_states,
            primary_system = excluded.primary_system,
            daily_core_ids = excluded.daily_core_ids,
            career_setup_step = excluded.career_setup_step,
            target_roles = excluded.target_roles,
            career_goal_types = excluded.career_goal_types,
            selected_career_skill_ids = excluded.selected_career_skill_ids,
            resume_source_name = excluded.resume_source_name,
            resume_summary = excluded.resume_summary,
            career_plan_summary = excluded.career_plan_summary,
            interaction_style = excluded.interaction_style,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.timezone ?? null,
          entry.onboarding_complete ? 1 : 0,
          entry.enabled_systems ?? null,
          (entry as any).system_activation_states ?? null,
          (entry as any).primary_system ?? null,
          entry.daily_core_ids ?? null,
          entry.career_setup_step ?? null,
          entry.target_roles ?? null,
          entry.career_goal_types ?? null,
          entry.selected_career_skill_ids ?? null,
          entry.resume_source_name ?? null,
          entry.resume_summary ?? null,
          entry.career_plan_summary ?? null,
          entry.interaction_style ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_actions
  if (changes?.kaizen_actions?.length) {
    for (const entry of changes.kaizen_actions) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_actions (
            id, user_id, title, system, rhythm, linked_feature, is_daily_core, sort_order,
            time_of_day, stack_id, rotation_day, reminder_anchor, reminder_policy,
            watch_quick_log_enabled, voice_log_prompt, input_description, output_description,
            is_archived, created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            system = excluded.system,
            rhythm = excluded.rhythm,
            linked_feature = excluded.linked_feature,
            is_daily_core = excluded.is_daily_core,
            sort_order = excluded.sort_order,
            time_of_day = excluded.time_of_day,
            stack_id = excluded.stack_id,
            rotation_day = excluded.rotation_day,
            reminder_anchor = excluded.reminder_anchor,
            reminder_policy = excluded.reminder_policy,
            watch_quick_log_enabled = excluded.watch_quick_log_enabled,
            voice_log_prompt = excluded.voice_log_prompt,
            input_description = excluded.input_description,
            output_description = excluded.output_description,
            is_archived = excluded.is_archived,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.title ?? null,
          entry.system ?? null,
          entry.rhythm ?? null,
          entry.linked_feature ?? null,
          entry.is_daily_core ? 1 : 0,
          entry.sort_order ?? null,
          entry.time_of_day ?? null,
          entry.stack_id ?? null,
          entry.rotation_day ?? null,
          entry.reminder_anchor ?? null,
          entry.reminder_policy ?? null,
          entry.watch_quick_log_enabled ? 1 : 0,
          entry.voice_log_prompt ?? null,
          entry.input_description ?? null,
          entry.output_description ?? null,
          entry.is_archived ? 1 : 0,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_skill_nodes (self-ref parent_id is a SOFT ref — no FK ordering needed)
  if (changes?.kaizen_skill_nodes?.length) {
    for (const entry of changes.kaizen_skill_nodes) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_skill_nodes (
            id, user_id, name, parent_id, level_raw, mastery_0_to_100, activation_state,
            concept_band, level_descriptions, is_priority, is_assessable, assessment_weight,
            prerequisite_ids, sort_order, created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            parent_id = excluded.parent_id,
            level_raw = excluded.level_raw,
            mastery_0_to_100 = excluded.mastery_0_to_100,
            activation_state = excluded.activation_state,
            concept_band = excluded.concept_band,
            level_descriptions = excluded.level_descriptions,
            is_priority = excluded.is_priority,
            is_assessable = excluded.is_assessable,
            assessment_weight = excluded.assessment_weight,
            prerequisite_ids = excluded.prerequisite_ids,
            sort_order = excluded.sort_order,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.name ?? null,
          entry.parent_id ?? null,
          entry.level_raw ?? null,
          entry.mastery_0_to_100 ?? null,
          entry.activation_state ?? null,
          (entry as any).concept_band ?? null,
          entry.level_descriptions ?? null,
          entry.is_priority ? 1 : 0,
          (entry as any).is_assessable ? 1 : 0,
          (entry as any).assessment_weight ?? 1.0,
          (entry as any).prerequisite_ids ?? null,
          entry.sort_order ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_habit_stacks
  if (changes?.kaizen_habit_stacks?.length) {
    for (const entry of changes.kaizen_habit_stacks) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_habit_stacks (
            id, user_id, name, sort_order, created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            sort_order = excluded.sort_order,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.name ?? null,
          entry.sort_order ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_knowledge_items
  if (changes?.kaizen_knowledge_items?.length) {
    for (const entry of changes.kaizen_knowledge_items) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_knowledge_items (
            id, user_id, para_type, title, content, tags, linked_skill_id, book_metadata,
            created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            para_type = excluded.para_type,
            title = excluded.title,
            content = excluded.content,
            tags = excluded.tags,
            linked_skill_id = excluded.linked_skill_id,
            book_metadata = excluded.book_metadata,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.para_type ?? null,
          entry.title ?? null,
          entry.content ?? null,
          entry.tags ?? null,
          entry.linked_skill_id ?? null,
          entry.book_metadata ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_user_memory
  if (changes?.kaizen_user_memory?.length) {
    for (const entry of changes.kaizen_user_memory) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_user_memory (
            id, user_id, category, fact, confidence, sensitivity, source_kind, source_ref,
            source_session_id, is_approved, is_archived, last_seen_at, expires_at,
            use_in_ai_context, created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            category = excluded.category,
            fact = excluded.fact,
            confidence = excluded.confidence,
            sensitivity = excluded.sensitivity,
            source_kind = excluded.source_kind,
            source_ref = excluded.source_ref,
            source_session_id = excluded.source_session_id,
            is_approved = excluded.is_approved,
            is_archived = excluded.is_archived,
            last_seen_at = excluded.last_seen_at,
            expires_at = excluded.expires_at,
            use_in_ai_context = excluded.use_in_ai_context,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.category ?? null,
          entry.fact ?? null,
          entry.confidence ?? null,
          entry.sensitivity ?? null,
          entry.source_kind ?? null,
          entry.source_ref ?? null,
          entry.source_session_id ?? null,
          entry.is_approved ? 1 : 0,
          entry.is_archived ? 1 : 0,
          entry.last_seen_at ?? null,
          entry.expires_at ?? null,
          entry.use_in_ai_context ? 1 : 0,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_interview_pipeline
  if (changes?.kaizen_interview_pipeline?.length) {
    for (const entry of changes.kaizen_interview_pipeline) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_interview_pipeline (
            id, user_id, title, stage, linked_skill_id, notes, sort_order,
            created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            stage = excluded.stage,
            linked_skill_id = excluded.linked_skill_id,
            notes = excluded.notes,
            sort_order = excluded.sort_order,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.title ?? null,
          entry.stage ?? null,
          entry.linked_skill_id ?? null,
          entry.notes ?? null,
          entry.sort_order ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_interview_questions (FSRS-5 scheduler state; baseline_attempt_id is a SOFT ref)
  if (changes?.kaizen_interview_questions?.length) {
    for (const entry of changes.kaizen_interview_questions) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_interview_questions (
            id, user_id, prompt, question_bank, kind, purpose, linked_skill_id,
            linked_concept_id, concept_band, difficulty_0_to_100, topic_tags, import_source,
            import_batch_id, source_document_name, source_hash, import_review_status,
            ideal_answer, rubric, judge_model, ideal_answer_version, baseline_attempt_id,
            stability, difficulty, retrievability, reps, lapses, last_reviewed_at, due_at,
            desired_retention, created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            prompt = excluded.prompt,
            question_bank = excluded.question_bank,
            kind = excluded.kind,
            purpose = excluded.purpose,
            linked_skill_id = excluded.linked_skill_id,
            linked_concept_id = excluded.linked_concept_id,
            concept_band = excluded.concept_band,
            difficulty_0_to_100 = excluded.difficulty_0_to_100,
            topic_tags = excluded.topic_tags,
            import_source = excluded.import_source,
            import_batch_id = excluded.import_batch_id,
            source_document_name = excluded.source_document_name,
            source_hash = excluded.source_hash,
            import_review_status = excluded.import_review_status,
            ideal_answer = excluded.ideal_answer,
            rubric = excluded.rubric,
            judge_model = excluded.judge_model,
            ideal_answer_version = excluded.ideal_answer_version,
            baseline_attempt_id = excluded.baseline_attempt_id,
            stability = excluded.stability,
            difficulty = excluded.difficulty,
            retrievability = excluded.retrievability,
            reps = excluded.reps,
            lapses = excluded.lapses,
            last_reviewed_at = excluded.last_reviewed_at,
            due_at = excluded.due_at,
            desired_retention = excluded.desired_retention,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.prompt ?? null,
          entry.question_bank ?? null,
          entry.kind ?? null,
          entry.purpose ?? null,
          entry.linked_skill_id ?? null,
          entry.linked_concept_id ?? null,
          entry.concept_band ?? null,
          entry.difficulty_0_to_100 ?? null,
          entry.topic_tags ?? null,
          entry.import_source ?? null,
          entry.import_batch_id ?? null,
          entry.source_document_name ?? null,
          entry.source_hash ?? null,
          entry.import_review_status ?? null,
          entry.ideal_answer ?? null,
          entry.rubric ?? null,
          entry.judge_model ?? null,
          entry.ideal_answer_version ?? null,
          entry.baseline_attempt_id ?? null,
          entry.stability ?? null,
          entry.difficulty ?? null,
          entry.retrievability ?? null,
          entry.reps ?? null,
          entry.lapses ?? null,
          entry.last_reviewed_at ?? null,
          entry.due_at ?? null,
          entry.desired_retention ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_weekly_rotations
  if (changes?.kaizen_weekly_rotations?.length) {
    for (const entry of changes.kaizen_weekly_rotations) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_weekly_rotations (
            id, user_id, weekday, focus_title, system, linked_skill_id,
            created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            weekday = excluded.weekday,
            focus_title = excluded.focus_title,
            system = excluded.system,
            linked_skill_id = excluded.linked_skill_id,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.weekday ?? null,
          entry.focus_title ?? null,
          entry.system ?? null,
          entry.linked_skill_id ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_gtd_items
  if (changes?.kaizen_gtd_items?.length) {
    for (const entry of changes.kaizen_gtd_items) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_gtd_items (
            id, user_id, title, notes, system, status, captured_at,
            created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            notes = excluded.notes,
            system = excluded.system,
            status = excluded.status,
            captured_at = excluded.captured_at,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.title ?? null,
          entry.notes ?? null,
          entry.system ?? null,
          entry.status ?? null,
          entry.captured_at ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_weekly_reviews
  if (changes?.kaizen_weekly_reviews?.length) {
    for (const entry of changes.kaizen_weekly_reviews) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_weekly_reviews (
            id, user_id, week_start, wins, improvements, one_percent_change,
            system_adjustments, career_snapshot, created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            week_start = excluded.week_start,
            wins = excluded.wins,
            improvements = excluded.improvements,
            one_percent_change = excluded.one_percent_change,
            system_adjustments = excluded.system_adjustments,
            career_snapshot = excluded.career_snapshot,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.week_start ?? null,
          entry.wins ?? null,
          entry.improvements ?? null,
          entry.one_percent_change ?? null,
          entry.system_adjustments ?? null,
          entry.career_snapshot ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_deep_work_blocks (local-only on iOS v1; backend upsert provisioned for parity)
  if (changes?.kaizen_deep_work_blocks?.length) {
    for (const entry of changes.kaizen_deep_work_blocks) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_deep_work_blocks (
            id, user_id, date, start_time, end_time, topic, suggest_focus_mode,
            created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            date = excluded.date,
            start_time = excluded.start_time,
            end_time = excluded.end_time,
            topic = excluded.topic,
            suggest_focus_mode = excluded.suggest_focus_mode,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.date ?? null,
          entry.start_time ?? null,
          entry.end_time ?? null,
          entry.topic ?? null,
          entry.suggest_focus_mode ? 1 : 0,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // ==========================================================================
  // Book Comprehension feature — all soft refs, Phase-1 parent batch
  // ==========================================================================

  // kaizen_books
  if (changes?.kaizen_books?.length) {
    for (const entry of changes.kaizen_books) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_books (
            id, user_id, title, author, language, source_type, file_object_key,
            file_name, file_hash, page_count, cover_emoji, created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            author = excluded.author,
            language = excluded.language,
            source_type = excluded.source_type,
            file_object_key = excluded.file_object_key,
            file_name = excluded.file_name,
            file_hash = excluded.file_hash,
            page_count = excluded.page_count,
            cover_emoji = excluded.cover_emoji,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.title ?? null,
          entry.author ?? null,
          entry.language ?? 'en',
          entry.source_type ?? 'toc_only',
          entry.file_object_key ?? null,
          entry.file_name ?? null,
          entry.file_hash ?? null,
          entry.page_count ?? null,
          entry.cover_emoji ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_book_chapters
  if (changes?.kaizen_book_chapters?.length) {
    for (const entry of changes.kaizen_book_chapters) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_book_chapters (
            id, user_id, book_id, chapter_index, title, start_page, end_page, status,
            content_object_key, summary, read_at, questions_generated_at,
            created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            book_id = excluded.book_id,
            chapter_index = excluded.chapter_index,
            title = excluded.title,
            start_page = excluded.start_page,
            end_page = excluded.end_page,
            status = excluded.status,
            content_object_key = excluded.content_object_key,
            summary = excluded.summary,
            read_at = excluded.read_at,
            questions_generated_at = excluded.questions_generated_at,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.book_id ?? null,
          entry.chapter_index ?? 0,
          entry.title ?? null,
          entry.start_page ?? null,
          entry.end_page ?? null,
          entry.status ?? 'none',
          entry.content_object_key ?? null,
          entry.summary ?? null,
          entry.read_at ?? null,
          entry.questions_generated_at ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_book_questions
  if (changes?.kaizen_book_questions?.length) {
    for (const entry of changes.kaizen_book_questions) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_book_questions (
            id, user_id, book_id, chapter_id, type, prompt, options, answer_index,
            ideal_answer, rubric, language, difficulty_0_to_100, source_highlight_id,
            stability, difficulty, retrievability, reps, lapses, last_reviewed_at,
            due_at, desired_retention, created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            book_id = excluded.book_id,
            chapter_id = excluded.chapter_id,
            type = excluded.type,
            prompt = excluded.prompt,
            options = excluded.options,
            answer_index = excluded.answer_index,
            ideal_answer = excluded.ideal_answer,
            rubric = excluded.rubric,
            language = excluded.language,
            difficulty_0_to_100 = excluded.difficulty_0_to_100,
            source_highlight_id = excluded.source_highlight_id,
            stability = excluded.stability,
            difficulty = excluded.difficulty,
            retrievability = excluded.retrievability,
            reps = excluded.reps,
            lapses = excluded.lapses,
            last_reviewed_at = excluded.last_reviewed_at,
            due_at = excluded.due_at,
            desired_retention = excluded.desired_retention,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.book_id ?? null,
          entry.chapter_id ?? null,
          entry.type ?? 'open',
          entry.prompt ?? null,
          entry.options ?? null,
          entry.answer_index ?? null,
          entry.ideal_answer ?? null,
          entry.rubric ?? null,
          entry.language ?? 'en',
          entry.difficulty_0_to_100 ?? null,
          entry.source_highlight_id ?? null,
          entry.stability ?? null,
          entry.difficulty ?? null,
          entry.retrievability ?? null,
          entry.reps ?? 0,
          entry.lapses ?? 0,
          entry.last_reviewed_at ?? null,
          entry.due_at ?? null,
          entry.desired_retention ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_book_attempts
  if (changes?.kaizen_book_attempts?.length) {
    for (const entry of changes.kaizen_book_attempts) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_book_attempts (
            id, user_id, question_id, book_id, chapter_id, attempted_at, answer_source,
            answer_text, selected_index, is_correct, audio_object_key, transcription,
            content_score, overall_score, mistakes, pronunciation, delivery, feedback,
            fsrs_rating, scored_offline, created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            question_id = excluded.question_id,
            book_id = excluded.book_id,
            chapter_id = excluded.chapter_id,
            attempted_at = excluded.attempted_at,
            answer_source = excluded.answer_source,
            answer_text = excluded.answer_text,
            selected_index = excluded.selected_index,
            is_correct = excluded.is_correct,
            audio_object_key = excluded.audio_object_key,
            transcription = excluded.transcription,
            content_score = excluded.content_score,
            overall_score = excluded.overall_score,
            mistakes = excluded.mistakes,
            pronunciation = excluded.pronunciation,
            delivery = excluded.delivery,
            feedback = excluded.feedback,
            fsrs_rating = excluded.fsrs_rating,
            scored_offline = excluded.scored_offline,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.question_id ?? null,
          entry.book_id ?? null,
          entry.chapter_id ?? null,
          entry.attempted_at || now,
          entry.answer_source ?? 'typed',
          entry.answer_text ?? null,
          entry.selected_index ?? null,
          entry.is_correct ?? null,
          entry.audio_object_key ?? null,
          entry.transcription ?? null,
          entry.content_score ?? null,
          entry.overall_score ?? null,
          entry.mistakes ?? null,
          entry.pronunciation ?? null,
          entry.delivery ?? null,
          entry.feedback ?? null,
          entry.fsrs_rating ?? null,
          entry.scored_offline ?? 0,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_book_mistakes
  if (changes?.kaizen_book_mistakes?.length) {
    for (const entry of changes.kaizen_book_mistakes) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_book_mistakes (
            id, user_id, book_id, type, text, correction, explanation, severity, status,
            dedup_key, regression_count, srs_state, due_at, last_seen_at,
            created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            book_id = excluded.book_id,
            type = excluded.type,
            text = excluded.text,
            correction = excluded.correction,
            explanation = excluded.explanation,
            severity = excluded.severity,
            status = excluded.status,
            dedup_key = excluded.dedup_key,
            regression_count = excluded.regression_count,
            srs_state = excluded.srs_state,
            due_at = excluded.due_at,
            last_seen_at = excluded.last_seen_at,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.book_id ?? null,
          entry.type ?? 'grammar',
          entry.text ?? null,
          entry.correction ?? null,
          entry.explanation ?? null,
          entry.severity ?? null,
          entry.status ?? 'detected',
          entry.dedup_key ?? null,
          entry.regression_count ?? 0,
          entry.srs_state ?? null,
          entry.due_at ?? null,
          entry.last_seen_at ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_book_highlights
  if (changes?.kaizen_book_highlights?.length) {
    for (const entry of changes.kaizen_book_highlights) {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_book_highlights (
            id, user_id, book_id, chapter_id, text, anchor, color, note,
            created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            book_id = excluded.book_id,
            chapter_id = excluded.chapter_id,
            text = excluded.text,
            anchor = excluded.anchor,
            color = excluded.color,
            note = excluded.note,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.book_id ?? null,
          entry.chapter_id ?? null,
          entry.text ?? null,
          entry.anchor ?? null,
          entry.color ?? null,
          entry.note ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // ==========================================================================
  // Kaizen — Phase 2 children
  // ==========================================================================

  // kaizen_action_logs (child of kaizen_actions)
  if (changes?.kaizen_action_logs?.length) {
    for (const entry of changes.kaizen_action_logs) {
      childBatchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_action_logs (
            id, user_id, action_id, date, completed_at, skipped, skip_reason, source, notes,
            created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            action_id = excluded.action_id,
            date = excluded.date,
            completed_at = excluded.completed_at,
            skipped = excluded.skipped,
            skip_reason = excluded.skip_reason,
            source = excluded.source,
            notes = excluded.notes,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.action_id ?? null,
          entry.date ?? null,
          entry.completed_at ?? null,
          entry.skipped ? 1 : 0,
          entry.skip_reason ?? null,
          entry.source ?? null,
          entry.notes ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_skill_progress_logs (child of kaizen_skill_nodes)
  if (changes?.kaizen_skill_progress_logs?.length) {
    for (const entry of changes.kaizen_skill_progress_logs) {
      childBatchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_skill_progress_logs (
            id, user_id, skill_id, previous_level, new_level, previous_mastery, new_mastery,
            evidence, date, created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            skill_id = excluded.skill_id,
            previous_level = excluded.previous_level,
            new_level = excluded.new_level,
            previous_mastery = excluded.previous_mastery,
            new_mastery = excluded.new_mastery,
            evidence = excluded.evidence,
            date = excluded.date,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.skill_id ?? null,
          entry.previous_level ?? null,
          entry.new_level ?? null,
          entry.previous_mastery ?? null,
          entry.new_mastery ?? null,
          entry.evidence ?? null,
          entry.date ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_habit_stack_steps (child of kaizen_habit_stacks)
  if (changes?.kaizen_habit_stack_steps?.length) {
    for (const entry of changes.kaizen_habit_stack_steps) {
      childBatchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_habit_stack_steps (
            id, user_id, stack_id, action_id, sort_order, created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            stack_id = excluded.stack_id,
            action_id = excluded.action_id,
            sort_order = excluded.sort_order,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).bind(
          entry.id ?? null,
          userId,
          entry.stack_id ?? null,
          entry.action_id ?? null,
          entry.sort_order ?? null,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // kaizen_interview_attempts (child of kaizen_interview_questions)
  // ONE-WAY UPGRADE UPSERT: attempts are immutable events. The only legitimate
  // update is upgrading an offline self-scored attempt (scored_offline = 1) to its
  // authoritative AI score (scored_offline = 0). The WHERE clause on the conflict
  // target ensures the row is overwritten ONLY when an incoming AI-scored attempt
  // (excluded.scored_offline = 0) lands on an existing offline self-scored row
  // (kaizen_interview_attempts.scored_offline = 1). It never overwrites a row that
  // has already been AI-scored, and never downgrades an AI score back to offline.
  if (changes?.kaizen_interview_attempts?.length) {
    for (const entry of changes.kaizen_interview_attempts) {
      childBatchStatements.push(
        db.prepare(`
          INSERT INTO kaizen_interview_attempts (
            id, user_id, question_id, attempted_at, answer_text, answer_source,
            duration_seconds, is_baseline, is_diagnostic, self_confidence, criterion_scores,
            overall_score, correction_suggestions, lesson_learned, gap_vs_ideal, fsrs_rating,
            judge_reasoning, judge_model, provider_fingerprint, scored_offline,
            created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            question_id = excluded.question_id,
            attempted_at = excluded.attempted_at,
            answer_text = excluded.answer_text,
            answer_source = excluded.answer_source,
            duration_seconds = excluded.duration_seconds,
            is_baseline = excluded.is_baseline,
            is_diagnostic = excluded.is_diagnostic,
            self_confidence = excluded.self_confidence,
            criterion_scores = excluded.criterion_scores,
            overall_score = excluded.overall_score,
            correction_suggestions = excluded.correction_suggestions,
            lesson_learned = excluded.lesson_learned,
            gap_vs_ideal = excluded.gap_vs_ideal,
            fsrs_rating = excluded.fsrs_rating,
            judge_reasoning = excluded.judge_reasoning,
            judge_model = excluded.judge_model,
            provider_fingerprint = excluded.provider_fingerprint,
            scored_offline = excluded.scored_offline,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
          WHERE excluded.scored_offline = 0 AND kaizen_interview_attempts.scored_offline = 1
        `).bind(
          entry.id ?? null,
          userId,
          entry.question_id ?? null,
          entry.attempted_at ?? null,
          entry.answer_text ?? null,
          entry.answer_source ?? null,
          entry.duration_seconds ?? null,
          entry.is_baseline ? 1 : 0,
          entry.is_diagnostic ? 1 : 0,
          entry.self_confidence ?? null,
          entry.criterion_scores ?? null,
          entry.overall_score ?? null,
          entry.correction_suggestions ?? null,
          entry.lesson_learned ?? null,
          entry.gap_vs_ideal ?? null,
          entry.fsrs_rating ?? null,
          entry.judge_reasoning ?? null,
          entry.judge_model ?? null,
          entry.provider_fingerprint ?? null,
          entry.scored_offline ? 1 : 0,
          entry.created_at || now,
          now,
          (entry as any).deleted_at ?? null
        )
      );
    }
  }

  // Helper function to execute a batch with retry logic
  async function executeBatchWithRetry(statements: D1PreparedStatement[], phaseName: string) {
    if (statements.length === 0) return;

    console.log(`[Sync] Executing ${phaseName} batch of ${statements.length} statements`);

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await db.batch(statements);
        return; // Success
      } catch (error) {
        lastError = error as Error;
        const errorStr = String(error);

        // Check if this is a retryable D1 error
        if (errorStr.includes('D1_RESET_DO') || errorStr.includes('D1_ERROR')) {
          console.warn(`[Sync] D1 transient error on ${phaseName} attempt ${attempt}/${maxRetries}: ${errorStr}`);
          if (attempt < maxRetries) {
            // Exponential backoff: 100ms, 200ms, 400ms
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
            continue;
          }
        }
        // Non-retryable error or max retries reached
        throw error;
      }
    }

    // If we get here, all retries failed
    throw lastError;
  }

  // Two-phase execution to respect foreign key constraints:
  // Phase 1: Parent tables
  // Phase 2: Child tables
  // This ensures parent records exist before child records reference them.
  await executeBatchWithRetry(parentBatchStatements, 'phase-1-parents');
  await executeBatchWithRetry(childBatchStatements, 'phase-2-children');
}

export async function getServerChanges(
  db: D1Database,
  userId: string,
  lastSyncAt: Date | null
): Promise<SyncResponse['changes']> {
  const since = lastSyncAt?.toISOString() || '1970-01-01T00:00:00.000Z';

  // Kaizen — Phase 1 parents
  const kaizenProfiles = await db.prepare(`
    SELECT * FROM kaizen_profiles
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenProfileEntry>();

  const kaizenActions = await db.prepare(`
    SELECT * FROM kaizen_actions
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenActionEntry>();

  const kaizenWeeklyRotations = await db.prepare(`
    SELECT * FROM kaizen_weekly_rotations
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenWeeklyRotationEntry>();

  const kaizenHabitStacks = await db.prepare(`
    SELECT * FROM kaizen_habit_stacks
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenHabitStackEntry>();

  const kaizenDeepWorkBlocks = await db.prepare(`
    SELECT * FROM kaizen_deep_work_blocks
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenDeepWorkBlockEntry>();

  const kaizenSkillNodes = await db.prepare(`
    SELECT * FROM kaizen_skill_nodes
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenSkillNodeEntry>();

  const kaizenUserMemory = await db.prepare(`
    SELECT * FROM kaizen_user_memory
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenUserMemoryEntry>();

  const kaizenInterviewPipeline = await db.prepare(`
    SELECT * FROM kaizen_interview_pipeline
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenInterviewPipelineEntry>();

  const kaizenInterviewQuestions = await db.prepare(`
    SELECT * FROM kaizen_interview_questions
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenInterviewQuestionEntry>();

  const kaizenKnowledgeItems = await db.prepare(`
    SELECT * FROM kaizen_knowledge_items
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenKnowledgeItemEntry>();

  const kaizenGtdItems = await db.prepare(`
    SELECT * FROM kaizen_gtd_items
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenGtdItemEntry>();

  const kaizenWeeklyReviews = await db.prepare(`
    SELECT * FROM kaizen_weekly_reviews
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenWeeklyReviewEntry>();

  // Kaizen — Phase 2 children
  const kaizenActionLogs = await db.prepare(`
    SELECT * FROM kaizen_action_logs
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenActionLogEntry>();

  const kaizenHabitStackSteps = await db.prepare(`
    SELECT * FROM kaizen_habit_stack_steps
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenHabitStackStepEntry>();

  const kaizenSkillProgressLogs = await db.prepare(`
    SELECT * FROM kaizen_skill_progress_logs
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenSkillProgressLogEntry>();

  const kaizenInterviewAttempts = await db.prepare(`
    SELECT * FROM kaizen_interview_attempts
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenInterviewAttemptEntry>();

  // Book Comprehension feature
  const kaizenBooks = await db.prepare(`
    SELECT * FROM kaizen_books
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenBookEntry>();

  const kaizenBookChapters = await db.prepare(`
    SELECT * FROM kaizen_book_chapters
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenBookChapterEntry>();

  const kaizenBookQuestions = await db.prepare(`
    SELECT * FROM kaizen_book_questions
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenBookQuestionEntry>();

  const kaizenBookAttempts = await db.prepare(`
    SELECT * FROM kaizen_book_attempts
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenBookAttemptEntry>();

  const kaizenBookMistakes = await db.prepare(`
    SELECT * FROM kaizen_book_mistakes
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenBookMistakeEntry>();

  const kaizenBookHighlights = await db.prepare(`
    SELECT * FROM kaizen_book_highlights
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, since).all<KaizenBookHighlightEntry>();

  return {
    kaizen_profiles: kaizenProfiles.results || [],
    kaizen_actions: kaizenActions.results || [],
    kaizen_action_logs: kaizenActionLogs.results || [],
    kaizen_weekly_rotations: kaizenWeeklyRotations.results || [],
    kaizen_habit_stacks: kaizenHabitStacks.results || [],
    kaizen_habit_stack_steps: kaizenHabitStackSteps.results || [],
    kaizen_deep_work_blocks: kaizenDeepWorkBlocks.results || [],
    kaizen_skill_nodes: kaizenSkillNodes.results || [],
    kaizen_skill_progress_logs: kaizenSkillProgressLogs.results || [],
    kaizen_user_memory: kaizenUserMemory.results || [],
    kaizen_interview_pipeline: kaizenInterviewPipeline.results || [],
    kaizen_interview_questions: kaizenInterviewQuestions.results || [],
    kaizen_interview_attempts: kaizenInterviewAttempts.results || [],
    kaizen_knowledge_items: kaizenKnowledgeItems.results || [],
    kaizen_gtd_items: kaizenGtdItems.results || [],
    kaizen_weekly_reviews: kaizenWeeklyReviews.results || [],
    kaizen_books: kaizenBooks.results || [],
    kaizen_book_chapters: kaizenBookChapters.results || [],
    kaizen_book_questions: kaizenBookQuestions.results || [],
    kaizen_book_attempts: kaizenBookAttempts.results || [],
    kaizen_book_mistakes: kaizenBookMistakes.results || [],
    kaizen_book_highlights: kaizenBookHighlights.results || [],
  };
}

export default sync;
