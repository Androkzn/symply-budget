import AsyncStorage from '@react-native-async-storage/async-storage';

import { getActiveBudgetHouseholdId, listLocalBudgetHouseholds } from '../engine';

import type { BudgetBackupDestination } from './backupDestinations';

/**
 * Budget V2 — the last backup this app actually saw finish, and where it went.
 *
 * ## Why a record separate from the schedule's `lastRunAt`
 *
 * The Backup screen's status card answers one question: *is my budget
 * recoverable right now?* It used to answer it from `autoSettings.lastRunAt`
 * alone, which is a record of an EVENT, not of a copy that still exists. Those
 * drift apart in both directions:
 *
 *  - A scheduled run wrote an archive to this device, and the archive was later
 *    deleted — from the list on the screen, or from Files. The timestamp stayed,
 *    so the card kept saying "Protected · Last backup today" over a list reading
 *    "No backups on this device yet". That contradiction is what this module
 *    exists to end.
 *  - A manual backup to Drive left no trace at all — `lastRunAt` belongs to the
 *    scheduler — so a member who had just uploaded one was told "No backup yet".
 *
 * So both paths record here, and the destination rides along: it is what tells
 * the card whether the evidence can be re-checked (an on-device archive proves
 * itself by still being there) or has to be taken on trust (bytes that left the
 * phone cannot be listed from a status card).
 *
 * Only outcomes we can honestly call written are recorded — see
 * `recordBudgetBackupSuccess`.
 *
 * ## Why the record is per household (BR-016)
 *
 * One record for N households answers the card's question for the wrong budget.
 * A member who backs up their main household every week and has never once
 * backed up the holiday one was told "Protected · Last backup today" on both,
 * because the single key knew only that *a* backup had happened somewhere. That
 * is not a display bug — it is a data-loss surface wearing a reassuring label,
 * and it is the reason a household can be lost while looking safe.
 */

export type BudgetBackupEventKind = 'manual' | 'scheduled';

export type BudgetBackupEvent = {
  /** ISO timestamp of the write. */
  at: string;
  destination: BudgetBackupDestination;
  kind: BudgetBackupEventKind;
  /** Archive name, when the destination gave one back. Display only. */
  fileName: string | null;
  /**
   * Whose budget was written. Optional on the way IN — a caller that only ever
   * backs up what is on screen is describing the active household and need not
   * say so — but always stored, so a record can never be read as another
   * household's evidence.
   */
  householdId?: string;
};

/**
 * Pre-BR-016 key: one record for the whole device. Still read once, to be
 * adopted by the household it must have belonged to — see `adoptLegacyEvent`.
 */
const LEGACY_LAST_SUCCESS_KEY = 'budget.backup.lastSuccess';

const lastSuccessKeyFor = (householdId: string) =>
  `${LEGACY_LAST_SUCCESS_KEY}:${householdId}`;

/**
 * True when the archive lives in the app's own folder, where the screen can
 * confirm it — anything else left the phone and can only be taken on trust.
 */
export function backupEvidenceIsLocal(destination: BudgetBackupDestination): boolean {
  return destination === 'device';
}

function parseEvent(raw: string, householdId: string): BudgetBackupEvent | null {
  const parsed = JSON.parse(raw) as Partial<BudgetBackupEvent>;
  if (!parsed.at || !parsed.destination) return null;
  return {
    at: parsed.at,
    destination: parsed.destination,
    kind: parsed.kind === 'manual' ? 'manual' : 'scheduled',
    fileName: parsed.fileName ?? null,
    householdId: parsed.householdId ?? householdId,
  };
}

/**
 * Move the pre-BR-016 device-wide record onto the household it described.
 *
 * Only when this device holds exactly one household, which is the state every
 * install upgrading into BR-016 is in: there is then precisely one household
 * the old record could have been about. With two or more the inference is gone
 * and the record is left alone rather than guessed at — a wrong attribution
 * would tell a member a household is protected when nothing ever backed it up,
 * which is worse than the one-off "No backup yet" that ignoring it costs.
 *
 * Best-effort throughout: this is bookkeeping, and no read of it may throw.
 */
async function adoptLegacyEvent(householdId: string): Promise<BudgetBackupEvent | null> {
  const only = listLocalBudgetHouseholds();
  if (only.length !== 1 || only[0].householdId !== householdId) return null;
  try {
    const raw = await AsyncStorage.getItem(LEGACY_LAST_SUCCESS_KEY);
    if (!raw) return null;
    const event = parseEvent(raw, householdId);
    if (!event) return null;
    await AsyncStorage.setItem(lastSuccessKeyFor(householdId), JSON.stringify(event));
    await AsyncStorage.removeItem(LEGACY_LAST_SUCCESS_KEY);
    return event;
  } catch {
    return null;
  }
}

