/**
 * SavingsGoalsView — Goals sub-view, self-fetch + navigation behaviour.
 *
 * Prop-less tab body that fetches its own goal list via `savingsApi.listGoals`.
 * Every money figure (target / current / paceCents) is BE-computed — this test
 * asserts the view RENDERS those figures (no local math) and wires the "Add
 * goal" and card-tap navigations correctly. (Registered accounts moved to the
 * dedicated Pension tab, so the old "Registered accounts →" link is gone.)
 */

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: {} }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockNavigate = jest.fn();
// Stable navigation object across renders.
const mockNavigation = { goBack: jest.fn(), navigate: mockNavigate };

const mockListGoals = jest.fn();

jest.mock('@api/savings', () => ({
  savingsApi: {
    listGoals: (...args: unknown[]) => mockListGoals(...args),
  },
}));

jest.mock('@stores/householdStore', () => {
  const state: { currentHousehold: { id: string } | null } = {
    currentHousehold: { id: 'hh-test' },
  };
  const useHouseholdStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  // Test-only handle to simulate the decoupled-household "nothing selected" case.
  (useHouseholdStore as unknown as { __setHousehold: (h: typeof state.currentHousehold) => void }).__setHousehold =
    (h) => {
      state.currentHousehold = h;
    };
  return { useHouseholdStore };
});

jest.mock('@stores/savingsStore', () => {
  const state = { dataRevision: 0 };
  const useSavingsStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  return { useSavingsStore };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { useHouseholdStore } from '@stores/householdStore';

import { SavingsGoalsView } from '../SavingsGoalsView';

const setHousehold = (useHouseholdStore as unknown as {
  __setHousehold: (h: { id: string } | null) => void;
}).__setHousehold;

function goal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    household_id: 'hh-test',
    type: 'emergency_fund',
    name: 'Safety Pillow',
    target_amount_cents: 1000000,
    current_amount_cents: 250000,
    target_date: null,
    months_of_expenses: 6,
    monthly_allocation_cents: 50000,
    currency: 'CAD',
    status: 'active',
    created_at: '',
    updated_at: '',
    paceCents: 60000,
    ...overrides,
  };
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsGoalsView />
      </ThemeProvider>
    );
  });
  return tree;
}

/** Collect all rendered Text strings for BE-figure assertions. */
function allText(root: ReactTestRenderer.ReactTestInstance): string {
  return root
    .findAllByType('Text' as any)
    .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children))
    .filter((c) => typeof c === 'string')
    .join(' | ');
}

describe('SavingsGoalsView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHousehold({ id: 'hh-test' });
    mockListGoals.mockResolvedValue({ goals: [goal()] });
  });

  it('fetches and renders the goal with BE-computed figures (name + current/target + pace)', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    expect(mockListGoals).toHaveBeenCalledWith('hh-test');
    // The card for the seeded goal rendered.
    expect(root.findByProps({ testID: 'savings-goal-card-g1' })).toBeTruthy();

    const text = allText(root);
    expect(text).toContain('Safety Pillow');
    // BE current (250000 cents → $2500 → "$2,500") and target (1000000 cents → "$10,000").
    expect(text).toContain('$2,500');
    expect(text).toContain('$10,000');
    // BE pace (60000 cents → $600) surfaced verbatim, not locally recomputed.
    expect(text).toContain('$600');
  });

  it('navigates to the goal form (no params) via the "Add goal" button', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-goals-add-list' }).props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('SavingsGoalForm');
  });

  it('navigates to the goal form with { goalId } when a card is tapped', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-goal-card-g1' }).props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('SavingsGoalForm', { goalId: 'g1' });
  });

  it('no longer shows a "Registered accounts" link (relocated to the Pension tab)', async () => {
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'savings-goals-registered-link' })).toHaveLength(0);
  });

  it('shows the empty state whose action navigates to the goal form', async () => {
    mockListGoals.mockResolvedValue({ goals: [] });
    const tree = await renderScreen();
    const root = tree.root;

    const text = allText(root);
    expect(text).toContain('No savings goals yet');
    // No goal cards present.
    expect(root.findAllByProps({ testID: 'savings-goal-card-g1' }).length).toBe(0);

    // The empty-state CTA also routes to the goal form.
    await act(async () => {
      root.findByProps({ testID: 'savings-goals-add-empty' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('SavingsGoalForm');
  });

  it('clears the spinner into the empty state when no household is selected (no infinite spinner)', async () => {
    // Budget's decoupled households can be unset; load() must not early-return
    // before flipping isLoading off, or the Goals tab spins forever.
    setHousehold(null);
    const tree = await renderScreen();
    const root = tree.root;

    // Never hits the API…
    expect(mockListGoals).not.toHaveBeenCalled();
    // …and the loading spinner is gone (empty state is shown instead).
    expect(root.findAllByProps({ testID: 'savings-goals-loading' }).length).toBe(0);
    expect(allText(root)).toContain('No savings goals yet');
  });

  it('shows "Fully funded" for an achieved goal', async () => {
    mockListGoals.mockResolvedValue({
      goals: [goal({ status: 'achieved', paceCents: 0 })],
    });
    const tree = await renderScreen();
    expect(allText(tree.root)).toContain('Fully funded');
  });

  it('falls back to the monthly allocation line when there is no pace', async () => {
    mockListGoals.mockResolvedValue({
      goals: [goal({ paceCents: 0, monthly_allocation_cents: 40000 })],
    });
    const tree = await renderScreen();
    expect(allText(tree.root)).toContain('Allocating');
  });

  it('renders no pace line when there is neither pace nor allocation', async () => {
    mockListGoals.mockResolvedValue({
      goals: [goal({ paceCents: 0, monthly_allocation_cents: 0 })],
    });
    const tree = await renderScreen();
    const text = allText(tree.root);
    expect(text).not.toContain('Allocating');
    expect(text).not.toContain('/mo to stay on track');
  });

  it('still renders (empty) when loading the goals fails', async () => {
    mockListGoals.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'savings-goal-card-g1' }).length).toBe(0);
  });

  it('renders a zero-target goal with a $0 amount and no progress', async () => {
    mockListGoals.mockResolvedValue({
      goals: [goal({ target_amount_cents: 0, current_amount_cents: 0, paceCents: 0, monthly_allocation_cents: 0 })],
    });
    const tree = await renderScreen();
    // progressRatio short-circuits to 0 (no divide-by-zero) and $0 is rendered.
    expect(allText(tree.root)).toContain('$0');
    const fill = tree.root.findAll(
      (n) => JSON.stringify(n.props?.style ?? '').includes('"width":"0%"')
    );
    expect(fill.length).toBeGreaterThan(0);
  });
});
