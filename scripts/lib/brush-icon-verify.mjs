import sharp from 'sharp';

/** Icons that are intentionally short (e.g. ellipsis row). */
export const THIN_ICON_SLUGS = new Set(['more', 'search']);

/** Wide horizontal glyphs (footsteps path). */
export const WIDE_ICON_SLUGS = new Set(['steps']);

export const LIMITS = {
  minPixels: 380,
  minThinPixels: 120,
  minWidePixels: 250,
  minFilledPixels: 300,
  minBBox: 28,
  minThinBBox: 14,
  minWideBBoxH: 14,
  minMeanAlpha: 0.18,
  maxCoverage: 0.82,
  maxMeanAlphaSelected: 0.86,
  maxMeanAlphaFilled: 0.92,
  maxBbox: 85,
  minEdgeMargin: 3,
};

/** @param {Buffer} buf */
export async function measureIcon(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let pixels = 0;
  let alphaSum = 0;
  let premulGhost = 0;
  let cornerBleed = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const a = data[o + 3];
      if (a <= 20) {
        if (r > 8 || g > 8 || b > 8) premulGhost++;
        continue;
      }
      pixels++;
      alphaSum += a;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const corner =
        (x < 4 && y < 4) ||
        (x < 4 && y >= height - 4) ||
        (x >= width - 4 && y < 4) ||
        (x >= width - 4 && y >= height - 4);
      if (corner) cornerBleed++;
    }
  }

  if (!pixels) {
    return {
      pixels: 0,
      coverage: 0,
      bboxW: 0,
      bboxH: 0,
      meanAlpha: 0,
      premulGhost,
      cornerBleed,
      edgeMargin: 0,
    };
  }

  const edgeMargin = Math.min(minX, minY, width - 1 - maxX, height - 1 - maxY);

  return {
    pixels,
    coverage: pixels / (width * height),
    bboxW: maxX - minX + 1,
    bboxH: maxY - minY + 1,
    meanAlpha: alphaSum / pixels / 255,
    premulGhost,
    cornerBleed,
    edgeMargin,
  };
}

/** @param {Awaited<ReturnType<typeof measureIcon>>} metrics */
export function verifyIconMetrics(metrics, slug, extra = {}) {
  const issues = [];
  const thin = THIN_ICON_SLUGS.has(slug);
  const wide = WIDE_ICON_SLUGS.has(slug);
  const state = extra.state ?? 'selected';
  const minPixels =
    state === 'filled-accent' || state.startsWith('unselected')
      ? LIMITS.minFilledPixels
      : thin
        ? LIMITS.minThinPixels
        : wide
          ? LIMITS.minWidePixels
          : LIMITS.minPixels;
  const minBBox = thin ? LIMITS.minThinBBox : LIMITS.minBBox;
  const minBBoxH = wide ? LIMITS.minWideBBoxH : minBBox;

  if (metrics.pixels < minPixels) issues.push(`lowPixels:${metrics.pixels}`);
  if (metrics.bboxW < minBBox || metrics.bboxH < minBBoxH) {
    issues.push(`smallBBox:${metrics.bboxW}x${metrics.bboxH}`);
  }
  if (metrics.bboxW > LIMITS.maxBbox || metrics.bboxH > LIMITS.maxBbox) {
    issues.push(`oversizeBBox:${metrics.bboxW}x${metrics.bboxH}`);
  }
  if (metrics.meanAlpha < LIMITS.minMeanAlpha) issues.push(`faint:${metrics.meanAlpha.toFixed(2)}`);
  if (metrics.coverage > LIMITS.maxCoverage) issues.push(`solidBlock:${metrics.coverage.toFixed(2)}`);

  if (state === 'selected' && metrics.meanAlpha > LIMITS.maxMeanAlphaSelected) {
    issues.push(`solidFill:${metrics.meanAlpha.toFixed(2)}`);
  }
  if (state === 'filled-accent' && metrics.meanAlpha > LIMITS.maxMeanAlphaFilled) {
    issues.push(`solidFill:${metrics.meanAlpha.toFixed(2)}`);
  }

  if (metrics.premulGhost > 12) issues.push(`premulGhost:${metrics.premulGhost}`);
  if (metrics.cornerBleed > 8) issues.push(`cornerBleed:${metrics.cornerBleed}`);
  if (metrics.edgeMargin < LIMITS.minEdgeMargin && !thin && !wide) {
    issues.push(`cropClip:margin=${metrics.edgeMargin}`);
  }

  return { ok: issues.length === 0, issues, metrics };
}

export async function verifyIconBuffer(buf, slug, extra = {}) {
  const metrics = await measureIcon(buf);
  return verifyIconMetrics(metrics, slug, extra);
}
