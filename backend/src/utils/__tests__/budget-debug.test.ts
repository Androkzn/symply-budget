/**
 * budget-debug.ts — verbose budget/AI e2e debug logging + asset-quality
 * diagnostics. Pure logic (no D1/network), so these are fast unit tests.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  analyzeAssetQuality,
  budgetDebug,
  detectMimeFromBytes,
  isBudgetDebugEnabled,
  newTraceId,
  sniffImageDimensions,
} from '../budget-debug';

// ---------- byte fixtures ----------

function pngBuffer(width: number, height: number, totalBytes = 24): ArrayBuffer {
  const buf = new ArrayBuffer(Math.max(24, totalBytes));
  const v = new DataView(buf);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((b, i) => v.setUint8(i, b));
  v.setUint32(8, 13); // IHDR length
  [0x49, 0x48, 0x44, 0x52].forEach((b, i) => v.setUint8(12 + i, b)); // "IHDR"
  v.setUint32(16, width);
  v.setUint32(20, height);
  return buf;
}

function jpegBuffer(width: number, height: number, totalBytes = 20): ArrayBuffer {
  const buf = new ArrayBuffer(Math.max(20, totalBytes));
  const v = new DataView(buf);
  v.setUint8(0, 0xff);
  v.setUint8(1, 0xd8); // SOI
  v.setUint8(2, 0xff);
  v.setUint8(3, 0xc0); // SOF0
  v.setUint16(4, 17); // segment length
  v.setUint8(6, 8); // precision
  v.setUint16(7, height);
  v.setUint16(9, width);
  return buf;
}

function webpBuffer(width: number, height: number): ArrayBuffer {
  const buf = new ArrayBuffer(32);
  const v = new DataView(buf);
  [0x52, 0x49, 0x46, 0x46].forEach((b, i) => v.setUint8(i, b)); // RIFF
  v.setUint32(4, 26, true);
  [0x57, 0x45, 0x42, 0x50].forEach((b, i) => v.setUint8(8 + i, b)); // WEBP
  [0x56, 0x50, 0x38, 0x58].forEach((b, i) => v.setUint8(12 + i, b)); // VP8X
  const w = width - 1;
  const h = height - 1;
  v.setUint8(24, w & 0xff);
  v.setUint8(25, (w >> 8) & 0xff);
  v.setUint8(26, (w >> 16) & 0xff);
  v.setUint8(27, h & 0xff);
  v.setUint8(28, (h >> 8) & 0xff);
  v.setUint8(29, (h >> 16) & 0xff);
  return buf;
}

function pdfBuffer(totalBytes = 64): ArrayBuffer {
  const buf = new ArrayBuffer(Math.max(4, totalBytes));
  const v = new DataView(buf);
  [0x25, 0x50, 0x44, 0x46].forEach((b, i) => v.setUint8(i, b)); // %PDF
  return buf;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isBudgetDebugEnabled', () => {
  it('is on for non-production environments', () => {
    expect(isBudgetDebugEnabled({ ENVIRONMENT: 'staging' })).toBe(true);
    expect(isBudgetDebugEnabled({ ENVIRONMENT: 'development' })).toBe(true);
    expect(isBudgetDebugEnabled({})).toBe(true);
  });

  it('is off for production by default', () => {
    expect(isBudgetDebugEnabled({ ENVIRONMENT: 'production' })).toBe(false);
    expect(isBudgetDebugEnabled({ ENVIRONMENT: 'Production' })).toBe(false);
  });

  it('respects the explicit override flag both ways', () => {
    expect(isBudgetDebugEnabled({ ENVIRONMENT: 'production', BUDGET_DEBUG_LOGS: 'true' })).toBe(true);
    expect(isBudgetDebugEnabled({ ENVIRONMENT: 'staging', BUDGET_DEBUG_LOGS: 'false' })).toBe(false);
  });
});

describe('newTraceId', () => {
  it('returns a short non-empty id', () => {
    const id = newTraceId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(id.length).toBeLessThanOrEqual(8);
  });
});

describe('budgetDebug', () => {
  it('logs a grep-prefixed JSON line when enabled', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    budgetDebug({ ENVIRONMENT: 'staging' }, 'scan', { trace: 'abc', foo: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).toContain('[BUDGET-E2E][scan]');
    expect(line).toContain('"trace":"abc"');
    expect(line).toContain('"foo":1');
  });

  it('is silent when disabled', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    budgetDebug({ ENVIRONMENT: 'production' }, 'scan', { foo: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('truncates very long strings', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    budgetDebug({ ENVIRONMENT: 'staging' }, 'scan', { blob: 'x'.repeat(3000) });
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).toContain('…(+1000 chars)');
    expect(line.length).toBeLessThan(3000);
  });

  it('never throws on unserializable payloads', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => budgetDebug({ ENVIRONMENT: 'staging' }, 'scan', circular)).not.toThrow();
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).toContain('<unserializable>');
  });
});

describe('detectMimeFromBytes', () => {
  it('detects each supported type from magic bytes', () => {
    expect(detectMimeFromBytes(jpegBuffer(10, 10))).toBe('image/jpeg');
    expect(detectMimeFromBytes(pngBuffer(10, 10))).toBe('image/png');
    expect(detectMimeFromBytes(pdfBuffer())).toBe('application/pdf');
    expect(detectMimeFromBytes(webpBuffer(10, 10))).toBe('image/webp');
  });

  it('returns null for unknown or too-short buffers', () => {
    expect(detectMimeFromBytes(new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer)).toBeNull();
    expect(detectMimeFromBytes(new Uint8Array([0x00]).buffer)).toBeNull();
  });
});

describe('sniffImageDimensions', () => {
  it('reads PNG dimensions', () => {
    expect(sniffImageDimensions(pngBuffer(1234, 5678), 'image/png')).toEqual({
      width: 1234,
      height: 5678,
    });
  });

  it('reads JPEG dimensions from the SOF marker', () => {
    expect(sniffImageDimensions(jpegBuffer(640, 480), 'image/jpeg')).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('reads WebP (VP8X) dimensions', () => {
    expect(sniffImageDimensions(webpBuffer(300, 200), 'image/webp')).toEqual({
      width: 300,
      height: 200,
    });
  });

  it('returns null for unsupported/short data', () => {
    expect(sniffImageDimensions(new ArrayBuffer(4), 'image/png')).toBeNull();
    expect(sniffImageDimensions(pdfBuffer(), 'application/pdf')).toBeNull();
  });
});

describe('analyzeAssetQuality', () => {
  it('rates a large, high-resolution JPEG as ok with no warnings', () => {
    const q = analyzeAssetQuality(jpegBuffer(1200, 1600, 200 * 1024), 'image/jpeg');
    expect(q.detectedMime).toBe('image/jpeg');
    expect(q.mimeMismatch).toBe(false);
    expect(q.width).toBe(1200);
    expect(q.height).toBe(1600);
    expect(q.megapixels).toBeCloseTo(1.92, 2);
    expect(q.verdict).toBe('ok');
    expect(q.warnings).toHaveLength(0);
  });

  it('flags a declared/detected mime mismatch', () => {
    const q = analyzeAssetQuality(jpegBuffer(1200, 1600, 200 * 1024), 'image/png');
    expect(q.detectedMime).toBe('image/jpeg');
    expect(q.mimeMismatch).toBe(true);
    expect(q.warnings.join(' ')).toContain('bytes are "image/jpeg"');
  });

  it('flags low-resolution and narrow images as low quality', () => {
    const q = analyzeAssetQuality(pngBuffer(400, 400, 200 * 1024), 'image/png');
    expect(q.megapixels).toBeCloseTo(0.16, 2);
    expect(q.verdict).toBe('low');
    expect(q.warnings.join(' ')).toContain('low resolution');
    expect(q.warnings.join(' ')).toContain('narrow image');
  });

  it('flags tiny files as low quality', () => {
    const q = analyzeAssetQuality(jpegBuffer(1200, 1600, 1000), 'image/jpeg');
    expect(q.byteLength).toBe(1000);
    expect(q.verdict).toBe('low');
    expect(q.warnings.join(' ')).toContain('< 25KB');
  });

  it('treats a healthy PDF as ok with no dimensions', () => {
    const q = analyzeAssetQuality(pdfBuffer(30 * 1024), 'application/pdf');
    expect(q.detectedMime).toBe('application/pdf');
    expect(q.width).toBeNull();
    expect(q.height).toBeNull();
    expect(q.megapixels).toBeNull();
    expect(q.verdict).toBe('ok');
  });

  it('returns an unknown verdict for unrecognized bytes', () => {
    const q = analyzeAssetQuality(new ArrayBuffer(40 * 1024), 'image/jpeg');
    expect(q.detectedMime).toBeNull();
    expect(q.verdict).toBe('unknown');
  });
});
