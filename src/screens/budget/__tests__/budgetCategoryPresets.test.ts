/**
 * Look of a user-created budget category — the presets shared by the Categories
 * management screen and the inline create row inside every category picker.
 */
import { brandKitSlugs } from '../../../test-utils/brandIconKit';
import {
  DEFAULT_NEW_CATEGORY_ICON,
  PRESET_CATEGORY_COLORS,
  PRESET_CATEGORY_ICONS,
  nextCategoryColor,
} from '../budgetCategoryPresets';

describe('budgetCategoryPresets', () => {
  it('rotates the swatch by how many categories already exist', () => {
    expect(nextCategoryColor(0)).toBe(PRESET_CATEGORY_COLORS[0]);
    expect(nextCategoryColor(1)).toBe(PRESET_CATEGORY_COLORS[1]);
    // Two categories created back to back must not come out the same colour.
    expect(nextCategoryColor(0)).not.toBe(nextCategoryColor(1));
  });

  it('wraps around instead of running off the end of the palette', () => {
    const len = PRESET_CATEGORY_COLORS.length;
    expect(nextCategoryColor(len)).toBe(PRESET_CATEGORY_COLORS[0]);
    expect(nextCategoryColor(len * 3 + 2)).toBe(PRESET_CATEGORY_COLORS[2]);
  });

  it('always returns a real swatch, never undefined', () => {
    // A household with a surprising count (negative/fractional from a bad
    // length) must still paint a colour rather than pass undefined to the API.
    for (const count of [-1, -13, 2.7, 0, 999]) {
      expect(PRESET_CATEGORY_COLORS).toContain(nextCategoryColor(count));
    }
  });

  it('defaults an inline-created category to the first preset glyph', () => {
    expect(DEFAULT_NEW_CATEGORY_ICON).toBe(PRESET_CATEGORY_ICONS[0]);
    expect(DEFAULT_NEW_CATEGORY_ICON).toBe('tag');
  });

  /**
   * The picker offers brand-kit slugs, not Ionicons names, so a user-made
   * category draws the same brush-style art as the built-in ones. A slug the
   * kit doesn't ship falls through to Ionicons and renders the "?" box.
   */
  it('offers only glyphs the Symply Budget kit ships', () => {
    const kit = brandKitSlugs();
    expect(PRESET_CATEGORY_ICONS.filter((icon) => !kit.has(icon))).toEqual([]);
  });

  it('ships every swatch as a hex colour and every glyph as a non-empty slug', () => {
    for (const color of PRESET_CATEGORY_COLORS) expect(color).toMatch(/^#[0-9A-F]{6}$/i);
    for (const icon of PRESET_CATEGORY_ICONS) expect(icon.trim()).not.toBe('');
    // Duplicates would make two custom categories indistinguishable.
    expect(new Set(PRESET_CATEGORY_COLORS).size).toBe(PRESET_CATEGORY_COLORS.length);
    expect(new Set(PRESET_CATEGORY_ICONS).size).toBe(PRESET_CATEGORY_ICONS.length);
  });
});
