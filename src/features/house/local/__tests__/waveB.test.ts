/**
 * H11 Wave B — the labor hub, as a specification.
 *
 * Wave B is where House stops being a to-do list and starts holding a record of
 * other people's work: who came, what they quoted, what was agreed, what was
 * checked off on site. Three properties of that data drive every decision here,
 * and each test below names the one it is defending:
 *
 *  1. **Quotes have a business identity.** D1 enforces one quote per contractor
 *     per task; the ledger cannot, so the id must carry that identity instead.
 *  2. **The on-site surface is written offline, by definition.** A basement with
 *     no signal is the normal case, not the edge case, so the convergence rules
 *     matter more here than anywhere in Wave A.
 *  3. **Half of Wave B is event-shaped** — visits, messages, payments, photos —
 *     and event tables are what windowing exists for.
 *
 * Sub-waves B1 (the contractor record), B2 (quoting), B3 (the project) and B4
 * (the on-site surface) have all gone live, so **Wave B is complete** and this
 * file has become a record of four crossings rather than a specification for
 * staged tables. Each crossing keeps its own block, because the manoeuvre is the
 * one C1–C4 repeat, and because a half-finished one — the table live in the
 * ledger but still claimed by the Wave B maps — passes every count assertion in
 * the suite while being exactly the bug the split exists to prevent.
 *
 * The final block asserts the terminal state: the Wave B maps are EMPTY, not
 * removed and not stubbed. `schema.ts` argues that choice at length; the tests
 * here prove it holds in every one of the six maps at once.
 */
import { HOUSE_DETERMINISTIC_ID_BUILDERS, HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS } from '../ids';
import {
  HOUSE_DETERMINISTIC_ID_TABLES,
  HOUSE_LEDGER_PHYSICAL_TABLES,
  HOUSE_LEDGER_TABLE_KEYS,
  HOUSE_LEDGER_TABLE_NAMES,
  HOUSE_STAGED_DETERMINISTIC_ID_TABLES,
  HOUSE_STAGED_TABLES_WITHOUT_DTO,
  HOUSE_STAGED_TABLE_NAMES,
  HOUSE_STAGED_WINDOWED_DATE_FIELDS,
  HOUSE_SUB_WAVE_TABLES,
  HOUSE_WAVE_B_PHYSICAL_TABLES,
  HOUSE_WAVE_B_TABLE_COUNT,
  HOUSE_WAVE_B_TABLE_KEYS,
  HOUSE_WAVE_B_TABLE_NAMES,
  HOUSE_WINDOWED_DATE_FIELDS,
  type HouseLedgerTableName,
} from '../schema';

/**
 * The Wave B maps, viewed as plain records.
 *
 * `HouseWaveBTableName` is `never` now that B4 has crossed, which is the honest
 * type for a wave with nothing left in it — but it also means these maps can no
 * longer be INDEXED by a table name, because there is no name to index them
 * with. Every "the crossing left no copy behind" assertion below would have had
 * to be deleted along with the type that made it expressible.
 *
 * Casting to a plain record keeps them running instead. They still mean
 * something: they are what would fail if a future edit reinstated an entry in a
 * staged map for a table that is live.
 */
const stagedRowKeys = HOUSE_WAVE_B_TABLE_KEYS as Record<string, string | undefined>;
const stagedPhysical = HOUSE_WAVE_B_PHYSICAL_TABLES as Record<string, string | undefined>;
const stagedNames = HOUSE_WAVE_B_TABLE_NAMES as readonly string[];
const stagedWindows = HOUSE_STAGED_WINDOWED_DATE_FIELDS as Record<
  string,
  readonly string[] | undefined
>;
const stagedNaturalKeys = HOUSE_STAGED_DETERMINISTIC_ID_TABLES as Record<
  string,
  readonly string[] | undefined
>;

/** The four tables sub-wave B1 promoted out of Wave B and into the ledger. */
const B1_TABLES: HouseLedgerTableName[] = [
  'contractors',
  'contractorVisits',
  'contractorRepresentatives',
  'contractorDocuments',
];

/** The four sub-wave B2 promoted. */
const B2_TABLES: HouseLedgerTableName[] = [
  'appointments',
  'quotes',
  'contractorQuotes',
  'quoteRequests',
];

