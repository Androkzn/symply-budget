/**
 * Budget end-to-end debug logging.
 *
 * Emits grep-friendly, structured logs so the whole budget feature — and in
 * particular the AI extraction flows (grocery receipt scan, "add with AI"
 * detect, insights) — can be traced end-to-end in `wrangler tail` /
 * Observability. Every line is prefixed with `[BUDGET-E2E]` and a stage tag,
 * followed by a single-line JSON payload.
 *
 * Enabled automatically outside production; in production set the
 * `BUDGET_DEBUG_LOGS=true` var (or `false` to silence everywhere).
 *
 * Search examples:
 *   [BUDGET-E2E]                → everything
 *   [BUDGET-E2E][scan]          → receipt scan lifecycle
 *   [BUDGET-E2E][scan.asset]    → asset-quality diagnostics
 *   [BUDGET-E2E][scan.ai]       → raw AI analysis responses
 *   [BUDGET-E2E][ai-detect]     → "add with AI" text/file flow
 *   [BUDGET-E2E][insights]      → monthly AI insights
 */

interface DebugEnv {
  ENVIRONMENT?: string;
  BUDGET_DEBUG_LOGS?: string;
}

export function isBudgetDebugEnabled(env: DebugEnv): boolean {
  if (env.BUDGET_DEBUG_LOGS === 'true') return true;
  if (env.BUDGET_DEBUG_LOGS === 'false') return false;
  return (env.ENVIRONMENT ?? '').toLowerCase() !== 'production';
}

/** A correlation id so all logs from one request can be grouped together. */
export function newTraceId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function budgetDebug(env: DebugEnv, tag: string, data: Record<string, unknown>): void {
  if (!isBudgetDebugEnabled(env)) return;
  let payload: string;
  try {
    payload = JSON.stringify(data, jsonSafeReplacer);
  } catch {
    payload = '"<unserializable>"';
  }
  console.log(`[BUDGET-E2E][${tag}] ${payload}`);
}

/** Keep log lines bounded — truncate long strings, cap arrays. */
function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.length > 2000) {
    return `${value.slice(0, 2000)}…(+${value.length - 2000} chars)`;
  }
  return value;
}

export interface AssetQuality {
  byteLength: number;
  sizeKB: number;
  sizeMB: number;
  declaredMime: string;
  detectedMime: string | null;
  mimeMismatch: boolean;
  width: number | null;
  height: number | null;
  megapixels: number | null;
  /** Heuristic verdict + human-readable warnings about likely OCR quality. */
  verdict: 'ok' | 'low' | 'unknown';
  warnings: string[];
}

/**
 * Inspect the raw bytes of an uploaded receipt to judge whether it's likely to
 * OCR well: real file type (magic bytes), pixel dimensions, and size-based
 * heuristics. Purely diagnostic — never throws, never blocks the request.
 */
export function analyzeAssetQuality(buffer: ArrayBuffer, declaredMime: string): AssetQuality {
  const byteLength = buffer.byteLength;
  const detectedMime = detectMimeFromBytes(buffer);
  const dims = detectedMime && detectedMime !== 'application/pdf'
    ? sniffImageDimensions(buffer, detectedMime)
    : null;

  const width = dims?.width ?? null;
  const height = dims?.height ?? null;
  const megapixels =
    width && height ? Math.round(((width * height) / 1_000_000) * 100) / 100 : null;

  const warnings: string[] = [];
  if (detectedMime && detectedMime !== declaredMime) {
    warnings.push(`declared mime "${declaredMime}" but bytes are "${detectedMime}"`);
  }
  if (byteLength < 25 * 1024) {
    warnings.push('file < 25KB — likely too compressed/low-detail for reliable OCR');
  }
  if (megapixels !== null && megapixels < 0.5) {
    warnings.push(`low resolution (${megapixels}MP) — receipts OCR best above ~1MP`);
  }
  if (width !== null && width < 700) {
    warnings.push(`narrow image (${width}px wide) — small text may be unreadable`);
  }

  let verdict: AssetQuality['verdict'] = 'ok';
  if (megapixels === null && detectedMime !== 'application/pdf') {
    verdict = 'unknown';
  }
  if (
    byteLength < 25 * 1024 ||
    (megapixels !== null && megapixels < 0.5) ||
    (width !== null && width < 700)
  ) {
    verdict = 'low';
  }

  return {
    byteLength,
    sizeKB: Math.round((byteLength / 1024) * 10) / 10,
    sizeMB: Math.round((byteLength / (1024 * 1024)) * 100) / 100,
    declaredMime,
    detectedMime,
    mimeMismatch: !!detectedMime && detectedMime !== declaredMime,
    width,
    height,
    megapixels,
    verdict,
    warnings,
  };
}

/** Magic-byte file-type sniffing (jpeg/png/webp/pdf). */
export function detectMimeFromBytes(buffer: ArrayBuffer): string | null {
  const b = new Uint8Array(buffer);
  if (b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
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
  return null;
}

/** Read pixel dimensions from PNG/JPEG/WebP headers without decoding pixels. */
export function sniffImageDimensions(
  buffer: ArrayBuffer,
  mime: string
): { width: number; height: number } | null {
  try {
    const view = new DataView(buffer);
    if (mime === 'image/png') {
      // IHDR width/height are the first fields after the 8-byte signature +
      // 4-byte length + 4-byte "IHDR" type => offsets 16 and 20 (big-endian).
      if (view.byteLength < 24) return null;
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (mime === 'image/jpeg') {
      let offset = 2; // skip SOI (FF D8)
      const len = view.byteLength;
      while (offset + 9 < len) {
        if (view.getUint8(offset) !== 0xff) {
          offset++;
          continue;
        }
        const marker = view.getUint8(offset + 1);
        // SOF0–SOF15 carry dimensions, excluding DHT(C4), JPG(C8), DAC(CC).
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        const segmentLength = view.getUint16(offset + 2);
        if (segmentLength < 2) return null;
        offset += 2 + segmentLength;
      }
      return null;
    }
    if (mime === 'image/webp') {
      if (view.byteLength < 30) return null;
      const format = String.fromCharCode(
        view.getUint8(12),
        view.getUint8(13),
        view.getUint8(14),
        view.getUint8(15)
      );
      if (format === 'VP8 ') {
        return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      }
      if (format === 'VP8L') {
        const bits =
          view.getUint8(21) | (view.getUint8(22) << 8) | (view.getUint8(23) << 16) | (view.getUint8(24) << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (format === 'VP8X') {
        const w = 1 + (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16));
        const h = 1 + (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16));
        return { width: w, height: h };
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}
