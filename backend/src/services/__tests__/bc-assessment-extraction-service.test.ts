/**
 * bc-assessment-extraction-service.test.ts — the pure dollars→cents conversion
 * that turns an AI-extracted BC Assessment notice into a create-ready record.
 *
 * `toCreateBCAssessmentInput` has no `this` dependency, so we invoke it via the
 * prototype to avoid constructing the Anthropic-backed service (no env needed).
 */
import { describe, it, expect } from 'vitest';

import type { ExtractedBCAssessment } from '../../ai/prompts/extract-bc-assessment';
import { BCAssessmentExtractionService } from '../bc-assessment-extraction-service';

const toInput = (e: ExtractedBCAssessment) =>
  BCAssessmentExtractionService.prototype.toCreateBCAssessmentInput.call(
    {} as BCAssessmentExtractionService,
    e
  ) as ReturnType<BCAssessmentExtractionService['toCreateBCAssessmentInput']>;

const toHistory = (e: ExtractedBCAssessment) =>
  BCAssessmentExtractionService.prototype.toBackfillHistoryInputs.call(
    {} as BCAssessmentExtractionService,
    e
  ) as ReturnType<BCAssessmentExtractionService['toBackfillHistoryInputs']>;

const y = (
  year: number,
  totalValue: number | null,
  landValue: number | null = null,
  improvementValue: number | null = null,
  changePercent: number | null = null
) => ({ year, totalValue, landValue, improvementValue, exemptValue: null, netValue: null, changePercent });

function emptyPropertyInfo(): ExtractedBCAssessment['propertyInfo'] {
  return {
    yearBuilt: null,
    description: null,
    bedrooms: null,
    bathrooms: null,
    carports: null,
    garages: null,
    landSizeSqFt: null,
    firstFloorAreaSqFt: null,
    secondFloorAreaSqFt: null,
    basementFinishAreaSqFt: null,
    strataAreaSqFt: null,
    buildingStoreys: null,
    grossLeasableAreaSqFt: null,
    netLeasableAreaSqFt: null,
    manufacturedHome: null,
  };
}

function baseExtract(overrides?: Partial<ExtractedBCAssessment>): ExtractedBCAssessment {
  return {
    assessmentYear: 2026,
    property: {
      address: '8138 138 St',
      rollNumber: '6282-89962-0',
      jurisdiction: 'Surrey',
      jurisdictionNumber: '326',
      pid: '003-110-320',
      propertyClass: '01 - Residential',
      ownerName: null,
      owners: [],
      legalDescription: null,
    },
    propertyInfo: emptyPropertyInfo(),
    values: {
      totalValue: 1181000,
      landValue: 920000,
      improvementValue: 261000,
      previousYearValue: 1050000,
    },
    valueHistory: [],
    salesHistory: [],
    homeownerGrant: null,
    appealDeadline: '2026-01-31',
    confidence: { overall: 0.9, assessmentYear: 0.9, values: 0.9, property: 0.9 },
    rawText: '',
    ...overrides,
  };
}

