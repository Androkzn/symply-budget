/**
 * H11 Wave C — the long tail, as a specification.
 *
 * Wave C is four unrelated features (utilities, floor plans, garden plans, home
 * projects) that share only their position in the queue. What makes it worth its
 * own suite is that it is the first wave where the plan's table count and the
 * ledgerable table count differ, and the reasons are exactly the hazards §1.5
 * predicted:
 *
 *  - three tables have **no primary key at all** (S2), and neither available fix
 *    is safe today;
 *  - one is **Tier D** and sits in the same Drizzle file as tables that are not;
 *  - two are keyed on a **year**, which is an `integer` and therefore cannot be a
 *    bucket field however much one would like it to be.
 *
 * Registering 26 tables because the plan says 26 would have shipped all four
 * problems. This suite is the record of not doing that.
 *
 * Sub-waves C1 (utilities), C2 (floor plans), C3 (garden plans) and C4 (home
 * projects) have all gone live, so **Wave C is complete and so is the whole
 * registry** — 63 live, 0 staged. (62 until 2026-08-15, when
 * `applianceDocuments` was registered: a table that was in NO wave and so in
 * neither of those numbers, corrected rather than crossed — `schema.ts`.) Each
 * crossing keeps its own block, because a
 * half-finished one (the table live in the ledger but still claimed by the Wave
 * C maps) passes every count assertion in the suite while being exactly the bug
 * the split exists to prevent.
 *
 * The final block asserts the terminal state, which is a bigger claim than
 * `waveB.test.ts`'s equivalent: at B4 one wave emptied, at C4 **every staged
 * construct in the registry emptied at once**. Ten of them, listed there and
 * asserted positively rather than by filtering the empty side — which is
 * §11.1.3's own lesson applied to the moment it stops being possible to learn.
 */
import { HOUSE_DETERMINISTIC_ID_BUILDERS, HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS } from '../ids';
import {
  HOUSE_DETERMINISTIC_ID_TABLES,
  HOUSE_LEDGER_PHYSICAL_TABLES,
  HOUSE_LEDGER_TABLE_KEYS,
  HOUSE_LEDGER_TABLE_NAMES,
  HOUSE_REGISTERED_TABLE_COUNT,
  HOUSE_S2_DEFERRED_TABLES,
  HOUSE_STAGED_DETERMINISTIC_ID_TABLES,
  HOUSE_STAGED_TABLES_WITHOUT_DTO,
  HOUSE_STAGED_TABLE_NAMES,
  HOUSE_STAGED_WINDOWED_DATE_FIELDS,
  HOUSE_SUB_WAVE_TABLES,
  HOUSE_TIER_C_TABLES,
  HOUSE_TIER_D_TABLES,
  HOUSE_WAVE_A_TABLE_COUNT,
  HOUSE_WAVE_B_TABLE_COUNT,
  HOUSE_WAVE_C_PHYSICAL_TABLES,
  HOUSE_WAVE_C_TABLE_COUNT,
  HOUSE_WAVE_C_TABLE_KEYS,
  HOUSE_WAVE_C_TABLE_NAMES,
  HOUSE_WINDOWED_DATE_FIELDS,
  type HouseLedgerTableName,
} from '../schema';

/**
 * The Wave C maps viewed as plain records.
 *
 * These used to be castable *for convenience*; since C4 they have to be. Every
 * one of them is now keyed by `never`, so they can no longer be INDEXED by a
 * table name — there is no name left to index them with — and every
 * "the crossing left no copy behind" assertion below would have had to be
 * deleted along with the type that made it expressible. `waveB.test.ts` reached
 * this point at B4 and took the same escape; this file takes it for the same
 * reason and with the same limit: the casts do not weaken any claim, because
 * what they assert is that a name is ABSENT.
 *
 * Note `stagedNaturalKeys` and `HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS` have
 * been EMPTY since C1 and `stagedRowKeys` / `stagedPhysical` / `stagedWindows`
 * joined them at C4, so every per-table assertion against them now passes
 * whatever the registry says. They are kept because they catch the one thing
 * that would still be wrong — an entry left behind, or reinstated, for a table
 * that is live — and every block that uses them also asserts the terminal state
 * positively, which is the only form of that check with content in it.
 */
const stagedRowKeys = HOUSE_WAVE_C_TABLE_KEYS as Record<string, string | undefined>;
const stagedPhysical = HOUSE_WAVE_C_PHYSICAL_TABLES as Record<string, string | undefined>;
const stagedNames = HOUSE_WAVE_C_TABLE_NAMES as readonly string[];
const stagedWindows = HOUSE_STAGED_WINDOWED_DATE_FIELDS as Record<
  string,
  readonly string[] | undefined
>;
const stagedNaturalKeys = HOUSE_STAGED_DETERMINISTIC_ID_TABLES as Record<
  string,
  readonly string[] | undefined
>;

/** The five tables sub-wave C1 promoted out of Wave C and into the ledger. */
const C1_TABLES: HouseLedgerTableName[] = [
  'utilityAccounts',
  'utilityBills',
  'propertyTaxes',
  'bcAssessmentData',
  'utilityReminders',
];

/** The three tables sub-wave C2 promoted. */
const C2_TABLES: HouseLedgerTableName[] = [
  'floorPlans',
  'floorPlanMarkers',
  'floorPlanAnnotations',
];

/** The four tables sub-wave C3 promoted. */
const C3_TABLES: HouseLedgerTableName[] = [
  'gardenPlans',
  'gardenPlanObjects',
  'gardenPlanMarkers',
  'gardenPlanBoundaryDrafts',
];

/** The three of C3's four that are drawing content and stay resident. */
const C3_DRAWING_TABLES: HouseLedgerTableName[] = [
  'gardenPlans',
  'gardenPlanObjects',
  'gardenPlanMarkers',
];

/** The ten tables sub-wave C4 promoted — and the last crossing of the programme. */
const C4_TABLES: HouseLedgerTableName[] = [
  'homeProjects',
  'homeProjectBudgetLines',
  'homeProjectSelections',
  'homeProjectPhases',
  'homeProjectMilestones',
  'homeProjectBlockers',
  'homeProjectAttachments',
  'homeProjectPlanLinks',
  'homeProjectComments',
  'homeProjectActivity',
];

/** The four of C4's ten that ARE the project and are read whole on every open. */
const C4_DEFINITION_TABLES: HouseLedgerTableName[] = [
  'homeProjectBudgetLines',
  'homeProjectPhases',
  'homeProjectPlanLinks',
  'homeProjectSelections',
];

