import React from 'react';
import { StyleSheet, Text, TextProps, TextStyle } from 'react-native';

import {
  useAppColors,
  TypographyTokens,
  UIFoundation,
  type FontToken,
  type TypographyVariant as V2Variant,
} from '@theme';

/**
 * Centralized, token-driven text component.
 *
 * SINGLE SOURCE OF TRUTH: every size / weight / line-height / letter-spacing
 * comes from the semantic ramp in `designTokens.ts` (`TypographyTokens`), and
 * the default color comes from `appColors.ts` (`useAppColors().textPrimary`).
 * Editing a token in those two files re-styles the entire app — no screen
 * should hardcode `fontSize` / `fontWeight` / hex colors.
 *
 * Variants:
 *   - Prefer the V2 semantic names: `display | heading | title | titleSmall |
 *     bodyLarge | buttonLabel | body | bodyMedium | label | labelRegular |
 *     bodySmall | bodySmallMedium | bodySmallSemibold | caption | captionSmall |
 *     captionBold | overline | micro`.
 *   - Legacy Apple-HIG names (`largeTitle | title1 | title2 | title3 | headline |
 *     callout | subheadline | footnote | caption1 | caption2`) are kept as
 *     deprecated aliases that resolve onto the same V2 ramp, so existing screens
 *     stay on one consistent scale while they migrate to the V2 names.
 */

// Deprecated legacy variant names → nearest V2 token. Keeping these mapped to
// the V2 ramp (rather than their old metrics) is what unifies the whole app on
// a single scale without touching every screen at once.
const LEGACY_TO_V2 = {
  largeTitle: 'display',
  title1: 'heading',
  title2: 'title',
  title3: 'titleSmall',
  headline: 'buttonLabel',
  callout: 'body',
  subheadline: 'labelRegular',
  footnote: 'caption',
  caption1: 'captionSmall',
  caption2: 'captionSmall',
} as const satisfies Record<string, V2Variant>;

type LegacyVariant = keyof typeof LEGACY_TO_V2;
export type TypographyVariant = V2Variant | LegacyVariant;

function resolveToken(variant: TypographyVariant): FontToken {
  const v2 = (LEGACY_TO_V2 as Record<string, V2Variant>)[variant] ?? variant;
  return TypographyTokens[v2 as V2Variant] ?? TypographyTokens.body;
}

type WeightAlias = 'regular' | 'medium' | 'semibold' | 'bold';

const weightStyles: Record<WeightAlias, TextStyle> = {
  regular: { fontWeight: '400' },
  medium: { fontWeight: '500' },
  semibold: { fontWeight: '600' },
  bold: { fontWeight: '700' },
};

interface TypographyProps extends TextProps {
  variant?: TypographyVariant;
  /** Override foreground color. Defaults to `useAppColors().textPrimary`. */
  color?: string;
  /** Override the token's weight. */
  weight?: WeightAlias;
  align?: 'left' | 'center' | 'right';
  children: React.ReactNode;
}

export function Typography({
  variant = 'body',
  color,
  weight,
  align,
  style,
  children,
  ...props
}: TypographyProps) {
  const colors = useAppColors();
  const token = resolveToken(variant);

  // If a caller overrides `fontSize` (e.g. enlarging an emoji icon to 64pt)
  // without also passing `lineHeight`, the token's smaller line height would
  // clip the glyph. Auto-scale to ~1.2× the override so emojis and tall
  // ascenders render fully.
  const flatStyle = StyleSheet.flatten(style) as TextStyle | undefined;
  const overriddenFontSize =
    typeof flatStyle?.fontSize === 'number' ? flatStyle.fontSize : undefined;
  const overriddenLineHeight =
    typeof flatStyle?.lineHeight === 'number' ? flatStyle.lineHeight : undefined;
  const autoLineHeight =
    overriddenFontSize !== undefined &&
    overriddenLineHeight === undefined &&
    overriddenFontSize > token.size
      ? Math.round(overriddenFontSize * 1.2)
      : undefined;

  return (
    <Text
      maxFontSizeMultiplier={1.3}
      style={[
        styles.base,
        {
          fontSize: token.size,
          lineHeight: token.lineHeight,
          fontWeight: token.weight,
          color: color || colors.textPrimary,
        },
        token.letterSpacing !== undefined
          ? { letterSpacing: token.letterSpacing }
          : undefined,
        token.uppercase ? { textTransform: 'uppercase' } : undefined,
        weight ? weightStyles[weight] : undefined,
        align ? { textAlign: align } : undefined,
        style,
        autoLineHeight !== undefined ? { lineHeight: autoLineHeight } : undefined,
      ]}
      {...props}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    letterSpacing: UIFoundation.textLetterSpacing,
  },
});
