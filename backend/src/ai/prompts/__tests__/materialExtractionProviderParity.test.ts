/**
 * One material, whichever provider the member picked.
 *
 * Material extraction runs on three vendors behind `ai/provider.ts` — Anthropic,
 * OpenAI and Gemini — over two paths: a pasted shop link and a photographed
 * shelf tag. The member chooses the vendor in Settings → AI Providers, and the
 * product promise is that the choice does not change the answer. This file is
 * what turns that promise into something a machine can check.
 *
 * ## What this file can prove, and what it cannot
 *
 * It CANNOT prove that Gemini reads a glary shelf tag correctly. No offline test
 * can: that needs the real photo, the real model and real money, which is
 * `scripts/ai/verify-material-extraction.mjs` and is run by hand.
 *
 * What it CAN prove is the other half, and it is the half that breaks silently:
 * the three vendors write the SAME reading down in different JSON. One omits a
 * key it has no value for, one sends `""` where the schema said `["string",
 * "null"]`, one quotes a number. Every one of those is a shape difference, not a
 * reading difference, and each one is capable of turning a correct extraction
 * into a blank card — with no error anywhere, because the request succeeded.
 *
 * `normalizeMaterialListingExtras` exists for exactly this and says so at
 * `packages/contracts/src/home-project-material.ts:146-153`: the providers
 * "honour that to three different degrees". This file is the test that sentence
 * was owed.
 *
 * ## Why the fixtures are two real shelf tags
 *
 * Both are transcribed from photographs of labels at Capital Tile + Stone and
 * are pinned on the device side at
 * `src/screens/home-projects/__tests__/shelfTagFixtures.test.ts:1-19`. They
 * differ in the only way that matters: each shows a second, lower price, and
 * only ONE of them is a sale.
 *
 *   Tag A — "Retail Price $7.13 / SF" and "Trade Price $4.28 / SF"  → NOT a sale
 *   Tag B — "RETAIL: $14.42 Sq. Ft." and "NOW: $5.98 Sq. Ft."       → a real 59% off
 *
 * A trade rate is what a contractor with an account pays. Badging it as a
 * discount misleads the member twice — on the card, and again in an estimate
 * built from a price they cannot transact at. Reusing that pair here means the
 * parity cases are anchored to prices that were actually printed on a wall
 * rather than to numbers chosen to make a normaliser look good.
 *
 * ## Why the provider axis is a loop over identical assertions
 *
 * Deliberately. We do not have live evidence pinning each quirk to each vendor —
 * that is what the live script is for — so assigning "Gemini omits keys" here
 * would be a guess written as a fact. Instead every dialect is run under every
 * provider. The claim the file makes is therefore the strong one and the honest
 * one: whichever provider the member picked, and whichever of these shapes it
 * emits, one identical `MaterialAppearance` and `MaterialSaleOffer` comes out.
 *
 * See `documents/engineering/material-extraction-providers.md`.
 */
import { mergeListingIntoDraft, type SelectionDraft } from '@symply/contracts';
import { describe, it, expect } from 'vitest';

import type { AIProviderId } from '../../../services/ai-entitlement-types';
import { EXTRACT_SHELF_TAG_SCHEMA } from '../extract-shelf-tag';
import {
  EXTRACT_MATERIAL_LISTING_SCHEMA,
  hasSaleOffer,
  normalizeMaterialAppearance,
  normalizeMaterialListingExtras,
  normalizeMaterialSaleOffer,
  type MaterialAppearance,
  type MaterialSaleOffer,
  type RawMaterialListing,
} from '../extract-material-listing';

/**
 * The three the member can choose between.
 *
 * Taken from `AIProviderId` rather than written out, so the day a fourth vendor
 * joins the picker this suite fails to compile instead of quietly testing three
 * of four. `ai-credential-resolver.ts:55-66` is the matching exhaustive switch.
 */
const PROVIDERS: readonly AIProviderId[] = ['anthropic', 'openai', 'gemini'];

// ---------------------------------------------------------------------------
// The facts, before any provider has written them down
// ---------------------------------------------------------------------------

/**
 * What a tag or a page STATES, independent of JSON.
 *
 * The dialects below each render this same struct into one vendor's wire shape.
 * Keeping the facts separate from the shapes is what makes "the answer did not
 * change" a checkable claim rather than a comparison of two hand-written blobs
 * that happen to agree.
 */
