/**
 * The registry, checked against the real D1 schema (H11).
 *
 * Every other guard in this directory checks the registry against ITSELF — that
 * names are unique, that keys are `'id'`, that tiers are disjoint. All of that
 * passes just as happily on a table name someone mistyped or a bucket field that
 * does not exist, and both failures are silent: an unknown physical table is a
 * CSV export section that is always empty and a sync mapping that never matches,
 * and an unknown bucket field makes `rowBucket` fall through to always-resident,
 * so the windowing simply does nothing while appearing to be configured.
 *
 * So this suite parses `backend/src/db/schema*.ts` and asserts the registry
 * against it. Parsing rather than importing is deliberate: the mobile tsconfig
 * excludes `backend/**`, the Drizzle modules pull in `drizzle-orm/sqlite-core`,
 * and Jest here is an Expo preset — reading the source costs nothing and gives
 * the same answer, because the column names ARE string literals in that source.
 *
 * The parser deliberately matches only real column builders
 * (`text(…)`, `integer(…)`, …) and not `index('…')` / `uniqueIndex('…')`, which
 * share the `name: fn('literal')` shape inside the second callback argument.
 */
import fs from 'fs';
import path from 'path';

import {
  HOUSE_DETERMINISTIC_ID_TABLES,
  HOUSE_LEDGER_PHYSICAL_TABLES,
  HOUSE_REGISTERED_PHYSICAL_TABLES,
  HOUSE_REGISTERED_TABLE_NAMES,
  HOUSE_S2_DEFERRED_TABLES,
  HOUSE_STAGED_DETERMINISTIC_ID_TABLES,
  HOUSE_STAGED_WINDOWED_DATE_FIELDS,
  HOUSE_TIER_B_TABLES,
  HOUSE_WINDOWED_DATE_FIELDS,
  type HouseRegisteredTableName,
} from '../schema';

const DB_DIR = path.resolve(__dirname, '../../../../../backend/src/db');

type TableVariant = { file: string; columns: Map<string, string> };

const COLUMN = /(\w+)\s*:\s*(text|integer|real|blob|numeric)\(\s*'([^']+)'/g;
const SPREAD = /\.\.\.(\w+),/g;

function columnsIn(body: string): Map<string, string> {
  const columns = new Map<string, string>();
  COLUMN.lastIndex = 0;
  let match = COLUMN.exec(body);
  while (match) {
    columns.set(match[3]!, match[2]!);
    match = COLUMN.exec(body);
  }
  return columns;
}

function spreadsIn(body: string): string[] {
  const names: string[] = [];
  SPREAD.lastIndex = 0;
  let match = SPREAD.exec(body);
  while (match) {
    names.push(match[1]!);
    match = SPREAD.exec(body);
  }
  return names;
}

/**
 * physical table name → every Drizzle declaration of it (S1: some have two).
 *
 * Shared column groups have to be resolved, not skipped. `tasks` and
 * `task_drafts` reach `created_at` through `...auditFields` → `...timestamps`,
 * and a parser that only saw the literal columns would report the Wave-A
 * registry as windowing on a column that does not exist — a false alarm loud
 * enough to get the real check deleted.
 */
function parseDrizzleTables(): Map<string, TableVariant[]> {
  const variants = new Map<string, TableVariant[]>();
  for (const file of fs.readdirSync(DB_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(DB_DIR, file), 'utf8');

    // Column groups: file-level `const name = { … };` that are not tables.
    const groups = new Map<string, { columns: Map<string, string>; spreads: string[] }>();
    const groupPattern = /^(?:export )?const (\w+) = \{\n([\s\S]*?)^\};$/gm;
    let group = groupPattern.exec(source);
    while (group) {
      groups.set(group[1]!, { columns: columnsIn(group[2]!), spreads: spreadsIn(group[2]!) });
      group = groupPattern.exec(source);
    }
    const resolveGroup = (name: string, seen = new Set<string>()): Map<string, string> => {
      const found = groups.get(name);
      if (!found || seen.has(name)) return new Map();
      seen.add(name);
      const merged = new Map<string, string>();
      for (const nested of found.spreads) {
        for (const [k, v] of resolveGroup(nested, seen)) merged.set(k, v);
      }
      for (const [k, v] of found.columns) merged.set(k, v);
      return merged;
    };

    // Split on the table constructor, then stop at the close of the column
    // object so a `const` declared after the table cannot leak into it.
    for (const chunk of source.split(/\bsqliteTable\(\s*/).slice(1)) {
      const named = /^'([^']+)'/.exec(chunk);
      if (!named) continue;
      const end = chunk.search(/\n {2}\},?\n/);
      const body = end === -1 ? chunk : chunk.slice(0, end);
      const columns = new Map<string, string>();
      for (const spread of spreadsIn(body)) {
        for (const [k, v] of resolveGroup(spread)) columns.set(k, v);
      }
      for (const [k, v] of columnsIn(body)) columns.set(k, v);
      const list = variants.get(named[1]!) ?? [];
      list.push({ file, columns });
      variants.set(named[1]!, list);
    }
  }
  return variants;
}

