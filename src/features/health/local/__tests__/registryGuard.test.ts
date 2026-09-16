import { readFileSync } from 'fs';
import { resolve } from 'path';

import { HEALTH_DETERMINISTIC_ID_BUILDERS } from '../ids';
import {
  HEALTH_DETERMINISTIC_ID_TABLES,
  HEALTH_LEDGER_PHYSICAL_TABLES,
  HEALTH_LEDGER_TABLE_KEYS,
  HEALTH_LEDGER_TABLE_NAMES,
  HEALTH_RANDOM_ID_TABLES,
  HEALTH_TIER_B_TABLES,
  HEALTH_TIER_C_TABLES,
  HEALTH_TIER_D_TABLES,
  HEALTH_TIER_OFF_TABLES,
  HEALTH_WAVE_A_TABLE_COUNT,
  HEALTH_WINDOWED_DATE_FIELDS,
  type HealthLedgerTableName,
} from '../schema';

/**
 * He1 registry guard.
 *
 * This suite deliberately reads `backend/src/db/schema-health.ts` and derives
 * the truth from it, rather than restating what the plan says. The registry is
 * a claim ABOUT the D1 schema; a test that only compares the registry to itself
 * would stay green through exactly the schema change that breaks the merge.
 */

const SCHEMA_PATH = resolve(__dirname, '../../../../../backend/src/db/schema-health.ts');

type ParsedTable = { name: string; body: string; columns: string[]; hasUnique: boolean };

function parseHealthSchema(): Map<string, ParsedTable> {
  const src = readFileSync(SCHEMA_PATH, 'utf8');
  const out = new Map<string, ParsedTable>();

  // Split on table declarations; each chunk runs up to the next declaration.
  const decl = /export const \w+ = sqliteTable\(\s*'([\w]+)'/g;
  const starts: Array<{ name: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = decl.exec(src)) !== null) {
    starts.push({ name: m[1], index: m.index });
  }

  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
    const body = src.slice(start.index, end);
    const columns = [...body.matchAll(/(?:text|integer|real)\('([\w]+)'/g)].map((c) => c[1]);
    out.set(start.name, {
      name: start.name,
      body,
      columns,
      hasUnique: /\bunique\(\)/.test(body),
    });
  });

  return out;
}

const schema = parseHealthSchema();

const WAVE_A_PHYSICAL = Object.values(HEALTH_LEDGER_PHYSICAL_TABLES);

describe('Health ledger registry — shape', () => {
  it('registers EXACTLY the 8 Wave A tables', () => {
    expect(HEALTH_LEDGER_TABLE_NAMES).toHaveLength(HEALTH_WAVE_A_TABLE_COUNT);
    expect(HEALTH_WAVE_A_TABLE_COUNT).toBe(8);
    expect([...HEALTH_LEDGER_TABLE_NAMES].sort()).toEqual(
      [
        'bodyMeasurements',
        'habitLogs',
        'healthEntries',
        'healthGoals',
        'nutritionEntries',
        'userHabits',
        'waterEntries',
        'weightEntries',
      ].sort(),
    );
  });

  it('notes are NOT a ninth ledger key — they stay in MMKV (plan §1.5)', () => {
    expect(HEALTH_LEDGER_TABLE_NAMES).not.toContain('notes');
    expect(WAVE_A_PHYSICAL).not.toContain('health_notes');
  });

  it('S3a — every row key is `id`, never a natural key', () => {
    for (const [table, key] of Object.entries(HEALTH_LEDGER_TABLE_KEYS)) {
      expect(`${table}:${key}`).toBe(`${table}:id`);
    }
  });

  it('maps every ledger name to a real physical table', () => {
    for (const [ledgerName, physical] of Object.entries(HEALTH_LEDGER_PHYSICAL_TABLES)) {
      expect(HEALTH_LEDGER_TABLE_NAMES).toContain(ledgerName as HealthLedgerTableName);
      expect(schema.has(physical)).toBe(true);
    }
    expect(Object.keys(HEALTH_LEDGER_PHYSICAL_TABLES)).toHaveLength(8);
  });
});

