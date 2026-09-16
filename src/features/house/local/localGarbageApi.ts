/**
 * Local counterpart of `src/api/garbage-collection.ts` (9 methods) — Stage H3.
 *
 * This module straddles two tiers, which is exactly why `localApiProxy.ts`
 * carries a `remoteMethods` list at all:
 *
 *  - **Tier A (local).** `garbage_schedules` is the member's own row — which
 *    streams, which day, what time the bins go out. It is in the ledger, so
 *    `getSchedule` / `createSchedule` / `updateSchedule` / `updateReminders`
 *    and the date expansion behind `getNextCollections` all work offline.
 *  - **Tier C (remote by design, plan §1.2).** `getMunicipalities`,
 *    `getMunicipality` and `getWasteRegulations` read `municipality_configs` —
 *    global reference data shared by every household, fetched over HTTP and
 *    cached, never ledgered and never synced. They are deliberately ABSENT from
 *    this object and named in `HOUSE_LOCAL_GARBAGE_REMOTE_METHODS`, so the
 *    Proxy passes them through as a decision in the code rather than as the
 *    absence of one.
 *  - **H7 (unsupported).** `aiDetect` runs several grounded web searches on the
 *    Worker and is an AI Housekeeper surface. It throws
 *    `HouseLocalUnsupportedError` — never silently falls through, because a
 *    local-first household has no server-side rows to detect against.
 *
 * Behaviour is ported from `backend/src/services/garbage-collection-service.ts`
 * (get-or-create, the create→update upsert, the reminder split) and the date
 * expansion lives in `./logic/garbageSchedule.ts`.
 */
// Polyfill before the engine / @symply/local-first graph loads (@noble captures
// globalThis.crypto at module load) — plan §6.1.
import './cryptoPolyfill';

import type {
  CollectionDate,
  CustomReminder,
  GarbageSchedule,
  GarbageScheduleType,
  garbageCollectionApi,
} from '@api/garbage-collection';

import { HouseLocalUnsupportedError } from './errors';
import { isoNow, newLocalId } from './ids';
import { ledger, nowIso, rowsOf, writeLocal } from './localWrite';
import { DEFAULT_COLLECTION_DAYS_AHEAD, expandCollectionDates } from './logic/garbageSchedule';

/**
 * Tier-C reference reads that stay on the server (plan §1.2). Typed against the
 * remote module's keys so renaming a method there fails this file rather than
 * quietly dropping a name out of the list.
 */
export const HOUSE_LOCAL_GARBAGE_REMOTE_METHODS = [
  'getMunicipalities',
  'getMunicipality',
  'getWasteRegulations',
] as const satisfies ReadonlyArray<keyof typeof garbageCollectionApi>;

/** Column defaults from `garbage-collection-service.ts:173-190`. */
const DEFAULT_SET_OUT_TIME = '19:00';
const DEFAULT_COLLECTION_START_TIME = '07:00';
const DEFAULT_REMOVE_BY_TIME = '19:00';

function defaultReminders(): NonNullable<GarbageSchedule['reminders']> {
  return {
    nightBefore: { enabled: true, time: '19:00' },
    morningOf: { enabled: false, time: '07:00' },
  };
}

export type LocalGarbageScheduleInput = {
  municipality: string;
  schedules: GarbageScheduleType[];
  set_out_time?: string;
  collection_start_time?: string;
  remove_by_time?: string;
  holiday_shifts?: GarbageSchedule['holiday_shifts'];
  reminders?: GarbageSchedule['reminders'];
  source?: GarbageSchedule['source'];
};

/**
 * The household's active schedule, newest first.
 *
 * The ordering is not cosmetic: it is `garbage-collection-service.ts:96-98`
 * verbatim ("if a household ended up with duplicate rows … return the most
 * recently saved one"). Locally the duplicate risk is worse than on the server,
 * because `garbage_schedules` is not in `HOUSE_DETERMINISTIC_ID_TABLES` — two
 * devices that both open the Garbage tab offline each mint a row and both
 * survive the merge. Newest-wins keeps the member on the row they last saved.
 */
