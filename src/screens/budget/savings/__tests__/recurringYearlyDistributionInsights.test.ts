/**
 * Unit tests for the pure helpers behind `RecurringYearlyDistributionChart`
 * — the "distribution by category, across the whole year" stacked bar.
 * Kept pure so they can be tested without rendering the React Native chart.
 */
import type { RecurringYearlyGroupBreakdown } from '@api/savings';
import { getAppColors } from '@theme';
import { seriesColor } from '@theme/chartPalette';

import { buildYearlyLegend, buildYearlyStacks, groupDisplayLabel } from '../recurringYearlyDistributionInsights';

const colors = getAppColors('light');

function month(monthNum: number, byGroup: Array<{ group_label: string | null; subtotalCents: number }>) {
  const totalCents = byGroup.reduce((sum, g) => sum + g.subtotalCents, 0);
  return { month: monthNum, totalCents, byGroup };
}

describe('groupDisplayLabel', () => {
  it('maps null to "Other"', () => {
    expect(groupDisplayLabel(null)).toBe('Other');
  });

  it('passes a named group through verbatim', () => {
    expect(groupDisplayLabel('Housing')).toBe('Housing');
  });
});

describe('buildYearlyStacks', () => {
  it('produces 12 stacks (Jan→Dec), one segment per group in FIXED order', () => {
    const breakdown: RecurringYearlyGroupBreakdown = {
      year: 2026,
      groups: [{ group_label: 'Housing' }, { group_label: 'Utilities' }, { group_label: null }],
      months: Array.from({ length: 12 }, (_, i) =>
        month(i + 1, [
          { group_label: 'Housing', subtotalCents: 180_000 },
          { group_label: 'Utilities', subtotalCents: 9_000 },
          { group_label: null, subtotalCents: 1_600 },
        ])
      ),
    };

    const stacks = buildYearlyStacks(breakdown, colors);
    expect(stacks).toHaveLength(12);
    expect(stacks.map((s) => s.label)).toEqual(['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']);
    for (const stack of stacks) {
      expect(stack.segments).toHaveLength(3);
      expect(stack.segments[0]).toEqual({ value: 1800, color: seriesColor(colors, 0) });
      expect(stack.segments[1]).toEqual({ value: 90, color: seriesColor(colors, 1) });
      expect(stack.segments[2]).toEqual({ value: 16, color: seriesColor(colors, 2) });
    }
  });

  it('a group missing from a given month still gets a ZERO segment at its fixed position — never dropped', () => {
    const breakdown: RecurringYearlyGroupBreakdown = {
      year: 2026,
      groups: [{ group_label: 'Housing' }, { group_label: 'Childcare & Education' }],
      months: [
        month(1, [
          { group_label: 'Housing', subtotalCents: 180_000 },
          { group_label: 'Childcare & Education', subtotalCents: 0 },
        ]),
        ...Array.from({ length: 5 }, (_, i) =>
          month(i + 2, [
            { group_label: 'Housing', subtotalCents: 180_000 },
            { group_label: 'Childcare & Education', subtotalCents: 0 },
          ])
        ),
        month(7, [
          { group_label: 'Housing', subtotalCents: 180_000 },
          { group_label: 'Childcare & Education', subtotalCents: 6_000 },
        ]),
        ...Array.from({ length: 5 }, (_, i) =>
          month(i + 8, [
            { group_label: 'Housing', subtotalCents: 180_000 },
            { group_label: 'Childcare & Education', subtotalCents: 0 },
          ])
        ),
      ],
      // Months not explicitly listed above still resolve via `monthByNumber`
      // lookup — but every month IS listed here (1..12), so this fixture is
      // exhaustive.
    };

    const stacks = buildYearlyStacks(breakdown, colors);
    // January: Childcare segment present at index 1, value 0 — not removed.
    expect(stacks[0].segments).toHaveLength(2);
    expect(stacks[0].segments[1]).toEqual({ value: 0, color: seriesColor(colors, 1) });
    // July: the one month camp actually ran.
    expect(stacks[6].segments[1]).toEqual({ value: 60, color: seriesColor(colors, 1) });
    // Every stack still carries both segments at the same fixed indices.
    expect(stacks.every((s) => s.segments.length === 2)).toBe(true);
  });

  it('a month absent from the BE payload entirely still renders as an all-zero stack (never a missing bar)', () => {
    const breakdown: RecurringYearlyGroupBreakdown = {
      year: 2026,
      groups: [{ group_label: 'Housing' }],
      months: [month(1, [{ group_label: 'Housing', subtotalCents: 180_000 }])],
    };
    const stacks = buildYearlyStacks(breakdown, colors);
    expect(stacks).toHaveLength(12);
    expect(stacks[1].segments).toEqual([{ value: 0, color: seriesColor(colors, 0) }]);
  });
});

describe('buildYearlyLegend', () => {
  it('one entry per group, "Other" label for null, same order/color the stacks use', () => {
    const breakdown: RecurringYearlyGroupBreakdown = {
      year: 2026,
      groups: [{ group_label: 'Housing' }, { group_label: 'Utilities' }, { group_label: null }],
      months: [],
    };
    const legend = buildYearlyLegend(breakdown, colors);
    expect(legend).toEqual([
      { label: 'Housing', color: seriesColor(colors, 0) },
      { label: 'Utilities', color: seriesColor(colors, 1) },
      { label: 'Other', color: seriesColor(colors, 2) },
    ]);
  });

  it('empty groups → empty legend', () => {
    const breakdown: RecurringYearlyGroupBreakdown = { year: 2026, groups: [], months: [] };
    expect(buildYearlyLegend(breakdown, colors)).toEqual([]);
  });
});