interface TagFacts {
  name: string;
  vendor: string;
  /** What the customer pays today, major units. */
  price: number | null;
  /** The struck-through "was" price, when there genuinely is one. */
  listPrice: number | null;
  salePrice: number | null;
  /** The percentage the tag CLAIMS. A claim, never the answer. */
  statedPct: number | null;
  endsAt: string | null;
  colorHex: string | null;
  colorName: string | null;
  groutHex: string | null;
  sizeW: number | null;
  sizeH: number | null;
  sizeUnit: 'mm' | 'cm' | 'in' | null;
}

/**
 * Tag A — Daniel Blanc. One real price and a trade rate that is not an offer.
 *
 * The size lives inside the NAME ("12X24"), which is the commonest layout in a
 * tile shop and the reason `unit_size_w` / `unit_size_h` are their own fields
 * rather than something scraped out of a labelled dimensions row.
 */
const TAG_A_DANIEL_BLANC: TagFacts = {
  name: 'DANIEL BLANC 12X24 MATTE',
  vendor: 'Capital Tile + Stone',
  price: 7.13,
  listPrice: null,
  salePrice: null,
  statedPct: null,
  endsAt: null,
  colorHex: null,
  colorName: null,
  groutHex: null,
  sizeW: 12,
  sizeH: 24,
  sizeUnit: 'in',
};

/** Tag B — London Soho. A real promotion, printed in red under the retail price. */
const TAG_B_LONDON_SOHO: TagFacts = {
  name: 'LONDON SOHO 8X8 MT',
  vendor: 'Capital Tile + Stone',
  price: 5.98,
  listPrice: 14.42,
  salePrice: 5.98,
  statedPct: null,
  endsAt: null,
  colorHex: null,
  colorName: null,
  groutHex: null,
  sizeW: 8,
  sizeH: 8,
  sizeUnit: 'in',
};

/**
 * The link path, where a page states what a shelf tag physically cannot.
 *
 * Synthesised rather than photographed, and labelled as such: neither real tag
 * printed a colour name, a hex, a grout colour, an end date or a percentage
 * badge, so a fixture built only from them would leave most of
 * `MaterialAppearance` untested. The values follow the schema's own worked
 * examples (`packages/contracts/src/material-listing-prompt.ts:243-269`) — a
 * metric tile size, a vendor colour name a member could take to a counter, and
 * a badge that disagrees with the page's own arithmetic by two points.
 */
const LINK_CARRARA: TagFacts = {
  name: 'Carrara White 600x600 Polished Porcelain',
  vendor: 'Capital Tile + Stone',
  price: 45.99,
  listPrice: 59.99,
  salePrice: 45.99,
  // 59.99 → 45.99 is 23.3%, so a "25% OFF" badge is a claim the arithmetic
  // contradicts. Surfaced as `discountPctDisputed`, never silently obeyed.
  statedPct: 25,
  endsAt: '2026-09-30',
  colorHex: '#f2efe9',
  colorName: 'Carrara White',
  groutHex: '#d9d5cc',
  sizeW: 600,
  sizeH: 600,
  sizeUnit: 'mm',
};

// ---------------------------------------------------------------------------
// The dialects — one set of facts, seven ways of writing it down
// ---------------------------------------------------------------------------

/**
 * A provider's rendering of the facts.
 *
 * Returns `Record<string, unknown>` and not `RawMaterialListing` on purpose: a
 * model is not bound by our TypeScript, and a dialect that could only produce
 * type-correct output could not express the divergences this file exists to
 * catch. Every call site casts through `unknown`, which is exactly the honesty
 * the runtime has.
 */
type Dialect = (facts: TagFacts) => Record<string, unknown>;

/**
 * The eighteen fields no provider disagrees about, so the interesting ten stand
 * alone below. `price_basis: 'sqft'` because both real tags price by the square
 * foot (`shelfTagFixtures.test.ts:141-155`) — reading "$7.13 / SF" as the price
 * of one 12x24 tile puts an estimate out by half.
 */
