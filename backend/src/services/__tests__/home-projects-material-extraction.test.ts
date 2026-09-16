/**
 * The pure half of "paste a shop link" — price parsing, basis→coverage folding
 * and image resolution.
 *
 * These are unit-testable precisely because they touch no network, and they are
 * worth testing because each one is a place where a plausible wrong answer
 * reaches the member's budget: a price off by 1000×, a per-square-foot price
 * treated as a per-box price, a logo stored as the product photo.
 */
import { describe, it, expect } from 'vitest';

import type { RawMaterialListing } from '../../ai/prompts/extract-material-listing';
import {
  absoluteImageUrl,
  mergeListingIntoDraft,
  parsePriceToCents,
} from '../home-projects-service';

const EMPTY_LISTING: RawMaterialListing = {
  name: null,
  brand: null,
  vendor: null,
  sku: null,
  price_amount: null,
  price_currency: null,
  price_basis: null,
  coverage_per_unit: null,
  coverage_unit: null,
  // Added when the DEVICE started reading pages too and the schema widened to
  // take everything a retail listing states — see `material-listing-prompt`.
  dimensions: null,
  pieces_per_unit: null,
  price_per_area_amount: null,
  price_per_area_unit: null,
  availability: null,
  image_url: null,
  category: null,
  specs: [],
  confidence: 'low',
};

const BASE = {
  name: 'Fallback name',
  productUrl: 'https://shop.example.com/tile',
  extractionSource: 'link_og',
};

describe('parsePriceToCents', () => {
  it.each([
    ['45.99', 4599],
    ['$45.99', 4599],
    ['USD 45.99', 4599],
    ['45', 4500],
    ['0', 0],
    ['0.05', 5],
  ])('reads %s as %i cents', (input, expected) => {
    expect(parsePriceToCents(input)).toBe(expected);
  });

  it('reads a European decimal comma', () => {
    expect(parsePriceToCents('45,99 €')).toBe(4599);
  });

  it('reads a thousands comma as grouping, not as a decimal point', () => {
    // "1,234" is one thousand two hundred, not 1.234 — a 1000× error into the
    // budget if the comma were taken as a decimal separator.
    expect(parsePriceToCents('1,234')).toBe(123400);
  });

  it('disambiguates 1,234.56 from 1.234,56 by which separator comes last', () => {
    expect(parsePriceToCents('$1,234.56')).toBe(123456);
    expect(parsePriceToCents('1.234,56 €')).toBe(123456);
  });

  it('accepts a number as well as a string', () => {
    expect(parsePriceToCents(45.99)).toBe(4599);
  });

  it.each([[null], [undefined], [''], ['Call for pricing'], ['—']])(
    'returns null for %s rather than zero',
    (input) => {
      // Zero is a price. "We could not read a price" is not, and the card must
      // be able to tell the member which one happened.
      expect(parsePriceToCents(input as string | null)).toBeNull();
    }
  );

  it('refuses a negative price', () => {
    expect(parsePriceToCents(-5)).toBeNull();
  });
});

describe('absoluteImageUrl', () => {
  it('resolves a relative path against the page', () => {
    expect(absoluteImageUrl('/img/tile.jpg', 'https://shop.example.com/p/123')).toBe(
      'https://shop.example.com/img/tile.jpg'
    );
  });

  it('keeps an absolute https url', () => {
    expect(absoluteImageUrl('https://cdn.example.com/a.jpg', 'https://shop.example.com/p')).toBe(
      'https://cdn.example.com/a.jpg'
    );
  });

  it('refuses a non-https scheme', () => {
    // data: and http: would both be stored and later fetched server-side.
    expect(absoluteImageUrl('http://cdn.example.com/a.jpg', 'https://shop.example.com/p')).toBeNull();
    expect(absoluteImageUrl('data:image/png;base64,AAA', 'https://shop.example.com/p')).toBeNull();
  });

  it('returns null for nothing', () => {
    expect(absoluteImageUrl(undefined, 'https://shop.example.com/p')).toBeNull();
  });
});

