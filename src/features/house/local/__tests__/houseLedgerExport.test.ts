/**
 * H9 CSV export (plan §10).
 *
 * Two things here are load-bearing rather than cosmetic:
 *
 *  1. **Formula-injection neutralization.** House rows carry text a member typed
 *     — task titles, notes, space names. A cell starting `=`, `+`, `-` or `@` is
 *     executed as a formula by Excel, Numbers and Sheets on open. The plan calls
 *     this out by name when porting Budget's exporter, so it is asserted against
 *     a real payload, not just the happy path.
 *  2. **Registry coverage.** The section list is derived from
 *     `HOUSE_LEDGER_TABLE_NAMES` precisely so a Wave-B table cannot be added to
 *     the ledger and silently omitted from exports. That property is only real
 *     if a test enforces it, so it is enforced here as an exact set equality.
 *
 * Static imports throughout (plan §6.2).
 */
import {
  HOUSE_EXPORT_FORMAT,
  HOUSE_EXPORT_VERSION,
  buildHouseLedgerCsvBundle,
  buildTableCsv,
  columnsFor,
  escapeCsvCell,
  houseExportFileName,
  renderHouseLedgerExportText,
  sectionFileName,
  toCsv,
  totalExportedCsvRows,
} from '../export/houseLedgerExport';
import { HOUSE_LEDGER_PHYSICAL_TABLES, HOUSE_LEDGER_TABLE_NAMES } from '../schema';
import type { HouseLedgerTableName } from '../schema';

import { emptyHouseLedger, taskRow } from './houseLedgerTestKit';

jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/' }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

describe('escapeCsvCell — formula injection', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '=cmd|\'/c calc\'!A1'])(
    'neutralizes %s by prefixing an apostrophe',
    (payload) => {
      expect(escapeCsvCell(payload)).toBe(`'${payload}`);
    },
  );

  it('neutralizes a formula that a member typed as a task title', () => {
    // The realistic vector: not a crafted cell, just a title that happens to
    // start with a dash, plus a comma forcing quoting. Both rules must apply.
    const csv = toCsv(['title'], [['-50% off gutter cleaning, spring']]);
    expect(csv).toContain(`"'-50% off gutter cleaning, spring"`);
  });

  it('quotes and doubles embedded quotes', () => {
    expect(escapeCsvCell('He said "fix the roof"')).toBe('"He said ""fix the roof"""');
  });

  it('quotes cells containing commas or newlines', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders null and undefined as empty, not as the strings', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell('null')).toBe('null');
  });

  it('serialises a nested object as JSON rather than [object Object]', () => {
    // Task rows carry nested photo/author shapes; the old stringification would
    // have exported them as an opaque placeholder.
    expect(escapeCsvCell({ id: 'p1', sort_order: 0 })).toBe('"{""id"":""p1"",""sort_order"":0}"');
  });

  it('leaves a leading-dash negative number neutralized too', () => {
    // Costs are exported as-is; a bare -12.5 would still be read as a formula
    // start by some spreadsheets, so it gets the same treatment.
    expect(escapeCsvCell(-12.5)).toBe("'-12.5");
  });
});

describe('columnsFor — sparse local-first rows', () => {
  it('unions keys across rows rather than trusting the first', () => {
    // A column added in a later app version is absent from older rows. Keying
    // off row zero would silently drop it for the whole file.
    const cols = columnsFor([{ id: '1', title: 'a' }, { id: '2', title: 'b', new_field: 'x' }]);
    expect(cols).toEqual(['id', 'title', 'new_field']);
  });

  it('preserves first-appearance order so exports stay diffable', () => {
    expect(columnsFor([{ id: '1', b: 1, a: 2 }])).toEqual(['id', 'b', 'a']);
  });

  it('is empty for no rows', () => {
    expect(columnsFor([])).toEqual([]);
  });
});