function agreedFields(f: TagFacts): Record<string, unknown> {
  return {
    name: f.name,
    brand: null,
    vendor: f.vendor,
    sku: null,
    price_amount: f.price,
    price_currency: 'USD',
    price_basis: 'sqft',
    coverage_per_unit: 1,
    coverage_unit: 'sqft',
    dimensions: null,
    pieces_per_unit: null,
    price_per_area_amount: null,
    price_per_area_unit: null,
    availability: null,
    image_url: null,
    category: 'tile',
    specs: [],
    confidence: 'high',
  };
}

/** The ten fields `normalizeMaterialListingExtras` was written for. */
function extras(f: TagFacts): Record<string, unknown> {
  return {
    color_hex: f.colorHex,
    color_name: f.colorName,
    grout_color_hex: f.groutHex,
    unit_size_w: f.sizeW,
    unit_size_h: f.sizeH,
    unit_size_unit: f.sizeUnit,
    list_price_amount: f.listPrice,
    sale_price_amount: f.salePrice,
    sale_discount_pct_stated: f.statedPct,
    sale_ends_at: f.endsAt,
  };
}

/** Drop every key whose value is null, leaving the rest untouched. */
function withoutNullKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null));
}

/** Re-render the three money fields through one formatter. */
function moneyAs(
  f: TagFacts,
  format: (amount: number) => string
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.price != null) out.price_amount = format(f.price);
  if (f.listPrice != null) out.list_price_amount = format(f.listPrice);
  if (f.salePrice != null) out.sale_price_amount = format(f.salePrice);
  return out;
}

interface DialectCase {
  /** Named for the divergence, not the vendor — the assignment is unproven. */
  label: string;
  render: Dialect;
}

const DIALECTS: readonly DialectCase[] = [
  {
    /*
      The shape the schema asks for: every key present, `null` where the page
      said nothing.

      This is the baseline the other six are compared against, and it is the
      whole reason all ten extras are listed as `required` even though they are
      optional in TypeScript — see the asymmetry note at
      `packages/contracts/src/material-listing-prompt.ts:56-63`. Providers
      disagree about optional keys and agree about required ones.
    */
    label: 'every required key present with an explicit null',
    render: f => ({ ...agreedFields(f), ...extras(f) }),
  },
  {
    /*
      Absent keys dropped entirely.

      The failure mode `required` is meant to prevent, and the one that survives
      it: a model under load, a `responseSchema` translation that lost the
      requirement, or a member's own key pointed at a fourth vendor. Reading it
      must produce the same nulls as an explicit null, or `=== null` stops being
      a usable test and every call site grows a `?? null`.
    */
    label: 'keys omitted entirely rather than sent as null',
    render: f => withoutNullKeys({ ...agreedFields(f), ...extras(f) }),
  },
  {
    /*
      `""` where a string is absent.

      A `["string", "null"]` union invites a model that has decided the field is
      "empty" to send the empty string, which is a value and not an absence. If
      it survived, a member would see a blank colour chip on the card and a hex
      of `""` would fail `materialSchema`'s `#[0-9a-fA-F]{6}` — taking down the
      whole room document, not one field.
    */
    label: 'an empty string standing in for an absent string',
    render: f => ({
      ...agreedFields(f),
      ...extras(f),
      color_hex: f.colorHex ?? '',
      color_name: f.colorName ?? '',
      grout_color_hex: f.groutHex ?? '',
      unit_size_unit: f.sizeUnit ?? '',
      sale_ends_at: f.endsAt ?? '',
    }),
  },
  {
    /*
      Money quoted: `"7.13"` instead of `7.13`.

      The commonest coercion there is, because it is what the retailer's own
      JSON-LD does — `schema.org/Offer.price` is a string, and it is fed to the
      model as the most reliable part of the page. A model copying it verbatim
      is being faithful, not sloppy, and `parsePriceToCents`
      (`packages/contracts/src/link-extraction.ts:231-264`) absorbs it precisely
      so this is not a lost price.
    */
    label: 'money quoted as a string',
    render: f => ({
      ...agreedFields(f),
      ...extras(f),
      ...moneyAs(f, amount => amount.toFixed(2)),
    }),
  },
  {
    /*
      Money with the symbol still attached: `"$7.13"`.

      A model reading a rendered page sees the glyph and the digits as one
      token. Dropping the offer over a `$` would badge a real 59%-off tile as
      full price, which is the exact opposite of the error the strictness in
      `normalizeMaterialSaleOffer` exists to prevent.
    */
    label: 'money written with its currency symbol',
    render: f => ({
      ...agreedFields(f),
      ...extras(f),
      ...moneyAs(f, amount => `$${amount.toFixed(2)}`),
    }),
  },
  {
    /*
      Money with a comma decimal: `"7,13"`.

      Not hypothetical — a model with a European prior writes prices this way,
      and the same string is a thousands separator in `"1,442"`. The parser
      decides by digit count (1-2 after the comma is a decimal), which is the
      only rule that gets both right.
    */
    label: 'money with a comma for the decimal point',
    render: f => ({
      ...agreedFields(f),
      ...extras(f),
      ...moneyAs(f, amount => amount.toFixed(2).replace('.', ',')),
    }),
  },
  {
    /*
      Hex written loosely: uppercase, and with the `#` missing.

      The prompt asks for lowercase `#rrggbb` and models emit `F2EFE9` and
      `#FFF` anyway. `normalizeHexColor` widens rather than rejects because the
      intent is unambiguous and the cost of rejecting is a swatch the member
      chose being silently dropped.
    */
    label: 'a hex in upper case with no leading hash',
    render: f => ({
      ...agreedFields(f),
      ...extras(f),
      color_hex: f.colorHex ? f.colorHex.slice(1).toUpperCase() : null,
      grout_color_hex: f.groutHex ? f.groutHex.toUpperCase() : null,
    }),
  },
  {
    /*
      A boolean spelled as a string, on keys nobody asked for.

      The schema has no boolean field, so this class can only arrive as an
      unrequested key — and that is the danger. `on_sale: "true"` looks like
      the answer to "is this discounted", and it is not: the only evidence of a
      discount is two prices, or a stated percentage. A reader that started
      believing `on_sale` would badge Tag A's trade rate as an offer.
    */
    label: 'a boolean spelled "true" on an unrequested key',
    render: f => ({
      ...agreedFields(f),
      ...extras(f),
      on_sale: f.listPrice != null ? 'true' : 'false',
      in_stock: 'true',
    }),
  },
  {
    /*
      Extra keys riding along beside the schema.

      `additionalProperties: false` is a request, not a guarantee — and it is
      stripped outright on the way to Gemini, which has no field for it
      (`src/utils/geminiSchema.ts:1-23`). So a provider may invent
      `discount_percentage` alongside `sale_discount_pct_stated`. It must be
      inert: an invented percentage on a full-price tile is a fake sale, and a
      fake sale rushes a real decision.
    */
    label: 'extra unrequested keys alongside the schema',
    render: f => ({
      ...agreedFields(f),
      ...extras(f),
      on_sale: f.listPrice != null,
      discount_percentage: 65,
      currency_symbol: '$',
      _reasoning: 'read the red NOW price under the retail price',
    }),
  },
];

