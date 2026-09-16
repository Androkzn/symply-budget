#!/usr/bin/env node
/**
 * extract-icon-sheet.mjs — robust, brand-agnostic icon-sheet slicer.
 *
 * Turns a "contact sheet" of icons (a grid of icons on a near-uniform
 * background, usually with a title header and a caption under each icon)
 * into one transparent-background PNG per icon.
 *
 * WHY THIS INSTEAD OF A FIXED GRID
 * --------------------------------
 * The naive approach ("cut the image into cols×rows equal rectangles") breaks
 * the moment the generator nudges an icon, changes the header height, leaves a
 * short final row, or draws a multi-part glyph (feet, dots). This script never
 * assumes pixel positions. It:
 *   1. estimates the background colour from the border,
 *   2. builds an "ink" mask (pixels that clearly differ from the background;
 *      in the default `chroma` mode, only *saturated* pixels — which drops the
 *      neutral title + caption text for free),
 *   3. segments the grid from the ink itself using whitespace gutters
 *      (projection profiles) — so partial rows and off-centre icons just work,
 *   4. crops each cell from a soft alpha-keyed copy (anti-aliased edges, real
 *      transparency), then trims + centres + fits it onto a square canvas.
 *
 * It is dependency-light (only `sharp`, already in the repo) and emits a
 * manifest + optional debug overlay so every run is verifiable.
 *
 * USAGE
 *   node scripts/extract-icon-sheet.mjs <sheet.png> [options]
 *
 * OPTIONS
 *   --out <dir>        Output directory (default: ./<sheet-basename>-icons)
 *   --names <a,b,c>    Row-major slugs (comma list) OR a path to a .json/.txt
 *                      file (JSON array, or newline/comma list). Extra cells
 *                      beyond the list fall back to r{row}-c{col}.
 *   --cols <n>         Expected columns (validation + splits a fused row).
 *   --rows <n>         Expected rows (validation only).
 *   --size <px>        Output canvas size, square (default 256).
 *   --pad <px>         Transparent padding inside the canvas (default 16).
 *   --mode <chroma|contrast>
 *                      chroma  (default): keep only saturated ink; auto-drops
 *                                         neutral title/caption text.
 *                      contrast:          keep anything far from the bg colour
 *                                         (use for black / monochrome icons;
 *                                         captions are removed by row banding).
 *   --sat <0..255>     Min saturation for chroma mode (default 28).
 *   --dist <0..441>    Min colour distance from bg to count as ink (default 40).
 *   --min-cell <px>    Ignore blobs/cells smaller than this on a side (default 12).
 *   --debug            Also write _debug-overlay.png (detected boxes) and
 *                      _debug-mask.png (the ink mask).
 *   --dry-run          Detect + report, write nothing.
 *   --help
 *
 * EXAMPLES
 *   node scripts/extract-icon-sheet.mjs sheet-01.png \
 *     --names health-home,activity-tab,nutrition-tab,trends-tab,more,profile,settings,steps,distance,walk,run,timer \
 *     --cols 4 --rows 3 --out ./out --debug
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

// ----------------------------------------------------------------------------
// arg parsing
// ----------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    out: null,
    names: null,
    cols: null,
    rows: null,
    size: 256,
    pad: 16,
    mode: 'chroma',
    sat: 28,
    dist: 40,
    minCell: 12,
    debug: false,
    dryRun: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--out': opts.out = next(); break;
      case '--names': opts.names = next(); break;
      case '--cols': opts.cols = parseInt(next(), 10); break;
      case '--rows': opts.rows = parseInt(next(), 10); break;
      case '--size': opts.size = parseInt(next(), 10); break;
      case '--pad': opts.pad = parseInt(next(), 10); break;
      case '--mode': opts.mode = next(); break;
      case '--sat': opts.sat = parseInt(next(), 10); break;
      case '--dist': opts.dist = parseInt(next(), 10); break;
      case '--min-cell': opts.minCell = parseInt(next(), 10); break;
      case '--debug': opts.debug = true; break;
      case '--dry-run': opts.dryRun = true; break;
      default:
        if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`);
        positional.push(a);
    }
  }
  opts.input = positional[0];
  return opts;
}

const HELP = `extract-icon-sheet.mjs — slice a grid of icons into transparent PNGs.

  node scripts/extract-icon-sheet.mjs <sheet.png> [--out dir] [--names a,b,..]
    [--cols n] [--rows n] [--size 256] [--pad 16] [--mode chroma|contrast]
    [--sat 28] [--dist 40] [--min-cell 12] [--debug] [--dry-run]

Run with --help to see the full option list in the file header.`;

function loadNames(spec) {
  if (!spec) return null;
  // A file path?
  if (/\.(json|txt)$/i.test(spec) && fs.existsSync(spec)) {
    const raw = fs.readFileSync(spec, 'utf8').trim();
    if (spec.toLowerCase().endsWith('.json')) return JSON.parse(raw);
    return raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  }
  return spec.split(',').map(s => s.trim()).filter(Boolean);
}

// ----------------------------------------------------------------------------
// pixel helpers
// ----------------------------------------------------------------------------
async function loadRGBA(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Median background colour sampled from a border ring (robust to icons that
 *  touch an edge and to JPEG-ish noise). */
