/**
 * ShelfTagExtractionService — the member is standing in the shop.
 *
 * Fixture-driven and offline: every rule this feature exists to enforce is
 * checked against a payload, never against a live model. The payloads below are
 * what a vision model SHOULD return for two labels actually photographed at
 * Capital Tile + Stone, pinned alongside
 * `src/screens/home-projects/__tests__/shelfTagFixtures.test.ts`:
 *
 *   Tag A — "DANIEL BLANC 12X24 MATTE"  Retail $7.13 / SF, Trade $4.28 / SF
 *   Tag B — "LONDON SOHO 8X8 MT"        RETAIL $14.42 Sq. Ft., NOW $5.98 Sq. Ft.
 *
 * They are the same shop and nearly the same layout, and both show a lower
 * second price — but only Tag B is a sale. That pair is why these tests exist in
 * one file: a service that treats "lower second number" as "sale" gets one right
 * and one wrong and looks correct on either in isolation.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  EXTRACT_SHELF_TAG_REQUIRED_KEYS,
  EXTRACT_SHELF_TAG_SCHEMA,
  EXTRACT_SHELF_TAG_SYSTEM_PROMPT,
  type RawMaterialListing,
} from '../../../ai/prompts/extract-shelf-tag';
import type { AIProvider, GenerateResult } from '../../../ai/provider';
import type { Env } from '../../../types';
import { ValidationError } from '../../../utils/errors';
import {
  ShelfTagExtractionService,
  sizeFromName,
} from '../shelf-tag-extraction-service';

const ENV = {
  AIHOUSEKEEPER_BRIEFING_MODEL: 'primary-model',
  AIHOUSEKEEPER_NUDGE_MODEL: 'nudge-model',
  AIHOUSEKEEPER_FALLBACK_MODEL: 'fallback-model',
} as unknown as Env;

function service(ai?: AIProvider): ShelfTagExtractionService {
  return new ShelfTagExtractionService(ENV, ai);
}

/**
 * Tag A, read correctly.
 *
 * The trade price is deliberately NOT in `sale_price_amount` — it is a spec.
 * That is the extraction contract this fixture encodes: the reader classifies
 * the second price, it does not merely find it.
 */
const TAG_A_DANIEL_BLANC: Partial<RawMaterialListing> = {
  name: 'DANIEL BLANC 12X24 MATTE',
  brand: null,
  vendor: 'Capital Tile + Stone',
  price_amount: 7.13,
  price_currency: 'USD',
  price_basis: 'sqft',
  price_per_area_amount: 7.13,
  price_per_area_unit: 'sqft',
  coverage_per_unit: null,
  coverage_unit: null,
  dimensions: '12x24 in',
  category: 'tile',
  color_hex: '#d9d6d0',
  specs: [
    { label: 'Material', value: 'Porcelain' },
    { label: 'Finish', value: 'Matte' },
    { label: 'Origin', value: 'Italy' },
    { label: 'Usage', value: 'Floor, Wall' },
    { label: 'Trade price', value: '$4.28 / sq ft' },
  ],
  confidence: 'high',
};

/** Tag B — a real promotion, printed in red under the retail price. */
const TAG_B_LONDON_SOHO: Partial<RawMaterialListing> = {
  name: 'LONDON SOHO 8X8 MT',
  vendor: 'Capital Tile + Stone',
  price_amount: 5.98,
  price_currency: 'USD',
  price_basis: 'sqft',
  price_per_area_amount: 5.98,
  price_per_area_unit: 'sqft',
  list_price_amount: 14.42,
  sale_price_amount: 5.98,
  sale_discount_pct_stated: null,
  sale_ends_at: null,
  dimensions: '8x8 in',
  category: 'tile',
  // A multi-colour encaustic has no single colour; the reader returned none.
  color_hex: null,
  color_name: 'Soho',
  specs: [
    { label: 'Material', value: 'Porcelain' },
    { label: 'Usage', value: 'Wall, Floor' },
    { label: 'Origin', value: 'Italy' },
    { label: 'Pattern', value: 'Encaustic, multi-colour' },
  ],
  confidence: 'high',
};

