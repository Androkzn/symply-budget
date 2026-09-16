/**
 * Symply Health — WATER area, dedicated tab store (`healthWaterStorage.ts`).
 *
 * This module ships (routed at `app/(tabs)/health-water.tsx`, registered in
 * `src/navigation/tabRegistry.ts` as the **Water** tab) and had NO test file at
 * all. It is the donor's `WaterIntakeView`: preset quick-adds, a custom amount,
 * today's per-entry log with a real per-row delete, an editable goal and an
 * ml/oz display choice — everything Home's ±1-cup counter is not.
 *
 * The properties worth pinning, in order of what breaks a member's data:
 *
 *  1. **Millilitres are canonical.** `oz` is a DISPLAY choice applied at the two
 *     edges only (`formatVolume` / `parseVolume`). If an ounce figure ever
 *     reached the wire or the cache there would be two sources of truth for one
 *     glass of water and a rounding error on every unit switch.
 *  2. **One record, three surfaces.** Every write here mirrors
 *     `health.water.v1` — the key Home and Nutrition read — so a 500 ml bottle
 *     logged on this tab moves Home's cup counter and vice versa. Cups are
 *     DERIVED from the millilitre total, never accumulated in parallel.
 *  3. **The ring never disagrees with the log.** `totalMl` comes from the
 *     server's own `/water/summary/daily`, not from re-adding the rows on the
 *     device, so a row the device has not seen yet cannot make them differ.
 *  4. **Route bounds are enforced client-side.** `amount_ml` is
 *     `positive().max(10000)` on the Worker, so a value that would 400 must be
 *     clamped or refused before it is sent.
 *
 * Harness matches ./water.storage.test.ts: `@api/health` mocked, a stateful
 * ledger standing in for `water_entries` + the daily summary.
 */

import { healthApi } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  CUP_ML,
  HEALTH_WATER_KEY,
  loadWaterToday,
  type WaterDay,
} from '../../healthLocalStorage';
import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../../healthRepository';
import {
  addWaterAmount,
  clampEntryMl,
  clampGoalMl,
  DEFAULT_WATER_GOAL_ML,
  deleteWaterEntry,
  FL_OZ_ML,
  formatEntryTime,
  formatVolume,
  GLASS_ML,
  HEALTH_WATER_LOG_KEY,
  HEALTH_WATER_PREFS_KEY,
  loadWaterDay,
  loadWaterPrefs,
  mlToOz,
  ozToMl,
  parseVolume,
  saveWaterUnit,
  setWaterGoalMl,
  stepMl,
  toUnitInput,
  unitLabel,
  WATER_GOAL_PRESETS_ML,
  WATER_PRESETS,
  waterGlasses,
  waterProgress,
  waterRemainingMl,
  type WaterDayDetail,
} from '../../healthWaterStorage';
import {
  fakeGoalServer,
  goalRow,
  installHealthApiDefaults,
  NETWORK_ERROR,
  ok,
  waterEntryRow,
  waterSummaryRow,
  type MockedHealthApi,
} from '../../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';
const YESTERDAY = '2026-07-12';

interface LedgerRow {
  id: string;
  date: string;
  ml: number;
  container: string | null;
  createdAt: string;
}

/**
 * Stateful stand-in for `water_entries` + `/water/summary/daily` + the goal row.
 *
 * Models `created_at` explicitly because this module SORTS the log by it — two
 * writes inside one millisecond would otherwise make "newest first" untestable.
 */
