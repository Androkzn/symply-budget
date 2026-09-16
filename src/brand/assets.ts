/**
 * Metro-bundled brand images.
 * Paths follow the active brand's asset map; SimpleHouse keeps files under
 * src/assets/images so existing binaries are reused without duplication.
 */
import type { ImageSourcePropType } from 'react-native';

import type { AccentSchemeId } from '@theme/accentSchemes';

// Metro needs literal paths; the standalone bundle contains only Budget artwork.
const BUDGET_ASSETS = {
  appIcon: require('../../brands/symply-budget/src/assets/images/app-icon.png'),
  splashLight: require('../../brands/symply-budget/src/assets/images/splash-light.png'),
  splashDark: require('../../brands/symply-budget/src/assets/images/splash-dark.png'),
  logoHorizontal: require('../../brands/symply-budget/src/assets/images/logo-horizontal.png'),
  logoSplash: require('../../brands/symply-budget/src/assets/images/logo-splash.png'),
} as const;

export type BrandImageAssets = typeof BUDGET_ASSETS;

export const brandAssets: BrandImageAssets = BUDGET_ASSETS;

export function getBrandImageAssets(brandId: string): BrandImageAssets {
  if (brandId !== 'symply-budget') throw new Error(`Unsupported standalone brand: ${brandId}`);
  return BUDGET_ASSETS;
}

// Budget-only: the splash/header mark recolored for each non-`classic` accent
// scheme (see `@theme/accentSchemes` + `scripts/tint-brand-mark.py`). Requires
// literal paths for Metro, so bundled unconditionally like the rest of this
// file rather than gated behind a brand-id check.
const BUDGET_ACCENT_SPLASH: Partial<Record<AccentSchemeId, ImageSourcePropType>> = {
  tealCoral: require('../../brands/symply-budget/src/assets/images/logo-splash-teal-coral.png'),
  sageTerracotta: require('../../brands/symply-budget/src/assets/images/logo-splash-sage-terracotta.png'),
};

/**
 * The splash/header mark for `brandId`, recolored for `scheme` when that
 * brand ships alternates (Budget only today). Falls back to the brand's
 * default `logoSplash` for `classic` or any brand without scheme art.
 */
export function getLogoSplashForScheme(
  brandId: string,
  scheme: AccentSchemeId
): ImageSourcePropType {
  if (brandId === 'symply-budget') {
    const override = BUDGET_ACCENT_SPLASH[scheme];
    if (override) return override;
  }
  return BUDGET_ASSETS.logoSplash;
}

export interface SpinnerMarkAssets {
  ring: ImageSourcePropType;
  dollar: ImageSourcePropType;
}

// `SymplySpinner`'s two animated layers (rotating ring + pulsing dollar),
// split from the same brush mark as `logoSplash` above. Shared across every
// brand that renders `SymplySpinner` (Budget, Kaizen, Language); House and
// Health render their own spinners instead.
const DEFAULT_SPINNER: SpinnerMarkAssets = {
  ring: require('../assets/images/spinner-ring.png'),
  dollar: require('../assets/images/spinner-dollar.png'),
};

// Budget-only: the spinner mark recolored for each non-`classic` accent
// scheme, generated the same way as `BUDGET_ACCENT_SPLASH` above (see
// `scripts/tint-brand-mark.py`).
const BUDGET_ACCENT_SPINNER: Partial<Record<AccentSchemeId, SpinnerMarkAssets>> = {
  tealCoral: {
    ring: require('../../brands/symply-budget/src/assets/images/spinner-ring-teal-coral.png'),
    dollar: require('../../brands/symply-budget/src/assets/images/spinner-dollar-teal-coral.png'),
  },
  sageTerracotta: {
    ring: require('../../brands/symply-budget/src/assets/images/spinner-ring-sage-terracotta.png'),
    dollar: require('../../brands/symply-budget/src/assets/images/spinner-dollar-sage-terracotta.png'),
  },
};

/**
 * The `SymplySpinner` ring + dollar images for `brandId`, recolored for
 * `scheme` when that brand ships alternates (Budget only today). Falls back
 * to the shared lime→teal artwork for `classic` or any brand without scheme
 * art.
 */
export function getSpinnerAssetsForScheme(
  brandId: string,
  scheme: AccentSchemeId
): SpinnerMarkAssets {
  if (brandId === 'symply-budget') {
    const override = BUDGET_ACCENT_SPINNER[scheme];
    if (override) return override;
  }
  return DEFAULT_SPINNER;
}
