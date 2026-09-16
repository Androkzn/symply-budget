/**
 * "Add from camera" for renovation materials — the shop-floor path.
 *
 * The member is standing in an aisle holding a tile sample. They photograph the
 * shelf label and get back the same material the paste-a-link path produces,
 * without typing a forty-character product name and a per-square-foot price into
 * a phone one-handed.
 *
 * Modelled on `BudgetLoanExtractionService` / `BCAssessmentExtractionService`:
 * one image, one forced `output` tool, a flat schema, and a normalisation pass
 * at the boundary. Everything below is arranged around three facts about this
 * particular input.
 *
 * 1. **The classification the model makes cannot be redone here.** Both real
 *    shelf tags this was built from show a lower second price and only one is a
 *    sale (`extract-shelf-tag.ts` has the pair). Once "Trade Price $4.28" has
 *    been written into `sale_price_amount`, `normalizeMaterialSaleOffer` computes
 *    a confident 40% off and is arithmetically right to. So this service does not
 *    try to second-guess the offer — it hands the model's answer straight to the
 *    shared normaliser and reports what came back, including when the tag's own
 *    badge disagreed with its own prices.
 *
 * 2. **Normalisation is the contract's job, not this file's.** `toMillimetres`,
 *    `normalizeMaterialAppearance`, `normalizeMaterialSaleOffer` and
 *    `mergeListingIntoDraft` all live in `@symply/contracts` because the DEVICE
 *    runs them too (a private-mode household has no Worker). A second
 *    implementation of "is this on sale" or "how big is one tile" is a second
 *    answer to a question the member is about to spend money on.
 *
 * 3. **Degrade, never fail.** A tag that yields only a name and a price is still
 *    worth a card — the member is in the shop and their alternative is typing.
 *    Every field is allowed to be null; only a response with neither a name nor
 *    a price is rejected, because that is a card with nothing on it.
 *
 * The one piece of real logic here is {@link sizeFromName}: neither real tag has
 * a dimensions field, because on a shelf label the size lives INSIDE the product
 * name ("DANIEL BLANC 12X24 MATTE"). A reader that only looks at a labelled size
 * field returns null on the commonest layout in a tile shop, and the surface
 * preview then has no repeat size at all.
 */
import { mergeListingIntoDraft, type SelectionDraft } from '@symply/contracts';

import { generateWithFallback } from '../../ai/fallback';
import { resolveMediaType, type SupportedMediaType } from '../../ai/media-type';
/*
  The normalisers are imported from BESIDE the prompt, not from the contracts
  barrel, because that re-export exists precisely so a reader who found the
  prompt finds the code that decides what its answer MEANS: the prompt reports
  "12x24" and "in"; `toMillimetres` is what makes that 304.8 mm, and
  `normalizeMaterialSaleOffer` is what refuses to believe a badge its own prices
  contradict.
*/
import {
  hasSaleOffer,
  normalizeMaterialAppearance,
  normalizeMaterialListingExtras,
  normalizeMaterialSaleOffer,
  toMillimetres,
  type MaterialAppearance,
  type MaterialSaleOffer,
} from '../../ai/prompts/extract-material-listing';
import {
  EXTRACT_SHELF_TAG_SCHEMA,
  EXTRACT_SHELF_TAG_SYSTEM_PROMPT,
  buildExtractShelfTagUserPrompt,
  type RawMaterialListing,
} from '../../ai/prompts/extract-shelf-tag';
import type { AIProvider, GenerateMessage } from '../../ai/provider';
import { createProviderAdapter } from '../../ai/provider-factory';
import type { Env } from '../../types';
import { ValidationError } from '../../utils/errors';
import { resolveProviderApiKey } from '../ai-credential-resolver';
import { usageRecorderFor } from '../ai-usage-service';

/** Only still pictures. A shelf tag is a photo; there is no PDF of a shelf. */
export type ShelfTagMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Machine-readable reasons the member should glance back at the shelf.
 *
 * Codes rather than sentences: the member is in a shop, the app is choosing
 * between a warning banner and a silent card, and a string it has to pattern
 * match is a string that stops matching the first time this file is edited.
 * Every code below is DERIVED from the extraction — none is invented by the
 * model, so none can be hallucinated.
 */
