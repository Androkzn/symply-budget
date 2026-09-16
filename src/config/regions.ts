/**
 * Country + province/state lists for the sales-tax Region setting. The chosen
 * region is sent with a receipt scan so the backend can apply the correct
 * sales-tax rate when the receipt itself prints no usable tax (the fallback).
 *
 * Codes here match the two-letter codes the backend tax table understands
 * (see backend tax-attribution.ts). Keep the two in sync when adding regions.
 */

export interface RegionSubdivision {
  /** Two-letter province/state code, e.g. 'BC', 'CA'. */
  code: string;
  label: string;
}

export interface RegionCountry {
  /** ISO country code understood by the backend ('CA' | 'US'). */
  code: string;
  label: string;
  /** What a subdivision is called for this country. */
  subdivisionLabel: string;
  subdivisions: RegionSubdivision[];
}

const CA_PROVINCES: RegionSubdivision[] = [
  { code: 'AB', label: 'Alberta' },
  { code: 'BC', label: 'British Columbia' },
  { code: 'MB', label: 'Manitoba' },
  { code: 'NB', label: 'New Brunswick' },
  { code: 'NL', label: 'Newfoundland and Labrador' },
  { code: 'NS', label: 'Nova Scotia' },
  { code: 'NT', label: 'Northwest Territories' },
  { code: 'NU', label: 'Nunavut' },
  { code: 'ON', label: 'Ontario' },
  { code: 'PE', label: 'Prince Edward Island' },
  { code: 'QC', label: 'Quebec' },
  { code: 'SK', label: 'Saskatchewan' },
  { code: 'YT', label: 'Yukon' },
];

const US_STATES: RegionSubdivision[] = [
  { code: 'AL', label: 'Alabama' },
  { code: 'AK', label: 'Alaska' },
  { code: 'AZ', label: 'Arizona' },
  { code: 'AR', label: 'Arkansas' },
  { code: 'CA', label: 'California' },
  { code: 'CO', label: 'Colorado' },
  { code: 'CT', label: 'Connecticut' },
  { code: 'DE', label: 'Delaware' },
  { code: 'DC', label: 'District of Columbia' },
  { code: 'FL', label: 'Florida' },
  { code: 'GA', label: 'Georgia' },
  { code: 'HI', label: 'Hawaii' },
  { code: 'ID', label: 'Idaho' },
  { code: 'IL', label: 'Illinois' },
  { code: 'IN', label: 'Indiana' },
  { code: 'IA', label: 'Iowa' },
  { code: 'KS', label: 'Kansas' },
  { code: 'KY', label: 'Kentucky' },
  { code: 'LA', label: 'Louisiana' },
  { code: 'ME', label: 'Maine' },
  { code: 'MD', label: 'Maryland' },
  { code: 'MA', label: 'Massachusetts' },
  { code: 'MI', label: 'Michigan' },
  { code: 'MN', label: 'Minnesota' },
  { code: 'MS', label: 'Mississippi' },
  { code: 'MO', label: 'Missouri' },
  { code: 'MT', label: 'Montana' },
  { code: 'NE', label: 'Nebraska' },
  { code: 'NV', label: 'Nevada' },
  { code: 'NH', label: 'New Hampshire' },
  { code: 'NJ', label: 'New Jersey' },
  { code: 'NM', label: 'New Mexico' },
  { code: 'NY', label: 'New York' },
  { code: 'NC', label: 'North Carolina' },
  { code: 'ND', label: 'North Dakota' },
  { code: 'OH', label: 'Ohio' },
  { code: 'OK', label: 'Oklahoma' },
  { code: 'OR', label: 'Oregon' },
  { code: 'PA', label: 'Pennsylvania' },
  { code: 'RI', label: 'Rhode Island' },
  { code: 'SC', label: 'South Carolina' },
  { code: 'SD', label: 'South Dakota' },
  { code: 'TN', label: 'Tennessee' },
  { code: 'TX', label: 'Texas' },
  { code: 'UT', label: 'Utah' },
  { code: 'VT', label: 'Vermont' },
  { code: 'VA', label: 'Virginia' },
  { code: 'WA', label: 'Washington' },
  { code: 'WV', label: 'West Virginia' },
  { code: 'WI', label: 'Wisconsin' },
  { code: 'WY', label: 'Wyoming' },
];

export const SUPPORTED_REGION_COUNTRIES: RegionCountry[] = [
  { code: 'CA', label: 'Canada', subdivisionLabel: 'Province', subdivisions: CA_PROVINCES },
  { code: 'US', label: 'United States', subdivisionLabel: 'State', subdivisions: US_STATES },
];

/** Resolve a country by code, or undefined. */
export function findRegionCountry(code: string | null | undefined): RegionCountry | undefined {
  if (!code) return undefined;
  return SUPPORTED_REGION_COUNTRIES.find((c) => c.code === code);
}

/** First-run picker default from the device locale. Country only — no GPS. */
export function resolveLocaleTaxRegion(): { country: string; region: null } | null {
  try {
    // Lazy require so unit tests can mock expo-localization without a native bind.
    const { getLocales } = require('expo-localization') as typeof import('expo-localization');
    const code = getLocales()[0]?.regionCode?.toUpperCase();
    if (code === 'CA' || code === 'US') return { country: code, region: null };
  } catch {
    // Tests / environments without the native module stay unset.
  }
  return null;
}

/** A short human label for a saved region, e.g. "British Columbia, Canada". */
export function formatRegionLabel(
  countryCode: string | null | undefined,
  regionCode: string | null | undefined
): string | null {
  const country = findRegionCountry(countryCode);
  if (!country) return null;
  const sub = regionCode ? country.subdivisions.find((s) => s.code === regionCode) : undefined;
  return sub ? `${sub.label}, ${country.label}` : country.label;
}