/** The four sub-wave B3 promoted — the project and the children it owns. */
const B3_TABLES: HouseLedgerTableName[] = [
  'projects',
  'projectMilestones',
  'projectPayments',
  'projectProgressPhotos',
];

/** The seven sub-wave B4 promoted — the on-site surface, and the last of them. */
const B4_TABLES: HouseLedgerTableName[] = [
  'visitChecklists',
  'visitChecklistItems',
  'visitNotes',
  'checklistItemPhotos',
  'contractorMessages',
  'contractorJobRatings',
  'contractorIssueResolutions',
];

/**
 * All nineteen, which is what the windowing check below has to walk now that
 * `HOUSE_WAVE_B_TABLE_NAMES` is empty. Filtering the empty side is the trap;
 * walking the tables the wave ACTUALLY contained is the same claim with content
 * in it.
 */
const ALL_WAVE_B_TABLES: HouseLedgerTableName[] = [
  ...B1_TABLES,
  ...B2_TABLES,
  ...B3_TABLES,
  ...B4_TABLES,
];

describe('Wave B — sub-wave sequencing (plan §11)', () => {
  it('has no Wave B sub-wave left to schedule', () => {
    // §11 sequenced by dependency: B1 (the contractor record) gated B2 (quoting
    // against that contractor), which gated B3 (the project a quote becomes),
    // which gated B4 (what happens when the contractor turns up). Shipping them
    // as one 19-table lump is what the gates existed to prevent — a quote row
    // with no contractor to hang it on.
    //
    // `HOUSE_SUB_WAVE_TABLES` is the REMAINING work, so all four are gone. The
    // activated keys are GONE, not present-and-empty: an entry left as `[]`
    // would keep the partition passing while telling a reader nothing. C1–C4
    // have since left it the same way, so the schedule is now empty outright —
    // which `waveC.test.ts` asserts alongside the other nine constructs C4
    // emptied.
    for (const activated of ['B1', 'B2', 'B3', 'B4']) {
      expect(Object.keys(HOUSE_SUB_WAVE_TABLES)).not.toContain(activated);
    }
    expect(Object.keys(HOUSE_SUB_WAVE_TABLES)).toEqual([]);
  });

  it('leaves no staged schedule at all, in either wave', () => {
    // The partition assertion, restated for the terminal state. It used to say
    // "with Wave B empty, everything scheduled must be a Wave C table and vice
    // versa"; since C4 both sides are empty, so the comparison is `[] === []`
    // and the two positive assertions beside it are what carry the check.
    //
    // This is the one that would have failed if a B4 table had been dropped
    // from the ledger without being put back — and it still would, via the
    // 63-table count `waveC.test.ts` asserts on the live side.
    const scheduled = Object.values(HOUSE_SUB_WAVE_TABLES).flat();
    expect([...scheduled].sort()).toEqual([...HOUSE_STAGED_TABLE_NAMES].sort());
    expect(stagedNames).toEqual([]);
    expect(HOUSE_STAGED_TABLE_NAMES).toEqual([]);
  });
});

/**
 * B1 activated — the first sub-wave to make the crossing, and the one whose
 * shape B2–B4 and C1–C4 copy.
 *
 * The move is a CUT: key, physical name and window all leave the Wave B maps in
 * the same edit that adds them to the live ones. A copy passes every count
 * assertion in the suite (the `HOUSE_REGISTERED_*` spreads dedupe object keys)
 * while leaving the table claiming to be both merged and unbuilt, so the halves
 * are asserted separately here — present live, absent staged.
 */
