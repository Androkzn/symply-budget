/**
 * Mortgage amortization engine — pure, I/O-free, the single source of truth for
 * every mortgage number the app shows. Correct for the Canadian convention
 * (fixed rates compound SEMI-ANNUALLY, not in advance) and validated to the cent
 * against a real TD statement (see the golden vectors in the test).
 *
 * Nothing here touches the DB or the network, so it is trivially unit-testable
 * and is mirrored 1:1 on the client (`src/features/mortgage/amortization.ts`)
 * for the setup-wizard live preview. Keep the two in lockstep — the same golden
 * vectors assert both.
 *
 * Design notes (see documents/requirements/as-built/mortgage/Mortgage_Implementation_Plan.md §4):
 *  - §4.2 semi-annual→periodic rate conversion (never `j/12` for fixed).
 *  - §4.6 renewal re-amortizes over the ACTUAL remaining amortization, not N−k.
 *  - §4.4 equity paydown uses (price − down), so a financed CMHC premium is not
 *    miscounted as equity.
 *  - §4.10 variable products accrue interest as DAILY SIMPLE interest (Actual/365).
 */

export type Compounding = 'semi_annual' | 'monthly';
export type RateType = 'fixed' | 'variable_arm' | 'variable_vrm';
export type PaymentFrequency =
  | 'monthly'
  | 'semi_monthly'
  | 'biweekly'
  | 'weekly'
  | 'accel_biweekly'
  | 'accel_weekly';

/** Payments per year for each frequency. Accelerated variants keep the same
 * count as their base but derive the payment from the monthly amount ÷ 2. */
export const PAYMENTS_PER_YEAR: Record<PaymentFrequency, number> = {
  monthly: 12,
  semi_monthly: 24,
  biweekly: 26,
  weekly: 52,
  accel_biweekly: 26,
  accel_weekly: 52,
};

export function paymentsPerYear(freq: PaymentFrequency): number {
  return PAYMENTS_PER_YEAR[freq];
}

export function isAccelerated(freq: PaymentFrequency): boolean {
  return freq === 'accel_biweekly' || freq === 'accel_weekly';
}

/** Round to whole cents (money display). */
export function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Effective periodic rate `i` for `n` payments/year.
 * - `semi_annual` (Canadian fixed): `i = (1 + j/2)^(2/n) − 1`
 * - `monthly` (variable / US): `i = j/n`
 * `j` is the nominal annual rate as a decimal (0.05 = 5%).
 */
export function periodicRate(nominalAnnual: number, n: number, compounding: Compounding): number {
  if (compounding === 'semi_annual') {
    return Math.pow(1 + nominalAnnual / 2, 2 / n) - 1;
  }
  return nominalAnnual / n;
}

/** Effective annual rate for display: `(1 + i)^n − 1`. */
export function effectiveAnnualRate(
  nominalAnnual: number,
  n: number,
  compounding: Compounding
): number {
  return Math.pow(1 + periodicRate(nominalAnnual, n, compounding), n) - 1;
}

/**
 * Level (blended P&I) payment: `PMT = P·i / (1 − (1+i)^(−N))`.
 * At `i = 0` (interest-free) it degrades to straight-line `P/N`.
 */
export function levelPayment(principal: number, i: number, nPayments: number): number {
  if (nPayments <= 0) return 0;
  if (i === 0) return principal / nPayments;
  return (principal * i) / (1 - Math.pow(1 + i, -nPayments));
}

/**
 * Exact remaining balance after `k` payments of `pmt` on `principal` at periodic
 * rate `i`: `B_k = P·(1+i)^k − pmt·((1+i)^k − 1)/i`. No `N` needed, so it works
 * for any point on a re-amortized or prepaid schedule.
 */
export function balanceAfter(principal: number, i: number, pmt: number, k: number): number {
  if (k <= 0) return principal;
  if (i === 0) return principal - pmt * k;
  const growth = Math.pow(1 + i, k);
  return principal * growth - (pmt * (growth - 1)) / i;
}

/**
 * Number of payments (fractional) to pay `principal` down to zero at `pmt`/`i`.
 * Returns `null` when the payment doesn't even cover the first period's interest
 * (never amortizes — a VRM past its trigger rate).
 */
