/**
 * He2/He4 §5.1 — the session lifecycle, and the three failures that are silent
 * without it.
 *
 *  1. **Double open.** Sign-in and cold-start hydration both call
 *     `ensureHealthLocalSession()`, often in the same tick. Two opens race the
 *     same SQLite file and the same `POST /v2/households`.
 *  2. **Teardown that leaves something behind.** Plan §1.3 makes sign-out
 *     destroy the ledger, both WAL sidecars, the DEK and the MMKV mirrors. Any
 *     one of them surviving is the shared-handset leak
 *     `privacy-cross-user-leak.yaml` exists to catch.
 *  3. **The dual world (§1.3).** With the session NOT open, a local read must
 *     THROW. He3's Proxy catches a local throw and falls through to D1, so an
 *     un-opened session does not crash — it quietly restores the two-system-of-
 *     record state, and `readThrough` then overwrites the MMKV mirror with the
 *     server's answer. Nothing goes red. `assertHealthLocalSessionOpen()` is
 *     what turns that omission into a visible failure, so it is tested here.
 */
import fs from 'fs';
import path from 'path';

const mockOpenLocalHealthSession = jest.fn<Promise<unknown>, [unknown]>();
const mockCloseLocalHealthSession = jest.fn<Promise<void>, []>();
const mockResetLocalHealthSession = jest.fn<Promise<void>, []>();
const mockIsLocalHealthSessionOpen = jest.fn<boolean, []>();
const mockStartBridge = jest.fn<() => void, []>();
const mockStopBridge = jest.fn<void, []>();
const mockRemoveItem = jest.fn<Promise<void>, [string]>();
const mockApiPost = jest.fn();
const mockApiGet = jest.fn();

const LEDGER = {
  version: 1 as const,
  household: { id: 'hh_local_health', userId: 'user-1', createdAt: '2026-01-01T00:00:00.000Z' },
  deviceId: 'dev_a',
};

jest.mock('../engine', () => ({
  openLocalHealthSession: (input: unknown) => mockOpenLocalHealthSession(input),
  closeLocalHealthSession: () => mockCloseLocalHealthSession(),
  resetLocalHealthSession: () => mockResetLocalHealthSession(),
  isLocalHealthSessionOpen: () => mockIsLocalHealthSessionOpen(),
  getLocalHealthLedger: () => LEDGER,
  getLocalHealthIdentity: () => ({
    signingPublicKey: new Uint8Array([1, 2, 3]),
    agreementPublicKey: new Uint8Array([4, 5, 6]),
  }),
}));

jest.mock('../ledgerRefresh', () => ({
  startHealthLedgerRefreshBridge: () => mockStartBridge(),
  stopHealthLedgerRefreshBridge: () => mockStopBridge(),
}));

const mockAuthState: {
  user: { id: string; email: string; display_name?: string | null } | null;
  isAuthenticated: boolean;
  hasHydrated: boolean;
} = { user: null, isAuthenticated: false, hasHydrated: false };

jest.mock('@stores/authStore', () => ({
  useAuthStore: { getState: () => mockAuthState },
}));

jest.mock('@services/storage', () => ({
  asyncStorage: { removeItem: (key: string) => mockRemoveItem(key) },
}));

