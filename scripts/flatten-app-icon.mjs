#!/usr/bin/env node
/**
 * Make an app-icon PNG fully opaque (iOS App Store icons may not have alpha).
 *
 *   mode "extend"  — full-bleed art with transparent rounded corners: fill each
 *                    transparent pixel with the nearest opaque pixel toward the
 *                    center, so the gradient bleeds into the corners with no seam.
 *   mode "flat"    — mark on transparency: composite over a solid background hex
 *                    (e.g. white), giving "mark on <bg>".
 *
 * Usage: node scripts/flatten-app-icon.mjs <file.png> <extend|flat> [bgHex]
 */
import fs from 'node:fs';
import { PNG } from 'pngjs';

const [, , file, mode = 'extend', bgHex = '#FFFFFF'] = process.argv;
if (!file) {
  console.error('Usage: flatten-app-icon.mjs <file.png> <extend|flat> [bgHex]');
  process.exit(1);
}

const png = PNG.sync.read(fs.readFileSync(file));
const { width: w, height: h, data } = png;
const idx = (x, y) => (y * w + x) * 4;

const bg = {
  r: parseInt(bgHex.slice(1, 3), 16),
  g: parseInt(bgHex.slice(3, 5), 16),
  b: parseInt(bgHex.slice(5, 7), 16),
};

const cx = w / 2;
const cy = h / 2;

function nearestOpaqueTowardCenter(x, y) {
  const dx = cx - x;
  const dy = cy - y;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
  for (let s = 1; s <= steps; s++) {
    const nx = Math.round(x + (dx * s) / steps);
    const ny = Math.round(y + (dy * s) / steps);
    if (data[idx(nx, ny) + 3] > 250) return idx(nx, ny);
  }
  return null;
}

let filled = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    const a = data[i + 3];
    if (a === 255) continue;
    const alpha = a / 255;
    let src = { r: bg.r, g: bg.g, b: bg.b };
    if (mode === 'extend') {
      const oi = nearestOpaqueTowardCenter(x, y);
      if (oi != null) src = { r: data[oi], g: data[oi + 1], b: data[oi + 2] };
    }
    // Composite existing (possibly semi-transparent) pixel over the chosen source.
    data[i] = Math.round(data[i] * alpha + src.r * (1 - alpha));
    data[i + 1] = Math.round(data[i + 1] * alpha + src.g * (1 - alpha));
    data[i + 2] = Math.round(data[i + 2] * alpha + src.b * (1 - alpha));
    data[i + 3] = 255;
    filled++;
  }
}

// Write as RGB (colorType 2) so the alpha CHANNEL is dropped — iOS App Store
// icons must have no alpha channel, not merely no transparency.
fs.writeFileSync(file, PNG.sync.write(png, { colorType: 2 }));
console.log(`✓ flattened ${file} (${mode}) — ${filled} px made opaque, alpha channel stripped`);
