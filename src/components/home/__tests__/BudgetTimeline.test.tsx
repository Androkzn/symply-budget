/**
 * BudgetTimeline — the home "Budget Forecast" card. Renders per-timeframe cost
 * ranges (min→max), item/critical badges, and a proportional bar chart. Pure
 * presentation, so these tests drive the branchy bits: currency formatting
 * (cents→dollars, and following Settings → Currency), every timeframe color
 * case, the critical badge gate, and the maxBudget===0 bar-width guard.
 */
import React from 'react';
import ReactTestRenderer, { act, type ReactTestRendererJSON } from 'react-test-renderer';

import { DEFAULT_CURRENCY } from '@config/currencies';
import { ThemeProvider } from '@contexts/ThemeContext';
import { useAppStore } from '@stores/appStore';

import { BudgetTimeline } from '../BudgetTimeline';

/**
 * Concatenate every text leaf in render order. Unlike collectRenderedText (which
 * only grabs single-string children), this preserves interpolated Text like
 * `{count} items` and the total range `{min} - {max}` as contiguous strings.
 */
type JsonNode = ReactTestRendererJSON | string | null;
function flattenText(node: JsonNode | JsonNode[]): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(flattenText).join('');
  return flattenText((node.children ?? []) as JsonNode[]);
}

interface Budget {
  timeframe: string;
  label: string;
  minCost: number;
  maxCost: number;
  itemCount: number;
  criticalCount: number;
}

const BUDGETS: Budget[] = [
  { timeframe: '0-30_days', label: 'This month', minCost: 10000, maxCost: 20000, itemCount: 2, criticalCount: 1 },
  { timeframe: '3-6_months', label: 'Soon', minCost: 5000, maxCost: 15000, itemCount: 1, criticalCount: 0 },
  { timeframe: '1_year', label: 'This year', minCost: 20000, maxCost: 40000, itemCount: 3, criticalCount: 0 },
  { timeframe: '2-5_years', label: 'Mid-term', minCost: 0, maxCost: 60000, itemCount: 4, criticalCount: 2 },
  { timeframe: '5-10_years', label: 'Long-term', minCost: 1000, maxCost: 8000, itemCount: 1, criticalCount: 0 },
  { timeframe: 'someday', label: 'Someday', minCost: 0, maxCost: 0, itemCount: 0, criticalCount: 0 },
];

function render(props: React.ComponentProps<typeof BudgetTimeline>) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetTimeline {...props} />
      </ThemeProvider>,
    );
  });
  return tree;
}

describe('BudgetTimeline', () => {
  it('renders the header, total range, per-timeframe rows and disclaimer', () => {
    const joined = flattenText(render({ budgets: BUDGETS }).toJSON());

    expect(joined).toContain('Budget Forecast');
    expect(joined).toContain('Total Estimated Cost');
    expect(joined).toContain('Cost Distribution');
    expect(joined).toMatch(/Estimates are non-binding/);

    // Every timeframe label appears (timeline + bar chart both list them).
    for (const b of BUDGETS) {
      expect(joined).toContain(b.label);
    }

    // Total = sum(min)=36000c ($360) → sum(max)=143000c ($1,430).
    expect(joined).toContain('$360');
    expect(joined).toContain('$1,430');
  });

  it('formats cents into whole-dollar currency and shows item/critical badges', () => {
    const joined = flattenText(render({ budgets: BUDGETS }).toJSON());
    // 20000c → $200 (max of the first row).
    expect(joined).toContain('$200');
    expect(joined).toContain('2 items');
    // Critical badges only render when criticalCount > 0.
    expect(joined).toContain('1 critical');
    expect(joined).toContain('2 critical');
  });

  it('follows the display currency from Settings → Currency', () => {
    // The component no longer takes a currency prop — amounts render in whatever
    // the user picked in Settings. This is the regression the picker used to
    // have: USD and CAD printed the identical "$", so choosing Canadian Dollar
    // looked like nothing had happened.
    act(() => {
      useAppStore.setState({ currency: 'CAD' });
    });
    const tree = render({ budgets: [BUDGETS[0]] });
    expect(flattenText(tree.toJSON())).toContain('CA$100'); // minCost 10000c
    expect(flattenText(tree.toJSON())).toContain('This month');

    // …and a live change re-renders the already-mounted card, rather than
    // leaving stale symbols until the screen happens to re-render for some
    // other reason.
    act(() => {
      useAppStore.setState({ currency: DEFAULT_CURRENCY });
    });
    expect(flattenText(tree.toJSON())).toContain('$100');
    expect(flattenText(tree.toJSON())).not.toContain('CA$100');
  });

  it('guards against a zero max budget (all-zero costs) without dividing by zero', () => {
    const joined = flattenText(
      render({ budgets: [{ timeframe: 'someday', label: 'Someday', minCost: 0, maxCost: 0, itemCount: 0, criticalCount: 0 }] }).toJSON(),
    );
    expect(joined).toContain('Someday');
    expect(joined).toContain('$0');
    expect(joined).toContain('0 items');
  });
});
