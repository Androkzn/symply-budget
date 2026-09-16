import { SERVER_SEED_CATEGORIES, defaultCategoryId } from '@symply/contracts';
import {
  DEFAULT_CATEGORY_ICON,
  budgetIconForActiveKit,
  getBudgetCategoryIcon,
  resolveCategoryIcon,
} from '@utils/budgetCategoryIcon';

import { defaultCategories } from '../defaults';

/**
 * The catch-all AS THE ACTIVE BRAND DRAWS IT. House's kit has no `other`, so it
 * resolves to an Ionicons stand-in — comparing against the raw slug would make
 * every "did this fall through to the generic glyph?" assertion below silently
 * unfalsifiable on every brand but Budget.
 */
const GENERIC_ICON = budgetIconForActiveKit(DEFAULT_CATEGORY_ICON);

describe('local default categories', () => {
  const cats = defaultCategories('hh_local_test');

  it('seeds a list broad enough to categorise a real month', () => {
    // The previous seed was 10 buckets, so most spending landed in "Other".
    expect(cats.length).toBeGreaterThanOrEqual(30);
  });

  it('has no duplicate names and none blank', () => {
    const names = cats.map((c) => c.name.trim().toLowerCase());
    expect(names.filter(Boolean)).toHaveLength(cats.length);
    expect(new Set(names).size).toBe(cats.length);
  });

  it('scopes every row to the household it was seeded for', () => {
    expect(cats.every((c) => c.household_id === 'hh_local_test')).toBe(true);
  });

  it('marks every seed as default and visible', () => {
    expect(cats.every((c) => c.is_default && !c.hidden)).toBe(true);
  });

  /**
   * Names are the join key: `CATEGORY_ICONS` maps name → glyph, and the BYOK
   * import ladders ask the model to pick a category name verbatim then match it
   * back. A local-only name silently renders "other" and never matches.
   */
  it('covers every everyday-spending default the server seeds', () => {
    // The gap that shipped `Fees` server-only for two releases: the old version
    // of this test scraped one hand-written block, so anything added in a later
    // cohort was invisible to it. Now it reads the shared table, all cohorts.
    const local = new Set(cats.map((c) => c.name));
    const missing = SERVER_SEED_CATEGORIES.filter(
      (c) => c.scope === 'general' && !local.has(c.name),
    );
    expect(missing.map((c) => c.name)).toEqual([]);
  });

  /**
   * Ids were positional (`cat_default_<index + 1>`), which made this list's
   * order load-bearing: inserting a seed renumbered every one after it, so two
   * devices on different builds authored one category under two ids. Derived
   * from the name, order is display order and nothing more.
   */
  it('derives every mint id from the name, not the position', () => {
    expect(cats.map((c) => c.id)).toEqual(cats.map((c) => defaultCategoryId(c.name)));
    expect(new Set(cats.map((c) => c.id)).size).toBe(cats.length);
  });

  it('seeds Fees, which the server had and the local list did not', () => {
    expect(cats.map((c) => c.name)).toContain('Fees');
  });

  /**
   * `CATEGORY_ICONS` used to route ~a third of these names to the generic
   * "other", and the resolver papered over it by falling through to the seed's
   * Ionicons hint — which put flat Ionicons and brush-style brand art in the
   * same list. Every seed now has to earn a real kit glyph by name.
   */
  it('renders a distinct glyph for every seeded category', () => {
    const generic = cats.filter(
      (c) => resolveCategoryIcon(c) === GENERIC_ICON && c.name !== 'Other',
    );
    expect(generic.map((c) => c.name)).toEqual([]);
  });

  it('keeps a catch-all and an income bucket the server list lacks', () => {
    const names = cats.map((c) => c.name);
    expect(names).toContain('Other');
    expect(names).toContain('Income');
  });

  /**
   * Parking is its own line, not "Transportation" or "Car Maintenance": it is a
   * recurring, plannable cost with its own monthly shape (a permit, a daily
   * garage), and folding it into either of those hides it from spending
   * planning — which is the whole reason it was asked for.
   */
  it('carries Parking, grouped with the other getting-around costs', () => {
    const names = cats.map((c) => c.name);
    expect(names).toContain('Parking');
    const parking = cats.findIndex((c) => c.name === 'Parking');
    expect(cats[parking - 1]!.name).toBe('Car Maintenance');
    expect(resolveCategoryIcon(cats[parking]!)).not.toBe(GENERIC_ICON);
  });

  it('gives every seed a colour and an icon hint', () => {
    expect(cats.every((c) => !!c.color && !!c.icon)).toBe(true);
  });
});

describe('resolveCategoryIcon', () => {
  it("uses a custom category's own glyph", () => {
    expect(resolveCategoryIcon({ name: 'Boat fuel', icon: 'boat', is_default: false })).toBe('boat');
  });

  it('falls back to the name mapping when a custom category has no glyph', () => {
    expect(resolveCategoryIcon({ name: 'Groceries', icon: null, is_default: false })).toBe(
      getBudgetCategoryIcon('Groceries'),
    );
  });

  /**
   * Defaults carry an Ionicons hint for parity with the server seed. Preferring
   * it would swap every default away from the brand kit, so the name mapping
   * has to win for them.
   */
  it('keeps defaults on the brand mapping when the kit ships a real glyph', () => {
    const groceries = defaultCategories('hh')[0];
    expect(groceries.name).toBe('Groceries');
    expect(getBudgetCategoryIcon('Groceries')).not.toBe(GENERIC_ICON);
    expect(resolveCategoryIcon(groceries)).toBe(getBudgetCategoryIcon('Groceries'));
  });

  it('stores the brand slug it draws, so the editor pre-selects it', () => {
    // Defaults used to store an Ionicons name ('game-controller') that the kit
    // does not ship and the icon picker does not offer, so opening a default in
    // the editor pre-selected nothing. The stored glyph is now the brand slug.
    const gaming = defaultCategories('hh').find((c) => c.name === 'Gaming')!;
    expect(gaming.icon).toBe('play');
    expect(resolveCategoryIcon(gaming)).toBe('play');
  });

  it('degrades to the generic glyph for an unknown, icon-less category', () => {
    expect(resolveCategoryIcon({ name: 'Nonsense', icon: null })).toBe(GENERIC_ICON);
    expect(resolveCategoryIcon(null)).toBe(GENERIC_ICON);
  });
});
