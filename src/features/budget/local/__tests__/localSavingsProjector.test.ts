import type { LocalBudgetLedger } from '../engine';
import {
  getProjection,
  getYearHistory,
  listRecurring,
  targetsByPeriod,
} from '../savings/localSavingsProjector';

import { emptyLedger } from './ledgerTestKit';

/**
 * The projection engine decides what every future month of the Savings
 * Projection tab shows. Its rules are subtle and none of them were pinned by a
 * test before this file: the pace window is the last 3 completed months, the
 * fallback order is target → goal → pace, and one-off income is deliberately
 * excluded from pace so a single marketplace sale doesn't inflate the rest of
 * the year.
 */

const YEAR = 2026;

type LedgerParts = {
  /** month -> confirmed payroll cents */
  income?: Record<number, number>;
  /** month -> one-off (irregular) income cents */
  oneOff?: Record<number, number>;
  /**
   * month -> recorded spending cents. A COMPLETED month only counts as having
   * data when it carries spending (see `hasData` in the projector), so a month
   * with income alone is skipped by the pace window.
   */
  spend?: Record<number, number>;
  /** month -> target cents */
  targets?: Record<number, number>;
  /** sum of active goals' monthly allocation */
  goalMonthly?: number;
};

function ledgerWith({
  income = {},
  oneOff = {},
  spend = {},
  targets = {},
  goalMonthly,
}: LedgerParts): LocalBudgetLedger {
  const ledger = emptyLedger();
  const mm = (m: number) => String(m).padStart(2, '0');
  const spendCategoryId = ledger.categories[0]?.id ?? null;

  for (const [month, cents] of Object.entries(spend)) {
    ledger.expenses.push({
      id: `exp_${month}`,
      household_id: ledger.household.id,
      budget_item_id: null,
      category_id: spendCategoryId,
      title: `Spending ${month}`,
      description: null,
      amount: cents,
      saved_amount: 0,
      tax_amount: 0,
      deposit_amount: 0,
      expense_date: `${YEAR}-${mm(Number(month))}-12`,
      vendor: null,
      receipt_key: null,
      created_by: ledger.memberId,
      created_at: '2026-01-01T00:00:00.000Z',
    } as unknown as LocalBudgetLedger['expenses'][number]);
  }

  for (const [month, cents] of Object.entries(income)) {
    ledger.savingsIncome.push({
      id: `inc_reg_${month}`,
      household_id: ledger.household.id,
      source_type: 'payroll',
      label: 'Salary',
      amount_cents: cents,
      income_date: `${YEAR}-${mm(Number(month))}-05`,
      status: 'confirmed',
    } as unknown as LocalBudgetLedger['savingsIncome'][number]);
  }

  for (const [month, cents] of Object.entries(oneOff)) {
    ledger.savingsIncome.push({
      id: `inc_one_${month}`,
      household_id: ledger.household.id,
      source_type: 'marketplace_sale',
      label: 'Sold a bike',
      amount_cents: cents,
      income_date: `${YEAR}-${mm(Number(month))}-20`,
      status: 'confirmed',
    } as unknown as LocalBudgetLedger['savingsIncome'][number]);
  }

  for (const [month, cents] of Object.entries(targets)) {
    ledger.savingsMonthlyTargets.push({
      id: `tgt_${month}`,
      household_id: ledger.household.id,
      period: `${YEAR}-${mm(Number(month))}`,
      target_cents: cents,
      updated_at: '2026-01-01T00:00:00.000Z',
    } as unknown as LocalBudgetLedger['savingsMonthlyTargets'][number]);
  }

  if (goalMonthly != null) {
    ledger.savingsGoals.push({
      id: 'goal_1',
      household_id: ledger.household.id,
      name: 'Emergency fund',
      status: 'active',
      monthly_allocation_cents: goalMonthly,
      target_amount_cents: goalMonthly * 12,
    } as unknown as LocalBudgetLedger['savingsGoals'][number]);
  }

  return ledger;
}

const monthOf = (projection: ReturnType<typeof getProjection>, month: number) => {
  const row = projection.months.find((m) => m.month === month);
  if (!row) throw new Error(`no row for month ${month}`);
  return row;
};

