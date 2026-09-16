import type {
  BudgetLoan,
  LoanScheduleView,
  UpsertLoanRequest,
} from '@api/budgetLoans';
import {
  buildInstallmentLoanSchedule,
  computeInstallmentLoanSummary,
  elapsedMonths,
  type LoanSummary,
} from '@features/budget/loan-amortization';
import { levelPayment, periodicRate } from '@features/mortgage/amortization';

import {
  getLocalLedgerFor,
  mutateLocalLedger,
  runOnHousehold,
  type LocalBudgetLedger,
} from '../engine';
import { BudgetLocalUnsupportedError } from '../errors';
import { isoNow, newLocalId } from '../ids';

/*
 * Loan WRITES run through the engine's `runOnHousehold(id, work)`, which
 * activates the named household first (BR-016 B5).
 *
 * `mutateLocalLedger` is bound to the ACTIVE session by design — the engine
 * deliberately gave it no `forHouseholdId` — so a call naming another household
 * has exactly two honest outcomes: move the session, or refuse. Writing anyway
 * would attach household B's loan to household A's ledger, sealed correctly
 * under A's HDK and therefore invisible to every integrity check the engine has;
 * worse, a loan row points at a `recurring_payment_id`, so the orphan would land
 * next to a monthly payment that does not exist in A and quietly corrupt A's
 * Monthly-Payments screen as well.
 *
 * It replaced `assertHousehold`, which threw on every such call. That was the
 * right answer while a device could hold only one household and became a wall
 * the moment it could hold two: anything naming a non-active household died with
 * "Loan household mismatch for local ledger" rather than doing the obvious
 * thing. Activating is what the member meant — they addressed that household.
 * The refusal half survives inside `runOnHousehold`, which raises
 * `BudgetLocalUnknownHouseholdError` for an id this device holds no ledger for.
 *
 * It also replaced this file's private copy of the helper, which activated on the
 * engine's session chain but ran the write off it — so a loan write and any
 * sibling facade's write for a second household could interleave, and the loan
 * would follow whichever household the sibling activated.
 *
 * READS deliberately do NOT come through it — they take
 * `getLocalLedgerFor(householdId)`, which hydrates that household on demand and
 * answers from its own rows without moving the session.
 */

/**
 * Every lookup takes the ledger it is to read rather than reaching for the
 * active one. Under a single household those were the same object; under BR-016
 * they are not, and a helper that quietly read the active ledger would answer a
 * background household's question with the wrong household's loan — the exact
 * bleed the `household_id` filter below only *looks* like it prevents.
 */
function findLoan(
  source: LocalBudgetLedger,
  householdId: string,
  recurringPaymentId: string,
): BudgetLoan | null {
  return (
    (source.budgetLoans ?? []).find(
      (loan) =>
        loan.household_id === householdId && loan.recurring_payment_id === recurringPaymentId,
    ) ?? null
  );
}

function findRecurringPayment(
  source: LocalBudgetLedger,
  householdId: string,
  recurringPaymentId: string,
) {
  return (source.savingsRecurringPayments ?? []).find(
    (payment) => payment.id === recurringPaymentId && payment.household_id === householdId,
  );
}

function requireRecurringPayment(
  source: LocalBudgetLedger,
  householdId: string,
  recurringPaymentId: string,
) {
  const payment = findRecurringPayment(source, householdId, recurringPaymentId);
  if (!payment) throw new Error('Monthly payment not found');
  return payment;
}

function principalDerivedPaymentCents(loan: BudgetLoan): number {
  const i =
    loan.rate_type === 'zero'
      ? 0
      : periodicRate(loan.rate_bps / 10_000, 12, 'monthly');
  return Math.round(levelPayment(loan.principal_cents, i, loan.term_months));
}

/**
 * The linked monthly payment is looked up in the ledger the loan came from, not
 * in the active one. `loan.household_id` alone was enough to *filter* correctly
 * while every ledger held one household; it never selected the ledger, and under
 * BR-016 a summary for a background household would have silently fallen through
 * to `principalDerivedPaymentCents` — a plausible-looking number that is not the
 * member's actual payment.
 */
function resolvePaymentCents(source: LocalBudgetLedger, loan: BudgetLoan): number {
  const payment = findRecurringPayment(source, loan.household_id, loan.recurring_payment_id);
  return payment?.amount_cents ?? principalDerivedPaymentCents(loan);
}

function summarize(source: LocalBudgetLedger, loan: BudgetLoan): LoanSummary {
  return computeInstallmentLoanSummary({
    principalCents: loan.principal_cents,
    rateType: loan.rate_type,
    rateBps: loan.rate_bps,
    termMonths: loan.term_months,
    startDate: loan.start_date,
    paymentCents: resolvePaymentCents(source, loan),
  });
}

