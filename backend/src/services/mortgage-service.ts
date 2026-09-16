import { and, eq, desc } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { householdMembers } from '../db/schema';
import {
  mortgages,
  mortgageTerms,
  mortgageStatements,
  mortgageEvents,
  mortgageRatePeriods,
  mortgageRenewalOffers,
  type Mortgage,
  type MortgageTerm,
  type MortgageStatement,
  type MortgageEvent,
  type MortgageRatePeriod,
  type MortgageRenewalOffer,
} from '../db/schema-mortgage';
import type { Env } from '../types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { generateId, now } from '../utils/id';

import {
  type Compounding,
  type PaymentFrequency,
  type RateType,
  paymentsPerYear,
  periodicRate,
  effectiveAnnualRate,
  levelPayment,
  remainingPeriods,
  totalInterest,
  interestOverPeriods,
  crossoverPayment,
  buildSchedule,
  equityBreakdown,
  solveNominalRate,
  reAmortizePayment,
  roundCents,
  type ScheduleRow,
} from './mortgage/amortization';
import {
  reconcileCurrentBalance,
  paymentsBetween,
  pickAnchor,
  type StatementAnchor,
  type LumpEvent,
} from './mortgage/reconciliation';

const LIST_MORTGAGES_LIMIT = 50;
const LIST_TERMS_LIMIT = 60;
const LIST_STATEMENTS_LIMIT = 240;
const LOAD_LUMP_EVENTS_LIMIT = 200;
const LIST_EVENTS_LIMIT = 200;
const LIST_OFFERS_LIMIT = 50;

// ============ INPUT TYPES ============

export interface CreateMortgageInput {
  nickname: string;
  lender?: string | null;
  productType?: 'standard' | 'heloc_flexline' | 'step';
  propertyAddress?: string | null;
  mortgageNumberLast4?: string | null;
  originalPriceCents?: number | null;
  downPaymentCents?: number | null;
  originalPrincipalCents?: number | null;
  originalAmortizationMonths?: number;
  startDate: string;
  currentHomeValueCents?: number | null;
  insurancePremiumCents?: number | null;
  // First term.
  rateType: RateType;
  compounding: Compounding;
  nominalRateBps?: number | null;
  primeRateBps?: number | null;
  spreadBps?: number | null;
  termMonths: number;
  paymentFrequency: PaymentFrequency;
  scheduledPaymentCents?: number | null;
}

export interface UpdateMortgageInput {
  nickname?: string;
  lender?: string | null;
  propertyAddress?: string | null;
  currentHomeValueCents?: number | null;
  isActive?: boolean;
}

export interface AddStatementInput {
  statementDate: string;
  closingBalanceCents: number;
  openingBalanceCents?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  interestPaidCents?: number | null;
  interestChargedCents?: number | null;
  principalPaidCents?: number | null;
  paymentAmountCents?: number | null;
  interestRateBps?: number | null;
  primeRateBps?: number | null;
  varianceBps?: number | null;
  remainingAmortizationMonths?: number | null;
  propertyTaxPaidCents?: number | null;
  source?: string;
  extractionConfidence?: number | null;
  rawExtractionJson?: string | null;
  /**
   * The statement's dated rate sub-periods (bps). Persisted as
   * `mortgage_rate_periods` rows — the queryable rate axis behind the change
   * history and the rate-impact charts. Omit (undefined) to leave any existing
   * rows for this statement untouched; pass [] to clear them.
   */
  ratePeriods?: AddRatePeriodInput[] | null;
}

/** One dated rate sub-period read off a statement. `rateBps` 359 = 3.59%. */
export interface AddRatePeriodInput {
  effectiveDate: string;
  rateBps: number;
  periodEnd?: string | null;
  primeRateBps?: number | null;
  varianceBps?: number | null;
}

export interface AddEventInput {
  eventType: 'lump_sum_prepayment' | 'payment_increase' | 'rate_change' | 'renewal' | 'amortization_change';
  eventDate: string;
  amountCents?: number | null;
  newRateBps?: number | null;
  newPaymentCents?: number | null;
  policy?: 'keep_payment_shorten' | 'keep_amort_lower_payment' | null;
  note?: string | null;
}

export interface RenewMortgageInput {
  termStartDate: string;
  termMonths: number;
  rateType: RateType;
  compounding: Compounding;
  nominalRateBps?: number | null;
  primeRateBps?: number | null;
  spreadBps?: number | null;
  paymentFrequency: PaymentFrequency;
  scheduledPaymentCents?: number | null;
  /** Remaining amortization at renewal in months (defaults to prior term's remaining). */
  amortizationMonthsAtStart?: number;
}

export interface AddOfferInput {
  bankName: string;
  offeredRateBps: number;
  rateType: RateType;
  termMonths: number;
  monthlyPaymentCents?: number | null;
  offerExpiresAt?: string | null;
  source?: 'manual' | 'ai';
  note?: string | null;
}

export interface UpdateOfferInput {
  status?: 'draft' | 'shortlisted' | 'accepted' | 'declined';
  note?: string | null;
  monthlyPaymentCents?: number | null;
}

export interface MortgageOfferView {
  id: string;
  bankName: string;
  offeredRatePct: number;
  rateType: RateType;
  termMonths: number;
  monthlyPaymentCents: number;
  /** Positive ⇒ cheaper per payment than the current mortgage. */
  paymentSavedVsCurrentCents: number;
  status: string;
  offerExpiresAt: string | null;
  note: string | null;
}

export interface OffersView {
  incumbentPaymentCents: number;
  offers: MortgageOfferView[];
}

export interface WhatIfView {
  acceleratedBiweeklyPaymentCents: number;
  acceleratedYearsToPayoff: number | null;
  /** Interest saved over the current-term schedule by a one-off lump sum. */
  lumpSumInterestSavedCents: number | null;
}

// ============ VIEW MODELS ============

export interface MortgageListItem {
  id: string;
  nickname: string;
  lender: string | null;
  productType: string;
  currentBalanceCents: number;
  pctPaid: number;
  nextRenewalDate: string | null;
  isActive: boolean;
}

export interface MortgageRateView {
  nominalPct: number;
  effectiveAnnualPct: number;
  rateType: RateType;
  compounding: Compounding;
  primeRateBps: number | null;
  spreadBps: number | null;
}

