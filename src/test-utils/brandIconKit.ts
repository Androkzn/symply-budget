/**
 * The icon slugs a brand kit actually ships, read off disk.
 *
 * Every brand-slug map in the app (category glyphs, picker presets) has to stay
 * inside this set: `<Icon>` falls through to Ionicons for anything the kit is
 * missing, and a kit-only name like `maintenance-fund` is not an Ionicons glyph,
 * so the row renders the "?" box. Reading the folder rather than hand-listing it
 * is what keeps the guard honest as the kit grows.
 */
import { readdirSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '../..');

export function brandKitSlugs(brandId = 'symply-budget'): Set<string> {
  const dir = join(REPO_ROOT, 'brands', brandId, 'src/assets/icons/png/selected');
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.replace(/\.png$/, '')),
  );
}