function fakeWaterLedger(seed: LedgerRow[] = []): {
  rows: LedgerRow[];
  goal: { goal: { daily_water_ml: number | null } };
} {
  const goal = fakeGoalServer(api) as unknown as { goal: { daily_water_ml: number | null } };
  const state = { rows: [...seed] };
  let clock = 0;

  api.addWater.mockImplementation((body) => {
    const row: LedgerRow = {
      id: `h2o_${state.rows.length}`,
      date: body.date,
      ml: body.amount_ml,
      container: (body as { container?: string }).container ?? null,
      // Strictly increasing so `localeCompare` on the ISO stamp is a real order.
      createdAt: `2026-07-13T${String(8 + clock++).padStart(2, '0')}:00:00.000Z`,
    };
    state.rows.push(row);
    return Promise.resolve(ok({ entry: waterEntryRow({ id: row.id, date: row.date }) }));
  });
  api.deleteWater.mockImplementation((id) => {
    const index = state.rows.findIndex((r) => r.id === id);
    if (index >= 0) state.rows.splice(index, 1);
    return Promise.resolve(ok({ deleted: index >= 0 }));
  });
  api.waterSummary.mockImplementation((date) =>
    Promise.resolve(
      ok({
        summary: waterSummaryRow({
          date,
          total_ml: state.rows.filter((r) => r.date === date).reduce((s, r) => s + r.ml, 0),
          goal_ml: goal.goal.daily_water_ml,
          entry_count: state.rows.filter((r) => r.date === date).length,
        }),
      })
    )
  );
  api.listWater.mockImplementation((params) =>
    Promise.resolve(
      ok({
        entries: state.rows
          .filter((r) => (params?.from ? r.date >= params.from : true))
          .filter((r) => (params?.to ? r.date <= params.to : true))
          .map((r) =>
            waterEntryRow({
              id: r.id,
              date: r.date,
              amount_ml: r.ml,
              container: r.container,
              created_at: r.createdAt,
            })
          ),
      })
    )
  );
  return { rows: state.rows, goal };
}

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]);
  __setHealthOfflineForTests(false);
  jest.resetAllMocks();
  installHealthApiDefaults(api);
  api.deleteWater.mockResolvedValue(ok({ deleted: true }));
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

/* ---------------------------------------------------------------- */
/* Units — display only                                              */
/* ---------------------------------------------------------------- */

