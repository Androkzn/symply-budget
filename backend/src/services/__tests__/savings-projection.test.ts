/**
 * Savings Projection read model + target writes.
 *
 * The Projection tab contrasts what a household HAS saved with what it could,
 * so the invariants under test are mostly about which months count where:
 *  - a month's actual net is `getYearHistory`'s net (income − ALL spending), so
 *    Projection can never disagree with the Year-history grid or the trend;
 *  - elapsed/current/future classification is driven by the injected clock;
 *  - `paceMonthly` averages COMPLETED months with data only — the partial
 *    current month must not drag the pace down every 1st of the month;
 *  - a future month with no target still projects at the pace — negative pace
 *    included, so the year-end figure is truthful, not floored at $0;
 *  - the current month is counted ONCE in `projectedYearEnd` (via its own
 *    projection, which already folds in its actual) — never double-counted;
 *  - `potentialMonthly` is the better of the recent pace and the household's
 *    OWN best completed month — never an invented number, never below the
 *    current pace, and never artificially floored at $0 either;
 *  - targets upsert per (household, period), bulk-apply over many months, and
 *    clear by DELETE (absence of a row ≠ a target of $0).
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { budgetGoals, expenses, budgetCategories } from '../../db/schema-budget';
import {
  savingsIncomeEntries,
  savingsIncomeTemplates,
  savingsMonthlyTargets,
  savingsGoals,
  savingsRecurringPayments,
} from '../../db/schema-savings';
import {
  createSavingsTables,
  resetSavingsTables,
} from '../../routes/__tests__/savings-test-helpers';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { SavingsService } from '../savings-service';

const testEnv = env as unknown as Env;
const HID = 'hh_projection_01';
const UID = 'u_projection_owner';
const MID = 'm_projection_owner';
const OUTSIDER = 'u_projection_outsider';

const YEAR = 2026;
/** "Today" for every test: 15 Jul 2026 — Jan–Jun elapsed, Jul live, Aug–Dec ahead. */
const NOW = new Date('2026-07-15T12:00:00Z');

function db() {
  return drizzle(testEnv.DB, { schema });
}

function service(): SavingsService {
  return new SavingsService(testEnv, testEnv.DB);
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createSavingsTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetSavingsTables(testEnv.DB);

  const d = db();
  await d.insert(schema.users).values([
    { id: UID, email: 'owner@example.com', email_verified: true, display_name: 'Owner' },
    { id: OUTSIDER, email: 'outsider@example.com', email_verified: true, display_name: 'Nope' },
  ]);
  await d.insert(schema.households).values({ id: HID, name: 'ProjectionTest' });
  await d.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2026-01-01T00:00:00Z',
  });
}

let incSeq = 0;
async function seedIncome(
  amountCents: number,
  date: string,
  sourceType = 'payroll'
): Promise<void> {
  await db()
    .insert(savingsIncomeEntries)
    .values({
      id: `inc_${++incSeq}`,
      household_id: HID,
      source_type: sourceType,
      label: sourceType,
      amount_cents: amountCents,
      income_date: date,
    });
}

let expSeq = 0;
let catId: string | null = null;
async function seedExpense(amountCents: number, date: string): Promise<void> {
  if (!catId) {
    catId = 'cat_projection';
    await db().insert(budgetCategories).values({ id: catId, household_id: HID, name: 'Other' });
  }
  await db()
    .insert(expenses)
    .values({
      id: `exp_${++expSeq}`,
      household_id: HID,
      category_id: catId,
      title: 'Spend',
      amount: amountCents,
      expense_date: date,
      source: 'manual',
    });
}

/** One month with `income` in and `spend` out → net = income − spend. */
async function seedMonth(month: number, incomeCents: number, spendCents: number): Promise<void> {
  const mm = String(month).padStart(2, '0');
  if (incomeCents) await seedIncome(incomeCents, `${YEAR}-${mm}-05`);
  if (spendCents) await seedExpense(spendCents, `${YEAR}-${mm}-10`);
}

beforeEach(async () => {
  await seed();
  incSeq = 0;
  expSeq = 0;
  catId = null;
});

describe('getProjection — month classification', () => {
  it('splits the year into elapsed / current / future around the injected clock', async () => {
    const p = await service().getProjection(HID, UID, YEAR, NOW);

    expect(p.months).toHaveLength(12);
    expect(p.currentMonth).toBe(7);
    expect(p.months.slice(0, 6).every((m) => m.status === 'actual')).toBe(true);
    expect(p.months[6].status).toBe('current');
    expect(p.months.slice(7).every((m) => m.status === 'future')).toBe(true);
    // Aug–Dec = 5 months still ahead; the live month is NOT "remaining".
    expect(p.monthsRemaining).toBe(5);
  });

  it('treats a wholly past year as all-actual with nothing left to plan', async () => {
    const p = await service().getProjection(HID, UID, 2025, NOW);
    expect(p.currentMonth).toBeNull();
    expect(p.months.every((m) => m.status === 'actual')).toBe(true);
    expect(p.monthsRemaining).toBe(0);
  });

  it('treats a future year as wholly plannable', async () => {
    const p = await service().getProjection(HID, UID, 2027, NOW);
    expect(p.currentMonth).toBeNull();
    expect(p.months.every((m) => m.status === 'future')).toBe(true);
    expect(p.monthsRemaining).toBe(12);
    expect(p.months.every((m) => m.actualNet === null)).toBe(true);
  });
});

