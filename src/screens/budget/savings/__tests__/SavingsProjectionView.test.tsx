/**
 * SavingsProjectionView — the Savings → Projection tab.
 *
 * The view is a pure render of the BE-computed `SavingsProjection`: every money
 * figure (pace, potential, year-end) arrives already computed, so these tests
 * assert WIRING and PRESENTATION, not math:
 *  - it fetches the selected household + year, and refetches on a data bump;
 *  - actual months render solid, planned months render as a ghost of the same
 *    hue (the "banked vs planned" read of the chart, with no legend needed);
 *  - EVERY month is editable, including elapsed ones — a past target never
 *    changes that month's real figure, it only becomes something to grade;
 *  - the single-month editor writes ONE month while "apply to all" writes every
 *    month from that one through December, forward OR backward-anchored;
 *  - a graded month (elapsed/current + a target) colors green/amber/red by how
 *    much of the goal it hit, and the year rolls up into a goal-performance line;
 *  - the motivational copy is grounded in the household's own best month, and
 *    degrades sanely for a fresh household and a closed year.
 */

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
  };
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockGetProjection = jest.fn();
const mockSetTargets = jest.fn();
const mockSetDefaultMethod = jest.fn();

jest.mock('@api/savings', () => ({
  PROJECTION_METHODS: ['historical_average', 'trend', 'planned_budget', 'hybrid'],
  savingsApi: {
    getProjection: (...args: unknown[]) => mockGetProjection(...args),
    setProjectionTargets: (...args: unknown[]) => mockSetTargets(...args),
    setDefaultProjectionMethod: (...args: unknown[]) => mockSetDefaultMethod(...args),
  },
}));

type BarDatum = { value: number; label: string; frontColor: string };
let mockLastBarData: BarDatum[] | null = null;
jest.mock('react-native-gifted-charts', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    BarChart: (props: { data?: BarDatum[] }) => {
      mockLastBarData = props.data ?? null;
      return React.createElement(View, { testID: 'bar-chart' });
    },
  };
});

const mockMarkDirty = jest.fn();
let mockDataRevision = 0;
let mockSelectedYear = 2026;

jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      selectedYear: mockSelectedYear,
      selectedMonth: 7,
      dataRevision: mockDataRevision,
      markDirty: mockMarkDirty,
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = { dataRevision: 0 };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-test' }, currentHouseholdMembers: [] };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { SavingsGoalPerformance, SavingsProjection, SavingsProjectionMonth } from '@api/savings';
import { ThemeProvider } from '@contexts/ThemeContext';

import {
  SavingsProjectionView,
  projectionBarColor,
  projectionHeadline,
  monthRowMeta,
  monthGoalTone,
  goalPerformanceSummary,
  goalProgressSummary,
} from '../SavingsProjectionView';

const NO_GOAL_PERFORMANCE: SavingsGoalPerformance = {
  monthsTracked: 0,
  monthsHit: 0,
  hitRatePct: null,
  avgAttainmentPct: null,
};

/**
 * 2026 as of mid-July: Jan–Jun completed, Jul live, Aug–Dec ahead.
 * Jan–Jun net $2,000 each except a $7,000 best month in March. No month
 * carries a target by default — individual tests layer one on.
 */