const TABLES = parseDrizzleTables();

/**
 * Which Drizzle file each half of the `checklist_items` collision comes from.
 *
 * Pinning this is the point of the S1 rename: `recurringChecklistItems` and
 * `visitChecklistItems` are different tables with the same physical name, and a
 * column check that accepted "exists in either" would let a Wave-B window be
 * satisfied by a Wave-A column.
 */
const S1_SOURCE_FILE: Partial<Record<HouseRegisteredTableName, string>> = {
  recurringChecklistItems: 'schema-checklists.ts',
  visitChecklistItems: 'schema-labor-hub.ts',
};

/** Every physical table the registry claims, live or staged. */
function physicalNames(): Set<string> {
  return new Set(Object.values(HOUSE_REGISTERED_PHYSICAL_TABLES));
}

function columnsOf(table: HouseRegisteredTableName): Map<string, string> {
  const physical = HOUSE_REGISTERED_PHYSICAL_TABLES[table];
  const found = TABLES.get(physical) ?? [];
  const wanted = S1_SOURCE_FILE[table];
  const variant = wanted ? found.find((v) => v.file === wanted) : found[0];
  if (!variant) throw new Error(`no Drizzle declaration for ${table} (${physical})`);
  return variant.columns;
}

describe('registry ↔ D1 schema parity — the tables exist', () => {
  it('parses the Drizzle tree at all', () => {
    // A guard on the guard: if the parser silently matched nothing, every
    // assertion below would pass vacuously. The tree had 237 tables when H11 was
    // written and only grows, so a floor is the right shape of check.
    expect(TABLES.size).toBeGreaterThan(200);
    expect(TABLES.get('tasks')?.[0]?.columns.has('next_due_date')).toBe(true);
  });

  it('names a physical table that really exists, for all 63 registered entries', () => {
    const missing = HOUSE_REGISTERED_TABLE_NAMES.filter(
      (t) => !TABLES.has(HOUSE_REGISTERED_PHYSICAL_TABLES[t]),
    );
    expect(missing).toEqual([]);
  });

  it('registers only tables whose row key is real — a column, or a builder (S3a)', () => {
    // The registry keys every row on `id`. A table with neither an `id` column
    // nor a way to synthesise one would produce rows whose key is `undefined`:
    // they never diff, so they never reach a peer.
    //
    // "Has an `id` column" was the right test while every registered table was
    // PK'd on a surrogate. The H13 B-wave broke that assumption with
    // `assistant_identity`, which D1 PKs on `household_id` alone and which reads
    // like an ordinary settings row — so the test now asks the question it
    // always meant: **can this row be keyed at all?**
    //
    // (`chat_room_participants` and `chat_room_reads` are PK-less the same way
    // and were briefly registered here, then withdrawn with the rest of chat —
    // the assistant is a chat participant and runs on the Worker, so a ledgered
    // `chat_messages` would hide the `@assistant` mention behind the HDK. See
    // `HOUSE_TIER_B_TABLES`.)
    //
    // A deterministic-id builder answers yes, and answers it more strongly than
    // an `id` column does. A surrogate `id` is unique per device, so two
    // devices creating the same logical row offline still produce two rows; a
    // builder derives the id from the natural key D1 itself enforces, so they
    // converge. What must never pass is a table with NEITHER, which is still
    // exactly what this catches.
    const keyless = HOUSE_REGISTERED_TABLE_NAMES.filter(
      (t) => !columnsOf(t).has('id') && !(t in HOUSE_DETERMINISTIC_ID_TABLES),
    );
    expect(keyless).toEqual([]);

    // …and the synthesised-key tables are named, so this cannot quietly become
    // the general case. A new PK-less table has to be added here deliberately.
    const synthesised = HOUSE_REGISTERED_TABLE_NAMES.filter((t) => !columnsOf(t).has('id')).sort();
    expect(synthesised).toEqual(['assistantIdentity']);
  });

  it('introduces no new physical-name collision beyond the three the plan knows', () => {
    // Wave B and Wave C span six more Drizzle files than Wave A did, so this is
    // the first point at which a fourth collision could appear. A flat registry
    // cannot represent one, and the failure is two tables merging into one.
    const collisions = [...TABLES.entries()]
      .filter(([, v]) => v.length > 1)
      .map(([name]) => name)
      .sort();
    expect(collisions).toEqual([
      'checklist_items',
      'municipality_configs',
      'scheduled_notifications',
    ]);
  });

  it('resolves the two halves of `checklist_items` to different Drizzle files', () => {
    expect(columnsOf('recurringChecklistItems').has('checklist_id')).toBe(true);
    // Only the labor-hub variant has the on-site fields; if the S1 rename ever
    // pointed both names at one file, this is what would notice.
    expect(columnsOf('visitChecklistItems').has('voice_note_key')).toBe(true);
    expect(columnsOf('recurringChecklistItems').has('voice_note_key')).toBe(false);
  });
});

