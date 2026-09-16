/**
 * On-device mortgage summary/schedule projector for Budget V2 local-first.
 *
 * Uses the client amortisation mirror (`src/features/mortgage/amortization.ts`).
 * Phase 1: statement anchors snap balance; theory schedule when none exist.
 */

import type {
  Mortgage,
  MortgageEvent,
  MortgageListItem,
  MortgagePaymentFrequency,
  MortgageScheduleView,
  MortgageStatement,
  MortgageSummary,
  MortgageTerm,
} from '@api/mortgage';
import {
  buildSchedule,
  crossoverPayment,
  effectiveAnnualRate,
  equityBreakdown,
  interestOverPeriods,
  levelPayment,
  paymentsPerYear,
  periodicRate,
  remainingPeriods,
  roundCents,
  solveNominalRate,
  totalInterest,
  type Compounding,
  type PaymentFrequency,
  type RateType,
} from '@features/mortgage/amortization';

import {
  lumpEventsFromMortgageEvents,
  paymentsBetween,
  pickAnchor,
  reconcileCurrentBalance,
  statementsToAnchors,
  statementsToFacts,
  sumStatementActuals,
  type LumpEvent,
} from './localMortgageReconciliation';

/** Local term row — includes starting balance used after renewals. */
export type LocalMortgageTerm = MortgageTerm & {
  starting_balance_cents?: number | null;
};

export type MortgageProjectionContext = {
  statements?: MortgageStatement[];
  events?: MortgageEvent[];
  lumpEvents?: LumpEvent[];
};

const MS_PER_DAY = 86_400_000;

function toDollars(cents: number): number {
  return cents / 100;
}

function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor(
    (new Date(toIso.slice(0, 10)).getTime() - new Date(fromIso.slice(0, 10)).getTime()) /
      MS_PER_DAY,
  );
}

function maskAddress(address: string | null): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (trimmed.length <= 4) return '••••';
  const firstSpace = trimmed.indexOf(' ');
  const head = firstSpace > 0 ? trimmed.slice(0, firstSpace) : trimmed.slice(0, 3);
  return `${head} ••••••`;
}

type TermMath = {
  nominal: number;
  compounding: Compounding;
  frequency: PaymentFrequency;
  n: number;
  i: number;
  amortizationMonths: number;
  nPayments: number;
  payment: number;
  scheduleAvailable: boolean;
};

function termMath(principalDollars: number, term: LocalMortgageTerm): TermMath {
  const compounding = term.compounding as Compounding;
  const frequency = term.payment_frequency as PaymentFrequency;
  const n = paymentsPerYear(frequency);
  const amortizationMonths = term.amortization_months_at_start;
  const nPayments = Math.round((amortizationMonths / 12) * n);
  const statedPayment =
    term.scheduled_payment_cents != null ? toDollars(term.scheduled_payment_cents) : null;

  let nominal = (term.nominal_rate_bps ?? 0) / 10_000;
  let scheduleAvailable = true;

  if (nominal <= 0) {
    if (statedPayment && statedPayment > 0) {
      nominal = solveNominalRate(principalDollars, statedPayment, n, nPayments, compounding);
    } else {
      scheduleAvailable = false;
    }
  }

  const i = periodicRate(nominal, n, compounding);
  const payment = statedPayment ?? roundCents(levelPayment(principalDollars, i, nPayments));

  return {
    nominal,
    compounding,
    frequency,
    n,
    i,
    amortizationMonths,
    nPayments,
    payment,
    scheduleAvailable,
  };
}

function clampPayments(daysElapsed: number, math: TermMath): number {
  if (daysElapsed <= 0) return 0;
  const elapsed = Math.floor((daysElapsed / 365) * math.n);
  return Math.min(math.nPayments, Math.max(0, elapsed));
}

function termPrincipalCents(mortgage: Mortgage, term: LocalMortgageTerm): number {
  return term.starting_balance_cents ?? mortgage.original_principal_cents;
}

function resolveProjectionContext(ctx: MortgageProjectionContext = {}) {
  const statements = ctx.statements ?? [];
  const lumpEvents =
    ctx.lumpEvents ?? (ctx.events ? lumpEventsFromMortgageEvents(ctx.events) : []);
  return {
    anchors: statementsToAnchors(statements),
    facts: statementsToFacts(statements),
    lumpEvents,
  };
}

function reconcileBalance(
  principal: number,
  term: LocalMortgageTerm,
  math: TermMath,
  asOfIso: string,
  ctx: MortgageProjectionContext,
) {
  const { anchors, lumpEvents } = resolveProjectionContext(ctx);
  if (!math.scheduleAvailable) {
    return {
      currentBalance: principal,
      status: 'estimated' as const,
      balanceAsOf: term.term_start_date.slice(0, 10),
      hasAnchor: false,
      paymentsSinceAnchor: 0,
    };
  }
  return reconcileCurrentBalance({
    originalPrincipal: principal,
    i: math.i,
    payment: math.payment,
    termStartDate: term.term_start_date,
    statements: anchors,
    lumpEvents,
    paymentsPerYearN: math.n,
    asOf: asOfIso,
  });
}