function projectionFixture(overrides: Partial<SavingsProjection> = {}): SavingsProjection {
  const months: SavingsProjectionMonth[] = [];
  for (let m = 1; m <= 12; m++) {
    if (m < 7) {
      const net = m === 3 ? 700000 : 200000;
      months.push({
        month: m,
        status: 'actual',
        actualNet: net,
        targetCents: null,
        projectedNet: net,
        projectionSource: null,
        hasData: true,
        oneOffIncome: 0,
        goalDeltaCents: null,
        goalAttainmentPct: null,
        goalHit: null,
        plannedBudget: null,
      });
    } else if (m === 7) {
      months.push({
        month: 7,
        status: 'current',
        actualNet: 100000,
        targetCents: null,
        projectedNet: 100000,
        projectionSource: null,
        hasData: true,
        oneOffIncome: 0,
        goalDeltaCents: null,
        goalAttainmentPct: null,
        goalHit: null,
        plannedBudget: null,
      });
    } else {
      months.push({
        month: m,
        status: 'future',
        actualNet: null,
        targetCents: null,
        projectedNet: 283333,
        projectionSource: 'pace',
        hasData: false,
        oneOffIncome: 0,
        goalDeltaCents: null,
        goalAttainmentPct: null,
        goalHit: null,
        plannedBudget: null,
      });
    }
  }
  return {
    year: 2026,
    currentMonth: 7,
    months,
    actualToDate: 1700000, // $17,000 banked (Jan–Jun $16,000 + Jul $1,000)
    targetedRemaining: 0,
    monthsRemaining: 5,
    monthsWithTarget: 0,
    projectedYearEnd: 3116665,
    paceMonthly: 283333, // avg of the six completed months
    paceYearEnd: 3116665,
    bestMonth: { month: 3, net: 700000 },
    potentialMonthly: 700000,
    potentialYearEnd: 5200000,
    excludesOneOffIncome: false,
    yearGoal: 6000000,
    monthlyGoal: 250000,
    goalPerformance: NO_GOAL_PERFORMANCE,
    method: 'hybrid',
    methodComparison: [
      { method: 'historical_average', projectedYearEnd: 3116665 },
      { method: 'trend', projectedYearEnd: 3116665 },
      { method: 'planned_budget', projectedYearEnd: 3116665 },
      { method: 'hybrid', projectedYearEnd: 3116665 },
    ],
    ...overrides,
  };
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsProjectionView />
      </ThemeProvider>
    );
  });
  return tree;
}

function byId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAllByProps({ testID: id })[0];
}

/** Flattened text of the node carrying `testID` (children may be an interpolated array). */
function textOf(tree: ReactTestRenderer.ReactTestRenderer, id: string): string {
  const node = tree.root.findAll((n) => n.props?.testID === id && n.props?.children != null)[0];
  const children = node?.props.children;
  if (typeof children === 'string') return children;
  return Array.isArray(children) ? children.filter((c) => typeof c === 'string').join('') : '';
}

async function press(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  await act(async () => {
    byId(tree, id).props.onPress();
  });
}

describe('SavingsProjectionView — fetching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDataRevision = 0;
    mockSelectedYear = 2026;
    mockLastBarData = null;
    mockGetProjection.mockResolvedValue(projectionFixture());
    mockSetTargets.mockImplementation(async () => projectionFixture());
  });

  it('fetches the projection for the selected household and year', async () => {
    await renderScreen();
    expect(mockGetProjection).toHaveBeenCalledWith('hh-test', 2026, undefined);
  });

  it('refetches when the header year-nav steps to a different year, even with no prior mutation', async () => {
    // Regression: a guard meant to skip the double-fetch on initial mount used
    // to also swallow every later year change until `dataRevision` first bumped
    // — so a household that never edited anything just paged through stale data.
    const tree = await renderScreen();
    expect(mockGetProjection).toHaveBeenCalledTimes(1);

    mockSelectedYear = 2025;
    mockGetProjection.mockResolvedValueOnce(projectionFixture({ year: 2025 }));
    await act(async () => {
      tree.update(
        <ThemeProvider>
          <SavingsProjectionView />
        </ThemeProvider>
      );
    });

    expect(mockGetProjection).toHaveBeenCalledTimes(2);
    expect(mockGetProjection).toHaveBeenLastCalledWith('hh-test', 2025, undefined);
  });

  it('renders the empty state when the projection cannot be loaded', async () => {
    mockGetProjection.mockRejectedValue(new Error('offline'));
    const tree = await renderScreen();
    expect(byId(tree, 'savings-projection-empty')).toBeTruthy();
  });
});

