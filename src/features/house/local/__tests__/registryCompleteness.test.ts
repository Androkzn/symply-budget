/**
 * Registry COMPLETENESS — is every House domain table accounted for?
 *
 * Every other guard in this directory asks *"is each registered table
 * well-formed?"* — distinct physical names, a key field that exists, a natural
 * key where D1 constrains one, a tier that does not overlap Tier A.
 * **None of them asks whether a table was registered at all.**
 *
 * That asymmetry hid a real gap until 2026-08-15. `appliance_documents` lives
 * in `schema-maintenance.ts`, is ordinary household content, and belonged to no
 * wave, no tier and no deferral list. Nothing failed, because nothing looked.
 * The cost was concrete: `localAppliancesApi.getDocuments` / `addDocument`
 * threw, no appliance screen could host `HouseAttachmentField`, and the
 * identical `contractor_documents` shipped in B1 — the two tables are the same
 * shape and only one of them existed as far as the registry was concerned.
 *
 * **That table was classified the same day this suite found it**, into the live
 * ledger, which took the registry from 62 to 63. The correction is argued in
 * `schema.ts` (`HOUSE_WAVE_A_TABLE_COUNT`); what matters here is that removing
 * its line from `HOUSE_UNCLASSIFIED_PENDING` FAILED the bounded-gap case below
 * until that case was updated by hand. The list is asserted by equality in both
 * directions on purpose: it must not grow silently, and it must not shrink
 * silently either.
 *
 * Worse, the plan's own S3b hazard table (§1.4) names `contractor_shares` and
 * `labor_notification_preferences` as constrained tables "in Tier A/B". Both
 * are absent from the registry entirely. **Prose in a plan is not a registry**,
 * and this suite is the difference.
 *
 * So: parse House's Drizzle files, and require every table to land in exactly
 * one bucket —
 *
 *   live ledger · Tier B · Tier C · Tier D · S2-deferred ·
 *   HOUSE_NON_DOMAIN_TABLES (with a written reason) ·
 *   HOUSE_UNCLASSIFIED_PENDING (a decision owed, and bounded)
 *
 * `HOUSE_UNCLASSIFIED_PENDING` is asserted to be EXACTLY its current contents
 * rather than merely permitted, so the known gap cannot grow while looking
 * green. Classifying one of those tables means deleting its line, which is the
 * point.
 *
 * Scope: only the nine Drizzle files that hold House's own domain. The tree
 * carries 237 tables across every brand; Budget's wishes and Health's cycle
 * entries are not House's to classify, and sweeping them in would turn this
 * into a fleet-wide audit that fails for the wrong reasons.
 */
import fs from 'fs';
import path from 'path';

import {
  HOUSE_LEDGER_PHYSICAL_TABLES,
  HOUSE_LEDGER_TABLE_NAMES,
  HOUSE_NON_DOMAIN_TABLES,
  HOUSE_S2_DEFERRED_TABLES,
  HOUSE_TIER_B_TABLES,
  HOUSE_TIER_C_TABLES,
  HOUSE_TIER_D_TABLES,
  HOUSE_UNCLASSIFIED_PENDING,
} from '../schema';

const DB_DIR = path.resolve(__dirname, '../../../../../backend/src/db');

/**
 * The files that hold House's own domain.
 *
 * Named explicitly rather than globbed. A glob would pull in
 * `schema-budget.ts`, `schema-health.ts` and the rest the moment someone adds
 * one, and this suite would start failing for tables House has no opinion
 * about. Adding a House domain file here is a deliberate act.
 */
const HOUSE_SCHEMA_FILES = [
  'schema.ts',
  'schema-maintenance.ts',
  'schema-contractors.ts',
  'schema-labor-hub.ts',
  'schema-checklists.ts',
  'schema-utilities.ts',
  'schema-floor-plans.ts',
  'schema-garden-plans.ts',
  'schema-home-projects.ts',
  // Migration 0165. Added here in the SAME edit that registered its three
  // tables, which is the discipline this suite exists to enforce: a House domain
  // file that is not swept is a file whose tables can go unclassified without
  // anything failing, and that is precisely how `appliance_documents` hid.
  'schema-neighbours.ts',
];

/** Physical table names declared across the House schema files. */
function houseDomainTables(): string[] {
  const found = new Set<string>();
  for (const file of HOUSE_SCHEMA_FILES) {
    const source = fs.readFileSync(path.join(DB_DIR, file), 'utf8');
    for (const match of source.matchAll(/export const \w+ = sqliteTable\(\s*'([^']+)'/g)) {
      found.add(match[1]!);
    }
  }
  return [...found].sort();
}

const DOMAIN_TABLES = houseDomainTables();

const LEDGERED = new Set(HOUSE_LEDGER_TABLE_NAMES.map((t) => HOUSE_LEDGER_PHYSICAL_TABLES[t]));

const BUCKETS: Record<string, ReadonlySet<string>> = {
  ledger: LEDGERED,
  tierB: new Set(HOUSE_TIER_B_TABLES),
  tierC: new Set(HOUSE_TIER_C_TABLES),
  tierD: new Set(HOUSE_TIER_D_TABLES),
  s2Deferred: new Set(HOUSE_S2_DEFERRED_TABLES),
  nonDomain: new Set(HOUSE_NON_DOMAIN_TABLES),
  pending: new Set(HOUSE_UNCLASSIFIED_PENDING),
};