describe('getProjection — actuals', () => {
  it('reports each elapsed month at its year-history net (income − all spending)', async () => {
    await seedMonth(1, 500_000, 300_000); // +2000.00
    await seedMonth(2, 500_000, 700_000); // −2000.00 (a deficit month stays negative)

    const svc = service();
    const p = await svc.getProjection(HID, UID, YEAR, NOW);
    const history = await svc.getYearHistory(HID, UID, YEAR);

    expect(p.months[0].actualNet).toBe(200_000);
    expect(p.months[1].actualNet).toBe(-200_000);
    // Never allowed to drift from the Year-history grid.
    expect(p.months.map((m) => m.actualNet)).toEqual([
      ...history.months.slice(0, 7).map((h) => h.net),
      ...[null, null, null, null, null],
    ]);
    expect(p.actualToDate).toBe(0); // +2000 − 2000
  });

  it('flags months with data so empty elapsed months are distinguishable from $0 ones', async () => {
    await seedMonth(3, 400_000, 100_000);
    const p = await service().getProjection(HID, UID, YEAR, NOW);

    expect(p.months[2].hasData).toBe(true);
    expect(p.months[0].hasData).toBe(false);
    expect(p.months[0].actualNet).toBe(0); // still an actual, just an empty one
  });

  it('does not treat a completed income-only month as "banked" — spending was never logged', async () => {
    // Regression for the production bug: a household bulk-imported five
    // months of past income but never logged the matching expenses, so the
    // Dashboard "Saved so far" read as if every dollar of income was pure
    // profit. An elapsed month needs LOGGED spending to count as real data —
    // income alone isn't enough, even though it's a genuine, non-zero figure.
    await seedIncome(500_000, `${YEAR}-01-05`); // Jan: income only, no expense logged
    await seedMonth(2, 500_000, 200_000); // Feb: real month, income + spend

    const p = await service().getProjection(HID, UID, YEAR, NOW);

    expect(p.months[0].hasData).toBe(false);
    expect(p.months[0].actualNet).toBe(500_000); // the raw figure is still reported…
    expect(p.months[1].hasData).toBe(true);
    // …but only Feb counts toward "banked": 500000 − 200000 = 300000, NOT
    // 500000 (Jan) + 300000 (Feb) = 800000.
    expect(p.actualToDate).toBe(300_000);
    // The pace sample is Feb alone too — Jan's phantom profit can't inflate it.
    expect(p.paceMonthly).toBe(300_000);
  });
});

describe('getProjection — pace, best month and potential', () => {
  it('averages COMPLETED months with data only — the partial current month never drags the pace', async () => {
    await seedMonth(1, 500_000, 200_000); // net +3000.00
    await seedMonth(2, 500_000, 400_000); // net +1000.00
    await seedMonth(7, 100_000, 0); // current month, partway through: +1000.00

    const p = await service().getProjection(HID, UID, YEAR, NOW);

    // (3000 + 1000) / 2 = 2000.00 — July is excluded despite having data.
    expect(p.paceMonthly).toBe(200_000);
    expect(p.months[6].status).toBe('current');
    expect(p.months[6].hasData).toBe(true);
  });

  it('falls back to the current month when no completed month has data yet', async () => {
    await seedMonth(7, 300_000, 100_000); // only the live month has anything
    const p = await service().getProjection(HID, UID, YEAR, NOW);
    expect(p.paceMonthly).toBe(200_000);
    // …but it is never the "best month" anchor, which stays completed-only.
    expect(p.bestMonth).toBeNull();
  });

  it('anchors potential on the household’s own best completed month', async () => {
    await seedMonth(1, 500_000, 400_000); // +1000.00
    await seedMonth(2, 900_000, 200_000); // +7000.00  ← best
    await seedMonth(3, 500_000, 300_000); // +2000.00

    const p = await service().getProjection(HID, UID, YEAR, NOW);

    expect(p.bestMonth).toEqual({ month: 2, net: 700_000 });
    expect(p.paceMonthly).toBe(Math.round((100_000 + 700_000 + 200_000) / 3));
    expect(p.potentialMonthly).toBe(700_000);
    // Banked 10000.00 + 5 remaining months at the best pace.
    expect(p.actualToDate).toBe(1_000_000);
    expect(p.potentialYearEnd).toBe(1_000_000 + 700_000 * 5);
  });

  it('never lets potential fall below the current pace, but both can go negative', async () => {
    await seedMonth(1, 100_000, 500_000); // −4000.00, every month is a loss
    await seedMonth(2, 100_000, 300_000); // −2000.00

    const p = await service().getProjection(HID, UID, YEAR, NOW);

    expect(p.paceMonthly).toBeLessThan(0);
    // A run of bad months must project the true (negative) trajectory instead
    // of a floor at $0 — but potential still can't fall below the recent pace:
    // Feb (−2000, the household's own "best" here) beats the −3000 average.
    expect(p.potentialMonthly).toBe(-200_000);
    expect(p.potentialMonthly).toBeGreaterThanOrEqual(p.paceMonthly);
    expect(p.paceYearEnd).toBe(p.actualToDate + p.paceMonthly * 5);
    expect(p.potentialYearEnd).toBe(p.actualToDate + p.potentialMonthly * 5);
    expect(p.paceYearEnd).toBeLessThan(p.actualToDate);
  });
});

