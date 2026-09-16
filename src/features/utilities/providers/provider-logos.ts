import type { ImageSourcePropType } from 'react-native';

import bcHydro from '@assets/images/providers/bc-hydro.png';
import burnaby from '@assets/images/providers/city-of-burnaby.png';
import coquitlam from '@assets/images/providers/city-of-coquitlam.png';
import portCoquitlam from '@assets/images/providers/city-of-port-coquitlam.png';
import richmond from '@assets/images/providers/city-of-richmond.png';
import surrey from '@assets/images/providers/city-of-surrey.png';
import fortisbc from '@assets/images/providers/fortisbc.png';
import type { ProviderKey } from '@features/utilities/api/utilities';

/**
 * Bundled utility / municipality brand logos.
 *
 * Sourced from Wikimedia and resolution-normalized to a uniform 120px height
 * (transparent PNG, aspect ratio preserved) so they render consistently inside
 * the fixed-size logo chips on the Utilities screens.
 */

/** Logos for the fixed provider dashboards (Utilities "Your utilities" row). */
const PROVIDER_KEY_LOGOS: Partial<Record<ProviderKey, ImageSourcePropType>> = {
  bc_hydro: bcHydro,
  fortisbc,
  city_of_surrey: surrey,
};

/**
 * Matchers for the free-text `provider` string stored on a bill (e.g. "BC
 * Hydro", "FortisBC", "City of Surrey", "Coquitlam"). First match wins, so keep
 * the more specific city names (Port Coquitlam) ahead of the generic ones.
 */
const NAME_MATCHERS: Array<{ test: RegExp; logo: ImageSourcePropType }> = [
  { test: /hydro/i, logo: bcHydro },
  { test: /fortis/i, logo: fortisbc },
  { test: /surrey/i, logo: surrey },
  { test: /port\s*coquitlam|\bpoco\b/i, logo: portCoquitlam },
  { test: /coquitlam/i, logo: coquitlam },
  { test: /burnaby/i, logo: burnaby },
  { test: /richmond/i, logo: richmond },
];

/**
 * Resolve a bundled logo for a provider dashboard key and/or the free-text
 * provider name on a bill. Returns `undefined` when nothing matches so callers
 * can fall back to the emoji icon.
 */
export function getProviderLogo(
  providerKey?: ProviderKey | null,
  providerName?: string | null
): ImageSourcePropType | undefined {
  if (providerKey) {
    const byKey = PROVIDER_KEY_LOGOS[providerKey];
    if (byKey) return byKey;
  }
  if (providerName) {
    const match = NAME_MATCHERS.find((m) => m.test.test(providerName));
    if (match) return match.logo;
  }
  return undefined;
}

/**
 * Whether a bundled brand logo exists for this provider. Our logos are
 * wordmarks (they spell out the brand), so callers use this to drop a
 * redundant text title when a logo will render — and keep the title as the
 * only label when we can only show a generic fallback icon.
 */
export function hasProviderLogo(
  providerKey?: ProviderKey | null,
  providerName?: string | null
): boolean {
  return getProviderLogo(providerKey, providerName) !== undefined;
}
