import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { Elevation, Shadow } from '@theme';
import { badgeTextColor, getLenderInfo, getLenderLogo } from '@utils/lender-logos';

import { Typography } from './Typography';

interface LenderLogoProps {
  /** Lender name (curated or custom). Null → a neutral placeholder tile. */
  name: string | null | undefined;
  /** Tile diameter in px. */
  size?: number;
}

/** Slightly darker shade of a hex color for the tile's gradient bottom stop. */
function shade(hex: string, factor = 0.82): string {
  const c = hex.replace('#', '');
  if (c.length < 6) return hex;
  const r = Math.round(parseInt(c.slice(0, 2), 16) * factor);
  const g = Math.round(parseInt(c.slice(2, 4), 16) * factor);
  const b = Math.round(parseInt(c.slice(4, 6), 16) * factor);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Normalized brand chip for a mortgage lender. Two-tier:
 *  • if a size-normalized wordmark PNG is bundled for the lender (see
 *    `@utils/lender-logos`), it renders contained on a clean white tile so
 *    transparent, dark-ink marks read in either theme;
 *  • otherwise a premium monogram chip — a subtle brand-color gradient with a
 *    hairline edge, a soft lift, and the lender's tightened monogram.
 * Custom lenders always get the monogram. Rounded-square (logos letterbox better
 * than a circle). Purely presentational.
 */
export function LenderLogo({ name, size = 28 }: LenderLogoProps) {
  const radius = Math.round(size * 0.28);
  const lift = {
    ...styles.lift,
    shadowRadius: Shadow.light.radius,
    shadowOffset: { width: 0, height: Shadow.light.offsetY },
    shadowOpacity: Shadow.light.opacityLight,
  };
  const logo = getLenderLogo(name);

  if (logo) {
    const inset = Math.round(size * 0.16);
    return (
      <View style={[styles.tile, styles.logoTile, lift, { width: size, height: size, borderRadius: radius }]}>
        <Image
          source={logo}
          style={{ width: size - inset * 2, height: size - inset * 2 }}
          resizeMode="contain"
        />
      </View>
    );
  }

  const info = getLenderInfo(name);
  const color = info?.color ?? '#B7C0CC';
  const label = info?.short ?? '?';
  const textColor = badgeTextColor(color);
  const multi = label.length >= 3;
  // Monogram scales with the tile; clamp so 3–4 char marks (RBC/BMO/B2B) still fit.
  const fontSize = Math.round(size * (multi ? 0.3 : 0.42));

  return (
    <LinearGradient
      colors={[color, shade(color)]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={[styles.tile, styles.monogram, lift, { width: size, height: size, borderRadius: radius }]}
    >
      <Typography
        weight="bold"
        color={textColor}
        style={[styles.label, { fontSize, letterSpacing: multi ? -0.5 : 0 }]}
        allowFontScaling={false}
      >
        {label}
      </Typography>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  lift: {
    shadowColor: '#000000',
    elevation: Elevation.floating,
  },
  // Light backing so real (often dark-ink, transparent) wordmarks stay legible in dark mode.
  logoTile: {
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 0, 0, 0.08)',
  },
  // Hairline top edge gives the colored chip a crisp, premium rim.
  monogram: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  label: { includeFontPadding: false, textAlign: 'center' },
});
