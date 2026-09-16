/**
 * Regression suite for BudgetSpendingsView — guards tab-specific planned vs
 * spent behaviour inside BudgetScreen's ScrollView chain.
 *
 * The add CTAs (Add Manually / Scan Receipt / Add with AI) are NOT here anymore:
 * they moved out of this view into the header "+" sheet, and are covered by
 * `BudgetAddActionsSheet.test.tsx`.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useFocusEffect: (cb: () => (() => void) | void) => {
      React.useEffect(cb, []);
    },
  };
});

const mockGetMonthlyOverview = jest.fn();
const mockGetQuickAddSuggestions = jest.fn();
const mockGetCategories = jest.fn();
const mockCreateItem = jest.fn();
const mockAddExpense = jest.fn();
const mockDeleteItem = jest.fn();
const mockDeleteExpense = jest.fn();
const mockRecordPlannedSpending = jest.fn();

jest.mock('@api/budget', () => ({
  budgetApi: {
    getMonthlyOverview: (...args: unknown[]) => mockGetMonthlyOverview(...args),
    getQuickAddSuggestions: (...args: unknown[]) => mockGetQuickAddSuggestions(...args),
    getCategories: (...args: unknown[]) => mockGetCategories(...args),
    createItem: (...args: unknown[]) => mockCreateItem(...args),
    addExpense: (...args: unknown[]) => mockAddExpense(...args),
    updateItem: jest.fn(),
    deleteItem: (...args: unknown[]) => mockDeleteItem(...args),
    deleteExpense: (...args: unknown[]) => mockDeleteExpense(...args),
    recordPlannedSpending: (...args: unknown[]) => mockRecordPlannedSpending(...args),
  },
}));

jest.mock('react-native-gesture-handler', () => {
  const RN = require('react-native');
  return {
    TouchableOpacity: RN.TouchableOpacity,
    ScrollView: RN.ScrollView,
  };
});

jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  __esModule: true,
  default: ({
    children,
    renderRightActions,
  }: {
    children: unknown;
    renderRightActions?: () => React.ReactNode;
  }) => (
    <>
      {children}
      {typeof renderRightActions === 'function' ? renderRightActions() : null}
    </>
  ),
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector?: (s: { currentHousehold: { id: string } }) => unknown) => {
    const state = { currentHousehold: { id: 'hh-test' } };
    return selector ? selector(state) : state;
  },
}));

let mockBudgetDataRevision = 0;
const mockMarkInsightsDirty = jest.fn();
jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (selector?: (s: { markInsightsDirty: jest.Mock; dataRevision: number }) => unknown) => {
    const state = { markInsightsDirty: mockMarkInsightsDirty, dataRevision: mockBudgetDataRevision };
    return selector ? selector(state) : state;
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { BudgetItem, Expense, MonthlyOverview } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import {
  ALL_DEVICES,
  renderOnDevice,
  setDevice,
  treeText,
  type DeviceName,
} from '../../../test-utils/deviceRender';
import { formatBudgetCurrency } from '../budgetFormat';
import { BudgetMonthHeader } from '../BudgetMonthHeader';
import { BudgetSpendingsView, shiftDateToMonth } from '../BudgetSpendingsView';

const EVERY_DEVICE = ALL_DEVICES.map((d) => [d] as [DeviceName]);

const EMPTY_OVERVIEW: MonthlyOverview = {
  goal: {
    id: 'goal_1',
    household_id: 'hh-test',
    year: 2026,
    month: 7,
    planned_budget: 50000,
    actual_spent: 0,
    category_budgets: null,
    notes: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  },
  plannedBudget: 50000,
  actualSpent: 0,
  committedTotal: 0,
  remainingBudget: 50000,
  affordability: { remaining_budget: 50000, used_budget: 0, affordable: [], deferred: [] },
  items: [],
  expenses: [],
  itemCount: 0,
  savedTotal: 0,
};

function makeBudgetItem(overrides: Partial<BudgetItem> = {}): BudgetItem {
  return {
    id: 'bi-1',
    household_id: 'hh-test',
    category_id: null,
    timeframe: 'immediate',
    year: 2026,
    quarter: null,
    title: 'Water filter',
    description: null,
    estimated_cost_min: 4000,
    estimated_cost_max: 4000,
    actual_cost: null,
    priority: 'high',
    status: 'planned',
    is_recurring: false,
    recurrence_frequency: null,
    source_type: null,
    source_id: null,
    target_date: '2026-07-15',
    completed_at: null,
    created_by: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'exp-1',
    household_id: 'hh-test',
    category_id: null,
    budget_item_id: null,
    title: 'Groceries',
    description: null,
    amount: 3200,
    saved_amount: 0,
    expense_date: '2026-07-10',
    vendor: null,
    receipt_key: null,
    created_by: null,
    created_at: '2026-07-10T00:00:00Z',
    ...overrides,
  };
}

const DEFAULT_PROPS = {
  variant: 'planned' as const,
  year: 2026,
  month: 7,
  onMonthChange: jest.fn(),
  onEditItem: jest.fn(),
  onEditExpense: jest.fn(),
};

/**
 * Drives the single-row "Copy" destination wheel: presses `actionTestID`, then
 * confirms the sheet on `monthKey` (`YYYY-MM`, defaulting to the viewed month —
 * what a plain Done does, since the wheel opens there).
 */
async function copyRowToMonth(
  r: ReactTestRenderer.ReactTestRenderer,
  actionTestID: string,
  monthKey = '2026-07'
) {
  act(() => r.root.findByProps({ testID: actionTestID }).props.onPress());
  const sheet = r.root.findByProps({ testID: 'budget-row-copy-month' });
  expect(sheet.props.visible).toBe(true);
  await act(async () => {
    sheet.props.onConfirm(monthKey);
    sheet.props.onClose();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function wrapWithProviders(node: React.ReactElement): React.ReactElement {
  return <ThemeProvider>{node}</ThemeProvider>;
}

async function renderLoaded(
  device: DeviceName,
  node: React.ReactElement = <BudgetSpendingsView {...DEFAULT_PROPS} />
): Promise<ReactTestRenderer.ReactTestRenderer> {
  setDevice(device);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(wrapWithProviders(node));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBudgetDataRevision = 0;
  mockGetMonthlyOverview.mockResolvedValue(EMPTY_OVERVIEW);
  mockGetQuickAddSuggestions.mockResolvedValue({ recent: [], popular: [] });
  mockGetCategories.mockResolvedValue({ categories: [] });
});

describe('BudgetSpendingsView — smoke', () => {
  it.each(EVERY_DEVICE)('mounts without crash on %s', async (device) => {
    const r = renderOnDevice(device, <BudgetSpendingsView {...DEFAULT_PROPS} />);
    expect(r.toJSON()).not.toBeNull();
  });
});

describe('BudgetSpendingsView — set-budget reminder', () => {
  const NO_BUDGET_OVERVIEW: MonthlyOverview = {
    ...EMPTY_OVERVIEW,
    goal: { ...EMPTY_OVERVIEW.goal, planned_budget: null },
    plannedBudget: 0,
    remainingBudget: 0,
  };

  it('shows the reminder when no budget is set for the month', async () => {
    mockGetMonthlyOverview.mockResolvedValue(NO_BUDGET_OVERVIEW);
    const onSetBudget = jest.fn();
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" onSetBudget={onSetBudget} />
    );
    const banner = r.root.findByProps({ testID: 'budget-set-budget-reminder' });
    expect(banner).toBeTruthy();

    act(() => {
      banner.props.onPress();
    });
    expect(onSetBudget).toHaveBeenCalledTimes(1);
  });

  it('hides the reminder once a budget is set', async () => {
    mockGetMonthlyOverview.mockResolvedValue(EMPTY_OVERVIEW); // planned_budget = 50000
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" onSetBudget={jest.fn()} />
    );
    expect(r.root.findAllByProps({ testID: 'budget-set-budget-reminder' })).toHaveLength(0);
  });

  it('never shows the reminder without an onSetBudget handler', async () => {
    mockGetMonthlyOverview.mockResolvedValue(NO_BUDGET_OVERVIEW);
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    expect(r.root.findAllByProps({ testID: 'budget-set-budget-reminder' })).toHaveLength(0);
  });

  // Parity: the Planning tab shows the SAME reminder as Spending (the banner
  // lives in the shared component, gated only by noBudgetSet + onSetBudget).
  it('shows the reminder on the planned tab too, and fires onSetBudget', async () => {
    mockGetMonthlyOverview.mockResolvedValue(NO_BUDGET_OVERVIEW);
    const onSetBudget = jest.fn();
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="planned" onSetBudget={onSetBudget} />
    );
    const banner = r.root.findByProps({ testID: 'budget-set-budget-reminder' });
    expect(banner).toBeTruthy();
    act(() => {
      banner.props.onPress();
    });
    expect(onSetBudget).toHaveBeenCalledTimes(1);
  });

  it('hides the planned-tab reminder once a budget is set', async () => {
    mockGetMonthlyOverview.mockResolvedValue(EMPTY_OVERVIEW); // planned_budget = 50000
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="planned" onSetBudget={jest.fn()} />
    );
    expect(r.root.findAllByProps({ testID: 'budget-set-budget-reminder' })).toHaveLength(0);
  });
});

