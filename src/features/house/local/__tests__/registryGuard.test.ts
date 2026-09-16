/**
 * Registry guard (plan §1.5 verification).
 *
 * Every claim the House ledger registry makes about itself is asserted here
 * rather than trusted, because each failure mode is silent data loss rather
 * than a crash:
 *
 *  - a duplicate physical table name collapses two tables into one (S1)
 *  - a key field the row type does not have makes every row of that table
 *    invisible to sync (never diffs, never reaches a peer)
 *  - a natural key makes delete-then-recreate permanently divergent (S3a)
 *  - a missing deterministic-id builder makes offline double-creates survive as
 *    duplicate rows (S3b)
 *  - a Tier-B/C/D table in Tier A ships server-authoritative state as if it
 *    were device-authoritative
 */
import { HOUSE_DETERMINISTIC_ID_BUILDERS, HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS } from '../ids';
import {
  HOUSE_DETERMINISTIC_ID_TABLES,
  HOUSE_LEDGER_PHYSICAL_TABLES,
  HOUSE_LEDGER_TABLE_KEYS,
  HOUSE_LEDGER_TABLE_NAMES,
  HOUSE_REGISTERED_PHYSICAL_TABLES,
  HOUSE_REGISTERED_TABLE_COUNT,
  HOUSE_REGISTERED_TABLE_KEYS,
  HOUSE_REGISTERED_TABLE_NAMES,
  HOUSE_S2_DEFERRED_TABLES,
  HOUSE_STAGED_DETERMINISTIC_ID_TABLES,
  HOUSE_STAGED_TABLE_NAMES,
  HOUSE_STAGED_TABLES_WITHOUT_DTO,
  HOUSE_STAGED_WINDOWED_DATE_FIELDS,
  HOUSE_SUB_WAVE_TABLES,
  HOUSE_TIER_B_TABLES,
  HOUSE_TIER_C_TABLES,
  HOUSE_TIER_D_TABLES,
  HOUSE_WAVE_A_TABLE_COUNT,
  HOUSE_WAVE_B_TABLE_COUNT,
  HOUSE_WAVE_B_TABLE_NAMES,
  HOUSE_WAVE_C_TABLE_COUNT,
  HOUSE_WAVE_C_TABLE_NAMES,
  HOUSE_WINDOWED_DATE_FIELDS,
  type HouseLedgerTableName,
  type HouseRegisteredTableName,
  type HouseStagedTableName,
} from '../schema';

import { emptyHouseLedger } from './houseLedgerTestKit';

describe('House ledger registry — shape', () => {
  it('registers exactly the Wave A table count', () => {
    expect(HOUSE_LEDGER_TABLE_NAMES).toHaveLength(HOUSE_WAVE_A_TABLE_COUNT);
  });

  it('has no duplicate ledger names', () => {
    expect(new Set(HOUSE_LEDGER_TABLE_NAMES).size).toBe(HOUSE_LEDGER_TABLE_NAMES.length);
  });

  /**
   * Every ledger name maps to a physical table, and the ONLY physical name two
   * ledger names may share is `checklist_items`.
   *
   * This was a plain distinctness check until B4. It could be, because the two
   * claimants lived in different waves: Wave A registered `recurringChecklistItems`
   * and the labor-hub twin was still staged. B4 activated `visitChecklistItems`,
   * so both are live and the set is one smaller than the list — by design, and
   * exactly the S1 case the registry was built to handle.
   *
   * Asserted as "one known collision", not relaxed to "collisions allowed": a
   * SECOND duplicate would be a real registration bug, and this still catches it.
   */
  it('maps every ledger name to a physical D1 table, with one known collision (S1)', () => {
    const physical = HOUSE_LEDGER_TABLE_NAMES.map((t) => HOUSE_LEDGER_PHYSICAL_TABLES[t]);
    expect(physical.every(Boolean)).toBe(true);

    const duplicated = [...new Set(physical.filter((n, i) => physical.indexOf(n) !== i))];
    expect(duplicated).toEqual(['checklist_items']);
    // …and it is shared by exactly two names, not three.
    expect(physical.filter((n) => n === 'checklist_items')).toHaveLength(2);
    expect(new Set(physical).size).toBe(physical.length - 1);
  });

  it('renames the colliding checklist tables rather than registering them twice (S1)', () => {
    // `checklist_items` exists in schema-checklists.ts AND schema-labor-hub.ts.
    // Wave A registers the recurring one under a disambiguated ledger name; the
    // labor-hub one arrives in Wave B under its own name.
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.recurringChecklistItems).toBe('checklist_items');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.recurringChecklists).toBe('checklists');
    expect(HOUSE_LEDGER_TABLE_NAMES).not.toContain('checklistItems');
    expect(HOUSE_LEDGER_TABLE_NAMES).not.toContain('checklists');
  });

  it('keeps the other two colliding physical names out of the ledger entirely (S1)', () => {
    const physical = new Set(
      HOUSE_LEDGER_TABLE_NAMES.map((t) => HOUSE_LEDGER_PHYSICAL_TABLES[t]),
    );
    expect(physical.has('municipality_configs')).toBe(false);
    expect(physical.has('scheduled_notifications')).toBe(false);
  });
});

