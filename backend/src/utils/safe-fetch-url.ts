/**
 * SSRF-hardened URL fetch for Workers (materials clipper).
 * Residual risk: DNS-rebinding TOCTOU cannot be fully closed on Workers.
 */

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === 'metadata.google.internal') return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  if (host.startsWith('::ffff:')) {
    const v4 = host.slice('::ffff:'.length);
    return PRIVATE_V4.some((re) => re.test(v4));
  }
  return PRIVATE_V4.some((re) => re.test(host));
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  bodyText: string;
  finalUrl: string;
  error?: string;
}

export async function safeFetchUrl(
  rawUrl: string,
  options?: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number }
): Promise<SafeFetchResult> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const maxBytes = options?.maxBytes ?? 512 * 1024;
  const maxRedirects = options?.maxRedirects ?? 3;

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return { ok: false, status: 0, bodyText: '', finalUrl: current, error: 'invalid_url' };
    }
    if (parsed.protocol !== 'https:') {
      return { ok: false, status: 0, bodyText: '', finalUrl: current, error: 'https_only' };
    }
    if (parsed.port && parsed.port !== '443') {
      return { ok: false, status: 0, bodyText: '', finalUrl: current, error: 'port_blocked' };
    }
    if (isBlockedHostname(parsed.hostname)) {
      return { ok: false, status: 0, bodyText: '', finalUrl: current, error: 'private_host' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'SymplyHouse-Clipper/1.0',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('Location');
        if (!loc) {
          return {
            ok: false,
            status: res.status,
            bodyText: '',
            finalUrl: current,
            error: 'redirect_missing',
          };
        }
        const next = new URL(loc, parsed).toString();
        // Strip auth headers on hop by not forwarding cookies/auth (we never set them).
        current = next;
        continue;
      }

      const buf = await res.arrayBuffer();
      if (buf.byteLength > maxBytes) {
        return {
          ok: false,
          status: res.status,
          bodyText: '',
          finalUrl: current,
          error: 'too_large',
        };
      }
      const bodyText = new TextDecoder('utf-8').decode(buf);
      return { ok: res.ok, status: res.status, bodyText, finalUrl: current };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        bodyText: '',
        finalUrl: current,
        error: err instanceof Error ? err.message : 'fetch_failed',
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: 0, bodyText: '', finalUrl: current, error: 'too_many_redirects' };
}

/**
 * The page readers moved to `@symply/contracts` when the DEVICE started opening
 * product pages too (private-mode households have no Worker to do it). They are
 * re-exported from here so every existing caller is untouched, and so there is
 * still one obvious place to look for "how do we read a shop page".
 */
export {
  parseOpenGraph,
  parseJsonLd,
  extractReadableText,
} from '@symply/contracts';

export interface SafeFetchImageResult {
  ok: boolean;
  status: number;
  bytes: ArrayBuffer | null;
  contentType: string | null;
  finalUrl: string;
  error?: string;
}

/**
 * The binary sibling of {@link safeFetchUrl}, for copying a product photo.
 *
 * Same guards for the same reason — the URL is still attacker-influenceable,
 * since it arrives from a page the member merely pasted rather than from the
 * member — plus a content-type allowlist. An `image_url` that answers `text/html`
 * is not a photo, and storing it would put arbitrary third-party HTML in the
 * bucket under an image key.
 *
 * The byte cap is enforced BEFORE the body is read into memory where the server
 * declares a length, and again after: a Worker has ~128MB and a hostile
 * `Content-Length: 12` on a 200MB body should not be the thing that decides it.
 */
export async function safeFetchImage(
  rawUrl: string,
  options?: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number }
): Promise<SafeFetchImageResult> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const maxBytes = options?.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = options?.maxRedirects ?? 3;
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return { ok: false, status: 0, bytes: null, contentType: null, finalUrl: current, error: 'invalid_url' };
    }
    if (parsed.protocol !== 'https:') {
      return { ok: false, status: 0, bytes: null, contentType: null, finalUrl: current, error: 'https_only' };
    }
    if (parsed.port && parsed.port !== '443') {
      return { ok: false, status: 0, bytes: null, contentType: null, finalUrl: current, error: 'port_blocked' };
    }
    if (isBlockedHostname(parsed.hostname)) {
      return { ok: false, status: 0, bytes: null, contentType: null, finalUrl: current, error: 'private_host' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'SymplyHouse-Clipper/1.0', Accept: 'image/*' },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('Location');
        if (!loc) {
          return {
            ok: false,
            status: res.status,
            bytes: null,
            contentType: null,
            finalUrl: current,
            error: 'redirect_missing',
          };
        }
        current = new URL(loc, parsed).toString();
        continue;
      }

      if (!res.ok) {
        return { ok: false, status: res.status, bytes: null, contentType: null, finalUrl: current, error: 'http_error' };
      }

      const contentType = (res.headers.get('Content-Type') || '').split(';')[0]!.trim().toLowerCase();
      if (!allowed.has(contentType)) {
        return {
          ok: false,
          status: res.status,
          bytes: null,
          contentType: contentType || null,
          finalUrl: current,
          error: 'unsupported_type',
        };
      }

      const declared = Number(res.headers.get('Content-Length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        return {
          ok: false,
          status: res.status,
          bytes: null,
          contentType,
          finalUrl: current,
          error: 'too_large',
        };
      }

      const bytes = await res.arrayBuffer();
      if (bytes.byteLength > maxBytes) {
        return { ok: false, status: res.status, bytes: null, contentType, finalUrl: current, error: 'too_large' };
      }
      return { ok: true, status: res.status, bytes, contentType, finalUrl: current };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        bytes: null,
        contentType: null,
        finalUrl: current,
        error: err instanceof Error ? err.message : 'fetch_failed',
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: 0, bytes: null, contentType: null, finalUrl: current, error: 'too_many_redirects' };
}