function estimateBackground(data, width, height) {
  const ring = Math.max(2, Math.round(Math.min(width, height) * 0.02));
  const rs = [];
  const gs = [];
  const bs = [];
  const push = (x, y) => {
    const o = (y * width + x) * 4;
    if (data[o + 3] < 8) return; // ignore already-transparent
    rs.push(data[o]);
    gs.push(data[o + 1]);
    bs.push(data[o + 2]);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < ring || x >= width - ring || y < ring || y >= height - ring) push(x, y);
    }
  }
  const median = arr => {
    arr.sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)] ?? 255;
  };
  return { r: median(rs), g: median(gs), b: median(bs) };
}

const colorDist = (r, g, b, bg) =>
  Math.sqrt((r - bg.r) ** 2 + (g - bg.g) ** 2 + (b - bg.b) ** 2);

const saturation = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);

/**
 * Ink mask (Uint8 0/1) + a soft-keyed RGBA buffer where the background is
 * turned transparent with an anti-aliased alpha ramp (so brush edges stay
 * smooth instead of getting a hard 1-bit cut).
 */
function buildInk(data, width, height, bg, opts) {
  const mask = new Uint8Array(width * height);
  const keyed = Buffer.alloc(data.length);
  const d0 = opts.dist * 0.6; // fully transparent below this distance
  const d1 = opts.dist * 1.4; // fully opaque above this distance
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const a = data[o + 3];
    const dist = colorDist(r, g, b, bg);
    const sat = saturation(r, g, b);

    // Is this an "ink" pixel for grid-detection purposes?
    let isInk;
    if (opts.mode === 'chroma') {
      isInk = sat >= opts.sat && dist >= opts.dist;
    } else {
      isInk = dist >= opts.dist;
    }
    if (a < 8) isInk = false;
    mask[i] = isInk ? 1 : 0;

    // Soft alpha for the visual crop. In chroma mode, neutral pixels (caption
    // text, faint grey) are forced transparent so stray text can't survive a
    // crop even if it grazes an icon's bounding box.
    let alpha;
    if (opts.mode === 'chroma' && sat < opts.sat * 0.7) {
      alpha = 0;
    } else {
      const t = (dist - d0) / Math.max(1, d1 - d0);
      alpha = Math.round(Math.max(0, Math.min(1, t)) * a);
    }
    keyed[o] = r;
    keyed[o + 1] = g;
    keyed[o + 2] = b;
    keyed[o + 3] = alpha;
  }
  return { mask, keyed };
}

// ----------------------------------------------------------------------------
// grid segmentation via projection profiles (whitespace gutters)
// ----------------------------------------------------------------------------
/** Split [0,len) into runs where profile[i] >= threshold, merging gaps smaller
 *  than `minGap` and dropping runs shorter than `minRun`. */