describe('Wave B — B1 has crossed into the ledger', () => {
  it.each(B1_TABLES)('%s is keyed live and no longer staged', (table) => {
    expect(HOUSE_LEDGER_TABLE_KEYS[table]).toBe('id');
    expect(HOUSE_LEDGER_TABLE_NAMES).toContain(table);
    expect(stagedNames).not.toContain(table);
  });

  it('carried its physical names across unchanged', () => {
    // The physical name is what the sync mapping and the CSV export section are
    // derived from. A name that drifted during the move would produce an export
    // section that is always empty and a mapping that never matches — both
    // silent.
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.contractors).toBe('contractors');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.contractorVisits).toBe('contractor_visits');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.contractorRepresentatives).toBe(
      'contractor_representatives',
    );
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.contractorDocuments).toBe('contractor_documents');
    for (const table of B1_TABLES) {
      expect(stagedPhysical[table]).toBeUndefined();
    }
  });

  it('needs no deterministic id, because none of the four is unique in D1', () => {
    // Two members adding the same plumber offline get two plumbers, and that is
    // correct: `contractors` carries no uniqueIndex, and two visits from one
    // contractor on one day are two visits. Minting a deterministic id here
    // would be the opposite bug — merging rows the member meant to keep apart.
    for (const table of B1_TABLES) {
      expect(
        stagedNaturalKeys[table],
      ).toBeUndefined();
    }
  });
});

/**
 * B2 activated — quoting, and the first sub-wave to carry S3b tables across.
 *
 * B1's crossing moved keys, physical names and windows. B2's moves those AND a
 * natural key with its id builder, which is the part with a second half in
 * another file: a table in `HOUSE_DETERMINISTIC_ID_TABLES` whose builder is
 * still in `HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS` fails `registryGuard`'s
 * "builder for every S3b table" check, and the reverse fails its mirror. Both
 * halves are asserted here against the LIVE maps.
 *
 * B2 also wrote two DTOs that did not exist, so the third half of its crossing
 * is `HOUSE_STAGED_TABLES_WITHOUT_DTO` shrinking.
 */
describe('Wave B — B2 has crossed into the ledger', () => {
  it.each(B2_TABLES)('%s is keyed live and no longer staged', (table) => {
    expect(HOUSE_LEDGER_TABLE_KEYS[table]).toBe('id');
    expect(HOUSE_LEDGER_TABLE_NAMES).toContain(table);
    expect(stagedNames).not.toContain(table);
  });

  it('carried its physical names across unchanged', () => {
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.appointments).toBe('appointments');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.quotes).toBe('quotes');
    // The two quote tables collide in English and not in SQL, which is why
    // neither needed an S1 rename. If `contractorQuotes` ever pointed at
    // `quotes`, the ledger would merge a task-scoped estimate into a labor-hub
    // one and the export would write a single file for both.
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.contractorQuotes).toBe('contractor_quotes');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.quoteRequests).toBe('quote_requests');
    for (const table of B2_TABLES) {
      expect(stagedPhysical[table]).toBeUndefined();
    }
  });

  it('moved the two natural keys AND their builders to the live maps', () => {
    expect(HOUSE_DETERMINISTIC_ID_TABLES.contractorQuotes).toEqual(['task_id', 'contractor_id']);
    expect(HOUSE_DETERMINISTIC_ID_TABLES.quoteRequests).toEqual(['task_id', 'contractor_id']);
    expect(typeof HOUSE_DETERMINISTIC_ID_BUILDERS.contractorQuotes).toBe('function');
    expect(typeof HOUSE_DETERMINISTIC_ID_BUILDERS.quoteRequests).toBe('function');
    // …and left no copy behind. A builder in both maps would still be fed the
    // same parts by the guard's distinctness check, so it would pass; the
    // failure would be `HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS` naming a table
    // that is no longer staged, which is what this catches.
    const stagedBuilders = Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS);
    const stagedKeys = Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_TABLES);
    for (const table of ['contractorQuotes', 'quoteRequests']) {
      expect(stagedBuilders).not.toContain(table);
      expect(stagedKeys).not.toContain(table);
    }
  });

  it('keeps the request and the quote it produced apart despite one natural key', () => {
    // Both are unique on `(task_id, contractor_id)` in D1 — the same pair, two
    // tables. The per-table prefix in `deterministicRowId` is the only thing
    // stopping the merge from folding a request into the quote that answered it.
    const build = HOUSE_DETERMINISTIC_ID_BUILDERS as unknown as Record<
      string,
      (...parts: string[]) => string
    >;
    const quote = build.contractorQuotes!('task-1', 'ctr-1');
    const request = build.quoteRequests!('task-1', 'ctr-1');
    expect(quote).not.toBe(request);
  });

  it('windows all four, because quoting is entirely event-shaped', () => {
    expect(HOUSE_WINDOWED_DATE_FIELDS.appointments).toEqual(['scheduled_date', 'created_at']);
    expect(HOUSE_WINDOWED_DATE_FIELDS.contractorQuotes).toEqual(['submitted_at', 'created_at']);
    expect(HOUSE_WINDOWED_DATE_FIELDS.quoteRequests).toEqual(['requested_at', 'created_at']);
    // `quotes` is the one B2 table with no domain date at all: `valid_until` is
    // an expiry rather than an occurrence, and bucketing by it would file a
    // quote under a month in which nothing happened.
    expect(HOUSE_WINDOWED_DATE_FIELDS.quotes).toEqual(['created_at']);
    const stagedKeys = Object.keys(HOUSE_STAGED_WINDOWED_DATE_FIELDS);
    for (const table of B2_TABLES) expect(stagedKeys).not.toContain(table);
  });

  it('took the two DTO gaps off the list by writing the DTOs', () => {
    // §3.2: a ledger row IS the DTO. `contractor_quotes` and `quote_requests`
    // had none — the only remote surface for them is typed `{ quotes: any[] }` —
    // so B2's first step was authoring them from the Drizzle columns.
    //
    // The `not.toContain` pair below is vacuous now that the list is `[]`, so it
    // is kept only as the statement of intent it always was and the count is the
    // real assertion. Note the casts are gone: `HouseStagedTableName` is `never`
    // since C4, so `'contractorQuotes' as HouseStagedTableName` no longer
    // compiles — which is the type doing its job.
    expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).not.toContain('contractorQuotes');
    expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).not.toContain('quoteRequests');
    // NONE remains. B4 later wrote the other two Wave-B gaps (`visitNotes`,
    // `contractorIssueResolutions`) the same way, C1 wrote `utilityReminders`
    // and C4 wrote the last, `homeProjectMilestones`.
    expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).toEqual([]);
  });
});

