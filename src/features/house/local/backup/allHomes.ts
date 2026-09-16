/**
 * The identity of a WHOLE-DEVICE backup: one file holding every home the member
 * has on this phone, each in its own section.
 *
 * ## Why this is a module of its own
 *
 * Every per-home surface in the backup feature is already keyed by household id
 * — the auto-backup settings blob, the keychain phrase, the archive file-name
 * token, the "last backup" record, the retention sweep, the restore-phrase
 * memory. Giving "all homes" an id of its own lets it travel all of those
 * unchanged instead of growing a parallel set of device-level ones.
 *
 * That makes the id a leaf dependency of nearly the whole folder, and it must
 * stay one. Reading it from `houseBackup.ts` would drag Argon2id, the document
 * picker and the file system into `backupHistory.ts` — and, more immediately,
 * would break every suite that mocks `houseBackup` down to the one function it
 * exercises. `houseBackup.ts` re-exports these three names, so nothing outside
 * this folder has to know the split exists.
 *
 * ## Why `all-homes` cannot collide with a real property
 *
 * Local properties are minted as `hh_local_<hex>` (`engine.createLocalHouseProperty`)
 * and server-issued ones are `hh_`-prefixed too. Nothing in the system produces
 * a bare `all-homes`, and the value is also what appears in an archive's
 * cleartext `meta.householdId`, where it says "several homes are in here"
 * without saying which — deliberately, since which homes a member has is not
 * something a file sitting in their Drive should announce.
 */

export const HOUSE_ALL_HOMES_ID = 'all-homes';

export const HOUSE_ALL_HOMES_LABEL = 'All homes';

/** True for the pseudo-household that means "every home on this device". */
export function isAllHomesTarget(householdId: string | null | undefined): boolean {
  return householdId === HOUSE_ALL_HOMES_ID;
}
