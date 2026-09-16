import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppColors } from '@theme';

/**
 * Shared horizontal progress bar — a brand-neutral track + fill primitive used
 * for "% paid off ($)", category headroom, savings pace, etc. The fill fraction
 * is a pure, unit-testable function so the width math is verified without
 * rendering. Colors come from `useAppColors()`.
 */

/**
 * Fraction of the bar to fill, clamped to [0, 1].
 * - `clampFraction(0.4)` → 0.4 (value is already a fraction)
 * - `clampFraction(30, 120)` → 0.25 (value / max)
 * - `max <= 0` → 0 (avoids divide-by-zero); non-finite → 0.
 */
export function clampFraction(value: number, max?: number): number {
  const frac = max == null ? value : max <= 0 ? 0 : value / max;
  return Number.isFinite(frac) ? Math.max(0, Math.min(1, frac)) : 0;
}

interface ProgressBarProps {
  /** Fraction in [0, 1]. Use this OR `value` + `max`. */
  progress?: number;
  /** Absolute value paired with `max` (e.g. dollars retired). */
  value?: number;
  /** Denominator for `value` (e.g. original principal). */
  max?: number;
  /** Bar height in points (default 8). Also drives the pill radius. */
  height?: number;
  /** Fill color. Defaults to the brand primary. */
  color?: string;
  /** Track color. Defaults to the theme border color. */
  trackColor?: string;
  testID?: string;
}

export function ProgressBar({
  progress,
  value,
  max,
  height = 8,
  color,
  trackColor,
  testID,
}: ProgressBarProps) {
  const colors = useAppColors();
  const fraction =
    value != null ? clampFraction(value, max ?? 0) : clampFraction(progress ?? 0);
  const fill = color ?? colors.primary;
  const track = trackColor ?? colors.borderColor;
  const radius = height / 2;

  return (
    <View
      style={[styles.track, { height, borderRadius: radius, backgroundColor: track }]}
      testID={testID}
    >
      <View
        style={[
          styles.fill,
          { width: `${fraction * 100}%`, borderRadius: radius, backgroundColor: fill },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});
