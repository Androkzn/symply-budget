import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, {
  Defs,
  LinearGradient as SvgGradient,
  Path,
  RadialGradient as SvgRadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { brandId } from '@brand';
import { gradients } from '@brand/tokens.generated';
import { useTheme } from '@contexts/ThemeContext';

/**
 * Brand "atmosphere" backdrop (Simple Kaizen Gradient & Glass guide §3 / §5).
 * A low-saturation base gradient + two faint corner radial glows + a glowing
 * wave ribbon anchored to the bottom (bloom + parallel light trails + bright
 * core threads). Light base colours come from the active brand's
 * `gradients.lightBackground` token; ribbon/highlight hues stay per-brand so
 * all five apps get the same premium treatment in their own colour family.
 *
 * Non-interactive; render as the first child of a screen's background View
 * (like the shared `AuthWave`). Optional `children` render above the
 * atmosphere for use as a full wrapper.
 */

// Bespoke decorative hex — intentionally outside the semantic theme tokens.
/* eslint-disable no-restricted-syntax */

// Dark atmosphere stays a shared deep navy; light base is the brand token.
const DARK_BASE = ['#020713', '#071426', '#091A31'] as const;
const LIGHT_BASE = gradients.lightBackground.colors;
const DARK_LOC = [0, 0.55, 1] as const;
const LIGHT_LOC = gradients.lightBackground.locations;
const DARK_OPACITY = { bandOpacity: 0.2, lineOpacity: 0.62, highlightOpacity: 0.95, fillOpacity: 0.18, mintGlow: 0.12, violetGlow: 0.1 };
const LIGHT_OPACITY = { bandOpacity: 0.16, lineOpacity: 0.5, highlightOpacity: 0.6, fillOpacity: 0.12, mintGlow: 0, violetGlow: 0.05 };

type ThemePalette = { ribbon: readonly string[]; highlight: readonly string[] };
type BrandPalette = { dark: ThemePalette; light: ThemePalette };

// Per-brand ribbon (6 stops) + highlight (3 stops) — an analogous gradient
// centred on each brand's primary hue. Dark = bright on navy; light = pastel on
// white.
const BRAND_WAVES: Record<string, BrandPalette> = {
  // Kaizen — the signature mint → teal → blue → violet wave.
  'symply-kaizen': {
    dark: { ribbon: ['#7CFFB2', '#33E6D6', '#00D4FF', '#4A8DFF', '#8A6CFF', '#B06CFF'], highlight: ['#B6FFD9', '#7CFFE8', '#CDA8FF'] },
    light: { ribbon: ['#7FE3C4', '#5FD9DA', '#7FC4F2', '#A6BEF0', '#C2AEEC', '#CA9EE6'], highlight: ['#45D2AC', '#33C4CC', '#A585DE'] },
  },
  // House (teal #4ECDC4) — mint → teal → cyan → sky.
  'symply-house': {
    dark: { ribbon: ['#7CFFD4', '#4EEAD4', '#2EE0E6', '#2CC8F2', '#35ACF2', '#4E9CF5'], highlight: ['#B6FFEA', '#7CFDF2', '#A6D6FF'] },
    light: { ribbon: ['#86E8D2', '#66DFD8', '#72D6EC', '#86CCEE', '#98C6EC', '#A6C4E8'], highlight: ['#38D0BE', '#2FC2D2', '#4FA6DE'] },
  },
  // Budget (green #2BB673) — lime → green → teal.
  'symply-budget': {
    dark: { ribbon: ['#C6FF7C', '#86F088', '#4EE89C', '#2EDEB2', '#2CCCC6', '#34B6D2'], highlight: ['#DEFFB0', '#9CFFC2', '#7CF0E4'] },
    light: { ribbon: ['#C8EFA2', '#A2E3AA', '#7EDCBA', '#6ED6C8', '#74CFD4', '#82C8D8'], highlight: ['#52D07C', '#2FC49A', '#2FB6B2'] },
  },
  // Language (orange #E07A3D) — gold → orange → coral → pink.
  'symply-language': {
    dark: { ribbon: ['#FFE47C', '#FFC44E', '#FFA24E', '#FF875A', '#FF7A6E', '#FF7CA0'], highlight: ['#FFF0BA', '#FFD6A0', '#FFB0AE'] },
    light: { ribbon: ['#F5DCA2', '#F0C288', '#EEA882', '#EC9884', '#EA9896', '#E69CB2'], highlight: ['#E8A64E', '#E88A5E', '#E48A84'] },
  },
  // Health (red #E5484D) — coral → red → rose → pink → violet.
  'symply-health': {
    dark: { ribbon: ['#FFB07C', '#FF876C', '#FF6470', '#FF5A82', '#F45AA0', '#E36CCA'], highlight: ['#FFD2BA', '#FFA6AA', '#FFAEDA'] },
    light: { ribbon: ['#F5B6A6', '#F09894', '#EE8896', '#EC86A2', '#E890B6', '#E2A0CE'], highlight: ['#E8685A', '#E85A7E', '#E27CB2'] },
  },
};
/* eslint-enable no-restricted-syntax */

const VIEW_W = 400;
const VIEW_H = 300;

// A bold flowing wave — crest left, trough right, recovering.
const ribbon = (o: number) =>
  `M-20,${170 + o} C 75,${120 + o} 145,${130 + o} 218,${172 + o} ` +
  `C 292,${214 + o} 352,${246 + o} 420,${222 + o}`;
const closed = (o: number) => `${ribbon(o)} L420,320 L-20,320 Z`;
const TRAIL_OFFSETS = [0, 6, 12, 19, 27, 36, 46];

function stops(cols: readonly string[]) {
  const inner = cols.length;
  return [
    { off: 0, c: cols[0], op: 0 },
    ...cols.map((c, i) => ({ off: 0.12 + (0.76 * i) / (inner - 1), c, op: 1 })),
    { off: 1, c: cols[cols.length - 1], op: 0 },
  ];
}

type WavePalette = {
  ribbon: readonly string[];
  highlight: readonly string[];
  bandOpacity: number;
  lineOpacity: number;
  highlightOpacity: number;
  fillOpacity: number;
};

/** Glowing wave ribbon — bloom + parallel light trails + bright core threads. */
function RibbonWave({ p, idp }: { p: WavePalette; idp: string }) {
  return (
    <>
      <Defs>
        <SvgGradient id={`${idp}Ribbon`} x1="0" y1="0" x2="1" y2="0">
          {stops(p.ribbon).map((s, i) => (
            <Stop key={i} offset={s.off} stopColor={s.c} stopOpacity={s.op} />
          ))}
        </SvgGradient>
        <SvgGradient id={`${idp}Highlight`} x1="0" y1="0" x2="1" y2="0">
          {stops(p.highlight).map((s, i) => (
            <Stop key={i} offset={s.off} stopColor={s.c} stopOpacity={s.op} />
          ))}
        </SvgGradient>
        <SvgGradient id={`${idp}Fill`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={p.ribbon[2]} stopOpacity={p.fillOpacity} />
          <Stop offset="0.7" stopColor={p.ribbon[3]} stopOpacity={p.fillOpacity * 0.3} />
          <Stop offset="1" stopColor={p.ribbon[4]} stopOpacity="0" />
        </SvgGradient>
      </Defs>

      <Path d={closed(24)} fill={`url(#${idp}Fill)`} />

      <Path d={ribbon(20)} stroke={`url(#${idp}Ribbon)`} strokeWidth={62} strokeOpacity={p.bandOpacity * 0.35} fill="none" strokeLinecap="round" />
      <Path d={ribbon(20)} stroke={`url(#${idp}Ribbon)`} strokeWidth={42} strokeOpacity={p.bandOpacity * 0.7} fill="none" strokeLinecap="round" />
      <Path d={ribbon(20)} stroke={`url(#${idp}Ribbon)`} strokeWidth={26} strokeOpacity={p.bandOpacity} fill="none" strokeLinecap="round" />

      {TRAIL_OFFSETS.map((o, i) => (
        <Path
          key={o}
          d={ribbon(o)}
          stroke={`url(#${idp}Ribbon)`}
          strokeWidth={1.7}
          strokeOpacity={p.lineOpacity * (1 - i * 0.11)}
          fill="none"
          strokeLinecap="round"
        />
      ))}

      <Path d={ribbon(3)} stroke={`url(#${idp}Highlight)`} strokeWidth={2.6} strokeOpacity={p.highlightOpacity * 0.5} fill="none" strokeLinecap="round" />
      <Path d={ribbon(2)} stroke={`url(#${idp}Highlight)`} strokeWidth={1.4} strokeOpacity={p.highlightOpacity} fill="none" strokeLinecap="round" />
    </>
  );
}

interface BrandBackgroundProps {
  children?: React.ReactNode;
}

export function BrandBackground({ children }: BrandBackgroundProps) {
  const { isDark } = useTheme();
  const { width, height } = useWindowDimensions();

  const brandPalette = BRAND_WAVES[brandId] ?? BRAND_WAVES['symply-kaizen'];
  const mode = isDark ? brandPalette.dark : brandPalette.light;
  const o = isDark ? DARK_OPACITY : LIGHT_OPACITY;
  const base = isDark ? DARK_BASE : LIGHT_BASE;
  const baseLoc = isDark ? DARK_LOC : LIGHT_LOC;
  const p: WavePalette = { ...mode, ...o };
  // Keep the wave in the lower third so its crest clears the footer text.
  const waveHeight = Math.min(width * 0.64, height * 0.4);

  // Corner glows reuse the brand's own ribbon hues (a mid + a deep stop).
  const glowA = mode.ribbon[1];
  const glowB = mode.ribbon[4];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={children ? 'box-none' : 'none'}>
      {/* 1. Base linear background */}
      <LinearGradient
        colors={[...base]}
        locations={[...baseLoc]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* 2. Faint corner radial glows */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <SvgRadialGradient id="brandGlowA" cx="0%" cy="18%" rx="80%" ry="60%" fx="0%" fy="18%">
            <Stop offset="0%" stopColor={glowA} stopOpacity={o.mintGlow} />
            <Stop offset="100%" stopColor={glowA} stopOpacity="0" />
          </SvgRadialGradient>
          <SvgRadialGradient id="brandGlowB" cx="100%" cy="88%" rx="90%" ry="70%" fx="100%" fy="88%">
            <Stop offset="0%" stopColor={glowB} stopOpacity={o.violetGlow} />
            <Stop offset="100%" stopColor={glowB} stopOpacity="0" />
          </SvgRadialGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={height} fill="url(#brandGlowA)" />
        <Rect x="0" y="0" width={width} height={height} fill="url(#brandGlowB)" />
      </Svg>

      {/* 3. Glowing wave ribbon anchored to the bottom */}
      <Svg
        width={width}
        height={waveHeight}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        style={styles.waves}
        pointerEvents="none"
      >
        <RibbonWave p={p} idp={isDark ? 'brandD' : 'brandL'} />
      </Svg>

      {/* 4. Optional content above the atmosphere */}
      {children ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  waves: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  content: {
    flex: 1,
  },
});
