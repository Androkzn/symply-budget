/**
 * SecureStore token adapter — product access/refresh never enter Zustand persist / MMKV.
 * Key prefix: `{brand}:{env}:{authorityVer}:`
 */
import * as SecureStore from 'expo-secure-store';

import { brand } from '@brand';
import { ENV } from '@config/env';

const AUTHORITY_VERSION = '1';

const LEGACY_GENERIC_KEYS = [
  'access_token',
  'refresh_token',
  'auth_token',
  'auth.accessToken',
  'auth.refreshToken',
] as const;

function envSegment(): string {
  return ENV.IS_PRODUCTION ? 'production' : 'staging';
}

function prefix(): string {
  // expo-secure-store (SDK 57+) rejects keys containing ':' — keys may only use
  // alphanumerics plus '.', '-', '_'. Use '.' as the separator so brand-scoped
  // token keys (e.g. `symply-budget.staging.1.access`) stay valid.
  return `${brand.id}.${envSegment()}.${AUTHORITY_VERSION}.`;
}

function options(background = false): SecureStore.SecureStoreOptions {
  return {
    keychainAccessible: background && brand.id === 'symply-budget'
      ? SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
      : SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
}

export async function wipeLegacyTokenKeys(): Promise<void> {
  await Promise.all(
    LEGACY_GENERIC_KEYS.map(async (key) => {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {
        // ignore missing keys
      }
    })
  );
}

export async function saveProductTokens(
  accessToken: string,
  refreshToken: string,
  /** Epoch ms the access token expires — lets a future launch proactively
   * refresh a stale token instead of firing it and eating a guaranteed 401. */
  expiresAt?: number
): Promise<void> {
  try {
    const p = prefix();
    await SecureStore.setItemAsync(`${p}access`, accessToken, options(true));
    await SecureStore.setItemAsync(`${p}refresh`, refreshToken, options(true));
    if (expiresAt != null) {
      await SecureStore.setItemAsync(`${p}expiresAt`, String(expiresAt), options(true));
    }
    await wipeLegacyTokenKeys();
  } catch (error) {
    // Debug simulators often lack Keychain entitlements — keep in-memory JWTs
    // for the session so Maestro E2E can proceed after e2e-login / form sign-in.
    if (__DEV__) {
      console.warn('[SecureStore] saveProductTokens skipped — using in-memory tokens', error);
      return;
    }
    throw error;
  }
}

export async function loadProductTokens(): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
}> {
  try {
    const p = prefix();
    const [accessToken, refreshToken, expiresAtRaw] = await Promise.all([
      SecureStore.getItemAsync(`${p}access`),
      SecureStore.getItemAsync(`${p}refresh`),
      SecureStore.getItemAsync(`${p}expiresAt`),
    ]);
    // Budget sync wakes need account credentials when the screen is locked.
    // Other brands retain their existing foreground-only accessibility policy.
    if (brand.id === 'symply-budget' && accessToken && refreshToken) {
      try {
      await SecureStore.setItemAsync(`${p}access`, accessToken, options(true));
      await SecureStore.setItemAsync(`${p}refresh`, refreshToken, options(true));
      if (expiresAtRaw != null) await SecureStore.setItemAsync(`${p}expiresAt`, expiresAtRaw, options(true));
      } catch { /* Accessibility migration must not discard readable credentials. */ }
    }
    const parsedExpiresAt = expiresAtRaw != null ? Number(expiresAtRaw) : NaN;
    return {
      accessToken,
      refreshToken,
      expiresAt: Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : null,
    };
  } catch (error) {
    if (__DEV__) {
      console.warn('[SecureStore] loadProductTokens unavailable', error);
      return { accessToken: null, refreshToken: null, expiresAt: null };
    }
    throw error;
  }
}

export async function clearProductTokens(): Promise<void> {
  const p = prefix();
  await Promise.all([
    SecureStore.deleteItemAsync(`${p}access`).catch(() => undefined),
    SecureStore.deleteItemAsync(`${p}refresh`).catch(() => undefined),
    SecureStore.deleteItemAsync(`${p}expiresAt`).catch(() => undefined),
    wipeLegacyTokenKeys(),
  ]);
}

export async function saveCompanionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(`${prefix()}companion`, token, options());
}

export async function loadCompanionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(`${prefix()}companion`);
}

export async function clearCompanionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(`${prefix()}companion`).catch(() => undefined);
}