/**
 * B3 activated — the project, and the first sub-wave to carry a PARENT AND ITS
 * CHILDREN across together.
 *
 * B1's crossing moved keys, physical names and windows; B2's moved those plus a
 * natural key and its builder. B3's moves the least of the three — no natural
 * key, no DTO gap — and is nonetheless the riskiest, because its correctness
 * lives mostly outside this file: three of its four tables cascade from
 * `projects` in D1, and a ledger delete is a tombstone rather than a foreign
 * key. The registry cannot express that; `localProjectsApi.deleteProject` is
 * where it is proved, and `CONTRACTOR_CASCADE_TABLES` is where the OTHER
 * direction (`contractors` → `projects`) is proved.
 *
 * So this block asserts the registry half and names the other half, rather than
 * pretending the crossing was only a registry edit.
 */
describe('Wave B — B3 has crossed into the ledger', () => {
  it.each(B3_TABLES)('%s is keyed live and no longer staged', (table) => {
    expect(HOUSE_LEDGER_TABLE_KEYS[table]).toBe('id');
    expect(HOUSE_LEDGER_TABLE_NAMES).toContain(table);
    expect(stagedNames).not.toContain(table);
  });

  it('carried its physical names across, and did NOT collide with `home_projects`', () => {
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.projects).toBe('projects');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.projectMilestones).toBe('project_milestones');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.projectPayments).toBe('project_payments');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.projectProgressPhotos).toBe('project_progress_photos');
    // The trap this sub-wave sets for a reader: `projects` (labor hub) and
    // `home_projects` (the C4 renovation planner) are two different features in
    // two different Drizzle files, and only the ledger-name prefix keeps them
    // apart. A `projects` entry pointing at `home_projects` would look entirely
    // plausible and would merge two unrelated features into one table.
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.projects).not.toBe('home_projects');
    for (const table of B3_TABLES) {
      expect(stagedPhysical[table]).toBeUndefined();
    }
  });

  it('needs no deterministic id, because none of the four is unique in D1', () => {
    // Checked against the schema by `waveBCSchemaParity.test.ts`; asserted here
    // as intent. Two members offline are genuinely ALLOWED to add two deposit
    // payments, two milestones with the same title and two photos of the same
    // wall — those are two rows. A deterministic id would merge work the members
    // meant to keep apart, which is the opposite failure to the one S3b guards,
    // and it is the reason B3 moved nothing between the two S3b maps.
    for (const table of B3_TABLES) {
      expect(HOUSE_DETERMINISTIC_ID_TABLES[table]).toBeUndefined();
      expect(stagedNaturalKeys[table]).toBeUndefined();
      expect(HOUSE_DETERMINISTIC_ID_BUILDERS[table]).toBeUndefined();
    }
  });

  it('windows the parent and its children on DIFFERENT fields, unlike B4 will', () => {
    // A project spans months by definition and its children are events strung
    // along that span, so each buckets by its own moment. That is the opposite
    // of the `visitChecklists` / `visitChecklistItems` rule below, where both
    // share one field so a checklist can never hydrate without its items — and
    // the difference is safe only because `localProjectsApi` reads a project's
    // children THROUGH the project, never standalone.
    expect(HOUSE_WINDOWED_DATE_FIELDS.projects).toEqual(['start_date', 'created_at']);
    expect(HOUSE_WINDOWED_DATE_FIELDS.projectMilestones).toEqual(['due_date', 'created_at']);
    expect(HOUSE_WINDOWED_DATE_FIELDS.projectPayments).toEqual([
      'due_date',
      'paid_date',
      'created_at',
    ]);
    expect(HOUSE_WINDOWED_DATE_FIELDS.projectProgressPhotos).toEqual(['taken_at', 'created_at']);
    // Both crossed with B4, so the "same bucket" claim is now on the live map.
    expect(HOUSE_WINDOWED_DATE_FIELDS.visitChecklists).toEqual(
      HOUSE_WINDOWED_DATE_FIELDS.visitChecklistItems,
    );
    const stagedKeys = Object.keys(HOUSE_STAGED_WINDOWED_DATE_FIELDS);
    for (const table of B3_TABLES) expect(stagedKeys).not.toContain(table);
  });

  it('left the DTO-gap list untouched, because all four DTOs already existed', () => {
    // B2's crossing shrank this list by writing two DTOs from the Drizzle
    // columns. B3's did not have to: `Project`, `ProjectMilestone`,
    // `ProjectPayment` and `ProjectProgressPhoto` are all declared in
    // `src/api/projects.ts`. Three of them diverge from D1 — see `types.ts` —
    // but a divergent DTO is still a DTO, and correcting one would change what
    // every screen already reads.
    //
    // The list has been `[]` since C4 wrote the last gap, so the loop below is
    // vacuous and the count is the assertion. C4 also proved the limit of this
    // list from the other side: two of its NINE existing DTOs were present and
    // LOSSY — each omitting the `created_at` its table windows on — and nothing
    // here could ever have seen that.
    expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).toEqual([]);
    for (const table of B3_TABLES) {
      expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).not.toContain(table as string);
    }
  });
});