describe('getProjection — recent pace favors the trailing months', () => {
  it('drops the oldest months out of the pace once the window is full', async () => {
    // Jan-Feb: a much lower earning season. Apr-Jun: the recent, higher trend.
    await seedMonth(1, 300_000, 200_000); // +1000.00
    await seedMonth(2, 300_000, 200_000); // +1000.00
    await seedMonth(4, 500_000, 200_000); // +3000.00
    await seedMonth(5, 500_000, 200_000); // +3000.00
    await seedMonth(6, 500_000, 200_000); // +3000.00

    const p = await service().getProjection(HID, UID, YEAR, NOW);

    // Only Apr-Jun (the most recent 3 with data) drive the pace — Jan/Feb no
    // longer drag it down once the trailing window is full.
    expect(p.paceMonthly).toBe(300_000);
    expect(p.months[7].projectedNet).toBe(300_000); // August rides the recent pace
    expect(p.months[7].projectionSource).toBe('pace');
  });

  it('still averages every month it has when fewer than the window exist', async () => {
    await seedMonth(1, 300_000, 200_000); // +1000.00
    await seedMonth(2, 500_000, 200_000); // +3000.00

    const p = await service().getProjection(HID, UID, YEAR, NOW);
    expect(p.paceMonthly).toBe(200_000);
  });
});

describe('getProjection — goal-driven future months', () => {
  it('projects an untargeted future month at the household monthly goal, not the pace', async () => {
    await seedMonth(1, 500_000, 300_000); // +2000.00 pace
    await db()
      .insert(savingsGoals)
      .values({
        id: 'goal_monthly',
        household_id: HID,
        type: 'custom',
        name: 'New roof',
        target_amount_cents: 0,
        monthly_allocation_cents: 500_000,
        status: 'active',
      });

    const p = await service().getProjection(HID, UID, YEAR, NOW);

    expect(p.paceMonthly).toBe(200_000);
    expect(p.monthlyGoal).toBe(500_000);
    // August: the household's stated goal outranks the backward-looking pace.
    expect(p.months[7].projectedNet).toBe(500_000);
    expect(p.months[7].projectionSource).toBe('goal');
  });

  it('lets an explicit per-month target still override the household goal', async () => {
    await db()
      .insert(savingsGoals)
      .values({
        id: 'goal_monthly',
        household_id: HID,
        type: 'custom',
        name: 'New roof',
        target_amount_cents: 0,
        monthly_allocation_cents: 500_000,
        status: 'active',
      });
    const p = await service().setMonthlyTargets(HID, UID, YEAR, [8], 900_000, NOW);

    expect(p.months[7].projectedNet).toBe(900_000);
    expect(p.months[7].projectionSource).toBe('target');
    // September has no explicit target of its own — it still rides the goal.
    expect(p.months[8].projectedNet).toBe(500_000);
    expect(p.months[8].projectionSource).toBe('goal');
  });

  it('falls back to the pace when neither a target nor a household goal exists', async () => {
    await seedMonth(1, 500_000, 300_000); // +2000.00
    const p = await service().getProjection(HID, UID, YEAR, NOW);
    expect(p.months[7].projectionSource).toBe('pace');
    expect(p.monthlyGoal).toBeNull();
  });
});

describe('getProjection — goal attainment', () => {
  it('grades a completed month against its own (positive) target', async () => {
    await seedMonth(1, 500_000, 400_000); // +1000.00 actual
    await service().setMonthlyTargets(HID, UID, YEAR, [1], 800_000, NOW); // aimed for +8000.00
    const p = await service().getProjection(HID, UID, YEAR, NOW);

    expect(p.months[0].targetCents).toBe(800_000);
    expect(p.months[0].goalDeltaCents).toBe(100_000 - 800_000);
    expect(p.months[0].goalAttainmentPct).toBe(13); // 1000/8000 rounded
    expect(p.months[0].goalHit).toBe(false);
  });

  it('marks a beaten target as hit, over 100%', async () => {
    await seedMonth(2, 900_000, 200_000); // +7000.00 actual
    await service().setMonthlyTargets(HID, UID, YEAR, [2], 500_000, NOW); // aimed for +5000.00
    const p = await service().getProjection(HID, UID, YEAR, NOW);

    expect(p.months[1].goalDeltaCents).toBe(200_000);
    expect(p.months[1].goalAttainmentPct).toBe(140);
    expect(p.months[1].goalHit).toBe(true);
  });

  it('grades a deficit (negative) target on hit/miss, never a misleading percentage', async () => {
    // Planned to lose at most $1,000; actually lost $5,000 — worse than the plan.
    await seedMonth(3, 100_000, 600_000); // net = 1000 - 6000 = -5000.00
    await service().setMonthlyTargets(HID, UID, YEAR, [3], -100_000, NOW);
    const p = await service().getProjection(HID, UID, YEAR, NOW);

    expect(p.months[2].actualNet).toBe(-500_000);
    expect(p.months[2].goalAttainmentPct).toBeNull();
    expect(p.months[2].goalHit).toBe(false); // −5000 is worse than the −1000 plan
    expect(p.months[2].goalDeltaCents).toBe(-400_000);
  });

  it('hits a deficit target when the household loses less than planned, or turns a profit', async () => {
    await seedMonth(4, 400_000, 300_000); // +1000.00 — better than a planned loss
    await service().setMonthlyTargets(HID, UID, YEAR, [4], -100_000, NOW);
    const p = await service().getProjection(HID, UID, YEAR, NOW);

    expect(p.months[3].goalHit).toBe(true);
    expect(p.months[3].goalAttainmentPct).toBeNull();
  });

  it('leaves attainment null for months with no target, and for future months even once one is set', async () => {
    await seedMonth(1, 500_000, 300_000);
    const p = await service().setMonthlyTargets(HID, UID, YEAR, [9], 200_000, NOW);

    expect(p.months[0].goalHit).toBeNull(); // Jan never had a target
    expect(p.months[8].status).toBe('future');
    expect(p.months[8].goalHit).toBeNull(); // Sep hasn't happened yet — nothing to grade
    expect(p.months[8].goalAttainmentPct).toBeNull();
  });

  it('rolls elapsed/current targeted months up into goalPerformance', async () => {
    await seedMonth(1, 500_000, 400_000); // +1000, target 800 → miss
    await seedMonth(2, 900_000, 200_000); // +7000, target 500 → hit
    await seedMonth(3, 500_000, 300_000); // +2000, no target → not tracked
    await service().setMonthlyTargets(HID, UID, YEAR, [1], 800_000, NOW);
    const p = await service().setMonthlyTargets(HID, UID, YEAR, [2], 500_000, NOW);

    expect(p.goalPerformance.monthsTracked).toBe(2);
    expect(p.goalPerformance.monthsHit).toBe(1);
    expect(p.goalPerformance.hitRatePct).toBe(50);
    expect(p.goalPerformance.avgAttainmentPct).toBe(Math.round((13 + 140) / 2));
  });

  it('allows setting a target on an elapsed month without it feeding the math', async () => {
    await seedMonth(1, 500_000, 300_000); // +2000.00
    const p = await service().setMonthlyTargets(HID, UID, YEAR, [1], 999_999_9, NOW);

    expect(p.months[0].status).toBe('actual');
    expect(p.months[0].projectedNet).toBe(200_000); // the actual still wins the math
    expect(p.months[0].targetCents).toBe(999_999_9); // but the target IS saved
    expect(p.months[0].goalHit).toBe(false); // …and graded
  });

  it('returns a zeroed-out goalPerformance when nothing is tracked', async () => {
    const p = await service().getProjection(HID, UID, YEAR, NOW);
    expect(p.goalPerformance).toEqual({
      monthsTracked: 0,
      monthsHit: 0,
      hitRatePct: null,
      avgAttainmentPct: null,
      // The card reports the MEDIAN attainment; with nothing graded there is
      // no typical month either.
      medianAttainmentPct: null,
    });
  });
});

