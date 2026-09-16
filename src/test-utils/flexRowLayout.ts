import { StyleSheet, type ViewStyle } from 'react-native';

import type { BudgetCtaSpec } from '../screens/budget/budgetCtaLayout';

export type Rect = { x: number; y: number; width: number; height: number };

/** Flatten a style prop that may be an array or object. */
export function flattenStyle(style: unknown): ViewStyle {
  return StyleSheet.flatten(style as object) ?? {};
}

/**
 * Content width available to BudgetSpendingsView inside BudgetScreen's
 * ScrollView → AdaptiveContainer chain (mirrors BudgetScreen + AdaptiveContainer).
 */
export function budgetSpendingsContentWidth(screenWidth: number, isTablet: boolean): number {
  const scrollPadding = 16 * 2;
  const maxContainer = isTablet ? 960 : screenWidth;
  const containerPadding = isTablet ? 16 * 2 : 8 * 2;
  const outer = Math.min(screenWidth - scrollPadding, maxContainer);
  return outer - containerPadding;
}

/**
 * Resolve a flex-row's width when its parent has a known content width.
 * Returns -1 when the row would shrink-wrap (the Budget CTA overlap bug).
 */
export function resolveFlexRowWidth(rowStyle: ViewStyle, parentContentWidth: number): number {
  if (rowStyle.width === '100%' || rowStyle.alignSelf === 'stretch') {
    return parentContentWidth;
  }
  if (typeof rowStyle.width === 'number') {
    return rowStyle.width;
  }
  return -1;
}

/** Minimum width so icon + label are not clipped inside a CTA pill (pt). */
export function estimateHorizontalCtaMinWidth(params: {
  label: string;
  iconWidth?: number;
  gap?: number;
  paddingHorizontal?: number;
  /** Approximate width per character for body/semibold on iOS. */
  charWidth?: number;
}): number {
  const {
    label,
    iconWidth = 0,
    gap = 6,
    paddingHorizontal = 16,
    charWidth = 9,
  } = params;
  const textWidth = label.length * charWidth;
  const iconBlock = iconWidth > 0 ? iconWidth + gap : 0;
  return paddingHorizontal * 2 + iconBlock + textWidth;
}

/** Width when a flex row shrink-wraps to the sum of its children's min widths. */
export function estimateShrinkWrappedRowWidth(childMinWidths: number[], gap: number): number {
  if (childMinWidths.length === 0) return 0;
  return childMinWidths.reduce((sum, width) => sum + width, 0) + gap * (childMinWidths.length - 1);
}

/** Lay out flex children in a horizontal row (equal flex distribution). */
export function layoutFlexRow(rowWidth: number, gap: number, childStyles: ViewStyle[]): Rect[] {
  const count = childStyles.length;
  const totalGap = gap * Math.max(0, count - 1);
  const flexSum = childStyles.reduce((sum, style) => sum + (style.flex ?? 0), 0);

  if (flexSum <= 0 || rowWidth <= 0) {
    return [];
  }

  const available = rowWidth - totalGap;
  let x = 0;

  return childStyles.map((style) => {
    const flex = style.flex ?? 0;
    const width = (available * flex) / flexSum;
    const frame: Rect = { x, y: 0, width, height: Number(style.minHeight ?? 48) };
    x += width + gap;
    return frame;
  });
}

export function rectsOverlapHorizontally(a: Rect, b: Rect, minGap = 0): boolean {
  return a.x + a.width + minGap > b.x && b.x + b.width + minGap > a.x;
}

/** Assert every pair of sibling frames is separated by at least minGap. */
export function assertFlexRowSiblingsDoNotOverlap(frames: Rect[], minGap = 0): void {
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      if (rectsOverlapHorizontally(frames[i], frames[j], minGap)) {
        throw new Error(
          `Flex row children overlap: [${i}] (${frames[i].x}–${frames[i].x + frames[i].width}) ` +
            `vs [${j}] (${frames[j].x}–${frames[j].x + frames[j].width}), minGap=${minGap}`
        );
      }
    }
  }
}

/**
 * End-to-end layout guard for a flex CTA row:
 * 1. Row expands to the parent content width (not shrink-wrapped).
 * 2. Children share space by flex weight.
 * 3. Laid-out frames do not overlap and respect the row gap.
 */