export function remainingPeriods(principal: number, i: number, pmt: number): number | null {
  if (i === 0) return pmt > 0 ? principal / pmt : null;
  const x = (principal * i) / pmt;
  if (x >= 1) return null;
  return -Math.log(1 - x) / Math.log(1 + i);
}

/** Total interest over the life of a level-payment schedule: `N·PMT − P`. */
export function totalInterest(pmt: number, nPayments: number, principal: number): number {
  return pmt * nPayments - principal;
}

export interface PeriodTotals {
  /** Interest paid over the span (never negative). */
  interest: number;
  /** Principal repaid over the span (start − end balance). */
  principal: number;
  /** Balance after the span (never negative). */
  endBalance: number;
}

/**
 * Split `count` level payments of `pmt` (at periodic rate `i`) into their total
 * interest vs principal, using the closed-form `balanceAfter`. Interest is the
 * cash paid minus principal repaid, so it stays exact against the schedule and
 * needs no per-row loop. Used by the forecast (tail since the last statement,
 * interest remaining this term) and the rate-scenario math — see §4.5/§4.10:
 * between anchors the periodic rate is an acceptable approximation, actuals win.
 */
export function interestOverPeriods(
  startBalance: number,
  i: number,
  pmt: number,
  count: number
): PeriodTotals {
  const n = Math.max(0, count);
  const endBalance = Math.max(0, balanceAfter(startBalance, i, pmt, n));
  const principal = Math.max(0, startBalance - endBalance);
  const interest = Math.max(0, pmt * n - principal);
  return { interest, principal, endBalance };
}

/**
 * Interest share of payment `k` (1-based): `1 − (1+i)^(−(N−k+1))`. Falls from
 * near-1 early to 0 at the final payment.
 */
export function interestShareOfPayment(i: number, nPayments: number, k: number): number {
  if (i === 0) return 0;
  return 1 - Math.pow(1 + i, -(nPayments - k + 1));
}

/**
 * First payment index where principal exceeds interest (the "crossover"):
 * the smallest `k` with `(1+i)^(−(N−k+1)) < 0.5`.
 */
export function crossoverPayment(i: number, nPayments: number): number {
  if (i === 0) return 1;
  // (1+i)^-(N-k+1) < 0.5  ⇒  N-k+1 > ln2/ln(1+i)  ⇒  k < N + 1 − ln2/ln(1+i)
  const k = nPayments + 1 - Math.log(2) / Math.log(1 + i);
  return Math.max(1, Math.min(nPayments, Math.ceil(k)));
}

/**
 * Re-amortize an outstanding `balance` at a new nominal rate over a given
 * remaining amortization (in PERIODS at the new frequency). This is the renewal
 * payment (§4.6) — pass the ACTUAL remaining amortization, never `N − k`.
 */
export function reAmortizePayment(
  balance: number,
  newNominalAnnual: number,
  remainingPeriodsAtNewFreq: number,
  n: number,
  compounding: Compounding
): number {
  const i = periodicRate(newNominalAnnual, n, compounding);
  return levelPayment(balance, i, remainingPeriodsAtNewFreq);
}

/**
 * Daily simple interest (Actual/365) — how variable / HELOC-style products
 * actually charge interest between payments (§4.10, validated on a real TD
 * statement): `balance × annualRate × days / 365`.
 */
export function dailySimpleInterest(balance: number, annualRate: number, days: number): number {
  return (balance * annualRate * days) / 365;
}

/**
 * Solve the nominal annual rate implied by a known payment (the "rate unknown,
 * payment known" setup path, §4.8) via bisection. Returns 0 when the payment
 * only covers principal (no interest).
 */
