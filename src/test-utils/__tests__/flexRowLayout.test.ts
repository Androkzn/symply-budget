import type { BudgetCtaSpec } from '../../screens/budget/budgetCtaLayout';
import {
  assertCtaRowFitsButtonLabels,
  estimateHorizontalCtaMinWidth,
  estimateShrinkWrappedRowWidth,
  layoutFlexRow,
  resolveFlexRowWidth,
  shrinkWrappedRowClipsLabels,
} from '../flexRowLayout';

// Fixtures, not product data: these mirror the shape of a real Budget CTA row
// (a two- or three-button row whose narrowest label is "AI") so the helpers are
// exercised against realistic widths without pinning them to any one screen.
const THREE_CTAS: BudgetCtaSpec[] = [
  { testID: 'cta-planned', label: 'Planned', iconWidth: 16 },
  { testID: 'cta-spent', label: 'Spent', iconWidth: 16 },
  { testID: 'cta-ai', label: 'AI', iconWidth: 16 },
];
const TWO_CTAS: BudgetCtaSpec[] = [THREE_CTAS[0], THREE_CTAS[2]];

describe('flexRowLayout', () => {
  it('detects shrink-wrapped rows (missing width: 100%)', () => {
    expect(resolveFlexRowWidth({ flexDirection: 'row' }, 928)).toBe(-1);
    expect(resolveFlexRowWidth({ flexDirection: 'row', width: '100%' }, 928)).toBe(928);
  });

  it('estimates minimum width for "AI" copy + icon', () => {
    const minWidth = estimateHorizontalCtaMinWidth({
      label: 'AI',
      iconWidth: 16,
      paddingHorizontal: 16,
    });
    expect(minWidth).toBeGreaterThan(50);
  });

  it('shrink-wrapped row width equals sum of label min widths (three CTAs)', () => {
    const mins = THREE_CTAS.map((cta) =>
      estimateHorizontalCtaMinWidth({
        label: cta.label,
        iconWidth: cta.iconWidth,
        paddingHorizontal: 16,
      })
    );
    const expected =
      mins.reduce((sum, width) => sum + width, 0) + 12 * (mins.length - 1);
    expect(estimateShrinkWrappedRowWidth(mins, 12)).toBe(expected);
  });

  it('flags overlapping frames when row width is too narrow', () => {
    const childStyles = [{ flex: 1 }, { flex: 1 }];
    const narrowRow = 180;
    const frames = layoutFlexRow(narrowRow, 12, childStyles);
    const [left, right] = frames;

    expect(left.width).toBeLessThan(100);
    expect(right.x).toBeGreaterThan(left.x);
    expect(left.x + left.width + 12).toBeLessThanOrEqual(right.x);
  });

  it('passes equal thirds on a full-width iPad three-CTA row', () => {
    const childStyle = { flex: 1, gap: 6, paddingHorizontal: 16 };
    expect(() =>
      assertCtaRowFitsButtonLabels({
        rowStyle: { flexDirection: 'row', width: '100%', gap: 12 },
        childStyles: [childStyle, childStyle, childStyle],
        parentContentWidth: 928,
        ctas: THREE_CTAS,
        minGap: 12,
      })
    ).not.toThrow();
  });

  it('passes a two-button row with a weighted AI pill', () => {
    const childStyle = { flex: 1, gap: 6, paddingHorizontal: 16 };
    expect(() =>
      assertCtaRowFitsButtonLabels({
        rowStyle: { flexDirection: 'row', width: '100%', gap: 12 },
        childStyles: [childStyle, { ...childStyle, flex: 1.2 }],
        parentContentWidth: 928,
        ctas: TWO_CTAS,
        minGap: 12,
      })
    ).not.toThrow();
  });

  it('fails label-fit when row collapses to shrink-wrapped width', () => {
    const childStyle = { flex: 1, gap: 6, paddingHorizontal: 16 };
    expect(() =>
      assertCtaRowFitsButtonLabels({
        rowStyle: { flexDirection: 'row', gap: 12 },
        childStyles: [childStyle, childStyle],
        parentContentWidth: 928,
        ctas: TWO_CTAS,
      })
    ).toThrow();
  });

  it('documents that shrink-wrap clips labels without width:100%', () => {
    const childStyle = { flex: 1, gap: 6, paddingHorizontal: 16 };
    expect(
      shrinkWrappedRowClipsLabels({
        rowStyle: { flexDirection: 'row', gap: 12 },
        childStyles: [childStyle, { ...childStyle, flex: 1.2 }],
        parentContentWidth: 928,
        ctas: TWO_CTAS,
      })
    ).toBe(true);
  });
});
