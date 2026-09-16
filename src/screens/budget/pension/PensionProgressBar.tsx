import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppColors } from '@theme';

interface PensionProgressBarProps {
  /** 0..1 fill fraction (clamped). */
  fraction: number;
  /** Fill color token. */
  color: string;
  /** Optional second (stacked) segment drawn after the first, e.g. employer split. */
  secondFraction?: number;
  secondColor?: string;
  /** True → paint the track in the error tint (over-contribution). */
  over?: boolean;
}

/**
 * Tokenized horizontal progress bar for the Pension views. Presentation only —
 * every figure it visualizes is computed server-side. Fully token-driven (no
 * hardcoded colors), matching the app's card/room-bar language.
 */
export function PensionProgressBar({
  fraction,
  color,
  secondFraction = 0,
  secondColor,
  over = false,
}: PensionProgressBarProps) {
  const colors = useAppColors();
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const first = clamp(fraction) * 100;
  const second = clamp(secondFraction) * 100;

  return (
    <View style={[styles.track, { backgroundColor: colors.surfaceSelected }]}>
      <View
        style={[styles.segment, { width: `${first}%`, backgroundColor: over ? colors.error : color }]}
      />
      {second > 0 && secondColor ? (
        <View style={[styles.segment, { width: `${second}%`, backgroundColor: secondColor }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    width: '100%',
  },
  segment: { height: '100%' },
});
