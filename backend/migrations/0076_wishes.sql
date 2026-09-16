-- Wishes: long-term dreams / a household wishlist that is deliberately DISTINCT
-- from savings goals and budget items. A wish ("buy a boat", "renovate the
-- kitchen", "family trip to Japan") is aspirational and visual first, financial
-- second — it has NO required target amount or deadline and never participates
-- in monthly affordability math. Money is optional context only
-- (estimated_cost_cents is a ballpark).
--
-- Each wish owns a feed of entries (wish_entries) shown chat/timeline style:
-- notes, photos, and links/listings (e.g. a boat you found, with its price).
-- Members keep dropping things into the feed over months as the dream takes
-- shape. cover_image_key is a denormalized pointer to a chosen/first image
-- entry so the list can render a thumbnail without loading the whole feed.
CREATE TABLE IF NOT EXISTS wishes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  notes TEXT,                        -- short blurb shown under the title

  cover_image_key TEXT,              -- R2 key of the chosen cover (from an image entry)
  estimated_cost_cents INTEGER,      -- optional ballpark; NOT budget math
  target_date TEXT,                  -- optional "hope to have it by" (YYYY-MM-DD)

  -- active = still dreaming/collecting, achieved = got it, archived = let go
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS wishes_household_idx ON wishes(household_id);
CREATE INDEX IF NOT EXISTS wishes_household_status_idx ON wishes(household_id, status);

-- One row per item dropped into a wish's feed. `kind` selects which columns are
-- meaningful: 'note' -> body; 'image' -> image_key (+ optional body caption);
-- 'link' -> url + link_title (+ optional body note). price_cents is an optional
-- tag on any entry (e.g. the asking price of a listing you pasted).
CREATE TABLE IF NOT EXISTS wish_entries (
  id TEXT PRIMARY KEY,
  wish_id TEXT NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,

  kind TEXT NOT NULL,                -- 'note' | 'image' | 'link'
  body TEXT,                         -- note text / caption / link note
  image_key TEXT,                    -- R2 key for kind='image'
  url TEXT,                          -- link URL for kind='link'
  link_title TEXT,                   -- display label for kind='link'
  price_cents INTEGER,               -- optional price tag on the entry

  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS wish_entries_wish_idx ON wish_entries(wish_id, created_at);
CREATE INDEX IF NOT EXISTS wish_entries_household_idx ON wish_entries(household_id);