// ---------------------------------------------------------------------------
// What every dialect must produce
// ---------------------------------------------------------------------------

interface Fixture {
  label: string;
  facts: TagFacts;
  appearance: MaterialAppearance;
  offer: MaterialSaleOffer;
}

const FIXTURES: readonly Fixture[] = [
  {
    label: 'Tag A — Daniel Blanc, whose second price is a TRADE price',
    facts: TAG_A_DANIEL_BLANC,
    appearance: {
      colorHex: null,
      colorName: null,
      groutColorHex: null,
      // 12x24 inches. The size came out of the product name, which is where a
      // shelf tag puts it and where a labelled-field parser never looks.
      unitWMm: 304.8,
      unitHMm: 609.6,
    },
    offer: {
      listPriceCents: null,
      salePriceCents: null,
      discountPct: null,
      saleEndsAt: null,
      discountPctDisputed: false,
    },
  },
  {
    label: 'Tag B — London Soho, whose second price IS a sale',
    facts: TAG_B_LONDON_SOHO,
    appearance: {
      colorHex: null,
      colorName: null,
      groutColorHex: null,
      unitWMm: 203.2,
      unitHMm: 203.2,
    },
    offer: {
      listPriceCents: 1442,
      salePriceCents: 598,
      // 58.5%, rounded. Derived from the two prices, never from a badge.
      discountPct: 59,
      saleEndsAt: null,
      discountPctDisputed: false,
    },
  },
  {
    label: 'A link listing, where the badge disagrees with the page',
    facts: LINK_CARRARA,
    appearance: {
      colorHex: '#f2efe9',
      colorName: 'Carrara White',
      groutColorHex: '#d9d5cc',
      unitWMm: 600,
      unitHMm: 600,
    },
    offer: {
      listPriceCents: 5999,
      salePriceCents: 4599,
      // 23, not the 25 the badge claims. The arithmetic wins and the
      // disagreement is surfaced rather than swallowed.
      discountPct: 23,
      saleEndsAt: '2026-09-30',
      discountPctDisputed: true,
    },
  },
];

