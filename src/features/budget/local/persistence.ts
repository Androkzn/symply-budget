import * as SecureStore from 'expo-secure-store';

import { asyncStorage } from '@services/storage';
import {
  aeadDecrypt,
  aeadEncrypt,
  bytesToHex,
  hexToBytes,
  utf8Decode,
  utf8Encode,
  type Bytes,
} from '@symply/local-first';

import {
  archiveBudgetLocalFirstDbFile,
  deleteArchivedBudgetLocalFirstDbFile,
  deleteBudgetLocalFirstDbFile,
  listArchivedBudgetLocalFirstDbFiles,
} from './budget-local-first-store';

/** Leftover MMKV keys from the pre-Stage-2 snapshot path — wiped on reset. */
const SNAPSHOT_KEY = 'budget.localFirst.snapshot.v1';
const KEY_MATERIAL_KEY = 'budget.localFirst.dbKey.v1';

/**
 * Device DEK. Alphanumeric + dots only — expo-secure-store rejects `:`.
 * Accessibility: device-bound, does not migrate via iCloud restore.
 */
const DEK_SECURE_KEY = 'budget.localFirst.dek.v1';

let jestDekHex: string | null = null;

function isJestRuntime(): boolean {
  return process.env.JEST_WORKER_ID !== undefined;
}

