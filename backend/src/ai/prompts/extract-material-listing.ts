/**
 * Moved to `@symply/contracts` when the DEVICE started reading product pages
 * too: a private-mode household has no Worker to do it, and a second prompt
 * against a second schema is a second answer to "what does this floor cost".
 * Re-exported from here so every Worker call site is untouched.
 */
export {
  EXTRACT_MATERIAL_LISTING_SCHEMA,
  EXTRACT_MATERIAL_LISTING_SYSTEM_PROMPT,
  buildExtractMaterialListingUserPrompt,
  type RawMaterialListing,
} from '@symply/contracts';

/**
 * Appearance and offer, derived from the same listing — migration 0164.
 *
 * Re-exported from beside the prompt so a reader who found the prompt finds the
 * code that decides what its answer MEANS. The prompt reports "12x24" and "in";
 * `toMillimetres` is what makes that 304.8 mm, and `normalizeMaterialSaleOffer`
 * is what refuses to believe a "50% OFF" badge that its own prices contradict.
 */
export {
  EMPTY_MATERIAL_APPEARANCE,
  EMPTY_MATERIAL_SALE_OFFER,
  colorSpecFor,
  hasSaleOffer,
  normalizeHexColor,
  normalizeMaterialAppearance,
  normalizeMaterialListingExtras,
  normalizeMaterialSaleOffer,
  toMillimetres,
  type MaterialAppearance,
  type MaterialSaleOffer,
} from '@symply/contracts';
