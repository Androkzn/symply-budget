import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Platform, Pressable, PressableProps, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAppStore } from '@stores/appStore';
import {
  ButtonMetrics,
  CornerRadius,
  Elevation,
  LegacyTextVariant,
  Opacity,
  Spacing,
  TypographyTokens,
  UIFoundation,
  getButtonGradientColors,
  useAppColors,
} from '@theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface ButtonProps extends Omit<PressableProps, 'style'> {
  title: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  textColor?: string;
  /**
   * Underline the label. Defaults on for `ghost`, which is otherwise bare text
   * needing something to read as tappable — pass `false` where the surrounding
   * layout already makes that clear and the rule would read as a web link.
   */
  underline?: boolean;
  style?: object;
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  textColor,
  underline,
  style,
  disabled,
  ...props
}: ButtonProps) {
  const colors = useAppColors();
  const accentScheme = useAppStore((s) => s.accentScheme);
  const scale = useSharedValue(1);
  const isPrimary = variant === 'primary';
  /** Variants that paint a surface — they carry the elevation; the transparent
   *  ones (outline/ghost/destructive) must not cast a shadow around nothing. */
  const isFilled = variant === 'primary' || variant === 'secondary';
  /** A disabled primary drops the gradient for a solid `actionDisabled` fill:
   *  `getButtonGradientColors({ disabled })` returns two identical stops, which
   *  render nothing at all, leaving the label floating on bare background. */
  const usesGradient = isPrimary && !disabled;
  const borderRadius = fullWidth ? ButtonMetrics.primaryCornerRadius : CornerRadius.md;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(ButtonMetrics.pressScaleCard, { damping: 15, stiffness: 300 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  const getBackgroundColor = () => {
    switch (variant) {
      case 'outline':
      case 'ghost':
      case 'destructive':
        // Transparent variants stay transparent when disabled — a grey fill
        // would turn an outline button into a different control entirely.
        return 'transparent';
      case 'secondary':
        // `secondaryButtonBackground`, NOT `backgroundSecondary`: the latter is
        // the Card fill, so a secondary button inside a Card vanished into it.
        return disabled ? colors.actionDisabled : colors.secondaryButtonBackground;
      default:
        return disabled ? colors.actionDisabled : colors.primary;
    }
  };

  const getTextColor = () => {
    if (disabled) return colors.textSecondary;
    switch (variant) {
      case 'primary':
        return colors.white;
      case 'secondary':
        return colors.textPrimary;
      case 'destructive':
        return colors.error;
      case 'outline':
      case 'ghost':
        return colors.primary;
      default:
        return colors.white;
    }
  };

  const getBorderColor = () => {
    if (disabled) return colors.actionDisabled;
    switch (variant) {
      case 'outline':
        return colors.primary;
      case 'destructive':
        return colors.error;
      case 'secondary':
        // Keeps the button legible on surfaces that share its fill.
        return colors.borderColor;
      default:
        return 'transparent';
    }
  };

  const getBorderWidth = () => {
    switch (variant) {
      case 'outline':
      case 'destructive':
        return 1.5;
      case 'secondary':
        return 1;
      default:
        return 0;
    }
  };

  const getPadding = () => {
    switch (size) {
      case 'sm':
        return { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.base };
      case 'lg':
        return { paddingVertical: Spacing.base, paddingHorizontal: Spacing.xxl };
      default:
        return { paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl };
    }
  };

  const getFontSize = () => {
    switch (size) {
      case 'sm':
        return TypographyTokens.bodySmall.size;
      case 'lg':
        return TypographyTokens.bodyLarge.size;
      default:
        return LegacyTextVariant.callout.size;
    }
  };

  const labelColor = textColor || getTextColor();
  const content = (
    <View style={[styles.content, getPadding()]}>
      {loading ? (
        <ActivityIndicator color={labelColor} size="small" />
      ) : (
        <>
          {leftIcon && <View style={styles.iconLeft}>{leftIcon}</View>}
          <Text
            style={[
              styles.text,
              {
                color: labelColor,
                fontSize: getFontSize(),
                textDecorationLine: (underline ?? variant === 'ghost') ? 'underline' : 'none',
              },
            ]}
          >
            {title}
          </Text>
          {rightIcon && <View style={styles.iconRight}>{rightIcon}</View>}
        </>
      )}
    </View>
  );

  const elevationStyle = isFilled
    ? Platform.select({
        ios: {
          shadowColor: colors.black,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: Opacity.buttonRaised,
          shadowRadius: 4,
        },
        android: {
          elevation: Elevation.floating,
        },
      })
    : null;

  return (
    <AnimatedPressable
      style={[
        styles.button,
        animatedStyle,
        {
          borderColor: getBorderColor(),
          borderWidth: getBorderWidth(),
          borderRadius,
          ...elevationStyle,
          ...(!usesGradient
            ? {
                backgroundColor: getBackgroundColor(),
              }
            : null),
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      {...props}
    >
      {usesGradient ? (
        <LinearGradient
          colors={getButtonGradientColors('primary', { schemeId: accentScheme })}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          // The gradient clips itself rather than the Pressable clipping it —
          // `overflow: 'hidden'` on the Pressable also clipped away its shadow.
          style={[styles.gradientFill, { borderRadius }]}
        >
          {content}
        </LinearGradient>
      ) : (
        content
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  gradientFill: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Sits on the content (not the Pressable) so the primary gradient, which
    // wraps it, is guaranteed to cover the whole tap target.
    minHeight: ButtonMetrics.minTapTarget,
  },
  text: {
    fontWeight: '600',
    letterSpacing: UIFoundation.textLetterSpacing,
  },
  iconLeft: {
    marginRight: Spacing.sm,
  },
  iconRight: {
    marginLeft: Spacing.sm,
  },
});
