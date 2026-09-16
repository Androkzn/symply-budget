-- Migration: 0095_life_os_feature_flags
-- Description: Feature-flag rows the ported Life OS (Kaizen) code reads at runtime.
--
-- PORT NOTE: the donor Life OS backend gated its AI surfaces on a D1 `feature_flags`
-- table (donor migrations 087/089/092). This shared ecosystem backend does NOT use a
-- D1 feature_flags table — its own feature flags live in CONFIG_KV
-- (src/services/featureFlagService.ts). The ported Life OS code paths, however, still
-- read this D1 table directly:
--   * routes/lifeOSCoachChat.ts  → isFlagEnabled(env, 'lifeOSAIScoring')  (fail-CLOSED)
--   * services/lifeOS/ai/costGuards.ts → optionalGlobalCeilingTripped()   (fail-open)
-- so we provision the minimal tables + the two Life OS rows here. This is purely
-- ADDITIVE and safe on every brand's D1: no non-Kaizen code path ever reads these
-- tables, and unused tables are harmless.
--
-- Faithful to the donor's shipped posture:
--   * lifeOS          → enabled (shell on; donor 092 default-on)
--   * lifeOSAIScoring → DISABLED (AI judge / coach LLM kill switch stays OFF until an
--                       operator flips it remotely after QA — donor 089 fail-closed)
--
-- To turn the Kaizen Master AI on later (Kaizen Worker's D1):
--   UPDATE feature_flags SET enabled = 1 WHERE key = 'lifeOSAIScoring';
--
-- Idempotent: CREATE TABLE/INSERT OR IGNORE, and the one-time default-on flip is
-- guarded by feature_flag_default_flips so a re-apply never clobbers an operator override.

CREATE TABLE IF NOT EXISTS feature_flags (
    key         TEXT PRIMARY KEY,
    enabled     INTEGER NOT NULL DEFAULT 1,   -- 0/1
    description TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One-time-flip bookkeeping so a default-on UPDATE runs at most once per key.
CREATE TABLE IF NOT EXISTS feature_flag_default_flips (
    key        TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed the two Life OS flags fail-closed (donor 089). INSERT OR IGNORE keeps any
-- operator override intact.
INSERT OR IGNORE INTO feature_flags (key, enabled, description, updated_at) VALUES
  ('lifeOS',          0, 'Life OS personal operating system (shell)',        datetime('now')),
  ('lifeOSAIScoring', 0, 'Life OS AI judge / coach LLM calls (kill switch)', datetime('now'));

-- Ship the Life OS shell enabled by default (donor 092), once, guarded by the flip
-- marker so a later operator disable survives re-apply. lifeOSAIScoring stays OFF.
UPDATE feature_flags
SET enabled = 1, updated_at = datetime('now')
WHERE key = 'lifeOS'
  AND key NOT IN (SELECT key FROM feature_flag_default_flips);

INSERT OR IGNORE INTO feature_flag_default_flips (key, applied_at)
SELECT 'lifeOS', datetime('now')
FROM feature_flags
WHERE key = 'lifeOS'
  AND key NOT IN (SELECT key FROM feature_flag_default_flips);
