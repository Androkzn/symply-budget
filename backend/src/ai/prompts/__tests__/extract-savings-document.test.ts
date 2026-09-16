/**
 * Contract tests for the savings document READ (transcription) prompt.
 *
 * Pins the two fixes that made a real household yearly grid transcribe its
 * SPENDING correctly: (1) both grid orientations are described — months down
 * rows AND months across columns (pivot); (2) a genuine line item is never
 * dropped just because its name ("Mortgages"/"Utilities"/"Other") looks like a
 * common aggregate heading.
 */
import { describe, it, expect } from 'vitest';

import { EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT } from '../extract-savings-document';

describe('extract-savings-document yearly-grid handling', () => {
  it('describes both grid orientations (row- and column-per-month)', () => {
    expect(EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT).toMatch(/ROW-per-month/i);
    expect(EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT).toMatch(/COLUMN-per-month/i);
    // The pivot layout's section headers are called out.
    expect(EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT).toMatch(/HOUSEHOLD SPENDING/);
  });

  it('does not drop a real spending line item by its name alone', () => {
    expect(EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT).toMatch(/because of its NAME/i);
    expect(EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT).toMatch(/"Mortgages"/);
    expect(EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT).toMatch(/MUST be transcribed/);
  });

  it('skips derived/aggregate cells: Total YTD, Net/Savings, section totals, balances', () => {
    expect(EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT).toMatch(/Total YTD/);
    expect(EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT).toMatch(/Savings \/ Net/);
    expect(EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT).toMatch(/CARDS BALANCE/);
  });
});
