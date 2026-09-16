/**
 * PensionGoalsView — coverage sibling.
 *
 * Covers the handlers/branches the primary suite leaves out (uncovered 46, 59, 67-68,
 * 89-90, 137-143, 193): the load-error catch, the dataRevision refetch effect, the
 * "Add goal" open, the row-tap edit-open, the delete-error catch, and the sheet close.
 * PensionEntrySheet is stubbed here so we can read the props the view drives it with and
 * fire its onClose.
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
const mockHouseholdState: { currentHousehold: { id: string } | null; currentHouseholdMembers: typeof members } = {
  currentHousehold: { id: 'hh-test' },
  currentHouseholdMembers: members,
};
jest.mock('@stores/householdStore', () => {
  const useHouseholdStore = (s?: (x: typeof mockHouseholdState) => unknown) =>
    s ? s(mockHouseholdState) : mockHouseholdState;
  return { useHouseholdStore };
});

const mockMarkDirty = jest.fn();
const mockPensionState = {
  selectedYear: 2026,
  selectedMemberId: null as string | null,
  memberGroups: [] as { id: string | null; name: string | null }[],
  setMemberGroups: () => {},
  dataRevision: 0,
  markDirty: (...a: unknown[]) => mockMarkDirty(...a),
};
jest.mock('@stores/pensionStore', () => {
  const usePensionStore = (s?: (x: typeof mockPensionState) => unknown) =>
    s ? s(mockPensionState) : mockPensionState;
  return { usePensionStore };
});

// Stub the entry sheet so we can inspect the props the view drives it with (visible /
// initial) and fire its onClose (line 193) without mounting the real bottom sheet.
const mockSheetProps: { current: Record<string, unknown> | null } = { current: null };
jest.mock('../PensionEntrySheet', () => {
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return {
    PensionEntrySheet: (props: Record<string, unknown>) => {
      mockSheetProps.current = props;
      return React.createElement(
        TouchableOpacity,
        { testID: 'pension-sheet', onPress: props.onClose as () => void },
        React.createElement(Text, null, props.visible ? 'open' : 'closed')
      );
    },
  };
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

// A TFSA line whose goal is expressed as a PERCENTAGE of room (annual_goal_pct set,
// annual_goal_cents null) — exercises the "% of room" caption + the tfsa mapping paths.
function overviewPct() {
  return {
    year: 2026,
    totals: {
      totalBalanceCents: 0,
      totalRoomRemainingCents: 0,
      totalContributedSelfCents: 0,
      totalContributedEmployerCents: 0,
      goalCents: 300000,
      goalContributedCents: 150000,
      goalPct: 50,
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
              id: 'acc-tfsa',
              account_type: 'tfsa',
              member_id: 'm1',
              is_room_only: true,
              starting_room_cents: 600000,
              annual_goal_cents: null,
              annual_goal_pct: 50,
              regular_contribution_cents: null,
              employer_match_cents: null,
            },
            memberName: 'Alex',
            room: {
              roomRemaining: 450000,
              goalCents: 300000,
              goalContributedCents: 150000,
              goalPct: 50,
              usedByContributor: { self: 150000, employer: 0 },
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
  mockSheetProps.current = null;
  mockPensionState.dataRevision = 0;
  mockHouseholdState.currentHousehold = { id: 'hh-test' };
  mockGetOverview.mockResolvedValue(overview());
  mockSetMemberLine.mockResolvedValue({ account: {} });
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    (buttons ?? []).find((b) => b.style === 'destructive')?.onPress?.();
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PensionGoalsView (coverage)', () => {
  it('logs and swallows a load error, falling back to the empty state', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetOverview.mockRejectedValueOnce(new Error('overview boom'));

    const tree = await renderView();

    expect(errSpy).toHaveBeenCalledWith('Error loading pension goals:', expect.any(Error));
    // No overview → no goal rows; empty affordance is shown instead.
    expect(tree.root.findAllByProps({ testID: 'pension-goal-row' }).length).toBe(0);
    expect(tree.root.findAllByProps({ testID: 'pension-goal-add' }).length).toBeGreaterThan(0);
  });

  it('refetches the overview when dataRevision is non-zero', async () => {
    mockPensionState.dataRevision = 3;

    await renderView();

    // Both the focus effect and the dataRevision effect fire load() on mount.
    expect(mockGetOverview.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockGetOverview).toHaveBeenCalledWith('hh-test', 2026);
  });

  it('opens the sheet with no initial when "Add goal" is tapped', async () => {
    const tree = await renderView();
    expect(mockSheetProps.current?.visible).toBe(false);

    await act(async () => tree.root.findByProps({ testID: 'pension-goal-add' }).props.onPress());
    await flush();

    expect(mockSheetProps.current?.visible).toBe(true);
    expect(mockSheetProps.current?.initial).toBeUndefined();
  });

  it('opens the sheet pre-filled when a goal row is tapped', async () => {
    const tree = await renderView();

    await act(async () => tree.root.findByProps({ testID: 'pension-goal-row' }).props.onPress());
    await flush();

    expect(mockSheetProps.current?.visible).toBe(true);
    expect(mockSheetProps.current?.initial).toEqual({
      memberId: 'm1',
      accountType: 'rrsp',
      goalCents: 500000,
      goalPct: null,
    });
  });

  it('drives the sheet with a goalBases map (memberId:type → starting_room ?? annualLimit)', async () => {
    await renderView();

    // Built from every rrsp/tfsa account in the overview; base = starting_room_cents here.
    expect(mockSheetProps.current?.goalBases).toEqual({ 'm1:rrsp': 5000000 });
  });

  it('falls back to annualLimit for the goalBases base when no starting room is set', async () => {
    const noStartingRoom = overview();
    (noStartingRoom.groups[0].accounts[0].account as { starting_room_cents: number | null }).starting_room_cents =
      null;
    (noStartingRoom.groups[0].accounts[0].room as { annualLimit?: number }).annualLimit = 3200000;
    mockGetOverview.mockResolvedValue(noStartingRoom);

    await renderView();

    expect(mockSheetProps.current?.goalBases).toEqual({ 'm1:rrsp': 3200000 });
  });

  it('surfaces an error alert when deleting the goal fails', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSetMemberLine.mockRejectedValueOnce(new Error('delete boom'));

    const tree = await renderView();
    await act(async () => tree.root.findByProps({ testID: 'pension-goal-delete' }).props.onPress());
    await flush();

    expect(mockSetMemberLine).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith('Error deleting pension goal:', expect.any(Error));
    // Second Alert.alert call is the failure notice (first was the confirm dialog).
    expect(Alert.alert).toHaveBeenCalledWith('Error', expect.any(String));
    expect(mockMarkDirty).not.toHaveBeenCalled();
  });

  it('no-ops the fetch and hides the sheet when there is no current household', async () => {
    mockHouseholdState.currentHousehold = null;

    const tree = await renderView();

    // load() returns before hitting the API; the entry sheet is not mounted at all.
    expect(mockGetOverview).not.toHaveBeenCalled();
    expect(mockSheetProps.current).toBeNull();
    expect(tree.root.findAllByProps({ testID: 'pension-goal-row' }).length).toBe(0);
  });

  it('renders a percentage TFSA goal and maps it to tfsa on edit + delete', async () => {
    mockGetOverview.mockResolvedValue(overviewPct());

    const tree = await renderView();

    // The "% of room" caption only renders for percentage-based goals (isPct branch).
    // JSX `{pct}% of room` renders children as the array [50, '% of room'].
    const flatten = (c: unknown): string =>
      Array.isArray(c) ? c.map(flatten).join('') : c == null ? '' : String(c);
    const pctCaption = tree.root.findAll((n) => flatten(n.props?.children) === '50% of room');
    expect(pctCaption.length).toBeGreaterThan(0);

    // Row tap maps the tfsa account type and carries the percentage (cents null).
    await act(async () => tree.root.findByProps({ testID: 'pension-goal-row' }).props.onPress());
    await flush();
    expect(mockSheetProps.current?.initial).toEqual({
      memberId: 'm1',
      accountType: 'tfsa',
      goalCents: null,
      goalPct: 50,
    });

    // Delete resolves the account_type to tfsa (the non-rrsp branch of confirmDelete).
    await act(async () => tree.root.findByProps({ testID: 'pension-goal-delete' }).props.onPress());
    await flush();
    expect(mockSetMemberLine).toHaveBeenCalledWith('hh-test', {
      member_id: 'm1',
      account_type: 'tfsa',
      goal_cents: null,
      goal_pct: null,
    });
  });

  it('closes the sheet via its onClose handler', async () => {
    const tree = await renderView();
    // Open first so there is something to close.
    await act(async () => tree.root.findByProps({ testID: 'pension-goal-add' }).props.onPress());
    await flush();
    expect(mockSheetProps.current?.visible).toBe(true);

    await act(async () => tree.root.findByProps({ testID: 'pension-sheet' }).props.onPress());
    await flush();

    expect(mockSheetProps.current?.visible).toBe(false);
  });
});