describe('SavingsProjectionView — method selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDataRevision = 0;
    mockSelectedYear = 2026;
    mockLastBarData = null;
    // The default (no explicit method) resolves to 'hybrid' — the household's
    // stored default — same as the backend's own absent-row fallback.
    mockGetProjection.mockResolvedValue(projectionFixture({ method: 'hybrid' }));
  });

  it('shows all 4 methods, each with its own year-end figure and an info button', async () => {
    const tree = await renderScreen();
    for (const method of ['historical_average', 'trend', 'planned_budget', 'hybrid']) {
      expect(byId(tree, `savings-projection-method-${method}`)).toBeTruthy();
      expect(byId(tree, `savings-projection-method-info-${method}-toggle`)).toBeTruthy();
    }
  });

  it('marks the household default with a badge and hides "set as default" for it', async () => {
    const tree = await renderScreen();
    expect(byId(tree, 'savings-projection-default-badge')).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'savings-projection-set-default' })).toHaveLength(0);
  });

  it('tapping a different method card refetches the projection under that method', async () => {
    const tree = await renderScreen();
    mockGetProjection.mockResolvedValueOnce(
      projectionFixture({ method: 'trend', projectedYearEnd: 4_000_000 })
    );

    await press(tree, 'savings-projection-method-trend');

    expect(mockGetProjection).toHaveBeenLastCalledWith('hh-test', 2026, 'trend');
    expect(textOf(tree, 'savings-projection-year-end')).toContain('40,000');
  });

  it('offers "set as default" once viewing a method that is not the household default, and it persists', async () => {
    const tree = await renderScreen();
    mockGetProjection.mockResolvedValueOnce(projectionFixture({ method: 'trend' }));
    await press(tree, 'savings-projection-method-trend');

    expect(byId(tree, 'savings-projection-set-default')).toBeTruthy();

    mockSetDefaultMethod.mockResolvedValueOnce(projectionFixture({ method: 'trend' }));
    await press(tree, 'savings-projection-set-default');

    expect(mockSetDefaultMethod).toHaveBeenCalledWith('hh-test', 2026, 'trend');
    // Now the household default IS trend — the button goes away, the badge moves.
    expect(tree.root.findAllByProps({ testID: 'savings-projection-set-default' })).toHaveLength(0);
  });
});

describe('SavingsProjectionView — presentation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDataRevision = 0;
    mockSelectedYear = 2026;
    mockLastBarData = null;
    mockGetProjection.mockResolvedValue(projectionFixture());
    mockSetTargets.mockImplementation(async () => projectionFixture());
  });

  it('renders the BE year-end figure verbatim (no client-side math)', async () => {
    const tree = await renderScreen();
    // $31,166.65 → the shared budget formatter rounds to whole dollars.
    expect(textOf(tree, 'savings-projection-year-end')).toContain('31,167');
  });

  it('charts all 12 months, ghosting the ones that have not happened yet', async () => {
    await renderScreen();

    expect(mockLastBarData).toHaveLength(12);
    expect(mockLastBarData!.map((d) => d.label)).toEqual([
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ]);
    // Actual months carry a solid hex; planned months the same hue at ~35%.
    const jan = mockLastBarData![0].frontColor;
    const aug = mockLastBarData![7].frontColor;
    expect(jan).not.toMatch(/59$/);
    expect(aug).toBe(`${jan}59`);
    // Future bars plot their projection, actuals plot the real net.
    expect(mockLastBarData![0].value).toBe(2000);
    expect(mockLastBarData![7].value).toBeCloseTo(2833.33, 2);
  });

  it('makes every month editable, elapsed ones included', async () => {
    const tree = await renderScreen();

    // Jun is done, Jul is live, Dec is ahead — all three still open an editor.
    expect(byId(tree, 'savings-projection-edit-6')).toBeTruthy();
    expect(byId(tree, 'savings-projection-edit-7')).toBeTruthy();
    expect(byId(tree, 'savings-projection-edit-12')).toBeTruthy();
  });

  it('hides the goal-performance card until at least one month is graded', async () => {
    const tree = await renderScreen();
    expect(
      tree.root.findAllByProps({ testID: 'savings-projection-goal-performance-title' })
    ).toHaveLength(0);
  });

  it('shows a year-wide goal-performance line once months are graded', async () => {
    mockGetProjection.mockResolvedValue(
      projectionFixture({
        goalPerformance: { monthsTracked: 4, monthsHit: 3, hitRatePct: 75, avgAttainmentPct: 108 },
      })
    );
    const tree = await renderScreen();
    const line = textOf(tree, 'savings-projection-goal-performance');
    expect(line).toContain('3 of 4');
    expect(line).toContain('75%');
    expect(line).toContain('108%');
  });

  it('shows the amount banked and the gap to the year goal alongside the hit rate', async () => {
    mockGetProjection.mockResolvedValue(
      projectionFixture({
        actualToDate: 1700000,
        yearGoal: 6000000,
        goalPerformance: { monthsTracked: 4, monthsHit: 3, hitRatePct: 75, avgAttainmentPct: 108 },
      })
    );
    const tree = await renderScreen();
    const amountLine = textOf(tree, 'savings-projection-goal-performance-amount');
    expect(amountLine).toContain('$17,000');
    expect(amountLine).toContain('$43,000 to go');
    expect(byId(tree, 'savings-projection-goal-performance-progress')).toBeTruthy();
  });

  it('omits the amount-banked line when no year goal is set, keeping only the hit rate', async () => {
    mockGetProjection.mockResolvedValue(
      projectionFixture({
        yearGoal: null,
        goalPerformance: { monthsTracked: 4, monthsHit: 3, hitRatePct: 75, avgAttainmentPct: 108 },
      })
    );
    const tree = await renderScreen();
    expect(
      tree.root.findAllByProps({ testID: 'savings-projection-goal-performance-amount' })
    ).toHaveLength(0);
  });

  it('nudges toward setting goals when none are set for the months ahead', async () => {
    mockGetProjection.mockResolvedValue(projectionFixture({ monthlyGoal: null }));
    const tree = await renderScreen();
    expect(textOf(tree, 'savings-projection-no-goals-hint')).toContain('recent pace');
  });

  it('points the nudge at the household goal once one exists', async () => {
    mockGetProjection.mockResolvedValue(projectionFixture({ monthlyGoal: 250000 }));
    const tree = await renderScreen();
    expect(textOf(tree, 'savings-projection-no-goals-hint')).toContain('2,500');
  });

  it('hides the nudge once the household has set at least one goal', async () => {
    mockGetProjection.mockResolvedValue(projectionFixture({ monthsWithTarget: 1 }));
    const tree = await renderScreen();
    expect(
      tree.root.findAllByProps({ testID: 'savings-projection-no-goals-hint' })
    ).toHaveLength(0);
  });
});