/**
 * All twenty-two Wave-C tables, which is what the windowing check has to walk
 * now that `HOUSE_WAVE_C_TABLE_NAMES` is empty. Filtering the empty side is the
 * trap; walking the tables the wave ACTUALLY contained is the same claim with
 * content in it — `waveB.test.ts` built `ALL_WAVE_B_TABLES` for this at B4.
 */
const ALL_WAVE_C_TABLES: HouseLedgerTableName[] = [
  ...C1_TABLES,
  ...C2_TABLES,
  ...C3_TABLES,
  ...C4_TABLES,
];

describe('Wave C — what the plan budgets vs what can be a row', () => {
  it('has nothing left to schedule, four tables short of the plan', () => {
    // §11 said 14 for C4. Ten of the fourteen `home_project_*` tables could be
    // ledger rows; the other four are accounted for by the two tests below, and
    // they are the whole of the gap between the plan's 66 and the 62 the
    // registry counted before `applianceDocuments` — a table in no wave at all —
    // took it to 63.
    expect(HOUSE_WAVE_C_TABLE_NAMES).toEqual([]);
    expect(HOUSE_WAVE_C_TABLE_COUNT).toBe(0);
    expect(HOUSE_WAVE_C_TABLE_NAMES).toHaveLength(HOUSE_WAVE_C_TABLE_COUNT);
    // The three exclusions, restated as arithmetic: 13 declared in the Drizzle
    // file, 10 registered, 1 Tier D and 2 S2. It was 14/10/1/3 until migration
    // 0170 dropped `home_project_tasks` for a column on the parent.
    expect(C4_TABLES).toHaveLength(10);
    expect(HOUSE_S2_DEFERRED_TABLES).toHaveLength(2);
  });

  it('keeps the three-addend arithmetic exact across the C4 crossing', () => {
    // `A + B + C = REGISTERED` is what stops a table being lost or double-counted
    // during an activation. C1 moved the boundary — 40 + 0 + 22 became
    // 45 + 0 + 17 — C2 moved it to 48 + 0 + 14, C3 to 52 + 0 + 10 and C4 to
    // 62 + 0 + 0. The total is what must not move. A crossing that dropped a
    // table would leave 61 + 0 + 0, which is what this catches; a crossing that
    // COPIED one would leave the maps overlapping, which `registryGuard`'s
    // disjointness check catches instead.
    //
    // Both staged addends are now zero, and the sum is kept rather than
    // collapsed to `63 === 63`: the identity still fails the moment a table
    // leaves `HOUSE_LEDGER_TABLE_KEYS` without arriving anywhere, which is the
    // edit this has always existed to catch.
    //
    // **The 2026-08-15 correction moved the TOTAL, which no crossing may do.**
    // `applianceDocuments` was in neither staged map — Wave B and Wave C were
    // already empty when it was found — so 62 + 0 + 0 became 63 + 0 + 0 rather
    // than one addend paying another. That is the signature of a correction as
    // opposed to a crossing, and it is exactly why the numbers below are pinned
    // as literals: a real activation must leave them alone.
    // H13 D-wave took this from 63 to 68. Like the `applianceDocuments`
    // correction it grew the FIRST addend without shrinking either of the other
    // two — both were already zero — but for the opposite reason: nothing was
    // omitted here, five tables were re-tiered out of Tier D once H7 made the
    // derivation local. A crossing pays one addend from another; a correction
    // and a re-tier both grow the total.
    //
    // 75 → 78 is the third way this addend can grow and the plainest: three
    // tables that did not exist when the waves were drawn. Migration 0165 added
    // the Neighbours family, Tier A on arrival. Like the two cases above it
    // leaves the other addends at zero, because there is no staged bucket left
    // for a new table to cross from.
    expect(HOUSE_WAVE_A_TABLE_COUNT).toBe(78);
    expect(HOUSE_WAVE_A_TABLE_COUNT + HOUSE_WAVE_B_TABLE_COUNT + HOUSE_WAVE_C_TABLE_COUNT).toBe(
      HOUSE_REGISTERED_TABLE_COUNT,
    );
    expect(HOUSE_REGISTERED_TABLE_COUNT).toBe(78);
    // …and the live count is not merely equal to the total by declaration.
    expect(HOUSE_LEDGER_TABLE_NAMES).toHaveLength(HOUSE_REGISTERED_TABLE_COUNT);
  });

  it('no longer schedules any sub-wave at all', () => {
    // An activated sub-wave leaves `HOUSE_SUB_WAVE_TABLES` entirely rather than
    // becoming `[]` — an empty array would keep the partition passing while
    // telling a reader nothing. The union type narrows with it, so a stale
    // `HOUSE_SUB_WAVE_TABLES.C4` in a screen or a test fails to COMPILE rather
    // than reading `undefined`; that is what happened to this file's own C4
    // block, which is the mechanism working.
    expect(HOUSE_SUB_WAVE_TABLES).toEqual({});
    expect(Object.keys(HOUSE_SUB_WAVE_TABLES)).toEqual([]);
    // The partition, asserted in BOTH directions. With the record empty this is
    // `[] === []`, which is why the two positive assertions above carry the
    // weight now — see the terminal-state block at the foot of this file, where
    // every emptied construct is named individually rather than inferred from
    // one of them.
    const scheduled = Object.values(HOUSE_SUB_WAVE_TABLES).flat();
    expect([...scheduled].sort()).toEqual([...HOUSE_STAGED_TABLE_NAMES].sort());
    expect(HOUSE_STAGED_TABLE_NAMES).toEqual([]);
  });

  it('excludes the three PK-less join tables (S2)', () => {
    // `home_project_spaces` carries two foreign keys and nothing else — not even
    // a timestamp. There is no field to key a row on, and both ways of inventing
    // one are worse than waiting:
    //
    //   random id        → two members linking the same space offline produce two
    //                      link rows, which is S3b all over again;
    //   deterministic id → converges, but link/unlink/re-link is the normal user
    //                      action on a join row and the tombstone is absorbing,
    //                      so the second link would never come back (S3a, the
    //                      exact bug Budget's B6 was).
    //
    // The plan's own answer is to model them as an array on the parent, which is
    // a backend change. Until then they stay out.
    //
    // Checked against the LIVE map since C4 crossed. The staged map is `{}`, so
    // the pre-crossing version of this test — `Object.values(
    // HOUSE_WAVE_C_PHYSICAL_TABLES)` — would now be a set of nothing and would
    // pass for every table in the world. The danger moved with the tables: the
    // tempting place to add `home_project_tasks` is now the LIVE block in
    // `schema.ts`, four lines below `homeProjectPlanLinks`.
    const live = new Set(HOUSE_LEDGER_TABLE_NAMES.map((t) => HOUSE_LEDGER_PHYSICAL_TABLES[t]));
    const staged = new Set(Object.values(HOUSE_WAVE_C_PHYSICAL_TABLES));
    expect(HOUSE_S2_DEFERRED_TABLES).toHaveLength(2);
    for (const table of HOUSE_S2_DEFERRED_TABLES) {
      expect(live.has(table)).toBe(false);
      expect(staged.has(table)).toBe(false);
    }
    // The precedent already existed in the tree — `projects.linked_task_ids` is
    // a JSON array on the parent rather than a join table — and migration 0170
    // finally followed it for `home_project_tasks`, which is why that name is no
    // longer in this list. The parent IS live, so what is left is not "the whole
    // feature is out": it is two links missing from a feature that otherwise
    // works, and `home_project_tasks` is the worked example of closing one.
    expect(live.has('home_projects')).toBe(true);
    // The dropped table must not reappear anywhere: not live, not staged, and
    // not deferred. A name in a deferral list for a table nobody declares reads
    // as work outstanding when the work is done.
    expect(live.has('home_project_tasks')).toBe(false);
    expect(staged.has('home_project_tasks')).toBe(false);
    expect(HOUSE_S2_DEFERRED_TABLES).not.toContain('home_project_tasks');
  });

  it('excludes the two Tier-D tables that live inside C2 and C4', () => {
    // `floor_plan_regions` is the segmentation model's output and
    // `home_project_geometry` is the generated layout. Both are re-derived on
    // device by H7 or the feature is off — the one thing they must never be is
    // synced between members, because then a stale derivation from one phone
    // becomes the shared truth on the other.
    //
    // Checked against BOTH maps since C2 crossed, and that is not belt and
    // braces. The staged half of this assertion was the whole check while floor
    // plans were staged; the moment they went live the danger moved with them,
    // because the tempting place to add `floor_plan_regions` is now the LIVE
    // block in `schema.ts`, three lines below `floorPlanAnnotations`. A staged-
    // only check would have gone quietly weaker on exactly the sub-wave that
    // made the mistake possible.
    const staged = new Set(Object.values(HOUSE_WAVE_C_PHYSICAL_TABLES));
    const live = new Set(HOUSE_LEDGER_TABLE_NAMES.map((t) => HOUSE_LEDGER_PHYSICAL_TABLES[t]));
    // Both were Tier D through C2/C4 and are LIVE as of the H13 D-wave. What
    // still has to hold is that they came in through the ledger map and not by
    // reappearing in a staged one — the staged maps stay empty either way.
    for (const table of ['floor_plan_regions', 'home_project_geometry']) {
      expect(staged.has(table)).toBe(false);
      expect(live.has(table)).toBe(true);
      expect(HOUSE_TIER_D_TABLES).not.toContain(table);
    }
    expect(HOUSE_TIER_D_TABLES).toHaveLength(0);
  });

  it('has no staged row key left to check, and says so positively', () => {
    // This was `for (const table of HOUSE_WAVE_C_TABLE_NAMES) expect(key).toBe('id')`
    // and it asserts NOTHING now that C4 has emptied the wave — the §11.1.3
    // vacuity trap, arriving on the last crossing exactly as `waveB.test.ts`
    // recorded it arriving on B4.
    //
    // The terminal state is asserted directly instead. `HouseWaveCTableName` is
    // `never`, so an entry cannot be added to `HOUSE_WAVE_C_TABLE_KEYS` without
    // widening the type — and the S3a claim for every table that IS keyed lives
    // in `registryGuard`'s `HOUSE_REGISTERED_TABLE_KEYS` loop, which runs over
    // all 63 and cannot go vacuous while the registry is inhabited.
    expect(HOUSE_WAVE_C_TABLE_NAMES).toEqual([]);
    expect(Object.keys(HOUSE_WAVE_C_TABLE_KEYS)).toEqual([]);
    // …and the claim the loop used to make, made where it is still true.
    for (const table of ALL_WAVE_C_TABLES) {
      expect(HOUSE_LEDGER_TABLE_KEYS[table]).toBe('id');
    }
  });
});