function segmentRuns(profile, threshold, minRun, minGap) {
  const runs = [];
  let start = -1;
  let lastEnd = -1;
  for (let i = 0; i < profile.length; i++) {
    const on = profile[i] >= threshold;
    if (on && start < 0) {
      // bridge a small gap back to the previous run
      if (lastEnd >= 0 && i - lastEnd <= minGap && runs.length) {
        start = runs.pop().start;
      } else {
        start = i;
      }
    } else if (!on && start >= 0) {
      runs.push({ start, end: i });
      lastEnd = i;
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, end: profile.length });
  return runs.filter(r => r.end - r.start >= minRun);
}

/**
 * Bounding-box area of the largest connected ink component inside a horizontal
 * band [top, bottom). Iterative flood fill (4-connectivity) over the mask;
 * ignores components smaller than `minPix` (noise / anti-alias specks).
 * Used to tell icon rows (one big blob) from text rows (many tiny blobs).
 */
function largestComponentArea(mask, width, top, bottom, minPix) {
  const seen = new Uint8Array(width * (bottom - top));
  const idxOf = (x, y) => (y - top) * width + x;
  let best = 0;
  const stack = [];
  for (let y = top; y < bottom; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x] || seen[idxOf(x, y)]) continue;
      let minX = x, maxX = x, minY = y, maxY = y, size = 0;
      stack.length = 0;
      stack.push(x, y);
      seen[idxOf(x, y)] = 1;
      while (stack.length) {
        const cy = stack.pop();
        const cx = stack.pop();
        size++;
        if (cx < minX) minX = cx; else if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; else if (cy > maxY) maxY = cy;
        const nb = [cx - 1, cy, cx + 1, cy, cx, cy - 1, cx, cy + 1];
        for (let k = 0; k < 8; k += 2) {
          const nx = nb[k];
          const ny = nb[k + 1];
          if (nx < 0 || nx >= width || ny < top || ny >= bottom) continue;
          if (!mask[ny * width + nx] || seen[idxOf(nx, ny)]) continue;
          seen[idxOf(nx, ny)] = 1;
          stack.push(nx, ny);
        }
      }
      if (size < minPix) continue;
      const area = (maxX - minX + 1) * (maxY - minY + 1);
      if (area > best) best = area;
    }
  }
  return best;
}

/** Column profile of a horizontal band: how many ink pixels in each column. */
function columnProfile(mask, width, top, bottom) {
  const prof = new Array(width).fill(0);
  for (let y = top; y < bottom; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) if (mask[row + x]) prof[x]++;
  }
  return prof;
}

/** Row profile: how many ink pixels in each row across the whole width. */
function rowProfile(mask, width, height) {
  const prof = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let n = 0;
    for (let x = 0; x < width; x++) n += mask[row + x];
    prof[y] = n;
  }
  return prof;
}

/**
 * Detect icon cells. Returns [{ row, col, left, top, right, bottom }].
 * Row bands come from the vertical projection; within each band, columns come
 * from the horizontal projection. If `cols` is supplied and a band yields the
 * wrong column count, we fall back to an even split so a run of fused icons is
 * still recoverable.
 */
