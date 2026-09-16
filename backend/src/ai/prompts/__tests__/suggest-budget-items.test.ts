/**
 * Contract tests for the Budget "Add with AI" prompts.
 *
 * Regression guard for a real failure: uploading a whole-year household budget
 * grid returned "Nothing found" because (1) the extract prompt only knew
 * receipts/quotes and (2) the suggest prompt was framed purely as a wishlist
 * adder, so transcribed budget-table rows produced zero items. Both now
 * recognise spend line items from a spending document/table (either grid
 * orientation) and never drop a real line by its name alone.
 */
import { describe, it, expect } from 'vitest';

import { EXTRACT_BUDGET_DOCUMENT_SYSTEM_PROMPT } from '../extract-budget-document';
import { SUGGEST_BUDGET_ITEMS_SYSTEM_PROMPT } from '../suggest-budget-items';

describe('suggest-budget-items prompt', () => {
  it('accepts a transcribed receipt/statement/budget-table, not only a wishlist description', () => {
    expect(SUGGEST_BUDGET_ITEMS_SYSTEM_PROMPT).toMatch(/budget spreadsheet|budget.*table/i);
    // One item per spend line — the fix that stops "Nothing found" on a table.
    expect(SUGGEST_BUDGET_ITEMS_SYSTEM_PROMPT).toMatch(/ONE ITEM PER SPEND LINE/i);
    expect(SUGGEST_BUDGET_ITEMS_SYSTEM_PROMPT).toMatch(/never return an empty list when named amounts are present/i);
  });

  it('never drops a real line item by its name alone; skips only true aggregates', () => {
    expect(SUGGEST_BUDGET_ITEMS_SYSTEM_PROMPT).toMatch(/because of its NAME/i);
    expect(SUGGEST_BUDGET_ITEMS_SYSTEM_PROMPT).toMatch(/"Mortgages"/);
    expect(SUGGEST_BUDGET_ITEMS_SYSTEM_PROMPT).toMatch(/Total YTD/);
    expect(SUGGEST_BUDGET_ITEMS_SYSTEM_PROMPT).toMatch(/CARDS BALANCE/);
  });

  it('dates a spend by the month named on its line', () => {
    expect(SUGGEST_BUDGET_ITEMS_SYSTEM_PROMPT).toMatch(/YYYY-MM-01/);
  });
});

describe('extract-budget-document prompt', () => {
  it('reads budget spreadsheets/grids in both orientations, not just receipts', () => {
    expect(EXTRACT_BUDGET_DOCUMENT_SYSTEM_PROMPT).toMatch(/budget spreadsheet|tracker/i);
    expect(EXTRACT_BUDGET_DOCUMENT_SYSTEM_PROMPT).toMatch(/one ROW per month/i);
    expect(EXTRACT_BUDGET_DOCUMENT_SYSTEM_PROMPT).toMatch(/one COLUMN per month/i);
  });

  it('does not drop a real spending line by its name; skips aggregates + income + balances', () => {
    expect(EXTRACT_BUDGET_DOCUMENT_SYSTEM_PROMPT).toMatch(/because of its NAME/i);
    expect(EXTRACT_BUDGET_DOCUMENT_SYSTEM_PROMPT).toMatch(/"Mortgages"/);
    expect(EXTRACT_BUDGET_DOCUMENT_SYSTEM_PROMPT).toMatch(/CARDS BALANCE/);
    expect(EXTRACT_BUDGET_DOCUMENT_SYSTEM_PROMPT).toMatch(/Savings \/ Net/);
  });
});
