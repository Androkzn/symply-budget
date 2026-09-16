/**
 * propertyTaxFormUtils — money parsing/formatting + building the create request
 * for the Add Property Tax review form. Pure logic, no rendering.
 */
import {
  buildCreatePropertyTaxRequest,
  centsToInput,
  emptyPropertyTaxForm,
  inputToCents,
  netOwedAfterGrant,
  type PropertyTaxForm,
} from '../propertyTaxFormUtils';

describe('centsToInput', () => {
  it('renders null/undefined as an empty string', () => {
    expect(centsToInput(null)).toBe('');
    expect(centsToInput(undefined)).toBe('');
  });

  it('drops the decimals for whole-dollar amounts', () => {
    expect(centsToInput(118100000)).toBe('1181000');
    expect(centsToInput(57000)).toBe('570');
  });

  it('keeps two decimals for fractional dollars', () => {
    expect(centsToInput(505334)).toBe('5053.34');
    expect(centsToInput(120050)).toBe('1200.50');
  });
});

describe('inputToCents', () => {
  it('returns null for blank input', () => {
    expect(inputToCents('')).toBeNull();
    expect(inputToCents('   ')).toBeNull();
  });

  it('parses plain and currency-formatted dollar strings to cents', () => {
    expect(inputToCents('5053.34')).toBe(505334);
    expect(inputToCents('$1,181,000')).toBe(118100000);
    expect(inputToCents('570')).toBe(57000);
  });

  it('returns null when nothing numeric is present', () => {
    expect(inputToCents('abc')).toBeNull();
  });
});

describe('buildCreatePropertyTaxRequest', () => {
  const validForm: PropertyTaxForm = {
    taxYear: '2026',
    municipalityName: '  City of Surrey  ',
    assessedValue: '1181000',
    taxAmount: '5053.34',
    mainDueDate: '2026-07-02',
    advanceAmount: '',
    advanceDueDate: '',
    grantEligible: true,
    grantAmount: '570',
    grantApplied: false,
  };
  const opts = { markPaid: false, documentUrl: 'utilities/hh/property-taxes/x.pdf', today: '2026-07-06' };

  it('builds an unpaid request (no paid date → backend creates the reminder tasks)', () => {
    const result = buildCreatePropertyTaxRequest(validForm, opts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).toMatchObject({
      taxYear: 2026,
      assessedValue: 118100000,
      taxAmount: 505334,
      mainPaymentAmount: 505334,
      mainPaymentDueDate: '2026-07-02',
      homeownerGrantEligible: true,
      homeownerGrantAmount: 57000,
      homeownerGrantApplied: false, // eligible but not claimed yet
      municipalityName: 'City of Surrey', // trimmed
      documentUrl: 'utilities/hh/property-taxes/x.pdf',
    });
    expect(result.request.mainPaymentPaidDate).toBeUndefined();
    // No advance instalment on this form.
    expect(result.request.advancePaymentAmount).toBeUndefined();
    expect(result.request.advancePaymentDueDate).toBeUndefined();
  });

  it('marks the grant applied only when eligible AND claimed', () => {
    const applied = buildCreatePropertyTaxRequest(
      { ...validForm, grantApplied: true },
      opts
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.request.homeownerGrantApplied).toBe(true);

    // "Applied" with no eligibility can't happen — it stays false.
    const notEligible = buildCreatePropertyTaxRequest(
      { ...validForm, grantEligible: false, grantApplied: true },
      opts
    );
    expect(notEligible.ok).toBe(true);
    if (!notEligible.ok) return;
    expect(notEligible.request.homeownerGrantApplied).toBe(false);
  });

  it('records today as the paid date when markPaid is set', () => {
    const result = buildCreatePropertyTaxRequest(validForm, { ...opts, markPaid: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.mainPaymentPaidDate).toBe('2026-07-06');
  });

  it('includes the advance instalment when the form has one', () => {
    const result = buildCreatePropertyTaxRequest(
      { ...validForm, advanceAmount: '1200.50', advanceDueDate: '2026-02-02' },
      opts
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.advancePaymentAmount).toBe(120050);
    expect(result.request.advancePaymentDueDate).toBe('2026-02-02');
  });

  it('takes the advance instalment OFF the main payment rather than double-counting it', () => {
    // Regression: mainPaymentAmount used to be the full levy regardless of the
    // advance, so a 5053.34 bill with a 1200.50 advance scheduled 6253.84 of
    // payments. taxAmount keeps the gross levy; mainPaymentAmount is the balance.
    const result = buildCreatePropertyTaxRequest(
      { ...validForm, advanceAmount: '1200.50', advanceDueDate: '2026-02-02' },
      opts
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.request.taxAmount).toBe(505334);
    expect(result.request.mainPaymentAmount).toBe(505334 - 120050);
    expect(
      result.request.mainPaymentAmount + (result.request.advancePaymentAmount ?? 0)
    ).toBe(result.request.taxAmount);
  });

  it('leaves the main payment at the full levy when there is no advance', () => {
    const result = buildCreatePropertyTaxRequest(validForm, opts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.mainPaymentAmount).toBe(result.request.taxAmount);
  });

  it('never drives the main payment negative when the advance exceeds the levy', () => {
    const result = buildCreatePropertyTaxRequest(
      { ...validForm, advanceAmount: '99999.00', advanceDueDate: '2026-02-02' },
      opts
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.mainPaymentAmount).toBe(0);
  });

  it('rejects an invalid tax year', () => {
    const result = buildCreatePropertyTaxRequest({ ...validForm, taxYear: '' }, opts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/tax year/i);
  });

  it('rejects a missing/zero amount due', () => {
    const result = buildCreatePropertyTaxRequest({ ...validForm, taxAmount: '' }, opts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/amount due/i);
  });

  it('rejects a missing due date', () => {
    const result = buildCreatePropertyTaxRequest({ ...validForm, mainDueDate: '  ' }, opts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/due date/i);
  });

  it('defaults assessed value to 0 when blank on the empty form', () => {
    const result = buildCreatePropertyTaxRequest(
      { ...emptyPropertyTaxForm, taxYear: '2026', taxAmount: '100', mainDueDate: '2026-07-02' },
      opts
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.assessedValue).toBe(0);
    expect(result.request.municipalityName).toBeUndefined();
  });
});

describe('netOwedAfterGrant', () => {
  const base: PropertyTaxForm = {
    ...emptyPropertyTaxForm,
    taxAmount: '5053.34',
    grantEligible: true,
    grantAmount: '570',
  };

  it('returns null until the total is a valid amount', () => {
    expect(netOwedAfterGrant({ ...base, taxAmount: '' })).toBeNull();
  });

  it('returns the full total when the grant is not being applied', () => {
    expect(netOwedAfterGrant({ ...base, grantApplied: false })).toBe(505334);
  });

  it('deducts the grant from the total when applied', () => {
    expect(netOwedAfterGrant({ ...base, grantApplied: true })).toBe(505334 - 57000);
  });

  it('does not deduct when eligible is off, even if applied is somehow set', () => {
    expect(
      netOwedAfterGrant({ ...base, grantEligible: false, grantApplied: true })
    ).toBe(505334);
  });

  it('never goes below zero when the grant exceeds the total', () => {
    expect(
      netOwedAfterGrant({ ...base, taxAmount: '400', grantAmount: '570', grantApplied: true })
    ).toBe(0);
  });
});
