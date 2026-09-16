/**
 * Budget → Device Sync, the trusted-device list.
 *
 * The list rendered `dev_652de89b0240 / active · epoch 1` next to a Revoke
 * button — an irreversible decision about a device nobody could identify, and
 * the phone in the member's hand was missing from the list whenever the control
 * plane had not registered it yet (fresh install, or a local erase that minted
 * a new device id).
 *
 * Pinned here: rows are named, this device is always one of them and can be
 * renamed, and the rename reaches the control plane.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
    ScreenHeader: () => null,
  };
});

jest.mock('@features/budget/local/flag', () => ({
  __esModule: true,
  isBudgetLocalFirst: () => true,
}));

/**
 * Revoke is owner-gated (the coordinator 403s anyone else), so the viewer's
 * identity now decides what the list offers. Without a signed-in user there is
 * no membership to match and every Revoke button correctly disappears.
 */
const SELF_USER = {
  id: 'u_self',
  display_name: 'Andrei',
  avatar_url: null,
  email: 'andrei@example.com',
};
jest.mock('@stores/authStore', () => ({
  __esModule: true,
  useAuthStore: Object.assign(
    (selector: (s: { user: unknown }) => unknown) => selector({ user: SELF_USER }),
    { getState: () => ({ user: SELF_USER }) },
  ),
}));

jest.mock('@features/budget/local/engine', () => ({
  __esModule: true,
  getLocalLedger: () => ({ deviceId: 'dev_self0001', household: { id: 'hh-1' } }),
  isLocalBudgetSessionOpen: () => true,
  isAwaitingHouseholdEnrolment: () => false,
  subscribeToLedgerChanges: () => () => {},
  // Read through `useSyncExternalStore` (the active household) and on every
  // render (the conflict count). Omitted, React fails with "getSnapshot is not
  // a function" and points at itself rather than at this mock.
  getLedgerRevision: () => 1,
  getActiveBudgetHouseholdId: () => 'hh-1',
  getLocalConflicts: () => [],
}));

jest.mock('@features/budget/local/sync/orchestrator', () => ({
  __esModule: true,
  runBudgetLocalSync: jest.fn(async () => {}),
}));

const mockFetchControlPlaneState = jest.fn();
const mockRename = jest.fn();
const mockRevoke = jest.fn();
const mockForget = jest.fn();
jest.mock('@features/budget/local/controlPlaneClient', () => ({
  __esModule: true,
  fetchControlPlaneState: (...a: unknown[]) => mockFetchControlPlaneState(...a),
  renameLocalFirstDevice: (...a: unknown[]) => mockRename(...a),
  revokeLocalFirstDevice: (...a: unknown[]) => mockRevoke(...a),
  forgetLocalFirstDevice: (...a: unknown[]) => mockForget(...a),
}));

jest.mock('@features/budget/local/deviceName', () => {
  const actual = jest.requireActual('@features/budget/local/deviceName');
  return {
    __esModule: true,
    ...actual,
    getLocalDeviceName: jest.fn(async () => "Andrei's iPhone"),
    suggestDeviceName: () => "Andrei's iPhone",
  };
});

jest.mock('@features/budget/local/localDataReset', () => ({
  __esModule: true,
  getPreviousLocalBudgetData: jest.fn(async () => []),
  cleanUpPreviousLocalBudgetData: jest.fn(async () => ({ removed: 0, bytesFreed: 0 })),
  eraseLocalBudgetData: jest.fn(async () => ({ removed: 0, bytesFreed: 0 })),
}));

jest.mock('@features/budget/local/backup/backupDestinations', () => ({
  __esModule: true,
  listLocalBudgetBackups: jest.fn(async () => []),
}));

