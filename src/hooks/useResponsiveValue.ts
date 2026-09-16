import { useDeviceType } from './useDeviceType';

interface ResponsiveValues<T> {
  phone?: T;
  tablet?: T;
  tabletLandscape?: T;
  default: T;
}

/**
 * Returns a value based on the current device type and orientation.
 * Useful for responsive styling and layout decisions.
 *
 * @example
 * const padding = useResponsiveValue({
 *   phone: 16,
 *   tablet: 24,
 *   tabletLandscape: 32,
 *   default: 16,
 * });
 */
export function useResponsiveValue<T>(values: ResponsiveValues<T>): T {
  const { isTablet, isLandscape } = useDeviceType();

  if (isTablet && isLandscape && values.tabletLandscape !== undefined) {
    return values.tabletLandscape;
  }

  if (isTablet && values.tablet !== undefined) {
    return values.tablet;
  }

  if (!isTablet && values.phone !== undefined) {
    return values.phone;
  }

  return values.default;
}

interface ResponsiveStyleValues {
  phone?: Record<string, unknown>;
  tablet?: Record<string, unknown>;
  tabletLandscape?: Record<string, unknown>;
}

/**
 * Merges base styles with responsive overrides based on device type.
 *
 * @example
 * const styles = useResponsiveStyles(
 *   { padding: 16, fontSize: 14 },
 *   {
 *     tablet: { padding: 24, fontSize: 16 },
 *     tabletLandscape: { padding: 32, maxWidth: 800 },
 *   }
 * );
 */
export function useResponsiveStyles<T extends Record<string, unknown>>(
  baseStyles: T,
  responsiveOverrides: ResponsiveStyleValues
): T {
  const { isTablet, isLandscape } = useDeviceType();

  let result = { ...baseStyles };

  if (isTablet && responsiveOverrides.tablet) {
    result = { ...result, ...responsiveOverrides.tablet };
  }

  if (isTablet && isLandscape && responsiveOverrides.tabletLandscape) {
    result = { ...result, ...responsiveOverrides.tabletLandscape };
  }

  return result as T;
}
