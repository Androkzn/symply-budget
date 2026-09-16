// See autoBackup.ts — must precede `@symply/local-first`.
import '../cryptoPolyfill';

import * as SecureStore from 'expo-secure-store';

import { isValidRecoveryPhrase, normalizeRecoveryPhrase } from '@symply/local-first';

import { getActiveHouseholdId } from '../engine';

/**
 * The last recovery phrase that actually opened an archive on this device.
 *
 * Kept so a second restore does not re-ask for words the user already proved
 * they hold. Keychain, not AsyncStorage — this phrase opens the whole ledger.
 * Only ever written after a successful decrypt, so a typo can never become the
 * remembered default.
 *
 * ## Per property (Q15 / H5)
 *
 * Each home's archives are sealed under their own phrase — auto-backup mints
 * one per home, and a manual backup mints one per archive. One remembered
 * phrase for three homes would pre-fill the restore field with words that are
 * correct for some other home: the member accepts the offered default, waits
 * out a full Argon2 pass, and is told the phrase is wrong. So the memory is
 * keyed by property, and a home with no remembered phrase correctly asks rather
 * than guessing.
 */
const RESTORE_PHRASE_KEY_PREFIX = 'house.backup.lastRestorePhrase';

/**
 * SecureStore rejects any key outside `[A-Za-z0-9._-]`, so the `:` separator
 * used for the AsyncStorage keys elsewhere in this folder is not available here
 * — it throws rather than degrading. Household ids are `hh_local_<hex>`, which
 * already fit, but a server-issued id need not, so everything else is folded to
 * `_` rather than trusted.
 */
const secureKeySegment = (householdId: string) => householdId.replace(/[^A-Za-z0-9._-]+/g, '_');

const restorePhraseKeyFor = (householdId: string) =>
  `${RESTORE_PHRASE_KEY_PREFIX}.${secureKeySegment(householdId)}`;

/** A stored phrase is only worth returning if it still validates — see below. */
function usablePhrase(stored: string | null): string | null {
  if (!stored) return null;
  // A phrase that no longer validates (wordlist change, partial write) is
  // worse than none — it would pre-fill a field the user then trusts.
  return isValidRecoveryPhrase(stored) ? normalizeRecoveryPhrase(stored) : null;
}

export async function getRememberedRestorePhrase(householdId?: string): Promise<string | null> {
  const target = householdId ?? getActiveHouseholdId();
  if (!target) return null;
  try {
    return usablePhrase(await SecureStore.getItemAsync(restorePhraseKeyFor(target)));
  } catch {
    return null;
  }
}

export async function rememberRestorePhrase(
  phrase: string,
  householdId?: string,
): Promise<void> {
  const target = householdId ?? getActiveHouseholdId();
  if (!target) return;
  const normalized = normalizeRecoveryPhrase(phrase);
  if (!isValidRecoveryPhrase(normalized)) return;
  try {
    await SecureStore.setItemAsync(restorePhraseKeyFor(target), normalized);
  } catch {
    // Remembering is a convenience; never fail a restore over it.
  }
}

export async function forgetRememberedRestorePhrase(householdId?: string): Promise<void> {
  const target = householdId ?? getActiveHouseholdId();
  if (!target) return;
  try {
    await SecureStore.deleteItemAsync(restorePhraseKeyFor(target));
  } catch {
    // Nothing to do — the item is already unreachable.
  }
}
