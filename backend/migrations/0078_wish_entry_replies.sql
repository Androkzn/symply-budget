-- Threaded replies for the wish feed: an entry may reply to an earlier entry in
-- the same wish (WhatsApp-style quoted reply). parent_entry_id points at the
-- entry being replied to; NULL for a top-level post. Kept as a soft link (no FK
-- CASCADE — deleting a parent just leaves the reply's quote unresolved, which
-- the API renders as a generic "a message").
ALTER TABLE wish_entries ADD COLUMN parent_entry_id TEXT;

CREATE INDEX IF NOT EXISTS wish_entries_parent_idx ON wish_entries(parent_entry_id);
