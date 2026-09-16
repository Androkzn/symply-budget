/**
 * Cheap guard — runs in the package's normal `npm test`.
 *
 * Cross-stage comparison is only meaningful if the House corpus is
 * byte-identical between runs. An unpinned generator turns an H3 "improvement"
 * into an artefact of a factory somebody tweaked. Field sets and per-row byte
 * sizes are pinned too, because that catches the subtle version: a row that
 * gained a field is a different corpus even at the same row count.
 *
 * Counts are pinned as literals (they are the composition table, derived by
 * hand against the plan's §4 envelope); the field/size pins are committed
 * snapshots, because hand-transcribing 21 field lists is a source of errors,
 * not of evidence.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  HOUSE_LEDGER_TABLE_KEYS,
  HOUSE_LEDGER_TABLE_NAMES,
} from '../../../../src/features/house/local/schema';

import { enableDevAssertions } from './lib/dev-global';
import {
  HOUSE_DEFAULT_SEED,
  HOUSE_REFERENCE_SPEC,
  corpusFingerprint,
  generateHouseLedger,
  lwwStampCount,
  rowCounts,
  rowIdAt,
  scaleId,
  totalRows,
} from './lib/house-ledger-factory';

enableDevAssertions();

describe('house scale corpus — pinned totals', () => {
  it('lands inside the plan §4 envelope at the reference scale', () => {
    const id = scaleId(HOUSE_REFERENCE_SPEC);
    expect(id.rows).toBe(14_557);
    expect(id.ops).toBe(21_836);
    // documents/requirements/House v2/… §4: Wave A total 8,000–20,000 at 5y.
    expect(id.rows).toBeGreaterThanOrEqual(8_000);
    expect(id.rows).toBeLessThanOrEqual(20_000);
  });

  it('lands inside the ten-year envelope too', () => {
    const id = scaleId({ years: 10 });
    expect(id.rows).toBe(28_867);
    expect(id.rows).toBeGreaterThanOrEqual(16_000);
    expect(id.rows).toBeLessThanOrEqual(40_000);
  });

  it('pins every scale the baseline reports', () => {
    expect(scaleId({ years: 1 })).toEqual({ years: 1, adults: 2, rows: 3_109, ops: 4_664 });
    expect(scaleId({ years: 3 })).toEqual({ years: 3, adults: 2, rows: 8_833, ops: 13_250 });
    expect(scaleId({ years: 5 })).toEqual({ years: 5, adults: 2, rows: 14_557, ops: 21_836 });
    expect(scaleId({ years: 10 })).toEqual({ years: 10, adults: 2, rows: 28_867, ops: 43_301 });
  });

  it('grows with adults on the tables that really are per-adult', () => {
    // 4 adults doubles the accumulating tables and the memberships, and leaves
    // the property itself alone.
    const two = rowCounts({ years: 5, adults: 2 });
    const four = rowCounts({ years: 5, adults: 4 });
    expect(four.maintenanceCompletions).toBe(two.maintenanceCompletions * 2);
    expect(four.householdMembers).toBe(4);
    expect(four.householdSpaces).toBe(two.householdSpaces);
    expect(four.households).toBe(1);
  });

  it('pins per-table row counts at the reference scale', () => {
    expect(rowCounts(HOUSE_REFERENCE_SPEC)).toEqual({
      households: 1,
      householdMembers: 2,
      householdSpaces: 18,
      tasks: 1_800,
      maintenanceCompletions: 5_500,
      maintenanceSubtasks: 3_500,
      maintenanceTaskNotes: 400,
      homeFeatures: 45,
      appliances: 22,
      applianceServiceHistory: 150,
      garbageSchedules: 1,
      seasonalChecklists: 20,
      seasonalChecklistItems: 240,
      recurringChecklists: 8,
      recurringChecklistItems: 64,
      checklistInstances: 280,
      checklistItemCompletions: 1_700,
      householdNotes: 46,
      settings: 40,
      recurringReminders: 120,
      taskDrafts: 600,
    });
  });

  it('honours the plan §4 per-table drivers, not just the total', () => {
    const five = rowCounts({ years: 5 });
    const ten = rowCounts({ years: 10 });
    // maintenanceCompletions — House's `expenses`
    expect(five.maintenanceCompletions).toBeGreaterThanOrEqual(3_000);
    expect(five.maintenanceCompletions).toBeLessThanOrEqual(8_000);
    expect(ten.maintenanceCompletions).toBeGreaterThanOrEqual(6_000);
    expect(ten.maintenanceCompletions).toBeLessThanOrEqual(16_000);
    // maintenanceSubtasks — 3–5 per AI-enriched task
    expect(five.maintenanceSubtasks).toBeGreaterThanOrEqual(2_000);
    expect(five.maintenanceSubtasks).toBeLessThanOrEqual(5_000);
    // tasks
    expect(five.tasks).toBeGreaterThanOrEqual(1_200);
    expect(five.tasks).toBeLessThanOrEqual(2_500);
    expect(ten.tasks).toBeGreaterThanOrEqual(2_500);
    expect(ten.tasks).toBeLessThanOrEqual(5_000);
    // checklist instances + completions, together
    expect(five.checklistInstances + five.checklistItemCompletions).toBeGreaterThanOrEqual(1_000);
    expect(five.checklistInstances + five.checklistItemCompletions).toBeLessThanOrEqual(3_000);
    // taskDrafts
    expect(five.taskDrafts).toBeGreaterThanOrEqual(200);
    expect(five.taskDrafts).toBeLessThanOrEqual(1_000);
  });
});

describe('house scale corpus — determinism', () => {
  it('is a pure function of (years, adults, seed)', () => {
    const a = generateHouseLedger({ years: 1, adults: 2, seed: HOUSE_DEFAULT_SEED });
    const b = generateHouseLedger({ years: 1, adults: 2, seed: HOUSE_DEFAULT_SEED });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('changes with the seed, so the seed is really wired through', () => {
    const a = generateHouseLedger({ years: 1, adults: 2, seed: HOUSE_DEFAULT_SEED });
    const b = generateHouseLedger({ years: 1, adults: 2, seed: HOUSE_DEFAULT_SEED + 1 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('pins the corpus fingerprint the comparator refuses to diff across', () => {
    expect(corpusFingerprint()).toBe('a7c9454e863ba24c');
  });

  it('generates the row counts it promised', () => {
    const ledger = generateHouseLedger(HOUSE_REFERENCE_SPEC);
    expect(totalRows(ledger)).toBe(14_557);
    const counts = rowCounts(HOUSE_REFERENCE_SPEC);
    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      expect(ledger[table]).toHaveLength(counts[table]);
    }
  });
});

describe('house scale corpus — row shapes', () => {
  const ledger = generateHouseLedger({ years: 1, adults: 2, seed: HOUSE_DEFAULT_SEED });

  it('gives every row its registered key field', () => {
    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      const keyField = HOUSE_LEDGER_TABLE_KEYS[table];
      for (const row of ledger[table]) {
        expect(typeof row[keyField]).toBe('string');
      }
    }
  });

  it('gives every row a UNIQUE key within its table', () => {
    // A duplicate key would make the indexed cursor fall back to the scan
    // cursor, quietly changing which code path every apply measurement runs.
    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      const keyField = HOUSE_LEDGER_TABLE_KEYS[table];
      const keys = ledger[table].map((row) => String(row[keyField]));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('never emits a key whose value is undefined', () => {
    // `Object.keys` counts a key assigned `undefined`, but `JSON.stringify`
    // drops it and `diffLedger` never emits it — so such a key would be given a
    // watermark stamp that the product would never create, inflating the single
    // number (edit.lww.charsPerRowChar) this corpus exists to report.
    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      for (const row of ledger[table]) {
        for (const [field, value] of Object.entries(row)) {
          expect(`${table}.${field}=${value === undefined ? 'undefined' : 'defined'}`).toBe(
            `${table}.${field}=defined`,
          );
        }
      }
    }
  });

  it('pins the field set and per-row JSON size of every table', () => {
    const shape: Record<string, { fields: string[]; bytes: number }> = {};
    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      const row = ledger[table][0]!;
      shape[table] = {
        fields: Object.keys(row).sort(),
        bytes: JSON.stringify(row).length,
      };
    }
    expect(shape).toMatchSnapshot();
  });

  it('keeps `tasks` the widest row, which is what N5 is about', () => {
    const widths = HOUSE_LEDGER_TABLE_NAMES.map((table) => ({
      table,
      fields: Object.keys(ledger[table][0]!).length,
    })).sort((a, b) => b.fields - a.fields);
    expect(widths[0]!.table).toBe('tasks');
    // Pinned: the N5 arithmetic (stamps ≈ fields × rows) is quoted from it.
    expect(widths[0]!.fields).toBe(41);
  });

  it('addresses rows by id the way the phases do', () => {
    expect(rowIdAt(ledger, 'maintenanceCompletions', 0)).toBe('mcp_0');
    expect(rowIdAt(ledger, 'tasks', 3)).toBe('task_3');
  });
});

describe('house scale corpus — the watermark map', () => {
  const ledger = generateHouseLedger({ years: 1, adults: 2, seed: HOUSE_DEFAULT_SEED });

  it('carries one stamp per field per row — a household that has SYNCED', () => {
    let expected = 0;
    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      for (const row of ledger[table]) expected += Object.keys(row).length;
    }
    expect(lwwStampCount(ledger)).toBe(expected);
    expect(lwwStampCount(ledger)).toBe(45_225);
  });

  it('stamps every row under its own key, in every table', () => {
    const lww = ledger.lww as Record<string, Record<string, unknown>>;
    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      const keyField = HOUSE_LEDGER_TABLE_KEYS[table];
      expect(Object.keys(lww[table] ?? {})).toHaveLength(ledger[table].length);
      for (const row of ledger[table]) {
        expect(lww[table]![String(row[keyField])]).toBeDefined();
      }
    }
  });

  it('stamps BELOW the wall clock the phases use, so a peer edit still wins', () => {
    const lww = ledger.lww as Record<string, Record<string, { f: Record<string, string> }>>;
    const first = Object.values(Object.values(lww.tasks!)[0]!.f)[0]!;
    const wall = Number(first.split('-')[0]);
    expect(wall).toBeLessThan(1_800_000_000_000);
  });

  it('is the N5 hazard, quantified', () => {
    const rowsJson = JSON.stringify(
      Object.fromEntries(HOUSE_LEDGER_TABLE_NAMES.map((t) => [t, ledger[t]])),
    );
    const lwwJson = JSON.stringify(ledger.lww);
    // The map is nearly twice the data it describes. Pinned loosely: this guard
    // exists to catch it COLLAPSING (a stage that silently stopped building the
    // map would make every persist number look like a win), not to grade it.
    expect(lwwJson.length / rowsJson.length).toBeGreaterThan(1.5);
    expect(lwwJson.length / rowsJson.length).toBeLessThan(2.5);
  });
});

describe('house scale corpus — identity is distinct from Budget', () => {
  it('uses its own seed and household id', () => {
    expect(HOUSE_DEFAULT_SEED).not.toBe(0x5c41e);
    const ledger = generateHouseLedger({ years: 1 });
    expect(String(ledger.household.id)).toBe('hh_local_4d7e2f9a1c6b8305');
  });

  it('hashes to something no Budget run could produce', () => {
    const houseProbe = createHash('sha256')
      .update(JSON.stringify(generateHouseLedger({ years: 1 })), 'utf8')
      .digest('hex')
      .slice(0, 16);
    expect(houseProbe).toBe(corpusFingerprint());
  });
});