/**
 * C1 activated — utilities, and the first sub-wave of Wave C.
 *
 * The manoeuvre is the one B1–B4 established and the block mirrors theirs: the
 * move is a CUT, so every half is asserted twice — present live, absent staged.
 * A copy instead of a cut passes every count assertion in the suite (the
 * `HOUSE_REGISTERED_*` spreads dedupe object keys) while leaving the table
 * claiming to be both merged and unbuilt.
 *
 * C1 moved the most of any single crossing except B4: five keys, five physical
 * names, two windows, the last two natural keys in the registry WITH their
 * `ids.ts` builders, and a DTO gap. What it did NOT move is the interesting
 * part, and it is asserted below too: no Wave-A or Wave-B facade changed, because
 * nothing already live cascades into a C1 table.
 */
describe('Wave C — C1 has crossed into the ledger', () => {
  it.each(C1_TABLES)('%s is keyed live and no longer staged', (table) => {
    expect(HOUSE_LEDGER_TABLE_KEYS[table]).toBe('id');
    expect(HOUSE_LEDGER_TABLE_NAMES).toContain(table);
    expect(stagedNames).not.toContain(table);
    expect(stagedRowKeys[table]).toBeUndefined();
  });

  it('carried its physical names across unchanged, and near two it must not touch', () => {
    // The physical name is what the sync mapping and the CSV export section are
    // derived from; a name that drifted during the move would produce an export
    // section that is always empty and a mapping that never matches, both
    // silently.
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.utilityAccounts).toBe('utility_accounts');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.utilityBills).toBe('utility_bills');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.propertyTaxes).toBe('property_taxes');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.bcAssessmentData).toBe('bc_assessment_data');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.utilityReminders).toBe('utility_reminders');
    for (const table of C1_TABLES) expect(stagedPhysical[table]).toBeUndefined();

    // The trap this sub-wave sets: `schema-utilities.ts` declares eight tables
    // and only five may be ledgered. `utility_providers` is the Tier C catalogue
    // every household shares, `utility_trends` is Tier D (server-derived monthly
    // rollups that H7 re-derives on device — `logic/billAnalytics.ts` IS that
    // re-derivation), and `municipality_configs` is Tier C AND one of the three
    // physical-name collisions. An entry pointing at any of them would look
    // entirely plausible.
    const live = new Set(HOUSE_LEDGER_TABLE_NAMES.map((t) => HOUSE_LEDGER_PHYSICAL_TABLES[t]));
    // `utility_trends` is LIVE as of the H13 D-wave. The trap this block exists
    // to catch is unchanged and now sharper, because the three names are no
    // longer uniformly excluded: the two Tier-C catalogues beside it must STILL
    // be absent. They are global tables with no `household_id` at all, so they
    // have no household ledger to belong to — an entry for either would sync a
    // copy of the same catalogue into every household and, worse, put it
    // somewhere the Worker can never update it again.
    expect(live.has('utility_trends')).toBe(true);
    expect(live.has('utility_providers')).toBe(false);
    expect(live.has('municipality_configs')).toBe(false);
    expect(HOUSE_TIER_C_TABLES).toContain('utility_providers');
    expect(HOUSE_TIER_C_TABLES).toContain('municipality_configs');
  });

  it('moved the two natural keys AND their builders to the live maps (S3b)', () => {
    // Both carry a real D1 uniqueIndex — `property_taxes_household_year_idx` and
    // `bc_assessment_data_household_year_idx`. One row per property per year is
    // the whole point: two members each entering the 2026 assessment offline must
    // produce one record, or the year-over-year chart plots the same year twice.
    expect(HOUSE_DETERMINISTIC_ID_TABLES.propertyTaxes).toEqual(['household_id', 'tax_year']);
    expect(HOUSE_DETERMINISTIC_ID_TABLES.bcAssessmentData).toEqual([
      'household_id',
      'assessment_year',
    ]);
    expect(typeof HOUSE_DETERMINISTIC_ID_BUILDERS.propertyTaxes).toBe('function');
    expect(typeof HOUSE_DETERMINISTIC_ID_BUILDERS.bcAssessmentData).toBe('function');
    // …and left no copy behind. A builder in both maps would still be fed the
    // same parts by `registryGuard`'s distinctness check, so it would pass; the
    // failure would be the staged map naming a table that is no longer staged.
    for (const table of ['propertyTaxes', 'bcAssessmentData']) {
      expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS)).not.toContain(table);
      expect(stagedNaturalKeys[table]).toBeUndefined();
    }
  });

  it('empties the staged S3b maps, which is the terminal state and not a gap', () => {
    // Asserted POSITIVELY rather than as a filter over the staged names, because
    // §11.1.3's third lesson is that a filter over an emptying set passes
    // vacuously exactly when it matters most. Nothing left in Wave C carries a
    // uniqueIndex in D1 — `waveBCSchemaParity.test.ts` proves that against the
    // Drizzle sources — so both maps being empty is a claim about the schema.
    expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_TABLES)).toEqual([]);
    expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS)).toEqual([]);
  });

  it('keeps the two year-scoped tables always-resident rather than windowing', () => {
    // `tax_year` and `assessment_year` are `integer`, and the bucket function
    // reads a `YYYY-MM` prefix off a string — an integer yields nothing, so a
    // window naming them would look configured and do nothing at all. House has
    // no `bucketOverride` (Budget added one for `goals`, which is keyed the same
    // way), and it needs none: ten years of these tables is ten rows.
    //
    // Note this is the ONE thing the natural key above is good for: the same
    // year column that gives these rows their identity cannot give them a bucket.
    expect(HOUSE_WINDOWED_DATE_FIELDS.propertyTaxes).toBeUndefined();
    expect(HOUSE_WINDOWED_DATE_FIELDS.bcAssessmentData).toBeUndefined();
    // `utilityAccounts` is unwindowed for a different reason — it is the address
    // book, a handful of rows every utilities screen reads on first render, the
    // same argument `contractors` makes.
    expect(HOUSE_WINDOWED_DATE_FIELDS.utilityAccounts).toBeUndefined();
  });

  it('windows the bill history on the billing period, not the due date', () => {
    // A bill's period is what a member searches by ("last winter's gas"), and
    // `due_date` can fall in the following month. Both are notNull, so leading
    // with the period is a real choice rather than a fallback ordering.
    expect(HOUSE_WINDOWED_DATE_FIELDS.utilityBills).toEqual([
      'billing_period_start',
      'due_date',
      'created_at',
    ]);
    // A reminder belongs to the moment it is FOR, not the moment it was written.
    expect(HOUSE_WINDOWED_DATE_FIELDS.utilityReminders?.[0]).toBe('scheduled_for');
    for (const table of C1_TABLES) expect(stagedWindows[table]).toBeUndefined();
  });

  it('took the last utilities DTO gap off the list by writing the DTO', () => {
    // §3.2: a ledger row IS the DTO. `utility_reminders` had none — `utilitiesApi`
    // exposes no reminder method at all — so C1's first step was authoring it
    // from `schema-utilities.ts`. One gap remained after C1, and C4 wrote it, so
    // the list is `[]` from here on. Asserted as the empty list rather than as
    // `not.toContain`, which would pass on any list at all.
    expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).not.toContain('utilityReminders');
    expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).toEqual([]);
  });

  it('ledgers the reminder table even though nothing reads or writes it', () => {
    // The position `visitNotes` and `contractorIssueResolutions` hold after B4,
    // and the reason is stronger here: `utility_reminders.bill_id` is the ONLY
    // `onDelete: 'cascade'` in the whole of Wave C that a server delete actually
    // fires (plan §11.1.2), and an unregistered table cannot be cascaded. Rows a
    // server-side backfill left behind would outlive their bill on every peer
    // forever. The delete itself is proved in `localUtilitiesApi.test.ts`.
    expect(HOUSE_LEDGER_TABLE_NAMES).toContain('utilityReminders');
    expect(HOUSE_LEDGER_TABLE_KEYS.utilityReminders).toBe('id');
  });
});

