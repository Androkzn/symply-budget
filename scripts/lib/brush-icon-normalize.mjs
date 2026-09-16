import sharp from 'sharp';
import { inkPixel, headerInkPixel } from './brush-brand-ink.mjs';

export const OUT_SIZE = 96;
export const CANVAS_PAD = 6;
export const MIN_EDGE = 4;

/** @type {Record<string, { x: number, y: number }>} */
export const MANUAL_NUDGE = {};

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

function keepMajorInkBlobs(data, width, height) {
  const out = Buffer.alloc(data.length);
  const minX = 3;
  const visited = new Uint8Array(width * height);
  /** @type {Array<{ size: number, pixels: Array<[number, number]> }>} */
  const blobs = [];

  const isInk = (x, y) => data[(y * width + x) * 4 + 3] > 20;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || !isInk(x, y)) continue;
      const queue = [[x, y]];
      visited[idx] = 1;
      let size = 0;
      const pixels = [];

      while (queue.length) {
        const [cx, cy] = queue.pop();
        size++;
        pixels.push([cx, cy]);
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ]) {
          if (nx < minX || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx] || !isInk(nx, ny)) continue;
          visited[nIdx] = 1;
          queue.push([nx, ny]);
        }
      }
      blobs.push({ size, pixels });
    }
  }

  if (!blobs.length) return out;
  blobs.sort((a, b) => b.size - a.size);
  const largest = blobs[0].size;
  const minKeep = Math.max(96, Math.floor(largest * 0.18));

  for (const blob of blobs) {
    if (blob.size < minKeep) continue;
    for (const [x, y] of blob.pixels) {
      const o = (y * width + x) * 4;
      out[o] = data[o];
      out[o + 1] = data[o + 1];
      out[o + 2] = data[o + 2];
      out[o + 3] = data[o + 3];
    }
  }
  return out;
}

export function stripSolidMass(data, width, height, minDist = 3) {
  const out = Buffer.from(data);
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    ink[i] = data[i * 4 + 3] > 20 ? 1 : 0;
  }
  const dist = new Int16Array(width * height).fill(9999);
  const queue = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!ink[idx]) {
        dist[idx] = 0;
        queue.push(idx);
      }
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const idx = queue[qi];
    const d = dist[idx];
    const x = idx % width;
    const y = (idx / width) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nidx = ny * width + nx;
      if (!ink[nidx] || dist[nidx] <= d + 1) continue;
      dist[nidx] = d + 1;
      queue.push(nidx);
    }
  }
  for (let i = 0; i < width * height; i++) {
    if (ink[i] && dist[i] >= minDist) {
      out[i * 4 + 3] = 0;
    }
  }
  return out;
}

export { stripToBrandInk, stripToRedInk } from './brush-brand-ink.mjs';