describe('Health ledger registry — deterministic id rule, both directions', () => {
  it('every deterministic-id table HAS a builder', () => {
    for (const table of Object.keys(HEALTH_DETERMINISTIC_ID_TABLES) as HealthLedgerTableName[]) {
      expect(HEALTH_DETERMINISTIC_ID_BUILDERS[table]).toBeInstanceOf(Function);
    }
  });

  it('every random-id table has NO builder', () => {
    for (const table of HEALTH_RANDOM_ID_TABLES) {
      expect(HEALTH_DETERMINISTIC_ID_BUILDERS[table]).toBeUndefined();
    }
  });

  it('the two sets are disjoint and cover the whole registry', () => {
    const deterministic = Object.keys(HEALTH_DETERMINISTIC_ID_TABLES) as HealthLedgerTableName[];
    const overlap = deterministic.filter((t) => HEALTH_RANDOM_ID_TABLES.includes(t));
    expect(overlap).toEqual([]);
    expect([...deterministic, ...HEALTH_RANDOM_ID_TABLES].sort()).toEqual(
      [...HEALTH_LEDGER_TABLE_NAMES].sort(),
    );
  });

  /**
   * The load-bearing one. A `unique()` in D1 means two offline devices can mint
   * "the same" row twice and both survive the merge (S3b) — so it REQUIRES a
   * deterministic id. Conversely a table without one must keep random ids, or a
   * real second reading in the same day gets LWW'd away.
   */
  it('presence of a D1 unique() constraint matches builder registration exactly', () => {
    const mismatches: string[] = [];

    for (const [ledgerName, physical] of Object.entries(HEALTH_LEDGER_PHYSICAL_TABLES)) {
      const parsed = schema.get(physical);
      expect(parsed).toBeDefined();
      const constrained = parsed!.hasUnique;
      const registered = Boolean(
        HEALTH_DETERMINISTIC_ID_TABLES[ledgerName as HealthLedgerTableName],
      );
      if (constrained !== registered) {
        mismatches.push(
          `${physical}: D1 unique()=${constrained} but registry deterministic=${registered}`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('the constrained set is exactly habit_logs + health_goals', () => {
    const constrained = WAVE_A_PHYSICAL.filter((t) => schema.get(t)?.hasUnique).sort();
    expect(constrained).toEqual(['habit_logs', 'health_goals']);
  });

  it('weight_entries specifically carries NO unique() and NO builder', () => {
    // Two weigh-ins in one day are two real readings. A `weight_${date}` builder
    // would LWW one away — silent data loss in the app's flagship metric.
    expect(schema.get('weight_entries')?.hasUnique).toBe(false);
    expect(HEALTH_DETERMINISTIC_ID_BUILDERS.weightEntries).toBeUndefined();
  });
});

describe('Health ledger registry — windowed reads', () => {
  it('windows only registered tables, on columns that really exist', () => {
    for (const [ledgerName, fields] of Object.entries(HEALTH_WINDOWED_DATE_FIELDS)) {
      const table = ledgerName as HealthLedgerTableName;
      expect(HEALTH_LEDGER_TABLE_NAMES).toContain(table);

      const physical = HEALTH_LEDGER_PHYSICAL_TABLES[table];
      const columns = schema.get(physical)?.columns ?? [];
      for (const field of fields ?? []) {
        expect(columns).toContain(field);
      }
    }
  });

  it('userHabits and healthGoals are deliberately always-resident', () => {
    expect(HEALTH_WINDOWED_DATE_FIELDS.userHabits).toBeUndefined();
    expect(HEALTH_WINDOWED_DATE_FIELDS.healthGoals).toBeUndefined();
  });
});

describe('Health ledger registry — tier disjointness', () => {
  it('no Tier A table appears in any other tier', () => {
    const others = new Set([
      ...HEALTH_TIER_B_TABLES,
      ...HEALTH_TIER_C_TABLES,
      ...HEALTH_TIER_D_TABLES,
      ...HEALTH_TIER_OFF_TABLES,
    ]);
    const leaked = WAVE_A_PHYSICAL.filter((t) => others.has(t));
    expect(leaked).toEqual([]);
  });

  it('the derived weekly-average cache is Tier D, never ledgered', () => {
    expect(HEALTH_TIER_D_TABLES).toContain('health_weekly_weight_averages');
    expect(WAVE_A_PHYSICAL).not.toContain('health_weekly_weight_averages');
  });
});
