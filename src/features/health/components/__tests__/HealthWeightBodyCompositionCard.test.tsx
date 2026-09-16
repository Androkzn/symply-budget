/**
 * Symply Health — `HealthWeightBodyCompositionCard`, the donor's
 * `bodyCompositionCard` (Fat / BMI / BMR tiles + an (i) info panel) restyled
 * to this app's own tokens.
 *
 * Conventions mirror the sibling Weight suite (`HealthWeightWidgets.test.tsx`):
 * react-test-renderer + `act`, testID lookups via a small JSON walker. This
 * repo does not have `@testing-library/react-native` installed, so `render`/
 * `fireEvent` from it are not available here.
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import type { DatedValue } from '../../healthDashboards';
import { weightWindow } from '../../healthWeightAnalytics';
import {
  HealthWeightBodyCompositionCard,
  type HealthWeightBodyCompositionCardProps,
} from '../HealthWeightBodyCompositionCard';

const PREFIX = 'health-weight-bodycomposition';
const TODAY = '2026-07-20';
/** The page-level window this card now always renders against — no card-local selector. */
const WINDOW_30 = weightWindow(TODAY, 30);

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

type Json = { props?: Record<string, unknown>; children?: unknown } | string | number | null;

/** Depth-first search of the RENDERED json for a node carrying `testID`. */
function findJson(json: unknown, testID: string): Json {
  if (json == null || typeof json !== 'object') return null;
  if (Array.isArray(json)) {
    for (const child of json) {
      const hit = findJson(child, testID);
      if (hit) return hit;
    }
    return null;
  }
  const node = json as { props?: Record<string, unknown>; children?: unknown };
  if (node.props?.testID === testID) return node;
  return findJson(node.children, testID);
}

function text(tree: ReactTestRenderer.ReactTestRenderer, testID: string): string {
  const node = findJson(tree.toJSON(), testID);
  if (node === null) throw new Error(`no node with testID "${testID}"`);
  return allText(node);
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return (
    tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID).length > 0
  );
}

/** `accessibilityState.selected` on the first host node carrying this testID. */
function selected(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  const found = tree.root.find((n) => typeof n.type === 'string' && n.props?.testID === testID);
  return found.props.accessibilityState?.selected === true;
}

function pressToggle(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  act(() => node.props.onPress());
}

async function render(props: HealthWeightBodyCompositionCardProps) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthWeightBodyCompositionCard {...props} />
      </ThemeProvider>
    );
  });
  return tree;
}

/** Re-renders the SAME tree with new props — e.g. the page's window changing —
 *  so a card-local toggle's state (Average/Trend) survives, exactly as it
 *  would for a member browsing windows on the real screen. */
async function update(
  tree: ReactTestRenderer.ReactTestRenderer,
  props: HealthWeightBodyCompositionCardProps
) {
  await act(async () => {
    tree.update(
      <ThemeProvider>
        <HealthWeightBodyCompositionCard {...props} />
      </ThemeProvider>
    );
  });
}

const BASE: HealthWeightBodyCompositionCardProps = {
  bodyFatPercent: null,
  bmi: null,
  bmr: null,
  gender: null,
  window: WINDOW_30,
};

describe('empty state', () => {
  it('renders the muted empty line, not a crash, when all three figures are null', async () => {
    const tree = await render(BASE);
    expect(text(tree, `${PREFIX}-empty`)).toMatch(/log a body-fat percentage or your height/i);
    expect(has(tree, `${PREFIX}-tiles`)).toBe(false);
    expect(has(tree, `${PREFIX}-fat`)).toBe(false);
    expect(has(tree, `${PREFIX}-bmi`)).toBe(false);
    expect(has(tree, `${PREFIX}-bmr`)).toBe(false);
  });

  it('still renders the card shell and the info toggle with nothing logged', async () => {
    const tree = await render(BASE);
    expect(has(tree, `${PREFIX}-card`)).toBe(true);
    expect(has(tree, `${PREFIX}-info-toggle`)).toBe(true);
  });
});

describe('populated tiles', () => {
  it('renders all three tiles with the expected formatting', async () => {
    const tree = await render({
      ...BASE,
      bodyFatPercent: 23.6,
      bmi: 27.9,
      bmr: 1840,
      gender: 'female',
    });
    expect(has(tree, `${PREFIX}-empty`)).toBe(false);
    expect(text(tree, `${PREFIX}-fat`)).toContain('23.6%');
    expect(text(tree, `${PREFIX}-bmi`)).toContain('27.9');
    expect(text(tree, `${PREFIX}-bmr`)).toContain('1,840 kcal');
  });

  it('renders only the tiles whose figure is known', async () => {
    const tree = await render({ ...BASE, bodyFatPercent: 18.2, gender: null });
    expect(has(tree, `${PREFIX}-fat`)).toBe(true);
    expect(has(tree, `${PREFIX}-bmi`)).toBe(false);
    expect(has(tree, `${PREFIX}-bmr`)).toBe(false);
    expect(has(tree, `${PREFIX}-empty`)).toBe(false);
  });

  it('rounds BMR to whole kcal', async () => {
    const tree = await render({ ...BASE, bmr: 1839.6 });
    expect(text(tree, `${PREFIX}-bmr`)).toContain('1,840 kcal');
  });
});