describe('getProjection — one-off income never becomes the benchmark', () => {
  // Budget matrix flag #13: a forecast must not extrapolate one-off income.
  it('keeps a windfall in the actuals but out of the pace and the best month', async () => {
    await seedMonth(1, 500_000, 300_000); // +2000.00 repeatable
    await seedMonth(2, 500_000, 300_000); // +2000.00 repeatable
    // March: a genuinely better payroll month (+2500 repeatable) that ALSO
    // banked a $20,000 inheritance.
    await seedMonth(3, 550_000, 300_000);
    await seedIncome(2_000_000, `${YEAR}-03-20`, 'gift');

    const p = await service().getProjection(HID, UID, YEAR, NOW);

    // The money is real: it shows in the month, in the banked total and the chart.
    expect(p.months[2].actualNet).toBe(2_250_000);
    expect(p.months[2].oneOffIncome).toBe(2_000_000);
    expect(p.actualToDate).toBe(2_650_000);

    // March still wins "best month" — but at its REPEATABLE $2,500, not $22,500.
    // The month is not disqualified, the windfall is simply stripped out of it.
    expect(p.bestMonth).toEqual({ month: 3, net: 250_000 });
    expect(p.potentialMonthly).toBe(250_000);
    expect(p.paceMonthly).toBe(216_667); // (2000 + 2000 + 2500) / 3
    expect(p.excludesOneOffIncome).toBe(true);
    // Untargeted future months project at the repeatable pace, not the windfall.
    expect(p.months[7].projectedNet).toBe(216_667);
    expect(p.paceYearEnd).toBe(2_650_000 + 216_667 * 5);
    expect(p.potentialYearEnd).toBe(2_650_000 + 250_000 * 5);
  });

  it('keeps the earliest month on a tie so the anchor does not jump around', async () => {
    await seedMonth(1, 500_000, 300_000);
    await seedMonth(2, 500_000, 300_000);
    const p = await service().getProjection(HID, UID, YEAR, NOW);
    expect(p.bestMonth).toEqual({ month: 1, net: 200_000 });
  });

  it('leaves the flag off when no completed month had one-off income', async () => {
    await seedMonth(1, 500_000, 300_000);
    const p = await service().getProjection(HID, UID, YEAR, NOW);
    expect(p.excludesOneOffIncome).toBe(false);
    expect(p.months.every((m) => m.oneOffIncome === 0)).toBe(true);
  });

  it('treats the legacy "other" source as regular, matching the overview split', async () => {
    await seedMonth(1, 0, 300_000);
    await seedIncome(500_000, `${YEAR}-01-05`, 'other');

    const p = await service().getProjection(HID, UID, YEAR, NOW);
    expect(p.months[0].oneOffIncome).toBe(0);
    expect(p.paceMonthly).toBe(200_000);
    expect(p.excludesOneOffIncome).toBe(false);
  });

  it('strips a tax refund out of the benchmark like any other windfall', async () => {
    // Regression: tax_refund used to be classified as "regular" income, so a
    // one-time refund could silently win "best month" and inflate the stretch
    // target — exactly the failure mode this describe block guards against.
    await seedMonth(1, 500_000, 300_000); // +2000.00 repeatable
    // February: a smaller payroll month that ALSO banked a $15,000 tax refund.
    await seedMonth(2, 500_000, 400_000); // +1000.00 repeatable
    await seedIncome(1_500_000, `${YEAR}-02-20`, 'tax_refund');

    const p = await service().getProjection(HID, UID, YEAR, NOW);

    expect(p.months[1].actualNet).toBe(1_600_000);
    expect(p.months[1].oneOffIncome).toBe(1_500_000);
    // January still wins "best month" at its repeatable $2,000 — the refund
    // never gets to pass as February's repeatable benchmark.
    expect(p.bestMonth).toEqual({ month: 1, net: 200_000 });
    expect(p.potentialMonthly).toBe(200_000);
    expect(p.excludesOneOffIncome).toBe(true);
  });

  it('can drive the pace negative when the month only balanced thanks to a windfall', async () => {
    // Payroll 1000 − spend 3000 = −2000 repeatable, rescued by a 5000 bonus.
    await seedMonth(1, 100_000, 300_000);
    await seedIncome(500_000, `${YEAR}-01-20`, 'bonus');

    const p = await service().getProjection(HID, UID, YEAR, NOW);

    expect(p.months[0].actualNet).toBe(300_000); // the month really was positive
    expect(p.paceMonthly).toBe(-200_000); // …but it is not repeatable
    expect(p.potentialMonthly).toBe(-200_000); // stretch pace is honest, not floored at $0
    expect(p.months[7].projectedNet).toBe(-200_000);
  });
});

