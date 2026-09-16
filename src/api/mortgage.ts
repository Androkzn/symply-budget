import { apiClient } from './client';

/**
 * Mortgage tracking API client (Budget-only). Mirrors `src/api/savings.ts`.
 *
 * Remote path: thin client — money figures come from the Worker amortisation
 * engine. Local-first path (`EXPO_PUBLIC_BUDGET_LOCAL_FIRST`): the same methods
 * project summary/schedule on-device via `localMortgageApi` + the client-mirror
 * engine (Phase 1 theory schedule; statement reconciliation can refine later).
 *
 * Base path: /households/:householdId/mortgage. Envelopes MUST match
 * `backend/src/routes/mortgage.ts` EXACTLY.
 */

const base = (householdId: string) => `/households/${householdId}/mortgage`;

export type MortgageRateType = 'fixed' | 'variable_arm' | 'variable_vrm';
export type MortgageCompounding = 'semi_annual' | 'monthly';
export type MortgageProductType = 'standard' | 'heloc_flexline' | 'step';
export type MortgagePaymentFrequency =
  | 'monthly'
  | 'semi_monthly'
  | 'biweekly'
  | 'weekly'
  | 'accel_biweekly'
  | 'accel_weekly';

export interface Mortgage {
  id: string;
  household_id: string;
  nickname: string;
  lender: string | null;
  product_type: MortgageProductType;
  property_address: string | null;
  mortgage_number_last4: string | null;
  original_price_cents: number | null;
  down_payment_cents: number | null;
  original_principal_cents: number;
  original_amortization_months: number;
  start_date: string;
  current_home_value_cents: number | null;
  insurance_premium_cents: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MortgageTerm {
  id: string;
  mortgage_id: string;
  household_id: string;
  sequence: number;
  rate_type: MortgageRateType;
  compounding: MortgageCompounding;
  nominal_rate_bps: number;
  prime_rate_bps: number | null;
  spread_bps: number | null;
  term_months: number;
  term_start_date: string;
  maturity_date: string;
  payment_frequency: MortgagePaymentFrequency;
  amortization_months_at_start: number;
  scheduled_payment_cents: number | null;
  is_current: boolean;
}

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

export interface MortgageSummary {
  mortgageId: string;
  nickname: string;
  lender: string | null;
  productType: string;
  propertyAddressMasked: string | null;
  scheduleAvailable: boolean;
  originalPrincipalCents: number;
  currentBalanceCents: number;
  balanceStatus: 'estimated' | 'confirmed';
  balanceAsOf: string;
  paymentsElapsed: number;
  paymentsTotal: number;
  pctPaid: number;
  scheduledPaymentCents: number;
  paymentFrequency: MortgagePaymentFrequency;
  rate: {
    nominalPct: number;
    effectiveAnnualPct: number;
    rateType: MortgageRateType;
    compounding: MortgageCompounding;
    primeRateBps: number | null;
    spreadBps: number | null;
  };
  totalPaidToDateCents: number;
  totalInterestToDateCents: number;
  totalPrincipalToDateCents: number;
  totalInterestOverLifeCents: number;
  /** Provenance of the interest-paid figure: 'actual' = summed from your uploaded
   * statements (through `throughDate`); 'estimated' = modelled from the schedule.
   * Optional so an older/partial backend summary (pre-provenance) degrades to
   * "estimated" instead of crashing the view. */
  paidToDate?: {
    interestSource: 'actual' | 'estimated';
    throughDate: string | null;
    statementsWithInterest: number;
  };
  /** Remaining amortization (months) at the current balance + latest rate. */
  remainingAmortizationMonths: number;
  currentPaymentSplit: { interestCents: number; principalCents: number; interestSharePct: number };
  crossover: { paymentIndex: number; reached: boolean };
  equity: {
    downPaymentCents: number;
    paydownEquityCents: number;
    appreciationEquityCents: number;
    totalEquityCents: number;
    hasAppreciation: boolean;
  };
  /** Forecast to the end of the current term, recomputed on every read from the
   * latest known rate — re-bases automatically when a fresh statement lands. */
  projected: {
    forwardRate: { nominalPct: number; basedOn: 'statement' | 'rate_change' | 'term'; asOfDate: string | null };
    projectionStale: boolean;
    toEndOfTerm: {
      date: string;
      balanceCents: number;
      equityCents: number;
      principalPaidCents: number;
      totalInterestCents: number;
      interestRemainingCents: number;
    };
  };
  currentTerm: { sequence: number; termStartDate: string; maturityDate: string; termMonths: number };
  nextRenewalDate: string;
  daysToRenewal: number;
}

export interface MortgageScheduleRow {
  index: number;
  interest: number;
  principal: number;
  balance: number;
  estimated: boolean;
}

export interface MortgageScheduleView {
  scheduleAvailable: boolean;
  paymentsElapsed: number;
  rows: MortgageScheduleRow[];
}

export interface CreateMortgageRequest {
  nickname: string;
  lender?: string | null;
  productType?: MortgageProductType;
  propertyAddress?: string | null;
  mortgageNumberLast4?: string | null;
  originalPriceCents?: number | null;
  downPaymentCents?: number | null;
  originalPrincipalCents?: number | null;
  originalAmortizationMonths?: number;
  startDate: string;
  currentHomeValueCents?: number | null;
  insurancePremiumCents?: number | null;
  rateType: MortgageRateType;
  compounding: MortgageCompounding;
  nominalRateBps?: number | null;
  primeRateBps?: number | null;
  spreadBps?: number | null;
  termMonths: number;
  paymentFrequency: MortgagePaymentFrequency;
  scheduledPaymentCents?: number | null;
}

export interface UpdateMortgageRequest {
  nickname?: string;
  lender?: string | null;
  propertyAddress?: string | null;
  currentHomeValueCents?: number | null;
  isActive?: boolean;
}

export interface MortgageStatement {
  id: string;
  mortgage_id: string;
  statement_date: string;
  closing_balance_cents: number;
  opening_balance_cents: number | null;
  interest_paid_cents: number | null;
  principal_paid_cents: number | null;
  payment_amount_cents: number | null;
  interest_rate_bps: number | null;
  prime_rate_bps: number | null;
  variance_bps: number | null;
  /** JSON blob (PII-safe) — carries `{ ratePeriods: StoredRatePeriod[] }` when the
   * statement listed a rate breakdown, so the client can detect mid-period changes.
   * Optional so pre-existing fixtures/summaries that omit it still typecheck. */
  raw_extraction_json?: string | null;
  source: string;
  created_at: string;
}

/** A rate sub-period as persisted in `raw_extraction_json` (bps, canonical).
 *  Legacy shape — superseded by the `mortgage_rate_periods` table
 *  ({@link MortgageRatePeriod}); still read as a fallback for statements
 *  captured before migration 0118. */
export interface StoredRatePeriod {
  /** First day the rate applied, `YYYY-MM-DD`. */
  effectiveDate: string;
  rateBps: number;
  primeRateBps: number | null;
  varianceBps: number | null;
}

/**
 * A stored `mortgage_rate_periods` row — one dated interest-rate sub-period read
 * off a statement. This is the canonical rate axis: a variable / HELOC statement
 * lists its interest in sub-periods, so the rate actually paid changes
 * mid-statement and each change carries its own exact effective date.
 */
export interface MortgageRatePeriod {
  id: string;
  mortgage_id: string;
  statement_id: string | null;
  /** First day the rate applied, `YYYY-MM-DD`. */
  effective_date: string;
  period_end: string | null;
  /** 359 = 3.59%. */
  rate_bps: number;
  prime_rate_bps: number | null;
  /** Signed: −86 = prime − 0.86. */
  variance_bps: number | null;
  source: string;
  created_at: string;
}

export interface CreateStatementRequest {
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
  source?: 'manual' | 'camera' | 'gallery' | 'file' | 'google_drive';
  extractionConfidence?: number | null;
  rawExtractionJson?: string | null;
  /** Dated rate sub-periods → `mortgage_rate_periods` rows. Omit to let the
   *  backend derive one period from `interestRateBps`; `[]` clears them. */
  ratePeriods?: Array<{
    effectiveDate: string;
    rateBps: number;
    periodEnd?: string | null;
    primeRateBps?: number | null;
    varianceBps?: number | null;
  }>;
  replace?: boolean;
}

/** AI-extracted, PII-scrubbed statement draft (no full number, no name). */
export interface MortgageStatementDraft {
  lender: string | null;
  productType: MortgageProductType | null;
  hasHelocPortion: boolean;
  mortgageNumberLast4: string | null;
  statementDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  interestPaid: number | null;
  interestCharged: number | null;
  principalPaid: number | null;
  paymentAmount: number | null;
  interestRate: number | null;
  primeRate: number | null;
  variance: number | null;
  /** The statement's per-sub-period rate breakdown (percents), oldest first —
   * where a mid-period rate change (e.g. Oct 30) is read off. */
  ratePeriods: Array<{
    effectiveDate: string;
    interestRate: number;
    primeRate: number | null;
    variance: number | null;
  }>;
  rateType: 'fixed' | 'variable' | null;
  paymentFrequency: string | null;
  propertyTaxPaid: number | null;
  remainingAmortizationMonths: number | null;
  maturityDate: string | null;
  newAdvanceAmount: number | null;
  confidence: number;
}

export interface MortgageOfferView {
  id: string;
  bankName: string;
  offeredRatePct: number;
  rateType: MortgageRateType;
  termMonths: number;
  monthlyPaymentCents: number;
  paymentSavedVsCurrentCents: number;
  status: 'draft' | 'shortlisted' | 'accepted' | 'declined';
  offerExpiresAt: string | null;
  note: string | null;
}

export interface MortgageOffersView {
  incumbentPaymentCents: number;
  offers: MortgageOfferView[];
}

export interface AddOfferRequest {
  bankName: string;
  offeredRateBps: number;
  rateType: MortgageRateType;
  termMonths: number;
  monthlyPaymentCents?: number | null;
  offerExpiresAt?: string | null;
  source?: 'manual' | 'ai';
  note?: string | null;
}

export interface UpdateOfferRequest {
  status?: 'draft' | 'shortlisted' | 'accepted' | 'declined';
  note?: string | null;
  monthlyPaymentCents?: number | null;
}

export interface MortgageWhatIfView {
  acceleratedBiweeklyPaymentCents: number;
  acceleratedYearsToPayoff: number | null;
  lumpSumInterestSavedCents: number | null;
}

export interface RenewMortgageRequest {
  termStartDate: string;
  termMonths: number;
  rateType: MortgageRateType;
  compounding: MortgageCompounding;
  nominalRateBps?: number | null;
  primeRateBps?: number | null;
  spreadBps?: number | null;
  paymentFrequency: MortgagePaymentFrequency;
  scheduledPaymentCents?: number | null;
  amortizationMonthsAtStart?: number;
}

export type MortgageEventType =
  | 'lump_sum_prepayment'
  | 'payment_increase'
  | 'rate_change'
  | 'renewal'
  | 'amortization_change';

export type MortgageEventPolicy = 'keep_payment_shorten' | 'keep_amort_lower_payment';

/** A dated entry in the mortgage's change history (rate/payment change, prepayment, renewal). */
export interface MortgageEvent {
  id: string;
  mortgage_id: string;
  household_id: string;
  event_type: MortgageEventType;
  event_date: string;
  amount_cents: number | null;
  new_rate_bps: number | null;
  new_payment_cents: number | null;
  policy: MortgageEventPolicy | null;
  note: string | null;
  created_at: string;
}

export interface AddEventRequest {
  eventType: MortgageEventType;
  eventDate: string;
  amountCents?: number | null;
  newRateBps?: number | null;
  newPaymentCents?: number | null;
  policy?: MortgageEventPolicy | null;
  note?: string | null;
}

const remoteMortgageApi = {
  list: (householdId: string) =>
    apiClient.get<{ mortgages: MortgageListItem[] }>(base(householdId)).then((res) => res.data),

  /** Full record by id — used by the settings/edit form (raw address + home value). */
  get: (householdId: string, mortgageId: string) =>
    apiClient.get<Mortgage>(`${base(householdId)}/${mortgageId}`).then((res) => res.data),

  create: (householdId: string, data: CreateMortgageRequest) =>
    apiClient.post<Mortgage>(base(householdId), data).then((res) => res.data),

  getSummary: (householdId: string, mortgageId: string) =>
    apiClient.get<MortgageSummary>(`${base(householdId)}/${mortgageId}/summary`).then((res) => res.data),

  getSchedule: (householdId: string, mortgageId: string) =>
    apiClient.get<MortgageScheduleView>(`${base(householdId)}/${mortgageId}/schedule`).then((res) => res.data),

  listTerms: (householdId: string, mortgageId: string) =>
    apiClient.get<{ terms: MortgageTerm[] }>(`${base(householdId)}/${mortgageId}/terms`).then((res) => res.data),

  // ---- Change history (events) ----
  listEvents: (householdId: string, mortgageId: string) =>
    apiClient.get<{ events: MortgageEvent[] }>(`${base(householdId)}/${mortgageId}/events`).then((res) => res.data),

  addEvent: (householdId: string, mortgageId: string, data: AddEventRequest) =>
    apiClient.post<MortgageEvent>(`${base(householdId)}/${mortgageId}/events`, data).then((res) => res.data),

  update: (householdId: string, mortgageId: string, data: UpdateMortgageRequest) =>
    apiClient.patch<Mortgage>(`${base(householdId)}/${mortgageId}`, data).then((res) => res.data),

  remove: (householdId: string, mortgageId: string) =>
    apiClient.delete(`${base(householdId)}/${mortgageId}`),

  // ---- Statements ----
  addStatement: (householdId: string, mortgageId: string, data: CreateStatementRequest) =>
    apiClient
      .post<MortgageStatement>(`${base(householdId)}/${mortgageId}/statements`, data)
      .then((res) => res.data),

  listStatements: (householdId: string, mortgageId: string) =>
    apiClient
      .get<{ statements: MortgageStatement[] }>(`${base(householdId)}/${mortgageId}/statements`)
      .then((res) => res.data),

  deleteStatement: (householdId: string, mortgageId: string, statementId: string) =>
    apiClient.delete(`${base(householdId)}/${mortgageId}/statements/${statementId}`),

  // ---- Rate history (per-statement rate sub-periods) ----
  listRatePeriods: (householdId: string, mortgageId: string) =>
    apiClient
      .get<{ ratePeriods: MortgageRatePeriod[] }>(`${base(householdId)}/${mortgageId}/rate-periods`)
      .then((res) => res.data),

  // ---- AI extraction (statement scan / import) ----
  extractStatement: (householdId: string, mortgageId: string, form: FormData) =>
    apiClient
      .post<{ draft: MortgageStatementDraft }>(`${base(householdId)}/${mortgageId}/statements/extract`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // A vision extraction (upload + model read) routinely runs well past the
        // default 30s API timeout on a phone/large photo — without this axios
        // aborts mid-read and the member sees a spurious "couldn't read" error.
        timeout: 120000,
      })
      .then((res) => res.data),

