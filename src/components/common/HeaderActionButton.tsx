import React, { useMemo } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Typography } from '@components/ui/Typography';
import { Header, useAppColors, type AppColors } from '@theme';

function hexToRgba(hex: string, alpha: number): string {
  const sanitized = hex.replace('#', '');
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * `solid`  — filled brand pill (labelled actions like Save/Edit).
 * `tint`   — light brand-tinted chip that matches the header notification
 *            bell + back button. Default for circular icon-only buttons so all
 *            header controls read as one consistent set.
 */
type HeaderActionTone = 'solid' | 'tint';

interface HeaderActionButtonProps {
  label?: string;
  children?: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  iconOnly?: boolean;
  tone?: HeaderActionTone;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function HeaderActionButton({
  label,
  children,
  onPress,
  disabled = false,
  iconOnly = false,
  tone,
  accessibilityLabel,
  testID,
  style,
}: HeaderActionButtonProps) {
  const colors = useAppColors();
  // Icon-only header buttons match the notification bell / back button tint by
  // default; labelled pills stay solid unless a tone is passed explicitly.
  const resolvedTone: HeaderActionTone = tone ?? (iconOnly ? 'tint' : 'solid');
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={[
        styles.button,
        resolvedTone === 'tint' && styles.tint,
        iconOnly && styles.iconOnly,
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={Header.actionActiveOpacity}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
    >
      {children ?? (
        <Typography
          variant="caption1"
          color={
            disabled
              ? colors.textSecondary
              : resolvedTone === 'tint'
                ? colors.primary
                : colors.white
          }
          weight="semibold"
        >
          {label}
        </Typography>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    button: {
      minWidth: Header.actionMinWidth,
      minHeight: Header.actionHeight,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Header.actionBorderRadius,
      borderWidth: 1,
      borderColor: colors.primary,
      paddingHorizontal: Header.actionPaddingHorizontal,
      backgroundColor: colors.primary,
    },
    tint: {
      // Matches the circular back button's fill (pastel teal @ 0x33 ≈ 20%) so
      // the gear reads identically to the back button + notification bell.
      backgroundColor: hexToRgba(colors.primary, 0.2),
      borderColor: colors.headerNotificationBorder,
    },
    disabled: {
      backgroundColor: colors.pillBackground,
      borderColor: colors.borderColor,
      opacity: Header.actionDisabledOpacity,
    },
    iconOnly: {
      width: Header.circleButtonSize,
      height: Header.circleButtonSize,
      minWidth: Header.circleButtonSize,
      borderRadius: Header.circleButtonRadius,
      paddingHorizontal: 0,
    },
  });
