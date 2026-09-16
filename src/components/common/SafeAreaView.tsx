import React from 'react';
import { StyleSheet, ViewProps, View } from 'react-native';
import { SafeAreaView as RNSafeAreaView, Edge, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@contexts/ThemeContext';
import { useDeviceType } from '@hooks/useDeviceType';

interface SafeAreaViewProps extends ViewProps {
  children: React.ReactNode;
  edges?: Edge[];
  /**
   * For iPad, adds extra horizontal padding for better content positioning
   */
  iPadHorizontalPadding?: boolean;
}

/**
 * Enhanced SafeAreaView with iPad-specific optimizations.
 * Follows iPadOS 26 design patterns:
 * - Proper safe area handling for all iPad models
 * - Support for Stage Manager and multitasking windows
 * - Additional horizontal padding option for content centering
 */
export function SafeAreaView({
  children,
  edges = ['top', 'bottom'],
  style,
  iPadHorizontalPadding = false,
  ...props
}: SafeAreaViewProps) {
  const { theme: _theme } = useTheme();
  const { isTablet, isLandscape, shouldUseSidebar } = useDeviceType();

  // On iPad with sidebar, we might want to adjust edges
  // since the sidebar already handles left edge
  const adjustedEdges = shouldUseSidebar
    ? edges.filter((edge) => edge !== 'left')
    : edges;

  // Extra horizontal padding for iPad to keep content readable
  const horizontalPadding = iPadHorizontalPadding && isTablet
    ? isLandscape ? 40 : 24
    : 0;

  return (
    <RNSafeAreaView
      style={[
        styles.container,
        style,
      ]}
      edges={adjustedEdges}
      {...props}
    >
      {horizontalPadding > 0 ? (
        <View style={[styles.paddedContent, { paddingHorizontal: horizontalPadding }]}>
          {children}
        </View>
      ) : (
        children
      )}
    </RNSafeAreaView>
  );
}

/**
 * Hook to get iPad-aware safe area insets
 * Useful when you need programmatic access to insets
 */
export function useIPadSafeAreaInsets() {
  const insets = useSafeAreaInsets();
  const { isTablet, isLandscape, shouldUseSidebar } = useDeviceType();

  return {
    ...insets,
    // On iPad with sidebar, left inset is handled by sidebar
    left: shouldUseSidebar ? 0 : insets.left,
    // Provide helper values for iPad layouts
    isTablet,
    isLandscape,
    // Recommended content padding for iPad
    contentPadding: isTablet ? (isLandscape ? 40 : 24) : 16,
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  paddedContent: {
    flex: 1,
  },
});
