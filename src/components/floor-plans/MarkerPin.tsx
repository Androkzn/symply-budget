import React, { useMemo } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';

import type { FloorPlanMarker } from '@api/floor-plans';
import { useAppColors } from '@theme';
import type { AppColors } from '@theme';

interface MarkerPinProps {
  marker: FloorPlanMarker;
  scale: number;
  taskCategory?: string | null;
  onPress?: () => void;
}

export function MarkerPin({ marker, scale, taskCategory: _taskCategory, onPress }: MarkerPinProps) {
  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    marker_type = 'pin',
    marker_icon = '📍',
  } = marker;
  // `marker_color` is user/marker data; fall back to the brand accent (blue)
  // so it stays theme-aware when the marker has no explicit color.
  const marker_color = marker.marker_color ?? colors.accent;

  // Scale markers based on zoom - smaller when zoomed in for precise placement
  const isPinMarker = marker_type === 'pin';
  const baseSize = isPinMarker ? 32 : 28;
  // Allow non-pin markers to scale down more when zoomed in (min 10px at max zoom)
  const minSize = isPinMarker ? 16 : 10;
  const size = Math.max(minSize, baseSize / scale);
  const fontSize = Math.max(8, 18 / scale);


  const renderMarker = () => {
    switch (marker_type) {
      case 'pin':
        return (
          <View style={[styles.pinContainer, { width: size, height: size * 1.2 }]}>
            <View
              style={[
                styles.pinTop,
                {
                  width: size,
                  height: size,
                  backgroundColor: marker_color,
                  borderRadius: size / 2,
                },
              ]}
            >
              <Text style={[styles.icon, { fontSize }]}>{marker_icon}</Text>
            </View>
            <View
              style={[
                styles.pinBottom,
                {
                  width: 0,
                  height: 0,
                  borderLeftWidth: size / 4,
                  borderRightWidth: size / 4,
                  borderTopWidth: size / 3,
                  borderTopColor: marker_color,
                },
              ]}
            />
          </View>
        );

      case 'circle':
        return (
          <View
            style={[
              styles.circle,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: marker_color + '33',
                borderColor: marker_color,
                borderWidth: 2 / scale,
              },
            ]}
          >
            <Text style={[styles.icon, { fontSize }]}>{marker_icon}</Text>
          </View>
        );

      case 'square':
        return (
          <View
            style={[
              styles.square,
              {
                width: size,
                height: size,
                borderRadius: 4 / scale,
                backgroundColor: marker_color + '33',
                borderColor: marker_color,
                borderWidth: 2 / scale,
              },
            ]}
          >
            <Text style={[styles.icon, { fontSize }]}>{marker_icon}</Text>
          </View>
        );

      default:
        return null;
    }
  };

  // Task markers don't show labels - just the icon
  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        pressed && { opacity: 0.7 },
      ]}
      onPress={onPress}
      hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
    >
      {renderMarker()}
    </Pressable>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    taskMarker: {
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 6,
    },
    taskIcon: {
      color: colors.white,
      fontWeight: 'bold',
      textAlign: 'center',
    },
    pinContainer: {
      alignItems: 'center',
    },
    pinTop: {
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      elevation: 5,
    },
    pinBottom: {
      borderStyle: 'solid',
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      marginTop: -1,
    },
    circle: {
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      elevation: 5,
    },
    square: {
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      elevation: 5,
    },
    icon: {
      textAlign: 'center',
    },
  });
