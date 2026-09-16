/**
 * PensionRoomView — Room sub-view of Budget → Pension.
 *
 * Button-driven simple flow: an "Add contribution room" CTA + tappable rows built from the
 * BE overview, both opening the shared PensionEntrySheet. No dependency on Accounts.
 */

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockGetOverview = jest.fn();
const mockSetMemberLine = jest.fn().mockResolvedValue({ account: null });
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

import { PensionProgressBar } from '../PensionProgressBar';
import { PensionRoomView } from '../PensionRoomView';

function overview(
  startingRoom: number | null,
  roomRemaining?: number,
  avatarUrl: string | null = null
) {
  return {
    year: 2026,
    totals: {
      totalBalanceCents: 0,
      totalRoomRemainingCents: startingRoom ?? 0,
      totalContributedSelfCents: 0,
      totalContributedEmployerCents: 0,
      goalCents: 0,
      goalContributedCents: 0,
      goalPct: 0,
    },
    groups:
      startingRoom == null
        ? []
        : [
            {
              memberId: 'm1',
              memberName: 'Alex',
              memberAvatarUrl: avatarUrl,
              totalBalanceCents: 0,
              accounts: [
                {
                  account: {
                    id: 'acc-rrsp',
                    account_type: 'rrsp',
                    member_id: 'm1',
                    is_room_only: true,
                    starting_room_cents: startingRoom,
                    annual_goal_cents: null,
                    annual_goal_pct: null,
                    regular_contribution_cents: null,
                    employer_match_cents: null,
                  },
                  memberName: 'Alex',
                  room: {
                    roomRemaining: roomRemaining ?? startingRoom,
                    goalCents: null,
                    goalContributedCents: 0,
                    goalPct: 0,
                    usedByContributor: { self: 0, employer: 0 },
                  },
                },
              ],
            },
          ],
    warnings: [],
  };
}

// Flatten every string rendered anywhere in the tree, so we can assert on the
// composed row copy ("$10,000 of $50,000 used", "20%", "$40,000 room remaining").
function allText(tree: ReactTestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: ReactTestRenderer.ReactTestRendererJSON | string | null) => {
    if (node == null) return;
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    (node.children ?? []).forEach(walk);
  };
  const json = tree.toJSON();
  (Array.isArray(json) ? json : [json]).forEach(walk);
  // Join with '' — literal spaces are already baked into the JSX string children
  // (e.g. "100" + "%" → "100%", "$10,000" + " of " + "$50,000" → "$10,000 of $50,000").
  return out.join('');
}

async function renderView() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PensionRoomView />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  return tree;
}

beforeEach(() => jest.clearAllMocks());

describe('PensionRoomView', () => {
  it('always shows the "Add contribution room" button', async () => {
    mockGetOverview.mockResolvedValue(overview(null));
    const tree = await renderView();
    expect(mockGetOverview).toHaveBeenCalledWith('hh-test', 2026);
    expect(tree.root.findAllByProps({ testID: 'pension-room-add' }).length).toBeGreaterThan(0);
  });

  it('renders a room row from the BE overview and opens the sheet when tapped', async () => {
    mockGetOverview.mockResolvedValue(overview(1500000));
    const tree = await renderView();
    const row = tree.root.findByProps({ testID: 'pension-room-row' });
    expect(row).toBeTruthy();
    // Tapping opens the shared entry sheet (member selector becomes present).
    await act(async () => row.props.onPress());
    expect(tree.root.findAllByProps({ testID: 'pension-entry-member-m1' }).length).toBeGreaterThan(0);
  });

  it('shows the room money, % filled, a progress bar, and remaining', async () => {
    // total 50k, remaining 40k → used 10k → 20% filled.
    mockGetOverview.mockResolvedValue(overview(5000000, 4000000));
    const tree = await renderView();
    const text = allText(tree);

    expect(text).toContain('20%');
    expect(text).toMatch(/of .* used/); // "$10,000 of $50,000 used"
    expect(text).toContain('room remaining');
    // The tokenized progress bar is rendered, filled to 20%.
    const bars = tree.root.findAllByType(PensionProgressBar);
    expect(bars.length).toBe(1);
    expect(bars[0].props.fraction).toBeCloseTo(0.2, 5);
    expect(bars[0].props.over).toBe(false);
  });

  it('flags over-contribution when remaining is negative', async () => {
    // total 10k, remaining −2k → used 12k → over the room, % capped at 100.
    mockGetOverview.mockResolvedValue(overview(1000000, -200000));
    const tree = await renderView();
    const text = allText(tree);

    expect(text).toContain('over your room');
    expect(text).toContain('100%');
    expect(tree.root.findByType(PensionProgressBar).props.over).toBe(true);
  });

  it('renders the member photo when an avatar URL is present', async () => {
    mockGetOverview.mockResolvedValue(overview(1500000, undefined, 'https://cdn.example.com/a.png'));
    const tree = await renderView();
    const withPhoto = tree.root.findAll(
      (n) => n.props?.source?.uri === 'https://cdn.example.com/a.png'
    );
    expect(withPhoto.length).toBeGreaterThan(0);
  });

  it('deletes a room (clears room_cents) when the trash is tapped and confirmed', async () => {
    mockGetOverview.mockResolvedValue(overview(1500000));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      (buttons ?? []).find((b) => b.style === 'destructive')?.onPress?.();
    });
    const tree = await renderView();

    const del = tree.root.findByProps({ testID: 'pension-room-delete' });
    await act(async () => {
      del.props.onPress();
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    expect(mockSetMemberLine).toHaveBeenCalledWith('hh-test', {
      member_id: 'm1',
      account_type: 'rrsp',
      room_cents: 0,
    });
    expect(mockMarkDirty).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('does NOT delete when the confirmation is cancelled', async () => {
    mockGetOverview.mockResolvedValue(overview(1500000));
    // Simulate the user tapping "Cancel" (no destructive onPress fires).
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderView();

    const del = tree.root.findByProps({ testID: 'pension-room-delete' });
    await act(async () => {
      del.props.onPress();
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    expect(mockSetMemberLine).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
