/**
 * Local counterpart of `src/api/seasonal-checklists.ts` (6 methods) — Stage H3.
 *
 * `seasonalChecklists` and `seasonalChecklistItems` are both Tier A, so every
 * method is local and none throws `HouseLocalUnsupportedError`. The one thing
 * that stays remote is the *content* the items are made of: item bodies come
 * from the Tier-C template catalogue over HTTP (plan §1.2), which is why
 * generation takes seeds rather than inventing them — see
 * `logic/seasonalGeneration.ts`.
 *
 * THE SHAPE RULE THAT DRIVES THIS FILE. `LocalSeasonalChecklist` (types.ts:70)
 * is FLAT: no `items`, no `progress`, no stored `completed_at`. The remote DTO's
 * `items` and `progress` are joins and counts the server composed per request,
 * and storing them would give the same fact two homes in the ledger — LWW would
 * then converge the row and its own summary to different answers. Both are
 * composed here, at read time, from the item rows.
 *
 * WHY `getCurrent` CAN WRITE. The server's `/current` route is a find-or-create
 * (`getOrCreateChecklist`), so the GET creating a row is inherited behaviour,
 * not something the ledger introduced. What IS local-first is that a missing
 * year materializes all four seasons in one bulk write:
 * `SeasonalChecklistScreen` re-runs `getCurrent` on every season tap, and four
 * one-shell writes would be four full ledger captures and diffs (plan §3.3).
 */
import type { Season, SeasonalChecklist, SeasonalChecklistItem } from '@api/seasonal-checklists';

import { HouseLocalUnknownPropertyError } from './errors';
import { newLocalId } from './ids';
import {
  activeHouseholdId,
  nowIso,
  rowsOf,
  writeLocal,
  writeLocalBulk,
} from './localWrite';
import {
  DEFAULT_CLIMATE_ZONE,
  SEASONS_IN_ORDER,
  clampChecklistYear,
  generateSeasonalYear,
  seasonForDate,
  seasonalChecklistId,
  seasonalProgress,
  type SeasonalItemSeed,
} from './logic/seasonalGeneration';
import type { LocalSeasonalChecklist, LocalSeasonalChecklistItem } from './types';

/** `src/api/seasonal-checklists.ts:36 CreateChecklistRequest` — not exported. */
type CreateSeasonalChecklistInput = {
  season: Season;
  year: number;
  climate_zone?: string;
};

/** `src/api/seasonal-checklists.ts:42 AddItemRequest`. */
type AddItemInput = {
  task_template_id?: string;
  title: string;
  category?: string;
  sort_order?: number;
};

/** `src/api/seasonal-checklists.ts:49 UpdateItemRequest`. */
type UpdateItemInput = {
  is_completed?: boolean;
  notes?: string;
  photo_keys?: string[];
};

/** See the identical guard in `localChecklistsApi.ts` — silent-empty is worse. */
function requireActiveHousehold(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function checklistRows(): LocalSeasonalChecklist[] {
  return rowsOf<LocalSeasonalChecklist>('seasonalChecklists');
}

/** Items of one checklist, `order by sort_order` (`getChecklist` :149). */
function itemsOf(checklistId: string): LocalSeasonalChecklistItem[] {
  return rowsOf<LocalSeasonalChecklistItem>('seasonalChecklistItems')
    .filter((item) => item.checklist_id === checklistId)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id));
}

/** The DTO the screens read: flat row + the two derived views. */
function composeChecklist(checklist: LocalSeasonalChecklist): SeasonalChecklist {
  const items = itemsOf(checklist.id);
  return { ...checklist, items, progress: seasonalProgress(items) };
}

function findBySeasonYear(season: Season, year: number): LocalSeasonalChecklist | null {
  return (
    checklistRows().find(
      (checklist) => checklist.season === season && checklist.year === year,
    ) ?? null
  );
}

/**
 * Make sure the requested year exists, then hand back the requested season.
 *
 * `getOrCreateChecklist` (:48) looks up by (household, season, year) and creates
 * on a miss. The local version widens the miss to the whole year for the reason
 * in the header, and does nothing at all when the shell is already there — the
 * common case, since `defaults.ts` seeds four shells at household mint.
 */