function detectCells(mask, width, height, opts) {
  const rProf = rowProfile(mask, width, height);
  let rowRuns = segmentRuns(
    rProf,
    Math.max(1, Math.round(width * 0.01)), // a row is "on" if >=1% of its width is ink
    Math.max(opts.minCell, Math.round(height * 0.03)),
    Math.round(height * 0.02),
  );
  if (!rowRuns.length) return [];

  // Drop title / subtitle / caption bands by *content*, not position. Text
  // bands are made of small letter-sized blobs; an icon row always contains at
  // least one large icon-sized blob. So classify each band by the bounding-box
  // area of its single largest connected component, and drop bands whose
  // largest blob is far smaller than the biggest icon on the sheet. This is
  // colour-agnostic (a navy title that chroma keying can't reject still goes),
  // position-agnostic (kills a caption line sitting *between* two icon rows),
  // and never removes a real icon row. Falls back to keeping all if it would
  // drop everything.
  // A band is TEXT only if BOTH signals agree: its largest blob is far smaller
  // than the biggest icon (small components) AND the band itself is short. That
  // second clause is what protects a row made entirely of fragmented icons — a
  // grid of little squares or a row of bars has small components too, but it
  // still stands tall, whereas a title/caption line is short in both.
  const bandArea = rowRuns.map(b => largestComponentArea(mask, width, b.start, b.end, opts.minCell * opts.minCell));
  const bandH = rowRuns.map(b => b.end - b.start);
  const maxArea = Math.max(...bandArea);
  const maxH = Math.max(...bandH);
  if (maxArea > 0 && maxH > 0) {
    const kept = rowRuns.filter((_, i) => !(bandArea[i] < maxArea * 0.5 && bandH[i] < maxH * 0.72));
    if (kept.length) rowRuns = kept;
  }

  const cells = [];
  rowRuns.forEach((band, rowIdx) => {
    const cProf = columnProfile(mask, width, band.start, band.end);
    let colRuns = segmentRuns(
      cProf,
      1,
      opts.minCell,
      Math.round(width * 0.02),
    );

    // If we know how many columns to expect and detection disagrees, and the
    // band clearly spans the full width, split it evenly as a fallback.
    if (opts.cols && colRuns.length !== opts.cols) {
      const first = colRuns[0]?.start ?? 0;
      const last = colRuns[colRuns.length - 1]?.end ?? width;
      const span = last - first;
      if (colRuns.length > opts.cols || span > width * 0.6) {
        const step = span / opts.cols;
        colRuns = Array.from({ length: opts.cols }, (_, i) => ({
          start: Math.round(first + i * step),
          end: Math.round(first + (i + 1) * step),
        }));
      }
    }

    colRuns.forEach((run, colIdx) => {
      // Tighten the vertical extent to this cell's actual ink (a tall
      // neighbour shouldn't inflate a short icon's box).
      let top = band.end;
      let bottom = band.start;
      for (let y = band.start; y < band.end; y++) {
        const row = y * width;
        let has = false;
        for (let x = run.start; x < run.end; x++) {
          if (mask[row + x]) { has = true; break; }
        }
        if (has) { top = Math.min(top, y); bottom = Math.max(bottom, y + 1); }
      }
      if (bottom <= top) return;
      cells.push({
        row: rowIdx,
        col: colIdx,
        left: run.start,
        top,
        right: run.end,
        bottom,
      });
    });
  });
  return cells;
}

