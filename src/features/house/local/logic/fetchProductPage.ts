/**
 * Opening a shop page from the device.
 *
 * ## Why the device does this now
 *
 * `createFromLink` was a refusal on egress grounds — the Worker fetches the
 * product page behind an SSRF guard, and a device doing the same makes an
 * unsolicited request from the member's own network to a vendor. That objection
 * was about *unsolicited* traffic, and this is not: the member pasted this URL,
 * pressed a button labelled "Add from link", and is reading copy that says the
 * page will be read for the photo, the price and the coverage.
 *
 * Reading the URL alone was the first attempt and it is not enough. A slug
 * gives a name and nothing else, so the card came back "No price · link" under
 * a promise of four things. Everything the member actually wanted — the price
 * that lands in their budget, the photo, what one box covers — exists only on
 * the page.
 *
 * ## What this is careful about
 *
 * The Worker's `safeFetchUrl` guards against SSRF because it takes URLs from
 * untrusted callers and runs inside a network that has private ranges worth
 * reaching. A phone has neither property — there is nothing behind it to
 * pivot to. What a phone DOES need is to not hang, not download a video, and
 * not be talked into a non-web scheme:
 *
 *  - **https only.** `file://` would read the device's own disk and `http://`
 *    would put the member's browsing on the local network in clear text.
 *  - **A timeout**, because a shop that never answers must not leave the
 *    button spinning forever.
 *  - **A byte cap**, enforced while reading rather than from `content-length`,
 *    which is absent or lies on exactly the pages that need capping.
 *  - **No credentials**, no cookies, and a plain `Accept: text/html` — this is
 *    a read of a public page, not a session with the shop.
 *
 * Redirects are followed by `fetch` itself; the final URL comes back so
 * relative image paths resolve against the page that actually answered.
 */

/** Never wait longer than this for a shop that is not answering. */
const TIMEOUT_MS = 12_000;

/**
 * Stop reading after this much HTML.
 *
 * `extractReadableText` caps at 12k characters and `parseJsonLd` at four blocks,
 * so more than this can never reach the model — it would only cost the member
 * their data plan. Retail pages run 300–800 KB, which fits.
 */
const MAX_BYTES = 2 * 1024 * 1024;

export interface ProductPageResult {
  ok: boolean;
  status: number;
  /** The HTML, or `''` when the fetch did not produce any. */
  html: string;
  /** Where the page actually came from, after redirects. */
  finalUrl: string;
  /** Machine-readable reason, for logs. Never shown to a member. */
  error?: string;
}

/**
 * Fetch one product page.
 *
 * Never throws: every failure is a result with `ok: false` and a reason, because
 * the caller's whole design is that a page it could not read costs polish and
 * not the row.
 */
export async function fetchProductPage(
  url: string,
  options: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch } = {},
): Promise<ProductPageResult> {
  const trimmed = url.trim();
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const doFetch = options.fetchImpl ?? fetch;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, status: 0, html: '', finalUrl: trimmed, error: 'bad_url' };
  }
  if (parsed.protocol !== 'https:') {
    // `http:` and `file:` both fail here on purpose — see the header.
    return { ok: false, status: 0, html: '', finalUrl: trimmed, error: 'scheme_not_allowed' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        // Some shops serve a stub to an unrecognised agent. Naming the app is
        // honest and gets the same markup a browser would see.
        'User-Agent': 'SymplyHouse/1.0 (+material link import)',
      },
    });

    const finalUrl = response.url || parsed.toString();
    if (!response.ok) {
      return { ok: false, status: response.status, html: '', finalUrl, error: `http_${response.status}` };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
      // A PDF or an image is not a listing, and reading megabytes of one to
      // find that out is worse than saying so now.
      return { ok: false, status: response.status, html: '', finalUrl, error: 'not_html' };
    }

    const html = await readCapped(response, maxBytes);
    return { ok: true, status: response.status, html, finalUrl };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      html: '',
      finalUrl: parsed.toString(),
      error: aborted ? 'timeout' : error instanceof Error ? error.message : 'fetch_failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the body, stopping at the cap.
 *
 * Streaming where the runtime supports it, so an oversized page is abandoned
 * mid-download rather than after it. React Native's `fetch` does not always
 * expose `body`, and there the cap is applied after the fact — still correct,
 * just less thrifty.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const body = (response as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!body || typeof body.getReader !== 'function') {
    const text = await response.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
  }
  // Truncated HTML is fine for every reader downstream: they are regexes and a
  // whitespace collapse, not a parser that needs a balanced tree.
  await reader.cancel().catch(() => undefined);

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}