/**
 * C2 activated — floor plans, and the second sub-wave of Wave C.
 *
 * The manoeuvre is the one B1–B4 and C1 established and the block mirrors
 * theirs: the move is a CUT, so every half is asserted twice — present live,
 * absent staged.
 *
 * C2 moved the LEAST of any crossing: three keys, three physical names, no
 * window, no natural key, no DTO gap and no `ids.ts` builder. What it did not
 * move is the whole story, and each absence is asserted positively below rather
 * than left to a filter over a map that no longer contains the table — which is
 * the §11.1.3 vacuity trap, live since C1 and now the default assumption for
 * every remaining sub-wave.
 */
describe('Wave C — C2 has crossed into the ledger', () => {
  it.each(C2_TABLES)('%s is keyed live and no longer staged', (table) => {
    expect(HOUSE_LEDGER_TABLE_KEYS[table]).toBe('id');
    expect(HOUSE_LEDGER_TABLE_NAMES).toContain(table);
    expect(stagedNames).not.toContain(table);
    expect(stagedRowKeys[table]).toBeUndefined();
  });

  it('carried its physical names across unchanged, and near one it must not touch', () => {
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.floorPlans).toBe('floor_plans');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.floorPlanMarkers).toBe('floor_plan_markers');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.floorPlanAnnotations).toBe('floor_plan_annotations');
    for (const table of C2_TABLES) expect(stagedPhysical[table]).toBeUndefined();

    // The trap this sub-wave sets, and it is a one-table trap rather than C1's
    // three. `schema-floor-plans.ts` declares FOUR tables and only three may be
    // ledgered: `floor_plan_regions` sits between the markers and the
    // annotations in that file, carries an `id`, a `floor_plan_id` and
    // timestamps exactly as they do, has a client DTO exactly as they do — and
    // is the segmentation model's OUTPUT. An entry for it would be the most
    // natural-looking line in the block.
    const live = new Set(HOUSE_LEDGER_TABLE_NAMES.map((t) => HOUSE_LEDGER_PHYSICAL_TABLES[t]));
    expect(live.has('floor_plan_regions')).toBe(true);
    expect(HOUSE_TIER_D_TABLES).not.toContain('floor_plan_regions');
  });

  it('keeps all three always-resident, asserted on the LIVE map', () => {
    // The failure mode here differs from a list, which is why plans are the one
    // family in the whole registry with no window at all. A task outside the
    // read window is absent and obviously so; a MARKER outside it renders a
    // floor plan that looks complete and is wrong — the boiler simply is not on
    // it, and nothing on the screen suggests anything is missing. Plans are also
    // few: one per floor, not one per month.
    //
    // Asserted against `HOUSE_WINDOWED_DATE_FIELDS` and not by filtering the
    // staged map, because indexing a `Partial<Record<HouseStagedTableName, …>>`
    // by a name that is no longer staged does not compile — so the pre-crossing
    // version of this test could not have survived, and deleting it would have
    // taken the only statement that these three are unwindowed ON PURPOSE.
    for (const table of C2_TABLES) {
      expect(HOUSE_WINDOWED_DATE_FIELDS[table]).toBeUndefined();
      expect(stagedWindows[table]).toBeUndefined();
    }
  });

  it('claims no natural key, and left nothing behind in the staged maps', () => {
    // Not one of the five indexes in `schema-floor-plans.ts` is a `uniqueIndex`,
    // and none of these tables should acquire a deterministic id by analogy: a
    // household may hold a survey AND a builder's drawing of the same floor, two
    // pins may sit on the same point for two different tasks, and two members
    // tracing the same wall drew two lines. A deterministic id would MERGE work
    // they meant to keep apart — the opposite failure to the one S3b guards, and
    // the call B3 made for the same reason.
    for (const table of C2_TABLES) {
      expect(HOUSE_DETERMINISTIC_ID_TABLES[table]).toBeUndefined();
      expect(HOUSE_DETERMINISTIC_ID_BUILDERS[table]).toBeUndefined();
      expect(stagedNaturalKeys[table]).toBeUndefined();
      expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS)).not.toContain(table);
    }
    // …and the maps C1 emptied are still empty, which is the state every
    // remaining sub-wave inherits. Restated here rather than assumed, because a
    // crossing that accidentally re-populated one would make `registryGuard`'s
    // two staged loops meaningful again and nobody would notice they had been
    // vacuous in between.
    expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_TABLES)).toEqual([]);
    expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS)).toEqual([]);
  });

  it('took no DTO gap, because all three DTOs already existed', () => {
    // The first crossing since B1 for which this is true, and the reason the C2
    // work was documentation rather than authorship: `FloorPlan`,
    // `FloorPlanMarker` and `FloorPlanAnnotation` are all exported from
    // `src/api/floor-plans.ts`, so §3.2's "a ledger row IS the DTO" was already
    // satisfied and the job was to check each against D1 and NAME the
    // divergences (`types.ts` lists eight). The remaining gap was C4's, and C4
    // wrote it, so the list is empty from here on.
    expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).toEqual([]);
    for (const table of C2_TABLES) {
      expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).not.toContain(table as string);
    }
  });

  it('ledgers the annotation table even though no screen writes one', () => {
    // `floorPlansApi` exposes `createAnnotation` and `deleteAnnotation` and no
    // screen calls either — the annotation layer is built and unreached, the
    // position `visitNotes` and `utilityReminders` hold. It is ledgered for the
    // two reasons that always apply: rows written before a household went
    // local-first converge, and — decisively — an unregistered table cannot be
    // dropped when its plan is, which is precisely the obligation
    // `FLOOR_PLAN_CHILD_TABLES` discharges.
    expect(HOUSE_LEDGER_TABLE_NAMES).toContain('floorPlanAnnotations');
    expect(HOUSE_LEDGER_TABLE_KEYS.floorPlanAnnotations).toBe('id');
  });
});