async function ensureSeasonalYear(input: {
  householdId: string;
  year: number;
  climateZone: string;
  seeds?: readonly SeasonalItemSeed[];
}): Promise<void> {
  const existing = new Set(checklistRows().map((checklist) => checklist.id));
  const missingSeason = SEASONS_IN_ORDER.some(
    (season) => !existing.has(seasonalChecklistId(input.householdId, season, input.year)),
  );
  if (!missingSeason) return;

  const generated = generateSeasonalYear({
    householdId: input.householdId,
    year: input.year,
    climateZone: input.climateZone,
    seeds: input.seeds,
    now: nowIso(),
  });

  // Two tables, one op stream — the chunker packs by bytes and row count, so a
  // catalogue-sized year still lands in a couple of ops rather than one per row.
  type GeneratedRow =
    | { kind: 'checklist'; row: LocalSeasonalChecklist }
    | { kind: 'item'; row: LocalSeasonalChecklistItem };
  const rows: GeneratedRow[] = [
    ...generated.checklists.map((row) => ({ kind: 'checklist' as const, row })),
    ...generated.items.map((row) => ({ kind: 'item' as const, row })),
  ];

  await writeLocalBulk(
    rows,
    (draft, chunk) => {
      for (const entry of chunk) {
        if (entry.kind === 'checklist') {
          // Never overwrite an existing shell: the one seeded at mint carries
          // the household's real `climate_zone` and `created_at`, and the
          // generator only knows the defaults.
          if (!draft.seasonalChecklists.some((row) => row.id === entry.row.id)) {
            draft.seasonalChecklists.push(entry.row);
          }
        } else if (!draft.seasonalChecklistItems.some((row) => row.id === entry.row.id)) {
          draft.seasonalChecklistItems.push(entry.row);
        }
      }
    },
    (chunk, index) => ({
      opType: 'SEASONAL_YEAR_GENERATE',
      entityType: 'seasonal_checklist',
      entityId: chunk[0]!.row.id,
      payload: { year: input.year, chunk: index, count: chunk.length },
    }),
  );
}

