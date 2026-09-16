/**
 * Contract tests for the savings AI-import prompt's grouping guidance.
 *
 * Pins that the model is told to file property obligations (mortgage, strata /
 * HOA / condo fees, property tax, rent) under a dedicated "Housing" group rather
 * than leaving them ungrouped / lumped into "Other". Mirrors the deterministic
 * backfill in `resolveRecurringGroupLabel` so a fresh import and an existing row
 * land in the same bucket.
 */
import { describe, it, expect } from 'vitest';

import {
  SAVINGS_IMPORT_SYSTEM_PROMPT,
  SAVINGS_IMPORT_SCHEMA,
  savingsScopeDirective,
} from '../suggest-savings-import';

describe('savings-import prompt grouping', () => {
  it('instructs the system prompt to group housing bills under "Housing"', () => {
    expect(SAVINGS_IMPORT_SYSTEM_PROMPT).toMatch(/GROUPING/);
    expect(SAVINGS_IMPORT_SYSTEM_PROMPT).toMatch(/"Housing"/);
    // The three requested labels are named explicitly.
    expect(SAVINGS_IMPORT_SYSTEM_PROMPT).toMatch(/mortgage/i);
    expect(SAVINGS_IMPORT_SYSTEM_PROMPT).toMatch(/strata/i);
    expect(SAVINGS_IMPORT_SYSTEM_PROMPT).toMatch(/property tax/i);
  });

  it('documents "Housing" in the recurringPayments group_label schema', () => {
    const schema = SAVINGS_IMPORT_SCHEMA as {
      properties: {
        recurringPayments: {
          items: { properties: { group_label: { description: string } } };
        };
      };
    };
    const desc = schema.properties.recurringPayments.items.properties.group_label.description;
    expect(desc).toMatch(/"Housing"/);
  });

  it('tells the Monthly-Payments scope to set Housing group labels', () => {
    const directive = savingsScopeDirective('recurring');
    expect(directive).toMatch(/"Housing"/);
    expect(directive).toMatch(/property tax/i);
  });
});

describe('savings-import yearly-grid handling', () => {
  it('history scope covers BOTH grid orientations (row- and column-per-month)', () => {
    const directive = savingsScopeDirective('history');
    // Column-per-month (transposed / pivot) is explicitly described, not just
    // the classic one-row-per-month layout.
    expect(directive).toMatch(/COLUMN-per-month/i);
    expect(directive).toMatch(/ROW-per-month/i);
    // Spending cells still route to the grid bucket.
    expect(directive).toMatch(/monthlyGridSpending/);
    // Section-total + running-total + balances are skipped, not emitted.
    expect(directive).toMatch(/HOUSEHOLD SPENDING/);
    expect(directive).toMatch(/Total YTD/);
    expect(directive).toMatch(/CARDS BALANCE/);
  });

  it('system prompt forbids dropping a real line item by its name alone', () => {
    // Regression guard: "Mortgages"/"Utilities"/"Other" used to be listed as
    // example aggregate rows to skip, which dropped them when they were the
    // actual spending line items in a household grid.
    expect(SAVINGS_IMPORT_SYSTEM_PROMPT).toMatch(/because of its NAME/i);
    expect(SAVINGS_IMPORT_SYSTEM_PROMPT).toMatch(/"Mortgages"/);
    expect(SAVINGS_IMPORT_SYSTEM_PROMPT).toMatch(/MUST be emitted/);
    // Both grid orientations are named in the system prompt too.
    expect(SAVINGS_IMPORT_SYSTEM_PROMPT).toMatch(/one COLUMN per month/i);
  });

  it('grid schema description names both orientations', () => {
    const schema = SAVINGS_IMPORT_SCHEMA as {
      properties: { monthlyGridSpending: { description: string } };
    };
    const desc = schema.properties.monthlyGridSpending.description;
    expect(desc).toMatch(/either orientation/i);
    expect(desc).toMatch(/one column per month/i);
  });
});
