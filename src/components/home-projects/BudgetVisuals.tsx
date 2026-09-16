/**
 * The picture at the foot of the Budget tab.
 *
 * Everything above it is a column of figures, and a column of figures answers
 * "what is each thing" while hiding the question a member actually scrolls down
 * with: **where is the money going**. That is a composition, so it gets a
 * part-to-whole bar rather than more rows of text.
 *
 * The other question — *am I still inside my budget* — used to be answered by a
 * spend meter directly above this. It lives in `BudgetBar` now, at the top of
 * every project surface, because it is the one figure worth seeing without
 * opening the Budget tab at all. Its derivation went with it (`spendMeter`), so
 * there is still exactly one of it.
 *
 * It is drawn from the SAME budget lines the rollup sums, so the picture and the
 * numbers above it cannot disagree — there is no second derivation here, only a
 * second presentation.
 *
 * ## Colour
 *
 * The distribution is IDENTITY, so it wears `seriesColor` — the brand's fixed
 * categorical order — indexed by the CATEGORY, not by the segment's position.
 * Materials is the same colour on a project that has no labour line as on one
 * that does; deleting a line never repaints the survivors. (The status palette
 * the meter wears is reserved for STATE, and the two are never mixed.)
 *
 * Identity is never carried by colour alone: every segment is named in the
 * legend beside its amount, and the legend is present whenever there is more
 * than one segment. Text stays on text tokens — a value is never printed in its
 * series colour.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { BudgetRollups, HomeProjectBudgetLine } from '@api/home-projects';
import { seriesColor, useAppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

/**
 * Category → its slot in the brand's categorical order.
 *
 * A fixed map rather than `indexOf` over the categories present: the index has to
 * follow the entity so that a project's Materials segment keeps its colour when
 * the member deletes their Permits line. Anything unrecognised folds into the
 * `other` slot rather than generating a new hue.
 */
const CATEGORY_ORDER = ['materials', 'labor', 'permits', 'other', 'contingency'] as const;

const CATEGORY_LABELS: Record<string, string> = {
  materials: 'Materials',
  labor: 'Labor',
  permits: 'Permits',
  other: 'Other',
  contingency: 'Contingency',
};

function colorFor(category: string, colors: ReturnType<typeof useAppColors>): string {
  const index = CATEGORY_ORDER.indexOf(category as (typeof CATEGORY_ORDER)[number]);
  return seriesColor(colors, index >= 0 ? index : CATEGORY_ORDER.indexOf('other'));
}

export interface BudgetSlice {
  category: string;
  label: string;
  estimateCents: number;
  actualCents: number;
}

/**
 * The budget lines, folded into one slice per category.
 *
 * Contingency comes from `rollups.contingency_cents` rather than from the lines,
 * for the reason `computeRollups` gives: it is a percentage of everything else
 * unless a member has typed an explicit `contingency` line, so summing the lines
 * would miss it in the usual case and double it in the other. Its `actualCents`
 * is 0 because a buffer is not a payment — nobody writes a cheque to contingency.
 *
 * Exported for the test: the slices ARE the chart, and a chart is otherwise only
 * assertable by rendering it.
 */
export function budgetSlices(
  lines: readonly HomeProjectBudgetLine[],
  contingencyCents: number
): BudgetSlice[] {
  const byCategory = new Map<string, BudgetSlice>();
  for (const line of lines) {
    if (line.category === 'contingency') continue;
    const slice = byCategory.get(line.category) ?? {
      category: line.category,
      label: CATEGORY_LABELS[line.category] ?? line.category,
      estimateCents: 0,
      actualCents: 0,
    };
    slice.estimateCents += line.estimate_cents;
    slice.actualCents += line.actual_cents;
    byCategory.set(line.category, slice);
  }
  if (contingencyCents > 0) {
    byCategory.set('contingency', {
      category: 'contingency',
      label: CATEGORY_LABELS.contingency,
      estimateCents: contingencyCents,
      actualCents: 0,
    });
  }
  return CATEGORY_ORDER.map((category) => byCategory.get(category))
    .filter((slice): slice is BudgetSlice => !!slice && slice.estimateCents > 0)
    .concat(
      // Anything outside the known five keeps its own row rather than being
      // dropped: the backend's enum is closed today but the column is free text.
      [...byCategory.values()].filter(
        (slice) =>
          slice.estimateCents > 0 &&
          !CATEGORY_ORDER.includes(slice.category as (typeof CATEGORY_ORDER)[number])
      )
    );
}

