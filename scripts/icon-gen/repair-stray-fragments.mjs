// Repair brand-kit icons that carry a fragment sliced off a NEIGHBOURING tile.
//
// The sheet extractor cuts each glyph out of a painted contact sheet. When the
// cut lands slightly wide it drags in a piece of the icon next door, and the
// damage compounds: the trim-and-centre step then fits "glyph + fragment" into
// the standard inner box, so the real glyph comes out undersized and pushed off
// centre as well. One bad cut, three visible symptoms.
//
// This undoes all three: drop the fragment, then re-trim and re-centre what is
// left at the kit's standard 85% inner box. It is deliberately NOT a
// regeneration — the artwork is fine, only the crop was wrong, so re-running
// gpt-image-1 (see regen-goal-hires.mjs) would throw away good art and return
// something different every time. Repair is deterministic and offline.
//
//   node scripts/icon-gen/repair-stray-fragments.mjs --dry
//   node scripts/icon-gen/repair-stray-fragments.mjs --out /tmp/review
//   node scripts/icon-gen/repair-stray-fragments.mjs [--brand symply-budget] [names...]
//
// ALWAYS review with --dry/--out and LOOK at the result before installing. No
// geometric rule can tell a foreign fragment from a detached mark the artist
// meant: on symply-budget every hit is real, but the other kits lean on
// detached decoration — kaizen `widget-mark` is a grid of loose tiles, `voice`
// a waveform, `sort` three bars, house `search`/`urgent` carry motion lines —
// and this would happily strip them down to the one blob it recognises. It has
// only been vetted against symply-budget; treat any other brand as unproven.
//
// Every state file (selected / unselected-* / filled-accent) gets the SAME crop
// box, computed once from `selected`, so the states stay pixel-aligned. Each
// state keeps its own pixels: in this kit the unselected pair is a desaturated
// copy of the selected gradient, not the flat brand neutral the generator
// writes, and re-deriving them from `selected` would silently restyle them.
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATES = ['selected', 'unselected-dark', 'unselected-light', 'filled-accent'];
const REFERENCE = 'selected';
/** Share of total ink at or above which a blob is part of the glyph proper. */
const CORE_SHARE = 0.15;
/**
 * Clear canvas a fragment must sit beyond the glyph before it counts as
 * foreign, as a fraction of the canvas. Being outside the core's box is not
 * enough on its own: `fingerprint` draws each ridge as its own stroke, so its
 * topmost arc sits just above the rest — 1px clear. The fragments a bad cut
 * drags in land ~20px out on a 96px canvas, well beyond anything a glyph does
 * with its own parts.
 */
const STRAY_GAP = 0.1;
/** Fraction of the canvas the composed glyph spans — matches the generator. */
const INNER = 0.85;
const ALPHA_ON = 24;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BRAND = opt('brand', 'symply-budget');
const OUT = opt('out', null);
const DRY = flag('dry');
const ONLY = argv.filter((a) => !a.startsWith('--') && a !== BRAND && a !== OUT);

const kitDir = (state) =>
  path.join(REPO, 'brands', BRAND, 'src/assets/icons/png', state);

/** 4-connected components over the alpha channel. */
function label(data, w, h, channels) {
  const on = (i) => data[i * channels + 3] > ALPHA_ON;
  const lab = new Int32Array(w * h).fill(-1);
  const blobs = [];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!on(s) || lab[s] !== -1) continue;
    const id = blobs.length;
    let count = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    stack.push(s);
    lab[s] = id;
    while (stack.length) {
      const p = stack.pop();
      count++;
      const x = p % w;
      const y = Math.floor(p / w);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && on(q) && lab[q] === -1) { lab[q] = id; stack.push(q); }
    }
    blobs.push({ id, count, box: [x0, y0, x1, y1] });
  }
  return { lab, blobs };
}

/**
 * Blobs that are a neighbouring glyph's leftovers rather than part of this one.
 *
 * Size alone cannot decide it — `utilities` is a droplet, a flame and a bolt, so
 * its biggest blob holds barely a third of the ink and a size-only rule (what
 * the generator's dropSpecks does) reads a real element as a speck. Position
 * settles it: the glyph's parts cluster, a foreign fragment sits off on its own,
 * a clear STRAY_GAP beyond the cluster's box.
 */
