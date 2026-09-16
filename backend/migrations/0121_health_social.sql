-- Symply Health — parity phase P4: the SOCIAL domain.
--
-- Family sharing, accountability buddies, community rooms, joinable challenges —
-- plus `health_metric_shares`, the SCOPED GRANT that is the only thing in this
-- schema which can ever make one user's health data readable by another.
--
-- Ported from the donor Worker (`~/Desktop/Symply Ecosystem/Simply Health/backend/migrations/`):
--   029_health_buddy.sql        user_connections              → health_buddies
--   036_food_challenges.sql     food_challenges / progress    → health_challenges / *
--   055_family_feature.sql      families / members / invites  → health_families / *
--   072_community_chats.sql     community_topics / messages   → health_community_*
--
-- ============================ SHIPS DISABLED =============================
-- `routes/health-social.ts` 404s this ENTIRE surface unless CONFIG_KV
-- `health_social_enabled` holds the literal string 'true'. Absent, '', 'false',
-- 'FALSE', '1' — every one of those means OFF. That is the INVERSE of the
-- repo's usual `savings_enabled`-style flag (absent = enabled, only 'false'
-- disables), because health data is deny-by-default:
-- documents/apps/symply-health/migration.md — "Health inbound and outbound
-- sharing is denied by default", family/community/social "denied until
-- approved". These tables therefore exist but stay empty until a privacy review
-- flips the flag.
-- ========================================================================
--
-- Conventions carried from 0119/0120: TEXT ids, ISO TEXT timestamps, soft
-- deletes everywhere, an `updated_at` sync index per table so the delta cursor
-- can carry tombstones, and FKs to the PLATFORM `users` table.
--
-- Soft delete + "one of these per user" is expressed as a PARTIAL UNIQUE INDEX
-- (`WHERE deleted_at IS NULL`) rather than an inline UNIQUE: leaving a family
-- and rejoining it, or re-sending a withdrawn invite, must not collide with the
-- tombstone of the previous row.
--
-- Deviations from the donor, and why:
--   * Every table is `health_`-prefixed. This Worker binary is shared with
--     House/Budget/Kaizen and a bare `families` table would read as
--     platform-wide identity rather than one brand's social graph.
--   * Donor `family_dashboard_preferences` is NOT ported. It was a per-member
--     row that defaulted share_calories / share_macros / share_water /
--     share_workout_activity to 1 — i.e. joining a family started sharing four
--     metric groups automatically. That is precisely what this phase must not
--     do. `health_metric_shares` replaces it: nothing is readable until an
--     explicit, per-viewer, per-metric-group, revocable grant row exists.
--   * Donor `journey_updates` / `journey_reactions` / `journey_comments` (the
--     buddy feed) and `family_photos` are NOT ported: a feed post and a family
--     photo are unscoped health payloads that no per-metric grant can describe.
--   * Donor `community_messages.message_type` allowed 'recipe_share',
--     'workout_share' and 'achievement' with a `data_json` attachment. Community
--     rooms here carry TEXT ONLY — a public room must never become a side
--     channel around the grant table.
--   * Donor buddy requests carried a `recipient_id` and answered 404 when no
--     such user existed, which confirms account existence. Here a request is
--     addressed to an EMAIL exactly like a family invite, and the response never
--     varies with whether that email is registered.
--   * Donor challenges were PRIVATE single-user food challenges. Here a
--     challenge is a joinable object with its own participant and progress
--     tables, and its `metric` is constrained to a grantable scope so a
--     challenge can never be built on cycle or vitality data.

