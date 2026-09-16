/**
 * HouseInviteScreen — the hub.
 *
 * The screen itself does almost nothing, and that is the point: it shows whose
 * TURN it is, names who is already here, and pushes to the screens that do the
 * work. What is worth pinning is exactly the wiring that is easy to get wrong
 * and invisible when it is:
 *
 *  - each row leading where it says it does, because a hub whose rows are
 *    mis-wired is a dead end with no error;
 *  - the live states appearing HERE and not only on their own screens — both are
 *    what a push notification brings someone here to see, and a hub with no
 *    trace of it is worse than no notification;
 *  - a TAPPED INVITE LINK being handed straight to Join, filled in, without
 *    claiming anything on the way.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
const mockNavigate = jest.fn();

jest.mock('expo-router/react-navigation', () => {
  const React = require('react');
  return {
    __esModule: true,
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), canGoBack: () => true }),
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
  };
});

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
    ScreenHeader: ({ title }: { title?: string }) =>
      React.createElement(Text, { testID: 'screen-header' }, title ?? ''),
    screenScrollViewStyle: { scroll: { flex: 1 } },
  };
});

jest.mock('@features/house/local/flag', () => ({
  __esModule: true,
  isHouseLocalFirst: () => true,
}));

const mockHeldProperties = [
  {
    householdId: 'hh-1',
    deviceId: 'dev-self',
    name: 'Maple Street House',
    role: 'owner',
    isActive: true,
    hydrated: true,
    awaitingEnrolment: false,
  },
];

jest.mock('@features/house/local/engine', () => ({
  __esModule: true,
  isLocalHouseSessionOpen: () => true,
  isAwaitingHouseEnrolment: () => false,
  getActiveHouseholdId: () => 'hh-1',
  listLocalHouseProperties: () => mockHeldProperties,
  subscribeToHouseLedgerChanges: () => () => {},
}));

/** The parked invite a tapped link leaves behind, consumed once. */
const mockPendingInvite: { current: { code: string; secret: string } | null } = { current: null };
jest.mock('@features/house/local/inviteLinkStore', () => ({
  __esModule: true,
  takePendingHouseInvite: () => {
    const invite = mockPendingInvite.current;
    mockPendingInvite.current = null;
    return invite;
  },
}));

/** Whose turn it is — the two hooks the hub renders its live panels from. */
const mockRequestsState = {
  requests: null as unknown[] | null,
  sas: {} as Record<string, string | null>,
  isChecking: false,
  isApproving: false,
  refresh: jest.fn(async () => null),
  approve: jest.fn(),
};
const mockWaitState = {
  awaiting: false,
  sas: null as string | null,
  outcome: null as string | null,
  dismiss: jest.fn(),
  refresh: jest.fn(async () => {}),
};

jest.mock('@features/house/local/useHouseJoinRequests', () => ({
  __esModule: true,
  useHouseJoinRequests: () => mockRequestsState,
}));
jest.mock('@features/house/local/useHouseJoinWait', () => ({
  __esModule: true,
  useHouseJoinWait: () => mockWaitState,
}));

// The members card fetches a roster and reads the auth store; its own suite
// covers it, and here it would put a control-plane call on every render.
jest.mock('@features/house/components/HouseHouseholdMembersCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    HouseHouseholdMembersCard: () =>
      React.createElement(View, { testID: 'house-household-members' }),
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import HouseInviteScreen from '../HouseInviteScreen';

import { flush, hasTestId, press, textOf } from './enrolmentTestKit';

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HouseInviteScreen />
      </ThemeProvider>,
    );
    await flush();
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPendingInvite.current = null;
  mockRequestsState.requests = null;
  mockRequestsState.sas = {};
  mockWaitState.awaiting = false;
  mockWaitState.sas = null;
  mockWaitState.outcome = null;
  mockHeldProperties.length = 1;
});

