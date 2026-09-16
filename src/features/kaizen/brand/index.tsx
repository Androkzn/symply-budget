/**
 * Kaizen brand-primitive adapters.
 *
 * Feature-local wrappers that bind the donor Kaizen design primitives
 * (`GlassCard`, `BrandButton`, `GradientText`, `GradientButton`, `BrandBackground`,
 * `BrandKaizenRingIcon`, `useBrandMode`) onto the ECOSYSTEM's own primitives —
 * `@components/ui` Button, `@components/common` GradientText / AppBackground — so
 * ported screens keep their exact import surface without forking the donor pipeline.
 *
 * All theme comes from the feature theme barrels (`@features/kaizen/theme/*`), never
 * `@theme/*` directly, so depth never matters.
 */
import { LinearGradient } from 'expo-linear-gradient';
import React, { type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ColorValue,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';

import { AppBackground } from '@components/common/AppBackground';
import { GradientText as EcosystemGradientText } from '@components/common/GradientText';
import { Button } from '@components/ui/Button';
import { useTheme } from '@contexts/ThemeContext';
import {
  KAIZEN_GRADIENT_ACTION,
  KAIZEN_GRADIENT_BRAND,
  useAppColors,
} from '@features/kaizen/theme/appColors';
import { GlassRadius, Spacing } from '@features/kaizen/theme/designTokens';

/** Re-export every donor `@brand/iconset` glyph so screens can import them from the barrel. */
export * from './iconset';

/** Brand light/dark mode, resolved from the ecosystem ThemeContext. */
export function useBrandMode(): 'dark' | 'light' {
  return useTheme().isDark ? 'dark' : 'light';
}

/* ------------------------------------------------------------------ GlassCard */

export interface GlassCardProps {
  children?: ReactNode;
  /** Use the stronger translucent fill (elevated / hero cards). */
  strong?: boolean;
  /** Inner padding. Defaults to `Spacing.md`. */
  padding?: number;
  /** Corner radius. Defaults to the iOS-26 card radius (`GlassRadius.card`). */
  radius?: number;
  /** Optional solid tint that replaces the glass fill for this card. */
  tint?: string;
  style?: StyleProp<ViewStyle>;
}

/** iOS-26 Liquid-Glass card, painted from the feature `glass*` color tokens. */
export function GlassCard({ children, strong = false, padding, radius, tint, style }: GlassCardProps) {
  const colors = useAppColors();
  return (
    <View
      style={[
        {
          backgroundColor: tint ?? (strong ? colors.glassFillStrong : colors.glassFill),
          borderColor: colors.glassBorder,
          borderWidth: 1,
          borderRadius: radius ?? GlassRadius.card,
          padding: padding ?? Spacing.md,
          ...Platform.select({
            ios: {
              shadowColor: colors.glassShadow as ColorValue,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 1,
              shadowRadius: 16,
            },
            android: { elevation: 3 },
            default: {},
          }),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* ----------------------------------------------------------------- BrandButton */

export interface BrandButtonProps {
  title: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Optional leading icon element. Mapped onto the ecosystem Button `leftIcon`. */
  icon?: ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Stable automation/selector id, forwarded to the underlying Pressable. */
  testID?: string;
  /** Screen-reader label. Defaults to `title` when omitted. */
  accessibilityLabel?: string;
}

/** Adapter over the ecosystem `Button` (donor `icon` → `leftIcon`; default primary). */
export function BrandButton({
  title,
  onPress,
  loading,
  disabled,
  icon,
  variant = 'primary',
  fullWidth = true,
  style,
  testID,
  accessibilityLabel,
}: BrandButtonProps) {
  return (
    <Button
      title={title}
      onPress={onPress}
      loading={loading}
      disabled={disabled}
      leftIcon={icon}
      variant={variant}
      fullWidth={fullWidth}
      style={style as object}
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? title}
    />
  );
}

/* ----------------------------------------------------------------- GradientText */

export interface GradientTextProps {
  children?: ReactNode;
  /** Text to render. Falls back to a string `children`. */
  text?: string;
  /** Gradient stops, left → right. Defaults to the Kaizen brand gradient. */
  colors?: string[];
  style?: StyleProp<TextStyle>;
  /** Overrides `style.fontSize`; defaults to 28. */
  fontSize?: number;
  /** Canvas width; auto-estimated from the text when omitted. */
  width?: number;
  fontWeight?: string;
  align?: 'left' | 'center';
}

/**
 * Adapter over the ecosystem SVG `GradientText`. The ecosystem primitive needs an
 * explicit `text` / `fontSize` / `width`, so this shim derives them from donor-style
 * usage (`<GradientText style={...}>Simple Kaizen</GradientText>`).
 */
export function GradientText({
  children,
  text,
  colors = KAIZEN_GRADIENT_BRAND,
  style,
  fontSize,
  width,
  fontWeight,
  align,
}: GradientTextProps) {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const resolvedText = text ?? (typeof children === 'string' ? children : String(children ?? ''));
  const size =
    fontSize ?? (typeof flat?.fontSize === 'number' ? flat.fontSize : 28);
  const weight =
    fontWeight ?? (flat?.fontWeight != null ? String(flat.fontWeight) : '700');
  const canvasWidth = width ?? Math.ceil(resolvedText.length * size * 0.62 + size);

  return (
    <EcosystemGradientText
      text={resolvedText}
      colors={colors}
      fontSize={size}
      width={canvasWidth}
      fontWeight={weight}
      align={align ?? 'left'}
    />
  );
}

/* --------------------------------------------------------------- GradientButton */

export interface GradientButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Gradient stops. Defaults to the Kaizen "action" gradient. */
  colors?: string[];
}

/** Feature-local action-gradient button (Pressable + expo-linear-gradient). */
export function GradientButton({
  children,
  style,
  colors = KAIZEN_GRADIENT_ACTION,
  ...props
}: GradientButtonProps) {
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [gbStyles.pressable, pressed && gbStyles.pressed, style]}
    >
      <LinearGradient
        colors={colors as [ColorValue, ColorValue, ...ColorValue[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={gbStyles.gradient}
      >
        <View style={gbStyles.content}>{children}</View>
      </LinearGradient>
    </Pressable>
  );
}

const gbStyles = StyleSheet.create({
  pressable: { borderRadius: GlassRadius.button, overflow: 'hidden' },
  pressed: { transform: [{ scale: 0.985 }] },
  gradient: { minHeight: 52, justifyContent: 'center' },
  content: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
});

/* --------------------------------------------------------------- BrandBackground */

export interface BrandBackgroundProps {
  children?: ReactNode;
}

/** Adapter over the ecosystem flat, theme-aware `AppBackground`. */
export function BrandBackground({ children }: BrandBackgroundProps) {
  return <AppBackground>{children}</AppBackground>;
}

/* ----------------------------------------------------------- BrandKaizenRingIcon */

export interface BrandKaizenRingIconProps {
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** Accessible label for the mark. Defaults to "Kaizen". */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Minimal Simple-Kaizen brush-ring mark — a continuous-improvement loop with an
 * intentional open taper on the right, painted with the Kaizen brand gradient.
 */
export function BrandKaizenRingIcon({
  size = 32,
  style,
  accessibilityLabel = 'Kaizen',
  testID,
}: BrandKaizenRingIconProps) {
  const stops = KAIZEN_GRADIENT_BRAND;
  const lastIndex = Math.max(stops.length - 1, 1);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 102.4 102.4"
      style={style}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Defs>
        <SvgLinearGradient id="kaizenRingGradient" x1="5%" y1="5%" x2="95%" y2="95%">
          {stops.map((color, i) => (
            <Stop key={color} offset={`${Math.round((i / lastIndex) * 100)}%`} stopColor={color} />
          ))}
        </SvgLinearGradient>
      </Defs>
      <Path
        d="M79 69 C71.2 82.4 51.6 86.8 35.2 79.1
           C18.5 71.2 11.5 50.9 20.2 34.7
           C28.9 18.5 49.3 11.9 65.3 20.7
           C76.8 27 83.3 37.6 83.8 49.3"
        fill="none"
        stroke="url(#kaizenRingGradient)"
        strokeWidth={11.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
