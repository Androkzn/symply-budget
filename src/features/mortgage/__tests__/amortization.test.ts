/**
 * Client-mirror parity test — the SAME golden vectors as
 * backend/src/services/mortgage/__tests__/amortization.test.ts, run under jest,
 * so the wizard-preview engine can never drift from the server engine.
 */

import {
  PAYMENTS_PER_YEAR,
  paymentsPerYear,
  isAccelerated,
  roundCents,
  periodicRate,
  effectiveAnnualRate,
  levelPayment,
  balanceAfter,
  remainingPeriods,
  totalInterest,
  interestOverPeriods,
  interestShareOfPayment,
  crossoverPayment,
  reAmortizePayment,
  dailySimpleInterest,
  solveNominalRate,
  buildSchedule,
  equityBreakdown,
} from '../amortization';

/**
 * Golden vectors GV-1..GV-10 (see the implementation plan §11.2). Values are
 * externally verified against the Canadian semi-annual convention and, for
 * GV-10, a REAL TD Home Equity FlexLine statement (to the cent). The client
 * mirror (src/features/mortgage) asserts the identical numbers so the two
 * engines can never diverge.
 */

describe('helpers', () => {
  it('maps every payment frequency to a payments-per-year count', () => {
    expect(PAYMENTS_PER_YEAR.monthly).toBe(12);
    expect(paymentsPerYear('biweekly')).toBe(26);
    expect(paymentsPerYear('accel_weekly')).toBe(52);
  });

  it('flags accelerated frequencies', () => {
    expect(isAccelerated('accel_biweekly')).toBe(true);
    expect(isAccelerated('monthly')).toBe(false);
  });

  it('rounds to whole cents', () => {
    expect(roundCents(2908.024925)).toBe(2908.02);
    expect(roundCents(846.0672)).toBe(846.07);
  });
});

describe('GV-1 — 500,000 @ 5% semi-annual, 25yr, monthly', () => {
  const P = 500_000;
  const j = 0.05;
  const n = 12;
  const N = 300;
  const i = periodicRate(j, n, 'semi_annual');
  const pmt = levelPayment(P, i, N);

  it('periodic rate uses semi-annual compounding (not j/12)', () => {
    expect(i).toBeCloseTo(0.00412391547, 9);
    expect(i).not.toBeCloseTo(j / 12, 6);
  });

  it('effective annual rate is 5.0625%', () => {
    expect(effectiveAnnualRate(j, n, 'semi_annual')).toBeCloseTo(0.050625, 6);
  });

  it('monthly payment is $2,908.02', () => {
    expect(roundCents(pmt)).toBe(2908.02);
  });

  it("payment 1 splits $2,061.96 interest / $846.07 principal", () => {
    const interest1 = P * i;
    const principal1 = pmt - interest1;
    expect(roundCents(interest1)).toBe(2061.96);
    expect(roundCents(principal1)).toBe(846.07);
  });

  it('balance after 1 / 60 / 300 payments', () => {
    expect(balanceAfter(P, i, pmt, 1)).toBeCloseTo(499153.93, 2);
    expect(balanceAfter(P, i, pmt, 60)).toBeCloseTo(442537.54, 2);
    expect(balanceAfter(P, i, pmt, 300)).toBeCloseTo(0, 2);
  });

  it('total lifetime interest is $372,407.48', () => {
    expect(totalInterest(pmt, N, P)).toBeCloseTo(372407.48, 2);
  });

  it('interest share is ~1 on payment 1 and tiny on the last', () => {
    expect(interestShareOfPayment(i, N, 1)).toBeGreaterThan(0.7);
    // The final payment still carries one period of interest on the last sliver
    // of balance: i/(1+i) ≈ 0.41%, not exactly zero.
    expect(interestShareOfPayment(i, N, N)).toBeLessThan(0.01);
  });

  it('principal overtakes interest partway through (crossover)', () => {
    const k = crossoverPayment(i, N);
    expect(k).toBeGreaterThan(1);
    expect(k).toBeLessThan(N);
  });
});

describe('GV-2 — accelerated biweekly', () => {
  it('pays ~$1,454.01 biweekly and clears in ~558 payments (~21.5yr)', () => {
    const P = 500_000;
    const iMonthly = periodicRate(0.05, 12, 'semi_annual');
    const pmtMonthly = roundCents(levelPayment(P, iMonthly, 300));
    const pmtAccel = roundCents(pmtMonthly / 2);
    expect(pmtAccel).toBe(1454.01);
    const i26 = periodicRate(0.05, 26, 'semi_annual');
    const payoff = remainingPeriods(P, i26, pmtAccel);
    expect(payoff).not.toBeNull();
    expect(payoff!).toBeGreaterThan(555);
    expect(payoff!).toBeLessThan(560);
    expect(payoff! / 26).toBeLessThan(22); // shorter than the 25yr base amortization
  });
});

