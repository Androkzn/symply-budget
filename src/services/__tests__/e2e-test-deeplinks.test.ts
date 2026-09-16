/* eslint-disable @typescript-eslint/no-require-imports -- module registry access: these suites load modules lazily so each case sees the state it just set up */
import * as Linking from 'expo-linking';

import {
  clearAllE2ETestLogs,
  getE2EActiveMatrixTag,
  getE2ENetworkLog,
  recordE2ENetworkEntry,
  recordE2EPersistEntry,
} from '@api/e2eTestObservability';

jest.mock('expo-linking', () => ({
  parse: jest.fn(),
}));

const mockLogout = jest.fn().mockResolvedValue(undefined);
const mockClearPendingE2ELogin = jest.fn();

jest.mock('@stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ logout: mockLogout }),
  },
}));

// The purge handler `require`s this at call time; a module mock is the only
// shape that intercepts that (jest.spyOn cannot redefine the api object's
// properties).
jest.mock('@api/savings', () => ({
  savingsApi: {
    listRecurringPayments: jest.fn(),
    deleteRecurringPayment: jest.fn(),
  },
}));

jest.mock('../e2e-autologin', () => ({
  clearPendingE2ELogin: (...args: unknown[]) => mockClearPendingE2ELogin(...args),
}));

import { tryHandleE2ETestDeepLink } from '../e2e-test-deeplinks';