// ----------------------------------------------------------------------------
// per-cell crop → centred square transparent PNG
// ----------------------------------------------------------------------------
async function renderCell(keyed, width, height, cell, opts) {
  const pad = 2;
  const left = Math.max(0, cell.left - pad);
  const top = Math.max(0, cell.top - pad);
  const cw = Math.min(width - left, cell.right - cell.left + pad * 2);
  const ch = Math.min(height - top, cell.bottom - cell.top + pad * 2);

  const crop = await sharp(keyed, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: cw, height: ch })
    .png()
    .toBuffer();

  // Trim to the ink, then fit inside the padded square and centre it.
  const inner = Math.max(1, opts.size - opts.pad * 2);
  const trimmed = await sharp(crop).trim({ threshold: 6 }).toBuffer().catch(() => crop);
  const fitted = await sharp(trimmed)
    .resize(inner, inner, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const meta = await sharp(fitted).metadata();
  const iw = meta.width ?? inner;
  const ih = meta.height ?? inner;
  return sharp({
    create: {
      width: opts.size,
      height: opts.size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: fitted, left: Math.round((opts.size - iw) / 2), top: Math.round((opts.size - ih) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ----------------------------------------------------------------------------
// debug overlay
// ----------------------------------------------------------------------------
async function writeDebug(input, cells, mask, width, height, outDir) {
  const rects = cells
    .map(
      c =>
        `<rect x="${c.left}" y="${c.top}" width="${c.right - c.left}" height="${c.bottom - c.top}" ` +
        `fill="none" stroke="#00d0ff" stroke-width="3"/>` +
        `<text x="${c.left + 4}" y="${c.top + 20}" font-family="monospace" font-size="18" fill="#00d0ff">${c.row}·${c.col}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects}</svg>`;
  await sharp(input)
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .png()
    .toFile(path.join(outDir, '_debug-overlay.png'));

  const maskRGBA = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = mask[i] ? 255 : 0;
    maskRGBA[i * 4] = v;
    maskRGBA[i * 4 + 1] = v;
    maskRGBA[i * 4 + 2] = v;
    maskRGBA[i * 4 + 3] = 255;
  }
  await sharp(maskRGBA, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(path.join(outDir, '_debug-mask.png'));
}

// ----------------------------------------------------------------------------
// main
// ----------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.input) {
    console.log(HELP);
    process.exit(opts.input ? 0 : 1);
  }
  if (!fs.existsSync(opts.input)) {
    console.error(`✗ Not found: ${opts.input}`);
    process.exit(1);
  }
  const names = loadNames(opts.names);
  const outDir = opts.out || `${opts.input.replace(/\.[^.]+$/, '')}-icons`;

  const { data, width, height } = await loadRGBA(opts.input);
  const bg = estimateBackground(data, width, height);
  const { mask, keyed } = buildInk(data, width, height, bg, opts);

  let cells = detectCells(mask, width, height, opts);
  // Deterministic row-major order.
  cells.sort((a, b) => a.row - b.row || a.col - b.col);

  const rowsFound = cells.length ? cells[cells.length - 1].row + 1 : 0;
  console.log(`Sheet    : ${path.basename(opts.input)}  ${width}×${height}`);
  console.log(`Background: rgb(${bg.r},${bg.g},${bg.b})   mode=${opts.mode}`);
  console.log(`Detected : ${cells.length} icons across ${rowsFound} rows`);

  // Validation / warnings (non-fatal unless nothing found).
  let warnings = 0;
  if (opts.rows && rowsFound !== opts.rows) {
    console.warn(`⚠ expected ${opts.rows} rows, found ${rowsFound}`);
    warnings++;
  }
  if (opts.cols) {
    const perRow = {};
    for (const c of cells) perRow[c.row] = (perRow[c.row] || 0) + 1;
    for (const [r, n] of Object.entries(perRow)) {
      if (n !== opts.cols && Number(r) < rowsFound - 1) {
        console.warn(`⚠ row ${r} has ${n} icons, expected ${opts.cols}`);
        warnings++;
      }
    }
  }
  if (names && names.length !== cells.length) {
    console.warn(`⚠ ${names.length} names given but ${cells.length} icons detected — extras will be auto-named`);
    warnings++;
  }
  if (!cells.length) {
    console.error('✗ No icons detected. Try --mode contrast or lower --dist/--sat.');
    process.exit(2);
  }

  if (opts.dryRun) {
    console.log('(dry run — nothing written)');
    if (opts.debug) {
      fs.mkdirSync(outDir, { recursive: true });
      await writeDebug(opts.input, cells, mask, width, height, outDir);
      console.log(`Debug    : ${outDir}/_debug-overlay.png`);
    }
    process.exit(warnings ? 0 : 0);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const manifest = [];
  let idx = 0;
  for (const cell of cells) {
    const slug = (names && names[idx]) || `r${cell.row}-c${cell.col}`;
    const png = await renderCell(keyed, width, height, cell, opts);
    const file = `${slug}.png`;
    await fs.promises.writeFile(path.join(outDir, file), png);
    manifest.push({ slug, file, row: cell.row, col: cell.col, box: { left: cell.left, top: cell.top, right: cell.right, bottom: cell.bottom } });
    idx++;
  }

  await fs.promises.writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({ source: path.basename(opts.input), size: opts.size, background: bg, mode: opts.mode, icons: manifest }, null, 2),
  );

  if (opts.debug) await writeDebug(opts.input, cells, mask, width, height, outDir);

  console.log(`✓ Wrote ${manifest.length} icons → ${outDir}`);
  console.log(`  manifest.json${opts.debug ? '  _debug-overlay.png  _debug-mask.png' : ''}`);
}

main().catch(err => {
  console.error(err.stack || String(err));
  process.exit(1);
});
