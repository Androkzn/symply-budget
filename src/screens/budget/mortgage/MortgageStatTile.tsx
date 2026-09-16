import React from 'react';
import { StyleSheet } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Spacing, useAppColors } from '@theme';

/**
 * One KPI tile on the Mortgage screens (label + figure + optional provenance
 * hint). Shared by every mortgage view so the tile rows read identically — do not
 * re-declare a local copy.
 */
export function StatTile({
  label,
  value,
  hint,
  valueColor,
  testID,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Tints the figure (e.g. an interest cost in the warm chart hue). */
  valueColor?: string;
  testID?: string;
}) {
  const colors = useAppColors();
  return (
    <Card variant="filled" style={styles.tile} testID={testID}>
      <Typography variant="caption" color={colors.textSecondary}>
        {label}
      </Typography>
      <Typography variant="bodyLarge" weight="bold" color={valueColor}>
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" color={colors.textSecondary}>
          {hint}
        </Typography>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, padding: Spacing.base, gap: Spacing.xxs },
});
