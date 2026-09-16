-- Rebrand: rename the Kaizen storage tables from their legacy `life_os_*` names
-- to `kaizen_*`, matching the app rebrand (Symply Life → Symply Kaizen). Data is
-- preserved. SQLite carries each table's indexes and triggers across a RENAME,
-- so queries keep using them; the index names keep their historical
-- `idx_life_os_*` labels (internal only — not referenced by application code).
--
-- Runs after 0094 (core tables), 0095 (feature flags — no life_os_* tables), and
-- 0096 (book tables), so every source table below exists at apply time.
-- Immutable once applied remote; do not edit.

ALTER TABLE life_os_profiles RENAME TO kaizen_profiles;
ALTER TABLE life_os_actions RENAME TO kaizen_actions;
ALTER TABLE life_os_action_logs RENAME TO kaizen_action_logs;
ALTER TABLE life_os_weekly_rotations RENAME TO kaizen_weekly_rotations;
ALTER TABLE life_os_habit_stacks RENAME TO kaizen_habit_stacks;
ALTER TABLE life_os_habit_stack_steps RENAME TO kaizen_habit_stack_steps;
ALTER TABLE life_os_deep_work_blocks RENAME TO kaizen_deep_work_blocks;
ALTER TABLE life_os_skill_nodes RENAME TO kaizen_skill_nodes;
ALTER TABLE life_os_skill_progress_logs RENAME TO kaizen_skill_progress_logs;
ALTER TABLE life_os_user_memory RENAME TO kaizen_user_memory;
ALTER TABLE life_os_interview_pipeline RENAME TO kaizen_interview_pipeline;
ALTER TABLE life_os_interview_questions RENAME TO kaizen_interview_questions;
ALTER TABLE life_os_interview_attempts RENAME TO kaizen_interview_attempts;
ALTER TABLE life_os_knowledge_items RENAME TO kaizen_knowledge_items;
ALTER TABLE life_os_gtd_items RENAME TO kaizen_gtd_items;
ALTER TABLE life_os_weekly_reviews RENAME TO kaizen_weekly_reviews;
ALTER TABLE life_os_books RENAME TO kaizen_books;
ALTER TABLE life_os_book_chapters RENAME TO kaizen_book_chapters;
ALTER TABLE life_os_book_questions RENAME TO kaizen_book_questions;
ALTER TABLE life_os_book_attempts RENAME TO kaizen_book_attempts;
ALTER TABLE life_os_book_mistakes RENAME TO kaizen_book_mistakes;
ALTER TABLE life_os_book_highlights RENAME TO kaizen_book_highlights;