function bucketsFor(table: string): string[] {
  return Object.entries(BUCKETS)
    .filter(([, members]) => members.has(table))
    .map(([name]) => name);
}

describe('registry completeness — the parse itself', () => {
  it('finds every House schema file and a plausible number of tables', () => {
    // Non-vacuity. If a file is renamed or the regex drifts, `DOMAIN_TABLES`
    // shrinks and every assertion below passes over a smaller world.
    for (const file of HOUSE_SCHEMA_FILES) {
      expect(fs.existsSync(path.join(DB_DIR, file))).toBe(true);
    }
    expect(DOMAIN_TABLES.length).toBeGreaterThanOrEqual(110);
    // Spot-checks across three different files, so a single-file parse failure
    // cannot pass this.
    expect(DOMAIN_TABLES).toContain('tasks');
    expect(DOMAIN_TABLES).toContain('appliance_documents');
    expect(DOMAIN_TABLES).toContain('garden_plan_objects');
  });
});

describe('registry completeness — every House domain table is classified', () => {
  it.each(DOMAIN_TABLES)('%s belongs to exactly one bucket', (table) => {
    const buckets = bucketsFor(table);

    // The failure this suite exists for: a table nobody classified.
    expect(buckets.length).toBeGreaterThan(0);

    // And the other direction — a table claimed twice is a registration bug.
    // `registryGuard` proves tier/ledger disjointness over the registry; this
    // extends it to the two lists that suite does not know about.
    expect(buckets).toHaveLength(1);
  });

  it('classifies the whole domain, counted rather than iterated', () => {
    // The `it.each` above passes vacuously if `DOMAIN_TABLES` is empty; this
    // states the total explicitly so the two cannot both be wrong quietly.
    const classified = DOMAIN_TABLES.filter((t) => bucketsFor(t).length === 1);
    expect(classified).toHaveLength(DOMAIN_TABLES.length);
  });
});

describe('registry completeness — the known gap is bounded', () => {
  it('holds exactly the four tables whose classification is owed', () => {
    // Asserted as an equality, not a subset. A new unclassified table must fail
    // the suite above rather than be quietly appended here, and classifying one
    // of these means deleting its line — which fails this test until the
    // expectation is updated deliberately.
    //
    // **It was five until 2026-08-15.** `appliance_documents` was classified
    // into the live ledger that day and its line was deleted, which broke this
    // expectation exactly as designed: the list cannot shrink by accident any
    // more than it can grow by accident. The case below records what it cost
    // while it sat here, and now asserts the opposite.
    expect([...HOUSE_UNCLASSIFIED_PENDING].sort()).toEqual([
      'ai_info_conversations',
      'contractor_shares',
      'labor_notification_preferences',
      'service_provider_reviews',
    ]);
  });

  it('keeps every pending table out of the live ledger', () => {
    // "Undecided" must not mean "half-registered". A pending table that had
    // slipped into `HOUSE_LEDGER_TABLE_KEYS` would sync rows no facade writes.
    for (const table of HOUSE_UNCLASSIFIED_PENDING) {
      expect(LEDGERED.has(table)).toBe(false);
    }
  });

  it('has ledgered appliance_documents alongside its B1 twin', () => {
    // Kept as a named case, now inverted. It was the one entry on the pending
    // list with a member-visible consequence — the twin of `contractor_documents`
    // (ledgered in B1), and while it was unclassified `localAppliancesApi` could
    // only throw and `HouseAttachmentField` had no caller anywhere in `src/`.
    //
    // Both directions are asserted, because a half-done classification is the
    // shape this suite exists to catch: in the ledger AND off the pending list.
    expect(LEDGERED.has('appliance_documents')).toBe(true);
    expect(HOUSE_UNCLASSIFIED_PENDING).not.toContain('appliance_documents');
    expect(LEDGERED.has('contractor_documents')).toBe(true);
  });
});

describe('registry completeness — exclusions are reasoned, not convenient', () => {
  it('excludes nothing from the live ledger by way of the non-domain list', () => {
    for (const table of HOUSE_NON_DOMAIN_TABLES) {
      expect(LEDGERED.has(table)).toBe(false);
    }
  });

  it('keeps the legacy invite tables unledgered — Q14 replaces them', () => {
    // §5.1: all three collapse into the `lf_invites` device-enrolment
    // handshake. A member who joined by the old email invite has no device
    // keypair and therefore no way to decrypt anything.
    for (const table of [
      'household_invitations',
      'household_invite_links',
      'household_join_requests',
    ]) {
      expect(HOUSE_NON_DOMAIN_TABLES).toContain(table);
      expect(LEDGERED.has(table)).toBe(false);
    }
  });

  it('excludes task_photos because the photos ride on the task row', () => {
    // H6 carries a blob descriptor per photo on `tasks.photos`, so the table is
    // not a separate ledger entity. Asserted here so the reasoning survives.
    expect(HOUSE_NON_DOMAIN_TABLES).toContain('task_photos');
    expect(LEDGERED.has('tasks')).toBe(true);
  });
});