export interface MortgageSummary {
  mortgageId: string;
  nickname: string;
  lender: string | null;
  productType: string;
  propertyAddressMasked: string | null;
  /** True once we can compute a schedule (rate or payment known). */
  scheduleAvailable: boolean;
  originalPrincipalCents: number;
  currentBalanceCents: number;
  /** Phase 1: always 'estimated' (projected from start date). Phase 2 adds 'confirmed'. */
  balanceStatus: 'estimated' | 'confirmed';
  balanceAsOf: string;
  paymentsElapsed: number;
  paymentsTotal: number;
  pctPaid: number;
  scheduledPaymentCents: number;
  paymentFrequency: PaymentFrequency;
  rate: MortgageRateView;
  totalPaidToDateCents: number;
  totalInterestToDateCents: number;
  totalPrincipalToDateCents: number;
  totalInterestOverLifeCents: number;
  /**
   * Provenance of the to-date figures. `interestSource='actual'` means interest
   * is the sum of the bank's own `interest_paid` from your uploaded statements
   * (through `throughDate`) plus a small projection since; `'estimated'` means
   * it's modelled from the schedule (no statement carried interest yet).
   */
  paidToDate: {
    interestSource: 'actual' | 'estimated';
    throughDate: string | null;
    statementsWithInterest: number;
  };
  /** Remaining amortization (months) at the current balance + latest rate — the
   * seed the client scenario tab re-amortizes against. */
  remainingAmortizationMonths: number;
  currentPaymentSplit: {
    interestCents: number;
    principalCents: number;
    interestSharePct: number;
  };
  crossover: { paymentIndex: number; reached: boolean };
  equity: {
    downPaymentCents: number;
    paydownEquityCents: number;
    appreciationEquityCents: number;
    totalEquityCents: number;
    hasAppreciation: boolean;
  };
  /**
   * Forward-looking projection to the END OF THE CURRENT TERM, recomputed on
   * every read from the LATEST KNOWN rate (§4.5). For a variable product the
   * rate that drives it is the most recent statement's `interest_rate` (or a
   * `rate_change` event), so every fresh statement re-bases the forecast — the
   * whole point for flexible rates where the lifetime cost is unknown at signing.
   */
  projected: {
    forwardRate: {
      nominalPct: number;
      basedOn: 'statement' | 'rate_change' | 'term';
      asOfDate: string | null;
    };
    /** True once we're projecting > ~6 months past the last statement — the UI
     * nudges the user to upload a fresh statement so the forecast stays honest. */
    projectionStale: boolean;
    toEndOfTerm: {
      date: string;
      balanceCents: number;
      /** Projected total equity when the term matures (paydown + any known appreciation). */
      equityCents: number;
      /** Whole-loan principal repaid by maturity. */
      principalPaidCents: number;
      /** Interest paid to date + interest still to pay this term. */
      totalInterestCents: number;
      /** Interest still to pay between now and maturity at the forward rate. */
      interestRemainingCents: number;
    };
  };
  currentTerm: {
    sequence: number;
    termStartDate: string;
    maturityDate: string;
    termMonths: number;
  };
  nextRenewalDate: string;
  daysToRenewal: number;
}

export interface ScheduleView {
  scheduleAvailable: boolean;
  paymentsElapsed: number;
  rows: Array<ScheduleRow & { estimated: boolean }>;
}

// ============ INTERNAL COMPUTE ============

interface TermMath {
  nominal: number; // decimal
  compounding: Compounding;
  frequency: PaymentFrequency;
  n: number;
  i: number;
  amortizationMonths: number;
  nPayments: number;
  /** Payment in DOLLARS (rounded to the cent). */
  payment: number;
  scheduleAvailable: boolean;
}

const CENTS = 100;
const toCents = (dollars: number): number => Math.round(dollars * CENTS);
const toDollars = (cents: number): number => cents / CENTS;
const MS_PER_DAY = 86_400_000;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / MS_PER_DAY);
}

/**
 * Resolve a term row into engine inputs. Implements the rate-unknown state
 * machine (§4.8): rate known → compute payment; payment known, rate unknown →
 * solve the implied rate; neither → schedule unavailable.
 */
function termMath(principalDollars: number, term: MortgageTerm): TermMath {
  const compounding = term.compounding as Compounding;
  const frequency = term.payment_frequency as PaymentFrequency;
  const n = paymentsPerYear(frequency);
  const amortizationMonths = term.amortization_months_at_start;
  const nPayments = Math.round((amortizationMonths / 12) * n);
  const statedPayment = term.scheduled_payment_cents != null ? toDollars(term.scheduled_payment_cents) : null;

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

  return { nominal, compounding, frequency, n, i, amortizationMonths, nPayments, payment, scheduleAvailable };
}

function maskAddress(address: string | null): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (trimmed.length <= 4) return '••••';
  // Keep the first token (street number) + mask the rest.
  const firstSpace = trimmed.indexOf(' ');
  const head = firstSpace > 0 ? trimmed.slice(0, firstSpace) : trimmed.slice(0, 3);
  return `${head} ••••••`;
}

// ============ SERVICE ============

