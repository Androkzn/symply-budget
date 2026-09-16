/**
 * Reading a shop link into a material, on the device.
 *
 * ## What this is now, and what it was
 *
 * `createFromLink` threw here on egress grounds: the Worker opens the product
 * page behind an SSRF guard, and a device doing the same makes an unsolicited
 * request from the member's own network to a vendor.
 *
 * The first replacement read the URL and only the URL — no fetch, no page. It
 * got the name right off the slug and nothing else, so the card came back
 * "No price · link" underneath copy promising the photo, the price and what one
 * box covers. Three of four promises unkept, and the two things the member
 * actually needs — the figure that lands in their budget, and the coverage that
 * makes two boxes comparable — exist nowhere but on the page.
 *
 * So the page IS fetched now, by the device, in `fetchProductPage.ts`. The
 * egress argument was about *unsolicited* traffic; this is a member pasting a
 * URL and pressing a button that says it will be read.
 *
 * ## The rungs
 *
 *  - **Stage 0 — the URL alone.** Hostname and slug, pure string work, no
 *    network. Always produces a row, and is the floor every failure below falls
 *    back to.
 *  - **Stage 1 — the page.** `parseOpenGraph` over the fetched HTML: title,
 *    image, description, and `product:price:amount` where the shop publishes
 *    it. This is where a real price first appears.
 *  - **Stage 2 — the member's own AI key.** The retailer's JSON-LD, the
 *    OpenGraph tags and the stripped page text go to one of the three hosts in
 *    `HOUSE_BYOK_ALLOWLIST` under the member's key, using the SAME prompt and
 *    schema the Worker uses. Coverage, price basis, brand, sku and the spec
 *    table come from here.
 *
 * Each rung only ever improves on the one below it, so a shop that blocks the
 * fetch or a provider having a bad day costs polish and never the row.
 *
 * ## One pipeline, not a mirror of one
 *
 * `parseOpenGraph`, `parseJsonLd`, `extractReadableText`, `parsePriceToCents`
 * and `mergeListingIntoDraft` are imported from `@symply/contracts` — the same
 * functions the Worker calls, not a local reimplementation. A second parser is
 * a second answer to "what does this floor cost", and a parity test asserting
 * a local encoding certifies the bug rather than catching it.
 *
 * Everything in THIS file is pure. The fetch lives next door.
 */
import {
  absoluteImageUrl,
  hostnameOf,
  parseOpenGraph,
  parsePriceToCents,
  type SelectionDraft,
} from '@symply/contracts';

export { hostnameOf };

/**
 * The part of the path that names the product.
 *
 * The LAST meaningful segment, skipping the router noise shops put in front of
 * it (`/products/`, `/p/`, `/item/`) and the opaque ids they put after it. A
 * segment that is all digits or a bare hex/uuid blob says nothing about the
 * product, so it is stepped over rather than titled into a name like "8842".
 */
export function productSlugOf(url: string): string | null {
  let path: string;
  try {
    path = new URL(url.trim()).pathname;
  } catch {
    return null;
  }
  const segments = path
    .split('/')
    .map(segment => decodeURIComponent(segment).trim())
    .filter(Boolean)
    // `.html`, `.aspx` and friends are the page, not the product.
    .map(segment => segment.replace(/\.(html?|aspx?|php|jsp)$/i, ''));

  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i]!;
    if (ROUTER_SEGMENTS.has(segment.toLowerCase())) continue;
    if (IDENTIFIER_ONLY.test(segment)) continue;
    if (segment.length < 3) continue;
    return segment;
  }
  return null;
}

/** Segments that route rather than describe. */
const ROUTER_SEGMENTS = new Set([
  'p',
  'pd',
  'dp',
  'item',
  'items',
  'product',
  'products',
  'shop',
  'store',
  'catalog',
  'catalogue',
  'collections',
  'collection',
  'category',
  'categories',
  'en',
  'en-ca',
  'en-us',
  'ca',
  'us',
]);

/** All digits, or a long hex/uuid blob — an id, not a description. */
const IDENTIFIER_ONLY = /^(\d+|[0-9a-f]{8,}(-[0-9a-f]{4,}){0,4})$/i;

/**
 * A slug turned into something a member would recognise.
 *
 * Words are capitalised, but tokens that are already meaningful in their own
 * form are left exactly as written: `9x10` is a tile size and `Title Case`
 * would turn it into `9X10`, and `sku-4821` keeps its number.
 */
export function titleFromSlug(slug: string): string {
  const words = slug
    .split(/[-_+.]+/)
    .map(word => word.trim())
    .filter(Boolean)
    // A trailing id on an otherwise descriptive slug is noise, not a word.
    .filter(
      (word, index, all) =>
        !(index === all.length - 1 && IDENTIFIER_ONLY.test(word)),
    );

  return words
    .map(word =>
      /\d/.test(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(' ')
    .slice(0, 200);
}

/**
 * Stage 0: everything the URL says on its own.
 *
 * Always returns a usable draft — a link the member pasted is worth a row even
 * when the path is opaque, and "capitaltiles.ca" plus the link beats a refusal.
 * `extractionSource` starts at `'link_url'` and each rung above raises it.
 */
export function draftFromUrl(url: string): SelectionDraft {
  const trimmed = url.trim();
  const host = hostnameOf(trimmed);
  const slug = productSlugOf(trimmed);
  const name = slug ? titleFromSlug(slug) : '';

  return {
    name: name || host || 'Saved link',
    productUrl: trimmed,
    vendor: host ?? undefined,
    extractionSource: 'link_url',
  };
}

/**
 * Stage 1: what the page says about itself, before any model reads it.
 *
 * Computed unconditionally and first, exactly as the Worker does it — this is
 * the floor a failed extraction falls back to, and it costs nothing once the
 * HTML is already in hand. It is also where a real price first appears: shops
 * that publish `product:price:amount` state it here, and `parsePriceToCents`
 * is the same function that reads the Worker's copy.
 */
export function draftFromPage(
  base: SelectionDraft,
  html: string,
  finalUrl: string,
): SelectionDraft {
  const og = parseOpenGraph(html);
  const priceCents = parsePriceToCents(og.price);

  return {
    ...base,
    // The page's own title beats a slug, but an empty one must not erase it.
    name: og.title?.trim().slice(0, 200) || base.name,
    productUrl: finalUrl,
    vendor: hostnameOf(finalUrl) ?? base.vendor,
    unitPriceCents: priceCents ?? base.unitPriceCents,
    notes: og.description?.trim().slice(0, 500) || base.notes,
    imageUrl: absoluteImageUrl(og.image, finalUrl) ?? base.imageUrl,
    extractionSource: 'link_og',
  };
}