describe('targetsByPeriod — deterministic winner across replicas', () => {
  it('keeps the newest updated_at for a period', () => {
    const ledger = emptyLedger();
    ledger.savingsMonthlyTargets.push(
      { id: 'a', period: '2026-03', target_cents: 100, updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'b', period: '2026-03', target_cents: 900, updated_at: '2026-02-01T00:00:00.000Z' },
    );
    expect(targetsByPeriod(ledger).get('2026-03')?.target_cents).toBe(900);
  });

  it('breaks an updated_at tie by id so every device agrees', () => {
    const ledger = emptyLedger();
    ledger.savingsMonthlyTargets.push(
      { id: 'aaa', period: '2026-03', target_cents: 100, updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'zzz', period: '2026-03', target_cents: 700, updated_at: '2026-01-01T00:00:00.000Z' },
    );
    // Highest id wins regardless of array order — the point of the rule.
    expect(targetsByPeriod(ledger).get('2026-03')?.target_cents).toBe(700);
  });

  it('ignores rows with no period', () => {
    const ledger = emptyLedger();
    ledger.savingsMonthlyTargets.push({ id: 'x', period: '', target_cents: 500, updated_at: '' });
    expect(targetsByPeriod(ledger).size).toBe(0);
  });
});

describe('getYearHistory', () => {
  it('reports twelve months and counts only months holding data', () => {
    const history = getYearHistory(ledgerWith({ income: { 1: 500_000, 2: 400_000 } }), YEAR);
    expect(history.months).toHaveLength(12);
    expect(history.monthsWithData).toBe(2);
    expect(history.totals.income).toBe(900_000);
  });

  it('averages over months with data, not over all twelve', () => {
    const history = getYearHistory(ledgerWith({ income: { 1: 500_000, 2: 400_000 } }), YEAR);
    expect(history.average.income).toBe(450_000);
  });

  it('excludes draft income', () => {
    const ledger = ledgerWith({ income: { 1: 500_000 } });
    ledger.savingsIncome.push({
      id: 'inc_draft',
      household_id: ledger.household.id,
      source_type: 'payroll',
      label: 'Unconfirmed',
      amount_cents: 999_000,
      income_date: `${YEAR}-01-09`,
      status: 'draft',
    } as unknown as LocalBudgetLedger['savingsIncome'][number]);
    expect(getYearHistory(ledger, YEAR).totals.income).toBe(500_000);
  });
});

describe('getProjection — month status', () => {
  const now = new Date(Date.UTC(YEAR, 5, 15)); // 2026-06-15

  it('marks past months actual, the present month current, and the rest future', () => {
    const p = getProjection(ledgerWith({ income: { 1: 100_000 } }), YEAR, now);
    expect(monthOf(p, 5).status).toBe('actual');
    expect(monthOf(p, 6).status).toBe('current');
    expect(monthOf(p, 7).status).toBe('future');
  });

  it('marks every month of a past year actual', () => {
    const p = getProjection(ledgerWith({ income: { 1: 100_000 } }), YEAR - 1, now);
    expect(p.months.every((m) => m.status === 'actual')).toBe(true);
  });

  it('marks every month of a future year future', () => {
    const p = getProjection(ledgerWith({}), YEAR + 1, now);
    expect(p.months.every((m) => m.status === 'future')).toBe(true);
    expect(p.months.every((m) => m.actualNet === null)).toBe(true);
  });
});

describe('getProjection — fallback order for future months', () => {
  const now = new Date(Date.UTC(YEAR, 5, 15)); // June

  it('prefers an explicit target', () => {
    const p = getProjection(
      ledgerWith({ income: { 1: 300_000 }, targets: { 9: 250_000 }, goalMonthly: 111_000 }),
      YEAR,
      now,
    );
    const sep = monthOf(p, 9);
    expect(sep.projectionSource).toBe('target');
    expect(sep.projectedNet).toBe(250_000);
  });

  it('falls back to the monthly goal allocation when no target exists', () => {
    const p = getProjection(
      ledgerWith({ income: { 1: 300_000 }, goalMonthly: 111_000 }),
      YEAR,
      now,
    );
    const sep = monthOf(p, 9);
    expect(sep.projectionSource).toBe('goal');
    expect(sep.projectedNet).toBe(111_000);
  });

  it('falls back to pace when there is neither a target nor a goal', () => {
    // Completed months 3,4,5 net 100k/200k/300k → pace 200k.
    const p = getProjection(
      ledgerWith({
        income: { 3: 200_000, 4: 300_000, 5: 400_000 },
        spend: { 3: 100_000, 4: 100_000, 5: 100_000 },
      }),
      YEAR,
      now,
    );
    const sep = monthOf(p, 9);
    expect(sep.projectionSource).toBe('pace');
    expect(sep.projectedNet).toBe(200_000);
  });

  it('uses only the most recent three completed months for pace', () => {
    // Jan/Feb are deliberately huge; only Mar–May must count.
    const p = getProjection(
      ledgerWith({
        income: { 1: 900_000, 2: 900_000, 3: 200_000, 4: 300_000, 5: 400_000 },
        spend: { 1: 100_000, 2: 100_000, 3: 100_000, 4: 100_000, 5: 100_000 },
      }),
      YEAR,
      now,
    );
    expect(monthOf(p, 9).projectedNet).toBe(200_000);
  });

  it('ignores completed months that recorded no spending at all', () => {
    // Income-only months never enter the pace window, so this projects zero
    // even though 900k of income landed in each of Mar–May.
    const p = getProjection(ledgerWith({ income: { 3: 900_000, 4: 900_000, 5: 900_000 } }), YEAR, now);
    expect(monthOf(p, 9).projectedNet).toBe(0);
  });

  it('projects zero when nothing at all is known', () => {
    const p = getProjection(ledgerWith({}), YEAR, now);
    const sep = monthOf(p, 9);
    expect(sep.projectionSource).toBe('pace');
    expect(sep.projectedNet).toBe(0);
  });
});

