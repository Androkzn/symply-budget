-- Migration: 088_life_os
-- Description: Life OS v1 — Personal Operating System. All 16 Life OS tables.
--
-- Conventions (follow 019_habits.sql):
--   * Every table: user_id TEXT NOT NULL, created_at/updated_at/deleted_at TEXT,
--     FK to users(id) ON DELETE CASCADE, index on (user_id, updated_at).
--   * Soft-delete via deleted_at (never hard DELETE on sync).
--   * JSON payloads stored in TEXT columns.
--   * Booleans stored as INTEGER 0/1.
--
-- Intentional SOFT references (NOT enforced as FKs), validated app-side:
--   (1) life_os_interview_questions.baseline_attempt_id — attempts are Phase-2
--       children of questions; a hard FK would create a cyclic sync dependency.
--   (2) life_os_skill_nodes.parent_id — self-referential within a Phase-1 table;
--       a hard self-FK would fail on out-of-order batch inserts.
--   (3) every linked_skill_id (rotations/pipeline/knowledge -> skill_nodes) —
--       mirrors the existing challenge_progress soft-FK pattern.
--
-- Idempotency is mandatory: deploy.sh re-runs the entire migrations/ folder on
-- every deploy and swallows errors, so every statement is independently idempotent
-- (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS). Adds only NEW tables.

-- =============================================================================
-- 1. life_os_profiles — one per user; onboarding + career setup state
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    timezone TEXT,
    onboarding_complete INTEGER NOT NULL DEFAULT 0,
    enabled_systems TEXT,                  -- JSON array of system kinds
    system_activation_states TEXT,         -- JSON map systemKind -> activation state (enabled/paused/hidden/available)
    primary_system TEXT,                   -- the user's primary system kind, if any
    daily_core_ids TEXT,                   -- JSON array of action ids
    career_setup_step TEXT,
    target_roles TEXT,                     -- JSON array
    career_goal_types TEXT,                -- JSON array
    selected_career_skill_ids TEXT,        -- JSON array
    resume_source_name TEXT,
    resume_summary TEXT,
    career_plan_summary TEXT,
    interaction_style TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_profiles_user_id ON life_os_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_profiles_updated_at ON life_os_profiles(updated_at);

