-- Home project material options: shop several candidates per surface, pick one.
--
-- Today a `home_project_selections` row IS the decision — `createSelection`
-- writes a `materials` budget line the moment a price is present. That is right
-- for "one vanity", and wrong for "five flooring options we are still choosing
-- between", which would put five floors into the estimate at once.
--
-- The group is what fixes it. Options belonging to a group contribute NOTHING to
-- the budget until one of them is the group's `preferred_selection_id`; the
-- winner then owns a single line, re-pointed (never duplicated) on every switch.
-- Ungrouped selections keep the old behaviour byte for byte, so every project
-- that exists today reads back unchanged.
--
-- Why a named group rather than reusing `category`: one renovation routinely
-- prices two floors ("Kitchen floor" 24 m², "Master bath" 6 m²). Category is the
-- coarse budget tag and cannot carry two areas.
--
-- Shared fleet schema: `migrations_dir` is shared, so this lands on Budget,
-- Kaizen and Health D1s too — as an empty table and unread columns. Apply to
-- staging AND production for every fleet brand BEFORE deploy:fleet.

CREATE TABLE IF NOT EXISTS home_project_option_groups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  -- Member-facing name of the surface being decided: "Kitchen floor".
  name TEXT NOT NULL,
  -- Coarse tag inherited by the winner's budget line.
  category TEXT NOT NULL DEFAULT 'finish',
  -- The area the winning option has to cover. NULL is legitimate and common:
  -- a group of five faucets is priced per piece and has no area at all, and the
  -- card must then say "no area set" rather than show a fabricated total.
  area_value REAL,
  -- 'm2' | 'sqft'. Stored as entered so the member sees their own unit back;
  -- all arithmetic normalises to m2 first.
  area_unit TEXT,
  -- 'manual' | 'geometry' — whether the member typed the area or it was
  -- prefilled from `home_project_geometry`. Drives the "from your floor plan"
  -- hint, and stops a prefill from being silently trusted as measured truth.
  area_source TEXT NOT NULL DEFAULT 'manual',
  -- Offcuts and breakage. 10% is the trade default for straight-lay flooring.
  waste_factor_pct INTEGER NOT NULL DEFAULT 10,
  -- The chosen option. Deliberately NOT an `is_preferred` flag on the selection:
  -- a flag can be true on two rows at once, this cannot.
  preferred_selection_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS hpog_by_project ON home_project_option_groups(project_id);

-- Which group an option competes in. NULL = a standalone selection, i.e. every
-- row that exists before this migration.
ALTER TABLE home_project_selections ADD COLUMN option_group_id TEXT;

-- Identity of the product, as distinct from the free-text `name`. Extraction
-- fills these; a member typing a material by hand may leave them empty.
ALTER TABLE home_project_selections ADD COLUMN brand TEXT;
ALTER TABLE home_project_selections ADD COLUMN sku TEXT;

-- The vendor's own product photo, kept as a URL so a card can render before the
-- R2 copy finishes (and still render if the copy failed). The durable copy is a
-- `home_project_attachments` row with `selection_id` set; the card prefers it.
ALTER TABLE home_project_selections ADD COLUMN image_url TEXT;

-- What one purchasable unit covers — 20 sqft per box of tile, 32 m² per pail of
-- adhesive. This is the single field that turns a shelf price into "what this
-- floor costs", and it is the field shop pages most often omit.
ALTER TABLE home_project_selections ADD COLUMN coverage_per_unit REAL;
ALTER TABLE home_project_selections ADD COLUMN coverage_unit TEXT;

-- [{ "label": "PEI rating", "value": "4" }, …] — ordered, already member-facing.
-- JSON rather than a child table: specs are read as a block, never queried, and
-- differ per material class (a tile's PEI has no meaning for a faucet).
ALTER TABLE home_project_selections ADD COLUMN specs_json TEXT;

-- 'manual' | 'link_og' | 'link_ai'. Provenance is shown on the card, because a
-- price a model read off a page is a different kind of claim from one a member
-- typed, and the member is about to spend real money on the difference.
ALTER TABLE home_project_selections ADD COLUMN extraction_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE home_project_selections ADD COLUMN extraction_confidence TEXT;

CREATE INDEX IF NOT EXISTS hpsel_by_group ON home_project_selections(option_group_id);