export class MortgageService {
  private db: DrizzleD1Database;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1);
  }

  /** Public household-membership gate (used by the AI extract route, which has
   * no mortgage row to load yet). Throws ForbiddenError for non-members. */
  async assertHouseholdMember(householdId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
  }

  private async checkHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const member = await this.db
      .select()
      .from(householdMembers)
      .where(
        and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, userId))
      )
      .get();
    if (!member) {
      throw new ForbiddenError('You do not have access to this household');
    }
  }

  /** Load a mortgage, asserting it belongs to the household (IDOR guard). */
  private async loadOwnedMortgage(householdId: string, mortgageId: string): Promise<Mortgage> {
    const row = await this.db
      .select()
      .from(mortgages)
      .where(and(eq(mortgages.id, mortgageId), eq(mortgages.household_id, householdId)))
      .get();
    if (!row) throw new NotFoundError('Mortgage not found');
    return row;
  }

  private async currentTerm(mortgageId: string): Promise<MortgageTerm> {
    const term = await this.db
      .select()
      .from(mortgageTerms)
      .where(eq(mortgageTerms.mortgage_id, mortgageId))
      .orderBy(desc(mortgageTerms.sequence))
      .get();
    if (!term) throw new NotFoundError('Mortgage has no term');
    return term;
  }

  async createMortgage(
    householdId: string,
    userId: string,
    input: CreateMortgageInput
  ): Promise<Mortgage> {
    await this.checkHouseholdAccess(householdId, userId);

    // Derive original principal from price − down when not given directly.
    let principalCents = input.originalPrincipalCents ?? null;
    if (principalCents == null && input.originalPriceCents != null && input.downPaymentCents != null) {
      principalCents = input.originalPriceCents - input.downPaymentCents;
    }
    if (principalCents == null || principalCents <= 0) {
      throw new ValidationError('Provide the original loan amount (or price and down payment).');
    }
    const amortizationMonths = input.originalAmortizationMonths ?? 300;
    if (amortizationMonths <= 0) throw new ValidationError('Amortization must be positive.');
    if (input.termMonths <= 0) throw new ValidationError('Term length must be positive.');

    const mortgageId = generateId();
    const ts = now();
    await this.db.insert(mortgages).values({
      id: mortgageId,
      household_id: householdId,
      nickname: input.nickname,
      lender: input.lender ?? null,
      product_type: input.productType ?? 'standard',
      property_address: input.propertyAddress ?? null,
      mortgage_number_last4: input.mortgageNumberLast4 ?? null,
      original_price_cents: input.originalPriceCents ?? null,
      down_payment_cents: input.downPaymentCents ?? null,
      original_principal_cents: principalCents,
      original_amortization_months: amortizationMonths,
      start_date: input.startDate,
      current_home_value_cents: input.currentHomeValueCents ?? null,
      insurance_premium_cents: input.insurancePremiumCents ?? null,
      is_active: true,
      created_by: userId,
      created_at: ts,
      updated_at: ts,
    });

    const maturity = addMonths(input.startDate, input.termMonths);
    await this.db.insert(mortgageTerms).values({
      id: generateId(),
      mortgage_id: mortgageId,
      household_id: householdId,
      sequence: 1,
      rate_type: input.rateType,
      compounding: input.compounding,
      nominal_rate_bps: input.nominalRateBps ?? 0,
      prime_rate_bps: input.primeRateBps ?? null,
      spread_bps: input.spreadBps ?? null,
      term_months: input.termMonths,
      term_start_date: input.startDate,
      maturity_date: maturity,
      payment_frequency: input.paymentFrequency,
      amortization_months_at_start: amortizationMonths,
      starting_balance_cents: principalCents,
      scheduled_payment_cents: input.scheduledPaymentCents ?? null,
      is_current: true,
      created_at: ts,
      updated_at: ts,
    });

    return this.loadOwnedMortgage(householdId, mortgageId);
  }

  async listMortgages(householdId: string, userId: string): Promise<MortgageListItem[]> {
    await this.checkHouseholdAccess(householdId, userId);
    const rows = await this.db
      .select()
      .from(mortgages)
      .where(eq(mortgages.household_id, householdId))
      .orderBy(desc(mortgages.is_active), desc(mortgages.created_at))
      .limit(LIST_MORTGAGES_LIMIT)
      .all();

    const items: MortgageListItem[] = [];
    for (const m of rows) {
      const term = await this.db
        .select()
        .from(mortgageTerms)
        .where(eq(mortgageTerms.mortgage_id, m.id))
        .orderBy(desc(mortgageTerms.sequence))
        .get();
      const mortgagePrincipal = toDollars(m.original_principal_cents);
      const termPrincipal = toDollars(term?.starting_balance_cents ?? m.original_principal_cents);
      let balance = mortgagePrincipal;
      let nextRenewal: string | null = null;
      if (term) {
        const math = termMath(termPrincipal, term);
        nextRenewal = term.maturity_date;
        if (math.scheduleAvailable) {
          const anchors = await this.loadAnchors(m.id);
          const lumps = await this.loadLumpEvents(m.id);
          balance = reconcileCurrentBalance({
            originalPrincipal: termPrincipal,
            i: math.i,
            payment: math.payment,
            termStartDate: term.term_start_date,
            statements: anchors,
            lumpEvents: lumps,
            paymentsPerYearN: math.n,
            asOf: now(),
          }).currentBalance;
        }
      }
      const pctPaid = mortgagePrincipal > 0 ? (mortgagePrincipal - balance) / mortgagePrincipal : 0;
      items.push({
        id: m.id,
        nickname: m.nickname,
        lender: m.lender,
        productType: m.product_type,
        currentBalanceCents: toCents(balance),
        pctPaid: clamp01(pctPaid),
        nextRenewalDate: nextRenewal,
        isActive: m.is_active,
      });
    }
    return items;
  }

  async getSummary(
    householdId: string,
    userId: string,
    mortgageId: string
  ): Promise<MortgageSummary> {
    await this.checkHouseholdAccess(householdId, userId);
    const mortgage = await this.loadOwnedMortgage(householdId, mortgageId);
    const term = await this.currentTerm(mortgageId);

    // Full loan principal (for equity + %-paid) vs the CURRENT term's starting
    // balance (for the payment/projection math — differs after a renewal).
    const mortgagePrincipal = toDollars(mortgage.original_principal_cents);
    const principal = toDollars(term.starting_balance_cents ?? mortgage.original_principal_cents);
    const math = termMath(principal, term);
    const ts = now();
    const elapsed = math.scheduleAvailable ? clampPayments(daysBetween(term.term_start_date, ts), math) : 0;

    // Statements (reconciliation anchors + rate/interest actuals), lump-sum
    // prepayments, and rate-change events.
    const statements = await this.loadAnchors(mortgageId);
    const facts = await this.loadStatementFacts(mortgageId);
    const lumpEvents = await this.loadLumpEvents(mortgageId);
    const rateChanges = await this.loadRateChangeEvents(mortgageId);

    // FORWARD rate/payment for every projection = the LATEST KNOWN rate, not the
    // static term rate: latest statement's interest_rate → latest rate_change →
    // term. This is the variable-rate fix — a fresh statement carrying a new rate
    // re-bases the balance projection, the payment split, and the forecast.
    const fwd = math.scheduleAvailable
      ? resolveForwardRate({
          termNominal: math.nominal,
          i: math.i,
          payment: math.payment,
          n: math.n,
          compounding: math.compounding,
          facts,
          rateChanges,
          asOf: ts,
        })
      : { i: math.i, payment: math.payment, nominal: math.nominal, basedOn: 'term' as const, asOfDate: null };

    // Reconcile against real statements: snap to the latest statement's closing
    // balance and project forward at the forward rate (§4.5). Theory when none.
    const recon = math.scheduleAvailable
      ? reconcileCurrentBalance({
          originalPrincipal: principal,
          i: fwd.i,
          payment: fwd.payment,
          termStartDate: term.term_start_date,
          statements,
          lumpEvents,
          paymentsPerYearN: math.n,
          asOf: ts,
        })
      : {
          currentBalance: principal,
          status: 'estimated' as const,
          balanceAsOf: term.term_start_date,
          hasAnchor: false,
          paymentsSinceAnchor: 0,
        };
    const balance = recon.currentBalance;

    const principalPaid = mortgagePrincipal - balance; // whole-loan equity paydown
    const termPrincipalPaid = principal - balance; // paid within the current term

    // Interest paid to date PREFERS the bank's own actuals from statements
    // (§4.5 rule 4 / §4.10): the sum of each statement's `interest_paid`, plus a
    // small projection for the tail since the last statement. Falls back to the
    // modelled figure only when no statement has carried an interest number yet.
    const actual = sumStatementActuals(facts, ts);
    let interestPaid: number;
    let interestSource: 'actual' | 'estimated';
    if (actual.statementsWithInterest > 0) {
      const anchorBalance = pickAnchor(statements, ts)?.closingBalance ?? principal;
      const tail = interestOverPeriods(anchorBalance, fwd.i, fwd.payment, recon.paymentsSinceAnchor).interest;
      interestPaid = actual.interest + tail;
      interestSource = 'actual';
    } else {
      interestPaid = fwd.payment * elapsed - termPrincipalPaid;
      interestSource = 'estimated';
    }
    const totalInterestToDate = Math.max(0, interestPaid);
    const totalPrincipalToDate = Math.max(0, principalPaid);
    const totalPaidToDate = totalPrincipalToDate + totalInterestToDate;

    const nextInterest = balance * fwd.i;
    const nextPrincipal = fwd.payment - nextInterest;
    const interestShare = fwd.payment > 0 ? nextInterest / fwd.payment : 0;
    const crossoverIndex = math.scheduleAvailable ? crossoverPayment(fwd.i, math.nPayments) : 0;

    const eq = equityBreakdown({
      price: mortgage.original_price_cents != null ? toDollars(mortgage.original_price_cents) : null,
      downPayment: mortgage.down_payment_cents != null ? toDollars(mortgage.down_payment_cents) : null,
      originalPrincipal: mortgagePrincipal,
      currentValue:
        mortgage.current_home_value_cents != null ? toDollars(mortgage.current_home_value_cents) : null,
      balance,
    });

    // Remaining amortization at the CURRENT balance + forward rate (the scenario
    // seed). remainingPeriods returns null when the payment can't amortize (VRM
    // past its trigger) — fall back to the term's remaining payment count.
    const remPeriods = math.scheduleAvailable
      ? remainingPeriods(balance, fwd.i, fwd.payment) ?? Math.max(0, math.nPayments - elapsed)
      : Math.max(0, math.nPayments - elapsed);
    const remainingAmortizationMonths = Math.max(0, Math.round((remPeriods / math.n) * 12));

    // Forecast to the END OF THE CURRENT TERM at the forward rate.
    const paymentsToMaturity = math.scheduleAvailable
      ? Math.min(remPeriods, paymentsBetween(ts, term.maturity_date, math.n))
      : 0;
    const proj = interestOverPeriods(balance, fwd.i, fwd.payment, paymentsToMaturity);
    const balanceAtMaturity = proj.endBalance;
    const interestRemaining = proj.interest;
    const projTotalInterest = totalInterestToDate + interestRemaining;
    const projEquity = eq.totalEquity + (balance - balanceAtMaturity);
    const projPrincipalPaid = mortgagePrincipal - balanceAtMaturity;
    const stalePayments = Math.max(1, Math.round(math.n / 2)); // ~6 months of payments
    const projectionStale = recon.hasAnchor && recon.paymentsSinceAnchor > stalePayments;

    return {
      mortgageId,
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
      scheduledPaymentCents: toCents(fwd.payment),
      paymentFrequency: math.frequency,
      rate: {
        nominalPct: roundCents(fwd.nominal * 100),
        effectiveAnnualPct: roundCents(effectiveAnnualRate(fwd.nominal, math.n, math.compounding) * 100),
        rateType: term.rate_type as RateType,
        compounding: math.compounding,
        primeRateBps: term.prime_rate_bps,
        spreadBps: term.spread_bps,
      },
      totalPaidToDateCents: toCents(totalPaidToDate),
      totalInterestToDateCents: toCents(totalInterestToDate),
      totalPrincipalToDateCents: toCents(totalPrincipalToDate),
      totalInterestOverLifeCents: toCents(
        math.scheduleAvailable ? Math.max(0, totalInterest(math.payment, math.nPayments, principal)) : 0
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
      crossover: { paymentIndex: crossoverIndex, reached: elapsed >= crossoverIndex && crossoverIndex > 0 },
      equity: {
        downPaymentCents: toCents(eq.downPayment),
        paydownEquityCents: toCents(eq.paydownEquity),
        appreciationEquityCents: toCents(eq.appreciationEquity),
        totalEquityCents: toCents(eq.totalEquity),
        hasAppreciation: eq.hasAppreciation,
      },
      projected: {
        forwardRate: {
          nominalPct: roundCents(fwd.nominal * 100),
          basedOn: fwd.basedOn,
          asOfDate: fwd.asOfDate,
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
      daysToRenewal: daysBetween(ts, term.maturity_date),
    };
  }

  async getSchedule(
    householdId: string,
    userId: string,
    mortgageId: string
  ): Promise<ScheduleView> {
    await this.checkHouseholdAccess(householdId, userId);
    const mortgage = await this.loadOwnedMortgage(householdId, mortgageId);
    const term = await this.currentTerm(mortgageId);
    const principal = toDollars(term.starting_balance_cents ?? mortgage.original_principal_cents);
    const math = termMath(principal, term);

    if (!math.scheduleAvailable) {
      return { scheduleAvailable: false, paymentsElapsed: 0, rows: [] };
    }

    const elapsed = clampPayments(daysBetween(term.term_start_date, now()), math);
    const rows = buildSchedule({
      principal,
      nominalAnnual: math.nominal,
      frequency: math.frequency,
      compounding: math.compounding,
      amortizationMonths: math.amortizationMonths,
      paymentOverride: term.scheduled_payment_cents != null ? math.payment : undefined,
    }).map((r) => ({
      ...r,
      interest: toCents(r.interest),
      principal: toCents(r.principal),
      balance: toCents(r.balance),
      // Phase 1: every row is projected. Phase 2 marks reconciled rows confirmed.
      estimated: true,
    }));

    return { scheduleAvailable: true, paymentsElapsed: elapsed, rows };
  }

  /**
   * Full mortgage record by id (owner-scoped). Powers the settings/edit form,
   * which needs the raw (unmasked) property address + current home value that
   * the list/summary views don't expose. Same access + IDOR guards as every
   * other read; returns the same shape create/update already return.
   */
  async getMortgage(householdId: string, userId: string, mortgageId: string): Promise<Mortgage> {
    await this.checkHouseholdAccess(householdId, userId);
    return this.loadOwnedMortgage(householdId, mortgageId);
  }

  async updateMortgage(
    householdId: string,
    userId: string,
    mortgageId: string,
    input: UpdateMortgageInput
  ): Promise<Mortgage> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedMortgage(householdId, mortgageId);

    const patch: Partial<Mortgage> = { updated_at: now() };
    if (input.nickname !== undefined) patch.nickname = input.nickname;
    if (input.lender !== undefined) patch.lender = input.lender;
    if (input.propertyAddress !== undefined) patch.property_address = input.propertyAddress;
    if (input.currentHomeValueCents !== undefined) patch.current_home_value_cents = input.currentHomeValueCents;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    await this.db.update(mortgages).set(patch).where(eq(mortgages.id, mortgageId));
    return this.loadOwnedMortgage(householdId, mortgageId);
  }

  /**
   * Delete a property and EVERY artifact tied to it — rate periods, statements,
   * events, renewal offers and terms — then the mortgage row itself. The schema
   * declares `ON DELETE CASCADE`, but we clear the children explicitly so a delete
   * is a guaranteed full wipe regardless of whether FK enforcement is on for the
   * connection (belt-and-suspenders; also keeps the behaviour testable).
   */
  async deleteMortgage(householdId: string, userId: string, mortgageId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedMortgage(householdId, mortgageId);
    await this.db.delete(mortgageRatePeriods).where(eq(mortgageRatePeriods.mortgage_id, mortgageId));
    await this.db.delete(mortgageStatements).where(eq(mortgageStatements.mortgage_id, mortgageId));
    await this.db.delete(mortgageEvents).where(eq(mortgageEvents.mortgage_id, mortgageId));
    await this.db.delete(mortgageRenewalOffers).where(eq(mortgageRenewalOffers.mortgage_id, mortgageId));
    await this.db.delete(mortgageTerms).where(eq(mortgageTerms.mortgage_id, mortgageId));
    await this.db.delete(mortgages).where(eq(mortgages.id, mortgageId));
  }

  /** Terms for a mortgage (rate history), oldest first. */
  async listTerms(householdId: string, userId: string, mortgageId: string): Promise<MortgageTerm[]> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedMortgage(householdId, mortgageId);
    return this.db
      .select()
      .from(mortgageTerms)
      .where(eq(mortgageTerms.mortgage_id, mortgageId))
      .orderBy(mortgageTerms.sequence)
      .limit(LIST_TERMS_LIMIT)
      .all();
  }

  /** Change ledger for a mortgage (events), newest first. */
  async listEvents(householdId: string, userId: string, mortgageId: string): Promise<MortgageEvent[]> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedMortgage(householdId, mortgageId);
    return this.db
      .select()
      .from(mortgageEvents)
      .where(eq(mortgageEvents.mortgage_id, mortgageId))
      .orderBy(desc(mortgageEvents.event_date), desc(mortgageEvents.created_at))
      .limit(LIST_EVENTS_LIMIT)
      .all();
  }

  // ---- Statements (reconciliation anchors) ----

  private async loadAnchors(mortgageId: string): Promise<StatementAnchor[]> {
    const rows = await this.db
      .select()
      .from(mortgageStatements)
      .where(eq(mortgageStatements.mortgage_id, mortgageId))
      .orderBy(mortgageStatements.statement_date)
      .limit(LIST_STATEMENTS_LIMIT)
      .all();
    return rows.map((r) => ({
      statementDate: r.statement_date,
      closingBalance: toDollars(r.closing_balance_cents),
    }));
  }

  private async loadLumpEvents(mortgageId: string): Promise<LumpEvent[]> {
    const rows = await this.db
      .select()
      .from(mortgageEvents)
      .where(
        and(eq(mortgageEvents.mortgage_id, mortgageId), eq(mortgageEvents.event_type, 'lump_sum_prepayment'))
      )
      .limit(LOAD_LUMP_EVENTS_LIMIT)
      .all();
    const out: LumpEvent[] = [];
    for (const r of rows) {
      if (r.amount_cents != null) out.push({ eventDate: r.event_date, amount: toDollars(r.amount_cents) });
    }
    return out;
  }

  /**
   * Statement facts (oldest first) used by the forecast: the rate/payment each
   * statement reported (for the forward rate) and the bank's actual
   * interest/principal paid (preferred over modelled figures, §4.5 rule 4).
   */
  private async loadStatementFacts(mortgageId: string): Promise<StatementFact[]> {
    const rows = await this.db
      .select()
      .from(mortgageStatements)
      .where(eq(mortgageStatements.mortgage_id, mortgageId))
      .orderBy(mortgageStatements.statement_date)
      .limit(LIST_STATEMENTS_LIMIT)
      .all();
    return rows.map((r) => ({
      statementDate: r.statement_date,
      interestPaidCents: r.interest_paid_cents,
      principalPaidCents: r.principal_paid_cents,
      paymentAmountCents: r.payment_amount_cents,
      interestRateBps: r.interest_rate_bps,
    }));
  }

  /** Rate-change events (date + new rate) — a mid-term rate reset with no fresh
   * statement still re-bases the forward projection. */
  private async loadRateChangeEvents(mortgageId: string): Promise<RateChangeEvent[]> {
    const rows = await this.db
      .select()
      .from(mortgageEvents)
      .where(and(eq(mortgageEvents.mortgage_id, mortgageId), eq(mortgageEvents.event_type, 'rate_change')))
      .limit(LOAD_LUMP_EVENTS_LIMIT)
      .all();
    const out: RateChangeEvent[] = [];
    for (const r of rows) {
      if (r.new_rate_bps != null) out.push({ eventDate: r.event_date, newRateBps: r.new_rate_bps });
    }
    return out;
  }

  /**
   * Commit a statement. Dedups on (mortgage, statement_date): a second commit for
   * the same date throws ConflictError unless `replace` is set (replace-vs-cancel).
   */
  async addStatement(
    householdId: string,
    userId: string,
    mortgageId: string,
    input: AddStatementInput,
    opts?: { replace?: boolean }
  ): Promise<MortgageStatement> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedMortgage(householdId, mortgageId);

    const existing = await this.db
      .select()
      .from(mortgageStatements)
      .where(
        and(
          eq(mortgageStatements.mortgage_id, mortgageId),
          eq(mortgageStatements.statement_date, input.statementDate)
        )
      )
      .get();
    if (existing && !opts?.replace) {
      throw new ConflictError('A statement for that date already exists.');
    }

    const ts = now();
    const values = {
      household_id: householdId,
      statement_date: input.statementDate,
      period_start: input.periodStart ?? null,
      period_end: input.periodEnd ?? null,
      opening_balance_cents: input.openingBalanceCents ?? null,
      closing_balance_cents: input.closingBalanceCents,
      interest_paid_cents: input.interestPaidCents ?? null,
      interest_charged_cents: input.interestChargedCents ?? null,
      principal_paid_cents: input.principalPaidCents ?? null,
      payment_amount_cents: input.paymentAmountCents ?? null,
      interest_rate_bps: input.interestRateBps ?? null,
      prime_rate_bps: input.primeRateBps ?? null,
      variance_bps: input.varianceBps ?? null,
      remaining_amortization_months: input.remainingAmortizationMonths ?? null,
      property_tax_paid_cents: input.propertyTaxPaidCents ?? null,
      source: input.source ?? 'manual',
      extraction_confidence: input.extractionConfidence ?? null,
      raw_extraction_json: input.rawExtractionJson ?? null,
      updated_at: ts,
    };

    let id: string;
    if (existing) {
      id = existing.id;
      await this.db.update(mortgageStatements).set(values).where(eq(mortgageStatements.id, id));
    } else {
      id = generateId();
      await this.db
        .insert(mortgageStatements)
        .values({ id, mortgage_id: mortgageId, ...values, created_by: userId, created_at: ts });
    }
    await this.syncRatePeriods(householdId, mortgageId, id, input);

    const row = await this.db.select().from(mortgageStatements).where(eq(mortgageStatements.id, id)).get();
    if (!row) throw new NotFoundError('Statement not found');
    return row;
  }

  /**
   * Rewrite this statement's rate sub-periods. Delete-then-insert (rather than
   * upsert) so a re-committed statement whose breakdown SHRANK — e.g. a correction
   * that merges two sub-periods back into one — doesn't leave the dropped period
   * behind as a phantom rate change.
   *
   * When the caller sent no `ratePeriods` we still record the statement's single
   * headline rate dated at the statement date, so manual entries and older
   * extractions (no breakdown table) still contribute to the history.
   */
  private async syncRatePeriods(
    householdId: string,
    mortgageId: string,
    statementId: string,
    input: AddStatementInput
  ): Promise<void> {
    const explicit = input.ratePeriods;
    const periods: AddRatePeriodInput[] =
      explicit === undefined
        ? input.interestRateBps != null && input.interestRateBps > 0
          ? [
              {
                effectiveDate: input.statementDate,
                rateBps: input.interestRateBps,
                periodEnd: input.periodEnd ?? null,
                primeRateBps: input.primeRateBps ?? null,
                varianceBps: input.varianceBps ?? null,
              },
            ]
          : []
        : (explicit ?? []);

    await this.db.delete(mortgageRatePeriods).where(eq(mortgageRatePeriods.statement_id, statementId));
    if (periods.length === 0) return;

    // Dedup on effective date (the table's unique key) — last one wins.
    const byDate = new Map<string, AddRatePeriodInput>();
    for (const p of periods) {
      if (!p?.effectiveDate || !(p.rateBps > 0)) continue;
      byDate.set(p.effectiveDate, p);
    }
    if (byDate.size === 0) return;

    const ts = now();
    await this.db.insert(mortgageRatePeriods).values(
      [...byDate.values()].map((p) => ({
        id: generateId(),
        mortgage_id: mortgageId,
        household_id: householdId,
        statement_id: statementId,
        effective_date: p.effectiveDate,
        period_end: p.periodEnd ?? null,
        rate_bps: p.rateBps,
        prime_rate_bps: p.primeRateBps ?? null,
        variance_bps: p.varianceBps ?? null,
        source: 'statement',
        created_at: ts,
      }))
    );
  }

  /** Every dated rate sub-period for a mortgage, OLDEST first (the history axis). */
  async listRatePeriods(
    householdId: string,
    userId: string,
    mortgageId: string
  ): Promise<MortgageRatePeriod[]> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedMortgage(householdId, mortgageId);
    return this.db
      .select()
      .from(mortgageRatePeriods)
      .where(eq(mortgageRatePeriods.mortgage_id, mortgageId))
      .orderBy(mortgageRatePeriods.effective_date)
      .all();
  }

  async listStatements(
    householdId: string,
    userId: string,
    mortgageId: string
  ): Promise<MortgageStatement[]> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedMortgage(householdId, mortgageId);
    return this.db
      .select()
      .from(mortgageStatements)
      .where(eq(mortgageStatements.mortgage_id, mortgageId))
      .orderBy(desc(mortgageStatements.statement_date))
      .limit(LIST_STATEMENTS_LIMIT)
      .all();
  }

  async deleteStatement(
    householdId: string,
    userId: string,
    mortgageId: string,
    statementId: string
  ): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedMortgage(householdId, mortgageId);
    const row = await this.db
      .select()
      .from(mortgageStatements)
      .where(
        and(eq(mortgageStatements.id, statementId), eq(mortgageStatements.mortgage_id, mortgageId))
      )
      .get();
    if (!row) throw new NotFoundError('Statement not found');
    // Explicit child wipe (see deleteMortgage) — never leave orphaned rate rows
    // behind to show up as a phantom rate change after the statement is gone.
    await this.db.delete(mortgageRatePeriods).where(eq(mortgageRatePeriods.statement_id, statementId));
    await this.db.delete(mortgageStatements).where(eq(mortgageStatements.id, statementId));
  }

  // ---- Events ----

  async addEvent(
    householdId: string,
    userId: string,
    mortgageId: string,
    input: AddEventInput
  ): Promise<MortgageEvent> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedMortgage(householdId, mortgageId);
    const id = generateId();
    await this.db.insert(mortgageEvents).values({
      id,
      mortgage_id: mortgageId,
      household_id: householdId,
      event_type: input.eventType,
      event_date: input.eventDate,
      amount_cents: input.amountCents ?? null,
      new_rate_bps: input.newRateBps ?? null,
      new_payment_cents: input.newPaymentCents ?? null,
      policy: input.policy ?? null,
      note: input.note ?? null,
      created_by: userId,
      created_at: now(),
    });
    const row = await this.db.select().from(mortgageEvents).where(eq(mortgageEvents.id, id)).get();
    if (!row) throw new NotFoundError('Event not found');
    return row;
  }

  // ---- Renewal (create term N+1) ----

  /**
   * Record a renewal: snap the balance at renewal (reconciled), close the prior
   * term, and create term N+1 re-amortized over the ACTUAL remaining amortization
   * at the new rate (§4.6). Also writes a 'renewal' event.
   */
  async renewMortgage(
    householdId: string,
    userId: string,
    mortgageId: string,
    input: RenewMortgageInput
  ): Promise<MortgageTerm> {
    await this.checkHouseholdAccess(householdId, userId);
    const mortgage = await this.loadOwnedMortgage(householdId, mortgageId);
    const priorTerm = await this.currentTerm(mortgageId);

    const priorPrincipal = toDollars(priorTerm.starting_balance_cents ?? mortgage.original_principal_cents);
    const priorMath = termMath(priorPrincipal, priorTerm);
    const anchors = await this.loadAnchors(mortgageId);
    const lumps = await this.loadLumpEvents(mortgageId);
    const balanceAtRenewal = priorMath.scheduleAvailable
      ? reconcileCurrentBalance({
          originalPrincipal: priorPrincipal,
          i: priorMath.i,
          payment: priorMath.payment,
          termStartDate: priorTerm.term_start_date,
          statements: anchors,
          lumpEvents: lumps,
          paymentsPerYearN: priorMath.n,
          asOf: input.termStartDate,
        }).currentBalance
      : priorPrincipal;

    const monthsElapsed = Math.max(0, Math.round(paymentsBetween(priorTerm.term_start_date, input.termStartDate, 12)));
    const remainingAmort =
      input.amortizationMonthsAtStart ?? Math.max(1, priorTerm.amortization_months_at_start - monthsElapsed);

    const n = paymentsPerYear(input.paymentFrequency);
    const nominal = (input.nominalRateBps ?? 0) / 10_000;
    const remainingPeriodsAtNewFreq = Math.round((remainingAmort / 12) * n);
    const computedPayment =
      input.scheduledPaymentCents != null
        ? toDollars(input.scheduledPaymentCents)
        : reAmortizePayment(balanceAtRenewal, nominal, remainingPeriodsAtNewFreq, n, input.compounding);

    const ts = now();
    await this.db
      .update(mortgageTerms)
      .set({ is_current: false, updated_at: ts })
      .where(eq(mortgageTerms.id, priorTerm.id));

    const newTermId = generateId();
    const maturity = addMonths(input.termStartDate, input.termMonths);
    await this.db.insert(mortgageTerms).values({
      id: newTermId,
      mortgage_id: mortgageId,
      household_id: householdId,
      sequence: priorTerm.sequence + 1,
      rate_type: input.rateType,
      compounding: input.compounding,
      nominal_rate_bps: input.nominalRateBps ?? 0,
      prime_rate_bps: input.primeRateBps ?? null,
      spread_bps: input.spreadBps ?? null,
      term_months: input.termMonths,
      term_start_date: input.termStartDate,
      maturity_date: maturity,
      payment_frequency: input.paymentFrequency,
      amortization_months_at_start: remainingAmort,
      starting_balance_cents: toCents(balanceAtRenewal),
      scheduled_payment_cents: toCents(computedPayment),
      is_current: true,
      created_at: ts,
      updated_at: ts,
    });

    await this.db.insert(mortgageEvents).values({
      id: generateId(),
      mortgage_id: mortgageId,
      household_id: householdId,
      event_type: 'renewal',
      event_date: input.termStartDate,
      new_rate_bps: input.nominalRateBps ?? null,
      new_payment_cents: toCents(computedPayment),
      note: `Renewed at ${((input.nominalRateBps ?? 0) / 100).toFixed(2)}%`,
      created_by: userId,
      created_at: ts,
    });

    const row = await this.db.select().from(mortgageTerms).where(eq(mortgageTerms.id, newTermId)).get();
    if (!row) throw new NotFoundError('Term not found');
    return row;
  }

  // ---- Renewal offers + what-if ----

  /** Reconciled current balance, payment, and remaining amortization (current term). */
  private async reconciledCurrent(
    mortgage: Mortgage,
    term: MortgageTerm
  ): Promise<{ balance: number; payment: number; n: number; i: number; remainingMonths: number; compounding: Compounding }> {
    const principal = toDollars(term.starting_balance_cents ?? mortgage.original_principal_cents);
    const math = termMath(principal, term);
    const anchors = await this.loadAnchors(mortgage.id);
    const lumps = await this.loadLumpEvents(mortgage.id);
    const balance = math.scheduleAvailable
      ? reconcileCurrentBalance({
          originalPrincipal: principal,
          i: math.i,
          payment: math.payment,
          termStartDate: term.term_start_date,
          statements: anchors,
          lumpEvents: lumps,
          paymentsPerYearN: math.n,
          asOf: now(),
        }).currentBalance
      : principal;
    const remPeriods = remainingPeriods(balance, math.i, math.payment) ?? math.nPayments;
    const remainingMonths = Math.max(1, Math.round((remPeriods / math.n) * 12));
    return { balance, payment: math.payment, n: math.n, i: math.i, remainingMonths, compounding: math.compounding };
  }

  async addOffer(
    householdId: string,
    userId: string,
    mortgageId: string,
    input: AddOfferInput
  ): Promise<MortgageRenewalOffer> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedMortgage(householdId, mortgageId);
    const id = generateId();
    const ts = now();
    await this.db.insert(mortgageRenewalOffers).values({
      id,
      mortgage_id: mortgageId,
      household_id: householdId,
      bank_name: input.bankName,
      offered_rate_bps: input.offeredRateBps,
      rate_type: input.rateType,
      term_months: input.termMonths,
      monthly_payment_cents: input.monthlyPaymentCents ?? null,
      offer_expires_at: input.offerExpiresAt ?? null,
      status: 'draft',
      source: input.source ?? 'manual',
      note: input.note ?? null,
      created_by: userId,
      created_at: ts,
      updated_at: ts,
    });
    const row = await this.db.select().from(mortgageRenewalOffers).where(eq(mortgageRenewalOffers.id, id)).get();
    if (!row) throw new NotFoundError('Offer not found');
    return row;
  }

  async listOffers(householdId: string, userId: string, mortgageId: string): Promise<OffersView> {
    await this.checkHouseholdAccess(householdId, userId);
    const mortgage = await this.loadOwnedMortgage(householdId, mortgageId);
    const term = await this.currentTerm(mortgageId);
    const state = await this.reconciledCurrent(mortgage, term);

    const monthlyN = 12;
    const remPeriodsMonthly = Math.round((state.remainingMonths / 12) * monthlyN);
    const rows = await this.db
      .select()
      .from(mortgageRenewalOffers)
      .where(eq(mortgageRenewalOffers.mortgage_id, mortgageId))
      .orderBy(desc(mortgageRenewalOffers.created_at))
      .limit(LIST_OFFERS_LIMIT)
      .all();

    const offers: MortgageOfferView[] = rows.map((o) => {
      const nominal = o.offered_rate_bps / 10_000;
      const comp: Compounding = o.rate_type === 'fixed' ? 'semi_annual' : 'monthly';
      const computed =
        o.monthly_payment_cents != null
          ? toDollars(o.monthly_payment_cents)
          : reAmortizePayment(state.balance, nominal, remPeriodsMonthly, monthlyN, comp);
      return {
        id: o.id,
        bankName: o.bank_name,
        offeredRatePct: roundCents(nominal * 100),
        rateType: o.rate_type as RateType,
        termMonths: o.term_months,
        monthlyPaymentCents: toCents(computed),
        paymentSavedVsCurrentCents: toCents(state.payment - computed),
        status: o.status,
        offerExpiresAt: o.offer_expires_at,
        note: o.note,
      };
    });
    return { incumbentPaymentCents: toCents(state.payment), offers };
  }

  async updateOffer(
    householdId: string,
    userId: string,
    mortgageId: string,
    offerId: string,
    input: UpdateOfferInput
  ): Promise<MortgageRenewalOffer> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedMortgage(householdId, mortgageId);
    const existing = await this.db
      .select()
      .from(mortgageRenewalOffers)
      .where(and(eq(mortgageRenewalOffers.id, offerId), eq(mortgageRenewalOffers.mortgage_id, mortgageId)))
      .get();
    if (!existing) throw new NotFoundError('Offer not found');
    const patch: Partial<MortgageRenewalOffer> = { updated_at: now() };
    if (input.status !== undefined) patch.status = input.status;
    if (input.note !== undefined) patch.note = input.note;
    if (input.monthlyPaymentCents !== undefined) patch.monthly_payment_cents = input.monthlyPaymentCents;
    await this.db.update(mortgageRenewalOffers).set(patch).where(eq(mortgageRenewalOffers.id, offerId));
    const row = await this.db.select().from(mortgageRenewalOffers).where(eq(mortgageRenewalOffers.id, offerId)).get();
    if (!row) throw new NotFoundError('Offer not found');
    return row;
  }

  async deleteOffer(
    householdId: string,
    userId: string,
    mortgageId: string,
    offerId: string
  ): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.loadOwnedMortgage(householdId, mortgageId);
    const existing = await this.db
      .select()
      .from(mortgageRenewalOffers)
      .where(and(eq(mortgageRenewalOffers.id, offerId), eq(mortgageRenewalOffers.mortgage_id, mortgageId)))
      .get();
    if (!existing) throw new NotFoundError('Offer not found');
    await this.db.delete(mortgageRenewalOffers).where(eq(mortgageRenewalOffers.id, offerId));
  }

  /** What-if: accelerated-biweekly payoff + one-off lump-sum interest saved (§4.7). */
  async getWhatIf(
    householdId: string,
    userId: string,
    mortgageId: string,
    opts?: { lumpSumCents?: number }
  ): Promise<WhatIfView> {
    await this.checkHouseholdAccess(householdId, userId);
    const mortgage = await this.loadOwnedMortgage(householdId, mortgageId);
    const term = await this.currentTerm(mortgageId);
    const state = await this.reconciledCurrent(mortgage, term);
    const nominal = (term.nominal_rate_bps ?? 0) / 10_000;

    // Accelerated biweekly = monthly payment / 2, paid 26×/yr.
    const monthlyPmt =
      state.n === 12
        ? state.payment
        : roundCents(
            levelPayment(state.balance, periodicRate(nominal, 12, state.compounding), Math.round(state.remainingMonths))
          );
    const accel = roundCents(monthlyPmt / 2);
    const i26 = periodicRate(nominal, 26, state.compounding);
    const payoff = remainingPeriods(state.balance, i26, accel);
    const acceleratedYears = payoff != null ? Math.round((payoff / 26) * 10) / 10 : null;

    let lumpSaved: number | null = null;
    if (opts?.lumpSumCents && opts.lumpSumCents > 0) {
      const lump = toDollars(opts.lumpSumCents);
      const remBefore = remainingPeriods(state.balance, state.i, state.payment);
      const remAfter = remainingPeriods(Math.max(0, state.balance - lump), state.i, state.payment);
      if (remBefore != null && remAfter != null) {
        const interestBefore = remBefore * state.payment - state.balance;
        const interestAfter = remAfter * state.payment - (state.balance - lump);
        lumpSaved = Math.max(0, interestBefore - interestAfter);
      }
    }

    return {
      acceleratedBiweeklyPaymentCents: toCents(accel),
      acceleratedYearsToPayoff: acceleratedYears,
      lumpSumInterestSavedCents: lumpSaved != null ? toCents(lumpSaved) : null,
    };
  }
}

