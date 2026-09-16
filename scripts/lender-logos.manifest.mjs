/**
 * lender-logos.manifest.mjs — OPTIONAL source map for `normalize-lender-logos.mjs`.
 *
 * Two ways to feed the normalizer a logo for a lender slug (slugs live in
 * `src/utils/lender-logos.ts` → POPULAR_LENDERS):
 *
 *   A) DIRECT URL (automated): add an active entry below,
 *      `slug: 'https://…/logo.svg'`. The script downloads that URL and normalizes
 *      it. The URL must point at the IMAGE FILE itself (.svg/.png/…), not a web page.
 *
 *   B) REFERENCE PAGE (manual, one click): open the reference URL listed for the
 *      lender, download the file from it, and drop it into
 *      `scripts/lender-logo-sources/<slug>.<ext>`. A local file always wins over a
 *      URL here. This is the reliable route for Wikimedia file pages (those are
 *      HTML pages — use their "Original file" link to get the real image URL).
 *
 * Then run: `npm run logos:lenders`.
 *
 * ⚠ USAGE RIGHTS: bank names and logos are trademarks of their owners. The links
 * below only tell you WHERE a logo image is published (mostly Wikimedia Commons —
 * the same source this repo already used for utility logos, see
 * `src/utils/provider-logos.ts`). Wikimedia hosts many logos under a trademark/
 * "not eligible for copyright" rationale, but that is NOT a blanket licence for
 * commercial reuse — confirm each logo's terms (or use your own licensed copy)
 * before shipping it. Nothing here is downloaded or committed automatically.
 */

/** Active, DIRECT-image-URL entries the script will download. Empty by default. */
export const LENDER_LOGO_SOURCES = {
  // td: 'https://upload.wikimedia.org/…/TD_Bank.svg',   // ← paste an "Original file" URL
  // rbc: 'https://upload.wikimedia.org/…/RBC_2024_New_logo.svg',
};

/**
 * Verified reference pages (route B). Open, download the image, save as
 * `scripts/lender-logo-sources/<slug>.<ext>`, then run the script.
 * Verified for the major lenders; the rest fall back to the category indexes below.
 */
export const LENDER_LOGO_REFERENCES = {
  td: 'https://commons.wikimedia.org/wiki/File:TD_Bank.svg',
  rbc: 'https://commons.wikimedia.org/wiki/File:RBC_2024_New_logo.svg',
  scotiabank: 'https://commons.wikimedia.org/wiki/File:Scotiabank_logo.svg',
  bmo: 'https://commons.wikimedia.org/wiki/File:BMO_Logo.svg',
  cibc: 'https://en.wikipedia.org/wiki/File:CIBC_logo_2021.svg',
  'national-bank': 'https://commons.wikimedia.org/wiki/File:National_Bank_Of_Canada.svg',
  desjardins: 'https://commons.wikimedia.org/wiki/File:Desjardins_Group_logo.svg',
  tangerine: 'https://commons.wikimedia.org/wiki/File:Tangerine_Bank_logo.svg',
  simplii: 'https://commons.wikimedia.org/wiki/File:Simplii_Financial_Logo_2023.png',
  // Long tail (Equitable/EQ, Manulife, First National, MCAP, CMLS, Merix, RFA,
  // Home Trust, B2B, Laurentian, ATB, Motusbank, Meridian, Vancity, Coast Capital,
  // Servus, DUCA, Alterna, nesto, Neo, HSBC): look them up in the category indexes
  // below, or on the lender's own newsroom / brand page.
};

/** Umbrella indexes to find any Canadian lender logo not listed above. */
export const LENDER_LOGO_CATALOGS = [
  'https://commons.wikimedia.org/wiki/Category:Logos_of_banks_in_Canada',
  'https://commons.wikimedia.org/wiki/Category:SVG_logos_of_banks',
];