describe('House ledger registry — row keys', () => {
  it('keys every table on the surrogate `id`, never a natural key (S3a)', () => {
    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      expect(HOUSE_LEDGER_TABLE_KEYS[table]).toBe('id');
    }
  });

  it('has a table array on the ledger for every registered name', () => {
    const ledger = emptyHouseLedger() as unknown as Record<string, unknown>;
    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      expect(Array.isArray(ledger[table])).toBe(true);
    }
  });

  it('windows only tables that exist, on named date fields', () => {
    for (const [table, fields] of Object.entries(HOUSE_WINDOWED_DATE_FIELDS)) {
      expect(HOUSE_LEDGER_TABLE_NAMES).toContain(table as HouseLedgerTableName);
      expect(fields && fields.length).toBeGreaterThan(0);
    }
  });

  it('windows `tasks` on the columns D1 actually has', () => {
    // The D1 column is `next_due_date`; there is no `due_date`. A registry that
    // named a non-existent column would bucket every task always-resident and
    // the windowing would silently do nothing.
    expect(HOUSE_WINDOWED_DATE_FIELDS.tasks).toEqual([
      'next_due_date',
      'scheduled_work_date',
      'created_at',
    ]);
    expect(HOUSE_WINDOWED_DATE_FIELDS.checklistInstances).toEqual(['period_start']);
  });
});

describe('House ledger registry — deterministic ids (S3b)', () => {
  it('registers a builder for every table with a business uniqueness constraint', () => {
    for (const table of Object.keys(HOUSE_DETERMINISTIC_ID_TABLES) as HouseLedgerTableName[]) {
      expect(HOUSE_LEDGER_TABLE_NAMES).toContain(table);
      expect(typeof HOUSE_DETERMINISTIC_ID_BUILDERS[table]).toBe('function');
    }
  });

  it('registers no builder for a table that is not declared S3b', () => {
    for (const table of Object.keys(HOUSE_DETERMINISTIC_ID_BUILDERS) as HouseLedgerTableName[]) {
      expect(HOUSE_DETERMINISTIC_ID_TABLES[table]).toBeDefined();
    }
  });

  it('names the natural-key columns for each S3b table', () => {
    expect(HOUSE_DETERMINISTIC_ID_TABLES.householdMembers).toEqual(['household_id', 'user_id']);
    expect(HOUSE_DETERMINISTIC_ID_TABLES.settings).toEqual(['user_id', 'household_id', 'key']);
    expect(HOUSE_DETERMINISTIC_ID_TABLES.checklistItemCompletions).toEqual([
      'instance_id',
      'item_id',
    ]);
    expect(HOUSE_DETERMINISTIC_ID_TABLES.recurringReminders).toEqual([
      'household_id',
      'type',
      'reference_id',
      'period_key',
    ]);
    // H11 B2 promoted the first live pair that SHARES a natural key. Both are
    // `(task_id, contractor_id)`, so the columns alone cannot tell them apart —
    // only the id prefix does, which is what the distinctness test below covers.
    expect(HOUSE_DETERMINISTIC_ID_TABLES.contractorQuotes).toEqual(['task_id', 'contractor_id']);
    expect(HOUSE_DETERMINISTIC_ID_TABLES.quoteRequests).toEqual(['task_id', 'contractor_id']);
    // H11 C1 promoted the last two, and they are the second live pair whose
    // keys are indistinguishable by SHAPE: both are `(household_id, <a year>)`,
    // so for a property whose 2026 tax and 2026 assessment are both filed, only
    // the prefix keeps them apart.
    expect(HOUSE_DETERMINISTIC_ID_TABLES.propertyTaxes).toEqual(['household_id', 'tax_year']);
    expect(HOUSE_DETERMINISTIC_ID_TABLES.bcAssessmentData).toEqual([
      'household_id',
      'assessment_year',
    ]);
  });
});

