import * as SecureStore from 'expo-secure-store';

import { deleteHealthLocalFirstDbFile } from './health-local-first-store';

/**
 * Device DEK for the Health ledger. Alphanumeric + dots only — expo-secure-store
 * rejects `:`.
 *
 * Deliberately distinct from `house.localFirst.dek.v1` and
 * `budget.localFirst.dek.v1` (plan §3): one device running several Symply apps
 * must not have them overwrite each other's key. `healthSession.test.ts` proves
 * all three differ inside one Jest process.
 */
const DEK_SECURE_KEY = 'health.localFirst.dek.v1';

/**
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, matching Budget and House.
 *
 * The effect that matters is NOT "blocks iCloud Keychain sync" — expo-secure-store
 * never sets `kSecAttrSynchronizable`, so nothing it writes reaches iCloud
 * Keychain at any accessibility level. What `_THIS_DEVICE_ONLY` actually does is
 * exclude the item from **encrypted-backup restore onto a different device**:
 * Apple's own wording is that such an item is "useless if it's restored to a
 * different device".
 *
 * That is precisely why Q8 (plan §16) is open and blocks He9 — a user who loses
 * or replaces their phone loses the ledger unless the archive is separately
 * keyed. Do not weaken this class to work around a restore bug; answer Q8.
 *
 * Also note: `SecItemUpdate` omits `kSecAttrAccessible`, so changing this class
 * on an EXISTING item silently no-ops. Any future change is delete-then-rewrite.
 */
function secureOptions(): SecureStore.SecureStoreOptions {
  return { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
}

let jestDekHex: string | null = null;

function isJestRuntime(): boolean {
  return process.env.JEST_WORKER_ID !== undefined;
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

/**
 * Full teardown: DEK + ops journal + WAL sidecars.
 *
 * Deletes **only** the Health DEK. Do not sweep unrelated App Group / Keychain
 * items — other brands share the access group and a broad sweep would sign the
 * user out of Budget and House (plan §1.3).
 */
export async function clearLocalHealthPersistence(): Promise<void> {
  jestDekHex = null;
  try {
    await SecureStore.deleteItemAsync(DEK_SECURE_KEY);
  } catch {
    // ignore missing key / missing Keychain entitlements
  }
  await deleteHealthLocalFirstDbFile();
}

/** Exported for the cross-brand isolation test (DoD He1). */
export const HEALTH_DEK_SECURE_KEY = DEK_SECURE_KEY;
