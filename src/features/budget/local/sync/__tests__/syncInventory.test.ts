/**
 * The census a member uses to prove their budget is complete.
 *
 * This screen exists because "Last synced 2 minutes ago" is a claim about an
 * EVENT and says nothing about CONTENT — a device missing half a year reports it
 * word for word the same as one that is whole, which is how a failed backfill
 * stayed invisible for weeks. The numbers here are the content half, so they
 * carry a different burden of proof than an ordinary UI helper: two members
 * compare them line by line and conclude they are in sync. A count that silently
 * omits a table would produce a confident, wrong "yes".
 *
 * So the assertions below are mostly about COMPLETENESS and STABILITY rather
 * than arithmetic: is every table in the schema represented, exactly once, in a
 * fixed order, including the empty ones.
 */
import { emptyLedger } from '../../__tests__/ledgerTestKit';
import { LEDGER_TABLE_NAMES } from '../../projection';
import { buildInventoryGroups, countTable, formatRecordCount } from '../syncInventory';

/** A ledger with a known, deliberately uneven shape. */
function ledgerWith(counts: Partial<Record<string, number>>) {
  const ledger = emptyLedger();
  const table = ledger as unknown as Record<string, unknown[]>;
  for (const [name, n] of Object.entries(counts)) {
    table[name] = Array.from({ length: n ?? 0 }, (_, i) => ({ id: `${name}-${i}` }));
  }
  return ledger;
}

describe('every table in the schema is accounted for', () => {
  it('lists each one exactly once', () => {
    // The guarantee the whole screen rests on. A table that appears twice
    // double-counts; a table that appears zero times under-counts, and an
    // under-count is a member being told their data is missing when it is not —
    // or, worse, the reverse.
    const listed = buildInventoryGroups(emptyLedger()).flatMap((group) =>
      group.lines.map((line) => line.table),
    );

    expect([...listed].sort()).toEqual([...LEDGER_TABLE_NAMES].sort());
    expect(listed).toHaveLength(new Set(listed).size);
  });

  it('lists empty categories too', () => {
    // Zeroes are half of every comparison. Hiding them would make two devices
    // render lists of different SHAPES, so a mismatch would show up as a missing
    // row rather than a different number — and people do not spot absences.
    const groups = buildInventoryGroups(ledgerWith({ expenses: 3 }));
    const wishes = groups
      .flatMap((group) => group.lines)
      .find((line) => line.table === 'wishes');

    expect(wishes).toBeDefined();
    expect(wishes!.count).toBe(0);
  });

  it('keeps the same order whatever the counts are', () => {
    // Sorting by size would reorder the list per device, and two lists that do
    // not line up cannot be compared line by line.
    const order = (counts: Partial<Record<string, number>>) =>
      buildInventoryGroups(ledgerWith(counts)).flatMap((group) =>
        group.lines.map((line) => line.table),
      );

    expect(order({ expenses: 900, wishes: 1 })).toEqual(order({ expenses: 1, wishes: 900 }));
  });

  it('gives every line a human label rather than a schema key', () => {
    // `savingsIncome` is not a thing a member can check against their own
    // budget; "Income entries" is.
    for (const line of buildInventoryGroups(emptyLedger()).flatMap((g) => g.lines)) {
      expect(line.label).not.toBe(line.table);
      expect(line.label.length).toBeGreaterThan(0);
    }
  });
});

describe('the counts themselves', () => {
  it('counts rows per table', () => {
    const ledger = ledgerWith({ expenses: 12, goals: 5, savingsIncome: 3 });

    expect(countTable(ledger, 'expenses')).toBe(12);
    expect(countTable(ledger, 'goals')).toBe(5);
    expect(countTable(ledger, 'savingsIncome')).toBe(3);
  });

  it('adds up to a subtotal per group and a total across them', () => {
    const groups = buildInventoryGroups(ledgerWith({ expenses: 12, goals: 5, wishes: 2 }));
    const budget = groups.find((group) => group.title === 'Budget')!;
    const total = groups.reduce((sum, group) => sum + group.subtotal, 0);

    // `emptyLedger` seeds the default categories, so Budget carries those too —
    // asserted as "at least", because pinning the seed count here would make
    // this test fail every time a category is added to `defaults.ts`.
    expect(budget.subtotal).toBeGreaterThanOrEqual(17);
    expect(total).toBe(
      groups.flatMap((group) => group.lines).reduce((sum, line) => sum + line.count, 0),
    );
  });

  it('survives a table that is not an array', () => {
    // A ledger built from a malformed backup, or a schema key the projection has
    // not populated yet. The screen must show a number, not crash — it is the
    // screen somebody opens precisely when they suspect something is wrong.
    const ledger = emptyLedger();
    (ledger as unknown as Record<string, unknown>).expenses = undefined;

    expect(countTable(ledger, 'expenses')).toBe(0);
  });
});

describe('formatting', () => {
  it('separates thousands, because these numbers get compared by eye', () => {
    expect(formatRecordCount(1645)).toBe('1,645');
    expect(formatRecordCount(0)).toBe('0');
  });
});