/**
 * The last backup written for one household. Defaults to the active one, which
 * is what the Backup screen is always looking at.
 */
export async function getLastBudgetBackupEvent(
  householdId?: string,
): Promise<BudgetBackupEvent | null> {
  const target = householdId ?? getActiveBudgetHouseholdId();
  // No household means no session, and a record can only be about a household.
  // Claiming the device-wide legacy one here would attach it to whichever
  // household happens to open next.
  if (!target) return null;
  try {
    const raw = await AsyncStorage.getItem(lastSuccessKeyFor(target));
    if (raw) return parseEvent(raw, target);
    return await adoptLegacyEvent(target);
  } catch {
    return null;
  }
}

export type BudgetHouseholdBackupEvent = {
  householdId: string;
  householdName: string;
  /** Null when nothing has ever been written for this household. */
  event: BudgetBackupEvent | null;
};

/**
 * Every household on this device with its last backup — the honest answer to
 * "am I covered", now that the answer differs per household.
 *
 * Sequential rather than `Promise.all`: the list is small (a member holds a
 * handful of households, not hundreds) and a serial walk keeps the legacy
 * adoption above from racing itself over the same two keys.
 */
export async function listBudgetBackupEvents(): Promise<BudgetHouseholdBackupEvent[]> {
  const out: BudgetHouseholdBackupEvent[] = [];
  for (const household of listLocalBudgetHouseholds()) {
    out.push({
      householdId: household.householdId,
      householdName: household.name.trim() || 'Household',
      event: await getLastBudgetBackupEvent(household.householdId),
    });
  }
  return out;
}

/**
 * Remember a backup that was written, against the household it holds.
 *
 * Call this ONLY for a `saved` outcome. A `shared` one (iOS "Files app", and
 * every share-sheet destination) is not evidence of anything: `Sharing.shareAsync`
 * resolves the same whether the member saved the file or swiped the sheet away,
 * so recording it would let a dismissed sheet claim "Protected" — the exact
 * over-claim this record was added to stop.
 *
 * `householdId` may come from the argument, from the event, or — for a manual
 * backup started from a screen, which can only ever be backing up what is in
 * front of the member — from the active session.
 *
 * Never throws: a backup that succeeded must not be reported as failed because
 * the bookkeeping afterwards did not.
 */
export async function recordBudgetBackupSuccess(
  event: BudgetBackupEvent,
  householdId?: string,
): Promise<void> {
  const target = householdId ?? event.householdId ?? getActiveBudgetHouseholdId();
  if (!target) {
    // Unattributable, so unrecordable. Writing it device-wide is what BR-016
    // removed: it would show up as another household's protection.
    console.warn('[budget-backup] no household to record this backup against');
    return;
  }
  try {
    await AsyncStorage.setItem(
      lastSuccessKeyFor(target),
      JSON.stringify({ ...event, householdId: target }),
    );
  } catch (error) {
    console.warn('[budget-backup] could not record the last backup', error);
  }
}

/**
 * Record one written file against every household inside it.
 *
 * A bundle protects all of them, so attributing it to one would leave the others
 * showing "No backup yet" over data that is sitting in the same file — the same
 * class of lie as the pre-BR-016 device-wide record, just pointing the other
 * way. The per-household record itself stays: "is THIS budget recoverable" is
 * still the question the status card answers.
 *
 * Falls back to the active household when the caller has no list, which is the
 * legacy single-archive shape.
 */
export async function recordBudgetBackupSuccessFor(
  householdIds: string[],
  event: Omit<BudgetBackupEvent, 'householdId'>,
): Promise<void> {
  const targets = householdIds.length > 0 ? householdIds : [getActiveBudgetHouseholdId()];
  for (const householdId of targets) {
    if (!householdId) continue;
    await recordBudgetBackupSuccess({ ...event, householdId }, householdId);
  }
}

export async function forgetLastBudgetBackupEvent(householdId?: string): Promise<void> {
  const target = householdId ?? getActiveBudgetHouseholdId();
  if (!target) return;
  await AsyncStorage.removeItem(lastSuccessKeyFor(target)).catch(() => undefined);
}