export type ShelfTagNotice =
  /** Glare or an obstruction ate the name. The card cannot be checked against the shelf. */
  | 'name_unreadable'
  /** No legible price. The card is a reminder, not an estimate line. */
  | 'price_missing'
  /** A price with no readable qualifier — nobody knows what one unit buys. */
  | 'price_basis_unknown'
  /** Priced per unit AREA with no coverage stated. Normal on a tile tag, and the app must not show it as a per-item price. */
  | 'area_rate_without_coverage'
  /** A genuine before-and-after promotion, already checked by the shared normaliser. */
  | 'sale_offer'
  /** The tag's printed percentage contradicts its own two prices. */
  | 'discount_pct_disputed'
  /** The repeat size came out of the product NAME, not a labelled size field. */
  | 'size_from_name';

/**
 * What one photographed tag yields.
 *
 * `listing` is the SAME flat shape the paste-a-link path returns, field for
 * field, so both paths can be folded into a material by the same merge function
 * — and so a card cannot betray which path made it.
 */
export interface ShelfTagExtraction {
  listing: RawMaterialListing;
  appearance: MaterialAppearance;
  offer: MaterialSaleOffer;
  /** Never higher than the model's own claim; see {@link deriveConfidence}. */
  confidence: 'high' | 'medium' | 'low';
  notices: ShelfTagNotice[];
}

/**
 * A shelf tag has no URL.
 *
 * `SelectionDraft.productUrl` is required because the link path always has one.
 * Writing `''` into `product_url` would give the card a "View listing" link to
 * nowhere, which is worse than no link — so the field is dropped on the way out
 * and the caller never has to remember to strip it.
 */
export type ShelfTagSelectionDraft = Omit<SelectionDraft, 'productUrl'>;

/** `high`/`medium`/`low` ranked so a floor can be applied without a lookup. */
const CONFIDENCE_RANK: Record<'high' | 'medium' | 'low', number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * `12X24`, `8X8`, `7-1/2 in x 48 in`, `600x600 mm`, `12" x 24"`.
 *
 * A whole number, an optional decimal, and an optional `-1/2`-style fraction —
 * shop labels write "7-1/2 in x 48 in" for vinyl plank and a parser that only
 * accepts decimals silently drops the width.
 */
const SIZE_NUMBER = String.raw`\d+(?:\.\d+)?(?:[-\s]\d+\s*\/\s*\d+)?`;
const SIZE_UNIT = String.raw`(?:"|''|in\b|inch(?:es)?\b|mm\b|cm\b)`;
const SIZE_IN_NAME = new RegExp(
  `(${SIZE_NUMBER})\\s*(${SIZE_UNIT})?\\s*[x×]\\s*(${SIZE_NUMBER})\\s*(${SIZE_UNIT})?`,
  'i'
);

/**
 * A bare pair at or above this is millimetres, below it is inches.
 *
 * "600x600" is a porcelain slab in mm; "12x24" is a tile in inches. Nobody sells
 * a hundred-inch tile and nobody writes a 12 mm tile, so the gap between the two
 * conventions is wide enough to read without a unit — which matters because the
 * commonest tile-shop name states neither.
 */
const BARE_NUMBER_IS_MM_AT = 100;

