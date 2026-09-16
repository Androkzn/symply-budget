/**
 * Reading a shop page — one copy, shared by the Worker and the device.
 *
 * These were the Worker's, in `utils/safe-fetch-url.ts` and
 * `services/home-projects-service.ts`, and they stayed there for as long as the
 * Worker was the only thing that ever opened a product page. It is not any
 * more: a private-mode household has no Worker holding its data, so the device
 * fetches the page itself and needs the same reading of it.
 *
 * **They live here rather than being reimplemented** because a second parser is
 * a second answer. The failure that argument is made of is a real one: a local
 * mirror that encodes differently from the Worker, with a parity test asserting
 * its own encoding, certifies the bug instead of catching it. One `og:price`
 * regex, one thousands-separator rule, one entity table — used by both.
 *
 * Everything here is a pure function of a string. No `fetch`, no DOM, no
 * runtime API: Workers have no DOM and React Native has neither, and the
 * consumer of the readable text is a language model that reads
 * whitespace-collapsed prose perfectly well.
 */

/**
 * The `og:` tags, decoded.
 *
 * `decodeEntities` is declared further down and used here: function
 * declarations hoist, and keeping it next to `extractReadableText` — the other
 * caller — is worth the forward reference.
 */
export function parseOpenGraph(html: string): {
  title?: string;
  image?: string;
  description?: string;
  price?: string;
} {
  const pick = (prop: string): string | undefined => {
    const re = new RegExp(
      `<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`,
      'i'
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`,
      'i'
    );
    const raw = html.match(re)?.[1] || html.match(re2)?.[1];
    // Meta content is HTML-escaped at the source, so "Capital Tile &amp; Floors"
    // reaches a member's notes field looking like markup unless it is decoded
    // here. `extractReadableText` already does this for the body; the tags were
    // the half nobody had looked at.
    return raw === undefined ? undefined : decodeEntities(raw);
  };
  const title =
    pick('title') ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  /**
   * `og:image:secure_url` FIRST, and this is not a nicety.
   *
   * Shopify — and it is not alone — publishes `og:image` over plain http and
   * the https copy in `og:image:secure_url`, on a CDN that serves both. Reading
   * only `og:image` hands `absoluteImageUrl` an `http:` URL, which it correctly
   * refuses, and the listing loses its photo. Observed on the real page this
   * feature was built against: `http://capitaltiles.ca/cdn/shop/files/...jpg`
   * beside an identical `https://` secure_url.
   *
   * So the secure variant is preferred rather than the plain one being
   * loosened — the https-only rule on images stays exactly as strict.
   */
  const image = pick('image:secure_url') || pick('image');
  const description = pick('description');
  const price =
    html.match(/property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/content=["']([^"']+)["'][^>]+property=["']product:price:amount["']/i)?.[1];
  return { title, image, description, price };
}

/**
 * The retailer's own `schema.org/Product` blocks, verbatim.
 *
 * Where a shop publishes JSON-LD it is a machine-readable statement of name,
 * sku, brand, image and offer price by the party that sets the price — strictly
 * better evidence than the same values scraped out of rendered markup, and it
 * survives every layout change. Returned as raw strings rather than parsed
 * objects because the shapes vary wildly (`@graph` wrappers, arrays, nested
 * `offers`, `hasVariant`) and the model reads them better than a normaliser
 * would flatten them.
 *
 * Non-product blocks (BreadcrumbList, Organization, WebSite, FAQPage) are
 * dropped — they are the majority by count on a retail page and would crowd out
 * the page text under the size cap for nothing.
 */
export function parseJsonLd(html: string, options?: { maxBlocks?: number; maxChars?: number }): string[] {
  const maxBlocks = options?.maxBlocks ?? 4;
  const maxChars = options?.maxChars ?? 8000;
  const out: string[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null && out.length < maxBlocks) {
    const raw = match[1]?.trim();
    if (!raw || raw.length > maxChars) continue;
    // Must parse: a block that does not is truncated or templated, and handing
    // the model broken JSON labelled "most reliable" is worse than omitting it.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!mentionsProduct(parsed)) continue;
    out.push(raw);
  }
  return out;
}

/** Does this JSON-LD value carry a Product anywhere in its @type positions? */
function mentionsProduct(value: unknown, depth = 0): boolean {
  if (depth > 4 || value == null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => mentionsProduct(v, depth + 1));
  const obj = value as Record<string, unknown>;
  const type = obj['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === 'string' && /product/i.test(t))) return true;
  return Object.values(obj).some((v) => mentionsProduct(v, depth + 1));
}

/**
 * The named entities a retail page actually uses.
 *
 * Not a full table — there are ~2200 of those and shipping them to decode a
 * product title is absurd. These are what turned up on real listings: the
 * punctuation Shopify themes emit (`&ndash;` in every title, curly quotes in
 * descriptions), the symbols in spec tables (`&times;` between dimensions,
 * `&deg;` on ratings, `&frac12;` on sizes) and the marks in brand names.
 *
 * Numeric references (`&#8211;`, `&#x2019;`) are handled generically below and
 * cover everything not listed here.
 */
const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  times: '×',
  deg: '°',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup2: '²',
  sup3: '³',
  trade: '™',
  reg: '®',
  copy: '©',
  eacute: 'é',
  middot: '·',
  bull: '•',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    const key = body.toLowerCase();
    if (HTML_ENTITIES[key]) return HTML_ENTITIES[key];
    if (key.startsWith('#x')) {
      const code = parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (key.startsWith('#')) {
      const code = parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

/**
 * Rendered markup → the text a shopper would read.
 *
 * Scripts and styles go first and go WITH their content: a retail page carries
 * tens of kilobytes of inlined analytics and CSS, and under a character cap
 * every one of those bytes is a spec-table row that never reaches the model.
 * That, not tidiness, is why this exists — the price and the coverage are
 * usually near the bottom of the DOM.
 *
 * Deliberately NOT a parser. Workers have no DOM, a real parser is a dependency
 * for one call site, and the consumer is a language model that reads
 * whitespace-collapsed text perfectly well.
 *
 * **The cap is 18k, not 12k.** A real tile page states a dozen-plus specs —
 * material, thickness, nominal and actual size, PEI, DCOF, slip resistance,
 * pieces per box — and that table sits BELOW the nav, the gallery, the shipping
 * widget and the installation pitch. 12k reached it on the page this was tuned
 * against and would not on a longer one, and a truncated table is a spec silently
 * missing rather than a visible failure.
 */
export function extractReadableText(html: string, maxChars = 18000): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Block-level boundaries become newlines so a spec table does not collapse
    // into one run-on line where "Wear layer" and "12 mil" lose their pairing.
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table)>/gi, '\n')
    .replace(/<(br|\/td|\/th)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  return decodeEntities(text)
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, maxChars);
}

/**
 * "$45.99", "45,99", "1 234.56" → cents.
 *
 * Rejects rather than guesses when the string has both separators in an order
 * that could be either convention, because "1.234,56" and "1,234.56" differ by
 * a factor of a thousand and a wrong answer here reaches the budget.
 */
export function parsePriceToCents(
  raw: string | number | undefined | null,
): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) : null;
  }
  const cleaned = raw.replace(/[^0-9.,]/g, '').trim();
  if (!cleaned) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever separator comes last is the decimal one; the other groups.
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const groupSep = decimalSep === '.' ? ',' : '.';
    normalized = cleaned.split(groupSep).join('').replace(decimalSep, '.');
  } else if (lastComma >= 0) {
    // A lone comma is a decimal point when it leaves 1-2 digits ("45,99"),
    // and a thousands separator otherwise ("1,234").
    const tail = cleaned.length - lastComma - 1;
    normalized =
      tail === 1 || tail === 2
        ? cleaned.replace(',', '.')
        : cleaned.split(',').join('');
  } else {
    normalized = cleaned;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Resolve a possibly-relative image URL against the page it came from. */
export function absoluteImageUrl(
  candidate: string | undefined,
  pageUrl: string,
): string | null {
  if (!candidate) return null;
  try {
    const resolved = new URL(candidate, pageUrl);
    return resolved.protocol === 'https:' ? resolved.toString() : null;
  } catch {
    return null;
  }
}