/**
 * C3 activated — garden plans, and the third sub-wave of Wave C.
 *
 * The manoeuvre is the one B1–B4, C1 and C2 established and the block mirrors
 * theirs: the move is a CUT, so every half is asserted twice — present live,
 * absent staged.
 *
 * C3 is the first crossing to move a WINDOW out of the staged map since C1, and
 * the only one ever to move a table in each direction at once: three of its four
 * were unwindowed and stayed that way (the claim had to travel to the live map,
 * as C2's did), and the fourth carried its field list across. Both halves are
 * below, because a crossing that dropped the window would leave every draft
 * always-resident and nothing else would notice.
 *
 * What C3 did NOT move is asserted positively rather than by filtering a map
 * that no longer holds the table — the §11.1.3 vacuity trap, live since C1 and
 * the default assumption for the one sub-wave that remains.
 */
describe('Wave C — C3 has crossed into the ledger', () => {
  it.each(C3_TABLES)('%s is keyed live and no longer staged', (table) => {
    expect(HOUSE_LEDGER_TABLE_KEYS[table]).toBe('id');
    expect(HOUSE_LEDGER_TABLE_NAMES).toContain(table);
    expect(stagedNames).not.toContain(table);
    expect(stagedRowKeys[table]).toBeUndefined();
  });

  it('carried its physical names across unchanged, with no sibling left behind', () => {
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.gardenPlans).toBe('garden_plans');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.gardenPlanObjects).toBe('garden_plan_objects');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.gardenPlanMarkers).toBe('garden_plan_markers');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.gardenPlanBoundaryDrafts).toBe(
      'garden_plan_boundary_drafts',
    );
    for (const table of C3_TABLES) expect(stagedPhysical[table]).toBeUndefined();

    // C1 and C2 both had a table in their Drizzle file that must NOT be
    // registered, and both blocks assert the exclusion. C3 has none:
    // `schema-garden-plans.ts` declares exactly these four. Asserted rather than
    // stated, because "no sibling" is the claim a later migration would break —
    // a fifth table added to that file would need a tier decision, and this is
    // where the absence of one shows up.
    expect(
      HOUSE_TIER_C_TABLES.filter((t) => t.startsWith('garden_')),
    ).toEqual([]);
    expect(HOUSE_TIER_D_TABLES.filter((t) => t.startsWith('garden_'))).toEqual([]);
    // …and the near neighbour that IS live is a different feature's table. The
    // two marker tables are the hazard in this block: similar enough to be
    // confused, and different in three columns and one whole behaviour.
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.floorPlanMarkers).toBe('floor_plan_markers');
  });

  it('keeps the three drawing tables always-resident, asserted on the LIVE map', () => {
    // C2's argument, unchanged: a task outside the read window is absent and
    // obviously so, but an OBJECT or a MARKER outside it renders a garden that
    // looks complete and is wrong — the tree simply is not there, and nothing on
    // the screen suggests anything is missing.
    //
    // Asserted against `HOUSE_WINDOWED_DATE_FIELDS` and not by filtering the
    // staged map, because indexing a `Partial<Record<HouseStagedTableName, …>>`
    // by a name that is no longer staged does not compile — so the pre-crossing
    // version of this test could not have survived, and deleting it would have
    // taken the only statement that these three are unwindowed ON PURPOSE.
    for (const table of C3_DRAWING_TABLES) {
      expect(HOUSE_WINDOWED_DATE_FIELDS[table]).toBeUndefined();
      expect(stagedWindows[table]).toBeUndefined();
    }
  });

  it('carried the boundary draft window across, field list intact', () => {
    // The one window a sub-wave has ever moved out of the staged map, and the
    // reason it exists where the other three have none: a draft is transient
    // scaffolding with an `expires_at`, and `listBoundaryDrafts` already refuses
    // to return an expired one — so a draft in a colder bucket is one the only
    // reader would have filtered out anyway.
    expect(HOUSE_WINDOWED_DATE_FIELDS.gardenPlanBoundaryDrafts).toEqual(['created_at']);
    expect(stagedWindows.gardenPlanBoundaryDrafts).toBeUndefined();
    // NOT `expires_at`, which is the tempting lead field and would file a draft
    // under the month it dies rather than the month it was made — B2 declined
    // the same move on `quotes.valid_until`.
    expect(HOUSE_WINDOWED_DATE_FIELDS.gardenPlanBoundaryDrafts).not.toContain('expires_at');
  });

  it('claims no natural key, and left nothing behind in the staged maps', () => {
    // `schema-garden-plans.ts` declares eight indexes across its four tables and
    // not one is a `uniqueIndex`. Two of them look like constraints and are not:
    // `garden_plans_boundary_draft_idx` is a lookup index on a column with no
    // `references()` at all, and `garden_boundary_drafts_household_status_idx` is
    // the read path for the pending list rather than a uniqueness claim — one
    // member may have several drafts open, which is why that query carries a
    // limit. Two members each placing a shrub placed two shrubs; a deterministic
    // id would MERGE work they meant to keep apart.
    for (const table of C3_TABLES) {
      expect(HOUSE_DETERMINISTIC_ID_TABLES[table]).toBeUndefined();
      expect(HOUSE_DETERMINISTIC_ID_BUILDERS[table]).toBeUndefined();
      expect(stagedNaturalKeys[table]).toBeUndefined();
      expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS)).not.toContain(table);
    }
    // …and the maps C1 emptied are still empty, which is the state the last
    // sub-wave inherits. Restated here rather than assumed, because a crossing
    // that accidentally re-populated one would make `registryGuard`'s two staged
    // loops meaningful again and nobody would notice they had been vacuous in
    // between.
    expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_TABLES)).toEqual([]);
    expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS)).toEqual([]);
  });

  it('took no DTO gap, because all four DTOs already existed', () => {
    // True in the same words as C2 and for a weaker reason, which is the finding
    // worth carrying into C4. `GardenPlan`, `GardenPlanMarker` and
    // `GardenPlanBoundaryDraft` are exported from `src/api/garden-plans.ts` and
    // `GardenPlanObject` from `@models/garden-objects`, so this list was already
    // correct — and two of those four DTOs are hand-built PROJECTIONS rather
    // than row mirrors, so taking them literally would have produced rows with
    // no cascade key, no sort order, no member scope and no window field while
    // every guard stayed green. THIS LIST CATCHES AN ABSENT DTO; it cannot catch
    // a present-and-lossy one. `types.ts` names all twenty-four divergences.
    //
    // C4 proved that warning twice over — two of its nine existing DTOs omit the
    // `created_at` the registry windows their table on — and then emptied the
    // list entirely by writing the registry's last absent DTO.
    expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).toEqual([]);
    for (const table of C3_TABLES) {
      expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).not.toContain(table as string);
    }
  });

  it('ledgers the boundary draft even though the flow that created one is gone', () => {
    // `createBoundaryDraft` and `confirmBoundaryDraft` return 410 to every
    // household — the satellite lot tracing was retired — so no NEW draft can be
    // made by any path, on any backend. The table is still registered, for the
    // two reasons that always apply and one that does not apply elsewhere: rows
    // written before the retirement converge and are carried by every
    // checkpoint, export and backup; `listBoundaryDrafts` and `getBoundaryDraft`
    // still read them; and `deleteBoundaryDraft` is how a member clears one,
    // which an unregistered table could not support at all.
    expect(HOUSE_LEDGER_TABLE_NAMES).toContain('gardenPlanBoundaryDrafts');
    expect(HOUSE_LEDGER_TABLE_KEYS.gardenPlanBoundaryDrafts).toBe('id');
  });
});

