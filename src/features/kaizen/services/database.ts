/**
 * Symply Life (brand `symply-kaizen`) — local expo-sqlite database.
 *
 * Ported 1:1 from the donor Kaizen app (`Simply Kaizen/kaizen/src/services/kaizen/database.ts`).
 * Table/column names are the sync wire contract and stay byte-identical; only the on-device
 * database filename is brand-scoped (fresh install, no donor data continuity). Every data table
 * carries a `dirty` flag (SQL-only, stripped before sync) for offline-first delta sync.
 */
import * as SQLite from 'expo-sqlite';

import { KAIZEN_TABLES, type KaizenTableName } from '../types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const CREATE_STATEMENTS = `
CREATE TABLE IF NOT EXISTS kaizen_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kaizen_profiles (
  id TEXT PRIMARY KEY NOT NULL,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_actions (
  id TEXT PRIMARY KEY NOT NULL,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_action_logs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  date TEXT NOT NULL,
  completed_at TEXT,
  skipped INTEGER NOT NULL DEFAULT 0,
  skip_reason TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_weekly_rotations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  weekday INTEGER NOT NULL,
  focus_title TEXT NOT NULL,
  system TEXT,
  linked_skill_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_habit_stacks (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_habit_stack_steps (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  stack_id TEXT NOT NULL,
  action_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_deep_work_blocks (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  topic TEXT,
  suggest_focus_mode INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_skill_nodes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,
  level_raw INTEGER NOT NULL DEFAULT 0,
  mastery_0_to_100 REAL,
  activation_state TEXT,
  concept_band TEXT,
  level_descriptions TEXT,
  is_priority INTEGER NOT NULL DEFAULT 0,
  is_assessable INTEGER NOT NULL DEFAULT 0,
  assessment_weight REAL,
  prerequisite_ids TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_skill_progress_logs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  previous_level INTEGER,
  new_level INTEGER,
  previous_mastery REAL,
  new_mastery REAL,
  evidence TEXT,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_user_memory (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  fact TEXT NOT NULL,
  confidence REAL,
  sensitivity TEXT,
  source_kind TEXT,
  source_ref TEXT,
  source_session_id TEXT,
  is_approved INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  expires_at TEXT,
  use_in_ai_context INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_interview_pipeline (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  stage TEXT NOT NULL,
  linked_skill_id TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_interview_questions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  question_bank TEXT NOT NULL,
  kind TEXT,
  purpose TEXT,
  linked_skill_id TEXT,
  linked_concept_id TEXT,
  concept_band TEXT,
  difficulty_0_to_100 REAL,
  topic_tags TEXT,
  import_source TEXT,
  import_batch_id TEXT,
  source_document_name TEXT,
  source_hash TEXT,
  import_review_status TEXT,
  ideal_answer TEXT,
  rubric TEXT,
  judge_model TEXT,
  ideal_answer_version INTEGER,
  baseline_attempt_id TEXT,
  stability REAL,
  difficulty REAL,
  retrievability REAL,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  due_at TEXT,
  desired_retention REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_interview_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  answer_text TEXT,
  answer_source TEXT,
  duration_seconds INTEGER,
  is_baseline INTEGER NOT NULL DEFAULT 0,
  is_diagnostic INTEGER NOT NULL DEFAULT 0,
  self_confidence REAL,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_knowledge_items (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  para_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  tags TEXT,
  linked_skill_id TEXT,
  book_metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_gtd_items (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  system TEXT,
  status TEXT NOT NULL DEFAULT 'inbox',
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_weekly_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  wins TEXT,
  improvements TEXT,
  one_percent_change TEXT,
  system_adjustments TEXT,
  career_snapshot TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_books (
  id TEXT PRIMARY KEY NOT NULL,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_book_chapters (
  id TEXT PRIMARY KEY NOT NULL,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_book_questions (
  id TEXT PRIMARY KEY NOT NULL,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_book_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  book_id TEXT,
  chapter_id TEXT,
  attempted_at TEXT NOT NULL,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_book_mistakes (
  id TEXT PRIMARY KEY NOT NULL,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_book_highlights (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  text TEXT NOT NULL,
  anchor TEXT,
  color TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);
`;

export async function getKaizenDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('symply-life.db');
      await db.execAsync('PRAGMA journal_mode = WAL;');
      await db.execAsync(CREATE_STATEMENTS);
      return db;
    })();
  }
  return dbPromise;
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getKaizenDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM kaizen_meta WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getKaizenDatabase();
  await db.runAsync(
    'INSERT INTO kaizen_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

export function assertKaizenTable(table: string): asserts table is KaizenTableName {
  if (!(KAIZEN_TABLES as readonly string[]).includes(table)) {
    throw new Error(`Unknown Kaizen table: ${table}`);
  }
}