// ============ small pure helpers ============

/** The subset of a statement the forecast reads. */
interface StatementFact {
  statementDate: string;
  interestPaidCents: number | null;
  principalPaidCents: number | null;
  paymentAmountCents: number | null;
  interestRateBps: number | null;
}

interface RateChangeEvent {
  eventDate: string;
  newRateBps: number;
}

interface ForwardRate {
  i: number;
  payment: number;
  nominal: number;
  basedOn: 'statement' | 'rate_change' | 'term';
  asOfDate: string | null;
}

/**
 * The rate + payment to project the balance forward with. Picks the LATEST rate
 * signal at/before `asOf` — a statement's reported `interest_rate` or a
 * `rate_change` event — falling back to the term's contract rate when neither
 * exists. On a same-date tie the statement wins (the bank's own figure). When a
 * statement supplies the rate, its actual `payment_amount` becomes the forward
 * payment too (a VRM holds its payment; an ARM's has moved with the rate).
 */
function resolveForwardRate(input: {
  termNominal: number;
  i: number;
  payment: number;
  n: number;
  compounding: Compounding;
  facts: StatementFact[];
  rateChanges: RateChangeEvent[];
  asOf: string;
}): ForwardRate {
  const asOfT = new Date(input.asOf).getTime();
  let best: { date: string; bps: number; kind: 'statement' | 'rate_change'; payment?: number } | null = null;

  for (const f of input.facts) {
    if (f.interestRateBps == null || f.interestRateBps <= 0) continue;
    if (new Date(f.statementDate).getTime() > asOfT) continue;
    if (!best || new Date(f.statementDate).getTime() >= new Date(best.date).getTime()) {
      best = {
        date: f.statementDate,
        bps: f.interestRateBps,
        kind: 'statement',
        payment: f.paymentAmountCents != null && f.paymentAmountCents > 0 ? f.paymentAmountCents / CENTS : undefined,
      };
    }
  }
  for (const e of input.rateChanges) {
    if (e.newRateBps <= 0) continue;
    if (new Date(e.eventDate).getTime() > asOfT) continue;
    // Strictly newer than a statement signal — a same-date statement wins.
    if (!best || new Date(e.eventDate).getTime() > new Date(best.date).getTime()) {
      best = { date: e.eventDate, bps: e.newRateBps, kind: 'rate_change' };
    }
  }

  if (!best) {
    return { i: input.i, payment: input.payment, nominal: input.termNominal, basedOn: 'term', asOfDate: null };
  }
  const nominal = best.bps / 10_000;
  const i = periodicRate(nominal, input.n, input.compounding);
  const payment = best.payment != null ? roundCents(best.payment) : input.payment;
  return { i, payment, nominal, basedOn: best.kind, asOfDate: best.date };
}