export function assertEqualFlexRowFillsParent(params: {
  rowStyle: ViewStyle;
  childStyles: ViewStyle[];
  parentContentWidth: number;
  minGap?: number;
  minChildWidth?: number;
}): void {
  const { rowStyle, childStyles, parentContentWidth, minGap = 0, minChildWidth = 80 } = params;
  const gap = Number(rowStyle.gap ?? 0);

  const rowWidth = resolveFlexRowWidth(rowStyle, parentContentWidth);
  expect(rowWidth).toBe(parentContentWidth);

  expect(childStyles.length).toBeGreaterThanOrEqual(2);
  const flexSum = childStyles.reduce((sum, style) => sum + (style.flex ?? 0), 0);
  expect(flexSum).toBeGreaterThan(0);
  for (const childStyle of childStyles) {
    expect(childStyle.flex ?? 0).toBeGreaterThan(0);
  }

  const frames = layoutFlexRow(rowWidth, gap, childStyles);
  expect(frames.length).toBe(childStyles.length);

  assertFlexRowSiblingsDoNotOverlap(frames, minGap);

  for (const frame of frames) {
    expect(frame.width).toBeGreaterThanOrEqual(minChildWidth);
  }

  const available = rowWidth - gap * (childStyles.length - 1);
  frames.forEach((frame, index) => {
    const flex = childStyles[index].flex ?? 0;
    expect(frame.width).toBeCloseTo((available * flex) / flexSum, 0);
  });
}

/**
 * Guard against clipped CTA labels: each flex child must be wide enough for its
 * icon + copy at the resolved row width. Catches narrow pills (~115pt) that
 * still satisfy flex:1 style checks.
 */
export function assertCtaRowFitsButtonLabels(params: {
  rowStyle: ViewStyle;
  childStyles: ViewStyle[];
  parentContentWidth: number;
  ctas: BudgetCtaSpec[];
  minGap?: number;
}): void {
  const { rowStyle, childStyles, parentContentWidth, ctas, minGap = 0 } = params;
  const gap = Number(rowStyle.gap ?? 0);

  expect(childStyles.length).toBe(ctas.length);

  const minWidths = ctas.map((cta, index) => {
    const childStyle = childStyles[index];
    const paddingHorizontal = Number(childStyle.paddingHorizontal ?? 16);
    return estimateHorizontalCtaMinWidth({
      label: cta.label,
      iconWidth: cta.iconWidth,
      gap: Number(childStyle.gap ?? 6),
      paddingHorizontal,
    });
  });

  const rowWidth = resolveFlexRowWidth(rowStyle, parentContentWidth);
  expect(rowWidth).toBe(parentContentWidth);

  const frames = layoutFlexRow(rowWidth, gap, childStyles);
  assertFlexRowSiblingsDoNotOverlap(frames, minGap);

  frames.forEach((frame, index) => {
    expect(frame.width).toBeGreaterThanOrEqual(minWidths[index]);
  });
}

/**
 * Documents the ScrollView shrink-wrap failure mode: row without width:'100%'
 * collapses and labels no longer fit.
 */
export function shrinkWrappedRowClipsLabels(params: {
  rowStyle: ViewStyle;
  childStyles: ViewStyle[];
  parentContentWidth: number;
  ctas: BudgetCtaSpec[];
}): boolean {
  const { rowStyle, childStyles, parentContentWidth, ctas } = params;
  const gap = Number(rowStyle.gap ?? 0);
  const minWidths = ctas.map((cta, index) =>
    estimateHorizontalCtaMinWidth({
      label: cta.label,
      iconWidth: cta.iconWidth,
      gap: Number(childStyles[index]?.gap ?? 6),
      paddingHorizontal: Number(childStyles[index]?.paddingHorizontal ?? 16),
    })
  );
  const collapsedWidth = estimateShrinkWrappedRowWidth(minWidths, gap);
  expect(resolveFlexRowWidth(rowStyle, parentContentWidth)).toBe(-1);

  const frames = layoutFlexRow(collapsedWidth, gap, childStyles);
  return frames.some((frame, index) => frame.width < minWidths[index]);
}
