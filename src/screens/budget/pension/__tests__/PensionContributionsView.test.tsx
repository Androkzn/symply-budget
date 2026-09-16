/**
 * PensionContributionsView — Contributions sub-view of Budget → Pension.
 *
 * Card-driven: each member line shows "Edit recurring" / "Enter by month" / "Delete"
 * chips (no whole-card tap). Verifies delete clears the year's contributions, "Enter by
 * month" opens the backfill grid (pre-fill fetch fires), and "Edit recurring" opens the
 * shared entry sheet.
 */

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockGetOverview = jest.fn();
const mockDeleteContribs = jest.fn();
const mockGetMonthly = jest.fn();
jest.mock('@api/savings', () => ({
  savingsApi: {
    getRegisteredOverview: (...a: unknown[]) => mockGetOverview(...a),
    deleteMemberContributions: (...a: unknown[]) => mockDeleteContribs(...a),
    getMemberMonthly: (...a: unknown[]) => mockGetMonthly(...a),
    backfillMemberContributions: jest.fn().mockResolvedValue({ account: {} }),
    setMemberLine: jest.fn().mockResolvedValue({ account: {} }),
    addMemberContribution: jest.fn().mockResolvedValue({ account: {}, transaction: {} }),
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

import { PensionContributionsView } from '../PensionContributionsView';

function overview() {
  return {
    year: 2026,
    totals: {
      totalBalanceCents: 0,
      totalRoomRemainingCents: 0,
      totalContributedSelfCents: 100000,
      totalContributedEmployerCents: 50000,
      goalCents: 0,
      goalContributedCents: 0,
      goalPct: 0,
    },
    groups: [
      {
        memberId: 'm1',
        memberName: 'Alex',
        memberAvatarUrl: null,
        totalBalanceCents: 150000,
        accounts: [
          {
            account: {
              id: 'acc-rrsp',
              account_type: 'rrsp',
              member_id: 'm1',
              is_room_only: true,
              starting_room_cents: null,
              annual_goal_cents: null,
              annual_goal_pct: null,
              regular_contribution_cents: 50000,
              employer_match_cents: 50000,
            },
            memberName: 'Alex',
            room: {
              roomRemaining: 0,
              goalCents: null,
              goalContributedCents: 0,
              goalPct: 0,
              usedByContributor: { self: 100000, employer: 50000 },
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

// Flatten all rendered strings (literal spaces are baked into JSX children).
function allText(tree: ReactTestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: ReactTestRenderer.ReactTestRendererJSON | string | null) => {
    if (node == null) return;
    if (typeof node === 'string') return void out.push(node);
    (node.children ?? []).forEach(walk);
  };
  const json = tree.toJSON();
  (Array.isArray(json) ? json : [json]).forEach(walk);
  return out.join('');
}

async function renderView() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PensionContributionsView />
      </ThemeProvider>
    );
  });
  await flush();
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOverview.mockResolvedValue(overview());
  mockDeleteContribs.mockResolvedValue({ account: null });
  mockGetMonthly.mockResolvedValue({
    months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, selfCents: 0, employerCents: 0 })),
  });
  // Auto-confirm the destructive action in the delete Alert.
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    (buttons ?? []).find((b) => b.style === 'destructive')?.onPress?.();
  });
});

describe('PensionContributionsView', () => {
  it('renders a contribution card with the three action chips', async () => {
    const tree = await renderView();
    expect(mockGetOverview).toHaveBeenCalledWith('hh-test', 2026);
    expect(tree.root.findAllByProps({ testID: 'pension-contribution-edit-recurring' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'pension-contribution-edit-months' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'pension-contribution-delete' }).length).toBeGreaterThan(0);
  });

  it('shows the total contributed (you + employer) for the year with the split', async () => {
    // self $1,000 + employer $500 = $1,500 total.
    const tree = await renderView();
    const text = allText(tree);
    expect(text).toContain('Contributed in 2026');
    expect(text).toContain('$1,500'); // total, the headline number
    expect(text).toMatch(/You .*Employer/); // "You $1,000 · Employer $500"
  });

  it('Delete confirms then clears the year\'s contributions and marks dirty', async () => {
    const tree = await renderView();
    await act(async () => tree.root.findByProps({ testID: 'pension-contribution-delete' }).props.onPress());
    await flush();

    expect(Alert.alert).toHaveBeenCalled();
    expect(mockDeleteContribs).toHaveBeenCalledWith('hh-test', {
      member_id: 'm1',
      account_type: 'rrsp',
      year: 2026,
    });
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('"Enter by month" opens the backfill grid and fires its pre-fill fetch', async () => {
    const tree = await renderView();
    await act(async () => tree.root.findByProps({ testID: 'pension-contribution-edit-months' }).props.onPress());
    await flush();

    expect(mockGetMonthly).toHaveBeenCalledWith('hh-test', 'm1', 'rrsp', 2026);
    expect(tree.root.findAllByProps({ testID: 'pension-backfill-member-m1' }).length).toBeGreaterThan(0);
  });

  it('"Edit recurring" opens the shared entry sheet', async () => {
    const tree = await renderView();
    await act(async () => tree.root.findByProps({ testID: 'pension-contribution-edit-recurring' }).props.onPress());
    await flush();

    expect(tree.root.findAllByProps({ testID: 'pension-entry-member-m1' }).length).toBeGreaterThan(0);
  });
});