/**
 * C4 activated — home projects, the fourth sub-wave of Wave C, and the crossing
 * that empties the entire staged registry.
 *
 * The manoeuvre is the one B1–B4 and C1–C3 established and the block mirrors
 * theirs: the move is a CUT, so every half is asserted twice — present live,
 * absent staged.
 *
 * C4 moved the most of any single crossing: ten keys, ten physical names, SIX
 * windows and the registry's LAST DTO gap. Three of its claims are new to the
 * programme and each gets its own test below rather than being folded into the
 * per-table sweep:
 *
 *  1. **Two of the six windows would have been INERT** — `homeProjectBlockers`
 *     and `homeProjectAttachments` both name a `created_at` their DTO does not
 *     declare. That is §11.1.4b, which C3 met once and C4 met twice; it cannot
 *     be seen from the registry, so the runtime half lives in
 *     `localHomeProjectsApi.test.ts` and the type half in `types.ts`.
 *  2. **The four project-definition tables stay resident on purpose**, and the
 *     claim had to travel to the live map because indexing the staged one by a
 *     name that is no longer staged does not compile.
 *  3. **The DTO-gap list reaches `[]`** for the first time since H11 began.
 */
describe('Wave C — C4 has crossed into the ledger', () => {
  it.each(C4_TABLES)('%s is keyed live and no longer staged', (table) => {
    expect(HOUSE_LEDGER_TABLE_KEYS[table]).toBe('id');
    expect(HOUSE_LEDGER_TABLE_NAMES).toContain(table);
    expect(stagedNames).not.toContain(table);
    expect(stagedRowKeys[table]).toBeUndefined();
  });

  it('carried its physical names across unchanged, and near four it must not touch', () => {
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.homeProjects).toBe('home_projects');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.homeProjectBudgetLines).toBe(
      'home_project_budget_lines',
    );
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.homeProjectSelections).toBe('home_project_selections');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.homeProjectPhases).toBe('home_project_phases');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.homeProjectMilestones).toBe('home_project_milestones');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.homeProjectBlockers).toBe('home_project_blockers');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.homeProjectAttachments).toBe(
      'home_project_attachments',
    );
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.homeProjectPlanLinks).toBe('home_project_plan_links');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.homeProjectComments).toBe('home_project_comments');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.homeProjectActivity).toBe('home_project_activity');
    for (const table of C4_TABLES) expect(stagedPhysical[table]).toBeUndefined();

    // The trap this sub-wave sets is the biggest in the registry — four excluded
    // siblings in one Drizzle file, where C1 had three and C2 had one.
    const live = new Set(HOUSE_LEDGER_TABLE_NAMES.map((t) => HOUSE_LEDGER_PHYSICAL_TABLES[t]));
    expect(live.has('home_project_geometry')).toBe(true);
    expect(HOUSE_TIER_D_TABLES).not.toContain('home_project_geometry');
    // The S2 deferrals are untouched by the D-wave and must stay out: they are
    // deferred on a different ground (S2), which no Tier-D re-tier discharges.
    for (const table of HOUSE_S2_DEFERRED_TABLES) expect(live.has(table)).toBe(false);

    // …and the OTHER trap, which no other block in this file has: the near
    // neighbour is not an excluded sibling but a LIVE table from a different
    // feature. `projects` (B3, the labor-hub contractor job) and `home_projects`
    // (C4, the renovation planner) are two Drizzle files apart and one
    // underscore apart, and only the ledger-name prefix keeps them separate.
    // Either entry pointing at the other's table would merge two unrelated
    // features while every count assertion in this suite still passed.
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.projects).toBe('projects');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.projects).not.toBe('home_projects');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.homeProjects).not.toBe('projects');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.projectMilestones).toBe('project_milestones');
    expect(HOUSE_LEDGER_PHYSICAL_TABLES.homeProjectMilestones).not.toBe('project_milestones');
  });

  it('leaves the four project-definition tables resident, asserted on the LIVE map', () => {
    // Budget lines, selections, phases and plan links ARE the project: `getHub`
    // reads every one of them on the first render, so a row in a colder bucket
    // is an estimate that is silently short by a line — C2's "complete and
    // wrong" failure with a number attached.
    //
    // Asserted against `HOUSE_WINDOWED_DATE_FIELDS` and not by filtering the
    // staged map, because indexing a `Partial<Record<HouseStagedTableName, …>>`
    // by a name that is no longer staged does not compile — so the pre-crossing
    // version of this test could not have survived, and deleting it would have
    // taken the only statement that these four are unwindowed ON PURPOSE.
    for (const table of C4_DEFINITION_TABLES) {
      expect(HOUSE_WINDOWED_DATE_FIELDS[table]).toBeUndefined();
      expect(stagedWindows[table]).toBeUndefined();
    }
    // The complement, so the split is asserted rather than half-asserted: the
    // other six ARE windowed and none was dropped in transit.
    const unwindowed = C4_TABLES.filter((t) => HOUSE_WINDOWED_DATE_FIELDS[t] === undefined);
    expect(unwindowed.sort()).toEqual([...C4_DEFINITION_TABLES].sort());
  });

  it('carried all six windows across, field lists intact', () => {
    expect(HOUSE_WINDOWED_DATE_FIELDS.homeProjects).toEqual(['target_start_at', 'created_at']);
    // `target_start_at` is nullable — a project can be captured long before it
    // is scheduled — so the fallback is load-bearing rather than defensive.
    expect(HOUSE_WINDOWED_DATE_FIELDS.homeProjects?.[0]).toBe('target_start_at');
    expect(HOUSE_WINDOWED_DATE_FIELDS.homeProjectMilestones).toEqual(['due_on', 'created_at']);
    // The four append-only tables have no domain date at all, so `created_at` IS
    // the occurrence rather than a fallback — B2 made the same argument for
    // `quotes` and B4 for `contractorJobRatings`.
    expect(HOUSE_WINDOWED_DATE_FIELDS.homeProjectBlockers).toEqual(['created_at']);
    expect(HOUSE_WINDOWED_DATE_FIELDS.homeProjectAttachments).toEqual(['created_at']);
    expect(HOUSE_WINDOWED_DATE_FIELDS.homeProjectComments).toEqual(['created_at']);
    expect(HOUSE_WINDOWED_DATE_FIELDS.homeProjectActivity).toEqual(['created_at']);
    for (const table of C4_TABLES) expect(stagedWindows[table]).toBeUndefined();
  });

  it('windows a project and its milestones on DIFFERENT fields, as B3 does', () => {
    // The B3 shape, repeated: a project spans months by definition and its
    // milestones are events strung along that span, so each buckets by its own
    // moment. That is safe only because `localHomeProjectsApi.getHub` reads a
    // milestone THROUGH its project, never standalone — the same condition
    // `localProjectsApi` satisfies for B3.
    expect(HOUSE_WINDOWED_DATE_FIELDS.homeProjects).not.toEqual(
      HOUSE_WINDOWED_DATE_FIELDS.homeProjectMilestones,
    );
    // …and the opposite rule, `visitChecklists` / `visitChecklistItems`, is
    // still the one B4 needed. Both are live, so both claims sit on one map and
    // the contrast is checkable rather than remembered.
    expect(HOUSE_WINDOWED_DATE_FIELDS.visitChecklists).toEqual(
      HOUSE_WINDOWED_DATE_FIELDS.visitChecklistItems,
    );
  });

  it('claims no natural key, and left nothing behind in the staged maps', () => {
    // `schema-home-projects.ts` declares fifteen indexes across its fourteen
    // tables and NOT ONE is a `uniqueIndex` — which is right rather than an
    // omission. Two blockers with the same title are two blockers, two "Paint"
    // selections are two rooms' worth of paint, two comments with the same body
    // are two people agreeing, and two activity rows are two things that
    // happened. A deterministic id anywhere here would MERGE work the members
    // meant to keep apart, which is the opposite failure to the one S3b guards.
    for (const table of C4_TABLES) {
      expect(HOUSE_DETERMINISTIC_ID_TABLES[table]).toBeUndefined();
      expect(HOUSE_DETERMINISTIC_ID_BUILDERS[table]).toBeUndefined();
      expect(stagedNaturalKeys[table]).toBeUndefined();
      expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS)).not.toContain(table);
    }
    // …and the maps C1 emptied are still empty, three sub-waves later. Restated
    // here rather than assumed, because a crossing that accidentally
    // re-populated one would make `registryGuard`'s two staged loops meaningful
    // again and nobody would notice they had been vacuous in between.
    expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_TABLES)).toEqual([]);
    expect(Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS)).toEqual([]);
  });

  it('took the registry’s LAST DTO gap off the list by writing the DTO', () => {
    // §3.2: a ledger row IS the DTO. `home_project_milestones` had none — the
    // hub types the array `unknown[]`, which makes every field a guess at the
    // call site and the row unprojectable — so C4's first step was authoring
    // `LocalHomeProjectMilestone` from `schema-home-projects.ts` column by
    // column, exactly as B2, B4 and C1 did for theirs.
    //
    // The list is now EMPTY for the first time since H11 began. Asserted as
    // `[]` rather than by `not.toContain`, which would pass on any list.
    expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).toEqual([]);
  });

  it('ledgers the comment table even though nothing reads one back', () => {
    // There is no list route, no client method and no screen that renders a
    // comment: posting one writes this row AND an activity row, and the feed is
    // the only trace a member ever sees. The position `visitNotes`,
    // `utilityReminders` and `floorPlanAnnotations` hold — with one difference
    // that makes it stronger here, because `addComment` IS on the client module,
    // so the table is written locally on every post.
    expect(HOUSE_LEDGER_TABLE_NAMES).toContain('homeProjectComments');
    expect(HOUSE_LEDGER_TABLE_KEYS.homeProjectComments).toBe('id');
    // The milestone is the mirror case: read by the hub, never written locally,
    // because `homeProjectsApi` has no create-milestone method even though the
    // route does.
    expect(HOUSE_LEDGER_TABLE_NAMES).toContain('homeProjectMilestones');
  });
});