describe('getProjection — year-end projection', () => {
  it('projects untargeted future months at the current pace', async () => {
    await seedMonth(1, 500_000, 300_000); // +2000.00
    await seedMonth(2, 500_000, 300_000); // +2000.00

    const p = await service().getProjection(HID, UID, YEAR, NOW);

    expect(p.paceMonthly).toBe(200_000);
    expect(p.months[7].projectedNet).toBe(200_000); // August, no target
    expect(p.monthsWithTarget).toBe(0);
    // 4000 banked + 5 future months at 2000.
    expect(p.projectedYearEnd).toBe(400_000 + 200_000 * 5);
    expect(p.paceYearEnd).toBe(p.projectedYearEnd);
  });

  it('uses a set target over the pace, and counts the current month exactly once', async () => {
    await seedMonth(1, 500_000, 300_000); // +2000.00 completed
    await seedMonth(7, 100_000, 0); // +1000.00 so far this month

    const svc = service();
    // A stretch target on the live month + one future month.
    await svc.setMonthlyTargets(HID, UID, YEAR, [7], 500_000, NOW);
    const p = await svc.setMonthlyTargets(HID, UID, YEAR, [8], 300_000, NOW);

    expect(p.months[6].actualNet).toBe(100_000);
    expect(p.months[6].targetCents).toBe(500_000);
    // Mid-month: aim for the target, which is ahead of where the month sits.
    expect(p.months[6].projectedNet).toBe(500_000);
    expect(p.months[7].projectedNet).toBe(300_000);

    // Banked = Jan 2000 + Jul-so-far 1000 = 3000.
    expect(p.actualToDate).toBe(300_000);
    // Year end = Jan 2000 + Jul 5000 (once, not 1000 + 5000) + Aug 3000
    //            + Sep–Dec at the 2000 pace.
    expect(p.projectedYearEnd).toBe(200_000 + 500_000 + 300_000 + 200_000 * 4);
    expect(p.monthsWithTarget).toBe(2);
    expect(p.targetedRemaining).toBe(800_000);
  });

  it('keeps the current month at its actual when the target is already beaten', async () => {
    await seedMonth(7, 900_000, 100_000); // +8000.00 banked this month
    const p = await service().setMonthlyTargets(HID, UID, YEAR, [7], 200_000, NOW);

    expect(p.months[6].projectedNet).toBe(800_000);
  });

  it('honours a negative target — a planned deficit month is a real projection', async () => {
    await seedMonth(1, 500_000, 300_000); // +2000.00 pace
    const p = await service().setMonthlyTargets(HID, UID, YEAR, [9], -1_000_000, NOW);

    expect(p.months[8].targetCents).toBe(-1_000_000);
    expect(p.months[8].projectedNet).toBe(-1_000_000);
    // Sep drags the year down; Aug + Oct–Dec still ride the pace.
    expect(p.projectedYearEnd).toBe(200_000 + 200_000 * 4 - 1_000_000);
  });

  it('ignores a stale target left on a completed month', async () => {
    await seedMonth(1, 500_000, 300_000); // +2000.00 actual
    const p = await service().setMonthlyTargets(HID, UID, YEAR, [1], 999_999_9, NOW);

    expect(p.months[0].status).toBe('actual');
    expect(p.months[0].projectedNet).toBe(200_000); // the actual wins
    expect(p.monthsWithTarget).toBe(0); // completed months never count as "targeted"
    expect(p.targetedRemaining).toBe(0);
  });
});

