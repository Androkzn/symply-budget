import { and, eq } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import { householdMembers } from '../db/schema';
import { budgetLoans, type BudgetLoan } from '../db/schema-budget-loans';
import { savingsRecurringPayments } from '../db/schema-savings';
import type { Env } from '../types';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { generateId, nowIso } from '../utils/id';

import {
  computeInstallmentLoanSummary,
  buildInstallmentLoanSchedule,
  elapsedMonths,
  type LoanSummary,
} from './budget/loan-amortization';

/**
 * Loan tracking for one Monthly-Payments item (Savings → Monthly). A
 * household opts a `savings_recurring_payments` row into tracking a loan —
 * car loan, BNPL plan (IKEA-style), personal loan: principal, rate (0% or
 * fixed), term in months, start date. Every derived figure (payments
 * remaining, interest paid to date, total interest over the life of the
 * loan) is computed on read via `computeInstallmentLoanSummary`, anchored to
 * the recurring payment's own `amount_cents` — never a second, possibly-
 * stale copy of the payment amount.
 *
 * Household-scoped (not user-scoped) — mirrors `BudgetRenewalService`'s
 * shape, minus the document-attachment lifecycle a loan doesn't need.
 */

export type LoanKind = 'installment';
export type LoanRateType = 'zero' | 'fixed';

export interface UpsertLoanInput {
  rate_type?: LoanRateType;
  rate_bps?: number;
  principal_cents: number;
  term_months: number;
  start_date: string;
  lender?: string | null;
  notes?: string | null;
  portal_url?: string | null;
  /** Purely informational — never used to derive `start_date` or the summary. */
  amount_paid_cents?: number | null;
}

export interface LoanWithSummary {
  loan: BudgetLoan;
  summary: LoanSummary;
}

/** One payment's schedule row (cents) — index is 1-based. */
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

