-- Shareable household invite links + owner-approved join requests.
--
-- `household_invite_links` is the non-email-bound counterpart to
-- `household_invitations`: one link can be shared via the OS share sheet and
-- accepted by anyone, bounded by `expires_at` and optional `max_uses`, and
-- revocable via `revoked_at`.
--
-- `household_join_requests` holds the "request to join" rows created when
-- someone opens a link. A household owner approves (which inserts the
-- corresponding `household_members` row) or denies each request.

CREATE TABLE IF NOT EXISTS household_invite_links (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_by TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS household_invite_links_household_id_idx
  ON household_invite_links (household_id);
CREATE UNIQUE INDEX IF NOT EXISTS household_invite_links_token_hash_idx
  ON household_invite_links (token_hash);

CREATE TABLE IF NOT EXISTS household_join_requests (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  invite_link_id TEXT REFERENCES household_invite_links(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT
);

CREATE INDEX IF NOT EXISTS household_join_requests_household_status_idx
  ON household_join_requests (household_id, status);
CREATE INDEX IF NOT EXISTS household_join_requests_user_idx
  ON household_join_requests (user_id);
