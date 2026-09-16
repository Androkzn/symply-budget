import { describe, it, expect } from 'vitest';

import {
  computeBudgetEncouragement,
  type EncouragementInput,
} from '../budget-encouragement';

/** A neutral, on-track current month with a cap set — override per test. */
function input(over: Partial<EncouragementInput> = {}): EncouragementInput {
  return {
    monthPosition: 'current',
    monthName: 'July',
    plannedBudget: 200000, // $2000
    actualSpent: 90000, // $900
    remainingBudget: 110000, // $1100
    spentThisWeek: 20000,
    spentLastWeek: 20000,
    hasSpendHistory: true,
    ytdSavings: 0,
    monthsUnderBudgetStreak: 0,
    dayOfMonth: 15,
    daysInMonth: 31,
    ...over,
  };
}

describe('computeBudgetEncouragement', () => {
  it('celebrates a genuine no-spend week (with spend history)', () => {
    const r = computeBudgetEncouragement(input({ spentThisWeek: 0, spentLastWeek: 15000 }));
    expect(r.tone).toBe('celebrate');
    expect(r.isPositive).toBe(true);
    expect(r.emoji).toBe('🎉');
  });

  it('does NOT treat a no-spend week as a win when there is no spend history', () => {
    const r = computeBudgetEncouragement(
      input({ spentThisWeek: 0, spentLastWeek: 0, actualSpent: 0, hasSpendHistory: false, remainingBudget: 200000 })
    );
    // Falls through to on-track, not a celebration.
    expect(r.isPositive).toBe(false);
  });

  it('celebrates being meaningfully ahead of the monthly pace', () => {
    // Day 15/31 of a $2000 budget → expected ≈ $967; spent $300 → ~$667 under pace.
    const r = computeBudgetEncouragement(input({ actualSpent: 30000, remainingBudget: 170000 }));
    expect(r.tone).toBe('celebrate');
    expect(r.paceSavingsCents).toBeGreaterThan(0);
    expect(r.highlight).toContain('under pace');
  });

  it('flags spending trending down week over week', () => {
    // Not ahead of pace (spent at pace), but this week < last week.
    const r = computeBudgetEncouragement(
      input({ actualSpent: 96774, remainingBudget: 103226, spentThisWeek: 10000, spentLastWeek: 30000 })
    );
    expect(r.tone).toBe('positive');
    expect(r.weekOverWeekDeltaCents).toBe(-20000);
  });

  it('tells the growing-savings story when YTD savings are meaningful', () => {
    const r = computeBudgetEncouragement(
      input({
        actualSpent: 96774,
        remainingBudget: 103226,
        spentThisWeek: 20000,
        spentLastWeek: 20000,
        ytdSavings: 45000,
        monthsUnderBudgetStreak: 3,
      })
    );
    expect(r.tone).toBe('positive');
    expect(r.emoji).toBe('🌱');
    expect(r.message).toContain('3 months');
  });

  it('stays honest but constructive when over budget', () => {
    const r = computeBudgetEncouragement(input({ actualSpent: 250000, remainingBudget: -50000 }));
    expect(r.tone).toBe('watch');
    expect(r.isPositive).toBe(false);
  });

  it('nudges to set a budget when no cap exists', () => {
    const r = computeBudgetEncouragement(input({ plannedBudget: 0, actualSpent: 0, remainingBudget: 0 }));
    expect(r.tone).toBe('tip');
    expect(r.paceSavingsCents).toBeNull();
  });

  it('celebrates a past month finished under budget', () => {
    const r = computeBudgetEncouragement(
      input({ monthPosition: 'past', actualSpent: 150000, remainingBudget: 50000 })
    );
    expect(r.tone).toBe('celebrate');
    expect(r.emoji).toBe('🏆');
    expect(r.highlight).toContain('under budget');
  });

  it('has no week-over-week baseline when last week had zero spend', () => {
    const r = computeBudgetEncouragement(input({ spentLastWeek: 0 }));
    expect(r.weekOverWeekDeltaCents).toBeNull();
  });
});
