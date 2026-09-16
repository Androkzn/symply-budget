/**
 * SecureStore product/companion token adapter — Data Bridge A7.
 */
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 2,
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

import {
  saveProductTokens,
  loadProductTokens,
  clearProductTokens,
  saveCompanionToken,
  loadCompanionToken,
  clearCompanionToken,
  wipeLegacyTokenKeys,
} from '../secure-token-storage';

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

describe('secure-token-storage', () => {
  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
  });

  it('namespaces product tokens by brand:env:authority', async () => {
    await saveProductTokens('access-1', 'refresh-1');
    expect(store.get('symply-budget.staging.1.access')).toBe('access-1');
    expect(store.get('symply-budget.staging.1.refresh')).toBe('refresh-1');
    await expect(loadProductTokens()).resolves.toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: null,
    });
  });

  it('round-trips the optional expiresAt alongside the tokens', async () => {
    await saveProductTokens('access-1', 'refresh-1', 1785900000000);
    expect(store.get('symply-budget.staging.1.expiresAt')).toBe('1785900000000');
    await expect(loadProductTokens()).resolves.toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1785900000000,
    });
  });

  it('clearProductTokens also removes the stored expiresAt', async () => {
    await saveProductTokens('a', 'r', 1785900000000);
    await clearProductTokens();
    await expect(loadProductTokens()).resolves.toEqual({
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
    });
  });

  it('wipes legacy generic keys on save', async () => {
    store.set('access_token', 'legacy');
    store.set('auth_token', 'legacy2');
    await saveProductTokens('a', 'r');
    expect(store.has('access_token')).toBe(false);
    expect(store.has('auth_token')).toBe(false);
  });

  it('clears product + legacy keys', async () => {
    await saveProductTokens('a', 'r');
    store.set('refresh_token', 'legacy');
    await clearProductTokens();
    expect(store.get('symply-budget.staging.1.access')).toBeUndefined();
    expect(store.has('refresh_token')).toBe(false);
  });

  it('stores companion token under namespaced key', async () => {
    await saveCompanionToken('companion.jwt');
    expect(await loadCompanionToken()).toBe('companion.jwt');
    await clearCompanionToken();
    expect(await loadCompanionToken()).toBeNull();
  });

  it('wipeLegacyTokenKeys is idempotent', async () => {
    await wipeLegacyTokenKeys();
    await wipeLegacyTokenKeys();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
  });
});


it('keeps Budget product tokens device-only and available after first unlock for background sync', async () => {
  await saveProductTokens('access', 'refresh', 1234);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(expect.stringContaining('.access'), 'access', {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
});
