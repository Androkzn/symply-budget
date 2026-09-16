#!/usr/bin/env node
/**
 * Copy a supplied icon kit's PNGs into a brand's repo asset folder, normalizing
 * the two kit naming conventions into one:
 *
 *   active | selected                → selected
 *   inactive-dark  | unselected-dark  → unselected-dark
 *   inactive-light | unselected-light → unselected-light
 *   filled-accent                     → filled-accent
 *
 * Files are renamed from `<name>-<state>-96.png` (or `<name>-<state>.png`) to a
 * clean `<name>.png`, so the icon require-map generator keys on the semantic
 * icon name. Reusable across all five apps.
 *
 * Usage:
 *   node scripts/import-brand-icon-pngs.mjs <brandId> "<kit .../assets/png dir>"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [, , brandId, srcPngDirArg] = process.argv;
if (!brandId || !srcPngDirArg) {
  console.error(
    'Usage: node scripts/import-brand-icon-pngs.mjs <brandId> "<kit assets/png dir>"'
  );
  process.exit(1);
}

const srcRoot = path.resolve(srcPngDirArg);
if (!fs.existsSync(srcRoot)) {
  console.error(`Source PNG dir not found: ${srcRoot}`);
  process.exit(1);
}

// Source state dir → normalized state dir. First existing source wins.
const STATE_MAP = [
  { srcs: ['active', 'selected'], dest: 'selected' },
  { srcs: ['inactive-dark', 'unselected-dark'], dest: 'unselected-dark' },
  { srcs: ['inactive-light', 'unselected-light'], dest: 'unselected-light' },
  { srcs: ['filled-accent'], dest: 'filled-accent' },
];

const destRoot = path.join(REPO, 'brands', brandId, 'src/assets/icons/png');

/** `home-inactive-dark-96.png` → `home` (strip trailing -<state>[-96]). */
function baseName(file) {
  return file
    .replace(/\.png$/i, '')
    .replace(/-(active|selected|inactive-dark|inactive-light|unselected-dark|unselected-light|filled-accent)(-\d+)?$/i, '');
}

let copied = 0;
const perState = {};
for (const { srcs, dest } of STATE_MAP) {
  const srcDir = srcs.map(s => path.join(srcRoot, s)).find(d => fs.existsSync(d));
  if (!srcDir) continue;
  const outDir = path.join(destRoot, dest);
  fs.mkdirSync(outDir, { recursive: true });
  const files = fs.readdirSync(srcDir).filter(f => /\.png$/i.test(f));
  for (const f of files) {
    fs.copyFileSync(path.join(srcDir, f), path.join(outDir, `${baseName(f)}.png`));
    copied++;
  }
  perState[dest] = files.length;
}

console.log(`✓ ${brandId}: copied ${copied} PNGs → brands/${brandId}/src/assets/icons/png/`);
for (const [state, n] of Object.entries(perState)) console.log(`    ${state}: ${n}`);
if (!copied) {
  console.error('No PNGs copied — check the source dir has active/selected subfolders.');
  process.exit(1);
}