/**
 * B4 activated — the on-site surface, and the crossing that emptied Wave B.
 *
 * The last sub-wave is the one that turns every "Wave B holds N" assertion into
 * "Wave B holds nothing", so it is also the one where a half-finished crossing
 * would be least visible: with the wave empty, any assertion that filters
 * `HOUSE_WAVE_B_TABLE_NAMES` passes vacuously. That is what the `staged*` record
 * casts above are for, and this block is where they earn their keep — each one
 * would fail if a future edit reinstated a staged entry for a table that is live.
 */
describe('Wave B — B4 has crossed, and Wave B is now empty', () => {
  it('put all seven on the ledger', () => {
    for (const table of B4_TABLES) {
      expect(HOUSE_LEDGER_TABLE_NAMES).toContain(table);
      expect(HOUSE_LEDGER_TABLE_KEYS[table]).toBe('id');
    }
  });

  it('left no trace of them in any staged map — the half-finished-crossing check', () => {
    for (const table of B4_TABLES) {
      expect(stagedNames).not.toContain(table);
      expect(stagedRowKeys[table]).toBeUndefined();
      expect(stagedPhysical[table]).toBeUndefined();
      expect(stagedWindows[table]).toBeUndefined();
      expect(stagedNaturalKeys[table]).toBeUndefined();
    }
  });

  it('closed the last two labor-hub DTO gaps by writing them', () => {
    // `visit_notes` had a backend router and no client module;
    // `contractor_issue_resolutions` had neither. §3.2 says a ledger row IS the
    // DTO, so there was nothing to inherit and both had to be authored from the
    // Drizzle columns. What remained on the list was Wave C's, not Wave B's —
    // and C4 closed that too, so the list is now empty outright.
    expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).toEqual([]);
    for (const table of B4_TABLES) {
      expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).not.toContain(table as string);
    }
  });

  it('reports the wave as empty rather than as removed or stubbed', () => {
    // The count is the load-bearing one: `HOUSE_WAVE_B_TABLE_COUNT` staying
    // meaningful at 0 is what keeps `A + B + C = REGISTERED` checkable through
    // the whole programme. A stub entry kept "to avoid a `never` type" would
    // satisfy the arithmetic while lying about what is live.
    expect(HOUSE_WAVE_B_TABLE_COUNT).toBe(0);
    expect(stagedNames.filter((t) => (B4_TABLES as string[]).includes(t))).toEqual([]);
  });

  it('no longer schedules any Wave B sub-wave', () => {
    // An activated sub-wave leaves `HOUSE_SUB_WAVE_TABLES` entirely; with B4
    // gone the schedule was Wave C only, and C1–C4 have since left it too, so
    // the record is `{}` and its key type is `never`.
    expect(Object.keys(HOUSE_SUB_WAVE_TABLES)).toEqual([]);
  });
});