describe('registry ↔ D1 schema parity — the bucket fields exist', () => {
  const windowed: [HouseRegisteredTableName, readonly string[]][] = [
    ...Object.entries(HOUSE_WINDOWED_DATE_FIELDS),
    ...Object.entries(HOUSE_STAGED_WINDOWED_DATE_FIELDS),
  ] as [HouseRegisteredTableName, readonly string[]][];

  it.each(windowed)('%s windows on columns D1 has', (table, fields) => {
    const columns = columnsOf(table);
    for (const field of fields) expect(columns.has(field)).toBe(true);
  });

  it.each(windowed)('%s windows only on `text` columns', (table, fields) => {
    // `rowBucket` reads a `YYYY-MM` prefix off a string. An `integer` column —
    // a unix timestamp, or `property_taxes.tax_year` — yields no prefix, so the
    // table would be always-resident while the registry claimed otherwise. This
    // is why `propertyTaxes` and `bcAssessmentData` have no window at all.
    const columns = columnsOf(table);
    for (const field of fields) expect(columns.get(field)).toBe('text');
  });

  it('leaves the integer-year tables unwindowed rather than pretending', () => {
    // Asserted against the LIVE map since C1 crossed. The claim had to travel
    // with the tables rather than stay behind on the staged map: indexing
    // `HOUSE_STAGED_WINDOWED_DATE_FIELDS` by a live name no longer compiles, so
    // leaving it there would have meant deleting the only check that these two
    // are unwindowed ON PURPOSE — and the next person to notice the omission
    // would "fix" it by adding a window on the year, which would look configured
    // and do nothing at all.
    expect(columnsOf('propertyTaxes').get('tax_year')).toBe('integer');
    expect(columnsOf('bcAssessmentData').get('assessment_year')).toBe('integer');
    expect(HOUSE_WINDOWED_DATE_FIELDS.propertyTaxes).toBeUndefined();
    expect(HOUSE_WINDOWED_DATE_FIELDS.bcAssessmentData).toBeUndefined();
    // …and no copy was left behind on the staged side either.
    const stagedWindows = HOUSE_STAGED_WINDOWED_DATE_FIELDS as Record<string, unknown>;
    for (const table of ['propertyTaxes', 'bcAssessmentData', 'utilityBills', 'utilityReminders']) {
      expect(stagedWindows[table]).toBeUndefined();
    }
  });

  it('leaves the floor-plan family unwindowed by CHOICE, not by column type', () => {
    // C1 and C2 both end with "no window", and the two reasons are opposites —
    // which is why stating them separately is worth a test rather than a
    // comment. `propertyTaxes` CANNOT be windowed: its only period column is an
    // integer year and `rowBucket` reads a string prefix. All three C2 tables
    // carry a perfectly good `text` `created_at`, so a window would have worked
    // and was declined: a marker in a colder bucket renders a floor plan that
    // looks complete and is missing the boiler.
    //
    // The failure this catches is the plausible "fix": someone notices three
    // live tables with no window, sees `created_at` sitting right there, and
    // adds one. That would be silently wrong rather than inert, which is exactly
    // the case the integer-year test cannot cover.
    for (const table of ['floorPlans', 'floorPlanMarkers', 'floorPlanAnnotations'] as const) {
      expect(columnsOf(table).get('created_at')).toBe('text');
      expect(HOUSE_WINDOWED_DATE_FIELDS[table]).toBeUndefined();
    }
    // …and no copy was left behind on the staged side by the C2 crossing.
    const stagedWindows = HOUSE_STAGED_WINDOWED_DATE_FIELDS as Record<string, unknown>;
    for (const table of ['floorPlans', 'floorPlanMarkers', 'floorPlanAnnotations']) {
      expect(stagedWindows[table]).toBeUndefined();
    }
  });

  it('leaves the garden drawing tables unwindowed and the draft windowed', () => {
    // C3 is the only crossing that moved a table in BOTH directions at once, so
    // both halves are asserted. Three of its four stayed always-resident with a
    // perfectly good `text` `created_at` sitting right there — the C2 argument,
    // declined on purpose — and the fourth carried its window across.
    for (const table of ['gardenPlans', 'gardenPlanObjects', 'gardenPlanMarkers'] as const) {
      expect(HOUSE_WINDOWED_DATE_FIELDS[table]).toBeUndefined();
    }
    // `garden_plan_objects` is the one live table whose ROW carries no
    // `created_at` at all (the DTO is a projection that drops it), which is safe
    // ONLY because it is unwindowed — so the D1 column existing is not the whole
    // story and the assertion above is what holds it together.
    expect(columnsOf('gardenPlanObjects').get('created_at')).toBe('text');
    expect(HOUSE_WINDOWED_DATE_FIELDS.gardenPlanBoundaryDrafts).toEqual(['created_at']);
    // NOT `expires_at`, which is a deadline rather than an occurrence — B2
    // declined the same move on `quotes.valid_until`. Both are `text`, so the
    // choice is real rather than forced by the column type.
    expect(columnsOf('gardenPlanBoundaryDrafts').get('expires_at')).toBe('text');
    // …and no copy was left behind on the staged side by the C3 crossing.
    const stagedWindows = HOUSE_STAGED_WINDOWED_DATE_FIELDS as Record<string, unknown>;
    for (const table of [
      'gardenPlans',
      'gardenPlanObjects',
      'gardenPlanMarkers',
      'gardenPlanBoundaryDrafts',
    ]) {
      expect(stagedWindows[table]).toBeUndefined();
    }
  });

  it('leaves the four home-project definition tables unwindowed by CHOICE', () => {
    // C2's argument, made a third time and for the biggest family. All four
    // carry a perfectly good `text` `created_at`, so a window would have WORKED
    // and was declined: budget lines, selections, phases and plan links are read
    // whole by `getHub` on the first render, so a row in a colder bucket is an
    // estimate that is silently short by a line.
    //
    // The failure this catches is the plausible "fix": someone notices four live
    // tables with no window, sees `created_at` sitting right there, and adds one.
    for (const table of [
      'homeProjectBudgetLines',
      'homeProjectSelections',
      'homeProjectPhases',
      'homeProjectPlanLinks',
    ] as const) {
      expect(columnsOf(table).get('created_at')).toBe('text');
      expect(HOUSE_WINDOWED_DATE_FIELDS[table]).toBeUndefined();
    }
    // …and no copy was left behind on the staged side by the C4 crossing.
    const stagedWindows = HOUSE_STAGED_WINDOWED_DATE_FIELDS as Record<string, unknown>;
    for (const table of [
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
    ]) {
      expect(stagedWindows[table]).toBeUndefined();
    }
  });

  it('leaves applianceDocuments unwindowed, and proves the tempting entry is impossible', () => {
    // The 2026-08-15 correction (`schema.ts`), and the one absence in this map
    // that a reader is most likely to call a bug — because its twin
    // `contractorDocuments` IS windowed, on `['document_date', 'created_at']`.
    //
    // Three claims, and the first is the one only this suite can make. The DTO's
    // sole date is `uploaded_at`, and **there is no such column in D1** — the
    // table's dates are `upload_date` and `created_at`. So the obvious entry,
    // `['uploaded_at']`, would fail the `windows on columns D1 has` case above
    // rather than merely being inert, which is the schema half of the guard
    // catching the mistake before the runtime half has to.
    const columns = columnsOf('applianceDocuments');
    expect(columns.has('uploaded_at')).toBe(false);
    // …and both real columns are perfectly good `text`, so this is a DECLINED
    // window and not an impossible one — the `propertyTaxes` situation inverted.
    // Declining it is what keeps one instant in one field: carrying `upload_date`
    // on the row type beside `uploaded_at` would give per-field LWW two names for
    // the same fact. `types.ts` argues that at length.
    expect(columns.get('upload_date')).toBe('text');
    expect(columns.get('created_at')).toBe('text');
    expect(HOUSE_WINDOWED_DATE_FIELDS.applianceDocuments).toBeUndefined();
    // Its twin, for contrast — and as a non-vacuity check on `columnsOf`.
    expect(HOUSE_WINDOWED_DATE_FIELDS.contractorDocuments).toEqual([
      'document_date',
      'created_at',
    ]);
    expect(columnsOf('contractorDocuments').get('document_date')).toBe('text');
    // Nothing on the staged side either: this table never staged, because it was
    // never in a wave.
    const stagedWindows = HOUSE_STAGED_WINDOWED_DATE_FIELDS as Record<string, unknown>;
    expect(stagedWindows.applianceDocuments).toBeUndefined();
  });

  it('is HAPPY with the two windows whose DTO omitted the field — which is the point', () => {
    // ⚠️ This test asserts a LIMIT of this whole suite, on purpose.
    //
    // A window is a claim about THREE things: the registry entry, the D1 column
    // and the ROW TYPE. Everything in this file checks the first two, and both
    // are impeccable for `homeProjectBlockers` and `homeProjectAttachments` —
    // `created_at` is a `notNull text` column on each. Neither
    // `HomeProjectBlocker` nor `HomeProjectAttachment` declares such a field, so
    // before C4 carried it on the row types (`types.ts`) `rowBucket` would have
    // read `undefined`, produced no `YYYY-MM` and bucketed every row
    // always-resident — configured-looking and inert, with this suite green.
    //
    // C3 met the same hazard once on `gardenPlanBoundaryDrafts`. C4 met it
    // twice. The runtime half of the guard lives in
    // `localHomeProjectsApi.test.ts`, where `rowBucket` is called on a real row;
    // the type half is `tsc` on that file's typed seeders. This assertion exists
    // so the next reader learns from HERE that a green parity run is not enough.
    expect(columnsOf('homeProjectBlockers').get('created_at')).toBe('text');
    expect(columnsOf('homeProjectAttachments').get('created_at')).toBe('text');
    expect(HOUSE_WINDOWED_DATE_FIELDS.homeProjectBlockers).toEqual(['created_at']);
    expect(HOUSE_WINDOWED_DATE_FIELDS.homeProjectAttachments).toEqual(['created_at']);
  });

  it('windows a home project on the start date, not the end date', () => {
    // `target_start_at` and `target_end_at` are both nullable `text`, so leading
    // with the START is a real decision rather than a fallback ordering: an end
    // date is a deadline, and bucketing by it would file a project under the
    // month it is due to finish rather than the month the work happens — the
    // mistake B2 declined on `quotes.valid_until` and C3 declined on
    // `garden_plan_boundary_drafts.expires_at`.
    const columns = columnsOf('homeProjects');
    expect(columns.get('target_start_at')).toBe('text');
    expect(columns.get('target_end_at')).toBe('text');
    expect(HOUSE_WINDOWED_DATE_FIELDS.homeProjects?.[0]).toBe('target_start_at');
    expect(HOUSE_WINDOWED_DATE_FIELDS.homeProjects).not.toContain('target_end_at');
    // The milestone leads with its own due date and falls back, because `due_on`
    // is nullable — B3's `projectMilestones` shape exactly.
    expect(columnsOf('homeProjectMilestones').get('due_on')).toBe('text');
    expect(HOUSE_WINDOWED_DATE_FIELDS.homeProjectMilestones?.[0]).toBe('due_on');
  });

  it('windows the bill on the columns D1 marks notNull, in the order C1 chose', () => {
    // Both `billing_period_start` and `due_date` are notNull `text`, so leading
    // with the PERIOD is a real decision rather than a fallback ordering: a
    // member searches for "last winter's gas" by when the gas was burned, and a
    // due date routinely lands in the following month. Bucketing by `due_date`
    // would file January's bill under February on every device at once.
    const columns = columnsOf('utilityBills');
    expect(columns.get('billing_period_start')).toBe('text');
    expect(columns.get('due_date')).toBe('text');
    expect(HOUSE_WINDOWED_DATE_FIELDS.utilityBills?.[0]).toBe('billing_period_start');
    expect(HOUSE_WINDOWED_DATE_FIELDS.utilityReminders?.[0]).toBe('scheduled_for');
  });
});

