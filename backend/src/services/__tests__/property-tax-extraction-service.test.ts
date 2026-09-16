/**
 * property-tax-extraction-service.test.ts — the pure dollars→cents conversion
 * that turns an AI-extracted BC property tax notice into a create-ready record.
 *
 * `toCreatePropertyTaxInput` has no `this` dependency, so we invoke it via the
 * prototype to avoid constructing the Anthropic-backed service (no env needed).
 */
import { describe, it, expect } from 'vitest';

import type { ExtractedPropertyTax } from '../../ai/prompts/extract-property-tax';
import { PropertyTaxExtractionService } from '../property-tax-extraction-service';

const toInput = (e: ExtractedPropertyTax) =>
  PropertyTaxExtractionService.prototype.toCreatePropertyTaxInput.call(
    {} as PropertyTaxExtractionService,
    e
  ) as ReturnType<PropertyTaxExtractionService['toCreatePropertyTaxInput']>;

function baseExtract(overrides?: Partial<ExtractedPropertyTax>): ExtractedPropertyTax {
  return {
    municipality: { name: 'City of Surrey' },
    property: {
      address: '8135 138 ST',
      folioNumber: '6282-89962-X',
      accessCode: '156886',
      legalDescription: null,
      ownerName: null,
      propertyClass: '1-Res',
    },
    taxYear: 2026,
    assessedValue: 1181000,
    financial: {
      totalTaxAmount: 5053.34,
      amountWithBasicGrant: 4483.34,
      amountWithSeniorGrant: 4208.34,
    },
    payment: {
      mainDueDate: '2026-07-02',
      mainAmount: 5053.34,
      advanceDueDate: null,
      advanceAmount: null,
    },
    homeownerGrant: {
      eligible: true,
      basicAmount: 570,
      seniorAmount: 845,
      claimUrl: 'https://www.gov.bc.ca/homeownergrant',
    },
    penalty: { description: null, percentage: 5, afterDate: '2026-07-02' },
    confidence: { overall: 0.95, municipality: 0.9, taxYear: 0.99, financial: 0.95, payment: 0.94 },
    rawText: '',
    ...overrides,
  };
}

describe('PropertyTaxExtractionService.toCreatePropertyTaxInput', () => {
  it('converts dollars to integer cents and carries the grant + municipality', () => {
    const input = toInput(baseExtract());
    expect(input.taxYear).toBe(2026);
    expect(input.assessedValue).toBe(118100000); // $1,181,000
    expect(input.taxAmount).toBe(505334); // $5,053.34 (No-Grant column)
    expect(input.mainPaymentAmount).toBe(505334);
    expect(input.mainPaymentDueDate).toBe('2026-07-02');
    expect(input.homeownerGrantEligible).toBe(true);
    expect(input.homeownerGrantAmount).toBe(57000); // $570 basic grant
    expect(input.municipalityName).toBe('City of Surrey');
    expect(input.confidenceScore).toBe(0.95);
    // No instalment on this notice.
    expect(input.advancePaymentAmount).toBeUndefined();
    expect(input.advancePaymentDueDate).toBeUndefined();
  });

  it('includes the advance/instalment payment when the notice shows one', () => {
    const input = toInput(
      baseExtract({
        payment: {
          mainDueDate: '2026-07-02',
          mainAmount: 5053.34,
          advanceDueDate: '2026-02-02',
          advanceAmount: 1200.5,
        },
      })
    );
    expect(input.advancePaymentAmount).toBe(120050); // $1,200.50
    expect(input.advancePaymentDueDate).toBe('2026-02-02');
  });

  it('falls back to the total when the main-payment amount is absent', () => {
    const input = toInput(
      baseExtract({
        payment: { mainDueDate: '2026-07-02', mainAmount: null, advanceDueDate: null, advanceAmount: null },
      })
    );
    expect(input.mainPaymentAmount).toBe(505334); // derived from totalTaxAmount
  });

  it('defaults assessed value to 0 and omits the grant amount when not shown', () => {
    const input = toInput(
      baseExtract({
        assessedValue: null,
        homeownerGrant: { eligible: false, basicAmount: null, seniorAmount: null, claimUrl: null },
      })
    );
    expect(input.assessedValue).toBe(0);
    expect(input.homeownerGrantEligible).toBe(false);
    expect(input.homeownerGrantAmount).toBeUndefined();
  });

  it('throws when required fields (year / amount / due date) are missing', () => {
    expect(() => toInput(baseExtract({ taxYear: null }))).toThrow(/tax year/i);
    expect(() =>
      toInput(baseExtract({ financial: { totalTaxAmount: null, amountWithBasicGrant: null, amountWithSeniorGrant: null } }))
    ).toThrow(/total tax amount/i);
    expect(() =>
      toInput(
        baseExtract({
          payment: { mainDueDate: null, mainAmount: 100, advanceDueDate: null, advanceAmount: null },
        })
      )
    ).toThrow(/due date/i);
  });
});
