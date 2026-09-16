import React, { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { CornerRadius, Spacing, hexToRgba, scaledFont, useAppColors } from '@theme';

/**
 * Live progress for a restore that is running somewhere other than this render.
 *
 * Two things make this more than a `ProgressBar` with a number in it:
 *
 *  1. **It has to move while JS is frozen.** Most of a restore is one
 *     synchronous Argon2 pass — the JS thread does not run for minutes. A
 *     JS-driven bar stops dead exactly when the member most needs to see that
 *     something is happening, so the fill and the percentage are both animated
 *     on the UI thread (the same trick `GradientButton`'s progress mode uses).
 *  2. **It has to resume, not restart.** The member can leave this screen and
 *     come back mid-restore, which mounts this card fresh against a run that is
 *     already three quarters done. So the fill starts from where `startedAt`
 *     says the run actually is, rather than snapping back to zero and lying
 *     about it.
 */

const AnimatedPercentInput = Animated.createAnimatedComponent(TextInput);

/**
 * How long the fill takes to cross a phone, roughly. Only the UI uses it, and
 * only to ease a bar on the UI thread — a JS-driven bar freezes solid the
 * moment sync Argon2 starts, which is precisely the part that takes minutes.
 */
export const RESTORE_ESTIMATE_MS = 150_000;

/**
 * The estimate only eases the bar this far. Whatever the clock says, the last
 * tenth belongs to the real thing finishing — a bar that sits full while work
 * continues is worse than one that sits at 90%.
 */
const CEILING = 0.9;
/** Visible kick, so the bar reads as started before Argon2 takes the thread. */
const START = 0.12;

/**
 * Where the bar should already be for a run that started `elapsedMs` ago.
 *
 * `Easing.out(Easing.quad)` evaluated in JS: the same curve the animation uses,
 * so a card mounted halfway through a restore picks up the fill where the run
 * actually is rather than snapping back to the start and lying about it. Pure,
 * so the resume math is verified without rendering anything.
 */
export function resumeFillFraction(elapsedMs: number, estimateMs: number): number {
  const estimate = Math.max(1, estimateMs);
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const t = Math.min(1, elapsed / estimate);
  const eased = 1 - (1 - t) * (1 - t);
  return START + (CEILING - START) * eased;
}

type Props = {
  /** 0–1 floor reported by the restore itself. */
  progress: number;
  /** Stage wording, e.g. "Decrypting…". */
  label: string;
  /** When the run claimed the slot — what makes resuming mid-run possible. */
  startedAt: number | null;
  estimateMs?: number;
  /** "Restoring your budget" / "Restoring your home" — names what is at stake. */
  title?: string;
  testID?: string;
};

export function RestoreProgressCard({
  progress,
  label,
  startedAt,
  estimateMs = RESTORE_ESTIMATE_MS,
  title = 'Restoring your budget',
  testID,
}: Props) {
  const colors = useAppColors();
  const fill = useSharedValue(0);
  const trackWidth = useSharedValue(0);
  const [layoutWidth, setLayoutWidth] = useState(0);

  // One UI-thread ease per run, placed at wherever the run already is.
  useEffect(() => {
    const estimate = Math.max(1, estimateMs);
    const elapsed = startedAt == null ? 0 : Math.max(0, Date.now() - startedAt);
    cancelAnimation(fill);
    fill.value = resumeFillFraction(elapsed, estimate);
    const remaining = estimate - elapsed;
    // Linear for the remainder: the curve's shape was already spent on the part
    // that ran before this card mounted, and a second ease-out from a resumed
    // position would visibly stall.
    if (remaining > 0) {
      fill.value = withTiming(CEILING, { duration: remaining, easing: Easing.linear });
    }
  }, [startedAt, estimateMs, fill]);

  // Stage floors from JS (once Argon2 unblocks) jump the fill forward — never
  // back, which is why only the closing stages are allowed to touch it.
  useEffect(() => {
    const target = Math.max(0, Math.min(1, progress));
    if (target < CEILING) return;
    cancelAnimation(fill);
    fill.value = withTiming(target, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [progress, fill]);

  const fillStyle = useAnimatedStyle(() => ({
    width: Math.max(0, trackWidth.value * Math.max(0, Math.min(1, fill.value))),
  }));

  const percentProps = useAnimatedProps(() => {
    const pct = Math.round(Math.max(0, Math.min(1, fill.value)) * 100);
    return { text: `${pct}%`, value: `${pct}%` };
  });

  const onTrackLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width <= 0 || width === layoutWidth) return;
    setLayoutWidth(width);
    trackWidth.value = width;
  };

  return (
    <Card
      style={styles.card}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={`${title}. ${label}`}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
    >
      <View style={styles.headerRow}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Typography variant="footnote" weight="semibold" style={styles.title} accessible={false}>
          {title}
        </Typography>
        <AnimatedPercentInput
          editable={false}
          caretHidden
          underlineColorAndroid="transparent"
          defaultValue="0%"
          animatedProps={percentProps}
          style={[styles.percent, scaledFont('bodySmallSemibold'), { color: colors.textSecondary }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </View>

      <View
        onLayout={onTrackLayout}
        style={[styles.track, { backgroundColor: hexToRgba(colors.primary, 0.16) }]}
      >
        <Animated.View style={[styles.fill, { backgroundColor: colors.primary }, fillStyle]} />
      </View>

      {/* The two things a bar cannot say: you are not stuck here, and you will
          be told. Without them, a progress bar on a screen you started from
          reads as "wait on this screen" — which is what it used to mean. */}
      <Typography variant="caption2" color={colors.textSecondary} accessible={false}>
        {label} You can leave this screen — we&apos;ll let you know when it&apos;s done.
      </Typography>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.base, gap: Spacing.sm, marginBottom: Spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { flex: 1 },
  // A TextInput, not a Typography: its text is driven by `animatedProps` so the
  // number keeps counting while the JS thread is inside Argon2.
  percent: { padding: 0, minWidth: 44, textAlign: 'right' },
  track: { height: 8, borderRadius: CornerRadius.xs, overflow: 'hidden' },
  fill: { height: '100%' },
});
