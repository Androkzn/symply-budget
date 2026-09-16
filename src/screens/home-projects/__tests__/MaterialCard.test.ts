/**
 * What one material row is allowed to CLAIM.
 *
 * The row is the surface a member scans before spending several thousand
 * pounds, and every fact on it is either the vendor's or arithmetic on the
 * vendor's. So the rules live in `describeMaterialCard` — a pure function — and
 * are asserted here rather than through a render, for the same reason
 * `buildProjectMenuActions` and `MATERIAL_ADD_OPTIONS` are: a rule that only
 * exists inside a 2,900-line screen is a rule nobody can check.
 *
 * The row this replaced showed a name and the string "No price · link", where
 * "link" was inert text. Everything below is a thing the importer had already
 * written to the row and the card never showed — or, in three cases, a thing it
 * must go on refusing to show.
 *
 * The prices are Tag B from `shelfTagFixtures.test.ts`: a real shelf tag at
 * Capital Tile + Stone, $14.42 → $5.98, photographed. That file pins what the
 * EXTRACTION must make of the tag; this one pins what the card makes of the
 * row it produced.
 */
import {
  describeMaterialCard,
  type MaterialCardInput,
} from '@api/home-projects';

/** Midweek, so "ends Sat" is three days out and unambiguous. */
const WEDNESDAY = new Date('2026-09-02T10:00:00Z').getTime();

/** A row with nothing on it. Each test turns on only what it is about. */
function row(over: Partial<MaterialCardInput> = {}): MaterialCardInput {
  return {
    name: 'LONDON SOHO 8X8 MT',
    vendor: null,
    product_url: null,
    image_url: null,
    color_hex: null,
    unit_price_cents: null,
    list_price_cents: null,
    sale_price_cents: null,
    discount_pct: null,
    sale_ends_at: null,
    ...over,
  };
}

/** Tag B, as the columns migration 0164 added hold it. */
const LONDON_SOHO: Partial<MaterialCardInput> = {
  vendor: 'Capital Tile + Stone',
  unit_price_cents: 598,
  list_price_cents: 1442,
  sale_price_cents: 598,
  discount_pct: 59,
};

describe('a sale the prices prove', () => {
  it('shows both prices and derives the percentage from them', () => {
    // $14.42 → $5.98 is 58.5%, which rounds to 59. The member can check that
    // against the shelf; a number copied off the tag's own banner is the one
    // thing they cannot.
    const { sale } = describeMaterialCard(row(LONDON_SOHO), WEDNESDAY);
    expect(sale.onSale).toBe(true);
    expect(sale.priceCents).toBe(598);
    expect(sale.listPriceCents).toBe(1442);
    expect(sale.discountPct).toBe(59);
    expect(sale.badgeLabel).toBe('−59%');
  });

  it('carries the offer in the badge TEXT, not in a colour', () => {
    // The rule the badge's styling is not allowed to break: a member who cannot
    // separate the pill's tint from the row still reads "−59%".
    const { sale } = describeMaterialCard(row(LONDON_SOHO), WEDNESDAY);
    expect(sale.badgeLabel).toContain('59');
    // U+2212, not a hyphen — a hyphen is a word-break opportunity and VoiceOver
    // reads it as "dash".
    expect(sale.badgeLabel?.[0]).toBe('−');
  });

  it('says the whole thing in a sentence for a member who cannot see the strike-through', () => {
    const { sale } = describeMaterialCard(row(LONDON_SOHO), WEDNESDAY);
    expect(sale.accessibilityLabel).toContain('59 percent off');
    expect(sale.accessibilityLabel).toContain('was');
    expect(sale.accessibilityLabel).toContain('now');
  });

  it('shows the expiry on the CARD when it is still in the future', () => {
    // The deadline is what turns a discount into a decision, and it has to be
    // where the member is deciding — in the list, not one tap away.
    const { sale } = describeMaterialCard(
      row({ ...LONDON_SOHO, sale_ends_at: '2026-09-05' }),
      WEDNESDAY,
    );
    expect(sale.endsLabel).toBe('Ends Sat');
    expect(sale.onSale).toBe(true);
  });

  it('runs a date-only sale to the END of its last day, in the member’s own zone', () => {
    // `new Date('2026-09-02')` is UTC midnight, which would expire this sale
    // through the whole of the day the shop is still honouring it for every
    // member west of Greenwich.
    const lastMorning = new Date(2026, 8, 2, 9, 0, 0).getTime();
    const { sale } = describeMaterialCard(
      row({ ...LONDON_SOHO, sale_ends_at: '2026-09-02' }),
      lastMorning,
    );
    expect(sale.onSale).toBe(true);
    expect(sale.endsLabel).toBe('Ends today');
  });
});

