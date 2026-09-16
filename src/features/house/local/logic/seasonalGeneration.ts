/**
 * Seasonal-checklist generation for a household-year.
 * Ported from backend/src/services/checklist-service.ts — keep in sync.
 *
 * The pieces this mirrors, all live on `main`:
 *  - `ChecklistService.getOrCreateChecklist` (:48) — the (household, season,
 *    year) lookup that decides create-vs-reuse.
 *  - `ChecklistService.createChecklist` (:87) — the row the shell is made of.
 *  - `ChecklistService.updateProgress` (:396) — the percentage arithmetic.
 *  - `backend/src/routes/seasonal-checklists.ts` (:82-101) — the *route* owns
 *    the current-season derivation, the year clamp and the climate-zone
 *    default, so those are ported here rather than left to a caller.
 *
 * WHY THE CLIENT NEEDS IT (plan §6). Onboarding and the yearly rollover both
 * create these, and both must work on a cold install in airplane mode. The
 * shells are what make the Seasonal tab render at all — `SeasonalChecklistScreen`
 * calls `getCurrent` once per season tap.
 *
 * WHERE THE ITEM BODIES COME FROM. The server never generates items: a seasonal
 * checklist is created empty and filled by `addItem`. Item bodies are Tier-C
 * template content fetched over HTTP and cached (plan §1.2), which is why
 * generation here takes seeds as an argument and defaults to none — inventing a
 * catalogue on device would fork product content that the template service owns.
 *
 * TWO DEVIATIONS:
 *
 *  1. **Deterministic ids.** The server mints `generateId()`. On device the shell
 *     for (household, season, year) must be the SAME row on every device or a
 *     member who opens Fall offline on two devices ends up with two Falls. The
 *     formula is byte-identical to `defaults.ts:106` — the onboarding seed and
 *     this generator MUST agree, or the mint-time shells and the rollover
 *     shells would be different rows for the same season (plan §1.5 hazard S3b).
 *  2. **Progress is derived, never stored.** `seasonal_checklists.progress` and
 *     `.completed_at` are real D1 columns the server keeps up to date, but
 *     `LocalSeasonalChecklist` (types.ts:70) deliberately has neither: a count
 *     that is derivable from the item rows would have two homes in the ledger
 *     and LWW would happily converge them to different answers. `seasonalProgress`
 *     computes it at read time with the server's rounding.
 */
import type { Season } from '@api/seasonal-checklists';
import { deterministicRowId } from '@symply/local-first';

import type { LocalSeasonalChecklist, LocalSeasonalChecklistItem } from '../types';

/** Generation order for a whole year — also the order `list` returns within a year. */
export const SEASONS_IN_ORDER: readonly Season[] = ['spring', 'summer', 'fall', 'winter'];

/** `routes/seasonal-checklists.ts:88` — the zone assumed when none is supplied. */
export const DEFAULT_CLIMATE_ZONE = 'pacific_northwest';

/** `routes/seasonal-checklists.ts:87` — the year is clamped, not validated away. */
export function clampChecklistYear(year: number): number {
  if (!Number.isFinite(year)) return new Date().getFullYear();
  return Math.max(2000, Math.min(2100, Math.trunc(year)));
}

/**
 * Meteorological season for a date.
 * Ported from `routes/seasonal-checklists.ts:93-99`, which is the same rule as
 * `src/api/seasonal-checklists.ts:120 getCurrentSeason` — both are Northern
 * Hemisphere only, as `services/aihousekeeper/triggers/seasonal-kickoff.ts`
 * documents. Southern support is a product decision, not a local-first one.
 */
export function seasonForDate(now: Date = new Date()): Season {
  const month = now.getMonth() + 1; // 1-12
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'fall';
  return 'winter';
}

/**
 * The shell row key for one (household, season, year). See deviation 1.
 *
 * Identical by construction to `defaults.ts:106`. If you change either, change
 * both — `localSeasonalChecklistsApi.test.ts` pins that they agree.
 */
