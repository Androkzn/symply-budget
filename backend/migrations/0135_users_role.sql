-- Platform role on users.
--
-- 'user' (default) is everyone. 'admin' unlocks staff-only switchboards; the
-- first consumer is Symply Health's per-feature toggle screen, where a common
-- user gets only the four core trackers (calories, weight, workouts, water)
-- and an admin can turn the optional ones on.
--
-- This is NOT the household role: household_members.role stays 'owner'/'member'
-- and carries no platform privilege.
--
-- Backfills to 'user' for every existing row, so the gate is closed by default
-- and an admin must be promoted explicitly.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
