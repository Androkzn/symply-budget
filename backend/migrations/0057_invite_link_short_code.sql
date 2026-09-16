-- Short shareable code for household invite links (`/j/<short_code>`).
-- An alternate identifier for the same link, resolved interchangeably with the
-- raw token. Nullable (existing rows have none); a UNIQUE index enforces
-- uniqueness while allowing multiple NULLs in SQLite.

ALTER TABLE household_invite_links ADD COLUMN short_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS household_invite_links_short_code_idx
  ON household_invite_links (short_code);
