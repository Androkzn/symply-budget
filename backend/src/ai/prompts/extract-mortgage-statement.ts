/**
 * AI prompt for extracting a Canadian mortgage statement into a reviewable draft.
 * Mirrors extract-registered-statement.ts. Hardened against the real-doc findings
 * (implementation plan §6.3): balance disambiguation for combined FlexLine/STEP
 * products, interest-paid-vs-charged, payment-frequency inference, prime ± variance,
 * and — critically — PII OMISSION (no full account number, no borrower name).
 *
 * The prompt instruction is defense-in-depth only; the deterministic control is
 * `normalizeMortgageDraft` in services/mortgage/statement-normalize.ts.
 */

import type { RawMortgageStatement } from '../../services/mortgage/statement-normalize';

export type { RawMortgageStatement };

export const EXTRACT_MORTGAGE_STATEMENT_SYSTEM_PROMPT = `You extract structured data from a Canadian residential mortgage statement (TD, RBC, Scotiabank, BMO, CIBC, National Bank, etc.). Return ONE JSON object, no prose.

CRITICAL — PRIVACY: NEVER output the full mortgage/account number and NEVER output any borrower/customer name. If an account number is visible, output ONLY its last 4 digits in "mortgage_number_last4". Omit names entirely.

CRITICAL — BALANCE DISAMBIGUATION: many statements are combined "readvanceable" products (TD Home Equity FlexLine, Scotia STEP) with a revolving line of credit PLUS a Term Portion. The mortgage balance you want is the TERM PORTION "Closing Principal Balance" — NOT "Plan Limit", "Credit Limit", "Available Credit", or the revolving/HELOC balance. Set "product_type" to "heloc_flexline" or "step" for these, and "has_heloc_portion": true.

Extract these fields (use null when absent — do NOT guess original amount or original amortization; they are rarely on a statement):
- lender (e.g. "TD")
- product_type: "standard" | "heloc_flexline" | "step"
- has_heloc_portion (boolean)
- mortgage_number_last4 (last 4 digits ONLY)
- statement_date, period_start, period_end (YYYY-MM-DD)
- opening_balance, closing_balance (Term Portion; numbers, no currency symbols)
- interest_paid: the "Total Interest Paid" (the reconciliation truth)
- interest_charged: the "Interest for the statement period" if shown separately (it may differ from interest_paid due to payment-frequency timing)
- principal_paid, payment_amount
- interest_rate (annual %, e.g. 4.09), rate_type: "fixed" | "variable"
- prime_rate (% if a variable product shows TD/RBC Prime), variance (signed %, e.g. -0.86 for "Prime − 0.86")
- rate_periods: an ARRAY capturing the TERM PORTION "Interest for the statement period" breakdown — one entry per sub-period the statement lists. A variable statement often shows the rate CHANGING mid-period (e.g. "Oct 01 - Oct 29 … 3.840" then "Oct 30 - Oct 31 … 3.590"): return BOTH rows. For each: { effective_date (YYYY-MM-DD — the FIRST day of that sub-period, e.g. "Oct 30 - Oct 31" ⇒ 2025-10-30), prime_rate (%), variance (signed %), interest_rate (the Annual Variable/Fixed Interest Rate %) }. Use the TERM PORTION table (the one with the interest actually charged on the mortgage), NOT the revolving/HELOC portion. When the rate held flat all period, return the single row. Set interest_rate/prime_rate/variance (above) to the LAST (most recent) sub-period's values.
- payment_frequency: infer from the spacing of the listed payment due dates when not named (e.g. two dates 14 days apart ⇒ "biweekly"; two per month ⇒ "semi_monthly"; else "monthly")
- property_tax_paid
- remaining_amortization (verbatim string, e.g. "11 Years 06 Months")
- maturity_date (YYYY-MM-DD)
- new_advance_amount (only on an origination statement where opening balance is 0)
- confidence (0..1)`;

export const EXTRACT_MORTGAGE_STATEMENT_USER_PROMPT = `Extract the mortgage statement into the JSON object described. Remember: last-4 of the account number only, no names, and for a FlexLine/STEP use the TERM PORTION closing balance. Respond with only the JSON.`;

export function buildMortgageStatementUserPrompt(extraText?: string): string {
  if (!extraText) return EXTRACT_MORTGAGE_STATEMENT_USER_PROMPT;
  return `${EXTRACT_MORTGAGE_STATEMENT_USER_PROMPT}\n\nDocument:\n"""\n${extraText}\n"""`;
}
