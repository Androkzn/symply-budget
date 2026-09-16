import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { hexToRgba, IconSize, useAppColors } from '@theme';

import { Icon } from './Icon';

export interface IconBackgroundChipProps {
  name: string;
  size?: number;
  /** Defaults to `textPrimary`, or the palette primary when active. */
  color?: string;
  /** Use the live palette primary unless an explicit color is supplied. */
  active?: boolean;
  /** Chip wash — defaults to primary @ 12% alpha. */
  backgroundColor?: string;
  style?: ViewStyle;
  testID?: string;
}

/**
 * Icon sitting on a tinted chip. Inactive glyphs follow the row label; active
 * glyphs use the live palette primary. Explicit semantic colors take precedence.
 */
export function IconBackgroundChip({
  name,
  size = IconSize.md,
  color,
  active = false,
  backgroundColor,
  style,
  testID,
}: IconBackgroundChipProps) {
  const colors = useAppColors();
  const iconColor = color ?? (active ? colors.primary : colors.textPrimary);
  const bg = backgroundColor ?? hexToRgba(colors.primary, 0.12);

  return (
    <View style={[styles.chip, { backgroundColor: bg }, style]} testID={testID}>
      <Icon name={name} size={size} color={iconColor} active={active} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