-- ============ Families ============
-- A user owns at most one family and belongs to at most one family (donor rule).
CREATE TABLE IF NOT EXISTS health_families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 80),
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_families_owner_active
  ON health_families(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_health_families_sync ON health_families(owner_id, updated_at);

CREATE TABLE IF NOT EXISTS health_family_members (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (family_id) REFERENCES health_families(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
-- One ACTIVE membership per user, across all families (donor rule 055).
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_family_members_user_active
  ON health_family_members(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_health_family_members_family
  ON health_family_members(family_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_health_family_members_sync
  ON health_family_members(user_id, updated_at);

-- `invitee_id` is resolved server-side when the email happens to belong to an
-- account, but it is NEVER echoed back to the inviter — that would answer "is
-- this address registered?", which the invite endpoint must not do.
CREATE TABLE IF NOT EXISTS health_family_invitations (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  inviter_id TEXT NOT NULL,
  invitee_id TEXT,
  invitee_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  message TEXT CHECK (message IS NULL OR length(message) <= 500),
  invite_code TEXT NOT NULL,
  responded_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (family_id) REFERENCES health_families(id) ON DELETE CASCADE,
  FOREIGN KEY (inviter_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invitee_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_family_invites_code
  ON health_family_invitations(invite_code);
CREATE INDEX IF NOT EXISTS idx_health_family_invites_email
  ON health_family_invitations(invitee_email, status);
CREATE INDEX IF NOT EXISTS idx_health_family_invites_family
  ON health_family_invitations(family_id, status);
CREATE INDEX IF NOT EXISTS idx_health_family_invites_sync
  ON health_family_invitations(inviter_id, updated_at);

-- ============ Buddies ============
-- Addressed by EMAIL, not by user id, so one code path (and one non-leaking
-- response) covers both "already a Symply Health user" and "not yet".
CREATE TABLE IF NOT EXISTS health_buddies (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  message TEXT CHECK (message IS NULL OR length(message) <= 500),
  responded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_buddies_pair_active
  ON health_buddies(requester_id, recipient_email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_health_buddies_recipient
  ON health_buddies(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_health_buddies_email
  ON health_buddies(recipient_email, status);
CREATE INDEX IF NOT EXISTS idx_health_buddies_sync
  ON health_buddies(requester_id, updated_at);

-- ============ Community rooms ============
CREATE TABLE IF NOT EXISTS health_community_topics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 120),
  description TEXT CHECK (description IS NULL OR length(description) <= 500),
  category TEXT NOT NULL CHECK (category IN
    ('nutrition', 'fitness', 'recipes', 'motivation', 'tips', 'general', 'challenges')),
  icon TEXT,
  color TEXT,
  creator_id TEXT NOT NULL,
  is_locked INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  participant_count INTEGER NOT NULL DEFAULT 1,
  last_message_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_health_community_topics_category
  ON health_community_topics(category, last_message_at);
CREATE INDEX IF NOT EXISTS idx_health_community_topics_sync
  ON health_community_topics(creator_id, updated_at);

CREATE TABLE IF NOT EXISTS health_community_participants (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('creator', 'moderator', 'member')),
  last_read_at TEXT,
  joined_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (topic_id) REFERENCES health_community_topics(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_community_participants_active
  ON health_community_participants(topic_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_health_community_participants_user
  ON health_community_participants(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_health_community_participants_sync
  ON health_community_participants(user_id, updated_at);

-- TEXT ONLY. The donor's `message_type` enum + `data_json` attachment allowed a
-- recipe / workout / achievement payload to ride a PUBLIC room, which would
-- route health data around `health_metric_shares` entirely. Not ported.
CREATE TABLE IF NOT EXISTS health_community_messages (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 2000),
  reply_to_id TEXT,
  is_edited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (topic_id) REFERENCES health_community_topics(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reply_to_id) REFERENCES health_community_messages(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_health_community_messages_topic
  ON health_community_messages(topic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_health_community_messages_sync
  ON health_community_messages(user_id, updated_at);

-- ============ Challenges ============
-- `metric` is one of the GRANTABLE scopes (activity | nutrition | weight |
-- water | habits | sleep). The CHECK is the schema-level half of the rule that
-- cycle / vitality / body data can never underpin a shared objective; the
-- service half lives in SHAREABLE_SCOPES.
CREATE TABLE IF NOT EXISTS health_challenges (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 120),
  description TEXT CHECK (description IS NULL OR length(description) <= 1000),
  metric TEXT NOT NULL CHECK (metric IN
    ('activity', 'nutrition', 'weight', 'water', 'habits', 'sleep')),
  target_value REAL NOT NULL CHECK (target_value > 0),
  unit TEXT NOT NULL DEFAULT 'unit' CHECK (length(unit) <= 20),
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly')),
  visibility TEXT NOT NULL DEFAULT 'family'
    CHECK (visibility IN ('public', 'family', 'buddies')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  participant_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_health_challenges_active
  ON health_challenges(is_active, start_date);
CREATE INDEX IF NOT EXISTS idx_health_challenges_sync
  ON health_challenges(creator_id, updated_at);

CREATE TABLE IF NOT EXISTS health_challenge_participants (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (challenge_id) REFERENCES health_challenges(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_challenge_participants_active
  ON health_challenge_participants(challenge_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_health_challenge_participants_user
  ON health_challenge_participants(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_health_challenge_participants_sync
  ON health_challenge_participants(user_id, updated_at);

-- Progress rows are PRIVATE by default like every other health row: a
-- participant's number is only visible to a peer who holds an active
-- `health_metric_shares` grant for the challenge's `metric`.
CREATE TABLE IF NOT EXISTS health_challenge_progress (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0 CHECK (value >= 0),
  target_value REAL NOT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (challenge_id) REFERENCES health_challenges(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_challenge_progress_active
  ON health_challenge_progress(challenge_id, user_id, date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_health_challenge_progress_user
  ON health_challenge_progress(user_id, date);
CREATE INDEX IF NOT EXISTS idx_health_challenge_progress_sync
  ON health_challenge_progress(user_id, updated_at);

-- ============ The scoped share grant ============
-- THE WHOLE POINT OF P4. One row = "owner_id lets viewer_id read ONE metric
-- group, because of ONE named relationship, until it is revoked".
--
--   * EXPLICIT   — no row, no read. Joining a family or accepting a buddy grants
--                  nothing; `deny-by-default` is the absence of rows here.
--   * SCOPED     — `scope` is a single metric group, never "everything". The
--                  CHECK below is a hard allowlist: cycle, vitality, body
--                  photos and body measurements are NOT REPRESENTABLE, so no
--                  bug in the service layer can ever persist one.
--   * REVOCABLE  — `revoked_at` is stamped in place, which makes the read fail
--                  on the very next request while leaving the audit trail.
--
-- `relationship_type` is part of the identity of a grant, so leaving a family
-- revokes exactly the family grants and removing a buddy revokes exactly the
-- buddy grants, even between two people who are both.
CREATE TABLE IF NOT EXISTS health_metric_shares (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  viewer_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('family', 'buddy')),
  relationship_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN
    ('activity', 'nutrition', 'weight', 'water', 'habits', 'sleep')),
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (owner_id <> viewer_id),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
);
-- One row per (owner, viewer, relationship, scope): re-granting a revoked scope
-- clears `revoked_at` on the SAME row rather than accumulating duplicates, so
-- "is this readable?" is always a single-row question.
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_metric_shares_grant
  ON health_metric_shares(owner_id, viewer_id, relationship_type, scope);
CREATE INDEX IF NOT EXISTS idx_health_metric_shares_viewer
  ON health_metric_shares(viewer_id, owner_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_health_metric_shares_relationship
  ON health_metric_shares(relationship_type, relationship_id);
CREATE INDEX IF NOT EXISTS idx_health_metric_shares_sync
  ON health_metric_shares(owner_id, updated_at);
