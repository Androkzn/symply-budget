#!/usr/bin/env node
/**
 * Rasterize brands/<id>/icon-paths.cjs → PNG kit (96×96, three core states).
 * Uses @resvg/resvg-js. Skips slugs that already exist unless --force.
 *
 *   node scripts/generate-brand-icon-pngs.mjs symply-budget [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { createRequire } from 'node:module';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const [, , brandId, ...rest] = process.argv;
const force = rest.includes('--force');

if (!brandId) {
  console.error('Usage: node scripts/generate-brand-icon-pngs.mjs <brandId> [--force]');
  process.exit(1);
}

const pathsFile = path.join(REPO, 'brands', brandId, 'icon-paths.cjs');
if (!fs.existsSync(pathsFile)) {
  console.error(`Missing ${path.relative(REPO, pathsFile)}`);
  process.exit(1);
}

/** @type {Record<string, string>} */
const ICON_PATHS = require(pathsFile);

const PALETTES = {
  'symply-budget': {
    gradient: ['#5FD49A', '#2BB673', '#239A61', '#1B7A4C'],
    light: '#536A63',
    dark: '#92A6A0',
  },
  'symply-house': {
    gradient: ['#7EDDD6', '#4ECDC4', '#3DBDB5', '#2D9D96'],
    light: '#536A63',
    dark: '#92A6A0',
  },
};

const palette = PALETTES[brandId];
if (!palette) {
  console.error(`No palette for "${brandId}" — add to PALETTES in this script.`);
  process.exit(1);
}

const STATES = [
  { dir: 'selected', stroke: 'url(#g)' },
  { dir: 'unselected-light', stroke: palette.light },
  { dir: 'unselected-dark', stroke: palette.dark },
];

const pngRoot = path.join(REPO, 'brands', brandId, 'src/assets/icons/png');
const SIZE = 96;

function buildSvg(paths, stroke) {
  const defs =
    stroke === 'url(#g)'
      ? `<defs><linearGradient id="g" x1="5%" y1="5%" x2="95%" y2="95%">${palette.gradient
          .map((c, i) => `<stop offset="${Math.round((i / (palette.gradient.length - 1)) * 100)}%" stop-color="${c}"/>`)
          .join('')}</linearGradient></defs>`
      : '';
  const body = paths.replace(/currentColor/g, stroke);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none" stroke="${stroke === 'url(#g)' ? 'url(#g)' : stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${defs}${body}</svg>`;
}

function renderPng(svg) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: SIZE },
    background: 'transparent',
  });
  return resvg.render().asPng();
}

let written = 0;
let skipped = 0;

for (const [slug, paths] of Object.entries(ICON_PATHS)) {
  for (const { dir, stroke } of STATES) {
    const outDir = path.join(pngRoot, dir);
    const outFile = path.join(outDir, `${slug}.png`);
    if (!force && fs.existsSync(outFile)) {
      skipped++;
      continue;
    }
    fs.mkdirSync(outDir, { recursive: true });
    const png = renderPng(buildSvg(paths, stroke));
    fs.writeFileSync(outFile, png);
    written++;
  }
}

console.log(`✓ ${brandId}: wrote ${written} PNGs, skipped ${skipped} existing`);
if (written) {
  console.log(`  Run: APP_BRAND=${brandId} npm run icons:build`);
}
