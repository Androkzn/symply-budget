/**
 * Media-type sniffing — the deterministic guard that stops a lying file
 * extension (`.png` holding JPEG bytes, etc.) from reaching Anthropic and
 * triggering a 400 that surfaced as a generic "couldn't read" failure.
 */
import { describe, it, expect } from 'vitest';

import {
  detectMediaTypeFromBytes,
  detectMediaTypeFromBase64,
  resolveMediaType,
} from '../media-type';

const toBase64 = (bytes: number[]): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0, 0, 0, 0, 0, 0, 0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
// "RIFF" + 4 size bytes + "WEBP"
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0, 0, 0];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

describe('detectMediaTypeFromBytes', () => {
  it('recognizes JPEG / PNG / PDF / WEBP magic bytes', () => {
    expect(detectMediaTypeFromBytes(new Uint8Array(JPEG))).toBe('image/jpeg');
    expect(detectMediaTypeFromBytes(new Uint8Array(PNG))).toBe('image/png');
    expect(detectMediaTypeFromBytes(new Uint8Array(PDF))).toBe('application/pdf');
    expect(detectMediaTypeFromBytes(new Uint8Array(WEBP))).toBe('image/webp');
  });

  it('returns null for unsupported/unknown bytes (e.g. GIF)', () => {
    expect(detectMediaTypeFromBytes(new Uint8Array(GIF))).toBeNull();
    expect(detectMediaTypeFromBytes(new Uint8Array([0, 1, 2, 3]))).toBeNull();
    expect(detectMediaTypeFromBytes(new Uint8Array([]))).toBeNull();
  });
});

describe('detectMediaTypeFromBase64', () => {
  it('sniffs the type from a base64 prefix', () => {
    expect(detectMediaTypeFromBase64(toBase64(JPEG))).toBe('image/jpeg');
    expect(detectMediaTypeFromBase64(toBase64(WEBP))).toBe('image/webp');
  });

  it('is null-safe for empty / garbage input', () => {
    expect(detectMediaTypeFromBase64('')).toBeNull();
    expect(detectMediaTypeFromBase64('!!!not base64!!!')).toBeNull();
  });
});

describe('resolveMediaType', () => {
  it('OVERRIDES a wrong declared type with the sniffed truth (the bug)', () => {
    // A ".png" file that actually holds JPEG bytes — Anthropic would 400 on the
    // declared image/png; we send image/jpeg instead.
    expect(resolveMediaType(toBase64(JPEG), 'image/png')).toBe('image/jpeg');
  });

  it('keeps the declared type when the bytes are unrecognizable', () => {
    expect(resolveMediaType(toBase64(GIF), 'image/jpeg')).toBe('image/jpeg');
    expect(resolveMediaType('', 'application/pdf')).toBe('application/pdf');
  });

  it('is a no-op when declared already matches the bytes', () => {
    expect(resolveMediaType(toBase64(PDF), 'application/pdf')).toBe('application/pdf');
    expect(resolveMediaType(toBase64(PNG), 'image/png')).toBe('image/png');
  });
});