describe('setMonthlyTargets', () => {
  it('bulk-applies one figure to every remaining month', async () => {
    const remaining = [7, 8, 9, 10, 11, 12];
    const p = await service().setMonthlyTargets(HID, UID, YEAR, remaining, 250_000, NOW);

    for (const m of remaining) {
      expect(p.months[m - 1].targetCents).toBe(250_000);
    }
    expect(p.months[5].targetCents).toBeNull(); // June (elapsed) untouched
    expect(p.monthsWithTarget).toBe(6);

    const rows = await db()
      .select()
      .from(savingsMonthlyTargets)
      .where(eq(savingsMonthlyTargets.household_id, HID))
      .all();
    expect(rows).toHaveLength(6);
  });

  it('upserts rather than duplicating when a month is re-targeted', async () => {
    const svc = service();
    await svc.setMonthlyTargets(HID, UID, YEAR, [8, 9], 100_000, NOW);
    const p = await svc.setMonthlyTargets(HID, UID, YEAR, [8], 400_000, NOW);

    expect(p.months[7].targetCents).toBe(400_000);
    expect(p.months[8].targetCents).toBe(100_000);

    const rows = await db()
      .select()
      .from(savingsMonthlyTargets)
      .where(eq(savingsMonthlyTargets.household_id, HID))
      .all();
    expect(rows).toHaveLength(2);
  });

  it('clears a target by deleting the row — "no target" is not a $0 target', async () => {
    const svc = service();
    await svc.setMonthlyTargets(HID, UID, YEAR, [8, 9], 100_000, NOW);
    const cleared = await svc.setMonthlyTargets(HID, UID, YEAR, [8], null, NOW);

    expect(cleared.months[7].targetCents).toBeNull();
    expect(cleared.months[8].targetCents).toBe(100_000);

    const rows = await db()
      .select()
      .from(savingsMonthlyTargets)
      .where(eq(savingsMonthlyTargets.household_id, HID))
      .all();
    expect(rows).toHaveLength(1);

    // A deliberate $0 target is a DIFFERENT state and does persist a row.
    const zeroed = await svc.setMonthlyTargets(HID, UID, YEAR, [8], 0, NOW);
    expect(zeroed.months[7].targetCents).toBe(0);
    expect(zeroed.months[7].projectedNet).toBe(0);
  });

  it('scopes targets to one year', async () => {
    const svc = service();
    await svc.setMonthlyTargets(HID, UID, YEAR, [8], 100_000, NOW);
    const next = await svc.getProjection(HID, UID, YEAR + 1, NOW);
    expect(next.months.every((m) => m.targetCents === null)).toBe(true);
  });

  it('rejects an empty month list', async () => {
    await expect(service().setMonthlyTargets(HID, UID, YEAR, [], 100_000)).rejects.toThrow();
  });

  it('denies a non-member on both read and write', async () => {
    await expect(service().getProjection(HID, OUTSIDER, YEAR, NOW)).rejects.toThrow();
    await expect(
      service().setMonthlyTargets(HID, OUTSIDER, YEAR, [8], 100_000)
    ).rejects.toThrow();
  });
});

describe('getProjection — goals', () => {
  it('surfaces the household’s yearly + monthly savings goals', async () => {
    await db().insert(savingsGoals).values({
      id: 'goal_1',
      household_id: HID,
      type: 'custom',
      name: 'New roof',
      target_amount_cents: 3_000_000,
      monthly_allocation_cents: 250_000,
      status: 'active',
    });

    const p = await service().getProjection(HID, UID, YEAR, NOW);
    expect(p.yearGoal).toBe(3_000_000);
    expect(p.monthlyGoal).toBe(250_000);
  });

  it('returns null goals when the household set none', async () => {
    const p = await service().getProjection(HID, UID, YEAR, NOW);
    expect(p.yearGoal).toBeNull();
    expect(p.monthlyGoal).toBeNull();
  });
});

/**
 * DATA BEATS PLAN — a month ahead the household has already filled in.
 *
 * Reported 2026-09-09: a household knew their income was falling for the next
 * two to three months and entered it for October, November and December. Every
 * one of those months still rendered at its goal, because the future branch was
 * target -> goal -> pace and never consulted the month's own rows. The year-end
 * hero therefore sat far above anything their entries supported.
 */
describe('getProjection — a future month the household has already filled in', () => {
  it('forecasts the month from its own rows instead of the target', async () => {
    await seedMonth(4, 500_000, 100_000); // an elapsed month, so a pace exists
    await seedMonth(5, 500_000, 100_000);
    await seedMonth(6, 500_000, 100_000);
    await seedIncome(120_000, `${YEAR}-08-05`); // August is AHEAD of 15 Jul
    await db()
      .insert(savingsMonthlyTargets)
      .values({ id: 'tgt_aug', household_id: HID, period: `${YEAR}-08`, target_cents: 700_000 });

    const p = await service().getProjection(HID, UID, YEAR, NOW);
    const aug = p.months.find((m) => m.month === 8)!;

    expect(aug.status).toBe('future');
    expect(aug.projectionSource).toBe('entered');
    expect(aug.projectedNet).toBe(120_000);
    expect(aug.targetCents).toBe(700_000); // the plan stays visible
  });

  it('flags that such a month has no spending logged yet', async () => {
    await seedIncome(120_000, `${YEAR}-08-05`);
    const p = await service().getProjection(HID, UID, YEAR, NOW);
    const aug = p.months.find((m) => m.month === 8)!;
    expect(aug.projectionSource).toBe('entered');
    // Income in, spending not — the figure reads better than the month will land.
    expect(aug.spendingLogged).toBe(false);
  });

  it('still plans an untouched month ahead from its target', async () => {
    await seedIncome(120_000, `${YEAR}-08-05`);
    await db()
      .insert(savingsMonthlyTargets)
      .values({ id: 'tgt_sep', household_id: HID, period: `${YEAR}-09`, target_cents: 700_000 });

    const p = await service().getProjection(HID, UID, YEAR, NOW);
    const sep = p.months.find((m) => m.month === 9)!;
    expect(sep.projectionSource).toBe('target');
    expect(sep.projectedNet).toBe(700_000);
  });
});

