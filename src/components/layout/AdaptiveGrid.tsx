import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';

import { useDeviceType } from '@hooks/useDeviceType';
import { Layout } from '@theme';

interface AdaptiveGridProps {
  children: React.ReactNode;
  /**
   * Gap between items in pixels
   */
  gap?: number;
  /**
   * Override number of columns (otherwise auto-calculated based on device)
   */
  columns?: number;
  /**
   * Minimum item width for auto-column calculation
   */
  minItemWidth?: number;
  /**
   * Custom container style
   */
  style?: ViewStyle;
}

/**
 * AdaptiveGrid automatically adjusts column count based on device type and orientation.
 * Follows iPadOS 26 design patterns for responsive layouts.
 *
 * Default behavior:
 * - Phone portrait: 1-2 columns
 * - Phone landscape: 2 columns
 * - iPad portrait: 2-3 columns
 * - iPad landscape: 3-4 columns
 */
export function AdaptiveGrid({
  children,
  gap = 16,
  columns: columnOverride,
  minItemWidth = 280,
  style,
}: AdaptiveGridProps) {
  const { columns: autoColumns, width } = useDeviceType();

  // Calculate columns based on min item width if no override
  const calculatedColumns = columnOverride ?? Math.max(
    1,
    Math.min(autoColumns, Math.floor(width / minItemWidth))
  );

  const childArray = React.Children.toArray(children);

  return (
    <View style={[styles.container, { gap }, style]}>
      {childArray.map((child, index) => (
        <View
          key={index}
          style={[
            styles.item,
            {
              width: `${100 / calculatedColumns}%`,
              paddingHorizontal: gap / 2,
            },
          ]}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

/**
 * Responsive container that constrains content width on large screens.
 * Useful for readable line lengths and centered layouts on iPad.
 *
 * iPadOS 26 guidance:
 * - 'reading' (default ~720pt) — prose, single-column lists, settings.
 *   Matches Apple's HIG ~70-80 character line length.
 * - 'standard' (~960pt) — most app surfaces, two-column dashboards.
 * - 'wide' (~1200pt) — grid-heavy dashboards on 12.9" iPad / Stage Manager.
 * - 'fluid' — no cap; the container fills the available width.
 */
type AdaptiveContainerWidth = 'reading' | 'standard' | 'wide' | 'fluid';

interface AdaptiveContainerProps {
  children: React.ReactNode;
  /**
   * Semantic width preset (preferred). Falls back to `maxWidth` if provided.
   */
  width?: AdaptiveContainerWidth;
  /**
   * Maximum content width in pixels (escape hatch — overrides `width`).
   */
  maxWidth?: number;
  /**
   * Horizontal padding override
   */
  padding?: number;
  /**
   * Custom container style
   */
  style?: ViewStyle;
}

const WIDTH_PRESETS: Record<AdaptiveContainerWidth, number | undefined> = {
  reading: Layout.readingMaxWidth, // 720
  standard: 960,
  wide: 1200,
  fluid: undefined,
};

export function AdaptiveContainer({
  children,
  width = 'standard',
  maxWidth,
  padding,
  style,
}: AdaptiveContainerProps) {
  const { isTablet, isLandscape, shouldUseSidebar } = useDeviceType();

  // Sidebar already pushes content; in that case the AdaptiveContainer only
  // needs a small inner padding because `useLayoutPadding` provides the rest.
  const defaultPadding = shouldUseSidebar
    ? 0
    : isTablet
      ? isLandscape
        ? 20
        : 16
      : 8;
  const horizontalPadding = padding ?? defaultPadding;

  const resolvedMaxWidth = maxWidth ?? WIDTH_PRESETS[width];

  return (
    <View
      style={[
        styles.adaptiveContainer,
        {
          maxWidth: isTablet ? resolvedMaxWidth : undefined,
          paddingHorizontal: horizontalPadding,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  item: {
    marginBottom: 16,
  },
  adaptiveContainer: {
    // Fill remaining height in a bounded (flex) parent, but size to CONTENT in
    // an unbounded parent such as a ScrollView. `flex: 1` implies
    // `flexBasis: 0%`, which collapses this container to zero height inside a
    // vertical ScrollView — the scroll content then measures as empty and the
    // page can't scroll (content overflows and is clipped at the viewport).
    // Using an explicit `flexBasis: 'auto'` keeps the fill behavior where a
    // parent constrains height while letting the content define height when it
    // doesn't. See BudgetScreen (Savings tab) scroll regression.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    width: '100%',
    alignSelf: 'center',
  },
});
