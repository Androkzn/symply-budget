import React from 'react';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

/**
 * Horizontal gradient-filled text, rendered via `react-native-svg` (already in
 * the native binary — no MaskedView dependency, so it works over-the-air). Uses
 * the system font, matching the app's default Typography. Sizes to `width` ×
 * (fontSize × 1.4) and centres the text; give it a generous width so glyphs are
 * never clipped.
 */
export interface GradientTextProps {
  text: string;
  /** Gradient stops, left → right. */
  colors: string[];
  fontSize: number;
  /** Canvas width — should comfortably exceed the rendered text width. */
  width: number;
  fontWeight?: string;
  /** Unique gradient id (avoids collisions when multiple instances mount). */
  gradientId?: string;
  /**
   * Horizontal placement of the text within the canvas. `center` (default)
   * centres it — right when the canvas is sized to the text. Use `left` when
   * the canvas is deliberately over-provisioned (so glyphs never clip) and the
   * text must hug the left edge, e.g. beside a logo, with no leading gap.
   */
  align?: 'left' | 'center';
}

export function GradientText({
  text,
  colors,
  fontSize,
  width,
  fontWeight = '700',
  gradientId = 'gradientText',
  align = 'center',
}: GradientTextProps) {
  const height = Math.round(fontSize * 1.4);
  const lastIndex = Math.max(colors.length - 1, 1);
  const isLeft = align === 'left';

  return (
    <Svg width={width} height={height} pointerEvents="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          {colors.map((c, i) => (
            <Stop key={i} offset={i / lastIndex} stopColor={c} />
          ))}
        </LinearGradient>
      </Defs>
      <SvgText
        x={isLeft ? 0 : width / 2}
        y={fontSize}
        fontSize={fontSize}
        fontWeight={fontWeight}
        textAnchor={isLeft ? 'start' : 'middle'}
        fill={`url(#${gradientId})`}
      >
        {text}
      </SvgText>
    </Svg>
  );
}