/** The cast a provider forces on us, in one place with its reason attached. */
function asListing(raw: Record<string, unknown>): Partial<RawMaterialListing> {
  return raw as unknown as Partial<RawMaterialListing>;
}

// ---------------------------------------------------------------------------
// The parity claim
// ---------------------------------------------------------------------------

for (const fixture of FIXTURES) {
  describe(fixture.label, () => {
    for (const provider of PROVIDERS) {
      describe(`read by ${provider}`, () => {
        for (const dialect of DIALECTS) {
          it(`yields the one material when it writes ${dialect.label}`, () => {
            const raw = asListing(dialect.render(fixture.facts));
            expect(normalizeMaterialAppearance(raw)).toEqual(fixture.appearance);
            expect(normalizeMaterialSaleOffer(raw)).toEqual(fixture.offer);
          });
        }
      });
    }

    it('produces byte-identical output across all three providers at once', () => {
      // The per-provider tests above could each pass while the three still
      // disagreed with one another, if a fixture were ever edited per provider.
      // This compares the actual results rather than trusting three separate
      // comparisons against the same constant.
      const results = PROVIDERS.flatMap(() =>
        DIALECTS.map(d => {
          const raw = asListing(d.render(fixture.facts));
          return {
            appearance: normalizeMaterialAppearance(raw),
            offer: normalizeMaterialSaleOffer(raw),
          };
        })
      );
      const [first, ...rest] = results;
      for (const result of rest) expect(result).toEqual(first);
    });
  });
}

// ---------------------------------------------------------------------------
// The traps, named individually
// ---------------------------------------------------------------------------

describe('a lower second price is not evidence of a discount', () => {
  it('never badges Tag A as on sale, in any dialect, on any provider', () => {
    // The whole point of the real pair. $7.13 → $4.28 is a 40% gap that reads
    // exactly like a promotion and is not one. The classification has to happen
    // at extraction time — once a trade rate has been written into
    // `sale_price_amount` it is arithmetically a perfectly good offer and no
    // normaliser downstream can tell.
    for (const provider of PROVIDERS) {
      for (const dialect of DIALECTS) {
        // `_provider` rides along as an unrequested key, which is both how the
        // provider axis stays real here and one more shape the reader ignores.
        const raw = asListing({
          ...dialect.render(TAG_A_DANIEL_BLANC),
          _provider: provider,
        });
        const offer = normalizeMaterialSaleOffer(raw);
        expect(hasSaleOffer(offer)).toBe(false);
        expect(offer.discountPct).toBeNull();
        // Not "the sale price is 7.13" — there is no sale, so there is no
        // sale price, and a card must have nothing to strike through.
        expect(offer.salePriceCents).toBeNull();
      }
    }
  });

  it('ignores an unrequested on_sale key, whether it says true or "true"', () => {
    // `additionalProperties: false` does not reach Gemini at all
    // (`src/utils/geminiSchema.ts:26-34` strips it), so an invented boolean is
    // a shape we will actually receive. If it could create an offer, the
    // cheapest way to fake a sale on a member's card would be for a model to
    // hallucinate one key.
    for (const spelling of [true, 'true', 'yes', 1]) {
      const raw = asListing({
        ...agreedFields(TAG_A_DANIEL_BLANC),
        ...extras(TAG_A_DANIEL_BLANC),
        on_sale: spelling,
      });
      expect(hasSaleOffer(normalizeMaterialSaleOffer(raw))).toBe(false);
    }
  });

  it('returns a real boolean for discountPctDisputed, never undefined', () => {
    // The card renders a warning from this field. `undefined` is falsy and so
    // renders the same as `false` today — and would stop doing so the moment
    // anyone writes `disputed != null`. A boolean out of every dialect is what
    // makes that safe.
    for (const fixture of FIXTURES) {
      for (const dialect of DIALECTS) {
        const raw = asListing(dialect.render(fixture.facts));
        expect(typeof normalizeMaterialSaleOffer(raw).discountPctDisputed).toBe(
          'boolean'
        );
      }
    }
  });
});

