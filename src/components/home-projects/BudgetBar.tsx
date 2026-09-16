import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { BudgetRollups } from '@api/home-projects';
import { ProgressBar, clampFraction } from '@components/ui/ProgressBar';
import { useAppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

/** Which status colour the meter wears. Mirrors `budget_health`, plus overspend. */
export type SpendMeterTone = 'ok' | 'watch' | 'over';

export interface SpendMeter {
  /** What the spend is measured against. 0 when there is nothing to measure yet. */
  baseCents: number;
  /** True when `baseCents` is the member's own target rather than the priced total. */
  againstTarget: boolean;
  spentCents: number;
  /** Negative once the base is passed. */
  remainingCents: number;
  /** Clamped to [0, 1] — an overspend fills the track and is reported in words. */
  fraction: number;
  tone: SpendMeterTone;
}

/**
 * The strip's one figure, derived.
 *
 * **What the bar is measured against** is the target when there is one — it is
 * the member's own number and the only figure in this feature they chose
 * outright. Falling back to `estimate_total` (the priced lines plus contingency,
 * per `computeBudgetRollups`) keeps the bar meaningful on a project with no
 * target, and the caption above it says which of the two it is: a bar that
 * silently changes its denominator is worse than no bar.
 *
 * **The tone is not `budget_health` alone.** `budget_health` compares the
 * ESTIMATE against the target — it can read `ok` on a project that has already
 * overspent, because nothing was priced. So an actual overspend takes `over`
 * outright and `watch` is deferred to, not derived again.
 *
 * Exported and pure because it IS the picture: fraction, denominator and tone
 * are the whole of what the bar draws, and none of them is assertable by
 * rendering a track whose fill is a percentage width.
 */
export function spendMeter(rollups: BudgetRollups): SpendMeter {
  const target = rollups.target_budget_cents;
  const againstTarget = target != null && target > 0;
  const baseCents = againstTarget ? target : Math.max(0, rollups.estimate_total);
  const spentCents = rollups.actual_total;
  const tone: SpendMeterTone =
    baseCents > 0 && spentCents > baseCents
      ? 'over'
      : rollups.budget_health === 'watch'
        ? 'watch'
        : 'ok';
  return {
    baseCents,
    againstTarget,
    spentCents,
    remainingCents: baseCents - spentCents,
    fraction: clampFraction(spentCents, baseCents),
    tone,
  };
}

/**
 * The budget strip every project surface carries.
 *
 * It used to print two figures — Target and Actual — side by side and leave the
 * member to divide one by the other. The question they open a renovation with is
 * not "what are these two numbers", it is **am I still inside my budget**, and
 * that is a proportion: a meter answers it at a glance where a pair of figures
 * only supplies the ingredients. So the two metrics are gone and the spend meter
 * moved up here from the foot of the Budget tab, where it sat below everything
 * and was seen only by a member who had already scrolled to look for it.
 *
 * Both figures survive in the caption underneath, which is where they read as
 * what they are — the ends of the bar, not two unrelated totals.
 *
 * Also gone with them: the `OVER` / `WATCH` / `OK` chip, and a contingency line.
 * The chip restated `spent > target` in red directly under the numbers it was
 * judging, which the meter's own colour and its "$X over" caption now carry; the
 * contingency figure is a buffer the member never chose (it defaults to 0%) and
 * is itemised on the Budget tab beside the lines it is drawn from.
 */
export function BudgetBar({
  rollups,
  currency,
}: {
  rollups: BudgetRollups;
  currency?: string | null;
}) {
  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  // A project can carry its own currency; without one it follows Settings → Currency.
  const money = (cents: number) => formatMoney(cents, { code: currency });

  const meter = spendMeter(rollups);
  const toneColor =
    meter.tone === 'over'
      ? colors.error
      : meter.tone === 'watch'
        ? colors.warning
        : colors.success;

  return (
    <View
      style={[styles.wrap, { backgroundColor: colors.card, borderColor: colors.borderColor }]}
      testID="budget-bar"
    >
      <Text style={[styles.title, { color: colors.textSecondary }]}>
        {meter.againstTarget ? 'Spent against your target' : 'Spent against what you have priced'}
      </Text>

      {meter.baseCents <= 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]} testID="budget-bar-empty">
          Set a target on the Budget tab, or price a line there, and this fills in.
        </Text>
      ) : (
        <>
          {/*
            The primitive draws the track; the announcement lives on the wrapper
            because `ProgressBar` takes no accessibility props and a bar a screen
            reader reports as an unlabelled view is not a progress indicator.
          */}
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={`${money(meter.spentCents)} spent of ${money(meter.baseCents)}`}
          >
            <ProgressBar
              value={meter.spentCents}
              max={meter.baseCents}
              height={10}
              color={toneColor}
              trackColor={colors.chartNeutral}
              testID="budget-bar-meter"
            />
          </View>
          <View style={styles.row}>
            <Text style={[styles.caption, { color: colors.textSecondary }]}>
              {money(meter.spentCents)} spent of {money(meter.baseCents)}
            </Text>
            <Text
              style={[
                styles.caption,
                styles.captionStrong,
                { color: meter.remainingCents < 0 ? colors.error : colors.textPrimary },
              ]}
              testID="budget-bar-remaining"
            >
              {meter.remainingCents < 0
                ? `${money(-meter.remainingCents)} over`
                : `${money(meter.remainingCents)} left`}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  title: { fontSize: 12 },
  empty: { fontSize: 13 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  caption: { fontSize: 13 },
  captionStrong: { fontWeight: '700' },
});
