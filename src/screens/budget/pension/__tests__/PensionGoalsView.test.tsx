/**
 * PensionGoalsView — Goals sub-view of Budget → Pension.
 *
 * Renders per-member annual-goal cards (amount or % of room) with a progress bar, each
 * with a delete affordance. Verifies the card renders from the BE overview and that Delete
 * confirms then clears the goal (goal_cents + goal_pct → null) and marks dirty.
 */

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockGetOverview = jest.fn();
const mockSetMemberLine = jest.fn();
jest.mock('@api/savings', () => ({
  savingsApi: {
    getRegisteredOverview: (...a: unknown[]) => mockGetOverview(...a),
    setMemberLine: (...a: unknown[]) => mockSetMemberLine(...a),
    addMemberContribution: jest.fn(),
  },
}));

jest.mock('@api/households', () => ({
  householdsApi: { get: jest.fn().mockResolvedValue({ members: [] }) },
}));

const members = [{ id: 'm1', display_name: 'Alex', email: 'alex@example.com' }];
jest.mock('@stores/householdStore', () => {
  const state = { currentHousehold: { id: 'hh-test' }, currentHouseholdMembers: members };
  const useHouseholdStore = (s?: (x: typeof state) => unknown) => (s ? s(state) : state);
  return { useHouseholdStore };
});

const mockMarkDirty = jest.fn();
jest.mock('@stores/pensionStore', () => {
  const state = {
    selectedYear: 2026,
    selectedMemberId: null as string | null,
    memberGroups: [] as { id: string | null; name: string | null }[],
    setMemberGroups: () => {},
    dataRevision: 0,
    markDirty: (...a: unknown[]) => mockMarkDirty(...a),
  };
  const usePensionStore = (s?: (x: typeof state) => unknown) => (s ? s(state) : state);
  return { usePensionStore };
});

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { PensionGoalsView } from '../PensionGoalsView';

function overview() {
  return {
    year: 2026,
    totals: {
      totalBalanceCents: 0,
      totalRoomRemainingCents: 0,
      totalContributedSelfCents: 0,
      totalContributedEmployerCents: 0,
      goalCents: 500000,
      goalContributedCents: 100000,
      goalPct: 20,
    },
    groups: [
      {
        memberId: 'm1',
        memberName: 'Alex',
        memberAvatarUrl: null,
        totalBalanceCents: 0,
        accounts: [
          {
            account: {
              id: 'acc-rrsp',
              account_type: 'rrsp',
              member_id: 'm1',
              is_room_only: true,
              starting_room_cents: 5000000,
              annual_goal_cents: 500000,
              annual_goal_pct: null,
              regular_contribution_cents: null,
              employer_match_cents: null,
            },
            memberName: 'Alex',
            room: {
              roomRemaining: 4900000,
              goalCents: 500000,
              goalContributedCents: 100000,
              goalPct: 20,
              usedByContributor: { self: 100000, employer: 0 },
            },
          },
        ],
      },
    ],
    warnings: [],
  };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function renderView() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PensionGoalsView />
      </ThemeProvider>
    );
  });
  await flush();
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOverview.mockResolvedValue(overview());
  mockSetMemberLine.mockResolvedValue({ account: {} });
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    (buttons ?? []).find((b) => b.style === 'destructive')?.onPress?.();
  });
});

describe('PensionGoalsView', () => {
  it('renders a goal card from the BE overview', async () => {
    const tree = await renderView();
    expect(mockGetOverview).toHaveBeenCalledWith('hh-test', 2026);
    expect(tree.root.findAllByProps({ testID: 'pension-goal-row' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'pension-goal-delete' }).length).toBeGreaterThan(0);
  });

  it('Delete confirms then clears the goal (amount + %) and marks dirty', async () => {
    const tree = await renderView();
    await act(async () => tree.root.findByProps({ testID: 'pension-goal-delete' }).props.onPress());
    await flush();

    expect(Alert.alert).toHaveBeenCalled();
    expect(mockSetMemberLine).toHaveBeenCalledWith('hh-test', {
      member_id: 'm1',
      account_type: 'rrsp',
      goal_cents: null,
      goal_pct: null,
    });
    expect(mockMarkDirty).toHaveBeenCalled();
  });
});
