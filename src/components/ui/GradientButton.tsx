import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  ViewStyle,
  Platform,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAppStore } from '@stores/appStore';
import {
  ButtonMetrics,
  Elevation,
  GradientButton as GradientButtonSizes,
  Opacity,
  Spacing,
  UIFoundation,
  getButtonGradientColors,
  useAppColors,
  type ButtonGradientVariant,
} from '@theme';

import { Typography } from './Typography';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
/** UI-thread % label — keeps updating while JS is blocked (Argon2). */
const AnimatedPercentInput = Animated.createAnimatedComponent(TextInput);

const SPRING = { damping: 15, stiffness: 300 } as const;

/** @deprecated Prefer `primary` — `teal` remains as a legacy alias for brand primary. */
export type GradientButtonVariant = ButtonGradientVariant;
export type GradientButtonSize = 'sm' | 'md' | 'lg';

interface GradientButtonProps {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  variant?: GradientButtonVariant;
  icon?: React.ReactNode;
  iconEmoji?: string;
  size?: GradientButtonSize;
  fullWidth?: boolean;
  testID?: string;
  /**
   * When set (0–1), the whole button becomes a progress control: the brand
   * gradient fills left→right across the full button chrome. Animation runs on
   * the UI thread so it keeps moving if JS is blocked (e.g. Argon2).
   */
  progress?: number | null;
  /**
   * While `progress` is active, ease the fill toward ~90% over this many ms on
   * the UI thread. Stage updates via `progress` can jump ahead; completion
   * should pass `progress={1}`.
   */
  progressEstimateMs?: number;
  /**
   * Touchable to render instead of the default reanimated `Pressable`. Pass
   * react-native-gesture-handler's `TouchableOpacity` on screens where the RN
   * responder system is swallowed by a gesture root (e.g. inside a native-stack
   * modal wrapped in its own `GestureHandlerRootView`), otherwise the button
   * receives no taps. Trades the press-scale animation for RNGH's opacity feedback.
   */
  TouchableComponent?: React.ElementType;
}

