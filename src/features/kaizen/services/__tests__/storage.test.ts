import {
  asyncStorage,
  isStorageReady,
  isUsingMMKV,
  storage,
  storageHelpers,
} from '../storage';

// storage.ts prefers the (globally in-memory-mocked) MMKV instance.
describe('kaizen storage facade', () => {
  beforeEach(() => {
    // Clear any keys this suite touches.
    ['s.k', 's.obj', 's.state', 's.async'].forEach(k => storageHelpers.remove(k));
  });

  it('reports MMKV as the ready backend', () => {
    expect(isStorageReady()).toBe(true);
    expect(isUsingMMKV()).toBe(true);
  });

  describe('storageHelpers', () => {
    it('round-trips strings and removes them', () => {
      expect(storageHelpers.getString('s.k')).toBeNull();
      storageHelpers.setString('s.k', 'hello');
      expect(storageHelpers.getString('s.k')).toBe('hello');
      storageHelpers.remove('s.k');
      expect(storageHelpers.getString('s.k')).toBeNull();
    });

    it('round-trips objects and returns null on missing/corrupt JSON', () => {
      expect(storageHelpers.getObject('s.obj')).toBeNull();
      storageHelpers.setObject('s.obj', { a: 1, b: ['x'] });
      expect(storageHelpers.getObject<{ a: number; b: string[] }>('s.obj')).toEqual({ a: 1, b: ['x'] });

      storageHelpers.setString('s.obj', '{not json');
      expect(storageHelpers.getObject('s.obj')).toBeNull();
    });
  });

  describe('StateStorage adapters', () => {
    it('sync storage get/set/remove works against MMKV', () => {
      expect(storage.getItem('s.state')).toBeNull();
      storage.setItem('s.state', 'v');
      expect(storage.getItem('s.state')).toBe('v');
      storage.removeItem('s.state');
      expect(storage.getItem('s.state')).toBeNull();
    });

    it('async storage adapter resolves values', async () => {
      await asyncStorage.setItem('s.async', 'av');
      expect(await asyncStorage.getItem('s.async')).toBe('av');
      await asyncStorage.removeItem('s.async');
      expect(await asyncStorage.getItem('s.async')).toBeNull();
    });
  });
});

// The following suites re-import storage.ts under a differently-mocked
// react-native-mmkv so the two module-load code paths (MMKV unavailable /
// MMKV present-but-throwing) — which the module-scoped `usingMMKV` flag freezes
// at import time — can each be exercised. `resetModules()` clears the registry so
// the re-`require` runs `initializeMMKV()` against the overriding `doMock`.
describe('kaizen storage facade — MMKV unavailable (AsyncStorage fallback)', () => {
  afterEach(() => {
    jest.dontMock('react-native-mmkv');
    jest.resetModules();
  });

  it('routes every adapter through AsyncStorage when MMKV construction fails', async () => {
    jest.resetModules();
    jest.doMock('react-native-mmkv', () => ({
      createMMKV: jest.fn(() => {
        throw new Error("JSI unavailable");
      }),
    }));
     
    const asMod = require('@react-native-async-storage/async-storage');
    const AS = asMod.default ?? asMod;
     
    const mod: typeof import('../storage') = require('../storage');

    // init catch ran → storage still "ready" but not on MMKV.
    expect(mod.isStorageReady()).toBe(true);
    expect(mod.isUsingMMKV()).toBe(false);

    // Sync StateStorage: getItem is always null off-MMKV; set/remove defer to AsyncStorage.
    expect(mod.storage.getItem('sf')).toBeNull();
    mod.storage.setItem('sf', 'v');
    expect(AS.setItem).toHaveBeenCalledWith('sf', 'v');
    mod.storage.removeItem('sf');
    expect(AS.removeItem).toHaveBeenCalledWith('sf');

    // Async StateStorage: real round-trip through the in-memory AsyncStorage mock.
    await mod.asyncStorage.setItem('af', 'w');
    expect(await mod.asyncStorage.getItem('af')).toBe('w');
    await mod.asyncStorage.removeItem('af');
    expect(await mod.asyncStorage.getItem('af')).toBeNull();

    // Helpers: getString null off-MMKV; set/remove defer to AsyncStorage.
    expect(mod.storageHelpers.getString('hf')).toBeNull();
    mod.storageHelpers.setString('hf', 'z');
    expect(AS.setItem).toHaveBeenCalledWith('hf', 'z');
    mod.storageHelpers.remove('hf');
    expect(AS.removeItem).toHaveBeenCalledWith('hf');
  });

  it('swallows AsyncStorage rejections on the fire-and-forget writers', async () => {
    jest.resetModules();
    jest.doMock('react-native-mmkv', () => ({
      createMMKV: jest.fn(() => {
        throw new Error("JSI unavailable");
      }),
    }));
     
    const asMod = require('@react-native-async-storage/async-storage');
    const AS = asMod.default ?? asMod;
     
    const mod: typeof import('../storage') = require('../storage');

    const reject = () => Promise.reject(new Error('nope'));
    AS.setItem.mockImplementation(reject);
    AS.removeItem.mockImplementation(reject);

    // The sync writers are fire-and-forget with an inline `.catch(() => {})`;
    // an AsyncStorage rejection must be swallowed, never thrown.
    expect(() => mod.storage.setItem('r', 'v')).not.toThrow();
    expect(() => mod.storage.removeItem('r')).not.toThrow();
    expect(() => mod.storageHelpers.setString('r', 'v')).not.toThrow();
    expect(() => mod.storageHelpers.remove('r')).not.toThrow();

    // Flush the rejection microtasks so each `.catch(() => {})` handler runs.
    await new Promise(resolve => setImmediate(resolve));
  });
});

describe('kaizen storage facade — MMKV present but throwing', () => {
  afterEach(() => {
    jest.dontMock('react-native-mmkv');
    jest.resetModules();
  });

  it('swallows MMKV read/write errors on the sync adapter', () => {
    jest.resetModules();
    jest.doMock('react-native-mmkv', () => ({
      createMMKV: jest.fn(() => ({
        set: jest.fn(() => {
          throw new Error('set boom');
        }),
        getString: jest.fn(() => {
          throw new Error('get boom');
        }),
        remove: jest.fn(() => {
          throw new Error('remove boom');
        }),
      })),
    }));
     
    const mod: typeof import('../storage') = require('../storage');

    expect(mod.isUsingMMKV()).toBe(true);
    // getItem catches and returns null; set/remove catch and swallow.
    expect(mod.storage.getItem('x')).toBeNull();
    expect(() => mod.storage.setItem('x', 'y')).not.toThrow();
    expect(() => mod.storage.removeItem('x')).not.toThrow();
  });
});
