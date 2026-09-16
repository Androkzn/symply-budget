import { useId, useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';


import { GlassCard } from '@features/kaizen/brand';
import { KAIZEN_GRADIENT_BRAND } from '@features/kaizen/theme/appColors';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { useAppColors } from '@theme';

/** Brand gradient stops for the progress ring (mint → teal → azure → violet). */
const BRAND_STOPS = KAIZEN_GRADIENT_BRAND;
/** Solid "complete" tone — the teal step of the brand gradient. */
const BRAND_COMPLETE = KAIZEN_GRADIENT_BRAND[1] ?? KAIZEN_GRADIENT_BRAND[0];

/** Simple Kaizen brand progress ring — brand gradient arc over a hairline track. */
export function ProgressRing({
  progress,
  size = 150,
  stroke = 14,
  label = 'done',
}: {
  progress: number;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const colors = useAppColors();  const gradientId = useId();
  const clamped = Math.max(0, Math.min(1, progress));
  const complete = clamped >= 1;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);
  const track = colors.borderColor;
  const cx = size / 2;
  const lastStop = Math.max(BRAND_STOPS.length - 1, 1);

  const centerStyle = useMemo(
    () => ({
      width: size,
      height: size,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    }),
    [size],
  );

  return (
    <View style={centerStyle}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={gradientId} x1="8%" y1="0%" x2="92%" y2="100%">
            {BRAND_STOPS.map((color, i) => (
              <Stop
                key={color}
                offset={`${Math.round((i / lastStop) * 100)}%`}
                stopColor={color}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Circle cx={cx} cy={cx} r={radius} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={cx}
          cy={cx}
          r={radius}
          stroke={complete ? BRAND_COMPLETE : `url(#${gradientId})`}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      </Svg>
      <Text
        style={{
          color: colors.textPrimary,
          fontSize: Typography.title.size,
          fontWeight: '800',
        }}
      >
        {Math.round(clamped * 100)}%
      </Text>
      <Text style={{ color: colors.textSecondary, fontSize: Typography.caption.size }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * iOS 26 Liquid Glass command card. `tint` marks a hero/primary card, which
 * uses the stronger translucent fill so it reads as elevated.
 */
export function CommandCenterCard({
  children,
  tint,
}: {
  children: ReactNode;
  tint?: string;
}) {
  return (
    <GlassCard strong={Boolean(tint)} padding={Spacing.base}>
      {children}
    </GlassCard>
  );
}
