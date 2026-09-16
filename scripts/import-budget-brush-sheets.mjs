#!/usr/bin/env node
/**
 * Slice the Symply Budget ChatGPT brush-icon sheets into the PNG kit.
 * Source art: documents/apps/symply-budget/brand/brush-sheets/*.png
 *
 *   node scripts/import-budget-brush-sheets.mjs
 *   APP_BRAND=symply-budget npm run icons:build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(
  REPO,
  'documents/apps/symply-budget/brand/brush-sheets',
);
const PNG_ROOT = path.join(REPO, 'brands/symply-budget/src/assets/icons/png');
const OUT_SIZE = 96;
const CANVAS_PAD = 6;
const MIN_EDGE = 4;

/** Fine-tune restored git icons that still miss centroid after auto placement. */
const MANUAL_NUDGE = {
  spendings: { x: 0, y: 2 },
};

function measureInk(fitted) {
  return sharp(fitted).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function placeInk(fitted, ink, iw, ih) {
  let sumX = 0;
  let sumY = 0;
  let weight = 0;
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const a = ink[(y * iw + x) * 4 + 3] / 255;
      if (a > 0.06) {
        sumX += x * a;
        sumY += y * a;
        weight += a;
      }
    }
  }
  if (!weight) {
    return { left: CANVAS_PAD, top: CANVAS_PAD, minMargin: CANVAS_PAD };
  }

  const cx = sumX / weight;
  const cy = sumY / weight;
  let left = Math.round((OUT_SIZE - iw) / 2);
  let top = Math.round((OUT_SIZE - ih) / 2);
  const nudgeX = Math.round(OUT_SIZE / 2 - (left + cx));
  const nudgeY = Math.round(OUT_SIZE / 2 - (top + cy));
  left = Math.max(0, Math.min(left + nudgeX, OUT_SIZE - iw));
  top = Math.max(0, Math.min(top + nudgeY, OUT_SIZE - ih));
  const minMargin = Math.min(left, OUT_SIZE - iw - left, top, OUT_SIZE - ih - top);
  return { left, top, minMargin };
}

