/**
 * Pure helpers for the Add Property Tax review form — money parsing/formatting
 * and building the create request. Kept UI-free so the conversion + validation
 * rules are unit-testable without rendering the screen (see the budget screens'
 * *Utils modules for the same pattern).
 */
import type { CreatePropertyTaxRequest } from '@features/utilities/api/utilities';

export interface PropertyTaxForm {
  taxYear: string;
  municipalityName: string;
  assessedValue: string;
  taxAmount: string;
  mainDueDate: string;
  advanceAmount: string;
  advanceDueDate: string;
  grantEligible: boolean;
  grantAmount: string;
  /** Claim the grant now — deducts it from the amount owed (grantEligible only). */
  grantApplied: boolean;
}

export const emptyPropertyTaxForm: PropertyTaxForm = {
  taxYear: '',
  municipalityName: '',
  assessedValue: '',
  taxAmount: '',
  mainDueDate: '',
  advanceAmount: '',
  advanceDueDate: '',
  grantEligible: false,
  grantAmount: '',
  grantApplied: false,
};

/** Cents → editable dollar string ("505334" -> "5053.34"); whole dollars drop ".00". */
export function centsToInput(cents?: number | null): string {
  if (cents === null || cents === undefined) return '';
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

/** "5053.34" dollar string → integer cents (null when blank/unparseable). */
export function inputToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = parseFloat(trimmed.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/**
 * What the household actually owes: the total due minus the Home Owner Grant,
 * but only when the grant is eligible AND being applied now. Returns null when
 * the total isn't a valid amount yet (so callers can hide the preview).
 */
export function netOwedAfterGrant(form: PropertyTaxForm): number | null {
  const taxCents = inputToCents(form.taxAmount);
  if (taxCents === null) return null;
  if (!form.grantEligible || !form.grantApplied) return taxCents;
  const grantCents = inputToCents(form.grantAmount) ?? 0;
  return Math.max(0, taxCents - grantCents);
}

export type BuildRequestResult =
  | { ok: true; request: CreatePropertyTaxRequest }
  | { ok: false; error: string };

/**
 * Validate the review form and build a {@link CreatePropertyTaxRequest}.
 * `markPaid` records `mainPaymentPaidDate` (so the backend skips reminder tasks);
 * an unpaid record leaves it unset so the grant + pay tasks are created.
 */
export function buildCreatePropertyTaxRequest(
  form: PropertyTaxForm,
  opts: { markPaid: boolean; documentUrl: string | null; today: string }
): BuildRequestResult {
  const taxYear = parseInt(form.taxYear, 10);
  if (!Number.isFinite(taxYear) || taxYear < 2020) {
    return { ok: false, error: 'Please enter a valid tax year.' };
  }

  const taxAmountCents = inputToCents(form.taxAmount);
  if (taxAmountCents === null || taxAmountCents <= 0) {
    return { ok: false, error: 'Please enter the total amount due.' };
  }

  if (!form.mainDueDate.trim()) {
    return { ok: false, error: 'Please enter the payment due date (YYYY-MM-DD).' };
  }

  const advanceCents = inputToCents(form.advanceAmount);
  const grantCents = inputToCents(form.grantAmount);

  // The main payment is the BALANCE, not the whole levy.
  //
  // This used to send `mainPaymentAmount: taxAmountCents` regardless of the
  // advance instalment, so a $5,000 levy with a $2,000 advance was recorded as
  // a $5,000 main payment PLUS a $2,000 advance — $7,000 of scheduled payments
  // against a $5,000 bill, and a "Pay property tax" task for the wrong amount.
  //
  // `main_payment_amount` is unambiguously "what is still owed" on the server:
  // `createPropertyTax` already subtracts the Home Owner Grant from it. A BC
  // advance instalment is a prepayment toward the same year's levy, so it comes
  // off the same figure. `taxAmount` still carries the gross levy, so nothing
  // is lost — the two numbers just stop meaning the same thing.
  const mainPaymentCents = Math.max(0, taxAmountCents - (advanceCents ?? 0));

  return {
    ok: true,
    request: {
      taxYear,
      assessedValue: inputToCents(form.assessedValue) ?? 0,
      taxAmount: taxAmountCents,
      mainPaymentAmount: mainPaymentCents,
      mainPaymentDueDate: form.mainDueDate.trim(),
      advancePaymentAmount: advanceCents ?? undefined,
      advancePaymentDueDate: form.advanceDueDate.trim() || undefined,
      homeownerGrantEligible: form.grantEligible,
      homeownerGrantAmount: grantCents ?? undefined,
      homeownerGrantApplied: form.grantEligible && form.grantApplied,
      documentUrl: opts.documentUrl || undefined,
      mainPaymentPaidDate: opts.markPaid ? opts.today : undefined,
      municipalityName: form.municipalityName.trim() || undefined,
    },
  };
}
