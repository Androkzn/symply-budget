import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import React, { useMemo } from 'react';
import {
  Platform,
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

import { Icon } from '@components/ui/Icon';
import { Spacing, useAppColors, type AppColors } from '@theme';

const MAP_COMPASS_CONTROL_TOKENS = {
  containerRadius: 28,
  containerPadding: 6,
  containerGap: Spacing.sm,
  containerBorderColor: 'rgba(255,255,255,0.07)',
  containerFallbackFill: 'rgba(255,255,255,0.015)',
  containerShadowOpacity: 0.025,
  rotateButtonSize: 36,
  arrowFontSize: 16,
  arrowLineHeight: 18,
  centerWidth: 30,
  centerHeight: 36,
  needleSize: 20,
  needleHalfWidth: 5,
  needleHeight: 9,
} as const;

interface MapCompassControlProps {
  headingDegrees: number;
  onRotateLeft?: () => void;
  onRotateRight?: () => void;
  onResetRotation?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function MapCompassControl({
  headingDegrees,
  onRotateLeft,
  onRotateRight,
  onResetRotation,
  style,
}: MapCompassControlProps) {
  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hasRotationControls = Boolean(onRotateLeft && onRotateRight);

  const content = (
    <>
      {hasRotationControls && (
        <TouchableOpacity
          style={styles.rotateButton}
          onPress={onRotateLeft}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Rotate map counterclockwise"
        >
          <Icon
            name="arrow-undo"
            size={MAP_COMPASS_CONTROL_TOKENS.arrowFontSize}
            color={colors.white}
          />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.centerHit}
        onPress={onResetRotation}
        disabled={!onResetRotation}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Reset map rotation"
      >
        <View style={[styles.needleWrap, { transform: [{ rotate: `${headingDegrees}deg` }] }]}>
          <View style={styles.needleNorth} />
          <View style={styles.needleSouth} />
        </View>
      </TouchableOpacity>

      {hasRotationControls && (
        <TouchableOpacity
          style={styles.rotateButton}
          onPress={onRotateRight}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Rotate map clockwise"
        >
          <Icon
            name="arrow-redo"
            size={MAP_COMPASS_CONTROL_TOKENS.arrowFontSize}
            color={colors.white}
          />
        </TouchableOpacity>
      )}
    </>
  );

  if (isLiquidGlassAvailable()) {
    return (
      <GlassView style={[styles.container, style]} glassEffectStyle="regular" isInteractive>
        {content}
      </GlassView>
    );
  }

  return <View style={[styles.container, style]}>{content}</View>;
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: MAP_COMPASS_CONTROL_TOKENS.containerGap,
      padding: MAP_COMPASS_CONTROL_TOKENS.containerPadding,
      borderRadius: MAP_COMPASS_CONTROL_TOKENS.containerRadius,
      overflow: 'hidden',
      borderWidth: 0.5,
      borderColor: MAP_COMPASS_CONTROL_TOKENS.containerBorderColor,
      backgroundColor: MAP_COMPASS_CONTROL_TOKENS.containerFallbackFill,
      ...Platform.select({
        ios: {
          shadowColor: '#FFFFFF',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: MAP_COMPASS_CONTROL_TOKENS.containerShadowOpacity,
          shadowRadius: 8,
        },
        android: {
          elevation: 4,
        },
      }),
    },
    rotateButton: {
      width: MAP_COMPASS_CONTROL_TOKENS.rotateButtonSize,
      height: MAP_COMPASS_CONTROL_TOKENS.rotateButtonSize,
      borderRadius: MAP_COMPASS_CONTROL_TOKENS.rotateButtonSize / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    centerHit: {
      width: MAP_COMPASS_CONTROL_TOKENS.centerWidth,
      height: MAP_COMPASS_CONTROL_TOKENS.centerHeight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    needleWrap: {
      width: MAP_COMPASS_CONTROL_TOKENS.needleSize,
      height: MAP_COMPASS_CONTROL_TOKENS.needleSize,
      alignItems: 'center',
      justifyContent: 'center',
    },
    needleNorth: {
      position: 'absolute',
      top: 0,
      width: 0,
      height: 0,
      borderLeftWidth: MAP_COMPASS_CONTROL_TOKENS.needleHalfWidth,
      borderRightWidth: MAP_COMPASS_CONTROL_TOKENS.needleHalfWidth,
      borderBottomWidth: MAP_COMPASS_CONTROL_TOKENS.needleHeight,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderBottomColor: colors.error,
    },
    needleSouth: {
      position: 'absolute',
      bottom: 0,
      width: 0,
      height: 0,
      borderLeftWidth: MAP_COMPASS_CONTROL_TOKENS.needleHalfWidth,
      borderRightWidth: MAP_COMPASS_CONTROL_TOKENS.needleHalfWidth,
      borderTopWidth: MAP_COMPASS_CONTROL_TOKENS.needleHeight,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderTopColor: colors.textTertiary,
    },
  });
