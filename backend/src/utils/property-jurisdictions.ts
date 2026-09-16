/**
 * Household → property jurisdiction resolution (Worker side).
 *
 * The canonical registry of "how does property assessment work where this
 * household actually is" lives in `@symply/contracts`
 * (packages/contracts/src/property-jurisdiction.ts) and is shared with the app.
 * This module is the thin backend adapter over it:
 *
 *   1. normalize whatever is stored in `households.country` /
 *      `households.state_province` (codes, full names, French names, common
 *      abbreviations) into the registry's `CA-BC` style key, and
 *   2. look the household up (membership-scoped) so an extraction handler can
 *      resolve a jurisdiction from a householdId alone.
 *
 * Resolution is deliberately best-effort: a household with no address, an
 * unsupported region, or a transient DB error yields `null`, and every caller
 * must fall back to jurisdiction-neutral behaviour rather than assuming British
 * Columbia — assuming BC is the exact bug this module exists to remove.
 */
import { resolvePropertyJurisdiction, type PropertyJurisdiction } from '@symply/contracts';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';


import { households, householdMembers } from '../db/schema';

/** English, French and abbreviated region names → the registry's region code. */
const REGION_CODE_BY_NAME: Readonly<Record<string, string>> = {
  'british columbia': 'BC',
  'colombie britannique': 'BC',
  'colombie-britannique': 'BC',
  bc: 'BC',
  alberta: 'AB',
  ab: 'AB',
  saskatchewan: 'SK',
  sask: 'SK',
  sk: 'SK',
  manitoba: 'MB',
  man: 'MB',
  mb: 'MB',
  ontario: 'ON',
  ont: 'ON',
  on: 'ON',
  quebec: 'QC',
  québec: 'QC',
  qc: 'QC',
  pq: 'QC',
  'new brunswick': 'NB',
  'nouveau-brunswick': 'NB',
  'nouveau brunswick': 'NB',
  nb: 'NB',
  'nova scotia': 'NS',
  'nouvelle-écosse': 'NS',
  'nouvelle ecosse': 'NS',
  ns: 'NS',
  'prince edward island': 'PE',
  "île-du-prince-édouard": 'PE',
  'ile du prince edouard': 'PE',
  pei: 'PE',
  pe: 'PE',
  'newfoundland and labrador': 'NL',
  newfoundland: 'NL',
  'terre-neuve-et-labrador': 'NL',
  nfld: 'NL',
  nl: 'NL',
  yukon: 'YT',
  'yukon territory': 'YT',
  yt: 'YT',
  yk: 'YT',
  'northwest territories': 'NT',
  'territoires du nord-ouest': 'NT',
  nwt: 'NT',
  nt: 'NT',
  nunavut: 'NU',
  nu: 'NU',
};

/** Country names/abbreviations → the ISO code the registry is keyed by. */
const COUNTRY_CODE_BY_NAME: Readonly<Record<string, string>> = {
  ca: 'CA',
  can: 'CA',
  canada: 'CA',
  us: 'US',
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  'united states': 'US',
  'united states of america': 'US',
};

function normalizeKey(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** `"Canada"` / `"ca"` → `"CA"`. Null when we cannot tell. */
export function normalizePropertyCountryCode(value: string | null | undefined): string | null {
  const key = normalizeKey(value);
  if (!key) return null;
  return COUNTRY_CODE_BY_NAME[key] ?? (key.length === 2 ? key.toUpperCase() : null);
}

/** `"British Columbia"` / `"bc"` / `"Colombie-Britannique"` → `"BC"`. */
export function normalizePropertyRegionCode(value: string | null | undefined): string | null {
  const key = normalizeKey(value);
  if (!key) return null;
  return REGION_CODE_BY_NAME[key] ?? (key.length === 2 ? key.toUpperCase() : null);
}

/**
 * Resolve a jurisdiction from a raw address pair. Normalizes both halves first,
 * and defaults an unset country to Canada when the region is a recognized
 * Canadian province — older households were created before `country` was
 * captured, and "BC with no country" must still resolve to British Columbia.
 */
export function resolveJurisdictionFromAddress(
  country: string | null | undefined,
  region: string | null | undefined
): PropertyJurisdiction | null {
  const regionCode = normalizePropertyRegionCode(region);
  if (!regionCode) return null;

  const countryCode =
    normalizePropertyCountryCode(country) ??
    (Object.values(REGION_CODE_BY_NAME).includes(regionCode) ? 'CA' : null);
  if (!countryCode) return null;

  return resolvePropertyJurisdiction(countryCode, regionCode);
}

/**
 * Resolve the jurisdiction for a household the user actually belongs to.
 *
 * Membership-scoped on purpose: extraction handlers call this before the
 * service-layer access check runs, so a non-member must not be able to probe a
 * household's province. Never throws — a missing household, a missing
 * membership, an unsupported region or a DB error all resolve to `null`, which
 * every caller treats as "use the generic Canadian prompt".
 */
export async function resolveHouseholdPropertyJurisdiction(
  database: D1Database,
  householdId: string,
  userId: string
): Promise<PropertyJurisdiction | null> {
  try {
    const db = drizzle(database);
    const row = await db
      .select({
        country: households.country,
        stateProvince: households.state_province,
      })
      .from(households)
      .innerJoin(householdMembers, eq(householdMembers.household_id, households.id))
      .where(and(eq(households.id, householdId), eq(householdMembers.user_id, userId)))
      .get();

    if (!row) return null;
    return resolveJurisdictionFromAddress(row.country, row.stateProvince);
  } catch (error) {
    console.error('[PROPERTY-JURISDICTION] Resolution failed:', error);
    return null;
  }
}

/**
 * The subset of a jurisdiction worth returning to the client alongside an
 * extraction, so the review sheet can label the values with the vocabulary the
 * homeowner's own notice uses ("Current Value Assessment", "Portioned
 * assessment", …) instead of BC's.
 */
export interface PropertyJurisdictionSummary {
  countryCode: string;
  regionCode: string;
  regionName: string;
  authorityName: string;
  assessedValueTerm: string;
  parcelIdTerm: string;
  taxableValueTerm: string | null;
  assessmentRatioPercent: number;
  appealBodyName: string;
  languages: ReadonlyArray<'en' | 'fr'>;
}

/** Response-safe projection of a jurisdiction. `null` in, `null` out. */
export function describePropertyJurisdiction(
  jurisdiction: PropertyJurisdiction | null
): PropertyJurisdictionSummary | null {
  if (!jurisdiction) return null;
  return {
    countryCode: jurisdiction.countryCode,
    regionCode: jurisdiction.regionCode,
    regionName: jurisdiction.regionName,
    authorityName: jurisdiction.authorityName,
    assessedValueTerm: jurisdiction.assessedValueTerm,
    parcelIdTerm: jurisdiction.parcelIdTerm,
    taxableValueTerm: jurisdiction.taxableValueTerm,
    assessmentRatioPercent: jurisdiction.assessmentRatioPercent,
    appealBodyName: jurisdiction.appealBodyName,
    languages: jurisdiction.languages,
  };
}
