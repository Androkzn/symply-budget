import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { BudgetEncouragement, BudgetEncouragementTone } from '@api/budget';
import { Icon, Typography } from '@components/ui';
import { useAppColors, hexToRgba, IconSize, Spacing, CornerRadius } from '@theme';

import { encouragementKitIcon } from './budgetEncouragementIcon';

interface Props {
  encouragement: BudgetEncouragement;
}

/**
 * "Budget Wins" banner — pure presentation. Every dollar figure and every word
 * of copy is computed on the backend (see budget-encouragement.ts); this only
 * renders the returned strings and maps `tone` to an accent color.
 */
export function BudgetEncouragementBanner({ encouragement }: Props) {  const colors = useAppColors();

  const accent = useMemo((): string => {
    const byTone: Record<BudgetEncouragementTone, string> = {
      celebrate: colors.success,
      positive: colors.accentTeal,
      neutral: colors.primary,
      watch: colors.warning,
      tip: colors.primary,
    };
    return byTone[encouragement.tone] ?? colors.primary;
  }, [encouragement.tone, colors]);

  const kitIcon = encouragementKitIcon(encouragement.emoji);

  return (
    <Animated.View
      entering={FadeIn.duration(280)}
      style={[
        styles.banner,
        { backgroundColor: hexToRgba(accent, 0.1), borderColor: hexToRgba(accent, 0.22) },
      ]}
      testID="budget-encouragement-banner"
    >
      <View style={[styles.emojiBubble, { backgroundColor: hexToRgba(accent, 0.16) }]}>
        {kitIcon ? (
          <Icon name={kitIcon} size={IconSize.xl} color={accent} active testID="budget-encouragement-icon" />
        ) : (
          <Typography variant="title3">{encouragement.emoji}</Typography>
        )}
      </View>

      <View style={styles.body}>
        <Typography variant="subheadline" weight="semibold">
          {encouragement.headline}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.message}>
          {encouragement.message}
        </Typography>

        {encouragement.highlight ? (
          <View style={[styles.pill, { backgroundColor: hexToRgba(accent, 0.16) }]}>
            <Typography variant="caption1" weight="semibold" color={accent}>
              {encouragement.highlight}
            </Typography>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
  },
  emojiBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  message: {
    marginTop: 2,
  },
  pill: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: CornerRadius.full,
  },
});
