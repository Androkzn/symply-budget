/**
 * Pure-JS image crop helpers for Cloudflare Workers.
 * Uses upng-js + jpeg-js (no Node Stream dependency).
 * Supports PNG and JPEG → PNG crop. PDF must be rasterized first.
 */

import jpeg from 'jpeg-js';
import UPNG from 'upng-js';

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CropResult {
  pngBytes: Uint8Array;
  width: number;
  height: number;
  usedBox: BoundingBox;
}

const MIN_BOX_SIZE = 0.02;
const DEFAULT_PADDING = 0.04;

/** UPNG expects ArrayBuffer; Uint8Array may view a SharedArrayBuffer. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    const { buffer } = bytes;
    if (buffer instanceof ArrayBuffer) return buffer;
  }
  return new Uint8Array(bytes).buffer;
}

/**
 * Clamp and pad a normalized bounding box.
 * Returns null if the box is invalid or too small after clamping.
 */
export function normalizeBoundingBox(
  box: BoundingBox,
  padding: number = DEFAULT_PADDING
): BoundingBox | null {
  let { x1, y1, x2, y2 } = box;

  if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) return null;

  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];

  // Reject tiny boxes before padding expands them
  if (x2 - x1 < MIN_BOX_SIZE || y2 - y1 < MIN_BOX_SIZE) return null;

  const padX = (x2 - x1) * padding + padding * 0.25;
  const padY = (y2 - y1) * padding + padding * 0.25;

  x1 = Math.max(0, x1 - padX);
  y1 = Math.max(0, y1 - padY);
  x2 = Math.min(1, x2 + padX);
  y2 = Math.min(1, y2 + padY);

  return { x1, y1, x2, y2 };
}

function decodeToRgba(
  bytes: Uint8Array,
  contentType: string
): { data: Uint8Array; width: number; height: number } {
  if (contentType === 'image/png' || contentType.includes('png')) {
    const img = UPNG.decode(toArrayBuffer(bytes));
    const rgba = UPNG.toRGBA8(img)[0];
    return {
      data: new Uint8Array(rgba),
      width: img.width,
      height: img.height,
    };
  }

  if (contentType === 'image/jpeg' || contentType === 'image/jpg' || contentType.includes('jpeg')) {
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    return {
      data: new Uint8Array(decoded.data),
      width: decoded.width,
      height: decoded.height,
    };
  }

  throw new Error(`Unsupported image type for crop: ${contentType}`);
}

function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  // UPNG.encode expects ArrayBuffer[] of RGBA frames
  const encoded = UPNG.encode([toArrayBuffer(rgba)], width, height, 0);
  return new Uint8Array(encoded);
}

/**
 * Crop a raster image by a normalized bounding box (with padding).
 */
export function cropImageByBoundingBox(params: {
  imageBytes: Uint8Array;
  contentType: string;
  boundingBox: BoundingBox;
  padding?: number;
}): CropResult {
  const usedBox = normalizeBoundingBox(params.boundingBox, params.padding ?? DEFAULT_PADDING);
  if (!usedBox) {
    throw new Error('Invalid or too-small bounding box for crop');
  }

  const { data, width, height } = decodeToRgba(params.imageBytes, params.contentType);

  const left = Math.max(0, Math.floor(usedBox.x1 * width));
  const top = Math.max(0, Math.floor(usedBox.y1 * height));
  const right = Math.min(width, Math.ceil(usedBox.x2 * width));
  const bottom = Math.min(height, Math.ceil(usedBox.y2 * height));

  const cropW = Math.max(1, right - left);
  const cropH = Math.max(1, bottom - top);
  const out = new Uint8Array(cropW * cropH * 4);

  for (let y = 0; y < cropH; y++) {
    const srcRow = ((top + y) * width + left) * 4;
    const dstRow = y * cropW * 4;
    out.set(data.subarray(srcRow, srcRow + cropW * 4), dstRow);
  }

  return {
    pngBytes: encodePng(out, cropW, cropH),
    width: cropW,
    height: cropH,
    usedBox,
  };
}

export function isRasterContentType(contentType: string): boolean {
  return (
    contentType === 'image/png' ||
    contentType === 'image/jpeg' ||
    contentType === 'image/jpg' ||
    contentType.includes('png') ||
    contentType.includes('jpeg')
  );
}
