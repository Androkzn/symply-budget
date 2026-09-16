import type { MortgageSummary } from '@api/mortgage';
import {
  type Compounding,
  type PaymentFrequency,
  interestOverPeriods,
  paymentsPerYear,
  periodicRate,
  reAmortizePayment,
  remainingPeriods,
  roundCents,
} from '@features/mortgage/amortization';

/**
 * Pure rate-scenario math for the Mortgage "Scenarios" tab. A variable-rate
 * borrower can't know their lifetime cost at signing, so this lets them drag a
 * hypothetical rate and see, live, what it does to the payment, the interest,
 * the payoff, and their equity at the end of the current term.
 *
 * Runs entirely on the client (mirroring the setup-wizard-preview pattern): it
 * composes the byte-for-byte engine mirror (`@features/mortgage/amortization`),
 * so it never disagrees with the server. It only ever computes HYPOTHETICALS —
 * the saved mortgage's real numbers still come from the server summary, which
 * seeds this. Kept out of the component so the transforms are unit-testable.
 */

export interface ScenarioSeed {
  /** Current reconciled outstanding balance (dollars). */
  currentBalance: number;
  /** Current total equity (dollars) — scenario equity moves by principal repaid. */
  currentEquity: number;
  /** Current (latest known) payment per period (dollars). */
  currentPayment: number;
  /** Current (latest known) nominal annual rate as a decimal (0.052 = 5.2%). */
  currentNominal: number;
  frequency: PaymentFrequency;
  compounding: Compounding;
  /** Remaining amortization in months at the current balance + rate. */
  remainingAmortizationMonths: number;
  /** Whole payments left between now and the current term's maturity. */
  paymentsToMaturity: number;
}

export interface RateScenario {
  /** Hypothetical nominal annual rate (decimal). */
  nominal: number;
  /** Payment re-amortized over the remaining amortization at this rate (dollars). */
  paymentDollars: number;
  /** Payment change vs the current payment (dollars; +ve = costs more). */
  paymentDeltaDollars: number;
  /** Interest paid between now and maturity at this rate (dollars). */
  interestToMaturityDollars: number;
  /** Projected balance at maturity (dollars). */
  balanceAtMaturityDollars: number;
  /** Projected equity at maturity (dollars) = current equity + principal repaid. */
  equityAtMaturityDollars: number;
  /** Total interest from now to full payoff at the re-amortized payment (dollars). */
  totalInterestToPayoffDollars: number;
  /**
   * If instead you KEEP your current payment, months to payoff — or `null` when
   * the payment no longer covers the interest (a VRM trigger-rate situation:
   * the balance would grow). The headline risk of a flexible rate.
   */
  keepPaymentPayoffMonths: number | null;
}

/** Map a server summary into the scenario seed (all figures already reconciled). */
export function buildScenarioSeed(summary: MortgageSummary): ScenarioSeed {
  const n = paymentsPerYear(summary.paymentFrequency);
  const paymentsToMaturity = Math.max(0, Math.round(Math.max(0, summary.daysToRenewal) / (365 / n)));
  return {
    currentBalance: summary.currentBalanceCents / 100,
    currentEquity: summary.equity.totalEquityCents / 100,
    currentPayment: summary.scheduledPaymentCents / 100,
    currentNominal: summary.rate.nominalPct / 100,
    frequency: summary.paymentFrequency,
    compounding: summary.rate.compounding,
    remainingAmortizationMonths: summary.remainingAmortizationMonths,
    paymentsToMaturity,
  };
}

/** Compute the outcome of the mortgage running at a hypothetical `nominal` rate. */
export function computeRateScenario(seed: ScenarioSeed, nominal: number): RateScenario {
  const n = paymentsPerYear(seed.frequency);
  const i = periodicRate(nominal, n, seed.compounding);
  const amortPeriods = Math.max(1, Math.round((seed.remainingAmortizationMonths / 12) * n));

  // Re-amortize over the remaining amortization → the payment moves with the rate.
  const payment = roundCents(reAmortizePayment(seed.currentBalance, nominal, amortPeriods, n, seed.compounding));

  const toMaturity = interestOverPeriods(seed.currentBalance, i, payment, seed.paymentsToMaturity);
  const toPayoff = interestOverPeriods(seed.currentBalance, i, payment, amortPeriods);
  const equityAtMaturity = seed.currentEquity + (seed.currentBalance - toMaturity.endBalance);

  // Keep-payment path: how the current payment fares at the new rate.
  const keepPeriods = remainingPeriods(seed.currentBalance, i, seed.currentPayment);
  const keepPaymentPayoffMonths = keepPeriods != null ? Math.round((keepPeriods / n) * 12) : null;

  return {
    nominal,
    paymentDollars: payment,
    paymentDeltaDollars: roundCents(payment - seed.currentPayment),
    interestToMaturityDollars: roundCents(toMaturity.interest),
    balanceAtMaturityDollars: roundCents(toMaturity.endBalance),
    equityAtMaturityDollars: roundCents(equityAtMaturity),
    totalInterestToPayoffDollars: roundCents(toPayoff.interest),
    keepPaymentPayoffMonths,
  };
}

/**
 * A symmetric ladder of rate points around the current rate for the scenario
 * slider / quick chips. Clamped to [0.5%, 25%] so the axis stays sane. Steps of
 * `stepBps` basis points, `spanBps` either side.
 */
export function buildRateLadder(currentNominal: number, spanBps = 300, stepBps = 25): number[] {
  const centerBps = Math.round(currentNominal * 10_000);
  const lo = Math.max(50, centerBps - spanBps);
  const hi = Math.min(2_500, centerBps + spanBps);
  const out: number[] = [];
  for (let bps = lo; bps <= hi; bps += stepBps) out.push(bps / 10_000);
  return out;
}