describe('a sale that has ended is not a sale', () => {
  it('drops the badge, the strike-through and the percentage together', () => {
    // The single most damaging thing this row could render. A stale badge does
    // not merely mislead — it sends the member to a shop, and they find out at
    // the till.
    const { sale } = describeMaterialCard(
      row({ ...LONDON_SOHO, sale_ends_at: '2026-08-01' }),
      WEDNESDAY,
    );
    expect(sale.onSale).toBe(false);
    expect(sale.badgeLabel).toBeNull();
    expect(sale.listPriceCents).toBeNull();
    expect(sale.discountPct).toBeNull();
    expect(sale.endsLabel).toBeNull();
  });

  it('still shows the price, because the material is still for sale', () => {
    // Expired offer, not an expired material. Dropping the price too would turn
    // a stale badge into a missing number in the estimate.
    const { sale, hasPrice } = describeMaterialCard(
      row({ ...LONDON_SOHO, sale_ends_at: '2026-08-01' }),
      WEDNESDAY,
    );
    expect(hasPrice).toBe(true);
    expect(sale.priceCents).toBe(598);
  });

  it('suppresses the vendor’s own stated percentage as well', () => {
    // `discount_pct` outlives its sale more often than the prices do — it is
    // the field a shop forgets to clear. An expired row shows none of it.
    const { sale } = describeMaterialCard(
      row({
        unit_price_cents: 598,
        discount_pct: 59,
        sale_ends_at: '2026-08-01',
      }),
      WEDNESDAY,
    );
    expect(sale.claimedDiscountPct).toBeNull();
    expect(sale.badgeLabel).toBeNull();
  });
});

describe('what the card must refuse to invent', () => {
  it('invents no “was” price from a percentage alone', () => {
    // A shop that advertises "59% off" and prints only the new price has
    // published no "was". Reversing one out of the arithmetic would put a
    // number the shop never stated on screen, struck through, where a member
    // reads it as a fact.
    const { sale } = describeMaterialCard(
      row({ unit_price_cents: 598, discount_pct: 59 }),
      WEDNESDAY,
    );
    expect(sale.listPriceCents).toBeNull();
    expect(sale.onSale).toBe(false);
    expect(sale.badgeLabel).toBeNull();
    // Repeated as a claim in words instead — which is not the same thing as a
    // strike-through, and must not look like one.
    expect(sale.claimedDiscountPct).toBe(59);
  });

  it('badges nothing when a lone retail price is all there is', () => {
    // Tag A, once its TRADE price is correctly ignored: one price, no
    // promotion. See `shelfTagFixtures.test.ts` for why a lower second number
    // is not evidence of a discount.
    const { sale, hasPrice } = describeMaterialCard(
      row({ unit_price_cents: 713 }),
      WEDNESDAY,
    );
    expect(sale.onSale).toBe(false);
    expect(sale.badgeLabel).toBeNull();
    expect(hasPrice).toBe(true);
    expect(sale.priceCents).toBe(713);
  });

  it('treats a sale price ABOVE its list price as no sale', () => {
    // Two prices are only a discount when the second is lower. A misordered
    // pair is a bad import, not a −0%.
    const { sale } = describeMaterialCard(
      row({ list_price_cents: 598, sale_price_cents: 1442 }),
      WEDNESDAY,
    );
    expect(sale.onSale).toBe(false);
    expect(sale.badgeLabel).toBeNull();
  });
});

describe('a price-less material still renders its existing state', () => {
  it('reports no price rather than a zero', () => {
    // "No price" and "$0.00" are opposite claims about a renovation, and the
    // row has to be able to make the first one.
    const { sale, hasPrice } = describeMaterialCard(row(), WEDNESDAY);
    expect(hasPrice).toBe(false);
    expect(sale.priceCents).toBeNull();
    expect(sale.onSale).toBe(false);
  });

  it('still gets a visual, a name and whatever else the row holds', () => {
    // The unpriced row is the commonest one a partial import leaves behind. It
    // is not a broken row and must not look like one.
    const facts = describeMaterialCard(
      row({ vendor: 'Capital Tile + Stone', color_hex: '#c9c2b6' }),
      WEDNESDAY,
    );
    expect(facts.hasPrice).toBe(false);
    expect(facts.vendor).toBe('Capital Tile + Stone');
    expect(facts.visual).toEqual({ kind: 'swatch', colorHex: '#c9c2b6' });
  });
});