describe('water tab — unit conversion is display-only', () => {
  it('HEALTH-WATER-001: ml ⇄ oz round-trips on the donor constant', () => {
    // 29.5735 is the donor's own `UnitConversion.swift:111`. Anything else here
    // silently restates every logged drink by a percent or two.
    expect(FL_OZ_ML).toBe(29.5735);
    expect(mlToOz(FL_OZ_ML)).toBeCloseTo(1, 10);
    expect(ozToMl(1)).toBeCloseTo(FL_OZ_ML, 10);
    expect(mlToOz(ozToMl(16))).toBeCloseTo(16, 10);
  });

  it('HEALTH-WATER-002: formatVolume switches to litres past 1,000 ml but never for oz', () => {
    expect(formatVolume(0, 'ml')).toBe('0 ml');
    expect(formatVolume(250, 'ml')).toBe('250 ml');
    expect(formatVolume(999, 'ml')).toBe('999 ml');
    expect(formatVolume(1000, 'ml')).toBe('1.0 L'); // the boundary is inclusive
    expect(formatVolume(2000, 'ml')).toBe('2.0 L');

    // oz has no larger customary unit — 68 fl oz is how a US label states it.
    expect(formatVolume(250, 'oz')).toBe('8.5 oz'); // under 10 keeps a decimal…
    expect(formatVolume(500, 'oz')).toBe('17 oz'); // …past 10 it would be false precision
    expect(formatVolume(2000, 'oz')).toBe('68 oz');

    // A corrupt figure renders as nothing logged rather than "NaN ml".
    expect(formatVolume(Number.NaN, 'ml')).toBe('0 ml');
    expect(formatVolume(Number.POSITIVE_INFINITY, 'oz')).toBe('0.0 oz');
  });

  it('HEALTH-WATER-003: parseVolume rejects junk and converts oz input to millilitres', () => {
    // `keyboardType="decimal-pad"` only picks the on-screen keyboard; paste, a
    // hardware keyboard and UI automation all bypass it.
    expect(parseVolume('', 'ml')).toBe(0);
    expect(parseVolume(null as unknown as string, 'ml')).toBe(0); // defensive: non-string caller
    expect(parseVolume('abc', 'ml')).toBe(0);
    expect(parseVolume('0', 'ml')).toBe(0);
    expect(parseVolume('-250', 'ml')).toBe(250); // the sign character is stripped, not honoured
    expect(parseVolume('2 5 0 ml', 'ml')).toBe(250);
    expect(parseVolume('250', 'ml')).toBe(250);

    // A typed ounce figure is converted at the edge, so only ml reaches the wire.
    expect(parseVolume('16.9', 'oz')).toBe(500);
    expect(parseVolume('8', 'oz')).toBe(237);

    // Route bound: `amount_ml` is `positive().max(10000)`, so anything larger is
    // clamped here rather than 400ing at the Worker.
    expect(parseVolume('999999', 'ml')).toBe(10_000);
  });

  it('HEALTH-WATER-004: the ± step and the field seed match the display unit', () => {
    expect(stepMl('ml')).toBe(50); // the donor wheel's stride
    expect(stepMl('oz')).toBe(59); // ≈2 fl oz, its nearest customary sibling
    expect(unitLabel('ml')).toBe('ml');
    expect(unitLabel('oz')).toBe('oz');

    // A field is seeded with a BARE number so what comes back out parses again.
    expect(toUnitInput(500, 'ml')).toBe('500');
    expect(toUnitInput(500, 'oz')).toBe('17');
    expect(parseVolume(toUnitInput(500, 'oz'), 'oz')).toBe(503); // one round-trip, ±3 ml
    // Zero shows the placeholder rather than a literal "0" the member must clear.
    expect(toUnitInput(0, 'ml')).toBe('');
    expect(toUnitInput(Number.NaN, 'oz')).toBe('');
  });

  it('HEALTH-WATER-005: clampEntryMl and clampGoalMl hold the route bounds', () => {
    expect(clampEntryMl(0)).toBe(0);
    expect(clampEntryMl(0.4)).toBe(0); // rounds below 1 ml → refused
    expect(clampEntryMl(0.6)).toBe(1); // rounds to the minimum → accepted
    expect(clampEntryMl(250.4)).toBe(250);
    expect(clampEntryMl(99_999)).toBe(10_000);
    expect(clampEntryMl(Number.NaN)).toBe(0);
    expect(clampEntryMl(Number.POSITIVE_INFINITY)).toBe(0);

    expect(clampGoalMl(0)).toBe(DEFAULT_WATER_GOAL_ML);
    expect(clampGoalMl(-1)).toBe(DEFAULT_WATER_GOAL_ML);
    expect(clampGoalMl(Number.NaN)).toBe(DEFAULT_WATER_GOAL_ML);
    expect(clampGoalMl(100)).toBe(250); // a goal below one glass is not a goal
    expect(clampGoalMl(2000)).toBe(2000);
    expect(clampGoalMl(99_999)).toBe(10_000);
  });

  it('HEALTH-WATER-006: the unit preference syncs through the shared goal row (0140), and coerces junk to ml', async () => {
    // 'ml' / 'oz' / 'L' / 'cups' — four display units now, not two; the AMOUNT
    // stays canonical millilitres regardless of which one is chosen.
    const goal = fakeGoalServer(api, { water_unit: null });
    expect(await loadWaterPrefs()).toEqual({ unit: 'ml' });

    expect(await saveWaterUnit('cups')).toEqual({ unit: 'cups' });
    // Unlike the pre-0140 local-only toggle, this IS a real write — to the
    // SAME shared `health_goals` row the weight/water/activity goals share.
    expect(api.saveGoal).toHaveBeenCalledWith(expect.objectContaining({ water_unit: 'cups' }));
    expect(goal.goal.water_unit).toBe('cups');
    expect(await loadWaterPrefs()).toEqual({ unit: 'cups' });

    expect(await saveWaterUnit('L')).toEqual({ unit: 'L' });
    expect(await loadWaterPrefs()).toEqual({ unit: 'L' });

    // A pre-0140 Worker OMITS the key entirely (simulated by a goal row with
    // no `water_unit` at all) — its silence keeps whatever this handset last
    // knew rather than resetting the display back to ml.
    api.getGoal.mockResolvedValue(ok({ goal: goalRow() }));
    expect(await loadWaterPrefs()).toEqual({ unit: 'L' });

    // Junk never reaches the wire as the member's "unit".
    expect(await saveWaterUnit('gallons' as never)).toEqual({ unit: 'ml' });
    await storageHelpers.setObject(HEALTH_WATER_PREFS_KEY, 'corrupt');
    api.getGoal.mockResolvedValue(ok({ goal: null }));
    expect(await loadWaterPrefs()).toEqual({ unit: 'ml' });
  });
});