/** Strip opaque checkerboard, trim ink, center visual mass on a transparent square. */
async function normalizeCellBuffer(inputBuf, slug) {
  const { data, info } = await sharp(inputBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const out = Buffer.from(data);

  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max - min;
    const lum = (r + g + b) / 3;
    if (sat < 32 && lum > 175) {
      out[o + 3] = 0;
    }
  }

  const trimmed = await sharp(out, { raw: { width, height, channels: 4 } })
    .trim({ threshold: 12 })
    .png()
    .toBuffer();

  const inner = OUT_SIZE - CANVAS_PAD * 2;
  let fitted = await sharp(trimmed)
    .resize(inner, inner, {
      fit: 'inside',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  let { data: ink, info: inkInfo } = await measureInk(fitted);
  let { width: iw, height: ih } = inkInfo;
  let placement = placeInk(fitted, ink, iw, ih);

  for (let attempt = 0; attempt < 4 && placement.minMargin < MIN_EDGE; attempt++) {
    const scale = 0.92 - attempt * 0.03;
    fitted = await sharp(trimmed)
      .resize(Math.round(inner * scale), Math.round(inner * scale), {
        fit: 'inside',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    ({ data: ink, info: inkInfo } = await measureInk(fitted));
    ({ width: iw, height: ih } = inkInfo);
    placement = placeInk(fitted, ink, iw, ih);
  }

  const { left, top } = placement;
  const nudge = MANUAL_NUDGE[slug] ?? { x: 0, y: 0 };
  const finalLeft = Math.max(0, Math.min(left + nudge.x, OUT_SIZE - iw));
  const finalTop = Math.max(0, Math.min(top + nudge.y, OUT_SIZE - ih));

  return sharp({
    create: {
      width: OUT_SIZE,
      height: OUT_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: fitted, left: finalLeft, top: finalTop }])
    .png()
    .toBuffer();
}

/** @type {Array<{ file: string, cols: number, rows: number, slugs: string[][] }>} */
const SHEETS = [
  {
    file: 'sheet-01-core.png',
    cols: 4,
    rows: 4,
    slugs: [
      ['budget', 'home', 'ai-coach', 'more'],
      ['profile', 'settings', 'planned', 'categories'],
      ['trends', 'goal', 'income', 'expense'],
      ['transfer', 'import', 'savings', 'soft-transfer'],
    ],
  },
  {
    file: 'sheet-02-actions.png',
    cols: 4,
    rows: 4,
    slugs: [
      ['sync', 'due', 'paid', 'review-draft'],
      ['bills', 'import', 'export', 'document-scan'],
      ['recurring', 'share', 'insights', 'forecast'],
      ['notifications', 'calendar', 'tax', 'budget-health'],
    ],
  },
  {
    file: 'sheet-03-categories.png',
    cols: 4,
    rows: 4,
    slugs: [
      ['other', 'categories', 'tag', 'registered-account'],
      ['receipt', 'food', 'housing', 'transport'],
      ['utilities', 'shopping', 'subscriptions', 'bills'],
      ['maintenance-fund', 'other', 'cash', 'credit'],
    ],
  },
  {
    file: 'sheet-04-status.png',
    cols: 4,
    rows: 3,
    slugs: [
      ['complete', 'in-progress', 'pending', 'overdue-status'],
      ['skipped', 'overdue', 'debt', 'trends'],
      ['members', 'savings', 'currency', 'transfer'],
    ],
  },
];

const UNSELECTED_LIGHT = { r: 83, g: 106, b: 99 }; // #536A63
const UNSELECTED_DARK = { r: 146, g: 166, b: 160 }; // #92A6A0

async function cropCell(input, col, row, cols, rows, slug) {
  const meta = await sharp(input).metadata();
  const w = meta.width ?? 1024;
  const h = meta.height ?? 1024;
  const cellW = Math.floor(w / cols);
  const cellH = Math.floor(h / rows);
  const left = col * cellW;
  const top = row * cellH;
  const raw = await sharp(input)
    .extract({ left, top, width: cellW, height: cellH })
    .png()
    .toBuffer();
  return normalizeCellBuffer(raw, slug);
}

async function writeState(buf, slug, stateDir, tint) {
  const outDir = path.join(PNG_ROOT, stateDir);
  fs.mkdirSync(outDir, { recursive: true });
  let pipeline = sharp(buf);
  if (tint) {
    pipeline = pipeline.greyscale().tint(tint);
  }
  await pipeline.toFile(path.join(outDir, `${slug}.png`));
}

/** White glyph for buttons / FABs on brand-primary fills (chat FAB, etc.). */
async function writeFilledAccent(buf, slug) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  for (let i = 0; i < info.width * info.height; i++) {
    const o = i * 4;
    const a = data[o + 3];
    if (a < 12) {
      out[o + 3] = 0;
      continue;
    }
    out[o] = 255;
    out[o + 1] = 255;
    out[o + 2] = 255;
    out[o + 3] = a;
  }
  const whiteIcon = await sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  await writeState(whiteIcon, slug, 'filled-accent', null);
}

async function writeAllStates(cell, slug) {
  await writeState(cell, slug, 'selected', null);
  await writeState(cell, slug, 'unselected-light', UNSELECTED_LIGHT);
  await writeState(cell, slug, 'unselected-dark', UNSELECTED_DARK);
  await writeFilledAccent(cell, slug);
}

async function main() {
  const written = new Set();

  for (const sheet of SHEETS) {
    const src = path.join(ASSETS, sheet.file);
    if (!fs.existsSync(src)) {
      console.error(`Missing brush sheet: ${path.relative(REPO, src)}`);
      process.exit(1);
    }
    for (let row = 0; row < sheet.rows; row++) {
      for (let col = 0; col < sheet.cols; col++) {
        const slug = sheet.slugs[row][col];
        if (!slug) continue;
        const cell = await cropCell(src, col, row, sheet.cols, sheet.rows, slug);
        await writeAllStates(cell, slug);
        written.add(slug);
      }
    }
    console.log(`✓ ${sheet.file} → ${sheet.rows * sheet.cols} cells`);
  }

  // Restore brush originals from before the vector resvg pass (commit before e7da79c0).
  const RESTORE_REF = 'e7da79c0^';
  const selectedDir = path.join(PNG_ROOT, 'selected');
  const onDisk = fs.readdirSync(selectedDir).filter(f => f.endsWith('.png'));

  const { execSync } = await import('node:child_process');
  for (const file of onDisk) {
    const slug = file.replace(/\.png$/, '');
    if (written.has(slug)) continue;
    const rel = `brands/symply-budget/src/assets/icons/png/selected/${slug}.png`;
    try {
      const raw = execSync(`git show ${RESTORE_REF}:${rel}`, {
        cwd: REPO,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const cell = await normalizeCellBuffer(raw, slug);
      await writeAllStates(cell, slug);
    } catch {
      for (const state of ['selected', 'unselected-light', 'unselected-dark', 'filled-accent']) {
        try {
          fs.unlinkSync(path.join(PNG_ROOT, state, `${slug}.png`));
        } catch {
          /* already gone */
        }
      }
    }
  }

  // Kit-only slugs restored from git (chat, auth, spendings, …) — ensure filled-accent exists.
  for (const file of fs.readdirSync(selectedDir).filter(f => f.endsWith('.png'))) {
    const slug = file.replace(/\.png$/, '');
    const accentPath = path.join(PNG_ROOT, 'filled-accent', `${slug}.png`);
    if (fs.existsSync(accentPath)) continue;
    const raw = fs.readFileSync(path.join(selectedDir, file));
    const cell = await normalizeCellBuffer(raw, slug);
    await writeFilledAccent(cell, slug);
    console.log(`✓ filled-accent ${slug}`);
  }

  console.log(`✓ Imported ${written.size} brush icons from sheets`);
  console.log('  Run: APP_BRAND=symply-budget npm run icons:build');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