export const localSeasonalChecklistsApi = {
  /**
   * `listChecklists` (:180) — `order by year desc, season desc`.
   *
   * The season half of that ordering is alphabetical on the server (SQLite
   * compares the text: winter, summer, spring, fall), which is meaningless to a
   * member. Within a year the local list uses calendar order instead; the year
   * ordering is unchanged.
   */
  list: async (householdId: string, filters?: { season?: Season; year?: number }) => {
    requireActiveHousehold(householdId);
    const rows = checklistRows()
      .filter((checklist) => !filters?.season || checklist.season === filters.season)
      .filter((checklist) => !filters?.year || checklist.year === filters.year)
      .slice()
      .sort(
        (a, b) =>
          b.year - a.year ||
          SEASONS_IN_ORDER.indexOf(a.season) - SEASONS_IN_ORDER.indexOf(b.season),
      );
    return { checklists: rows.map(composeChecklist) };
  },

  /** `getChecklist` (:120). Raises like the server's `NotFoundError` (:141). */
  get: async (householdId: string, checklistId: string) => {
    requireActiveHousehold(householdId);
    const checklist = checklistRows().find((row) => row.id === checklistId);
    if (!checklist) throw new Error('Seasonal checklist not found');
    return { checklist: composeChecklist(checklist) };
  },

  /**
   * `GET /current` (`routes/seasonal-checklists.ts:82`) — the route owns the
   * season/year/climate-zone defaulting, so all three are applied here.
   */
  getCurrent: async (
    householdId: string,
    options?: { season?: Season; year?: number; climate_zone?: string },
  ) => {
    requireActiveHousehold(householdId);
    const season = options?.season ?? seasonForDate();
    const year = clampChecklistYear(options?.year ?? new Date().getFullYear());
    const climateZone = options?.climate_zone ?? DEFAULT_CLIMATE_ZONE;

    await ensureSeasonalYear({ householdId, year, climateZone });

    const checklist = findBySeasonYear(season, year);
    // Unreachable: `ensureSeasonalYear` just guaranteed all four shells. Kept so
    // a future change to the generator fails loudly instead of returning a
    // half-built DTO to the screen.
    if (!checklist) throw new Error('Seasonal checklist not found');
    return { checklist: composeChecklist(checklist) };
  },

  /**
   * `createChecklist` (:87), with the deterministic id from
   * `logic/seasonalGeneration.ts`. That turns create into an upsert: the server
   * would happily insert a second Fall 2026 (only `/current` checks first),
   * whereas two devices here mint the same row key and merge.
   */
  create: async (householdId: string, data: CreateSeasonalChecklistInput) => {
    requireActiveHousehold(householdId);
    const year = clampChecklistYear(data.year);
    const existing = findBySeasonYear(data.season, year);
    if (existing) return { checklist: composeChecklist(existing) };

    const now = nowIso();
    const checklist: LocalSeasonalChecklist = {
      id: seasonalChecklistId(householdId, data.season, year),
      household_id: householdId,
      season: data.season,
      year,
      climate_zone: data.climate_zone ?? DEFAULT_CLIMATE_ZONE,
      created_at: now,
      updated_at: now,
    };

    await writeLocal(
      (draft) => {
        draft.seasonalChecklists.push(checklist);
      },
      {
        opType: 'SEASONAL_CHECKLIST_CREATE',
        entityType: 'seasonal_checklist',
        entityId: checklist.id,
        payload: { season: checklist.season, year: checklist.year },
      },
    );

    // Freshly created, so there is nothing to join — but compose it the same
    // way so the caller cannot tell a new checklist from an existing one.
    return { checklist: composeChecklist(checklist) };
  },

  /**
   * `addItem` (:251). The id is RANDOM: a member typing "Clean the gutters" on
   * two devices has added two jobs, and only *generated* items (which two
   * devices can produce independently from the same catalogue) are keyed.
   *
   * The server's `updateProgress` call that follows the insert has no local
   * counterpart by design — progress is derived, see the file header.
   */
  addItem: async (householdId: string, checklistId: string, data: AddItemInput) => {
    requireActiveHousehold(householdId);
    const checklist = checklistRows().find((row) => row.id === checklistId);
    if (!checklist) throw new Error('Seasonal checklist not found');

    const item: LocalSeasonalChecklistItem = {
      id: newLocalId('sci'),
      household_id: householdId,
      checklist_id: checklistId,
      task_template_id: data.task_template_id,
      title: data.title,
      category: data.category,
      is_completed: false,
      // The server stores `sort_order || null` and the DTO declares it
      // non-optional; appending at the end is what the screen renders anyway.
      sort_order: data.sort_order ?? itemsOf(checklistId).length,
    };

    await writeLocal(
      (draft) => {
        draft.seasonalChecklistItems.push(item);
        const row = draft.seasonalChecklists.find((entry) => entry.id === checklistId);
        if (row) row.updated_at = nowIso();
      },
      {
        opType: 'SEASONAL_ITEM_ADD',
        entityType: 'seasonal_checklist_item',
        entityId: item.id,
        payload: { checklist_id: checklistId, title: item.title },
      },
    );

    return { item: item as SeasonalChecklistItem };
  },

  /**
   * `updateItem` (:308). Only the fields the request carries are touched — the
   * server's `updateData` builder pattern, which matters far more in a ledger:
   * a blind full-row write would clobber a peer's concurrent edit to a field
   * this member never looked at.
   */
  updateItem: async (
    householdId: string,
    checklistId: string,
    itemId: string,
    data: UpdateItemInput,
  ) => {
    requireActiveHousehold(householdId);
    const now = nowIso();
    let updated: LocalSeasonalChecklistItem | undefined;

    await writeLocal(
      (draft) => {
        const item = draft.seasonalChecklistItems.find(
          (row) => row.id === itemId && row.checklist_id === checklistId,
        );
        if (!item) throw new Error('Checklist item not found');

        if (data.is_completed !== undefined) {
          item.is_completed = data.is_completed;
          // `completed_at` is cleared on un-tick exactly as on the server (:333)
          // — a stale timestamp on an open item is what makes a "finished last
          // spring?" question unanswerable.
          item.completed_at = data.is_completed ? now : undefined;
        }
        if (data.notes !== undefined) item.notes = data.notes || undefined;
        if (data.photo_keys !== undefined) {
          // Keys only. The blobs themselves ride the H6 encrypted channel; this
          // row has always held references, not bytes.
          item.photo_keys = data.photo_keys;
        }

        const checklist = draft.seasonalChecklists.find((row) => row.id === checklistId);
        if (checklist) checklist.updated_at = now;
        updated = { ...item };
      },
      {
        opType: 'SEASONAL_ITEM_UPDATE',
        entityType: 'seasonal_checklist_item',
        entityId: itemId,
        payload: { checklist_id: checklistId, ...data },
      },
    );

    return { item: updated! as SeasonalChecklistItem };
  },
};