describe('GV-4 — renewal re-amortizes over ACTUAL remaining amortization (not N−k)', () => {
  it('$50k lump at pmt 60 then renew at 6% → PMT ≈ $3,115, not $2,796', () => {
    const P = 500_000;
    const i = periodicRate(0.05, 12, 'semi_annual');
    const pmt = levelPayment(P, i, 300);
    const balance60 = balanceAfter(P, i, pmt, 60);
    const afterLump = balance60 - 50_000;

    // Correct: remaining amortization is what's left continuing the ORIGINAL
    // payment at the old rate — NOT the calendar N−k = 240.
    const nRem = remainingPeriods(afterLump, i, roundCents(pmt));
    expect(nRem).not.toBeNull();
    expect(nRem!).toBeCloseTo(197.65, 1);

    const pmtPrime = reAmortizePayment(afterLump, 0.06, nRem!, 12, 'semi_annual');
    expect(pmtPrime).toBeCloseTo(3115.06, 1);

    // The naive N−k approach materially understates the payment (~11% low).
    const naive = reAmortizePayment(afterLump, 0.06, 240, 12, 'semi_annual');
    expect(naive).toBeCloseTo(2795.61, 1);
    expect(pmtPrime - naive).toBeGreaterThan(300);
  });
});

describe('GV-5 — semi-annual vs monthly compounding', () => {
  it('the compounding column drives the periodic rate', () => {
    expect(periodicRate(0.05, 12, 'semi_annual')).toBeCloseTo(0.00412392, 8);
    expect(periodicRate(0.05, 12, 'monthly')).toBeCloseTo(0.00416667, 8);
  });
});

describe('GV-8 — solve nominal rate from a known payment', () => {
  it('recovers ~5.00% from the GV-1 payment', () => {
    const P = 500_000;
    const pmt = roundCents(levelPayment(P, periodicRate(0.05, 12, 'semi_annual'), 300));
    const nominal = solveNominalRate(P, pmt, 12, 300, 'semi_annual');
    expect(nominal).toBeCloseTo(0.05, 4);
  });

  it('returns 0 when the payment only covers principal', () => {
    expect(solveNominalRate(120_000, 1000, 12, 120, 'semi_annual')).toBe(0);
  });
});

describe('GV-9 — full schedule with final-payment true-up', () => {
  const rows = buildSchedule({
    principal: 500_000,
    nominalAnnual: 0.05,
    frequency: 'monthly',
    compounding: 'semi_annual',
    amortizationMonths: 300,
  });

  it('has 300 rows; the first row splits from the ACTUAL rounded payment', () => {
    expect(rows).toHaveLength(300);
    expect(rows[0].interest).toBe(2061.96);
    // The schedule splits from the rounded payment ($2,908.02) the borrower
    // actually pays, so interest + principal sum to it exactly: 846.06, not the
    // theoretical-unrounded 846.07 of GV-1.
    expect(rows[0].principal).toBe(846.06);
    expect(rows[0].interest + rows[0].principal).toBe(2908.02);
  });

  it('drives the final balance to exactly $0.00', () => {
    expect(rows[rows.length - 1].balance).toBe(0);
    expect(rows[rows.length - 1].index).toBe(300);
  });

  it('honors a payment override (statement-stated payment)', () => {
    const overridden = buildSchedule({
      principal: 500_000,
      nominalAnnual: 0.05,
      frequency: 'monthly',
      compounding: 'semi_annual',
      amortizationMonths: 300,
      paymentOverride: 3200,
    });
    // A bigger payment retires the loan early → fewer than 300 rows, ends at 0.
    expect(overridden.length).toBeLessThan(300);
    expect(overridden[overridden.length - 1].balance).toBe(0);
  });
});

describe('GV-10 — real TD FlexLine statement (variable, daily interest)', () => {
  it('daily simple interest reproduces the statement to the cent', () => {
    // 976,000 @ 4.090% variable, 14-day period → interest paid $1,531.12.
    expect(roundCents(dailySimpleInterest(976_000, 0.0409, 14))).toBe(1531.12);
  });

  it('reconciliation identity: advance − principal_paid = closing balance', () => {
    expect(roundCents(976_000 - 638.96)).toBe(975361.04);
  });
});

