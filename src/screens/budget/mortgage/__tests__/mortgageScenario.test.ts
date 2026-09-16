import type { MortgageSummary } from '@api/mortgage';
import {
  levelPayment,
  periodicRate,
  roundCents,
} from '@features/mortgage/amortization';

import {
  buildRateLadder,
  buildScenarioSeed,
  computeRateScenario,
  type ScenarioSeed,
} from '../mortgageScenario';

// A self-consistent seed: 500k over 300mo at 5% semi-annual → PMT 2908.02.
const CURRENT_PMT = roundCents(levelPayment(500_000, periodicRate(0.05, 12, 'semi_annual'), 300)); // 2908.02
const SEED: ScenarioSeed = {
  currentBalance: 500_000,
  currentEquity: 100_000,
  currentPayment: CURRENT_PMT,
  currentNominal: 0.05,
  frequency: 'monthly',
  compounding: 'semi_annual',
  remainingAmortizationMonths: 300,
  paymentsToMaturity: 60,
};

describe('computeRateScenario', () => {
  it('reproduces the current payment when the scenario rate equals the current rate', () => {
    const s = computeRateScenario(SEED, 0.05);
    expect(s.paymentDollars).toBeCloseTo(CURRENT_PMT, 2);
    expect(s.paymentDeltaDollars).toBeCloseTo(0, 2);
  });

  it('a higher rate raises the payment and the interest paid', () => {
    const base = computeRateScenario(SEED, 0.05);
    const higher = computeRateScenario(SEED, 0.07);
    expect(higher.paymentDollars).toBeGreaterThan(base.paymentDollars);
    expect(higher.paymentDeltaDollars).toBeGreaterThan(0);
    expect(higher.interestToMaturityDollars).toBeGreaterThan(base.interestToMaturityDollars);
    expect(higher.totalInterestToPayoffDollars).toBeGreaterThan(base.totalInterestToPayoffDollars);
    // A bigger balance remains at maturity → less equity built.
    expect(higher.balanceAtMaturityDollars).toBeGreaterThan(base.balanceAtMaturityDollars);
    expect(higher.equityAtMaturityDollars).toBeLessThan(base.equityAtMaturityDollars);
  });

  it('a lower rate lowers the payment and interest', () => {
    const base = computeRateScenario(SEED, 0.05);
    const lower = computeRateScenario(SEED, 0.03);
    expect(lower.paymentDollars).toBeLessThan(base.paymentDollars);
    expect(lower.paymentDeltaDollars).toBeLessThan(0);
    expect(lower.interestToMaturityDollars).toBeLessThan(base.interestToMaturityDollars);
  });

  it('equity at maturity = current equity + principal repaid to maturity', () => {
    const s = computeRateScenario(SEED, 0.05);
    expect(s.equityAtMaturityDollars).toBeCloseTo(
      SEED.currentEquity + (SEED.currentBalance - s.balanceAtMaturityDollars),
      2
    );
  });

  it('keepPaymentPayoffMonths is null when the rate is so high the current payment cannot amortize', () => {
    const trigger = computeRateScenario(SEED, 0.3); // 30% — payment < interest
    expect(trigger.keepPaymentPayoffMonths).toBeNull();
  });

  it('keepPaymentPayoffMonths is a finite horizon at a normal rate', () => {
    const s = computeRateScenario(SEED, 0.05);
    expect(s.keepPaymentPayoffMonths).not.toBeNull();
    expect(s.keepPaymentPayoffMonths).toBeGreaterThan(0);
  });
});

describe('buildRateLadder', () => {
  it('is monotonic, includes the current rate, and spans ±span around it', () => {
    const ladder = buildRateLadder(0.05, 300, 25);
    expect(ladder[0]).toBeCloseTo(0.02, 4); // 5% − 3%
    expect(ladder[ladder.length - 1]).toBeCloseTo(0.08, 4); // 5% + 3%
    expect(ladder).toContain(0.05);
    for (let k = 1; k < ladder.length; k += 1) expect(ladder[k]).toBeGreaterThan(ladder[k - 1]);
  });

  it('clamps to a sane [0.5%, 25%] band', () => {
    const low = buildRateLadder(0.01, 300, 25); // would go negative
    expect(low[0]).toBeCloseTo(0.005, 4);
    const high = buildRateLadder(0.24, 300, 25); // would exceed 25%
    expect(high[high.length - 1]).toBeCloseTo(0.25, 4);
  });
});

describe('buildScenarioSeed', () => {
  it('maps a server summary into a scenario seed (cents→dollars, days→payments)', () => {
    const summary = {
      currentBalanceCents: 50_000_000,
      equity: { totalEquityCents: 10_000_000 },
      scheduledPaymentCents: 290_802,
      rate: { nominalPct: 5, compounding: 'semi_annual' },
      paymentFrequency: 'monthly',
      remainingAmortizationMonths: 300,
      daysToRenewal: 365 * 5, // ~5 years → 60 monthly payments
    } as unknown as MortgageSummary;
    const seed = buildScenarioSeed(summary);
    expect(seed.currentBalance).toBe(500_000);
    expect(seed.currentEquity).toBe(100_000);
    expect(seed.currentPayment).toBeCloseTo(2908.02, 2);
    expect(seed.currentNominal).toBeCloseTo(0.05, 4);
    expect(seed.frequency).toBe('monthly');
    expect(seed.compounding).toBe('semi_annual');
    expect(seed.remainingAmortizationMonths).toBe(300);
    expect(seed.paymentsToMaturity).toBe(60);
  });

  it('clamps a negative daysToRenewal (already matured) to zero payments', () => {
    const summary = {
      currentBalanceCents: 50_000_000,
      equity: { totalEquityCents: 0 },
      scheduledPaymentCents: 290_802,
      rate: { nominalPct: 5, compounding: 'semi_annual' },
      paymentFrequency: 'monthly',
      remainingAmortizationMonths: 300,
      daysToRenewal: -30,
    } as unknown as MortgageSummary;
    expect(buildScenarioSeed(summary).paymentsToMaturity).toBe(0);
  });
});
