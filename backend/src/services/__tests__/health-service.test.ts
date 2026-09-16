/**
 * HealthService — the derived-figure layer of the ported Symply Health domain.
 *
 * The routes are a thin pass-through (covered in routes/__tests__/health.test.ts);
 * everything a phone, a widget and a watch must AGREE on is computed here, so
 * this suite owns the maths:
 *   - the pure date/streak/cycle helpers (no D1 — plain function contracts),
 *   - the weekly weight rollup and the unit-safe statistics,
 *   - effective-dated goal resolution incl. the per-weekday calorie override,
 *   - server-computed habit streaks,
 *   - the cycle re-anchor + observed-cycle-length adoption,
 *   - delta-sync cursor semantics (tombstones must survive a pull).
 *
 * D1-backed specs run against live miniflare D1 with the migration-0119 DDL from
 * routes/__tests__/health-test-helpers.ts (same cross-directory helper pattern as
 * services/__tests__/savings-history.test.ts).
 */

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createHealthTables,
  resetHealthTables,
  seedHealthUsers,
} from '../../routes/__tests__/health-test-helpers';
import type { Env } from '../../types';
import { HealthRemindersService } from '../health-reminders-service';
import {
  HealthService,
  addDays,
  dayKey,
  daysBetween,
  observedCycleLength,
  streakOf,
  weekStartOf,
} from '../health-service';

const testEnv = env as unknown as Env;

const UID = 'u_svc_alice';
const OTHER = 'u_svc_bob';

// 2026-06-01 is a MONDAY and 2026-06-07 the Sunday that closes that week —
// every fixture below leans on that so the Monday-based rollup is checkable.
const MON = '2026-06-01';
const WED = '2026-06-03';
const SUN = '2026-06-07';
const NEXT_MON = '2026-06-08';

function svc(): HealthService {
  return new HealthService(testEnv.DB);
}

/**
 * `createNutrition` answers null for exactly one reason: `food_id` named a food
 * the caller does not own (0124). A fixture that does not send one must never
 * see it, so this fails loudly instead of letting a `null` flow on as an
 * unrelated error three assertions later.
 */
async function newNutrition(
  s: HealthService,
  input: Parameters<HealthService['createNutrition']>[1],
  userId = UID
) {
  const row = await s.createNutrition(userId, input);
  if (!row) throw new Error('fixture: createNutrition refused a row it should have written');
  return row;
}

/* ==================================================================== */
/* Pure helpers — no D1, no service instance                             */
/* ==================================================================== */

describe('health-service pure helpers', () => {
  describe('dayKey', () => {
    it('truncates an ISO stamp to its date', () => {
      expect(dayKey('2026-06-03T22:45:10.123Z')).toBe('2026-06-03');
    });
  });

  describe('weekStartOf (Monday-based, donor convention)', () => {
    it('returns the same day for a Monday', () => {
      expect(weekStartOf('2026-06-01')).toBe('2026-06-01');
    });

    it('walks a mid-week day back to its Monday', () => {
      expect(weekStartOf('2026-06-03')).toBe('2026-06-01'); // Wednesday
    });

    it('puts SUNDAY in the week that STARTED, not the one about to start', () => {
      // The ISO/donor rule and the classic off-by-one: JS getUTCDay() is 0 for
      // Sunday, so a naive `1 - dow` would jump forward a day.
      expect(weekStartOf('2026-06-07')).toBe('2026-06-01');
      expect(weekStartOf('2026-06-08')).toBe('2026-06-08'); // next Monday
    });

    it('crosses a month boundary', () => {
      expect(weekStartOf('2026-03-01')).toBe('2026-02-23'); // Sunday → Feb Monday
      expect(weekStartOf('2026-03-08')).toBe('2026-03-02');
    });

    it('crosses a year boundary', () => {
      // 2026-01-01 is a Thursday → its week started in 2025.
      expect(weekStartOf('2026-01-01')).toBe('2025-12-29');
    });
  });

  describe('addDays', () => {
    it('moves forward and backward', () => {
      expect(addDays('2026-06-03', 1)).toBe('2026-06-04');
      expect(addDays('2026-06-03', -1)).toBe('2026-06-02');
      expect(addDays('2026-06-03', 0)).toBe('2026-06-03');
    });

    it('crosses month, year and leap-day boundaries', () => {
      expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28'); // 2026 is not a leap year
      expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // 2028 is
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    });

    it('spans a whole year in one hop', () => {
      expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
    });
  });

  describe('daysBetween', () => {
    it('is zero for the same day and signed by direction', () => {
      expect(daysBetween('2026-06-03', '2026-06-03')).toBe(0);
      expect(daysBetween('2026-06-03', '2026-06-05')).toBe(2);
      expect(daysBetween('2026-06-05', '2026-06-03')).toBe(-2);
    });

    it('crosses month and year boundaries', () => {
      expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
      expect(daysBetween('2026-12-28', '2027-01-04')).toBe(7);
      expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
      expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29); // leap February
    });
  });

  describe('streakOf', () => {
    const TODAY = '2026-06-10';

    it('counts consecutive days ending TODAY', () => {
      expect(streakOf(['2026-06-10', '2026-06-09', '2026-06-08'], TODAY)).toBe(3);
    });

    it('stays alive when today is not ticked YET but yesterday was', () => {
      // A habit is not "broken" at 00:01 — the day is still in play.
      expect(streakOf(['2026-06-09', '2026-06-08'], TODAY)).toBe(2);
    });

    it('is zero once the anchor day itself is missed', () => {
      // Neither today nor yesterday → the run ended before this check.
      expect(streakOf(['2026-06-08', '2026-06-07'], TODAY)).toBe(0);
    });

    it('stops at the first gap', () => {
      expect(streakOf(['2026-06-10', '2026-06-09', '2026-06-07', '2026-06-06'], TODAY)).toBe(2);
    });

    it('is zero for an empty log', () => {
      expect(streakOf([], TODAY)).toBe(0);
    });

    it('does not care about order or duplicates', () => {
      expect(streakOf(['2026-06-08', '2026-06-10', '2026-06-09', '2026-06-09'], TODAY)).toBe(3);
    });

    it('counts a run that crosses a month boundary', () => {
      expect(streakOf(['2026-06-01', '2026-05-31', '2026-05-30'], '2026-06-01')).toBe(3);
    });

    it('ignores days in the future', () => {
      expect(streakOf(['2026-06-12', '2026-06-11'], TODAY)).toBe(0);
    });
  });

  describe('observedCycleLength', () => {
    it('is null until two runs exist', () => {
      expect(observedCycleLength([])).toBeNull();
      expect(observedCycleLength(['2026-06-01', '2026-06-02', '2026-06-03'])).toBeNull();
    });

    it('measures START to START, not day count', () => {
      // Two 3-day runs 28 days apart → 28, regardless of how many bleeding days.
      const days = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-29', '2026-06-30'];
      expect(observedCycleLength(days)).toBe(28);
    });

    it('averages several cycles and rounds to a whole day', () => {
      // Starts 06-01 → 06-29 (28) → 07-30 (31) → mean 29.5 → 30.
      const days = ['2026-06-01', '2026-06-29', '2026-07-30'];
      expect(observedCycleLength(days)).toBe(30);
    });

    it('ignores out-of-range gaps (< 20 or > 45 days)', () => {
      // A missed month or a double-logged spot would otherwise poison the mean.
      expect(observedCycleLength(['2026-06-01', '2026-06-10'])).toBeNull(); // 9 days
      expect(observedCycleLength(['2026-01-01', '2026-06-01'])).toBeNull(); // 151 days
      // Only the usable gap survives the mix: 06-01→07-01 = 30, 07-01→12-01 dropped.
      expect(observedCycleLength(['2026-06-01', '2026-07-01', '2026-12-01'])).toBe(30);
    });

    it('is insensitive to order and duplicates', () => {
      expect(observedCycleLength(['2026-06-29', '2026-06-01', '2026-06-01'])).toBe(28);
    });
  });
});

/* ==================================================================== */
/* D1-backed service behaviour                                           */
/* ==================================================================== */

