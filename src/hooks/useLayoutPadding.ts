import { useWindowDimensions } from 'react-native';

import { getSidebarWidth } from '@components/navigation/sidebarWidth';
import { useTabBarVisibilityStore } from '@stores/tabBarVisibilityStore';

import { useDeviceType } from './useDeviceType';

/**
 * Centralized layout padding values for consistent spacing across the app.
 * All screens should use these values for horizontal content padding.
 *
 * iPadOS 26 best practices applied:
 * - Generous breathing room next to the sidebar on regular widths.
 * - Compact (Slide Over / Stage Manager narrow) iPad windows step down to
 *   phone-class padding so content keeps its readable density.
 */

export interface LayoutPadding {
  /** Horizontal padding for main content areas */
  content: number;
  /** Gap between cards/items in a grid */
  cardGap: number;
  /** Padding for section containers */
  section: number;
  /**
   * Extra leading padding to reserve space for the iPad sidebar tab bar.
   * Already baked into `content` for screens that use that key — exposed
   * separately so layouts that build their own paddings can opt in.
   */
  sidebarInset: number;
}

/**
 * Returns consistent layout padding values based on device type.
 * Use this hook in all screens to ensure uniform spacing.
 *
 * @example
 * const { content, cardGap } = useLayoutPadding();
 * <View style={{ paddingHorizontal: content }}>
 */
export function useLayoutPadding(): LayoutPadding {
  const { isTablet, isLandscape, shouldUseSidebar } = useDeviceType();
  const { width } = useWindowDimensions();
  const isSidebarVisible = useTabBarVisibilityStore((s) => s.isSidebarVisible);

  // Reserve the leading inset taken by the floating sidebar, plus a small
  // gap so content doesn't touch the sidebar's outer edge. This value is
  // applied at the *screen wrapper* level (AppBackground / navigator root),
  // NOT mirrored into `content` which is used as `paddingHorizontal`.
  //
  // Only reserve space when the sidebar is *actually visible* — nested
  // routes that suppress the sidebar (e.g. fullscreen garden editor) get
  // sidebarInset=0 so their content can run full width.
  const sidebarInset =
    shouldUseSidebar && isSidebarVisible ? getSidebarWidth(width) + 12 : 0;

  if (isTablet && shouldUseSidebar && isLandscape) {
    return {
      content: 28,
      cardGap: 20,
      section: 20,
      sidebarInset,
    };
  }

  if (isTablet && shouldUseSidebar) {
    return {
      content: 24,
      cardGap: 18,
      section: 18,
      sidebarInset,
    };
  }

  // Compact iPad window (Slide Over / narrow Stage Manager)
  if (isTablet && isLandscape) {
    return {
      content: 20,
      cardGap: 16,
      section: 16,
      sidebarInset: 0,
    };
  }

  if (isTablet) {
    return {
      content: 16,
      cardGap: 14,
      section: 12,
      sidebarInset: 0,
    };
  }

  // Phone (default)
  return {
    content: 8,
    cardGap: 10,
    section: 8,
    sidebarInset: 0,
  };
}

/**
 * Pre-configured padding values for use with AdaptiveContainer.
 * Returns the content padding value based on device type.
 */
export function useContainerPadding(): number {
  const { content } = useLayoutPadding();
  return content;
}