/** "7-1/2" → 7.5. Returns null for anything that is not a positive number. */
function parseSizeNumber(raw: string): number | null {
  const text = raw.trim();
  const fraction = /^(\d+(?:\.\d+)?)[-\s](\d+)\s*\/\s*(\d+)$/.exec(text);
  if (fraction) {
    const [, whole, num, den] = fraction;
    const denominator = Number(den);
    if (!denominator) return null;
    const value = Number(whole) + Number(num) / denominator;
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeSizeUnit(raw: string | undefined): 'mm' | 'cm' | 'in' | null {
  if (!raw) return null;
  const unit = raw.trim().toLowerCase();
  if (unit === 'mm') return 'mm';
  if (unit === 'cm') return 'cm';
  return 'in'; // `"`, `''`, `in`, `inch`, `inches`
}

/**
 * The repeat size hiding inside the product name.
 *
 * Neither real tag has a dimensions row: "DANIEL BLANC 12X24 MATTE" IS the size
 * statement. A reader that only looks for a labelled field returns null on the
 * commonest tile-shop layout, and the surface preview then has no repeat size —
 * the one number that stops a visualiser drawing a room that cannot be built.
 *
 * Conversion goes through the shared {@link toMillimetres}, which also enforces
 * the 10 m ceiling `materialSchema` applies; a size above it came from a misread
 * and would fail the Room Surface Model's own validation later, where the cost
 * is the member's whole room document rather than one field.
 */
export function sizeFromName(
  name: string | null | undefined
): { unitWMm: number; unitHMm: number } | null {
  if (typeof name !== 'string' || !name.trim()) return null;
  const match = SIZE_IN_NAME.exec(name);
  if (!match) return null;

  const w = parseSizeNumber(match[1]);
  const h = parseSizeNumber(match[3]);
  if (w == null || h == null) return null;

  const unit =
    normalizeSizeUnit(match[2]) ??
    normalizeSizeUnit(match[4]) ??
    (w >= BARE_NUMBER_IS_MM_AT || h >= BARE_NUMBER_IS_MM_AT ? 'mm' : 'in');

  const unitWMm = toMillimetres(w, unit);
  const unitHMm = toMillimetres(h, unit);
  // Both or neither, exactly as `normalizeMaterialAppearance` insists: a repeat
  // needs two sides, and squaring the one we got would invent a tile nobody sells.
  if (unitWMm == null || unitHMm == null) return null;
  return { unitWMm, unitHMm };
}

/**
 * The confidence the member actually sees.
 *
 * Starts from the model's own claim and only ever moves DOWN. A reader that
 * missed the glare it was told to report is not made more trustworthy by this
 * function, but a reader that read cleanly and then produced something we can
 * see is unusable should not keep its "high".
 */
function deriveConfidence(
  claimed: unknown,
  listing: RawMaterialListing,
  offer: MaterialSaleOffer
): 'high' | 'medium' | 'low' {
  // An extraction that did not state a confidence has not earned one.
  let level: 'high' | 'medium' | 'low' =
    claimed === 'high' || claimed === 'medium' || claimed === 'low' ? claimed : 'low';

  const floor = (to: 'medium' | 'low') => {
    if (CONFIDENCE_RANK[level] > CONFIDENCE_RANK[to]) level = to;
  };

  // No name: glare took it, or two tags could not be told apart. Either way the
  // member cannot check the card against the label in front of them.
  if (!listing.name) floor('low');
  // The tag's own badge contradicts its own prices, so at least one printed fact
  // on it is stale — including, possibly, the prices.
  if (offer.discountPctDisputed) floor('low');
  // A price with no readable qualifier is a real number nobody can spend: on a
  // 12x24 tile, per-square-foot and per-piece differ by a factor of two.
  if (listing.price_amount != null && !listing.price_basis) floor('medium');

  return level;
}

/** Every notice is derived, so none can be hallucinated. See {@link ShelfTagNotice}. */
function deriveNotices(
  listing: RawMaterialListing,
  offer: MaterialSaleOffer,
  sizeCameFromName: boolean
): ShelfTagNotice[] {
  const notices: ShelfTagNotice[] = [];
  if (!listing.name) notices.push('name_unreadable');
  if (listing.price_amount == null) notices.push('price_missing');
  if (listing.price_amount != null && !listing.price_basis) {
    notices.push('price_basis_unknown');
  }
  if (
    (listing.price_basis === 'sqft' || listing.price_basis === 'm2') &&
    listing.coverage_per_unit == null
  ) {
    notices.push('area_rate_without_coverage');
  }
  if (hasSaleOffer(offer)) notices.push('sale_offer');
  if (offer.discountPctDisputed) notices.push('discount_pct_disputed');
  if (sizeCameFromName) notices.push('size_from_name');
  return notices;
}

/**
 * Fill in every key the provider dropped.
 *
 * The schema marks all of them `required`, but Anthropic, OpenAI and Gemini
 * honour that to three different degrees. Normalising absent → null here means
 * one shape reaches the rest of the code, so `=== null` is a usable test and no
 * caller writes `?? null` at every read. The offer/appearance keys are handled
 * by the contract's own `normalizeMaterialListingExtras`, which is the same
 * function the link path uses.
 */
function normalizeListing(raw: Partial<RawMaterialListing> | null | undefined): RawMaterialListing {
  const l = raw ?? {};
  const specs = Array.isArray(l.specs)
    ? l.specs
        .filter((s): s is { label: string; value: string } =>
          Boolean(s && typeof s.label === 'string' && typeof s.value === 'string')
        )
        .map((s) => ({ label: s.label.slice(0, 40), value: s.value.slice(0, 60) }))
        .slice(0, 20)
    : [];

  return {
    name: l.name ?? null,
    brand: l.brand ?? null,
    vendor: l.vendor ?? null,
    sku: l.sku ?? null,
    price_amount: l.price_amount ?? null,
    price_currency: l.price_currency ?? null,
    price_basis: l.price_basis ?? null,
    coverage_per_unit: l.coverage_per_unit ?? null,
    coverage_unit: l.coverage_unit ?? null,
    dimensions: l.dimensions ?? null,
    pieces_per_unit: l.pieces_per_unit ?? null,
    price_per_area_amount: l.price_per_area_amount ?? null,
    price_per_area_unit: l.price_per_area_unit ?? null,
    availability: l.availability ?? null,
    // Always null: a photograph of a label carries no URL, and a QR code decoded
    // on a guess sends the member to a different tile.
    image_url: null,
    category: l.category ?? null,
    specs,
    confidence: l.confidence === 'high' || l.confidence === 'medium' ? l.confidence : 'low',
    ...normalizeMaterialListingExtras(l),
  };
}

export class ShelfTagExtractionService {
  private env: Env;
  private injectedAi?: AIProvider;

  /** `aiProvider` is injectable for tests; production call sites omit it. */
  constructor(env: Env, aiProvider?: AIProvider) {
    this.env = env;
    this.injectedAi = aiProvider;
  }

  /**
   * Anthropic bound to the acting user — their own connected key when present,
   * the managed key otherwise. Same resolution as every other extraction
   * service, so BYOK and spend accounting behave identically here.
   */
  private async aiFor(
    householdId: string,
    userId: string | null | undefined
  ): Promise<AIProvider> {
    if (this.injectedAi) return this.injectedAi;
    const { apiKey } = await resolveProviderApiKey(this.env, userId, 'anthropic');
    return createProviderAdapter({
      provider: 'anthropic',
      apiKey,
      options: {
        onUsage: usageRecorderFor(this.env, {
          feature: 'home_project_shelf_tag',
          householdId,
          userId: userId ?? null,
        }),
      },
    });
  }

  /**
   * Read one photographed shelf label.
   *
   * `declaredMimeType` is what the client claims; the real bytes are sniffed via
   * the shared `resolveMediaType`, because a file named `.png` that holds JPEG
   * bytes is hard-rejected by the model API and surfaced to the member as a
   * generic "could not read that photo" — a camera roll is full of such files.
   */
  async extractFromPhoto(input: {
    photoBase64: string;
    declaredMimeType: ShelfTagMediaType;
    householdId: string;
    userId: string;
    hint?: string | null;
  }): Promise<ShelfTagExtraction> {
    const mime = this.resolveImageMediaType(input.photoBase64, input.declaredMimeType);

    const messages: GenerateMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: input.photoBase64 } },
          { type: 'text', text: buildExtractShelfTagUserPrompt({ hint: input.hint }) },
        ],
      },
    ];

    const ai = await this.aiFor(input.householdId, input.userId);
    const result = await generateWithFallback(
      ai,
      this.env.AIHOUSEKEEPER_BRIEFING_MODEL || this.env.AIHOUSEKEEPER_NUDGE_MODEL,
      this.env.AIHOUSEKEEPER_FALLBACK_MODEL,
      {
        systemPrompt: EXTRACT_SHELF_TAG_SYSTEM_PROMPT,
        messages,
        tools: [
          {
            name: 'output',
            description: 'Return the shelf tag as a material, matching the JSON schema.',
            input_schema: EXTRACT_SHELF_TAG_SCHEMA,
          },
        ],
        // Forced, never free-form: a model that answers in prose here produces a
        // material the parser has to guess at, and a guessed price is money.
        toolChoice: { type: 'tool', name: 'output' },
        maxTokens: 2048,
      }
    );

    const toolBlock = result.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new ValidationError(
        'Could not read that shelf tag. Try one label, straight on, without glare.'
      );
    }

    return this.toExtraction(toolBlock.input as Partial<RawMaterialListing>);
  }

  /**
   * The normalisation boundary. Public so the tests can drive it from fixtures
   * with no provider at all — every rule this feature exists to enforce is
   * checkable without a network call.
   */
  toExtraction(raw: Partial<RawMaterialListing> | null | undefined): ShelfTagExtraction {
    const listing = normalizeListing(raw);

    // A card with neither a name nor a price is nothing the member can use, and
    // it would sit in their project looking like a real option. Everything less
    // total than that degrades instead: a name with no price is a reminder, a
    // price with no name is an editable placeholder.
    if (!listing.name && listing.price_amount == null) {
      throw new ValidationError(
        'Could not read that shelf tag. Try one label, straight on, without glare.'
      );
    }

    const stated = normalizeMaterialAppearance(listing);
    // Only consulted when the tag stated no size of its own — a printed size
    // always beats one parsed out of a name.
    const fromName = stated.unitWMm == null ? sizeFromName(listing.name) : null;
    const appearance: MaterialAppearance = fromName
      ? { ...stated, unitWMm: fromName.unitWMm, unitHMm: fromName.unitHMm }
      : stated;

    // Handed straight to the shared normaliser. It refuses to believe a badge
    // its own prices contradict, and it is the SAME code the device and the link
    // path run — two implementations of "is this on sale" are two answers to a
    // question the member is about to spend money on.
    const offer = normalizeMaterialSaleOffer(listing);

    return {
      listing,
      appearance,
      offer,
      confidence: deriveConfidence(listing.confidence, listing, offer),
      notices: deriveNotices(listing, offer, fromName != null),
    };
  }

  /**
   * Fold the extraction into the same draft shape the link importer produces.
   *
   * `mergeListingIntoDraft` is the shared function, called with an empty page
   * URL because there is no page: it degrades to null for the image and the
   * hostname-derived vendor, leaving the tag's own vendor to win. Doing the
   * merge here rather than in the route is what makes the two paths produce
   * identical materials — including `price_basis` becoming a coverage of 1 sq ft
   * on a tag priced by the foot, which is the difference between a right and a
   * halved estimate.
   */
  toSelectionDraft(
    extraction: ShelfTagExtraction,
    projectCurrency: string
  ): ShelfTagSelectionDraft {
    const base: SelectionDraft = {
      name: extraction.listing.name?.trim() || 'Unnamed shelf tag',
      productUrl: '',
      extractionSource: 'shelf_tag_ai',
    };
    const merged = mergeListingIntoDraft(base, extraction.listing, '', projectCurrency);
    const { productUrl: _productUrl, ...draft } = merged;
    return { ...draft, extractionSource: 'shelf_tag_ai' };
  }

  /**
   * Images only.
   *
   * `generateToolFromDocument` (the PDF branch the statement readers use) is
   * Anthropic-specific, and this extractor is required to behave the same on all
   * three providers. A PDF is also not a thing a member holds up in a shop, so
   * refusing it here is a clear message rather than a confusing one from a model.
   */
  private resolveImageMediaType(
    base64: string,
    declared: ShelfTagMediaType
  ): ShelfTagMediaType {
    const resolved: SupportedMediaType = resolveMediaType(base64, declared);
    if (resolved === 'application/pdf') {
      throw new ValidationError('Take a photo of the shelf label — a PDF cannot be read here.');
    }
    return resolved;
  }
}
