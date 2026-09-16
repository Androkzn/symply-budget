/**
 * Shared icon primitive: brand PNG artwork supplies the shape; the live theme
 * supplies its color. Explicit colors take precedence over active/filled defaults
 * for both kit images and the Ionicons fallback. Never infer state from RGB
 * proximity or render a baked brand gradient for a user-selected palette.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Image,
  StyleProp,
  ImageStyle,
  Text,
  TextStyle,
  ViewStyle,
} from 'react-native';

import { brandIconAssets } from '@brand/icons.generated';
import { useAppColors } from '@theme/appColors';
import { useIsDarkMode } from '@theme/useIsDarkMode';

import { aliasToBrandIcon } from './ioniconAliases';

export type IconState = 'auto' | 'active' | 'inactive' | 'filled';

/**
 * True for an icon value that is a literal emoji rather than a glyph NAME.
 *
 * Ionicons slugs and brand-kit slugs are ASCII (`cloud-download-outline`,
 * `maintenance-fund`), so "contains a non-ASCII character" identifies emoji
 * without a codepoint table and without risking a real slug.
 */
export function isEmojiIcon(name: string): boolean {
  // eslint-disable-next-line no-control-regex -- ASCII range check, by design.
  return name.length > 0 && /[^\x00-\x7F]/.test(name);
}

export interface IconProps {
  /** Brand kit icon name, or an Ionicons glyph name (aliased/fell back). */
  name: string;
  /** Selected/active — defaults to the current palette primary. */
  active?: boolean;
  /** White foreground for a filled-accent control; the caller owns its background. */
  filled?: boolean;
  size?: number;
  /** Force light/dark PNG; defaults to the resolved app theme. */
  theme?: 'light' | 'dark';
  /**
   * Requested foreground color, honored by both PNG artwork and fallback glyphs.
   */
  color?: string;
  /** Accepts View/Text/Image styles so it drops into any legacy Ionicons site. */
  style?: StyleProp<ViewStyle | ImageStyle | TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
  /** Escape hatch: never use the brand PNG, always render the Ionicons glyph. */
  forceIonicons?: boolean;
  /**
   * Ionicons glyph to draw when neither the brand PNG nor `name` is a real
   * Ionicons slug. Prevents the "?" missing-glyph box for kit-only names
   * (e.g. `health`, `career-system`) when a build bakes a kit that lacks them.
   */
  fallbackIonicon?: string;
}

/**
 * Kit slug for `name`, or undefined when the ACTIVE brand has no PNG for it.
 *
 * `IONICON_TO_BRAND` is a global map shared by all five brands, so an alias
 * routinely resolves to a slug this brand's kit does not ship (House has no
 * `calendar`, `registered-account` or `ai-coach`). Resolving the alias is
 * therefore only half the answer — membership in `brandIconAssets` is the other
 * half, and every caller needs both.
 */
function resolveBrandIcon(name: string): string | undefined {
  if (name in brandIconAssets) return name;
  const alias = aliasToBrandIcon(name);
  return alias && alias in brandIconAssets ? alias : undefined;
}

export function Icon({
  name,
  active = false,
  filled = false,
  size = 24,
  theme,
  color,
  style,
  accessibilityLabel,
  testID,
  forceIonicons = false,
  fallbackIonicon,
}: IconProps) {
  const isDarkResolved = useIsDarkMode();
  const isDark = theme ? theme === 'dark' : isDarkResolved;
  const appColors = useAppColors();

  const brandName = forceIonicons ? undefined : resolveBrandIcon(name);

  const brandStates = brandName ? brandIconAssets[brandName] : undefined;

  const tint = color ?? (filled ? appColors.white : active ? appColors.primary : appColors.textSecondary);

  if (brandStates) {
    return (
      <Image
        source={isDark ? brandStates.unselectedDark : brandStates.unselectedLight}
        style={[
          { width: size, height: size },
          { tintColor: tint },
          style as StyleProp<ImageStyle>,
        ]}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel ?? name}
        accessible={!!accessibilityLabel}
        testID={testID}
      />
    );
  }

  // An EMOJI is a picture already — Ionicons has no glyph for it and draws the
  // missing-glyph box, which is how a restored ledger full of emoji category
  // icons (❄️ 🚿 ⚡, straight out of the D1 migration) turned into a screen of
  // "?" marks. Draw the character, exactly as FilterTabs already does for the
  // same data. Anything non-ASCII is emoji here: Ionicons names are ASCII
  // slugs, so this can never swallow a real glyph name.
  if (!fallbackIonicon && isEmojiIcon(name)) {
    return (
      <Text
        style={[{ fontSize: size, lineHeight: size * 1.2 }, style as StyleProp<TextStyle>]}
        accessibilityLabel={accessibilityLabel ?? name}
        accessible={!!accessibilityLabel}
        testID={testID}
      >
        {name}
      </Text>
    );
  }

  // Fallback: the original Ionicons glyph, tinted (brand primary when active).
  // Prefer an explicit `fallbackIonicon` so kit-only names never render as "?".
  const glyph = fallbackIonicon ?? name;
  return (
    <Ionicons
      name={glyph as React.ComponentProps<typeof Ionicons>['name']}
      size={size}
      color={tint}
      style={style as StyleProp<TextStyle>}
      accessibilityLabel={accessibilityLabel ?? name}
      testID={testID}
    />
  );
}

/** Whether the active brand kit supplies artwork for this name or alias. */
export function hasBrandIcon(name: string): boolean {
  return resolveBrandIcon(name) !== undefined;
}

export default Icon;
