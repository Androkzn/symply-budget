import React from 'react';
import { TouchableOpacity, StyleSheet, View } from 'react-native';

import { Chat, CornerRadius, Spacing, useAppColors } from '@theme';

import { Typography } from './Typography';

interface ChipProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md';
  /**
   * Capsule outline instead of a tinted fill: transparent background, 1pt
   * border in the variant colour, fully rounded ends.
   *
   * Suggestion chips need this. A filled chip beside a filled state pill (Tax,
   * fees) reads as another *status*, so a row of suggestions looked like a row
   * of badges nobody could tell was tappable. The outline says "choice".
   */
  outlined?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
  testID?: string;
}

function withAlphaChannel(base: string, alphaHex: '16' | '20' | '25') {
  if (base.startsWith('#') && base.length === 7) {
    return `${base}${alphaHex}`;
  }
  return base;
}

export function Chip({
  label,
  variant = 'secondary',
  size = 'md',
  outlined = false,
  onPress,
  onRemove,
  testID,
}: ChipProps) {
  const colors = useAppColors();

  const getColors = () => {
    switch (variant) {
      case 'primary':
        return {
          background: withAlphaChannel(colors.primary, '20'),
          text: colors.primary,
        };
      case 'success':
        return {
          background: withAlphaChannel(colors.success, '20'),
          text: colors.success,
        };
      case 'warning':
        return {
          background: withAlphaChannel(colors.warning, '20'),
          text: colors.warning,
        };
      case 'error':
        return {
          background: withAlphaChannel(colors.error, '20'),
          text: colors.error,
        };
      case 'secondary':
      default:
        return {
          background: colors.groupedListBackground,
          text: colors.textSecondary,
        };
    }
  };

  const chipColors = getColors();
  const paddingVertical = size === 'sm' ? Spacing.xs : Chat.compactGap;
  const paddingHorizontal = size === 'sm' ? Spacing.sm : Spacing.md;

  // An outlined chip borrows the variant's TEXT colour for its border so the
  // two read as one family; `secondary` (the suggestion default) borders on the
  // divider colour instead, which is quieter than its grey text would be.
  const borderColor = variant === 'secondary' ? colors.borderColor : chipColors.text;

  const content = (
    <View
      style={[
        styles.container,
        outlined
          ? [styles.outlined, { borderColor }]
          : { backgroundColor: chipColors.background },
        {
          paddingVertical,
          paddingHorizontal,
        },
      ]}
    >
      <Typography
        variant={size === 'sm' ? 'caption2' : 'caption1'}
        weight="medium"
        color={chipColors.text}
      >
        {label}
      </Typography>
      {onRemove && (
        <TouchableOpacity
          onPress={onRemove}
          style={styles.removeButton}
          hitSlop={{ top: Spacing.sm, bottom: Spacing.sm, left: Spacing.sm, right: Spacing.sm }}
        >
          <Typography variant="caption1" weight="bold" color={chipColors.text}>
            ×
          </Typography>
        </TouchableOpacity>
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} testID={testID}>
        {content}
      </TouchableOpacity>
    );
  }

  return <View testID={testID}>{content}</View>;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: CornerRadius.lg,
    alignSelf: 'flex-start',
  },
  /** Capsule outline — no fill, so it reads as a choice rather than a status. */
  outlined: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: CornerRadius.xxl,
  },
  removeButton: {
    marginLeft: Spacing.xs,
    width: Spacing.base,
    height: Spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
