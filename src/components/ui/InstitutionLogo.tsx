import React from 'react';
import { StyleSheet, View } from 'react-native';

import { badgeTextColor, getInstitutionInfo } from '@utils/institution-logos';

import { Typography } from './Typography';

interface InstitutionLogoProps {
  /** Institution name (curated or custom). Null → a neutral placeholder badge. */
  name: string | null | undefined;
  /** Badge diameter in px. */
  size?: number;
}

/**
 * Normalized brand badge for a financial institution: a uniform circle filled
 * with the institution's brand color and its monogram, so every row in the
 * institution picker (and the account card) reads consistently regardless of
 * whether it's a curated brand or a custom one. Purely presentational.
 */
export function InstitutionLogo({ name, size = 28 }: InstitutionLogoProps) {
  const info = getInstitutionInfo(name);
  const color = info?.color ?? '#B7C0CC';
  const label = info?.short ?? '?';
  const textColor = badgeTextColor(color);
  // Monogram scales with the badge; clamp so 3-char marks (RBC/BMO) still fit.
  const fontSize = Math.round(size * (label.length >= 3 ? 0.34 : 0.42));

  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
      ]}
    >
      <Typography weight="bold" color={textColor} style={{ fontSize }} allowFontScaling={false}>
        {label}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