describe('Tag A — the second price is a TRADE price', () => {
  it('reports no sale at all', () => {
    // WHY: $7.13 → $4.28 is a 40% gap that reads exactly like a promotion and is
    // not one — it is what a contractor with an account pays. Badging it
    // misleads the member twice: once on the card, and again in the estimate,
    // which would be built from a price they cannot transact at.
    const { offer, notices } = service().toExtraction(TAG_A_DANIEL_BLANC);
    expect(offer.salePriceCents).toBeNull();
    expect(offer.listPriceCents).toBeNull();
    expect(offer.discountPct).toBeNull();
    expect(notices).not.toContain('sale_offer');
  });

  it('keeps the trade price as a spec, where it cannot be read as a discount', () => {
    // WHY: it is a real fact the member may want at the counter. Dropping it
    // loses information; promoting it to `sale_price_amount` loses money.
    const extraction = service().toExtraction(TAG_A_DANIEL_BLANC);
    const draft = service().toSelectionDraft(extraction, 'USD');
    expect(draft.specs).toContainEqual({ label: 'Trade price', value: '$4.28 / sq ft' });
  });

  it('prices the card at the RETAIL rate, not the trade rate', () => {
    // WHY: `unit_price_cents` is the only number an estimate reads. $4.28 there
    // would build a renovation budget the member cannot buy at.
    const extraction = service().toExtraction(TAG_A_DANIEL_BLANC);
    const draft = service().toSelectionDraft(extraction, 'USD');
    expect(draft.unitPriceCents).toBe(713);
  });

  it('reads 12X24 out of the NAME as 304.8 x 609.6 mm', () => {
    // WHY: neither real tag has a dimensions field — the size lives inside the
    // product name. A reader that only looks for a labelled size returns null on
    // the commonest layout in a tile shop, and the surface preview then has no
    // repeat size, which is the one number that stops a visualiser drawing a
    // room that cannot be built.
    const { appearance, notices } = service().toExtraction({
      ...TAG_A_DANIEL_BLANC,
      // Exactly as both real tags come back: no stated size fields at all.
      unit_size_w: null,
      unit_size_h: null,
      unit_size_unit: null,
    });
    expect(appearance.unitWMm).toBe(304.8);
    expect(appearance.unitHMm).toBe(609.6);
    expect(notices).toContain('size_from_name');
  });
});

describe('Tag B — the second price IS a sale', () => {
  it('derives 59% from the two prices rather than from a printed claim', () => {
    // WHY: $14.42 → $5.98 is 58.5%, which rounds to 59. Retailers round
    // promotional percentages generously and inconsistently; the arithmetic is
    // the thing the member can check against the shelf.
    const { offer, notices } = service().toExtraction(TAG_B_LONDON_SOHO);
    expect(offer.listPriceCents).toBe(1442);
    expect(offer.salePriceCents).toBe(598);
    expect(offer.discountPct).toBe(59);
    expect(notices).toContain('sale_offer');
  });

  it('drops to low confidence when the tag’s badge contradicts its own prices', () => {
    // WHY: a tag shouting "65% OFF" over prices that work out to 59 has at least
    // one stale printed fact on it — possibly the prices. The member should be
    // nudged to look again while they are still standing in front of it.
    const { offer, confidence, notices } = service().toExtraction({
      ...TAG_B_LONDON_SOHO,
      sale_discount_pct_stated: 65,
    });
    expect(offer.discountPct).toBe(59);
    expect(offer.discountPctDisputed).toBe(true);
    expect(confidence).toBe('low');
    expect(notices).toContain('discount_pct_disputed');
  });

  it('reads 8X8 out of the name as 203.2 mm square', () => {
    const { appearance } = service().toExtraction(TAG_B_LONDON_SOHO);
    expect(appearance.unitWMm).toBe(203.2);
    expect(appearance.unitHMm).toBe(203.2);
  });

  it('carries no colour hex for a patterned tile, but keeps the colourway name', () => {
    // WHY: London Soho is a multi-colour encaustic. One confident hex renders
    // the preview as a flat beige floor that looks nothing like the sample in
    // the member's hand — while the name is the string they say at the counter.
    const { appearance } = service().toExtraction(TAG_B_LONDON_SOHO);
    expect(appearance.colorHex).toBeNull();
    expect(appearance.colorName).toBe('Soho');
  });

  it('invents no end date, because the tag printed none', () => {
    // WHY: most shop-floor promotions carry no date. An invented one either
    // expires a live offer early or keeps a dead one on the card.
    expect(service().toExtraction(TAG_B_LONDON_SOHO).offer.saleEndsAt).toBeNull();
  });
});