describe('e2e-test-deeplinks', () => {
  beforeEach(() => {
    clearAllE2ETestLogs();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.clearAllMocks();
    mockLogout.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('handles e2e-clear-log', () => {
    recordE2ENetworkEntry({ method: 'GET', url: '/tasks', status: 200, ok: true });
    (Linking.parse as jest.Mock).mockReturnValue({ hostname: 'e2e-clear-log' });

    expect(tryHandleE2ETestDeepLink('symply-house://e2e-clear-log')).toBe(true);
    expect(getE2ENetworkLog()).toHaveLength(0);
  });

  it('handles e2e-logout', () => {
    (Linking.parse as jest.Mock).mockReturnValue({ hostname: 'e2e-logout' });
    expect(tryHandleE2ETestDeepLink('simplehouse://e2e-logout')).toBe(true);
    expect(mockClearPendingE2ELogin).toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalled();
  });

  it('handles e2e-dump-log', () => {
    recordE2ENetworkEntry({ method: 'GET', url: '/ping', status: 200, ok: true });
    (Linking.parse as jest.Mock).mockReturnValue({ hostname: 'e2e-dump-log' });

    expect(tryHandleE2ETestDeepLink('kaizen://e2e-dump-log')).toBe(true);

    const lines = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => line.includes('[E2E-DUMP]'))).toBe(true);
  });

  it('handles e2e-tag-matrix with row query param', () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-tag-matrix',
      queryParams: { row: 'HOUSE-TASK-002' },
    });

    expect(tryHandleE2ETestDeepLink('symply-house://e2e-tag-matrix?row=HOUSE-TASK-002')).toBe(
      true,
    );
    expect(getE2EActiveMatrixTag()).toBe('HOUSE-TASK-002');
  });

  it('handles e2e-verify-network PASS when a matching entry exists', () => {
    recordE2ENetworkEntry({ method: 'POST', url: '/tasks', status: 201, ok: true });
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-verify-network',
      queryParams: { method: 'POST', path: '/tasks', status: '201' },
    });

    expect(
      tryHandleE2ETestDeepLink('symply-house://e2e-verify-network?method=POST&path=/tasks&status=201'),
    ).toBe(true);

    const lines = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => /\[E2E-VERIFY\].*PASS/.test(line))).toBe(true);
  });

  it('handles e2e-verify-network FAIL when no matching entry exists', () => {
    recordE2ENetworkEntry({ method: 'GET', url: '/tasks', status: 200, ok: true });
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-verify-network',
      queryParams: { method: 'POST', path: '/tasks', status: '201' },
    });

    expect(
      tryHandleE2ETestDeepLink('symply-house://e2e-verify-network?method=POST&path=/tasks&status=201'),
    ).toBe(true);

    const lines = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => /\[E2E-VERIFY\].*FAIL/.test(line))).toBe(true);
  });

  it('handles e2e-verify-no-network PASS when no call matches method+path', () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-verify-no-network',
      queryParams: { method: 'GET', path: '/ai-access' },
    });

    expect(
      tryHandleE2ETestDeepLink('symply-house://e2e-verify-no-network?method=GET&path=/ai-access'),
    ).toBe(true);

    const lines = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => /\[E2E-VERIFY\].*PASS/.test(line))).toBe(true);
  });

  it('handles e2e-verify-no-network FAIL when a call matches method+path', () => {
    recordE2ENetworkEntry({ method: 'GET', url: '/ai-access', status: 200, ok: true });
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-verify-no-network',
      queryParams: { method: 'GET', path: '/ai-access' },
    });

    expect(
      tryHandleE2ETestDeepLink('symply-house://e2e-verify-no-network?method=GET&path=/ai-access'),
    ).toBe(true);

    const lines = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => /\[E2E-VERIFY\].*FAIL/.test(line))).toBe(true);
  });

  it('handles e2e-verify-no-network with a status filter: PASS when the call succeeded (no matching-status hit)', () => {
    // A 401-then-retry-succeeds sequence: the endpoint WAS called (and did
    // eventually succeed), just never with the forbidden status — this is the
    // shape a fixed auth-hydration race should produce.
    recordE2ENetworkEntry({ method: 'GET', url: '/ai-access', status: 200, ok: true });
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-verify-no-network',
      queryParams: { method: 'GET', path: '/ai-access', status: '401' },
    });

    expect(
      tryHandleE2ETestDeepLink(
        'symply-house://e2e-verify-no-network?method=GET&path=/ai-access&status=401',
      ),
    ).toBe(true);

    const lines = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => /\[E2E-VERIFY\].*PASS/.test(line))).toBe(true);
  });

  it('handles e2e-verify-no-network with a status filter: FAIL when the forbidden status occurred', () => {
    // The pre-fix shape: a 401 fired before the interceptor's silent retry.
    recordE2ENetworkEntry({ method: 'GET', url: '/ai-access', status: 401, ok: false });
    recordE2ENetworkEntry({ method: 'GET', url: '/ai-access', status: 200, ok: true });
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-verify-no-network',
      queryParams: { method: 'GET', path: '/ai-access', status: '401' },
    });

    expect(
      tryHandleE2ETestDeepLink(
        'symply-house://e2e-verify-no-network?method=GET&path=/ai-access&status=401',
      ),
    ).toBe(true);

    const lines = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => /\[E2E-VERIFY\].*FAIL/.test(line))).toBe(true);
  });

  it('handles e2e-verify-no-network with exact=true: FAIL only matches the bare path, not nested sub-resources', () => {
    // /households/<id>/join-requests must NOT trip a check scoped to the bare
    // /households collection route — that was a real false positive: substring
    // matching flagged join-requests, budget/monthly-overview, etc. as if they
    // were the /households list call.
    recordE2ENetworkEntry({
      method: 'GET',
      url: '/households/6a91cf1f-29d9-4f37-a325-46c66b53ddda/join-requests',
      status: 401,
      ok: false,
    });
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-verify-no-network',
      queryParams: { method: 'GET', path: '/households', status: '401', exact: 'true' },
    });

    expect(
      tryHandleE2ETestDeepLink(
        'symply-house://e2e-verify-no-network?method=GET&path=/households&status=401&exact=true',
      ),
    ).toBe(true);

    const lines = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => /\[E2E-VERIFY\].*PASS/.test(line))).toBe(true);
  });

  it('handles e2e-verify-no-network with exact=true: FAIL when the bare path itself matches', () => {
    recordE2ENetworkEntry({ method: 'GET', url: '/households', status: 401, ok: false });
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-verify-no-network',
      queryParams: { method: 'GET', path: '/households', status: '401', exact: 'true' },
    });

    expect(
      tryHandleE2ETestDeepLink(
        'symply-house://e2e-verify-no-network?method=GET&path=/households&status=401&exact=true',
      ),
    ).toBe(true);

    const lines = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => /\[E2E-VERIFY\].*FAIL/.test(line))).toBe(true);
  });

  it('handles e2e-verify-persist PASS when a matching entry exists', () => {
    recordE2EPersistEntry({
      store: 'kaizen_weekly_rotations',
      operation: 'upsert',
      detail: 'weekday=1',
    });
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-verify-persist',
      queryParams: { store: 'kaizen_weekly_rotations', operation: 'upsert' },
    });

    expect(
      tryHandleE2ETestDeepLink(
        'kaizen://e2e-verify-persist?store=kaizen_weekly_rotations&operation=upsert',
      ),
    ).toBe(true);

    const lines = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => /\[E2E-VERIFY\].*PASS/.test(line))).toBe(true);
  });

  it('handles e2e-verify-persist FAIL when no matching entry exists', () => {
    recordE2EPersistEntry({ store: 'kaizen_sqlite', operation: 'sync', detail: 'dirty_tables=1' });
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-verify-persist',
      queryParams: { store: 'kaizen_weekly_rotations', operation: 'upsert' },
    });

    expect(
      tryHandleE2ETestDeepLink(
        'kaizen://e2e-verify-persist?store=kaizen_weekly_rotations&operation=upsert',
      ),
    ).toBe(true);

    const lines = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => /\[E2E-VERIFY\].*FAIL/.test(line))).toBe(true);
  });

  it('handles e2e-verify-persist with a missing store query param', () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-verify-persist',
      queryParams: {},
    });

    expect(tryHandleE2ETestDeepLink('kaizen://e2e-verify-persist')).toBe(true);

    const lines = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => line.includes('missing store query param'))).toBe(true);
  });

  // Symply Health's daily note is the one field Maestro cannot drive reliably:
  // iOS 26 `inputText` does not always sync RN's TextInput state, so
  // health-flows persist the note through this host instead (see
  // e2e/maestro/health/home-water-note.yaml). If it stops writing MMKV
  // the flows silently assert stale text.
  describe('e2e-health-set-note (Symply Health)', () => {
    const noteKey = 'health.notes.v1';

    // The handler fires `void saveNoteForDate(...)` and returns synchronously,
    // so the MMKV write lands a few microtasks later.
    const flush = async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));
    };

    beforeEach(async () => {
      const { storageHelpers } =
        require('@services/storage') as typeof import('@services/storage');
      await storageHelpers.setObject(noteKey, []);
    });

    it('HEALTH-STORE-034: persists the note text for today and returns handled', async () => {
      (Linking.parse as jest.Mock).mockReturnValue({
        hostname: 'e2e-health-set-note',
        queryParams: { text: 'Slept well, energetic' },
      });

      expect(
        tryHandleE2ETestDeepLink('simplehealth://e2e-health-set-note?text=Slept%20well'),
      ).toBe(true);
      await flush();

      const { loadNoteForDate } =
        require('@features/health/healthLocalStorage') as typeof import('@features/health/healthLocalStorage');
      await expect(loadNoteForDate()).resolves.toBe('Slept well, energetic');
    });

    it('HEALTH-STORE-035: an empty text param clears today’s note rather than storing ""', async () => {
      const { saveNoteForDate, loadNoteForDate } =
        require('@features/health/healthLocalStorage') as typeof import('@features/health/healthLocalStorage');
      await saveNoteForDate('to be cleared');
      await expect(loadNoteForDate()).resolves.toBe('to be cleared');

      (Linking.parse as jest.Mock).mockReturnValue({
        hostname: 'e2e-health-set-note',
        queryParams: {},
      });
      expect(tryHandleE2ETestDeepLink('simplehealth://e2e-health-set-note')).toBe(true);
      await flush();

      await expect(loadNoteForDate()).resolves.toBe('');
    });

    it('HEALTH-STORE-036: is inert outside dev builds — no note is written', async () => {
      const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
      (globalThis as { __DEV__?: boolean }).__DEV__ = false;

      (Linking.parse as jest.Mock).mockReturnValue({
        hostname: 'e2e-health-set-note',
        queryParams: { text: 'should not persist' },
      });
      expect(tryHandleE2ETestDeepLink('simplehealth://e2e-health-set-note?text=x')).toBe(false);
      await flush();

      (globalThis as { __DEV__?: boolean }).__DEV__ = dev;

      const { loadNoteForDate } =
        require('@features/health/healthLocalStorage') as typeof import('@features/health/healthLocalStorage');
      await expect(loadNoteForDate()).resolves.toBe('');
    });
  });

  it('returns false for unrelated URLs', () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'join',
      queryParams: { token: 'abc' },
    });

    expect(tryHandleE2ETestDeepLink('symply-house://join/abc')).toBe(false);
  });

  it('handles e2e-block-network and e2e-unblock-network', () => {
    const { isE2ENetworkBlocked, __resetE2ENetworkBlockForTests } =
      require('../e2e-network-block') as typeof import('../e2e-network-block');
    __resetE2ENetworkBlockForTests();

    (Linking.parse as jest.Mock).mockReturnValue({ hostname: 'e2e-block-network' });
    expect(tryHandleE2ETestDeepLink('simplebudget://e2e-block-network')).toBe(true);
    expect(isE2ENetworkBlocked()).toBe(true);

    (Linking.parse as jest.Mock).mockReturnValue({ hostname: 'e2e-unblock-network' });
    expect(tryHandleE2ETestDeepLink('simplebudget://e2e-unblock-network')).toBe(true);
    expect(isE2ENetworkBlocked()).toBe(false);
  });

  it('handles e2e-budget-purge-test-payments by deleting only "* Test Item" rows', async () => {
    const { savingsApi } = require('@api/savings') as typeof import('@api/savings');
    const { useHouseholdStore } = require('@stores/householdStore') as typeof import('@stores/householdStore');

    useHouseholdStore.setState({ currentHousehold: { id: 'hh-1' } as never });

    const listSpy = savingsApi.listRecurringPayments as jest.Mock;
    const delSpy = savingsApi.deleteRecurringPayment as jest.Mock;
    listSpy.mockResolvedValue({
      items: [
        { id: 'a', label: 'Renewal Test Item' },
        { id: 'b', label: 'Mortgage' },
        { id: 'c', label: 'Months Chart Test Item' },
        // The other convention the savings flows use — monthly-crud and
        // goal-crud name their rows "ZZ E2E <X>", not "<X> Test Item".
        { id: 'd', label: 'ZZ E2E Monthly Renamed' },
      ],
    });
    delSpy.mockResolvedValue(undefined);

    (Linking.parse as jest.Mock).mockReturnValue({ hostname: 'e2e-budget-purge-test-payments' });
    expect(tryHandleE2ETestDeepLink('simplebudget://e2e-budget-purge-test-payments')).toBe(true);

    // The handler is fire-and-forget; let its promise chain drain.
    await new Promise((r) => setImmediate(r));

    expect(listSpy).toHaveBeenCalledWith('hh-1');
    // The real payment must survive — this runs against a shared account that
    // carries genuine data.
    expect(delSpy).toHaveBeenCalledTimes(3);
    expect(delSpy).toHaveBeenCalledWith('hh-1', 'a');
    expect(delSpy).toHaveBeenCalledWith('hh-1', 'c');
    expect(delSpy).toHaveBeenCalledWith('hh-1', 'd');
    expect(delSpy).not.toHaveBeenCalledWith('hh-1', 'b');
  });

  it('handles e2e-savings-set-tab by driving the sub-tab directly', () => {
    const { useSavingsStore } = require('@stores/savingsStore') as typeof import('@stores/savingsStore');
    useSavingsStore.getState().setActiveSubTab('overview');

    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-savings-set-tab',
      queryParams: { tab: 'income' },
    });
    expect(tryHandleE2ETestDeepLink('simplebudget://e2e-savings-set-tab?tab=income')).toBe(true);
    expect(useSavingsStore.getState().activeSubTab).toBe('income');
  });

  it('rejects an unknown e2e-savings-set-tab tab rather than setting garbage', () => {
    const { useSavingsStore } = require('@stores/savingsStore') as typeof import('@stores/savingsStore');
    useSavingsStore.getState().setActiveSubTab('goals');

    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-savings-set-tab',
      queryParams: { tab: 'nope' },
    });
    expect(tryHandleE2ETestDeepLink('simplebudget://e2e-savings-set-tab?tab=nope')).toBe(true);
    expect(useSavingsStore.getState().activeSubTab).toBe('goals');
  });

  it('handles e2e-savings-reset-month by snapping year/month back to today', () => {
    const { useSavingsStore } = require('@stores/savingsStore') as typeof import('@stores/savingsStore');
    const now = new Date();

    // Leave the store on a month no flow would legitimately be sitting on, the
    // way a previous flow in a soft-launched run would.
    useSavingsStore.getState().setSelectedMonth(2019, 3);
    expect(useSavingsStore.getState().selectedYear).toBe(2019);

    (Linking.parse as jest.Mock).mockReturnValue({ hostname: 'e2e-savings-reset-month' });
    expect(tryHandleE2ETestDeepLink('simplebudget://e2e-savings-reset-month')).toBe(true);

    expect(useSavingsStore.getState().selectedYear).toBe(now.getFullYear());
    expect(useSavingsStore.getState().selectedMonth).toBe(now.getMonth() + 1);
  });

  it('returns false outside dev builds', () => {
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;

    (Linking.parse as jest.Mock).mockReturnValue({ hostname: 'e2e-clear-log' });
    expect(tryHandleE2ETestDeepLink('symply-house://e2e-clear-log')).toBe(false);

    (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
  });
});
