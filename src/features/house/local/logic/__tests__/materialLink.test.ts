/**
 * Reading a shop link, rung by rung.
 *
 * The screenshot that drove this said "No price · link" under a form promising
 * the photo, the price, what one box covers and the specs. Three of four
 * unkept, and the two that matter — the figure that lands in the budget and the
 * coverage that makes two boxes comparable — live only on the page.
 *
 * So these fix what each rung is allowed to claim, and that every one of them
 * only ever improves on the rung below.
 */
import {
  draftFromPage,
  draftFromUrl,
  hostnameOf,
  productSlugOf,
  titleFromSlug,
} from '../materialLink';

const REAL =
  'https://capitaltiles.ca/products/hex-joy-9x10-matte-finish-porcelain-tile?_pos=13&_sid=a0ec2254d&_ss=r';

describe('stage 0 — the URL alone', () => {
  it('reads the product out of the path', () => {
    expect(draftFromUrl(REAL).name).toBe('Hex Joy 9x10 Matte Finish Porcelain Tile');
  });

  it('keeps the vendor as the bare host, never as a guessed brand', () => {
    const draft = draftFromUrl(REAL);
    expect(draft.vendor).toBe('capitaltiles.ca');
    expect(draft.brand).toBeUndefined();
  });

  it('drops www so two links to one shop agree', () => {
    expect(hostnameOf('https://www.homedepot.ca/p/thing')).toBe('homedepot.ca');
  });

  /** A size is the most useful thing in a slug and title-casing destroys it. */
  it('leaves a dimension exactly as written', () => {
    expect(titleFromSlug('hex-joy-9x10-matte')).toBe('Hex Joy 9x10 Matte');
  });

  it('steps over the router segments shops put around the product', () => {
    expect(productSlugOf('https://shop.example.com/en-ca/products/oak-plank')).toBe(
      'oak-plank',
    );
  });

  /** "8842" is not a name a member would recognise as their tile. */
  it('steps over a trailing id rather than titling it', () => {
    expect(productSlugOf('https://example.com/p/matte-subway-tile/8842')).toBe(
      'matte-subway-tile',
    );
    expect(titleFromSlug('matte-subway-tile-8842')).toBe('Matte Subway Tile');
  });

  /** A link the member pasted is worth a row even when the path says nothing. */
  it('still produces something usable when the path is opaque', () => {
    const draft = draftFromUrl('https://example.com/x/9f2b1c4d8e7a6b5c');
    expect(draft.name).toBe('example.com');
    expect(draft.extractionSource).toBe('link_url');
  });

  it('does not throw on something that is not a URL at all', () => {
    expect(draftFromUrl('not a url').name).toBe('Saved link');
  });

  /** Nothing at this rung can know a price, and it must not pretend to. */
  it('carries no price', () => {
    expect(draftFromUrl(REAL).unitPriceCents).toBeUndefined();
  });
});

describe('stage 1 — the page', () => {
  const PAGE = `<html><head>
    <meta property="og:title" content="Hex Joy 9x10 Matte Finish Porcelain Tile">
    <meta property="og:image" content="/cdn/hex-joy.jpg">
    <meta property="og:description" content="Matte hexagon porcelain, 9x10 in.">
    <meta property="product:price:amount" content="6.49">
  </head><body>Sold by the square foot.</body></html>`;

  const base = draftFromUrl(REAL);

  /** The whole reason the page is fetched: this is where a real price is. */
  it('takes the price the shop publishes', () => {
    expect(draftFromPage(base, PAGE, REAL).unitPriceCents).toBe(649);
  });

  it('resolves a relative image against the page it came from', () => {
    expect(draftFromPage(base, PAGE, REAL).imageUrl).toBe(
      'https://capitaltiles.ca/cdn/hex-joy.jpg',
    );
  });

  it('prefers the page title over the slug', () => {
    const titled = draftFromPage(base, PAGE, REAL);
    expect(titled.name).toBe('Hex Joy 9x10 Matte Finish Porcelain Tile');
    expect(titled.extractionSource).toBe('link_og');
  });

  /** A page with nothing to say must not erase what the slug already gave. */
  it('keeps the stage-0 draft when the page carries no tags', () => {
    const bare = draftFromPage(base, '<html><body>hi</body></html>', REAL);
    expect(bare.name).toBe(base.name);
    expect(bare.unitPriceCents).toBeUndefined();
    expect(bare.imageUrl).toBeUndefined();
  });

  it('follows the redirect target for the vendor and the product url', () => {
    const moved = draftFromPage(base, PAGE, 'https://www.capitaltiles.ca/products/hex-joy');
    expect(moved.vendor).toBe('capitaltiles.ca');
    expect(moved.productUrl).toBe('https://www.capitaltiles.ca/products/hex-joy');
  });
});
