import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ProgressRing, Typography } from '@components/ui';
import { Spacing, useAppColors } from '@theme';

import type { NutritionGoals, NutritionTotals } from '../healthNutritionStorage';

import { MACRO_SERIES } from './HealthMacroBreakdown';
import { HealthGoalBar } from './HealthStatTiles';

/**
 * Symply Health — the donor's `CalorieBalanceCardView` ring + macro bars.
 *
 * Extracted out of `HealthNutritionScreen` so the Nutrition tab and the new
 * Home "Calorie ring" widget cannot drift: both draw the SAME ring math and
 * the SAME three macro bars. Center-text rule ported verbatim from Nutrition:
 * `remaining = max(0, goal - total)`, `overBy = max(0, -(goal - total))` —
 * "`{remaining}` left" under goal, "`{overBy}` over" (in `colors.error`) once
 * over it.
 *
 * Deliberately NOT the donor's `CalorieRingView` + `CalorieStatRow` pair — the
 * donor draws Eaten / Burned / Goal kcal rows beside the ring, where "Burned"
 * is HealthKit active-energy folded into the day's budget. This app has no
 * HealthKit connection, so there is no burned-calories figure to fold in; the
 * ring + macro bars are the whole card, matching what Nutrition already
 * shipped rather than inventing a burned-calories figure from nothing.
 *
 * Prop shape matches this app's own computed `NutritionTotals`/`NutritionGoals`
 * (`carbs`/`fat`, not the wire's `carbohydrates`/`fats`) since every caller —
 * Nutrition's own `sumNutrition(entries)` and Home's identical call — already
 * produces that shape; remapping field names at each call site would be pure
 * friction.
 */
export interface HealthCalorieRingCardProps {
  totals: NutritionTotals;
  goals: NutritionGoals;
  /** Prefix for every sub-element's testID (`${testID}-ring`, `-balance`, …). */
  testID?: string;
}

export function HealthCalorieRingCard({
  totals,
  goals,
  testID = 'health-calorie-ring-card',
}: HealthCalorieRingCardProps) {
  const colors = useAppColors();
  const remaining = Math.max(0, goals.calories - totals.calories);
  const overBy = Math.max(0, -(goals.calories - totals.calories));

  return (
    <View style={styles.ringRow} testID={testID}>
      <ProgressRing
        progress={goals.calories > 0 ? totals.calories / goals.calories : 0}
        size={104}
        stroke={11}
        showPercent={false}
        testID={`${testID}-ring`}
      >
        <Typography
          variant="title3"
          weight="bold"
          color={colors.textPrimary}
          testID={`${testID}-total-kcal`}
        >
          {totals.calories}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          / {goals.calories}
        </Typography>
        <Typography
          variant="caption1"
          weight="semibold"
          color={overBy > 0 ? colors.error : colors.textSecondary}
          testID={`${testID}-balance`}
        >
          {overBy > 0 ? `${overBy} over` : `${remaining} left`}
        </Typography>
      </ProgressRing>
      <View style={styles.macroColumn}>
        <HealthGoalBar
          label="Protein"
          value={totals.protein}
          target={goals.protein}
          suffix="g"
          color={MACRO_SERIES[0].color}
          testID={`${testID}-protein-bar`}
        />
        <HealthGoalBar
          label="Carbs"
          value={totals.carbs}
          target={goals.carbs}
          suffix="g"
          color={MACRO_SERIES[1].color}
          testID={`${testID}-carbs-bar`}
        />
        <HealthGoalBar
          label="Fat"
          value={totals.fat}
          target={goals.fat}
          suffix="g"
          color={MACRO_SERIES[2].color}
          testID={`${testID}-fat-bar`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  macroColumn: {
    flex: 1,
    gap: Spacing.sm,
  },
});