export function GradientButton({
  title,
  onPress,
  disabled = false,
  loading = false,
  style,
  variant = 'primary',
  icon,
  iconEmoji,
  size = 'md',
  fullWidth = false,
  testID,
  progress = null,
  progressEstimateMs,
  TouchableComponent,
}: GradientButtonProps) {
  const colors = useAppColors();
  const accentScheme = useAppStore((s) => s.accentScheme);
  const scale = useSharedValue(1);
  const fill = useSharedValue(0);
  const shellWidth = useSharedValue(0);
  const estimateStartedRef = useRef(false);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const isProgressMode = progress != null && Number.isFinite(progress);
  const isDisabled = disabled || loading || isProgressMode;

  // Start a single UI-thread ease when progress mode begins (survives JS stalls).
  useEffect(() => {
    if (!isProgressMode) {
      estimateStartedRef.current = false;
      cancelAnimation(fill);
      fill.value = 0;
      return;
    }
    if (estimateStartedRef.current) return;
    estimateStartedRef.current = true;
    // Visible kick so the fill is obvious before Argon2 freezes JS.
    fill.value = 0.12;
    const estimate = progressEstimateMs ?? 0;
    if (estimate > 0) {
      fill.value = withTiming(0.9, {
        duration: estimate,
        easing: Easing.out(Easing.quad),
      });
    }
  }, [isProgressMode, progressEstimateMs, fill]);

  // Stage floors from JS (after Argon2 unblocks) can jump the fill forward.
  useEffect(() => {
    if (!isProgressMode || progress == null) return;
    const target = Math.max(0, Math.min(1, progress));
    if (target < 0.9) return;
    cancelAnimation(fill);
    fill.value = withTiming(target, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [isProgressMode, progress, fill]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: Math.max(0, shellWidth.value * Math.max(0, Math.min(1, fill.value))),
  }));

  const percentProps = useAnimatedProps(() => {
    const pct = Math.round(Math.max(0, Math.min(1, fill.value)) * 100);
    return {
      text: `${pct}%`,
      value: `${pct}%`,
    };
  });

  const handlePressIn = () => {
    scale.value = withSpring(0.97, SPRING);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, SPRING);
  };

  const onProgressLayout = (event: LayoutChangeEvent) => {
    const w = event.nativeEvent.layout.width;
    if (w <= 0 || w === layoutWidth) return;
    setLayoutWidth(w);
    shellWidth.value = w;
  };

  const sizeStyles = GradientButtonSizes[size];
  const radius = fullWidth ? ButtonMetrics.primaryCornerRadius : sizeStyles.radius;
  const brandColors = getButtonGradientColors(variant, {
    disabled: false,
    disabledColor: colors.actionDisabled,
    schemeId: accentScheme,
  });

  // A disabled button is a flat, muted control — not a dimmed brand CTA. White
  // text at `onGradientDisabled` over the pale disabled fill was effectively
  // invisible (e.g. "Save new key" on the BYOK change-key screen), so the
  // disabled state borrows the shared `Button`'s treatment instead: solid
  // `actionDisabled` fill, `textSecondary` label, no raise, no text shadow.
  const isMuted = isDisabled && !isProgressMode;
  const onFillColor = isMuted ? colors.textSecondary : colors.white;

  const shadowStyle = isMuted
    ? undefined
    : Platform.select({
        ios: {
          shadowColor: colors.black,
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: Opacity.gradientButton,
          shadowRadius: 6,
        },
        android: {
          elevation: Elevation.cardRaised,
        },
        default: {},
      });

  const label = (
    <>
      {loading && !isProgressMode ? (
        <ActivityIndicator color={onFillColor} size="small" />
      ) : (
        <>
          {icon && <View style={styles.icon}>{icon}</View>}

          {iconEmoji && (
            <Text
              style={[
                styles.iconEmoji,
                { fontSize: sizeStyles.icon, color: onFillColor },
              ]}
            >
              {iconEmoji}
            </Text>
          )}

          <Typography
            variant={size === 'sm' ? 'subheadline' : 'headline'}
            weight="semibold"
            style={[
              styles.text,
              {
                color: onFillColor,
                letterSpacing: UIFoundation.textLetterSpacing,
              },
              !isMuted && {
                textShadowColor: 'rgba(0,0,0,0.35)',
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 2,
              },
            ]}
          >
            {title}
          </Typography>
        </>
      )}
    </>
  );

  if (isProgressMode) {
    return (
      <View
        style={[styles.container, fullWidth && styles.fullWidth, shadowStyle, style]}
        testID={testID}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round((progress ?? 0) * 100) }}
      >
        <View
          onLayout={onProgressLayout}
          style={[
            styles.progressShell,
            {
              borderRadius: radius,
              // Dim brand track so the full button shape is always visible.
              backgroundColor: colors.actionDisabled,
            },
          ]}
        >
          {/* Full-button muted brand gradient (unfilled remainder). */}
          <LinearGradient
            colors={brandColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.progressTrackGradient, { opacity: 0.35, borderRadius: radius }]}
          />

          {/* Active fill — full gradient clipped to growing width (L→R). */}
          <Animated.View style={[styles.progressFillClip, { borderRadius: radius }, fillStyle]}>
            <LinearGradient
              colors={brandColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: Math.max(layoutWidth, 1),
              }}
            />
          </Animated.View>

          {/* Label sits in normal layout so the button keeps real height. */}
          <View
            style={[
              styles.progressLabelRow,
              {
                paddingVertical: sizeStyles.paddingV,
                paddingHorizontal: sizeStyles.paddingH,
              },
            ]}
            pointerEvents="none"
          >
            <Typography
              variant={size === 'sm' ? 'subheadline' : 'headline'}
              weight="semibold"
              style={[
                styles.text,
                {
                  color: colors.white,
                  letterSpacing: UIFoundation.textLetterSpacing,
                  textShadowColor: 'rgba(0,0,0,0.35)',
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 2,
                },
              ]}
            >
              {title}
            </Typography>
            <AnimatedPercentInput
              editable={false}
              caretHidden
              underlineColorAndroid="transparent"
              defaultValue="0%"
              animatedProps={percentProps}
              style={[
                styles.progressPercent,
                {
                  color: colors.white,
                  fontSize: size === 'sm' ? 15 : 17,
                  fontWeight: '700',
                  letterSpacing: UIFoundation.textLetterSpacing,
                  textShadowColor: 'rgba(0,0,0,0.35)',
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 2,
                },
              ]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </View>
        </View>
      </View>
    );
  }

  const fillStyles = [
    styles.gradient,
    {
      paddingVertical: sizeStyles.paddingV,
      paddingHorizontal: sizeStyles.paddingH,
      borderRadius: radius,
    },
  ];

  // Disabled paints a plain View: a LinearGradient whose two stops are the same
  // colour rendered nothing at all, leaving the label floating on bare
  // background with no button shape behind it.
  const gradientContent = isMuted ? (
    <View style={[...fillStyles, { backgroundColor: colors.actionDisabled }]}>{label}</View>
  ) : (
    <LinearGradient
      colors={getButtonGradientColors(variant, {
        disabled: false,
        disabledColor: colors.actionDisabled,
        schemeId: accentScheme,
      })}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={fillStyles}
    >
      {label}
    </LinearGradient>
  );

  // Injected touchable (e.g. RNGH's TouchableOpacity) for screens where the RN
  // responder system is swallowed by a gesture root. No reanimated press-scale
  // here — the touchable supplies its own opacity feedback.
  if (TouchableComponent) {
    return (
      <TouchableComponent
        style={[styles.container, fullWidth && styles.fullWidth, shadowStyle, style]}
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.85}
        testID={testID}
      >
        {gradientContent}
      </TouchableComponent>
    );
  }

  return (
    <AnimatedPressable
      style={[
        animatedStyle,
        styles.container,
        fullWidth && styles.fullWidth,
        shadowStyle,
        style,
      ]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isDisabled}
      testID={testID}
    >
      {gradientContent}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {},
  fullWidth: {
    width: '100%',
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: ButtonMetrics.minTapTarget,
  },
  progressShell: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  progressTrackGradient: {
    ...StyleSheet.absoluteFill,
  },
  progressFillClip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  progressPercent: {
    marginLeft: Spacing.sm,
    padding: 0,
    minWidth: 44,
    textAlign: 'left',
  },
  icon: {
    marginRight: Spacing.sm,
  },
  iconEmoji: {
    marginRight: Spacing.sm,
  },
  text: {},
});
