/**
 * Shared test helpers for the ported Kaizen (Kaizen) backend routes.
 *
 * The Kaizen surface (sync of the 22 `kaizen_*` tables, the AI endpoints and
 * the Kaizen Master coach chat) has no D1 helper of its own, so this file
 * synthesises the minimal schema those routes read/write — a faithful subset of
 *   migrations/0094_kaizen.sql        (16 core kaizen_* tables)
 *   migrations/0095_kaizen_feature_flags.sql (feature_flags kill switch)
 *   migrations/0096_kaizen_books.sql   (6 kaizen_book_* tables)
 * plus the lazily-created `kaizen_ai_usage` cost-guard counter.
 *
 * Mirrors the DDL style of services/aihousekeeper/__tests__/test-helpers.ts and
 * routes/__tests__/appliances.test.ts: plain CREATE TABLE IF NOT EXISTS with the
 * FOREIGN KEY clauses and indexes dropped (miniflare D1 does not enforce FKs in
 * these tests — see the appliances suite), collapsed to a single line before exec.
 */

import type { D1Database } from '@cloudflare/workers-types';

const KAIZEN_TABLE_DDL: string[] = [
  // Minimal users row target (FKs are dropped, but keep it for realistic seeds).
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,

  // ---- 0094_kaizen.sql : 16 core tables ----------------------------------
  `CREATE TABLE IF NOT EXISTS kaizen_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    timezone TEXT,
    onboarding_complete INTEGER NOT NULL DEFAULT 0,
    enabled_systems TEXT,
    system_activation_states TEXT,
    primary_system TEXT,
    daily_core_ids TEXT,
    career_setup_step TEXT,
    target_roles TEXT,
    career_goal_types TEXT,
    selected_career_skill_ids TEXT,
    resume_source_name TEXT,
    resume_summary TEXT,
    career_plan_summary TEXT,
    interaction_style TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_actions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    system TEXT NOT NULL,
    rhythm TEXT NOT NULL DEFAULT 'daily',
    linked_feature TEXT,
    is_daily_core INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    time_of_day TEXT NOT NULL DEFAULT 'anytime',
    stack_id TEXT,
    rotation_day INTEGER,
    reminder_anchor TEXT,
    reminder_policy TEXT,
    watch_quick_log_enabled INTEGER NOT NULL DEFAULT 0,
    voice_log_prompt TEXT,
    input_description TEXT,
    output_description TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_action_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    date TEXT NOT NULL,
    completed_at TEXT,
    skipped INTEGER NOT NULL DEFAULT 0,
    skip_reason TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_weekly_rotations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    weekday INTEGER NOT NULL,
    focus_title TEXT NOT NULL,
    system TEXT,
    linked_skill_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_habit_stacks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_habit_stack_steps (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    stack_id TEXT NOT NULL,
    action_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_deep_work_blocks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    topic TEXT,
    suggest_focus_mode INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_skill_nodes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    level_raw INTEGER NOT NULL DEFAULT 0,
    mastery_0_to_100 INTEGER,
    activation_state TEXT NOT NULL DEFAULT 'planned',
    concept_band TEXT,
    level_descriptions TEXT,
    is_priority INTEGER NOT NULL DEFAULT 0,
    is_assessable INTEGER NOT NULL DEFAULT 1,
    assessment_weight REAL NOT NULL DEFAULT 1.0,
    prerequisite_ids TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_skill_progress_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    previous_level INTEGER,
    new_level INTEGER,
    previous_mastery INTEGER,
    new_mastery INTEGER,
    evidence TEXT,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_user_memory (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    fact TEXT NOT NULL,
    confidence REAL,
    sensitivity TEXT NOT NULL DEFAULT 'normal',
    source_kind TEXT,
    source_ref TEXT,
    source_session_id TEXT,
    is_approved INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT,
    expires_at TEXT,
    use_in_ai_context INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_interview_pipeline (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'book',
    linked_skill_id TEXT,
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_interview_questions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    question_bank TEXT NOT NULL DEFAULT 'technical',
    kind TEXT,
    purpose TEXT NOT NULL DEFAULT 'interviewPractice',
    linked_skill_id TEXT,
    linked_concept_id TEXT,
    concept_band TEXT,
    difficulty_0_to_100 INTEGER,
    topic_tags TEXT,
    import_source TEXT,
    import_batch_id TEXT,
    source_document_name TEXT,
    source_hash TEXT,
    import_review_status TEXT,
    ideal_answer TEXT,
    rubric TEXT,
    judge_model TEXT,
    ideal_answer_version INTEGER NOT NULL DEFAULT 0,
    baseline_attempt_id TEXT,
    stability REAL,
    difficulty REAL,
    retrievability REAL,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at TEXT,
    due_at TEXT,
    desired_retention REAL NOT NULL DEFAULT 0.9,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_interview_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    attempted_at TEXT NOT NULL,
    answer_text TEXT,
    answer_source TEXT NOT NULL DEFAULT 'text',
    duration_seconds INTEGER,
    is_baseline INTEGER NOT NULL DEFAULT 0,
    is_diagnostic INTEGER NOT NULL DEFAULT 0,
    self_confidence INTEGER,
    criterion_scores TEXT,
    overall_score REAL,
    correction_suggestions TEXT,
    lesson_learned TEXT,
    gap_vs_ideal TEXT,
    fsrs_rating INTEGER,
    judge_reasoning TEXT,
    judge_model TEXT,
    provider_fingerprint TEXT,
    scored_offline INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_knowledge_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    para_type TEXT NOT NULL DEFAULT 'resource',
    title TEXT NOT NULL,
    content TEXT,
    tags TEXT,
    linked_skill_id TEXT,
    book_metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_gtd_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT,
    system TEXT,
    status TEXT NOT NULL DEFAULT 'inbox',
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_weekly_reviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    week_start TEXT NOT NULL,
    wins TEXT,
    improvements TEXT,
    one_percent_change TEXT,
    system_adjustments TEXT,
    career_snapshot TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,

  // ---- 0096_kaizen_books.sql : 6 book tables ------------------------------
  `CREATE TABLE IF NOT EXISTS kaizen_books (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    source_type TEXT NOT NULL DEFAULT 'toc_only',
    file_object_key TEXT,
    file_name TEXT,
    file_hash TEXT,
    page_count INTEGER,
    cover_emoji TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_book_chapters (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    start_page INTEGER,
    end_page INTEGER,
    status TEXT NOT NULL DEFAULT 'none',
    content_object_key TEXT,
    summary TEXT,
    read_at TEXT,
    questions_generated_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_book_questions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'open',
    prompt TEXT NOT NULL,
    options TEXT,
    answer_index INTEGER,
    ideal_answer TEXT,
    rubric TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    difficulty_0_to_100 INTEGER,
    source_highlight_id TEXT,
    stability REAL,
    difficulty REAL,
    retrievability REAL,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at TEXT,
    due_at TEXT,
    desired_retention REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_book_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    book_id TEXT,
    chapter_id TEXT,
    attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
    answer_source TEXT NOT NULL DEFAULT 'typed',
    answer_text TEXT,
    selected_index INTEGER,
    is_correct INTEGER,
    audio_object_key TEXT,
    transcription TEXT,
    content_score REAL,
    overall_score REAL,
    mistakes TEXT,
    pronunciation TEXT,
    delivery TEXT,
    feedback TEXT,
    fsrs_rating INTEGER,
    scored_offline INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_book_mistakes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT,
    type TEXT NOT NULL DEFAULT 'grammar',
    text TEXT NOT NULL,
    correction TEXT,
    explanation TEXT,
    severity TEXT,
    status TEXT NOT NULL DEFAULT 'detected',
    dedup_key TEXT,
    regression_count INTEGER NOT NULL DEFAULT 0,
    srs_state TEXT,
    due_at TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_book_highlights (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    text TEXT NOT NULL,
    anchor TEXT,
    color TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,

  // ---- 0095_kaizen_feature_flags.sql (coach-chat kill switch) ------------
  `CREATE TABLE IF NOT EXISTS feature_flags (
    key TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ---- costGuards.ts lazily-created counter (create up-front for reset) ---
  `CREATE TABLE IF NOT EXISTS kaizen_ai_usage (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
  )`,
];

/** Every table name this helper owns — used by resetKaizenTables. */
export const KAIZEN_TABLE_NAMES: readonly string[] = [
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
  'feature_flags',
  'kaizen_ai_usage',
  'users',
];

/** Create the users + 22 kaizen_* tables + feature_flags + cost-guard counter. */
export async function createKaizenTables(db: D1Database): Promise<void> {
  for (const stmt of KAIZEN_TABLE_DDL) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

/** Truncate every Kaizen test table so each spec starts from a clean slate. */
export async function resetKaizenTables(db: D1Database): Promise<void> {
  for (const t of KAIZEN_TABLE_NAMES) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist in this file's subset; ignore
    }
  }
}

/** Set (or clear) the `kaizenAIScoring` kill-switch flag used by coach chat. */
export async function setAiScoringFlag(db: D1Database, enabled: boolean): Promise<void> {
  await db
    .prepare(
      `INSERT INTO feature_flags (key, enabled, description, updated_at)
       VALUES ('kaizenAIScoring', ?, 'test', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled`
    )
    .bind(enabled ? 1 : 0)
    .run();
}
