/* eslint-disable @typescript-eslint/no-require-imports -- Jest hoisted factories and resetModules require synchronous isolated imports. */
/**
 * Storage adapter contract — AsyncStorage fallback path.
 *
 * Regression guard for the silent-data-loss bug: under the New Architecture
 * (bridgeless) runtime, react-native-mmkv v2's JSI installer is unavailable, so
 * `new MMKV()` throws and the storage layer falls back to AsyncStorage. In that
 * mode the SYNChronous `storage` adapter's getItem returns null unconditionally
 * (AsyncStorage has no sync read), so any zustand persist store wired to it can
 * write to disk but never rehydrate — its state is lost on every launch.
 *
 * The default jest setup mocks MMKV as *available*, which hid this. Here we
 * force MMKV to be unavailable to exercise the real device path, and pin the
 * contract that the two prefs stores rely on: use `asyncStorage`, never the
 * sync `storage` adapter, for anything that must survive a relaunch.
 */

// Force MMKV creation to throw *before* the storage module initializes,
// reproducing the bridgeless runtime where MMKV cannot install.
jest.mock('react-native-mmkv', () => ({
  createMMKV: jest.fn(() => {
    throw new Error('MMKV unavailable (bridgeless New Arch)');
  }),
}));

// Fresh module state so initializeMMKV() runs against the throwing mock above.
let storageModule: typeof import('@services/storage');

beforeEach(() => {
  jest.resetModules();
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  AsyncStorage.clear();
  storageModule = require('@services/storage');
});

describe('storage layer — MMKV unavailable (AsyncStorage fallback)', () => {
  it('reports MMKV as not in use', () => {
    expect(storageModule.isUsingMMKV()).toBe(false);
    expect(storageModule.isStorageReady()).toBe(true);
  });

  it('sync `storage` adapter CANNOT read back a written value (the trap)', () => {
    // This is precisely why persist stores must not use the sync adapter under
    // the fallback: the write is fire-and-forget, the read is always null.
    storageModule.storage.setItem('probe', 'value');
    expect(storageModule.storage.getItem('probe')).toBeNull();
  });

  it('async `asyncStorage` adapter round-trips through AsyncStorage', async () => {
    await storageModule.asyncStorage.setItem('probe', 'value');
    await expect(storageModule.asyncStorage.getItem('probe')).resolves.toBe('value');
  });

  it('asyncStorage removeItem clears the value', async () => {
    await storageModule.asyncStorage.setItem('probe', 'value');
    await storageModule.asyncStorage.removeItem('probe');
    await expect(storageModule.asyncStorage.getItem('probe')).resolves.toBeNull();
  });

  it('migrateAsyncStorageToMMKV is a safe no-op when MMKV is unavailable', async () => {
    await storageModule.asyncStorage.setItem('keep', 'me');
    await expect(storageModule.migrateAsyncStorageToMMKV()).resolves.toBeUndefined();
    // Data stays in AsyncStorage (still the active backend).
    await expect(storageModule.asyncStorage.getItem('keep')).resolves.toBe('me');
  });
});

describe('prefs stores use the rehydratable async adapter', () => {
  // Guards taskBoardStore / homeProjectStore against regressing back to the
  // sync `storage` adapter, which silently drops their persisted prefs.
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const storesDir = path.join(__dirname, '..', '..', 'stores');

  it.each(['taskBoardStore.ts', 'homeProjectStore.ts'])(
    '%s persists via asyncStorage, not the sync storage adapter',
    (file) => {
      const src = fs.readFileSync(path.join(storesDir, file), 'utf8');
      expect(src).toMatch(/createJSONStorage\(\(\)\s*=>\s*asyncStorage\)/);
      expect(src).not.toMatch(/createJSONStorage\(\(\)\s*=>\s*storage\)/);
    }
  );
});

export {};