describe('BudgetSpendingsView — loading keeps chrome static', () => {
  it('shows the content spinner while the month nav stays mounted', async () => {
    // A pending overview keeps isLoading=true so we can observe the loading render.
    let resolveOverview: (v: MonthlyOverview) => void = () => {};
    mockGetMonthlyOverview.mockReturnValue(
      new Promise<MonthlyOverview>((resolve) => {
        resolveOverview = resolve;
      })
    );

    setDevice('iPhone 14 Pro');
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        wrapWithProviders(<BudgetSpendingsView {...DEFAULT_PROPS} />)
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    // The spinner lives in the main content area…
    expect(
      renderer.root.findAllByProps({ testID: 'budget-planned-spendings-loading' }).length
    ).toBeGreaterThanOrEqual(1);
    // …while the month nav remains statically mounted (not hidden then re-shown
    // once data lands).
    expect(renderer.root.findByProps({ testID: 'budget-spendings-month-prev' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'budget-spendings-month-next' })).toBeTruthy();
    // The root chrome is mounted, not replaced wholesale by the spinner.
    expect(renderer.root.findByProps({ testID: 'budget-planned-spendings' })).toBeTruthy();

    // Settle the pending fetch so the effect can finish without act warnings.
    await act(async () => {
      resolveOverview(EMPTY_OVERVIEW);
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('clears the content spinner once loaded, leaving the chrome in place', async () => {
    const r = await renderLoaded('iPhone 14 Pro');
    expect(
      r.root.findAllByProps({ testID: 'budget-planned-spendings-loading' })
    ).toHaveLength(0);
    expect(r.root.findByProps({ testID: 'budget-planned-spendings' })).toBeTruthy();
    expect(r.root.findByProps({ testID: 'budget-spendings-month-prev' })).toBeTruthy();
  });
});

describe('BudgetSpendingsView — savings & deposits banners', () => {
  it('shows the discount savings banner on the spent tab when savedTotal > 0', async () => {
    mockGetMonthlyOverview.mockResolvedValue({ ...EMPTY_OVERVIEW, savedTotal: 279 });
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    expect(r.root.findByProps({ testID: 'budget-savings-banner' })).toBeTruthy();
    expect(treeText(r)).toContain('2.79');
    expect(treeText(r)).toMatch(/on discounts this month/i);
  });

  it('hides the savings banner when savedTotal is 0', async () => {
    mockGetMonthlyOverview.mockResolvedValue({ ...EMPTY_OVERVIEW, savedTotal: 0 });
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    expect(r.root.findAllByProps({ testID: 'budget-savings-banner' })).toHaveLength(0);
  });

  it('never shows the savings banner on the planned tab', async () => {
    mockGetMonthlyOverview.mockResolvedValue({ ...EMPTY_OVERVIEW, savedTotal: 500 });
    const r = await renderLoaded('iPhone 14 Pro', <BudgetSpendingsView {...DEFAULT_PROPS} variant="planned" />);
    expect(r.root.findAllByProps({ testID: 'budget-savings-banner' })).toHaveLength(0);
  });

  it('shows the deposits banner on the spent tab when depositsTotal > 0', async () => {
    mockGetMonthlyOverview.mockResolvedValue({ ...EMPTY_OVERVIEW, depositsTotal: 125 });
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    expect(r.root.findByProps({ testID: 'budget-deposits-banner' })).toBeTruthy();
    expect(treeText(r)).toContain('1.25');
    expect(treeText(r)).toMatch(/in deposits this month/i);
    expect(treeText(r)).not.toMatch(/returnable/i);
  });

  it('hides the deposits banner when depositsTotal is 0', async () => {
    mockGetMonthlyOverview.mockResolvedValue({ ...EMPTY_OVERVIEW, depositsTotal: 0 });
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    expect(r.root.findAllByProps({ testID: 'budget-deposits-banner' })).toHaveLength(0);
  });

  it('shows the taxes banner on the spent tab when taxesTotal > 0', async () => {
    mockGetMonthlyOverview.mockResolvedValue({ ...EMPTY_OVERVIEW, taxesTotal: 1900 });
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    expect(r.root.findByProps({ testID: 'budget-taxes-banner' })).toBeTruthy();
    expect(treeText(r)).toContain('19.00');
    expect(treeText(r)).toMatch(/in taxes this month/i);
  });

  it('hides the taxes banner when taxesTotal is 0 or absent (older API)', async () => {
    mockGetMonthlyOverview.mockResolvedValue({ ...EMPTY_OVERVIEW, taxesTotal: 0 });
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    expect(r.root.findAllByProps({ testID: 'budget-taxes-banner' })).toHaveLength(0);

    mockGetMonthlyOverview.mockResolvedValue({ ...EMPTY_OVERVIEW });
    const r2 = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    expect(r2.root.findAllByProps({ testID: 'budget-taxes-banner' })).toHaveLength(0);
  });

  it('orders the banners discounts → deposits → taxes', async () => {
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      savedTotal: 279,
      depositsTotal: 125,
      taxesTotal: 1900,
    });
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    const text = treeText(r);
    const at = (needle: string) => text.indexOf(needle);
    expect(at('on discounts this month')).toBeGreaterThan(-1);
    expect(at('on discounts this month')).toBeLessThan(at('in deposits this month'));
    expect(at('in deposits this month')).toBeLessThan(at('in taxes this month'));
  });
});

describe('BudgetSpendingsView — banners link to their detail page', () => {
  const ALL_EXTRAS = { ...EMPTY_OVERVIEW, savedTotal: 279, depositsTotal: 125, taxesTotal: 1900 };

  it('each banner is a button with a chevron that reports its kind', async () => {
    mockGetMonthlyOverview.mockResolvedValue(ALL_EXTRAS);
    const onOpenSpendingExtras = jest.fn();
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView
        {...DEFAULT_PROPS}
        variant="spent"
        onOpenSpendingExtras={onOpenSpendingExtras}
      />
    );
    const expected: Array<[string, string]> = [
      ['budget-savings-banner', 'discounts'],
      ['budget-deposits-banner', 'deposits'],
      ['budget-taxes-banner', 'taxes'],
    ];
    for (const [id, kind] of expected) {
      const banner = r.root.findByProps({ testID: id });
      expect(banner.props.accessibilityRole).toBe('button');
      expect(banner.findAllByProps({ name: 'chevron-forward' }).length).toBeGreaterThan(0);
      act(() => banner.props.onPress());
      expect(onOpenSpendingExtras).toHaveBeenLastCalledWith(kind);
    }
    expect(onOpenSpendingExtras).toHaveBeenCalledTimes(3);
  });

  it('stays a plain statement — no chevron, not pressable — when no page is wired', async () => {
    mockGetMonthlyOverview.mockResolvedValue(ALL_EXTRAS);
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    const banner = r.root.findByProps({ testID: 'budget-taxes-banner' });
    expect(banner.props.onPress).toBeUndefined();
    expect(banner.findAllByProps({ name: 'chevron-forward' })).toHaveLength(0);
    expect(treeText(r)).toContain('19.00');
  });
});

describe('BudgetSpendingsView — month selector', () => {
  it.each(EVERY_DEVICE)('renders the month header for the current month on %s', async (device) => {
    const r = await renderLoaded(device);
    expect(r.root.findByProps({ testID: 'budget-spendings-month-prev' })).toBeTruthy();
    expect(r.root.findByProps({ testID: 'budget-spendings-month-next' })).toBeTruthy();
    const text = treeText(r);
    expect(text).toContain('Jul');
    expect(text).toContain('2026');
  });

  it('steps back a month when the left arrow is tapped', async () => {
    const onMonthChange = jest.fn();
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} onMonthChange={onMonthChange} />
    );
    act(() => r.root.findByProps({ testID: 'budget-spendings-month-prev' }).props.onPress());
    expect(onMonthChange).toHaveBeenCalledWith(2026, 6);
  });

  it('steps forward a month when the right arrow is tapped', async () => {
    const onMonthChange = jest.fn();
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} onMonthChange={onMonthChange} />
    );
    act(() => r.root.findByProps({ testID: 'budget-spendings-month-next' }).props.onPress());
    expect(onMonthChange).toHaveBeenCalledWith(2026, 8);
  });

  it('rolls over the year boundary going forward from December', async () => {
    const onMonthChange = jest.fn();
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} year={2026} month={12} onMonthChange={onMonthChange} />
    );
    act(() => r.root.findByProps({ testID: 'budget-spendings-month-next' }).props.onPress());
    expect(onMonthChange).toHaveBeenCalledWith(2027, 1);
  });

  it('shows the month header on the spent tab too', async () => {
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    expect(r.root.findByProps({ testID: 'budget-spendings-month-prev' })).toBeTruthy();
  });
});