describe('House ledger registry — tier disjointness', () => {
  // Over the WHOLE registry, not just what is live. A Wave-C entry that shadows
  // a Tier-D table would only be caught on the day that wave is activated —
  // i.e. after the facade and the screens have been written against it.
  const tierA = new Set(
    HOUSE_REGISTERED_TABLE_NAMES.map((t) => HOUSE_REGISTERED_PHYSICAL_TABLES[t]),
  );

  it.each([
    ['Tier B (server-authoritative)', HOUSE_TIER_B_TABLES],
    ['Tier C (global reference)', HOUSE_TIER_C_TABLES],
    ['Tier D (server-derived)', HOUSE_TIER_D_TABLES],
  ])('never ledgers a %s table', (_label, tables) => {
    for (const table of tables) {
      expect(tierA.has(table)).toBe(false);
    }
  });

  it('keeps the lower tiers disjoint from each other too', () => {
    const all = [...HOUSE_TIER_B_TABLES, ...HOUSE_TIER_C_TABLES, ...HOUSE_TIER_D_TABLES];
    expect(new Set(all).size).toBe(all.length);
  });

  it('excludes the two Tier-D tables that sit inside a Wave-C feature', () => {
    // `floor_plan_regions` and `home_project_geometry` live in the same Drizzle
    // files as the C2 and C4 tables and are easy to sweep up with them. Both are
    // machine output that H7 must re-derive on device — ledgering them would
    // sync a stale answer between members and call it authoritative.
    //
    // Both of their families are LIVE now, which is when this stops being
    // theoretical: the tempting place to add either is a block in `schema.ts`
    // that exists and is three lines long.
    // Both were Tier D and are Tier A as of the H13 D-wave.
    expect(tierA.has('floor_plan_regions')).toBe(true);
    expect(tierA.has('home_project_geometry')).toBe(true);
    expect(tierA.has('floor_plans')).toBe(true);
    expect(tierA.has('home_projects')).toBe(true);
  });
});

/**
 * H11 — the staged Wave B / Wave C registry.
 *
 * These tables are declared but not yet merged, so the guard is the ONLY thing
 * holding them to the rules until the facades arrive. Every assertion below is
 * one that would otherwise be re-litigated at activation time, when the cost of
 * getting it wrong is a shipped duplicate rather than a red test.
 */
