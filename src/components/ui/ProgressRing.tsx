import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useAppColors } from '@theme';

import { Typography } from './Typography';

/**
 * Shared radial progress ring — a single, brand-neutral primitive for any
 * "% complete" visual (mortgage paid-off, savings goal, task completion, …).
 *
 * Geometry is a pure, unit-testable function; the component only wires it to an
 * SVG track + progress arc and a center label. The arc starts at 12 o'clock
 * (rotated −90°) and fills clockwise, with a rounded cap so partial rings read
 * cleanly. Colors come from `useAppColors()`; nothing is hardcoded.
 */

export interface RingGeometry {
  /** Circle radius (stroke-inset from the box). */
  radius: number;
  /** Full circumference (= dash array length). */
  circumference: number;
  /** Dash offset that leaves `clamped` fraction of the ring drawn. */
  dashOffset: number;
  /** Progress clamped to [0, 1]; non-finite input → 0. */
  clamped: number;
  /** Center coordinate (size / 2). */
  center: number;
}

/**
 * Pure ring geometry. Clamps progress to [0,1] (NaN/±∞ → 0) and never returns a
 * negative radius, so a tiny `size` relative to `stroke` degrades gracefully.
 */
export function ringGeometry(size: number, stroke: number, progress: number): RingGeometry {
  const clamped = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const radius = Math.max(0, (size - stroke) / 2);
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped);
  return { radius, circumference, dashOffset, clamped, center: size / 2 };
}

interface ProgressRingProps {
  /** Progress in [0, 1]. Values outside the range are clamped. */
  progress: number;
  /** Outer box size in points (default 140). */
  size?: number;
  /** Ring thickness in points (default 14). */
  stroke?: number;
  /** Progress arc color. Defaults to the brand primary. */
  color?: string;
  /** Track (unfilled) color. Defaults to the theme border color. */
  trackColor?: string;
  /** Show the big centered percentage (default true). */
  showPercent?: boolean;
  /** Small caption under the percentage (e.g. "paid off"). */
  label?: string;
  /** Replace the default percent + label center with custom content. */
  children?: React.ReactNode;
  testID?: string;
}

export function ProgressRing({
  progress,
  size = 140,
  stroke = 14,
  color,
  trackColor,
  showPercent = true,
  label,
  children,
  testID,
}: ProgressRingProps) {
  const colors = useAppColors();
  const { radius, circumference, dashOffset, clamped, center } = ringGeometry(size, stroke, progress);
  const arcColor = color ?? colors.primary;
  const track = trackColor ?? colors.borderColor;

  const containerStyle = useMemo(
    () => ({
      width: size,
      height: size,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    }),
    [size]
  );

  return (
    <View style={containerStyle} testID={testID}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={center} cy={center} r={radius} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={arcColor}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>
      {children ?? (
        <View style={styles.center}>
          {showPercent ? (
            <Typography variant="title" weight="bold" color={colors.textPrimary}>
              {Math.round(clamped * 100)}%
            </Typography>
          ) : null}
          {label ? (
            <Typography variant="caption" align="center" color={colors.textSecondary}>
              {label}
            </Typography>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
