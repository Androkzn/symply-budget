#!/usr/bin/env node
/**
 * Audit PNG icon centering for a brand kit.
 *   node scripts/audit-brand-icon-centering.mjs symply-budget [selected|unselected-light|unselected-dark]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , brandId = 'symply-budget', state = 'selected'] = process.argv;

const dir = path.join(REPO, 'brands', brandId, 'src/assets/icons/png', state);
if (!fs.existsSync(dir)) {
  console.error(`Missing ${dir}`);
  process.exit(1);
}

async function analyze(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0,
    sumX = 0,
    sumY = 0,
    count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > 16) {
        count++;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!count) return { slug: path.basename(file, '.png'), problem: 'empty' };
  const mid = (width - 1) / 2;
  const centCx = sumX / count;
  const centCy = sumY / count;
  const marginL = minX;
  const marginR = width - maxX - 1;
  const marginT = minY;
  const marginB = height - maxY - 1;
  return {
    slug: path.basename(file, '.png'),
    centOffX: +(centCx - mid).toFixed(2),
    centOffY: +(centCy - mid).toFixed(2),
    asymX: Math.abs(marginL - marginR),
    asymY: Math.abs(marginT - marginB),
    marginL,
    marginR,
    marginT,
    marginB,
    score: Math.max(Math.abs(centCx - mid), Math.abs(centCy - mid)),
  };
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
const rows = [];
for (const f of files) {
  rows.push(await analyze(path.join(dir, f)));
}
rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

const flagged = rows.filter(r => (r.score ?? 0) > 2 || r.problem);
console.log(`${brandId}/${state}: ${files.length} icons, ${flagged.length} flagged (score > 2px)\n`);
for (const r of rows) {
  if (r.problem) {
    console.log(`✗ ${r.slug}: ${r.problem}`);
    continue;
  }
  const mark = r.score > 2 ? '✗' : '✓';
  console.log(
    `${mark} ${r.slug.padEnd(22)} score=${r.score.toFixed(2).padStart(5)} cent(${r.centOffX},${r.centOffY}) margins L${r.marginL} R${r.marginR} T${r.marginT} B${r.marginB}`,
  );
}

process.exit(flagged.length ? 1 : 0);
