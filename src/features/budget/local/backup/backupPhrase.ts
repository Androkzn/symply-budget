// Polyfill BEFORE `@symply/local-first` (noble caches `crypto` at import, so a
// later arming is too late). See the same note at the top of `autoBackup.ts` —
// this module mints phrases too, and it is now the earlier import of the two.
import '../cryptoPolyfill';

import * as SecureStore from 'expo-secure-store';

import { generateRecoveryPhrase } from '@symply/local-first';

import { getActiveBudgetHouseholdId, listLocalBudgetHouseholds } from '../engine';

/**
 * Budget V2 — the device's ONE backup recovery phrase.
 *
 * ## Why one phrase, and not one per backup
 *
 * Every backup used to mint its own 12 words and show them once. That is
 * defensible for a single archive and indefensible as a habit: a member who
 * backs up weekly ends up with a drawer of phrases, no way to tell which opens
 * which file, and one lost slip of paper for every archive they failed to write
 * down. The words are also the *only* way in — losing the pairing loses the data
 * just as completely as losing the file.
 *
 * Scheduled backups had already worked this out (nobody is watching an
 * unattended run, so a per-run phrase would seal archives nothing could ever
 * open) and kept one phrase in the keychain. Manual backups kept minting. So the
 * same device held a stable phrase for its automatic archives and a fresh one
 * per manual archive, and the Backup screen's "Recovery phrase → Show" row told
 * the truth about only half of them.
 *
 * This module is that one phrase, for both. It is minted the first time anything
 * needs it — a manual backup, enabling automatic backup, or simply looking at it
 * — kept in the device keychain from then on, and reused by every backup
 * afterwards until the member deliberately replaces it (`rotate…` below).
 *
 * ## The trade-off, stated plainly
 *
 * One phrase means one secret opens every archive this device has ever written.
 * That is a real widening compared with per-archive phrases, and it is the same
 * trade auto-backup already made. It buys the only property that makes backups
 * work in practice: a member who wrote the words down once is covered forever,
 * instead of being covered for exactly the one archive whose slip they can find.
 * `rotateBudgetBackupPhrase` is the revocation half — a member who thinks the
 * words leaked can retire them for everything written from that point on.
 *
 * ## Why it is not in `autoBackup.ts`
 *
 * It was, and `backupTaskStore` (the manual path) cannot import that module:
 * `autoBackup` imports the task store to announce its runs, so the phrase living
 * there would close a require cycle and leave one of the two half-initialised.
 * A module that depends on neither is what both can share.
 */

/**
 * Keychain, not AsyncStorage — this phrase opens every archive on the device.
 *
 * The key keeps its original `autoPhrase` name even though the phrase is no
 * longer only automatic backup's. Renaming it would strand the phrase every
 * shipped install already has, and with it every archive sealed under those
 * words. The name is history; the value is the device's.
 */
const PHRASE_KEY = 'budget.backup.autoPhrase';

/**
 * SecureStore rejects any key outside `[A-Za-z0-9._-]` — it throws rather than
 * degrading — so the keychain half cannot use the `:` separator the
 * AsyncStorage half does. Household ids are `hh_local_<hex>` and already fit;
 * anything a server might issue is folded to `_` rather than trusted.
 */
const perHouseholdPhraseKey = (householdId: string) =>
  `${PHRASE_KEY}.${householdId.replace(/[^A-Za-z0-9._-]+/g, '_')}`;

/**
 * The households a BR-016 fold-back should consider, active first.
 *
 * Order matters: with several per-household values there is no single right
 * answer to "what was the device's", and the active household — the one the
 * member is actually looking at and whose settings screen they last touched — is
 * the least surprising choice.
 *
 * Exported because `autoBackup.ts` folds the per-household SETTINGS back the
 * same way and must consider the same households in the same order; two copies
 * of this would be two chances to disagree about which household won.
 */
export function perHouseholdFoldCandidates(): string[] {
  const active = getActiveBudgetHouseholdId();
  const held = listLocalBudgetHouseholds().map((entry) => entry.householdId);
  return active ? [active, ...held.filter((id) => id !== active)] : held;
}

/**
 * Fold a per-household phrase back into the device-level slot.
 *
 * Unlike the settings, the OTHER households' phrases are deliberately left in
 * the keychain. Each of them still opens archives that household wrote, and
 * deleting one would strand those files permanently — the member has no other
 * copy of those words unless they wrote them down. They are dead weight; a
 * stranded archive is a loss.
 */
async function adoptPerHouseholdPhrase(): Promise<string | null> {
  for (const householdId of perHouseholdFoldCandidates()) {
    try {
      const found = await SecureStore.getItemAsync(perHouseholdPhraseKey(householdId));
      if (found) {
        await SecureStore.setItemAsync(PHRASE_KEY, found);
        return found;
      }
    } catch {
      // Keychain reads can fail on a locked device; try the next household.
    }
  }
  return null;
}

/**
 * The stored phrase, or null when this device has never minted one.
 *
 * Read-only on purpose: a caller that only wants to *report* the phrase (the
 * status card, a scheduled run deciding whether it may proceed) must not mint
 * one as a side effect. Minting is `ensureBudgetBackupPhrase`.
 */
export async function getBudgetBackupPhrase(): Promise<string | null> {
  try {
    const own = await SecureStore.getItemAsync(PHRASE_KEY);
    if (own) return own;
    return await adoptPerHouseholdPhrase();
  } catch {
    return null;
  }
}

export type BudgetBackupPhrase = {
  phrase: string;
  /**
   * True only when this call minted it. The Backup screen shows the words
   * unprompted exactly then — afterwards they are always one tap away on the
   * "Recovery phrase" row, and a sheet over every backup would be noise.
   */
  created: boolean;
};

/**
 * The device's phrase, minting and storing one on first use.
 *
 * Every path that seals an archive goes through here, which is what makes "one
 * phrase opens all of them" true rather than aspirational.
 */
export async function ensureBudgetBackupPhrase(): Promise<BudgetBackupPhrase> {
  const existing = await getBudgetBackupPhrase();
  // Deliberately NOT validated before reuse. A stored value that fails BIP39
  // could never have sealed anything, so replacing it would cost nothing — but
  // nothing writes this key except `generateRecoveryPhrase`, and a validator
  // that ever returned a false negative would silently retire the words the
  // member wrote down and strand every archive they open. An unreachable
  // failure is not worth that.
  if (existing) return { phrase: existing, created: false };

  const phrase = generateRecoveryPhrase();
  await SecureStore.setItemAsync(PHRASE_KEY, phrase);
  return { phrase, created: true };
}

/**
 * Retire the current phrase and mint its replacement.
 *
 * The revocation half of "created once, reused forever". Archives already
 * written keep the OLD words — nothing can re-seal a file that has left the
 * device — so the caller has to say so before it calls this. Overwriting the
 * keychain entry is the whole operation: the previous phrase is gone from this
 * device the moment it returns, and only the member's own copy can open what it
 * sealed.
 */
export async function rotateBudgetBackupPhrase(): Promise<string> {
  const phrase = generateRecoveryPhrase();
  await SecureStore.setItemAsync(PHRASE_KEY, phrase);
  return phrase;
}
