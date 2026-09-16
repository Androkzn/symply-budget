import React, { useEffect } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/**
 * HealthSpinner — Symply Health's branded loading indicator.
 *
 * Two red brush-stroke layers composited into one spinner:
 *   • the enso ring rotates continuously (the "loading" motion), and
 *   • the heart pulses with a lub-dub heartbeat in the centre.
 *
 * Drop-in replacement for `<ActivityIndicator />`: accepts the same
 * `size` (`'small' | 'large' | number`) prop.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const HEART = require('../assets/spinner-heart.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RING = require('../assets/spinner-ring.png');

const KEYWORD_SIZES = { small: 20, large: 36 } as const;

// The heart nests at half the ring's diameter (matching the Budget spinner's
// symbol nesting), leaving the brush stroke breathing room around it.
const HEART_RATIO = 0.5;

export interface HealthSpinnerProps {
  /** Diameter in px, or ActivityIndicator-style keyword. Default `'small'`. */
  size?: 'small' | 'large' | number;
  /** Milliseconds per full rotation of the ring. Default 1200. */
  rotationDuration?: number;
  /** Milliseconds per full heartbeat cycle. Default 1100. */
  beatDuration?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function HealthSpinner({
  size = 'small',
  rotationDuration = 1200,
  beatDuration = 1100,
  style,
  testID,
}: HealthSpinnerProps) {
  const dimension = typeof size === 'number' ? size : KEYWORD_SIZES[size];
  const heartSize = dimension * HEART_RATIO;

  const rotation = useSharedValue(0);
  const beat = useSharedValue(1);

  useEffect(() => {
    rotation.value = 0;
    rotation.value = withRepeat(
      withTiming(360, { duration: rotationDuration, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(rotation);
  }, [rotation, rotationDuration]);

  useEffect(() => {
    // Lub-dub: a quick double thump, then a rest — a real heartbeat rhythm.
    const thump = beatDuration * 0.14;
    const rest = beatDuration - thump * 4;
    beat.value = withRepeat(
      withSequence(
        withTiming(1.18, { duration: thump, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: thump, easing: Easing.in(Easing.quad) }),
        withTiming(1.12, { duration: thump, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: thump, easing: Easing.in(Easing.quad) }),
        withTiming(1, { duration: rest, easing: Easing.linear }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(beat);
  }, [beat, beatDuration]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const heartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: beat.value }],
  }));

  return (
    <View
      style={[{ width: dimension, height: dimension }, styles.center, style]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      <Animated.Image
        source={RING}
        style={[{ width: dimension, height: dimension }, styles.absolute, ringStyle]}
        resizeMode="contain"
      />
      <Animated.Image
        source={HEART}
        style={[{ width: heartSize, height: heartSize }, heartStyle]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  absolute: {
    position: 'absolute',
  },
});

export default HealthSpinner;