describe('BCAssessmentExtractionService.toCreateBCAssessmentInput', () => {
  it('converts dollars to integer cents and derives the YoY change percent', () => {
    const input = toInput(baseExtract());
    expect(input.assessmentYear).toBe(2026);
    expect(input.assessedValue).toBe(118100000); // $1,181,000
    expect(input.landValue).toBe(92000000); // $920,000
    expect(input.improvementValue).toBe(26100000); // $261,000
    expect(input.previousYearValue).toBe(105000000); // $1,050,000
    expect(input.changePercent).toBeCloseTo(12.5, 1); // 1.05M → 1.181M
    expect(input.propertyClass).toBe('01 - Residential');
    expect(input.appealDeadline).toBe('2026-01-31');
    expect(input.confidenceScore).toBe(0.9);
  });

  it('omits changePercent and optional values when the notice lacks them', () => {
    const input = toInput(
      baseExtract({
        values: { totalValue: 900000, landValue: null, improvementValue: null, previousYearValue: null },
      })
    );
    expect(input.assessedValue).toBe(90000000);
    expect(input.landValue).toBeUndefined();
    expect(input.improvementValue).toBeUndefined();
    expect(input.previousYearValue).toBeUndefined();
    expect(input.changePercent).toBeUndefined();
  });

  it('does not divide by zero when the prior-year value is 0', () => {
    const input = toInput(
      baseExtract({
        values: { totalValue: 900000, landValue: null, improvementValue: null, previousYearValue: 0 },
      })
    );
    expect(input.changePercent).toBeUndefined();
  });

  it('throws when the assessment year is missing', () => {
    expect(() => toInput(baseExtract({ assessmentYear: null }))).toThrow('Assessment year is required');
  });

  it('throws when the total assessed value is missing', () => {
    expect(() =>
      toInput(
        baseExtract({
          values: { totalValue: null, landValue: null, improvementValue: null, previousYearValue: null },
        })
      )
    ).toThrow('Total assessed value is required');
  });

  it('falls back to the multi-year history when the summary values are missing', () => {
    const input = toInput(
      baseExtract({
        values: { totalValue: null, landValue: null, improvementValue: null, previousYearValue: null },
        valueHistory: [
          { year: 2026, totalValue: 1181000, landValue: 1081000, improvementValue: 100000, exemptValue: 0, netValue: 1181000, changePercent: -5 },
          { year: 2025, totalValue: 1245000, landValue: 1196000, improvementValue: 49000, exemptValue: 0, netValue: 1245000, changePercent: -1 },
        ],
      })
    );
    expect(input.assessedValue).toBe(118100000); // $1,181,000 from history
    expect(input.landValue).toBe(108100000); // $1,081,000 from history
    expect(input.improvementValue).toBe(10000000); // $100,000 from history
    expect(input.previousYearValue).toBe(124500000); // 2025 total from history
    expect(input.changePercent).toBeCloseTo(-5.14, 1); // 1.245M → 1.181M
  });

  it('uses the history change percent when there is no prior-year value to derive from', () => {
    const input = toInput(
      baseExtract({
        values: { totalValue: 1121100, landValue: null, improvementValue: null, previousYearValue: null },
        valueHistory: [
          { year: 2026, totalValue: 1121100, landValue: null, improvementValue: null, exemptValue: null, netValue: null, changePercent: 35 },
        ],
      })
    );
    expect(input.previousYearValue).toBeUndefined();
    expect(input.changePercent).toBe(35); // taken straight from the history table
  });
});

describe('BCAssessmentExtractionService.toBackfillHistoryInputs', () => {
  it('maps every prior year to cents and excludes the current roll year', () => {
    const rows = toHistory(
      baseExtract({
        assessmentYear: 2026,
        // Municipal "General Assessment" style — full land/improvement per year.
        valueHistory: [
          y(2026, 1181000, 1081000, 100000, -5),
          y(2025, 1245000, 1196000, 49000, -1),
          y(2024, 1260300, 1200000, 60300, 0),
        ],
      })
    );

    // 2026 (current) is handled by the review sheet, not the backfill.
    expect(rows.map((r) => r.assessmentYear)).toEqual([2025, 2024]);

    const y2025 = rows.find((r) => r.assessmentYear === 2025)!;
    expect(y2025.assessedValue).toBe(124500000); // $1,245,000
    expect(y2025.landValue).toBe(119600000); // $1,196,000
    expect(y2025.improvementValue).toBe(4900000); // $49,000
    expect(y2025.changePercent).toBe(-1); // stated in the table
    expect(y2025.previousYearValue).toBe(126030000); // 2024 total → prior year
  });

  it('derives the YoY change from adjacent years when the table omits it', () => {
    const rows = toHistory(
      baseExtract({
        assessmentYear: 2026,
        valueHistory: [y(2026, 1181000), y(2025, 1245000), y(2024, 1260300)],
      })
    );
    const y2025 = rows.find((r) => r.assessmentYear === 2025)!;
    // 1,260,300 → 1,245,000 = -1.2%
    expect(y2025.changePercent).toBeCloseTo(-1.2, 1);
  });

  it('skips years with no usable total and returns [] when there is no history', () => {
    expect(toHistory(baseExtract({ valueHistory: [] }))).toEqual([]);
    const rows = toHistory(
      baseExtract({ assessmentYear: 2026, valueHistory: [y(2026, 1181000), y(2025, null)] })
    );
    expect(rows).toEqual([]); // 2026 excluded, 2025 has no total
  });
});
