import React, { useEffect } from 'react';
import { Image, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { brandId } from '@brand';
import { getSpinnerAssetsForScheme } from '@brand/assets';
import { useAppStore } from '@stores/appStore';

// Dollar box as a fraction of the ring box. The source mark nests it at ~0.6;
// we drop to 0.5 (ring effectively 20% larger) to give the `$` more breathing
// room inside the circle.
const DOLLAR_RATIO = 0.5;

/**
 * SymplySpinner — the ecosystem's branded loading indicator.
 *
 * Composed from the two brand images: the brush-stroke ring rotates
 * continuously while the dollar glyph nested inside it pulses (scales up/down).
 * Renders the shared lime→teal gradient artwork by default, or Budget's
 * recolored ring/dollar mark when a non-`classic` accent scheme is selected
 * (see `getSpinnerAssetsForScheme`). Drop-in replacement for
 * `<ActivityIndicator />` — same `size` (`'small' | 'large' | number`) prop.
 */

export interface SymplySpinnerProps {
  /** Diameter in px, or ActivityIndicator-style keyword. Default `'small'`. */
  size?: 'small' | 'large' | number;
  /**
   * Accepted for `ActivityIndicator` parity but ignored — the spinner always
   * keeps its brand-mark gradient (scheme-dependent) rather than flattening
   * to a solid colour.
   */
  color?: string;
  /** Milliseconds per full ring rotation. Default 1200. */
  duration?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const KEYWORD_SIZES = { small: 20, large: 36 } as const;
const AnimatedImage = Animated.createAnimatedComponent(Image);

export function SymplySpinner({
  size = 'small',
  duration = 1200,
  style,
  testID,
}: SymplySpinnerProps) {
  const dimension = typeof size === 'number' ? size : KEYWORD_SIZES[size];
  const dollarSize = dimension * DOLLAR_RATIO;

  const accentScheme = useAppStore((s) => s.accentScheme);
  const { ring: RING, dollar: DOLLAR } = getSpinnerAssetsForScheme(brandId, accentScheme);

  const rotation = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    rotation.value = 0;
    rotation.value = withRepeat(
      withTiming(360, { duration, easing: Easing.linear }),
      -1,
      false,
    );
    // Pulse the dollar between 82% and 100% scale, easing in and out.
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, { duration: duration * 0.6, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(rotation);
      cancelAnimation(pulse);
    };
  }, [rotation, pulse, duration]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const dollarStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.82 + pulse.value * 0.18 }],
  }));

  return (
    <Animated.View
      style={[styles.container, { width: dimension, height: dimension }, style]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      <AnimatedImage
        source={RING}
        resizeMode="contain"
        style={[styles.ring, { width: dimension, height: dimension }, ringStyle]}
      />
      <AnimatedImage
        source={DOLLAR}
        resizeMode="contain"
        style={[{ width: dollarSize, height: dollarSize }, dollarStyle]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
  },
});

export default SymplySpinner;
