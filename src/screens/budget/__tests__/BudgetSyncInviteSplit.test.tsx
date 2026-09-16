/**
 * Budget → Settings, sync/backup/invite split (BUDGET-LF-002).
 *
 * Sync, Backup and Invite used to be one stacked card on Budget Settings, with
 * the danger zone dropped at the very bottom of the screen. They are now three
 * dedicated rows leading to three screens, and the danger zone sits on Device
 * Sync — beside the trusted-device list that says who else holds a copy.
 *
 * What is pinned here is the routing contract the E2E suites depend on: which
 * row leads where, that Settings no longer renders the danger zone at all, and
 * that Sync now / Create an invite still exist under their original testIDs on
 * the screens that inherited them.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockRouteParams: { current: Record<string, string> | undefined } = { current: undefined };

jest.mock('expo-router/react-navigation', () => {
  const React = require('react');
  return {
    __esModule: true,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      canGoBack: () => true,
      setParams: jest.fn(),
    }),
    // The Join screen takes a tapped invite link as route params, handed over
    // by the hub. `mockRouteParams` is mutable so a test can play the tapped link.
    useRoute: () => ({ params: mockRouteParams.current }),
    // Settings re-reads the months on focus; in tests that is "on mount".
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
  };
});

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    screenScrollViewStyle: { scroll: {} },
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
    ScreenHeader: ({ onBackPress }: { onBackPress?: () => void }) =>
      React.createElement(TouchableOpacity, { onPress: onBackPress, testID: 'nav-back-button' }),
  };
});

jest.mock('@features/budget/local/flag', () => ({
  __esModule: true,
  isBudgetLocalFirst: () => true,
}));

// SYNC & SHARING renders on Profile, which is a sibling TAB of the one hosting
// the Budget stack — so its rows carry no `navigation` and go through the app's
// own URL instead. These are the helpers that open that door; what the rows owe
// is calling the right one, which is all this suite can (and should) assert.
const mockNavSync = jest.fn();
const mockNavBackup = jest.fn();
const mockNavHouseholds = jest.fn();
const mockNavInvite = jest.fn();
const mockNavExport = jest.fn();
jest.mock('@services/navigation', () => ({
  __esModule: true,
  navigateToBudgetSync: () => mockNavSync(),
  navigateToBudgetBackup: () => mockNavBackup(),
  navigateToBudgetHouseholds: () => mockNavHouseholds(),
  navigateToBudgetInvite: () => mockNavInvite(),
  navigateToBudgetExport: () => mockNavExport(),
}));

// The default test brand is `symply-house` (minimal budget), so the section's
// own gate would hide it and every assertion below would pass against nothing.
jest.mock('@features/budget', () => ({
  ...jest.requireActual('@features/budget'),
  isFullBudget: () => true,
}));

// Whether THIS device is the one waiting to be let in. Mutable so a test can
// put the screen on the invitee's side of the hand-off; reset in `beforeEach`.
const engineFlags = { awaitingEnrolment: false };

/** The households this device holds — the joined one leaves the set when dropped. */
const mockHeldHouseholds = new Set(['hh-local-1', 'hh-2']);

/**
 * Dropping the half-joined household is what ENDS the wait for a claim that
 * died, so the fake does what the real one does: the household is gone, and the
 * engine stops saying this device is awaiting anything. Without that the
 * re-enabled join controls could not be asserted at all.
 */
const mockAbandonEnrolment = jest.fn(async (householdId: string) => {
  mockHeldHouseholds.delete(householdId);
  engineFlags.awaitingEnrolment = false;
  return true;
});

/**
 * The households the ENGINE holds — what the hub's household card is built on.
 *
 * Mutable, because the card has two shapes and only the list decides which: one
 * household is a card that goes straight to that household's page, several is a
 * dropdown. Reset to the single-household default in `beforeEach`.
 */
type LocalHouseholdFixture = {
  householdId: string;
  id: string;
  name: string;
  role: string;
  isActive: boolean;
};
const SOLE_HOUSEHOLD: LocalHouseholdFixture = {
  householdId: 'hh-local-1',
  id: 'hh-local-1',
  name: 'My Household',
  role: 'owner',
  isActive: true,
};
const SECOND_HOUSEHOLD: LocalHouseholdFixture = {
  householdId: 'hh-2',
  id: 'hh-2',
  name: 'The Wilsons',
  role: 'member',
  isActive: false,
};
let mockLocalHouseholds: LocalHouseholdFixture[] = [SOLE_HOUSEHOLD];
const mockActivateHousehold = jest.fn(async (_householdId: string) => {});

jest.mock('@features/budget/local/engine', () => ({
  __esModule: true,
  // The name matters now: the join dialog has to say which budget is about to
  // be replaced, and it reads it from here.
  getLocalLedger: () => ({
    deviceId: 'dev-self',
    household: { id: 'hh-local-1', name: 'My Household' },
  }),
  isLocalBudgetSessionOpen: () => true,
  isAwaitingHouseholdEnrolment: () => engineFlags.awaitingEnrolment,
  abandonHouseholdEnrolment: (id: string) => mockAbandonEnrolment(id),
  // Whether the household is still ON this device — which is how the wait tells
  // "the key arrived" from "the claim was dropped". Both leave the engine
  // saying nothing is awaited.
  hasLocalBudgetHousehold: (id: string) => mockHeldHouseholds.has(id),
  subscribeToLedgerChanges: () => () => {},
  // Read through `useSyncExternalStore` by the household members card, which
  // every one of these screens renders — a missing snapshot getter fails as
  // "getSnapshot is not a function" pointing at React, not at this mock.
  getActiveBudgetHouseholdId: () => 'hh-local-1',
  getLedgerRevision: () => 1,
  // Device Sync counts unresolved conflicts per household on every render.
  getLocalConflicts: () => [],
  // BR-016: the screen reads the households this device already HOLDS on every
  // render, so the join dialog can promise they are kept. Omitting it took the
  // whole suite down with "listLocalBudgetHouseholds is not a function".
  //
  // `householdId` is the engine's own field name and the hub's household card
  // navigates by it, so the fixture carries both spellings — `id` for the join
  // dialog, which was written against the earlier shape.
  listLocalBudgetHouseholds: () => mockLocalHouseholds,
  // The household card at the top of the hub switches by activating, and only
  // by activating — `ensureSession` republishes the store off the ledger event.
  activateLocalBudgetHousehold: (id: string) => mockActivateHousehold(id),
}));