describe('SavingsProjectionView — setting goals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDataRevision = 0;
    mockSelectedYear = 2026;
    mockGetProjection.mockResolvedValue(projectionFixture());
    mockSetTargets.mockImplementation(async () => projectionFixture());
  });

  it('writes a single month from the per-month editor', async () => {
    const tree = await renderScreen();
    await press(tree, 'savings-projection-edit-9');

    await act(async () => {
      byId(tree, 'projection-target-amount').props.onChangeText('1500');
    });
    await press(tree, 'projection-target-save');

    expect(mockSetTargets).toHaveBeenCalledWith('hh-test', {
      year: 2026,
      months: [9],
      targetCents: 150000,
    });
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('writes every month from the edited one to December when "apply to all" is on', async () => {
    const tree = await renderScreen();
    await press(tree, 'savings-projection-edit-9');

    await act(async () => {
      byId(tree, 'projection-target-amount').props.onChangeText('1000');
      byId(tree, 'projection-target-apply-all').props.onValueChange(true);
    });
    await press(tree, 'projection-target-save');

    expect(mockSetTargets).toHaveBeenCalledWith('hh-test', {
      year: 2026,
      months: [9, 10, 11, 12],
      targetCents: 100000,
    });
  });

  it('"Plan the year" opens the editor on January with bulk pre-armed for all 12 months', async () => {
    const tree = await renderScreen();
    await press(tree, 'savings-projection-plan-year');

    await act(async () => {
      byId(tree, 'projection-target-amount').props.onChangeText('2000');
    });
    await press(tree, 'projection-target-save');

    // The whole year, elapsed months included — "Plan the year" really means it.
    expect(mockSetTargets).toHaveBeenCalledWith('hh-test', {
      year: 2026,
      months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      targetCents: 200000,
    });
  });

  it('writes a goal on an elapsed month — it grades the month, it does not change it', async () => {
    const tree = await renderScreen();
    await press(tree, 'savings-projection-edit-3'); // March: already happened

    await act(async () => {
      byId(tree, 'projection-target-amount').props.onChangeText('5000');
    });
    await press(tree, 'projection-target-save');

    expect(mockSetTargets).toHaveBeenCalledWith('hh-test', {
      year: 2026,
      months: [3],
      targetCents: 500000,
    });
  });

  it('"apply to all" from an elapsed month reaches backward through the months it is anchored on', async () => {
    const tree = await renderScreen();
    await press(tree, 'savings-projection-edit-3'); // March

    await act(async () => {
      byId(tree, 'projection-target-amount').props.onChangeText('1800');
      byId(tree, 'projection-target-apply-all').props.onValueChange(true);
    });
    await press(tree, 'projection-target-save');

    // March through December — including the elapsed Mar–Jun months.
    expect(mockSetTargets).toHaveBeenCalledWith('hh-test', {
      year: 2026,
      months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      targetCents: 180000,
    });
  });

  it('clears a goal rather than writing a zero', async () => {
    const withTarget = projectionFixture();
    withTarget.months[8] = { ...withTarget.months[8], targetCents: 300000 };
    mockGetProjection.mockResolvedValue(withTarget);

    const tree = await renderScreen();
    await press(tree, 'savings-projection-edit-9');
    await press(tree, 'projection-target-clear');

    expect(mockSetTargets).toHaveBeenCalledWith('hh-test', {
      year: 2026,
      months: [9],
      targetCents: null,
    });
  });
});