export const localBudgetLoansApi = {
  get: async (householdId: string, paymentId: string) => {
    const source = await getLocalLedgerFor(householdId);
    const loan = findLoan(source, householdId, paymentId);
    if (!loan) return { loan: null, summary: null };
    return { loan, summary: summarize(source, loan) };
  },

  getSchedule: async (householdId: string, paymentId: string): Promise<LoanScheduleView> => {
    const source = await getLocalLedgerFor(householdId);
    const loan = findLoan(source, householdId, paymentId);
    if (!loan) throw new Error('Loan not found');

    const paymentCents = resolvePaymentCents(source, loan);
    const paymentsElapsed = Math.min(loan.term_months, elapsedMonths(loan.start_date, new Date()));
    const rows = buildInstallmentLoanSchedule({
      principalCents: loan.principal_cents,
      rateType: loan.rate_type,
      rateBps: loan.rate_bps,
      termMonths: loan.term_months,
      startDate: loan.start_date,
      paymentCents,
    });

    return { paymentsElapsed, rows };
  },

  upsert: async (householdId: string, paymentId: string, input: UpsertLoanRequest) =>
    runOnHousehold(householdId, async () => {
      // Resolved AFTER the activation, so `memberId` and the linked payment both
      // come from the household this loan is being written into rather than from
      // the one it left behind.
      const source = await getLocalLedgerFor(householdId);
      requireRecurringPayment(source, householdId, paymentId);

      if (input.principal_cents <= 0) {
        throw new Error('Loan principal must be greater than $0');
      }
      if (input.term_months <= 0) {
        throw new Error('Loan term must be at least 1 month');
      }

      const rateType = input.rate_type ?? 'fixed';
      if (rateType === 'fixed' && (input.rate_bps ?? 0) <= 0) {
        throw new Error('Enter an interest rate, or switch to 0% APR');
      }
      const rateBps = rateType === 'zero' ? 0 : (input.rate_bps ?? 0);

      const existing = findLoan(source, householdId, paymentId);
      const now = isoNow();
      const id = existing?.id ?? newLocalId('budget_loan');
      const memberId = source.memberId;

      const loan: BudgetLoan = {
        id,
        household_id: householdId,
        recurring_payment_id: paymentId,
        loan_kind: 'installment',
        rate_type: rateType,
        rate_bps: rateBps,
        principal_cents: input.principal_cents,
        term_months: input.term_months,
        start_date: input.start_date,
        lender: input.lender ?? existing?.lender ?? null,
        notes: input.notes ?? existing?.notes ?? null,
        portal_url: input.portal_url !== undefined ? input.portal_url : (existing?.portal_url ?? null),
        amount_paid_cents:
          input.amount_paid_cents !== undefined
            ? input.amount_paid_cents
            : (existing?.amount_paid_cents ?? null),
        created_by: existing?.created_by ?? memberId,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };

      const next = await mutateLocalLedger(
        (ledger) => {
          const loans = ledger.budgetLoans ?? [];
          if (existing) {
            ledger.budgetLoans = loans.map((row) => (row.id === id ? loan : row));
          } else {
            ledger.budgetLoans = [...loans, loan];
          }
        },
        {
          opType: existing ? 'BUDGET_LOAN_UPDATE' : 'BUDGET_LOAN_CREATE',
          entityType: 'budget_loan',
          entityId: id,
          payload: loan,
        },
      );

      return { loan, summary: summarize(next, loan) };
    }),

  remove: async (householdId: string, paymentId: string) =>
    runOnHousehold(householdId, async () => {
      const existing = findLoan(await getLocalLedgerFor(householdId), householdId, paymentId);
      if (!existing) return { success: false };

      await mutateLocalLedger(
        (ledger) => {
          ledger.budgetLoans = (ledger.budgetLoans ?? []).filter((row) => row.id !== existing.id);
        },
        {
          opType: 'BUDGET_LOAN_DELETE',
          entityType: 'budget_loan',
          entityId: existing.id,
          payload: { id: existing.id, recurring_payment_id: paymentId },
        },
      );

      return { success: true };
    }),

  extract: async (_householdId: string, _paymentId: string, _form: FormData) => {
    throw new BudgetLocalUnsupportedError('budgetLoansApi.extract');
  },

  extractDraft: async (_householdId: string, _form: FormData) => {
    throw new BudgetLocalUnsupportedError('budgetLoansApi.extractDraft');
  },
};
