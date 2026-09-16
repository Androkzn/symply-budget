import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

import { useTheme } from '@contexts/ThemeContext';

/**
 * Kaizen-only premium auth backdrop. Two distinct, theme-matched treatments:
 *   • Dark  — deep-navy gradient with a bright, glowing wave ribbon that sweeps
 *             from a teal crest on the left down to a violet tail on the right
 *             (stacked light trails + bloom, no SVG blur filters needed).
 *   • Light — near-white → soft-lavender gradient with airy, translucent
 *             watercolor wave bands (pale teal → blue → lavender → lilac). Soft
 *             and delicate, never loud — matches the light brand splash.
 *
 * Purely cosmetic and non-interactive; render it as the first child of the auth
 * screen's background View so the form draws on top. Kaizen brand-gated by
 * `AuthWave`; other brands keep the shared PNG wave.
 */

// Bespoke decorative palette — intentionally outside the semantic theme tokens
// (useAppColors), so hex literals are the source of truth here.
/* eslint-disable no-restricted-syntax */
const DARK = {
  bg: ['#071225', '#06152B', '#081A33'] as const,
  // mint, teal, cyan, blue, violet, purple
  ribbon: ['#7CFFB2', '#33E6D6', '#00D4FF', '#4A8DFF', '#8A6CFF', '#B06CFF'] as const,
  highlight: ['#B6FFD9', '#7CFFE8', '#CDA8FF'] as const,
  bandOpacity: 0.2,
  lineOpacity: 0.62,
  highlightOpacity: 0.95,
  fillOpacity: 0.18,
};
const LIGHT = {
  bg: ['#FCFCFF', '#F5F6FD', '#EBE9F7'] as const,
  // Soft watercolor bands, back → front: pale teal, blue, lavender, lilac.
  bands: [
    { c: '#C6ECE1', o: 2, op: 0.26 },
    { c: '#CEDBF6', o: 15, op: 0.28 },
    { c: '#D8D2F1', o: 29, op: 0.34 },
    { c: '#E4D6F2', o: 45, op: 0.4 },
  ] as const,
  edge: '#EAF6F1',
  edgeOpacity: 0.5,
};
/* eslint-enable no-restricted-syntax */

// Waves authored in a 400 × 300 viewBox (bottom = 300). The Svg is sized
// width × (width * 0.86) so the viewBox scales uniformly. Paths overshoot
// -20..420 in x so edges never show.
const VIEW_W = 400;
const VIEW_H = 300;

// Dark: a bold flowing wave — teal crest left, violet trough right, recovering.
const ribbon = (o: number) =>
  `M-20,${170 + o} C 75,${120 + o} 145,${130 + o} 218,${172 + o} ` +
  `C 292,${214 + o} 352,${246 + o} 420,${222 + o}`;
const closed = (o: number) => `${ribbon(o)} L420,320 L-20,320 Z`;
const TRAIL_OFFSETS = [0, 6, 12, 19, 27, 36, 46];

// Light: a gentler, lower-amplitude wave for the soft bands.
const soft = (o: number) =>
  `M-20,${196 + o} C 85,${162 + o} 175,${186 + o} 258,${198 + o} ` +
  `C 332,${208 + o} 384,${194 + o} 420,${203 + o}`;
const softClosed = (o: number) => `${soft(o)} L420,320 L-20,320 Z`;

function stops(cols: readonly string[]) {
  // Even colour spread with transparent ends so the ribbon fades before the
  // screen sides. Works for the 6-colour ribbon and 3-colour highlight sets.
  const inner = cols.length;
  return [
    { off: 0, c: cols[0], op: 0 },
    ...cols.map((c, i) => ({ off: 0.12 + (0.76 * i) / (inner - 1), c, op: 1 })),
    { off: 1, c: cols[cols.length - 1], op: 0 },
  ];
}