jest.mock('@features/budget/local/backup/autoBackup', () => ({
  __esModule: true,
  getBudgetAutoBackupSettings: jest.fn(async () => ({
    enabled: false,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
  })),
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { BudgetSyncScreen } from '../BudgetSyncScreen';

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetSyncScreen />
      </ThemeProvider>,
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

const query = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0] ?? null;

const texts = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchControlPlaneState.mockResolvedValue({ devices: [], keyEpoch: 1 });
  mockRename.mockResolvedValue({ name: 'Kitchen iPad', state: null });
  mockRevoke.mockResolvedValue({ keyEpoch: 2, devices: [] });
  mockForget.mockResolvedValue({ keyEpoch: 2, devices: [] });
  // Revoke goes through a destructive confirm; the tests drive its button.
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('trusted devices', () => {
  it('names every row instead of printing the device id', async () => {
    mockFetchControlPlaneState.mockResolvedValue({
      keyEpoch: 2,
      // The viewer owns this household, which is what makes a peer's device
      // revocable at all — the server enforces the same predicate.
      members: [{ userId: 'u_self', role: 'OWNER', status: 'active' }],
      devices: [
        {
          deviceId: 'dev_self0001',
          userId: 'u_self',
          status: 'active',
          label: "Andrei's iPhone",
        },
        {
          deviceId: 'dev_652de89b0240',
          userId: 'u_peer',
          status: 'active',
          label: 'Kate’s iPhone',
          // Relative, not a fixed date: the row reports liveness from the
          // enrolment stamp, so a hardcoded day silently ages past the
          // staleness window and changes what this row says.
          enrolledAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });

    const tree = await render();
    const rendered = texts(tree);

    expect(rendered).toContain("Andrei's iPhone");
    expect(rendered).toContain('Kate’s iPhone');
    expect(rendered.some((t) => t.includes('dev_652de89b0240'))).toBe(false);
    expect(rendered.some((t) => t.includes('epoch'))).toBe(false);
    // The peer is still revocable, under the testID the E2E suites use.
    expect(query(tree, 'budget-settings-revoke-dev_652de89b0240')).not.toBeNull();
    // …and this device is never offered a Revoke button.
    expect(query(tree, 'budget-settings-revoke-dev_self0001')).toBeNull();
  });

  it('shows this device even when the control plane has not registered it yet', async () => {
    mockFetchControlPlaneState.mockResolvedValue({ devices: [], keyEpoch: 1 });

    const tree = await render();

    expect(query(tree, 'budget-sync-device-dev_self0001')).not.toBeNull();
    expect(texts(tree)).toContain("Andrei's iPhone");
    // Alone on the list, so the invite hint replaces the peer rows.
    expect(query(tree, 'budget-sync-devices-solo')).not.toBeNull();
  });

  it('renames this device from the sheet and pushes the new name', async () => {
    const tree = await render();

    await act(async () => {
      query(tree, 'budget-sync-rename-device')!.props.onPress();
    });
    await act(async () => {
      query(tree, 'budget-device-name-input')!.props.onChangeText('Kitchen iPad');
    });
    await act(async () => {
      query(tree, 'budget-device-name-save')!.props.onPress();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    // BR-016: renaming names the household too. Left to default, a switch
    // during the round trip renames the device in the wrong registry.
    expect(mockRename).toHaveBeenCalledWith('Kitchen iPad', 'hh-1');
    expect(texts(tree)).toContain('Kitchen iPad');
  });
});

/**
 * Who may revoke what.
 *
 * The coordinator 403s a revoke unless the actor owns the household or the
 * device is their own. The list used to offer "Revoke" on every row that was
 * not your own phone, whoever was looking, so a non-owner got a button that
 * could only fail — and the generic error that followed read as a glitch
 * rather than a rule, so it got pressed again, and again on another device.
 */
describe('who may revoke', () => {
  const peerOwnedHousehold = {
    keyEpoch: 1,
    members: [
      { userId: 'u_owner', role: 'OWNER', status: 'active' },
      { userId: 'u_self', role: 'ADULT', status: 'active' },
    ],
    devices: [
      { deviceId: 'dev_self0001', userId: 'u_self', status: 'active', label: 'My phone' },
      { deviceId: 'dev_mine_other', userId: 'u_self', status: 'active', label: 'My old phone' },
      { deviceId: 'dev_652de89b0240', userId: 'u_owner', status: 'active', label: 'Their phone' },
    ],
  };

  it('offers a non-owner no way to revoke someone else’s device', async () => {
    mockFetchControlPlaneState.mockResolvedValue(peerOwnedHousehold);

    const tree = await render();

    expect(query(tree, 'budget-settings-revoke-dev_652de89b0240')).toBeNull();
  });

  /**
   * The gap that stranded people: wiping a phone deliberately does NOT
   * deregister it, and revoke is the only remedy — so an owner-only rule left a
   * member's own dead enrolment in the list with nobody able to remove it.
   */
  it('lets a non-owner revoke their OWN other device', async () => {
    mockFetchControlPlaneState.mockResolvedValue(peerOwnedHousehold);

    const tree = await render();

    expect(query(tree, 'budget-settings-revoke-dev_mine_other')).not.toBeNull();
  });

  it('explains the rule rather than leaving the missing button a mystery', async () => {
    mockFetchControlPlaneState.mockResolvedValue(peerOwnedHousehold);

    const tree = await render();

    expect(query(tree, 'budget-sync-devices-owner-only')).not.toBeNull();
  });
});

/**
 * What a revoke looks like while it is happening, and afterwards.
 *
 * A revoke is a DELETE plus a key rotation plus a refetch. With no pending
 * state the button sat there looking untouched for the whole round trip, which
 * reads as a missed tap — and the response to a missed tap is another tap.
 * Afterwards the row stayed in the list forever, so clearing out stale
 * enrolments never actually made the list any shorter.
 */
describe('revoking, during and after', () => {
  const ownedHousehold = (revokedPeer = false) => ({
    keyEpoch: 1,
    members: [{ userId: 'u_self', role: 'OWNER', status: 'active' }],
    devices: [
      { deviceId: 'dev_self0001', userId: 'u_self', status: 'active', label: 'My phone' },
      {
        deviceId: 'dev_652de89b0240',
        userId: 'u_peer',
        status: revokedPeer ? 'revoked' : 'active',
        label: 'Their phone',
      },
    ],
  });

  it('folds revoked devices away instead of leaving them in the list', async () => {
    mockFetchControlPlaneState.mockResolvedValue(ownedHousehold(true));

    const tree = await render();

    expect(query(tree, 'budget-sync-device-dev_652de89b0240')).toBeNull();
    expect(query(tree, 'budget-sync-toggle-revoked')).not.toBeNull();
  });

  /** Folded away, not thrown away — the list is also a record of who lost access. */
  it('still lets you look at them', async () => {
    mockFetchControlPlaneState.mockResolvedValue(ownedHousehold(true));

    const tree = await render();
    await act(async () => {
      query(tree, 'budget-sync-toggle-revoked')!.props.onPress();
    });

    expect(query(tree, 'budget-sync-device-dev_652de89b0240')).not.toBeNull();
  });

  it('offers no toggle when nothing has been revoked', async () => {
    mockFetchControlPlaneState.mockResolvedValue(ownedHousehold(false));

    const tree = await render();

    expect(query(tree, 'budget-sync-toggle-revoked')).toBeNull();
  });

  it('shows a spinner on the row while the revoke is in flight', async () => {
    mockFetchControlPlaneState.mockResolvedValue(ownedHousehold(false));
    // Never settles: holds the UI in its in-flight state so it can be observed.
    mockRevoke.mockReturnValue(new Promise(() => {}));

    const tree = await render();
    await act(async () => {
      query(tree, 'budget-settings-revoke-dev_652de89b0240')!.props.onPress();
    });
    // The confirm's destructive action, which is what actually fires the call.
    await act(async () => {
      const [, , buttons] = alertSpy.mock.calls[alertSpy.mock.calls.length - 1]!;
      (buttons as Array<{ text: string; onPress?: () => void }>)
        .find((b) => b.text === 'Revoke')!
        .onPress!();
    });

    expect(query(tree, 'budget-settings-revoking-dev_652de89b0240')).not.toBeNull();
    expect(query(tree, 'budget-settings-revoke-dev_652de89b0240')).toBeNull();
  });
});

/**
 * Folding revoked rows away kept the list readable but left every stale
 * enrolment on record for good — a household that has replaced a few phones
 * carries more dead rows than live ones, and the toggle only moves them out of
 * sight. Removing one is a different act from revoking it (the device lost its
 * access, and its keys, when it was revoked) and is offered only where the
 * member has already asked to see them.
 */
describe('removing a revoked device from the record', () => {
  const householdWithRevokedPeer = (peerStatus = 'revoked', selfRole = 'OWNER') => ({
    keyEpoch: 2,
    members: [{ userId: 'u_self', role: selfRole, status: 'active' }],
    devices: [
      { deviceId: 'dev_self0001', userId: 'u_self', status: 'active', label: 'My phone' },
      {
        deviceId: 'dev_652de89b0240',
        userId: 'u_peer',
        status: peerStatus,
        label: 'Their old phone',
      },
    ],
  });

  /** Unfolding is the friction: you have to have asked to see them first. */
  it('offers Remove only once the revoked rows are unfolded', async () => {
    mockFetchControlPlaneState.mockResolvedValue(householdWithRevokedPeer());

    const tree = await render();
    expect(query(tree, 'budget-sync-forget-dev_652de89b0240')).toBeNull();

    await act(async () => {
      query(tree, 'budget-sync-toggle-revoked')!.props.onPress();
    });

    expect(query(tree, 'budget-sync-forget-dev_652de89b0240')).not.toBeNull();
  });

  it('never offers Remove on a device that still has access', async () => {
    mockFetchControlPlaneState.mockResolvedValue(householdWithRevokedPeer('active'));

    const tree = await render();

    expect(query(tree, 'budget-sync-forget-dev_652de89b0240')).toBeNull();
    expect(query(tree, 'budget-settings-revoke-dev_652de89b0240')).not.toBeNull();
  });

  /** Someone else's hardware stays the owner's to administer. */
  it('offers a non-owner no Remove on a peer’s row', async () => {
    mockFetchControlPlaneState.mockResolvedValue(householdWithRevokedPeer('revoked', 'ADULT'));

    const tree = await render();
    await act(async () => {
      query(tree, 'budget-sync-toggle-revoked')!.props.onPress();
    });

    expect(query(tree, 'budget-sync-forget-dev_652de89b0240')).toBeNull();
  });

  async function unfoldAndRemove(tree: ReactTestRenderer.ReactTestRenderer) {
    await act(async () => {
      query(tree, 'budget-sync-toggle-revoked')!.props.onPress();
    });
    await act(async () => {
      query(tree, 'budget-sync-forget-dev_652de89b0240')!.props.onPress();
    });
    // The confirm's destructive action, which is what fires the call.
    await act(async () => {
      const [, , buttons] = alertSpy.mock.calls[alertSpy.mock.calls.length - 1]!;
      (buttons as Array<{ text: string; onPress?: () => void }>)
        .find((b) => b.text === 'Remove')!
        .onPress!();
    });
  }

  it('deletes the row and repaints from the answer, without a refetch', async () => {
    mockFetchControlPlaneState.mockResolvedValue(householdWithRevokedPeer());
    mockForget.mockResolvedValue({
      keyEpoch: 2,
      members: [{ userId: 'u_self', role: 'OWNER', status: 'active' }],
      devices: [
        { deviceId: 'dev_self0001', userId: 'u_self', status: 'active', label: 'My phone' },
      ],
    });

    const tree = await render();
    expect(mockFetchControlPlaneState).toHaveBeenCalledTimes(1);
    await unfoldAndRemove(tree);

    // Named household, never "whatever is active by the time this resolves".
    expect(mockForget).toHaveBeenCalledWith('hh-1', 'dev_652de89b0240');
    expect(query(tree, 'budget-sync-device-dev_652de89b0240')).toBeNull();
    expect(query(tree, 'budget-sync-toggle-revoked')).toBeNull();
    expect(mockFetchControlPlaneState).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner on the row while the delete is in flight', async () => {
    mockFetchControlPlaneState.mockResolvedValue(householdWithRevokedPeer());
    // Never settles: holds the UI in its in-flight state so it can be observed.
    mockForget.mockReturnValue(new Promise(() => {}));

    const tree = await render();
    await unfoldAndRemove(tree);

    expect(query(tree, 'budget-settings-revoking-dev_652de89b0240')).not.toBeNull();
    expect(query(tree, 'budget-sync-forget-dev_652de89b0240')).toBeNull();
  });

  /**
   * The row went back to active between render and tap — the device re-enrolled.
   * Deleting it now would drop a live key holder out of the list the household
   * polices access with, so the server refuses and the member is told why.
   */
  it('explains a 409 instead of reporting a generic failure', async () => {
    mockFetchControlPlaneState.mockResolvedValue(householdWithRevokedPeer());
    mockForget.mockRejectedValue({ response: { status: 409 } });

    const tree = await render();
    await unfoldAndRemove(tree);

    const [title] = alertSpy.mock.calls[alertSpy.mock.calls.length - 1]!;
    expect(title).toBe('Still has access');
    // …and the list is re-read, because what is on screen is now known to be stale.
    expect(mockFetchControlPlaneState).toHaveBeenCalledTimes(2);
  });

  it('names the rule on a 403 rather than inviting a retry', async () => {
    mockFetchControlPlaneState.mockResolvedValue(householdWithRevokedPeer());
    mockForget.mockRejectedValue({ response: { status: 403 } });

    const tree = await render();
    await unfoldAndRemove(tree);

    const [title] = alertSpy.mock.calls[alertSpy.mock.calls.length - 1]!;
    expect(title).toBe('Owner only');
  });
});
