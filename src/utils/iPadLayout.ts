import { useDeviceType } from '@hooks/useDeviceType';
import { useResponsiveValue } from '@hooks/useResponsiveValue';

/**
 * iPad layout utilities following iOS 26 best practices
 */

/**
 * Get optimal card width for iPad layouts
 * Cards should be at least 320px wide, but can expand on larger screens
 */
export function useIPadCardWidth(minWidth = 320, maxWidth = 400): number {
  const { isTablet, width, columns } = useDeviceType();

  if (!isTablet) return 0;

  // Calculate optimal width based on available space and columns
  const availableWidth = width - 80; // Account for padding
  const optimalWidth = Math.floor(availableWidth / Math.min(columns, 2));
  
  return Math.max(minWidth, Math.min(maxWidth, optimalWidth));
}

/**
 * Get responsive spacing values optimized for iPad
 */
export function useIPadSpacing(): {
  small: number;
  medium: number;
  large: number;
  xlarge: number;
} {
  const spacing = useResponsiveValue({
    phone: {
      small: 8,
      medium: 16,
      large: 24,
      xlarge: 32,
    },
    tablet: {
      small: 12,
      medium: 20,
      large: 32,
      xlarge: 48,
    },
    tabletLandscape: {
      small: 16,
      medium: 24,
      large: 40,
      xlarge: 64,
    },
    default: {
      small: 8,
      medium: 16,
      large: 24,
      xlarge: 32,
    },
  });

  return spacing;
}

/**
 * Get responsive typography scale for iPad
 */
export function useIPadTypography(): {
  title1: number;
  title2: number;
  title3: number;
  headline: number;
  body: number;
  callout: number;
} {
  const typography = useResponsiveValue({
    phone: {
      title1: 34,
      title2: 28,
      title3: 22,
      headline: 17,
      body: 17,
      callout: 16,
    },
    tablet: {
      title1: 40,
      title2: 32,
      title3: 26,
      headline: 20,
      body: 18,
      callout: 17,
    },
    tabletLandscape: {
      title1: 44,
      title2: 36,
      title3: 28,
      headline: 22,
      body: 19,
      callout: 18,
    },
    default: {
      title1: 34,
      title2: 28,
      title3: 22,
      headline: 17,
      body: 17,
      callout: 16,
    },
  });

  return typography;
}

/**
 * Get optimal number of columns for grid layouts on iPad
 */
export function useIPadColumns(
  minItemWidth = 280,
  maxColumns = 4
): number {
  const { isTablet, width, columns } = useDeviceType();

  if (!isTablet) return 1;

  const availableWidth = width - 80; // Account for padding
  const calculatedColumns = Math.floor(availableWidth / minItemWidth);
  
  return Math.max(1, Math.min(maxColumns, calculatedColumns, columns));
}

/**
 * Check if current device should use iPad-optimized layouts
 */
export function useShouldOptimizeForIPad(): boolean {
  const { isTablet, shouldUseSplitView } = useDeviceType();
  return isTablet && shouldUseSplitView;
}