describe('Wave B — S1, the second `checklist_items`', () => {
  it('registers the labor-hub table under a name Wave A did not take', () => {
    // This is the hazard the plan opens with. `HOUSE_LEDGER_TABLE_KEYS` and its
    // Wave B/C siblings are flat maps keyed by ledger name; two tables sharing a
    // physical name can only both be registered if one is renamed. Wave A took
    // `recurringChecklistItems`; the visit checklist takes this one.
    // Asserted on the LIVE map: B4 carried this table across, so both
    // claimants of `checklist_items` are now in the ledger at once — which is
    // the state the rename existed to make survivable.
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.visitChecklistItems).toBe('checklist_items');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.recurringChecklistItems).toBe('checklist_items');
    expect(HOUSE_LEDGER_TABLE_NAMES).not.toContain('checklistItems');
  });

  it('registers no other Wave B name that differs from its physical table', () => {
    // Every unnecessary rename is a place where the export filename, the sync
    // mapping and the screen's mental model drift apart. One is the price of S1;
    // a second would be carelessness.
    // Over the LIVE registry, because Wave B is empty and filtering it would
    // pass vacuously. The labor hub's two deliberate renames are the recurring
    // twin (Wave A's) and the visit twin (B4's); anything else is carelessness.
    const renamed = HOUSE_LEDGER_TABLE_NAMES.filter((table) => {
      const expected = table.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      return HOUSE_LEDGER_PHYSICAL_TABLES[table] !== expected;
    });
    expect(renamed.sort()).toEqual(
      ['recurringChecklistItems', 'recurringChecklists', 'visitChecklistItems'].sort(),
    );
  });
});