describe('HealthService (D1)', () => {
  beforeEach(async () => {
    // Creates the P2 food tables too, which 0124's `nutrition_entries.food_id`
    // resolves its basis out of.
    await createHealthTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID, OTHER]);
  });

  /* ------------------------------ weight ---------------------------- */

  describe('weekly weight rollup', () => {
    it('stores average/min/max/count and the unit of the write', async () => {
      const s = svc();
      await s.createWeight(UID, { date: MON, weight: 70, unit: 'kg' });
      await s.createWeight(UID, { date: WED, weight: 71, unit: 'kg' });
      await s.createWeight(UID, { date: SUN, weight: 72, unit: 'kg' });

      const weeks = await s.weeklyAverages(UID);
      expect(weeks).toHaveLength(1); // Sunday belongs to the Monday week
      expect(weeks[0]).toMatchObject({
        week_start: MON,
        week_end: SUN,
        average_weight: 71,
        min_weight: 70,
        max_weight: 72,
        entry_count: 3,
        weight_unit: 'kg',
      });
    });

    it('keeps one row per (user, week) — a second write upserts, never appends', async () => {
      const s = svc();
      await s.createWeight(UID, { date: MON, weight: 70, unit: 'kg' });
      await s.createWeight(UID, { date: WED, weight: 80, unit: 'kg' });
      const rows = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS n FROM health_weekly_weight_averages WHERE user_id = ?'
      )
        .bind(UID)
        .first<{ n: number }>();
      expect(rows?.n).toBe(1);
      expect((await s.weeklyAverages(UID))[0].average_weight).toBe(75);
    });

    it('splits entries into their own weeks', async () => {
      const s = svc();
      await s.createWeight(UID, { date: SUN, weight: 70, unit: 'kg' });
      await s.createWeight(UID, { date: NEXT_MON, weight: 90, unit: 'kg' });
      const weeks = await s.weeklyAverages(UID);
      expect(weeks.map((w) => w.week_start)).toEqual([NEXT_MON, MON]); // newest first
      expect(weeks.map((w) => w.average_weight)).toEqual([90, 70]);
    });

    it('removes the week row when its last entry is deleted', async () => {
      const s = svc();
      const entry = await s.createWeight(UID, { date: MON, weight: 70, unit: 'kg' });
      expect(await s.weeklyAverages(UID)).toHaveLength(1);
      expect(await s.deleteWeight(UID, entry.id)).toBe(true);
      // A left-behind rollup would keep charting a weight the user erased.
      expect(await s.weeklyAverages(UID)).toEqual([]);
    });

    it('recomputes (not just deletes) when one of several entries goes', async () => {
      const s = svc();
      const keep = await s.createWeight(UID, { date: MON, weight: 70, unit: 'kg' });
      const drop = await s.createWeight(UID, { date: WED, weight: 90, unit: 'kg' });
      await s.deleteWeight(UID, drop.id);
      const weeks = await s.weeklyAverages(UID);
      expect(weeks[0]).toMatchObject({ average_weight: 70, min_weight: 70, max_weight: 70, entry_count: 1 });
      expect(keep.id).toBeTruthy();
    });

    it('recomputes on update', async () => {
      const s = svc();
      const entry = await s.createWeight(UID, { date: MON, weight: 70, unit: 'kg' });
      await s.updateWeight(UID, entry.id, { weight: 68 });
      expect((await s.weeklyAverages(UID))[0]).toMatchObject({ average_weight: 68, entry_count: 1 });
    });

    it('recomputes BOTH weeks when an entry is re-dated across a week boundary', async () => {
      // Re-dating moves the entry between weeks. Recomputing only the NEW week
      // would leave the old one counting a weight that is no longer in it — an
      // emptied week reporting entry_count: 1. Fixed 2026-07-25 (was BUG-3).
      const s = svc();
      const entry = await s.createWeight(UID, { date: WED, weight: 70, unit: 'kg' });
      await s.updateWeight(UID, entry.id, { date: NEXT_MON });

      const weeks = await s.weeklyAverages(UID);
      // The emptied week is dropped entirely rather than left at zero entries.
      expect(weeks.map((w) => w.week_start)).toEqual([NEXT_MON]);
      expect(weeks[0]).toMatchObject({ entry_count: 1, average_weight: 70 });
      expect(await s.listWeight(UID, { from: MON, to: SUN })).toEqual([]);
    });

    it('scopes the rollup per user', async () => {
      const s = svc();
      await s.createWeight(UID, { date: MON, weight: 70, unit: 'kg' });
      await s.createWeight(OTHER, { date: MON, weight: 95, unit: 'kg' });
      expect((await s.weeklyAverages(UID))[0].average_weight).toBe(70);
      expect((await s.weeklyAverages(OTHER))[0].average_weight).toBe(95);
    });
  });

  describe('weightStatistics', () => {
    it('averages, rounds to one decimal and reports the raw min/max', async () => {
      const s = svc();
      await s.createWeight(UID, { date: MON, weight: 70.11, unit: 'kg' });
      await s.createWeight(UID, { date: WED, weight: 70.29, unit: 'kg' });
      const stats = await s.weightStatistics(UID);
      expect(stats).toMatchObject({
        count: 2,
        unit: 'kg',
        latest: 70.29,
        first: 70.11,
        change: 0.2,
        average: 70.2,
        min: 70.11,
        max: 70.29,
      });
    });

    it('compares only entries sharing the LATEST unit', async () => {
      // Reporting kg→lb as a change would tell a stable user they gained 84.
      const s = svc();
      await s.createWeight(UID, { date: MON, weight: 70, unit: 'kg' });
      await s.createWeight(UID, { date: WED, weight: 154, unit: 'lb' });
      const stats = await s.weightStatistics(UID);
      expect(stats.unit).toBe('lb');
      expect(stats.count).toBe(1);
      expect(stats.change).toBe(0);
      expect(stats.min).toBe(154);
    });

    it("treats the donor's 'lbs' and the app's 'lb' as different units", async () => {
      // Documents the accepted-but-distinct spelling from migration 0119: a
      // donor-imported 'lbs' row is NOT folded into a native 'lb' comparison.
      const s = svc();
      await s.createWeight(UID, { date: MON, weight: 154, unit: 'lbs' });
      await s.createWeight(UID, { date: WED, weight: 152, unit: 'lb' });
      const stats = await s.weightStatistics(UID);
      expect(stats.unit).toBe('lb');
      expect(stats.count).toBe(1);
    });

    it('honours the `from` window', async () => {
      const s = svc();
      await s.createWeight(UID, { date: MON, weight: 70, unit: 'kg' });
      await s.createWeight(UID, { date: SUN, weight: 68, unit: 'kg' });
      const windowed = await s.weightStatistics(UID, WED);
      expect(windowed.count).toBe(1);
      expect(windowed.latest).toBe(68);
    });

    it('excludes soft-deleted entries', async () => {
      const s = svc();
      const gone = await s.createWeight(UID, { date: MON, weight: 70, unit: 'kg' });
      await s.deleteWeight(UID, gone.id);
      expect(await s.weightStatistics(UID)).toMatchObject({ count: 0, unit: null, change: null });
    });
  });

  describe('weight scoping + delete semantics', () => {
    it('refuses to update or delete another user row', async () => {
      const s = svc();
      const mine = await s.createWeight(UID, { date: MON, weight: 70, unit: 'kg' });
      expect(await s.updateWeight(OTHER, mine.id, { weight: 999 })).toBeNull();
      expect(await s.deleteWeight(OTHER, mine.id)).toBe(false);
      const row = await testEnv.DB.prepare(
        'SELECT weight, deleted_at FROM weight_entries WHERE id = ?'
      )
        .bind(mine.id)
        .first<{ weight: number; deleted_at: string | null }>();
      expect(row).toMatchObject({ weight: 70, deleted_at: null });
    });

    it('a repeat delete reports not-found rather than re-stamping the tombstone', async () => {
      const s = svc();
      const entry = await s.createWeight(UID, { date: MON, weight: 70, unit: 'kg' });
      expect(await s.deleteWeight(UID, entry.id)).toBe(true);
      expect(await s.deleteWeight(UID, entry.id)).toBe(false); // already gone
      expect(await s.listWeight(UID)).toEqual([]);
      expect(await s.weeklyAverages(UID)).toEqual([]);
    });
  });

  /* ------------------------------ water ----------------------------- */

  describe('water', () => {
    async function seedWater(id: string, date: string, amount: number, createdAt: string, user = UID) {
      await testEnv.DB.prepare(
        `INSERT INTO water_entries (id, user_id, date, amount_ml, beverage_type, container, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, 'water', NULL, ?, ?, NULL)`
      )
        .bind(id, user, date, amount, createdAt, createdAt)
        .run();
    }

    it('removes the latest sip by created_at, not by insert order', async () => {
      // created_at is seeded out of order on purpose — the ± cup control sends
      // no id, so "last" has to be resolved from the data.
      await seedWater('h2o_b', MON, 200, '2026-06-01T18:00:00.000Z');
      await seedWater('h2o_a', MON, 100, '2026-06-01T07:00:00.000Z');

      expect(await svc().removeLastWater(UID, MON)).toBe(true);
      const left = await svc().listWater(UID);
      expect(left.map((r) => r.id)).toEqual(['h2o_a']);
    });

    it('is a no-op when the day is empty or already undone', async () => {
      await seedWater('h2o_a', MON, 100, '2026-06-01T07:00:00.000Z');
      expect(await svc().removeLastWater(UID, SUN)).toBe(false); // other day
      expect(await svc().removeLastWater(UID, MON)).toBe(true);
      expect(await svc().removeLastWater(UID, MON)).toBe(false); // nothing left
    });

    it('never reaches into another user day', async () => {
      await seedWater('h2o_theirs', MON, 100, '2026-06-01T07:00:00.000Z', OTHER);
      expect(await svc().removeLastWater(UID, MON)).toBe(false);
      expect(await svc().listWater(OTHER)).toHaveLength(1);
    });

    it('summarises with a null goal when none is set', async () => {
      await seedWater('h2o_a', MON, 250, '2026-06-01T07:00:00.000Z');
      await seedWater('h2o_b', MON, 250, '2026-06-01T08:00:00.000Z');
      expect(await svc().waterDailySummary(UID, MON)).toEqual({
        date: MON,
        total_ml: 500,
        goal_ml: null,
        entry_count: 2,
      });
    });
  });

  /* ------------------------------ goals ----------------------------- */

  describe('goals (effective-dated)', () => {
    it('resolves the goal in force ON a date, never the newest one', async () => {
      const s = svc();
      await s.saveGoal(UID, MON, { daily_calories: 1800 });
      await s.saveGoal(UID, SUN, { daily_calories: 2400 });

      expect((await s.goalFor(UID, MON))?.daily_calories).toBe(1800);
      expect((await s.goalFor(UID, WED))?.daily_calories).toBe(1800); // still the old one
      expect((await s.goalFor(UID, SUN))?.daily_calories).toBe(2400);
      expect((await s.goalFor(UID, NEXT_MON))?.daily_calories).toBe(2400);
      expect(await s.goalFor(UID, '2026-05-31')).toBeNull(); // before the first goal
    });

    it('starts from the donor defaults when nothing exists yet', async () => {
      const saved = await svc().saveGoal(UID, MON, {});
      expect(saved).toMatchObject({
        daily_calories: 2000,
        use_per_day_calories: false,
        exclude_burned_calories: false,
      });
    });

    it('is scoped per user', async () => {
      const s = svc();
      await s.saveGoal(UID, MON, { daily_calories: 1800 });
      expect(await s.goalFor(OTHER, MON)).toBeNull();
    });

    it('applies the per-weekday calorie override', async () => {
      // 2026-06-01 is Monday, 06-02 Tuesday, 06-07 Sunday — the array is indexed
      // by getUTCDay() (0=Sunday), the classic place to be off by one.
      const s = svc();
      await s.saveGoal(UID, MON, {
        daily_calories: 2000,
        use_per_day_calories: true,
        monday_calories: 1500,
        sunday_calories: 2600,
      });

      expect((await s.nutritionSummary(UID, MON)).goal?.calories).toBe(1500);
      expect((await s.nutritionSummary(UID, SUN)).goal?.calories).toBe(2600);
      // Tuesday was never given a value → fall back to the daily target.
      expect((await s.nutritionSummary(UID, '2026-06-02')).goal?.calories).toBe(2000);
    });

    it('ignores the per-weekday columns while the switch is off', async () => {
      const s = svc();
      await s.saveGoal(UID, MON, {
        daily_calories: 2000,
        use_per_day_calories: false,
        monday_calories: 1500,
      });
      expect((await s.nutritionSummary(UID, MON)).goal?.calories).toBe(2000);
    });

    it('applies the per-weekday macro override', async () => {
      const s = svc();
      await s.saveGoal(UID, MON, {
        daily_protein_grams: 150,
        daily_carbs_grams: 200,
        daily_fats_grams: 60,
        use_per_day_macros: true,
        monday_protein_grams: 220,
        monday_carbs_grams: 150,
        monday_fats_grams: 70,
        sunday_protein_grams: 120,
      });

      const mon = (await s.nutritionSummary(UID, MON)).goal;
      expect(mon?.proteins).toBe(220);
      expect(mon?.carbohydrates).toBe(150);
      expect(mon?.fats).toBe(70);

      // Sunday only set protein → carbs/fats fall back to the daily target.
      const sun = (await s.nutritionSummary(UID, SUN)).goal;
      expect(sun?.proteins).toBe(120);
      expect(sun?.carbohydrates).toBe(200);
      expect(sun?.fats).toBe(60);

      // Tuesday was never given a value → fall back to the daily target.
      const tue = (await s.nutritionSummary(UID, '2026-06-02')).goal;
      expect(tue?.proteins).toBe(150);
      expect(tue?.carbohydrates).toBe(200);
      expect(tue?.fats).toBe(60);
    });

    it('ignores the per-weekday macro columns while the switch is off', async () => {
      const s = svc();
      await s.saveGoal(UID, MON, {
        daily_protein_grams: 150,
        daily_carbs_grams: 200,
        daily_fats_grams: 60,
        use_per_day_macros: false,
        monday_protein_grams: 220,
      });
      const mon = (await s.nutritionSummary(UID, MON)).goal;
      expect(mon?.proteins).toBe(150);
    });
  });

  /* ------------------------------ habits ---------------------------- */

  describe('habits', () => {
    function today(offset = 0): string {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    }

    it('returns days newest-first with a server-computed streak', async () => {
      const s = svc();
      const habit = await s.createHabit(UID, { name: 'Stretch' });
      for (const d of [today(-1), today(0), today(-2)]) {
        await s.toggleHabit(UID, habit.id, d);
      }
      const [listed] = await s.listHabits(UID);
      expect(listed.days).toEqual([today(0), today(-1), today(-2)]);
      expect(listed.streak).toBe(3);
    });

    it('reports a broken streak as 0 without losing the days', async () => {
      const s = svc();
      const habit = await s.createHabit(UID, { name: 'Stretch' });
      await s.toggleHabit(UID, habit.id, today(-4));
      await s.toggleHabit(UID, habit.id, today(-5));
      const [listed] = await s.listHabits(UID);
      expect(listed.days).toHaveLength(2);
      expect(listed.streak).toBe(0);
    });

    it('drops an unticked day out of the streak', async () => {
      const s = svc();
      const habit = await s.createHabit(UID, { name: 'Stretch' });
      await s.toggleHabit(UID, habit.id, today(0));
      await s.toggleHabit(UID, habit.id, today(-1));
      expect((await s.listHabits(UID))[0].streak).toBe(2);
      await s.toggleHabit(UID, habit.id, today(-1)); // untick yesterday
      const [listed] = await s.listHabits(UID);
      expect(listed.days).toEqual([today(0)]);
      expect(listed.streak).toBe(1);
    });

    it('hides archived and soft-deleted habits from the list', async () => {
      const s = svc();
      const archived = await s.createHabit(UID, { name: 'Archived' });
      const deleted = await s.createHabit(UID, { name: 'Deleted' });
      await s.createHabit(UID, { name: 'Live' });
      await testEnv.DB.prepare('UPDATE user_habits SET is_archived = 1 WHERE id = ?')
        .bind(archived.id)
        .run();
      await s.deleteHabit(UID, deleted.id);

      const listed = await s.listHabits(UID);
      expect(listed.map((h) => h.name)).toEqual(['Live']);
    });

    it('never counts another user logs toward a streak', async () => {
      const s = svc();
      const mine = await s.createHabit(UID, { name: 'Stretch' });
      const theirs = await s.createHabit(OTHER, { name: 'Stretch' });
      await s.toggleHabit(OTHER, theirs.id, today(0));
      expect((await s.listHabits(UID))[0]).toMatchObject({ streak: 0 });
      expect((await s.listHabits(UID))[0].days).toEqual([]);
      expect(mine.id).not.toBe(theirs.id);
    });

    it('refuses to delete another user habit', async () => {
      const s = svc();
      const mine = await s.createHabit(UID, { name: 'Stretch' });
      expect(await s.deleteHabit(OTHER, mine.id)).toBe(false);
      expect(await s.listHabits(UID)).toHaveLength(1);
    });
  });

  /* ------------------------------ cycle ----------------------------- */

  describe('cycle', () => {
    it('adopts the observed cycle length when a new run starts', async () => {
      const s = svc();
      for (const d of ['2026-06-01', '2026-06-02']) await s.logPeriodDay(UID, d, 3);
      await s.logPeriodDay(UID, '2026-07-01', 3);
      const settings = await s.getCycleSettings(UID);
      expect(settings).toMatchObject({ last_period_start: '2026-07-01', cycle_length: 30 });
    });

    it('re-anchors but KEEPS the previous length when the gap is out of range', async () => {
      // A 9-day gap is a mis-log, not a cycle — the prediction must not follow it.
      const s = svc();
      await s.saveCycleSettings(UID, { cycle_length: 28 });
      await s.logPeriodDay(UID, '2026-06-01', 3);
      await s.logPeriodDay(UID, '2026-06-10', 3);
      const settings = await s.getCycleSettings(UID);
      expect(settings).toMatchObject({ last_period_start: '2026-06-10', cycle_length: 28 });
    });

    it('does not re-anchor for a day that merely continues the current run', async () => {
      const s = svc();
      await s.logPeriodDay(UID, '2026-06-01', 3);
      await s.logPeriodDay(UID, '2026-06-02', 4);
      await s.logPeriodDay(UID, '2026-06-03', 2);
      expect((await s.getCycleSettings(UID))?.last_period_start).toBe('2026-06-01');
    });

    it('upserts a day and tombstones a removal', async () => {
      const s = svc();
      await s.logPeriodDay(UID, '2026-06-01', 2, 'light');
      await s.logPeriodDay(UID, '2026-06-01', 5, 'heavy');
      const rows = await s.listPeriods(UID);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ flow_level: 5, notes: 'heavy' });

      expect(await s.removePeriodDay(UID, '2026-06-01')).toBe(true);
      expect(await s.listPeriods(UID)).toEqual([]);
      const tombstone = await testEnv.DB.prepare(
        'SELECT deleted_at FROM period_entries WHERE user_id = ? AND date = ?'
      )
        .bind(UID, '2026-06-01')
        .first<{ deleted_at: string | null }>();
      expect(tombstone?.deleted_at).toBeTruthy();
    });

    it('revives a removed day when it is logged again', async () => {
      const s = svc();
      await s.logPeriodDay(UID, '2026-06-01', 3);
      await s.removePeriodDay(UID, '2026-06-01');
      await s.logPeriodDay(UID, '2026-06-01', 4);
      expect(await s.listPeriods(UID)).toHaveLength(1);
    });

    it('HEALTH-CYCLE-120: deleting the ANCHOR day moves the anchor to the last remaining run start', async () => {
      // Without the re-anchor, `last_period_start` keeps pointing at a date that
      // no longer has an entry: the screen goes on showing a cycle day, a phase
      // and a prediction derived from a period the person just deleted.
      const s = svc();
      for (const d of ['2026-06-01', '2026-06-02']) await s.logPeriodDay(UID, d, 3);
      for (const d of ['2026-07-01', '2026-07-02']) await s.logPeriodDay(UID, d, 3);
      expect((await s.getCycleSettings(UID))?.last_period_start).toBe('2026-07-01');

      expect(await s.removePeriodDay(UID, '2026-07-01')).toBe(true);
      const after = await s.getCycleSettings(UID);
      // 2026-07-02 has no logged day before it any more, so it IS the run start.
      expect(after?.last_period_start).toBe('2026-07-02');
    });

    it('HEALTH-CYCLE-121: deleting the LAST period day clears the anchor rather than stranding it', async () => {
      // The "log a period day to start tracking" empty state has to be able to
      // come back; a stale anchor makes it unreachable forever.
      const s = svc();
      await s.logPeriodDay(UID, '2026-06-01', 3);
      expect((await s.getCycleSettings(UID))?.last_period_start).toBe('2026-06-01');

      await s.removePeriodDay(UID, '2026-06-01');
      expect((await s.getCycleSettings(UID))?.last_period_start).toBeNull();
    });

    it('HEALTH-CYCLE-122: deleting a NON-anchor day leaves the anchor exactly where it was', async () => {
      const s = svc();
      for (const d of ['2026-06-01', '2026-06-02', '2026-06-03']) await s.logPeriodDay(UID, d, 3);
      await s.removePeriodDay(UID, '2026-06-03');
      expect((await s.getCycleSettings(UID))?.last_period_start).toBe('2026-06-01');
    });

    it('HEALTH-CYCLE-123: removing a day that was never logged changes nothing', async () => {
      const s = svc();
      await s.logPeriodDay(UID, '2026-06-01', 3);
      expect(await s.removePeriodDay(UID, '2026-06-20')).toBe(false);
      expect((await s.getCycleSettings(UID))?.last_period_start).toBe('2026-06-01');
      expect(await s.listPeriods(UID)).toHaveLength(1);
    });

    it('HEALTH-CYCLE-124: re-anchoring also re-derives the observed cycle length from what is left', async () => {
      const s = svc();
      // Three runs, 30 then 31 days apart → observed 31 after the last log.
      for (const d of ['2026-06-01', '2026-07-01', '2026-08-01']) await s.logPeriodDay(UID, d, 3);
      expect((await s.getCycleSettings(UID))?.cycle_length).toBe(31);

      // Dropping the newest run leaves one 30-day gap.
      await s.removePeriodDay(UID, '2026-08-01');
      const after = await s.getCycleSettings(UID);
      expect(after).toMatchObject({ last_period_start: '2026-07-01', cycle_length: 30 });
    });

    it('keeps symptom upserts per (user, date)', async () => {
      const s = svc();
      await s.saveCycleSymptoms(UID, '2026-06-01', { mood: 3, cramps: 2 });
      const updated = await s.saveCycleSymptoms(UID, '2026-06-01', { mood: 5 });
      expect(updated).toMatchObject({ mood: 5, cramps: 2 });
      await s.saveCycleSymptoms(OTHER, '2026-06-01', { mood: 1 });
      expect(await s.listCycleSymptoms(UID)).toHaveLength(1);
      expect((await s.listCycleSymptoms(UID))[0].mood).toBe(5);
    });
  });

  /* --------------------------- mens health -------------------------- */

  describe('mens health', () => {
    it('upserts by (user, date) and leaves omitted fields alone', async () => {
      const s = svc();
      await s.saveMensHealth(UID, MON, { libido: 7, energy_level: 6 });
      const updated = await s.saveMensHealth(UID, MON, { mood: 9 });
      expect(updated).toMatchObject({ libido: 7, energy_level: 6, mood: 9 });
      expect(await s.listMensHealth(UID)).toHaveLength(1);
    });

    it('keeps users in separate rows for the same date', async () => {
      const s = svc();
      await s.saveMensHealth(UID, MON, { libido: 7 });
      await s.saveMensHealth(OTHER, MON, { libido: 1 });
      expect((await s.listMensHealth(UID))[0].libido).toBe(7);
      expect((await s.listMensHealth(OTHER))[0].libido).toBe(1);
    });

    it('creates then patches the settings singleton', async () => {
      const s = svc();
      expect(await s.getMensHealthSettings(UID)).toBeNull();
      await s.saveMensHealthSettings(UID, { track_libido: false });
      await s.saveMensHealthSettings(UID, { reminder_enabled: true, reminder_time: '07:30' });
      expect(await s.getMensHealthSettings(UID)).toMatchObject({
        track_libido: false,
        reminder_enabled: true,
        reminder_time: '07:30',
        track_energy: true,
      });
      const count = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS n FROM mens_health_settings'
      ).first<{ n: number }>();
      expect(count?.n).toBe(1);
    });
  });

  /* ---------------------- generic entries / steps -------------------- */

  describe('generic entries', () => {
    it('upserts the MANUAL steps row and leaves HealthKit samples alone', async () => {
      // The donor let HealthKit write several samples a day; only the manual
      // row is the one the ± control owns, so the upsert filters on source.
      const s = svc();
      await testEnv.DB.prepare(
        `INSERT INTO health_entries (id, user_id, date, entry_type, data, source, created_at, updated_at, deleted_at)
         VALUES ('he_hk', ?, ?, 'steps', '{"steps":1234}', 'healthkit', '2026-06-01T01:00:00.000Z', '2026-06-01T01:00:00.000Z', NULL)`
      )
        .bind(UID, MON)
        .run();

      const first = await s.setSteps(UID, MON, 5000);
      const second = await s.setSteps(UID, MON, 9000);
      expect(second.id).toBe(first.id); // same row updated

      const rows = await s.listHealthEntries(UID, { type: 'steps' });
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === 'he_hk')?.data).toBe('{"steps":1234}');
      expect(JSON.parse(rows.find((r) => r.id === first.id)?.data ?? '{}')).toEqual({ steps: 9000 });
    });

    it('reads the freshest steps value into the daily summary', async () => {
      const s = svc();
      await s.setSteps(UID, MON, 4321);
      await s.saveGoal(UID, MON, { daily_steps: 10000 });
      const summary = await s.dailySummary(UID, MON);
      expect(summary.steps).toEqual({ value: 4321, goal: 10000 });
    });

    it('starts a fresh day rather than carrying yesterday steps forward', async () => {
      const s = svc();
      await s.setSteps(UID, MON, 4321);
      expect((await s.dailySummary(UID, WED)).steps.value).toBe(0);
    });
  });

  /* ------------------------------- sync ------------------------------ */

  describe('daily summary robustness', () => {
    it('HEALTH-DASH-120: a steps row whose blob carries no step count reads as zero, not NaN', async () => {
      // `health_entries.data` is free-form TEXT. A row written by an older
      // client, or a HealthKit import that stored the sample under a different
      // key, still has to render the Home dashboard.
      const s = svc();
      await testEnv.DB.prepare(
        `INSERT INTO health_entries (id, user_id, date, entry_type, data, source, created_at, updated_at, deleted_at)
         VALUES ('he_odd_steps', ?, ?, 'steps', '{"count":8000}', 'manual', '2026-06-01T08:00:00.000Z', '2026-06-01T08:00:00.000Z', NULL)`
      )
        .bind(UID, MON)
        .run();

      const summary = await s.dailySummary(UID, MON);
      expect(summary.steps.value).toBe(0);
      expect(Number.isNaN(summary.steps.value)).toBe(false);
    });
  });

  describe('delta sync', () => {
    it('hands back a tombstone for every soft-deleted table', async () => {
      const s = svc();
      const weight = await s.createWeight(UID, { date: MON, weight: 70, unit: 'kg' });
      const water = await s.createWater(UID, { date: MON, amount_ml: 250 });
      const food = await newNutrition(s, {
        date: MON,
        food_name: 'Egg',
        meal_type: 'breakfast',
        calories: 70,
      });
      const entry = await s.createHealthEntry(UID, { date: MON, entry_type: 'sleep', data: { h: 8 } });
      const habit = await s.createHabit(UID, { name: 'Stretch' });
      await s.toggleHabit(UID, habit.id, MON);
      await s.logPeriodDay(UID, MON, 3);

      await s.deleteWeight(UID, weight.id);
      await s.deleteWater(UID, water.id);
      await s.deleteNutrition(UID, food.id);
      await s.deleteHealthEntry(UID, entry.id);
      await s.deleteHabit(UID, habit.id);
      await s.toggleHabit(UID, habit.id, MON); // untick → habit_log tombstone
      await s.removePeriodDay(UID, MON);

      const pull = await s.sync(UID, '1970-01-01T00:00:00.000Z');
      // A hard delete would drop these rows and the other device would re-add them.
      const tombstoned = [
        pull.weight_entries,
        pull.water_entries,
        pull.nutrition_entries,
        pull.health_entries,
        pull.habits,
        pull.habit_logs,
        pull.period_entries,
      ];
      for (const rows of tombstoned) {
        expect(rows).toHaveLength(1);
        expect(rows[0].deleted_at).toBeTruthy();
      }
    });

    it('filters by the cursor (inclusive) and never crosses users', async () => {
      const s = svc();
      const mine = await s.createWeight(UID, { date: MON, weight: 70, unit: 'kg' });
      await s.createWeight(OTHER, { date: MON, weight: 95, unit: 'kg' });

      // The row's own stamp is INCLUDED — a client replaying `server_time` sees
      // the boundary row twice rather than missing it.
      const atCursor = await s.sync(UID, mine.updated_at);
      expect(atCursor.weight_entries.map((r) => r.id)).toEqual([mine.id]);

      const future = await s.sync(UID, '2999-01-01T00:00:00.000Z');
      expect(future.weight_entries).toEqual([]);
      expect(future.since).toBe('2999-01-01T00:00:00.000Z');
      expect(future.server_time).toBeTruthy();

      const theirs = await s.sync(OTHER, '1970-01-01T00:00:00.000Z');
      expect(theirs.weight_entries.map((r) => r.id)).not.toContain(mine.id);
    });

    it('includes body measurements, symptoms and mens-health rows', async () => {
      const s = svc();
      await s.createMeasurement(UID, { date: MON, unit: 'cm', waist: 80 });
      await s.saveCycleSymptoms(UID, MON, { mood: 3 });
      await s.saveMensHealth(UID, MON, { libido: 5 });
      const pull = await s.sync(UID, '1970-01-01T00:00:00.000Z');
      expect(pull.body_measurements).toHaveLength(1);
      expect(pull.cycle_symptom_entries).toHaveLength(1);
      expect(pull.mens_health_entries).toHaveLength(1);
    });

    /**
     * `health_reminder_preferences` (0134) is a member's real, hand-configured
     * reminder schedule and, unlike `widget_preferences` / `activity_notification_
     * preferences`, it also carries a TOMBSTONE. Missing from `sync()` meant a
     * reinstalled or second device could never see the schedule OR the wipe —
     * both would silently read back as the all-OFF defaults. `HEALTH-SYNC-201`
     * only proves the table is WIRED UP; this proves the round trip actually
     * carries the member's data and the tombstone.
     */
    it('carries the reminder schedule, and its tombstone, through the pull', async () => {
      const s = svc();
      const reminders = new HealthRemindersService(testEnv.DB);

      const saved = await reminders.savePreferences(UID, {
        meals_enabled: true,
        breakfast_enabled: true,
        breakfast_time: '07:15',
      });

      const afterSave = await s.sync(UID, '1970-01-01T00:00:00.000Z');
      expect(afterSave.reminder_preferences).toHaveLength(1);
      expect(afterSave.reminder_preferences[0]).toMatchObject({
        user_id: UID,
        meals_enabled: true,
        breakfast_time: '07:15',
      });

      // Filtering by a cursor strictly after the save excludes it — same
      // `updated_at` cursor contract every other sync collection honours.
      const future = await s.sync(UID, '2999-01-01T00:00:00.000Z');
      expect(future.reminder_preferences).toEqual([]);

      // Never another member's row.
      const theirs = await s.sync(OTHER, '1970-01-01T00:00:00.000Z');
      expect(theirs.reminder_preferences).toEqual([]);

      await reminders.clearPreferences(UID);
      const afterClear = await s.sync(UID, saved.updated_at ?? '1970-01-01T00:00:00.000Z');
      expect(afterClear.reminder_preferences).toHaveLength(1);
      expect(afterClear.reminder_preferences[0].deleted_at).toBeTruthy();
    });
  });

  /* -------------------------- measurements --------------------------- */

  describe('measurements', () => {
    it('lists newest-first, exposes the latest and hides soft-deleted rows', async () => {
      const s = svc();
      const older = await s.createMeasurement(UID, { date: MON, unit: 'cm', waist: 84 });
      const newer = await s.createMeasurement(UID, { date: SUN, unit: 'cm', waist: 82 });
      expect((await s.listMeasurements(UID)).map((m) => m.id)).toEqual([newer.id, older.id]);
      expect((await s.latestMeasurement(UID))?.id).toBe(newer.id);

      expect(await s.deleteMeasurement(UID, newer.id)).toBe(true);
      expect((await s.latestMeasurement(UID))?.id).toBe(older.id);
      expect(await s.listMeasurements(UID)).toHaveLength(1);
    });

    it('returns null when the user has none and refuses cross-user deletes', async () => {
      const s = svc();
      expect(await s.latestMeasurement(UID)).toBeNull();
      const mine = await s.createMeasurement(UID, { date: MON, unit: 'cm', waist: 84 });
      expect(await s.deleteMeasurement(OTHER, mine.id)).toBe(false);
      expect(await s.listMeasurements(UID)).toHaveLength(1);
    });

    /* -------------------- updateMeasurement (0131) ---------------------- */

    describe('updateMeasurement', () => {
      it('drops `undefined` patch values instead of writing them as SQL NULL', async () => {
        // The route already strips unknown/undefined keys via zod, so this is a
        // direct-service case: any other caller handing this method a plain
        // object with an `undefined` member (e.g. a spread from a partial
        // record) must not have that member clobber the stored value.
        const s = svc();
        const row = await s.createMeasurement(UID, { date: MON, unit: 'cm', waist: 84, chest: 100 });
        const updated = await s.updateMeasurement(UID, row.id, {
          waist: undefined,
          chest: 101,
        });
        expect(updated).toMatchObject({ waist: 84, chest: 101 });
      });

      it('returns null for an unknown id, a stranger’s row, and an already-tombstoned row', async () => {
        const s = svc();
        expect(await s.updateMeasurement(UID, 'bm_nope', { waist: 1 })).toBeNull();

        const mine = await s.createMeasurement(UID, { date: MON, unit: 'cm', waist: 84 });
        expect(await s.updateMeasurement(OTHER, mine.id, { waist: 1 })).toBeNull();

        await s.deleteMeasurement(UID, mine.id);
        expect(await s.updateMeasurement(UID, mine.id, { waist: 1 })).toBeNull();
      });

      it('an explicit null clears a site; omitting it keeps the stored value', async () => {
        const s = svc();
        const row = await s.createMeasurement(UID, { date: MON, unit: 'cm', waist: 84, chest: 100 });
        const cleared = await s.updateMeasurement(UID, row.id, { waist: null });
        expect(cleared).toMatchObject({ waist: null, chest: 100 });
      });
    });
  });

  /* --------------------------- nutrition ----------------------------- */

  describe('nutrition summary', () => {
    it('buckets unknown meal types into snack rather than dropping them', async () => {
      // Defensive branch in the service: a donor row with an unexpected slot
      // must still count toward the day, never vanish from the totals.
      await testEnv.DB.prepare(
        `INSERT INTO nutrition_entries (id, user_id, date, food_name, portion, unit, meal_type, calories, proteins, carbohydrates, fats, created_at, updated_at, deleted_at)
         VALUES ('n_odd', ?, ?, 'Midnight toast', 1, 'serving', 'snack', 200, 5, 30, 4, '2026-06-01T23:00:00.000Z', '2026-06-01T23:00:00.000Z', NULL)`
      )
        .bind(UID, MON)
        .run();
      const summary = await svc().nutritionSummary(UID, MON);
      expect(summary.by_meal.snack).toEqual({
        calories: 200,
        proteins: 5,
        carbohydrates: 30,
        fats: 4,
      });
      expect(summary.totals.calories).toBe(200);
    });

    it('excludes soft-deleted food from the totals', async () => {
      const s = svc();
      const food = await newNutrition(s, {
        date: MON,
        food_name: 'Cake',
        meal_type: 'snack',
        calories: 500,
      });
      await s.deleteNutrition(UID, food.id);
      const summary = await s.nutritionSummary(UID, MON);
      expect(summary.entry_count).toBe(0);
      expect(summary.totals).toEqual({ calories: 0, proteins: 0, carbohydrates: 0, fats: 0 });
    });

    it('refuses cross-user updates and deletes', async () => {
      const s = svc();
      const mine = await newNutrition(s, {
        date: MON,
        food_name: 'Egg',
        meal_type: 'breakfast',
        calories: 70,
      });
      expect(await s.updateNutrition(OTHER, mine.id, { calories: 9999 })).toBeNull();
      expect(await s.deleteNutrition(OTHER, mine.id)).toBe(false);
      expect((await s.nutritionSummary(UID, MON)).totals.calories).toBe(70);
    });
  });

  /* ================================================================== */
  /* 0124 — GAP 1: an entry can be UPDATED                               */
  /* ================================================================== */

  describe('updateHealthEntry (0124)', () => {
    it('HEALTH-ACT-140: edits IN PLACE — same id, same created_at, new updated_at', async () => {
      const s = svc();
      const created = await s.createHealthEntry(UID, {
        date: MON,
        entry_type: 'workout',
        data: { workout_type: 'run', minutes: 30, calories: 200, note: '' },
      });

      const updated = await s.updateHealthEntry(UID, created.id, {
        data: { workout_type: 'run', minutes: 45, calories: 300, note: 'tempo' },
      });

      // The whole point of the gap: the row keeps its identity. Re-recording
      // minted a new id and a new created_at, which moved the session to the
      // top of its day and made the screen apologise for it in copy.
      expect(updated?.id).toBe(created.id);
      expect(updated?.created_at).toBe(created.created_at);
      expect(JSON.parse(updated?.data ?? '{}')).toEqual({
        workout_type: 'run',
        minutes: 45,
        calories: 300,
        note: 'tempo',
      });

      const rows = await s.listHealthEntries(UID, { type: 'workout' });
      expect(rows).toHaveLength(1); // never a duplicate
    });

    it('HEALTH-ACT-141: REPLACES the data blob wholesale, so a key can be removed', async () => {
      const s = svc();
      const created = await s.createHealthEntry(UID, {
        date: MON,
        entry_type: 'sleep',
        data: { hours: 8, quality: 4 },
      });

      const updated = await s.updateHealthEntry(UID, created.id, { data: { hours: 7 } });

      // Donor contract (`PUT /entries/:id`): a merge would make `quality`
      // impossible to delete.
      expect(JSON.parse(updated?.data ?? '{}')).toEqual({ hours: 7 });
    });

    it('HEALTH-ACT-142: can re-date an entry, which the donor route could not', async () => {
      const s = svc();
      const created = await s.createHealthEntry(UID, {
        date: MON,
        entry_type: 'workout',
        data: { workout_type: 'walk', minutes: 20 },
      });

      expect((await s.updateHealthEntry(UID, created.id, { date: WED }))?.date).toBe(WED);
      expect((await s.listHealthEntries(UID, { from: WED, to: WED }))[0].id).toBe(created.id);
    });

    it('HEALTH-ACT-143: leaves every field the patch did not name alone', async () => {
      const s = svc();
      const created = await s.createHealthEntry(UID, {
        date: MON,
        entry_type: 'workout',
        data: { workout_type: 'swim', minutes: 30 },
        source: 'healthkit',
        intensity: 'hard',
      });

      const updated = await s.updateHealthEntry(UID, created.id, { date: WED });

      expect(updated?.source).toBe('healthkit');
      expect(updated?.intensity).toBe('hard');
      expect(JSON.parse(updated?.data ?? '{}')).toEqual({ workout_type: 'swim', minutes: 30 });
    });

    it('HEALTH-ACT-170: can re-origin an entry and can null its payload', async () => {
      // `source` is what the HealthKit importer keys "do not overwrite" on, so
      // an edit has to be able to move a row from imported to hand-typed — the
      // same correction `PUT /weight/entries/:id` gained for a weight reading.
      const s = svc();
      const created = await s.createHealthEntry(UID, {
        date: MON,
        entry_type: 'steps',
        data: { steps: 8000 },
        source: 'healthkit',
      });

      const reOrigined = await s.updateHealthEntry(UID, created.id, {
        source: 'manual',
        data: { steps: 9200 },
      });
      expect(reOrigined?.source).toBe('manual');
      expect(JSON.parse(reOrigined?.data ?? '{}')).toEqual({ steps: 9200 });

      // An explicit null payload becomes an empty object, never the string
      // "null" — the reader of `data` always gets valid JSON.
      const emptied = await s.updateHealthEntry(UID, created.id, { data: null });
      expect(JSON.parse(emptied?.data ?? 'null')).toEqual({});
    });

    it("HEALTH-ACT-144: refuses another user's entry, an unknown id and a tombstone alike", async () => {
      const s = svc();
      const mine = await s.createHealthEntry(UID, {
        date: MON,
        entry_type: 'workout',
        data: { workout_type: 'run', minutes: 30 },
      });

      // All three answer null → 404. A 403 would confirm the id exists.
      expect(await s.updateHealthEntry(OTHER, mine.id, { date: WED })).toBeNull();
      expect(await s.updateHealthEntry(UID, 'he_nope', { date: WED })).toBeNull();

      await s.deleteHealthEntry(UID, mine.id);
      expect(await s.updateHealthEntry(UID, mine.id, { date: WED })).toBeNull();
      // The tombstone is untouched: editing it would bump `updated_at` and
      // re-deliver a deleted row through the delta pull.
      const pull = await s.sync(UID, '1970-01-01T00:00:00.000Z');
      expect(pull.health_entries[0].date).toBe(MON);
    });
  });

  describe('updateWorkoutEntry (0124)', () => {
    it('HEALTH-ACT-145: MERGES the typed payload — an untouched note survives', async () => {
      const s = svc();
      const created = await s.createHealthEntry(UID, {
        date: MON,
        entry_type: 'workout',
        data: { workout_type: 'run', minutes: 30, calories: 200, note: 'hill repeats' },
      });

      const updated = await s.updateWorkoutEntry(UID, created.id, { minutes: 45 });

      expect(JSON.parse(updated?.data ?? '{}')).toEqual({
        workout_type: 'run',
        minutes: 45,
        calories: 200,
        note: 'hill repeats',
      });
    });

    it('HEALTH-ACT-146: refuses an entry that is not a workout', async () => {
      const s = svc();
      const sleep = await s.createHealthEntry(UID, {
        date: MON,
        entry_type: 'sleep',
        data: { hours: 8 },
      });

      expect(await s.updateWorkoutEntry(UID, sleep.id, { minutes: 45 })).toBeNull();
      // The blob is untouched — rewriting it into the workout shape would
      // silently corrupt a sleep record.
      expect(JSON.parse((await s.listHealthEntries(UID, { type: 'sleep' }))[0].data)).toEqual({
        hours: 8,
      });
    });

    it('HEALTH-ACT-147: starts from scratch when the stored blob is unparseable', async () => {
      const s = svc();
      await testEnv.DB.prepare(
        `INSERT INTO health_entries (id, user_id, date, entry_type, data, source, created_at, updated_at, deleted_at)
         VALUES ('he_broken', ?, ?, 'workout', 'not json', 'manual', '2026-06-01T08:00:00.000Z', '2026-06-01T08:00:00.000Z', NULL)`
      )
        .bind(UID, MON)
        .run();

      const updated = await s.updateWorkoutEntry(UID, 'he_broken', {
        workout_type: 'run',
        minutes: 20,
      });

      // Keeping half of a corrupt payload is worse than the fields just typed.
      expect(JSON.parse(updated?.data ?? '{}')).toEqual({ workout_type: 'run', minutes: 20 });
    });

    it('HEALTH-ACT-171: a blob that parses but is NOT an object is replaced, not spread', async () => {
      // `JSON.parse` succeeds for `[1,2]`, `"text"` and `null` — spreading any
      // of those into the merge yields `{0:1,1:2}` or `{}` with the type lost.
      // The catch above never fires for these, so they need their own guard.
      const s = svc();
      for (const [id, blob] of [
        ['he_arr', '[1,2,3]'],
        ['he_str', '"just a note"'],
        ['he_null', 'null'],
      ] as const) {
        await testEnv.DB.prepare(
          `INSERT INTO health_entries (id, user_id, date, entry_type, data, source, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, 'workout', ?, 'manual', '2026-06-01T08:00:00.000Z', '2026-06-01T08:00:00.000Z', NULL)`
        )
          .bind(id, UID, MON, blob)
          .run();

        const updated = await s.updateWorkoutEntry(UID, id, { workout_type: 'row', minutes: 15 });
        expect(JSON.parse(updated?.data ?? '{}')).toEqual({ workout_type: 'row', minutes: 15 });
      }
    });

    it('HEALTH-ACT-172: each typed field is merged independently of the others', async () => {
      // Every key of the workout payload has its own "did the caller name it?"
      // arm; a shared one would make editing the note reset the calories.
      const s = svc();
      const created = await s.createHealthEntry(UID, {
        date: MON,
        entry_type: 'workout',
        data: { workout_type: 'run', minutes: 30, calories: 200, note: 'hill repeats' },
      });

      const calsOnly = await s.updateWorkoutEntry(UID, created.id, { calories: 355 });
      expect(JSON.parse(calsOnly?.data ?? '{}')).toEqual({
        workout_type: 'run',
        minutes: 30,
        calories: 355,
        note: 'hill repeats',
      });

      const noteOnly = await s.updateWorkoutEntry(UID, created.id, { note: 'easy jog' });
      expect(JSON.parse(noteOnly?.data ?? '{}')).toEqual({
        workout_type: 'run',
        minutes: 30,
        calories: 355,
        note: 'easy jog',
      });

      // …and an empty note is a real value, not "leave it alone".
      const cleared = await s.updateWorkoutEntry(UID, created.id, { note: '' });
      expect(JSON.parse(cleared?.data ?? '{}').note).toBe('');
    });
  });

  /* ================================================================== */
  /* 0124 — GAP 2: a workout has an INTENSITY column                     */
  /* ================================================================== */

  describe('workout intensity (0124)', () => {
    it('HEALTH-ACT-148: stores intensity in its own column, not inside the note', async () => {
      const s = svc();
      const created = await s.createHealthEntry(UID, {
        date: MON,
        entry_type: 'workout',
        data: { workout_type: 'run', minutes: 30, calories: 0, note: 'hill repeats' },
        intensity: 'hard',
      });

      expect(created.intensity).toBe('hard');
      // The tag-smuggling this replaces is gone: the note is exactly what was
      // typed, with no `[hard] ` prefix.
      expect(JSON.parse(created.data).note).toBe('hill repeats');
    });

    it('HEALTH-ACT-149: defaults to NULL — "not recorded" is a real state', async () => {
      const s = svc();
      const created = await s.createHealthEntry(UID, {
        date: MON,
        entry_type: 'workout',
        data: { workout_type: 'walk', minutes: 20 },
      });
      expect(created.intensity).toBeNull();
    });

    it('HEALTH-ACT-150: an explicit null CLEARS it, so the picker can go back to default', async () => {
      const s = svc();
      const created = await s.createHealthEntry(UID, {
        date: MON,
        entry_type: 'workout',
        data: { workout_type: 'run', minutes: 30 },
        intensity: 'max',
      });

      // Omitting the key keeps the old value; sending null un-records it. Both
      // are needed, which is why the route schema is `.nullable().optional()`.
      expect((await s.updateWorkoutEntry(UID, created.id, { minutes: 31 }))?.intensity).toBe('max');
      expect((await s.updateWorkoutEntry(UID, created.id, { intensity: null }))?.intensity).toBeNull();
    });

    it('HEALTH-ACT-151: rides the existing sync cursor — no separate plumbing', async () => {
      const s = svc();
      await s.createHealthEntry(UID, {
        date: MON,
        entry_type: 'workout',
        data: { workout_type: 'run', minutes: 30 },
        intensity: 'easy',
      });

      const pull = await s.sync(UID, '1970-01-01T00:00:00.000Z');
      expect(pull.health_entries[0].intensity).toBe('easy');
    });
  });

  /* ================================================================== */
  /* 0124 — GAP 3: a nutrition row can be RE-PORTIONED                   */
  /* ================================================================== */

  describe('nutrition basis + reportion (0124)', () => {
    /** A library food with a clean 100 g basis: 200 kcal / 10 P / 30 C / 5 F. */
    async function seedFood(userId = UID, id = 'cf_rice'): Promise<string> {
      await testEnv.DB.prepare(
        `INSERT INTO custom_foods
           (id, user_id, name, portion, unit, calories, proteins, carbohydrates, fats,
            base_calories_per_100, base_proteins_per_100, base_carbs_per_100, base_fats_per_100,
            created_at, updated_at)
         VALUES (?, ?, 'Rice', 100, 'g', 200, 10, 30, 5, 200, 10, 30, 5,
                 '2026-06-01T08:00:00.000Z', '2026-06-01T08:00:00.000Z')`
      )
        .bind(id, userId)
        .run();
      return id;
    }

    it('HEALTH-NUTR-112: takes the basis from the FOOD when the entry names one', async () => {
      const s = svc();
      const foodId = await seedFood();

      const row = await s.createNutrition(UID, {
        date: MON,
        food_name: 'Rice',
        meal_type: 'lunch',
        calories: 300,
        proteins: 15,
        carbohydrates: 45,
        fats: 7.5,
        portion: 150,
        unit: 'g',
        food_id: foodId,
      });

      expect(row?.food_id).toBe(foodId);
      expect(row?.base_calories_per_100).toBe(200);
      expect(row?.base_proteins_per_100).toBe(10);
      expect(row?.base_carbs_per_100).toBe(30);
      expect(row?.base_fats_per_100).toBe(5);
    });

    it("HEALTH-NUTR-113: refuses a food_id the caller does not own, and writes NOTHING", async () => {
      const s = svc();
      const theirs = await seedFood(OTHER, 'cf_theirs');

      const row = await s.createNutrition(UID, {
        date: MON,
        food_name: 'Rice',
        meal_type: 'lunch',
        calories: 300,
        food_id: theirs,
      });

      // A dangling pointer would make the row claim a provenance it has not got.
      expect(row).toBeNull();
      expect(await s.listNutrition(UID, { date: MON })).toEqual([]);
      // Unknown id answers identically, so a probe cannot tell the two apart.
      expect(
        await s.createNutrition(UID, {
          date: MON,
          food_name: 'Rice',
          meal_type: 'lunch',
          calories: 300,
          food_id: 'cf_nope',
        })
      ).toBeNull();
    });

    it('HEALTH-NUTR-114: derives a basis from a hand-typed entry, exactly and reversibly', async () => {
      const s = svc();
      const row = await newNutrition(s, {
        date: MON,
        food_name: 'Porridge',
        meal_type: 'breakfast',
        calories: 180,
        proteins: 6,
        carbohydrates: 30,
        fats: 3,
        portion: 50,
        unit: 'g',
      });

      // 180 kcal per 50 g → 360 per 100 g.
      expect(row.base_calories_per_100).toBe(360);

      // And the identity that makes this safe: re-applying the ORIGINAL portion
      // returns the original figures rather than drifting a little each time.
      const same = await s.reportionNutrition(UID, row.id, 50);
      expect(same.ok && same.entry.calories).toBe(180);
      expect(same.ok && same.entry.proteins).toBe(6);
    });

    it('HEALTH-NUTR-115: re-derives macros for a new portion, keeping id, day and slot', async () => {
      const s = svc();
      const foodId = await seedFood();
      const row = await newNutrition(s, {
        date: MON,
        food_name: 'Rice',
        meal_type: 'lunch',
        calories: 200,
        proteins: 10,
        carbohydrates: 30,
        fats: 5,
        portion: 100,
        unit: 'g',
        food_id: foodId,
      });

      const result = await s.reportionNutrition(UID, row.id, 250);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.entry.id).toBe(row.id);
      expect(result.entry.date).toBe(MON);
      expect(result.entry.meal_type).toBe('lunch');
      expect(result.entry.portion).toBe(250);
      expect(result.entry.calories).toBe(500);
      expect(result.entry.proteins).toBe(25);
      expect(result.entry.carbohydrates).toBe(75);
      expect(result.entry.fats).toBe(12.5);
      // The day total follows, which is the reason the user changed it.
      expect((await s.nutritionSummary(UID, MON)).totals.calories).toBe(500);
    });

    it('HEALTH-NUTR-169: correcting the macros re-derives the basis they will be re-portioned from', async () => {
      // The defect: `updateNutrition` spread the patch and left `base_*_per_100`
      // at whatever the row was created with. So the row showed the corrected
      // figures while `canReportion` still pointed at the OLD basis, and the next
      // portion change silently re-derived from the numbers the member had just
      // corrected away — quietly undoing the correction.
      const s = svc();
      const row = await newNutrition(s, {
        date: MON,
        food_name: 'Rice',
        meal_type: 'lunch',
        calories: 200,
        proteins: 10,
        carbohydrates: 30,
        fats: 5,
        portion: 100,
        unit: 'g',
      });

      // The label was wrong: it is really 260 kcal per 100 g.
      await s.updateNutrition(UID, row.id, { calories: 260, proteins: 12 });

      // Doubling the portion now follows the CORRECTED figure, not the old one.
      const doubled = await s.reportionNutrition(UID, row.id, 200);
      expect(doubled.ok && doubled.entry.calories).toBe(520);
      expect(doubled.ok && doubled.entry.proteins).toBe(24);

      // …and coming back to the original portion returns the correction intact,
      // rather than resurrecting the 200 kcal the member replaced.
      const back = await s.reportionNutrition(UID, row.id, 100);
      expect(back.ok && back.entry.calories).toBe(260);
      expect(back.ok && back.entry.proteins).toBe(12);
    });

    it('HEALTH-NUTR-170: a free-hand row re-derives too — one serving is still a basis', async () => {
      // A row logged without a portion is stored as one serving, so its basis is
      // "this much per serving". That is a real statement, and correcting the
      // figure has to move it like any other — otherwise doubling the helping
      // afterwards would double the number the member just replaced.
      const s = svc();
      const row = await newNutrition(s, {
        date: MON,
        food_name: 'Leftovers',
        meal_type: 'dinner',
        calories: 400,
      });

      await s.updateNutrition(UID, row.id, { calories: 450 });

      const twoHelpings = await s.reportionNutrition(UID, row.id, 2);
      expect(twoHelpings.ok && twoHelpings.entry.calories).toBe(900);
    });

    it('HEALTH-NUTR-171: an edit that touches no macro leaves the basis alone', async () => {
      // Moving a row between slots is not a statement about what the food is.
      const s = svc();
      const row = await newNutrition(s, {
        date: MON,
        food_name: 'Rice',
        meal_type: 'lunch',
        calories: 200,
        proteins: 10,
        carbohydrates: 30,
        fats: 5,
        portion: 100,
        unit: 'g',
      });

      await s.updateNutrition(UID, row.id, { meal_type: 'dinner' });

      const doubled = await s.reportionNutrition(UID, row.id, 200);
      expect(doubled.ok && doubled.entry.calories).toBe(400);
    });

    it('HEALTH-NUTR-116: derives from the BASIS every time, so repeated edits never drift', async () => {
      const s = svc();
      const row = await newNutrition(s, {
        date: MON,
        food_name: 'Rice',
        meal_type: 'lunch',
        calories: 200,
        proteins: 10,
        carbohydrates: 30,
        fats: 5,
        portion: 100,
        unit: 'g',
      });

      // Scaling the CURRENT macros instead would compound the rounding of every
      // intermediate step; deriving from the stored basis cannot.
      await s.reportionNutrition(UID, row.id, 33);
      await s.reportionNutrition(UID, row.id, 7);
      const back = await s.reportionNutrition(UID, row.id, 100);

      expect(back.ok && back.entry.calories).toBe(200);
      expect(back.ok && back.entry.proteins).toBe(10);
      expect(back.ok && back.entry.carbohydrates).toBe(30);
      expect(back.ok && back.entry.fats).toBe(5);
    });

    it('HEALTH-NUTR-117: answers no_basis for a pre-0124 row rather than silently doing nothing', async () => {
      const s = svc();
      // A row from before the columns existed: NULL basis, no food.
      await testEnv.DB.prepare(
        `INSERT INTO nutrition_entries (id, user_id, date, food_name, portion, unit, meal_type, calories, proteins, carbohydrates, fats, created_at, updated_at, deleted_at)
         VALUES ('n_legacy', ?, ?, 'Soup', 1, 'serving', 'lunch', 300, 10, 40, 5, '2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z', NULL)`
      )
        .bind(UID, MON)
        .run();

      const result = await s.reportionNutrition(UID, 'n_legacy', 2);

      expect(result).toEqual({ ok: false, reason: 'no_basis' });
      // Untouched — the client says "this one was typed in" instead.
      expect((await s.listNutrition(UID, { date: MON }))[0].calories).toBe(300);
    });

    it("HEALTH-NUTR-118: refuses another user's row, an unknown id and a tombstone alike", async () => {
      const s = svc();
      const mine = await newNutrition(s, {
        date: MON,
        food_name: 'Rice',
        meal_type: 'lunch',
        calories: 200,
        portion: 100,
      });

      expect(await s.reportionNutrition(OTHER, mine.id, 200)).toEqual({
        ok: false,
        reason: 'not_found',
      });
      expect(await s.reportionNutrition(UID, 'n_nope', 200)).toEqual({
        ok: false,
        reason: 'not_found',
      });

      await s.deleteNutrition(UID, mine.id);
      expect(await s.reportionNutrition(UID, mine.id, 200)).toEqual({
        ok: false,
        reason: 'not_found',
      });
    });

    it('HEALTH-NUTR-119: a copied day carries its provenance and basis forward', async () => {
      const s = svc();
      const foodId = await seedFood();
      await newNutrition(s, {
        date: MON,
        food_name: 'Rice',
        meal_type: 'lunch',
        calories: 200,
        proteins: 10,
        carbohydrates: 30,
        fats: 5,
        portion: 100,
        unit: 'g',
        food_id: foodId,
      });

      const copied = await s.copyNutritionDay(UID, MON, WED);

      // Without this, yesterday's rice becomes un-re-portionable the moment it
      // is copied onto today.
      expect(copied[0].food_id).toBe(foodId);
      expect(copied[0].base_calories_per_100).toBe(200);
      const rescaled = await s.reportionNutrition(UID, copied[0].id, 50);
      expect(rescaled.ok && rescaled.entry.calories).toBe(100);
    });

    it('HEALTH-NUTR-218: a ZERO portion stores no basis rather than dividing by it', async () => {
      // The coach reaches here: `prepare_log_meal` accepts `grams: 0` (optNum
      // allows any non-negative number) and passes it straight through as the
      // portion. `basisFrom(x, 0)` would be a basis of zeroes that reads as a
      // real measurement and makes every later re-portion answer 0 kcal.
      const s = svc();
      const row = await newNutrition(s, {
        date: MON,
        food_name: 'Leftover stew',
        meal_type: 'dinner',
        calories: 300,
        portion: 0,
      });
      expect(row.base_calories_per_100).toBeNull();
      // …and the app is told so rather than being offered a rescale that lies.
      expect(await s.reportionNutrition(UID, row.id, 200)).toEqual({
        ok: false,
        reason: 'no_basis',
      });
    });

    it('HEALTH-NUTR-216: a bulk batch keeps the rows it CAN write when one names a missing food', async () => {
      // The copy-day / copy-meal sheets are the callers. Failing the whole batch
      // would lose eleven good rows because the twelfth pointed at a food that
      // had been hard-deleted on another device.
      const s = svc();
      const foodId = await seedFood();
      const created = await s.createNutritionBulk(UID, [
        { date: MON, food_name: 'Rice', meal_type: 'lunch', calories: 200, food_id: foodId },
        // Not this user's food — createNutrition answers null for it.
        { date: MON, food_name: 'Ghost', meal_type: 'lunch', calories: 100, food_id: 'cf_missing' },
        { date: MON, food_name: 'Apple', meal_type: 'snack', calories: 80 },
      ]);
      expect(created.map((r) => r.food_name)).toEqual(['Rice', 'Apple']);
      expect(await s.listNutrition(UID, { date: MON })).toHaveLength(2);
    });

    it('HEALTH-NUTR-217: list windows filter by from/to, inclusive at both ends', async () => {
      const s = svc();
      for (const [date, name] of [
        ['2026-05-31', 'Before'],
        [MON, 'Start'],
        [WED, 'Middle'],
        [SUN, 'End'],
        [NEXT_MON, 'After'],
      ] as const) {
        await newNutrition(s, { date, food_name: name, meal_type: 'snack', calories: 10 });
        await s.createWater(UID, { date, amount_ml: 100 });
      }

      const window = await s.listNutrition(UID, { from: MON, to: SUN });
      expect(window.map((r) => r.food_name)).toEqual(['Start', 'Middle', 'End']);
      // A one-sided window is honoured too.
      expect((await s.listNutrition(UID, { from: SUN })).map((r) => r.food_name)).toEqual([
        'End',
        'After',
      ]);
      expect((await s.listNutrition(UID, { to: MON })).map((r) => r.food_name)).toEqual([
        'Before',
        'Start',
      ]);

      const water = await s.listWater(UID, { from: MON, to: SUN });
      expect(water.map((r) => r.date)).toEqual([SUN, WED, MON]); // newest first
      expect(await s.listWater(UID, { from: NEXT_MON })).toHaveLength(1);
      expect(await s.listWater(UID, { to: '2026-05-31' })).toHaveLength(1);
    });

    it('HEALTH-NUTR-120: the new columns ride the existing sync cursor', async () => {
      const s = svc();
      const foodId = await seedFood();
      await newNutrition(s, {
        date: MON,
        food_name: 'Rice',
        meal_type: 'lunch',
        calories: 200,
        portion: 100,
        unit: 'g',
        food_id: foodId,
      });

      const pull = await s.sync(UID, '1970-01-01T00:00:00.000Z');
      expect(pull.nutrition_entries[0].food_id).toBe(foodId);
      expect(pull.nutrition_entries[0].base_calories_per_100).toBe(200);
    });
  });
});
