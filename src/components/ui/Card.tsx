import React, { useMemo, useCallback } from 'react';
import { Platform, Pressable, StyleSheet, View, ViewProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { useTheme } from '@contexts/ThemeContext';
import { ButtonMetrics, CornerRadius, Elevation, Spacing, useAppColors } from '@theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface CardProps extends ViewProps {
  children: React.ReactNode;
  variant?: 'elevated' | 'outlined' | 'filled';
  pressable?: boolean;
  onPress?: () => void;
}

export function Card({
  children,
  variant = 'elevated',
  pressable = false,
  onPress,
  style,
  ...props
}: CardProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    if (pressable) {
      scale.value = withSpring(ButtonMetrics.pressScaleCard, { damping: 15, stiffness: 300 });
    }
  }, [pressable, scale]);

  const handlePressOut = useCallback(() => {
    if (pressable) {
      scale.value = withSpring(1, { damping: 15, stiffness: 300 });
    }
  }, [pressable, scale]);

  const cardStyles = useMemo(() => {
    const baseStyles = {
      backgroundColor: colors.backgroundSecondary,
      borderRadius: CornerRadius.lg,
    };

    switch (variant) {
      case 'elevated':
        return {
          ...baseStyles,
          ...Platform.select({
            ios: {
              shadowColor: colors.black,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: theme.dark ? 0.3 : 0.08,
              shadowRadius: 12,
            },
            android: {
              elevation: Elevation.cardRaised,
            },
          }),
        };
      case 'outlined':
        return {
          ...baseStyles,
          borderWidth: 1,
          borderColor: colors.borderColor,
        };
      case 'filled':
        return baseStyles;
      default:
        return baseStyles;
    }
  }, [variant, theme.dark, colors.black, colors.backgroundSecondary, colors.borderColor]);

  if (pressable) {
    return (
      <AnimatedPressable
        style={[styles.card, cardStyles, animatedStyle, style]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        {...props}
      >
        {children}
      </AnimatedPressable>
    );
  }

  return (
    <View style={[styles.card, cardStyles, style]} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    overflow: 'hidden',
  },
});