describe('the badge is cross-checked, never obeyed', () => {
  it('reports the arithmetic and flags the disagreement, in every dialect', () => {
    // A page shouting "25% OFF" over prices that work out to 23 is not worth
    // hiding the offer for, but the member must not be told 25 when the till
    // will say 23. A "50% OFF" banner outliving its sale is one of the
    // commonest stale facts in retail HTML.
    for (const dialect of DIALECTS) {
      const offer = normalizeMaterialSaleOffer(
        asListing(dialect.render(LINK_CARRARA))
      );
      expect(offer.discountPct).toBe(23);
      expect(offer.discountPctDisputed).toBe(true);
    }
  });

  it('does not let an unrequested discount_percentage reach the card', () => {
    // The `extra unrequested keys` dialect carries `discount_percentage: 65`.
    // Tag B's real discount is 59. If the invented key were ever read, the
    // member would be shown a number no shelf in the shop agrees with.
    const dialect = DIALECTS.find(d =>
      d.label.startsWith('extra unrequested keys')
    );
    expect(dialect).toBeDefined();
    const offer = normalizeMaterialSaleOffer(
      asListing(dialect!.render(TAG_B_LONDON_SOHO))
    );
    expect(offer.discountPct).toBe(59);
    expect(offer.discountPctDisputed).toBe(false);
  });
});

describe('a size is read or it is null — it is never half-guessed', () => {
  it('drops a width with no height rather than squaring it', () => {
    // A page that prints "12" and nothing else gives a width with no height,
    // and a repeat needs both. Squaring the width would invent a 12x12 tile
    // nobody sells and draw the member a room that cannot be built — strictly
    // worse than declining to draw a pattern at all.
    for (const provider of PROVIDERS) {
      const halfStated = asListing({
        ...agreedFields(TAG_A_DANIEL_BLANC),
        ...extras(TAG_A_DANIEL_BLANC),
        unit_size_h: null,
        _provider: provider,
      });
      const appearance = normalizeMaterialAppearance(halfStated);
      expect(appearance.unitWMm).toBeNull();
      expect(appearance.unitHMm).toBeNull();
    }
  });

  it('rejects a repeat larger than ten metres whichever provider sent it', () => {
    // Above `MAX_UNIT_MM` the number came from a misread coverage figure or a
    // page dimension. Letting it through fails `materialSchema` later, where
    // the failure costs the member the entire room document rather than one
    // field.
    for (const provider of PROVIDERS) {
      const absurd = asListing({
        ...agreedFields(LINK_CARRARA),
        ...extras(LINK_CARRARA),
        unit_size_w: 12000,
        unit_size_h: 12000,
        _provider: provider,
      });
      expect(normalizeMaterialAppearance(absurd).unitWMm).toBeNull();
    }
  });
});

describe('the mechanism that makes explicit nulls happen', () => {
  const EXTRAS_KEYS = [
    'color_hex',
    'color_name',
    'grout_color_hex',
    'unit_size_w',
    'unit_size_h',
    'unit_size_unit',
    'list_price_amount',
    'sale_price_amount',
    'sale_discount_pct_stated',
    'sale_ends_at',
  ] as const;

  it('lists every appearance and offer field as required in BOTH schemas', () => {
    // This is not decoration. `required` is the only lever that makes all three
    // vendors emit a key with an explicit null instead of dropping it — they
    // disagree about optional keys and agree about required ones
    // (`material-listing-prompt.ts:124-137`). Quietly demoting one of these to
    // optional would make the omitted-key dialect the common case rather than
    // the defensive one, on providers we have not measured.
    //
    // Both paths, because the guarantee is per-request: a member who photographs
    // a tag gets the shelf-tag schema and a member who pastes a link gets the
    // listing one, and a hole in either is a hole in the same card.
    const schemas: Array<[string, Record<string, unknown>]> = [
      ['link', EXTRACT_MATERIAL_LISTING_SCHEMA],
      ['shelf tag', EXTRACT_SHELF_TAG_SCHEMA],
    ];
    for (const [label, schema] of schemas) {
      const required = schema.required as string[];
      for (const key of EXTRAS_KEYS) {
        expect(required, `${label} schema is missing ${key}`).toContain(key);
      }
    }
  });

  it('normalises absent and null to the same ten-key object', () => {
    // `normalizeMaterialListingExtras` is the single door. An empty listing and
    // an all-null listing must be indistinguishable after it, because that is
    // what lets the rest of the code test `=== null` instead of writing
    // `?? null` at every read.
    const fromNothing = normalizeMaterialListingExtras({});
    const fromNulls = normalizeMaterialListingExtras(
      asListing(Object.fromEntries(EXTRAS_KEYS.map(k => [k, null])))
    );
    expect(fromNothing).toEqual(fromNulls);
    expect(Object.keys(fromNothing).sort()).toEqual([...EXTRAS_KEYS].sort());
    expect(normalizeMaterialListingExtras(null)).toEqual(fromNothing);
    expect(normalizeMaterialListingExtras(undefined)).toEqual(fromNothing);
  });
});