describe('projectionHeadline', () => {
  it('anchors the pitch on the household’s own best month', () => {
    const { title, body } = projectionHeadline(projectionFixture());
    expect(title).toContain('March');
    expect(title).toContain('7,000');
    expect(body).toContain('5 months');
    expect(body).toContain('52,000'); // potential year end
  });

  it('congratulates rather than nags when the pace already equals the best month', () => {
    const { title } = projectionHeadline(
      projectionFixture({ potentialYearEnd: 3116665, paceYearEnd: 3116665 })
    );
    expect(title).toBe('You are running at your best pace');
  });

  it('invites a first goal when no completed month has data', () => {
    const { title } = projectionHeadline(projectionFixture({ bestMonth: null }));
    expect(title).toContain('Set the pace');
  });

  it('says the benchmark is windfall-free when one-off income was stripped', () => {
    const plain = projectionHeadline(projectionFixture());
    expect(plain.title).not.toContain('one-off');

    const withWindfall = projectionHeadline(projectionFixture({ excludesOneOffIncome: true }));
    // The user sees a $22,500 March in the list but a $7,000 benchmark — the
    // copy has to close that gap or the number just looks wrong.
    expect(withWindfall.title).toContain('one-off income aside');
  });

  it('reports a closed year in the past tense', () => {
    const { title, body } = projectionHeadline(
      projectionFixture({ monthsRemaining: 0, currentMonth: null })
    );
    expect(title).toContain('in the books');
    expect(body).toContain('17,000');
  });

  it('asks for data rather than projecting from nothing', () => {
    const { title } = projectionHeadline(
      projectionFixture({
        monthsRemaining: 0,
        actualToDate: 0,
        bestMonth: null,
        paceMonthly: 0,
      })
    );
    expect(title).toContain('Nothing tracked');
  });
});

/** Base a full `SavingsProjectionMonth` fixture, only stating what a test overrides. */
function monthFixture(over: Partial<SavingsProjectionMonth>): SavingsProjectionMonth {
  return {
    month: 1,
    status: 'actual',
    actualNet: 100,
    targetCents: null,
    projectedNet: 100,
    projectionSource: null,
    hasData: true,
    oneOffIncome: 0,
    goalDeltaCents: null,
    goalAttainmentPct: null,
    goalHit: null,
    plannedBudget: null,
    ...over,
  };
}

describe('projectionBarColor', () => {
  const colors = { positive: '#00AA88', negative: '#FF3B30' };
  const base = monthFixture;

  it('colors actuals by sign, solid', () => {
    expect(projectionBarColor(base({}), colors)).toBe('#00AA88');
    expect(projectionBarColor(base({ actualNet: -100 }), colors)).toBe('#FF3B30');
  });

  it('ghosts future months in the same hue as their projection’s sign', () => {
    expect(projectionBarColor(base({ status: 'future', actualNet: null, projectedNet: 100 }), colors)).toBe('#00AA8859');
    expect(projectionBarColor(base({ status: 'future', actualNet: null, projectedNet: -100 }), colors)).toBe('#FF3B3059');
  });

  it('keeps the live month solid — it is real money, just not final', () => {
    expect(projectionBarColor(base({ status: 'current' }), colors)).toBe('#00AA88');
  });
});