describe('Wave B — row keys and natural keys', () => {
  it('has no staged row key left to check, and says so positively', () => {
    // This was `for (const table of HOUSE_WAVE_B_TABLE_NAMES) expect(key).toBe('id')`
    // and it has asserted NOTHING since B4 emptied the wave — the §11.1.3
    // vacuity trap, sitting green for two sub-waves. Found during C2's sweep of
    // every loop over a staged map, which is now a standing step of an
    // activation rather than a C1 one-off.
    //
    // The terminal state is asserted directly instead. `HouseWaveBTableName` is
    // `never`, so an entry cannot be added to `HOUSE_WAVE_B_TABLE_KEYS` without
    // widening the type — and the S3a claim for every table that IS keyed lives
    // in `registryGuard`'s `HOUSE_REGISTERED_TABLE_KEYS` loop, which runs over
    // all 63 and cannot go vacuous while the registry is inhabited.
    expect(HOUSE_WAVE_B_TABLE_NAMES).toEqual([]);
    expect(Object.keys(HOUSE_WAVE_B_TABLE_KEYS)).toEqual([]);
  });

  it('declares a natural key for exactly the one table D1 still constrains here', () => {
    // Everything else left in Wave B is genuinely multi-instance: two visits
    // from the same contractor on the same day are two visits, two notes are two
    // notes. Giving those a deterministic id would be the opposite bug — it
    // would merge rows the member meant to keep apart. The other two constrained
    // tables, `contractorQuotes` and `quoteRequests`, went live with B2.
    // `contractorJobRatings` crossed with B4, so the claim is asserted on the
    // live map — and Wave B holding none is now the terminal state, not a gap.
    //
    // The staged map is EMPTY rather than holding Wave C's two: C1 took
    // `propertyTaxes` and `bcAssessmentData` across, and nothing left in Wave C
    // carries a uniqueIndex. That is asserted here as the observable
    // consequence; `waveC.test.ts` asserts it positively and
    // `waveBCSchemaParity.test.ts` proves it against the Drizzle sources.
    expect(HOUSE_DETERMINISTIC_ID_TABLES.contractorJobRatings).toBeDefined();
    expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_TABLES)).toEqual([]);
  });

  it('derives quote identity from the pair D1 makes unique', () => {
    // `contractor_quotes_task_contractor_unique_idx`. Quotes arrive by PDF and
    // are extracted by AI, so "both of us uploaded the same estimate" is an
    // ordinary Tuesday. With random ids the merge keeps both and the comparison
    // screen shows the same contractor twice at two prices.
    //
    // Asserted against the LIVE map now that B2 has crossed — the claim moved
    // with the tables, and re-asserting it here is what proves the move did not
    // drop it on the way.
    expect(HOUSE_DETERMINISTIC_ID_TABLES.contractorQuotes).toEqual(['task_id', 'contractor_id']);
    expect(HOUSE_DETERMINISTIC_ID_TABLES.quoteRequests).toEqual(['task_id', 'contractor_id']);
  });

  it('derives rating identity from the visit alone', () => {
    // One call-out, one rating — `contractor_job_ratings_visit_id_idx`. Two
    // members rating the same visit offline must produce one row that LWW
    // resolves, not two ratings that both count toward the average.
    expect(HOUSE_DETERMINISTIC_ID_TABLES.contractorJobRatings).toEqual(['visit_id']);
  });
});

