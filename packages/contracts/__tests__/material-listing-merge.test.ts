/**
 * A listing folded onto a draft.
 *
 * The interesting cases are all ones a real page produced. capitaltiles.ca
 * states the price three ways ($5.98/sq ft, $2.01/piece, $48.80/box), packs 16
 * tiles to a box, and lists nineteen specs including "Estimated Weight per Box
 * (lbs.)" — which is what broke the de-duplication the first time.
 */
import { describe, expect, it } from 'vitest';

import {
  mergeListingIntoDraft,
  type RawMaterialListing,
  type SelectionDraft,
} from '../src';

const BASE: SelectionDraft = {
  name: 'Hex Joy 9x10 Matte Finish Porcelain Tile',
  productUrl: 'https://capitaltiles.ca/products/hex-joy-9x10-matte-finish-porcelain-tile',
  vendor: 'capitaltiles.ca',
  extractionSource: 'link_og',
};

const LISTING: RawMaterialListing = {
  name: 'Hex Joy 9x10 Matte Finish Porcelain Tile',
  brand: 'Capital Tile',
  vendor: 'Capital Tiles CA',
  sku: 'HJ910MS',
  price_amount: 48.8,
  price_currency: 'CAD',
  price_basis: 'box',
  coverage_per_unit: 8.16,
  coverage_unit: 'sqft',
  dimensions: '9" x 10"',
  pieces_per_unit: 16,
  price_per_area_amount: 5.98,
  price_per_area_unit: 'sqft',
  availability: 'In stock',
  image_url: null,
  category: 'tile',
  specs: [
    { label: 'Material', value: 'Porcelain' },
    { label: 'Estimated Weight per Box (lbs.)', value: '30.86' },
  ],
  confidence: 'high',
};

const label = (draft: SelectionDraft, name: string) =>
  draft.specs?.find(s => s.label === name)?.value;

describe('the packaging facts no column can hold', () => {
  const card = mergeListingIntoDraft(BASE, LISTING, BASE.productUrl, 'CAD');

  /**
   * The regression. A `/per box/` de-duplication also matched "Estimated
   * Weight per Box (lbs.)", so the count of tiles in the box — the fact that
   * turns "40 sq ft" into "5 boxes, 80 tiles" — was silently dropped. Seen on
   * the device: nineteen specs, and this was not one of them.
   */
  it('keeps the piece count even next to a weight-per-box row', () => {
    expect(label(card, 'Pieces per box')).toBe('16');
    expect(label(card, 'Estimated Weight per Box (lbs.)')).toBe('30.86');
  });

  /** The shop did the division against its own rounding; take its number. */
  it("takes the shop's own per-square-foot price", () => {
    expect(label(card, 'Price per sq ft')).toBe('$5.98');
  });

  it('records stock status and the size', () => {
    expect(label(card, 'Availability')).toBe('In stock');
    expect(label(card, 'Size')).toBe('9" x 10"');
  });

  it('still fills the columns a budget line needs', () => {
    expect(card.unitPriceCents).toBe(4880);
    expect(card.unit).toBe('box');
    expect(card.coveragePerUnit).toBe(8.16);
    expect(card.extractionSource).toBe('link_ai');
  });
});

describe('what it refuses to duplicate or invent', () => {
  it('does not print a size the model already listed as a spec', () => {
    const card = mergeListingIntoDraft(
      BASE,
      {
        ...LISTING,
        specs: [{ label: 'Nominal Size', value: '9" x 10"' }],
      },
      BASE.productUrl,
      'CAD',
    );
    expect(card.specs?.filter(s => /size/i.test(s.label))).toHaveLength(1);
  });

  it('adds no packaging rows when the page stated none', () => {
    const card = mergeListingIntoDraft(
      BASE,
      {
        ...LISTING,
        pieces_per_unit: null,
        price_per_area_amount: null,
        price_per_area_unit: null,
        availability: null,
        dimensions: null,
        specs: [],
      },
      BASE.productUrl,
      'CAD',
    );
    expect(card.specs ?? []).toHaveLength(0);
  });

  /** Nineteen real specs plus the derived rows must not silently truncate. */
  it('carries a full retail spec table', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      label: `Spec ${i}`,
      value: String(i),
    }));
    const card = mergeListingIntoDraft(
      BASE,
      { ...LISTING, specs: many },
      BASE.productUrl,
      'CAD',
    );
    expect(card.specs!.length).toBeGreaterThanOrEqual(20);
  });
});
