import AsyncStorage from '@react-native-async-storage/async-storage';

import { getActiveHouseholdId, listLocalHouseProperties } from '../engine';

import { HOUSE_ALL_HOMES_ID, isAllHomesTarget } from './allHomes';
import type { HouseBackupDestination } from './backupDestinations';

/**
 * House V2 — the last backup this app actually saw finish, and where it went.
 *
 * Ported from `budget/local/backup/backupHistory.ts`.
 *
 * ## Why a record separate from the schedule's `lastRunAt`
 *
 * The Backup screen's status card answers one question: *is my home recoverable
 * right now?* Answering it from `autoSettings.lastRunAt` alone reads a record of
 * an EVENT, not of a copy that still exists. Those drift apart in both
 * directions:
 *
 *  - A scheduled run wrote an archive to this device, and the archive was later
 *    deleted — from the list on the screen, or from Files. The timestamp stays,
 *    so the card keeps saying "Protected · Last backup today" over a list
 *    reading "No backups on this device yet".
 *  - A manual backup to Drive leaves no trace at all — `lastRunAt` belongs to
 *    the scheduler — so a member who had just uploaded one is told "No backup
 *    yet".
 *
 * So both paths record here, and the destination rides along: it is what tells
 * the card whether the evidence can be re-checked (an on-device archive proves
 * itself by still being there) or has to be taken on trust (bytes that left the
 * phone cannot be listed from a status card).
 *
 * ## Why the record is per property (Q15 / H5)
 *
 * One record for three homes answers the card's question for the wrong home. A
 * member who backs up the house every week and has never once backed up the
 * cabin would be told "Protected · Last backup today" on both, because a single
 * key knows only that *a* backup happened somewhere. That is not a display bug
 * — it is a data-loss surface wearing a reassuring label.
 */

export type HouseBackupEventKind = 'manual' | 'scheduled';

export type HouseBackupEvent = {
  /** ISO timestamp of the write. */
  at: string;
  destination: HouseBackupDestination;
  kind: HouseBackupEventKind;
  /** Archive name, when the destination gave one back. Display only. */
  fileName: string | null;
  /**
   * Which home was written. Optional on the way IN — a caller that only ever
   * backs up what is on screen is describing the active property and need not
   * say so — but always stored, so a record can never be read as another home's
   * evidence.
   */
  householdId?: string;
};

const LAST_SUCCESS_KEY_PREFIX = 'house.backup.lastSuccess';

const lastSuccessKeyFor = (householdId: string) => `${LAST_SUCCESS_KEY_PREFIX}:${householdId}`;

/**
 * True when the archive lives in the app's own folder, where the screen can
 * confirm it — anything else left the phone and can only be taken on trust.
 */
export function backupEvidenceIsLocal(destination: HouseBackupDestination): boolean {
  return destination === 'device';
}

function parseEvent(raw: string, householdId: string): HouseBackupEvent | null {
  const parsed = JSON.parse(raw) as Partial<HouseBackupEvent>;
  if (!parsed.at || !parsed.destination) return null;
  return {
    at: parsed.at,
    destination: parsed.destination,
    kind: parsed.kind === 'manual' ? 'manual' : 'scheduled',
    fileName: parsed.fileName ?? null,
    householdId: parsed.householdId ?? householdId,
  };
}

async function readEvent(householdId: string): Promise<HouseBackupEvent | null> {
  try {
    const raw = await AsyncStorage.getItem(lastSuccessKeyFor(householdId));
    return raw ? parseEvent(raw, householdId) : null;
  } catch {
    return null;
  }
}

/**
 * The last backup written for one home. Defaults to the active one, which is
 * what the Backup screen is always looking at.
 *
 * **A whole-device backup counts as this home's**, because it contains this
 * home. Its record is filed under `HOUSE_ALL_HOMES_ID`, so a member who backs
 * every home up in one file would otherwise be told "No backup yet" on all three
 * — a status card that is not merely unhelpful but actively wrong, and one that
 * would push them into making backups they already have. The newer of the two
 * records wins, so a home backed up on its own since the whole-device run still
 * reports the more recent fact.
 */
export async function getLastHouseBackupEvent(
  householdId?: string,
): Promise<HouseBackupEvent | null> {
  const target = householdId ?? getActiveHouseholdId();
  // No property means no session, and a record can only be about a property.
  if (!target) return null;
  const own = await readEvent(target);
  if (isAllHomesTarget(target)) return own;
  const allHomes = await readEvent(HOUSE_ALL_HOMES_ID);
  if (!allHomes) return own;
  if (!own) return allHomes;
  return Date.parse(allHomes.at) > Date.parse(own.at) ? allHomes : own;
}

export type HousePropertyBackupEvent = {
  householdId: string;
  propertyName: string;
  /** Null when nothing has ever been written for this home. */
  event: HouseBackupEvent | null;
};

/**
 * Every property on this device with its last backup — the honest answer to
 * "am I covered", now that the answer differs per home.
 *
 * Sequential rather than `Promise.all`: the list is at most three (H5), and a
 * serial walk keeps the reads from racing each other over the same keys.
 */
export async function listHouseBackupEvents(): Promise<HousePropertyBackupEvent[]> {
  const out: HousePropertyBackupEvent[] = [];
  for (const property of listLocalHouseProperties()) {
    out.push({
      householdId: property.householdId,
      propertyName: property.name.trim() || 'Home',
      event: await getLastHouseBackupEvent(property.householdId),
    });
  }
  return out;
}

/**
 * Remember a backup that was written, against the home it holds.
 *
 * Call this ONLY for a `saved` outcome. A `shared` one (iOS "Files app", and
 * every share-sheet destination) is not evidence of anything:
 * `Sharing.shareAsync` resolves the same whether the member saved the file or
 * swiped the sheet away, so recording it would let a dismissed sheet claim
 * "Protected".
 *
 * Never throws: a backup that succeeded must not be reported as failed because
 * the bookkeeping afterwards did not.
 */
export async function recordHouseBackupSuccess(
  event: HouseBackupEvent,
  householdId?: string,
): Promise<void> {
  const target = householdId ?? event.householdId ?? getActiveHouseholdId();
  if (!target) {
    // Unattributable, so unrecordable. Writing it device-wide would show up as
    // another home's protection.
    console.warn('[house-backup] no property to record this backup against');
    return;
  }
  try {
    await AsyncStorage.setItem(
      lastSuccessKeyFor(target),
      JSON.stringify({ ...event, householdId: target }),
    );
  } catch (error) {
    console.warn('[house-backup] could not record the last backup', error);
  }
}

export async function forgetLastHouseBackupEvent(householdId?: string): Promise<void> {
  const target = householdId ?? getActiveHouseholdId();
  if (!target) return;
  await AsyncStorage.removeItem(lastSuccessKeyFor(target)).catch(() => undefined);
}
