import React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
  Platform,
} from 'react-native';

import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import {
  BackButtonChrome,
  BackButtonFill,
  Elevation,
  Opacity,
  Spacing,
  useAppColors,
} from '@theme';

interface BackButtonProps {
  onPress: () => void;
  style?: ViewStyle;
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  backgroundVariant?: 'translucent' | 'solid';
  /**
   * Glyph rendered inside the circular button. Defaults to `chevron-back`.
   * `close` reuses the identical chrome for dismiss/close affordances so every
   * circular nav control across the app reads as one family. `chevron-forward`
   * is the same chrome mirrored — a paired "next" control for a stepper header
   * (see `OnboardingStepScreen`), never a stand-alone "forward" gesture.
   */
  icon?: 'chevron-back' | 'chevron-forward' | 'close';
  /**
   * Some sheet / modal screens live under a gesture root where plain RN
   * touchables never receive taps — pass RNGH's `TouchableOpacity` here so the
   * button stays live (see ScheduleTaskScreen / TaskDetailScreen).
   */
  TouchableComponent?: React.ElementType;
  /** Overrides the default `nav-back-button` test id (e.g. to preserve a screen-specific id). */
  testID?: string;
  accessibilityLabel?: string;
  /** For the `chevron-forward` stepper use — a back/close/dismiss control is never disabled. */
  disabled?: boolean;
}

function addHexAlpha(hex: string, alpha: string) {
  if (hex.startsWith('#') && hex.length === 7) return `${hex}${alpha}`;
  return hex;
}

/**
 * iOS 26 style circular back button.
 */
export function BackButton({
  onPress,
  style,
  size = 'md',
  color,
  backgroundVariant = 'translucent',
  icon = 'chevron-back',
  TouchableComponent = TouchableOpacity,
  testID = 'nav-back-button',
  accessibilityLabel,
  disabled = false,
}: BackButtonProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const config = BackButtonChrome[size];
  const iconColor = color || colors.textPrimary;
  const backgroundColor =
    backgroundVariant === 'solid'
      ? theme.pastel.teal
      : addHexAlpha(theme.pastel.teal, BackButtonFill.translucentAlphaHex);

  return (
    <TouchableComponent
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? (icon === 'close' ? 'Close' : icon === 'chevron-forward' ? 'Continue' : 'Go back')
      }
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        {
          width: config.size,
          height: config.size,
          borderRadius: config.size / 2,
          backgroundColor,
          opacity: disabled ? 0.4 : 1,
          ...Platform.select({
            ios: {
              shadowColor: colors.black,
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: Opacity.backButton,
              shadowRadius: 4,
            },
            android: {
              elevation: Elevation.floating,
            },
          }),
        },
        style,
      ]}
      hitSlop={{ top: Spacing.sm, bottom: Spacing.sm, left: Spacing.sm, right: Spacing.sm }}
      activeOpacity={0.7}
    >
      <Icon
        name={icon}
        size={config.icon}
        color={iconColor}
        // Only the chevrons need the optical nudge; `close` is symmetric.
        style={
          icon === 'chevron-back'
            ? styles.icon
            : icon === 'chevron-forward'
              ? styles.iconForward
              : undefined
        }
      />
    </TouchableComponent>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginLeft: -Spacing.xxs,
  },
  iconForward: {
    marginRight: -Spacing.xxs,
  },
});