describe('monthRowMeta', () => {
  const base = (over: Partial<SavingsProjectionMonth>): SavingsProjectionMonth =>
    monthFixture({ month: 5, actualNet: 200000, projectedNet: 200000, ...over });

  it('shows a completed, untargeted month as saved — and still editable (a goal can grade it later)', () => {
    expect(monthRowMeta(base({}), 100000)).toEqual({
      amount: 200000,
      caption: 'Saved',
      editable: true,
    });
  });

  it('distinguishes an empty completed month from a $0 one', () => {
    expect(monthRowMeta(base({ actualNet: 0, hasData: false }), 100000).caption).toBe('No data');
  });

  it('explains a windfall month so the benchmark gap makes sense', () => {
    // $22,500 banked, $20,000 of it a one-off — the row has to say so, or the
    // household wonders why their "best month" reads $2,500.
    const meta = monthRowMeta(base({ actualNet: 2250000, oneOffIncome: 2000000 }), 216667);
    expect(meta.amount).toBe(2250000);
    expect(meta.caption).toContain('one-off');
    expect(meta.caption).toContain('20,000');
  });

  it('grades a completed month against its own target', () => {
    const meta = monthRowMeta(
      base({ targetCents: 250000, goalAttainmentPct: 80, goalHit: false }),
      100000
    );
    expect(meta.caption).toContain('80% of');
    expect(meta.caption).toContain('2,500'); // the target amount
    expect(meta.editable).toBe(true);
  });

  it('skips the percentage for a deficit target but still names it', () => {
    const meta = monthRowMeta(
      base({ actualNet: -50000, targetCents: -100000, goalAttainmentPct: null, goalHit: true }),
      100000
    );
    expect(meta.caption).not.toMatch(/%/);
    expect(meta.caption).toContain('goal');
  });

  it('shows the live month’s progress toward its goal', () => {
    const meta = monthRowMeta(base({ status: 'current', targetCents: 500000 }), 100000);
    expect(meta.editable).toBe(true);
    expect(meta.amount).toBe(200000); // what's banked so far, not the goal
    expect(meta.caption).toContain('goal');
  });

  it('labels an untargeted future month as riding the recent pace', () => {
    const meta = monthRowMeta(
      base({
        status: 'future',
        actualNet: null,
        projectedNet: 100000,
        projectionSource: 'pace',
        hasData: false,
      }),
      100000
    );
    expect(meta.amount).toBe(100000);
    expect(meta.caption).toContain('At your recent pace');
    expect(meta.editable).toBe(true);
  });

  it('labels an untargeted future month riding the household goal', () => {
    const meta = monthRowMeta(
      base({
        status: 'future',
        actualNet: null,
        projectedNet: 250000,
        projectionSource: 'goal',
        hasData: false,
      }),
      100000
    );
    expect(meta.caption).toBe('From your savings goal');
  });
});

describe('monthGoalTone', () => {
  const base = (over: Partial<SavingsProjectionMonth>): SavingsProjectionMonth =>
    monthFixture({ targetCents: 100000, ...over });

  it('reads "none" when the month never set a target', () => {
    expect(monthGoalTone(monthFixture({}))).toBe('none');
  });

  it('reads "hit" at or above 100% attainment', () => {
    expect(monthGoalTone(base({ goalAttainmentPct: 100, goalHit: true }))).toBe('hit');
    expect(monthGoalTone(base({ goalAttainmentPct: 140, goalHit: true }))).toBe('hit');
  });

  it('reads "near" between 75% and 100%', () => {
    expect(monthGoalTone(base({ goalAttainmentPct: 80, goalHit: false }))).toBe('near');
  });

  it('reads "miss" below 75%, including a negative attainment', () => {
    expect(monthGoalTone(base({ goalAttainmentPct: 40, goalHit: false }))).toBe('miss');
    expect(monthGoalTone(base({ goalAttainmentPct: -20, goalHit: false }))).toBe('miss');
  });

  it('falls back to the hit/miss boolean for a deficit target with no percentage', () => {
    expect(monthGoalTone(base({ targetCents: -100000, goalAttainmentPct: null, goalHit: true }))).toBe(
      'hit'
    );
    expect(
      monthGoalTone(base({ targetCents: -100000, goalAttainmentPct: null, goalHit: false }))
    ).toBe('miss');
  });
});

describe('goalPerformanceSummary', () => {
  it('returns null when nothing has been graded yet', () => {
    expect(goalPerformanceSummary(NO_GOAL_PERFORMANCE)).toBeNull();
  });

  it('states the hit count, rate, and average attainment', () => {
    const summary = goalPerformanceSummary({
      monthsTracked: 4,
      monthsHit: 3,
      hitRatePct: 75,
      avgAttainmentPct: 108,
    });
    expect(summary).toContain('3 of 4');
    expect(summary).toContain('75%');
    expect(summary).toContain('108%');
  });

  it('degrades without an average when no month had a meaningful percentage', () => {
    const summary = goalPerformanceSummary({
      monthsTracked: 1,
      monthsHit: 1,
      hitRatePct: 100,
      avgAttainmentPct: null,
    });
    expect(summary).toContain('1 of 1 month');
    expect(summary).not.toContain('averaging');
  });
});