function schedulesOf(householdId: string): GarbageSchedule[] {
  return rowsOf<GarbageSchedule>('garbageSchedules')
    .filter((row) => row.household_id === householdId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function requireSchedule(householdId: string, scheduleId: string): GarbageSchedule {
  const found = schedulesOf(householdId).find((row) => row.id === scheduleId);
  if (!found) throw new Error('Garbage schedule not found');
  return found;
}

/**
 * The municipality an auto-created row starts with.
 *
 * The Worker canonicalizes the property's city against the
 * `municipality_configs` catalogue (`MunicipalityService.detectMunicipality`)
 * and falls back to 'Vancouver'. The catalogue is Tier C, so on device we have
 * the raw city string and nothing to match it against — the value is a
 * placeholder the member's first save through the editor replaces, and the
 * server's own fallback is kept so an empty property row behaves identically.
 */
function inferMunicipality(): string {
  const city = ledger().household.city;
  return city && city.trim() ? city.trim() : 'Vancouver';
}

function buildScheduleRow(
  householdId: string,
  input: LocalGarbageScheduleInput,
  timestamp: string,
): GarbageSchedule {
  return {
    id: newLocalId('gsch'),
    household_id: householdId,
    municipality: input.municipality,
    schedules: input.schedules,
    set_out_time: input.set_out_time ?? DEFAULT_SET_OUT_TIME,
    collection_start_time: input.collection_start_time ?? DEFAULT_COLLECTION_START_TIME,
    remove_by_time: input.remove_by_time ?? DEFAULT_REMOVE_BY_TIME,
    holiday_shifts: input.holiday_shifts ?? [],
    reminders: input.reminders ?? defaultReminders(),
    source: input.source ?? 'manual',
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * Apply a partial update in place — shared by `updateSchedule` and by
 * `createSchedule`'s upsert branch so the two cannot drift.
 */
function applyScheduleInput(
  row: GarbageSchedule,
  input: Partial<LocalGarbageScheduleInput>,
  timestamp: string,
): void {
  if (input.municipality !== undefined) row.municipality = input.municipality;
  if (input.schedules !== undefined) row.schedules = input.schedules;
  if (input.set_out_time !== undefined) row.set_out_time = input.set_out_time;
  if (input.collection_start_time !== undefined) {
    row.collection_start_time = input.collection_start_time;
  }
  if (input.remove_by_time !== undefined) row.remove_by_time = input.remove_by_time;
  if (input.holiday_shifts !== undefined) row.holiday_shifts = input.holiday_shifts;
  if (input.reminders !== undefined) row.reminders = input.reminders;
  if (input.source !== undefined) row.source = input.source;
  row.updated_at = timestamp;
}

export const localGarbageApi = {
  /**
   * GET /households/:id/garbage-collection.
   *
   * Get-OR-CREATE, like `getOrCreateSchedule`. It looks wrong for a read to
   * write, but every caller depends on it: `useGarbageSummary` and both garbage
   * screens immediately use `schedule.id` to ask for collection dates, so a
   * household that has never opened the tab must still come back with a row.
   *
   * Scheduling the reminder notifications that the Worker fires here has no
   * local equivalent — notification DELIVERY is Tier B (the server must send
   * while the app is closed) and on-device rolling-horizon reminders are the
   * H7-lite item in the DoD.
   */
  getSchedule: async (householdId: string): Promise<{ schedule: GarbageSchedule }> => {
    const existing = schedulesOf(householdId)[0];
    if (existing) return { schedule: existing };

    return localGarbageApi.createSchedule(householdId, {
      municipality: inferMunicipality(),
      schedules: [],
      reminders: defaultReminders(),
    });
  },

  /**
   * POST /households/:id/garbage-collection.
   *
   * Upsert, not insert. A household has at most ONE active schedule and
   * `getSchedule` auto-creates an empty row on first view, so a plain insert
   * would leave the stale empty row behind and reads (which return one row)
   * could surface it — the exact bug the service comments at :150-153.
   */
  createSchedule: async (
    householdId: string,
    data: LocalGarbageScheduleInput,
  ): Promise<{ schedule: GarbageSchedule }> => {
    const existing = schedulesOf(householdId)[0];
    if (existing) {
      return localGarbageApi.updateSchedule(householdId, existing.id, data);
    }

    const timestamp = isoNow();
    const schedule = buildScheduleRow(householdId, data, timestamp);
    await writeLocal(
      (draft) => {
        draft.garbageSchedules.push(schedule);
      },
      {
        opType: 'GARBAGE_SCHEDULE_CREATE',
        entityType: 'garbageSchedule',
        entityId: schedule.id,
        payload: { household_id: householdId, municipality: schedule.municipality },
      },
    );
    return { schedule };
  },

  /** PATCH /households/:id/garbage-collection/:scheduleId */
  updateSchedule: async (
    householdId: string,
    scheduleId: string,
    data: Partial<LocalGarbageScheduleInput>,
  ): Promise<{ schedule: GarbageSchedule }> => {
    requireSchedule(householdId, scheduleId);
    const timestamp = isoNow();
    let updated: GarbageSchedule | undefined;

    await writeLocal(
      (draft) => {
        const row = draft.garbageSchedules.find(
          (candidate) => candidate.id === scheduleId && candidate.household_id === householdId,
        );
        if (!row) throw new Error('Garbage schedule not found');
        applyScheduleInput(row, data, timestamp);
        updated = { ...row };
      },
      {
        opType: 'GARBAGE_SCHEDULE_UPDATE',
        entityType: 'garbageSchedule',
        entityId: scheduleId,
        payload: { household_id: householdId },
      },
    );

    return { schedule: updated! };
  },

  /**
   * GET /households/:id/garbage-collection/:scheduleId/next-collections.
   *
   * Pure computation over a ledger row — see `./logic/garbageSchedule.ts` for
   * the port and for the two documented differences from the Worker.
   */
  getNextCollections: async (
    householdId: string,
    scheduleId: string,
    days: number = DEFAULT_COLLECTION_DAYS_AHEAD,
  ): Promise<{ dates: CollectionDate[] }> => {
    const schedule = requireSchedule(householdId, scheduleId);
    return { dates: expandCollectionDates(schedule.schedules, days) };
  },

  /**
   * POST /households/:id/garbage-collection/ai-detect — Stage H7.
   *
   * Web-search-grounded detection is an AI Housekeeper surface: it runs several
   * queries server-side and reads the property's address from server state.
   * Neither exists on device today, so this is honest-unavailable rather than a
   * silent server round-trip for a household the server has no rows for.
   */
  aiDetect: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('garbage-collection.aiDetect');
  },

  /**
   * PATCH /households/:id/garbage-collection/:scheduleId/reminders.
   *
   * The screen sends one flat list; the row stores two named presets plus a
   * custom array. The split is `garbage-collection-service.ts:310-323`: an
   * absent preset keeps whatever the row already had, and an empty custom list
   * is stored as `undefined` rather than `[]`.
   */
  updateReminders: async (
    householdId: string,
    scheduleId: string,
    reminders: CustomReminder[],
  ): Promise<{ schedule: GarbageSchedule }> => {
    const current = requireSchedule(householdId, scheduleId);
    const currentReminders = current.reminders ?? defaultReminders();

    const nightBefore = reminders.find((entry) => entry.type === 'evening_before');
    const morningOf = reminders.find((entry) => entry.type === 'morning_of');
    const custom = reminders.filter((entry) => entry.type === 'custom');

    const timestamp = nowIso();
    let updated: GarbageSchedule | undefined;

    await writeLocal(
      (draft) => {
        const row = draft.garbageSchedules.find(
          (candidate) => candidate.id === scheduleId && candidate.household_id === householdId,
        );
        if (!row) throw new Error('Garbage schedule not found');
        row.reminders = {
          nightBefore: nightBefore
            ? { enabled: nightBefore.enabled, time: nightBefore.time }
            : currentReminders.nightBefore,
          morningOf: morningOf
            ? { enabled: morningOf.enabled, time: morningOf.time }
            : currentReminders.morningOf,
          custom: custom.length > 0 ? custom : undefined,
        };
        row.updated_at = timestamp;
        updated = { ...row };
      },
      {
        opType: 'GARBAGE_REMINDERS_UPDATE',
        entityType: 'garbageSchedule',
        entityId: scheduleId,
        payload: { count: reminders.length },
      },
    );

    return { schedule: updated! };
  },
};