export class BudgetLoanService {
  private db: DrizzleD1Database;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1);
  }

  private async assertHouseholdMember(householdId: string, userId: string): Promise<void> {
    const member = await this.db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, userId)))
      .get();
    if (!member) throw new ForbiddenError('You do not have access to this household');
  }

  /** Validates the recurring payment belongs to this household; returns its current amount. */
  private async assertRecurringPayment(
    householdId: string,
    recurringPaymentId: string
  ): Promise<{ label: string; amountCents: number }> {
    const payment = await this.db
      .select({
        id: savingsRecurringPayments.id,
        label: savingsRecurringPayments.label,
        amount_cents: savingsRecurringPayments.amount_cents,
      })
      .from(savingsRecurringPayments)
      .where(
        and(
          eq(savingsRecurringPayments.id, recurringPaymentId),
          eq(savingsRecurringPayments.household_id, householdId)
        )
      )
      .get();
    if (!payment) throw new NotFoundError('Monthly payment not found');
    return { label: payment.label, amountCents: payment.amount_cents };
  }

  private async getLoanRow(householdId: string, recurringPaymentId: string): Promise<BudgetLoan | null> {
    return (
      (await this.db
        .select()
        .from(budgetLoans)
        .where(
          and(eq(budgetLoans.household_id, householdId), eq(budgetLoans.recurring_payment_id, recurringPaymentId))
        )
        .get()) ?? null
    );
  }

  private summarize(loan: BudgetLoan, paymentCents: number): LoanSummary {
    return computeInstallmentLoanSummary({
      principalCents: loan.principal_cents,
      rateType: loan.rate_type as LoanRateType,
      rateBps: loan.rate_bps,
      termMonths: loan.term_months,
      startDate: loan.start_date,
      paymentCents,
    });
  }

  /**
   * Confirms `userId` belongs to `householdId` AND that `recurringPaymentId`
   * resolves within THAT household — without requiring a loan row to already
   * exist. Used by the "Fill with AI" extract route so an invalid/foreign id
   * 404s before an AI call is spent on it (throws ForbiddenError/NotFoundError,
   * same as every other loan route's IDOR guard).
   */
  async assertPaymentAccess(householdId: string, userId: string, recurringPaymentId: string): Promise<void> {
    await this.assertHouseholdMember(householdId, userId);
    await this.assertRecurringPayment(householdId, recurringPaymentId);
  }

  /**
   * Confirms `userId` belongs to `householdId` — no recurring-payment/loan
   * row required. Used by the "Fill with AI" DRAFT-extract route, where loan
   * tracking is turned on and a statement is uploaded before the recurring
   * payment itself has ever been saved (so no `recurring_payment_id` exists
   * yet to check). Same household leg `assertPaymentAccess` uses, minus the
   * payment lookup.
   */
  async assertHouseholdAccess(householdId: string, userId: string): Promise<void> {
    await this.assertHouseholdMember(householdId, userId);
  }

  async getLoan(
    householdId: string,
    userId: string,
    recurringPaymentId: string
  ): Promise<{ loan: BudgetLoan | null; summary: LoanSummary | null }> {
    await this.assertHouseholdMember(householdId, userId);
    const loan = await this.getLoanRow(householdId, recurringPaymentId);
    if (!loan) return { loan: null, summary: null };

    const { amountCents } = await this.assertRecurringPayment(householdId, recurringPaymentId);
    return { loan, summary: this.summarize(loan, amountCents) };
  }

  /**
   * Full payment-by-payment schedule for a tracked loan — backs the Savings →
   * Monthly payment detail sheet's loan payoff charts. Unlike the mortgage
   * equivalent, no `scheduleAvailable` flag is needed: a tracked loan's
   * rate/principal/term are always present and validated at `upsertLoan` time.
   * Same IDOR/NotFoundError behavior as `getLoan`, except a missing loan row
   * 404s here (there is no "not tracked" state to render — the caller only
   * asks for a schedule once loan tracking is already on).
   */
  async getSchedule(
    householdId: string,
    userId: string,
    recurringPaymentId: string
  ): Promise<LoanScheduleView> {
    await this.assertHouseholdMember(householdId, userId);
    const loan = await this.getLoanRow(householdId, recurringPaymentId);
    if (!loan) throw new NotFoundError('Loan');

    const { amountCents } = await this.assertRecurringPayment(householdId, recurringPaymentId);

    const paymentsElapsed = Math.min(loan.term_months, elapsedMonths(loan.start_date, new Date()));
    const rows = buildInstallmentLoanSchedule({
      principalCents: loan.principal_cents,
      rateType: loan.rate_type as LoanRateType,
      rateBps: loan.rate_bps,
      termMonths: loan.term_months,
      startDate: loan.start_date,
      paymentCents: amountCents,
    });

    return { paymentsElapsed, rows };
  }

  async upsertLoan(
    householdId: string,
    userId: string,
    recurringPaymentId: string,
    input: UpsertLoanInput
  ): Promise<LoanWithSummary> {
    await this.assertHouseholdMember(householdId, userId);
    const { amountCents } = await this.assertRecurringPayment(householdId, recurringPaymentId);

    if (input.principal_cents <= 0) {
      throw new ValidationError('Loan principal must be greater than $0');
    }
    if (input.term_months <= 0) {
      throw new ValidationError('Loan term must be at least 1 month');
    }

    const rateType = input.rate_type ?? 'fixed';
    if (rateType === 'fixed' && (input.rate_bps ?? 0) <= 0) {
      throw new ValidationError('Enter an interest rate, or switch to 0% APR');
    }
    const rateBps = rateType === 'zero' ? 0 : (input.rate_bps ?? 0);

    const existing = await this.getLoanRow(householdId, recurringPaymentId);
    const ts = nowIso();
    const id = existing?.id ?? generateId();

    const row: typeof budgetLoans.$inferInsert = {
      id,
      household_id: householdId,
      recurring_payment_id: recurringPaymentId,
      loan_kind: 'installment',
      rate_type: rateType,
      rate_bps: rateBps,
      principal_cents: input.principal_cents,
      term_months: input.term_months,
      start_date: input.start_date,
      lender: input.lender ?? existing?.lender ?? null,
      notes: input.notes ?? existing?.notes ?? null,
      // Distinguish "omitted" (preserve) from an explicit `null` (clear) —
      // `??` alone can't tell those apart, so portal_url/amount_paid_cents
      // check `undefined` explicitly. See report deviation note: lender/notes
      // above keep the pre-existing `??` shorthand (unchanged behavior, not
      // in scope here).
      portal_url: input.portal_url !== undefined ? input.portal_url : (existing?.portal_url ?? null),
      amount_paid_cents:
        input.amount_paid_cents !== undefined
          ? input.amount_paid_cents
          : (existing?.amount_paid_cents ?? null),
      created_by: existing?.created_by ?? userId,
      created_at: existing?.created_at ?? ts,
      updated_at: ts,
    };

    if (existing) {
      await this.db.update(budgetLoans).set(row).where(eq(budgetLoans.id, id)).run();
    } else {
      await this.db.insert(budgetLoans).values(row).run();
    }

    const loan = row as BudgetLoan;
    return { loan, summary: this.summarize(loan, amountCents) };
  }

  async deleteLoan(householdId: string, userId: string, recurringPaymentId: string): Promise<boolean> {
    await this.assertHouseholdMember(householdId, userId);
    const existing = await this.getLoanRow(householdId, recurringPaymentId);
    if (!existing) return false;

    await this.db.delete(budgetLoans).where(eq(budgetLoans.id, existing.id)).run();
    return true;
  }
}
