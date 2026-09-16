/**
 * Pure normalization + PII scrub for AI-extracted mortgage statements
 * (implementation plan §6.4). This is the DETERMINISTIC PII control — the prompt
 * asking the model to omit PII is only defense-in-depth. `normalizeMortgageDraft`
 * reads ONLY an allowlisted, safe field set, so a full account number or borrower
 * name the model might emit is dropped; only the last 4 of the number is kept.
 *
 * I/O-free → fully unit-testable without any AI call.
 */

/** One sub-period of the statement's interest breakdown — the axis a variable /
 *  HELOC rate change is read off. `interestRate`/`primeRate`/`variance` are
 *  percents; `effectiveDate` is the FIRST day the rate applied (YYYY-MM-DD). */
export interface RawRatePeriod {
  effectiveDate: string;
  interestRate: number;
  primeRate: number | null;
  variance: number | null;
}

/** The SAFE extracted draft. Deliberately excludes any full account number or
 *  borrower name field — those can never be represented here. Amounts in dollars. */
export interface RawMortgageStatement {
  lender: string | null;
  productType: 'standard' | 'heloc_flexline' | 'step' | null;
  hasHelocPortion: boolean;
  /** Only ever the last 4 digits of the mortgage/account number. */
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
  interestRate: number | null; // percent (the LATEST sub-period's rate)
  primeRate: number | null;
  variance: number | null; // signed percent
  /** Every rate sub-period the statement listed, oldest first. Empty when the
   *  statement carried no interest-breakdown table. Drives rate-change detection. */
  ratePeriods: RawRatePeriod[];
  rateType: 'fixed' | 'variable' | null;
  paymentFrequency: string | null;
  propertyTaxPaid: number | null;
  remainingAmortizationMonths: number | null;
  maturityDate: string | null;
  newAdvanceAmount: number | null;
  confidence: number; // 0..1
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const parsed = parseFloat(v.replace(/[^0-9.-]/g, ''));
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function date(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Last 4 digits of an account-number-like value (min 4 digits), else null. */
export function lastFourDigits(input: unknown): string | null {
  if (input == null) return null;
  const digits = String(input).replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * Mask long digit runs (account numbers) in free text, keeping only the last 4:
 * "9104-4099855" → "••••9855". Defense-in-depth for any raw text before storage.
 */
export function scrubDigits(text: string): string {
  return text.replace(/\d[\d\s-]{6,}\d/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 4 ? `••••${digits.slice(-4)}` : '••••';
  });
}

/**
 * Parse a remaining-amortization string into whole months.
 * "11 Years 06 Months" → 138 · "6 months" → 6 · "25 years" → 300 · a bare number
 * → that many months · unparseable → null.
 */
export function parseAmortizationMonths(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : null;
  const s = String(input).toLowerCase();
  const yearsM = s.match(/(\d+)\s*(?:years?|yrs?|yr|y)\b/);
  const monthsM = s.match(/(\d+)\s*(?:months?|mos?|mo|m)\b/);
  if (yearsM || monthsM) {
    const y = yearsM ? parseInt(yearsM[1], 10) : 0;
    const mo = monthsM ? parseInt(monthsM[1], 10) : 0;
    return y * 12 + mo;
  }
  const bare = s.match(/^\s*(\d+)\s*$/);
  return bare ? parseInt(bare[1], 10) : null;
}

/**
 * Parse the AI's `rate_periods` array into safe, sorted `RawRatePeriod`s. Drops
 * any entry without a usable date + rate; sorts oldest-first so the caller can
 * walk it for transitions. Never throws on a malformed shape (returns []).
 */
export function parseRatePeriods(input: unknown): RawRatePeriod[] {
  if (!Array.isArray(input)) return [];
  const out: RawRatePeriod[] = [];
  for (const entry of input) {
    if (entry == null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const effectiveDate = date(e.effective_date ?? e.effectiveDate ?? e.period_start ?? e.start);
    const interestRate = num(e.interest_rate ?? e.interestRate ?? e.rate);
    if (!effectiveDate || interestRate == null) continue;
    out.push({
      effectiveDate,
      interestRate,
      primeRate: num(e.prime_rate ?? e.primeRate),
      variance: num(e.variance),
    });
  }
  return out.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

/**
 * Normalize a raw AI JSON object into the SAFE draft. Reads only allowlisted
 * fields; any `borrower`/`name`/full-`account_number` the model emitted is
 * dropped, and only the last 4 of a number is retained.
 */
export function normalizeMortgageDraft(raw: unknown): RawMortgageStatement {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rateTypeRaw = str(r.rate_type)?.toLowerCase() ?? null;
  const rateType: RawMortgageStatement['rateType'] =
    rateTypeRaw === 'fixed' ? 'fixed' : rateTypeRaw?.startsWith('var') ? 'variable' : null;
  const productRaw = str(r.product_type)?.toLowerCase() ?? null;
  const productType: RawMortgageStatement['productType'] =
    productRaw === 'heloc_flexline' || productRaw === 'flexline'
      ? 'heloc_flexline'
      : productRaw === 'step'
        ? 'step'
        : productRaw === 'standard'
          ? 'standard'
          : null;

  return {
    lender: str(r.lender),
    productType,
    hasHelocPortion: r.has_heloc_portion === true,
    mortgageNumberLast4: lastFourDigits(
      r.mortgage_number_last4 ?? r.account_number ?? r.mortgage_number
    ),
    statementDate: date(r.statement_date),
    periodStart: date(r.period_start),
    periodEnd: date(r.period_end),
    openingBalance: num(r.opening_balance),
    closingBalance: num(r.closing_balance),
    interestPaid: num(r.interest_paid),
    interestCharged: num(r.interest_charged),
    principalPaid: num(r.principal_paid),
    paymentAmount: num(r.payment_amount),
    interestRate: num(r.interest_rate),
    primeRate: num(r.prime_rate),
    variance: num(r.variance),
    ratePeriods: parseRatePeriods(r.rate_periods),
    rateType,
    paymentFrequency: str(r.payment_frequency)?.toLowerCase() ?? null,
    propertyTaxPaid: num(r.property_tax_paid),
    remainingAmortizationMonths: parseAmortizationMonths(r.remaining_amortization),
    maturityDate: date(r.maturity_date),
    newAdvanceAmount: num(r.new_advance_amount),
    confidence: typeof r.confidence === 'number' ? r.confidence : 0.5,
  };
}