/**
 * The terminal state — and it is a bigger claim than `waveB.test.ts`'s.
 *
 * B4 emptied ONE wave. C4 empties **every staged construct in the registry at
 * once**, so every assertion of the form "walk the staged set and check X" in
 * this directory now passes vacuously. §11.1.3 named that hazard for an emptying
 * wave; this is the moment it reaches the whole mechanism.
 *
 * The response is the one B4 chose and C1 repeated: keep the constructs, empty,
 * and assert the emptiness POSITIVELY and individually. Naming all ten below
 * rather than inferring nine of them from `HOUSE_STAGED_TABLE_NAMES` is the
 * point — the half-finished crossing this catches is precisely one construct
 * that did NOT empty with the rest, and a check that reads only the spread would
 * miss it, because a staged window or a staged builder for a live table does not
 * show up in `HOUSE_STAGED_TABLE_NAMES` at all.
 */
describe('Wave C — the staged registry is empty, and every construct says so', () => {
  it('empties all ten staged constructs together', () => {
    // The three that describe the staged SET.
    expect(HOUSE_WAVE_C_TABLE_KEYS).toEqual({});
    expect(HOUSE_WAVE_C_TABLE_NAMES).toEqual([]);
    expect(HOUSE_WAVE_C_PHYSICAL_TABLES).toEqual({});
    // The three that describe the staged set ACROSS both waves.
    expect(HOUSE_STAGED_TABLE_NAMES).toEqual([]);
    expect(HOUSE_STAGED_WINDOWED_DATE_FIELDS).toEqual({});
    expect(HOUSE_STAGED_TABLES_WITHOUT_DTO).toEqual([]);
    // The two S3b maps, empty since C1 and re-checked on every crossing since.
    expect(HOUSE_STAGED_DETERMINISTIC_ID_TABLES).toEqual({});
    expect(HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS).toEqual({});
    // The schedule.
    expect(HOUSE_SUB_WAVE_TABLES).toEqual({});
    // And the count that keeps the arithmetic honest.
    expect(HOUSE_WAVE_C_TABLE_COUNT).toBe(0);
  });

  it('leaves no Wave-C table behind in any staged map — the half-crossing check', () => {
    // The per-table form of the same claim, over all twenty-two tables Wave C
    // ever held rather than over the empty side. This is what `waveB.test.ts`
    // does with `ALL_WAVE_B_TABLES`, and it is the assertion that fails if a
    // future edit reinstates a staged entry for a table that is live.
    for (const table of ALL_WAVE_C_TABLES) {
      expect(HOUSE_LEDGER_TABLE_NAMES).toContain(table);
      expect(stagedNames).not.toContain(table);
      expect(stagedRowKeys[table]).toBeUndefined();
      expect(stagedPhysical[table]).toBeUndefined();
      expect(stagedWindows[table]).toBeUndefined();
      expect(stagedNaturalKeys[table]).toBeUndefined();
    }
    expect(ALL_WAVE_C_TABLES).toHaveLength(22);
  });

  it('keeps the whole registry live, with nothing lost on the way', () => {
    // The strongest single statement available now: registered == live, and
    // both are 78 (62 through the eight crossings, plus the 2026-08-15
    // `applianceDocuments` correction, the H13 re-tier, migration 0162's option
    // groups and migration 0165's three Neighbours tables). A table dropped
    // during any of them shows up here as a count that no longer matches the
    // constant.
    expect(HOUSE_LEDGER_TABLE_NAMES).toHaveLength(78);
    expect(HOUSE_REGISTERED_TABLE_COUNT).toBe(78);
    expect(new Set(HOUSE_LEDGER_TABLE_NAMES).size).toBe(78);
    // …and the type-level half: `HouseStagedTableName` is `never`, so the maps
    // above cannot gain an entry without someone first widening it. That is not
    // directly assertable at runtime, so what stands in for it is that every one
    // of them is empty AND that the live map spans the whole registered count.
    expect(HOUSE_WAVE_A_TABLE_COUNT).toBe(HOUSE_REGISTERED_TABLE_COUNT);
  });
});
