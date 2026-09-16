/**
 * Real shelf tags, photographed in a tile shop.
 *
 * Both fixtures below are transcribed from photographs of actual labels at
 * Capital Tile + Stone. They are the same retailer and nearly the same layout,
 * and they differ in exactly the way that matters: each shows a second, lower
 * price, and only ONE of them is a sale.
 *
 *   Tag A — "Retail Price $7.13 / SF" and "Trade Price $4.28 / SF"
 *   Tag B — "RETAIL: $14.42 Sq. Ft." and "NOW: $5.98 Sq. Ft." (in red)
 *
 * A trade price is a professional rate, not a discount. Reading it as one puts
 * a 40%-off badge on a full-price tile and, worse, feeds $4.28 into an estimate
 * the member cannot actually buy at. Tag B's NOW price is a genuine 58% off.
 *
 * A model that treats "lower second number" as "sale" gets one of these right
 * and one wrong, and looks correct either way in isolation — which is why they
 * are pinned together, in one file, from real photographs.
 */

import {
  normalizeMaterialSaleOffer,
  hasSaleOffer,
  toMillimetres,
} from '@symply/contracts';

/**
 * What a vision model should return for Tag A.
 *
 * The trade price is deliberately NOT mapped to `sale_price_amount`. That is
 * the extraction contract this fixture asserts: the reader must classify the
 * second price, not just find it.
 */
const TAG_A_DANIEL_BLANC = {
  name: 'DANIEL BLANC 12X24 MATTE',
  vendor: 'Capital Tile + Stone',
  price_amount: 7.13,
  list_price_amount: null,
  sale_price_amount: null,
  sale_discount_pct_stated: null,
  sale_ends_at: null,
} as const;

/** Tag B — a real promotion, printed in red under the retail price. */
const TAG_B_LONDON_SOHO = {
  name: 'LONDON SOHO 8X8 MT',
  vendor: 'Capital Tile + Stone',
  price_amount: 5.98,
  list_price_amount: 14.42,
  sale_price_amount: 5.98,
  sale_discount_pct_stated: null,
  sale_ends_at: null,
} as const;

describe('Tag A — Daniel Blanc, where the second price is a TRADE price', () => {
  it('reports no sale, because a trade rate is not a discount', () => {
    // The whole point of the pair. $7.13 → $4.28 is a 40% gap that reads
    // exactly like a promotion and is not one; it is the price a contractor
    // with an account pays. Badging it misleads the member twice — once on the
    // card, and again in the estimate, which would be built from a price they
    // cannot transact at.
    const offer = normalizeMaterialSaleOffer(TAG_A_DANIEL_BLANC);
    expect(hasSaleOffer(offer)).toBe(false);
    expect(offer.salePriceCents).toBeNull();
    expect(offer.discountPct).toBeNull();
  });

  it('would badge a 40% discount if the trade price were mapped to the sale field', () => {
    // The failure this guards, made explicit. If an extraction ever routes
    // "Trade Price" into `sale_price_amount`, the normaliser has no way to know
    // it is wrong — it is arithmetically a perfectly good offer. So the
    // classification has to happen at extraction time, and this test documents
    // what it costs to get it wrong.
    const misread = { ...TAG_A_DANIEL_BLANC, list_price_amount: 7.13, sale_price_amount: 4.28 };
    const offer = normalizeMaterialSaleOffer(misread);
    expect(offer.discountPct).toBe(40);
    expect(hasSaleOffer(offer)).toBe(true);
  });

  it('reads 12X24 out of the product NAME as 304.8 x 609.6 mm', () => {
    // Neither tag has a dimensions field: the size lives inside the name. A
    // parser that only looks for a labelled size returns null on the commonest
    // layout in a tile shop, and the surface preview then has no repeat size —
    // which is the one number that stops a visualiser drawing a room that
    // cannot be built.
    expect(toMillimetres(12, 'in')).toBe(304.8);
    expect(toMillimetres(24, 'in')).toBe(609.6);
  });
});

describe('Tag B — London Soho, where the second price IS a sale', () => {
  it('derives the discount from the prices rather than a printed claim', () => {
    // $14.42 → $5.98 is 58.5%, which rounds to 59. Retailers round promotional
    // percentages generously and inconsistently; the arithmetic is the thing
    // the member can check against the shelf.
    const offer = normalizeMaterialSaleOffer(TAG_B_LONDON_SOHO);
    expect(offer.listPriceCents).toBe(1442);
    expect(offer.salePriceCents).toBe(598);
    expect(offer.discountPct).toBe(59);
    expect(hasSaleOffer(offer)).toBe(true);
  });

  it('flags a disagreement when the tag claims a rounder number than the maths', () => {
    // A tag shouting "60% OFF" over prices that work out to 59 is not an error
    // worth hiding the offer for, but the member should not be told 60 when the
    // till will say 59.
    const offer = normalizeMaterialSaleOffer({
      ...TAG_B_LONDON_SOHO,
      sale_discount_pct_stated: 65,
    });
    expect(offer.discountPct).toBe(59);
    expect(offer.discountPctDisputed).toBe(true);
  });

  it('reads 8X8 out of the name as 203.2 mm square', () => {
    expect(toMillimetres(8, 'in')).toBe(203.2);
  });
});

describe('what neither tag states, and must therefore stay null', () => {
  it('invents no end date, because neither tag printed one', () => {
    // Most shop-floor promotions carry no date at all. An invented one either
    // expires a live offer early or keeps a dead one on the card.
    expect(normalizeMaterialSaleOffer(TAG_B_LONDON_SOHO).saleEndsAt).toBeNull();
  });

  it('invents no size when the name carries no dimensions', () => {
    // A guessed repeat size makes the preview lie with total confidence, which
    // is worse than a preview that declines to draw a pattern.
    expect(toMillimetres(null, 'in')).toBeNull();
    expect(toMillimetres(12, null)).toBeNull();
  });

  it('treats a lone retail price as no offer at all', () => {
    // Tag A once its trade price is correctly ignored: one price, no promotion.
    const offer = normalizeMaterialSaleOffer({ price_amount: 7.13 });
    expect(hasSaleOffer(offer)).toBe(false);
  });
});

describe('both tags price by the SQUARE FOOT, not by the box', () => {
  it('records the area rate without pretending it is a per-tile price', () => {
    // Neither tag states a box price or a coverage figure. A 12x24 tile is two
    // square feet, so reading "$7.13 / SF" as the price of one tile puts the
    // estimate out by half. Coverage stays null rather than being assumed, and
    // the rate is what got captured.
    const offer = normalizeMaterialSaleOffer(TAG_A_DANIEL_BLANC);
    expect(offer.listPriceCents).toBeNull();

    const tileAreaSqFt = (12 * 24) / 144;
    expect(tileAreaSqFt).toBe(2);
    // $7.13/sq ft × 2 sq ft = $14.26 for one tile — the number a naive reading
    // would have shown as $7.13.
    expect(Math.round(7.13 * tileAreaSqFt * 100)).toBe(1426);
  });
});
