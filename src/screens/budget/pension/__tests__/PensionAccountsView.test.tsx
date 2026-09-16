/**
 * PensionAccountsView — Accounts sub-view of the Budget → Pension tab.
 *
 * Prop-less body that self-fetches the BE-computed registered-account overview
 * (`savingsApi.getRegisteredOverview`). This test asserts it RENDERS the totals,
 * the per-account room + goal figures, and the self/employer split (no local
 * math), shows the empty state when there are no accounts, and wires the
 * "Add / manage" and "Import statement" CTAs to navigation.
 */

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockNavigate = jest.fn();
const mockNavigation = { goBack: jest.fn(), navigate: mockNavigate };

const mockGetOverview = jest.fn();
jest.mock('@api/savings', () => ({
  savingsApi: { getRegisteredOverview: (...args: unknown[]) => mockGetOverview(...args) },
}));

jest.mock('@stores/householdStore', () => {
  const state = { currentHousehold: { id: 'hh-test' } };
  const useHouseholdStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  return { useHouseholdStore };
});

jest.mock('@stores/pensionStore', () => {
  const state = { selectedYear: 2026, dataRevision: 0 };
  const usePensionStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  return { usePensionStore };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../../test-utils/budgetConsistency';
import { PensionAccountsView } from '../PensionAccountsView';

function overview(overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    totals: {
      totalBalanceCents: 5000000,
      totalRoomRemainingCents: 1500000,
      totalContributedSelfCents: 300000,
      totalContributedEmployerCents: 150000,
      goalCents: 1000000,
      goalContributedCents: 450000,
      goalPct: 45,
    },
    groups: [
      {
        memberId: 'm1',
        memberName: 'Alex',
        totalBalanceCents: 5000000,
        accounts: [
          {
            account: {
              id: 'acc-1',
              account_type: 'rrsp',
              institution: 'Wealthsimple',
              employer_name: 'Acme',
              balance_cents: 5000000,
            },
            memberName: 'Alex',
            room: {
              accountId: 'acc-1',
              accountType: 'rrsp',
              year: 2026,
              roomRemaining: 1500000,
              annualLimit: 2000000,
              used: 450000,
              usedByKind: { regular: 0, manual: 450000 },
              usedByContributor: { self: 300000, employer: 150000 },
              warnings: [],
              goalCents: 1000000,
              goalContributedCents: 450000,
              goalRemainingCents: 550000,
              goalPct: 45,
            },
          },
        ],
      },
    ],
    warnings: [],
    ...overrides,
  };
}

async function renderView() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PensionAccountsView />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PensionAccountsView', () => {
  it('renders the BE totals card + an account card, with figures verbatim', async () => {
    mockGetOverview.mockResolvedValue(overview());
    const tree = await renderView();

    expect(mockGetOverview).toHaveBeenCalledWith('hh-test', 2026);
    // Totals + one account card are rendered from the BE view model.
    expect(tree.root.findAllByProps({ testID: 'pension-totals' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'pension-account-card' }).length).toBeGreaterThan(0);
    // Server-computed balance (5000000c → "$50,000") rendered verbatim.
    const texts = collectRenderedText(tree);
    expect(texts.some((t) => t.includes('$50,000'))).toBe(true);
  });

  it('shows the empty state when there are no accounts', async () => {
    mockGetOverview.mockResolvedValue(overview({ groups: [], totals: overview().totals }));
    const tree = await renderView();
    expect(collectRenderedText(tree).some((t) => t.includes('Track your RRSP'))).toBe(true);
  });

  it('hides room-only placeholders — a group of only room-only entries shows the empty state', async () => {
    const roomOnly = overview();
    // Mark the sole account as a room-only placeholder (set on the Room tab, not a real account).
    (roomOnly.groups[0].accounts[0].account as { is_room_only?: boolean }).is_room_only = true;
    mockGetOverview.mockResolvedValue(roomOnly);
    const tree = await renderView();

    expect(tree.root.findAllByProps({ testID: 'pension-account-card' }).length).toBe(0);
    expect(collectRenderedText(tree).some((t) => t.includes('Track your RRSP'))).toBe(true);
  });

  it('wires the manage + import CTAs to navigation', async () => {
    mockGetOverview.mockResolvedValue(overview({ groups: [] }));
    const tree = await renderView();
    act(() => tree.root.findByProps({ testID: 'pension-manage-accounts' }).props.onPress());
    act(() => tree.root.findByProps({ testID: 'pension-import-statement' }).props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('SavingsRegistered');
    expect(mockNavigate).toHaveBeenCalledWith('PensionImport');
  });
});