export async function normalizeCellBuffer(inputBuf, slug) {
  const { data, info } = await sharp(inputBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let isolated = keepMajorInkBlobs(data, width, height);
  isolated = stripSolidMass(isolated, width, height, 3);
  const out = Buffer.from(isolated);

  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = isolated[o];
    const g = isolated[o + 1];
    const b = isolated[o + 2];
    if (isolated[o + 3] < 6) continue;
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

  let composed = await sharp({
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

  const { data: placed, info: placedInfo } = await measureInk(composed);
  let pMinX = placedInfo.width;
  let pMinY = placedInfo.height;
  let pMaxX = 0;
  let pMaxY = 0;
  for (let y = 0; y < placedInfo.height; y++) {
    for (let x = 0; x < placedInfo.width; x++) {
      if (placed[(y * placedInfo.width + x) * 4 + 3] <= 20) continue;
      pMinX = Math.min(pMinX, x);
      pMinY = Math.min(pMinY, y);
      pMaxX = Math.max(pMaxX, x);
      pMaxY = Math.max(pMaxY, y);
    }
  }
  const edge = Math.min(pMinX, pMinY, OUT_SIZE - 1 - pMaxX, OUT_SIZE - 1 - pMaxY);
  if (edge < MIN_EDGE && pMaxX > pMinX) {
    const dx =
      pMinX < MIN_EDGE
        ? MIN_EDGE - pMinX
        : pMaxX > OUT_SIZE - 1 - MIN_EDGE
          ? OUT_SIZE - 1 - MIN_EDGE - pMaxX
          : 0;
    const dy =
      pMinY < MIN_EDGE
        ? MIN_EDGE - pMinY
        : pMaxY > OUT_SIZE - 1 - MIN_EDGE
          ? OUT_SIZE - 1 - MIN_EDGE - pMaxY
          : 0;
    if (dx || dy) {
      composed = await sharp(composed)
        .extend({
          top: Math.max(0, dy),
          bottom: Math.max(0, -dy),
          left: Math.max(0, dx),
          right: Math.max(0, -dx),
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .extract({ left: 0, top: 0, width: OUT_SIZE, height: OUT_SIZE })
        .png()
        .toBuffer();
    }
  }

  return finalizePng(composed);
}

export async function finalizePng(inputBuf, opts = {}) {
  const preserveLightInk = opts.preserveLightInk === true;
  const { data, info } = await sharp(inputBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < info.width * info.height; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const a = data[o + 3];
    if (a < 20) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      continue;
    }
    if (!preserveLightInk) {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max - min;
      const lum = (r + g + b) / 3;
      if (sat < 40 && lum > 210) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
        continue;
      }
      if (sat < 28 && lum > 190) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
        continue;
      }
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

function rowInkProfile(data, width, height, brand) {
  const ink = new Array(height).fill(0);
  const caption = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (inkPixel(data, o, brand)) ink[y]++;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max - min;
      const lum = (r + g + b) / 3;
      if (sat < 42 && lum > 28 && lum < 165) caption[y]++;
    }
  }
  return { ink, caption };
}

export function findIconCropHeight(data, width, height, brand = 'health') {
  const { ink, caption } = rowInkProfile(data, width, height, brand);
  const rowTotal = ink.map((n, i) => n + caption[i]);
  const minIconH = Math.floor(height * 0.48);
  const defaultCrop = Math.floor(height * 0.78);

  let bandTop = height;
  const captionZone = Math.floor(height * 0.65);
  const captionCutoff = width * 0.012;
  let captionBandTop = height;
  for (let y = height - 1; y >= captionZone; y--) {
    if (caption[y] >= captionCutoff) captionBandTop = y;
    else if (captionBandTop < height) break;
  }
  if (captionBandTop < height) {
    let quietAbove = 0;
    for (let y = captionBandTop - 1; y >= Math.max(captionZone, captionBandTop - 24); y--) {
      if (rowTotal[y] < width * 0.05) quietAbove++;
      else break;
    }
    if (quietAbove >= 3) bandTop = Math.min(bandTop, captionBandTop);
  }

  const labelZone = Math.floor(height * 0.76);
  const labelCutoff = width * 0.35;
  let labelBandTop = height;
  for (let y = height - 1; y >= labelZone; y--) {
    if (ink[y] >= labelCutoff) labelBandTop = y;
    else if (labelBandTop < height) break;
  }
  if (labelBandTop < height) {
    let quietAbove = 0;
    for (let y = labelBandTop - 1; y >= Math.max(labelZone, labelBandTop - 24); y--) {
      if (ink[y] < width * 0.08) quietAbove++;
      else break;
    }
    if (quietAbove >= 3) bandTop = Math.min(bandTop, labelBandTop);
  }

  if (bandTop >= height) return defaultCrop;
  return Math.max(minIconH, bandTop - 2);
}

export function detectHeaderPx(inputBuf, brand = 'health', fallback = 80) {
  return sharp(inputBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      const { width, height } = info;
      const scanH = Math.min(height, Math.floor(height * 0.3));
      for (let y = 0; y < scanH; y++) {
        let colsWithInk = 0;
        for (let q = 0; q < 4; q++) {
          const x0 = Math.floor((width * q) / 4);
          const x1 = Math.floor((width * (q + 1)) / 4);
          let count = 0;
          for (let x = x0; x < x1; x++) {
            if (headerInkPixel(data, (y * width + x) * 4, brand)) count++;
          }
          if (count >= (x1 - x0) * 0.025) colsWithInk++;
        }
        if (colsWithInk >= 3) return Math.max(48, y - 2);
      }
      return fallback;
    });
}

export async function detectSheetIconBoxes(input, slugs, rowCounts, brand = 'health') {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const headerPx = await detectHeaderPx(input, brand);
  const visited = new Uint8Array(width * height);
  /** @type {Array<{ minX: number, minY: number, maxX: number, maxY: number, size: number }>} */
  const parts = [];

  const isInk = (x, y) => inkPixel(data, (y * width + x) * 4, brand);

  for (let y = headerPx; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || !isInk(x, y)) continue;
      const queue = [[x, y]];
      visited[idx] = 1;
      let size = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      while (queue.length) {
        const [cx, cy] = queue.pop();
        size++;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ]) {
          if (nx < 0 || nx >= width || ny < headerPx || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx] || !isInk(nx, ny)) continue;
          visited[nIdx] = 1;
          queue.push([nx, ny]);
        }
      }

      if (size < 120) continue;
      parts.push({ minX, minY, maxX, maxY, size });
    }
  }

  const rowBands = rowCounts.length;
  const rowThreshold = (height - headerPx) / rowBands;
  /** @type {Array<Array<{ minX: number, minY: number, maxX: number, maxY: number, size: number }>>} */
  const rows = Array.from({ length: rowBands }, () => []);
  for (const part of parts) {
    const cy = (part.minY + part.maxY) / 2;
    const row = Math.min(rowBands - 1, Math.floor((cy - headerPx) / rowThreshold));
    rows[row].push(part);
  }

  const merged = [];
  for (const row of rows) {
    row.sort((a, b) => a.minX - b.minX);
    let group = null;
    for (const part of row) {
      if (!group || part.minX - group.maxX > 72) {
        if (group) merged.push(group);
        group = { ...part };
      } else {
        group.minX = Math.min(group.minX, part.minX);
        group.minY = Math.min(group.minY, part.minY);
        group.maxX = Math.max(group.maxX, part.maxX);
        group.maxY = Math.max(group.maxY, part.maxY);
        group.size += part.size;
      }
    }
    if (group) merged.push(group);
  }

  merged.sort((a, b) => a.minY - b.minY || a.minX - b.minX);

  if (merged.length !== slugs.length) {
    throw new Error(`Expected ${slugs.length} icon regions, found ${merged.length}`);
  }

  return merged.map((box, i) => {
    const pad = 14;
    return {
      slug: slugs[i],
      left: Math.max(0, box.minX - pad),
      top: Math.max(headerPx, box.minY - pad),
      width: Math.min(width - Math.max(0, box.minX - pad), box.maxX - box.minX + 1 + pad * 2),
      height: Math.min(height - Math.max(headerPx, box.minY - pad), box.maxY - box.minY + 1 + pad * 2),
    };
  });
}

