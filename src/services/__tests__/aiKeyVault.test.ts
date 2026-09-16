/**
 * AI provider key vault — the durable BYOK key lives in the device Keychain,
 * brand + env scoped. Reads still degrade to null on a bare simulator, but a
 * failed WRITE now surfaces in every build: swallowing it under __DEV__ let the
 * connect flow finish and the Providers card render "Active · Validated" off
 * server state while the Keychain stayed empty, so every local-first BYOK
 * feature reported "needs your AI key" (observed 2026-08-14, Budget receipt
 * scan). Mirrors secure-token-storage.test.ts.
 */
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __store: store,
  };
});

jest.mock('@brand', () => ({
  brand: { id: 'symply-budget' },
}));

jest.mock('@config/env', () => ({
  ENV: { IS_PRODUCTION: false },
}));

import * as SecureStore from 'expo-secure-store';

import { aiKeyVault } from '../aiKeyVault';

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const setItem = SecureStore.setItemAsync as jest.Mock;
const getItem = SecureStore.getItemAsync as jest.Mock;
const deleteItem = SecureStore.deleteItemAsync as jest.Mock;

// aiKeyVault branches on __DEV__ (swallow vs throw). It defaults to true under
// jest; flip it per-test to exercise the production path, then restore.
const realDev = (global as unknown as { __DEV__: boolean }).__DEV__;
const setDev = (value: boolean) => {
  (global as unknown as { __DEV__: boolean }).__DEV__ = value;
};

describe('aiKeyVault', () => {
  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    setDev(realDev);
  });

  afterEach(() => setDev(realDev));

  it('namespaces keys by brand.env.provider and round-trips set → get', async () => {
    await aiKeyVault.setKey('anthropic', 'sk-ant-123');

    expect(store.get('symply-budget.staging.ai.key.anthropic')).toBe('sk-ant-123');
    expect(setItem).toHaveBeenCalledWith(
      'symply-budget.staging.ai.key.anthropic',
      'sk-ant-123',
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
    await expect(aiKeyVault.getKey('anthropic')).resolves.toBe('sk-ant-123');
  });

  it('scopes keys per provider so one provider never reads another', async () => {
    await aiKeyVault.setKey('openai', 'sk-openai');
    await aiKeyVault.setKey('gemini', 'sk-gemini');

    expect(await aiKeyVault.getKey('openai')).toBe('sk-openai');
    expect(await aiKeyVault.getKey('gemini')).toBe('sk-gemini');
    // A provider that was never set reads back null.
    expect(await aiKeyVault.getKey('anthropic')).toBeNull();
  });

  it('hasKey reflects presence', async () => {
    expect(await aiKeyVault.hasKey('openai')).toBe(false);
    await aiKeyVault.setKey('openai', 'sk-openai');
    expect(await aiKeyVault.hasKey('openai')).toBe(true);
  });

  it('deleteKey removes the key and swallows a Keychain failure', async () => {
    await aiKeyVault.setKey('openai', 'sk-openai');
    await aiKeyVault.deleteKey('openai');
    expect(await aiKeyVault.getKey('openai')).toBeNull();

    // Even if the platform rejects the delete, the call resolves quietly.
    deleteItem.mockRejectedValueOnce(new Error('keychain locked'));
    await expect(aiKeyVault.deleteKey('gemini')).resolves.toBeUndefined();
  });

  describe('__DEV__ simulator fallback (no Keychain entitlement)', () => {
    beforeEach(() => setDev(true));

    it('setKey surfaces the write error rather than pretending the key was saved', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      setItem.mockRejectedValueOnce(new Error('no entitlement'));

      // This used to resolve — the swallow that made the "connected but no key
      // on device" state invisible. A dev build must fail loudly here too.
      await expect(aiKeyVault.setKey('anthropic', 'sk')).rejects.toThrow();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('getKey returns null instead of throwing when the read fails', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      getItem.mockRejectedValueOnce(new Error('no entitlement'));

      await expect(aiKeyVault.getKey('anthropic')).resolves.toBeNull();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('production (real device — errors must surface)', () => {
    beforeEach(() => setDev(false));

    it('setKey rethrows a Keychain write failure', async () => {
      setItem.mockRejectedValueOnce(new Error('write denied'));
      await expect(aiKeyVault.setKey('openai', 'sk')).rejects.toThrow('write denied');
    });

    it('setKey translates a missing-entitlement error into a legible message', async () => {
      // The raw native string ("...setValueWithKeyAsync... A required entitlement
      // isn't present") is meaningless to a user — it must be remapped, but still
      // throw so the connect flow does not falsely claim the key was saved.
      setItem.mockRejectedValueOnce(
        new Error("Calling the 'setValueWithKeyAsync' function has failed → Caused by: A required entitlement isn't present."),
      );
      await expect(aiKeyVault.setKey('gemini', 'AQ.key')).rejects.toThrow(/Keychain unavailable/i);
    });

    it('getKey rethrows a Keychain read failure', async () => {
      getItem.mockRejectedValueOnce(new Error('read denied'));
      await expect(aiKeyVault.getKey('openai')).rejects.toThrow('read denied');
    });
  });
});
