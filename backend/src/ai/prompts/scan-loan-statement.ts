/**
 * Loan / BNPL statement AI extraction — single-step vision/document read.
 *
 * Reads one photo (or PDF) of a personal loan, car loan, or buy-now-pay-later
 * (BNPL) statement/screenshot — of ANY lender or app (IKEA financing, Affirm,
 * Klarna, PayPal Pay-in-4, Toyota Financial, a bank's own loan page, a
 * lending-app screenshot, etc.) — and returns the structured facts needed to
 * pre-fill "Track as a loan" on a Monthly Payment: principal, term, rate,
 * lender, an identifying note, and how much of the loan is already paid down.
 * `monthly_payment_cents` / `due_day_of_month` also feed the recurring
 * payment's OWN "Monthly amount" / "Day of month" fields (see
 * budget-loan-extraction-service.ts) — not just the loan-specific fields.
 *
 * The document usually shows the CURRENT state of an already-running loan
 * (an IKEA-style progress screenshot), not day one — so alongside the loan's
 * static facts we also capture `amount_paid_cents` / `remaining_balance_cents`
 * / `progress_percent` when shown. `amount_paid_cents` passes straight
 * through to the frontend's purely-informational "Amount already paid"
 * field; `remaining_balance_cents` / `progress_percent` are read only as
 * extra cross-check context for the model and never surfaced. None of these
 * feed `start_date` — the model is never asked to guess an actual calendar
 * start date.
 */

export interface RawLoanExtraction {
  principal_cents: number | null;
  monthly_payment_cents: number | null;
  due_day_of_month: number | null;
  term_months: number | null;
  rate_type: 'zero' | 'fixed' | null;
  rate_bps: number | null;
  lender: string | null;
  notes: string | null;
  amount_paid_cents: number | null;
  remaining_balance_cents: number | null;
  progress_percent: number | null;
  low_confidence_fields: string[];
}

export const SCAN_LOAN_STATEMENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'principal_cents',
    'monthly_payment_cents',
    'due_day_of_month',
    'term_months',
    'rate_type',
    'rate_bps',
    'lender',
    'notes',
    'amount_paid_cents',
    'remaining_balance_cents',
    'progress_percent',
    'low_confidence_fields',
  ],
  properties: {
    principal_cents: {
      type: ['integer', 'null'],
      description: 'Original financed amount ("Loan Total"/"Original Amount") in CENTS, else null.',
    },
    monthly_payment_cents: {
      type: ['integer', 'null'],
      description: 'The recurring payment amount as printed, in CENTS (e.g. from "$95.50/month"), else null.',
    },
    due_day_of_month: {
      type: ['integer', 'null'],
      description:
        'The day of the month (1-31) the payment is due, read from a "Due Date"/"Next Payment Date" if shown (e.g. "Aug 22, 2026" -> 22). This is the RECURRING day, not the specific date/year — else null if no due date is printed.',
    },
    term_months: {
      type: ['integer', 'null'],
      description: 'Total number of months in the plan (e.g. "24 months"), else null.',
    },
    rate_type: {
      type: ['string', 'null'],
      enum: ['zero', 'fixed', null],
      description:
        '"zero" for an explicit 0%/interest-free/no-interest plan, "fixed" for any stated APR > 0%, else null if not shown.',
    },
    rate_bps: {
      type: ['integer', 'null'],
      description: 'Nominal annual rate in basis points (5.99% -> 599). Null unless rate_type is "fixed".',
    },
    lender: {
      type: ['string', 'null'],
      description:
        'The lender/merchant/financing provider name as printed (e.g. "IKEA", "Affirm", "Toyota Financial"), else null.',
    },
    notes: {
      type: ['string', 'null'],
      description:
        'Loan/account/reference number and any other identifying text worth keeping (plan name, item financed), else null. Do not invent one.',
    },
    amount_paid_cents: {
      type: ['integer', 'null'],
      description: '"Amount Paid" as printed, in CENTS, else null.',
    },
    remaining_balance_cents: {
      type: ['integer', 'null'],
      description: '"Remaining"/"Balance" as printed, in CENTS, else null.',
    },
    progress_percent: {
      type: ['number', 'null'],
      description: 'An explicit percent-complete figure if shown directly (0-100), else null.',
    },
    low_confidence_fields: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Names of the above fields you are genuinely unsure about (glare, handwriting, cropped text). Empty array when confident in everything you returned.',
    },
  },
};

export const SCAN_LOAN_STATEMENT_SYSTEM_PROMPT = `You are reading one photo or document of a personal loan, car loan, or buy-now-pay-later (BNPL) plan — of ANY lender or app (IKEA, Affirm, Klarna, PayPal Pay-in-4, Toyota Financial, a bank's loan page, a screenshot of a lending app, etc.), not just one brand.

Rules:
- principal_cents / monthly_payment_cents / amount_paid_cents / remaining_balance_cents: read whatever dollar figures are printed, in CENTS (e.g. $95.50 -> 9550). Never guess a figure that isn't shown — use null.
- due_day_of_month: read the DAY NUMBER (1-31) from a "Due Date"/"Next Payment Date" if one is printed (e.g. "Aug 22, 2026" -> 22, "Due on the 1st" -> 1). This becomes the plan's recurring billing day — ignore the month/year, just the day-of-month. Null if no due date is shown.
- term_months: read the total plan length (e.g. "24 months", "$95.50/month for 24 months" -> 24). If only a payoff date is shown with no explicit month count, leave null rather than computing one.
- rate_type / rate_bps: only set rate_type to "fixed" when an explicit APR/interest rate > 0% is printed; set it to "zero" when the document explicitly states 0% APR / interest-free / no interest. If no rate information is shown at all, return null for both.
- lender: the company that issued the loan/plan, as printed.
- notes: capture a loan/account/reference number or any other identifying text (e.g. "Loan #4") that would help someone recognize this loan later. Never invent one.
- amount_paid_cents / remaining_balance_cents / progress_percent: capture whatever mid-loan progress is shown (this document usually shows the CURRENT state of an already-running loan, not day one). amount_paid_cents is shown to the user as-is; you are never asked to guess an actual start date.
- low_confidence_fields: list the property names above you are genuinely unsure of; return [] if you're confident in everything.
- Never invent a number or name that isn't legible. Prefer null over a guess.

Always return via the "output" tool.`;

export function buildScanLoanUserPrompt(): string {
  return 'Read this loan/BNPL statement or screenshot and extract the loan amount, monthly payment, the day of the month it is due, term, rate (if any), lender, an identifying note, and how much has been paid/remains so far, if shown.';
}