describe('getProjection — one-off income', () => {
  const now = new Date(Date.UTC(YEAR, 5, 15));

  it('excludes one-off income from the pace used for future months', () => {
    // May carries a 600k marketplace sale on top of 300k payroll. Pace must be
    // built from the repeatable 300k, not the 900k that actually landed.
    const p = getProjection(
      ledgerWith({
        income: { 3: 400_000, 4: 400_000, 5: 400_000 },
        spend: { 3: 100_000, 4: 100_000, 5: 100_000 },
        oneOff: { 5: 600_000 },
      }),
      YEAR,
      now,
    );
    expect(monthOf(p, 9).projectedNet).toBe(300_000);
  });

  it('still reports the one-off month actual net in full', () => {
    const p = getProjection(
      ledgerWith({ income: { 5: 300_000 }, oneOff: { 5: 600_000 } }),
      YEAR,
      now,
    );
    expect(monthOf(p, 5).actualNet).toBe(900_000);
  });

  it('flags that the pace excludes one-off income', () => {
    const p = getProjection(
      ledgerWith({ income: { 5: 300_000 }, spend: { 5: 100_000 }, oneOff: { 5: 600_000 } }),
      YEAR,
      now,
    );
    expect(p.excludesOneOffIncome).toBe(true);
  });
});

describe('getProjection — grading a month against its target', () => {
  const now = new Date(Date.UTC(YEAR, 5, 15));

  it('grades a completed month that beat its target', () => {
    const p = getProjection(
      ledgerWith({ income: { 4: 250_000 }, targets: { 4: 200_000 } }),
      YEAR,
      now,
    );
    const apr = monthOf(p, 4);
    expect(apr.goalHit).toBe(true);
    expect(apr.goalDeltaCents).toBe(50_000);
    expect(apr.goalAttainmentPct).toBe(125);
  });

  it('grades a completed month that missed its target', () => {
    const p = getProjection(
      ledgerWith({ income: { 4: 100_000 }, targets: { 4: 200_000 } }),
      YEAR,
      now,
    );
    const apr = monthOf(p, 4);
    expect(apr.goalHit).toBe(false);
    expect(apr.goalDeltaCents).toBe(-100_000);
    expect(apr.goalAttainmentPct).toBe(50);
  });

  it('does not grade future months', () => {
    const p = getProjection(ledgerWith({ targets: { 9: 200_000 } }), YEAR, now);
    const sep = monthOf(p, 9);
    expect(sep.goalHit).toBeNull();
    expect(sep.goalDeltaCents).toBeNull();
  });

  it('leaves attainment null when the target is zero rather than dividing by it', () => {
    const p = getProjection(
      ledgerWith({ income: { 4: 100_000 }, targets: { 4: 0 } }),
      YEAR,
      now,
    );
    expect(monthOf(p, 4).goalAttainmentPct).toBeNull();
  });
});

describe('getProjection — the current month', () => {
  const now = new Date(Date.UTC(YEAR, 5, 15)); // June

  it('holds the target as the projection while the month is still running', () => {
    // Actual so far is below target, so the month is projected to reach target.
    const p = getProjection(
      ledgerWith({ income: { 6: 100_000 }, targets: { 6: 250_000 } }),
      YEAR,
      now,
    );
    expect(monthOf(p, 6).projectedNet).toBe(250_000);
  });

  it('keeps the actual when it already exceeds the target', () => {
    const p = getProjection(
      ledgerWith({ income: { 6: 400_000 }, targets: { 6: 250_000 } }),
      YEAR,
      now,
    );
    expect(monthOf(p, 6).projectedNet).toBe(400_000);
  });
});

/**
 * Monthly Payments read every payment's flags as plain truthiness — the group
 * subtotals skip `!item.active`, the row text dims on `!item.active` — but the
 * row's switch is an RN `Switch`, which renders `value === true` strictly. A
 * legacy row persisted with SQLite's 1/0 therefore counted toward its group
 * subtotal while its toggle drew OFF, and the edit form then wrote that same
 * shape straight back. `listRecurring` is the one place every consumer goes
 * through, so it normalizes.
 */
