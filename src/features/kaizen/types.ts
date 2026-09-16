/**
 * Symply Life (brand `symply-kaizen`) — local data model.
 *
 * Ported 1:1 from the donor Kaizen app (`Simply Kaizen/kaizen/src/types/kaizen.ts`).
 * Interface names (`Kaizen*`) and table names (`kaizen_*`) are the DB + delta-sync
 * wire contract and MUST stay byte-identical across mobile ⇄ backend and with the
 * iOS Swift origin — do not rename. Booleans are SQLite INTEGER (0/1); JSON is TEXT;
 * dates are ISO strings.
 */

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

// ---------------------------------------------------------------------------
// Book Comprehension & Retention feature (Kaizen). Six local-first tables that
// sync through /api/v1/sync. Intra-feature relations are soft refs (id strings,
// no FK). JSON payloads are stored as TEXT columns (options/rubric/mistakes/…).
// ---------------------------------------------------------------------------

export interface KaizenBookEntry {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  language: string;
  source_type: string; // toc_only | pdf | epub
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
  status: string; // none | processing | ready | failed
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
  type: string; // mcq | open | spoken
  prompt: string;
  options: string | null; // JSON string[]
  answer_index: number | null;
  ideal_answer: string | null;
  rubric: string | null; // JSON
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
  answer_source: string; // typed | spoken | mcq
  answer_text: string | null;
  selected_index: number | null;
  is_correct: number | null;
  audio_object_key: string | null;
  transcription: string | null;
  content_score: number | null; // Layer 1: meaning
  overall_score: number | null;
  mistakes: string | null; // JSON: Layer 2 grammar/form
  pronunciation: string | null; // JSON (spoken)
  delivery: string | null; // JSON (spoken)
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
  type: string; // grammar | pronunciation | vocabulary | fluency
  text: string;
  correction: string | null;
  explanation: string | null;
  severity: string | null;
  status: string; // detected | practicing | mastered | archived
  dedup_key: string | null;
  regression_count: number;
  srs_state: string | null; // JSON
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
  anchor: string | null; // JSON: {start,end} char offsets
  color: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const KAIZEN_TABLES = [
  'kaizen_profiles',
  'kaizen_actions',
  'kaizen_action_logs',
  'kaizen_weekly_rotations',
  'kaizen_habit_stacks',
  'kaizen_habit_stack_steps',
  'kaizen_deep_work_blocks',
  'kaizen_skill_nodes',
  'kaizen_skill_progress_logs',
  'kaizen_user_memory',
  'kaizen_interview_pipeline',
  'kaizen_interview_questions',
  'kaizen_interview_attempts',
  'kaizen_knowledge_items',
  'kaizen_gtd_items',
  'kaizen_weekly_reviews',
  'kaizen_books',
  'kaizen_book_chapters',
  'kaizen_book_questions',
  'kaizen_book_attempts',
  'kaizen_book_mistakes',
  'kaizen_book_highlights',
] as const;

export type KaizenTable = (typeof KAIZEN_TABLES)[number];
export type KaizenTableName = KaizenTable;
