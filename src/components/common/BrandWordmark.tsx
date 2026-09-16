import React from 'react';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText, TSpan } from 'react-native-svg';

/**
 * Two-tone app wordmark, rendered as one `react-native-svg` text run (no
 * MaskedView, works over-the-air). The first word is painted a solid neutral
 * (black on light, white on dark) and the remaining words sweep the brand
 * gradient — e.g. **Symply** `Kaizen`. Splitting a single text run into two
 * `TSpan`s keeps the exact kerning of the full name; `textAnchor="middle"`
 * centres the whole lockup in the (over-provisioned) canvas.
 */
export interface BrandWordmarkProps {
  /** Full display name, e.g. "Symply Kaizen". */
  name: string;
  /** Solid colour for the first word (use a theme text token). */
  firstColor: string;
  /** Gradient stops (left → right) for the remaining words. */
  gradient: string[];
  fontSize: number;
  /** Canvas width — should comfortably exceed the rendered text width. */
  width: number;
  fontWeight?: string;
  /** Unique gradient id (avoids collisions when multiple instances mount). */
  gradientId?: string;
  /**
   * Horizontal placement within the canvas. `center` (default) centres the
   * lockup — right for a stacked hero. `left` hugs the left edge — right beside
   * a ring in a horizontal nav lockup, where the canvas is over-provisioned so
   * glyphs never clip.
   */
  align?: 'left' | 'center';
}

/**
 * Estimated rendered width (≈0.56em/char for the bold system font) of a
 * wordmark run — shared with `HeaderLogo` so a caller that needs the *visible*
 * text width (e.g. to compensate for the canvas's own over-provisioned
 * trailing space when centring the icon+wordmark as one unit) uses the exact
 * same estimate this component centres its own text with.
 */
export function estimateWordmarkWidth(fontSize: number, name: string): number {
  return Math.round(fontSize * name.trim().length * 0.56);
}

export function BrandWordmark({
  name,
  firstColor,
  gradient,
  fontSize,
  width,
  fontWeight = '700',
  gradientId = 'brandWordmark',
  align = 'center',
}: BrandWordmarkProps) {
  const height = Math.round(fontSize * 1.4);
  const lastIndex = Math.max(gradient.length - 1, 1);
  const isLeft = align === 'left';

  const trimmed = name.trim();
  const spaceIndex = trimmed.indexOf(' ');
  const first = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  // Keep the leading space with the remainder so kerning matches the full name.
  const rest = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex);

  // We always anchor at `start` and compute x ourselves. `textAnchor="middle"`
  // is unreliable across two `TSpan`s in react-native-svg — it centres only the
  // first span and lets the second overflow right — so for centred lockups we
  // estimate the run width and offset x to centre the whole name in the
  // (over-provisioned) canvas.
  const estTextWidth = estimateWordmarkWidth(fontSize, trimmed);
  const x = isLeft ? 0 : Math.max(0, (width - estTextWidth) / 2);

  return (
    <Svg width={width} height={height} pointerEvents="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          {gradient.map((c, i) => (
            <Stop key={i} offset={i / lastIndex} stopColor={c} />
          ))}
        </LinearGradient>
      </Defs>
      <SvgText
        x={x}
        y={fontSize}
        fontSize={fontSize}
        fontWeight={fontWeight}
        textAnchor="start"
      >
        <TSpan fill={firstColor}>{first}</TSpan>
        {rest ? <TSpan fill={`url(#${gradientId})`}>{rest}</TSpan> : null}
      </SvgText>
    </Svg>
  );
}
