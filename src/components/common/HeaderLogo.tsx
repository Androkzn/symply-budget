import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { brand, brandId } from '@brand';
import { getLogoSplashForScheme } from '@brand/assets';
import { getBrandWordmarkGradient } from '@brand/loginTheme';
import { useTheme } from '@contexts/ThemeContext';
import { useAppStore } from '@stores/appStore';
import { useAppColors } from '@theme';

import { BrandWordmark, estimateWordmarkWidth } from './BrandWordmark';

interface HeaderLogoProps {
  height?: number;
  /**
   * `horizontal` (default) — ring and wordmark side by side, for compact
   * nav-bar lockups. `vertical` — ring stacked above a centred wordmark, for
   * hero placements (e.g. the onboarding welcome). Vertical keeps a wide
   * wordmark ("Symply Language") centred and never lets it overrun a narrow
   * screen, which the side-by-side lockup cannot guarantee at hero size.
   */
  orientation?: 'horizontal' | 'vertical';
  /**
   * Compensates for the wordmark's own over-provisioned (clip-proof) canvas,
   * which — in `horizontal` orientation only — leaves its slack entirely on
   * the trailing edge (the wordmark left-aligns inside it). Left uncorrected,
   * that invisible slack sits inside this component's own layout box, so a
   * parent that centres the whole box (e.g. flex `space-between` around two
   * symmetric buttons) ends up centring the box rather than the visible
   * icon+text, which reads as noticeably off-centre. Pass `centered` when
   * this lockup IS that centred element; leave it off for the common
   * flush-left nav-bar placement, where the trailing slack is harmless.
   */
  centered?: boolean;
}

/**
 * Brand lockup: the brush-ring splash mark + the app name as a two-tone
 * wordmark — the first word in the theme's neutral text colour (black on light,
 * white on dark) and the remaining words sweeping the per-brand gradient, e.g.
 * **Symply** `Kaizen`. One component, two orientations, every brand + theme, so
 * the identity reads the same everywhere the logo appears. Replaces the old
 * baked solid-colour horizontal PNG.
 */
export function HeaderLogo({
  height = 36,
  orientation = 'horizontal',
  centered = false,
}: HeaderLogoProps) {
  const { isDark } = useTheme();
  const colors = useAppColors();
  const accentScheme = useAppStore((s) => s.accentScheme);
  const name = brand.displayName;
  const logoSplash = getLogoSplashForScheme(brandId, accentScheme);

  // Second-word gradient: the brand's deep wordmark tone swept into its vibrant
  // accent, theme-aware via `getBrandWordmarkGradient` so it reads on both the
  // light and dark surfaces. The first word uses the neutral text token.
  const gradientColors = getBrandWordmarkGradient(brandId, isDark, accentScheme);

  // fontSize ≈ 0.44× the ring height makes the wordmark a clear, legible pair
  // with the mark (bigger than the old 0.32×); capped at 32 so the large hero
  // lockup (height 100) doesn't overrun narrow screens. The canvas is
  // over-provisioned from the name length so the longest display name
  // ("Symply Language") never clips.
  const fontSize = Math.min(Math.round(height * 0.44), 32);
  // Over-provision the canvas from the name length so the centred wordmark has
  // margin on both sides and the longest display name never clips.
  const width = Math.round(fontSize * (name.length * 0.66 + 1.5));

  // Horizontal: the wordmark hugs the ring (align="left"), so the row width is
  // ring + gap + text and centres tightly in a nav bar. Vertical (hero): the
  // wordmark sits on its own centred row, so it must be centred *inside* its
  // over-provisioned canvas (align="center") — otherwise the canvas's trailing
  // slack would shove the visible text off-centre and the ring off the edge.
  const isVertical = orientation === 'vertical';

  // The canvas over-provisions `width` beyond the wordmark's actual rendered
  // width so long names never clip; in horizontal mode that slack sits after
  // the text (align="left"), inside this component's own layout box. Mirror
  // the same amount onto the leading edge so the box is symmetric around the
  // VISIBLE icon+text, which is what a centring parent actually needs centred.
  const centeringOffset =
    centered && !isVertical ? Math.max(0, width - estimateWordmarkWidth(fontSize, name)) : 0;

  return (
    <View
      style={[
        isVertical ? styles.column : styles.row,
        { gap: Math.round(height * (isVertical ? 0.1 : 0.14)) },
        centeringOffset > 0 && { marginLeft: centeringOffset },
      ]}
    >
      <Image source={logoSplash} style={{ width: height, height }} resizeMode="contain" />
      <BrandWordmark
        name={name}
        firstColor={colors.textPrimary}
        gradient={gradientColors}
        fontSize={fontSize}
        width={width}
        gradientId="headerLogoWordmark"
        align={isVertical ? 'center' : 'left'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  column: {
    alignItems: 'center',
    flexDirection: 'column',
    justifyContent: 'center',
  },
});