jest.mock('@api/client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockApiPost(...args),
    get: (...args: unknown[]) => mockApiGet(...args),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('@services/notifications', () => ({
  notificationService: {
    hasPermission: jest.fn(async () => false),
    initialize: jest.fn(async () => null),
  },
}));

import { HEALTH_CACHE_KEYS } from '../../healthCacheKeys';
import {
  assertHealthLocalSessionOpen,
  ensureHealthLocalSession,
  resetHealthLocalSessionGuardForTests,
  teardownHealthLocalSession,
} from '../ensureSession';
import { HealthLocalNotReadyError } from '../errors';
import { HEALTH_LOCAL_FIRST_DB_FILES } from '../health-local-first-store';
import { loadDbKeyHex, saveDbKeyHex } from '../persistence';

function signIn(): void {
  mockAuthState.user = { id: 'user-1', email: 'a@example.com', display_name: 'A' };
  mockAuthState.isAuthenticated = true;
  mockAuthState.hasHydrated = true;
}

const savedFlag = process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST;

beforeEach(() => {
  jest.clearAllMocks();
  resetHealthLocalSessionGuardForTests();
  process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST = '1';
  mockAuthState.user = null;
  mockAuthState.isAuthenticated = false;
  mockAuthState.hasHydrated = false;
  mockOpenLocalHealthSession.mockResolvedValue(LEDGER);
  mockCloseLocalHealthSession.mockResolvedValue(undefined);
  mockResetLocalHealthSession.mockResolvedValue(undefined);
  mockIsLocalHealthSessionOpen.mockReturnValue(false);
  mockRemoveItem.mockResolvedValue(undefined);
  mockApiPost.mockResolvedValue({ data: {} });
  mockApiGet.mockResolvedValue({ data: {} });
});

afterAll(() => {
  if (savedFlag === undefined) delete process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST;
  else process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST = savedFlag;
});

describe('ensureHealthLocalSession is idempotent', () => {
  it('opens the ledger once for two calls in the same tick', async () => {
    signIn();
    await Promise.all([ensureHealthLocalSession(), ensureHealthLocalSession()]);
    expect(mockOpenLocalHealthSession).toHaveBeenCalledTimes(1);
    expect(mockOpenLocalHealthSession).toHaveBeenCalledWith({ userId: 'user-1' });
  });

  it('does not reopen an already-open session for the same user', async () => {
    signIn();
    await ensureHealthLocalSession();
    mockIsLocalHealthSessionOpen.mockReturnValue(true);
    await ensureHealthLocalSession();
    await ensureHealthLocalSession();
    expect(mockOpenLocalHealthSession).toHaveBeenCalledTimes(1);
  });

  it('starts the refresh bridge on every call — the bridge itself is the idempotent one', async () => {
    signIn();
    await ensureHealthLocalSession();
    mockIsLocalHealthSessionOpen.mockReturnValue(true);
    await ensureHealthLocalSession();
    // Twice, not once: a screen that mounted between the two has no other event
    // to converge on, and `startHealthLedgerRefreshBridge` returns early when
    // already attached (plan §5.1 row 4).
    expect(mockStartBridge).toHaveBeenCalledTimes(2);
  });

  it('reopens after an account switch', async () => {
    signIn();
    await ensureHealthLocalSession();
    mockIsLocalHealthSessionOpen.mockReturnValue(true);
    mockAuthState.user = { id: 'user-2', email: 'b@example.com' };
    await ensureHealthLocalSession();
    expect(mockOpenLocalHealthSession).toHaveBeenCalledTimes(2);
    expect(mockOpenLocalHealthSession).toHaveBeenLastCalledWith({ userId: 'user-2' });
  });

  it('does nothing at all when the flag is off — a flag-0 build is untouched', async () => {
    process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST = '0';
    signIn();
    await ensureHealthLocalSession();
    expect(mockOpenLocalHealthSession).not.toHaveBeenCalled();
    expect(mockStartBridge).not.toHaveBeenCalled();
  });

  it('does nothing before hydration completes', async () => {
    signIn();
    mockAuthState.hasHydrated = false;
    await ensureHealthLocalSession();
    expect(mockOpenLocalHealthSession).not.toHaveBeenCalled();
  });

  it('releases the single-flight guard when the open throws', async () => {
    signIn();
    mockOpenLocalHealthSession.mockRejectedValueOnce(new Error('sqlite busy'));
    await expect(ensureHealthLocalSession()).rejects.toThrow('sqlite busy');
    // A failed open must not wedge the app on the "already in flight" branch.
    mockOpenLocalHealthSession.mockResolvedValue(LEDGER);
    await ensureHealthLocalSession();
    expect(mockOpenLocalHealthSession).toHaveBeenCalledTimes(2);
  });
});

describe('teardown wipes everything a sign-out must not leave behind', () => {
  it('deletes the ledger, both WAL sidecars and the DEK on wipe', async () => {
    await saveDbKeyHex('deadbeef');
    expect(await loadDbKeyHex()).toBe('deadbeef');

    await teardownHealthLocalSession({ wipe: true });

    // The engine reset owns the close; `clearLocalHealthPersistence` owns the
    // three files + the DEK. Both run, and the DEK is verifiably gone.
    expect(mockResetLocalHealthSession).toHaveBeenCalledTimes(1);
    expect(await loadDbKeyHex()).toBeNull();

    // `deleteDatabaseAsync` does NOT remove the sidecars (expo/expo#43441), so
    // the file set is asserted rather than the delete's return value.
    expect([...HEALTH_LOCAL_FIRST_DB_FILES]).toEqual([
      'symply-health-local-first.db',
      'symply-health-local-first.db-wal',
      'symply-health-local-first.db-shm',
    ]);
  });

  it('clears every HEALTH_CACHE_KEYS mirror', async () => {
    await teardownHealthLocalSession({ wipe: true });
    const cleared = mockRemoveItem.mock.calls.map(([key]) => key);
    for (const key of HEALTH_CACHE_KEYS) {
      expect(cleared).toContain(key);
    }
  });

  it('still wipes the files and the DEK when the engine reset throws', async () => {
    await saveDbKeyHex('deadbeef');
    mockResetLocalHealthSession.mockRejectedValueOnce(new Error('store already closed'));

    await expect(teardownHealthLocalSession({ wipe: true })).rejects.toThrow(
      'store already closed',
    );

    // Ciphertext + key surviving because a close failed is the one outcome
    // teardown must not have.
    expect(await loadDbKeyHex()).toBeNull();
  });

  it('detaches the refresh bridge', async () => {
    await teardownHealthLocalSession();
    expect(mockStopBridge).toHaveBeenCalledTimes(1);
  });

  it('without wipe it closes the session and keeps the DEK', async () => {
    await saveDbKeyHex('deadbeef');
    mockIsLocalHealthSessionOpen.mockReturnValue(true);

    await teardownHealthLocalSession();

    expect(mockCloseLocalHealthSession).toHaveBeenCalledTimes(1);
    expect(mockResetLocalHealthSession).not.toHaveBeenCalled();
    expect(await loadDbKeyHex()).toBe('deadbeef');
  });

  it('forces the next ensure to reopen', async () => {
    signIn();
    await ensureHealthLocalSession();
    await teardownHealthLocalSession({ wipe: true });
    mockIsLocalHealthSessionOpen.mockReturnValue(true);
    await ensureHealthLocalSession();
    expect(mockOpenLocalHealthSession).toHaveBeenCalledTimes(2);
  });
});

describe('the dual-world rejection (plan §1.3)', () => {
  it('a local read with the session NOT opened throws — it is not served from D1', async () => {
    mockIsLocalHealthSessionOpen.mockReturnValue(false);
    mockApiGet.mockClear();
    mockApiPost.mockClear();

    expect(() => assertHealthLocalSessionOpen()).toThrow(HealthLocalNotReadyError);

    // The whole point: the guard fails loudly instead of reaching for the
    // server. A single `/health/*` request here is the dual-world state.
    const requested = [...mockApiGet.mock.calls, ...mockApiPost.mock.calls].map(
      ([url]) => String(url),
    );
    expect(requested.filter((url) => url.startsWith('/health'))).toEqual([]);
    expect(requested).toEqual([]);
  });

  it('names the error so callers can route it instead of string-matching', () => {
    mockIsLocalHealthSessionOpen.mockReturnValue(false);
    try {
      assertHealthLocalSessionOpen();
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as HealthLocalNotReadyError).name).toBe('HealthLocalNotReadyError');
      expect((error as HealthLocalNotReadyError).code).toBe('health_local_not_ready');
    }
  });

  it('passes once the session is open', () => {
    mockIsLocalHealthSessionOpen.mockReturnValue(true);
    expect(() => assertHealthLocalSessionOpen()).not.toThrow();
  });
});