describe('BudgetSpendingsView — spent tab blocks future months', () => {
  // Spending can only record the past/present, so the forward arrow must be a
  // hard no-op once the current month is reached. Pin "now" so the current
  // month is deterministically July 2026 regardless of the real clock.
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-15T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('disables the forward arrow at the current month and ignores presses', async () => {
    const onMonthChange = jest.fn();
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" year={2026} month={7} onMonthChange={onMonthChange} />
    );
    const next = r.root.findByProps({ testID: 'budget-spendings-month-next' });
    expect(next.props.disabled).toBe(true);
    act(() => next.props.onPress());
    expect(onMonthChange).not.toHaveBeenCalled();
  });

  it('still steps back to previous months on the spent tab', async () => {
    const onMonthChange = jest.fn();
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" year={2026} month={7} onMonthChange={onMonthChange} />
    );
    act(() => r.root.findByProps({ testID: 'budget-spendings-month-prev' }).props.onPress());
    expect(onMonthChange).toHaveBeenCalledWith(2026, 6);
  });

  it('allows moving forward from a past month up to the current month', async () => {
    const onMonthChange = jest.fn();
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" year={2026} month={5} onMonthChange={onMonthChange} />
    );
    const next = r.root.findByProps({ testID: 'budget-spendings-month-next' });
    expect(next.props.disabled).toBe(false);
    act(() => next.props.onPress());
    expect(onMonthChange).toHaveBeenCalledWith(2026, 6);
  });

  it('leaves the planned tab free to scroll into future months', async () => {
    const onMonthChange = jest.fn();
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="planned" year={2026} month={7} onMonthChange={onMonthChange} />
    );
    const next = r.root.findByProps({ testID: 'budget-spendings-month-next' });
    expect(next.props.disabled).toBe(false);
    act(() => next.props.onPress());
    expect(onMonthChange).toHaveBeenCalledWith(2026, 8);
  });
});

describe('BudgetSpendingsView — empty state', () => {
  it.each(EVERY_DEVICE)('shows planned empty copy on %s', async (device) => {
    const r = await renderLoaded(device);
    expect(treeText(r)).toContain('No planned spendings yet');
  });

  it.each(EVERY_DEVICE)('shows spent empty copy on %s', async (device) => {
    const r = await renderLoaded(device, <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />);
    expect(treeText(r)).toContain('Nothing spent this month yet');
  });
});

describe('BudgetSpendingsView — populated data', () => {
  it('lists planned items in affordability sections', async () => {
    const item = makeBudgetItem();
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      items: [item],
      itemCount: 1,
      affordability: {
        remaining_budget: 50000,
        used_budget: 0,
        affordable: [
          {
            id: item.id,
            title: item.title,
            priority: item.priority,
            target_date: item.target_date,
            status: item.status,
            estimatedCost: 4000,
            score: 1,
            reason: 'fits',
          },
        ],
        deferred: [],
      },
    });

    const r = await renderLoaded('iPhone 14 Pro');
    expect(treeText(r)).toMatch(/planned · fits this month/i);
    expect(treeText(r)).toContain('Water filter');
    expect(treeText(r)).toContain('budget-planned-item');
  });

  it('lists expenses on the spent tab', async () => {
    const expense = makeExpense();
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      actualSpent: expense.amount,
      expenses: [expense],
    });

    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    expect(treeText(r)).toMatch(/spent this month/i);
    expect(treeText(r)).toContain('Groceries');
    expect(treeText(r)).toContain('budget-spent-item');
  });

  it('shows the total spent for the month on the spent tab', async () => {
    const a = makeExpense({ id: 'e1', amount: 1046069 });
    const b = makeExpense({ id: 'e2', amount: 663211 });
    const totalCents = a.amount + b.amount; // 1,709,280
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      actualSpent: totalCents,
      expenses: [a, b],
    });

    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    const total = r.root.findByProps({ testID: 'budget-spent-total' });
    expect(total.props.children).toBe(formatBudgetCurrency(totalCents));
  });
});

describe('BudgetSpendingsView — duplicate', () => {
  beforeEach(() => {
    mockCreateItem.mockReset();
    mockAddExpense.mockReset();
    mockCreateItem.mockResolvedValue({ item: makeBudgetItem({ id: 'bi-copy' }) });
    mockAddExpense.mockResolvedValue({ expense: makeExpense({ id: 'exp-copy' }) });
  });

  it('duplicates a planned item when the swipe duplicate action is pressed', async () => {
    const item = makeBudgetItem();
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      items: [item],
      itemCount: 1,
      affordability: {
        remaining_budget: 50000,
        used_budget: 0,
        affordable: [
          {
            id: item.id,
            title: item.title,
            priority: item.priority,
            target_date: item.target_date,
            status: item.status,
            estimatedCost: 4000,
            score: 1,
            reason: 'fits',
          },
        ],
        deferred: [],
      },
    });

    const r = await renderLoaded('iPhone 14 Pro');
    await copyRowToMonth(r, 'budget-duplicate-planned');

    expect(mockCreateItem).toHaveBeenCalledWith('hh-test', {
      title: 'Water filter',
      category_id: undefined,
      timeframe: 'immediate',
      priority: 'high',
      estimated_cost_min: 4000,
      estimated_cost_max: 4000,
      is_recurring: false,
      target_date: '2026-07-15',
    });
  });

  it('duplicates a spent expense when the swipe duplicate action is pressed', async () => {
    const expense = makeExpense();
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      actualSpent: expense.amount,
      expenses: [expense],
    });

    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    await copyRowToMonth(r, 'budget-duplicate-spent');

    expect(mockAddExpense).toHaveBeenCalledWith('hh-test', {
      title: 'Groceries',
      amount: 3200,
      expense_date: '2026-07-10',
      category_id: undefined,
      vendor: undefined,
      saved_amount: 0,
    });
  });

  it('copies a planned item into the month picked on the wheel and follows it', async () => {
    const item = makeBudgetItem({ target_date: '2026-07-31' });
    mockGetMonthlyOverview.mockResolvedValue(AFFORDABLE_OVERVIEW(item));
    const onMonthChange = jest.fn();

    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} onMonthChange={onMonthChange} />
    );
    await copyRowToMonth(r, 'budget-duplicate-planned', '2027-02');

    // Day-of-month preserved, clamped to the destination month's length.
    expect(mockCreateItem).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ target_date: '2027-02-28' })
    );
    expect(onMonthChange).toHaveBeenCalledWith(2027, 2);
  });

  it('copies a spent expense into the month picked on the wheel, tax and all', async () => {
    const expense = makeExpense({
      expense_date: '2026-07-31',
      saved_amount: 500,
      tax_amount: 416,
      deposit_amount: 20,
    });
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      actualSpent: expense.amount,
      expenses: [expense],
    });
    const onMonthChange = jest.fn();

    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView
        {...DEFAULT_PROPS}
        variant="spent"
        onMonthChange={onMonthChange}
      />
    );
    await copyRowToMonth(r, 'budget-duplicate-spent', '2026-09');

    expect(mockAddExpense).toHaveBeenCalledWith('hh-test', {
      title: 'Groceries',
      amount: 3200,
      expense_date: '2026-09-30',
      category_id: undefined,
      vendor: undefined,
      saved_amount: 500,
      tax_amount: 416,
      deposit_amount: 20,
    });
    expect(onMonthChange).toHaveBeenCalledWith(2026, 9);
  });

  it('copies nothing while the destination wheel is still open', async () => {
    mockGetMonthlyOverview.mockResolvedValue(AFFORDABLE_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro');

    act(() => r.root.findByProps({ testID: 'budget-duplicate-planned' }).props.onPress());
    expect(mockCreateItem).not.toHaveBeenCalled();

    // Dismissing without Done leaves the month untouched.
    await act(async () => {
      r.root.findByProps({ testID: 'budget-row-copy-month' }).props.onClose();
      await Promise.resolve();
    });
    expect(mockCreateItem).not.toHaveBeenCalled();
  });
});

