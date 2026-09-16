import type { MortgageStatementDraft } from '@api/mortgage';

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
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

function lastFour(input: unknown): string | null {
  if (input == null) return null;
  const digits = String(input).replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function amortMonths(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : null;
  const s = String(input).toLowerCase();
  const yearsM = s.match(/(\d+)\s*(?:years?|yrs?|yr|y)\b/);
  const monthsM = s.match(/(\d+)\s*(?:months?|mos?|mo|m)\b/);
  if (yearsM || monthsM) {
    return (yearsM ? parseInt(yearsM[1], 10) : 0) * 12 + (monthsM ? parseInt(monthsM[1], 10) : 0);
  }
  const bare = s.match(/^\s*(\d+)\s*$/);
  return bare ? parseInt(bare[1], 10) : null;
}

/** Deterministic PII-safe normalize for local BYOK mortgage drafts. */
export function normalizeMortgageDraftLocal(raw: unknown): MortgageStatementDraft {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rateTypeRaw = str(r.rate_type ?? r.rateType)?.toLowerCase() ?? null;
  const rateType: MortgageStatementDraft['rateType'] =
    rateTypeRaw === 'fixed' ? 'fixed' : rateTypeRaw?.startsWith('var') ? 'variable' : null;
  const productRaw = str(r.product_type ?? r.productType)?.toLowerCase() ?? null;
  const productType: MortgageStatementDraft['productType'] =
    productRaw === 'heloc_flexline' || productRaw === 'flexline'
      ? 'heloc_flexline'
      : productRaw === 'step'
        ? 'step'
        : productRaw === 'standard'
          ? 'standard'
          : null;

  const ratePeriodsRaw = r.rate_periods ?? r.ratePeriods;
  const ratePeriods: MortgageStatementDraft['ratePeriods'] = [];
  if (Array.isArray(ratePeriodsRaw)) {
    for (const entry of ratePeriodsRaw) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const effectiveDate = date(e.effective_date ?? e.effectiveDate);
      const interestRate = num(e.interest_rate ?? e.interestRate ?? e.rate);
      if (!effectiveDate || interestRate == null) continue;
      ratePeriods.push({
        effectiveDate,
        interestRate,
        primeRate: num(e.prime_rate ?? e.primeRate),
        variance: num(e.variance),
      });
    }
    ratePeriods.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  }

  return {
    lender: str(r.lender),
    productType,
    hasHelocPortion: r.has_heloc_portion === true || r.hasHelocPortion === true,
    mortgageNumberLast4: lastFour(
      r.mortgage_number_last4 ?? r.mortgageNumberLast4 ?? r.account_number,
    ),
    statementDate: date(r.statement_date ?? r.statementDate),
    periodStart: date(r.period_start ?? r.periodStart),
    periodEnd: date(r.period_end ?? r.periodEnd),
    openingBalance: num(r.opening_balance ?? r.openingBalance),
    closingBalance: num(r.closing_balance ?? r.closingBalance),
    interestPaid: num(r.interest_paid ?? r.interestPaid),
    interestCharged: num(r.interest_charged ?? r.interestCharged),
    principalPaid: num(r.principal_paid ?? r.principalPaid),
    paymentAmount: num(r.payment_amount ?? r.paymentAmount),
    interestRate: num(r.interest_rate ?? r.interestRate),
    primeRate: num(r.prime_rate ?? r.primeRate),
    variance: num(r.variance),
    ratePeriods,
    rateType,
    paymentFrequency: str(r.payment_frequency ?? r.paymentFrequency)?.toLowerCase() ?? null,
    propertyTaxPaid: num(r.property_tax_paid ?? r.propertyTaxPaid),
    remainingAmortizationMonths: amortMonths(
      r.remaining_amortization ?? r.remainingAmortizationMonths ?? r.remaining_amortization_months,
    ),
    maturityDate: date(r.maturity_date ?? r.maturityDate),
    newAdvanceAmount: num(r.new_advance_amount ?? r.newAdvanceAmount),
    confidence: typeof r.confidence === 'number' ? r.confidence : 0.5,
  };
}