const mockRunSync = jest.fn();
jest.mock('@features/budget/local/sync/orchestrator', () => ({
  __esModule: true,
  runBudgetLocalSync: (...a: unknown[]) => mockRunSync(...a),
}));

const mockFetchControlPlaneState = jest.fn();
const mockCreateInvite = jest.fn();
const mockListPendingJoinRequests = jest.fn();
const mockJoinHousehold = jest.fn();
const mockLookupInvite = jest.fn();
const mockLookupInviteById = jest.fn();
const mockListOutstanding = jest.fn();
const mockRevokeInvite = jest.fn();
const mockDeriveJoinRequestSas = jest.fn();
const mockApproveInvite = jest.fn();
jest.mock('@features/budget/local/controlPlaneClient', () => ({
  __esModule: true,
  fetchControlPlaneState: (...a: unknown[]) => mockFetchControlPlaneState(...a),
  createLocalFirstInvite: (...a: unknown[]) => mockCreateInvite(...a),
  approveLocalFirstInvite: (...a: unknown[]) => mockApproveInvite(...a),
  deriveJoinRequestSas: (...a: unknown[]) => mockDeriveJoinRequestSas(...a),
  joinLocalFirstHousehold: (...a: unknown[]) => mockJoinHousehold(...a),
  listPendingJoinRequests: (...a: unknown[]) => mockListPendingJoinRequests(...a),
  lookupLocalFirstInvite: (...a: unknown[]) => mockLookupInvite(...a),
  lookupLocalFirstInviteById: (...a: unknown[]) => mockLookupInviteById(...a),
  listOutstandingInvites: (...a: unknown[]) => mockListOutstanding(...a),
  revokeLocalFirstInvite: (...a: unknown[]) => mockRevokeInvite(...a),
  parseInviteInput: () => ({ shortCode: null, secret: null }),
  buildBudgetInviteLink: (invite: { inviteId: string; shortCode: string; secret: string }) =>
    `simplebudget://lf-invite?id=${invite.inviteId}&secret=${invite.secret}&code=${invite.shortCode}`,
  revokeLocalFirstDevice: jest.fn(async () => {}),
  renameLocalFirstDevice: jest.fn(async () => ({ name: 'This iPhone', state: null })),
}));

const mockTakePendingInvite = jest.fn(() => null);
jest.mock('@features/budget/local/inviteLinkStore', () => ({
  __esModule: true,
  // Only the hand-off is faked. `parseBudgetInviteLink` stays REAL: it is what
  // turns a scanned payload into a code and a secret, and a stub returning null
  // would test nothing but the stub.
  ...jest.requireActual('@features/budget/local/inviteLinkStore'),
  takePendingBudgetInvite: () => mockTakePendingInvite(),
}));

// The invitee's six digits survive the join that unmounts the screen deriving
// them, so they are read back from storage rather than held in state.
type PendingJoinFixture = {
  inviteId: string;
  householdId: string | null;
  sas: string;
  outcome?: 'revoked' | 'expired';
};
const mockRecallJoinSas = jest.fn(
  async (): Promise<PendingJoinFixture | null> => ({
    inviteId: 'inv_9',
    householdId: 'hh-2',
    sas: '123456',
  }),
);
const mockNoteJoinOutcome = jest.fn(async (_outcome: 'revoked' | 'expired') => {});
const mockForgetJoinSas = jest.fn(async () => {});
jest.mock('@services/enrolment/inviteSecretStore', () => ({
  __esModule: true,
  recallJoinSas: () => mockRecallJoinSas(),
  noteJoinOutcome: (outcome: 'revoked' | 'expired') => mockNoteJoinOutcome(outcome),
  forgetJoinSas: () => mockForgetJoinSas(),
  rememberJoinSas: jest.fn(async () => {}),
  rememberInviteSecret: jest.fn(async () => {}),
  recallInviteSecret: jest.fn(async () => 'secret'),
  forgetInviteSecret: jest.fn(async () => {}),
}));

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

jest.mock('@features/budget/local/export/budgetLedgerExport', () => ({
  __esModule: true,
  exportBudgetLedgerCsv: jest.fn(async () => ({ status: 'shared', message: 'done' })),
}));

jest.mock('expo-clipboard', () => ({
  __esModule: true,
  setStringAsync: jest.fn(async () => {}),
}));

// The QR itself is `react-native-qrcode-svg`'s job, not ours; what this suite
// pins is the PAYLOAD it is handed — the link, so a phone camera can read it.
jest.mock('react-native-qrcode-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => React.createElement(View, props),
  };
});

// A live camera cannot run under Jest (no permission, no device), so the
// scanner is stubbed down to the one thing the screen cares about: a payload
// arriving from it. `onScanned` is exposed on the stub for the tests to fire.
jest.mock('@features/budget/components/BudgetInviteQrScanner', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    BudgetInviteQrScanner: ({
      visible,
      onScanned,
      onClose,
    }: {
      visible: boolean;
      onScanned: (payload: string) => void;
      onClose: () => void;
    }) =>
      visible
        ? React.createElement(
            View,
            { testID: 'budget-invite-scanner' },
            React.createElement(View, { testID: 'budget-invite-scanner-camera', onScanned }),
            React.createElement(View, { testID: 'budget-invite-scanner-close', onPress: onClose })
          )
        : null,
  };
});

jest.mock('@api/budget', () => ({
  __esModule: true,
  budgetApi: {
    getMonthlyGoal: jest.fn(async () => ({ goal: { planned_budget: null } })),
    setMonthlyGoal: jest.fn(async () => ({ isFirstForYear: false })),
    applyGoalToYear: jest.fn(async () => ({})),
  },
}));

