import sharp from 'sharp';

/** @typedef {'health' | 'house' | 'budget'} BrushBrand */

/** @param {BrushBrand} brand */
export function inkPixel(data, o, brand) {
  const r = data[o];
  const g = data[o + 1];
  const b = data[o + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max - min;
  const lum = (r + g + b) / 3;
  if (sat < 36 && lum > 198) return false;
  if (sat < 24 && lum > 175) return false;
  if (sat < 42 && lum < 165) return false;
  if (brand === 'health') return sat > 35 && r > 90 && lum < 220;
  if (brand === 'house') return sat > 18 && g > 95 && g >= r - 8 && b > 70 && lum < 245;
  if (brand === 'budget') return sat > 22 && g > 90 && g > r + 8 && lum < 230;
  return sat > 20 && max > 80 && lum < 240;
}

/** @param {BrushBrand} brand */
export async function stripToBrandInk(inputBuf, brand) {
  const { data, info } = await sharp(inputBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < info.width * info.height; i++) {
    const o = i * 4;
    const a = data[o + 3];
    if (a < 6) continue;
    if (!inkPixel(data, o, brand)) continue;
    out[o] = data[o];
    out[o + 1] = data[o + 1];
    out[o + 2] = data[o + 2];
    out[o + 3] = a;
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

/** Back-compat alias */
export const stripToRedInk = (buf) => stripToBrandInk(buf, 'health');

/** @param {BrushBrand} brand */
export function headerInkPixel(data, o, brand) {
  return inkPixel(data, o, brand);
}
