-- =============================================================================
-- 0096_kaizen_books.sql — Book Comprehension & Retention feature (Kaizen only)
--
-- Adds six local-first `life_os_book_*` tables that sync through the existing
-- /api/v1/sync pipeline (see src/routes/sync.ts). All intra-feature relations
-- are SOFT refs (no hard FK between book tables) to avoid Phase-1<->Phase-2
-- cyclic sync ordering, exactly like life_os_interview_questions.baseline_attempt_id
-- and life_os_skill_nodes.parent_id. Only user_id carries a hard FK to users(id).
--
-- Columns are sized for ALL feature phases (reader/highlights, MCQ/open/spoken,
-- two-layer grading, pronunciation, recurring mistakes) so no follow-up migration
-- is needed — migrations are immutable once applied remote.
-- =============================================================================

-- 1. life_os_books — one registered book (uploaded PDF or ToC/name only)
CREATE TABLE IF NOT EXISTS life_os_books (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    language TEXT NOT NULL DEFAULT 'en',          -- per-book answer/reading language
    source_type TEXT NOT NULL DEFAULT 'toc_only', -- toc_only/pdf/epub
    file_object_key TEXT,                          -- R2 key of the uploaded source file
    file_name TEXT,
    file_hash TEXT,                                -- content hash (upload dedup)
    page_count INTEGER,
    cover_emoji TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_books_user_id ON life_os_books(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_books_updated_at ON life_os_books(updated_at);

-- 2. life_os_book_chapters — the processing unit; content is extracted on demand
CREATE TABLE IF NOT EXISTS life_os_book_chapters (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,                         -- soft ref -> life_os_books
    chapter_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    start_page INTEGER,                            -- from ToC; used only to slice the chapter
    end_page INTEGER,
    status TEXT NOT NULL DEFAULT 'none',           -- none/processing/ready/failed
    content_object_key TEXT,                       -- R2 key of cached extracted chapter text
    summary TEXT,
    read_at TEXT,                                  -- user marked chapter read
    questions_generated_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_book_chapters_user_id ON life_os_book_chapters(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_book_chapters_updated_at ON life_os_book_chapters(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_book_chapters_book ON life_os_book_chapters(user_id, book_id);

-- 3. life_os_book_questions — generated comprehension questions (+ FSRS state)
CREATE TABLE IF NOT EXISTS life_os_book_questions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,                         -- soft ref -> life_os_books
    chapter_id TEXT NOT NULL,                      -- soft ref -> life_os_book_chapters
    type TEXT NOT NULL DEFAULT 'open',             -- mcq/open/spoken
    prompt TEXT NOT NULL,
    options TEXT,                                  -- JSON array of strings (MCQ)
    answer_index INTEGER,                          -- correct option index (MCQ)
    ideal_answer TEXT,                             -- reference answer (open/spoken)
    rubric TEXT,                                   -- JSON rubric criteria
    language TEXT NOT NULL DEFAULT 'en',
    difficulty_0_to_100 INTEGER,
    source_highlight_id TEXT,                      -- soft ref -> life_os_book_highlights (seeded quiz)
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
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_book_questions_user_id ON life_os_book_questions(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_book_questions_updated_at ON life_os_book_questions(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_book_questions_chapter ON life_os_book_questions(user_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_life_os_book_questions_due ON life_os_book_questions(user_id, due_at);

-- 4. life_os_book_attempts — a graded answer (mcq/open/spoken), two-layer scores
CREATE TABLE IF NOT EXISTS life_os_book_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    question_id TEXT NOT NULL,                     -- soft ref -> life_os_book_questions
    book_id TEXT,
    chapter_id TEXT,
    attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
    answer_source TEXT NOT NULL DEFAULT 'typed',   -- typed/spoken/mcq
    answer_text TEXT,
    selected_index INTEGER,                        -- chosen option (MCQ)
    is_correct INTEGER,                            -- MCQ correctness (0/1)
    audio_object_key TEXT,
    transcription TEXT,
    content_score REAL,                            -- Layer 1: meaning/logic (0..1)
    overall_score REAL,
    mistakes TEXT,                                 -- JSON: Layer 2 grammar/form mistakes[]
    pronunciation TEXT,                            -- JSON: per-word pronunciation (spoken)
    delivery TEXT,                                 -- JSON: fillers/pace/fluency (spoken)
    feedback TEXT,
    fsrs_rating INTEGER,
    scored_offline INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_book_attempts_user_id ON life_os_book_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_book_attempts_updated_at ON life_os_book_attempts(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_book_attempts_question ON life_os_book_attempts(user_id, question_id);

-- 5. life_os_book_mistakes — recurring grammar/pronunciation tickets (SRS-driven)
CREATE TABLE IF NOT EXISTS life_os_book_mistakes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT,                                  -- soft ref -> life_os_books
    type TEXT NOT NULL DEFAULT 'grammar',          -- grammar/pronunciation/vocabulary/fluency
    text TEXT NOT NULL,                            -- the erroneous form
    correction TEXT,
    explanation TEXT,
    severity TEXT,                                 -- low/medium/high/critical
    status TEXT NOT NULL DEFAULT 'detected',       -- detected/practicing/mastered/archived
    dedup_key TEXT,                                -- (type|normalized text) dedup key
    regression_count INTEGER NOT NULL DEFAULT 0,
    srs_state TEXT,                                -- JSON scheduler state
    due_at TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_book_mistakes_user_id ON life_os_book_mistakes(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_book_mistakes_updated_at ON life_os_book_mistakes(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_book_mistakes_dedup ON life_os_book_mistakes(user_id, dedup_key);

-- 6. life_os_book_highlights — saved reader highlights (+ optional note)
CREATE TABLE IF NOT EXISTS life_os_book_highlights (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,                         -- soft ref -> life_os_books
    chapter_id TEXT NOT NULL,                      -- soft ref -> life_os_book_chapters
    text TEXT NOT NULL,                            -- highlighted excerpt
    anchor TEXT,                                   -- JSON: {start,end} char offsets into chapter text
    color TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_life_os_book_highlights_user_id ON life_os_book_highlights(user_id);
CREATE INDEX IF NOT EXISTS idx_life_os_book_highlights_updated_at ON life_os_book_highlights(updated_at);
CREATE INDEX IF NOT EXISTS idx_life_os_book_highlights_chapter ON life_os_book_highlights(user_id, chapter_id);
