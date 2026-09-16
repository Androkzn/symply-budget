import { api, apiClient } from './client';

/**
 * Loan tracking for one Monthly-Payments item (Savings → Monthly,
 * Budget-only). Base path:
 * `/households/:householdId/savings/recurring-payments/:paymentId/loan`,
 * served by `backend/src/routes/savings.ts` (delegates to
 * `BudgetLoanService`). Envelopes MUST match that file EXACTLY.
 *
 * Every derived figure (payments remaining, interest paid to date, total
 * interest over the life of the loan) is server-computed and returned as
 * `summary` — never recompute amortization math on the client.
 */

export type LoanRateType = 'zero' | 'fixed';

export interface BudgetLoan {
  id: string;
  household_id: string;
  recurring_payment_id: string;
  loan_kind: 'installment';
  rate_type: LoanRateType;
  rate_bps: number;
  principal_cents: number;
  term_months: number;
  start_date: string;
  lender: string | null;
  notes: string | null;
  portal_url: string | null;
  /** Purely informational — never used to derive `start_date` or `summary`. */
  amount_paid_cents: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoanSummary {
  termMonths: number;
  elapsedMonths: number;
  paymentsRemaining: number;
  currentBalanceCents: number;
  interestPaidToDateCents: number;
  totalInterestCents: number;
  totalCostCents: number;
  payoffDate: string;
}

export interface UpsertLoanRequest {
  rate_type?: LoanRateType;
  rate_bps?: number;
  principal_cents: number;
  term_months: number;
  start_date: string;
  lender?: string | null;
  notes?: string | null;
  portal_url?: string | null;
  amount_paid_cents?: number | null;
}

/**
 * AI-extracted draft from a photographed/uploaded loan statement — only what
 * `LoanInfoSection`'s form can actually pre-fill for review. Nothing here is
 * auto-saved; the member still presses Save after reviewing the draft.
 * `monthlyPaymentCents` / `dueDayOfMonth` feed the recurring payment's OWN
 * "Monthly amount" / "Day of month" fields, one level up from the
 * loan-specific fields below them — see `SavingsRecurringPaymentsScreen`'s
 * `onExtractedPayment` wiring on `LoanDraftSection`/`LoanInfoSection`.
 */
export interface LoanExtractionDraft {
  principal_cents: number | null;
  monthlyPaymentCents: number | null;
  dueDayOfMonth: number | null;
  term_months: number | null;
  rate_type: 'zero' | 'fixed' | null;
  rate_bps: number | null;
  lender: string | null;
  notes: string | null;
  amountPaidCents: number | null;
  lowConfidenceFields: string[];
}

/**
 * One row of a tracked loan's amortization schedule — cents, same
 * `{index, interest, principal, balance}` shape as the mortgage engine's
 * `MortgageScheduleRow` (minus `estimated`, which a fixed installment plan
 * has no use for) so the mortgage Payments tab's pure bucketing/charting
 * helpers (`src/screens/budget/mortgage/paymentsInsights.ts`) work unchanged
 * against it — see `LoanPaymentInsights.tsx`.
 */
export interface LoanScheduleRow {
  index: number;
  interest: number;
  principal: number;
  balance: number;
}

export interface LoanScheduleView {
  paymentsElapsed: number;
  rows: LoanScheduleRow[];
}

const base = (householdId: string, paymentId: string) =>
  `/households/${householdId}/savings/recurring-payments/${paymentId}/loan`;

const remoteBudgetLoansApi = {
  get: (householdId: string, paymentId: string) =>
    apiClient
      .get<{ loan: BudgetLoan | null; summary: LoanSummary | null }>(base(householdId, paymentId))
      .then((r) => r.data),

  /** Full amortization schedule for the chart cards in `LoanPaymentInsights`. */
  getSchedule: (householdId: string, paymentId: string) =>
    apiClient.get<LoanScheduleView>(`${base(householdId, paymentId)}/schedule`).then((r) => r.data),

  upsert: (householdId: string, paymentId: string, body: UpsertLoanRequest) =>
    apiClient
      .put<{ loan: BudgetLoan; summary: LoanSummary }>(base(householdId, paymentId), body)
      .then((r) => r.data),

  remove: (householdId: string, paymentId: string) =>
    apiClient.delete<{ success: boolean }>(base(householdId, paymentId)).then((r) => r.data),

  /**
   * "Fill with AI" — photograph/upload a loan statement, get back a draft to
   * review (nothing is auto-saved). `api.upload` already sets a 120s timeout
   * and the multipart content-type for every upload, so neither needs to be
   * set here (mirrors `mortgageApi.extractStatement`'s AI-upload convention).
   */
  extract: (householdId: string, paymentId: string, form: FormData) =>
    api.upload<{ draft: LoanExtractionDraft }>(`${base(householdId, paymentId)}/extract`, form),

  /**
   * "Fill with AI" for the Add-payment DRAFT flow — loan tracking is turned
   * on and a statement uploaded BEFORE the recurring payment itself is ever
   * saved, so there's no `paymentId` yet to scope `extract` to. Same draft
   * shape, same upload conventions (120s timeout + multipart content-type
   * from `api.upload`), just a household-scoped path instead of a
   * payment-scoped one.
   */
  extractDraft: (householdId: string, form: FormData) =>
    api.upload<{ draft: LoanExtractionDraft }>(
      `/households/${householdId}/savings/recurring-payments/loan-extract-draft`,
      form
    ),
};

/**
 * Budget loans API facade — routes to the local ledger + on-device
 * amortisation when Budget local-first is on. AI extract remains unsupported
 * offline (`BudgetLocalUnsupportedError`).
 */
export const budgetLoansApi: typeof remoteBudgetLoansApi = new Proxy(remoteBudgetLoansApi, {
  get(target, prop, receiver) {
    try {
      const { isBudgetLocalFirst } =
        require('@features/budget/local/flag') as typeof import('@features/budget/local/flag');
      if (isBudgetLocalFirst()) {
        const { localBudgetLoansApi } =
          require('@features/budget/local/loans/localBudgetLoansApi') as typeof import('@features/budget/local/loans/localBudgetLoansApi');
        const localFn = (localBudgetLoansApi as Record<string | symbol, unknown>)[prop];
        if (typeof localFn === 'function') {
          return localFn.bind(localBudgetLoansApi);
        }
      }
    } catch {
      // Feature not ready — fall through to remote.
    }
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

export default budgetLoansApi;
