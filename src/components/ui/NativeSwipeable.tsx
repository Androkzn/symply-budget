import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';
import ReanimatedSwipeable, {
  type SwipeableMethods,
  type SwipeableProps,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { useAppColors } from '@theme';

export type { SwipeableMethods };

type NativeSwipeableProps = Omit<
  SwipeableProps,
  'friction' | 'overshootRight' | 'overshootFriction' | 'enableTrackpadTwoFingerGesture'
> &
  Partial<
    Pick<
      SwipeableProps,
      'friction' | 'overshootRight' | 'overshootFriction' | 'enableTrackpadTwoFingerGesture'
    >
  >;

/** ReanimatedSwipeable with iOS-native defaults (finger tracking, no overshoot bounce). */
export function NativeSwipeable({
  friction = 2,
  overshootRight = false,
  overshootFriction = 8,
  enableTrackpadTwoFingerGesture = true,
  ...props
}: NativeSwipeableProps) {
  return (
    <ReanimatedSwipeable
      friction={friction}
      overshootRight={overshootRight}
      overshootFriction={overshootFriction}
      enableTrackpadTwoFingerGesture={enableTrackpadTwoFingerGesture}
      {...props}
    />
  );
}

const DEFAULT_ACTION_WIDTH = 72;

interface NativeSwipeActionProps {
  onPress: () => void;
  backgroundColor: string;
  disabled?: boolean;
  testID?: string;
  width?: number;
  /** Caption under the glyph (iOS Mail style) — a bare icon reads as ambiguous. */
  label?: string;
  /** Defaults to white; override when the action sits on a light fill. */
  tintColor?: string;
  children: React.ReactNode;
}

export function NativeSwipeAction({
  onPress,
  backgroundColor,
  disabled,
  testID,
  width = DEFAULT_ACTION_WIDTH,
  label,
  tintColor,
  children,
}: NativeSwipeActionProps) {
  const colors = useAppColors();
  return (
    <GHTouchableOpacity
      style={[styles.action, { width, backgroundColor }]}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={0.85}
    >
      {children}
      {label ? (
        <Text style={[styles.actionLabel, { color: tintColor ?? colors.white }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </GHTouchableOpacity>
  );
}

export function NativeSwipeActions({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.actions, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: '100%',
  },
  action: {
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  actionLabel: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '600',
  },
});
