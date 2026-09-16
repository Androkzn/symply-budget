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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const HOUSE = require('../assets/spinner-house.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RING = require('../assets/spinner-ring.png');

// House mark nests at half the ring's diameter — same nesting ratio as the
// Symply/Budget spinner's dollar coin.
const HOUSE_RATIO = 0.5;

/**
 * HouseSpinner — Symply House's branded loading indicator.
 *
 * Same brush-stroke composition and animation as the default Symply spinner
 * (Budget's): a teal ring rotates continuously while the house mark nested
 * inside it pulses. Drop-in replacement for `<ActivityIndicator />` — same
 * `size` (`'small' | 'large' | number'`) prop.
 */

export interface HouseSpinnerProps {
  /** Diameter in px, or ActivityIndicator-style keyword. Default `'small'`. */
  size?: 'small' | 'large' | number;
  /**
   * Accepted for `ActivityIndicator` parity but ignored — the spinner always
   * keeps its brand artwork rather than flattening to a solid colour.
   */
  color?: string;
  /** Milliseconds per full ring rotation. Default 1200. */
  duration?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const KEYWORD_SIZES = { small: 20, large: 36 } as const;
const AnimatedImage = Animated.createAnimatedComponent(Image);

export function HouseSpinner({
  size = 'small',
  duration = 1200,
  style,
  testID,
}: HouseSpinnerProps) {
  const dimension = typeof size === 'number' ? size : KEYWORD_SIZES[size];
  const houseSize = dimension * HOUSE_RATIO;

  const rotation = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    rotation.value = 0;
    rotation.value = withRepeat(
      withTiming(360, { duration, easing: Easing.linear }),
      -1,
      false,
    );
    // Pulse the house mark between 82% and 100% scale, easing in and out.
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

  const houseStyle = useAnimatedStyle(() => ({
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
        source={HOUSE}
        resizeMode="contain"
        style={[{ width: houseSize, height: houseSize }, houseStyle]}
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

export default HouseSpinner;
