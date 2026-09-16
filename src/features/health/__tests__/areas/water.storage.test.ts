/**
 * Symply Health — WATER area, store layer (`healthLocalStorage.ts` §Water).
 *
 * Companion to ../healthLocalStorage.test.ts, which already owns the happy path
 * (STORE-021/023/028…032, 045…052, 057/058). This file drives the paths that
 * survived that pass, all of which are edges a member can actually reach:
 *
 *  * the millilitre → cup ROUNDING, which is the only place the ring's number
 *    comes from and is not a plain division (a 250 ml bottle is one cup);
 *  * the FLOOR at zero — "Remove a cup" on an empty day must never persist a
 *    negative count nor a zero-cup history row;
 *  * RAPID taps, sequential and concurrent. `adjustWater` is a read-modify-write
 *    with no queue, so the only property that can hold is "the server is the
 *    record and no tap is lost"; the optimistic cache may lag and must heal;
 *  * a DAY BOUNDARY crossed mid-session, online and offline — the counter is a
 *    per-day total and a tap at 00:01 belongs to the new day, not yesterday's;
 *  * the goal being reached and EXCEEDED, plus the 30-cup ceiling, where the
 *    client clamp and the server ledger disagree (see STORE-069);
 *  * `undoWater`'s whole-ENTRY semantics versus the Worker's per-entry delete
 *    (`DELETE /health/water/entries/:id`, which has no RN caller at all).
 *
 * Harness mirrors ../healthLocalStorage.test.ts: `@api/health` is mocked and a
 * STATEFUL fake stands in for the water ledger. A static mock cannot express any
 * of the above — every water path is a write followed by a re-read, so the fake
 * has to hold rows, order them by creation like `removeLastWater` does, and
 * total them per day like `waterDailySummary` does.
 */

import { healthApi } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  adjustWater,
  CUP_ML,
  DEFAULT_WATER_TARGET,
  HEALTH_WATER_HISTORY_KEY,
  HEALTH_WATER_KEY,
  loadWaterHistory,
  loadWaterToday,
  setWaterTarget,
  type WaterDay,
} from '../../healthLocalStorage';
import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../../healthRepository';
import {
  fakeGoalServer,
  installHealthApiDefaults,
  NETWORK_ERROR,
  ok,
  waterEntryRow,
  waterSummaryRow,
  type MockedHealthApi,
} from '../../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

/** Local noon, far from any timezone's midnight — `todayDateKey()` is stable. */
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';
const TOMORROW = '2026-07-14';
const YESTERDAY = '2026-07-12';

/** The 30-cup client ceiling (`MAX_CUPS`, not exported). */
const MAX_CUPS = 30;

interface WaterRow {
  id: string;
  date: string;
  ml: number;
}

/**
 * Stateful stand-in for `water_entries` + `/water/summary/daily`.
 *
 * Deliberately models ROWS rather than a per-day total: `POST /water/undo`
 * removes the most recently CREATED row of a day (health-service.ts
 * `removeLastWater`), so "two taps of +1 then one of −1" and "one tap of +2 then
 * one of −1" land on completely different numbers. A total-only fake would make
 * both look identical and hide the asymmetry STORE-048 pins.
 */
function fakeWaterLedger(seed: WaterRow[] = []): {
  rows: WaterRow[];
  totalFor: (date: string) => number;
} {
  const goal = fakeGoalServer(api);
  const state = { rows: [...seed] };
  let nextId = seed.length;
  const totalFor = (date: string) =>
    state.rows.filter((r) => r.date === date).reduce((sum, r) => sum + r.ml, 0);

  api.addWater.mockImplementation((body) => {
    const row = { id: `h2o_${nextId++}`, date: body.date, ml: body.amount_ml };
    state.rows.push(row);
    return Promise.resolve(
      ok({ entry: waterEntryRow({ id: row.id, date: row.date, amount_ml: row.ml }) })
    );
  });
  api.undoWater.mockImplementation((date) => {
    // Most recent FIRST — `state.rows` is append-ordered, so the last matching
    // index is the newest `created_at`.
    const index = state.rows.map((r) => r.date).lastIndexOf(date);
    if (index >= 0) state.rows.splice(index, 1);
    return Promise.resolve(ok({ removed: index >= 0 }));
  });
  api.waterSummary.mockImplementation((date) =>
    Promise.resolve(
      ok({
        summary: waterSummaryRow({
          date,
          total_ml: totalFor(date),
          goal_ml: goal.goal.daily_water_ml,
          entry_count: state.rows.filter((r) => r.date === date).length,
        }),
      })
    )
  );
  api.listWater.mockImplementation(() =>
    Promise.resolve(
      ok({
        entries: state.rows.map((r) =>
          waterEntryRow({ id: r.id, date: r.date, amount_ml: r.ml })
        ),
      })
    )
  );
  return { rows: state.rows, totalFor };
}

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]); // reset the module-level sync-state map
  __setHealthOfflineForTests(false);
  jest.resetAllMocks();
  installHealthApiDefaults(api);
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