describe('the rows', () => {
  it('leads to the owner half, the invitee half, the homes and the devices', async () => {
    const tree = await renderScreen();

    await press(tree, 'house-invite-section-invite');
    expect(mockNavigate).toHaveBeenLastCalledWith('HouseInviteCreate');

    await press(tree, 'house-invite-section-join');
    expect(mockNavigate).toHaveBeenLastCalledWith('HouseJoin');

    await press(tree, 'house-invite-section-properties');
    expect(mockNavigate).toHaveBeenLastCalledWith('HouseProperties');

    await press(tree, 'house-invite-section-devices');
    expect(mockNavigate).toHaveBeenLastCalledWith('HouseDeviceSync');
  });

  it('names the active home on the Homes row, rather than an id nobody can read', async () => {
    const tree = await renderScreen();
    expect(textOf(tree, 'house-invite-section-properties')).toContain('Maple Street House');
  });

  it('counts the homes on this device only when there is more than one to switch between', async () => {
    const tree = await renderScreen();
    expect(textOf(tree, 'house-invite-section-properties')).not.toContain('on this device');

    mockHeldProperties.push({
      householdId: 'hh-2',
      deviceId: 'dev-self',
      name: 'The Cottage',
      role: 'member',
      isActive: false,
      hydrated: false,
      awaitingEnrolment: false,
    });
    const withTwo = await renderScreen();
    expect(textOf(withTwo, 'house-invite-section-properties')).toContain('2 on this device');
  });
});

describe('whose turn it is', () => {
  it('shows nothing at the top when nobody is waiting on anybody', async () => {
    const tree = await renderScreen();
    expect(hasTestId(tree, 'house-settings-join-requests-panel')).toBe(false);
    expect(hasTestId(tree, 'house-join-sas-panel')).toBe(false);
  });

  it("raises the owner's pending request here, not only on the Invite screen", async () => {
    mockRequestsState.requests = [
      {
        inviteId: 'inv_1',
        shortCode: 'AB12CD',
        role: 'ADULT',
        expiresAt: new Date().toISOString(),
        claimedByUserId: 'u2',
        claimedByEmail: 'partner@example.com',
        claimedByDisplayName: 'Partner',
        claimedDeviceId: 'dev-peer',
        claimedDeviceLabel: "Partner's iPhone",
        claimedSigningPublicKey: 'aa',
        claimedAgreementPublicKey: 'bb',
      },
    ];
    mockRequestsState.sas = { inv_1: '123456' };
    const tree = await renderScreen();

    expect(hasTestId(tree, 'house-settings-join-requests-panel')).toBe(true);
    expect(textOf(tree, 'house-request-sas-inv_1')).toContain('123');
  });

  it("raises this device's own wait, with the digits to read out", async () => {
    mockWaitState.awaiting = true;
    mockWaitState.sas = '654321';
    const tree = await renderScreen();

    expect(textOf(tree, 'house-join-sas')).toContain('654');
    expect(textOf(tree, 'house-invite-section-join')).toContain('Waiting for them to approve');
  });

  it('lets the ending outrank the wait, so the row cannot contradict the banner', async () => {
    mockWaitState.awaiting = true;
    mockWaitState.sas = '654321';
    mockWaitState.outcome = 'expired';
    const tree = await renderScreen();

    expect(textOf(tree, 'house-join-outcome')).toContain('ran out');
    expect(textOf(tree, 'house-invite-section-join')).toContain('expired');
    expect(textOf(tree, 'house-invite-section-join')).not.toContain('Waiting for them');
  });
});

describe('a tapped invite link', () => {
  it('is handed to Join with both halves, and claims nothing on the way', async () => {
    mockPendingInvite.current = { code: 'AB12CD', secret: 'sekret' };
    await renderScreen();

    expect(mockNavigate).toHaveBeenCalledWith('HouseJoin', {
      code: 'AB12CD',
      secret: 'sekret',
    });
  });

  it('is taken once, so a re-render does not reopen a dialog the member dismissed', async () => {
    mockPendingInvite.current = { code: 'AB12CD', secret: 'sekret' };
    const tree = await renderScreen();
    mockNavigate.mockClear();

    await act(async () => {
      tree.update(
        <ThemeProvider>
          <HouseInviteScreen />
        </ThemeProvider>,
      );
      await flush();
    });

    expect(mockNavigate).not.toHaveBeenCalledWith('HouseJoin', expect.anything());
  });
});
