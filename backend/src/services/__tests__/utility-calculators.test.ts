/**
 * UtilityService pure calculators — Home Owner Grant, property-tax due dates,
 * and penalty math (BUDGET-BILL-038/040/041).
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import type { MunicipalityConfig, PropertyTax } from '../../db/schema-utilities';
import type { Env } from '../../types';
import { UtilityService } from '../utility-service';

const testEnv = env as unknown as Env;

function service(): UtilityService {
  return new UtilityService(testEnv, testEnv.DB);
}

function sampleTax(overrides: Partial<PropertyTax> = {}): PropertyTax {
  return {
    id: 'tax-1',
    household_id: 'hh-1',
    tax_year: 2026,
    assessed_value: 150000000,
    tax_amount: 450000,
    advance_payment_amount: null,
    advance_payment_due_date: null,
    advance_payment_paid_date: null,
    main_payment_amount: 450000,
    main_payment_due_date: '2026-07-02',
    main_payment_paid_date: null,
    homeowner_grant_eligible: 0,
    homeowner_grant_amount: null,
    homeowner_grant_applied_date: null,
    homeowner_grant_status: null,
    penalties: null,
    document_url: null,
    main_payment_task_id: null,
    grant_task_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as PropertyTax;
}

/**
 * 2026 Home Owner Grant amounts, per gov.bc.ca. These tests previously asserted
 * 77000 / 104500 for a NON-rural claimant — those are the northern-and-rural
 * figures, and the calculator handed them to everyone because both constants
 * were hardcoded and `isRural` only moved a threshold. The repo's own Surrey
 * fixture (utilities.test.ts) has always carried basicGrant 570 /
 * additionalGrant 845, i.e. the non-rural pair, and disagreed with it.
 */
const REGULAR = 57000; // $570
const REGULAR_RURAL = 77000; // $770 — northern and rural
const ADDITIONAL = 84500; // $845 — seniors / veterans / disability
const ADDITIONAL_RURAL = 104500; // $1,045 — northern and rural

describe('UtilityService.calculateHomeOwnerGrant', () => {
  it('returns the full regular grant when assessed value is under the threshold', () => {
    const result = service().calculateHomeOwnerGrant(150000000);
    expect(result.eligible).toBe(true);
    expect(result.amount).toBe(REGULAR);
    expect(result.threshold).toBe(207500000);
  });

  it('phases out the grant when assessed value exceeds the threshold', () => {
    const result = service().calculateHomeOwnerGrant(217500000);
    expect(result.eligible).toBe(true);
    expect(result.amount).toBeLessThan(REGULAR);
    expect(result.amount).toBeGreaterThan(0);
  });

  it('uses the higher senior additional grant and threshold', () => {
    const regular = service().calculateHomeOwnerGrant(150000000, false);
    const senior = service().calculateHomeOwnerGrant(150000000, true);
    expect(senior.amount).toBe(ADDITIONAL);
    expect(senior.threshold).toBeGreaterThan(regular.threshold);
  });

  it('pays the northern-and-rural top-up on the REGULAR grant', () => {
    // The regression: isRural used to make no difference at all here, because
    // it was wired only into ADDITIONAL_THRESHOLD.
    const urban = service().calculateHomeOwnerGrant(150000000, false, false, false, false);
    const rural = service().calculateHomeOwnerGrant(150000000, false, false, false, true);
    expect(urban.amount).toBe(REGULAR);
    expect(rural.amount).toBe(REGULAR_RURAL);
    expect(rural.amount).toBeGreaterThan(urban.amount);
  });

  it('pays the northern-and-rural top-up on the ADDITIONAL grant too', () => {
    const urban = service().calculateHomeOwnerGrant(150000000, true, false, false, false);
    const rural = service().calculateHomeOwnerGrant(150000000, true, false, false, true);
    expect(urban.amount).toBe(ADDITIONAL);
    expect(rural.amount).toBe(ADDITIONAL_RURAL);
  });

  it.each([
    ['veteran', [false, true, false] as const],
    ['disabled', [false, false, true] as const],
  ])('treats a %s claimant as eligible for the additional grant', (_label, flags) => {
    const [isSenior, isVeteran, isDisabled] = flags;
    const result = service().calculateHomeOwnerGrant(150000000, isSenior, isVeteran, isDisabled);
    expect(result.amount).toBe(ADDITIONAL);
  });

  it('grants the full amount at an assessed value of exactly zero', () => {
    // `!assessedValue` in the route used to reject this outright as "required",
    // even though 0 is under every threshold.
    const result = service().calculateHomeOwnerGrant(0);
    expect(result.eligible).toBe(true);
    expect(result.amount).toBe(REGULAR);
  });

  it('pays the full grant exactly AT the threshold, not one cent less', () => {
    const result = service().calculateHomeOwnerGrant(207500000);
    expect(result.amount).toBe(REGULAR);
  });

  it('zeroes out and reports ineligible for a high enough assessment', () => {
    const result = service().calculateHomeOwnerGrant(500000000);
    expect(result.amount).toBe(0);
    expect(result.eligible).toBe(false);
  });
});

describe('UtilityService.calculatePropertyTaxDueDate', () => {
  it('defaults to July 2 when municipality config is missing', () => {
    expect(service().calculatePropertyTaxDueDate(2026, null, 'main')).toBe('2026-07-02');
  });

  it('parses municipality main and advance due dates', () => {
    const municipality = {
      property_tax_main_due_date: 'July 3',
      property_tax_advance_due_date: 'February 1',
    } as MunicipalityConfig;

    expect(service().calculatePropertyTaxDueDate(2026, municipality, 'main')).toBe('2026-07-03');
    expect(service().calculatePropertyTaxDueDate(2026, municipality, 'advance')).toBe('2026-02-01');
  });
});

describe('UtilityService.calculatePropertyTaxPenalties', () => {
  it('returns no penalties when payment is on time', () => {
    const tax = sampleTax({ main_payment_paid_date: '2026-07-01' });
    const penalties = service().calculatePropertyTaxPenalties(tax, null);
    expect(penalties).toEqual([]);
  });

  it('applies municipality penalty tiers when overdue', () => {
    const municipality = {
      penalty_structure: JSON.stringify([
        { daysAfterDue: 1, percentage: 5 },
        { daysAfterDue: 30, percentage: 10 },
      ]),
    } as MunicipalityConfig;
    const tax = sampleTax();
    const penalties = service().calculatePropertyTaxPenalties(tax, municipality, '2026-08-15');
    expect(penalties.length).toBeGreaterThan(0);
    expect(penalties[0].amount).toBe(Math.round((450000 * 5) / 100));
  });
});