describe('Wave B — windowing policy', () => {
  it('has no staged Wave-B window left, and every moved one is on the live map', () => {
    // The second vacuous loop C2's sweep found, and the more dangerous of the
    // two because its SHAPE is the one §11.1.3 warns about by name: a
    // `HOUSE_WAVE_B_TABLE_NAMES.filter(...)` over an empty array resolves to
    // `[]` and passes, so "every staged Wave-B table is windowed" has been true
    // by construction since B4 rather than by fact.
    //
    // What is actually still worth asserting is the OTHER end of the crossing:
    // all nineteen windows arrived on the live map and none was dropped in
    // transit. That is a claim about the registry as it stands, so it cannot go
    // vacuous while Wave B has ever existed. `contractors` and
    // `contractorRepresentatives` are the two deliberate absences — the address
    // book, argued in the test below.
    expect(HOUSE_WAVE_B_TABLE_NAMES).toEqual([]);
    const unwindowed = ALL_WAVE_B_TABLES.filter(
      (t) => HOUSE_WINDOWED_DATE_FIELDS[t] === undefined,
    );
    expect(unwindowed.sort()).toEqual(['contractorRepresentatives', 'contractors']);
  });

  it('leaves the contractor address book resident now that it is live', () => {
    // `contractors` and their representatives are the address book: a few dozen
    // rows that every labor screen reads on first render. Windowing them would
    // buy nothing and would hide a plumber whose record happens to be old. The
    // claim moved maps with the tables, so it is re-asserted against the live
    // one — otherwise the move could have dropped it and nothing would notice.
    expect(HOUSE_WINDOWED_DATE_FIELDS.contractors).toBeUndefined();
    expect(HOUSE_WINDOWED_DATE_FIELDS.contractorRepresentatives).toBeUndefined();
    // …and the windows that DID move left no copy behind. Indexing the staged
    // map by a B1 name no longer compiles, so the check is over its keys.
    const stagedKeys = Object.keys(HOUSE_STAGED_WINDOWED_DATE_FIELDS);
    for (const table of B1_TABLES) expect(stagedKeys).not.toContain(table);
  });

  it('keeps B1 windowed on the fields it was staged with', () => {
    // `visit_date` is notNull and `document_date` is nullable; both keep the
    // `created_at` fallback, because first-match-wins costs nothing when the
    // lead field is set and is the difference between a bucketed row and an
    // always-resident one when it is not.
    expect(HOUSE_WINDOWED_DATE_FIELDS.contractorVisits).toEqual(['visit_date', 'created_at']);
    expect(HOUSE_WINDOWED_DATE_FIELDS.contractorDocuments).toEqual([
      'document_date',
      'created_at',
    ]);
  });

  it('puts a visit checklist and its items in the same bucket', () => {
    // Both window on `created_at`, which is the same instant for a checklist and
    // the items generated with it. Giving the items a different field — say
    // `checked_at` — would let a checklist hydrate with none of its items, which
    // renders as "the contractor checked nothing" rather than as missing data.
    expect(HOUSE_WINDOWED_DATE_FIELDS.visitChecklists).toEqual(['created_at']);
    expect(HOUSE_WINDOWED_DATE_FIELDS.visitChecklistItems).toEqual(['created_at']);
  });

  it('falls back to `created_at` wherever the domain date is nullable', () => {
    // `document_date`, `start_date`, `due_date`, `taken_at`, `resolved_at` and
    // `sent_at` are all nullable in D1. First-match-wins means a null simply
    // moves to the next field; without a fallback the row would land in the
    // always-resident bucket and the windowing would quietly stop applying to
    // exactly the rows a member has not filled in yet.
    const nullableDomainDate: HouseLedgerTableName[] = [
      'checklistItemPhotos',
      'contractorMessages',
      'contractorIssueResolutions',
    ];
    for (const table of nullableDomainDate) {
      const fields = HOUSE_WINDOWED_DATE_FIELDS[table]!;
      expect(fields.length).toBeGreaterThan(1);
      expect(fields[fields.length - 1]).toBe('created_at');
    }
    // Same rule, now on the live side. `document_date` is nullable, and so is
    // every one of B3's four domain dates — `start_date`, `due_date`,
    // `paid_date` and `taken_at` are all optional in the D1 schema, which is
    // precisely why the rule had to travel across with them rather than being
    // re-derived. The assertion follows the tables into the live map instead of
    // being deleted with the staged entries; deleting it is how a rule that was
    // proved for four staged tables silently stops being proved for four live
    // ones.
    const liveNullableDomainDate: HouseLedgerTableName[] = [
      'contractorDocuments',
      'projects',
      'projectMilestones',
      'projectPayments',
      'projectProgressPhotos',
    ];
    for (const table of liveNullableDomainDate) {
      const fields = HOUSE_WINDOWED_DATE_FIELDS[table]!;
      expect(fields.length).toBeGreaterThan(1);
      expect(fields[fields.length - 1]).toBe('created_at');
    }
  });

  it('leads with the domain date even where D1 marks it notNull', () => {
    // `visit_date`, `scheduled_date`, `submitted_at` and `timestamp` are notNull,
    // so the fallback is rarely reached — but they are `text` columns, and
    // notNull is not well-formed. The fallback stays; what matters is the order,
    // because bucketing a visit by when the row was written rather than when the
    // contractor came would scatter one job across two months.
    expect(HOUSE_WINDOWED_DATE_FIELDS.contractorVisits?.[0]).toBe('visit_date');
    expect(HOUSE_WINDOWED_DATE_FIELDS.appointments?.[0]).toBe('scheduled_date');
    expect(HOUSE_WINDOWED_DATE_FIELDS.contractorQuotes?.[0]).toBe('submitted_at');
    expect(HOUSE_WINDOWED_DATE_FIELDS.visitNotes?.[0]).toBe('timestamp');
  });
});
