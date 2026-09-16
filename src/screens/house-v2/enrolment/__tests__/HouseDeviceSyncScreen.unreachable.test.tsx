/**
 * The verdict has to REACH the member.
 *
 * `canEnrolmentStillBeApproved` and the gate are both covered by their own
 * suites, and both could be perfect while the screen renders nothing — a tested
 * conclusion nobody is ever shown. That is the exact shape of the original bug:
 * the orchestrator already logged "still waiting for the home key" on every
 * heartbeat, and the member saw a spinner.
 *
 * So this asserts the last hop only: gate says unreachable → the notice is on
 * the screen; gate says otherwise → it is not.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn() }),
  router: { push: jest.fn() },
}));

jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  useNavigation: () => ({ goBack: jest.fn() }),
}));

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

jest.mock('@components/house-v2', () => ({
  __esModule: true,
  HouseConflictList: () => null,
}));

jest.mock('@features/house/components/HouseSyncProgressPanel', () => ({
  __esModule: true,
  HouseSyncProgressPanel: () => null,
}));

// The three bodies this screen composes. Each is a screen in its own right with
// its own suite; standing them up here would test them again and nothing new.
jest.mock('../HouseDevicesScreen', () => ({ __esModule: true, HouseDevicesBody: () => null }));
jest.mock('../HouseInviteCreateScreen', () => ({ __esModule: true, HouseInviteBody: () => null }));
jest.mock('../HouseJoinScreen', () => ({ __esModule: true, HouseJoinBody: () => null }));

let mockLocalFirst = true;
jest.mock('@features/house/local/flag', () => ({
  __esModule: true,
  isHouseLocalFirst: () => mockLocalFirst,
}));

let mockAwaiting = false;
jest.mock('@features/house/local/engine', () => ({
  __esModule: true,
  isLocalHouseSessionOpen: () => true,
  isAwaitingHouseEnrolment: () => mockAwaiting,
  getActiveHouseholdId: () => 'hh-1',
  getLocalHouseLedger: () => ({
    household: { id: 'hh-1', name: 'Maple Street House' },
    deviceId: 'dev-self',
  }),
  requestHouseholdBackfill: jest.fn(),
  subscribeToHouseLedgerChanges: () => () => {},
}));

jest.mock('@features/house/local/controlPlaneClient', () => ({
  __esModule: true,
  houseHouseholdControlPlaneStatus: jest.fn().mockResolvedValue({ registered: true }),
}));

jest.mock('@features/house/local/sync/orchestrator', () => ({
  __esModule: true,
  runHouseLocalSync: jest.fn().mockResolvedValue(undefined),
}));

// Synchronous — the screen reads `.total` off the return value directly.
jest.mock('@features/house/local/syncInventory', () => ({
  __esModule: true,
  describeHouseSyncInventory: () => ({ total: 0, categories: [] }),
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { useHouseSyncStatusStore } from '@features/house/local/sync/syncStatusStore';

import HouseDeviceSyncScreen from '../HouseDeviceSyncScreen';

import { allText, flush, hasTestId } from './enrolmentTestKit';

const NOTICE = 'lf-sync-enrolment-unreachable';

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HouseDeviceSyncScreen />
      </ThemeProvider>,
    );
  });
  await flush();
  mounted = tree;
  return tree;
}

beforeEach(() => {
  mockLocalFirst = true;
  mockAwaiting = false;
  useHouseSyncStatusStore.setState({ enrolmentUnreachable: false });
});

afterEach(() => {
  // Unmounted, or the previous test's tree stays subscribed to the status store
  // and the next `setState` re-renders it outside `act` — a warning that would
  // train everyone here to ignore act warnings.
  act(() => {
    mounted?.unmount();
  });
  mounted = null;
});

describe('HouseDeviceSyncScreen — the unreachable-enrolment notice', () => {
  it('shows it when the wait can no longer be answered', async () => {
    mockAwaiting = true;
    useHouseSyncStatusStore.setState({ enrolmentUnreachable: true });

    const tree = await renderScreen();

    expect(hasTestId(tree, NOTICE)).toBe(true);
    expect(allText(tree)).toContain('Maple Street House');
  });

  it('stays hidden while the wait is still ordinary', async () => {
    // A joiner seconds from approval must not be told the home is unrecoverable.
    mockAwaiting = true;
    useHouseSyncStatusStore.setState({ enrolmentUnreachable: false });

    expect(hasTestId(await renderScreen(), NOTICE)).toBe(false);
  });

  it('stays hidden when there is no wait at all', async () => {
    mockAwaiting = false;
    useHouseSyncStatusStore.setState({ enrolmentUnreachable: true });

    expect(hasTestId(await renderScreen(), NOTICE)).toBe(false);
  });
});
