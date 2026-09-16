/**
 * Symply Life (brand `symply-kaizen`) — appColors shim.
 *
 * Reuses the ecosystem `useAppColors()` (all standard semantic keys) and adds only the
 * Liquid-Glass + brand-gradient keys the donor Kaizen screens expect (`glass*`, `gradient*`),
 * derived from ecosystem tokens. This avoids forking the donor design pipeline while keeping
 * ported screens' `appColors.glassBorder` / `appColors.gradientAction.colors` references unchanged.
 */
import { useTheme } from '@contexts/ThemeContext';
import { useAppColors as useEcosystemAppColors } from '@theme/appColors';
import { getButtonGradientColors } from '@theme/buttonGradients';

/** Kaizen brand gradient stops (mint → teal → azure → violet), keyed off brand primary #5B7CFF. */
export const KAIZEN_GRADIENT_BRAND = ['#6EE7C7', '#4ECDC4', '#5B7CFF', '#8B7CFF'];
/** Action CTA — brand primary ramp from the shared button system. */
export const KAIZEN_GRADIENT_ACTION = [...getButtonGradientColors('primary')];

/**
 * Gradient descriptors — the donor `appColors.gradient*` values are objects consumed as
 * `{ colors, locations, start, end }` by `<LinearGradient>`. The bare arrays above stay
 * available for the brand primitives (GradientText / GradientButton / ProgressRing).
 */
export const GRADIENT_BRAND_DESCRIPTOR = {
  colors: KAIZEN_GRADIENT_BRAND,
  locations: [0, 0.35, 0.7, 1],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};
export const GRADIENT_ACTION_DESCRIPTOR = {
  colors: KAIZEN_GRADIENT_ACTION,
  locations: [0, 1],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
};

export function useAppColors() {
  const base = useEcosystemAppColors();
  const { isDark } = useTheme();
  return {
    ...base,
    glassFill: base.cardBackground,
    glassFillStrong: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.78)',
    glassBorder: base.borderColor,
    glassShadow: isDark ? 'rgba(0,0,0,0.50)' : 'rgba(15,23,42,0.10)',
    glassTint: base.primary,
    gradientBrand: GRADIENT_BRAND_DESCRIPTOR,
    gradientAction: GRADIENT_ACTION_DESCRIPTOR,
  };
}
