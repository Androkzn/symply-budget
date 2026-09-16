/**
 * Base64 for the sync wire format.
 *
 * Hex doubles every byte at rest and in transit. Base64 costs 1.33x, so the same
 * op batch fits ~1.5x more history under the server's per-blob cap, and the same
 * snapshot costs a third less to write. Kept dependency-free and
 * environment-agnostic: `btoa`/`atob` are not guaranteed under Hermes, and the
 * String.fromCharCode(...spread) idiom they are usually paired with blows the
 * call-stack argument limit on multi-megabyte buffers.
 *
 * Chunked for the same reason as bytesToHex: unbounded `out += …` over megabytes
 * is pathologically slow and allocates roughly 56x the input in garbage.
 */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Value per char code; -1 for anything outside the alphabet. */
const B64_VAL = new Int8Array(128).fill(-1);
for (let i = 0; i < B64_CHARS.length; i += 1) {
  B64_VAL[B64_CHARS.charCodeAt(i)] = i;
}

/** Multiple of 3 so no chunk ever splits a 3-byte group. */
const B64_CHUNK_BYTES = 8190;

function encodeChunk(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  let i = start;
  for (; i + 2 < end; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      B64_CHARS[(n >> 18) & 63]! +
      B64_CHARS[(n >> 12) & 63]! +
      B64_CHARS[(n >> 6) & 63]! +
      B64_CHARS[n & 63]!;
  }
  const remaining = end - i;
  if (remaining === 1) {
    const n = bytes[i]! << 16;
    out += B64_CHARS[(n >> 18) & 63]! + B64_CHARS[(n >> 12) & 63]! + '==';
  } else if (remaining === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out +=
      B64_CHARS[(n >> 18) & 63]! +
      B64_CHARS[(n >> 12) & 63]! +
      B64_CHARS[(n >> 6) & 63]! +
      '=';
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  if (len === 0) return '';
  if (len <= B64_CHUNK_BYTES) return encodeChunk(bytes, 0, len);

  const chunks: string[] = [];
  // Every chunk but the last is a whole number of 3-byte groups, so only the
  // final chunk ever emits padding.
  for (let start = 0; start < len; start += B64_CHUNK_BYTES) {
    chunks.push(encodeChunk(bytes, start, Math.min(start + B64_CHUNK_BYTES, len)));
  }
  return chunks.join('');
}

export function base64ToBytes(text: string): Uint8Array {
  let len = text.length;
  if (len === 0) return new Uint8Array(0);
  if (len % 4 !== 0) {
    throw new Error('base64ToBytes: length is not a multiple of 4');
  }

  let padding = 0;
  if (text.charCodeAt(len - 1) === 0x3d) padding += 1; // '='
  if (text.charCodeAt(len - 2) === 0x3d) padding += 1;
  len -= padding;

  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < len; i += 1) {
    const code = text.charCodeAt(i);
    const v = code < 128 ? B64_VAL[code]! : -1;
    if (v < 0) {
      throw new Error('base64ToBytes: invalid character');
    }
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o] = (acc >> bits) & 0xff;
      o += 1;
    }
  }
  return out;
}

/** Bytes a base64 string of this length decodes to — without decoding it. */
export function base64DecodedLength(text: string): number {
  if (text.length === 0) return 0;
  let padding = 0;
  if (text.charCodeAt(text.length - 1) === 0x3d) padding += 1;
  if (text.charCodeAt(text.length - 2) === 0x3d) padding += 1;
  return (text.length / 4) * 3 - padding;
}
