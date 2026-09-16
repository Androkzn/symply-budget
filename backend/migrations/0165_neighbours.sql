-- Neighbours — the homes around a property, and the people who live in them.
--
-- Three tables rather than one, because a pin on a map is a BUILDING and the
-- people in it are a list. Modelling a neighbour as a person means the second
-- occupant either overwrites the first or becomes a second pin on the same
-- roof; both are wrong and both are what a single-table version produces on
-- day two. `backend/src/db/schema-neighbours.ts` argues the split in full.
--
-- Deliberate choices worth naming at the SQL level:
--
--  * `neighbours.latitude` / `.longitude` are NOT NULL. This feature is the map;
--    a row that cannot be drawn is not a neighbour, it is a note. The client
--    refuses to create one without a position, so the column enforces what the
--    product already promises.
--  * `neighbours.neighbourhood_id` is ON DELETE SET NULL, not CASCADE. Deleting
--    the area "Maple Court" must leave every home standing — the member removed
--    a grouping, not a street.
--  * `neighbour_people.neighbour_id` IS ON DELETE CASCADE. The people only exist
--    as occupants of that home.
--  * `neighbour_people.household_id` is denormalised from the parent so the
--    device ledger, which has no joins, can scope a read to one property.
--  * `neighbourhoods (household_id, name)` is UNIQUE. Two areas with one name is
--    a mistake every time, and the constraint is what makes the device ledger
--    mint a DETERMINISTIC id for the table (hazard S3b) so two members creating
--    it offline merge instead of duplicating.
--
-- Shared fleet schema: `migrations_dir` is shared, so this lands on Budget,
-- Kaizen and Health D1s too — as three unused tables on a brand that never
-- mounts the router. Apply to staging AND production for every fleet brand
-- BEFORE deploy:fleet.

CREATE TABLE IF NOT EXISTS neighbourhoods (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  photo_key TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS neighbourhoods_by_household ON neighbourhoods(household_id);
CREATE UNIQUE INDEX IF NOT EXISTS neighbourhoods_household_name_unique
  ON neighbourhoods(household_id, name);

CREATE TABLE IF NOT EXISTS neighbours (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  neighbourhood_id TEXT REFERENCES neighbourhoods(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'nearby',
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state_province TEXT,
  postal_code TEXT,
  country TEXT,
  formatted_address TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  place_source TEXT NOT NULL DEFAULT 'manual',
  photo_key TEXT,
  notes TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_emergency_contact INTEGER NOT NULL DEFAULT 0,
  has_spare_key INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS neighbours_by_household ON neighbours(household_id);
CREATE INDEX IF NOT EXISTS neighbours_by_neighbourhood ON neighbours(neighbourhood_id);
CREATE INDEX IF NOT EXISTS neighbours_by_lat_lon ON neighbours(household_id, latitude, longitude);

CREATE TABLE IF NOT EXISTS neighbour_people (
  id TEXT PRIMARY KEY,
  neighbour_id TEXT NOT NULL REFERENCES neighbours(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'adult',
  phone TEXT,
  email TEXT,
  photo_key TEXT,
  notes TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  device_contact_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS neighbour_people_by_neighbour ON neighbour_people(neighbour_id);
CREATE INDEX IF NOT EXISTS neighbour_people_by_household ON neighbour_people(household_id);