/**
 * Sum the bank's own `interest_paid` across every statement at/before `asOf`
 * (the documented interest), and report the coverage: how many statements
 * carried an interest figure and the latest statement date.
 */
function sumStatementActuals(
  facts: StatementFact[],
  asOf: string
): { interest: number; statementsWithInterest: number; throughDate: string | null } {
  const asOfT = new Date(asOf).getTime();
  let interest = 0;
  let statementsWithInterest = 0;
  let throughDate: string | null = null;
  for (const f of facts) {
    if (new Date(f.statementDate).getTime() > asOfT) continue;
    if (f.interestPaidCents != null) {
      interest += f.interestPaidCents / CENTS;
      statementsWithInterest += 1;
    }
    if (throughDate == null || f.statementDate > throughDate) throughDate = f.statementDate;
  }
  return { interest, statementsWithInterest, throughDate };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function clampPayments(daysElapsed: number, math: TermMath): number {
  if (daysElapsed <= 0) return 0;
  const perPayment = 365 / math.n;
  return Math.max(0, Math.min(math.nPayments, Math.floor(daysElapsed / perPayment)));
}

/** Add whole months to an ISO date (YYYY-MM-DD…), clamping day overflow. */
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // Handle month-end overflow (e.g. Jan 31 + 1mo → Mar 3 → clamp to Feb 28/29).
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
