/**
 * The distribution bar's data, asserted as data.
 *
 * `budgetSlices` IS the chart: the segment widths, their order, and which
 * categories get a segment at all come out of it, and a chart is otherwise only
 * assertable by rendering pixels. The two things that actually go wrong here are
 * both arithmetic — double-counting the contingency, and losing a category
 * whose lines happen to sum to the same figure as another's — so they are worth
 * a suite even though the component is small.
 */
import type { HomeProjectBudgetLine } from '@api/home-projects';

import { budgetSlices } from '../BudgetVisuals';

function line(
  category: string,
  estimate_cents: number,
  actual_cents = 0,
  label = category
): HomeProjectBudgetLine {
  return {
    id: `hpbl_${category}_${estimate_cents}`,
    project_id: 'hpj_1',
    category,
    label,
    estimate_cents,
    actual_cents,
    selection_id: null,
    version: 1,
  };
}

describe('budgetSlices', () => {
  it('folds every line of a category into one slice', () => {
    const slices = budgetSlices(
      [line('materials', 500_000, 0, 'Tile'), line('materials', 120_000, 40_000, 'Vanity')],
      0
    );
    expect(slices).toEqual([
      { category: 'materials', label: 'Materials', estimateCents: 620_000, actualCents: 40_000 },
    ]);
  });

  /**
   * The one arithmetic trap in the whole component. `computeRollups` sums only
   * the NON-contingency lines and then adds `contingency_cents` — which is a
   * percentage of that subtotal unless an explicit `contingency` line exists.
   * Taking the buffer from the lines instead would miss it in the usual case (no
   * line, a rate) and double it in the other (a line, which the rollup already
   * turned into `contingency_cents`).
   */
  it('takes the contingency from the rollup, never from the lines', () => {
    const withRate = budgetSlices([line('labor', 400_000)], 60_000);
    expect(withRate.map((s) => [s.category, s.estimateCents])).toEqual([
      ['labor', 400_000],
      ['contingency', 60_000],
    ]);
    // Sums to the rollup's own `estimate_total`, which is the whole claim the
    // picture makes: subtotal + buffer, counted once.
    expect(withRate.reduce((sum, s) => sum + s.estimateCents, 0)).toBe(460_000);

    // An explicit line reaches the component too, and must not be added twice.
    const withLine = budgetSlices([line('labor', 400_000), line('contingency', 60_000)], 60_000);
    expect(withLine).toEqual(withRate);
  });

  it('omits the contingency entirely when there is none', () => {
    const slices = budgetSlices([line('labor', 400_000)], 0);
    expect(slices.map((s) => s.category)).toEqual(['labor']);
  });

  /**
   * Fixed order, so the colour a slice draws follows the CATEGORY rather than the
   * slice's position. Materials must stay the same hue on a project with no
   * labour line as on one that has three — deleting a line otherwise repaints
   * every survivor.
   */
  it('returns the categories in a fixed order, whatever order the lines arrive in', () => {
    const slices = budgetSlices(
      [line('other', 1_000), line('permits', 2_000), line('materials', 3_000), line('labor', 4_000)],
      500
    );
    expect(slices.map((s) => s.category)).toEqual([
      'materials',
      'labor',
      'permits',
      'other',
      'contingency',
    ]);
  });

  it('drops a category nobody has priced, so the bar has no zero-width segments', () => {
    const slices = budgetSlices([line('materials', 100_000), line('permits', 0)], 0);
    expect(slices.map((s) => s.category)).toEqual(['materials']);
  });

  /**
   * The category column is free text on both backends even though the route's
   * `z.enum` is closed today, so an unrecognised value keeps its own row rather
   * than being silently dropped out of a total the member is reading.
   */
  it('keeps a category outside the known five', () => {
    const slices = budgetSlices([line('materials', 100_000), line('disposal', 25_000)], 0);
    expect(slices.map((s) => [s.category, s.label])).toEqual([
      ['materials', 'Materials'],
      ['disposal', 'disposal'],
    ]);
  });

  it('has nothing to draw for a project nobody has priced', () => {
    expect(budgetSlices([], 0)).toEqual([]);
  });
});