export function seasonalChecklistId(householdId: string, season: Season, year: number): string {
  return deterministicRowId('scl', [householdId, season, year]);
}

/** One empty seasonal checklist. Mirrors `createChecklist` (:102). */
export function buildSeasonalChecklist(input: {
  householdId: string;
  season: Season;
  year: number;
  climateZone: string;
  now: string;
}): LocalSeasonalChecklist {
  return {
    id: seasonalChecklistId(input.householdId, input.season, input.year),
    household_id: input.householdId,
    season: input.season,
    year: input.year,
    climate_zone: input.climateZone,
    created_at: input.now,
    updated_at: input.now,
  };
}

/**
 * A template line a seasonal checklist can be generated from.
 *
 * Shaped after the Tier-C `checklist_templates` catalogue rather than after the
 * `addItem` request body: `season` is what routes a seed to one of the four
 * shells, and it has no meaning once the item exists.
 */
export type SeasonalItemSeed = {
  season: Season;
  title: string;
  category?: string;
  task_template_id?: string;
};

/**
 * Items for one shell, in seed order.
 *
 * Ids are deterministic for the same reason the shells are: generation is a
 * bulk path that two devices can run independently. The key is the template id
 * when the catalogue supplies one and the title otherwise, so re-running
 * generation against a catalogue that gained a line adds exactly that line.
 */
export function buildSeasonalItems(input: {
  checklistId: string;
  householdId: string;
  seeds: readonly SeasonalItemSeed[];
}): LocalSeasonalChecklistItem[] {
  return input.seeds.map((seed, index) => ({
    id: deterministicRowId('sci', [input.checklistId, seed.task_template_id ?? seed.title]),
    household_id: input.householdId,
    checklist_id: input.checklistId,
    task_template_id: seed.task_template_id,
    title: seed.title,
    category: seed.category,
    is_completed: false,
    sort_order: index,
  }));
}

/**
 * All four shells for one year, plus whatever items the seeds route into them.
 *
 * Whole-year rather than one-season because the member tabs through all four:
 * `SeasonalChecklistScreen` re-runs `getCurrent` on every season tap, and four
 * separate materializing writes are four full ledger captures and diffs
 * (plan §3.3). Callers hand the result to `writeLocalBulk`, so a year costs one
 * op, not eight.
 */
export function generateSeasonalYear(input: {
  householdId: string;
  year: number;
  climateZone?: string;
  seeds?: readonly SeasonalItemSeed[];
  now?: string;
}): { checklists: LocalSeasonalChecklist[]; items: LocalSeasonalChecklistItem[] } {
  const year = clampChecklistYear(input.year);
  const climateZone = input.climateZone ?? DEFAULT_CLIMATE_ZONE;
  const now = input.now ?? new Date().toISOString();
  const seeds = input.seeds ?? [];

  const checklists: LocalSeasonalChecklist[] = [];
  const items: LocalSeasonalChecklistItem[] = [];

  for (const season of SEASONS_IN_ORDER) {
    const checklist = buildSeasonalChecklist({
      householdId: input.householdId,
      season,
      year,
      climateZone,
      now,
    });
    checklists.push(checklist);
    items.push(
      ...buildSeasonalItems({
        checklistId: checklist.id,
        householdId: input.householdId,
        seeds: seeds.filter((seed) => seed.season === season),
      }),
    );
  }

  return { checklists, items };
}

/**
 * The `progress` view the client DTO declares. See deviation 2.
 *
 * `percentage` uses the server's rounding (`updateProgress` :414) so a
 * household that migrates from the server sees the same number. Note the shape
 * difference the ledger inherits rather than causes: `SeasonalChecklistResponse`
 * on the Worker sends `progress` as a bare number while
 * `src/api/seasonal-checklists.ts:26` declares an object — the screens read the
 * object, so that is what the facade composes.
 */
export function seasonalProgress(items: readonly LocalSeasonalChecklistItem[]): {
  total: number;
  completed: number;
  percentage: number;
} {
  const total = items.length;
  const completed = items.filter((item) => item.is_completed).length;
  return {
    total,
    completed,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}