function secureOptions(background = false): SecureStore.SecureStoreOptions {
  return { keychainAccessible: background ? SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY : SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
}

export async function loadDbKeyHex(): Promise<string | null> {
  if (isJestRuntime()) return jestDekHex;
  try {
    const hex = await SecureStore.getItemAsync(DEK_SECURE_KEY);
    // Migrate existing installs while unlocked; background work may then open
    // the encrypted ledger after the first unlock, without exporting its key.
    if (hex) await SecureStore.setItemAsync(DEK_SECURE_KEY, hex, secureOptions(true)).catch(() => undefined);
    return hex;
  } catch {
    return null;
  }
}

export async function saveDbKeyHex(hex: string): Promise<void> {
  if (isJestRuntime()) {
    jestDekHex = hex;
    return;
  }
  await SecureStore.setItemAsync(DEK_SECURE_KEY, hex, secureOptions(true));
}

/** Per-archive DEK slot. Alphanumeric + dots only — see DEK_SECURE_KEY. */
function archivedDekKey(label: string): string {
  return `budget.localFirst.dek.archived.${label}`;
}

/**
 * Retire the current ledger WITHOUT destroying it.
 *
 * Signing in as a different member has to take the previous member's ledger out
 * of reach — they are not a member of that household. It does NOT have to
 * shred it. The old behaviour deleted the database and its key outright, so a
 * single unexpected account switch silently and permanently destroyed every
 * category, expense and budget on the device with no warning and no export
 * (observed 2026-08-14: a ledger recreated at 13:28:40 with 0 operations).
 *
 * The file moves aside and its DEK moves to a per-member slot in the SAME
 * SecureStore the live key uses — no weaker storage, nothing readable without
 * the Keychain. Recovering it still needs a restore path in the UI; retaining
 * the material is what makes that possible at all.
 *
 * Returns the archived database path, or null when there was nothing to keep.
 */
export async function archiveLocalBudgetPersistence(label: string): Promise<string | null> {
  const dekHex = await loadDbKeyHex();
  const archivedPath = await archiveBudgetLocalFirstDbFile(label);

  if (archivedPath && dekHex && !isJestRuntime()) {
    try {
      await SecureStore.setItemAsync(archivedDekKey(label), dekHex, secureOptions());
    } catch {
      // Without the key the archive is unreadable — say so rather than
      // implying the data was kept.
      console.warn('[BudgetLocal] archived ledger but could not retain its key');
    }
  }

  jestDekHex = null;
  try {
    await SecureStore.deleteItemAsync(DEK_SECURE_KEY);
  } catch {
    // ignore missing key / missing Keychain entitlements
  }
  await asyncStorage.removeItem(SNAPSHOT_KEY);
  await asyncStorage.removeItem(KEY_MATERIAL_KEY);
  // The live file has already been moved; this clears anything left behind.
  await deleteBudgetLocalFirstDbFile();
  return archivedPath;
}

/** A ledger this device retired on an account switch, as the UI shows it. */
export type ArchivedLocalLedger = {
  label: string;
  sizeBytes: number;
  archivedAt: string | null;
};

/** Outcome of a purge: retired ledgers destroyed, and the disk they held. */
export type PurgedArchivedLedgers = {
  removed: number;
  bytesFreed: number;
};

/** What earlier sign-ins left behind on this device, newest first. */
export async function listArchivedLocalBudgetLedgers(): Promise<ArchivedLocalLedger[]> {
  const files = await listArchivedBudgetLocalFirstDbFiles();
  return files.map(({ label, sizeBytes, archivedAt }) => ({ label, sizeBytes, archivedAt }));
}

/**
 * Destroy every retired ledger, ciphertext AND key.
 *
 * The counterpart to `archiveLocalBudgetPersistence`: that one keeps a signed-out
 * member's data recoverable, this one is how the owner of the phone finally gets
 * rid of it. Both halves have to go — a leftover Keychain slot outlives even an
 * app uninstall on iOS, and orphaned key material is exactly what "clean up my
 * old data" is supposed to remove.
 *
 * The live ledger is untouched.
 */
export async function purgeArchivedLocalBudgetLedgers(): Promise<PurgedArchivedLedgers> {
  const archives = await listArchivedLocalBudgetLedgers();
  let removed = 0;
  let bytesFreed = 0;

  for (const archive of archives) {
    await deleteArchivedBudgetLocalFirstDbFile(archive.label);
    if (!isJestRuntime()) {
      try {
        await SecureStore.deleteItemAsync(archivedDekKey(archive.label));
      } catch {
        // Already gone / no Keychain entitlement — the ciphertext is what mattered.
      }
    }
    removed += 1;
    bytesFreed += archive.sizeBytes;
  }

  return { removed, bytesFreed };
}

export async function clearLocalBudgetPersistence(): Promise<void> {
  jestDekHex = null;
  try {
    await SecureStore.deleteItemAsync(DEK_SECURE_KEY);
  } catch {
    // ignore missing key / missing Keychain entitlements
  }
  await asyncStorage.removeItem(SNAPSHOT_KEY);
  await asyncStorage.removeItem(KEY_MATERIAL_KEY);
  await deleteBudgetLocalFirstDbFile();
}

/**
 * Detectable "SecureStore wiped, SQLite survived" — ciphertext orphan.
 * Callers should send the member to recovery, not crash.
 */
export class LedgerDekMissingError extends Error {
  readonly code = 'ledger_dek_missing';
  constructor() {
    super('Ledger DEK missing from SecureStore while a local database exists');
    this.name = 'LedgerDekMissingError';
  }
}

/** @deprecated Stage 2 no longer writes a full-ledger snapshot. Kept for tests that pin the old path. */
export async function loadEncryptedSnapshot(dbKey: Bytes): Promise<string | null> {
  const sealedHex = await asyncStorage.getItem(SNAPSHOT_KEY);
  if (!sealedHex) return null;
  try {
    const plain = aeadDecrypt(dbKey, hexToBytes(sealedHex), utf8Encode('budget-ledger-v1'));
    return utf8Decode(plain);
  } catch {
    return null;
  }
}

/** @deprecated Stage 2 writes per-row AEAD into SQLite instead. */
export async function saveEncryptedSnapshot(dbKey: Bytes, json: string): Promise<void> {
  const sealed = aeadEncrypt(dbKey, utf8Encode(json), utf8Encode('budget-ledger-v1'));
  await asyncStorage.setItemStrict(SNAPSHOT_KEY, bytesToHex(sealed));
}