describe('every card gets a visual — never an empty box', () => {
  it('prefers the durable attachment over the vendor’s own url', () => {
    // The schema says the attachment wins: a vendor URL rots when the listing
    // is pulled, and a card that 404s months later is how a project loses its
    // photos without anyone noticing.
    const facts = describeMaterialCard(
      row({ image_url: 'https://shop.example/tile.jpg', color_hex: '#c9c2b6' }),
      WEDNESDAY,
      { url: 'https://r2.example/attachment.jpg' },
    );
    expect(facts.visual).toEqual({
      kind: 'image',
      uri: 'https://r2.example/attachment.jpg',
    });
  });

  it('uses the vendor’s photo when there is no attachment, ahead of the colour', () => {
    const facts = describeMaterialCard(
      row({ image_url: 'https://shop.example/tile.jpg', color_hex: '#c9c2b6' }),
      WEDNESDAY,
    );
    expect(facts.visual).toEqual({
      kind: 'image',
      uri: 'https://shop.example/tile.jpg',
    });
  });

  it('falls back to a swatch of the material’s own colour', () => {
    // Paint is the case that earns this outright: a paint material IS a colour,
    // and shops rarely publish a photo of one worth looking at.
    const facts = describeMaterialCard(
      row({ name: 'SW 7015 Repose Gray', color_hex: '#cccbc4' }),
      WEDNESDAY,
    );
    expect(facts.visual).toEqual({ kind: 'swatch', colorHex: '#cccbc4' });
  });

  it('falls back again to a placeholder rather than to nothing', () => {
    // In a scanned column an empty box does not read as "no photo", it reads as
    // a row that failed to load.
    expect(describeMaterialCard(row(), WEDNESDAY).visual).toEqual({
      kind: 'placeholder',
    });
  });

  it('refuses a malformed hex rather than handing it to backgroundColor', () => {
    // One bad hex out of an importer is a red-box on a list screen. The
    // placeholder costs nothing.
    expect(
      describeMaterialCard(row({ color_hex: 'beige' }), WEDNESDAY).visual,
    ).toEqual({ kind: 'placeholder' });
  });

  it('renders a local-first sealed blob as a blob, not as a missing image', () => {
    // Private-mode bytes have no URL at all; only `HouseBlobImage` can open
    // them, so the card has to know the difference.
    expect(
      describeMaterialCard(row(), WEDNESDAY, { hasBlob: true }).visual,
    ).toEqual({ kind: 'blob' });
  });
});

describe('the store, and getting to it', () => {
  it('shows the vendor when the row has one', () => {
    expect(describeMaterialCard(row(LONDON_SOHO), WEDNESDAY).vendor).toBe(
      'Capital Tile + Stone',
    );
  });

  it('reports no vendor at all rather than an empty one', () => {
    // Null renders no row. A whitespace vendor would render an empty line and
    // a gap nobody can explain.
    expect(describeMaterialCard(row(), WEDNESDAY).vendor).toBeNull();
    expect(
      describeMaterialCard(row({ vendor: '   ' }), WEDNESDAY).vendor,
    ).toBeNull();
  });

  it('opens the product_url, and names the shop while doing it', () => {
    // This replaces the inert word "link", which every row announced and which
    // named nothing — so a member using VoiceOver heard "link" twenty times and
    // could not tell one shop from another.
    const { link } = describeMaterialCard(
      row({
        ...LONDON_SOHO,
        product_url: 'https://capitaltile.example/london-soho-8x8',
      }),
      WEDNESDAY,
    );
    expect(link?.url).toBe('https://capitaltile.example/london-soho-8x8');
    expect(link?.accessibilityLabel).toBe('Open Capital Tile + Stone');
  });

  it('falls back to the material’s name when the shop is unnamed', () => {
    const { link } = describeMaterialCard(
      row({ product_url: 'https://capitaltile.example/london-soho-8x8' }),
      WEDNESDAY,
    );
    expect(link?.accessibilityLabel).toBe(
      'Open the shop page for LONDON SOHO 8X8 MT',
    );
  });

  it('offers no button at all for a scheme it does not recognise', () => {
    // `Linking.openURL` hands whatever it is given straight to the OS. A
    // `javascript:` value that reached the column through an importer or a
    // paste would be ACTED on, under a label carrying a shop's name.
    for (const url of [
      // eslint-disable-next-line no-script-url -- the hazard IS the subject: a
      // rule that forbids writing this string also forbids writing the test
      // that proves we never open it.
      'javascript:alert(1)',
      'intent://scan/#Intent;scheme=zxing;end',
      'file:///etc/passwd',
      'not a url',
      '   ',
    ]) {
      expect(
        describeMaterialCard(row({ product_url: url }), WEDNESDAY).link,
      ).toBeNull();
    }
  });

  it('offers no button when the row has no link', () => {
    expect(describeMaterialCard(row(), WEDNESDAY).link).toBeNull();
  });
});
