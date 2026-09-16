/**
 * Media-type sniffing from magic bytes — the DETERMINISTIC guard for AI document
 * extraction (mortgage / savings / receipts / utility bills / property tax).
 *
 * WHY THIS EXISTS: every extraction route forwards the CLIENT-declared MIME
 * (from a file extension via `inferMime`, or an unreliable picker) straight to
 * Anthropic. Anthropic HARD-REJECTS a mismatch — e.g. a file named `.png` that
 * actually holds JPEG bytes returns
 *   400 invalid_request_error: "media type image/png, but the image appears to
 *   be a image/jpeg image"
 * which surfaced to members as the generic "Could not read that statement."
 * Statements exported/saved with a lying extension are common, so this is not a
 * corner case. Sniffing the real type from the leading bytes and trusting THAT
 * (over the declared MIME) makes the extraction robust to every such mismatch.
 *
 * I/O-free → fully unit-testable without any AI call.
 */

export type SupportedMediaType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp';

/**
 * Identify a supported media type from a file's leading bytes. Returns `null`
 * for anything we don't recognize (incl. GIF/HEIC/etc.) so the caller can fall
 * back to the declared type rather than guessing wrong.
 */
export function detectMediaTypeFromBytes(b: Uint8Array): SupportedMediaType | null {
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WEBP: "RIFF" (0-3) .... "WEBP" (8-11)
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'image/webp';
  }
  // PDF: "%PDF"
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    return 'application/pdf';
  }
  return null;
}

/**
 * Sniff a supported media type from the FIRST bytes of a base64 payload. Only
 * the leading ~18 bytes are decoded — enough for every signature we check
 * (WEBP needs byte 11) and cheap regardless of file size. Returns `null` if the
 * prefix is undecodable or unrecognized.
 */
export function detectMediaTypeFromBase64(base64: string): SupportedMediaType | null {
  if (!base64) return null;
  try {
    // 24 base64 chars → exactly 18 bytes (24 % 4 === 0, so no partial group).
    const prefix = base64.slice(0, 24);
    const bin = atob(prefix);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return detectMediaTypeFromBytes(bytes);
  } catch {
    return null;
  }
}

/**
 * The media type to actually SEND to the model: the sniffed type when the bytes
 * are recognizable, otherwise the client-declared type. This is the single call
 * the provider makes so a lying extension can never reach Anthropic.
 */
export function resolveMediaType(
  base64: string,
  declared: SupportedMediaType
): SupportedMediaType {
  return detectMediaTypeFromBase64(base64) ?? declared;
}