describe('getProjection — goal performance reports a typical month', () => {
  it('reports the MEDIAN attainment, which one catastrophic month cannot drag', async () => {
    // Three graded months: a disaster, a miss and a beat. The mean lands near
    // the disaster; the median lands on the month that actually typifies them.
    await seedMonth(4, 100_000, 1_300_000); // net -1,200,000 -> -171%
    await seedMonth(5, 800_000, 300_000); //  net   500,000 ->   71%
    await seedMonth(6, 900_000, 100_000); //  net   800,000 ->  114%
    for (const m of [4, 5, 6]) {
      await db()
        .insert(savingsMonthlyTargets)
        .values({
          id: `tgt_${m}`,
          household_id: HID,
          period: `${YEAR}-0${m}`,
          target_cents: 700_000,
        });
    }

    const { goalPerformance: perf } = await service().getProjection(HID, UID, YEAR, NOW);
    expect(perf.monthsTracked).toBe(3);
    expect(perf.medianAttainmentPct).toBe(71); // the middle month

    // The mean of (-171, 71, 114) is 5 — a figure NO month of the three came
    // near, and the one the card used to print as "averaging 5% of target".
    // That gap is the whole reason the card reports the median instead.
    expect(perf.avgAttainmentPct).toBe(5);
    expect(perf.medianAttainmentPct! - perf.avgAttainmentPct!).toBeGreaterThan(60);
  });
});

describe('getProjection — method selection', () => {
  it('historical_average ignores the standing goal and uses the flat pace', async () => {
    await seedMonth(4, 500_000, 300_000); // net 200,000
    await seedMonth(5, 500_000, 300_000);
    await seedMonth(6, 500_000, 300_000); // pace = 200,000
    await db()
      .insert(savingsGoals)
      .values({
        id: 'goal_monthly',
        household_id: HID,
        type: 'custom',
        name: 'New roof',
        target_amount_cents: 0,
        monthly_allocation_cents: 500_000,
        status: 'active',
      });

    const p = await service().getProjection(HID, UID, YEAR, NOW, 'historical_average');
    expect(p.method).toBe('historical_average');
    // Unlike `hybrid`, this method never lets the standing goal override the
    // pace — it stays "pure".
    expect(p.months[7].projectedNet).toBe(200_000);
    expect(p.months[7].projectionSource).toBe('pace');
  });

  it('trend continues an improving trajectory past the flat pace', async () => {
    await seedMonth(1, 300_000, 200_000); // net 100,000
    await seedMonth(2, 350_000, 200_000); // net 150,000
    await seedMonth(3, 400_000, 200_000); // net 200,000
    await seedMonth(4, 450_000, 200_000); // net 250,000
    await seedMonth(5, 500_000, 200_000); // net 300,000
    await seedMonth(6, 550_000, 200_000); // net 350,000

    const p = await service().getProjection(HID, UID, YEAR, NOW, 'trend');
    // Flat pace only looks at the last 3 months: (250k+300k+350k)/3.
    expect(p.paceMonthly).toBe(300_000);
    // Trend continues the +50,000/month trajectory instead: 350k + 50k.
    expect(p.months[7].projectedNet).toBe(400_000);
    expect(p.months[7].projectionSource).toBe('pace');
  });

  it('planned_budget computes income minus recurring payments minus the Planning-tab budget', async () => {
    await db()
      .insert(savingsIncomeTemplates)
      .values({
        id: 'tmpl_payroll',
        household_id: HID,
        source_type: 'payroll',
        label: 'Paycheck',
        amount_cents: 2_000_000, // $20,000/mo
        active: true,
      });
    await db()
      .insert(savingsRecurringPayments)
      .values({
        id: 'rp_rent',
        household_id: HID,
        label: 'Rent',
        amount_cents: 1_000_000, // $10,000/mo
        active: true,
      });
    await db()
      .insert(budgetGoals)
      .values({ id: 'bg_sep', household_id: HID, year: YEAR, month: 9, planned_budget: 200_000 }); // $2,000

    const p = await service().getProjection(HID, UID, YEAR, NOW, 'planned_budget');
    const sep = p.months.find((m) => m.month === 9)!;
    // The user's own worked example: 20,000 income - 10,000 payments - 2,000
    // spending goal = 8,000.
    expect(sep.projectedNet).toBe(800_000);
    expect(sep.projectionSource).toBe('pace');
    expect(sep.plannedBudget).toEqual({
      expectedIncomeCents: 2_000_000,
      recurringPaymentsCents: 1_000_000,
      spendingGoalCents: 200_000,
      netCents: 800_000,
    });
  });

  it('planned_budget falls back to the pace when the Planning-tab budget is unresolved', async () => {
    await seedMonth(4, 500_000, 300_000);
    await seedMonth(5, 500_000, 300_000);
    await seedMonth(6, 500_000, 300_000); // pace = 200,000
    // No budget_goals.planned_budget row for any future month.
    const p = await service().getProjection(HID, UID, YEAR, NOW, 'planned_budget');
    expect(p.months[7].projectedNet).toBe(200_000);
    expect(p.months[7].projectionSource).toBe('pace');
  });

  it('methodComparison reports all 4 methods, and the selected one matches projectedYearEnd', async () => {
    await seedMonth(4, 500_000, 300_000);
    await seedMonth(5, 500_000, 300_000);
    await seedMonth(6, 500_000, 300_000);

    const p = await service().getProjection(HID, UID, YEAR, NOW, 'historical_average');
    expect(p.methodComparison.map((m) => m.method).sort()).toEqual(
      ['historical_average', 'hybrid', 'planned_budget', 'trend'].sort()
    );
    const selected = p.methodComparison.find((m) => m.method === 'historical_average')!;
    expect(selected.projectedYearEnd).toBe(p.projectedYearEnd);
  });

  it('methodComparison still diverges per method once every remaining month has an explicit target', async () => {
    // A steadily improving trajectory: trend should diverge from the flat pace.
    await seedMonth(4, 400_000, 200_000); // net 200,000
    await seedMonth(5, 500_000, 200_000); // net 300,000
    await seedMonth(6, 600_000, 200_000); // net 400,000

    // "Plan the year": the household applied the same target to every month
    // still ahead (Aug–Dec) — this used to make `projectFor` short-circuit to
    // `targetCents` for every method, flattening all 4 comparison cards to
    // the same number regardless of how each method would actually forecast.
    const remaining = [8, 9, 10, 11, 12];
    await service().setMonthlyTargets(HID, UID, YEAR, remaining, 350_000, NOW);

    const p = await service().getProjection(HID, UID, YEAR, NOW, 'historical_average');

    // The primary figure still honors the household's explicit plan.
    for (const m of remaining) {
      expect(p.months.find((row) => row.month === m)!.projectedNet).toBe(350_000);
    }

    // But the comparison cards report what each method's OWN formula would
    // have projected instead of all converging on the typed-in target.
    const byMethod = Object.fromEntries(p.methodComparison.map((m) => [m.method, m.projectedYearEnd]));
    expect(byMethod.historical_average).not.toBe(byMethod.trend);
    expect(byMethod.trend).toBeGreaterThan(byMethod.historical_average);
  });
});