jest.mock('@stores/budgetStore', () => ({
  __esModule: true,
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = { selectedYear: 2026, selectedMonth: 7, markInsightsDirty: jest.fn() };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

// A real-enough store: the member roster reads it through BOTH the hook and
// `getState()` (the latter from `householdRoster`, which publishes what the
// control plane says about each member). A hook-only stand-in threw
// `getState is not a function` the moment the household card mounted.
jest.mock('@stores/householdStore', () => {
  const state = {
    currentHousehold: { id: 'hh-1' },
    currentHouseholdMembers: [
      {
        id: 'usr-owner',
        user_id: 'usr-owner',
        display_name: 'Ada Owner',
        avatar_url: null,
        email: 'ada@example.com',
        role: 'owner',
        joined_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    setCurrentHouseholdMembers: jest.fn(),
  };
  const useHouseholdStore = (sel?: (s: unknown) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  useHouseholdStore.getState = () => state;
  useHouseholdStore.setState = (patch: Record<string, unknown>) => Object.assign(state, patch);
  return { __esModule: true, useHouseholdStore };
});

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { BudgetSyncSharingSection } from '@features/budget/components/BudgetSyncSharingSection';
// The real classes, deliberately: the client module above is mocked, so the
// screen's `instanceof` checks are only worth anything against these.
import {
  BudgetInviteAlreadyApprovedError,
  BudgetInviteGoneError,
} from '@features/budget/local/errors';

import { BudgetInviteCreateScreen } from '../BudgetInviteCreateScreen';
import { BudgetInviteScreen } from '../BudgetInviteScreen';
import { BudgetJoinScreen } from '../BudgetJoinScreen';
import { BudgetSettingsScreen } from '../BudgetSettingsScreen';
import { BudgetSyncScreen } from '../BudgetSyncScreen';

async function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

const find = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.find((n) => n.props?.testID === id);

const query = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0] ?? null;

async function press(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  await act(async () => {
    find(tree, id).props.onPress();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

/**
 * The two halves are their own screens now, pushed from the hub. What used to
 * be "open the section" is "render the screen the row leads to" — which is also
 * what makes these tests honest: a person arrives at the whole screen, not at a
 * panel that may or may not be mounted.
 */
const renderInviteHalf = () => render(<BudgetInviteCreateScreen />);
const renderJoinHalf = () => render(<BudgetJoinScreen />);

beforeEach(() => {
  jest.clearAllMocks();
  engineFlags.awaitingEnrolment = false;
  // Set here rather than left to the `jest.fn` factory: `clearAllMocks` keeps
  // implementations, so a per-test `mockResolvedValue` would otherwise leak
  // into every test that ran after it.
  mockRecallJoinSas.mockResolvedValue({
    inviteId: 'inv_9',
    householdId: 'hh-2',
    sas: '123456',
  });
  mockHeldHouseholds.clear();
  mockHeldHouseholds.add('hh-local-1');
  mockHeldHouseholds.add('hh-2');
  mockAbandonEnrolment.mockImplementation(async (householdId: string) => {
    mockHeldHouseholds.delete(householdId);
    engineFlags.awaitingEnrolment = false;
    return true;
  });
  mockRouteParams.current = undefined;
  mockLocalHouseholds = [SOLE_HOUSEHOLD];
  mockActivateHousehold.mockResolvedValue(undefined);
  mockTakePendingInvite.mockReturnValue(null);
  mockRunSync.mockResolvedValue(undefined);
  mockFetchControlPlaneState.mockResolvedValue({ devices: [], keyEpoch: 1 });
  mockCreateInvite.mockResolvedValue({
    inviteId: 'inv_1',
    shortCode: 'ABC123',
    secret: 's3cr3t',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    universalLink: 'symply-budget://lf-invite?code=ABC123',
    inviteeEmail: null,
  });
  mockListPendingJoinRequests.mockResolvedValue([]);
  mockDeriveJoinRequestSas.mockResolvedValue('123456');
  mockApproveInvite.mockResolvedValue({
    approved: { userId: 'usr-2', deviceId: 'dev-2', agreementPublicKey: 'ag' },
  });
  mockJoinHousehold.mockResolvedValue({ householdId: 'hh-2', inviteId: 'inv_9', sas: '123456' });
  mockLookupInvite.mockResolvedValue({
    inviteId: 'inv_9',
    householdId: 'hh-2',
    householdName: 'The Wilsons',
    status: 'active',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  mockLookupInviteById.mockResolvedValue({
    inviteId: 'inv_9',
    householdId: 'hh-2',
    householdName: 'The Wilsons',
    status: 'claimed',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  mockListOutstanding.mockResolvedValue([]);
  mockRevokeInvite.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('Budget Settings — sync section', () => {
  it('no longer carries SYNC & SHARING at all — it moved to Profile', async () => {
    const tree = await render(<BudgetSettingsScreen />);

    // The whole group, not just its rows: a settings screen that kept the
    // heading with nothing under it would read as a broken section, and one
    // that kept a single row would be the duplicate this move deleted.
    for (const id of [
      'budget-local-first-sync-card',
      'budget-settings-sync-section',
      'budget-settings-sync-link',
      'budget-settings-backup-link',
      'budget-settings-households-link',
      'budget-settings-invite-link',
      'budget-settings-export-link',
    ]) {
      expect(query(tree, id)).toBeNull();
    }
    // …and nothing on Settings routes to those screens any more.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('keeps the danger zone off Settings, and the enrolment controls with it', async () => {
    const tree = await render(<BudgetSettingsScreen />);

    expect(query(tree, 'budget-danger-zone')).toBeNull();
    expect(query(tree, 'budget-settings-sync-now')).toBeNull();
    expect(query(tree, 'budget-settings-create-invite')).toBeNull();
    expect(query(tree, 'budget-settings-join-panel')).toBeNull();
    // Export is a row of its own (BudgetExportScreen owns the CSV/XLSX buttons),
    // and that row now sits on Profile with the rest of SYNC & SHARING.
    expect(query(tree, 'budget-settings-export-csv')).toBeNull();
    expect(query(tree, 'budget-settings-export-xlsx')).toBeNull();
  });

  it('groups the budget-shaping rows under MANAGE BUDGET, editor included', async () => {
    const tree = await render(<BudgetSettingsScreen />);

    expect(query(tree, 'budget-settings-manage-section')).not.toBeNull();
    // The 12-month grid is a row here now, not the screen's opening wall.
    expect(query(tree, 'budget-settings-planned-budget')).toBeNull();
    expect(query(tree, 'budget-settings-monthly-caps-link')).not.toBeNull();
    expect(query(tree, 'budget-settings-transfer-link')).not.toBeNull();
    expect(query(tree, 'budget-settings-categories-link')).not.toBeNull();
    expect(query(tree, 'budget-settings-sub-budgets-link')).not.toBeNull();

    await press(tree, 'budget-settings-monthly-caps-link');
    expect(mockNavigate).toHaveBeenCalledWith('BudgetMonthlyCaps');
  });

  it('groups the import/export rows under SHARING', async () => {
    const tree = await render(<BudgetSettingsScreen />);

    expect(query(tree, 'budget-settings-sharing-section')).not.toBeNull();
    expect(query(tree, 'budget-settings-soft-transfer-link')).not.toBeNull();
    expect(query(tree, 'budget-settings-soft-transfer-export-link')).not.toBeNull();
    expect(query(tree, 'budget-settings-data-sharing-link')).not.toBeNull();
  });
});

/**
 * The section in its new home. Rendered on its own rather than through Profile:
 * what moved is this component and its five destinations, and mounting the whole
 * profile screen would drag in the avatar picker, the subscription card and the
 * auth store for no extra coverage.
 */
describe('SYNC & SHARING on Profile', () => {
  it('offers one dedicated row per destination and opens each through the app URL', async () => {
    const tree = await render(<BudgetSyncSharingSection />);

    // Headed by a group label, the same shape the Budget Settings sections use.
    expect(query(tree, 'budget-settings-sync-section')).not.toBeNull();

    await press(tree, 'budget-settings-sync-link');
    expect(mockNavSync).toHaveBeenCalledTimes(1);

    await press(tree, 'budget-settings-backup-link');
    expect(mockNavBackup).toHaveBeenCalledTimes(1);

    await press(tree, 'budget-settings-households-link');
    expect(mockNavHouseholds).toHaveBeenCalledTimes(1);

    await press(tree, 'budget-settings-invite-link');
    expect(mockNavInvite).toHaveBeenCalledTimes(1);

    await press(tree, 'budget-settings-export-link');
    expect(mockNavExport).toHaveBeenCalledTimes(1);
  });

  it('carries the live status lines the rows are worth having', async () => {
    const tree = await render(<BudgetSyncSharingSection />);

    // Each row says something about the state it leads to — a column of five
    // bare titles would be a menu, not a status surface, and this is the half
    // that would rot silently if the move dropped a store subscription.
    expect(query(tree, 'budget-settings-sync-status')).not.toBeNull();
    expect(query(tree, 'budget-settings-backup-status')).not.toBeNull();
    expect(query(tree, 'budget-settings-households-status')).not.toBeNull();
    expect(query(tree, 'budget-settings-invite-entry-status')).not.toBeNull();
    expect(query(tree, 'budget-settings-export-status')).not.toBeNull();
  });

  it('says a pending join is still waiting, on the row that leads to it', async () => {
    // The reason the Invite row subscribes to the engine at all: a member who
    // claimed an invite must find that state where they left it, not only on
    // the screen behind the row.
    engineFlags.awaitingEnrolment = true;
    const tree = await render(<BudgetSyncSharingSection />);

    expect(query(tree, 'budget-settings-invite-entry-status')?.props.children).toBe(
      'Waiting for approval…',
    );
  });
});

describe('BudgetSyncScreen', () => {
  it('syncs on demand and reports the outcome inline', async () => {
    const tree = await render(<BudgetSyncScreen />);

    await press(tree, 'budget-settings-sync-now');

    expect(mockRunSync).toHaveBeenCalledTimes(1);
    expect(query(tree, 'budget-settings-sync-note')).not.toBeNull();
  });

  it('carries the danger zone, with Back up first leading to Backup & Restore', async () => {
    const tree = await render(<BudgetSyncScreen />);

    expect(query(tree, 'budget-danger-zone')).not.toBeNull();
    await press(tree, 'budget-danger-erase');
    await press(tree, 'budget-danger-backup-first');
    expect(mockNavigate).toHaveBeenCalledWith('BudgetBackup');
  });
});

describe('BudgetInviteScreen — the hub', () => {
  it('is three rows that go somewhere, not sections that unfold', async () => {
    // A disclosure triangle is not a destination. Everything inside a closed
    // section is invisible to the eye, to a screen reader and to a UI test, and
    // the person arriving had to know which triangle was theirs first.
    const tree = await render(<BudgetInviteScreen />);

    expect(query(tree, 'budget-invite-section-invite')).not.toBeNull();
    expect(query(tree, 'budget-invite-section-join')).not.toBeNull();
    expect(query(tree, 'budget-invite-section-households')).not.toBeNull();

    // Neither half's body is here under any circumstances now — they are other
    // screens, so there is nothing left that could be "present but invisible".
    expect(query(tree, 'budget-settings-create-invite')).toBeNull();
    expect(query(tree, 'budget-settings-join-panel')).toBeNull();
  });

  it('pushes each destination rather than expanding it in place', async () => {
    const tree = await render(<BudgetInviteScreen />);

    await press(tree, 'budget-invite-section-invite');
    expect(mockNavigate).toHaveBeenCalledWith('BudgetInviteCreate');

    await press(tree, 'budget-invite-section-join');
    expect(mockNavigate).toHaveBeenCalledWith('BudgetJoin');

    // The households themselves used to live in another navigation tree
    // entirely (More → Household & Members), so "who is in this?" and "which
    // budget is this?" were answered two trees apart.
    await press(tree, 'budget-invite-section-households');
    expect(mockNavigate).toHaveBeenCalledWith('BudgetHouseholds');
  });

  it('answers "who is in this household" inline — it is the answer, not a task', async () => {
    const tree = await render(<BudgetInviteScreen />);

    expect(query(tree, 'budget-household-members')).not.toBeNull();
  });

  it('names the household at the top, and one household is a card to its own page', async () => {
    // WHICH budget, before WHO is in it. With one household there is nothing to
    // choose, so the card must not behave like a chooser — it goes to the one
    // place the household can actually be renamed.
    const tree = await render(<BudgetInviteScreen />);

    expect(query(tree, 'budget-household-switcher')).not.toBeNull();
    expect(query(tree, 'budget-household-picker-sheet')).toBeNull();

    await press(tree, 'budget-household-switcher-trigger');

    expect(mockNavigate).toHaveBeenCalledWith('BudgetHouseholdEdit', {
      householdId: 'hh-local-1',
    });
  });

  it('turns the card into a dropdown once a second household is held', async () => {
    mockLocalHouseholds = [SOLE_HOUSEHOLD, SECOND_HOUSEHOLD];

    const tree = await render(<BudgetInviteScreen />);

    // The trigger now opens the list rather than the household's page.
    await press(tree, 'budget-household-switcher-trigger');
    expect(mockNavigate).not.toHaveBeenCalledWith('BudgetHouseholdEdit', expect.anything());
    expect(query(tree, 'budget-household-picker-sheet')).not.toBeNull();

    // Picking one moves the ENGINE. Nothing writes the household store here —
    // `ensureSession` republishes it from the ledger event activation emits.
    await press(tree, 'budget-household-picker-item-hh-2');
    expect(mockActivateHousehold).toHaveBeenCalledWith('hh-2');
  });

  it('keeps every household one tap from its own page, active or not', async () => {
    // The single-household card promises "tap it, rename it". A second
    // household turning that card into a picker must not take the promise away.
    mockLocalHouseholds = [SOLE_HOUSEHOLD, SECOND_HOUSEHOLD];

    const tree = await render(<BudgetInviteScreen />);

    await press(tree, 'budget-household-switcher-trigger');
    await press(tree, 'budget-household-picker-edit-hh-2');

    expect(mockActivateHousehold).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('BudgetHouseholdEdit', { householdId: 'hh-2' });
  });

  it('hands a tapped invite link to the screen that can act on it', async () => {
    // The link carries both halves of the invite, so the invitee's only
    // remaining act is agreeing to the household it names. Landing them on the
    // hub with no sign of why they are here is the alternative.
    mockTakePendingInvite.mockReturnValueOnce({
      code: 'ABC123',
      secret: 's3cr3t',
    } as never);

    await render(<BudgetInviteScreen />);

    expect(mockNavigate).toHaveBeenCalledWith('BudgetJoin', {
      code: 'ABC123',
      secret: 's3cr3t',
    });
  });
});

describe('BudgetInviteCreateScreen', () => {

  it('mints an invite from the screen that owns it', async () => {
    const tree = await renderInviteHalf();

    await press(tree, 'budget-settings-create-invite');

    expect(mockCreateInvite).toHaveBeenCalledTimes(1);
  });

  it('puts the QR code on screen in the same tap that mints the invite', async () => {
    // The button says "Generate QR code"; landing on a card of strings instead
    // would be a bait and switch.
    const tree = await renderInviteHalf();

    await press(tree, 'budget-settings-create-invite');

    expect(query(tree, 'budget-invite-qr-sheet')).not.toBeNull();
    // The code encodes the LINK, not a bare code+secret pair: that is what
    // makes it scannable by the phone camera as well as by this app.
    expect(query(tree, 'budget-invite-qr')?.props.value).toBe(
      'simplebudget://lf-invite?id=inv_1&secret=s3cr3t&code=ABC123'
    );
    expect(query(tree, 'budget-invite-qr-share')).not.toBeNull();
  });

  it('shows the invite in place, with both halves and a way to send them', async () => {
    // It used to be an Alert that vanished on OK, so the code was unreadable a
    // second later and the only copy was one the app had made silently.
    const tree = await renderInviteHalf();

    await press(tree, 'budget-settings-create-invite');

    expect(query(tree, 'budget-invite-created-panel')).not.toBeNull();
    expect(find(tree, 'budget-invite-code').props.children).toBe('ABC123');
    expect(find(tree, 'budget-invite-secret').props.children).toBe('s3cr3t');
    expect(query(tree, 'budget-invite-share')).not.toBeNull();
    expect(query(tree, 'budget-invite-copy-code')).not.toBeNull();
    expect(query(tree, 'budget-invite-copy-secret')).not.toBeNull();
    // The sheet can be dismissed and is not the only way back to the code.
    expect(query(tree, 'budget-invite-show-qr')).not.toBeNull();
    // No answer to memorise on this card any more: the verification digits are
    // derived from the claiming device's keys and cannot exist until it claims.
    expect(query(tree, 'budget-invite-oob-correct')).toBeNull();
  });

  it('copies nothing until asked', async () => {
    const Clipboard = require('expo-clipboard');
    const tree = await renderInviteHalf();

    await press(tree, 'budget-settings-create-invite');
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();

    await press(tree, 'budget-invite-copy-code');
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('ABC123');
  });

});

describe('BudgetJoinScreen', () => {
  it('keeps the join panel to a scan and the two fields the invite is made of', async () => {
    const tree = await renderJoinHalf();

    expect(query(tree, 'budget-settings-join-panel')).not.toBeNull();
    expect(query(tree, 'budget-settings-scan-invite')).not.toBeNull();
    expect(query(tree, 'budget-settings-join-code')).not.toBeNull();
    expect(query(tree, 'budget-settings-join-secret')).not.toBeNull();
    expect(query(tree, 'budget-settings-join-household')).not.toBeNull();
    // The separate "paste the invite link" field is gone: the code field takes
    // a pasted link and splits it, and a tapped link fills both.
    expect(query(tree, 'budget-settings-join-link')).toBeNull();
  });

  it('opens the camera on Scan QR code, and confirms rather than joins on a hit', async () => {
    const tree = await renderJoinHalf();

    await press(tree, 'budget-settings-scan-invite');
    expect(query(tree, 'budget-invite-scanner')).not.toBeNull();

    await act(async () => {
      find(tree, 'budget-invite-scanner-camera').props.onScanned(
        'simplebudget://lf-invite?id=inv_9&secret=scanned-secret&code=QRCODE'
      );
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    // Scanning is intent, but a join still replaces this device's budget — the
    // one tap nobody gets to skip.
    expect(query(tree, 'budget-settings-join-confirm-panel')).not.toBeNull();
    expect(find(tree, 'budget-settings-join-code').props.value).toBe('QRCODE');
    expect(find(tree, 'budget-settings-join-secret').props.value).toBe('scanned-secret');
    expect(mockJoinHousehold).not.toHaveBeenCalled();
  });

  it('names the household being joined, and the ones this device keeps', async () => {
    // BR-016 B6 turned a swap into an addition: joining no longer clears the
    // ledger, so the dialog's second row stopped being the casualty list and
    // became the reassurance. Both rows still have to NAME households — "your
    // budget" is unanswerable for anyone who belongs to more than one.
    const tree = await renderJoinHalf();
    await press(tree, 'budget-settings-scan-invite');
    await act(async () => {
      find(tree, 'budget-invite-scanner-camera').props.onScanned(
        'simplebudget://lf-invite?id=inv_9&secret=scanned-secret&code=QRCODE'
      );
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(mockLookupInvite).toHaveBeenCalledWith('QRCODE');
    expect(find(tree, 'budget-join-confirm-target').props.children).toBe('The Wilsons');
    expect(find(tree, 'budget-join-confirm-keeping').props.children).toBe('My Household');
  });

  it('still asks — without a name — when the household cannot be looked up', async () => {
    // Offline in front of the person who just invited you is not a reason to
    // refuse: the join itself re-resolves the code.
    mockLookupInvite.mockRejectedValueOnce(new Error('offline'));
    const tree = await renderJoinHalf();
    await press(tree, 'budget-settings-scan-invite');
    await act(async () => {
      find(tree, 'budget-invite-scanner-camera').props.onScanned(
        'simplebudget://lf-invite?id=inv_9&secret=scanned-secret&code=QRCODE'
      );
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(query(tree, 'budget-settings-join-confirm-panel')).not.toBeNull();
    expect(find(tree, 'budget-join-confirm-target').props.children).toBe('their household');
  });

  it('refuses a spent invite before anything destructive is offered', async () => {
    mockLookupInvite.mockResolvedValueOnce({
      inviteId: 'inv_9',
      householdId: 'hh-2',
      householdName: 'The Wilsons',
      status: 'revoked',
      expiresAt: new Date().toISOString(),
    });
    const tree = await renderJoinHalf();
    await press(tree, 'budget-settings-scan-invite');
    await act(async () => {
      find(tree, 'budget-invite-scanner-camera').props.onScanned(
        'simplebudget://lf-invite?id=inv_9&secret=scanned-secret&code=QRCODE'
      );
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(query(tree, 'budget-settings-join-confirm-panel')).toBeNull();
    expect(find(tree, 'budget-settings-join-status').props.children).toContain('cancelled');
  });

  it('says so when the code scanned was not one of ours', async () => {
    // "Nothing happened" after pointing a camera at something is
    // indistinguishable from a camera that did not work.
    const tree = await renderJoinHalf();

    await press(tree, 'budget-settings-scan-invite');
    await act(async () => {
      find(tree, 'budget-invite-scanner-camera').props.onScanned('https://example.com/lunch-menu');
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(query(tree, 'budget-settings-join-confirm-panel')).toBeNull();
    expect(find(tree, 'budget-settings-join-status').props.children).toContain(
      'not a Symply Budget invite'
    );
  });

  it('asks for an invite before confirming a destructive join', async () => {
    const tree = await renderJoinHalf();

    await press(tree, 'budget-settings-join-household');

    expect(query(tree, 'budget-settings-join-confirm-panel')).toBeNull();
    expect(find(tree, 'budget-settings-join-status').props.children).toContain('code and the secret');
  });

  /** An invite somebody has claimed and is waiting on — the row Cancel sits in. */
});

describe('BudgetInviteCreateScreen — invites already sent', () => {
  const claimedInvite = () => ({
    inviteId: 'inv_claimed',
    shortCode: 'CLM222',
    status: 'claimed',
    role: 'ADULT',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    inviteeEmail: null,
    createdByUserId: 'u1',
    createdAt: new Date().toISOString(),
    claimedByUserId: 'u2',
    claimedByEmail: 'them@example.com',
    claimedByDisplayName: 'Sam',
  });

  it('lists invites already out in the world, so they can be cancelled', async () => {
    // Minted on a previous run of the app, these had no representation in the
    // UI at all — so a code sent to the wrong person stayed live until it
    // expired and nobody could do a thing about it.
    mockListOutstanding.mockResolvedValue([
      {
        inviteId: 'inv_old',
        shortCode: 'OLD111',
        status: 'active',
        role: 'ADULT',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        inviteeEmail: null,
        createdByUserId: 'u1',
        createdAt: new Date().toISOString(),
        claimedByUserId: null,
        claimedByEmail: null,
        claimedByDisplayName: null,
      },
    ]);
    const tree = await renderInviteHalf();

    expect(query(tree, 'budget-invite-outstanding-panel')).not.toBeNull();
    expect(query(tree, 'budget-invite-revoke-OLD111')).not.toBeNull();

    await press(tree, 'budget-invite-revoke-OLD111');

    expect(mockRevokeInvite).toHaveBeenCalledWith('inv_old');
    expect(query(tree, 'budget-invite-revoke-OLD111')).toBeNull();
    expect(find(tree, 'budget-invite-revoke-note').props.children).toContain('no longer works');
  });

  it('says the waiting device was told, when the cancelled invite had a claimant', async () => {
    mockListOutstanding.mockResolvedValue([claimedInvite()]);
    const tree = await renderInviteHalf();

    await press(tree, 'budget-invite-revoke-CLM222');

    expect(find(tree, 'budget-invite-revoke-note').props.children).toContain('has been told');
  });

  /**
   * The production failure this branch exists for.
   *
   * An owner approved a device at 22:42 and tapped Cancel on the invite that
   * had enrolled it at 22:42:59 and again at 22:43:03. Both taps were refused
   * 409 by the control plane — correctly, the device is a member and dropping
   * the invite would not remove it — and both were reported as "check you are
   * online and try again" over a state no network could change.
   */
  it('says an already-approved invite is approved, rather than blaming the network', async () => {
    // Second read is empty on purpose: an approved invite is not outstanding,
    // which is exactly why the control plane refused the cancel.
    mockListOutstanding.mockResolvedValueOnce([claimedInvite()]).mockResolvedValue([]);
    mockRevokeInvite.mockRejectedValue(new BudgetInviteAlreadyApprovedError());
    const tree = await renderInviteHalf();

    await press(tree, 'budget-invite-revoke-CLM222');

    const note = find(tree, 'budget-invite-revoke-note').props.children;
    expect(note).toContain('already approved');
    expect(note).toContain('Device Sync');
    expect(note).not.toContain('online');
    // …and the row goes, because it can never be acted on again.
    expect(query(tree, 'budget-invite-revoke-CLM222')).toBeNull();
  });

  it('treats an invite cancelled elsewhere as done, not as a failure', async () => {
    mockListOutstanding.mockResolvedValueOnce([claimedInvite()]).mockResolvedValue([]);
    mockRevokeInvite.mockRejectedValue(new BudgetInviteGoneError());
    const tree = await renderInviteHalf();

    await press(tree, 'budget-invite-revoke-CLM222');

    expect(find(tree, 'budget-invite-revoke-note').props.children).toContain('no longer works');
    expect(query(tree, 'budget-invite-revoke-CLM222')).toBeNull();
  });

  it('still blames the network when the network is what failed', async () => {
    mockListOutstanding.mockResolvedValue([claimedInvite()]);
    mockRevokeInvite.mockRejectedValue(new Error('Network Error'));
    const tree = await renderInviteHalf();

    await press(tree, 'budget-invite-revoke-CLM222');

    expect(find(tree, 'budget-invite-revoke-note').props.children).toContain('online');
    // Still cancellable: this one CAN succeed on the next tap.
    expect(query(tree, 'budget-invite-revoke-CLM222')).not.toBeNull();
  });
});

/**
 * Somebody waiting at the door, surfaced without being asked for.
 *
 * The approval used to live behind "See who is waiting", inside a section that
 * opens collapsed — so the push that says "X is waiting to join" landed the
 * owner on a screen showing no sign of X, and the one act this screen exists
 * for took two taps they had to know to make. What is pinned here is that the
 * screen ASKS on arrival and puts the answer ABOVE everything, including the
 * collapsed sections.
 */
describe('Join requests — the panel, wherever it is mounted', () => {
  const request = (overrides: Record<string, unknown> = {}) => ({
    inviteId: 'inv_waiting',
    shortCode: 'WAIT01',
    role: 'ADULT',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    claimedByUserId: 'usr-2',
    claimedByEmail: 'sam@example.com',
    claimedByDisplayName: 'Sam Wilson',
    claimedDeviceId: 'dev-2',
    claimedDeviceLabel: "Sam's iPhone",
    claimedSigningPublicKey: 'sign',
    claimedAgreementPublicKey: 'agree',
    ...overrides,
  });

  it('checks who is waiting on arrival, with nobody tapping anything', async () => {
    mockListPendingJoinRequests.mockResolvedValue([request()]);
    const tree = await render(<BudgetInviteScreen />);

    expect(mockListPendingJoinRequests).toHaveBeenCalled();
    // …and the answer is on screen with BOTH sections still collapsed: the
    // banner is not inside the half the owner has to open.
    expect(query(tree, 'budget-invite-section-invite-body')).toBeNull();
    expect(query(tree, 'budget-settings-join-requests-panel')).not.toBeNull();
    expect(find(tree, 'budget-request-who-inv_waiting').props.children).toBe('Sam Wilson');
    expect(find(tree, 'budget-request-sas-inv_waiting').props.children).toContain('123');
  });

  it('gives each waiting device its own banner and its own digits', async () => {
    // Two people waiting are two decisions, each with a number of its own to
    // read aloud. Merged into one card, that is how the wrong one gets approved.
    mockListPendingJoinRequests.mockResolvedValue([
      request(),
      request({ inviteId: 'inv_second', shortCode: 'WAIT02', claimedByDisplayName: 'Pat Lee' }),
    ]);
    mockDeriveJoinRequestSas.mockImplementation(async (r: { inviteId: string }) =>
      r.inviteId === 'inv_second' ? '654321' : '123456',
    );
    const tree = await render(<BudgetInviteScreen />);

    expect(query(tree, 'budget-join-request-banner-inv_waiting')).not.toBeNull();
    expect(query(tree, 'budget-join-request-banner-inv_second')).not.toBeNull();
    expect(find(tree, 'budget-request-sas-inv_second').props.children).toContain('654');
  });

  it('approves from the banner, and drops it once the device is in', async () => {
    mockListPendingJoinRequests.mockResolvedValue([request()]);
    const tree = await render(<BudgetInviteScreen />);

    await press(tree, 'budget-settings-approve-request');

    expect(mockApproveInvite).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ inviteId: 'inv_waiting' }) }),
    );
    expect(query(tree, 'budget-join-request-banner-inv_waiting')).toBeNull();
  });

  it('re-reads the sent invites after an approval, so the spent code stops offering Cancel', async () => {
    // Approving spends the invite — the control plane drops it from the
    // outstanding list — so a list captured before the tap describes an invite
    // that can no longer be cancelled. That staleness is what produced the
    // production 409: an approved code still shown as "waiting to be approved".
    mockListPendingJoinRequests.mockResolvedValue([request()]);
    mockListOutstanding.mockResolvedValue([
      {
        inviteId: 'inv_waiting',
        shortCode: 'WAIT01',
        status: 'claimed',
        role: 'ADULT',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        inviteeEmail: null,
        createdByUserId: 'u1',
        createdAt: new Date().toISOString(),
        claimedByUserId: 'usr-2',
        claimedByEmail: 'sam@example.com',
        claimedByDisplayName: 'Sam Wilson',
      },
    ]);
    const tree = await renderInviteHalf();
    expect(query(tree, 'budget-invite-revoke-WAIT01')).not.toBeNull();

    mockListOutstanding.mockResolvedValue([]);
    await press(tree, 'budget-settings-approve-request');

    expect(query(tree, 'budget-invite-revoke-WAIT01')).toBeNull();
  });

  it('offers no number to approve when this device cannot derive one', async () => {
    // A device that did not mint the invite has no secret, so there is nothing
    // to compare — and an approve button there is the unchecked tap this
    // ceremony exists to remove.
    mockListPendingJoinRequests.mockResolvedValue([request()]);
    mockDeriveJoinRequestSas.mockResolvedValue(null);
    const tree = await render(<BudgetInviteScreen />);

    expect(query(tree, 'budget-request-sas-missing-inv_waiting')).not.toBeNull();
    expect(query(tree, 'budget-settings-approve-request')).toBeNull();
  });

  it('says nothing at all when the automatic check finds nobody', async () => {
    // An alert on arrival would fire on every visit to this screen. Only a
    // person who tapped the button is owed the answer "nobody" — and that
    // button lives on the Invite screen, beside the code that was minted.
    const tree = await renderInviteHalf();

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(query(tree, 'budget-settings-join-requests-panel')).toBeNull();

    await press(tree, 'budget-settings-join-requests');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Join requests',
      expect.stringContaining('No one is waiting'),
    );
  });

  it('shows a waiting device its own digits on the hub, not behind a row', async () => {
    // The invitee's side of the same problem the banners solve for the owner.
    // Their wait — the digits to read out — used to live inside a section that
    // opened collapsed, so the push that summoned them landed on a screen with
    // no trace of what it was about.
    engineFlags.awaitingEnrolment = true;
    const tree = await render(<BudgetInviteScreen />);

    expect(query(tree, 'budget-join-sas-panel')).not.toBeNull();
    expect(find(tree, 'budget-join-sas').props.children).toContain('123');
  });

  it('keeps an approved join on this phone when /state 403s', async () => {
    // The coordinator marks the invite approved before D1 writes membership.
    // enrolment.approved then fires, this poll hits /state, and a 403 used to
    // mean "removed" — which deleted Sweet Home and left the personal ledger.
    engineFlags.awaitingEnrolment = true;
    mockLookupInviteById.mockResolvedValue({
      inviteId: 'inv_9',
      householdId: 'hh-2',
      householdName: 'Sweet Home',
      status: 'approved',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    mockFetchControlPlaneState.mockRejectedValue({ response: { status: 403 } });

    await render(<BudgetJoinScreen />);

    expect(mockAbandonEnrolment).not.toHaveBeenCalled();
    expect(mockHeldHouseholds.has('hh-2')).toBe(true);
    expect(mockRunSync).toHaveBeenCalledWith('join-wait-poll');
    expect(mockNoteJoinOutcome).not.toHaveBeenCalled();
  });

  /**
   * The dead end, and the whole reason the drop exists.
   *
   * An invite claimed shortly before it expired left this device holding a
   * household it could never be approved into — and every join control on this
   * screen is disabled while the device is "awaiting enrolment", so the person
   * could not claim the replacement invite the owner had already sent them.
   * Seen on staging 2026-08-19: Scan and Join both dead, an invite typed into
   * the fields that no tap could submit.
   */
  it('drops a household whose invite died, so a new invite can be claimed', async () => {
    engineFlags.awaitingEnrolment = true;
    mockLookupInviteById.mockResolvedValue({
      inviteId: 'inv_9',
      householdId: 'hh-2',
      householdName: 'The Wilsons',
      status: 'expired',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const tree = await render(<BudgetJoinScreen />);

    // The half-joined household is off this device, named explicitly — never
    // some other household that happened to be active.
    expect(mockAbandonEnrolment).toHaveBeenCalledWith('hh-2');
    // ...and recorded, so the next mount does not have to ask the network
    // again — which is what used to flash the dead invite's digits on arrival.
    expect(mockNoteJoinOutcome).toHaveBeenCalledWith('expired');

    expect(query(tree, 'budget-join-outcome-panel')).not.toBeNull();
    expect(query(tree, 'budget-join-sas-panel')).toBeNull();
    // The point of all of it: both ways in are usable again.
    expect(find(tree, 'budget-settings-join-household').props.title).toBe('Join household');
    expect(find(tree, 'budget-settings-join-household').props.disabled).toBe(false);
    expect(find(tree, 'budget-settings-scan-invite').props.disabled).toBe(false);
  });

  it('says what happened on arrival, without asking the network again', async () => {
    // The outcome is read back from the claim record, which outlives both the
    // wait and the household it was about. A banner derived from engine state
    // alone would have nothing left to derive from by now.
    engineFlags.awaitingEnrolment = false;
    mockRecallJoinSas.mockResolvedValue({
      inviteId: 'inv_9',
      householdId: 'hh-2',
      sas: '123456',
      outcome: 'expired',
    });

    const tree = await render(<BudgetInviteScreen />);

    expect(mockLookupInviteById).not.toHaveBeenCalled();
    expect(query(tree, 'budget-join-sas-panel')).toBeNull();
    expect(find(tree, 'budget-join-outcome').props.children).toContain('taken off this device');
    // The row underneath used to go on saying the device was waiting for an
    // approval, directly below a banner saying the invite had expired.
    expect(find(tree, 'budget-invite-section-join').props.summary).toContain('That invite expired');
  });

  it('lets the banner be dismissed, and forgets the claim it described', async () => {
    engineFlags.awaitingEnrolment = false;
    mockRecallJoinSas.mockResolvedValue({
      inviteId: 'inv_9',
      householdId: 'hh-2',
      sas: '123456',
      outcome: 'revoked',
    });

    const tree = await render(<BudgetInviteScreen />);
    expect(query(tree, 'budget-join-outcome-panel')).not.toBeNull();

    await press(tree, 'budget-join-outcome-dismiss');

    expect(mockForgetJoinSas).toHaveBeenCalled();
    expect(query(tree, 'budget-join-outcome-panel')).toBeNull();
  });

  it('keeps a banner already on screen when the network blinks', async () => {
    // The banner is a request the control plane confirmed a moment ago.
    // Dropping it because a re-check failed would hide the approval the owner
    // came here to give.
    mockListPendingJoinRequests.mockResolvedValue([request()]);
    const tree = await renderInviteHalf();
    expect(query(tree, 'budget-join-request-banner-inv_waiting')).not.toBeNull();

    mockListPendingJoinRequests.mockRejectedValue(new Error('offline'));
    await press(tree, 'budget-settings-join-requests');

    expect(query(tree, 'budget-join-request-banner-inv_waiting')).not.toBeNull();
  });
});