describe('BMI category colour path', () => {
  it('labels a normal BMI without crashing', async () => {
    const tree = await render({ ...BASE, bmi: 22 });
    expect(text(tree, `${PREFIX}-bmi`)).toContain('22.0');
    expect(text(tree, `${PREFIX}-bmi`)).toContain('Normal');
  });

  it('labels an overweight BMI without crashing', async () => {
    const tree = await render({ ...BASE, bmi: 27.9 });
    expect(text(tree, `${PREFIX}-bmi`)).toContain('27.9');
    expect(text(tree, `${PREFIX}-bmi`)).toContain('Overweight');
  });

  it('labels an underweight BMI without crashing', async () => {
    const tree = await render({ ...BASE, bmi: 17 });
    expect(text(tree, `${PREFIX}-bmi`)).toContain('Underweight');
  });

  it('labels an obese BMI without crashing', async () => {
    const tree = await render({ ...BASE, bmi: 32 });
    expect(text(tree, `${PREFIX}-bmi`)).toContain('Obese I');
  });
});

describe('info panel toggle', () => {
  it('is hidden until the (i) button is pressed, then hides again on a second press', async () => {
    const tree = await render({ ...BASE, bodyFatPercent: 23, bmi: 27.9, bmr: 1840, gender: 'female' });
    expect(has(tree, `${PREFIX}-info-panel`)).toBe(false);

    pressToggle(tree, `${PREFIX}-info-toggle`);
    expect(has(tree, `${PREFIX}-info-panel`)).toBe(true);
    expect(allText(tree.toJSON())).toMatch(/does not know the difference between muscle and fat/i);
    expect(allText(tree.toJSON())).toMatch(/mifflin.st jeor/i);

    pressToggle(tree, `${PREFIX}-info-toggle`);
    expect(has(tree, `${PREFIX}-info-panel`)).toBe(false);
  });

  it('opens even with nothing logged, so a first-time member can read what would fill the card', async () => {
    const tree = await render(BASE);
    pressToggle(tree, `${PREFIX}-info-toggle`);
    expect(has(tree, `${PREFIX}-info-panel`)).toBe(true);
  });
});