/* ---------------------------------------------------------------- */
/* Today's log                                                       */
/* ---------------------------------------------------------------- */

describe("water tab — today's log", () => {
  it('HEALTH-WATER-007: the day is one summary + one entries call, newest drink first', async () => {
    fakeWaterLedger([
      { id: 'a', date: TODAY, ml: 250, container: 'Glass', createdAt: '2026-07-13T08:00:00.000Z' },
      { id: 'b', date: TODAY, ml: 500, container: 'Bottle', createdAt: '2026-07-13T14:00:00.000Z' },
      { id: 'c', date: YESTERDAY, ml: 900, container: null, createdAt: '2026-07-12T09:00:00.000Z' },
    ]);

    const day = await loadWaterDay();

    expect(api.waterSummary).toHaveBeenCalledWith(TODAY);
    // The entries query is bounded to the ONE day — the log is today's, and a
    // 400-day pull would be the Trends history's job, not this screen's.
    expect(api.listWater).toHaveBeenCalledWith({ from: TODAY, to: TODAY });
    expect(day.date).toBe(TODAY);
    expect(day.totalMl).toBe(750);
    expect(day.entries.map((e) => e.id)).toEqual(['b', 'a']); // newest first
    expect(day.entries[0]).toMatchObject({ amountMl: 500, container: 'Bottle' });
  });

  it('HEALTH-WATER-008: the total comes from the SERVER, not from re-adding the rows', async () => {
    // The ring and the log must never disagree. A device that re-added its own
    // rows would drift the moment the entries page and the summary were computed
    // at different instants (or the log were truncated at 60 rows).
    api.waterSummary.mockResolvedValue(ok({ summary: waterSummaryRow({ total_ml: 1234 }) }));
    api.listWater.mockResolvedValue(ok({ entries: [waterEntryRow({ amount_ml: 250 })] }));

    const day = await loadWaterDay();

    expect(day.totalMl).toBe(1234);
    expect(day.entries).toHaveLength(1);
  });

  it('HEALTH-WATER-009: zero-volume rows are dropped and the log is capped at 60', async () => {
    api.waterSummary.mockResolvedValue(ok({ summary: waterSummaryRow({ total_ml: 100 }) }));
    api.listWater.mockResolvedValue(
      ok({
        entries: [
          waterEntryRow({ id: 'zero', amount_ml: 0 }),
          ...Array.from({ length: 70 }, (_, i) =>
            waterEntryRow({
              id: `r${i}`,
              amount_ml: 100,
              created_at: `2026-07-13T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
            })
          ),
        ],
      })
    );

    const day = await loadWaterDay();

    // A 0 ml row is a tombstone the member cannot act on — showing it would put
    // an undeletable "0 ml" line in the log.
    expect(day.entries.some((e) => e.id === 'zero')).toBe(false);
    expect(day.entries).toHaveLength(60);
  });

  it('HEALTH-WATER-031: a partial wire row survives every missing field', async () => {
    // An older Worker (or a 200 with a trimmed body) can omit any of these. Each
    // has its own fallback, and each fallback exists because the alternative is
    // `undefined` reaching `Math.round`, `String.localeCompare` or a `<Text>`.
    api.waterSummary.mockResolvedValue(ok({ summary: {} as never }));
    api.listWater.mockResolvedValue(
      ok({
        entries: [
          {
            id: 'bare',
            date: TODAY,
            created_at: '2026-07-13T09:00:00.000Z',
            // amount_ml / container / beverage_type all absent
          } as never,
          waterEntryRow({ id: 'full', amount_ml: 250, container: 'Glass' }),
        ],
      })
    );

    const day = await loadWaterDay();

    // A row with no amount is a 0 ml row, which HEALTH-WATER-009 drops.
    expect(day.entries.map((e) => e.id)).toEqual(['full']);
    expect(day.entries[0]).toMatchObject({ container: 'Glass', beverageType: 'water' });
    expect(day.totalMl).toBe(0); // no `total_ml` key → nothing logged, not NaN
    expect(day.goalMl).toBe(DEFAULT_WATER_GOAL_ML);

    // A list response with no `entries` key at all is an empty log, not a throw.
    api.listWater.mockResolvedValue(ok({} as never));
    expect((await loadWaterDay()).entries).toEqual([]);

    // And the same fields missing from the CACHE, on the offline read path.
    await storageHelpers.setObject(HEALTH_WATER_LOG_KEY, { date: TODAY, entries: [] });
    __setHealthOfflineForTests(true);
    expect(await loadWaterDay()).toEqual<WaterDayDetail>({
      date: TODAY,
      totalMl: 0,
      goalMl: DEFAULT_WATER_GOAL_ML,
      entries: [],
    });
  });

  it('HEALTH-WATER-010: a goal-less account falls back to 2,000 ml, not to zero', async () => {
    api.waterSummary.mockResolvedValue(
      ok({ summary: waterSummaryRow({ total_ml: 500, goal_ml: null }) })
    );

    // A goal of 0 would make the ring divide by zero and the caption read
    // "0 ml to go" on an empty day — i.e. "goal reached" before a sip.
    const day = await loadWaterDay();
    expect(day.goalMl).toBe(DEFAULT_WATER_GOAL_ML);
    expect(DEFAULT_WATER_GOAL_ML).toBe(1920); // 8 cups × 240 ml, Home's default target
  });

  it('HEALTH-WATER-011: a cached day from YESTERDAY is emptied but keeps its goal', async () => {
    await storageHelpers.setObject(HEALTH_WATER_LOG_KEY, {
      date: YESTERDAY,
      totalMl: 1800,
      goalMl: 3000,
      entries: [{ id: 'old', date: YESTERDAY, amountMl: 1800, container: null, beverageType: 'water', createdAt: '2026-07-12T09:00:00.000Z' }],
    });
    __setHealthOfflineForTests(true);

    const day = await loadWaterDay();

    // Yesterday's drinks must never be shown as today's — that would be an
    // invented health record, and the member would "un-drink" them by deleting.
    expect(day).toEqual<WaterDayDetail>({
      date: TODAY,
      totalMl: 0,
      goalMl: 3000, // the goal survives; only the intake resets
      entries: [],
    });
  });

  it('HEALTH-WATER-011b: a stale-dated cache with no goal at all falls back to the default goal', async () => {
    // A legacy/corrupt cache blob for a DIFFERENT day, missing `goalMl`
    // entirely — the field the rollover branch reads to keep the goal across
    // the day change. Losing it must not crash `clampGoalMl(undefined)`; it
    // must read as "no goal known yet" and fall back to the default.
    await storageHelpers.setObject(HEALTH_WATER_LOG_KEY, {
      date: YESTERDAY,
      totalMl: 500,
      entries: [],
    });
    __setHealthOfflineForTests(true);

    expect(await loadWaterDay()).toEqual<WaterDayDetail>({
      date: TODAY,
      totalMl: 0,
      goalMl: DEFAULT_WATER_GOAL_ML,
      entries: [],
    });
  });

  it('HEALTH-WATER-012: an offline cold start renders an empty day, not a crash', async () => {
    api.waterSummary.mockRejectedValue(NETWORK_ERROR);
    api.listWater.mockRejectedValue(NETWORK_ERROR);

    expect(await loadWaterDay()).toEqual<WaterDayDetail>({
      date: TODAY,
      totalMl: 0,
      goalMl: DEFAULT_WATER_GOAL_ML,
      entries: [],
    });
    expect(healthSyncStateFor(HEALTH_WATER_LOG_KEY)).toBe('offline');
  });

  it('HEALTH-WATER-013: a corrupt cached day degrades instead of throwing into the screen', async () => {
    // Both shapes a hand-edited or schema-drifted blob can take.
    await storageHelpers.setObject(HEALTH_WATER_LOG_KEY, 'nope');
    __setHealthOfflineForTests(true);
    expect(await loadWaterDay()).toMatchObject({ date: TODAY, totalMl: 0, entries: [] });

    await storageHelpers.setObject(HEALTH_WATER_LOG_KEY, {
      date: TODAY,
      totalMl: -5,
      goalMl: 2000,
      entries: 'not an array',
    });
    // `entries.map` on a string would blank the screen on exactly the offline
    // path the cache exists to protect.
    expect(await loadWaterDay()).toEqual<WaterDayDetail>({
      date: TODAY,
      totalMl: 0, // negatives floor at zero
      goalMl: 2000,
      entries: [],
    });
  });
});

/* ---------------------------------------------------------------- */
/* Logging a drink                                                   */
/* ---------------------------------------------------------------- */

describe('water tab — logging a drink', () => {
  it('HEALTH-WATER-014: the three presets post their exact donor amounts and containers', async () => {
    const ledger = fakeWaterLedger();

    expect(WATER_PRESETS.map((p) => [p.id, p.ml])).toEqual([
      ['Glass', 250],
      ['Mug', 350],
      ['Bottle', 500],
    ]);

    for (const preset of WATER_PRESETS) await addWaterAmount(preset.ml, { container: preset.id });

    expect(api.addWater.mock.calls.map(([body]) => body)).toEqual([
      { date: TODAY, amount_ml: 250, container: 'Glass' },
      { date: TODAY, amount_ml: 350, container: 'Mug' },
      { date: TODAY, amount_ml: 500, container: 'Bottle' },
    ]);
    // The container is what lets the log row read "Bottle · 2:15 PM" instead of
    // an anonymous volume.
    expect(ledger.rows.map((r) => r.container)).toEqual(['Glass', 'Mug', 'Bottle']);
    expect((await loadWaterDay()).totalMl).toBe(1100);
  });

  it('HEALTH-WATER-015: a custom amount with no container omits the key entirely', async () => {
    fakeWaterLedger();

    await addWaterAmount(300);

    // Not `container: null` — the route's zod schema takes an OPTIONAL string,
    // and an explicit null would be rejected as the wrong type.
    expect(api.addWater).toHaveBeenCalledWith({ date: TODAY, amount_ml: 300 });
  });

  it('HEALTH-WATER-016: a non-positive or unusable amount writes nothing at all', async () => {
    const ledger = fakeWaterLedger();
    await addWaterAmount(500);
    api.addWater.mockClear();

    for (const bad of [0, -250, 0.4, Number.NaN, Number.POSITIVE_INFINITY]) {
      const day = await addWaterAmount(bad);
      expect(day.totalMl).toBe(500); // unchanged, and the current day is returned
    }

    // No phantom row, no 400 from the route, and no optimistic cache poisoning.
    expect(api.addWater).not.toHaveBeenCalled();
    expect(ledger.rows).toHaveLength(1);
  });

  it('HEALTH-WATER-017: an offline add still shows the drink and heals on reconnect', async () => {
    const ledger = fakeWaterLedger();
    await addWaterAmount(250, { container: 'Glass' });
    api.addWater.mockRejectedValue(NETWORK_ERROR);

    const optimistic = await addWaterAmount(500, { container: 'Bottle' });

    expect(optimistic.totalMl).toBe(750);
    expect(optimistic.entries[0]).toMatchObject({ amountMl: 500, container: 'Bottle' });
    // The placeholder id is never used to address a row — the next successful
    // read replaces the whole list with the server's.
    expect(optimistic.entries[0].id).toMatch(/^pending-/);
    expect(healthSyncStateFor(HEALTH_WATER_LOG_KEY)).toBe('offline');

    api.addWater.mockClear();
    expect((await loadWaterDay()).totalMl).toBe(250); // reconciled to what landed
    expect(ledger.rows).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- */
/* Per-entry delete                                                  */
/* ---------------------------------------------------------------- */

describe('water tab — per-entry delete', () => {
  it('HEALTH-WATER-018: deleting a row removes THAT drink, not the last one', async () => {
    const ledger = fakeWaterLedger();
    await addWaterAmount(250, { container: 'Glass' });
    await addWaterAmount(500, { container: 'Bottle' });
    const day = await loadWaterDay();
    const glass = day.entries.find((e) => e.amountMl === 250)!;

    // This is the difference from Home's ± control, which can only "undo the
    // last sip": here the member is pointing at a specific row, so the OLDER
    // drink must go even though a newer one exists.
    const after = await deleteWaterEntry(glass.id);

    expect(api.deleteWater).toHaveBeenCalledWith(glass.id);
    expect(after.totalMl).toBe(500);
    expect(after.entries.map((e) => e.amountMl)).toEqual([500]);
    expect(ledger.rows.map((r) => r.ml)).toEqual([500]);
    expect(api.undoWater).not.toHaveBeenCalled();
  });

  it('HEALTH-WATER-019: an offline delete hides the row optimistically and heals', async () => {
    fakeWaterLedger();
    await addWaterAmount(250);
    await addWaterAmount(500);
    const day = await loadWaterDay();
    api.deleteWater.mockRejectedValue(NETWORK_ERROR);

    const after = await deleteWaterEntry(day.entries[0].id);

    expect(after.totalMl).toBe(250); // 750 − the 500 the member removed
    expect(after.entries).toHaveLength(1);
    expect(healthSyncStateFor(HEALTH_WATER_LOG_KEY)).toBe('offline');

    // …and the server, which never saw the DELETE, restores it on the next read.
    expect((await loadWaterDay()).totalMl).toBe(750);
  });

  it('HEALTH-WATER-020: deleting an unknown id still issues the request', async () => {
    fakeWaterLedger();
    await addWaterAmount(250);

    const after = await deleteWaterEntry('h2o_does_not_exist');

    // DEFECT (HEALTH-WATER-020): the id is not in the cached list, so the
    // optimistic subtraction is a no-op — but a DELETE is sent anyway (the
    // Worker answers 404, which `writeThrough` swallows as "offline"). Same
    // shape as HEALTH-STORE-022 on the weight log. A no-op delete should
    // short-circuit; sending it means an unrelated network blip gets recorded as
    // an offline write.
    expect(api.deleteWater).toHaveBeenCalledWith('h2o_does_not_exist');
    expect(after.totalMl).toBe(250); // nothing was actually removed
  });
});

/* ---------------------------------------------------------------- */
/* Goal                                                              */
/* ---------------------------------------------------------------- */

describe('water tab — daily goal', () => {
  it('HEALTH-WATER-021: the goal presets are the donor five and save in millilitres', async () => {
    const ledger = fakeWaterLedger();

    expect([...WATER_GOAL_PRESETS_ML]).toEqual([1500, 2000, 2500, 3000, 3500]);

    const day = await setWaterGoalMl(2500);

    expect(api.saveGoal).toHaveBeenCalledWith({ daily_water_ml: 2500 });
    expect(day.goalMl).toBe(2500);
    // Written to the shared effective-dated goal row, which is what stops the
    // Water tab and Home's cup target drifting apart.
    expect(ledger.goal.goal.daily_water_ml).toBe(2500);
  });

  it('HEALTH-WATER-022: an out-of-range goal is clamped before it is saved', async () => {
    fakeWaterLedger();

    expect((await setWaterGoalMl(50)).goalMl).toBe(250);
    expect((await setWaterGoalMl(50_000)).goalMl).toBe(10_000);
    expect((await setWaterGoalMl(0)).goalMl).toBe(DEFAULT_WATER_GOAL_ML);
    expect(api.saveGoal).toHaveBeenLastCalledWith({ daily_water_ml: DEFAULT_WATER_GOAL_ML });
  });

  it('HEALTH-WATER-023: a failed goal save keeps the chosen figure on screen', async () => {
    fakeWaterLedger();
    await addWaterAmount(500);
    api.saveGoal.mockRejectedValue(NETWORK_ERROR);

    const day = await setWaterGoalMl(3000);

    expect(day.goalMl).toBe(3000);
    expect(day.totalMl).toBe(500); // the intake is untouched by a goal change
    expect(healthSyncStateFor(HEALTH_WATER_LOG_KEY)).toBe('offline');
  });
});

/* ---------------------------------------------------------------- */
/* Derived hero figures                                              */
/* ---------------------------------------------------------------- */

describe('water tab — derived hero figures', () => {
  const day = (totalMl: number, goalMl = 2000): WaterDayDetail => ({
    date: TODAY,
    totalMl,
    goalMl,
    entries: [],
  });

  it('HEALTH-WATER-024: progress clamps to [0,1] and survives a zero goal', () => {
    expect(waterProgress(day(0))).toBe(0);
    expect(waterProgress(day(1000))).toBe(0.5);
    expect(waterProgress(day(2000))).toBe(1);
    expect(waterProgress(day(5000))).toBe(1); // the ring cannot overfill
    // A zero goal would be a divide-by-zero → Infinity → a ring drawn as "met".
    expect(waterProgress(day(500, 0))).toBe(0);
  });

  it('HEALTH-WATER-025: "to go" floors at zero, so a goal met never reads negative', () => {
    expect(waterRemainingMl(day(500))).toBe(1500);
    expect(waterRemainingMl(day(2000))).toBe(0);
    expect(waterRemainingMl(day(2500))).toBe(0); // never "−500 ml to go"
  });

  it('HEALTH-WATER-026: the glasses row is bounded so a huge goal cannot draw 40 slots', () => {
    expect(GLASS_ML).toBe(250);
    expect(waterGlasses(day(0))).toEqual({ filled: 0, total: 8 });
    expect(waterGlasses(day(500))).toEqual({ filled: 2, total: 8 });
    // A partial glass is not drawn as full — `floor`, not `round`.
    expect(waterGlasses(day(749))).toEqual({ filled: 2, total: 8 });
    expect(waterGlasses(day(750))).toEqual({ filled: 3, total: 8 });
    // Overshooting the goal cannot light more slots than exist.
    expect(waterGlasses(day(9000))).toEqual({ filled: 8, total: 8 });
    // Bounds: at least one slot, at most twenty (a 10 L goal would be 40).
    expect(waterGlasses(day(0, 100)).total).toBe(1);
    expect(waterGlasses(day(0, 10_000)).total).toBe(20);
  });

  it('HEALTH-WATER-027: an unparseable entry stamp renders as nothing, not "Invalid Date"', () => {
    expect(formatEntryTime('not-a-date')).toBe('');
    expect(formatEntryTime('')).toBe('');
    expect(formatEntryTime('2026-07-13T14:15:00.000Z')).not.toBe('');
  });
});

/* ---------------------------------------------------------------- */
/* One record, two counters                                          */
/* ---------------------------------------------------------------- */

describe('water tab — mirrors the ±cup counter', () => {
  it('HEALTH-WATER-028: every write here restates health.water.v1 in CUPS', async () => {
    fakeWaterLedger();

    // A 500 ml bottle is 2.08 cups → the counter Home reads must round, never
    // accumulate its own parallel tally.
    await addWaterAmount(500, { container: 'Bottle' });
    expect(await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY)).toEqual<WaterDay>({
      date: TODAY,
      cups: 2,
      target: 8,
    });

    await addWaterAmount(250, { container: 'Glass' });
    expect(await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY)).toMatchObject({ cups: 3 });

    // A goal set in millilitres restates Home's cup TARGET too (2,400 ml = 10).
    await setWaterGoalMl(2400);
    expect(await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY)).toMatchObject({
      cups: 3,
      target: 10,
    });
  });

  it('HEALTH-WATER-029: a delete on this tab moves the cup counter DOWN', async () => {
    fakeWaterLedger();
    await addWaterAmount(500);
    await addWaterAmount(500);
    expect(await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY)).toMatchObject({ cups: 4 });

    const day = await loadWaterDay();
    await deleteWaterEntry(day.entries[0].id);

    // Without the mirror the member deletes a bottle here, switches to Home, and
    // still sees the cups they just removed.
    expect(await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY)).toMatchObject({ cups: 2 });
    expect((await loadWaterToday()).cups).toBe(2);
  });

  it('HEALTH-WATER-030: cups are DERIVED, so ml and cups can never drift apart', async () => {
    fakeWaterLedger();

    // Three 250 ml glasses = 750 ml = 3.125 cups → 3. A parallel cup tally
    // ("+1 per glass") would say 3 too, and would be wrong the moment a 500 ml
    // bottle or an AI-committed 180 ml arrived.
    await addWaterAmount(250);
    await addWaterAmount(250);
    await addWaterAmount(250);
    const day = await loadWaterDay();
    const counter = await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY);

    expect(day.totalMl).toBe(750);
    expect(counter?.cups).toBe(Math.round(day.totalMl / CUP_ML));
    expect(counter?.cups).toBe(3);
  });
});
