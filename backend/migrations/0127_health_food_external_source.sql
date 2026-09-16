-- Symply Health — remember WHERE an imported food came from, so importing the
-- same external food twice is one row and not two.
--
-- Parity phase P3 lands the donor's FatSecret integration: `/health/foods/search`
-- now tops its answer up from an external food database, and
-- `POST /health/foods/import` turns a result the user actually wants into a real
-- `custom_foods` row they own. That row is what makes the app keep working
-- offline afterwards and what keeps `base_*_per_100` re-portioning applicable —
-- an external hit is a lookup, a custom food is a possession.
--
-- Without these two columns, "log this again next week" re-imports and the
-- library slowly fills with five copies of the same chicken breast, each with
-- its own `use_count`, so suggestions and most-used never converge.
--
-- ============================ DONOR MAPPING ================================
--
-- Donor = `~/Desktop/Symply Ecosystem/Simply Health/backend/`, read-only.
--
--   * The donor HAS the concept and does NOT have the columns. Its
--     `foodSearch.ts` mints a synthetic result id (`fatsecret_${food.food_id}`)
--     that exists only for the duration of the HTTP response, and its client's
--     `SmartSearchResult.toCustomFood(ownerId:)` (SmartSearchResult.swift:126)
--     drops it entirely: `UUID(uuidString: id) ?? UUID()` — and `fatsecret_123`
--     is never a valid UUID, so EVERY save minted a fresh id. Saving the same
--     FatSecret food twice therefore produced two identical rows in the donor,
--     with nothing to detect it by. That is the defect these columns close, so
--     they are a deliberate ADDITION rather than a port.
--
--   * `source_type` is NOT extended. It already carries the donor's own
--     `'imported'` member (0120, donor `customFoods.ts`), which is exactly what
--     an external import is; `external_source` answers the different question of
--     WHICH database, and the two are not the same field. A food imported from a
--     second provider later is a new `external_source` value and no schema change.
--
--   * The provider's food id is stored VERBATIM as text. FatSecret ids are
--     numeric today, but a second provider's are not, and parsing an opaque
--     third-party identifier into a number is how a working id becomes a
--     silently truncated one.
--
-- ============================ DEVIATIONS ===================================
--
--   * NO CHECK CONSTRAINT on `external_source`. Same reason as 0122 and 0124:
--     SQLite cannot add a CHECK to an existing table without a full rebuild, and
--     rebuilding `custom_foods` on a live D1 is not worth it for a value the
--     route's zod enum already rejects with a 400 at the boundary — where a CHECK
--     would only turn the same bad value into a 500.
--
--   * NO FOREIGN KEY, deliberately, and there is nothing it could point at:
--     the external food lives in another company's database. The pair is
--     provenance, not a referential guarantee.
--
--   * BOTH COLUMNS NULLABLE with no default. Every existing row was typed by
--     hand, scanned, or converted from a recipe, and back-filling
--     `external_source = 'manual'` would claim a provenance those rows do not
--     have. NULL is the honest "not imported from anywhere".
--
--   * The UNIQUE index is PARTIAL on `deleted_at IS NULL`. Deletes in this
--     domain are soft (0119–0124 convention), so a full unique index would make
--     "delete an imported food, then import it again" fail forever against a
--     tombstone the user cannot see. Scoping it to live rows means a re-import
--     after a delete is a clean new row, which is what the user asked for.
--     `HealthFoodService.importExternalFood` also looks the row up before
--     inserting and catches the constraint on the losing side of a race, so this
--     index is the backstop rather than the mechanism.
--
--   * Conventions carried from 0119–0124: soft deletes and `updated_at` already
--     exist on `custom_foods` and are untouched, so the delta-sync cursor keeps
--     working — both columns ride the EXISTING `updated_at` and need no sync
--     change beyond being in `schema-health-p2.ts`.
--
-- ORDER OF OPERATIONS: `src/db/schema-health-p2.ts` selects these columns by
-- name, so this migration must be applied to BOTH Health D1s (staging and
-- production) BEFORE the Worker carrying it is deployed.

-- Which external database this food was imported from ('fatsecret'). NULL for
-- every food the user typed, scanned or converted from a recipe.
ALTER TABLE custom_foods ADD COLUMN external_source TEXT;

-- That database's own identifier for the food, verbatim. NULL unless
-- `external_source` is set; the pair is meaningful only together.
ALTER TABLE custom_foods ADD COLUMN external_id TEXT;

-- One live copy of a given external food per user. Partial on both the
-- provenance pair and the tombstone — see the deviations note.
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_foods_external
  ON custom_foods(user_id, external_source, external_id)
  WHERE external_source IS NOT NULL
    AND external_id IS NOT NULL
    AND deleted_at IS NULL;