export async function extractBoxBuffer(input, box, brand = 'health') {
  const full = await sharp(input)
    .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const iconH = findIconCropHeight(full.data, box.width, box.height, brand);
  return sharp(full.data, { raw: { width: box.width, height: box.height, channels: 4 } })
    .extract({ left: 0, top: 0, width: box.width, height: iconH })
    .png()
    .toBuffer();
}

export async function extractCellBuffer(input, col, row, cols, rows, opts = {}) {
  const brand = opts.brand ?? 'health';
  const headerPx = opts.headerPx ?? (await detectHeaderPx(input, brand));
  const rowSpan = opts.rowSpan ?? 1;
  const colSpan = opts.colSpan ?? 1;

  const meta = await sharp(input).metadata();
  const w = meta.width ?? 1024;
  const h = meta.height ?? 1024;
  const cellW = Math.floor(w / cols);
  const iconAreaH = h - headerPx;
  const cellH = Math.floor(iconAreaH / rows);
  const insetX = opts.insetX ?? Math.max(6, Math.floor(cellW * 0.035));
  const spanW = cellW * colSpan;
  const spanH = cellH * rowSpan;
  const leftInset = col > 0 ? Math.floor(insetX * 0.45) : 0;
  const rightInset = col + colSpan < cols ? Math.floor(insetX * 0.45) : 0;
  const left = col * cellW + leftInset;
  const top = headerPx + row * cellH;
  const width = spanW - leftInset - rightInset;
  const height = spanH;

  const full = await sharp(input)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const iconH = findIconCropHeight(full.data, width, height, brand);
  return sharp(full.data, { raw: { width, height, channels: 4 } })
    .extract({ left: 0, top: 0, width, height: iconH })
    .png()
    .toBuffer();
}

export async function countVisibleInk(inputBuf) {
  const { data, info } = await sharp(inputBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    if (data[i * 4 + 3] > 20) n++;
  }
  return n;
}

export async function cropCell(input, col, row, cols, rows, slug, opts = {}) {
  const raw = await extractCellBuffer(input, col, row, cols, rows, opts);
  return normalizeCellBuffer(raw, slug);
}