export function BudgetVisuals({
  rollups,
  budgetLines,
  currency,
}: {
  rollups: BudgetRollups;
  budgetLines: readonly HomeProjectBudgetLine[];
  currency?: string | null;
}) {
  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes, as `BudgetBar` does.
  useDisplayCurrency();
  const money = (cents: number) => formatMoney(cents, { code: currency });

  const slices = budgetSlices(budgetLines, rollups.contingency_cents);
  const priced = slices.reduce((sum, slice) => sum + slice.estimateCents, 0);
  const anySpend = rollups.actual_total > 0;

  return (
    <View style={styles.wrap} testID="budget-visuals">
      <Text style={[styles.title, { color: colors.textPrimary }]}>Where the money goes</Text>

      {slices.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          Nothing priced yet. Add a figure to a line below and the split appears here.
        </Text>
      ) : (
        <>
          <View style={styles.stack} testID="budget-distribution">
            {slices.map((slice) => (
              <View
                key={slice.category}
                style={[
                  styles.segment,
                  {
                    // `flex` rather than a percentage width: the 2pt `gap` between
                    // segments comes out of the row, so percentages would overflow
                    // it by the total gap width on a project with many categories.
                    flex: slice.estimateCents,
                    backgroundColor: colorFor(slice.category, colors),
                  },
                ]}
              />
            ))}
          </View>
          {slices.map((slice) => (
            <View key={slice.category} style={styles.legendRow}>
              <View
                style={[styles.swatch, { backgroundColor: colorFor(slice.category, colors) }]}
              />
              <View style={styles.legendLabel}>
                <Text style={[styles.legendLabelText, { color: colors.textPrimary }]}>
                  {slice.label}
                </Text>
                {/*
                  Only where something has been paid, and only for the categories
                  that have. A `spent $0` under every row would be four lines of
                  chrome saying nothing on the projects that have not started.
                */}
                {anySpend && slice.actualCents > 0 && (
                  <Text style={[styles.legendSub, { color: colors.textSecondary }]}>
                    {money(slice.actualCents)} spent
                  </Text>
                )}
              </View>
              <Text style={[styles.legendShare, { color: colors.textSecondary }]}>
                {priced > 0 ? `${Math.round((slice.estimateCents / priced) * 100)}%` : '—'}
              </Text>
              <Text style={[styles.legendValue, { color: colors.textPrimary }]}>
                {money(slice.estimateCents)}
              </Text>
            </View>
          ))}
          <View style={[styles.legendRow, styles.legendTotal, { borderColor: colors.borderColor }]}>
            <View style={styles.swatchSpacer} />
            <View style={styles.legendLabel}>
              <Text
                style={[styles.legendLabelText, styles.legendTotalText, { color: colors.textPrimary }]}
              >
                Priced so far
              </Text>
            </View>
            <Text style={[styles.legendShare, { color: colors.textSecondary }]} />
            <Text style={[styles.legendValue, styles.legendTotalText, { color: colors.textPrimary }]}>
              {money(priced)}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

const SWATCH = 10;

const styles = StyleSheet.create({
  wrap: { marginTop: 20 },
  title: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  empty: { fontSize: 13, marginBottom: 4 },
  /* 2pt of surface between fills, so adjacent segments stay countable even when
     two categories land on neighbouring hues. */
  stack: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 12,
    gap: 2,
  },
  segment: { height: '100%' },
  legendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  swatch: { width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2, marginRight: 8 },
  swatchSpacer: { width: SWATCH, marginRight: 8 },
  legendLabel: { flex: 1 },
  legendLabelText: { fontSize: 14 },
  legendSub: { fontSize: 12, marginTop: 1 },
  legendShare: { fontSize: 13, width: 48, textAlign: 'right' },
  legendValue: { fontSize: 14, width: 96, textAlign: 'right' },
  legendTotal: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2 },
  legendTotalText: { fontWeight: '700' },
});
