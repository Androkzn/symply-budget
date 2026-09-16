/* eslint-disable no-restricted-syntax -- sentinel hex colors: the tests assert the exact value passed through, so tokens would defeat the check. */
/**
 * BUDGET-DASH-045 — `src/screens/budget/budgetCtaLayout.ts` had zero tests.
 *
 * NOTE ON THE MATRIX ROW: DASH-045 describes "compute the CTA layout for zero,
 * one, two and overflow CTA counts". The module exposes **no count-parameterised
 * layout function** — it is the shared row/slot styles that make N buttons share
 * one row via `flex: 1`. So the determinism the row asks for is a property of the
 * *styles*, not of a computed arrangement: every CTA slot is `flex: 1`, so any
 * count divides the row evenly, no width is ever NaN, the gap is never negative
 * and nothing is pushed off-screen because no fixed widths exist. These tests
 * assert that actual contract.
 *
 * The per-screen CTA SPECS this file used to enumerate were retired with the
 * Planning/Spending action row (see BudgetAddActionsSheet).
 */
import { ButtonMetrics, CornerRadius, Spacing } from '@theme';

import {
  BUDGET_CTA_OUTLINE_BORDER_WIDTH,
  BUDGET_CTA_ROW_STYLES,
  budgetCtaFill,
  budgetCtaOutline,
  budgetCtaTint,
} from '../budgetCtaLayout';

describe('budgetCtaLayout — row styles are count-independent', () => {
  it('BUDGET-DASH-045: the row fills the content column and uses a non-negative gap', () => {
    const { root, addRow } = BUDGET_CTA_ROW_STYLES;
    expect(root.width).toBe('100%');
    expect(root.alignSelf).toBe('stretch');
    expect(addRow.flexDirection).toBe('row');
    expect(addRow.width).toBe('100%');
    expect(typeof addRow.gap).toBe('number');
    expect(addRow.gap).toBe(Spacing.md);
    expect(addRow.gap).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(addRow.gap)).toBe(false);
  });

  it('BUDGET-DASH-045: the CTA slot is flex:1 on the OUTER wrapper so any count divides the row evenly', () => {
    // RNGH TouchableOpacity puts `style` on the inner view and `containerStyle`
    // on the outer pressable — `flex: 1` must be on the slot (containerStyle) or
    // the buttons collapse to content width. There is no fixed width anywhere,
    // which is exactly why zero/one/two/overflow counts all lay out safely.
    expect(BUDGET_CTA_ROW_STYLES.ctaSlot).toEqual({ flex: 1 });
    expect(BUDGET_CTA_ROW_STYLES.addCta.flex).toBe(1);
    expect(
      Object.prototype.hasOwnProperty.call(BUDGET_CTA_ROW_STYLES.addCta, 'width')
    ).toBe(false);
  });

  it('BUDGET-DASH-045: the CTA keeps the minimum tap target and never clips its icon', () => {
    const { addCta } = BUDGET_CTA_ROW_STYLES;
    expect(addCta.minHeight).toBe(ButtonMetrics.minTapTarget);
    expect(addCta.minHeight).toBeGreaterThan(0);
    expect(addCta.borderRadius).toBe(CornerRadius.lg);
    expect(addCta.overflow).toBe('visible');
    expect(addCta.alignItems).toBe('center');
    expect(addCta.justifyContent).toBe('center');
    for (const value of [addCta.gap, addCta.paddingVertical, addCta.paddingHorizontal]) {
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('budgetCtaLayout — variant helpers', () => {
  it('BUDGET-DASH-045: fill and outline are mutually exclusive style shapes', () => {
    expect(budgetCtaFill('#123456')).toEqual({ backgroundColor: '#123456' });
    expect(budgetCtaOutline('#123456')).toEqual({
      borderWidth: BUDGET_CTA_OUTLINE_BORDER_WIDTH,
      borderColor: '#123456',
    });
    expect(budgetCtaFill('#123456')).not.toHaveProperty('borderWidth');
    expect(budgetCtaOutline('#123456')).not.toHaveProperty('backgroundColor');
    expect(BUDGET_CTA_OUTLINE_BORDER_WIDTH).toBeGreaterThan(0);
  });

  it('BUDGET-DASH-045: the tint pairs with the variant background', () => {
    const colors = { primary: '#0a7', white: '#fff' };
    expect(budgetCtaTint('primary', colors)).toBe(colors.white);
    expect(budgetCtaTint('outline', colors)).toBe(colors.primary);
  });
});
