import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';

import { useDeviceType } from '@hooks/useDeviceType';
import { useResponsiveValue } from '@hooks/useResponsiveValue';

interface ResponsiveLayoutProps {
  children: React.ReactNode;
  /**
   * Maximum content width for large screens (iPad)
   */
  maxWidth?: number;
  /**
   * Horizontal padding
   */
  padding?: number;
  /**
   * Custom container style
   */
  style?: ViewStyle;
  /**
   * Whether to center content on large screens
   */
  centerContent?: boolean;
}

/**
 * ResponsiveLayout provides a container that adapts to device type.
 * Follows iOS 26 design patterns for optimal iPad experience.
 *
 * Features:
 * - Constrains width on iPad for readability
 * - Responsive padding based on device
 * - Centers content on large screens
 * - Supports all iPad models and orientations
 */
export function ResponsiveLayout({
  children,
  maxWidth = 1200,
  padding,
  centerContent = true,
  style,
}: ResponsiveLayoutProps) {
  const { isTablet, isLandscape } = useDeviceType();

  const containerPadding = useResponsiveValue({
    phone: 16,
    tablet: isLandscape ? 40 : 32,
    tabletLandscape: 48,
    default: 16,
  });

  const horizontalPadding = padding ?? containerPadding;

  return (
    <View
      style={[
        styles.container,
        {
          paddingHorizontal: horizontalPadding,
          maxWidth: isTablet && centerContent ? maxWidth : undefined,
          alignSelf: isTablet && centerContent ? 'center' : 'stretch',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

interface ResponsiveSpacingProps {
  /**
   * Spacing value for phone
   */
  phone?: number;
  /**
   * Spacing value for tablet
   */
  tablet?: number;
  /**
   * Spacing value for tablet landscape
   */
  tabletLandscape?: number;
  /**
   * Default spacing value
   */
  default: number;
}

/**
 * Hook to get responsive spacing values
 */
export function useResponsiveSpacing(values: ResponsiveSpacingProps): number {
  return useResponsiveValue(values);
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
});