describe('listRecurring — boolean flags', () => {
  function ledgerWithRecurring(
    over: Record<string, unknown>,
  ): LocalBudgetLedger {
    const ledger = emptyLedger();
    ledger.savingsRecurringPayments.push({
      id: 'rp_legacy',
      household_id: ledger.household.id,
      category_id: null,
      label: 'Mortgage Home',
      amount_cents: 434_000,
      currency: 'CAD',
      day_of_month: 1,
      group_label: 'Housing',
      is_essential: true,
      active: true,
      is_automated: false,
      scope_type: 'all_year',
      scope_year: null,
      active_months: null,
      source: 'manual',
      created_by: ledger.memberId,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      ...over,
    } as LocalBudgetLedger['savingsRecurringPayments'][number]);
    return ledger;
  }

  it('normalizes SQLite 1/0 flags to real booleans', () => {
    const view = listRecurring(
      ledgerWithRecurring({ active: 1, is_essential: 1, is_automated: 0 }),
      2026,
      8,
    );
    const item = view.items[0]!;
    expect(item.active).toBe(true);
    expect(item.is_essential).toBe(true);
    expect(item.is_automated).toBe(false);
  });

  it('keeps such a row in the totals it already counted toward', () => {
    // The bug's signature: subtotal said active, the toggle said off. Both
    // halves must now agree.
    const view = listRecurring(ledgerWithRecurring({ active: 1 }), 2026, 8);
    expect(view.totalMonthlyCents).toBe(434_000);
    expect(view.byGroup).toEqual([{ group_label: 'Housing', subtotalCents: 434_000 }]);
    expect(view.items[0]!.active).toBe(true);
  });

  it('leaves a genuinely inactive row off and out of the totals', () => {
    const view = listRecurring(ledgerWithRecurring({ active: 0 }), 2026, 8);
    expect(view.items[0]!.active).toBe(false);
    expect(view.totalMonthlyCents).toBe(0);
    expect(view.byGroup).toEqual([]);
  });

  it('passes real booleans through untouched', () => {
    const view = listRecurring(ledgerWithRecurring({}), 2026, 8);
    expect(view.items[0]!.active).toBe(true);
    expect(view.items[0]!.is_essential).toBe(true);
    expect(view.items[0]!.is_automated).toBe(false);
  });
});

/**
 * The HEADLINE FIGURES of the Projection tab.
 *
 * Everything above pins one month at a time. These pin the aggregates the
 * member actually reads at the top of the screen — "Projected 2026 savings",
 * "CA$x banked · n months to go · goal CA$y", the best-month callout and the
 * Goal-performance card. Reported 2026-09-09 as "I'm not sure the numbers on
 * Projection are right"; none of them had a test before this block, so a wrong
 * total would have shipped silently past a green suite.
 *
 * One shared shape throughout, chosen to mirror a real September ledger:
 *
 *   Jun  income 10,000  spend 12,000  ->  net -2,000   (a genuinely bad month)
 *   Jul  income  9,000  spend  1,000  ->  net +8,000   (the best month)
 *   Aug  income  8,000  spend  3,000  ->  net +5,000
 *   Sep  income  4,000  spend  1,000  ->  net +3,000   (current, still running)
 *   Oct/Nov/Dec  target 7,000 each    (future)
 *
 * All figures are CENTS.
 */
