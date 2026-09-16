/**
 * Publisher-hook behaviour: when the App Group snapshots are (and are not)
 * written from the live Budget dashboard.
 *
 * Matrix: BUDGET-WIDGET-001/004/005, BUDGET-WATCH-001/006.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { MonthlyOverview } from '@api/budget';

import { useBudgetSnapshotPublisher } from '../budgetSnapshot';

jest.mock('@services/widget-sync', () => ({
  widgetSync: { setSnapshot: jest.fn() },
}));

jest.mock('@brand/capabilities', () => ({
  ...jest.requireActual('@brand/capabilities'),
  isFullBudget: jest.fn(() => true),
}));

 
const { widgetSync } = require('@services/widget-sync') as {
  widgetSync: { setSnapshot: jest.Mock };
};
 
const { isFullBudget } = require('@brand/capabilities') as { isFullBudget: jest.Mock };

function overview(partial: Partial<MonthlyOverview> = {}): MonthlyOverview {
  return {
    plannedBudget: 500000,
    actualSpent: 200000,
    remainingBudget: 300000,
    committedTotal: 0,
    ...partial,
  } as MonthlyOverview;
}

function Harness({
  overview: ov,
  periodLabel,
  savingsCurrentCents,
  savingsPreviousCents,
  projectedYearEndCents,
  insightMessage,
}: {
  overview: MonthlyOverview | null;
  periodLabel?: string;
  savingsCurrentCents?: number;
  savingsPreviousCents?: number;
  projectedYearEndCents?: number;
  insightMessage?: string;
}) {
  useBudgetSnapshotPublisher(ov, {
    periodLabel,
    savingsCurrentCents,
    savingsPreviousCents,
    projectedYearEndCents,
    insightMessage,
  });
  return null;
}

/** Keys written across all calls so far. */
function writtenKeys(): string[] {
  return widgetSync.setSnapshot.mock.calls.map((c) => c[0]);
}

/** Mount the harness and return a rerender helper, mirroring the RTL shape. */
function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return {
    rerender(next: React.ReactElement) {
      act(() => {
        renderer.update(next);
      });
    },
  };
}

beforeEach(() => {
  widgetSync.setSnapshot.mockClear();
  isFullBudget.mockReturnValue(true);
});

it('BUDGET-WIDGET-001 / BUDGET-WATCH-001: publishes both keys once the overview loads', () => {
  render(<Harness overview={overview()} periodLabel="Jul 2026" />);

  expect(writtenKeys()).toEqual(['widget_budget_summary', 'watch_budget_today']);
});

it('BUDGET-WIDGET-004 / BUDGET-WATCH-006: writes nothing while the overview is null', () => {
  render(<Harness overview={null} periodLabel="Jul 2026" />);

  // A zeroed snapshot here would flash "$0 remaining" on both surfaces.
  expect(widgetSync.setSnapshot).not.toHaveBeenCalled();
});

it('BUDGET-WIDGET-004: publishes on the transition from null to loaded', () => {
  const { rerender } = render(<Harness overview={null} periodLabel="Jul 2026" />);
  expect(widgetSync.setSnapshot).not.toHaveBeenCalled();

  rerender(<Harness overview={overview()} periodLabel="Jul 2026" />);
  expect(writtenKeys()).toEqual(['widget_budget_summary', 'watch_budget_today']);
});

it('BUDGET-WIDGET-005: republishes when the period changes', () => {
  const ovJul = overview();
  const { rerender } = render(<Harness overview={ovJul} periodLabel="Jul 2026" />);
  widgetSync.setSnapshot.mockClear();

  rerender(<Harness overview={ovJul} periodLabel="Aug 2026" />);

  const payloads = widgetSync.setSnapshot.mock.calls.map((c) => c[1]);
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).toMatchObject({ period_label: 'Aug 2026' });
  expect(payloads[1]).toMatchObject({ period_label: 'Aug 2026' });
});

it('BUDGET-WIDGET-005: does not republish when nothing changed', () => {
  const ov = overview();
  const { rerender } = render(<Harness overview={ov} periodLabel="Jul 2026" />);
  widgetSync.setSnapshot.mockClear();

  rerender(<Harness overview={ov} periodLabel="Jul 2026" />);

  expect(widgetSync.setSnapshot).not.toHaveBeenCalled();
});

it("BUDGET-WIDGET-001: House minimal-budget mode does not overwrite Budget's keys", () => {
  // House renders the same dashboard in minimal mode; it must not publish.
  isFullBudget.mockReturnValue(false);

  render(<Harness overview={overview()} periodLabel="Jul 2026" />);

  expect(widgetSync.setSnapshot).not.toHaveBeenCalled();
});

it('BUDGET-WIDGET-017: republishes the widget payload when savings figures arrive after the overview', () => {
  // Savings loads from a separate endpoint than the overview, so it commonly
  // resolves a tick later — the widget snapshot must catch up, not pin to
  // whatever was known on the first publish.
  const ov = overview();
  const { rerender } = render(
    <Harness overview={ov} periodLabel="Jul 2026" />,
  );
  widgetSync.setSnapshot.mockClear();

  rerender(
    <Harness
      overview={ov}
      periodLabel="Jul 2026"
      savingsCurrentCents={42000}
      savingsPreviousCents={31500}
    />,
  );

  const [widgetPayload] = widgetSync.setSnapshot.mock.calls.map(c => c[1]);
  expect(widgetPayload).toMatchObject({
    savings_cents: 42000,
    savings_prev_cents: 31500,
  });
});

it('republishes both the widget and Watch payloads once the year-end projection arrives', () => {
  const ov = overview();
  const { rerender } = render(
    <Harness overview={ov} periodLabel="Jul 2026" />,
  );
  widgetSync.setSnapshot.mockClear();

  rerender(
    <Harness overview={ov} periodLabel="Jul 2026" projectedYearEndCents={4_200_000} />,
  );

  const [widgetPayload, watchPayload] = widgetSync.setSnapshot.mock.calls.map(c => c[1]);
  expect(widgetPayload).toMatchObject({ projected_year_end_cents: 4_200_000 });
  expect(watchPayload).toMatchObject({ projected_year_end: 42_000 });
});

it('BUDGET-WIDGET-018: republishes when the AI insight arrives', () => {
  const ov = overview();
  const { rerender } = render(
    <Harness overview={ov} periodLabel="Jul 2026" />,
  );
  widgetSync.setSnapshot.mockClear();

  rerender(
    <Harness
      overview={ov}
      periodLabel="Jul 2026"
      insightMessage="You're on pace to beat last month."
    />,
  );

  const [widgetPayload] = widgetSync.setSnapshot.mock.calls.map(c => c[1]);
  expect(widgetPayload).toMatchObject({
    insight_message: "You're on pace to beat last month.",
  });
});
