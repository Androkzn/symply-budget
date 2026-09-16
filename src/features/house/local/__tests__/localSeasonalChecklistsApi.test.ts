/**
 * `localSeasonalChecklistsApi` + the ported generation logic (plan §6 DoD).
 *
 * The server side is `backend/src/services/checklist-service.ts` (the seasonal
 * half, which IS implemented on `main`) plus
 * `backend/src/routes/seasonal-checklists.ts` for the defaulting rules. Two
 * facts the suite is really here to pin:
 *
 *  - the shell id agrees with `defaults.ts` (the household-mint seed) — if it
 *    ever stops agreeing, every household gets a second set of four shells the
 *    first time it opens the Seasonal tab;
 *  - `progress` is derived at read time and appears nowhere in the ledger row.
 *
 * Real session, static imports (plan §6.2).
 */
import { seasonalChecklistsApi, type Season } from '@api/seasonal-checklists';

import { defaultSeasonalChecklists } from '../defaults';
import { getLocalHouseLedger, openLocalHouseSession, resetLocalHouseSession } from '../engine';
import { HouseLocalUnknownPropertyError } from '../errors';
import { parityGap } from '../localApiProxy';
import { localSeasonalChecklistsApi } from '../localSeasonalChecklistsApi';
import {
  DEFAULT_CLIMATE_ZONE,
  clampChecklistYear,
  generateSeasonalYear,
  seasonForDate,
  seasonalChecklistId,
  seasonalProgress,
  type SeasonalItemSeed,
} from '../logic/seasonalGeneration';

const USER = 'user-house-seasonal';
const THIS_YEAR = new Date().getFullYear();
const NEXT_YEAR = THIS_YEAR + 1;

const SEEDS: readonly SeasonalItemSeed[] = [
  { season: 'spring', title: 'Open the outdoor taps', category: 'plumbing' },
  { season: 'spring', title: 'Service the mower', task_template_id: 'tpl_mower' },
  { season: 'fall', title: 'Clean the gutters', category: 'exterior' },
];

async function freshSession() {
  await resetLocalHouseSession();
  return openLocalHouseSession({ userId: USER, displayName: 'Seasonal home' });
}

function householdId(): string {
  return getLocalHouseLedger().household.id;
}

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

describe('seasonal generation — parity with routes/seasonal-checklists.ts', () => {
  it('derives the meteorological season the route derives', () => {
    const seasons: Array<[number, Season]> = [
      [0, 'winter'],
      [2, 'spring'],
      [4, 'spring'],
      [5, 'summer'],
      [7, 'summer'],
      [8, 'fall'],
      [10, 'fall'],
      [11, 'winter'],
    ];
    for (const [monthIndex, expected] of seasons) {
      expect(seasonForDate(new Date(2026, monthIndex, 15))).toBe(expected);
    }
  });

  it('clamps the year instead of rejecting it, as the route does', () => {
    expect(clampChecklistYear(1990)).toBe(2000);
    expect(clampChecklistYear(3000)).toBe(2100);
    expect(clampChecklistYear(2026)).toBe(2026);
    expect(clampChecklistYear(Number.NaN)).toBe(THIS_YEAR);
  });

  it('generates four shells and routes each seed into its own season', () => {
    const first = generateSeasonalYear({ householdId: 'hh_1', year: 2027, seeds: SEEDS });
    expect(first.checklists.map((row) => row.season)).toEqual([
      'spring',
      'summer',
      'fall',
      'winter',
    ]);
    expect(first.checklists[0]!.climate_zone).toBe(DEFAULT_CLIMATE_ZONE);

    const spring = first.checklists[0]!;
    const springItems = first.items.filter((item) => item.checklist_id === spring.id);
    expect(springItems.map((item) => item.title)).toEqual([
      'Open the outdoor taps',
      'Service the mower',
    ]);
    expect(springItems.every((item) => item.is_completed === false)).toBe(true);
    expect(first.items).toHaveLength(3);

    // A second device generating the same year must land on the same row keys.
    const second = generateSeasonalYear({ householdId: 'hh_1', year: 2027, seeds: SEEDS });
    expect(second.checklists.map((row) => row.id)).toEqual(first.checklists.map((row) => row.id));
    expect(second.items.map((row) => row.id)).toEqual(first.items.map((row) => row.id));
  });

  it('mints the SAME shell id the household-mint seed does', () => {
    // `defaults.ts` seeds four shells when the property is created. If these two
    // formulas drift, the first `getCurrent` doubles them.
    const seeded = defaultSeasonalChecklists('hh_42', 2026);
    for (const shell of seeded.checklists) {
      expect(shell.id).toBe(seasonalChecklistId('hh_42', shell.season, shell.year));
    }
  });

  it('computes the progress view with the server’s rounding', () => {
    const items = [{ is_completed: true }, { is_completed: false }, { is_completed: false }];
    expect(seasonalProgress(items as never)).toEqual({
      total: 3,
      completed: 1,
      percentage: 33,
    });
    expect(seasonalProgress([])).toEqual({ total: 0, completed: 0, percentage: 0 });
  });
});