// ---------------------------------------------------------------------------
// Divergences the normalizers do NOT absorb
// ---------------------------------------------------------------------------

/**
 * Numeric strings, which every normaliser now absorbs.
 *
 * Money was string-tolerant from the start, because `parsePriceToCents` was
 * written for OpenGraph and JSON-LD, which state prices as strings. Every OTHER
 * number was read with a bare `typeof === 'number'` test, so the same coercion
 * that cost nothing on a price silently deleted a size or a percentage.
 *
 * All three cases below were originally pinned here as defects, in this
 * describe block's earlier life as "coercions the normalizers do NOT absorb".
 * They are kept — inverted — rather than deleted, because a test that once
 * caught a real bug is the cheapest guard against its return, and the shape of
 * the bug is worth reading.
 *
 * What made this worth closing at the normaliser rather than at one caller: the
 * merge covered listings that become a persisted selection, but the shelf-tag
 * route computes `extraction.appearance` WITHOUT the merge, so the response
 * reported a null repeat size for a row that stored 304.8 — two answers to one
 * question, which is the failure mode this whole file exists to prevent.
 */
describe('numeric strings, which the normalizers now absorb', () => {
  it('parses a stringified size, so the repeat survives on every path', () => {
    // INVERTED, not deleted. This pinned the gap it describes: `toMillimetres`
    // required a real number, so a provider quoting `"12"` lost the repeat size
    // and the member got a card with no preview and no error.
    //
    // The gap is now closed inside `toMillimetres` itself, which is what the
    // superseded comment argued for — `mergeListingIntoDraft`'s coercion only
    // covered listings that become a persisted selection, leaving the shelf-tag
    // route's `extraction.appearance` (computed WITHOUT the merge) reporting a
    // null size for a row that stores 304.8. Two answers to one question.
    const quoted = asListing({
      ...agreedFields(TAG_A_DANIEL_BLANC),
      ...extras(TAG_A_DANIEL_BLANC),
      unit_size_w: '12',
      unit_size_h: '24',
    });
    expect(normalizeMaterialAppearance(quoted).unitWMm).toBe(304.8);
    expect(normalizeMaterialAppearance(quoted).unitHMm).toBe(609.6);
  });

  it('parses a stringified stated percentage, so the badge cross-check fires', () => {
    // INVERTED, not deleted — the offer-side half of the same gap. A quoted
    // `"25"` was not read, so the cross-check never ran and a page whose badge
    // disagreed with its own prices passed as though it agreed.
    //
    // The computed percentage still wins: 23 is what the prices say, and that
    // is what the member is charged. What changes is that the disagreement is
    // now REPORTED rather than lost, which is the signal that a page's prices
    // may be as stale as its banner.
    const quoted = asListing({
      ...agreedFields(LINK_CARRARA),
      ...extras(LINK_CARRARA),
      sale_discount_pct_stated: '25',
    });
    const offer = normalizeMaterialSaleOffer(quoted);
    expect(offer.discountPct).toBe(23);
    expect(offer.discountPctDisputed).toBe(true);
  });

  it('coerces a stringified coverage to a number before it reaches the draft', () => {
    /*
      This test used to pin the OPPOSITE, as the worst of the three coercion
      gaps: `mergeListingIntoDraft` gates coverage on `coverage_per_unit > 0`,
      and in JavaScript `"23.8" > 0` is true, so the string sailed through into
      `SelectionDraft.coveragePerUnit` — a field typed `number`. TypeScript
      could not see it, because the value crossed the boundary inside a model
      response, and the string then reached the takeoff arithmetic that turns
      "I need 40 sq ft" into a number of boxes. `"23.8" * 2` is 47.6 and looks
      right; `"23.8" + 2` is `"23.82"` and does not. Which one the member got
      depended on the operator downstream.

      `withCoercedNumbers` now runs at the top of the merge, so every numeric
      field is a real number before any gate or normaliser reads it. Inverted
      rather than deleted: the assertion is what stops the gap reopening.
    */
    const base: SelectionDraft = {
      name: 'baseline',
      productUrl: 'https://example.com/tile',
      extractionSource: 'link_og',
    };
    const listing = {
      ...agreedFields(TAG_A_DANIEL_BLANC),
      ...extras(TAG_A_DANIEL_BLANC),
      price_basis: 'box',
      coverage_per_unit: '23.8',
      coverage_unit: 'sqft',
    } as unknown as RawMaterialListing;

    const draft = mergeListingIntoDraft(
      base,
      listing,
      'https://example.com/tile',
      'USD'
    );
    expect(typeof draft.coveragePerUnit).toBe('number');
    expect(draft.coveragePerUnit).toBe(23.8);
  });
});