describe('getProjection — hybrid blends the plan with the pace by the household track record', () => {
  async function seedPlan(): Promise<void> {
    await db()
      .insert(savingsIncomeTemplates)
      .values({
        id: 'tmpl_payroll',
        household_id: HID,
        source_type: 'payroll',
        label: 'Paycheck',
        amount_cents: 2_000_000,
        active: true,
      });
    // Scoped to October only — an 'all_year' payment would retroactively add
    // itself to April–June's ALREADY-SEEDED actual net too, contaminating the
    // hand-picked pace/hit-rate this test is isolating.
    await db()
      .insert(savingsRecurringPayments)
      .values({
        id: 'rp_rent',
        household_id: HID,
        label: 'Rent',
        amount_cents: 1_000_000,
        active: true,
        scope_type: 'custom_months',
        scope_year: YEAR,
        active_months: JSON.stringify([10]),
      });
    await db()
      .insert(budgetGoals)
      .values({ id: 'bg_oct', household_id: HID, year: YEAR, month: 10, planned_budget: 200_000 });
  }

  it('leans fully on the plan when the household has always hit its own targets', async () => {
    for (const m of [4, 5, 6]) {
      await seedMonth(m, 600_000, 500_000); // net 100,000
      await db()
        .insert(savingsMonthlyTargets)
        .values({ id: `tgt_${m}`, household_id: HID, period: `${YEAR}-0${m}`, target_cents: 100_000 });
    }
    await seedPlan();

    const p = await service().getProjection(HID, UID, YEAR, NOW, 'hybrid');
    expect(p.goalPerformance.hitRatePct).toBe(100);
    expect(p.paceMonthly).toBe(100_000);
    const oct = p.months.find((m) => m.month === 10)!;
    // blendWeight = 1.0 → the plan's own figure (20,000 - 10,000 - 2,000), untouched by pace.
    expect(oct.projectedNet).toBe(800_000);
  });

  it('leans fully on the pace when the household has never hit its own targets', async () => {
    for (const m of [4, 5, 6]) {
      await seedMonth(m, 600_000, 590_000); // net 10,000
      await db()
        .insert(savingsMonthlyTargets)
        .values({ id: `tgt_${m}`, household_id: HID, period: `${YEAR}-0${m}`, target_cents: 100_000 });
    }
    await seedPlan();

    const p = await service().getProjection(HID, UID, YEAR, NOW, 'hybrid');
    expect(p.goalPerformance.hitRatePct).toBe(0);
    expect(p.paceMonthly).toBe(10_000);
    const oct = p.months.find((m) => m.month === 10)!;
    // blendWeight = 0.0 → the pace, untouched by the (optimistic, unmet) plan.
    expect(oct.projectedNet).toBe(10_000);
  });
});

describe('setDefaultProjectionMethod', () => {
  it('persists the household default and getProjection picks it up when method is omitted', async () => {
    await seedMonth(4, 500_000, 300_000);
    await seedMonth(5, 500_000, 300_000);
    await seedMonth(6, 500_000, 300_000); // pace = 200,000
    await db()
      .insert(savingsGoals)
      .values({
        id: 'goal_monthly',
        household_id: HID,
        type: 'custom',
        name: 'New roof',
        target_amount_cents: 0,
        monthly_allocation_cents: 500_000,
        status: 'active',
      });

    // No default set yet — 'hybrid', so the standing goal wins.
    const before = await service().getProjection(HID, UID, YEAR, NOW);
    expect(before.method).toBe('hybrid');
    expect(before.months[7].projectionSource).toBe('goal');

    await service().setDefaultProjectionMethod(HID, UID, 'historical_average', YEAR, NOW);

    const after = await service().getProjection(HID, UID, YEAR, NOW);
    expect(after.method).toBe('historical_average');
    expect(after.months[7].projectedNet).toBe(200_000);
    expect(after.months[7].projectionSource).toBe('pace');
  });
});
