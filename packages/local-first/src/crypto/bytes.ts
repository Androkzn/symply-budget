/**
 * CSPRNG bytes without going through `@noble/hashes/utils.randomBytes`, which
 * throws hard when `crypto.getRandomValues` is missing (common on Hermes
 * before the app installs a polyfill).
 */
export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`randomBytes: invalid length ${length}`);
  }
  const out = new Uint8Array(length);
  if (length === 0) return out;

  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(out);
    return out;
  }

  try {
    // Node / vitest — avoid a static import so RN Metro never pulls `node:crypto`.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto') as typeof import('crypto');
    if (typeof nodeCrypto.randomFillSync === 'function') {
      nodeCrypto.randomFillSync(out);
      return out;
    }
  } catch {
    // React Native — the consuming brand must install getRandomValues before
    // this module loads (`ensureBudgetLocalCrypto` / `ensureHouseLocalCrypto`).
  }

  throw new Error(
    'randomBytes: crypto.getRandomValues is not defined (install react-native-get-random-values / expo-crypto polyfill)',
  );
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** '00'..'ff' — one lookup and one concat per byte instead of two of each. */
const HEX_BYTE: string[] = new Array(256);
for (let i = 0; i < 256; i += 1) {
  HEX_BYTE[i] = i.toString(16).padStart(2, '0');
}

/**
 * Bytes per chunk when building a hex string.
 *
 * Repeated `out += …` over a multi-megabyte buffer is the single most expensive
 * operation in the app: measured 3,442 ms for 17.5 MB and 24,377 ms at 35 MB on
 * V8 — slower than the AES-GCM that produced the bytes — with heap churn around
 * 56x the input, which is what pushed large ledgers into OOM. Building bounded
 * chunks and joining once keeps the rope shallow: ~2.8x faster at 32 MiB and
 * ~40% less garbage. Hermes has no optimizing JIT, so the win is larger there.
 */
const HEX_CHUNK_BYTES = 8192;

export function bytesToHex(bytes: Uint8Array): string {
  const len = bytes.length;
  if (len === 0) return '';

  if (len <= HEX_CHUNK_BYTES) {
    let out = '';
    for (let i = 0; i < len; i += 1) out += HEX_BYTE[bytes[i]!];
    return out;
  }

  const chunks: string[] = [];
  for (let start = 0; start < len; start += HEX_CHUNK_BYTES) {
    const end = Math.min(start + HEX_CHUNK_BYTES, len);
    let chunk = '';
    for (let i = start; i < end; i += 1) chunk += HEX_BYTE[bytes[i]!];
    chunks.push(chunk);
  }
  return chunks.join('');
}

/** Nibble value per char code; -1 for anything that is not a hex digit. */
const HEX_VAL = new Int8Array(128).fill(-1);
for (let i = 0; i < 10; i += 1) HEX_VAL[0x30 + i] = i; // '0'-'9'
for (let i = 0; i < 6; i += 1) {
  HEX_VAL[0x61 + i] = 10 + i; // 'a'-'f'
  HEX_VAL[0x41 + i] = 10 + i; // 'A'-'F'
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('hexToBytes: odd length');
  }
  const out = new Uint8Array(hex.length / 2);
  // charCodeAt + table, not parseInt(slice(..)): the old form allocated a
  // two-character string per byte, and this runs over the whole snapshot on
  // every cold open (measured 1.8 s at 5-year scale).
  for (let i = 0; i < out.length; i += 1) {
    const hi = HEX_VAL[hex.charCodeAt(i * 2)] ?? -1;
    const lo = HEX_VAL[hex.charCodeAt(i * 2 + 1)] ?? -1;
    if (hi < 0 || lo < 0) {
      throw new Error('hexToBytes: invalid hex');
    }
    out[i] = (hi << 4) | lo;
  }
  return out;
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Zeroize a mutable buffer (best-effort). */
export function zeroize(bytes: Uint8Array): void {
  bytes.fill(0);
}
