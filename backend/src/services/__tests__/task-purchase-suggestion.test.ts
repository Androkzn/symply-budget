import { describe, it, expect } from 'vitest';

import {
  buildPurchaseSuggestion,
  formatCentsRange,
} from '../task-purchase-suggestion';

describe('formatCentsRange', () => {
  it('returns null when both bounds are absent', () => {
    expect(formatCentsRange(null, null)).toBeNull();
  });

  it('formats a point estimate when min === max', () => {
    expect(formatCentsRange(20000, 20000)).toBe('$200');
  });

  it('formats a point estimate when only one bound is present', () => {
    expect(formatCentsRange(20000, null)).toBe('$200');
    expect(formatCentsRange(null, 4000)).toBe('$40');
  });

  it('formats a range', () => {
    expect(formatCentsRange(45000, 90000)).toBe('$450–$900');
  });

  it('rounds to whole dollars', () => {
    expect(formatCentsRange(1550, 1550)).toBe('$16'); // 15.5 → 16
  });
});

describe('buildPurchaseSuggestion', () => {
  it('returns null for a non-purchase task', () => {
    expect(buildPurchaseSuggestion({ is_purchase: false })).toBeNull();
    expect(buildPurchaseSuggestion({})).toBeNull();
    expect(buildPurchaseSuggestion({ is_purchase: null })).toBeNull();
  });

  it('returns the "added" confirmation when a budget item is linked', () => {
    const s = buildPurchaseSuggestion({ is_purchase: true, budget_item_id: 'bi_1' });
    expect(s).not.toBeNull();
    expect(s?.state).toBe('added');
    expect(s?.title).toBe('Added to planned spending');
    expect(s?.subtitle).toBeNull();
    expect(s?.amount_label).toBeNull();
  });

  it('prefers "added" over "dismissed" when both apply (linked wins)', () => {
    const s = buildPurchaseSuggestion({
      is_purchase: true,
      budget_item_id: 'bi_1',
      purchase_suggestion_dismissed: true,
    });
    expect(s?.state).toBe('added');
  });

  it('returns null when dismissed and not linked', () => {
    expect(
      buildPurchaseSuggestion({ is_purchase: true, purchase_suggestion_dismissed: true })
    ).toBeNull();
  });

  it('returns an actionable chip with a formatted cost range', () => {
    const s = buildPurchaseSuggestion({
      is_purchase: true,
      purchase_estimated_cost_min: 45000,
      purchase_estimated_cost_max: 90000,
    });
    expect(s?.state).toBe('actionable');
    expect(s?.title).toBe('Looks like a purchase');
    expect(s?.amount_label).toBe('$450–$900');
    expect(s?.subtitle).toBe('Add to planned spending · ~$450–$900');
    expect(s?.action_label).toBe('Add');
  });

  it('returns an actionable chip without a cost when un-estimable', () => {
    const s = buildPurchaseSuggestion({ is_purchase: true });
    expect(s?.state).toBe('actionable');
    expect(s?.amount_label).toBeNull();
    expect(s?.subtitle).toBe('Add to planned spending');
  });
});