describe('registry ↔ D1 schema parity — the natural keys exist (S3b)', () => {
  const naturalKeys: [HouseRegisteredTableName, readonly string[]][] = [
    ...Object.entries(HOUSE_DETERMINISTIC_ID_TABLES),
    ...Object.entries(HOUSE_STAGED_DETERMINISTIC_ID_TABLES),
  ] as [HouseRegisteredTableName, readonly string[]][];

  it.each(naturalKeys)('%s derives its id from columns D1 has', (table, key) => {
    // A deterministic id built from a column that does not exist hashes
    // `undefined` on every device — which converges, but onto ONE row per table
    // instead of one row per logical entity.
    const columns = columnsOf(table);
    for (const column of key) expect(columns.has(column)).toBe(true);
  });

  it('covers every uniqueIndex D1 declares on a ledgered table', () => {
    // Derived from the Drizzle sources, not restated.
    //
    // This assertion used to hardcode `['contractorQuotes','quoteRequests']` as
    // the live half of the set, which made it rot the moment a third table
    // crossed: B4 moved `contractorJobRatings` into the live map and it simply
    // fell out of `declared`, shrinking the list rather than failing loudly.
    // B3 flagged that as latent rot and it duly went off one sub-wave later.
    //
    // Now the expectation comes from the schema itself, so activation cannot
    // change it: parse every `uniqueIndex` declaration, keep the ones landing on
    // a table the registry ledgers, and require each to carry a natural key in
    // EITHER map. Where the key lives is an activation detail; that it exists is
    // the invariant. Anything uncovered is an offline duplicate waiting to
    // happen — two members writing the same logical row and both surviving.
    const UNIQUE_INDEX = /uniqueIndex\(\s*'([^']+)'\s*\)\s*\.on\(([^)]*)\)/g;
    const sources = fs
      .readdirSync(DB_DIR)
      .filter((f) => f.startsWith('schema') && f.endsWith('.ts'))
      .map((f) => fs.readFileSync(path.join(DB_DIR, f), 'utf8'))
      .join('\n');

    // physical table name -> the ledger names claiming it
    const claimants = new Map<string, HouseRegisteredTableName[]>();
    for (const table of Object.keys(HOUSE_REGISTERED_PHYSICAL_TABLES) as HouseRegisteredTableName[]) {
      const physical = HOUSE_REGISTERED_PHYSICAL_TABLES[table];
      claimants.set(physical, [...(claimants.get(physical) ?? []), table]);
    }

    // A uniqueIndex is conventionally named `<physical>_..._unique_idx`, so the
    // owning table is recoverable from the longest physical name it starts with.
    const constrained = new Set<HouseRegisteredTableName>();
    let match: RegExpExecArray | null;
    while ((match = UNIQUE_INDEX.exec(sources)) !== null) {
      const indexName = match[1]!;
      const owner = [...claimants.keys()]
        .filter((physical) => indexName.startsWith(`${physical}_`))
        .sort((a, b) => b.length - a.length)[0];
      if (!owner) continue;
      for (const table of claimants.get(owner)!) constrained.add(table);
    }

    // Non-vacuity: if the regex or the naming convention drifts, `constrained`
    // empties and this passes while proving nothing.
    expect(constrained.size).toBeGreaterThanOrEqual(5);

    const withKey = new Set([
      ...Object.keys(HOUSE_DETERMINISTIC_ID_TABLES),
      ...Object.keys(HOUSE_STAGED_DETERMINISTIC_ID_TABLES),
    ]);
    const uncovered = [...constrained].filter((table) => !withKey.has(table)).sort();
    expect(uncovered).toEqual([]);
  });
});

