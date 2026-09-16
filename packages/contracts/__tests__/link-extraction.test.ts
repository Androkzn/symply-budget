/**
 * Reading a shop page — the cases that came off a real one.
 *
 * These are not invented shapes. The page this feature was built against is a
 * Shopify storefront (capitaltiles.ca), and it broke two assumptions that
 * looked safe until markup from an actual retailer went through:
 *
 *   1. `og:image` is served over plain **http**, with the https copy parked in
 *      `og:image:secure_url`. Reading only `og:image` means `absoluteImageUrl`
 *      refuses it — correctly — and the listing silently loses its photo, which
 *      is the one thing a tile needs for a preview.
 *   2. The price is nowhere in the meta tags. It lives in a `ProductGroup`
 *      JSON-LD block under `hasVariant[].offers.price`, so a parser that only
 *      accepted a top-level `@type: "Product"` would drop the whole listing.
 */
import { describe, expect, it } from 'vitest';

import {
  absoluteImageUrl,
  extractReadableText,
  parseJsonLd,
  parseOpenGraph,
  parsePriceToCents,
} from '../src/link-extraction';

const PAGE_URL =
  'https://capitaltiles.ca/products/hex-joy-9x10-matte-finish-porcelain-tile';

/** The tags as that storefront actually writes them. */
const SHOPIFY_HEAD = `
<meta property="og:site_name" content="Capital Tiles CA">
<meta property="og:title" content="Hex Joy 9x10 Matte Finish Porcelain Tile">
<meta property="og:type" content="product">
<meta property="og:image" content="http://capitaltiles.ca/cdn/shop/files/Hex-Joy-9x10-Matte-R.jpg?v=1753939671">
<meta property="og:image:secure_url" content="https://capitaltiles.ca/cdn/shop/files/Hex-Joy-9x10-Matte-R.jpg?v=1753939671">
`;

describe('openGraph', () => {
  it('reads the title', () => {
    expect(parseOpenGraph(SHOPIFY_HEAD).title).toBe(
      'Hex Joy 9x10 Matte Finish Porcelain Tile',
    );
  });

  /**
   * The regression that cost the tile its picture. Preferring the secure copy
   * keeps the https-only rule on images exactly as strict — it just stops
   * handing that rule the one URL on the page it is bound to refuse.
   */
  it('prefers the https image over the http one beside it', () => {
    const image = parseOpenGraph(SHOPIFY_HEAD).image;
    expect(image?.startsWith('https://')).toBe(true);
    expect(absoluteImageUrl(image, PAGE_URL)).toContain('Hex-Joy-9x10-Matte-R.jpg');
  });

  /**
   * Meta content is escaped at the source. Undecoded, "Capital Tile &amp;
   * Floors" reached the member's notes field looking like markup — seen on the
   * device, in the notes of an imported tile.
   */
  it('decodes entities so a description does not arrive as markup', () => {
    const og = parseOpenGraph(
      '<meta property="og:description" content="Capital Tile &amp; Floors &ndash; Surrey">',
    );
    expect(og.description).toBe('Capital Tile & Floors – Surrey');
  });

  it('still reads a lone og:image when there is no secure variant', () => {
    const image = parseOpenGraph(
      '<meta property="og:image" content="https://x.test/a.jpg">',
    ).image;
    expect(image).toBe('https://x.test/a.jpg');
  });

  /** An http-only image is still refused — the rule did not get looser. */
  it('refuses an http image that has no https copy', () => {
    const image = parseOpenGraph(
      '<meta property="og:image" content="http://x.test/a.jpg">',
    ).image;
    expect(absoluteImageUrl(image, PAGE_URL)).toBeNull();
  });
});

describe('jsonLd', () => {
  const PRODUCT_GROUP = `<script type="application/ld+json">
  {"@context":"http://schema.org/","@type":"ProductGroup","brand":{"@type":"Brand","name":"Capital Tile"},
   "category":"Decorative tile",
   "hasVariant":[{"@type":"Product","sku":"HJ910MS","name":"Hex Joy 9x10 Matte Finish Porcelain Tile - Original",
     "offers":{"@type":"Offer","price":"48.80","priceCurrency":"CAD"}}]}
  </script>`;

  /**
   * A `ProductGroup` whose products are nested under `hasVariant` — the shape
   * every Shopify storefront with variants emits, and the only place this page
   * states its price at all.
   */
  it('keeps a ProductGroup with the price nested in a variant', () => {
    const blocks = parseJsonLd(PRODUCT_GROUP);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('48.80');
    expect(blocks[0]).toContain('HJ910MS');
  });

  /** The majority of blocks on a retail page, and none of them a listing. */
  it('drops the blocks that are not about a product', () => {
    const noise = `
      <script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script>
      <script type="application/ld+json">{"@type":"Organization","name":"Capital Tiles"}</script>
      <script type="application/ld+json">{"@type":"WebSite","url":"https://capitaltiles.ca"}</script>`;
    expect(parseJsonLd(noise)).toHaveLength(0);
  });

  /** Broken JSON labelled "most reliable" is worse than no block at all. */
  it('drops a block that does not parse', () => {
    expect(
      parseJsonLd('<script type="application/ld+json">{"@type":"Product",</script>'),
    ).toHaveLength(0);
  });
});

describe('readable text', () => {
  /**
   * Coverage is the number that makes two boxes comparable and it is almost
   * never in the metadata — on this page it is a spec-table row.
   */
  it('keeps a spec-table row and drops the script that buried it', () => {
    const html = `<html><head><script>var a="8.16 never";</script>
      <style>.x{content:"48.80"}</style></head>
      <body><table><tr><td>Coverage</td><td>8.16 Sq.ft.</td></tr></table></body></html>`;
    const text = extractReadableText(html);
    expect(text).toContain('8.16 Sq.ft.');
    expect(text).not.toContain('var a');
    expect(text).not.toContain('.x{');
  });

  it('decodes entities so a price is not split by markup noise', () => {
    expect(extractReadableText('<p>Capital Tile &amp; Floors</p>')).toBe(
      'Capital Tile & Floors',
    );
  });
});

describe('price', () => {
  it('reads the JSON-LD figure', () => {
    expect(parsePriceToCents('48.80')).toBe(4880);
  });

  /** "1.234,56" and "1,234.56" differ by a thousand and both reach a budget. */
  it('resolves both separator conventions rather than guessing', () => {
    expect(parsePriceToCents('1,234.56')).toBe(123456);
    expect(parsePriceToCents('1.234,56')).toBe(123456);
    expect(parsePriceToCents('45,99')).toBe(4599);
    expect(parsePriceToCents('1,234')).toBe(123400);
  });

  it('answers null rather than zero for something that is not a price', () => {
    expect(parsePriceToCents('Call for pricing')).toBeNull();
    expect(parsePriceToCents(null)).toBeNull();
  });
});