describe('getProjection — the headline figures on the Projection tab', () => {
  const now = new Date(Date.UTC(YEAR, 8, 9)); // 2026-09-09: Jan–Aug past, Sep current

  const septemberLedger = () =>
    ledgerWith({
      income: { 6: 1_000_000, 7: 900_000, 8: 800_000, 9: 400_000 },
      spend: { 6: 1_200_000, 7: 100_000, 8: 300_000, 9: 100_000 },
      targets: { 6: 700_000, 7: 700_000, 8: 700_000, 10: 700_000, 11: 700_000, 12: 700_000 },
    });

  const p = () => getProjection(septemberLedger(), YEAR, now);

  it('banks the completed months PLUS the month still running', () => {
    // -2,000 + 8,000 + 5,000 (completed) + 3,000 (September so far) = 14,000
    expect(p().actualToDate).toBe(1_400_000);
  });

  it('counts only the months after the current one as remaining', () => {
    expect(p().monthsRemaining).toBe(3); // Oct, Nov, Dec — never September
  });

  it('adds the real past to the projected rest for the year-end figure', () => {
    // past actual 1,100,000 + September 300,000 + three targets 2,100,000
    expect(p().projectedYearEnd).toBe(3_500_000);
  });

  it('derives the year-end figure from the per-month rows it renders', () => {
    // The number in the hero must be the sum of the rows below it — if these
    // ever disagree the member sees a total that no month explains.
    const projection = p();
    const fromRows = projection.months.reduce(
      (sum, m) => sum + (m.status === 'actual' ? (m.actualNet ?? 0) : m.projectedNet),
      0,
    );
    expect(projection.projectedYearEnd).toBe(fromRows);
  });

  it('averages the last three completed months for pace, negatives included', () => {
    // (-2,000 + 8,000 + 5,000) / 3 = 3,666.67 -> 366,667 cents
    expect(p().paceMonthly).toBe(366_667);
  });

  it('extends the pace across exactly the remaining months', () => {
    const projection = p();
    expect(projection.paceYearEnd).toBe(
      projection.actualToDate + projection.paceMonthly * projection.monthsRemaining,
    );
    expect(projection.paceYearEnd).toBe(2_500_001);
  });

  it('names the best completed month and never a future one', () => {
    expect(p().bestMonth).toEqual({ month: 7, net: 800_000 });
  });

  it('takes the better of pace and best month as the potential', () => {
    const projection = p();
    expect(projection.potentialMonthly).toBe(800_000);
    expect(projection.potentialMonthly).toBeGreaterThanOrEqual(projection.paceMonthly);
  });

  it('extends the potential across exactly the remaining months', () => {
    const projection = p();
    expect(projection.potentialYearEnd).toBe(
      projection.actualToDate + projection.potentialMonthly * projection.monthsRemaining,
    );
    expect(projection.potentialYearEnd).toBe(3_800_000);
  });

  it('never promises less from the best month than from the recent pace', () => {
    const projection = p();
    expect(projection.potentialYearEnd).toBeGreaterThanOrEqual(projection.paceYearEnd);
  });

  it('counts the targets still ahead, current month included, past excluded', () => {
    const projection = p();
    expect(projection.monthsWithTarget).toBe(3); // Oct/Nov/Dec; Sep carries none
    expect(projection.targetedRemaining).toBe(2_100_000);
  });

  it('reports the yearly goal the header renders as "goal CA$x"', () => {
    // ledgerWith derives target_amount_cents as monthly x 12.
    const withGoal = getProjection(
      ledgerWith({ income: { 6: 1_000_000 }, spend: { 6: 1_200_000 }, goalMonthly: 250_000 }),
      YEAR,
      now,
    );
    expect(withGoal.yearGoal).toBe(3_000_000);
    expect(withGoal.monthlyGoal).toBe(250_000);
  });
});

describe('getProjection — the Goal performance card', () => {
  const now = new Date(Date.UTC(YEAR, 8, 9));

  const graded = () =>
    getProjection(
      ledgerWith({
        income: { 6: 1_000_000, 7: 900_000, 8: 800_000 },
        spend: { 6: 1_200_000, 7: 100_000, 8: 300_000 },
        targets: { 6: 700_000, 7: 700_000, 8: 700_000, 10: 700_000 },
      }),
      YEAR,
      now,
    );

  it('grades only the elapsed months that carry a target', () => {
    // Jun/Jul/Aug are graded; October has a target but has not happened yet.
    expect(graded().goalPerformance.monthsTracked).toBe(3);
  });

  it('counts a month as hit only when the net reached the target', () => {
    // Jun -2,000 miss · Jul 8,000 hit · Aug 5,000 miss
    expect(graded().goalPerformance.monthsHit).toBe(1);
  });

  it('rounds the hit rate the way the card prints it', () => {
    expect(graded().goalPerformance.hitRatePct).toBe(33); // round(1/3 x 100)
  });

  it('lets a bad month pull the average attainment DOWN through zero', () => {
    // Jun -29% · Jul 114% · Aug 71%  ->  round(156 / 3) = 52
    // This is the property that makes "averaging 43% of target" plausible on a
    // real ledger: a single deeply negative month is not floored at zero.
    const perf = graded().goalPerformance;
    expect(perf.avgAttainmentPct).toBe(52);
  });

  it('leaves the card empty rather than dividing by nothing when no month is graded', () => {
    const none = getProjection(
      ledgerWith({ income: { 6: 1_000_000 }, spend: { 6: 100_000 } }),
      YEAR,
      now,
    );
    expect(none.goalPerformance.monthsTracked).toBe(0);
    expect(none.goalPerformance.hitRatePct).toBeNull();
    expect(none.goalPerformance.avgAttainmentPct).toBeNull();
  });
});