describe('bundle composition', () => {
  function ledgerWithTasks() {
    const ledger = emptyHouseLedger();
    ledger.tasks = [
      taskRow('t1', { title: 'Clean gutters' }),
      taskRow('t2', { title: '=DANGER()' }),
    ] as typeof ledger.tasks;
    return ledger;
  }

  it('emits exactly one section per ledger table — no table can be silently dropped', () => {
    const bundle = buildHouseLedgerCsvBundle(emptyHouseLedger(), { exportedAt: 'X' });
    // Built through `sectionFileName` rather than from the physical name
    // directly: since B4 both `checklist_items` claimants are live, so two
    // sections carry the disambiguated `physical__ledgerName` form. Hardcoding
    // `${physical}.csv` here would assert the pre-B4 world.
    const expected = HOUSE_LEDGER_TABLE_NAMES.map((t) => sectionFileName(t)).sort();
    expect(bundle.files.map((f) => f.name).sort()).toEqual(expected);
    expect(bundle.files).toHaveLength(HOUSE_LEDGER_TABLE_NAMES.length);
  });

  it('names sections after the PHYSICAL table, matching D1 and the docs', () => {
    // The rule is "physical name", and it holds wherever a physical table has
    // one claimant — `checklists` still resolves cleanly.
    expect(sectionFileName('recurringChecklists')).toBe('checklists.csv');

    // `checklist_items` has TWO claimants now that B4 activated the labor-hub
    // twin, so both sides take the disambiguated form. The physical name is
    // still the prefix, so a reader can still match the section to the schema —
    // which is the property this test actually protects.
    expect(sectionFileName('recurringChecklistItems')).toBe(
      'checklist_items__recurringChecklistItems.csv',
    );
    expect(sectionFileName('visitChecklistItems')).toBe(
      'checklist_items__visitChecklistItems.csv',
    );
  });

  it('never emits two sections with the same file name', () => {
    // Physical-name uniqueness holds across Wave A but STOPS being an invariant
    // at Wave B, where the labor hub claims `checklist_items` too. Two sections
    // sharing a name means a consumer keyed on the name keeps only the last, and
    // a member's export is silently missing a table. Asserted over the whole
    // registry so activating a wave cannot reintroduce it.
    const names = HOUSE_LEDGER_TABLE_NAMES.map((t) => sectionFileName(t));
    expect(new Set(names).size).toBe(names.length);
  });

  it('disambiguates by ledger name when a physical table has two claimants', () => {
    const collide = (Object.keys(HOUSE_LEDGER_PHYSICAL_TABLES) as HouseLedgerTableName[]).filter(
      (t) => HOUSE_LEDGER_PHYSICAL_TABLES[t] === 'checklist_items',
    );
    if (collide.length > 1) {
      for (const t of collide) {
        expect(sectionFileName(t)).toBe(`checklist_items__${t}.csv`);
      }
    } else {
      // Wave A only — the disambiguation is dormant, which is itself the
      // contract: it must engage exactly when a second claimant appears.
      expect(sectionFileName(collide[0]!)).toBe('checklist_items.csv');
    }
  });

  it('counts data rows excluding headers', () => {
    const bundle = buildHouseLedgerCsvBundle(ledgerWithTasks(), { exportedAt: 'X' });
    expect(bundle.files.find((f) => f.name === 'tasks.csv')?.rowCount).toBe(2);
    expect(totalExportedCsvRows(bundle)).toBe(2);
  });

  it('gives an empty table a header-only section rather than omitting it', () => {
    const csv = buildTableCsv(emptyHouseLedger(), 'appliances');
    expect(csv.trim()).toBe('id');
  });

  it('carries the property identity in the bundle', () => {
    const bundle = buildHouseLedgerCsvBundle(emptyHouseLedger(), { exportedAt: 'T0' });
    expect(bundle).toMatchObject({
      format: HOUSE_EXPORT_FORMAT,
      version: HOUSE_EXPORT_VERSION,
      exportedAt: 'T0',
      householdId: 'hh_test',
    });
  });

  it('neutralizes injected content inside a real table section', () => {
    const bundle = buildHouseLedgerCsvBundle(ledgerWithTasks(), { exportedAt: 'X' });
    const tasks = bundle.files.find((f) => f.name === 'tasks.csv')!.content;
    expect(tasks).toContain("'=DANGER()");
    expect(tasks).not.toMatch(/(^|,)=DANGER\(\)/m);
  });
});

describe('rendered text file', () => {
  it('labels every section and leads with a parseable header', () => {
    const bundle = buildHouseLedgerCsvBundle(emptyHouseLedger(), { exportedAt: 'T0' });
    const text = renderHouseLedgerExportText(bundle);

    expect(text).toContain(`# ${HOUSE_EXPORT_FORMAT} v${HOUSE_EXPORT_VERSION}`);
    expect(text).toContain('# household_id=hh_test');
    expect(text).toContain('# exported_at=T0');
    for (const file of bundle.files) {
      expect(text).toContain(`===== ${file.name} =====`);
    }
  });
});

describe('file naming (H5 multi-property)', () => {
  it('includes the property so 3 exports are distinguishable in Files', () => {
    expect(houseExportFileName('Lakeside Cabin', '2026-08-13')).toBe(
      'symply-house-lakeside-cabin-2026-08-13.csv.txt',
    );
  });

  it('falls back to "home" when the name has nothing usable', () => {
    expect(houseExportFileName('!!!', '2026-08-13')).toBe('symply-house-home-2026-08-13.csv.txt');
  });

  it('bounds a long property name', () => {
    const name = houseExportFileName('a'.repeat(200), '2026-08-13');
    expect(name.length).toBeLessThan(80);
  });
});