/* ---------------------------------------------------------------- */
/* Millilitres → cups                                                */
/* ---------------------------------------------------------------- */

describe('water — millilitre/cup conversion', () => {
  it('HEALTH-STORE-063: a partial cup rounds to the nearest whole cup', async () => {
    // The server stores millilitres and the ring shows CUPS, so every volume a
    // member did not log through the ± control (the AI coach commits arbitrary
    // millilitres; a future preset would too) has to land on a whole number.
    // `Math.round` — so half a cup rounds UP.
    const cases: Array<[number, number]> = [
      [0, 0],
      [119, 0], // just under half a cup — still "nothing logged"
      [120, 1], // exactly half — rounds up
      [250, 1], // a 250 ml bottle is one cup
      [360, 2], // 1.5 cups — rounds up
      [CUP_ML * 3, 3],
    ];

    for (const [ml, cups] of cases) {
      await storageHelpers.clearAll();
      api.waterSummary.mockResolvedValue(ok({ summary: waterSummaryRow({ total_ml: ml }) }));
      expect((await loadWaterToday()).cups).toBe(cups);
    }
  });

  it('HEALTH-STORE-064: a summary-less or zero-goal response degrades, it does not throw', async () => {
    // Two independent falsy branches the Worker can legitimately produce:
    //  * `{}` — no `summary` key at all (an older Worker, or a 200 with an empty
    //    body); `total_ml ?? 0` has to carry it.
    //  * `goal_ml: 0` — a goal row that exists but has no water target. It is
    //    FALSY, so it must fall through to the cached target rather than being
    //    divided into a target of 0 (which `clampTarget` would then read as
    //    "invalid" and silently reset to 8 on every device).
    await storageHelpers.setObject(HEALTH_WATER_KEY, { date: TODAY, cups: 4, target: 12 });

    api.waterSummary.mockResolvedValue(ok({} as never));
    expect(await loadWaterToday()).toEqual<WaterDay>({ date: TODAY, cups: 0, target: 12 });

    await storageHelpers.setObject(HEALTH_WATER_KEY, { date: TODAY, cups: 4, target: 12 });
    api.waterSummary.mockResolvedValue(
      ok({ summary: waterSummaryRow({ total_ml: CUP_ML, goal_ml: 0 }) })
    );
    expect(await loadWaterToday()).toEqual<WaterDay>({ date: TODAY, cups: 1, target: 12 });
  });

  it('HEALTH-STORE-065: with neither a goal nor a cached target the ring falls back to 8', async () => {
    api.waterSummary.mockResolvedValue(ok({ summary: waterSummaryRow({ goal_ml: null }) }));

    // Nothing cached (a fresh install), so `cachedTarget` is undefined too.
    expect(await loadWaterToday()).toEqual<WaterDay>({
      date: TODAY,
      cups: 0,
      target: DEFAULT_WATER_TARGET,
    });
  });

  it('HEALTH-STORE-066: a total read failure with no cache yields an empty day, not a crash', async () => {
    api.waterSummary.mockRejectedValue(NETWORK_ERROR);

    // The offline path the cache exists for, on the one day there is no cache:
    // a cold start in a basement gym must render 0 / 8, never a spinner or a
    // raw error string (no-raw-error-leaks).
    expect(await loadWaterToday()).toEqual<WaterDay>({
      date: TODAY,
      cups: 0,
      target: DEFAULT_WATER_TARGET,
    });
    expect(healthSyncStateFor(HEALTH_WATER_KEY)).toBe('offline');
  });
});

/* ---------------------------------------------------------------- */
/* The floor at zero                                                 */
/* ---------------------------------------------------------------- */