describe('registry ↔ D1 schema parity — hazard S2', () => {
  it.each(HOUSE_S2_DEFERRED_TABLES)('%s genuinely has no key column to use', (physical) => {
    // The exclusion is a claim about the schema, so check the schema. If someone
    // adds a surrogate `id` to one of these in a migration, this test fails and
    // the table should then be registered — the failure is the reminder.
    const variant = TABLES.get(physical)?.[0];
    expect(variant).toBeDefined();
    expect(variant!.columns.has('id')).toBe(false);
  });

  it('keeps the S2 joins out of the registry while their parent is in it', () => {
    const physical = new Set(Object.values(HOUSE_REGISTERED_PHYSICAL_TABLES));
    expect(physical.has('home_projects')).toBe(true);
    for (const table of HOUSE_S2_DEFERRED_TABLES) expect(physical.has(table)).toBe(false);
  });

  it('excludes `floor_plan_regions` because of its TIER, not because it is missing', () => {
    // The S2 tests above prove an exclusion by showing the table cannot be
    // keyed. `floor_plan_regions` is the opposite case and needs its own proof:
    // it exists, it has an `id`, it has a `floor_plan_id` and timestamps, and it
    // would register perfectly well. It is out because it is Tier D — the
    // segmentation model's output, which H7 re-derives on device — and the only
    // thing standing between it and the registry is that decision.
    //
    // Without this, "not registered" and "not registerable" look alike from the
    // registry's side, and the next reader to notice a floor-plan table missing
    // from a floor-plan block would helpfully add it.
    const variant = TABLES.get('floor_plan_regions')?.[0];
    expect(variant).toBeDefined();
    expect(variant!.columns.has('id')).toBe(true);
    expect(variant!.columns.has('floor_plan_id')).toBe(true);
    const physical = new Set(Object.values(HOUSE_REGISTERED_PHYSICAL_TABLES));
    expect(physical.has('floor_plan_regions')).toBe(true);
    // …and its three siblings, which look identical from here, ARE registered.
    expect(physical.has('floor_plans')).toBe(true);
    expect(physical.has('floor_plan_markers')).toBe(true);
    expect(physical.has('floor_plan_annotations')).toBe(true);
  });

  it('registers every table `schema-garden-plans.ts` declares, with none left over', () => {
    // C1 had to exclude three of its file's eight tables and C2 one of its four.
    // C3 excludes none, which is a claim about the schema rather than about the
    // registry: `schema-garden-plans.ts` declares exactly four tables and all
    // four are the member's own. If a migration adds a fifth — a generated
    // geometry cache, say, which is what `home_project_geometry` is — this fails
    // and the tier decision gets made deliberately instead of by omission.
    const source = fs.readFileSync(path.join(DB_DIR, 'schema-garden-plans.ts'), 'utf8');
    const declared = [...source.matchAll(/sqliteTable\(\s*'([^']+)'/g)].map((m) => m[1]!).sort();
    expect(declared).toEqual([
      'garden_plan_boundary_drafts',
      'garden_plan_markers',
      'garden_plan_objects',
      'garden_plans',
    ]);
    for (const table of declared) expect(physicalNames().has(table)).toBe(true);
  });

  it('registers eleven of the sixteen tables `schema-home-projects.ts` declares', () => {
    // The C4 counterpart of the garden-plans test above, and the opposite
    // result: that file had nothing left over, this one has FOUR — which is more
    // than any other Drizzle file in the registry. Asserted against the schema
    // rather than against the registry, so a migration that adds a table forces
    // a tier decision instead of an omission.
    //
    // It has already done that job once. Migration 0162 added
    // `home_project_option_groups` and this assertion is what made the tier
    // decision explicit: the group is the member's own planning — a surface they
    // named, an area they measured, the option they chose — so it is ledgered,
    // NOT deferred like the S2 joins and not Tier D like the geometry.
    //
    // And again at migration 0166. `home_project_as_is` and
    // `home_project_smart_drafts` are Smart Project's two tables, and both are
    // Tier B: a draft is produced by a queue, a provider key and a model that
    // exist only on the Worker, so a device cannot write these rows even in
    // principle. That made SIX left over rather than four.
    //
    // And once in the other direction, at migration 0170. `home_project_tasks`
    // is GONE from the file — the link is `home_projects.linked_task_ids` now —
    // so the declared count drops to sixteen and the leftovers to four. This
    // assertion is what would have caught a drop that left the registry still
    // deferring a table nobody declares.
    const source = fs.readFileSync(path.join(DB_DIR, 'schema-home-projects.ts'), 'utf8');
    const declared = [...source.matchAll(/sqliteTable\(\s*'([^']+)'/g)].map((m) => m[1]!).sort();
    expect(declared).toHaveLength(16);
    expect(declared).toContain('home_project_option_groups');
    expect(physicalNames().has('home_project_option_groups')).toBe(true);

    const registered = physicalNames();
    const excluded = declared.filter((table) => !registered.has(table));
    expect(excluded.sort()).toEqual([
      // `home_project_geometry` left this list in the H13 D-wave and
      // `home_project_tasks` left the FILE in migration 0170. What remains is
      // the two S2 joins plus Smart Project's two Tier B tables — two different
      // reasons, each proved by its own mechanism below.
      'home_project_as_is',
      'home_project_contractors',
      'home_project_smart_drafts',
      'home_project_spaces',
    ]);
    // The one that left. A table the schema no longer declares must not be
    // sitting in a deferral list either, or "deferred" quietly becomes a place
    // dead names accumulate.
    expect(declared).not.toContain('home_project_tasks');
    // Smart Project's pair: server-authoritative, never ledgered.
    for (const table of ['home_project_as_is', 'home_project_smart_drafts']) {
      expect(HOUSE_TIER_B_TABLES).toContain(table);
    }
    // Two are S2 (no key) and one is Tier D (machine output), and the two
    // reasons are completely different — so each is proved by its own mechanism
    // rather than by "it is not in the registry". It was three S2 until
    // migration 0170 moved `home_project_tasks`' link onto the parent row.
    for (const table of ['home_project_spaces', 'home_project_contractors']) {
      expect(HOUSE_S2_DEFERRED_TABLES).toContain(table);
    }
    const geometry = TABLES.get('home_project_geometry')?.[0];
    expect(geometry).toBeDefined();
    expect(geometry!.columns.has('id')).toBe(true);
    expect(geometry!.columns.has('project_id')).toBe(true);
  });

  it('keeps `home_projects` and the labor hub’s `projects` apart', () => {
    // The C4 hazard, and it is the mirror of C3's two marker tables: two live
    // tables from two different features, one underscore apart, kept separate
    // only by the ledger-name prefix. Unlike the markers they do not even share
    // a shape — `home_projects` has the renovation planner's budget and
    // contingency columns and `projects` has the contractor job's — so a facade
    // copied from one onto the other would fail loudly. What would NOT fail
    // loudly is a registry entry pointing at the wrong physical table, which is
    // why the columns are the thing asserted here.
    const home = columnsOf('homeProjects');
    const labor = columnsOf('projects');
    expect(home.get('contingency_pct')).toBe('integer');
    expect(labor.has('contingency_pct')).toBe(false);
    expect(labor.has('contractor_id')).toBe(true);
    expect(home.has('contractor_id')).toBe(false);
    // The same trap one level down: `project_milestones` (B3) and
    // `home_project_milestones` (C4) are two tables whose ledger names differ by
    // one word, and only one of them has a `phase_id`.
    expect(columnsOf('homeProjectMilestones').has('phase_id')).toBe(true);
    expect(columnsOf('projectMilestones').has('phase_id')).toBe(false);
  });

  it('keeps the two marker tables apart, because they are one careless line away', () => {
    // The C3 hazard. `garden_plan_markers` and `floor_plan_markers` are near
    // twins with a shared vocabulary, and they differ in ways a copied facade
    // would silently get wrong: the garden one has NO `marker_type`, and its
    // coordinates are `integer` where the floor plan's are `real`.
    const garden = columnsOf('gardenPlanMarkers');
    const floor = columnsOf('floorPlanMarkers');
    expect(garden.has('marker_type')).toBe(false);
    expect(floor.get('marker_type')).toBe('text');
    expect(garden.get('x_percent')).toBe('integer');
    expect(floor.get('x_percent')).toBe('real');
  });

  it('still maps Wave A to the same physical tables it always did', () => {
    // HOUSE_REGISTERED_PHYSICAL_TABLES is a spread; a Wave-B entry that reused a
    // Wave-A ledger name would overwrite it here and nowhere else.
    for (const [table, physical] of Object.entries(HOUSE_LEDGER_PHYSICAL_TABLES)) {
      expect(HOUSE_REGISTERED_PHYSICAL_TABLES[table as HouseRegisteredTableName]).toBe(physical);
    }
  });
});
