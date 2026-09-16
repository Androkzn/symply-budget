import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';

import { useDeviceType } from '@hooks/useDeviceType';
import { useAppColors } from '@theme';

interface SplitViewProps {
  /**
   * The master/primary panel content (left side on iPad, full screen on iPhone)
   */
  master: React.ReactNode;
  /**
   * The detail/secondary panel content (right side on iPad, hidden or separate screen on iPhone)
   */
  detail?: React.ReactNode;
  /**
   * Width ratio for master panel (0-1). Default 0.35 (35%)
   */
  masterRatio?: number;
  /**
   * Minimum width for master panel in pixels
   */
  masterMinWidth?: number;
  /**
   * Maximum width for master panel in pixels
   */
  masterMaxWidth?: number;
  /**
   * Whether to show separator line between panels
   */
  showSeparator?: boolean;
  /**
   * Custom styles for master panel
   */
  masterStyle?: ViewStyle;
  /**
   * Custom styles for detail panel
   */
  detailStyle?: ViewStyle;
  /**
   * Placeholder content when no detail is selected (iPad only)
   */
  detailPlaceholder?: React.ReactNode;
}

/**
 * SplitView component that adapts layout for iPad vs iPhone.
 * On iPad: Shows master-detail side-by-side layout
 * On iPhone: Shows master only (detail handled via navigation)
 *
 * Based on iPadOS 26 design patterns with support for:
 * - Windowed multitasking
 * - Split View
 * - Slide Over compatibility
 */
export function SplitView({
  master,
  detail,
  masterRatio = 0.35,
  masterMinWidth = 320,
  masterMaxWidth = 400,
  showSeparator = true,
  masterStyle,
  detailStyle,
  detailPlaceholder,
}: SplitViewProps) {
  const colors = useAppColors();
  const { shouldUseSplitView, width } = useDeviceType();
  // On phone or narrow width, just show master content
  if (!shouldUseSplitView) {
    return (
      <View style={[styles.container, masterStyle]}>
        {master}
      </View>
    );
  }

  // Calculate master width respecting min/max constraints
  let calculatedMasterWidth = width * masterRatio;
  calculatedMasterWidth = Math.max(masterMinWidth, calculatedMasterWidth);
  calculatedMasterWidth = Math.min(masterMaxWidth, calculatedMasterWidth);

  return (
    <View style={styles.container}>
      {/* Master Panel */}
      <View
        style={[
          styles.masterPanel,
          { width: calculatedMasterWidth, backgroundColor: colors.backgroundSecondary },
          masterStyle,
        ]}
      >
        {master}
      </View>

      {/* Separator */}
      {showSeparator && (
        <View style={[styles.separator, { backgroundColor: colors.borderColor }]} />
      )}

      {/* Detail Panel */}
      <View
        style={[
          styles.detailPanel,
          { backgroundColor: colors.backgroundMain },
          detailStyle,
        ]}
      >
        {detail || detailPlaceholder || null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
  },
  masterPanel: {
    height: '100%',
  },
  separator: {
    width: StyleSheet.hairlineWidth,
    height: '100%',
  },
  detailPanel: {
    flex: 1,
    height: '100%',
  },
});