export function currentTermFor(
  terms: LocalMortgageTerm[],
  mortgageId: string,
): LocalMortgageTerm | null {
  const forMortgage = terms
    .filter((t) => t.mortgage_id === mortgageId)
    .sort((a, b) => b.sequence - a.sequence);
  return forMortgage.find((t) => t.is_current) ?? forMortgage[0] ?? null;
}

export function projectListItem(
  mortgage: Mortgage,
  term: LocalMortgageTerm | null,
  asOfIso: string,
  ctx: MortgageProjectionContext = {},
): MortgageListItem {
  const mortgagePrincipal = toDollars(mortgage.original_principal_cents);
  let balance = mortgagePrincipal;
  let nextRenewal: string | null = null;

  if (term) {
    const principal = toDollars(termPrincipalCents(mortgage, term));
    const math = termMath(principal, term);
    nextRenewal = term.maturity_date;
    balance = reconcileBalance(principal, term, math, asOfIso, ctx).currentBalance;
  }

  const pctPaid =
    mortgagePrincipal > 0 ? (mortgagePrincipal - balance) / mortgagePrincipal : 0;

  return {
    id: mortgage.id,
    nickname: mortgage.nickname,
    lender: mortgage.lender,
    productType: mortgage.product_type,
    currentBalanceCents: toCents(balance),
    pctPaid: clamp01(pctPaid),
    nextRenewalDate: nextRenewal,
    isActive: mortgage.is_active,
  };
}

