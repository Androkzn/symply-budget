import UPNG from 'upng-js';
import { describe, it, expect } from 'vitest';

import {
  normalizeBoundingBox,
  cropImageByBoundingBox,
  isRasterContentType,
} from '../floor-plan-crop';

function makeSolidPng(width: number, height: number, rgba: [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    data[o] = rgba[0];
    data[o + 1] = rgba[1];
    data[o + 2] = rgba[2];
    data[o + 3] = rgba[3];
  }
  return new Uint8Array(UPNG.encode([new Uint8Array(data).buffer], width, height, 0));
}

describe('floor-plan-crop', () => {
  describe('normalizeBoundingBox', () => {
    it('pads and clamps a valid box', () => {
      const box = normalizeBoundingBox({ x1: 0.2, y1: 0.2, x2: 0.5, y2: 0.6 });
      expect(box).not.toBeNull();
      expect(box!.x1).toBeLessThan(0.2);
      expect(box!.y1).toBeLessThan(0.2);
      expect(box!.x2).toBeGreaterThan(0.5);
      expect(box!.y2).toBeGreaterThan(0.6);
      expect(box!.x1).toBeGreaterThanOrEqual(0);
      expect(box!.y2).toBeLessThanOrEqual(1);
    });

    it('swaps inverted coordinates', () => {
      const box = normalizeBoundingBox({ x1: 0.8, y1: 0.7, x2: 0.3, y2: 0.2 });
      expect(box).not.toBeNull();
      expect(box!.x1).toBeLessThan(box!.x2);
      expect(box!.y1).toBeLessThan(box!.y2);
    });

    it('rejects tiny boxes', () => {
      expect(normalizeBoundingBox({ x1: 0.5, y1: 0.5, x2: 0.505, y2: 0.505 })).toBeNull();
    });

    it('rejects non-finite values', () => {
      expect(normalizeBoundingBox({ x1: NaN, y1: 0, x2: 1, y2: 1 })).toBeNull();
    });
  });

  describe('isRasterContentType', () => {
    it('accepts png and jpeg', () => {
      expect(isRasterContentType('image/png')).toBe(true);
      expect(isRasterContentType('image/jpeg')).toBe(true);
      expect(isRasterContentType('image/jpg')).toBe(true);
    });

    it('rejects pdf', () => {
      expect(isRasterContentType('application/pdf')).toBe(false);
    });
  });

  describe('cropImageByBoundingBox', () => {
    it('crops a PNG to the padded bounding box', () => {
      const pngBytes = makeSolidPng(100, 100, [255, 0, 0, 255]);
      const result = cropImageByBoundingBox({
        imageBytes: pngBytes,
        contentType: 'image/png',
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 },
        padding: 0,
      });

      expect(result.width).toBe(40);
      expect(result.height).toBe(40);
      expect(result.pngBytes.byteLength).toBeGreaterThan(0);

      const decoded = UPNG.decode(new Uint8Array(result.pngBytes).buffer);
      expect(decoded.width).toBe(40);
      expect(decoded.height).toBe(40);
    });

    it('throws on invalid bounding box', () => {
      const pngBytes = makeSolidPng(20, 20, [0, 0, 255, 255]);
      expect(() =>
        cropImageByBoundingBox({
          imageBytes: pngBytes,
          contentType: 'image/png',
          boundingBox: { x1: 0.5, y1: 0.5, x2: 0.51, y2: 0.51 },
        })
      ).toThrow(/Invalid or too-small/);
    });
  });
});