describe('BudgetSpendingsView — quick add removed', () => {
  // The Recent/Popular chip row was dropped from both tabs; guard against it
  // creeping back and against the view re-fetching suggestions it never shows.
  it('renders no quick-add row and never asks for suggestions', async () => {
    const r = await renderLoaded('iPhone 14 Pro', <BudgetSpendingsView {...DEFAULT_PROPS} />);

    expect(r.root.findAllByProps({ testID: 'budget-quick-add-row' })).toHaveLength(0);
    expect(mockGetQuickAddSuggestions).not.toHaveBeenCalled();
  });
});

const AFFORDABLE_OVERVIEW = (item = makeBudgetItem()): MonthlyOverview => ({
  ...EMPTY_OVERVIEW,
  items: [item],
  itemCount: 1,
  affordability: {
    remaining_budget: 50000,
    used_budget: 0,
    affordable: [
      {
        id: item.id,
        title: item.title,
        priority: item.priority,
        target_date: item.target_date,
        status: item.status,
        estimatedCost: 4000,
        score: 1,
        reason: 'fits',
      },
    ],
    deferred: [],
  },
});

describe('BudgetSpendingsView — edit / delete / record flows', () => {
  beforeEach(() => {
    mockDeleteItem.mockResolvedValue({});
    mockDeleteExpense.mockResolvedValue({});
    mockRecordPlannedSpending.mockResolvedValue({});
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    (Alert.alert as jest.Mock).mockRestore?.();
  });

  it('invokes onEditItem when the planned edit swipe action is pressed', async () => {
    const onEditItem = jest.fn();
    mockGetMonthlyOverview.mockResolvedValue(AFFORDABLE_OVERVIEW());
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} onEditItem={onEditItem} />
    );
    act(() => r.root.findByProps({ testID: 'budget-edit-planned' }).props.onPress());
    expect(onEditItem).toHaveBeenCalledWith('bi-1');
  });

  it('confirms and deletes a planned item', async () => {
    mockGetMonthlyOverview.mockResolvedValue(AFFORDABLE_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro');
    act(() => r.root.findByProps({ testID: 'budget-delete-planned' }).props.onPress());

    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Delete planned spending');
    expect(call).toBeTruthy();
    const buttons = call![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')!.onPress?.();
      await Promise.resolve();
    });
    expect(mockDeleteItem).toHaveBeenCalledWith('hh-test', 'bi-1');
  });

  it('opens the record-spending modal, validates, and records the amount', async () => {
    mockGetMonthlyOverview.mockResolvedValue(AFFORDABLE_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro');
    act(() => r.root.findByProps({ testID: 'budget-record-spending' }).props.onPress());

    // Invalid amount → error, no API call.
    act(() => r.root.findByProps({ testID: 'budget-record-amount' }).props.onChangeText('0'));
    await act(async () => {
      r.root.findByProps({ title: 'Record spent' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockRecordPlannedSpending).not.toHaveBeenCalled();

    // Valid amount → records.
    act(() => r.root.findByProps({ testID: 'budget-record-amount' }).props.onChangeText('40'));
    await act(async () => {
      r.root.findByProps({ title: 'Record spent' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockRecordPlannedSpending).toHaveBeenCalledWith('hh-test', 'bi-1', { amount: 4000 });
  });

  it('invokes onEditExpense when the spent edit swipe action is pressed', async () => {
    const onEditExpense = jest.fn();
    const expense = makeExpense();
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      actualSpent: expense.amount,
      expenses: [expense],
    });
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" onEditExpense={onEditExpense} />
    );
    act(() => r.root.findByProps({ testID: 'budget-edit-spent' }).props.onPress());
    expect(onEditExpense).toHaveBeenCalledWith(expect.objectContaining({ id: 'exp-1' }));
  });

  it('confirms and deletes a spent expense', async () => {
    const expense = makeExpense();
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      actualSpent: expense.amount,
      expenses: [expense],
    });
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    act(() => r.root.findByProps({ testID: 'budget-delete-spent' }).props.onPress());
    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Delete spending');
    const buttons = call![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')!.onPress?.();
      await Promise.resolve();
    });
    expect(mockDeleteExpense).toHaveBeenCalledWith('hh-test', 'exp-1');
  });

  it('taps a planned item row to edit it', async () => {
    const onEditItem = jest.fn();
    mockGetMonthlyOverview.mockResolvedValue(AFFORDABLE_OVERVIEW());
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} onEditItem={onEditItem} />
    );
    act(() => r.root.findByProps({ testID: 'budget-planned-item' }).props.onPress());
    expect(onEditItem).toHaveBeenCalledWith('bi-1');
  });

  it('taps a spent item row to edit it', async () => {
    const onEditExpense = jest.fn();
    const expense = makeExpense();
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      actualSpent: expense.amount,
      expenses: [expense],
    });
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" onEditExpense={onEditExpense} />
    );
    act(() => r.root.findByProps({ testID: 'budget-spent-item' }).props.onPress());
    expect(onEditExpense).toHaveBeenCalledWith(expect.objectContaining({ id: 'exp-1' }));
  });

  it('alerts when recording spending fails', async () => {
    mockRecordPlannedSpending.mockRejectedValue(new Error('boom'));
    mockGetMonthlyOverview.mockResolvedValue(AFFORDABLE_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro');
    act(() => r.root.findByProps({ testID: 'budget-record-spending' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-record-amount' }).props.onChangeText('40'));
    await act(async () => {
      r.root.findByProps({ title: 'Record spent' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Error')).toBe(true);
  });

  it('alerts when duplicating a planned item fails', async () => {
    mockCreateItem.mockRejectedValue(new Error('boom'));
    mockGetMonthlyOverview.mockResolvedValue(AFFORDABLE_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro');
    await copyRowToMonth(r, 'budget-duplicate-planned');
    expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Error')).toBe(true);
  });

  it('alerts when duplicating a spent expense fails', async () => {
    mockAddExpense.mockRejectedValue(new Error('boom'));
    const expense = makeExpense();
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      actualSpent: expense.amount,
      expenses: [expense],
    });
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    await copyRowToMonth(r, 'budget-duplicate-spent');
    expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Error')).toBe(true);
  });

  it('alerts when a planned delete fails', async () => {
    mockDeleteItem.mockRejectedValue(new Error('boom'));
    mockGetMonthlyOverview.mockResolvedValue(AFFORDABLE_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro');
    act(() => r.root.findByProps({ testID: 'budget-delete-planned' }).props.onPress());
    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Delete planned spending');
    const buttons = call![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')!.onPress?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Error')).toBe(true);
  });

  it('alerts when a spent delete fails', async () => {
    mockDeleteExpense.mockRejectedValue(new Error('boom'));
    const expense = makeExpense();
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      actualSpent: expense.amount,
      expenses: [expense],
    });
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    act(() => r.root.findByProps({ testID: 'budget-delete-spent' }).props.onPress());
    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Delete spending');
    const buttons = call![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')!.onPress?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Error')).toBe(true);
  });
});

describe('BudgetSpendingsView — remaining branches', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => {
    (Alert.alert as jest.Mock).mockRestore?.();
  });

  it('renders deferred and other (undated) planned sections', async () => {
    const affordable = makeBudgetItem({ id: 'bi-aff', title: 'Affordable', target_date: '2026-07-20' });
    const deferred = makeBudgetItem({ id: 'bi-def', title: 'Deferred', target_date: '2026-07-25' });
    const other = makeBudgetItem({ id: 'bi-other', title: 'Someday', target_date: null });
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      items: [affordable, deferred, other],
      itemCount: 3,
      affordability: {
        remaining_budget: 50000,
        used_budget: 0,
        affordable: [
          { id: affordable.id, title: affordable.title, priority: affordable.priority, target_date: affordable.target_date, status: affordable.status, estimatedCost: 4000, score: 1, reason: 'fits' },
        ],
        deferred: [
          { id: deferred.id, title: deferred.title, priority: deferred.priority, target_date: deferred.target_date, status: deferred.status, estimatedCost: 4000, score: 1, reason: "doesn't fit" },
        ],
      },
    });
    const r = await renderLoaded('iPhone 14 Pro');
    const text = treeText(r);
    expect(text).toMatch(/doesn't fit yet/i);
    expect(text).toContain('Deferred');
    expect(text).toMatch(/planned · other/i);
    expect(text).toContain('Someday');
  });

  it('renders a cost range when min and max differ', async () => {
    const item = makeBudgetItem({ estimated_cost_min: 4000, estimated_cost_max: 9000 });
    mockGetMonthlyOverview.mockResolvedValue(AFFORDABLE_OVERVIEW(item));
    const r = await renderLoaded('iPhone 14 Pro');
    expect(treeText(r)).toMatch(/\$40 - \$90/);
  });

  it('swallows a load error without crashing', async () => {
    mockGetMonthlyOverview.mockRejectedValue(new Error('boom'));
    const r = await renderLoaded('iPhone 14 Pro');
    // Falls back to the empty state (no overview loaded).
    expect(treeText(r)).toContain('No planned spendings yet');
  });

  it('regression: a failed reload clears the previous data (never shows stale cross-month data)', async () => {
    // First load succeeds with an expense…
    const expense = makeExpense();
    mockGetMonthlyOverview.mockResolvedValueOnce({
      ...EMPTY_OVERVIEW,
      actualSpent: expense.amount,
      expenses: [expense],
    });
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    expect(treeText(r)).toContain('Groceries');

    // …then the next load (e.g. after switching month) fails. The stale expense
    // must NOT linger — otherwise every month renders the last good response.
    mockGetMonthlyOverview.mockRejectedValue(new Error('boom'));
    await act(async () => {
      mockBudgetDataRevision = 7;
      r.update(wrapWithProviders(<BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(treeText(r)).not.toContain('Groceries');
    expect(treeText(r)).toContain('Nothing spent this month yet');
  });

  it('reloads when the budget data revision bumps', async () => {
    mockBudgetDataRevision = 5;
    await renderLoaded('iPhone 14 Pro');
    // Focus effect + the dataRevision effect each call the overview loader.
    expect(mockGetMonthlyOverview.mock.calls.length).toBeGreaterThan(1);
  });

  it('renders no quick-add row on the spent tab either', async () => {
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />
    );
    expect(r.root.findAllByProps({ testID: 'budget-quick-add-row' })).toHaveLength(0);
  });
});

describe('BudgetSpendingsView — multi-select (planned tab)', () => {
  const TWO_ITEM_OVERVIEW = (): MonthlyOverview => {
    const a = makeBudgetItem({ id: 'bi-a', title: 'Water filter', target_date: '2026-07-15' });
    const b = makeBudgetItem({ id: 'bi-b', title: 'Air filter', target_date: '2026-07-20' });
    return {
      ...EMPTY_OVERVIEW,
      items: [a, b],
      itemCount: 2,
      affordability: {
        remaining_budget: 50000,
        used_budget: 0,
        affordable: [
          { id: a.id, title: a.title, priority: a.priority, target_date: a.target_date, status: a.status, estimatedCost: 4000, score: 1, reason: 'fits' },
          { id: b.id, title: b.title, priority: b.priority, target_date: b.target_date, status: b.status, estimatedCost: 4000, score: 1, reason: 'fits' },
        ],
        deferred: [],
      },
    };
  };

  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateItem.mockReset();
    mockDeleteItem.mockReset();
    mockCreateItem.mockResolvedValue({ item: makeBudgetItem({ id: 'bi-copy' }) });
    mockDeleteItem.mockResolvedValue({});
  });
  afterEach(() => {
    (Alert.alert as jest.Mock).mockRestore?.();
  });

  it('shows a Select button on the planned tab only when items exist', async () => {
    mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro');
    expect(r.root.findByProps({ testID: 'budget-planned-select' })).toBeTruthy();
  });

  it('hides the Select button when the planned tab is empty', async () => {
    mockGetMonthlyOverview.mockResolvedValue(EMPTY_OVERVIEW);
    const r = await renderLoaded('iPhone 14 Pro');
    expect(r.root.findAllByProps({ testID: 'budget-planned-select' })).toHaveLength(0);
  });

  it('shows the spent-tab Select in the section header, not the planned one', async () => {
    const expense = makeExpense();
    mockGetMonthlyOverview.mockResolvedValue({ ...EMPTY_OVERVIEW, actualSpent: expense.amount, expenses: [expense] });
    const r = await renderLoaded('iPhone 14 Pro', <BudgetSpendingsView {...DEFAULT_PROPS} variant="spent" />);
    // Both tabs put Select beside "See all"; the spent tab carries its own id.
    expect(r.root.findByProps({ testID: 'budget-spent-select' })).toBeTruthy();
    expect(r.root.findAllByProps({ testID: 'budget-planned-select' })).toHaveLength(0);
  });

  it('enters selection mode and toggles a row, updating the counter', async () => {
    mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro');
    act(() => r.root.findByProps({ testID: 'budget-planned-select' }).props.onPress());

    // Toolbar shows and starts with a zero-select prompt.
    expect(r.root.findByProps({ testID: 'budget-selection-toolbar' })).toBeTruthy();
    expect(treeText(r)).toContain('Select planned items');

    act(() => r.root.findByProps({ testID: 'budget-select-row-bi-a' }).props.onPress());
    expect(treeText(r)).toContain('1 selected');
  });

  // Regression: the toolbar used to sit in the scrolling body, so ticking rows
  // further down the list scrolled Cancel / Copy / Delete off screen. It now
  // rides inside the pinned month header (sticky child 0) and stays reachable.
  it('keeps the selection toolbar pinned inside the sticky month header', async () => {
    mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro');
    act(() => r.root.findByProps({ testID: 'budget-planned-select' }).props.onPress());

    const header = r.root.findByType(BudgetMonthHeader);
    expect(header.findAllByProps({ testID: 'budget-selection-toolbar' }).length).toBeGreaterThan(0);
    expect(header.findAllByProps({ testID: 'budget-selection-cancel' }).length).toBeGreaterThan(0);
    expect(header.findAllByProps({ testID: 'budget-batch-delete' }).length).toBeGreaterThan(0);
    expect(header.findAllByProps({ testID: 'budget-batch-copy' }).length).toBeGreaterThan(0);

    // …and that header is still the scroll's pinned child.
    const scroll = r.root.findAllByProps({ testID: 'budget-planned-spendings' })[0];
    expect(scroll.props.stickyHeaderIndices).toEqual([0]);
  });

  it('selects and clears all rows via the toolbar toggle', async () => {
    mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro');
    act(() => r.root.findByProps({ testID: 'budget-planned-select' }).props.onPress());

    act(() => r.root.findByProps({ testID: 'budget-selection-selectall' }).props.onPress());
    expect(treeText(r)).toContain('2 selected');

    // Now labelled "Clear" — a second tap deselects all.
    act(() => r.root.findByProps({ testID: 'budget-selection-selectall' }).props.onPress());
    expect(treeText(r)).toContain('Select planned items');
  });

  it('Cancel exits selection mode and hands the header its "+" back', async () => {
    mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
    const onSelectionModeChange = jest.fn();
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} onSelectionModeChange={onSelectionModeChange} />
    );
    act(() => r.root.findByProps({ testID: 'budget-planned-select' }).props.onPress());
    expect(onSelectionModeChange).toHaveBeenLastCalledWith(true);

    act(() => r.root.findByProps({ testID: 'budget-selection-cancel' }).props.onPress());
    expect(onSelectionModeChange).toHaveBeenLastCalledWith(false);
    expect(r.root.findAllByProps({ testID: 'budget-selection-toolbar' })).toHaveLength(0);
  });

  it('batch-copies the selected items into the chosen month with shifted dates', async () => {
    const onMonthChange = jest.fn();
    mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} onMonthChange={onMonthChange} />
    );
    act(() => r.root.findByProps({ testID: 'budget-planned-select' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-select-row-bi-a' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-select-row-bi-b' }).props.onPress());

    // Open the copy sheet (defaults to next month = Aug 2026) and pick September.
    act(() => r.root.findByProps({ testID: 'budget-batch-copy' }).props.onPress());
    expect(r.root.findByProps({ testID: 'budget-copy-month-sheet' })).toBeTruthy();
    act(() => r.root.findByProps({ testID: 'budget-copy-month-9' }).props.onPress());

    await act(async () => {
      r.root.findByProps({ testID: 'budget-copy-confirm' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockCreateItem).toHaveBeenCalledTimes(2);
    expect(mockCreateItem).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ title: 'Water filter', target_date: '2026-09-15' })
    );
    expect(mockCreateItem).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ title: 'Air filter', target_date: '2026-09-20' })
    );
    // Jumps to the destination month so the copies are visible/editable.
    expect(onMonthChange).toHaveBeenCalledWith(2026, 9);
  });

  it('copy defaults to next month when confirmed without changing the grid', async () => {
    const onMonthChange = jest.fn();
    mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...DEFAULT_PROPS} onMonthChange={onMonthChange} />
    );
    act(() => r.root.findByProps({ testID: 'budget-planned-select' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-select-row-bi-a' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-batch-copy' }).props.onPress());
    await act(async () => {
      r.root.findByProps({ testID: 'budget-copy-confirm' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCreateItem).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ target_date: '2026-08-15' })
    );
    expect(onMonthChange).toHaveBeenCalledWith(2026, 8);
  });

  it('batch-deletes the selected items after confirmation', async () => {
    mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro');
    act(() => r.root.findByProps({ testID: 'budget-planned-select' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-select-row-bi-a' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-select-row-bi-b' }).props.onPress());

    act(() => r.root.findByProps({ testID: 'budget-batch-delete' }).props.onPress());
    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Delete planned spendings');
    expect(call).toBeTruthy();
    const buttons = call![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')!.onPress?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockDeleteItem).toHaveBeenCalledTimes(2);
    expect(mockDeleteItem).toHaveBeenCalledWith('hh-test', 'bi-a');
    expect(mockDeleteItem).toHaveBeenCalledWith('hh-test', 'bi-b');
  });

  it('copies an undated item onto the 1st of the destination month', async () => {
    const undated = makeBudgetItem({ id: 'bi-undated', title: 'Someday', target_date: null });
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      items: [undated],
      itemCount: 1,
      affordability: { remaining_budget: 50000, used_budget: 0, affordable: [], deferred: [] },
    });
    const r = await renderLoaded('iPhone 14 Pro');
    act(() => r.root.findByProps({ testID: 'budget-planned-select' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-select-row-bi-undated' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-batch-copy' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-copy-month-10' }).props.onPress());
    await act(async () => {
      r.root.findByProps({ testID: 'budget-copy-confirm' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCreateItem).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ title: 'Someday', target_date: '2026-10-01' })
    );
  });

  it('alerts and stays in selection mode when a batch copy fails', async () => {
    mockCreateItem.mockRejectedValue(new Error('boom'));
    mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro');
    act(() => r.root.findByProps({ testID: 'budget-planned-select' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-select-row-bi-a' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-batch-copy' }).props.onPress());
    await act(async () => {
      r.root.findByProps({ testID: 'budget-copy-confirm' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Error')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spent tab multi-select — mirrors the planned batch flow (copy-to-month /
// delete) but over recorded expenses, with the Select entry in the section
// header to the left of "See all".
// ---------------------------------------------------------------------------
describe('BudgetSpendingsView — spent tab multi-select', () => {
  const spentProps = { ...DEFAULT_PROPS, variant: 'spent' as const };

  const TWO_EXPENSE_OVERVIEW = () => {
    const a = makeExpense({ id: 'exp-a', title: 'Rice', amount: 600, expense_date: '2026-07-10' });
    const b = makeExpense({ id: 'exp-b', title: 'Eggs', amount: 700, expense_date: '2026-07-22' });
    return { ...EMPTY_OVERVIEW, actualSpent: a.amount + b.amount, expenses: [a, b] };
  };

  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockAddExpense.mockReset();
    mockDeleteExpense.mockReset();
    mockAddExpense.mockResolvedValue({ expense: makeExpense({ id: 'exp-copy' }) });
    mockDeleteExpense.mockResolvedValue({});
  });
  afterEach(() => {
    (Alert.alert as jest.Mock).mockRestore?.();
  });

  it('enters selection mode from the header Select and toggles a row', async () => {
    mockGetMonthlyOverview.mockResolvedValue(TWO_EXPENSE_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro', <BudgetSpendingsView {...spentProps} />);
    act(() => r.root.findByProps({ testID: 'budget-spent-select' }).props.onPress());

    expect(r.root.findByProps({ testID: 'budget-selection-toolbar' })).toBeTruthy();
    expect(treeText(r)).toContain('Select spendings');
    // Select entry hides once the toolbar owns selection state.
    expect(r.root.findAllByProps({ testID: 'budget-spent-select' })).toHaveLength(0);

    act(() => r.root.findByProps({ testID: 'budget-select-row-exp-a' }).props.onPress());
    expect(treeText(r)).toContain('1 selected');
  });

  it('selects all expenses via the toolbar toggle', async () => {
    mockGetMonthlyOverview.mockResolvedValue(TWO_EXPENSE_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro', <BudgetSpendingsView {...spentProps} />);
    act(() => r.root.findByProps({ testID: 'budget-spent-select' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-selection-selectall' }).props.onPress());
    expect(treeText(r)).toContain('2 selected');
    act(() => r.root.findByProps({ testID: 'budget-selection-selectall' }).props.onPress());
    expect(treeText(r)).toContain('Select spendings');
  });

  it('batch-copies the selected expenses into the chosen month with shifted dates', async () => {
    const onMonthChange = jest.fn();
    mockGetMonthlyOverview.mockResolvedValue(TWO_EXPENSE_OVERVIEW());
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...spentProps} onMonthChange={onMonthChange} />
    );
    act(() => r.root.findByProps({ testID: 'budget-spent-select' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-select-row-exp-a' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-select-row-exp-b' }).props.onPress());

    act(() => r.root.findByProps({ testID: 'budget-batch-copy' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-copy-month-9' }).props.onPress());
    await act(async () => {
      r.root.findByProps({ testID: 'budget-copy-confirm' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockAddExpense).toHaveBeenCalledTimes(2);
    expect(mockAddExpense).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ title: 'Rice', amount: 600, expense_date: '2026-09-10' })
    );
    expect(mockAddExpense).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ title: 'Eggs', amount: 700, expense_date: '2026-09-22' })
    );
    expect(onMonthChange).toHaveBeenCalledWith(2026, 9);
  });

  it('batch-deletes the selected expenses after confirmation', async () => {
    mockGetMonthlyOverview.mockResolvedValue(TWO_EXPENSE_OVERVIEW());
    const r = await renderLoaded('iPhone 14 Pro', <BudgetSpendingsView {...spentProps} />);
    act(() => r.root.findByProps({ testID: 'budget-spent-select' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-select-row-exp-a' }).props.onPress());
    act(() => r.root.findByProps({ testID: 'budget-select-row-exp-b' }).props.onPress());

    act(() => r.root.findByProps({ testID: 'budget-batch-delete' }).props.onPress());
    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Delete spendings');
    expect(call).toBeTruthy();
    const buttons = call![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')!.onPress?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockDeleteExpense).toHaveBeenCalledTimes(2);
    expect(mockDeleteExpense).toHaveBeenCalledWith('hh-test', 'exp-a');
    expect(mockDeleteExpense).toHaveBeenCalledWith('hh-test', 'exp-b');
  });

  it('Cancel exits selection mode and hands the header its "+" back', async () => {
    mockGetMonthlyOverview.mockResolvedValue(TWO_EXPENSE_OVERVIEW());
    const onSelectionModeChange = jest.fn();
    const r = await renderLoaded(
      'iPhone 14 Pro',
      <BudgetSpendingsView {...spentProps} onSelectionModeChange={onSelectionModeChange} />
    );
    act(() => r.root.findByProps({ testID: 'budget-spent-select' }).props.onPress());
    expect(onSelectionModeChange).toHaveBeenLastCalledWith(true);
    act(() => r.root.findByProps({ testID: 'budget-selection-cancel' }).props.onPress());
    expect(onSelectionModeChange).toHaveBeenLastCalledWith(false);
    expect(r.root.findAllByProps({ testID: 'budget-selection-toolbar' })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pure date-shifting helper — the core of copy-to-month correctness.
// ---------------------------------------------------------------------------
describe('shiftDateToMonth', () => {
  it('preserves the day-of-month when copying within the same year', () => {
    expect(shiftDateToMonth('2026-07-15', 2026, 9)).toBe('2026-09-15');
  });

  it('preserves the day when copying across a year boundary', () => {
    expect(shiftDateToMonth('2026-12-20', 2027, 3)).toBe('2027-03-20');
  });

  it('clamps the 31st into a 30-day destination month', () => {
    expect(shiftDateToMonth('2026-01-31', 2026, 4)).toBe('2026-04-30');
  });

  it('clamps the 31st into February of a non-leap year (28)', () => {
    expect(shiftDateToMonth('2026-01-31', 2026, 2)).toBe('2026-02-28');
  });

  it('clamps the 31st into February of a leap year (29)', () => {
    expect(shiftDateToMonth('2024-01-31', 2024, 2)).toBe('2024-02-29');
  });

  it('places an undated (null) source on the 1st of the destination month', () => {
    expect(shiftDateToMonth(null, 2026, 10)).toBe('2026-10-01');
  });

  it('zero-pads single-digit destination months and days', () => {
    expect(shiftDateToMonth('2026-07-05', 2026, 1)).toBe('2026-01-05');
  });

  it('falls back to the 1st when the source day is unparseable', () => {
    // A malformed "day 00" coerces to 0 → falls back to 1.
    expect(shiftDateToMonth('2026-07-00', 2026, 9)).toBe('2026-09-01');
  });
});

// ---------------------------------------------------------------------------
// Deep interaction coverage for the planned multi-select surface.
// ---------------------------------------------------------------------------
describe('BudgetSpendingsView — multi-select (detailed)', () => {
  const makeAffordabilityRow = (item: BudgetItem) => ({
    id: item.id,
    title: item.title,
    priority: item.priority,
    target_date: item.target_date,
    status: item.status,
    estimatedCost: 4000,
    score: 1,
    reason: 'fits',
  });

  const TWO_ITEM_OVERVIEW = (): MonthlyOverview => {
    const a = makeBudgetItem({ id: 'bi-a', title: 'Water filter', target_date: '2026-07-15' });
    const b = makeBudgetItem({ id: 'bi-b', title: 'Air filter', target_date: '2026-07-20' });
    return {
      ...EMPTY_OVERVIEW,
      items: [a, b],
      itemCount: 2,
      affordability: {
        remaining_budget: 50000,
        used_budget: 0,
        affordable: [makeAffordabilityRow(a), makeAffordabilityRow(b)],
        deferred: [],
      },
    };
  };

  // Overview spanning all three planned sections: affordable, deferred, other (undated).
  const THREE_SECTION_OVERVIEW = (): MonthlyOverview => {
    const aff = makeBudgetItem({ id: 'bi-aff', title: 'Affordable', target_date: '2026-07-10' });
    const def = makeBudgetItem({ id: 'bi-def', title: 'Deferred', target_date: '2026-07-25' });
    const other = makeBudgetItem({ id: 'bi-other', title: 'Someday', target_date: null });
    return {
      ...EMPTY_OVERVIEW,
      items: [aff, def, other],
      itemCount: 3,
      affordability: {
        remaining_budget: 50000,
        used_budget: 0,
        affordable: [makeAffordabilityRow(aff)],
        deferred: [{ ...makeAffordabilityRow(def), reason: "doesn't fit" }],
      },
    };
  };

  const enterSelection = (r: ReactTestRenderer.ReactTestRenderer) => {
    act(() => r.root.findByProps({ testID: 'budget-planned-select' }).props.onPress());
  };
  const toggleRow = (r: ReactTestRenderer.ReactTestRenderer, id: string) => {
    act(() => r.root.findByProps({ testID: `budget-select-row-${id}` }).props.onPress());
  };

  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateItem.mockReset();
    mockDeleteItem.mockReset();
    mockCreateItem.mockResolvedValue({ item: makeBudgetItem({ id: 'bi-copy' }) });
    mockDeleteItem.mockResolvedValue({});
  });
  afterEach(() => {
    (Alert.alert as jest.Mock).mockRestore?.();
  });

  describe('mode transitions', () => {
    it('hides the Select button while already in selection mode', async () => {
      mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      expect(r.root.findAllByProps({ testID: 'budget-planned-select' })).toHaveLength(0);
    });

    it('replaces swipe rows with checkbox rows (no swipe edit/delete actions render)', async () => {
      mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      expect(r.root.findAllByProps({ testID: 'budget-planned-item' })).toHaveLength(0);
      expect(r.root.findAllByProps({ testID: 'budget-edit-planned' })).toHaveLength(0);
      expect(r.root.findAllByProps({ testID: 'budget-delete-planned' })).toHaveLength(0);
      expect(r.root.findByProps({ testID: 'budget-select-row-bi-a' })).toBeTruthy();
    });

    it('tapping a row in selection mode toggles selection instead of editing', async () => {
      const onEditItem = jest.fn();
      mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
      const r = await renderLoaded(
        'iPhone 14 Pro',
        <BudgetSpendingsView {...DEFAULT_PROPS} onEditItem={onEditItem} />
      );
      enterSelection(r);
      toggleRow(r, 'bi-a');
      expect(onEditItem).not.toHaveBeenCalled();
      expect(treeText(r)).toContain('1 selected');
    });

    it('a selected checkbox row reflects checked accessibility state', async () => {
      mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      toggleRow(r, 'bi-a');
      const row = r.root.findByProps({ testID: 'budget-select-row-bi-a' });
      expect(row.props.accessibilityState).toEqual({ checked: true, selected: true });
      const unselected = r.root.findByProps({ testID: 'budget-select-row-bi-b' });
      expect(unselected.props.accessibilityState).toEqual({ checked: false, selected: false });
    });

    it('deselecting a row decrements the counter', async () => {
      mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      toggleRow(r, 'bi-a');
      toggleRow(r, 'bi-b');
      expect(treeText(r)).toContain('2 selected');
      toggleRow(r, 'bi-a');
      expect(treeText(r)).toContain('1 selected');
    });

    it('resets selection when the month prop changes', async () => {
      mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      expect(r.root.findByProps({ testID: 'budget-selection-toolbar' })).toBeTruthy();

      await act(async () => {
        r.update(wrapWithProviders(<BudgetSpendingsView {...DEFAULT_PROPS} month={8} />));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(r.root.findAllByProps({ testID: 'budget-selection-toolbar' })).toHaveLength(0);
    });
  });

  describe('action-bar affordances', () => {
    it('disables Copy and Delete while nothing is selected', async () => {
      mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      expect(r.root.findByProps({ testID: 'budget-batch-copy' }).props.disabled).toBe(true);
      expect(r.root.findByProps({ testID: 'budget-batch-delete' }).props.disabled).toBe(true);
    });

    it('enables Copy and Delete once at least one row is selected', async () => {
      mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      toggleRow(r, 'bi-a');
      expect(r.root.findByProps({ testID: 'budget-batch-copy' }).props.disabled).toBe(false);
      expect(r.root.findByProps({ testID: 'budget-batch-delete' }).props.disabled).toBe(false);
    });

    it('select-all spans every section (affordable + deferred + other)', async () => {
      mockGetMonthlyOverview.mockResolvedValue(THREE_SECTION_OVERVIEW());
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      act(() => r.root.findByProps({ testID: 'budget-selection-selectall' }).props.onPress());
      expect(treeText(r)).toContain('3 selected');
    });
  });

  describe('copy sheet', () => {
    const openSheetWithSelection = async (
      overview: MonthlyOverview,
      ids: string[]
    ): Promise<ReactTestRenderer.ReactTestRenderer> => {
      mockGetMonthlyOverview.mockResolvedValue(overview);
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      ids.forEach((id) => toggleRow(r, id));
      act(() => r.root.findByProps({ testID: 'budget-batch-copy' }).props.onPress());
      return r;
    };

    it('subtitle is singular for one item, plural for many', async () => {
      const r = await openSheetWithSelection(TWO_ITEM_OVERVIEW(), ['bi-a']);
      expect(treeText(r)).toMatch(/1 planned spending will be copied/);
      act(() => r.root.findByProps({ testID: 'budget-copy-cancel' }).props.onPress());

      const r2 = await openSheetWithSelection(TWO_ITEM_OVERVIEW(), ['bi-a', 'bi-b']);
      expect(treeText(r2)).toMatch(/2 planned spendings will be copied/);
    });

    it('defaults the grid to next month and labels the confirm button with it', async () => {
      const r = await openSheetWithSelection(TWO_ITEM_OVERVIEW(), ['bi-a']);
      // Source is Jul 2026 → default target Aug 2026.
      expect(r.root.findByProps({ testID: 'budget-copy-confirm' }).props.title).toBe('Copy to Aug');
      expect(r.root.findByProps({ testID: 'budget-copy-month-8' }).props.accessibilityState).toEqual({
        selected: true,
      });
    });

    it('marks the source month cell with a "this month" hint', async () => {
      const r = await openSheetWithSelection(TWO_ITEM_OVERVIEW(), ['bi-a']);
      expect(treeText(r)).toContain('this month');
    });

    it('picking a different month updates the selected cell and confirm label', async () => {
      const r = await openSheetWithSelection(TWO_ITEM_OVERVIEW(), ['bi-a']);
      act(() => r.root.findByProps({ testID: 'budget-copy-month-9' }).props.onPress());
      expect(r.root.findByProps({ testID: 'budget-copy-confirm' }).props.title).toBe('Copy to Sep');
      expect(r.root.findByProps({ testID: 'budget-copy-month-9' }).props.accessibilityState).toEqual({
        selected: true,
      });
      expect(r.root.findByProps({ testID: 'budget-copy-month-8' }).props.accessibilityState).toEqual({
        selected: false,
      });
    });

    it('year stepper advances the year and copies into it', async () => {
      const onMonthChange = jest.fn();
      mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
      const r = await renderLoaded(
        'iPhone 14 Pro',
        <BudgetSpendingsView {...DEFAULT_PROPS} onMonthChange={onMonthChange} />
      );
      enterSelection(r);
      toggleRow(r, 'bi-a');
      act(() => r.root.findByProps({ testID: 'budget-batch-copy' }).props.onPress());
      act(() => r.root.findByProps({ testID: 'budget-copy-year-next' }).props.onPress());
      expect(treeText(r)).toContain('2027');
      await act(async () => {
        r.root.findByProps({ testID: 'budget-copy-confirm' }).props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });
      // Aug (default month) of the advanced year, day preserved.
      expect(mockCreateItem).toHaveBeenCalledWith(
        'hh-test',
        expect.objectContaining({ target_date: '2027-08-15' })
      );
      expect(onMonthChange).toHaveBeenCalledWith(2027, 8);
    });

    it('Cancel closes the sheet without creating anything', async () => {
      const r = await openSheetWithSelection(TWO_ITEM_OVERVIEW(), ['bi-a']);
      act(() => r.root.findByProps({ testID: 'budget-copy-cancel' }).props.onPress());
      expect(r.root.findAllByProps({ testID: 'budget-copy-month-sheet' })).toHaveLength(0);
      expect(mockCreateItem).not.toHaveBeenCalled();
    });

    it('copies every populated field onto the new item', async () => {
      const rich = makeBudgetItem({
        id: 'bi-rich',
        title: 'Gym membership',
        description: 'Annual plan',
        category_id: 'cat-health',
        timeframe: '1_month',
        priority: 'critical',
        estimated_cost_min: 5000,
        estimated_cost_max: 7000,
        is_recurring: true,
        recurrence_frequency: 'monthly',
        target_date: '2026-07-15',
      });
      const overview: MonthlyOverview = {
        ...EMPTY_OVERVIEW,
        items: [rich],
        itemCount: 1,
        affordability: {
          remaining_budget: 50000,
          used_budget: 0,
          affordable: [makeAffordabilityRow(rich)],
          deferred: [],
        },
      };
      const r = await openSheetWithSelection(overview, ['bi-rich']);
      await act(async () => {
        r.root.findByProps({ testID: 'budget-copy-confirm' }).props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockCreateItem).toHaveBeenCalledWith('hh-test', {
        title: 'Gym membership',
        description: 'Annual plan',
        category_id: 'cat-health',
        timeframe: '1_month',
        priority: 'critical',
        estimated_cost_min: 5000,
        estimated_cost_max: 7000,
        is_recurring: true,
        recurrence_frequency: 'monthly',
        target_date: '2026-08-15',
      });
    });

    it('copies all three sections when select-all is used', async () => {
      mockGetMonthlyOverview.mockResolvedValue(THREE_SECTION_OVERVIEW());
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      act(() => r.root.findByProps({ testID: 'budget-selection-selectall' }).props.onPress());
      act(() => r.root.findByProps({ testID: 'budget-batch-copy' }).props.onPress());
      await act(async () => {
        r.root.findByProps({ testID: 'budget-copy-confirm' }).props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockCreateItem).toHaveBeenCalledTimes(3);
      // The undated "Someday" lands on the 1st of the destination month.
      expect(mockCreateItem).toHaveBeenCalledWith(
        'hh-test',
        expect.objectContaining({ title: 'Someday', target_date: '2026-08-01' })
      );
    });

    it('marks the budget data dirty after a successful copy', async () => {
      const r = await openSheetWithSelection(TWO_ITEM_OVERVIEW(), ['bi-a']);
      await act(async () => {
        r.root.findByProps({ testID: 'budget-copy-confirm' }).props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockMarkInsightsDirty).toHaveBeenCalledWith('hh-test');
    });
  });

  describe('batch delete', () => {
    it('makes no API calls when the delete alert is cancelled', async () => {
      mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      toggleRow(r, 'bi-a');
      act(() => r.root.findByProps({ testID: 'budget-batch-delete' }).props.onPress());
      const call = (Alert.alert as jest.Mock).mock.calls.find(
        (c) => c[0] === 'Delete planned spendings'
      );
      const buttons = call![2] as { text: string; style?: string; onPress?: () => void }[];
      act(() => buttons.find((b) => b.text === 'Cancel')!.onPress?.());
      expect(mockDeleteItem).not.toHaveBeenCalled();
    });

    it('uses singular copy for one item and plural for many in the confirm alert', async () => {
      mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      toggleRow(r, 'bi-a');
      act(() => r.root.findByProps({ testID: 'budget-batch-delete' }).props.onPress());
      let call = (Alert.alert as jest.Mock).mock.calls.find(
        (c) => c[0] === 'Delete planned spendings'
      );
      expect(call![1]).toMatch(/Delete 1 selected planned spending\?/);

      toggleRow(r, 'bi-b');
      act(() => r.root.findByProps({ testID: 'budget-batch-delete' }).props.onPress());
      call = (Alert.alert as jest.Mock).mock.calls
        .reverse()
        .find((c) => c[0] === 'Delete planned spendings');
      expect(call![1]).toMatch(/Delete 2 selected planned spendings\?/);
    });

    it('exits selection mode and marks data dirty after a successful batch delete', async () => {
      mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      toggleRow(r, 'bi-a');
      act(() => r.root.findByProps({ testID: 'budget-batch-delete' }).props.onPress());
      const call = (Alert.alert as jest.Mock).mock.calls.find(
        (c) => c[0] === 'Delete planned spendings'
      );
      const buttons = call![2] as { text: string; onPress?: () => void }[];
      await act(async () => {
        buttons.find((b) => b.text === 'Delete')!.onPress?.();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockMarkInsightsDirty).toHaveBeenCalledWith('hh-test');
      expect(r.root.findAllByProps({ testID: 'budget-selection-toolbar' })).toHaveLength(0);
    });

    it('alerts when a batch delete fails', async () => {
      mockDeleteItem.mockRejectedValue(new Error('boom'));
      mockGetMonthlyOverview.mockResolvedValue(TWO_ITEM_OVERVIEW());
      const r = await renderLoaded('iPhone 14 Pro');
      enterSelection(r);
      toggleRow(r, 'bi-a');
      act(() => r.root.findByProps({ testID: 'budget-batch-delete' }).props.onPress());
      const call = (Alert.alert as jest.Mock).mock.calls.find(
        (c) => c[0] === 'Delete planned spendings'
      );
      const buttons = call![2] as { text: string; onPress?: () => void }[];
      await act(async () => {
        buttons.find((b) => b.text === 'Delete')!.onPress?.();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Error')).toBe(true);
    });
  });
});
