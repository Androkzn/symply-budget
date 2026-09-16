/**
 * Unit coverage for the budget category → brand kit slug map.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { PRESET_CATEGORY_ICONS } from '../../screens/budget/budgetCategoryPresets';
import { brandKitSlugs } from '../../test-utils/brandIconKit';
import {
  CATEGORY_ICONS,
  CATEGORY_ICON_FALLBACKS,
  DEFAULT_CATEGORY_ICON,
  budgetIconForActiveKit,
  getBudgetCategoryIcon,
  getBudgetCategoryIconSlug,
} from '../budgetCategoryIcon';

/**
 * Slugs the Symply Budget brand kit actually ships, read off disk. Every mapped
 * icon MUST resolve to one of these — otherwise <Icon> falls through to a broken
 * Ionicons glyph (this is what regressed `electricity`/`water`/`gas`).
 */
const BUDGET_KIT_SLUGS = brandKitSlugs();

/** Every brand whose build includes the Budget screens. */
const BUDGET_HOST_BRANDS = ['symply-house', 'symply-budget', 'symply-kaizen', 'symply-health'];

/**
 * The real Ionicons glyph names, read off disk for the same reason the kit
 * slugs are: a hand-listed set goes stale, and a fallback that is not a real
 * glyph draws the very "?" box it exists to prevent.
 */
const IONICONS: Set<string> = new Set(
  Object.keys(
    JSON.parse(
      readFileSync(
        join(
          __dirname,
          '../../../node_modules/@expo/vector-icons/build/vendor',
          'react-native-vector-icons/glyphmaps/Ionicons.json',
        ),
        'utf8',
      ),
    ),
  ),
);

/** The whole Budget icon vocabulary: category glyphs + the custom-category rail. */
const BUDGET_SLUG_VOCABULARY = [
  ...new Set([...Object.values(CATEGORY_ICONS), ...PRESET_CATEGORY_ICONS, DEFAULT_CATEGORY_ICON]),
];

describe('getBudgetCategoryIconSlug', () => {
  it('returns the default tag glyph when the name is missing', () => {
    expect(getBudgetCategoryIconSlug()).toBe(DEFAULT_CATEGORY_ICON);
    expect(getBudgetCategoryIconSlug(null)).toBe(DEFAULT_CATEGORY_ICON);
    expect(getBudgetCategoryIconSlug('')).toBe(DEFAULT_CATEGORY_ICON);
  });

  it('maps known default category names (case- and whitespace-insensitive)', () => {
    expect(getBudgetCategoryIconSlug('Groceries')).toBe('marketplace');
    expect(getBudgetCategoryIconSlug('  hvac  ')).toBe('utilities');
    expect(getBudgetCategoryIconSlug('Rent & Mortgage')).toBe('housing');
    expect(getBudgetCategoryIconSlug('savings & investments')).toBe('savings');
  });

  it('maps categories to slugs the brand kit actually ships (no broken glyphs)', () => {
    // Regression guard: these used to point at kit-absent slugs.
    expect(getBudgetCategoryIconSlug('Electrical')).toBe('utilities');
    expect(getBudgetCategoryIconSlug('Pool & Spa')).toBe('utilities');
    expect(getBudgetCategoryIconSlug('Fuel')).toBe('transport');
    expect(getBudgetCategoryIconSlug('Taxes')).toBe('tax');

    // Every mapped slug — and the default — must exist in the kit.
    expect(BUDGET_KIT_SLUGS.has(DEFAULT_CATEGORY_ICON)).toBe(true);
    const invalid = Object.entries(CATEGORY_ICONS)
      .filter(([, slug]) => !BUDGET_KIT_SLUGS.has(slug))
      .map(([name, slug]) => `${name} → ${slug}`);
    expect(invalid).toEqual([]);
  });

  it('covers the categories that used to fall through to a flat Ionicons glyph', () => {
    // These missed the map entirely, so the manage screen drew brush-style brand
    // art on some rows and Ionicons on others — two icon languages, one list.
    expect(getBudgetCategoryIconSlug('Entertainment')).toBe('play');
    expect(getBudgetCategoryIconSlug('Childcare & Kids')).toBe('members');
    expect(getBudgetCategoryIconSlug('Pets')).toBe('leaf');
    // The kit does ship an income glyph; the map used to claim it did not.
    expect(getBudgetCategoryIconSlug('Income')).toBe('income-category');
  });

  it('falls back to the default glyph for a custom / unrecognized category', () => {
    expect(getBudgetCategoryIconSlug('My Custom Bucket')).toBe(DEFAULT_CATEGORY_ICON);
  });
});

/**
 * Budget is a FEATURE, not an app: these screens ship inside House, whose kit is
 * a home-maintenance set missing 19 of the 31 slugs the category map produces —
 * `other` included, so even the catch-all drew the "?" box. Kaizen and Health
 * are each missing ~21. The map stays Budget-native; the fallbacks are what make
 * it renderable everywhere.
 */
describe('budgetIconForActiveKit', () => {
  it('every Budget slug is drawable in every brand that ships the feature', () => {
    const broken: string[] = [];
    for (const brand of BUDGET_HOST_BRANDS) {
      const kit = brandKitSlugs(brand);
      for (const slug of BUDGET_SLUG_VOCABULARY) {
        if (kit.has(slug)) continue; // the kit draws its own art
        const fallback = CATEGORY_ICON_FALLBACKS[slug];
        // No kit art and no fallback is only safe when the slug is itself a
        // real Ionicons name (`calendar`, `gift`, `home`, `play`, …).
        if (!fallback && !IONICONS.has(slug)) broken.push(`${brand}: ${slug}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('every fallback is a real Ionicons glyph', () => {
    const invalid = Object.entries(CATEGORY_ICON_FALLBACKS)
      .filter(([, glyph]) => !IONICONS.has(glyph))
      .map(([slug, glyph]) => `${slug} → ${glyph}`);
    expect(invalid).toEqual([]);
  });

  it('carries no fallback for a slug every kit already ships', () => {
    // A stale entry is a silent downgrade: the slug would keep its brand art
    // (membership wins) while the table implies it does not have any.
    const everyKit = BUDGET_HOST_BRANDS.map((b) => brandKitSlugs(b));
    const redundant = Object.keys(CATEGORY_ICON_FALLBACKS).filter((slug) =>
      everyKit.every((kit) => kit.has(slug)),
    );
    expect(redundant).toEqual([]);
  });

  it('keeps a slug the active kit ships, and passes an unknown name through', () => {
    // `home` is in every kit — the brand art must win over any fallback.
    expect(budgetIconForActiveKit('home')).toBe('home');
    // A category created before the picker moved off Ionicons stores a real
    // glyph name; passing it through unchanged is what keeps it rendering.
    expect(budgetIconForActiveKit('boat')).toBe('boat');
  });

  it('resolves the catch-all to something drawable on the active brand', () => {
    const resolved = getBudgetCategoryIcon('My Custom Bucket');
    expect(resolved === DEFAULT_CATEGORY_ICON || IONICONS.has(resolved)).toBe(true);
  });
});
