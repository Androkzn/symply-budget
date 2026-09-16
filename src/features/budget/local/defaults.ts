import type { BudgetCategory } from '@api/budget';
import { LOCAL_SEED_CATEGORIES, defaultCategoryId } from '@symply/contracts';


/**
 * Seed categories for a new local household.
 *
 * The list lives in `@symply/contracts` (`budget-categories.ts`) — one table
 * shared with the Worker's seed and the brand icon map. Names are the join key:
 * the row id, the glyph lookup and the BYOK receipt/import ladders (which ask
 * the model to pick a category "verbatim" and match it back case-insensitively)
 * all resolve by name.
 *
 * `Income` and `Other` are device-only: the server list has neither, but the
 * receipt draft needs a catch-all and the spend/earn split needs an income
 * bucket.
 *
 * Ids are name-derived, so this list's ORDER is display order and nothing more.
 * `localBudgetApi.backfillDefaultCategories` carries a newly added seed to
 * households already on disk, matching by name.
 */
export function defaultCategories(householdId: string): BudgetCategory[] {
  const now = new Date().toISOString();
  return LOCAL_SEED_CATEGORIES.map((seed, index) => ({
    // NOTE: not household-scoped — two local households on one device seed the
    // same id. Safe in SQLite (the row PK is household_id + tbl + row_key), but
    // an in-memory lookup keyed on id alone will collide across them.
    id: defaultCategoryId(seed.name),
    household_id: householdId,
    name: seed.name,
    icon: seed.brandIcon,
    color: seed.color,
    sort_order: index,
    created_at: now,
    usage_count: 0,
    is_default: true,
    hidden: false,
  }));
}