describe('both tags price by the SQUARE FOOT, not by the box', () => {
  it('leaves coverage null when the tag states none', () => {
    // WHY: neither tag states a box price or a coverage figure. A guessed
    // coverage misprices an entire floor and is indistinguishable from a read
    // one on the card.
    const { listing, notices } = service().toExtraction(TAG_A_DANIEL_BLANC);
    expect(listing.coverage_per_unit).toBeNull();
    expect(listing.coverage_unit).toBeNull();
    expect(listing.pieces_per_unit).toBeNull();
    expect(notices).toContain('area_rate_without_coverage');
  });

  it('records the area rate as one square foot, never as one tile', () => {
    // WHY: a 12x24 tile is two square feet, so reading "$7.13 / SF" as the price
    // of one tile halves the estimate for the whole floor. The shared merge
    // turns an area basis into a coverage of exactly 1 of that unit, which is
    // what makes this card comparable to one imported from a link.
    const extraction = service().toExtraction(TAG_A_DANIEL_BLANC);
    const draft = service().toSelectionDraft(extraction, 'USD');
    expect(draft.unit).toBe('sq ft');
    expect(draft.coveragePerUnit).toBe(1);
    expect(draft.coverageUnit).toBe('sqft');
    // The naive misreading, stated so the cost is on the record: $7.13/sq ft on
    // a two-square-foot tile is $14.26 for one piece.
    expect(Math.round(7.13 * ((12 * 24) / 144) * 100)).toBe(1426);
  });

  it('flags a price whose qualifier could not be read', () => {
    // WHY: a real number nobody can spend. Per-square-foot and per-piece differ
    // by a factor of two on this exact tile, so the card must say so rather than
    // pick one.
    const { confidence, notices } = service().toExtraction({
      ...TAG_A_DANIEL_BLANC,
      price_basis: null,
    });
    expect(notices).toContain('price_basis_unknown');
    expect(confidence).toBe('medium');
  });
});

describe('two tags in one frame', () => {
  it('stays low confidence even though every field is filled in', () => {
    // WHY: shelf labels sit inches apart and a photo routinely catches a
    // neighbour. A merged pair — Tag A's name over Tag B's sale prices — is a
    // coherent, entirely fictional product. Nothing in the payload can reveal
    // the blend, so the model's own "low" is the ONLY surviving evidence and
    // must never be raised by a service that sees a complete-looking record.
    const merged: Partial<RawMaterialListing> = {
      ...TAG_A_DANIEL_BLANC,
      list_price_amount: 14.42,
      sale_price_amount: 5.98,
      price_amount: 5.98,
      confidence: 'low',
    };
    const { confidence } = service().toExtraction(merged);
    expect(confidence).toBe('low');
  });

  it('does not promote an extraction that stated no confidence', () => {
    // WHY: providers disagree about optional keys, and an answer that never
    // claimed to be reliable has not earned a "high" from the parser.
    expect(service().toExtraction({ ...TAG_A_DANIEL_BLANC, confidence: undefined }).confidence).toBe(
      'low'
    );
  });
});