describe('GV-3 — equity decomposition with a financed CMHC premium', () => {
  it('paydown uses (price − down), so the financed premium is not counted as equity', () => {
    // price 800k, down 100k, financed premium 15k → loan principal 715k.
    const eq = equityBreakdown({
      price: 800_000,
      downPayment: 100_000,
      originalPrincipal: 715_000, // includes the 15k premium
      currentValue: 850_000,
      balance: 690_000,
    });
    // paydown is measured from price−down (700k), NOT originalPrincipal (715k).
    expect(eq.paydownEquity).toBe(10_000); // 700k − 690k, not 25k
    expect(eq.appreciationEquity).toBe(50_000); // 850k − 800k
    expect(eq.downPayment).toBe(100_000);
    expect(eq.hasAppreciation).toBe(true);
    // Identity holds exactly even with the financed premium.
    expect(eq.totalEquity).toBe(160_000); // 850k − 690k
  });

  it('hides appreciation when price/down are known but current value is not', () => {
    const eq = equityBreakdown({
      price: 800_000,
      downPayment: 100_000,
      originalPrincipal: 715_000,
      currentValue: null,
      balance: 690_000,
    });
    expect(eq.hasAppreciation).toBe(false);
    expect(eq.appreciationEquity).toBe(0);
    // total = down + paydown + 0 = 100k + (700k − 690k) = 110k
    expect(eq.totalEquity).toBe(110_000);
  });

  it('degrades to paydown-only when price/down are unknown', () => {
    const eq = equityBreakdown({
      originalPrincipal: 500_000,
      balance: 450_000,
      price: null,
      downPayment: null,
    });
    expect(eq.downPayment).toBe(0);
    expect(eq.paydownEquity).toBe(50_000); // 500k − 450k
    expect(eq.appreciationEquity).toBe(0);
    expect(eq.hasAppreciation).toBe(false);
    expect(eq.totalEquity).toBe(50_000);
  });
});

describe('engine edge branches', () => {
  it('levelPayment handles zero interest and zero term', () => {
    expect(levelPayment(1200, 0, 12)).toBe(100);
    expect(levelPayment(1200, 0.01, 0)).toBe(0);
  });

  it('balanceAfter handles k<=0 and zero interest', () => {
    expect(balanceAfter(1000, 0.01, 100, 0)).toBe(1000);
    expect(balanceAfter(1200, 0, 100, 3)).toBe(900);
  });

  it('remainingPeriods returns null when payment cannot amortize', () => {
    const i = periodicRate(0.05, 12, 'semi_annual');
    expect(remainingPeriods(500_000, i, 100)).toBeNull(); // payment < interest
    expect(remainingPeriods(1200, 0, 0)).toBeNull(); // zero interest, zero payment
    expect(remainingPeriods(1200, 0, 100)).toBe(12); // zero interest amortizes linearly
  });

  it('interestShareOfPayment and crossover degrade at zero interest', () => {
    expect(interestShareOfPayment(0, 100, 1)).toBe(0);
    expect(crossoverPayment(0, 100)).toBe(1);
  });
});

describe('interestOverPeriods — forecast tail / scenario split (mirror)', () => {
  const i = periodicRate(0.05, 12, 'semi_annual');
  const pmt = roundCents(levelPayment(500_000, i, 300)); // 2908.02

  it('splits N payments into interest vs principal exactly against balanceAfter', () => {
    const r = interestOverPeriods(500_000, i, pmt, 12);
    expect(r.endBalance).toBeCloseTo(balanceAfter(500_000, i, pmt, 12), 6);
    expect(r.interest + r.principal).toBeCloseTo(pmt * 12, 6);
    expect(r.interest).toBeGreaterThan(r.principal);
  });

  it('the first payment matches GV-1 (interest 2061.96 / principal 846.06)', () => {
    const r = interestOverPeriods(500_000, i, pmt, 1);
    expect(r.interest).toBeCloseTo(2061.96, 2);
    expect(r.principal).toBeCloseTo(846.06, 2);
  });

  it('a zero-length span is a no-op; the balance never goes negative', () => {
    expect(interestOverPeriods(500_000, i, pmt, 0)).toEqual({ interest: 0, principal: 0, endBalance: 500_000 });
    expect(interestOverPeriods(1_000, i, 100_000, 1).endBalance).toBe(0);
  });
});
