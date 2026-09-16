import * as SecureStore from 'expo-secure-store';

import { deleteHouseLocalFirstDbFile } from './house-local-first-store';

/**
 * Device DEK for the House ledger. Alphanumeric + dots only — expo-secure-store
 * rejects `:`. Accessibility is device-bound and does NOT migrate through an
 * iCloud restore, which is the point: the key never leaves this handset.
 *
 * Deliberately distinct from Budget's `budget.localFirst.dek.v1` (plan §3.3) —
 * one device running both apps must not have them overwrite each other's key.
 */
const DEK_SECURE_KEY = 'house.localFirst.dek.v1';

let jestDekHex: string | null = null;

function isJestRuntime(): boolean {
  return process.env.JEST_WORKER_ID !== undefined;
}

function secureOptions(): SecureStore.SecureStoreOptions {
  return { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
}

export async function loadDbKeyHex(): Promise<string | null> {
  if (isJestRuntime()) return jestDekHex;
  try {
    return await SecureStore.getItemAsync(DEK_SECURE_KEY);
  } catch {
    return null;
  }
}

export async function saveDbKeyHex(hex: string): Promise<void> {
  if (isJestRuntime()) {
    jestDekHex = hex;
    return;
  }
  await SecureStore.setItemAsync(DEK_SECURE_KEY, hex, secureOptions());
}

export async function clearLocalHousePersistence(): Promise<void> {
  jestDekHex = null;
  try {
    await SecureStore.deleteItemAsync(DEK_SECURE_KEY);
  } catch {
    // ignore missing key / missing Keychain entitlements
  }
  await deleteHouseLocalFirstDbFile();
}

/** Exported for the cross-brand isolation test (plan DoD H1). */
export const HOUSE_DEK_SECURE_KEY = DEK_SECURE_KEY;

/**
 * Detectable "SecureStore wiped, SQLite survived" — ciphertext orphan.
 * Callers should send the member to recovery, not crash.
 */
export class HouseLedgerDekMissingError extends Error {
  readonly code = 'ledger_dek_missing';
  constructor() {
    super('House ledger DEK missing from SecureStore while a local database exists');
    this.name = 'HouseLedgerDekMissingError';
  }
}
