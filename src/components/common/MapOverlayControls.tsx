import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Icon } from '@components/ui/Icon';
import { Spacing, useAppColors } from '@theme';

import { MapCompassControl } from './MapCompassControl';

interface OverlayAction {
  id: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
}

interface MapOverlayControlsProps {
  rightActions: OverlayAction[];
  topInset?: number;
  rightStackBottomInset?: number;
  showCompass?: boolean;
  compassRotationDegrees?: number;
  onRotateLeft?: () => void;
  onRotateRight?: () => void;
  onCompassPress?: () => void;
}

export function MapOverlayControls({
  rightActions,
  topInset = 0,
  rightStackBottomInset,
  showCompass = true,
  compassRotationDegrees = 0,
  onRotateLeft,
  onRotateRight,
  onCompassPress,
}: MapOverlayControlsProps) {
  const colors = useAppColors();
  const mainActionColor = colors.primary;
  const rightStackPosition =
    rightStackBottomInset == null
      ? { top: Spacing.sm + topInset }
      : { bottom: rightStackBottomInset };

  return (
    <>
      <View style={[styles.rightStack, rightStackPosition]}>
        {rightActions.map(action => (
          <TouchableOpacity
            key={action.id}
            style={[
              styles.controlButton,
              {
                backgroundColor: mainActionColor,
                borderColor: mainActionColor,
                opacity: action.disabled ? 0.45 : 0.95,
              },
            ]}
            onPress={action.onPress}
            disabled={action.disabled}
            activeOpacity={0.78}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            {action.icon ? (
              <Icon name={action.icon} size={24} color={colors.white} />
            ) : (
              <Text style={[styles.controlLabel, { color: colors.white }]}>{action.label}</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {showCompass && (
        <MapCompassControl
          headingDegrees={compassRotationDegrees}
          onRotateLeft={onRotateLeft}
          onRotateRight={onRotateRight}
          onResetRotation={onCompassPress}
          style={[
            styles.compass,
            {
              top: Spacing.sm + topInset,
            },
          ]}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  rightStack: {
    position: 'absolute',
    right: Spacing.sm,
    gap: Spacing.sm,
  },
  controlButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlLabel: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '700',
  },
  compass: {
    position: 'absolute',
    left: Spacing.sm,
  },
});