describe('localSeasonalChecklistsApi', () => {
  beforeEach(async () => {
    await freshSession();
  });

  afterEach(async () => {
    await resetLocalHouseSession();
  });

  it('returns the mint-seeded shell for this year without writing anything', async () => {
    const hh = householdId();
    const before = opCount();

    const { checklist } = await localSeasonalChecklistsApi.getCurrent(hh, { season: 'fall' });

    expect(checklist.id).toBe(seasonalChecklistId(hh, 'fall', THIS_YEAR));
    expect(checklist.year).toBe(THIS_YEAR);
    // `defaults.ts` seeds the zone as unknown; the route's default must not
    // overwrite a shell that already exists, exactly as `getOrCreateChecklist`
    // does not.
    expect(checklist.climate_zone).toBe('unknown');
    expect(checklist.items).toEqual([]);
    expect(checklist.progress).toEqual({ total: 0, completed: 0, percentage: 0 });
    expect(opCount()).toBe(before);
  });

  it('defaults the season to the current one when the caller omits it', async () => {
    const { checklist } = await localSeasonalChecklistsApi.getCurrent(householdId());
    expect(checklist.season).toBe(seasonForDate());
  });

  it('generates a whole missing year in one op, not one per season tap', async () => {
    const hh = householdId();
    const before = opCount();

    await localSeasonalChecklistsApi.getCurrent(hh, { season: 'winter', year: NEXT_YEAR });

    expect(opCount() - before).toBe(1);
    const generated = getLocalHouseLedger().seasonalChecklists.filter(
      (row) => row.year === NEXT_YEAR,
    );
    expect(generated).toHaveLength(4);

    // Every later season tap in that year is now a pure read.
    const settled = opCount();
    await localSeasonalChecklistsApi.getCurrent(hh, { season: 'spring', year: NEXT_YEAR });
    expect(opCount()).toBe(settled);
  });

  it('treats create as an upsert on (household, season, year)', async () => {
    const hh = householdId();
    const existing = await localSeasonalChecklistsApi.getCurrent(hh, { season: 'spring' });
    const before = opCount();

    const { checklist } = await localSeasonalChecklistsApi.create(hh, {
      season: 'spring',
      year: THIS_YEAR,
    });

    expect(checklist.id).toBe(existing.checklist.id);
    expect(opCount()).toBe(before);
    expect(
      getLocalHouseLedger().seasonalChecklists.filter(
        (row) => row.season === 'spring' && row.year === THIS_YEAR,
      ),
    ).toHaveLength(1);
  });

  it('creates only the season asked for when the year is new', async () => {
    const hh = householdId();
    const { checklist } = await localSeasonalChecklistsApi.create(hh, {
      season: 'summer',
      year: 2030,
      climate_zone: 'coastal-temperate',
    });

    expect(checklist.climate_zone).toBe('coastal-temperate');
    expect(getLocalHouseLedger().seasonalChecklists.filter((row) => row.year === 2030)).toHaveLength(
      1,
    );
  });

  it('adds items and derives progress from them instead of storing it', async () => {
    const hh = householdId();
    const { checklist } = await localSeasonalChecklistsApi.getCurrent(hh, { season: 'fall' });

    const first = await localSeasonalChecklistsApi.addItem(hh, checklist.id, {
      title: 'Clean the gutters',
      category: 'exterior',
    });
    await localSeasonalChecklistsApi.addItem(hh, checklist.id, { title: 'Winterize the hose bibs' });
    await localSeasonalChecklistsApi.addItem(hh, checklist.id, { title: 'Service the furnace' });

    await localSeasonalChecklistsApi.updateItem(hh, checklist.id, first.item.id, {
      is_completed: true,
    });

    const { checklist: reloaded } = await localSeasonalChecklistsApi.get(hh, checklist.id);
    expect(reloaded.items).toHaveLength(3);
    expect(reloaded.items.map((item) => item.sort_order)).toEqual([0, 1, 2]);
    expect(reloaded.progress).toEqual({ total: 3, completed: 1, percentage: 33 });

    // The stored row carries neither the count nor the percentage — types.ts:70.
    const stored = getLocalHouseLedger().seasonalChecklists.find(
      (row) => row.id === checklist.id,
    )!;
    expect(Object.keys(stored)).not.toContain('progress');
    expect(Object.keys(stored)).not.toContain('completed_at');
  });

  it('gives every added item its own row — the same title twice is two jobs', async () => {
    const hh = householdId();
    const { checklist } = await localSeasonalChecklistsApi.getCurrent(hh, { season: 'winter' });

    const first = await localSeasonalChecklistsApi.addItem(hh, checklist.id, { title: 'Salt the steps' });
    const second = await localSeasonalChecklistsApi.addItem(hh, checklist.id, { title: 'Salt the steps' });

    expect(first.item.id).not.toBe(second.item.id);
    expect(getLocalHouseLedger().seasonalChecklistItems).toHaveLength(2);
  });

  it('clears completed_at on un-tick and leaves untouched fields alone', async () => {
    const hh = householdId();
    const { checklist } = await localSeasonalChecklistsApi.getCurrent(hh, { season: 'spring' });
    const { item } = await localSeasonalChecklistsApi.addItem(hh, checklist.id, {
      title: 'Test the sump pump',
      category: 'plumbing',
    });

    const ticked = await localSeasonalChecklistsApi.updateItem(hh, checklist.id, item.id, {
      is_completed: true,
      notes: 'ran for 30 seconds',
      photo_keys: ['seasonal/sump/1.jpg'],
    });
    expect(ticked.item.completed_at).toBeDefined();
    expect(ticked.item.notes).toBe('ran for 30 seconds');
    expect(ticked.item.photo_keys).toEqual(['seasonal/sump/1.jpg']);

    const untickedResult = await localSeasonalChecklistsApi.updateItem(hh, checklist.id, item.id, {
      is_completed: false,
    });
    expect(untickedResult.item.completed_at).toBeUndefined();
    // A partial update must not clobber the fields it never mentioned — the
    // peer that wrote them may never re-send them.
    expect(untickedResult.item.notes).toBe('ran for 30 seconds');
    expect(untickedResult.item.category).toBe('plumbing');
  });

  it('lists newest year first and calendar order within a year', async () => {
    const hh = householdId();
    await localSeasonalChecklistsApi.getCurrent(hh, { season: 'spring', year: NEXT_YEAR });

    const { checklists } = await localSeasonalChecklistsApi.list(hh);
    expect(checklists).toHaveLength(8);
    expect(checklists.slice(0, 4).map((row) => [row.year, row.season])).toEqual([
      [NEXT_YEAR, 'spring'],
      [NEXT_YEAR, 'summer'],
      [NEXT_YEAR, 'fall'],
      [NEXT_YEAR, 'winter'],
    ]);

    const filtered = await localSeasonalChecklistsApi.list(hh, { season: 'fall', year: THIS_YEAR });
    expect(filtered.checklists).toHaveLength(1);
    expect(filtered.checklists[0]!.season).toBe('fall');
  });

  it('raises for a checklist or item that is not there', async () => {
    const hh = householdId();
    await expect(localSeasonalChecklistsApi.get(hh, 'scl_missing')).rejects.toThrow(
      'Seasonal checklist not found',
    );
    await expect(
      localSeasonalChecklistsApi.addItem(hh, 'scl_missing', { title: 'nope' }),
    ).rejects.toThrow('Seasonal checklist not found');

    const { checklist } = await localSeasonalChecklistsApi.getCurrent(hh, { season: 'summer' });
    await expect(
      localSeasonalChecklistsApi.updateItem(hh, checklist.id, 'sci_missing', { is_completed: true }),
    ).rejects.toThrow('Checklist item not found');
  });

  it('refuses to answer for a property this device has not activated', async () => {
    await expect(localSeasonalChecklistsApi.list('hh_someone_else')).rejects.toBeInstanceOf(
      HouseLocalUnknownPropertyError,
    );
  });

  it('implements every method the remote module exports (DoD H3 method diff)', () => {
    expect(parityGap(seasonalChecklistsApi, localSeasonalChecklistsApi)).toEqual({
      missingLocally: [],
      extraLocally: [],
    });
  });
});
