import { brandIconAssets } from '@brand/icons.generated';
import { BUDGET_CATEGORY_ICON_SLUGS } from '@symply/contracts';


/**
 * Brand-kit glyph for each budget category name — the `brandIcon` column of the
 * shared default-category table in `@symply/contracts`, keyed by lowercased
 * name. Slugs are Symply Budget's own
 * (`brands/symply-budget/src/assets/icons/png/`).
 *
 * Re-exported rather than inlined so the map cannot drift from the seed lists
 * the way it used to: a category and its glyph are now one row.
 *
 * EVERY value must be a slug the kit actually ships — `budgetCategoryIcon.test.ts`
 * reads the PNG folder and fails on anything else.
 *
 * The kit is a finance-app icon set, not a per-category illustration set: it
 * ships one `food`, one `transport`, one `health`. Categories in the same family
 * therefore share a glyph and are told apart by their colour tile. That is
 * deliberate, and better than the alternative it replaced — half the list drew
 * brush-style brand art while the other half fell through to flat Ionicons, so
 * one screen showed two different icon languages.
 *
 * These are the SYMPLY BUDGET slugs. Budget is a feature, not an app: the same
 * screens ship inside House, whose kit is a home-maintenance set. Rendering
 * them needs {@link budgetIconForActiveKit} — see its note.
 */
export const CATEGORY_ICONS: Readonly<Record<string, string>> = BUDGET_CATEGORY_ICON_SLUGS;

/** Fallback for custom / unrecognized categories. */
export const DEFAULT_CATEGORY_ICON = 'other';

/**
 * Ionicons stand-in for every Budget slug a non-Budget kit may not ship.
 *
 * `<Icon>` falls through to Ionicons for a name the ACTIVE kit lacks, and a
 * kit-only slug like `maintenance-fund` is not an Ionicons glyph either — so it
 * draws the missing-glyph "?" box. The Budget screens ship inside House, whose
 * kit is missing 19 of the 31 slugs this map produces (`other` among them, so
 * even the fallback was a "?"), and Kaizen/Health are missing ~21 each.
 *
 * One entry per slug in the Budget category vocabulary — the values here and in
 * `PRESET_CATEGORY_ICONS` — EXCEPT the ones every kit ships or that are already
 * real Ionicons names (`calendar`, `gift`, `home`, `leaf`, `play`, …), which
 * degrade correctly on their own. `budgetCategoryIcon.test.ts` reads the kits
 * and the Ionicons glyph map off disk and fails on a gap in either direction.
 */
export const CATEGORY_ICON_FALLBACKS: Record<string, string> = {
  'ai-coach': 'sparkles',
  bills: 'receipt',
  bonus: 'gift',
  budget: 'pie-chart',
  categories: 'grid',
  credit: 'card',
  currency: 'cash',
  debt: 'trending-down',
  'document-scan': 'scan',
  'dollar-sign': 'logo-usd',
  envelope: 'mail',
  expense: 'arrow-up-circle',
  food: 'restaurant',
  forecast: 'analytics',
  freelance: 'laptop',
  goal: 'flag',
  health: 'fitness',
  housing: 'business',
  'income-category': 'arrow-down-circle',
  insights: 'bulb',
  insurance: 'shield-checkmark',
  'location-pin': 'location',
  'maintenance-fund': 'build',
  marketplace: 'cart',
  'mobile-phone': 'phone-portrait',
  // Matches `categoryIcons.ts`'s DEFAULT_CATEGORY_ICON, so the two catch-alls
  // don't read as two different "uncategorised" glyphs on one screen.
  other: 'ellipsis-horizontal-circle',
  privacy: 'lock-closed',
  recurring: 'repeat',
  'registered-account': 'ribbon',
  savings: 'wallet',
  shopping: 'bag-handle',
  spendings: 'card',
  subscriptions: 'refresh-circle',
  tag: 'pricetag',
  tax: 'document-text',
  transport: 'car',
  trends: 'trending-up',
  utilities: 'flash',
};

/**
 * The name to hand `<Icon>` for a Budget slug, given the brand actually built.
 *
 * Returns the slug untouched when the active kit ships it (House and Budget
 * both draw their own brush art for `home`), the Ionicons stand-in when it does
 * not, and the input unchanged when it is neither — a stored glyph is member
 * data, so anything unrecognised is passed to `<Icon>` rather than swallowed.
 */
export function budgetIconForActiveKit(slug: string): string {
  // `hasOwnProperty`, not `in`: a custom category's stored icon is member-typed
  // data, and `in` answers true for `constructor` / `toString`, which would hand
  // `<Icon>` an Object prototype member as an image source.
  if (Object.prototype.hasOwnProperty.call(brandIconAssets, slug)) return slug;
  return Object.prototype.hasOwnProperty.call(CATEGORY_ICON_FALLBACKS, slug)
    ? CATEGORY_ICON_FALLBACKS[slug]
    : slug;
}

/** The kit-resolved glyph for a category NAME (what screens render). */
export function getBudgetCategoryIcon(name?: string | null): string {
  return budgetIconForActiveKit(getBudgetCategoryIconSlug(name));
}

/**
 * The raw Symply Budget slug for a category name, before the active kit gets a
 * say. Kept separate so the map stays auditable against the Budget kit — the
 * guard test would be meaningless against an already-degraded value.
 */
export function getBudgetCategoryIconSlug(name?: string | null): string {
  if (!name) return DEFAULT_CATEGORY_ICON;
  return CATEGORY_ICONS[name.trim().toLowerCase()] ?? DEFAULT_CATEGORY_ICON;
}

/**
 * The glyph to draw for one category row.
 *
 * The stored glyph wins, for defaults and customs alike: a default now seeds
 * the same brand slug `CATEGORY_ICONS` would resolve, so the two agree — and
 * where they can disagree, storage is the right answer, because a renamed
 * default would otherwise fall off the name map and go generic.
 *
 * `CATEGORY_ICONS` is the fallback, which is what carries a row that has no
 * glyph of its own.
 *
 * Every path goes through {@link budgetIconForActiveKit}: a member picking
 * `savings` off the icon rail stores that slug, and on House — which has no
 * `savings` — the row would otherwise come back as the "?" box.
 */
export function resolveCategoryIcon(
  category?: { name?: string | null; icon?: string | null; is_default?: boolean } | null,
): string {
  const hint = category?.icon?.trim() || null;
  return hint ? budgetIconForActiveKit(hint) : getBudgetCategoryIcon(category?.name);
}