describe('water — floor at zero cups', () => {
  it('HEALTH-STORE-067: minus on an empty day persists 0, never a negative count', async () => {
    const ledger = fakeWaterLedger();

    const day = await adjustWater(-1);

    expect(day.cups).toBe(0);
    // Two separate guards have to hold, because either alone would still ship a
    // negative to somewhere that matters:
    //  * the OPTIMISTIC value is clamped, so an offline tap cannot cache −1…
    expect(await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY)).toEqual<WaterDay>({
      date: TODAY,
      cups: 0,
      target: DEFAULT_WATER_TARGET,
    });
    //  * …and no phantom row is created server-side (undo of nothing is a no-op).
    expect(ledger.rows).toHaveLength(0);
    expect(api.addWater).not.toHaveBeenCalled();
  });

  it('HEALTH-STORE-068: an emptied day leaves NO zero-cup row in the Trends history', async () => {
    fakeWaterLedger();

    await adjustWater(1);
    expect(await loadWaterHistory()).toEqual([{ date: TODAY, cups: 1, target: 8 }]);

    await adjustWater(-1);

    // A stored `{cups: 0}` row would count as a TRACKED day in
    // `summarizeHydrationTrend` and drag the average down — an untracked day and
    // a day the member drained back to zero must read the same to Trends.
    expect(await loadWaterHistory()).toEqual([]);
    expect(await storageHelpers.getObject(HEALTH_WATER_HISTORY_KEY)).toEqual([]);
  });

  it('HEALTH-STORE-069: minus at zero is a no-op — no wasted undo round trip', async () => {
    fakeWaterLedger();

    // FIXED (was HEALTH-STORE-069): the client knows the count is already 0
    // (it just read it), and `adjustWater` now refuses to call the server when
    // the clamped count would not move, so no `POST /water/undo` fires at all.
    expect((await adjustWater(-1)).cups).toBe(0);
    expect(api.undoWater).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------- */
/* Rapid taps                                                        */
/* ---------------------------------------------------------------- */

describe('water — rapid repeated taps', () => {
  it('HEALTH-STORE-070: five awaited taps land five cups and five separate sips', async () => {
    const ledger = fakeWaterLedger();

    for (let i = 0; i < 5; i += 1) await adjustWater(1);

    expect((await loadWaterToday()).cups).toBe(5);
    // Five ROWS, not one 1200 ml row: each tap is its own sip, so a single undo
    // takes back one cup rather than the whole session.
    expect(ledger.rows).toHaveLength(5);
    expect(api.addWater).toHaveBeenCalledTimes(5);
    expect(api.addWater).toHaveBeenLastCalledWith({ date: TODAY, amount_ml: CUP_ML });
  });

  it('HEALTH-STORE-071: five CONCURRENT taps lose no write; the cache may lag and heals', async () => {
    const ledger = fakeWaterLedger();

    // What a real burst looks like: `handleWater` is fire-and-forget
    // (`onPress={() => void handleWater(1)}`), so five taps inside one animation
    // frame overlap rather than queue. `adjustWater` is read-modify-write with
    // no lock, so the OPTIMISTIC arithmetic of the overlapping calls is
    // necessarily stale.
    const results = await Promise.all([1, 1, 1, 1, 1].map((d) => adjustWater(d)));

    // The property that MUST hold: the server is the record, and every tap
    // reached it. Nothing is lost.
    expect(ledger.rows).toHaveLength(5);
    expect(ledger.totalFor(TODAY)).toBe(5 * CUP_ML);

    // The property that must NOT be asserted as exact: the value each racing
    // call returned. Each one re-reads after its own write, so every answer is
    // somewhere in 1..5 and monotone in completion order — never above the truth.
    for (const r of results) {
      expect(r.cups).toBeGreaterThanOrEqual(1);
      expect(r.cups).toBeLessThanOrEqual(5);
    }
    const cached = await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY);
    expect(cached?.cups).toBeLessThanOrEqual(5);

    // …and the next ordinary read heals whatever the race cached, which is what
    // makes the missing lock survivable rather than a data-loss bug.
    expect((await loadWaterToday()).cups).toBe(5);
    expect(await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY)).toMatchObject({ cups: 5 });
  });

  it('HEALTH-STORE-072: alternating taps settle back to an untracked day', async () => {
    const ledger = fakeWaterLedger();

    for (const delta of [1, -1, 1, -1, 1, -1]) await adjustWater(delta);

    expect((await loadWaterToday()).cups).toBe(0);
    expect(ledger.rows).toHaveLength(0);
    expect(await loadWaterHistory()).toEqual([]);
  });
});

/* ---------------------------------------------------------------- */
/* Day boundary                                                      */
/* ---------------------------------------------------------------- */

describe('water — day boundary crossed mid-session', () => {
  it('HEALTH-STORE-073: a tap after midnight is written against the NEW day', async () => {
    const ledger = fakeWaterLedger();
    await adjustWater(3);
    expect((await loadWaterToday()).cups).toBe(3);

    // The app is not restarted at midnight — the Home tab can sit open across
    // the boundary, and the next tap must not extend yesterday's total.
    jest.setSystemTime(new Date(2026, 6, 14, 0, 1, 0));

    expect(await loadWaterToday()).toEqual<WaterDay>({ date: TOMORROW, cups: 0, target: 8 });
    expect(api.waterSummary).toHaveBeenLastCalledWith(TOMORROW);

    const after = await adjustWater(1);
    expect(after).toEqual<WaterDay>({ date: TOMORROW, cups: 1, target: 8 });
    expect(api.addWater).toHaveBeenLastCalledWith({ date: TOMORROW, amount_ml: CUP_ML });
    expect(ledger.rows.map((r) => r.date)).toEqual([TODAY, TOMORROW]);
  });

  it('HEALTH-STORE-074: the cached snapshot is REPLACED by the new day, not merged', async () => {
    fakeWaterLedger();
    await setWaterTarget(10);
    await adjustWater(4);

    jest.setSystemTime(new Date(2026, 6, 14, 0, 1, 0));
    await loadWaterToday();

    // A snapshot still carrying yesterday's date would make every subsequent
    // `day.date !== today` rollover fire against a stale count.
    expect(await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY)).toEqual<WaterDay>({
      date: TOMORROW,
      cups: 0,
      target: 10, // the goal is effective-dated and carries across midnight
    });
  });

  it('HEALTH-STORE-075: crossing midnight OFFLINE opens a new history row, keeping yesterday', async () => {
    await storageHelpers.setObject(HEALTH_WATER_KEY, { date: TODAY, cups: 5, target: 10 });
    await storageHelpers.setObject(HEALTH_WATER_HISTORY_KEY, [
      { date: TODAY, cups: 5, target: 10 },
    ]);
    __setHealthOfflineForTests(true);

    jest.setSystemTime(new Date(2026, 6, 14, 0, 1, 0));
    const after = await adjustWater(1);

    // Offline is the ONLY way to reach the `day.date !== today` rollover branch
    // (online the server always answers for today), and it is exactly the
    // situation where it matters: a phone with no signal at 00:01.
    expect(after).toEqual<WaterDay>({ date: TOMORROW, cups: 1, target: 10 });
    expect(await loadWaterHistory()).toEqual([
      { date: TOMORROW, cups: 1, target: 10 },
      { date: TODAY, cups: 5, target: 10 },
    ]);
  });
});

