/**
 * Contract tests for the shared recurring-payment grouping helper.
 *
 * Pins the rule that mortgages, strata/HOA fees, property tax and rent are
 * lifted out of the generic "Other" catch-all into a dedicated "Housing" group,
 * loan-tracked payments are lifted into a dedicated "Loans & Debt" group, and
 * an explicit user/import group is always respected as-is.
 */
import { describe, it, expect } from 'vitest';

import {
  HOUSING_GROUP_LABEL,
  LOANS_GROUP_LABEL,
  looksLikeHousingPayment,
  resolveRecurringGroupLabel,
} from '../recurring-groups';

describe('recurring-payment grouping', () => {
  it('classifies mortgage / strata / property-tax / rent labels as housing', () => {
    for (const label of [
      'Mortgage Home',
      'Mortgage Condo',
      'Strata',
      'Strata fees',
      'HOA dues',
      'Condo fee',
      'Property tax',
      'Property Taxes',
      'Land tax',
      'Rent',
    ]) {
      expect(looksLikeHousingPayment(label)).toBe(true);
      expect(resolveRecurringGroupLabel(label, null)).toBe(HOUSING_GROUP_LABEL);
    }
  });

  it('does not misclassify unrelated bills as housing', () => {
    for (const label of ['Netflix', 'Hydro', 'Car loan', 'Rental car', 'Current account fee']) {
      expect(looksLikeHousingPayment(label)).toBe(false);
      expect(resolveRecurringGroupLabel(label, null)).toBeNull();
    }
  });

  it('respects an explicit group even for a housing-looking label', () => {
    expect(resolveRecurringGroupLabel('Mortgage Home', 'Loans')).toBe('Loans');
    expect(resolveRecurringGroupLabel('Netflix', 'Subscriptions')).toBe('Subscriptions');
  });

  it('treats a blank/whitespace group as ungrouped', () => {
    expect(resolveRecurringGroupLabel('Netflix', '   ')).toBeNull();
    expect(resolveRecurringGroupLabel('Strata', '')).toBe(HOUSING_GROUP_LABEL);
  });

  it('classifies a loan-tracked payment as Loans & Debt regardless of its label', () => {
    expect(resolveRecurringGroupLabel('IKEA 1', null, true)).toBe(LOANS_GROUP_LABEL);
    expect(resolveRecurringGroupLabel('Toyota Financial', null, true)).toBe(LOANS_GROUP_LABEL);
    // Even a housing-looking label defers to the loan-tracked signal — it's a
    // relational fact (a `budget_loans` row exists), stronger than a text guess.
    expect(resolveRecurringGroupLabel('Mortgage Home', null, true)).toBe(LOANS_GROUP_LABEL);
  });

  it('respects an explicit group over the loan-tracked signal', () => {
    expect(resolveRecurringGroupLabel('IKEA 1', 'Subscriptions', true)).toBe('Subscriptions');
  });

  it('defaults isLoanTracked to false when omitted', () => {
    expect(resolveRecurringGroupLabel('IKEA 1', null)).toBeNull();
  });
});
