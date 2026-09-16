/**
 * Cold start on a House V2 local-first device.
 *
 * The defect these cover, seen on device: the very first refresh of every launch
 * toasted `Couldn't load "<home>". Pull to refresh.` over a home that was
 * perfectly intact. `householdStore` rehydrates the property list from disk
 * immediately, `HomeScreen`'s focus effect calls `refreshActivePropertyData()`
 * the moment the tab renders, and the encrypted ledger those tasks live in is
 * still being opened — so the local task facade threw `HouseLocalNotReadyError`
 * and the household was reported to the member as unloadable.
 *
 * Two halves, and both are needed for the fix to be a fix rather than a mute:
 * the early refresh must not accuse the household, AND the tasks must still
 * arrive once the ledger is open.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useTaskStore } from '@stores/taskStore';

import { DataProvider, useData } from '../DataContext';

// --- the ledger, as a switch this suite can flip -----------------------------
// `mock`-prefixed by Jest's rule: these are read from inside module factories.

let mockSessionOpen = false;

jest.mock('@features/house/local/flag', () => ({
  isHouseLocalFirst: () => true,
  isHouseP2PEnabled: () => false,
}));

jest.mock('@features/house/local/engine', () => ({
  isLocalHouseSessionOpen: () => mockSessionOpen,
}));

const mockEnsureSession = jest.fn();

jest.mock('@features/house/local/ensureSession', () => ({
  ensureHouseLocalSession: (...args: unknown[]) => mockEnsureSession(...args),
}));

jest.mock('@features/house/local/backup/autoBackup', () => ({
  startHouseAutoBackupScheduler: jest.fn(),
}));

// --- brand + api ------------------------------------------------------------

jest.mock('@brand', () => ({
  hasBrandCapability: () => true,
  isJoinedPlatformBrand: () => true,
}));

const mockListTasks = jest.fn();
const mockGetUpcoming = jest.fn();
const mockListReports = jest.fn();
const mockShowToast = jest.fn();

jest.mock('@api/tasks', () => ({
  tasksApi: {
    list: (...args: unknown[]) => mockListTasks(...args),
    getUpcoming: (...args: unknown[]) => mockGetUpcoming(...args),
  },
}));

jest.mock('@api/reports', () => ({
  reportsApi: { list: (...args: unknown[]) => mockListReports(...args) },
}));

jest.mock('@api/households', () => ({
  householdsApi: { list: jest.fn() },
}));

jest.mock('@services/toastManager', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));
jest.mock('@services/monitoring', () => ({ captureException: jest.fn() }));

const HOUSEHOLD = { id: 'hh_local_abc123', name: 'Sweet Home 🏠' };

/** Hands the context out so a test can call it the way a screen would. */
let contextValue: ReturnType<typeof useData> | null = null;
function CaptureContext() {
  contextValue = useData();
  return null;
}

async function mountProvider() {
  let tree: ReactTestRenderer.ReactTestRenderer | null = null;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <DataProvider>
        <CaptureContext />
      </DataProvider>
    );
  });
  return tree!;
}

beforeEach(() => {
  mockSessionOpen = false;
  contextValue = null;
  jest.clearAllMocks();
  // The real one: the ledger is closed while it runs, open once it resolves.
  mockEnsureSession.mockImplementation(async () => {
    await Promise.resolve();
    mockSessionOpen = true;
  });
  // `tasksApi` is the House local proxy on this brand, so it answers out of the
  // ledger — and throws `HouseLocalNotReadyError` when there is no ledger open
  // to read. Reproduced here rather than stubbed to always resolve: a task mock
  // that succeeds against a closed session cannot fail on the defect these tests
  // exist for.
  const notReady = () => new Error('House local-first session is not open.');
  mockListTasks.mockImplementation(async () => {
    if (!mockSessionOpen) throw notReady();
    return { tasks: [{ id: 't1', title: 'Change the filter' }] };
  });
  mockGetUpcoming.mockImplementation(async () => {
    if (!mockSessionOpen) throw notReady();
    return { tasks: [] };
  });
  mockListReports.mockResolvedValue({ reports: [] });

  useHouseholdStore.setState({
    households: [HOUSEHOLD],
    currentHousehold: HOUSEHOLD,
    propertyMode: 'single',
  } as never);
  useTaskStore.setState({ maintenanceTasks: [], upcomingTasks: [] } as never);
  useAuthStore.setState({ isAuthenticated: true, hasHydrated: true } as never);
});

describe('DataContext — House local-first cold start', () => {
  it('does not accuse the household while the ledger is unopened', async () => {
    // The ledger does not open — `ensureHouseLocalSession` returns having decided
    // nothing, which is what an offline launch on an empty device does, and is
    // also the state every launch passes through while the real one is running.
    // A closed ledger has nothing to say about the household either way.
    mockEnsureSession.mockResolvedValue(undefined);

    await mountProvider();
    // And again from the outside, the way `HomeScreen`'s focus effect calls it.
    await act(async () => {
      await contextValue!.refreshActivePropertyData();
    });

    expect(mockShowToast).not.toHaveBeenCalled();
    // Not merely un-toasted — not attempted. Reading a closed ledger is what
    // produced the error in the first place.
    expect(mockListTasks).not.toHaveBeenCalled();
  });

  it('loads the ledger tasks once the session is open', async () => {
    // `refreshAll` opens the session and then fetches — Home reads `taskStore`,
    // so this is the only guaranteed route to its task list on a cold start.
    await mountProvider();

    expect(mockListTasks).toHaveBeenCalledWith('hh_local_abc123');
    expect(useTaskStore.getState().maintenanceTasks).toHaveLength(1);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('keeps quiet when only the remote report list fails', async () => {
    // Reports are Tier B and stay on the server. Offline — or 403 while the
    // legacy membership mirror is still registering — must not be reported as
    // "couldn't load your home" on a device whose tasks came off its own disk.
    mockListReports.mockRejectedValue(new Error('Network Error'));

    await mountProvider();

    expect(useTaskStore.getState().maintenanceTasks).toHaveLength(1);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('still tells the member when the tasks themselves fail', async () => {
    mockListTasks.mockRejectedValue(new Error('boom'));

    await mountProvider();

    expect(mockShowToast).toHaveBeenCalledWith(
      'error',
      'Couldn\'t load "Sweet Home 🏠". Pull to refresh.'
    );
  });
});
