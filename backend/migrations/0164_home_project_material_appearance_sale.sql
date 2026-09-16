-- Home project materials: what a finish LOOKS like, and what it costs TODAY.
--
-- Two member-facing features need facts that `home_project_selections` has
-- never held, and both are read off the same shop page the link importer
-- already fetches.
--
-- 1. APPEARANCE, for the surface preview.
--
--    `packages/contracts/src/room-surface-model.ts` requires `colorHex` on every
--    material — a finish with no colour renders as a hole in the room, which
--    reads as a bug — and derives every pattern cell from `unit_w_mm` /
--    `unit_h_mm`, the real-world size of ONE REPEAT. Without the repeat size a
--    visualiser stretches the tile photo to the wall, and a 600x600 porcelain
--    and a 75x300 subway become the same picture at different scales: a room the
--    member cannot build. Until now the member eyedropped the colour by hand
--    after importing a link that already stated it.
--
--    The repeat size is REAL, not INTEGER: a 12 in tile is 304.8 mm, and
--    rounding it to 305 accumulates into a visibly wrong joint line across a
--    twenty-course wall.
--
-- 2. THE OFFER, to speed up choosing.
--
--    Materials are shortlisted and compared side by side (`option_group_id`,
--    with one winner). Nothing modelled a sale, so a floor discounted 40% this
--    week looked identical to one at full price, and the member could not see
--    the reason to decide now.
--
-- WHICH COLUMN IS MONEY: `unit_price_cents` — unchanged, still the price the
-- customer pays TODAY, still the only input to a budget line. The three columns
-- below DESCRIBE the offer and are never read by an estimate. A sale price that
-- silently replaced `unit_price_cents` would be right until the sale ended and
-- then wrong in a stored number nobody re-reads, so the split is deliberate:
-- `sale_price_cents` duplicates `unit_price_cents` while a sale is on, and the
-- pair `list_price_cents` / `sale_price_cents` is what renders the strike-through.
--
-- Every column is nullable and has no default. Every row that exists predates
-- this migration, has none of these facts, and must keep reading back byte for
-- byte — a material with no colour is the normal case for anything typed by
-- hand, and the editor prompts for it rather than inventing one.
--
-- Shared fleet schema: `migrations_dir` is shared, so this lands on Budget,
-- Kaizen and Health D1s too — as unread columns on a table they do not use.
-- Apply to staging AND production for every fleet brand BEFORE deploy:fleet.

-- ---- Appearance --------------------------------------------------------

-- '#rrggbb', lowercase. The dominant/product colour, and the fallback the
-- renderer draws before the texture downloads, offline, and at thumbnail size.
-- Stored normalised so `materialSchema.colorHex`'s strict /^#[0-9a-fA-F]{6}$/
-- always passes: a malformed hex fails the whole Room Surface Model parse, and
-- one bad material would read back as an empty room editor.
ALTER TABLE home_project_selections ADD COLUMN color_hex TEXT;

-- '#rrggbb', tile only, and only when the listing actually SHOWS grouted tile.
-- Guessing grout recolours every joint in the preview on no evidence.
ALTER TABLE home_project_selections ADD COLUMN grout_color_hex TEXT;

-- Real-world size of ONE repeat, millimetres. Both NULL for a non-repeating
-- finish (paint) and — importantly — both NULL when the page did not state a
-- size. A guessed repeat makes the preview lie, which is worse than no preview.
ALTER TABLE home_project_selections ADD COLUMN unit_w_mm REAL;
ALTER TABLE home_project_selections ADD COLUMN unit_h_mm REAL;

-- ---- The offer ---------------------------------------------------------

-- The "was"/regular price, in cents of the same currency as `unit_price_cents`.
-- Only ever set when the page showed it struck through beside a lower price.
ALTER TABLE home_project_selections ADD COLUMN list_price_cents INTEGER;

-- The discounted price the customer pays today, in cents. Mirrors
-- `unit_price_cents` while a sale is on; see the note on money above.
ALTER TABLE home_project_selections ADD COLUMN sale_price_cents INTEGER;

-- 0-100, rounded. Derived from the two prices wherever both are known rather
-- than copied off the badge — a "50% OFF" banner that outlives its sale is one
-- of the commonest stale facts on a retail page.
ALTER TABLE home_project_selections ADD COLUMN discount_pct INTEGER;

-- ISO date, ONLY when the vendor states an end date. NULL means "no end date
-- published", never "no sale" — `sale_price_cents` answers that.
ALTER TABLE home_project_selections ADD COLUMN sale_ends_at TEXT;
