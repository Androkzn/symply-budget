import type { ImageSourcePropType } from 'react-native';

/**
 * GENERATED — do not edit by hand.
 *
 * Written by `scripts/normalize-lender-logos.mjs`. Maps a lender slug (see
 * `POPULAR_LENDERS` in `@utils/lender-logos`) to a bundled, size-normalized
 * wordmark PNG under `src/assets/images/lenders/`. Metro requires literal
 * `require()` paths, so this map is codegen'd rather than built dynamically —
 * the same reason `src/brand/icons.generated.ts` is generated.
 *
 * It starts EMPTY: until you add real logo assets (drop licensed source images
 * into `scripts/lender-logo-sources/` and run the normalize script), every
 * lender renders a branded monogram tile via `<LenderLogo>`. No third-party
 * logo binaries are committed by default.
 */
export const LENDER_LOGO_ASSETS: Partial<Record<string, ImageSourcePropType>> = {
  // '<slug>': require('../assets/images/lenders/<slug>.png'),
};
