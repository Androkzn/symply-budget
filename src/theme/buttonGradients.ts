/**
 * Canonical CTA gradient stops for the shared button system.
 *
 * Every brand owns TWO dedicated gradients in `brands/<id>/tokens.json`
 * (→ `npm run design:build`):
 *   - `cta`       → the MAIN action ramp (primary CTA, FAB, Face ID Enable).
 *   - `secondary` → the SECONDARY / destructive action ramp, hue-distinct from
 *     `cta` so a stacked primary+secondary pair reads as a clear hierarchy.
 *
 * `primary`/`teal` resolve to `cta`; `secondary` resolves to the brand's
 * `secondary` token. Both fall back to a shared ramp if a brand pack omits them.
 */

import { gradients as brandGradients } from '../brand/tokens.generated';

import { ACCENT_SCHEMES, getDefaultAccentScheme, type AccentSchemeId } from './accentSchemes';
import { palette } from './colors';

export type ButtonGradientVariant =
  | 'primary'
  | 'teal'
  | 'secondary'
  | 'blue'
  | 'orange';

type GradientToken = {
  colors?: readonly string[];
};

type GradientStops = readonly [string, string, ...string[]];

/** Shared blue ramp — fallback secondary for brand packs without a `secondary` token. */
const BLUE_RAMP: GradientStops = [
  palette.button.blue,
  palette.button.blueMid,
  palette.button.blueDark,
] as const;

function brandStops(key: 'cta' | 'secondary', fallback: GradientStops): GradientStops {
  const token = (brandGradients as Record<string, GradientToken | undefined>)[key];
  const colors = token?.colors;
  if (colors && colors.length >= 2) {
    return colors as unknown as GradientStops;
  }
  return fallback;
}

/**
 * Main brand CTA ramp (left → right). `classic` uses the brand's own
 * generated `cta` gradient token (unchanged); non-classic accent schemes ramp
 * from the scheme's `primary` → `primaryDark` instead, so buttons/FABs shift
 * hue along with the rest of the scheme.
 */
function ctaStops(schemeId: AccentSchemeId): GradientStops {
  const seed = ACCENT_SCHEMES[schemeId];
  if (seed && schemeId !== 'classic') {
    return [seed.primary, seed.primaryDark] as const;
  }
  return brandStops('cta', [palette.button.teal, palette.button.tealDark] as const);
}

/** Brand-owned secondary/destructive ramp — hue-distinct from `cta`, same for every scheme. */
function secondaryStops(): GradientStops {
  return brandStops('secondary', BLUE_RAMP);
}

/** Horizontal brand gradient for a button variant (left → right). */
export function getButtonGradientColors(
  variant: ButtonGradientVariant = 'primary',
  options?: { disabled?: boolean; disabledColor?: string; schemeId?: AccentSchemeId }
): GradientStops {
  if (options?.disabled) {
    const fill = options.disabledColor ?? palette.gray[300];
    return [fill, fill] as const;
  }

  switch (variant) {
    case 'secondary':
      // Per-app dedicated secondary ramp (brand `secondary` token), used for
      // destructive / "not now" style actions beside a primary CTA.
      return secondaryStops();
    case 'blue':
      // Literal shared blue ramp — for screens that explicitly want blue rather
      // than the brand's secondary hue.
      return BLUE_RAMP;
    case 'orange':
      return [palette.button.orange, palette.button.orangeDark] as const;
    case 'primary':
    case 'teal':
    default:
      return ctaStops(options?.schemeId ?? getDefaultAccentScheme());
  }
}
