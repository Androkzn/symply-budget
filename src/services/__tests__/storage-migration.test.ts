/* eslint-disable @typescript-eslint/no-require-imports -- Jest hoisted factories and resetModules require synchronous isolated imports. */
/**
 * AsyncStorage → MMKV one-time migration (MMKV available path).
 *
 * With react-native-mmkv v4, `createMMKV()` auto-mocks in Jest, so MMKV is
 * "available" here (in-memory). This exercises the real migration the app runs
 * on the first launch after the v4 upgrade: data that had accumulated in the
 * AsyncStorage fallback must be copied into MMKV before any store reads it, so
 * persisted sessions/prefs survive the storage-backend switch.
 */

let storageModule: typeof import('@services/storage');
let AsyncStorage: typeof import('@react-native-async-storage/async-storage').default;

beforeEach(() => {
  jest.resetModules();
  AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  AsyncStorage.clear();
  storageModule = require('@services/storage');
  // Start from a clean MMKV so the migration flag isn't already set.
  storageModule.storageHelpers.clearAll();
});

describe('migrateAsyncStorageToMMKV — MMKV available', () => {
  it('runs against MMKV (not the fallback)', () => {
    expect(storageModule.isUsingMMKV()).toBe(true);
  });

  it('copies existing AsyncStorage keys into MMKV so a store can rehydrate', async () => {
    // Simulate data written while the app was on the AsyncStorage fallback.
    await AsyncStorage.setItem(
      'auth-storage',
      JSON.stringify({ state: { isAuthenticated: true }, version: 0 })
    );
    await AsyncStorage.setItem('task-board-prefs', JSON.stringify({ state: { viewMode: 'board' } }));

    await storageModule.migrateAsyncStorageToMMKV();

    // asyncStorage adapter now reads MMKV first — the copied values are there.
    await expect(storageModule.asyncStorage.getItem('auth-storage')).resolves.toContain(
      'isAuthenticated'
    );
    await expect(storageModule.asyncStorage.getItem('task-board-prefs')).resolves.toContain('board');
  });

  it('is idempotent — a second run does not re-copy or overwrite newer MMKV data', async () => {
    await AsyncStorage.setItem('k', 'from-async');
    await storageModule.migrateAsyncStorageToMMKV();

    // Value now lives in MMKV; write a newer value directly to MMKV.
    await storageModule.asyncStorage.setItem('k', 'newer-in-mmkv');
    // A stale AsyncStorage copy must NOT clobber the newer MMKV value on re-run.
    await storageModule.migrateAsyncStorageToMMKV();

    await expect(storageModule.asyncStorage.getItem('k')).resolves.toBe('newer-in-mmkv');
  });

  it('does not overwrite a key MMKV already holds', async () => {
    await storageModule.asyncStorage.setItem('shared', 'mmkv-wins');
    await AsyncStorage.setItem('shared', 'async-should-be-ignored');

    await storageModule.migrateAsyncStorageToMMKV();

    await expect(storageModule.asyncStorage.getItem('shared')).resolves.toBe('mmkv-wins');
  });

  it('typed getBoolean reads back a boolean flag copied as a string', async () => {
    // storageHelpers.setBoolean on the fallback stored booleans as 'true'/'false'.
    await AsyncStorage.setItem('some-flag', 'true');
    await storageModule.migrateAsyncStorageToMMKV();

    await expect(storageModule.storageHelpers.getBoolean('some-flag')).resolves.toBe(true);
  });

  it('typed getNumber reads back a number copied as a string', async () => {
    await AsyncStorage.setItem('some-count', '42');
    await storageModule.migrateAsyncStorageToMMKV();

    await expect(storageModule.storageHelpers.getNumber('some-count')).resolves.toBe(42);
  });
});

export {};