describe('body-fat range table highlight', () => {
  it('highlights the Fitness row for a female member at 23%', async () => {
    const tree = await render({ ...BASE, bodyFatPercent: 23, gender: 'female' });
    pressToggle(tree, `${PREFIX}-info-toggle`);

    expect(has(tree, `${PREFIX}-range-row-fitness-highlighted`)).toBe(true);
    expect(has(tree, `${PREFIX}-range-row-fitness`)).toBe(false);
    expect(has(tree, `${PREFIX}-range-row-average`)).toBe(true);
    expect(has(tree, `${PREFIX}-range-row-average-highlighted`)).toBe(false);
  });

  it('highlights the Average row for a male member at 20%', async () => {
    const tree = await render({ ...BASE, bodyFatPercent: 20, gender: 'male' });
    pressToggle(tree, `${PREFIX}-info-toggle`);

    expect(has(tree, `${PREFIX}-range-row-average-highlighted`)).toBe(true);
    expect(has(tree, `${PREFIX}-range-row-athletes-highlighted`)).toBe(false);
  });

  it('highlights the Obese row using its open-ended upper bound', async () => {
    const tree = await render({ ...BASE, bodyFatPercent: 40, gender: 'female' });
    pressToggle(tree, `${PREFIX}-info-toggle`);

    expect(has(tree, `${PREFIX}-range-row-obese-highlighted`)).toBe(true);
    expect(text(tree, `${PREFIX}-range-row-obese-highlighted`)).toContain('32%+');
  });

  it('highlights nothing when gender is "other"', async () => {
    const tree = await render({ ...BASE, bodyFatPercent: 23, gender: 'other' });
    pressToggle(tree, `${PREFIX}-info-toggle`);

    for (const key of ['essential', 'athletes', 'fitness', 'average', 'obese']) {
      expect(has(tree, `${PREFIX}-range-row-${key}-highlighted`)).toBe(false);
    }
  });

  it('highlights nothing when gender is known but no body-fat % has been logged', async () => {
    const tree = await render({ ...BASE, bodyFatPercent: null, gender: 'female' });
    pressToggle(tree, `${PREFIX}-info-toggle`);

    for (const key of ['essential', 'athletes', 'fitness', 'average', 'obese']) {
      expect(has(tree, `${PREFIX}-range-row-${key}-highlighted`)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/* BMI trend                                                           */
/* ------------------------------------------------------------------ */

function point(date: string, value: number): DatedValue {
  return { date, value };
}

// Oldest first, spanning back past every page window width (7/30/90/365)
// so passing a different `window` prop genuinely changes which points are in play.
const BMI_HISTORY: DatedValue[] = [
  point('2026-04-01', 24.0),
  point('2026-05-01', 25.0),
  point('2026-06-25', 26.0),
  point('2026-07-10', 27.0),
  point(TODAY, 28.0),
];

const WINDOW_7 = weightWindow(TODAY, 7);
const WINDOW_90 = weightWindow(TODAY, 90);
const WINDOW_365 = weightWindow(TODAY, 365);

describe('BMI trend', () => {
  it('stays off the card entirely when there is no BMI history yet', async () => {
    const tree = await render({ ...BASE, bmi: 22, bmiHistory: [], window: WINDOW_30 });
    expect(has(tree, `${PREFIX}-bmi-trend`)).toBe(false);
  });

  it('shows the as-of date once history exists, even with one point, and carries no card-local range control', async () => {
    const tree = await render({
      ...BASE,
      bmi: 28,
      bmiHistory: [point(TODAY, 28.0)],
      window: WINDOW_30,
    });
    expect(has(tree, `${PREFIX}-bmi-trend`)).toBe(true);
    expect(text(tree, `${PREFIX}-bmi-asof`)).toContain('20 Jul');
    // The card has exactly one period control on the whole page — the screen's
    // own window navigator — so no `-bmi-trend-range-*` pills exist here at all.
    for (const days of [7, 30, 90, 365]) {
      expect(has(tree, `${PREFIX}-bmi-trend-range-${days}`)).toBe(false);
    }
    // One point in range is not a trend line — it says so instead of drawing one.
    expect(has(tree, `${PREFIX}-bmi-trend-chart`)).toBe(false);
    expect(text(tree, `${PREFIX}-bmi-trend-empty`)).toMatch(/at least two days/i);
  });

  it('filters to the given 30-day window and reports Latest/Average/Change over just that span', async () => {
    const tree = await render({ ...BASE, bmi: 28, bmiHistory: BMI_HISTORY, window: WINDOW_30 });
    // The "30 days" window is a real calendar month (`weightWindow`), so it
    // keeps 10 Jul and 20 Jul (27/28) but not 25 Jun, 1 May, or 1 Apr.
    expect(has(tree, `${PREFIX}-bmi-trend-chart`)).toBe(true);
    expect(text(tree, `${PREFIX}-bmi-trend-latest`)).toContain('28.0');
    expect(text(tree, `${PREFIX}-bmi-trend-average`)).toContain('27.5');
    expect(text(tree, `${PREFIX}-bmi-trend-change`)).toContain('+1.0');
  });

  it('a 7-day window can drop below a trend line, and 90/365-day windows widen it — driven entirely by the window prop', async () => {
    const tree = await render({ ...BASE, bmi: 28, bmiHistory: BMI_HISTORY, window: WINDOW_30 });

    // Only 20 Jul itself falls inside the trailing 7 days — one point, no line.
    await update(tree, { ...BASE, bmi: 28, bmiHistory: BMI_HISTORY, window: WINDOW_7 });
    expect(has(tree, `${PREFIX}-bmi-trend-chart`)).toBe(false);
    expect(has(tree, `${PREFIX}-bmi-trend-empty`)).toBe(true);

    // 90 days back reaches 1 May (25.0) but not 1 Apr (24.0).
    await update(tree, { ...BASE, bmi: 28, bmiHistory: BMI_HISTORY, window: WINDOW_90 });
    expect(has(tree, `${PREFIX}-bmi-trend-chart`)).toBe(true);
    expect(text(tree, `${PREFIX}-bmi-trend-latest`)).toContain('28.0');
    expect(text(tree, `${PREFIX}-bmi-trend-average`)).toContain('26.5');
    expect(text(tree, `${PREFIX}-bmi-trend-change`)).toContain('+3.0');

    // 365 days reaches every point in the fixture, including 1 Apr.
    await update(tree, { ...BASE, bmi: 28, bmiHistory: BMI_HISTORY, window: WINDOW_365 });
    expect(text(tree, `${PREFIX}-bmi-trend-average`)).toContain('26.0');
    expect(text(tree, `${PREFIX}-bmi-trend-change`)).toContain('+4.0');
  });

  it('the as-of date always reads the MOST RECENT point in the full history, regardless of the selected window', async () => {
    const tree = await render({ ...BASE, bmi: 28, bmiHistory: BMI_HISTORY, window: WINDOW_7 });
    expect(text(tree, `${PREFIX}-bmi-asof`)).toContain('20 Jul');
  });
});

/* ------------------------------------------------------------------ */
/* Average + Trend overlays — off by default, tap to draw              */
/* ------------------------------------------------------------------ */

/** The AppLineChart → gifted-charts LineChart instance, whichever props it was called with. */
function lineChartProps(tree: ReactTestRenderer.ReactTestRenderer): Record<string, unknown> {
  const found = tree.root.find(
    (n) => !!n.props && Object.prototype.hasOwnProperty.call(n.props, 'yAxisOffset')
  );
  return found.props as Record<string, unknown>;
}

describe('BMI trend — Average and Trend overlays', () => {
  it('both toggles start off — no reference line, no second series', async () => {
    const tree = await render({ ...BASE, bmi: 28, bmiHistory: BMI_HISTORY, window: WINDOW_30 });
    expect(selected(tree, `${PREFIX}-bmi-trend-toggle-average`)).toBe(false);
    const props = lineChartProps(tree);
    expect(props.showReferenceLine1).toBeUndefined();
    expect(props.data2).toBeUndefined();
    expect(has(tree, `${PREFIX}-bmi-trend-legend`)).toBe(false);
  });

  it('tapping Average draws a reference line at the window average and stays until tapped again', async () => {
    const tree = await render({ ...BASE, bmi: 28, bmiHistory: BMI_HISTORY, window: WINDOW_30 });
    pressToggle(tree, `${PREFIX}-bmi-trend-toggle-average`);

    expect(selected(tree, `${PREFIX}-bmi-trend-toggle-average`)).toBe(true);
    let props = lineChartProps(tree);
    expect(props.showReferenceLine1).toBe(true);
    expect(props.referenceLine1Position).toBe(27.5); // 30-day (calendar-month) window average

    pressToggle(tree, `${PREFIX}-bmi-trend-toggle-average`);
    props = lineChartProps(tree);
    expect(props.showReferenceLine1).toBeUndefined();
  });

  it('the Trend chip is disabled (need 5+) until the window has enough points to fit', async () => {
    const tree = await render({ ...BASE, bmi: 28, bmiHistory: BMI_HISTORY, window: WINDOW_30 });
    // 30-day window carries 3 points — below MIN_PROJECTION_SAMPLES.
    expect(text(tree, `${PREFIX}-bmi-trend-toggle-trend`)).toMatch(/need 5\+/i);
    const pressable = tree.root.findAll(
      (n) =>
        n.props?.testID === `${PREFIX}-bmi-trend-toggle-trend` &&
        typeof n.props?.onPress === 'function'
    );
    expect(pressable.length).toBe(0);
  });

  it('tapping Trend on a wide-enough window draws a second, fitted line and a two-key legend', async () => {
    const tree = await render({ ...BASE, bmi: 28, bmiHistory: BMI_HISTORY, window: WINDOW_30 });
    // 365 days reaches all 5 fixture points — exactly MIN_PROJECTION_SAMPLES.
    await update(tree, { ...BASE, bmi: 28, bmiHistory: BMI_HISTORY, window: WINDOW_365 });
    expect(text(tree, `${PREFIX}-bmi-trend-toggle-trend`)).toBe('Trend');

    pressToggle(tree, `${PREFIX}-bmi-trend-toggle-trend`);
    expect(selected(tree, `${PREFIX}-bmi-trend-toggle-trend`)).toBe(true);

    const props = lineChartProps(tree);
    expect(Array.isArray(props.data2)).toBe(true);
    expect((props.data2 as unknown[]).length).toBe(5);

    expect(has(tree, `${PREFIX}-bmi-trend-legend`)).toBe(true);
    const legend = allText(tree.toJSON());
    expect(legend).toContain('BMI');
    expect(legend).toContain('Trend');
  });

  it('the page window narrowing back down turns the Trend chip back off and drops the second line', async () => {
    const tree = await render({ ...BASE, bmi: 28, bmiHistory: BMI_HISTORY, window: WINDOW_365 });
    pressToggle(tree, `${PREFIX}-bmi-trend-toggle-trend`);
    expect(lineChartProps(tree).data2).toBeDefined();

    // Back to a 30-day window — only 3 points, below the fit threshold again.
    await update(tree, { ...BASE, bmi: 28, bmiHistory: BMI_HISTORY, window: WINDOW_30 });
    expect(text(tree, `${PREFIX}-bmi-trend-toggle-trend`)).toMatch(/need 5\+/i);
    expect(lineChartProps(tree).data2).toBeUndefined();
  });
});
