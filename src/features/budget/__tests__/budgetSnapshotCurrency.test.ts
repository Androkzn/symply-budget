/**
 * The display currency on the two surfaces that cannot read the store: the iOS
 * home-screen widget and the Watch face.
 *
 * Both render a JSON snapshot pushed into the App Group, and both fall back on
 * their own when the code is missing — the widget to USD (`BudgetBrief.currency`
 * in SymplyBudgetWidgetContent.swift), the watch to the device locale. So an
 * omitted code is not a neutral default: it renders every figure in a currency
 * the member did not pick, which is exactly what shipped ("US$2,000" on the home
 * screen after switching Settings → Currency).
 *
 * Matrix: BUDGET-WIDGET-021, BUDGET-WIDGET-022, BUDGET-WATCH-011.
 */
import type { MonthlyOverview } from '@api/budget';
import { isFullBudget } from '@brand/capabilities';
import { widgetSync } from '@services/widget-sync';
import { useAppStore } from '@stores/appStore';

import {
  publishBudgetSnapshots,
  republishBudgetSnapshots,
  startBudgetSnapshotWatcher,
} from '../budgetSnapshot';

jest.mock('@services/widget-sync', () => ({
  widgetSync: { setSnapshot: jest.fn() },
}));

jest.mock('@brand/capabilities', () => ({
  ...jest.requireActual('@brand/capabilities'),
  isFullBudget: jest.fn(() => true),
}));

const setSnapshot = widgetSync.setSnapshot as jest.Mock;
const isFullBudgetMock = isFullBudget as jest.Mock;

function overview(partial: Partial<MonthlyOverview> = {}): MonthlyOverview {
  return {
    plannedBudget: 500000,
    actualSpent: 200000,
    remainingBudget: 300000,
    committedTotal: 0,
    ...partial,
  } as MonthlyOverview;
}

/** `[widgetPayload, watchPayload]` from the last publish. */
function lastPayloads(): [Record<string, unknown>, Record<string, unknown>] {
  const calls = setSnapshot.mock.calls;
  return [calls[calls.length - 2][1], calls[calls.length - 1][1]];
}

/**
 * Set the preference without going through `setCurrency`, which also queues a
 * debounced server sync. Subscribers fire either way — the sync is not what is
 * under test here.
 */
function selectCurrency(code: 'USD' | 'CAD' | 'EUR'): void {
  useAppStore.setState({ currency: code });
}

beforeEach(() => {
  // The publish cache is module state and would otherwise leak between cases —
  // a watcher's stop function is what drops it.
  startBudgetSnapshotWatcher()();
  setSnapshot.mockClear();
  isFullBudgetMock.mockReturnValue(true);
  selectCurrency('USD');
});

describe('currency on the published snapshot', () => {
  it('BUDGET-WIDGET-021 / BUDGET-WATCH-011: falls back to the display preference when the caller omits it', () => {
    selectCurrency('EUR');

    publishBudgetSnapshots(overview(), { periodLabel: 'Jul 2026' });

    const [widget, watch] = lastPayloads();
    // Two different key names on purpose — BudgetSummary decodes `currency`,
    // BudgetToday decodes `currency_code`.
    expect(widget).toMatchObject({ currency: 'EUR' });
    expect(watch).toMatchObject({ currency_code: 'EUR' });
  });

  it('BUDGET-WIDGET-021: an explicit currency from the caller wins', () => {
    selectCurrency('EUR');

    publishBudgetSnapshots(overview(), { currency: 'CAD' });

    const [widget, watch] = lastPayloads();
    expect(widget).toMatchObject({ currency: 'CAD' });
    expect(watch).toMatchObject({ currency_code: 'CAD' });
  });
});

describe('startBudgetSnapshotWatcher', () => {
  it('BUDGET-WIDGET-022 / BUDGET-WATCH-011: republishes both keys when the preference changes', () => {
    publishBudgetSnapshots(overview(), { periodLabel: 'Jul 2026' });
    const stop = startBudgetSnapshotWatcher();
    setSnapshot.mockClear();

    selectCurrency('CAD');

    // The figures are unchanged — only the code the surfaces format them with.
    const [widget, watch] = lastPayloads();
    expect(widget).toMatchObject({ currency: 'CAD', remaining_cents: 300000 });
    expect(watch).toMatchObject({ currency_code: 'CAD', remaining: 3000 });
    stop();
  });

  it('BUDGET-WIDGET-022: republishing keeps the rest of the last payload', () => {
    publishBudgetSnapshots(overview(), {
      periodLabel: 'Jul 2026',
      savingsCurrentCents: 42000,
      insightMessage: "You're on pace to beat last month.",
    });
    const stop = startBudgetSnapshotWatcher();
    setSnapshot.mockClear();

    selectCurrency('CAD');

    const [widget] = lastPayloads();
    expect(widget).toMatchObject({
      period_label: 'Jul 2026',
      savings_cents: 42000,
      insight_message: "You're on pace to beat last month.",
    });
    stop();
  });

  it('BUDGET-WIDGET-022: writes nothing when the preference is re-selected unchanged', () => {
    publishBudgetSnapshots(overview());
    const stop = startBudgetSnapshotWatcher();
    setSnapshot.mockClear();

    selectCurrency('USD');

    expect(setSnapshot).not.toHaveBeenCalled();
    stop();
  });

  it('BUDGET-WIDGET-022: stopping drops the cached figures', () => {
    // The cache holds one household's balances. Sign-out tears the watcher down;
    // the next member's currency change must not be able to re-publish them.
    publishBudgetSnapshots(overview());
    const stop = startBudgetSnapshotWatcher();
    stop();
    setSnapshot.mockClear();

    selectCurrency('CAD');
    expect(setSnapshot).not.toHaveBeenCalled();

    expect(republishBudgetSnapshots()).toBe(false);
    expect(setSnapshot).not.toHaveBeenCalled();
  });

  it('BUDGET-WIDGET-022: republishes nothing before a first publish', () => {
    // A republish is a refresh of known figures, never a first write — otherwise
    // a currency change could flash "$0 remaining" (BUDGET-WIDGET-004).
    const stop = startBudgetSnapshotWatcher();

    selectCurrency('CAD');

    expect(setSnapshot).not.toHaveBeenCalled();
    stop();
  });

  it("BUDGET-WIDGET-022: House's minimal-budget mode never republishes Budget's keys", () => {
    publishBudgetSnapshots(overview());
    const stop = startBudgetSnapshotWatcher();
    setSnapshot.mockClear();
    isFullBudgetMock.mockReturnValue(false);

    selectCurrency('CAD');

    expect(setSnapshot).not.toHaveBeenCalled();
    stop();
  });
});
