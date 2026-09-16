import React, { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { Typography } from '@components/ui';
import { Spacing, useAppColors } from '@theme';

/**
 * Dependency-free horizontal rate slider (no native module — works in the New
 * Arch / standalone Release build where `@react-native-community/slider` would
 * need a rebuild). PanResponder maps the touch x to a value in [min, max],
 * snapped to `step`. Continuous `onChange` while dragging drives the live
 * scenario recompute. Pair it with the tappable quick-chips for Maestro (drag
 * gestures aren't reliably scriptable on iOS 26).
 */

const THUMB = 26;
const TRACK_H = 6;

interface RateSliderProps {
  /** Current value (decimal rate, e.g. 0.052). */
  value: number;
  min: number;
  max: number;
  /** Snap step (decimal, e.g. 0.0025 = 0.25%). */
  step: number;
  onChange: (value: number) => void;
  testID?: string;
}

/** Clamp `raw` to [min, max] and snap to the nearest `step` from `min`. Exported
 * for unit testing (the gesture math's core). */
export function snap(raw: number, min: number, max: number, step: number): number {
  const clamped = Math.max(min, Math.min(max, raw));
  const steps = Math.round((clamped - min) / step);
  return Math.max(min, Math.min(max, min + steps * step));
}

/**
 * Map a touch x (relative to the track's left edge) to a snapped value. Pure and
 * exported so the gesture math is unit-testable without driving PanResponder.
 * `width <= 0` (not laid out yet) returns `fallback` (the current value).
 */
export function valueFromLocationX(
  x: number,
  width: number,
  min: number,
  max: number,
  step: number,
  fallback: number
): number {
  if (width <= 0) return fallback;
  const usable = Math.max(1, width - THUMB);
  const frac = Math.max(0, Math.min(1, (x - THUMB / 2) / usable));
  return snap(min + frac * (max - min), min, max, step);
}

export function RateSlider({ value, min, max, step, onChange, testID }: RateSliderProps) {
  const colors = useAppColors();
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  };

  const valueFromX = (x: number): number =>
    valueFromLocationX(x, widthRef.current, min, max, step, value);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => onChange(valueFromX(e.nativeEvent.locationX)),
        onPanResponderMove: (e) => onChange(valueFromX(e.nativeEvent.locationX)),
      }),
    // valueFromX/onChange are stable-enough for the gesture lifetime; recreating
    // the responder on every render would drop an in-flight drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, step]
  );

  const range = max - min || 1;
  const frac = Math.max(0, Math.min(1, (value - min) / range));
  const usable = Math.max(0, width - THUMB);
  const thumbLeft = frac * usable;

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.labels}>
        <Typography variant="caption" color={colors.textSecondary}>
          {(min * 100).toFixed(2)}%
        </Typography>
        <Typography variant="caption" color={colors.textSecondary}>
          {(max * 100).toFixed(2)}%
        </Typography>
      </View>
      <View style={styles.hit} onLayout={onLayout} {...pan.panHandlers}>
        <View style={[styles.track, { backgroundColor: colors.divider }]} />
        <View style={[styles.track, styles.fill, { width: thumbLeft + THUMB / 2, backgroundColor: colors.primary }]} />
        <View
          style={[styles.thumb, { left: thumbLeft, backgroundColor: colors.primary, borderColor: colors.backgroundMain }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  hit: { height: THUMB + 8, justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, height: TRACK_H, borderRadius: TRACK_H / 2 },
  fill: { right: undefined },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 3,
    top: 4,
  },
});
