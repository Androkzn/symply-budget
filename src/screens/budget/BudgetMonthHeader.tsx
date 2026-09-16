import React, { type ReactNode } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { IconSize, Layout, Spacing, useAppColors } from '@theme';

/** Short month names, index 0 = January. */
export const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Full month names, index 0 = January. */
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `1`-based month number → `Jan`…`Dec`. */
export function monthLabel(month: number): string {
  return MONTH_ABBR[month - 1] ?? String(month);
}

/** `1`-based month number → `January`…`December`. */
export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

/**
 * The period stepper's month title — `"September 2026"`. Spelled out rather
 * than abbreviated: the stepper is a headline with room for it, unlike the
 * chart axes and history tables that still take `monthLabel`'s abbreviation.
 */
export function monthYearLabel(year: number, month: number): string {
  return `${monthName(month)} ${year}`;
}

/** Steps `{year, month}` BACK by `n` months (so `1` = previous month). */
export function shiftMonth(
  year: number,
  month: number,
  n: number,
): { year: number; month: number } {
  const total = year * 12 + (month - 1) - n;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** `stickyHeaderIndices` for a scroll whose first child is a pinned header. */
export const BUDGET_STICKY_HEADER_INDICES = [0];

interface BudgetMonthHeaderProps {
  /** Text between the arrows — `"August 2026"` for months, `"2026"` for years. */
  label: string;
  /** Step backwards (older period). */
  onPrev: () => void;
  /** Step forwards (newer period). */
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  prevTestID?: string;
  nextTestID?: string;
  labelTestID?: string;
  /** Drives the arrows' accessibility labels ("Previous month" / "Next year"). */
  unit?: 'month' | 'year' | 'period';
  /**
   * `true` (default) — render the opaque band this header needs as the pinned
   * child of a `stickyHeaderIndices={BUDGET_STICKY_HEADER_INDICES}` scroll.
   * `false` — bare row for hosts that scroll their header away (Pension, which
   * shares its parent screen's ScrollView and its horizontal chrome).
   */
  pinned?: boolean;
  /** Extra chrome pinned WITH the stepper — e.g. the Savings sub-tab row. */
  children?: ReactNode;
}

/**
 * The one period stepper for every Budget section (Planning, Spending,
 * Savings, Pension). Forked copies drifted apart — Savings sat 4pt higher than
 * Planning/Spending because each screen re-declared its own paddings — so the
 * row metrics, the pinned band and the gap to the content below all live here
 * and nowhere else.
 *
 * Vertical rhythm, and why it is shaped this way:
 *
 * - The band's `paddingVertical` is SYMMETRIC, so the row (and the sub-tabs
 *   under it) sit optically centred in the painted box rather than pressed
 *   against its bottom edge.
 * - That padding is also the ONLY space above the row. The hosting scroll must
 *   NOT add `paddingTop` to its `contentContainerStyle` (use
 *   `BUDGET_STICKY_SCROLL_CONTENT`): that padding would sit above the sticky
 *   child, so the header would drift up by exactly that much on the first
 *   scroll before pinning — the visible "jump" — on top of reading as extra
 *   dead space under the app header.
 * - `marginBottom` sits OUTSIDE the painted box (margin isn't part of an
 *   element's own painted area), so the gap to the content below stays
 *   transparent and the screen's gradient shows through it.
 * - RN's sticky machinery moves the pinned child's own style onto its internal
 *   wrapper and replaces the child's style with a bare `flex: 1`. So the band
 *   may only carry styles that still work one level up (padding, margin,
 *   background) — `flexDirection` lives on `row`, and the row/children gap is a
 *   margin on `row` rather than `gap` on the band, which the transfer drops.
 */
export function BudgetMonthHeader({
  label,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  prevTestID,
  nextTestID,
  labelTestID,
  unit = 'month',
  pinned = true,
  children,
}: BudgetMonthHeaderProps) {
  const colors = useAppColors();

  // Guard the handlers as well as the `disabled` prop: a bounded stepper must
  // not step past its bound even if a press slips through (RN's `disabled`
  // stops the touch, but the callback is also reachable directly).
  const step = (disabled: boolean, go: () => void) => () => {
    if (disabled) return;
    go();
  };

  return (
    <View
      style={[
        pinned ? styles.band : styles.bareBand,
        pinned && { backgroundColor: colors.backgroundMain },
      ]}
    >
      <View style={[styles.row, children ? styles.rowWithChildren : null]}>
        <TouchableOpacity
          onPress={step(prevDisabled, onPrev)}
          disabled={prevDisabled}
          style={styles.arrow}
          accessibilityRole="button"
          accessibilityLabel={`Previous ${unit}`}
          accessibilityState={{ disabled: prevDisabled }}
          testID={prevTestID}
        >
          <Icon
            name="chevron-back"
            size={IconSize.md}
            color={prevDisabled ? colors.textTertiary : colors.textPrimary}
          />
        </TouchableOpacity>

        <Typography variant="headline" weight="semibold" testID={labelTestID}>
          {label}
        </Typography>

        <TouchableOpacity
          onPress={step(nextDisabled, onNext)}
          disabled={nextDisabled}
          style={styles.arrow}
          accessibilityRole="button"
          accessibilityLabel={`Next ${unit}`}
          accessibilityState={{ disabled: nextDisabled }}
          testID={nextTestID}
        >
          <Icon
            name="chevron-forward"
            size={IconSize.md}
            color={nextDisabled ? colors.textTertiary : colors.textPrimary}
          />
        </TouchableOpacity>
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.base,
  },
  // Pension's stepper scrolls with its parent screen, which already owns the
  // top padding and the background. Only the space BELOW is restated, so the
  // gap from the stepper to the content matches every other section.
  bareBand: {
    paddingBottom: Spacing.sm,
    marginBottom: Spacing.base,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xl,
  },
  rowWithChildren: {
    marginBottom: Spacing.base,
  },
  arrow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  stickyScrollContent: {
    // No `paddingTop` — see BudgetMonthHeader's rhythm notes.
    paddingBottom: Layout.bottomTabBarClearance,
    backgroundColor: 'transparent',
  },
});

/**
 * `contentContainerStyle` for a scroll whose first child is a pinned
 * `<BudgetMonthHeader>`. Keeps the header at content offset 0 so it pins from
 * the first scrolled pixel instead of drifting first.
 */
export const BUDGET_STICKY_SCROLL_CONTENT = styles.stickyScrollContent;
