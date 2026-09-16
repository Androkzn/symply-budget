import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View,
  Text,
  ViewStyle,
  Platform,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Concrete path, not the `@components/common` barrel: that barrel re-exports
// `ScreenHeader`, which imports from `@components/ui` — the barrel this file
// is itself part of — so importing the barrel here creates ui ⇄ common
// circular require that crashes any test mocking one side with
// `jest.requireActual` on the other (partially-initialised exports).
import { ScreenFooterGlass } from '@components/common/ScreenFooterGlass';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useAppStore } from '@stores/appStore';
import {
  ButtonMetrics,
  Elevation,
  Layout,
  Opacity,
  Spacing,
  TypographyTokens,
  getButtonGradientColors,
  useAppColors,
  type ButtonGradientVariant,
} from '@theme';

import { Typography } from './Typography';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export type FloatingButtonVariant = ButtonGradientVariant;

interface FloatingActionButtonProps {
  title: string;
  onPress: () => void;
  icon?: string;
  variant?: FloatingButtonVariant;
  disabled?: boolean;
  bottomOffset?: number;
  style?: ViewStyle;
  maxWidth?: number;
  horizontalPadding?: number;
  testID?: string;
}

const SPRING = { damping: 15, stiffness: 300 } as const;

export function FloatingActionButton({
  title,
  onPress,
  icon,
  variant = 'primary',
  disabled = false,
  bottomOffset = Layout.floatingButtonClearance,
  style,
  maxWidth = 600,
  horizontalPadding,
  testID,
}: FloatingActionButtonProps) {
  const colors = useAppColors();
  const accentScheme = useAppStore((s) => s.accentScheme);
  const insets = useSafeAreaInsets();
  const scale = useSharedValue(1);
  // Same "main padding horizontal" every screen uses for its own content
  // (`AdaptiveContainer`/`useLayoutPadding`) — every floating CTA's outer
  // edges line up with the screen's own content edges instead of each call
  // site picking its own inset.
  const { content: defaultHorizontalPadding } = useLayoutPadding();
  const resolvedHorizontalPadding = horizontalPadding ?? defaultHorizontalPadding;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.97, SPRING);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, SPRING);
  };

  // Disabled paints a solid `actionDisabled` fill with a muted label. The
  // gradient's disabled form is two identical stops, which renders nothing —
  // leaving a white label on bare background, i.e. an invisible button.
  const onFillColor = disabled ? colors.textSecondary : colors.white;

  return (
    <View
      testID={testID}
      style={[
        styles.container,
        {
          bottom: insets.bottom + bottomOffset,
          paddingHorizontal: resolvedHorizontalPadding,
        },
        style,
      ]}
    >
      {/* Shared blur backdrop — same recipe as the floating tab bar and every
          other sticky footer. One source of truth (`ScreenFooterGlass`) so a
          future style change applies to every floating CTA in every brand. */}
      <ScreenFooterGlass />

      <AnimatedTouchable
        style={[
          styles.button,
          {
            maxWidth,
            ...Platform.select({
              ios: {
                shadowColor: colors.black,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: Opacity.toast,
                shadowRadius: 8,
              },
              android: {
                elevation: Elevation.fab,
              },
            }),
          },
          animatedStyle,
        ]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        activeOpacity={0.9}
      >
        {disabled ? (
          <View style={[styles.gradient, { backgroundColor: colors.actionDisabled }]}>
            {icon && <Text style={[styles.icon, { color: onFillColor }]}>{icon}</Text>}

            <View style={icon ? styles.titleContainerWithIcon : styles.titleContainer}>
              <Typography
                variant="headline"
                weight="semibold"
                color={onFillColor}
                style={styles.title}
              >
                {title}
              </Typography>
            </View>
          </View>
        ) : (
          <LinearGradient
            colors={getButtonGradientColors(variant, { schemeId: accentScheme })}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.gradient}
          >
            {icon && <Text style={[styles.icon, { color: onFillColor }]}>{icon}</Text>}

            <View style={icon ? styles.titleContainerWithIcon : styles.titleContainer}>
              <Typography
                variant="headline"
                weight="semibold"
                color={onFillColor}
                style={styles.title}
              >
                {title}
              </Typography>
            </View>
          </LinearGradient>
        )}
      </AnimatedTouchable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  button: {
    width: '100%',
    borderRadius: ButtonMetrics.primaryCornerRadius,
    overflow: 'hidden',
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    borderRadius: ButtonMetrics.primaryCornerRadius,
    height: ButtonMetrics.primaryHeight,
    position: 'relative',
  },
  icon: {
    fontSize: TypographyTokens.title.size,
    fontWeight: '600',
    position: 'absolute',
    left: Spacing.xl,
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainerWithIcon: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
  },
});
