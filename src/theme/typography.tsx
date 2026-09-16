/**
 * SimpleHouse Typography helpers
 *
 * Bridges the semantic ramp in `designTokens.ts` to RN `<Text>` style. Use
 * either the helper (`scaledFont('body')`) when extending a custom Text, or
 * the `<TypographyV2>` component for the common case.
 *
 * Companion of:
 *   - `designTokens.ts` (tokens)
 *   - `appColors.ts`    (colors)
 */

import React from 'react';
import { PixelRatio, StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { useAppColors } from './appColors';
import {
  Typography as TypographyTokens,
  type FontToken,
  type TypographyVariant,
} from './designTokens';

// ---------------------------------------------------------------------------
// scaledFont — produces a TextStyle from a typography token
// ---------------------------------------------------------------------------

interface ScaledFontOptions {
  /** Cap on Dynamic Type scaling. Defaults to 1.3 for body, 1.5 for titles. */
  maxScale?: number;
  /** Override the token's letter spacing. */
  letterSpacing?: number;
  /** Override the token's line height. */
  lineHeight?: number;
}

/**
 * Convert a semantic typography token into a `TextStyle`. Honors the system
 * font scale (Dynamic Type on iOS, Font Scale on Android) but clamps it so
 * fixed-width containers don't break.
 *
 * @example
 *   <Text style={scaledFont('body')}>Hello</Text>
 *   <Text style={[scaledFont('title', { maxScale: 1.4 }), { color: '#000' }]} />
 */
export function scaledFont(
  variant: TypographyVariant,
  opts: ScaledFontOptions = {}
): TextStyle {
  const token: FontToken = TypographyTokens[variant];
  const fontScale = PixelRatio.getFontScale();
  const cap = opts.maxScale ?? defaultMaxScaleFor(variant);
  const clampedScale = Math.min(fontScale, cap);

  const style: TextStyle = {
    fontSize: token.size * clampedScale,
    fontWeight: token.weight,
    lineHeight: (opts.lineHeight ?? token.lineHeight) * clampedScale,
  };
  const ls = opts.letterSpacing ?? token.letterSpacing;
  if (ls !== undefined) style.letterSpacing = ls;
  if (token.uppercase) style.textTransform = 'uppercase';
  return style;
}

/**
 * Sensible per-variant Dynamic Type cap. Headers can grow more without
 * breaking layout; small text needs to stay close to its design size.
 */
function defaultMaxScaleFor(variant: TypographyVariant): number {
  switch (variant) {
    case 'display':
    case 'heading':
      return 1.5;
    case 'title':
      return 1.4;
    case 'titleSmall':
    case 'bodyLarge':
      return 1.4;
    case 'body':
    case 'bodyMedium':
    case 'buttonLabel':
    case 'label':
    case 'labelRegular':
    case 'bodySmall':
    case 'bodySmallMedium':
    case 'bodySmallSemibold':
      return 1.3;
    case 'caption':
      return 1.25;
    case 'captionSmall':
    case 'captionBold':
    case 'overline':
    case 'micro':
      return 1.2;
    default:
      return 1.2;
  }
}

// ---------------------------------------------------------------------------
// <TypographyV2> — drop-in token-driven Text
//
// Named V2 to avoid colliding with the existing Typography component (which
// uses an Apple HIG variant naming: `body`/`headline`/`caption1`). Both can
// coexist while screens migrate.
// ---------------------------------------------------------------------------

export interface TypographyV2Props extends TextProps {
  /** Semantic role from the design system ramp. Defaults to `body`. */
  variant?: TypographyVariant;
  /** Override foreground color. Defaults to `useAppColors().textPrimary`. */
  color?: string;
  /** Cap on Dynamic Type scaling. */
  maxScale?: number;
  /** Convenience for centering text. */
  align?: TextStyle['textAlign'];
  children: React.ReactNode;
}

export function TypographyV2({
  variant = 'body',
  color,
  maxScale,
  align,
  style,
  children,
  ...rest
}: TypographyV2Props) {
  const colors = useAppColors();
  return (
    <Text
      style={[
        styles.base,
        scaledFont(variant, { maxScale }),
        { color: color ?? colors.textPrimary },
        align ? { textAlign: align } : undefined,
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    // Empty — everything comes from scaledFont() so callers can override
    // cleanly via the style prop.
  },
});