describe('cryptoPolyfill import order', () => {
  it('is a bare static side-effect ahead of every local-first import', () => {
    // Asserted by test rather than by review (plan §5.1): `@noble/*` captures
    // `globalThis.crypto` at module load, so an import that lands after the
    // engine — or a lazy `await import()`, which additionally throws under Jest
    // without --experimental-vm-modules — silently produces a keyless build.
    const source = fs.readFileSync(path.join(__dirname, '..', 'ensureSession.ts'), 'utf8');

    // Assert on CODE, not comments. `ensureSession.ts` documents both forbidden
    // patterns verbatim in its header — the bare `@symply/local-first` id and a
    // literal `await import('./cryptoPolyfill')` — and that prose sorts ahead of
    // every real import, so a raw-source scan fails on correct source.
    // Line comments MUST go first: the header writes `@noble/*`, whose `/*`
    // would otherwise open a phantom block comment that swallows the imports.
    const code = source.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    const polyfillAt = code.indexOf("import './cryptoPolyfill'");
    expect(polyfillAt).toBeGreaterThan(-1);

    for (const later of [
      "from './engine'",
      "from '@symply/local-first'",
      "from './ledgerRefresh'",
    ]) {
      const at = code.indexOf(later);
      if (at === -1) continue;
      expect(polyfillAt).toBeLessThan(at);
    }

    expect(code).not.toMatch(/await import\(['"]\.\/cryptoPolyfill/);
  });
});
