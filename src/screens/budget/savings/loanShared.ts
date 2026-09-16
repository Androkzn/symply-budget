import type { LoanRateType, UpsertLoanRequest } from '@api/budgetLoans';
import type { SavingsRecurringPayment } from '@api/savings';

/**
 * Pure helpers + validation shared by `LoanInfoSection` (attached to a saved
 * recurring payment) and `LoanDraftSection` (Add-payment flow, before the
 * payment exists). Neither component re-derives these — they import from
 * here so the two forms can never quietly drift apart.
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const LOAN_STATEMENT_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

export interface LoanAttachment {
  uri: string;
  name: string;
  type: string;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function centsToDollarsInput(cents: number): string {
  return (cents / 100).toString();
}

export function toCents(dollars: string): number | null {
  const cleaned = dollars.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

export function bpsToPctInput(bps: number): string {
  return bps === 0 ? '' : (bps / 100).toString();
}

/**
 * Best-effort `startDate` suggestion for a "Fill with AI" draft of an
 * ALREADY-RUNNING loan/BNPL plan. The AI extraction never guesses a calendar
 * start date directly (see backend `scan-loan-statement.ts`) — both
 * `LoanDraftSection` and `LoanInfoSection` otherwise leave `startDate` at
 * `todayIso()`, which makes the loan read as 0 payments made even when the
 * SAME draft also filled in a real "Amount already paid". When the statement
 * gave us both an amount paid and a monthly payment, we can back into how
 * many payments have already happened (`amountPaidCents / monthlyPaymentCents`,
 * rounded) and set `startDate` that many months back — still just a prefill,
 * `onStartDateChange` stays free to correct it. Returns null when there
 * isn't enough signal (nothing paid yet, or no monthly payment to divide
 * by) — the caller leaves `startDate` at today, correct for a loan that
 * really does start today.
 */
export function estimateStartDateFromProgress(
  amountPaidCents: number | null,
  monthlyPaymentCents: number | null,
  termMonths: number | null,
  today: Date = new Date()
): string | null {
  if (amountPaidCents == null || amountPaidCents <= 0) return null;
  if (monthlyPaymentCents == null || monthlyPaymentCents <= 0) return null;

  let monthsPaid = Math.round(amountPaidCents / monthlyPaymentCents);
  if (termMonths != null && termMonths > 0) {
    // A statement exists to scan, so the loan is still running — never let
    // the estimate reach or pass the final payment.
    monthsPaid = Math.min(monthsPaid, termMonths - 1);
  }
  if (monthsPaid <= 0) return null;

  const target = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  target.setUTCMonth(target.getUTCMonth() - monthsPaid);
  return target.toISOString().slice(0, 10);
}

/**
 * The tracked-loan summary to render as a row's mini progress card — absent
 * once fully paid off. Shared by `SavingsRecurringPaymentsScreen` (the
 * "Manage" list) and `SavingsMonthlyView` (the Savings tab's own Monthly
 * list) so a loan's payments-left/progress bar reads the same in both places.
 */
export function loanCardInfo(
  summary: SavingsRecurringPayment['loan_summary']
): NonNullable<SavingsRecurringPayment['loan_summary']> | null {
  if (!summary || summary.paymentsRemaining <= 0) return null;
  return summary;
}

export function toBps(pct: string): number | null {
  const cleaned = pct.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

/** Infers a MIME type from a filename when the picker doesn't supply one. */
export function inferLoanStatementMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

export interface LoanFieldsSnapshot {
  rateType: LoanRateType;
  ratePct: string;
  principal: string;
  termMonths: string;
  startDate: string;
  /** Purely informational — never used to derive `startDate`. Optional/blank is fine. */
  amountAlreadyPaid: string;
  lender: string;
  notes: string;
  portalUrl: string;
}

export type LoanFieldsValidation =
  | { valid: true; payload: UpsertLoanRequest }
  | { valid: false; title: string; message: string };

/**
 * Validates the "track a loan" fields and builds the `UpsertLoanRequest`
 * payload — the exact rules `LoanInfoSection.handleSave` always enforced
 * (explicit start date, principal, term, rate-when-fixed, portal_url, amount
 * already paid), now shared so `LoanDraftSection`'s pre-save check can't
 * drift from the attached-payment flow's Save button.
 */
export function validateLoanFields(fields: LoanFieldsSnapshot): LoanFieldsValidation {
  const term = Number.parseInt(fields.termMonths, 10);

  if (!DATE_RE.test(fields.startDate)) {
    return { valid: false, title: 'Invalid date', message: 'Enter the loan start date as YYYY-MM-DD.' };
  }

  const trimmedAmountAlreadyPaid = fields.amountAlreadyPaid.trim();
  let amountPaidCents: number | null = null;
  if (trimmedAmountAlreadyPaid) {
    amountPaidCents = toCents(trimmedAmountAlreadyPaid);
    if (amountPaidCents == null || amountPaidCents < 0) {
      return {
        valid: false,
        title: 'Invalid entry',
        message: 'Enter the amount already paid, or leave it blank.',
      };
    }
  }

  const principalCents = toCents(fields.principal);
  if (principalCents == null || principalCents <= 0) {
    return { valid: false, title: 'Missing principal', message: 'Enter the original loan amount.' };
  }
  if (!Number.isFinite(term) || term <= 0) {
    return { valid: false, title: 'Missing term', message: 'Enter how many months the loan runs for.' };
  }
  const rateBps = fields.rateType === 'zero' ? 0 : toBps(fields.ratePct);
  if (fields.rateType === 'fixed' && (rateBps == null || rateBps <= 0)) {
    return { valid: false, title: 'Missing rate', message: 'Enter an interest rate, or switch to 0% APR.' };
  }
  const trimmedPortalUrl = fields.portalUrl.trim();
  if (trimmedPortalUrl) {
    try {
      // eslint-disable-next-line no-new -- validating; the URL is otherwise unused here.
      new URL(trimmedPortalUrl);
    } catch {
      return { valid: false, title: 'Invalid link', message: 'Enter a valid web address, or leave it blank.' };
    }
  }

  return {
    valid: true,
    payload: {
      rate_type: fields.rateType,
      rate_bps: rateBps ?? 0,
      principal_cents: principalCents,
      term_months: term,
      start_date: fields.startDate,
      lender: fields.lender.trim() || null,
      notes: fields.notes.trim() || null,
      portal_url: trimmedPortalUrl || null,
      amount_paid_cents: amountPaidCents,
    },
  };
}
