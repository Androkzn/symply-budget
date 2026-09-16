/**
 * He2 teardown — the two security-critical wipes.
 *
 * Both assertions here exist because the *absence* of either is silent:
 *
 *  1. `mockDeleteDatabaseAsync` does NOT remove the WAL sidecars (expo/expo#43441,
 *     still open, fix PR unmerged, absent from SDK 57 native source on both
 *     platforms). A stale `-wal` beside a later database of the same name can
 *     replay the previous account's committed transactions. The hazard is
 *     account-switch / re-login WITHIN one install — iOS drops the whole
 *     container on uninstall. So this suite asserts the FILE SET, never the
 *     `mockDeleteDatabaseAsync` return value.
 *
 *  2. The Keychain sweep must delete the Health DEK and nothing else. Other
 *     brands share the access group, so a broad sweep would sign the user out of
 *     Budget and House. That negative assertion is the point of this file.
 */

const mockDeleteAsync = jest.fn<Promise<void>, [string, unknown?]>();
const mockDeleteDatabaseAsync = jest.fn<Promise<void>, [string]>();
const mockSecureDeleteItemAsync = jest.fn<Promise<void>, [string]>();

jest.mock('expo-file-system/legacy', () => ({
  get documentDirectory() {
    return 'file:///docs/';
  },
  deleteAsync: (path: string, opts?: unknown) => mockDeleteAsync(path, opts),
}));

jest.mock('expo-sqlite', () => ({
  deleteDatabaseAsync: (name: string) => mockDeleteDatabaseAsync(name),
  openDatabaseAsync: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: (key: string) => mockSecureDeleteItemAsync(key),
}));

import {
  HEALTH_LOCAL_FIRST_DB_NAME,
  HEALTH_LOCAL_FIRST_DB_SIDECARS,
} from '../expo-sqlite-driver';
import {
  HEALTH_LOCAL_FIRST_DB_FILES,
  deleteHealthLocalFirstDbFile,
} from '../health-local-first-store';
import { HEALTH_DEK_SECURE_KEY, clearLocalHealthPersistence } from '../persistence';

/**
 * The store short-circuits to an in-memory store under Jest, so the real
 * teardown branch has to be reached by hiding `JEST_WORKER_ID` for the call.
 */
async function runNativeTeardown(fn: () => Promise<void>): Promise<void> {
  const saved = process.env.JEST_WORKER_ID;
  delete process.env.JEST_WORKER_ID;
  try {
    await fn();
  } finally {
    if (saved !== undefined) process.env.JEST_WORKER_ID = saved;
  }
}

beforeEach(() => {
  mockDeleteAsync.mockReset().mockResolvedValue(undefined);
  mockDeleteDatabaseAsync.mockReset().mockResolvedValue(undefined);
  mockSecureDeleteItemAsync.mockReset().mockResolvedValue(undefined);
});

describe('WAL sidecar teardown', () => {
  it('names exactly the three files that must die together', () => {
    expect(HEALTH_LOCAL_FIRST_DB_NAME).toBe('symply-health-local-first.db');
    expect([...HEALTH_LOCAL_FIRST_DB_SIDECARS]).toEqual([
      'symply-health-local-first.db-wal',
      'symply-health-local-first.db-shm',
    ]);
    expect([...HEALTH_LOCAL_FIRST_DB_FILES]).toEqual([
      'symply-health-local-first.db',
      'symply-health-local-first.db-wal',
      'symply-health-local-first.db-shm',
    ]);
  });

  it('deletes the .db AND both sidecars — not just the .db', async () => {
    await runNativeTeardown(deleteHealthLocalFirstDbFile);

    const deleted = mockDeleteAsync.mock.calls.map(([path]) => path);
    for (const name of HEALTH_LOCAL_FIRST_DB_FILES) {
      expect(deleted).toContain(`file:///docs/${name}`);
    }
    // House deletes only the main `.db`; Health must not inherit that gap.
    expect(deleted.some((p) => p.endsWith('.db-wal'))).toBe(true);
    expect(deleted.some((p) => p.endsWith('.db-shm'))).toBe(true);
  });

  it('does not rely on mockDeleteDatabaseAsync to remove the sidecars', async () => {
    await runNativeTeardown(deleteHealthLocalFirstDbFile);
    // It is still called (it owns the SQLite registry entry) …
    expect(mockDeleteDatabaseAsync).toHaveBeenCalledWith(HEALTH_LOCAL_FIRST_DB_NAME);
    // … but the sidecars are removed explicitly regardless of what it returns.
    expect(mockDeleteAsync).toHaveBeenCalledTimes(HEALTH_LOCAL_FIRST_DB_FILES.length);
  });

  it('one failing delete does not skip the rest', async () => {
    mockDeleteAsync.mockImplementationOnce(async () => {
      throw new Error('ENOENT');
    });

    await runNativeTeardown(deleteHealthLocalFirstDbFile);

    // All three attempted even though the first threw — a checkpointed WAL
    // leaving no sidecar behind is the NORMAL case, not an error.
    expect(mockDeleteAsync).toHaveBeenCalledTimes(HEALTH_LOCAL_FIRST_DB_FILES.length);
  });

  it('survives mockDeleteDatabaseAsync throwing', async () => {
    mockDeleteDatabaseAsync.mockRejectedValueOnce(new Error('no such database'));
    await expect(runNativeTeardown(deleteHealthLocalFirstDbFile)).resolves.toBeUndefined();
    expect(mockDeleteAsync).toHaveBeenCalledTimes(HEALTH_LOCAL_FIRST_DB_FILES.length);
  });
});

describe('Keychain sweep scope', () => {
  it('deletes the Health DEK', async () => {
    await runNativeTeardown(clearLocalHealthPersistence);
    expect(mockSecureDeleteItemAsync).toHaveBeenCalledWith('health.localFirst.dek.v1');
    expect(HEALTH_DEK_SECURE_KEY).toBe('health.localFirst.dek.v1');
  });

  it('NEVER touches the House or Budget DEK', async () => {
    // Security-critical: the brands share a Keychain access group, so a broad
    // sweep here signs the user out of the sibling apps.
    await runNativeTeardown(clearLocalHealthPersistence);

    const keys = mockSecureDeleteItemAsync.mock.calls.map(([key]) => key);
    expect(keys).not.toContain('house.localFirst.dek.v1');
    expect(keys).not.toContain('budget.localFirst.dek.v1');
    expect(keys).toEqual(['health.localFirst.dek.v1']);
  });

  it('still wipes the database when the Keychain delete throws', async () => {
    mockSecureDeleteItemAsync.mockRejectedValueOnce(new Error('missing entitlement'));
    await runNativeTeardown(clearLocalHealthPersistence);
    expect(mockDeleteAsync).toHaveBeenCalledTimes(HEALTH_LOCAL_FIRST_DB_FILES.length);
  });
});
