import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';

interface GrowingPlantProps {
  size?: number;
}

/**
 * Looping "plant growing from the ground" animation used in place of a spinner
 * for garden-related loading states. The seedling emoji starts small and tucked
 * down, then scales up and rises to its full size before resetting.
 */
export const GrowingPlant: React.FC<GrowingPlantProps> = ({ size = 28 }) => {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    const runIteration = () => {
      if (cancelled) return;
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: 1600,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished || cancelled) return;
        setTimeout(runIteration, 350);
      });
    };
    runIteration();
    return () => {
      cancelled = true;
    };
  }, [progress]);

  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 1.1],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [size * 0.3, 0],
  });
  const rotate = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-6deg', '4deg', '0deg'],
  });

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Animated.Text
        style={[
          styles.emoji,
          {
            fontSize: size,
            lineHeight: size,
            transform: [{ translateY }, { scale }, { rotate }],
          },
        ]}
      >
        🌱
      </Animated.Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  emoji: {
    textAlign: 'center',
  },
});