describe('glare must not fabricate', () => {
  it('passes a partly-read name through verbatim, never completed', () => {
    // WHY: on Tag A a specular highlight covers part of "DANIEL". A name silently
    // completed to a plausible different word is a different product, and on the
    // card it looks exactly as trustworthy as a correct one.
    const { listing } = service().toExtraction({
      ...TAG_A_DANIEL_BLANC,
      name: 'BLANC 12X24 MATTE',
      confidence: 'low',
    });
    expect(listing.name).toBe('BLANC 12X24 MATTE');
    expect(listing.name).not.toMatch(/DANIEL/i);
  });

  it('names an unreadable tag honestly instead of guessing a product', () => {
    // WHY: the fallback has to be obviously a placeholder. "Unnamed shelf tag"
    // asks to be edited; any plausible tile name would be believed.
    const extraction = service().toExtraction({
      ...TAG_A_DANIEL_BLANC,
      name: null,
      confidence: 'medium',
    });
    expect(extraction.listing.name).toBeNull();
    expect(extraction.notices).toContain('name_unreadable');
    expect(extraction.confidence).toBe('low');
    expect(service().toSelectionDraft(extraction, 'USD').name).toBe('Unnamed shelf tag');
  });

  it('refuses a tag that yielded neither a name nor a price', () => {
    // WHY: that card is nothing the member can use, and it would sit in their
    // project looking like a real option. Everything short of total failure
    // degrades instead — a name with no price is a reminder, a price with no
    // name is an editable placeholder.
    expect(() => service().toExtraction({ vendor: 'Capital Tile + Stone' })).toThrow(
      ValidationError
    );
    expect(() => service().toExtraction({ name: 'LONDON SOHO 8X8 MT' })).not.toThrow();
    expect(() => service().toExtraction({ price_amount: 7.13 })).not.toThrow();
  });
});

describe('one shape for all three providers', () => {
  it('fills every schema key with an explicit null when a provider omits it', () => {
    // WHY: Anthropic, OpenAI and Gemini honour `required` to three different
    // degrees. An omitted key and an explicit null are the same fact to a human
    // and different values to `=== null`, so normalising here is what lets one
    // parser read all three without a per-provider branch.
    const { listing } = service().toExtraction({ name: 'LONDON SOHO 8X8 MT' });
    expect(Object.keys(listing).sort()).toEqual([...EXTRACT_SHELF_TAG_REQUIRED_KEYS].sort());
    for (const [key, value] of Object.entries(listing)) {
      if (key === 'name' || key === 'specs' || key === 'confidence') continue;
      expect(value, `${key} should be null, not undefined`).toBeNull();
    }
    expect(listing.specs).toEqual([]);
  });

  it('never returns an image URL, whatever the model claims', () => {
    // WHY: a photograph of a label carries no URL. A QR code decoded on a guess
    // sends the member to a different tile.
    const { listing } = service().toExtraction({
      ...TAG_A_DANIEL_BLANC,
      image_url: 'https://example.com/not-this-tile.jpg',
    });
    expect(listing.image_url).toBeNull();
  });

  it('produces a draft with no product URL', () => {
    // WHY: a shelf tag has no page. An empty `product_url` would give the card a
    // "View listing" link to nowhere, which is worse than no link.
    const draft = service().toSelectionDraft(service().toExtraction(TAG_A_DANIEL_BLANC), 'USD');
    expect('productUrl' in draft).toBe(false);
    expect(draft.extractionSource).toBe('shelf_tag_ai');
    expect(draft.vendor).toBe('Capital Tile + Stone');
  });
});

describe('sizeFromName — the size lives inside the product name', () => {
  it('reads the two real tags', () => {
    expect(sizeFromName('DANIEL BLANC 12X24 MATTE')).toEqual({ unitWMm: 304.8, unitHMm: 609.6 });
    expect(sizeFromName('LONDON SOHO 8X8 MT')).toEqual({ unitWMm: 203.2, unitHMm: 203.2 });
  });

  it('converts fractional inches', () => {
    // WHY: shop labels write "7-1/2 in x 48 in" for vinyl plank. A parser that
    // only accepts decimals drops the width and the preview loses its repeat.
    expect(sizeFromName('Aspen Oak 7-1/2 in x 48 in Plank')).toEqual({
      unitWMm: 190.5,
      unitHMm: 1219.2,
    });
  });

  it('treats a bare pair at or above 100 as millimetres', () => {
    // WHY: "600x600" is a porcelain slab in mm and "12x24" is a tile in inches;
    // guessing the wrong convention scales the preview by 25.
    expect(sizeFromName('Grigio 600x600')).toEqual({ unitWMm: 600, unitHMm: 600 });
    expect(sizeFromName('Grigio 600x600 mm')).toEqual({ unitWMm: 600, unitHMm: 600 });
  });

  it('honours an inch mark over the bare-number convention', () => {
    expect(sizeFromName('Subway 3" x 12"')).toEqual({ unitWMm: 76.2, unitHMm: 304.8 });
  });

  it('returns null when the name states no size', () => {
    // WHY: a guessed repeat size makes the preview lie with total confidence,
    // which is worse than a preview that declines to draw a pattern.
    expect(sizeFromName('DANIEL BLANC MATTE')).toBeNull();
    expect(sizeFromName(null)).toBeNull();
    expect(sizeFromName('')).toBeNull();
  });

  it('yields to a size the tag actually printed', () => {
    // WHY: a stated size is evidence; one parsed out of a name is inference.
    const { appearance, notices } = service().toExtraction({
      ...TAG_A_DANIEL_BLANC,
      name: 'DANIEL BLANC 12X24 MATTE',
      unit_size_w: 600,
      unit_size_h: 600,
      unit_size_unit: 'mm',
    });
    expect(appearance.unitWMm).toBe(600);
    expect(notices).not.toContain('size_from_name');
  });
});