/**
 * THE REPORTED LEDGER, reproduced.
 *
 * A member looked at Savings → Projection on 2026-09-09 and said "I'm not sure
 * these numbers are right". Their screen read:
 *
 *   Projected 2026 savings   CA$41,866
 *   CA$20,866 banked · 3 months to go · goal CA$30,000
 *
 * This rebuilds a ledger that produces exactly that hero, so the figures are
 * pinned as a whole rather than one accessor at a time. It is the regression
 * guard for the report: if any of the four ever drifts, this names the case in
 * the member's own numbers instead of an abstract fixture.
 *
 * The arithmetic they could not see:
 *   banked      = -2,000 + 8,000 + 5,000 (Jun-Aug) + 9,866 (Sep so far) = 20,866
 *   year end    = 11,000 (Jan-Aug actual) + 9,866 (Sep) + 3 x 7,000 (Q4 targets)
 *               = 41,866
 *   goal        = the active goal's target, 30,000
 */
describe('getProjection — the ledger behind the 2026-09-09 report', () => {
  const now = new Date(Date.UTC(YEAR, 8, 9));

  const reported = () =>
    getProjection(
      ledgerWith({
        income: { 6: 1_000_000, 7: 900_000, 8: 800_000, 9: 986_600 },
        spend: { 6: 1_200_000, 7: 100_000, 8: 300_000 },
        targets: { 10: 700_000, 11: 700_000, 12: 700_000 },
        goalMonthly: 250_000, // target_amount_cents = 250,000 x 12 = 3,000,000
      }),
      YEAR,
      now,
    );

  it('reproduces the reported hero figure to the cent', () => {
    expect(reported().projectedYearEnd).toBe(4_186_600); // CA$41,866.00
  });

  it('reproduces the reported banked figure', () => {
    expect(reported().actualToDate).toBe(2_086_600); // CA$20,866.00
  });

  it('reproduces the reported "3 months to go"', () => {
    expect(reported().monthsRemaining).toBe(3);
  });

  it('reproduces the reported year goal', () => {
    expect(reported().yearGoal).toBe(3_000_000); // CA$30,000
  });

  it('leaves the hero exactly the banked amount plus the three targets ahead', () => {
    // The relationship the member was really asking about: what turns 20,866
    // into 41,866 is the 21,000 of goals they had already set for Q4 — nothing
    // is invented, and nothing from the past is double-counted.
    const p = reported();
    expect(p.projectedYearEnd - p.actualToDate).toBe(2_100_000);
    expect(p.targetedRemaining).toBe(2_100_000);
  });
});

/**
 * REPORTED AND FIXED — a future month the member filled in is forecast from
 * their own rows, not from a goal they set months ago.
 *
 * Reported 2026-09-09: "income for October, November and December dropped a
 * lot… the numbers don't reflect reality". Confirmed on the reporter's device:
 * their ledger held 4 savingsIncome rows in each of 2026-10, -11 and -12 —
 * entered deliberately, because they knew their income was falling for the next
 * two to three months. `getProjection` read none of them: for `status ===
 * 'future'` the chain was target -> goal -> pace and `row.net` was consulted on
 * no branch, so every filled-in month rendered at its goal and the year-end sat
 * far above anything their entries supported.
 *
 * DATA BEATS PLAN is the rule now. The one thing it cannot fix is a month
 * holding income but no spending yet: it nets out higher than the month will
 * really land, which is why `projectionSource` is surfaced and the row says
 * "From your entries" instead of quietly reading like a goal.
 */