/* ---------------------------------------------------------------- */
/* Goal reached, exceeded, and the ceiling                           */
/* ---------------------------------------------------------------- */

describe('water — goal reached and exceeded', () => {
  it('HEALTH-STORE-076: reaching the goal is not a stop — the count keeps climbing', async () => {
    fakeWaterLedger();
    await setWaterTarget(8);

    for (let i = 0; i < 8; i += 1) await adjustWater(1);
    const atGoal = await loadWaterToday();
    expect(atGoal.cups).toBe(atGoal.target); // 8 / 8

    const past = await adjustWater(1);
    // The clamp is the 30-cup sanity ceiling, never the goal: a member who
    // drinks more than their target must be able to log it, and Trends counts
    // `cups >= target` as a goal day either way.
    expect(past.cups).toBe(9);
    expect(past.cups).toBeGreaterThan(past.target);
    expect((await loadWaterHistory())[0]).toEqual({ date: TODAY, cups: 9, target: 8 });
  });

  it('HEALTH-STORE-077: a retarget restates the goal on today and in the history', async () => {
    fakeWaterLedger();
    await adjustWater(6);

    // 6/12 is short of the goal; 6/6 has met it. The target rides the shared
    // effective-dated goal row, so both surfaces have to move together.
    expect((await setWaterTarget(12)).target).toBe(12);
    expect(await loadWaterHistory()).toEqual([{ date: TODAY, cups: 6, target: 12 }]);

    expect((await setWaterTarget(6)).target).toBe(6);
    expect(await loadWaterHistory()).toEqual([{ date: TODAY, cups: 6, target: 6 }]);
    expect(api.saveGoal).toHaveBeenLastCalledWith({ daily_water_ml: 6 * CUP_ML });
  });

  it('HEALTH-STORE-078: at the 30-cup ceiling a plus tap is a true no-op, so minus never looks dead', async () => {
    // Seed the ceiling as ONE row so the arithmetic below is unambiguous.
    const ledger = fakeWaterLedger([{ id: 'seed', date: TODAY, ml: MAX_CUPS * CUP_ML }]);
    expect((await loadWaterToday()).cups).toBe(MAX_CUPS);

    // FIXED (was HEALTH-STORE-078): `adjustWater` now refuses to write when the
    // clamped count does not move, so a `+1` at the ceiling makes NO network
    // call and leaves the ledger untouched — no phantom 31st cup, and so no
    // later "Remove a cup" tap that looks dead behind the same clamp.
    expect((await adjustWater(1)).cups).toBe(MAX_CUPS);
    expect(ledger.totalFor(TODAY)).toBe(MAX_CUPS * CUP_ML);
    expect(ledger.rows).toHaveLength(1);
    expect(api.addWater).not.toHaveBeenCalled();

    // The very next minus is real and visible: it undoes the seeded row
    // wholesale (undo removes the last SIP, not one cup at a time) and the
    // ring drops straight to empty in a single tap.
    expect((await adjustWater(-1)).cups).toBe(0);
    expect(ledger.rows).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------- */
/* Undo semantics vs the Worker's per-entry delete                   */
/* ---------------------------------------------------------------- */

describe('water — undo is per-SIP, not per-cup', () => {
  it('HEALTH-STORE-079: undo removes the last SIP, whatever its size', async () => {
    const ledger = fakeWaterLedger();

    await adjustWater(2); // one 480 ml sip
    await adjustWater(1); // one 240 ml sip
    expect((await loadWaterToday()).cups).toBe(3);

    // The newest row goes first, so the count falls by ONE cup here…
    expect((await adjustWater(-1)).cups).toBe(2);
    expect(ledger.rows).toHaveLength(1);

    // …and by TWO on the next tap, because the remaining sip is a 2-cup one.
    // The shipped ± control only ever sends ±1, so this asymmetry is currently
    // unreachable from the UI — it is reachable from the AI coach's water
    // commit, which posts an arbitrary volume as a single entry.
    expect((await adjustWater(-1)).cups).toBe(0);
    expect(ledger.rows).toHaveLength(0);
  });

  it('HEALTH-STORE-080: the ±cup control NEVER reaches the per-entry delete route', async () => {
    // BOUNDARY GUARD between the two water writers.
    //
    // `DELETE /health/water/entries/:id` does ship and does have a client
    // (`healthApi.deleteWater` → healthWaterStorage.deleteWaterEntry → the Water
    // tab's per-row ✕). The ±1 control must never use it: it holds no entry id,
    // so an id-shaped delete from here could only ever be a guess at which row
    // to destroy. It uses `POST /water/undo` — "remove whatever was last" — and
    // that separation is the whole reason the undo route exists.
    const ledger = fakeWaterLedger();

    await adjustWater(1);
    await adjustWater(2);
    await adjustWater(-1);
    await adjustWater(-1);

    expect(ledger.rows).toHaveLength(0);
    expect(api.undoWater).toHaveBeenCalledTimes(2);
    expect(api.deleteWater).not.toHaveBeenCalled();

    // The real client's water surface, pinned so a new method lands as a
    // failure here and gets its own coverage rather than appearing silently.
    const actual = jest.requireActual<typeof import('@api/health')>('@api/health');
    expect(
      Object.keys(actual.healthApi)
        .filter((k) => /water/i.test(k))
        .sort()
    ).toEqual(['addWater', 'deleteWater', 'listWater', 'undoWater', 'waterSummary']);
  });
});

/* ---------------------------------------------------------------- */
/* Rolling history                                                   */
/* ---------------------------------------------------------------- */

describe('water — rolling history window', () => {
  it('HEALTH-STORE-081: the history is pulled as a 400-day window ending today', async () => {
    fakeWaterLedger();

    await loadWaterHistory();

    // 400 days ≈ 13 months, which is what makes the Trends year range honest on
    // a device that only just installed the app.
    expect(api.listWater).toHaveBeenCalledWith({ from: '2025-06-08', to: TODAY });
    expect(api.getGoal).toHaveBeenCalled();
  });

  it('HEALTH-STORE-082: server rows are grouped per day, newest first, sub-cup days dropped', async () => {
    fakeWaterLedger([
      { id: 'a', date: YESTERDAY, ml: 2 * CUP_ML },
      { id: 'b', date: TODAY, ml: CUP_ML },
      { id: 'c', date: TODAY, ml: CUP_ML }, // same day → one row of 2 cups
      { id: 'd', date: '2026-07-11', ml: 100 }, // rounds to 0 cups → dropped
    ]);
    api.getGoal.mockResolvedValue(ok({ goal: null }));

    expect(await loadWaterHistory()).toEqual([
      { date: TODAY, cups: 2, target: DEFAULT_WATER_TARGET },
      { date: YESTERDAY, cups: 2, target: DEFAULT_WATER_TARGET },
    ]);
  });

  it('HEALTH-STORE-083: the history is capped at 400 days, keeping the newest', async () => {
    const rows: WaterRow[] = [];
    for (let i = 0; i < 410; i += 1) {
      const d = new Date(2026, 6, 13);
      d.setDate(d.getDate() - i);
      rows.push({ id: `r${i}`, date: d.toISOString().slice(0, 10), ml: CUP_ML });
    }
    fakeWaterLedger(rows);

    const history = await loadWaterHistory();

    expect(history).toHaveLength(400);
    expect(history[0].date).toBe(TODAY); // newest kept
    expect(history.at(-1)?.date).toBe('2025-06-09'); // 400th day back
  });

  it('HEALTH-STORE-084: an out-of-order cached history is re-sorted on read', async () => {
    await storageHelpers.setObject(HEALTH_WATER_HISTORY_KEY, [
      { date: YESTERDAY, cups: 4, target: 8 },
      { date: TODAY, cups: 6, target: 8 },
      { date: '2026-07-11', cups: 2, target: 8 },
    ]);
    __setHealthOfflineForTests(true);

    // Trends slices "the last N days" off the front, so an unsorted cache would
    // silently report the wrong window.
    expect((await loadWaterHistory()).map((d) => d.date)).toEqual([
      TODAY,
      YESTERDAY,
      '2026-07-11',
    ]);
  });
});

/* ---------------------------------------------------------------- */
/* Offline writes                                                    */
/* ---------------------------------------------------------------- */

describe('water — offline writes', () => {
  it('HEALTH-STORE-085: a failed POST still advances the UI and marks the key offline', async () => {
    fakeWaterLedger();
    await adjustWater(2);
    api.addWater.mockRejectedValue(NETWORK_ERROR);

    const after = await adjustWater(1);

    // The tap is not lost to the member: the optimistic count is returned AND
    // cached, so the ring reflects what they just did.
    expect(after.cups).toBe(3);
    expect(await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY)).toMatchObject({ cups: 3 });
    expect(healthSyncStateFor(HEALTH_WATER_KEY)).toBe('offline');
    expect(await storageHelpers.getObject<WaterDay[]>(HEALTH_WATER_HISTORY_KEY)).toEqual([
      { date: TODAY, cups: 3, target: 8 },
    ]);

    // …and it is CORRECTED, not preserved: the history read-through still
    // succeeds (only the POST failed), so the server's own grouping replaces the
    // optimistic 3 with the 2 cups that actually landed. The cache is never
    // authoritative — that is what stops a failed write becoming a permanent
    // phantom cup in the Trends average.
    expect(await loadWaterHistory()).toEqual([{ date: TODAY, cups: 2, target: 8 }]);
  });

  it('HEALTH-STORE-086: a failed goal save keeps the chosen target locally', async () => {
    fakeWaterLedger();
    await adjustWater(1);
    api.saveGoal.mockRejectedValue(NETWORK_ERROR);

    expect((await setWaterTarget(14)).target).toBe(14);
    expect(await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY)).toMatchObject({
      target: 14,
    });
    expect(healthSyncStateFor(HEALTH_WATER_KEY)).toBe('offline');
  });
});
