/**
 * AI provider key vault — the DURABLE home for BYOK developer keys is the device
 * Keychain, NOT our backend. The server only ever holds a short-lived, encrypted
 * session lease (see the session-lease endpoint) so background AI keeps working;
 * that lease auto-expires and is refreshed from here when the app is foregrounded.
 *
 * Mirrors secure-token-storage.ts: brand + env scoped keys, '.'-separated (SDK 57
 * rejects ':'), WHEN_UNLOCKED_THIS_DEVICE_ONLY, with a __DEV__ simulator fallback.
 */
import * as SecureStore from 'expo-secure-store';

import type { AIProviderId } from '@api/aiAccess';
import { brand } from '@brand';
import { ENV } from '@config/env';

function envSegment(): string {
  return ENV.IS_PRODUCTION ? 'production' : 'staging';
}

function keyFor(provider: AIProviderId): string {
  return `${brand.id}.${envSegment()}.ai.key.${provider}`;
}

function options(): SecureStore.SecureStoreOptions {
  return { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
}

export async function setKey(provider: AIProviderId, apiKey: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(keyFor(provider), apiKey, options());
  } catch (error) {
    // This used to swallow the failure under __DEV__ ("the session lease still
    // works"), which was wrong in a way that cost a day: the connect flow went
    // on to POST the lease and PATCH /ai-preferences, both of which succeed, so
    // the Providers card rendered "Active · Validated" off SERVER state while
    // the device Keychain stayed empty. Every local-first BYOK feature reads
    // this vault, so they all failed with "needs your AI key" against a UI
    // insisting the provider was connected (observed 2026-08-14 on Budget
    // receipt scan). A write that did not happen must be reported, in every
    // build — the caller decides how to present it.
    console.warn('[aiKeyVault] setKey failed', error);
    // A missing Keychain entitlement (errSecMissingEntitlement / "A required
    // entitlement isn't present") means this build can't persist the key. The
    // raw native message is meaningless to a user, so translate it.
    const raw = (error as Error)?.message ?? '';
    if (/entitlement/i.test(raw) || /setValueWithKeyAsync/i.test(raw)) {
      throw new Error(
        "Couldn't securely save your key on this device (Keychain unavailable). Please update to the latest build and try again.",
      );
    }
    throw error;
  }
}

export async function getKey(provider: AIProviderId): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(keyFor(provider));
  } catch (error) {
    if (__DEV__) {
      console.warn('[aiKeyVault] getKey unavailable', error);
      return null;
    }
    throw error;
  }
}

export async function hasKey(provider: AIProviderId): Promise<boolean> {
  return (await getKey(provider)) !== null;
}

export async function deleteKey(provider: AIProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(provider)).catch(() => undefined);
}

export const aiKeyVault = { setKey, getKey, hasKey, deleteKey };