/** Dark: bright glowing ribbon (bloom band + parallel trails + core threads). */
function DarkWave() {
  const p = DARK;
  return (
    <>
      <Defs>
        <SvgGradient id="kzRibbon" x1="0" y1="0" x2="1" y2="0">
          {stops(p.ribbon).map((s, i) => (
            <Stop key={i} offset={s.off} stopColor={s.c} stopOpacity={s.op} />
          ))}
        </SvgGradient>
        <SvgGradient id="kzHighlight" x1="0" y1="0" x2="1" y2="0">
          {stops(p.highlight).map((s, i) => (
            <Stop key={i} offset={s.off} stopColor={s.c} stopOpacity={s.op} />
          ))}
        </SvgGradient>
        <SvgGradient id="kzFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={p.ribbon[2]} stopOpacity={p.fillOpacity} />
          <Stop offset="0.7" stopColor={p.ribbon[3]} stopOpacity={p.fillOpacity * 0.3} />
          <Stop offset="1" stopColor={p.ribbon[4]} stopOpacity="0" />
        </SvgGradient>
      </Defs>

      <Path d={closed(24)} fill="url(#kzFill)" />

      <Path d={ribbon(20)} stroke="url(#kzRibbon)" strokeWidth={62} strokeOpacity={p.bandOpacity * 0.35} fill="none" strokeLinecap="round" />
      <Path d={ribbon(20)} stroke="url(#kzRibbon)" strokeWidth={42} strokeOpacity={p.bandOpacity * 0.7} fill="none" strokeLinecap="round" />
      <Path d={ribbon(20)} stroke="url(#kzRibbon)" strokeWidth={26} strokeOpacity={p.bandOpacity} fill="none" strokeLinecap="round" />

      {TRAIL_OFFSETS.map((o, i) => (
        <Path
          key={o}
          d={ribbon(o)}
          stroke="url(#kzRibbon)"
          strokeWidth={1.7}
          strokeOpacity={p.lineOpacity * (1 - i * 0.11)}
          fill="none"
          strokeLinecap="round"
        />
      ))}

      <Path d={ribbon(3)} stroke="url(#kzHighlight)" strokeWidth={2.6} strokeOpacity={p.highlightOpacity * 0.5} fill="none" strokeLinecap="round" />
      <Path d={ribbon(2)} stroke="url(#kzHighlight)" strokeWidth={1.4} strokeOpacity={p.highlightOpacity} fill="none" strokeLinecap="round" />
    </>
  );
}

/** Light: soft, airy, translucent watercolor bands layered back → front. */
function LightWave() {
  return (
    <>
      <Defs>
        {LIGHT.bands.map((b, i) => (
          <SvgGradient key={i} id={`kzBand${i}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={b.c} stopOpacity={b.op} />
            <Stop offset="1" stopColor={b.c} stopOpacity={b.op * 0.3} />
          </SvgGradient>
        ))}
      </Defs>
      {LIGHT.bands.map((b, i) => (
        <Path key={i} d={softClosed(b.o)} fill={`url(#kzBand${i})`} />
      ))}
      {/* Faint soft top edge for a hint of definition */}
      <Path d={soft(0)} stroke={LIGHT.edge} strokeWidth={1} strokeOpacity={LIGHT.edgeOpacity} fill="none" strokeLinecap="round" />
    </>
  );
}

export function KaizenAuthWave() {
  const { isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const waveHeight = Math.min(width * 0.86, height * 0.52);
  const bg = isDark ? DARK.bg : LIGHT.bg;

  return (
    <View style={styles.fill} pointerEvents="none">
      {/* Base gradient across the whole screen */}
      <LinearGradient colors={[...bg]} locations={[0, 0.58, 1]} style={styles.fill} />

      {/* Wave anchored to the bottom */}
      <Svg
        width={width}
        height={waveHeight}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        style={styles.waves}
        pointerEvents="none"
      >
        {isDark ? <DarkWave /> : <LightWave />}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  waves: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