describe('House ledger registry — Wave B/C staging', () => {
  it('registers each wave at the size the plan budgets, minus what cannot be a row', () => {
    expect(HOUSE_WAVE_B_TABLE_NAMES).toHaveLength(HOUSE_WAVE_B_TABLE_COUNT);
    expect(HOUSE_WAVE_C_TABLE_NAMES).toHaveLength(HOUSE_WAVE_C_TABLE_COUNT);
    expect(HOUSE_REGISTERED_TABLE_NAMES).toHaveLength(HOUSE_REGISTERED_TABLE_COUNT);
    expect(HOUSE_WAVE_A_TABLE_COUNT + HOUSE_WAVE_B_TABLE_COUNT + HOUSE_WAVE_C_TABLE_COUNT).toBe(
      HOUSE_REGISTERED_TABLE_COUNT,
    );
  });

  it('keeps live and staged sets disjoint', () => {
    // The activation move is "cut a block from HOUSE_WAVE_*_TABLE_KEYS, paste it
    // into HOUSE_LEDGER_TABLE_KEYS". A copy instead of a cut leaves the table in
    // both maps, and the spread in HOUSE_REGISTERED_TABLE_KEYS would silently
    // absorb the duplicate — the count assertion above would still pass, because
    // object keys dedupe. This is what actually catches it.
    //
    // ⚠️ Since C4 the loop is VACUOUS: the staged set is empty, so "no staged
    // name is live" is true of nothing. The two assertions after it are what
    // carry the check now, and both are still real — the sum fails if a live
    // name goes missing from the registered spread, and the equality below fails
    // if a staged map is quietly re-populated.
    const live = new Set<string>(HOUSE_LEDGER_TABLE_NAMES);
    for (const table of HOUSE_STAGED_TABLE_NAMES) {
      expect(live.has(table)).toBe(false);
    }
    expect(HOUSE_STAGED_TABLE_NAMES.length + HOUSE_LEDGER_TABLE_NAMES.length).toBe(
      HOUSE_REGISTERED_TABLE_NAMES.length,
    );
    // The terminal state, asserted positively: registered IS live, and nothing
    // is staged. `waveC.test.ts` names all ten emptied constructs one by one.
    expect(HOUSE_STAGED_TABLE_NAMES).toEqual([]);
    expect([...HOUSE_REGISTERED_TABLE_NAMES].sort()).toEqual([...HOUSE_LEDGER_TABLE_NAMES].sort());
  });

  it('keys every staged table on the surrogate `id` too (S3a)', () => {
    for (const table of HOUSE_REGISTERED_TABLE_NAMES) {
      expect(HOUSE_REGISTERED_TABLE_KEYS[table]).toBe('id');
    }
  });

  it('repeats exactly one physical name, and only for the S1 pair', () => {
    // Wave A could assert that physical names are unique. Across waves that is
    // FALSE by construction and must be: `recurringChecklistItems` and
    // `visitChecklistItems` are different tables that Drizzle happens to declare
    // under one name, which is the whole reason the ledger names differ.
    //
    // So the invariant weakens in a specific, checkable way — one repeat, that
    // repeat, nothing else. It also flags something for activation day:
    // `houseLedgerExport.sectionFileName` derives a CSV name from the physical
    // table, so these two would collide on `checklist_items.csv` and need
    // disambiguating there.
    const physical = HOUSE_REGISTERED_TABLE_NAMES.map((t) => HOUSE_REGISTERED_PHYSICAL_TABLES[t]);
    expect(physical.every(Boolean)).toBe(true);
    const repeated = physical.filter((name, i) => physical.indexOf(name) !== i);
    expect(repeated).toEqual(['checklist_items']);
    expect(new Set(physical).size).toBe(HOUSE_REGISTERED_TABLE_NAMES.length - 1);
  });

  it('resolves the `checklist_items` collision across the two waves that own it', () => {
    // This is the collision S1 is actually about, and it is invisible inside a
    // single wave: Wave A ledgers `schema-checklists.ts`'s table and Wave B
    // ledgers `schema-labor-hub.ts`'s, and a flat map cannot hold the physical
    // name twice. Both halves must be present and must differ.
    expect(HOUSE_REGISTERED_PHYSICAL_TABLES.recurringChecklistItems).toBe('checklist_items');
    expect(HOUSE_REGISTERED_PHYSICAL_TABLES.visitChecklistItems).toBe('checklist_items');
    expect(HOUSE_REGISTERED_TABLE_NAMES).not.toContain('checklistItems');
  });

  it('schedules nothing, because every sub-wave has activated', () => {
    // §11 gated the work sub-wave by sub-wave (B1 gated B2; all of them gated on
    // H6). A table registered but not scheduled would never have been built; a
    // table in two sub-waves would have been built twice against two gates.
    //
    // ⚠️ NONE OF THAT IS PROVABLE ANY MORE, and this comment is the record of
    // where each half went. C3 took the first half: with `HOUSE_SUB_WAVE_TABLES`
    // down to ONE key, `new Set(scheduled).size === scheduled.length` could only
    // catch a duplicate within C4, because "scheduled in two sub-waves" is not
    // expressible when there is one. C4 took the rest — the record is
    // `Record<never, …>`, so `scheduled` is `[]`, the dedupe is vacuous and
    // `scheduled.length === HOUSE_WAVE_C_TABLE_COUNT` compares 0 to 0.
    //
    // The floor that used to say `toBeGreaterThan(0)` was written FOR this day,
    // to make the test fail loudly rather than pass on two empty arrays. It has
    // done its job and is replaced by the positive terminal-state assertions
    // below rather than deleted, because the two-way comparison — a claim about
    // the registry as a whole — is still the shape that would catch a table
    // reappearing in the schedule without reappearing in the staged set.
    const scheduled = Object.values(HOUSE_SUB_WAVE_TABLES).flat();
    expect(new Set(scheduled).size).toBe(scheduled.length);
    expect([...scheduled].sort()).toEqual([...HOUSE_STAGED_TABLE_NAMES].sort());
    expect(scheduled.length).toBe(HOUSE_WAVE_C_TABLE_COUNT);
    expect(HOUSE_SUB_WAVE_TABLES).toEqual({});
    expect(HOUSE_STAGED_TABLE_NAMES).toEqual([]);
  });

  it('holds no staged window at all, and says so positively', () => {
    // Was "windows staged tables only on fields of tables that exist" plus
    // "never windows a staged table on a field the live registry already
    // claims", and BOTH walked `HOUSE_STAGED_WINDOWED_DATE_FIELDS`. C4 emptied
    // it, so both went vacuous on the same day — and the second one no longer
    // type-checks either, because indexing `HOUSE_WINDOWED_DATE_FIELDS` by a key
    // of an empty record has no meaningful type.
    //
    // The terminal state is asserted directly. The claims those two made are not
    // lost: `waveBCSchemaParity.test.ts` proves every LIVE window names a `text`
    // column D1 actually has, over all thirty-four of them, and that check runs
    // on the map that is now inhabited.
    expect(HOUSE_STAGED_WINDOWED_DATE_FIELDS).toEqual({});
    expect(Object.keys(HOUSE_STAGED_WINDOWED_DATE_FIELDS)).toEqual([]);
    // …and the live map is non-empty, so the guard that replaced these is not
    // itself vacuous.
    expect(Object.keys(HOUSE_WINDOWED_DATE_FIELDS).length).toBeGreaterThan(0);
    for (const table of Object.keys(HOUSE_WINDOWED_DATE_FIELDS) as HouseLedgerTableName[]) {
      expect(HOUSE_LEDGER_TABLE_NAMES).toContain(table);
      expect(HOUSE_WINDOWED_DATE_FIELDS[table]!.length).toBeGreaterThan(0);
    }
  });

  it('keeps the S2 joins out of the registry, and holds no DTO gap left', () => {
    const physical = new Set(
      HOUSE_REGISTERED_TABLE_NAMES.map((t) => HOUSE_REGISTERED_PHYSICAL_TABLES[t]),
    );
    // S2 tables are excluded BECAUSE they cannot be keyed — if one ever appears
    // in the registry, someone has given it an id without deciding how re-linking
    // survives an absorbing tombstone. This half is NOT vacuous and got sharper
    // at C4: their parent `home_projects` is now live, so the joins sit one
    // plausible line away from a block that exists. Two rather than three since
    // migration 0170, which took the third out of the schema entirely by moving
    // its link onto the parent row.
    expect(HOUSE_S2_DEFERRED_TABLES).toHaveLength(2);
    for (const table of HOUSE_S2_DEFERRED_TABLES) {
      expect(physical.has(table)).toBe(false);
    }
    expect(physical.has('home_projects')).toBe(true);
    // The DTO-gap half went vacuous when C4 wrote `LocalHomeProjectMilestone`,
    // so it is asserted as the empty list rather than as a loop over one.
    for (const table of HOUSE_STAGED_TABLES_WITHOUT_DTO) {
      expect(HOUSE_STAGED_TABLE_NAMES).toContain(table);
    }
    expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).toEqual([]);
  });
});