// ---------- provider wiring (mocked AIProvider; no network) ----------

function toolResult(input: unknown): GenerateResult {
  return {
    content: [{ type: 'tool_use', id: 't1', name: 'output', input }],
    stopReason: 'tool_use',
    model: 'test-model',
  };
}

function mockProvider(result: GenerateResult): {
  provider: AIProvider;
  generate: ReturnType<typeof vi.fn>;
} {
  const generate = vi.fn(async () => result);
  return { provider: { generate } as unknown as AIProvider, generate };
}

/** A real JPEG magic-number prefix, so the media-type sniffer has something to read. */
function jpegBase64(): string {
  const bytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe('extractFromPhoto — provider wiring', () => {
  it('forces the output tool with the shelf-tag schema and sends the photo', async () => {
    // WHY: extraction quality hinges entirely on this wiring. A free-form answer
    // would have to be guessed at by the parser, and a guessed price is money.
    const { provider, generate } = mockProvider(toolResult(TAG_A_DANIEL_BLANC));
    const extraction = await service(provider).extractFromPhoto({
      photoBase64: jpegBase64(),
      declaredMimeType: 'image/png',
      householdId: 'h1',
      userId: 'u1',
    });

    const args = generate.mock.calls[0]?.[0] as {
      systemPrompt: string;
      tools: Array<{ name: string; input_schema: unknown }>;
      toolChoice: { type: string; name: string };
      messages: Array<{ content: Array<{ type: string; source?: { media_type: string } }> }>;
    };
    expect(args.systemPrompt).toBe(EXTRACT_SHELF_TAG_SYSTEM_PROMPT);
    expect(args.tools).toHaveLength(1);
    expect(args.tools[0]?.input_schema).toEqual(EXTRACT_SHELF_TAG_SCHEMA);
    expect(args.toolChoice).toEqual({ type: 'tool', name: 'output' });
    // Declared png, real bytes jpeg: the sniffed type is what goes on the wire,
    // because a mismatch is hard-rejected and surfaces as "could not read that
    // photo" — and a camera roll is full of mislabelled files.
    const image = args.messages[0]?.content.find((b) => b.type === 'image');
    expect(image?.source?.media_type).toBe('image/jpeg');
    expect(extraction.offer.discountPct).toBeNull();
  });

  it('asks for a retake when the model answered without the tool', async () => {
    // WHY: the member is standing in the shop. "Try one label, straight on" is
    // an action they can take in two seconds; a stack trace is not.
    const { provider } = mockProvider({
      content: [{ type: 'text', text: 'I see a tile.' }],
      stopReason: 'end_turn',
      model: 'test-model',
    });
    await expect(
      service(provider).extractFromPhoto({
        photoBase64: jpegBase64(),
        declaredMimeType: 'image/jpeg',
        householdId: 'h1',
        userId: 'u1',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('refuses a PDF before it reaches a provider', async () => {
    // WHY: the PDF branch the statement readers use is Anthropic-specific, and
    // this extractor must behave the same on all three providers. A PDF is also
    // not something a member holds up in a shop.
    const { provider, generate } = mockProvider(toolResult(TAG_A_DANIEL_BLANC));
    await expect(
      service(provider).extractFromPhoto({
        photoBase64: btoa('%PDF-1.7 fake'),
        declaredMimeType: 'image/jpeg',
        householdId: 'h1',
        userId: 'u1',
      })
    ).rejects.toThrow(ValidationError);
    expect(generate).not.toHaveBeenCalled();
  });
});
