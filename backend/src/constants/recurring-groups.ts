/**
 * Canonical grouping for recurring "Monthly Payments" — the single backend
 * source of truth.
 *
 * Property obligations (mortgage, strata / HOA / condo fees, property tax, rent)
 * must never fall into the generic "Other" catch-all: they read as one family
 * of housing costs and belong in their own bucket for the by-category
 * distribution. This helper reclassifies ungrouped rows whose label looks like a
 * housing bill into `HOUSING_GROUP_LABEL`, while always respecting an explicit
 * group the user set or the AI importer emitted. Loan-tracked payments (a
 * `budget_loans` row exists) get the same treatment into `LOANS_GROUP_LABEL` —
 * a relational fact rather than a label guess, so it's checked first.
 *
 * Used by the recurring-payments view (subtotals + section grouping) and mirrored
 * by the AI-import prompt so freshly imported bills land here directly.
 */

/** Dedicated group for mortgages, strata/HOA fees, property tax and rent. */
export const HOUSING_GROUP_LABEL = 'Housing';

/** Dedicated group for car loans, BNPL plans, personal loans — anything loan-tracked. */
export const LOANS_GROUP_LABEL = 'Loans & Debt';

/**
 * Labels that read as a property/housing obligation. `\brent\b` is bounded so it
 * matches "Rent" but not "rental", "current", or "parent".
 */
const HOUSING_LABEL_PATTERN =
  /(mortgage|strata|\bhoa\b|home\s*owners?\s*association|condo\s*(fee|maintenance)|property\s*tax|land\s*tax|\brent\b)/i;

/** True when a payment label looks like a mortgage / strata / property-tax / rent bill. */
export function looksLikeHousingPayment(label: string): boolean {
  return HOUSING_LABEL_PATTERN.test(label ?? '');
}

/**
 * Resolve the group a recurring payment should display under. An explicit,
 * non-empty stored group always wins. Otherwise: a loan-tracked payment is
 * lifted into "Loans & Debt" (checked first — it's a relational fact, stronger
 * signal than a label guess); an ungrouped housing bill is lifted into
 * "Housing". Everything else stays ungrouped (null), read as "Other".
 */
export function resolveRecurringGroupLabel(
  label: string,
  storedGroup: string | null | undefined,
  isLoanTracked = false
): string | null {
  const trimmed = (storedGroup ?? '').trim();
  if (trimmed) return trimmed;
  if (isLoanTracked) return LOANS_GROUP_LABEL;
  if (looksLikeHousingPayment(label)) return HOUSING_GROUP_LABEL;
  return null;
}
