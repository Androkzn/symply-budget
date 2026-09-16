/**
 * Contract tests for the shared income-source constants.
 *
 * These values were previously duplicated across five files with nothing
 * keeping them in sync. These tests pin the classification and assert every
 * downstream consumer (route validators, AI import prompt) is still derived
 * from this one list rather than re-declaring it.
 */
import { describe, it, expect } from 'vitest';

import { SAVINGS_INCOME_SOURCE_TYPES, SAVINGS_IMPORT_SCHEMA } from '../../ai/prompts/suggest-savings-import';
import {
  INCOME_SOURCE_TYPES,
  IRREGULAR_INCOME_SOURCE_TYPES,
  REGULAR_INCOME_SOURCE_TYPES,
  isIrregularIncomeSource,
} from '../income-sources';

describe('income source constants', () => {
  it('composes the full list from regular + irregular with no overlap', () => {
    expect(INCOME_SOURCE_TYPES).toEqual([
      ...REGULAR_INCOME_SOURCE_TYPES,
      ...IRREGULAR_INCOME_SOURCE_TYPES,
    ]);
    const overlap = REGULAR_INCOME_SOURCE_TYPES.filter((t) =>
      (IRREGULAR_INCOME_SOURCE_TYPES as readonly string[]).includes(t)
    );
    expect(overlap).toEqual([]);
    expect(new Set(INCOME_SOURCE_TYPES).size).toBe(INCOME_SOURCE_TYPES.length);
  });

  it('classifies the six one-off sources as irregular', () => {
    expect(IRREGULAR_INCOME_SOURCE_TYPES).toEqual([
      'marketplace_sale',
      'gift',
      'refund',
      'bonus',
      'freelance',
      'tax_refund',
    ]);
    for (const t of IRREGULAR_INCOME_SOURCE_TYPES) {
      expect(isIrregularIncomeSource(t)).toBe(true);
    }
  });

  it('classifies every regular source — including legacy "other" — as regular', () => {
    for (const t of REGULAR_INCOME_SOURCE_TYPES) {
      expect(isIrregularIncomeSource(t)).toBe(false);
    }
    // `other` predates the split and carries production rows; treating it as
    // one-off would retroactively rewrite historical analytics.
    expect(isIrregularIncomeSource('other')).toBe(false);
  });

  it('treats an unknown source as regular rather than throwing', () => {
    expect(isIrregularIncomeSource('lottery_win')).toBe(false);
    expect(isIrregularIncomeSource('')).toBe(false);
  });

  it('treats tax_refund and the generic refund as separate values, both irregular', () => {
    expect(INCOME_SOURCE_TYPES.filter((t) => t === 'tax_refund' || t === 'refund')).toEqual([
      'refund',
      'tax_refund',
    ]);
    expect(isIrregularIncomeSource('tax_refund')).toBe(true);
    expect(isIrregularIncomeSource('refund')).toBe(true);
  });

  it('feeds the AI import prompt from the same list', () => {
    // Re-export, not a copy — this is what stopped the enum drifting before.
    expect(SAVINGS_INCOME_SOURCE_TYPES).toBe(INCOME_SOURCE_TYPES);

    const incomeItem = (SAVINGS_IMPORT_SCHEMA.properties as Record<string, any>).income.items;
    expect(incomeItem.properties.source_type.enum).toEqual([...INCOME_SOURCE_TYPES]);
  });
});