describe('goalProgressSummary', () => {
  it('returns null when no year goal is set', () => {
    expect(goalProgressSummary(projectionFixture({ yearGoal: null }))).toBeNull();
  });

  it('states the amount banked and the gap remaining toward the goal', () => {
    const summary = goalProgressSummary(
      projectionFixture({ actualToDate: 1700000, yearGoal: 6000000 })
    );
    expect(summary).toContain('$17,000');
    expect(summary).toContain('$43,000 to go');
  });

  it('reads as past goal once actual savings clear the target', () => {
    const summary = goalProgressSummary(
      projectionFixture({ actualToDate: 7000000, yearGoal: 6000000 })
    );
    expect(summary).toContain('$70,000');
    expect(summary).toContain('$10,000 past goal');
  });
});

describe('SavingsProjectionView — cashflow scenarios', () => {
  const scenarios = [
    { method: 'historical_average' as const, label: 'Cautious', projectedYearEnd: 3_350_000 },
    { method: 'hybrid' as const, label: 'Base', projectedYearEnd: 3_650_000 },
    { method: 'trend' as const, label: 'Optimistic', projectedYearEnd: 3_950_000 },
    { method: 'pessimistic' as const, label: 'Pessimistic', projectedYearEnd: 3_050_000 },
  ];
  const scenarioFixture = (method: SavingsProjection['method'] = 'hybrid') => projectionFixture({
    method,
    projectedYearEnd: scenarios.find((s) => s.method === method)!.projectedYearEnd,
    methodComparison: scenarios,
    forecast: {
      model: 'cashflow-scenarios-v1', scenarios, sampleMonths: 3,
      includesCurrentMonth: true, warnings: [], goalGap: -350_000, requiredMonthly: 550_000,
    },
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectedYear = 2026;
    mockDataRevision = 0;
    mockGetProjection.mockImplementation(async (_hh, _year, method) => scenarioFixture(method));
    mockSetDefaultMethod.mockImplementation(async (_hh, _year, method) => scenarioFixture(method));
  });

  it('renders four scenarios, matching the selected hero, with range and no legacy default action', async () => {
    const tree = await renderScreen();
    expect(byId(tree, 'savings-forecast-assumptions')).toBeTruthy();
    expect(textOf(tree, 'savings-forecast-range')).toContain('30,500');
    expect(textOf(tree, 'savings-forecast-range')).toContain('39,500');
    expect(tree.root.findAllByProps({ testID: 'savings-projection-method-planned_budget' })).toHaveLength(0);
    await press(tree, 'savings-projection-method-trend');
    expect(mockSetDefaultMethod).toHaveBeenLastCalledWith('hh-test', 2026, 'trend');
    expect(textOf(tree, 'savings-projection-year-end')).toContain('39,500');
    expect(tree.root.findAllByProps({ testID: 'savings-projection-set-default' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'savings-projection-headline' })).toHaveLength(0);
  });

  it('explains a positive year-end total that is below recorded savings as a future decrease', async () => {
    const data = scenarioFixture('historical_average');
    data.actualToDate = 2_000_000;
    data.projectedYearEnd = 900_000;
    data.forecast!.scenarios[0].projectedYearEnd = 900_000;
    mockGetProjection.mockResolvedValue(data);
    const tree = await renderScreen();
    expect(textOf(tree, 'savings-projection-year-end')).toContain('9,000');
    expect(textOf(tree, 'forecast-remaining-change')).toContain('11,000');
    expect(textOf(tree, 'scenario-change-historical_average')).toContain('decrease expected');
    expect(textOf(tree, 'forecast-decrease-explanation')).toContain('Your recorded savings have not changed');
  });

  it('ignores an older request arriving after the latest scenario selection', async () => {
    const tree = await renderScreen();
    let finishOld!: (value: SavingsProjection) => void;
    mockGetProjection.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    mockDataRevision += 1;
    await act(async () => { tree.update(<ThemeProvider><SavingsProjectionView /></ThemeProvider>); });
    await press(tree, 'savings-projection-method-trend');
    await act(async () => { finishOld(scenarioFixture('historical_average')); });
    expect(textOf(tree, 'savings-projection-year-end')).toContain('39,500');
  });

  it('separates planned spending from the pessimistic adjustment that creates a deficit', async () => {
    const data = scenarioFixture();
    data.forecast!.scenarios = data.forecast!.scenarios.map((scenario) => ({
      ...scenario,
      exampleMonth: {
        month: 10, income: 1_564_897, recurring: 1_006_043, spending: 755_101,
        incomeSource: 'entries', spendingSource: 'budget', recordedNet: 0,
        plannedSpending: 200_000, scenarioSpendingAdjustment: 555_101,
        loggedSpendingFloorAdjustment: 0, net: -196_247,
      },
    }));
    mockGetProjection.mockResolvedValue(data);
    const tree = await renderScreen();
    await press(tree, 'savings-projection-method-info-pessimistic-toggle');
    const adjustment = byId(tree, 'scenario-budget-adjustment-pessimistic');
    expect(adjustment).toBeTruthy();
    expect(adjustment.findAll((node) => Array.isArray(node.props.children) && node.props.children.includes(' would remain this month. The higher spending assumption turns this scenario negative.')).length).toBeGreaterThan(0);
  });

  it('distinguishes a positive September total from its negative remaining forecast', async () => {
    const data = scenarioFixture('pessimistic');
    data.currentMonth = 9;
    data.forecast!.scenarios = data.forecast!.scenarios.map((scenario) => ({
      ...scenario,
      remainingMonths: [{ month: 9, income: 2_654_625, recordedNet: 1_572_490, netChange: -679_009, fullMonthNet: 893_481, recordedSpending: 76_092, breakdown: { income: 2_654_625, recurring: 1_006_043, spending: 755_101, incomeSource: 'entries', spendingSource: 'budget', recordedNet: 1_572_490, plannedSpending: 200_000, scenarioSpendingAdjustment: 555_101 } }],
    }));
    mockGetProjection.mockResolvedValue(data);
    const tree = await renderScreen();
    await press(tree, 'savings-projection-method-info-pessimistic-toggle');
    expect(byId(tree, 'forecast-current-month-reconciliation')).toBeTruthy();
    expect(textOf(tree, 'forecast-current-month-total')).toContain('8,935');
    expect(textOf(tree, 'forecast-current-month-total')).toContain('+');
    expect(textOf(tree, 'forecast-current-month-unspent')).toContain('6,790');
    expect(textOf(tree, 'forecast-current-month-unspent')).not.toContain('−');
  });

  it('shows the forecast and its component amounts for an open month', () => {
    const month = projectionFixture().months[6];
    month.forecastBreakdown = {
      income: 800_000, recurring: 100_000, spending: 300_000,
      incomeSource: 'templates', spendingSource: 'history', recordedNet: 100_000,
    };
    month.projectedNet = 400_000;
    const meta = monthRowMeta(month, 200_000);
    expect(meta.amount).toBe(400_000);
    expect(meta.caption).toContain('8,000');
    expect(meta.caption).toContain('recorded net');
    expect(projectionBarColor(month, { positive: '#00FF00', negative: '#FF0000' })).toBe('#00FF0059');
  });

  it('opens a full-height visual explanation for each scenario independently of the selected Base', async () => {
    const data = scenarioFixture();
    data.forecast!.scenarios = data.forecast!.scenarios.map((s, index) => ({
      ...s,
      exampleMonth: {
        month: 10, net: 500_000 + index * 50_000, income: 900_000,
        recurring: 0, spending: 400_000 - index * 50_000,
        incomeSource: 'entries', spendingSource: 'budget', recordedNet: 900_000,
      },
    }));
    mockGetProjection.mockResolvedValue(data);
    const tree = await renderScreen();
    for (const [index, scenario] of scenarios.entries()) {
      const info = byId(tree, `savings-projection-method-info-${scenario.method}`);
      expect(info.props.sheetHeight).toBe('full');
      await press(tree, `savings-projection-method-info-${scenario.method}-toggle`);
      expect(byId(tree, `scenario-explanation-${scenario.method}`)).toBeTruthy();
      expect(byId(tree, 'bottom-sheet-scroll')).toBeTruthy();
      expect(textOf(tree, `scenario-example-net-${scenario.method}`)).toContain(['5,000', '5,500', '6,000', '6,500'][index]);
      await press(tree, 'bottom-sheet-close');
    }
    expect(mockGetProjection).toHaveBeenCalledTimes(1);
  });
});
