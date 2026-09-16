import { ButtonMetrics, CornerRadius, Spacing } from '@theme';

/**
 * One button in a CTA row, as the layout helpers measure it.
 *
 * The Planning/Spending rows that used to be spelled out here are gone — their
 * actions moved into the header "+" sheet (`BudgetAddActionsSheet`), where they
 * stack vertically and no longer have to survive a shared row. The type and the
 * styles below stay: Savings, Pension and the two Backup screens still build
 * real CTA rows out of them.
 */
export type BudgetCtaSpec = {
  testID: string;
  label: string;
  iconWidth: number;
};

/** Glyph size inside a CTA — one value so every action row matches. */
export const BUDGET_CTA_ICON_WIDTH = 16;

/** Styles every CTA row + root must carry to fill a ScrollView content column. */
export const BUDGET_CTA_ROW_STYLES = {
  root: { width: '100%' as const, alignSelf: 'stretch' as const },
  addRow: { flexDirection: 'row' as const, width: '100%' as const, gap: Spacing.md },
  /**
   * Outer wrapper slot for each CTA. RNGH's `TouchableOpacity` applies `style`
   * to its INNER view and `containerStyle` to the OUTER pressable — so the
   * `flex: 1` that makes buttons share the row equally must live here and be
   * passed via `containerStyle`, not `style`, or the buttons collapse to their
   * content width.
   */
  ctaSlot: { flex: 1 },
  addCta: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: Spacing.sm,
    borderRadius: CornerRadius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    minHeight: ButtonMetrics.minTapTarget,
    overflow: 'visible' as const,
  },
};

/** Border weight for outline-variant CTAs (kept here so it's tuned once). */
export const BUDGET_CTA_OUTLINE_BORDER_WIDTH = 1.5;

/**
 * Single source of truth for the CTA *look* (fill vs outline). Callers pass a
 * semantic token (e.g. `useAppColors().primary`) so light/dark skins resolve
 * automatically — change the visual language here and every Budget/Savings
 * action row (Planning, Spendings, Savings) updates together.
 */
export const budgetCtaFill = (primary: string) => ({ backgroundColor: primary });
export const budgetCtaOutline = (primary: string) => ({
  borderWidth: BUDGET_CTA_OUTLINE_BORDER_WIDTH,
  borderColor: primary,
});
/** Icon/label tint that pairs with each variant's background. */
export const budgetCtaTint = (
  variant: 'primary' | 'outline',
  colors: { primary: string; white: string }
) => (variant === 'primary' ? colors.white : colors.primary);