describe('getProjection — a future month the member has already filled in', () => {
  const now = new Date(Date.UTC(YEAR, 8, 9)); // September

  // October holds real, entered income far below the 7,000 target.
  const octoberFilledIn = () =>
    ledgerWith({
      income: { 6: 1_000_000, 7: 900_000, 8: 800_000, 10: 120_000 },
      spend: { 6: 1_200_000, 7: 100_000, 8: 300_000 },
      targets: { 10: 700_000 },
    });

  it('forecasts the month from the entered rows, not from the target', () => {
    const oct = monthOf(getProjection(octoberFilledIn(), YEAR, now), 10);
    expect(oct.projectedNet).toBe(120_000);
    expect(oct.projectionSource).toBe('entered');
  });

  it('keeps the target visible so the plan is not lost', () => {
    const oct = monthOf(getProjection(octoberFilledIn(), YEAR, now), 10);
    expect(oct.targetCents).toBe(700_000);
  });

  it('surfaces the real figure instead of the "nothing recorded" null', () => {
    const oct = monthOf(getProjection(octoberFilledIn(), YEAR, now), 10);
    expect(oct.hasData).toBe(true);
    expect(oct.actualNet).toBe(120_000);
  });

  it('carries the member\'s own figure into the year-end hero', () => {
    const p = getProjection(octoberFilledIn(), YEAR, now);
    // The hero is the sum of the rows, so compare the whole year against the
    // same year with October's target honoured instead of its entries: the
    // difference is exactly what the member's October rows changed.
    const fromRows = p.months.reduce(
      (sum, m) => sum + (m.status === 'actual' ? (m.actualNet ?? 0) : m.projectedNet),
      0,
    );
    expect(p.projectedYearEnd).toBe(fromRows);

    const octContribution = monthOf(p, 10).projectedNet;
    expect(octContribution).toBe(120_000); // not the 700,000 target it used to add
  });

  it('prefers entered rows over the savings goal too', () => {
    const p = getProjection(
      ledgerWith({
        income: { 6: 1_000_000, 7: 900_000, 8: 800_000, 10: 120_000 },
        spend: { 6: 1_200_000, 7: 100_000, 8: 300_000 },
        goalMonthly: 500_000,
      }),
      YEAR,
      now,
    );
    expect(monthOf(p, 10).projectionSource).toBe('entered');
    expect(monthOf(p, 10).projectedNet).toBe(120_000);
  });

  it('prefers entered rows over the recent pace too', () => {
    const p = getProjection(
      ledgerWith({
        income: { 6: 1_000_000, 7: 900_000, 8: 800_000, 10: 120_000 },
        spend: { 6: 1_200_000, 7: 100_000, 8: 300_000 },
      }),
      YEAR,
      now,
    );
    expect(monthOf(p, 10).projectionSource).toBe('entered');
    expect(monthOf(p, 10).projectedNet).toBe(120_000);
  });

  it('still plans an EMPTY month ahead from the target', () => {
    // November was never touched, so nothing changed for it.
    const p = getProjection(
      ledgerWith({
        income: { 6: 1_000_000, 7: 900_000, 8: 800_000, 10: 120_000 },
        spend: { 6: 1_200_000, 7: 100_000, 8: 300_000 },
        targets: { 10: 700_000, 11: 700_000 },
      }),
      YEAR,
      now,
    );
    expect(monthOf(p, 11).projectionSource).toBe('target');
    expect(monthOf(p, 11).projectedNet).toBe(700_000);
  });

  /**
   * The regression this guard exists for: `monthlyPaymentsTotal` lands the
   * recurring schedule on EVERY future month by itself. Keying "filled in" off
   * the projector's `hasData` would treat all of them as entered and project
   * each at its commitments with none of its income — turning a whole year
   * ahead negative for any household that uses recurring payments.
   */
  it('does not treat a month as filled in just because recurring payments land on it', () => {
    const p = getProjection(
      ledgerWith({
        income: { 6: 1_000_000, 7: 900_000, 8: 800_000 },
        spend: { 6: 1_200_000, 7: 100_000, 8: 300_000 },
        targets: { 11: 700_000 },
      }),
      YEAR,
      now,
    );
    expect(monthOf(p, 11).projectionSource).toBe('target');
    expect(monthOf(p, 11).projectedNet).toBe(700_000);
  });
});

describe('getProjection — saying what an entered month ahead does NOT include', () => {
  const now = new Date(Date.UTC(YEAR, 8, 9)); // September

  it('marks an entered month that has no logged spending', () => {
    // The reporting household's exact shape: Q4 income entered, zero expenses.
    const withIncomeOnly = getProjection(
      ledgerWith({ income: { 6: 1_000_000, 10: 120_000 }, spend: { 6: 1_200_000 } }),
      YEAR,
      now,
    );
    const oct = monthOf(withIncomeOnly, 10);
    expect(oct.projectionSource).toBe('entered');
    expect(oct.spendingLogged).toBe(false);
  });

  it('clears the flag once the month has spending of its own', () => {
    const p = getProjection(
      ledgerWith({
        income: { 6: 1_000_000, 10: 120_000 },
        spend: { 6: 1_200_000, 10: 40_000 },
      }),
      YEAR,
      now,
    );
    const oct = monthOf(p, 10);
    expect(oct.spendingLogged).toBe(true);
    expect(oct.projectedNet).toBe(80_000); // 1,200 in, 400 out
  });
});

describe('getProjection — goal performance reports a typical month', () => {
  const now = new Date(Date.UTC(YEAR, 8, 9));

  it('reports the MEDIAN attainment, which one catastrophic month cannot drag', () => {
    // Jun -171% · Jul 71% · Aug 114%. The mean is 5 — a figure no month came
    // near — which is exactly what the card used to print.
    const p = getProjection(
      ledgerWith({
        income: { 6: 100_000, 7: 800_000, 8: 900_000 },
        spend: { 6: 1_300_000, 7: 300_000, 8: 100_000 },
        targets: { 6: 700_000, 7: 700_000, 8: 700_000 },
      }),
      YEAR,
      now,
    );
    expect(p.goalPerformance.monthsTracked).toBe(3);
    expect(p.goalPerformance.medianAttainmentPct).toBe(71);
    expect(p.goalPerformance.avgAttainmentPct).toBe(5);
  });

  it('has no typical month when nothing is graded', () => {
    const p = getProjection(ledgerWith({ income: { 6: 500_000 }, spend: { 6: 100_000 } }), YEAR, now);
    expect(p.goalPerformance.medianAttainmentPct).toBeNull();
  });
});