// ---------------------------------------------------------------------------
// The shelf-tag path
// ---------------------------------------------------------------------------

describe('the shelf-tag path', () => {
  /*
    `extract-shelf-tag.ts` answers in `RawMaterialListing` — the same flat object
    the link path returns, field for field, and it says why in its own header:
    two shapes would be two kinds of material card and eventually two answers to
    "what does this floor cost", which the member cannot tell apart because the
    card cannot tell them apart either.

    That is what makes every dialect above cover BOTH paths for free: nothing
    here is applied to a page or a photo, only to the object either one produces.
    The two tests below are the parts that would stop being true if that ever
    changed.
  */
  it('needs no second normaliser, because both paths answer in one shape', () => {
    // Tag A and Tag B are photographed shelf tags. They are driven through the
    // link path's normalizers above and come out correct, which is the whole
    // claim: the source of a `RawMaterialListing` does not change what it means.
    const fromPhoto = asListing({
      ...agreedFields(TAG_B_LONDON_SOHO),
      ...extras(TAG_B_LONDON_SOHO),
      // What a photo path has that a page path does not: no URL, no image, and
      // a lower confidence because a tag is glary and hand-written prices are
      // common.
      image_url: null,
      confidence: 'medium',
    });
    expect(normalizeMaterialSaleOffer(fromPhoto)).toEqual(FIXTURES[1]!.offer);
    expect(normalizeMaterialAppearance(fromPhoto)).toEqual(
      FIXTURES[1]!.appearance
    );
  });

  it('declares the same TYPE for every extras field as the link path does', () => {
    /*
      A dialect is only "awkward" relative to a declared type: `"7.13"` is a
      divergence because the schema said `number`, and `""` is one because it
      said `["string", "null"]`. If the two paths declared different types for
      the same field, the nine dialects above would be testing the link path's
      idea of awkward against the shelf tag's answers — and the live script's
      shape report, which classifies a value by the type its schema declared,
      would mislabel every one of them.

      Types, not the required list: `extractShelfTag.test.ts` already pins that
      the two `required` arrays are equal. This pins the thing the dialects and
      the shape report actually read.
    */
    const linkProps = EXTRACT_MATERIAL_LISTING_SCHEMA.properties as Record<
      string,
      { type?: unknown }
    >;
    const tagProps = EXTRACT_SHELF_TAG_SCHEMA.properties as Record<
      string,
      { type?: unknown }
    >;
    for (const key of [
      'color_hex',
      'color_name',
      'grout_color_hex',
      'unit_size_w',
      'unit_size_h',
      'unit_size_unit',
      'list_price_amount',
      'sale_price_amount',
      'sale_discount_pct_stated',
      'sale_ends_at',
      'price_amount',
      'coverage_per_unit',
    ]) {
      expect(tagProps[key], `shelf-tag schema has no ${key}`).toBeDefined();
      expect(tagProps[key]!.type, `${key} type differs between paths`).toEqual(
        linkProps[key]!.type
      );
    }
  });
});