-- =============================================================================
-- 2. life_os_actions — universal action unit (Daily Core / rotation / etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_actions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    system TEXT NOT NULL,                  -- health/career/mental/personal/administration/...
    rhythm TEXT NOT NULL DEFAULT 'daily',  -- daily/weekly/monthly
    linked_feature TEXT,                   -- JSON enum payload (weightLog/nutritionLog/habit(id)/manual/...)
    is_daily_core INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    time_of_day TEXT NOT NULL DEFAULT 'anytime',
    stack_id TEXT,                         -- soft ref -> life_os_habit_stacks
    rotation_day INTEGER,                  -- 1-7 weekday, NULL = every day
    reminder_anchor TEXT,
    reminder_policy TEXT,                  -- JSON ActionReminderPolicy
    watch_quick_log_enabled INTEGER NOT NULL DEFAULT 0,
    voice_log_prompt TEXT,
    input_description TEXT,
    output_description TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_actions_user_id ON life_os_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_actions_updated_at ON life_os_actions(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_actions_system ON life_os_actions(user_id, system);

-- =============================================================================
-- 3. life_os_action_logs — completion / skip events (Phase-2 child of actions)
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_action_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    date TEXT NOT NULL,                    -- YYYY-MM-DD
    completed_at TEXT,
    skipped INTEGER NOT NULL DEFAULT 0,
    skip_reason TEXT,
    source TEXT NOT NULL DEFAULT 'manual', -- manual/auto/notificationAction/watch/siri/shortcut
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (action_id) REFERENCES life_os_actions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_action_logs_user_id ON life_os_action_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_action_logs_updated_at ON life_os_action_logs(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_action_logs_action ON life_os_action_logs(action_id, date);

-- =============================================================================
-- 4. life_os_weekly_rotations — per-weekday focus
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_weekly_rotations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    weekday INTEGER NOT NULL,              -- 1-7
    focus_title TEXT NOT NULL,
    system TEXT,
    linked_skill_id TEXT,                  -- soft ref -> life_os_skill_nodes
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_weekly_rotations_user_id ON life_os_weekly_rotations(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_weekly_rotations_updated_at ON life_os_weekly_rotations(updated_at);

-- =============================================================================
-- 5. life_os_habit_stacks — ordered chains of actions
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_habit_stacks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_habit_stacks_user_id ON life_os_habit_stacks(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_habit_stacks_updated_at ON life_os_habit_stacks(updated_at);

-- =============================================================================
-- 6. life_os_habit_stack_steps — Phase-2 child of stacks (+ soft ref to actions)
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_habit_stack_steps (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    stack_id TEXT NOT NULL,
    action_id TEXT,                        -- soft ref -> life_os_actions
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (stack_id) REFERENCES life_os_habit_stacks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_habit_stack_steps_user_id ON life_os_habit_stack_steps(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_habit_stack_steps_updated_at ON life_os_habit_stack_steps(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_habit_stack_steps_stack ON life_os_habit_stack_steps(stack_id, sort_order);

-- =============================================================================
-- 7. life_os_deep_work_blocks — (local-only in v1, table provisioned for parity)
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_deep_work_blocks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,                    -- YYYY-MM-DD
    start_time TEXT,
    end_time TEXT,
    topic TEXT,
    suggest_focus_mode INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_deep_work_blocks_user_id ON life_os_deep_work_blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_deep_work_blocks_updated_at ON life_os_deep_work_blocks(updated_at);

-- =============================================================================
-- 8. life_os_skill_nodes — career skill tree (self-ref parent_id is a SOFT ref)
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_skill_nodes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,                        -- SOFT self-ref; NO FK (out-of-order batch safe)
    level_raw INTEGER NOT NULL DEFAULT 0,  -- 0-5 SkillLevel
    mastery_0_to_100 INTEGER,              -- derived placement, nullable
    activation_state TEXT NOT NULL DEFAULT 'planned', -- planned/activePendingAssessment/activeTraining/paused/reassessDue
    concept_band TEXT,                     -- 101/junior/mid/senior (concept nodes)
    level_descriptions TEXT,               -- JSON map level->description
    is_priority INTEGER NOT NULL DEFAULT 0,
    is_assessable INTEGER NOT NULL DEFAULT 1,
    assessment_weight REAL NOT NULL DEFAULT 1.0,
    prerequisite_ids TEXT,                 -- JSON array of skill node ids
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_skill_nodes_user_id ON life_os_skill_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_skill_nodes_updated_at ON life_os_skill_nodes(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_skill_nodes_parent ON life_os_skill_nodes(user_id, parent_id);

-- =============================================================================
-- 9. life_os_skill_progress_logs — Phase-2 child of skill_nodes
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_skill_progress_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    previous_level INTEGER,
    new_level INTEGER,
    previous_mastery INTEGER,
    new_mastery INTEGER,
    evidence TEXT,
    date TEXT NOT NULL,                    -- YYYY-MM-DD
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES life_os_skill_nodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_skill_progress_logs_user_id ON life_os_skill_progress_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_skill_progress_logs_updated_at ON life_os_skill_progress_logs(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_skill_progress_logs_skill ON life_os_skill_progress_logs(skill_id, date);

-- =============================================================================
-- 10. life_os_user_memory — Kaizen Master user-approved memories
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_user_memory (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    fact TEXT NOT NULL,
    confidence REAL,
    sensitivity TEXT NOT NULL DEFAULT 'normal', -- normal/sensitive
    source_kind TEXT,                      -- user/coachProposed/derived
    source_ref TEXT,
    source_session_id TEXT,
    is_approved INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT,
    expires_at TEXT,
    use_in_ai_context INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_user_memory_user_id ON life_os_user_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_user_memory_updated_at ON life_os_user_memory(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_user_memory_category ON life_os_user_memory(user_id, category);

-- =============================================================================
-- 11. life_os_interview_pipeline — 6-stage kanban items
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_interview_pipeline (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'book',    -- book/notes/flashcards/practice/mock/review
    linked_skill_id TEXT,                  -- soft ref -> life_os_skill_nodes
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_interview_pipeline_user_id ON life_os_interview_pipeline(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_interview_pipeline_updated_at ON life_os_interview_pipeline(updated_at);

-- =============================================================================
-- 12. life_os_interview_questions — corpus + FSRS scheduler state
--     baseline_attempt_id is a SOFT back-ref (no FK; avoids Phase1<->Phase2 cycle)
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_interview_questions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    question_bank TEXT NOT NULL DEFAULT 'technical', -- technical/behavioral
    kind TEXT,
    purpose TEXT NOT NULL DEFAULT 'interviewPractice', -- diagnostic/interviewPractice
    linked_skill_id TEXT,                  -- soft ref -> life_os_skill_nodes
    linked_concept_id TEXT,                -- soft ref -> life_os_skill_nodes
    concept_band TEXT,                     -- 101/junior/mid/senior
    difficulty_0_to_100 INTEGER,
    topic_tags TEXT,                       -- JSON array
    import_source TEXT,
    import_batch_id TEXT,
    source_document_name TEXT,
    source_hash TEXT,
    import_review_status TEXT,             -- pending/accepted/rejected
    ideal_answer TEXT,
    rubric TEXT,                           -- JSON [RubricCriterion]
    judge_model TEXT,
    ideal_answer_version INTEGER NOT NULL DEFAULT 0,
    baseline_attempt_id TEXT,              -- SOFT ref; NO FK
    -- FSRS-5 scheduler state
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
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_interview_questions_user_id ON life_os_interview_questions(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_interview_questions_updated_at ON life_os_interview_questions(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_interview_questions_bank ON life_os_interview_questions(user_id, question_bank);
CREATE INDEX IF NOT EXISTS idx_life_os_interview_questions_due ON life_os_interview_questions(user_id, due_at);

-- =============================================================================
-- 13. life_os_interview_attempts — immutable attempt events (Phase-2 child)
--     append-merge w/ ONE-WAY upgrade (offline self-score -> AI score). See sync.ts.
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_interview_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    attempted_at TEXT NOT NULL,
    answer_text TEXT,
    answer_source TEXT NOT NULL DEFAULT 'text', -- text/voice
    duration_seconds INTEGER,
    is_baseline INTEGER NOT NULL DEFAULT 0,
    is_diagnostic INTEGER NOT NULL DEFAULT 0,
    self_confidence INTEGER,
    criterion_scores TEXT,                 -- JSON map criterion->score(0-5)
    overall_score REAL,                    -- authoritative grade source (0-5)
    correction_suggestions TEXT,           -- JSON array
    lesson_learned TEXT,
    gap_vs_ideal TEXT,
    fsrs_rating INTEGER,                   -- advisory/logged-only
    judge_reasoning TEXT,
    judge_model TEXT,
    provider_fingerprint TEXT,
    scored_offline INTEGER NOT NULL DEFAULT 0, -- 1 = self-scored offline (upgradeable once)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES life_os_interview_questions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_interview_attempts_user_id ON life_os_interview_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_interview_attempts_updated_at ON life_os_interview_attempts(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_interview_attempts_question ON life_os_interview_attempts(question_id, attempted_at);

-- =============================================================================
-- 14. life_os_knowledge_items — PARA knowledge base
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_knowledge_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    para_type TEXT NOT NULL DEFAULT 'resource', -- project/area/resource/archive
    title TEXT NOT NULL,
    content TEXT,
    tags TEXT,                             -- JSON array
    linked_skill_id TEXT,                  -- soft ref -> life_os_skill_nodes
    book_metadata TEXT,                    -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_knowledge_items_user_id ON life_os_knowledge_items(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_knowledge_items_updated_at ON life_os_knowledge_items(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_knowledge_items_para ON life_os_knowledge_items(user_id, para_type);

-- =============================================================================
-- 15. life_os_gtd_items — GTD inbox capture
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_gtd_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT,
    system TEXT,
    status TEXT NOT NULL DEFAULT 'inbox',  -- inbox/next/waiting/someday/done
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_gtd_items_user_id ON life_os_gtd_items(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_gtd_items_updated_at ON life_os_gtd_items(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_gtd_items_status ON life_os_gtd_items(user_id, status);

-- =============================================================================
-- 16. life_os_weekly_reviews — Kaizen weekly review entries
-- =============================================================================
CREATE TABLE IF NOT EXISTS life_os_weekly_reviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    week_start TEXT NOT NULL,              -- YYYY-MM-DD (Monday)
    wins TEXT,                             -- JSON array
    improvements TEXT,                     -- JSON array
    one_percent_change TEXT,
    system_adjustments TEXT,               -- JSON array
    career_snapshot TEXT,                  -- JSON CareerProgressSnapshot
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_weekly_reviews_user_id ON life_os_weekly_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_weekly_reviews_updated_at ON life_os_weekly_reviews(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_weekly_reviews_week ON life_os_weekly_reviews(user_id, week_start);
