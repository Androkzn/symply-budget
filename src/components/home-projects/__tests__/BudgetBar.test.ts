/**
 * The spend meter at the top of every project surface.
 *
 * `spendMeter` IS the picture: the denominator, the fill fraction and the status
 * colour are the whole of what the bar draws, and none of them is assertable by
 * rendering a track whose fill is a percentage width. The strip replaced two
 * printed figures (Target and Actual) with a proportion, so a wrong denominator
 * no longer shows up as an odd-looking number — it shows up as a bar that is
 * confidently, silently measuring the wrong thing.
 */
import type { BudgetRollups } from '@api/home-projects';

import { spendMeter } from '../BudgetBar';

function rollups(over: Partial<BudgetRollups>): BudgetRollups {
  return {
    estimate_total: 0,
    actual_total: 0,
    contingency_cents: 0,
    target_budget_cents: null,
    budget_health: 'ok',
    ...over,
  };
}

describe('spendMeter', () => {
  it('measures against the member’s target when they set one', () => {
    const meter = spendMeter(
      rollups({ target_budget_cents: 300_000, actual_total: 75_000, estimate_total: 1_150_000 })
    );
    expect(meter.againstTarget).toBe(true);
    expect(meter.baseCents).toBe(300_000);
    expect(meter.fraction).toBeCloseTo(0.25);
    expect(meter.remainingCents).toBe(225_000);
  });

  /**
   * A bar that silently changes its denominator is worse than no bar, which is
   * what `againstTarget` is for — the caption above it names which number the
   * member is being measured against.
   */
  it('falls back to what has been priced when there is no target', () => {
    const meter = spendMeter(rollups({ estimate_total: 400_000, actual_total: 100_000 }));
    expect(meter.againstTarget).toBe(false);
    expect(meter.baseCents).toBe(400_000);
    expect(meter.fraction).toBeCloseTo(0.25);
  });

  it('treats a zero or negative target as no target at all', () => {
    for (const target of [0, -1]) {
      const meter = spendMeter(rollups({ target_budget_cents: target, estimate_total: 500_000 }));
      expect(meter.againstTarget).toBe(false);
      expect(meter.baseCents).toBe(500_000);
    }
  });

  it('reports nothing to measure on an untouched project', () => {
    const meter = spendMeter(rollups({}));
    expect(meter.baseCents).toBe(0);
    expect(meter.fraction).toBe(0);
    expect(meter.tone).toBe('ok');
  });

  it('clamps an overspend to a full bar and reports the excess as negative', () => {
    const meter = spendMeter(rollups({ target_budget_cents: 300_000, actual_total: 450_000 }));
    expect(meter.fraction).toBe(1);
    expect(meter.remainingCents).toBe(-150_000);
    expect(meter.tone).toBe('over');
  });

  /**
   * `budget_health` compares the ESTIMATE against the target, so it reads `ok` on
   * a project nobody has priced — including one that has already spent past its
   * target. Deferring to it outright would paint that bar green.
   */
  it('calls an actual overspend over, whatever budget_health says', () => {
    const meter = spendMeter(
      rollups({ target_budget_cents: 300_000, actual_total: 310_000, budget_health: 'ok' })
    );
    expect(meter.tone).toBe('over');
  });

  it('defers to budget_health for the watch state', () => {
    const meter = spendMeter(
      rollups({ target_budget_cents: 300_000, actual_total: 10_000, budget_health: 'watch' })
    );
    expect(meter.tone).toBe('watch');
  });

  /**
   * `budget_health: 'over'` means the ESTIMATE has passed the target — a warning
   * about what the project is going to cost, not a report that money has left the
   * member's account. The meter is about spend, so it stays calm until it has.
   */
  it('does not paint the bar over for an estimate that exceeds the target', () => {
    const meter = spendMeter(
      rollups({ target_budget_cents: 300_000, actual_total: 0, budget_health: 'over' })
    );
    expect(meter.tone).toBe('ok');
    expect(meter.fraction).toBe(0);
  });

  it('never returns a negative or non-finite fraction', () => {
    expect(spendMeter(rollups({ estimate_total: -100, actual_total: 50 })).fraction).toBe(0);
    expect(spendMeter(rollups({ target_budget_cents: 100, actual_total: -50 })).fraction).toBe(0);
  });
});
