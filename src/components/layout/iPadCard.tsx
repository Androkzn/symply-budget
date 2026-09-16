import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';

import { useDeviceType } from '@hooks/useDeviceType';
import { useAppColors } from '@theme';

interface IPadCardProps {
  children: React.ReactNode;
  /**
   * Custom container style
   */
  style?: ViewStyle;
  /**
   * Whether to use enhanced padding on iPad
   */
  enhancedPadding?: boolean;
  /**
   * Minimum card width on iPad
   */
  minWidth?: number;
}

/**
 * iPadCard provides optimized card styling for iPad screens.
 * Uses larger padding, better spacing, and optimized sizing for large screens.
 * 
 * Best practices:
 * - Cards should be at least 320px wide on iPad
 * - Use enhanced padding for better visual hierarchy
 * - Maintain consistent spacing between cards
 */
export function IPadCard({
  children,
  style,
  enhancedPadding = true,
  minWidth = 320,
}: IPadCardProps) {
  const colors = useAppColors();
  const { isTablet, isLandscape } = useDeviceType();
  const padding = enhancedPadding && isTablet
    ? (isLandscape ? 24 : 20)
    : 16;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.backgroundSecondary,
          padding,
          minWidth: isTablet ? minWidth : undefined,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
});
