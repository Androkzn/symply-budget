import { asyncStorage } from '@services/storage';
import { useBudgetStore } from '@stores/budgetStore';

import { resetLocalBudgetSession } from './engine';
import { ensureBudgetLocalSession } from './ensureSession';
import {
  listArchivedLocalBudgetLedgers,
  purgeArchivedLocalBudgetLedgers,
  type ArchivedLocalLedger,
  type PurgedArchivedLedgers,
} from './persistence';
import { RECEIPT_ALIASES_KEY } from './receiptAliases';

/**
 * Budget V2 — the Danger Zone's two operations.
 *
 * Local-first means this phone is the system of record: nothing here can be
 * re-fetched from a server afterwards. Both operations are therefore explicit,
 * confirmed by the member in the UI, and deliberately narrow about what they
 * touch — see `eraseLocalBudgetData` for the list of things that survive.
 */

/** Retired ledgers destroyed, and the disk that came back with them. */
export type LocalBudgetCleanupResult = PurgedArchivedLedgers;

export type { ArchivedLocalLedger };

/**
 * Ledgers left on this device by accounts that signed out of it.
 *
 * An account switch retires the outgoing member's ledger instead of shredding
 * it (see `archiveLocalBudgetPersistence`), which is the right default and also
 * means a shared/handed-down phone accumulates other people's encrypted budgets
 * with no way to see or remove them. This is that way.
 */
export function getPreviousLocalBudgetData(): Promise<ArchivedLocalLedger[]> {
  return listArchivedLocalBudgetLedgers();
}

/**
 * Delete the retired ledgers and their keys. The current budget is untouched.
 */
export function cleanUpPreviousLocalBudgetData(): Promise<LocalBudgetCleanupResult> {
  return purgeArchivedLocalBudgetLedgers();
}

/**
 * Erase everything Budget keeps on this device and start from an empty ledger.
 *
 * Removed: the encrypted ledger (categories, expenses, plans, savings, debts,
 * wishes, history), its device key, the retired ledgers above, the receipt
 * merchant→category memory, and the cached AI insights derived from all of it.
 *
 * Deliberately KEPT:
 *  • saved backups, on this device and in the cloud — this is the escape hatch,
 *    and erasing the live copy must not also destroy the only way back;
 *  • the phrases that open them (`budget.backup.autoPhrase` and the remembered
 *    restore phrase), which live in the Keychain. Deleting those would leave
 *    archives that exist and can never be decrypted, which is worse than
 *    deleting the archives outright.
 *
 * A fresh empty household is minted before returning, so the Budget screens
 * always have a ledger to render rather than throwing on `requireEngine()`.
 * The household the device previously belonged to is not left on the control
 * plane by this call — server-side membership is ended by revoking the device
 * from the household, not by wiping the phone.
 */
export async function eraseLocalBudgetData(): Promise<LocalBudgetCleanupResult> {
  // Before the reset: the wipe below mints a new ledger, and anything still
  // sitting in the SQLite directory after that is exactly the "previous data"
  // the member asked to be rid of.
  const purged = await cleanUpPreviousLocalBudgetData();

  // Closes the engine, then deletes the database, the DEK and the legacy
  // snapshot keys.
  await resetLocalBudgetSession();

  await asyncStorage.removeItem(RECEIPT_ALIASES_KEY);
  // Cached insights are sentences about the spending that no longer exists.
  useBudgetStore.getState().reset();

  // Mints an empty household, repoints householdStore at it, and re-syncs
  // reminders — which cancels every notification scheduled for erased rows.
  await ensureBudgetLocalSession();

  return purged;
}