export function projectSummary(
  mortgage: Mortgage,
  term: LocalMortgageTerm,
  asOfIso: string,
  ctx: MortgageProjectionContext = {},
): MortgageSummary {
  const mortgagePrincipal = toDollars(mortgage.original_principal_cents);
  const principal = toDollars(termPrincipalCents(mortgage, term));
  const math = termMath(principal, term);
  const { anchors, facts } = resolveProjectionContext(ctx);
  const elapsed = math.scheduleAvailable
    ? clampPayments(daysBetween(term.term_start_date, asOfIso), math)
    : 0;

  const recon = reconcileBalance(principal, term, math, asOfIso, ctx);
  const balance = recon.currentBalance;

  const principalPaid = mortgagePrincipal - balance;
  const termPrincipalPaid = principal - balance;
  const actual = sumStatementActuals(facts, asOfIso);
  let interestPaid: number;
  let interestSource: 'actual' | 'estimated';
  if (actual.statementsWithInterest > 0) {
    const anchorBalance = pickAnchor(anchors, asOfIso)?.closingBalance ?? principal;
    const tail = interestOverPeriods(
      anchorBalance,
      math.i,
      math.payment,
      recon.paymentsSinceAnchor,
    ).interest;
    interestPaid = actual.interest + tail;
    interestSource = 'actual';
  } else {
    interestPaid = math.scheduleAvailable
      ? Math.max(0, math.payment * elapsed - termPrincipalPaid)
      : 0;
    interestSource = 'estimated';
  }
  const totalInterestToDate = Math.max(0, interestPaid);
  const totalPrincipalToDate = Math.max(0, principalPaid);
  const totalPaidToDate = totalPrincipalToDate + totalInterestToDate;

  const nextInterest = balance * math.i;
  const nextPrincipal = math.payment - nextInterest;
  const interestShare = math.payment > 0 ? nextInterest / math.payment : 0;
  const crossoverIndex = math.scheduleAvailable ? crossoverPayment(math.i, math.nPayments) : 0;

  const eq = equityBreakdown({
    price: mortgage.original_price_cents != null ? toDollars(mortgage.original_price_cents) : null,
    downPayment:
      mortgage.down_payment_cents != null ? toDollars(mortgage.down_payment_cents) : null,
    originalPrincipal: mortgagePrincipal,
    currentValue:
      mortgage.current_home_value_cents != null
        ? toDollars(mortgage.current_home_value_cents)
        : null,
    balance,
  });

  const remPeriods = math.scheduleAvailable
    ? remainingPeriods(balance, math.i, math.payment) ?? Math.max(0, math.nPayments - elapsed)
    : Math.max(0, math.nPayments - elapsed);
  const remainingAmortizationMonths = Math.max(0, Math.round((remPeriods / math.n) * 12));

  const paymentsToMaturity = math.scheduleAvailable
    ? Math.min(remPeriods, paymentsBetween(asOfIso, term.maturity_date, math.n))
    : 0;
  const proj = interestOverPeriods(balance, math.i, math.payment, paymentsToMaturity);
  const balanceAtMaturity = proj.endBalance;
  const interestRemaining = proj.interest;
  const projTotalInterest = totalInterestToDate + interestRemaining;
  const projEquity = eq.totalEquity + (balance - balanceAtMaturity);
  const projPrincipalPaid = mortgagePrincipal - balanceAtMaturity;
  const stalePayments = Math.max(1, Math.round(math.n / 2));
  const projectionStale = recon.hasAnchor && recon.paymentsSinceAnchor > stalePayments;

  return {
    mortgageId: mortgage.id,
    nickname: mortgage.nickname,
    lender: mortgage.lender,
    productType: mortgage.product_type,
    propertyAddressMasked: maskAddress(mortgage.property_address),
    scheduleAvailable: math.scheduleAvailable,
    originalPrincipalCents: mortgage.original_principal_cents,
    currentBalanceCents: toCents(balance),
    balanceStatus: recon.status,
    balanceAsOf: recon.balanceAsOf,
    paymentsElapsed: elapsed,
    paymentsTotal: math.nPayments,
    pctPaid: clamp01(mortgagePrincipal > 0 ? principalPaid / mortgagePrincipal : 0),
    scheduledPaymentCents: toCents(math.payment),
    paymentFrequency: math.frequency as MortgagePaymentFrequency,
    rate: {
      nominalPct: roundCents(math.nominal * 100),
      effectiveAnnualPct: roundCents(
        effectiveAnnualRate(math.nominal, math.n, math.compounding) * 100,
      ),
      rateType: term.rate_type as RateType,
      compounding: math.compounding,
      primeRateBps: term.prime_rate_bps,
      spreadBps: term.spread_bps,
    },
    totalPaidToDateCents: toCents(totalPaidToDate),
    totalInterestToDateCents: toCents(totalInterestToDate),
    totalPrincipalToDateCents: toCents(totalPrincipalToDate),
    totalInterestOverLifeCents: toCents(
      math.scheduleAvailable
        ? Math.max(0, totalInterest(math.payment, math.nPayments, principal))
        : 0,
    ),
    paidToDate: {
      interestSource,
      throughDate: actual.throughDate,
      statementsWithInterest: actual.statementsWithInterest,
    },
    remainingAmortizationMonths,
    currentPaymentSplit: {
      interestCents: toCents(Math.max(0, nextInterest)),
      principalCents: toCents(Math.max(0, nextPrincipal)),
      interestSharePct: roundCents(clamp01(interestShare) * 100),
    },
    crossover: {
      paymentIndex: crossoverIndex,
      reached: elapsed >= crossoverIndex && crossoverIndex > 0,
    },
    equity: {
      downPaymentCents: toCents(eq.downPayment),
      paydownEquityCents: toCents(eq.paydownEquity),
      appreciationEquityCents: toCents(eq.appreciationEquity),
      totalEquityCents: toCents(eq.totalEquity),
      hasAppreciation: eq.hasAppreciation,
    },
    projected: {
      forwardRate: {
        nominalPct: roundCents(math.nominal * 100),
        basedOn: 'term',
        asOfDate: term.term_start_date,
      },
      projectionStale,
      toEndOfTerm: {
        date: term.maturity_date,
        balanceCents: toCents(balanceAtMaturity),
        equityCents: toCents(Math.max(0, projEquity)),
        principalPaidCents: toCents(Math.max(0, projPrincipalPaid)),
        totalInterestCents: toCents(Math.max(0, projTotalInterest)),
        interestRemainingCents: toCents(Math.max(0, interestRemaining)),
      },
    },
    currentTerm: {
      sequence: term.sequence,
      termStartDate: term.term_start_date,
      maturityDate: term.maturity_date,
      termMonths: term.term_months,
    },
    nextRenewalDate: term.maturity_date,
    daysToRenewal: daysBetween(asOfIso, term.maturity_date),
  };
}

export function projectSchedule(
  mortgage: Mortgage,
  term: LocalMortgageTerm,
  asOfIso: string,
): MortgageScheduleView {
  const principal = toDollars(termPrincipalCents(mortgage, term));
  const math = termMath(principal, term);

  if (!math.scheduleAvailable) {
    return { scheduleAvailable: false, paymentsElapsed: 0, rows: [] };
  }

  const elapsed = clampPayments(daysBetween(term.term_start_date, asOfIso), math);
  const rows = buildSchedule({
    principal,
    nominalAnnual: math.nominal,
    frequency: math.frequency,
    compounding: math.compounding,
    amortizationMonths: math.amortizationMonths,
    paymentOverride: term.scheduled_payment_cents != null ? math.payment : undefined,
  }).map((r) => ({
    index: r.index,
    interest: toCents(r.interest),
    principal: toCents(r.principal),
    balance: toCents(r.balance),
    estimated: true,
  }));

  return { scheduleAvailable: true, paymentsElapsed: elapsed, rows };
}
