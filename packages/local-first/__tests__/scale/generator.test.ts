/**
 * Cheap guard — runs in the package's normal `npm test`.
 *
 * Cross-stage comparison is only meaningful if the corpus is byte-identical
 * between runs. An unpinned generator turns a Stage 3 "improvement" into an
 * artefact of a factory somebody tweaked. Field sets and per-row byte sizes are
 * pinned too, because that catches the subtle version: a row that gained a
 * field is a different corpus even at the same row count.
 *
 * Counts are pinned as literals (they are the audit's reference and were
 * derived by hand); the field/size pins are committed snapshots, because
 * hand-transcribing 25 field lists is a source of errors, not of evidence.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  LEDGER_TABLE_KEYS,
  LEDGER_TABLE_NAMES,
} from '../../../../src/features/budget/local/projection';

import { enableDevAssertions } from './lib/dev-global';
import {
  DEFAULT_SEED,
  REFERENCE_SPEC,
  corpusFingerprint,
  generateLedger,
  lwwStampCount,
  rowCounts,
  rowIdAt,
  scaleId,
  totalRows,
} from './lib/ledger-factory';

enableDevAssertions();

describe('scale corpus — pinned totals', () => {
  it('reproduces the audit reference at 5 years / 2 adults', () => {
    const id = scaleId(REFERENCE_SPEC);
    // documents/engineering/budget-local-first-scale-audit.md §3
    expect(id.rows).toBe(11_833);
    expect(id.ops).toBe(17_750);
  });

  it('pins every scale the baseline reports', () => {
    expect(scaleId({ years: 1 })).toEqual({ years: 1, adults: 2, rows: 2_437, ops: 3_656 });
    expect(scaleId({ years: 3 })).toEqual({ years: 3, adults: 2, rows: 7_135, ops: 10_703 });
    expect(scaleId({ years: 5 })).toEqual({ years: 5, adults: 2, rows: 11_833, ops: 17_750 });
    expect(scaleId({ years: 10 })).toEqual({ years: 10, adults: 2, rows: 23_578, ops: 35_367 });
  });

  it('records the four-member discrepancy rather than fudging it', () => {
    // The audit quotes 24,703 rows for a 4-member household. No linear
    // composition satisfies F + 2P = 11,833 AND F + 4P = 24,703 with a
    // non-negative fixed term (it implies F = -1,037), so the two audit figures
    // cannot both come from one model. The generator hits the 2-adult reference
    // exactly and lands here at 4 adults.
    expect(scaleId({ years: 5, adults: 4 }).rows).toBe(22_655);
  });

  it('pins per-table row counts at the reference scale', () => {
    expect(rowCounts(REFERENCE_SPEC)).toEqual({
      categories: 24,
      expenses: 7_300,
      items: 240,
      goals: 60,
      subBudgets: 60,
      transfers: 120,
      mortgages: 1,
      mortgageTerms: 3,
      mortgageStatements: 60,
      mortgageEvents: 10,
      mortgageOffers: 1,
      savingsIncome: 260,
      savingsSpending: 3_000,
      savingsRecurringPayments: 14,
      savingsGoals: 5,
      savingsCategories: 12,
      savingsIncomeTemplates: 4,
      savingsMonthlyTargets: 60,
      budgetLoans: 5,
      budgetRenewals: 30,
      registeredAccounts: 4,
      registeredTransactions: 240,
      wishes: 20,
      wishEntries: 200,
      wishAttachments: 100,
    });
  });

  it('covers every syncing table', () => {
    const counts = rowCounts(REFERENCE_SPEC);
    for (const table of LEDGER_TABLE_NAMES) {
      expect(counts[table], `${table} must be represented in the corpus`).toBeGreaterThan(0);
    }
    expect(LEDGER_TABLE_NAMES).toHaveLength(25);
  });
});

describe('scale corpus — determinism', () => {
  it('is byte-identical for the same seed', () => {
    const a = JSON.stringify(generateLedger({ years: 1 }));
    const b = JSON.stringify(generateLedger({ years: 1 }));
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(100_000);
  });

  it('differs for a different seed but keeps the same shape', () => {
    const a = JSON.stringify(generateLedger({ years: 1, seed: DEFAULT_SEED }));
    const b = JSON.stringify(generateLedger({ years: 1, seed: DEFAULT_SEED + 1 }));
    expect(a).not.toBe(b);
    expect(Math.abs(a.length - b.length) / a.length).toBeLessThan(0.05);
  });

  it('generates a row from its (table, index) alone, not from loop order', () => {
    const oneYear = generateLedger({ years: 1 });
    const fiveYear = generateLedger({ years: 5 });
    // categories is a fixed-count table, so index 7 must be the identical row
    // in both — which is only true if the PRNG is seeded per (table, index)
    // rather than streamed through the generation loop.
    expect(JSON.stringify(oneYear.categories[7])).toBe(JSON.stringify(fiveYear.categories[7]));
  });
});

describe('scale corpus — shape fidelity', () => {
  const ledger = generateLedger(REFERENCE_SPEC);

  it('every row carries its LEDGER_TABLE_KEYS key', () => {
    for (const table of LEDGER_TABLE_NAMES) {
      const keyField = LEDGER_TABLE_KEYS[table];
      for (const row of ledger[table]) {
        expect(typeof row[keyField], `${table}.${keyField}`).toBe('string');
      }
    }
  });

  it('row keys are unique within a table', () => {
    for (const table of LEDGER_TABLE_NAMES) {
      const keyField = LEDGER_TABLE_KEYS[table];
      const keys = ledger[table].map((row) => String(row[keyField]));
      expect(new Set(keys).size, `${table} has duplicate keys`).toBe(keys.length);
    }
  });

  it('pins the sorted field-name set of every table', () => {
    const fields: Record<string, string> = {};
    for (const table of LEDGER_TABLE_NAMES) {
      fields[table] = Object.keys(ledger[table][0]!).sort().join(',');
    }
    expect(fields).toMatchSnapshot();
  });

  it('pins the JSON byte size of each table first row', () => {
    const sizes: Record<string, number> = {};
    for (const table of LEDGER_TABLE_NAMES) {
      sizes[table] = new TextEncoder().encode(JSON.stringify(ledger[table][0])).length;
    }
    expect(sizes).toMatchSnapshot();
  });

  it('pins the whole-corpus JSON size at the reference scale', () => {
    expect(new TextEncoder().encode(JSON.stringify(ledger)).length).toMatchSnapshot();
  });

  it('pins the corpus fingerprint every record is stamped with', () => {
    // `compare` refuses to diff two runs whose fingerprints differ, so this is
    // the value that decides whether a later run is gradeable against the
    // committed baseline at all. Pinned so a corpus change is a visible,
    // deliberate act: update this snapshot AND re-take the baseline.
    expect(corpusFingerprint(REFERENCE_SPEC)).toMatchSnapshot();
  });

  it('pins the size of the LWW watermark map (audit C18)', () => {
    // C18 is that this map outgrows the rows it describes. It is a first-class
    // corpus property now, not an empty object, so it gets a pin of its own.
    expect(lwwStampCount(ledger)).toMatchSnapshot();
  });

  it('pins the whole-corpus CONTENT hash', () => {
    // Size alone would miss a same-width change — and, more importantly, a
    // clock leaking into a row factory. Two `generateLedger` calls inside one
    // process can both read the same millisecond, so the within-run identity
    // test above cannot catch that; a committed hash compared across runs can.
    expect(createHash('sha256').update(JSON.stringify(ledger), 'utf8').digest('hex')).toMatchSnapshot();
  });

  it('exposes stable row ids for the phases to target', () => {
    expect(rowIdAt(ledger, 'expenses', 0)).toBe('exp_0');
    expect(rowIdAt(ledger, 'expenses', 7_300)).toBe('exp_0'); // wraps
    expect(totalRows(ledger)).toBe(11_833);
  });
});