describe('House ledger registry — deterministic ids across every wave (S3b)', () => {
  it('registers a builder for every staged table with a uniqueness constraint', () => {
    for (const table of Object.keys(
      HOUSE_STAGED_DETERMINISTIC_ID_TABLES,
    ) as HouseStagedTableName[]) {
      expect(HOUSE_STAGED_TABLE_NAMES).toContain(table);
      expect(typeof HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS[table]).toBe('function');
    }
  });

  it('registers no staged builder for a table that is not declared S3b', () => {
    for (const table of Object.keys(
      HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS,
    ) as HouseStagedTableName[]) {
      expect(HOUSE_STAGED_DETERMINISTIC_ID_TABLES[table]).toBeDefined();
    }
  });

  it('holds no staged S3b entry at all, and says so positively', () => {
    // Both loops above became vacuous when C1 took `propertyTaxes` and
    // `bcAssessmentData` into the live maps, and §11.1.3's third lesson is that a
    // filter over an empty set passes exactly when it matters most. So the
    // terminal state is asserted directly: nothing left in Wave C carries a
    // uniqueIndex in D1, which `waveBCSchemaParity.test.ts` proves by parsing the
    // Drizzle sources rather than by restating a list.
    //
    // Both maps must empty TOGETHER. A builder left behind for a table that is
    // no longer staged is exactly the half-finished crossing the two loops above
    // can no longer catch.
    expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_TABLES)).toEqual([]);
    expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS)).toEqual([]);
    // …and every S3b claim in the registry now lives on the live side.
    expect(Object.keys(HOUSE_DETERMINISTIC_ID_TABLES).sort()).toEqual(
      Object.keys(HOUSE_DETERMINISTIC_ID_BUILDERS).sort(),
    );
  });

  it('gives every builder in the whole registry a distinct id prefix', () => {
    // `contractorQuotes` and `quoteRequests` share the natural key
    // `(task_id, contractor_id)`, and `householdMembers` /
    // `checklistItemCompletions` share a two-part shape. Feed every builder the
    // SAME parts: if two tables produce the same id, the merge would fold a quote
    // request into the quote it produced. Distinct prefixes are the only thing
    // preventing that, and nothing else in the codebase checks them.
    const builders = {
      ...HOUSE_DETERMINISTIC_ID_BUILDERS,
      ...HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS,
    } as Record<string, (...parts: unknown[]) => string>;
    const ids = Object.values(builders).map((build) => build('k1', 'k2', 'k3', 'k4'));
    // 18: the D-wave added `utr` and `msg`, the B-wave `aol` / `atl` / `aid`,
    // and Neighbours (0165) added `nbh`. `crp` / `crr` were added and then
    // withdrawn with the chat tables, which is why this number has gone down as
    // well as up.
    expect(ids).toHaveLength(18);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('claims a natural key only for tables the registry actually holds', () => {
    const registered = new Set<HouseRegisteredTableName>(HOUSE_REGISTERED_TABLE_NAMES);
    const declared = [
      ...Object.keys(HOUSE_DETERMINISTIC_ID_TABLES),
      ...Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_TABLES),
    ] as HouseRegisteredTableName[];
    for (const table of declared) expect(registered.has(table)).toBe(true);
    // `contractor_shares` and `labor_notification_preferences` carry uniqueIndexes
    // and are named in the plan's S3b list, but Wave B does not ledger them.
    // Declaring a natural key for an unledgered table asserts nothing.
    expect(declared).not.toContain('contractorShares');
    expect(declared).not.toContain('laborNotificationPreferences');
  });
});