function straysOf(blobs, size) {
  if (blobs.length < 2) return [];
  const total = blobs.reduce((n, b) => n + b.count, 0);
  const core = blobs.filter((b) => b.count / total >= CORE_SHARE);
  if (!core.length) return [];
  const cx0 = Math.min(...core.map((b) => b.box[0]));
  const cy0 = Math.min(...core.map((b) => b.box[1]));
  const cx1 = Math.max(...core.map((b) => b.box[2]));
  const cy1 = Math.max(...core.map((b) => b.box[3]));
  const gap = size * STRAY_GAP;
  return blobs.filter((b) => {
    if (b.count / total >= CORE_SHARE) return false;
    const [x0, y0, x1, y1] = b.box;
    return x1 < cx0 - gap || x0 > cx1 + gap || y1 < cy0 - gap || y0 > cy1 + gap;
  });
}

async function raw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, channels: info.channels };
}

/** Erase the stray pixels, then trim + centre what is left in the inner box. */
async function repairState(file, strayIds, refBox, size) {
  const { data, w, h, channels } = await raw(file);
  const out = Buffer.from(data);
  if (strayIds) {
    const { lab } = label(data, w, h, channels);
    for (let p = 0; p < w * h; p++) if (lab[p] >= 0 && strayIds.has(lab[p])) out[p * channels + 3] = 0;
  }
  const cleaned = sharp(out, { raw: { width: w, height: h, channels } });
  const [x0, y0, x1, y1] = refBox;
  const inner = Math.round(size * INNER);
  const cropped = await cleaned
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .resize(inner, inner, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const m = await sharp(cropped).metadata();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: cropped, left: Math.round((size - m.width) / 2), top: Math.round((size - m.height) / 2) }])
    .png()
    .toBuffer();
}

async function main() {
  const refDir = kitDir(REFERENCE);
  if (!fs.existsSync(refDir)) throw new Error(`no kit for brand ${BRAND}`);
  const names = fs
    .readdirSync(refDir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.slice(0, -4))
    .filter((n) => !ONLY.length || ONLY.includes(n));

  let repaired = 0;
  for (const name of names) {
    const refFile = path.join(refDir, `${name}.png`);
    const { data, w, h, channels } = await raw(refFile);
    if (w !== h) continue;
    const { blobs } = label(data, w, h, channels);
    const strays = straysOf(blobs, w);
    if (!strays.length) continue;

    const keep = blobs.filter((b) => !strays.includes(b));
    const box = [
      Math.min(...keep.map((b) => b.box[0])),
      Math.min(...keep.map((b) => b.box[1])),
      Math.max(...keep.map((b) => b.box[2])),
      Math.max(...keep.map((b) => b.box[3])),
    ];
    const before = [
      Math.min(...blobs.map((b) => b.box[0])),
      Math.min(...blobs.map((b) => b.box[1])),
      Math.max(...blobs.map((b) => b.box[2])),
      Math.max(...blobs.map((b) => b.box[3])),
    ];
    repaired++;
    console.log(
      `${BRAND}/${name}: dropped ${strays.length} fragment(s) ` +
        `[${strays.map((s) => s.box.join(',')).join(' | ')}] ` +
        `· content ${before[2] - before[0] + 1}x${before[3] - before[1] + 1} → ` +
        `${box[2] - box[0] + 1}x${box[3] - box[1] + 1} refitted to ${Math.round(w * INNER)}px`,
    );
    if (DRY) continue;

    for (const state of STATES) {
      const file = path.join(kitDir(state), `${name}.png`);
      if (!fs.existsSync(file)) continue;
      // Each state is relabelled against its own pixels, so an id from the
      // reference would point at the wrong blob — match by box instead.
      const s = await raw(file);
      const own = label(s.data, s.w, s.h, s.channels);
      const ids = new Set(
        own.blobs
          .filter((b) => strays.some((t) => Math.abs(b.box[0] - t.box[0]) <= 2 && Math.abs(b.box[1] - t.box[1]) <= 2))
          .map((b) => b.id),
      );
      const buf = await repairState(file, ids, box, w);
      const dest = OUT ? path.join(OUT, state, `${name}.png`) : file;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
    }
  }
  console.log(
    repaired
      ? `\n${DRY ? 'Would repair' : 'Repaired'} ${repaired} icon(s)${OUT ? ` → ${OUT}` : ''}`
      : '\nNo damaged icons found.',
  );
}

main().catch((e) => { console.error(e.message); process.exit(1); });