  // ---- Renewal ----
  renew: (householdId: string, mortgageId: string, data: RenewMortgageRequest) =>
    apiClient.post<MortgageTerm>(`${base(householdId)}/${mortgageId}/renew`, data).then((res) => res.data),

  // ---- Renewal offers + what-if ----
  addOffer: (householdId: string, mortgageId: string, data: AddOfferRequest) =>
    apiClient.post<MortgageOfferView>(`${base(householdId)}/${mortgageId}/offers`, data).then((res) => res.data),

  listOffers: (householdId: string, mortgageId: string) =>
    apiClient.get<MortgageOffersView>(`${base(householdId)}/${mortgageId}/offers`).then((res) => res.data),

  updateOffer: (householdId: string, mortgageId: string, offerId: string, data: UpdateOfferRequest) =>
    apiClient.patch<MortgageOfferView>(`${base(householdId)}/${mortgageId}/offers/${offerId}`, data).then((res) => res.data),

  deleteOffer: (householdId: string, mortgageId: string, offerId: string) =>
    apiClient.delete(`${base(householdId)}/${mortgageId}/offers/${offerId}`),

  getWhatIf: (householdId: string, mortgageId: string, lumpSumCents?: number) =>
    apiClient
      .get<MortgageWhatIfView>(`${base(householdId)}/${mortgageId}/what-if`, {
        params: lumpSumCents ? { lumpSumCents } : undefined,
      })
      .then((res) => res.data),
};

/**
 * Mortgage API facade — routes to the local ledger + on-device amortisation
 * when Budget local-first is on. Statement extract uses the on-device BYOK
 * ladder; renewal offers / what-if remain unsupported offline.
 */
export const mortgageApi: typeof remoteMortgageApi = new Proxy(remoteMortgageApi, {
  get(target, prop, receiver) {
    try {
      const { isBudgetLocalFirst } =
        require('@features/budget/local/flag') as typeof import('@features/budget/local/flag');
      if (isBudgetLocalFirst()) {
        const { localMortgageApi } =
          require('@features/budget/local/mortgage/localMortgageApi') as typeof import('@features/budget/local/mortgage/localMortgageApi');
        const localFn = (localMortgageApi as Record<string | symbol, unknown>)[prop];
        if (typeof localFn === 'function') {
          return localFn.bind(localMortgageApi);
        }
      }
    } catch {
      // Feature not ready — fall through to remote.
    }
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