describe('mergeListingIntoDraft — price basis decides comparability', () => {
  it('treats a per-square-foot price as covering one square foot', () => {
    const merged = mergeListingIntoDraft(
      BASE,
      { ...EMPTY_LISTING, name: 'Slate', price_amount: 4.29, price_basis: 'sqft' },
      BASE.productUrl,
      'USD'
    );
    expect(merged.unitPriceCents).toBe(429);
    expect(merged.coveragePerUnit).toBe(1);
    expect(merged.coverageUnit).toBe('sqft');
    expect(merged.unit).toBe('sq ft');
  });

  it('pairs a per-case price with the coverage from the page', () => {
    const merged = mergeListingIntoDraft(
      BASE,
      {
        ...EMPTY_LISTING,
        name: 'Aspen Oak',
        price_amount: 69,
        price_basis: 'case',
        coverage_per_unit: 23.8,
        coverage_unit: 'sqft',
      },
      BASE.productUrl,
      'USD'
    );
    expect(merged.unitPriceCents).toBe(6900);
    expect(merged.coveragePerUnit).toBe(23.8);
    expect(merged.coverageUnit).toBe('sqft');
    expect(merged.unit).toBe('case');
  });

  it('gives a per-piece product no coverage at all', () => {
    const merged = mergeListingIntoDraft(
      BASE,
      { ...EMPTY_LISTING, name: 'Faucet', price_amount: 189, price_basis: 'each' },
      BASE.productUrl,
      'USD'
    );
    expect(merged.unit).toBe('each');
    expect(merged.coveragePerUnit).toBeUndefined();
    expect(merged.coverageUnit).toBeUndefined();
  });

  it('takes coverage even when the page states no basis', () => {
    const merged = mergeListingIntoDraft(
      { ...BASE },
      { ...EMPTY_LISTING, coverage_per_unit: 2.2, coverage_unit: 'm2' },
      BASE.productUrl,
      'USD'
    );
    expect(merged.coveragePerUnit).toBe(2.2);
  });

  it('ignores a zero or negative coverage', () => {
    const merged = mergeListingIntoDraft(
      BASE,
      { ...EMPTY_LISTING, price_basis: 'box', coverage_per_unit: 0, coverage_unit: 'm2' },
      BASE.productUrl,
      'USD'
    );
    expect(merged.coveragePerUnit).toBeUndefined();
  });

  it('surfaces a foreign currency instead of silently converting it', () => {
    const merged = mergeListingIntoDraft(
      BASE,
      { ...EMPTY_LISTING, price_amount: 45.99, price_currency: 'eur', price_basis: 'box' },
      BASE.productUrl,
      'USD'
    );
    // There is no rate source here; the honest move is to show the member the
    // currency the shop quoted and let them judge.
    expect(merged.specs?.[0]).toEqual({ label: 'Listed in', value: 'EUR' });
    expect(merged.unitPriceCents).toBe(4599);
  });

  it('says nothing about currency when it matches the project', () => {
    const merged = mergeListingIntoDraft(
      BASE,
      { ...EMPTY_LISTING, price_amount: 45.99, price_currency: 'USD', price_basis: 'box' },
      BASE.productUrl,
      'usd'
    );
    expect(merged.specs ?? []).toHaveLength(0);
  });

  it('keeps the OpenGraph values the model could not improve on', () => {
    const merged = mergeListingIntoDraft(
      { ...BASE, unitPriceCents: 5000, imageUrl: 'https://cdn.example.com/og.jpg' },
      { ...EMPTY_LISTING, name: 'Better name' },
      BASE.productUrl,
      'USD'
    );
    expect(merged.name).toBe('Better name');
    expect(merged.unitPriceCents).toBe(5000);
    expect(merged.imageUrl).toBe('https://cdn.example.com/og.jpg');
  });

  it('falls back to the shop hostname for the vendor', () => {
    const merged = mergeListingIntoDraft(BASE, EMPTY_LISTING, BASE.productUrl, 'USD');
    expect(merged.vendor).toBe('shop.example.com');
  });

  it('clamps spec text and drops half-empty rows', () => {
    const merged = mergeListingIntoDraft(
      BASE,
      {
        ...EMPTY_LISTING,
        specs: [
          { label: 'x'.repeat(80), value: 'y'.repeat(200) },
          { label: 'Finish', value: '' },
          { label: '', value: 'Polished' },
        ],
      },
      BASE.productUrl,
      'USD'
    );
    expect(merged.specs).toHaveLength(1);
    expect(merged.specs![0]!.label).toHaveLength(40);
    expect(merged.specs![0]!.value).toHaveLength(60);
  });

  /**
   * Twenty, not ten.
   *
   * Ten was chosen when the model was told to pick "the specs that DECIDE this
   * purchase". A real tile page states nineteen a member could act on —
   * material, finish, thickness, nominal AND actual size, colour, origin, tile
   * use, edge, shade variation, PEI, breaking strength, slip resistance, DCOF,
   * sq ft per piece, weights — and cutting that in half was choosing for them.
   * The cap still exists so a page with a hundred rows cannot flood the card.
   */
  it('caps the spec list at twenty rows', () => {
    const merged = mergeListingIntoDraft(
      BASE,
      {
        ...EMPTY_LISTING,
        specs: Array.from({ length: 40 }, (_, i) => ({ label: `L${i}`, value: `V${i}` })),
      },
      BASE.productUrl,
      'USD'
    );
    expect(merged.specs).toHaveLength(20);
  });

  it('marks the row as AI-extracted', () => {
    const merged = mergeListingIntoDraft(BASE, EMPTY_LISTING, BASE.productUrl, 'USD');
    expect(merged.extractionSource).toBe('link_ai');
  });
});
