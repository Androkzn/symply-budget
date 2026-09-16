-- Symply Health — parity phase P3, the AI surfaces.
--
-- Two tables, both PORTED (name-for-name, column-for-column where the platform
-- allows) from the donor Worker's Health Coach V2:
--
--   donor `migrations/096_health_coach_facts.sql`
--     → health_coach_consent_receipts
--   donor `migrations/095_health_coach_feature_flags_and_operations.sql`
--     → health_coach_operations
--
-- Donor = `~/Desktop/Symply Ecosystem/Simply Health/backend/`, read-only.
--
-- ======================== WHY ONLY TWO TABLES ==============================
--
-- The donor's coach has FOUR AI-only tables. Two are deliberately not ported:
--
--   * `health_coach_facts` (bitemporal coach memory: fact_type, value_json,
--     effective_start/end, asserted_at, supersedes, user_approved). A durable,
--     server-side memory of inferred claims ABOUT A PERSON'S HEALTH is a
--     retention/deletion/consent design of its own, and BRD §7 + PARITY_PLAN §6
--     put sensitive Health data behind exactly that kind of review. The coach
--     ported here is stateless between turns: it reads the user's OWN logged
--     rows at turn time and remembers nothing it was not told.
--
--   * NO conversation/message table at all. The donor does not persist coach
--     transcripts either — `CoachTurnRequest.history` arrives FROM the client
--     each turn — and this port keeps that. The transcript lives in the RN
--     offline cache under `health.coach.v1`, which `HEALTH_CACHE_KEYS` already
--     clears on sign-out (the cross-user-leak guard). Storing a health
--     conversation server-side would be new PII at rest for zero parity gain.
--
-- The donor's `ai_analysis_logs` is also not ported: it is READ by the donor's
-- admin dashboard in 11 places and WRITTEN by nothing (`INSERT INTO
-- ai_analysis_logs` has zero hits in the donor tree), so porting it would add a
-- permanently empty table. The platform already records real token usage per
-- call through `ai_usage_events` / `ai-usage-service.ts`, which is what the
-- provider chokepoint emits, so Health inherits usage telemetry for free.
--
-- ========================== DEVIATIONS =====================================
--
--   * `updated_at` + `deleted_at` on BOTH tables. The donor has neither
--     (consent receipts carry a bare `timestamp`, operations carry
--     created_at/updated_at but no tombstone). Every Symply Health table since
--     0119 is soft-deleted and carries `updated_at` because the delta-sync
--     cursor in `HealthService.sync()` pulls by `updated_at` — a hard delete
--     would resurrect the row on the next pull from another device. Revoking a
--     consent MUST propagate, so it is a soft delete like everything else.
--
--   * `health_coach_consent_receipts.granted_at` replaces the donor's
--     `timestamp`. `timestamp` is ambiguous (granted? recorded? revoked?) and
--     the revoke path needs a second stamp anyway, so the two are named for
--     what they are. `version` keeps the donor's name and its 'ga-1.0'-style
--     values: a consent is only valid for the disclosure text it was shown
--     against, so bumping the text bumps the version and re-asks.
--
--   * `revoked_at` is NEW. The donor can only ever set `granted = 0`, which
--     loses WHEN the user withdrew — the one fact a consent audit needs.
--
--   * The donor AUTO-GRANTS all five scopes on the first turn
--     ("GA mode: auto-create consent receipts for all wellness scopes if
--     missing… Remove and surface a real consent gate when the product requires
--     explicit opt-in"). That is not ported. This surface is deny-by-default:
--     no row, or `granted = 0`, means the turn is refused before any model call.
--     BRD §7 and TRD T6 both require real consent for the coach.
--
--   * SCOPE VOCABULARY is the donor's five values, kept verbatim so a future
--     write-scoped proposal can use them, but only `insights` is ENFORCED
--     today — see the CHECK below and the note on it.
--
--   * `health_coach_operations` keeps the donor's composite PRIMARY KEY
--     `(user_id, operation_id)`. That is what makes a replay idempotent PER
--     USER and makes another user's operation id unguessable-and-useless rather
--     than a cross-account write.
--
--   * NO FOREIGN KEY from `health_coach_operations.target_id` to the domain
--     row. The ledger is an audit of what the user CONFIRMED, and the domain
--     row it created is soft-deleted independently; an ON DELETE rule would
--     either erase the audit or never fire. Same reasoning as
--     `nutrition_entries.food_id` in 0124.
--
--   * Conventions carried from 0119–0124: `IF NOT EXISTS` everywhere, `users`
--     is the PLATFORM users table, every row is scoped to a USER (health data
--     has no household read path by design, BRD §7), and indexes are
--     table-prefixed.

-- ===================== Consent receipts (deny-by-default) ==================

CREATE TABLE IF NOT EXISTS health_coach_consent_receipts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- Donor vocabulary, verbatim. Only `insights` is checked by the turn route
  -- today: this port does not let the model WRITE anything, so the four
  -- *_logging scopes have nothing to gate yet. They are in the CHECK so a
  -- future write path cannot invent a sixth spelling, and so a row written by
  -- the donor's own client would still be storable.
  scope TEXT NOT NULL CHECK (scope IN (
    'insights', 'food_logging', 'weight_logging', 'water_logging', 'workout_logging'
  )),
  granted INTEGER NOT NULL DEFAULT 0,
  -- The disclosure VERSION this consent was given against. Bumping the text
  -- bumps this, which re-asks rather than silently reusing an old agreement.
  version TEXT NOT NULL,
  granted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- One LIVE receipt per (user, scope). Partial so a revoked-then-regranted
-- history is still expressible as separate rows if the product ever wants it,
-- while the current grant stays unique and cheap to read.
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_coach_consent_user_scope
  ON health_coach_consent_receipts(user_id, scope)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_health_coach_consent_sync
  ON health_coach_consent_receipts(user_id, updated_at);

-- ============ Proposal → commit ledger (the model never writes) =============
--
-- The coach may only PROPOSE a log. The proposal carries a `payload_hash`, and
-- the commit route refuses unless the client echoes that exact hash back — so
-- a proposal the user reviewed cannot be committed with different numbers, and
-- a double tap replays idempotently instead of logging twice.

CREATE TABLE IF NOT EXISTS health_coach_operations (
  operation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  -- 'water' | 'weight' | 'nutrition' — the domain the confirmed row landed in.
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  commit_status TEXT NOT NULL,
  expected_target_version INTEGER,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (user_id, operation_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_health_coach_ops_target
  ON health_coach_operations(user_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_health_coach_ops_sync
  ON health_coach_operations(user_id, updated_at);