/**
 * The four selectable Projection methods (mirrors
 * backend/src/services/__tests__/savings-projection.test.ts, which is the
 * source of truth for the formulas — these pin the SAME behavior on the
 * offline engine so local-first and server never disagree).
 */
describe('getProjection — method selection', () => {
  const now = new Date(Date.UTC(YEAR, 6, 15)); // 2026-07-15: Jan–Jun actual, Jul current

  it('historical_average ignores the standing goal and uses the flat pace', () => {
    const p = getProjection(
      ledgerWith({
        income: { 4: 500_000, 5: 500_000, 6: 500_000 },
        spend: { 4: 300_000, 5: 300_000, 6: 300_000 }, // pace = 200,000
        goalMonthly: 500_000,
      }),
      YEAR,
      now,
      'historical_average',
    );
    expect(p.method).toBe('historical_average');
    expect(monthOf(p, 8).projectedNet).toBe(200_000);
    expect(monthOf(p, 8).projectionSource).toBe('pace');
  });

  it('trend continues an improving trajectory past the flat pace', () => {
    const p = getProjection(
      ledgerWith({
        income: { 1: 300_000, 2: 350_000, 3: 400_000, 4: 450_000, 5: 500_000, 6: 550_000 },
        spend: { 1: 200_000, 2: 200_000, 3: 200_000, 4: 200_000, 5: 200_000, 6: 200_000 },
        // net: 100k, 150k, 200k, 250k, 300k, 350k — a clean +50k/month climb.
      }),
      YEAR,
      now,
      'trend',
    );
    expect(p.paceMonthly).toBe(300_000); // flat pace only reads the last 3 months
    expect(monthOf(p, 8).projectedNet).toBe(400_000); // 350k + the 50k/month delta
  });

  it('planned_budget computes income minus recurring payments minus the Planning-tab budget', () => {
    const ledger = ledgerWith({});
    ledger.savingsIncomeTemplates.push({
      id: 'tmpl_payroll',
      household_id: ledger.household.id,
      member_id: null,
      source_type: 'payroll',
      label: 'Paycheck',
      amount_cents: 2_000_000, // $20,000/mo
      currency: 'CAD',
      day_of_month: null,
      active: true,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    ledger.savingsRecurringPayments.push({
      id: 'rp_rent',
      household_id: ledger.household.id,
      category_id: null,
      label: 'Rent',
      amount_cents: 1_000_000, // $10,000/mo
      currency: 'CAD',
      day_of_month: null,
      group_label: null,
      is_essential: true,
      active: true,
      is_automated: false,
      scope_type: 'all_year',
      scope_year: null,
      active_months: null,
    } as unknown as LocalBudgetLedger['savingsRecurringPayments'][number]);
    ledger.goals.push({
      id: 'bg_sep',
      household_id: ledger.household.id,
      year: YEAR,
      month: 9,
      planned_budget: 200_000, // $2,000
      actual_spent: 0,
      category_budgets: null,
      notes: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const p = getProjection(ledger, YEAR, now, 'planned_budget');
    // The worked example: 20,000 income - 10,000 payments - 2,000 spending goal = 8,000.
    expect(monthOf(p, 9).projectedNet).toBe(800_000);
  });

  it('planned_budget falls back to the pace when the Planning-tab budget is unresolved', () => {
    const p = getProjection(
      ledgerWith({
        income: { 4: 500_000, 5: 500_000, 6: 500_000 },
        spend: { 4: 300_000, 5: 300_000, 6: 300_000 }, // pace = 200,000
      }),
      YEAR,
      now,
      'planned_budget',
    );
    expect(monthOf(p, 8).projectedNet).toBe(200_000);
  });

  it('methodComparison reports all 4 methods, and the selected one matches projectedYearEnd', () => {
    const p = getProjection(
      ledgerWith({
        income: { 4: 500_000, 5: 500_000, 6: 500_000 },
        spend: { 4: 300_000, 5: 300_000, 6: 300_000 },
      }),
      YEAR,
      now,
      'historical_average',
    );
    expect(p.methodComparison.map((m) => m.method).sort()).toEqual(
      ['historical_average', 'hybrid', 'planned_budget', 'trend'].sort(),
    );
    const selected = p.methodComparison.find((m) => m.method === 'historical_average')!;
    expect(selected.projectedYearEnd).toBe(p.projectedYearEnd);
  });
});