export function solveNominalRate(
  principal: number,
  targetPayment: number,
  n: number,
  nPayments: number,
  compounding: Compounding
): number {
  if (targetPayment <= principal / nPayments) return 0;
  let lo = 0;
  let hi = 1; // 100% nominal — far above any real mortgage
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const pmt = levelPayment(principal, periodicRate(mid, n, compounding), nPayments);
    if (pmt > targetPayment) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export interface ScheduleRow {
  /** 1-based payment number. */
  index: number;
  /** Interest portion (rounded cents). */
  interest: number;
  /** Principal portion (rounded cents). */
  principal: number;
  /** Balance remaining after this payment (rounded cents; exactly 0 at the end). */
  balance: number;
}

export interface BuildScheduleParams {
  principal: number;
  nominalAnnual: number;
  frequency: PaymentFrequency;
  compounding: Compounding;
  amortizationMonths: number;
  /** Override the computed level payment (e.g. the statement's stated payment). */
  paymentOverride?: number;
}

/**
 * Full blended-payment schedule with a final-payment true-up so the balance
 * lands on exactly 0.00. Amounts are rounded to cents for display; the running
 * balance is carried unrounded to avoid cent drift, then trued up on the last row.
 */
export function buildSchedule(params: BuildScheduleParams): ScheduleRow[] {
  const { principal, nominalAnnual, frequency, compounding, amortizationMonths } = params;
  const n = paymentsPerYear(frequency);
  const i = periodicRate(nominalAnnual, n, compounding);
  const nPayments = Math.round((amortizationMonths / 12) * n);
  const basePayment = params.paymentOverride ?? levelPayment(principal, i, nPayments);
  const pmt = roundCents(basePayment);

  const rows: ScheduleRow[] = [];
  let balance = principal;
  for (let k = 1; k <= nPayments; k++) {
    const interestRaw = balance * i;
    let principalPart = pmt - interestRaw;
    // Final payment (or any payment that would overshoot) trues up to zero.
    if (k === nPayments || principalPart >= balance) {
      principalPart = balance;
      const interest = roundCents(interestRaw);
      rows.push({ index: k, interest, principal: roundCents(principalPart), balance: 0 });
      balance = 0;
      break;
    }
    balance -= principalPart;
    rows.push({
      index: k,
      interest: roundCents(interestRaw),
      principal: roundCents(principalPart),
      balance: roundCents(balance),
    });
  }
  return rows;
}

export interface EquityInput {
  /** Purchase/sale price, if known. */
  price?: number | null;
  /** Down payment, if known. */
  downPayment?: number | null;
  /** Loan principal (may include a financed CMHC premium). */
  originalPrincipal: number;
  /** Current home value, for the appreciation slice (optional). */
  currentValue?: number | null;
  /** Current outstanding balance. */
  balance: number;
}

export interface EquityBreakdown {
  downPayment: number;
  /** Equity from paying the loan down, measured against (price − down) so a
   * financed CMHC premium is NOT counted as paydown equity (§4.4). May be
   * negative early when a premium was financed. */
  paydownEquity: number;
  /** Equity from home-price appreciation (0 when value or price unknown). */
  appreciationEquity: number;
  /** Total equity. Exactly `currentValue − balance` when value is known. */
  totalEquity: number;
  /** Whether the appreciation slice is meaningful (value + price both known). */
  hasAppreciation: boolean;
}

/**
 * Split equity into down payment + loan paydown + market appreciation.
 * - Full mode (price & down known): paydown is measured from `price − down`, so
 *   the identity `total = currentValue − balance` holds even with a financed
 *   premium (the critique's key correctness fix).
 * - Degraded mode (price/down unknown): paydown-only from `originalPrincipal`,
 *   appreciation hidden.
 */
export function equityBreakdown(input: EquityInput): EquityBreakdown {
  const { price, downPayment, originalPrincipal, currentValue, balance } = input;
  const hasPurchase = price != null && downPayment != null;
  const down = hasPurchase ? downPayment! : 0;
  const paydownBase = hasPurchase ? price! - downPayment! : originalPrincipal;
  const paydownEquity = paydownBase - balance;
  const hasAppreciation = hasPurchase && currentValue != null;
  const appreciationEquity = hasAppreciation ? currentValue! - price! : 0;
  const totalEquity =
    currentValue != null ? currentValue - balance : down + paydownEquity + appreciationEquity;
  return { downPayment: down, paydownEquity, appreciationEquity, totalEquity, hasAppreciation };
}
