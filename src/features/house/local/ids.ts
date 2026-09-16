import { bytesToHex, deterministicRowId, randomBytes } from '@symply/local-first';

import type { HouseLedgerTableName, HouseStagedTableName } from './schema';

/**
 * Random row id — the default. Correct for every table with no business
 * uniqueness: two members creating two tasks means two tasks.
 */
export function newLocalId(prefix: string): string {
  return `${prefix}_${bytesToHex(randomBytes(8))}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

/**
 * S3b deterministic-id builders (plan §1.5).
 *
 * One entry per Tier-A table that carries a business `uniqueIndex` in D1. Both
 * devices compute the same id from the same natural key, so an offline
 * double-create merges under LWW instead of surviving as two rows. Adding a
 * table to `HOUSE_DETERMINISTIC_ID_TABLES` without adding a builder here fails
 * `registryGuard.test.ts`.
 */
export const houseDeterministicIds = {
  householdMember: (householdId: string, userId: string): string =>
    deterministicRowId('hm', [householdId, userId]),

  /** `household_id` is nullable for user-scoped settings — the null is part of the key. */
  setting: (userId: string, householdId: string | null, key: string): string =>
    deterministicRowId('set', [userId, householdId, key]),

  checklistItemCompletion: (instanceId: string, itemId: string): string =>
    deterministicRowId('cic', [instanceId, itemId]),

  /** Auto-materialized by `getProgress` — see the note in `schema.ts`. */
  checklistInstance: (checklistId: string, periodStart: string): string =>
    deterministicRowId('cin', [checklistId, periodStart]),

  /**
   * Auto-materialized by `getCurrent`. MUST agree with `defaults.ts`'s mint-time
   * seed formula, or every household gets two sets of seasonal shells.
   */
  seasonalChecklist: (householdId: string, season: string, year: number): string =>
    deterministicRowId('scl', [householdId, season, year]),

  /** One active schedule per property — see the note in `schema.ts`. */
  garbageSchedule: (householdId: string): string => deterministicRowId('gsc', [householdId]),

  recurringReminder: (
    householdId: string,
    type: string,
    referenceId: string,
    periodKey: string,
  ): string => deterministicRowId('rr', [householdId, type, referenceId, periodKey]),

  // --- H11 sub-wave B2 (quoting), live ---------------------------------------

  /**
   * `contractor_quotes_task_contractor_unique_idx` — one quote per contractor
   * per task. The quote is often minted by an AI extraction run over a PDF, so
   * two members uploading the same document offline is not a corner case.
   */
  contractorQuote: (taskId: string, contractorId: string): string =>
    deterministicRowId('cq', [taskId, contractorId]),

  /**
   * `quote_requests_task_contractor_unique_idx` — same natural key as
   * `contractorQuote` above, different table. The `qrq` prefix is what keeps the
   * request and the quote it produced from colliding into one row.
   */
  quoteRequest: (taskId: string, contractorId: string): string =>
    deterministicRowId('qrq', [taskId, contractorId]),

  // --- H11 sub-wave B4 (the on-site surface), live ---------------------------

  /**
   * `contractor_job_ratings_visit_id_idx` — one rating per visit, and the only
   * live S3b key built from a SINGLE column.
   *
   * The double-create it prevents is not a race: a post-visit notification asks
   * the household to rate the call-out, either member can answer it from a
   * driveway with no signal, and with random ids the merge would keep both
   * answers and count one job twice in the contractor's average.
   */
  contractorJobRating: (visitId: string): string => deterministicRowId('cjr', [visitId]),

  // --- H11 sub-wave C1 (utilities), live -------------------------------------

  /**
   * `property_taxes_household_year_idx`. The year is a D1 `integer`, so it is
   * passed as a number and the shared builder stringifies it — matching what
   * `seasonalChecklist` already does with its `year`.
   *
   * The double-create is ordinary rather than a race: the notice arrives on
   * paper once a year and either member may photograph and file it, often the
   * same evening and often with no signal.
   */
  propertyTax: (householdId: string, taxYear: number): string =>
    deterministicRowId('ptx', [householdId, taxYear]),

  /**
   * `bc_assessment_data_household_year_idx` — one assessment per year, same
   * argument as the tax notice above. The `bca` prefix is what keeps the two
   * apart: their natural keys are both `(household_id, <a year>)`, so for a
   * property whose 2026 tax and 2026 assessment are both filed, the columns
   * alone would hash to the same id and the merge would fold an assessment into
   * a tax record.
   */
  bcAssessment: (householdId: string, assessmentYear: number): string =>
    deterministicRowId('bca', [householdId, assessmentYear]),

  /**
   * `utility_trends_household_type_year_month_idx` — one trend row per
   * (household, utility type, year, month). The H13 D-wave's only S3b table.
   *
   * The reason it needs a builder is sharper than for the two above, because
   * nobody *types* a trend row: it is COMPUTED, so two devices that both come
   * online after a month closes will both derive October, independently, with
   * no member action to serialise them. With a random id the LWW map keeps both
   * — they conflict on no field it can compare — and October appears twice.
   *
   * `month` is nullable, and that is load-bearing rather than incidental: the
   * annual roll-up is the row with `month === null`. Encoding it as the literal
   * `'y'` rather than letting a null stringify keeps the year row distinct from
   * January, which `[householdId, type, year, month ?? '']` would not — `''`
   * and `'1'` differ, but only by luck of formatting, and a future change to
   * `deterministicRowId`'s joiner would silently collide them.
   */
  utilityTrend: (
    householdId: string,
    utilityType: string,
    year: number,
    month: number | null,
  ): string =>
    deterministicRowId('utr', [householdId, utilityType, year, month === null ? 'y' : `m${month}`]),


  /**
   * `assistant_outbound_log` — `(household_id, idempotency_key)`.
   *
   * The send-once guarantee depends on this. A random id would let two devices
   * log the same logical send as two rows, and the member receives it twice.
   */
  assistantOutbound: (householdId: string, idempotencyKey: string): string =>
    deterministicRowId('aol', [householdId, idempotencyKey]),

  /**
   * `assistant_trust_ledger` — keyed on the event key ALONE. No household part,
   * because the event key is already globally unique; adding one would break
   * convergence between two households that legitimately share an event.
   */
  assistantTrust: (eventIdempotencyKey: string): string =>
    deterministicRowId('atl', [eventIdempotencyKey]),

  /**
   * `assistant_identity` — PK'd on `household_id`, no `id` column. One persona
   * per household, so the household id IS the natural key and the synthesised
   * row id is a pure function of it. Two devices editing the assistant's name
   * offline converge on one row instead of minting two personas.
   */
  assistantIdentityId: (householdId: string): string =>
    deterministicRowId('aid', [householdId]),

  /**
   * `maintenance_suggestions` — `(household_id, home_feature_id, template_id)`.
   *
   * The only builder here whose constraint D1 does not declare; see the note in
   * `schema.ts`. Generation moved on-device with H13, so the server's
   * read-then-write no longer serialises anything, and two devices generating
   * offline converge only if they agree on the id.
   */
  maintenanceSuggestion: (
    householdId: string,
    homeFeatureId: string,
    templateId: string,
  ): string => deterministicRowId('msg', [householdId, homeFeatureId, templateId]),

  /**
   * `neighbourhoods` — `(household_id, name)`, a real D1 `uniqueIndex`.
   *
   * The name is normalised the same way the Worker's duplicate check normalises
   * it (trim + lowercase), because the constraint the id stands in for is the
   * one a MEMBER perceives: "Maple Court" and "maple court " are the same area,
   * and two devices that disagree about that mint two ids and keep both rows.
   * The raw name is still stored on the row and is what the screens render —
   * only the KEY is normalised.
   */
  neighbourhood: (householdId: string, name: string): string =>
    deterministicRowId('nbh', [householdId, name.trim().toLowerCase()]),
} as const;

/**
 * Registry lookup used by the guard: ledger table → builder. Keeps the mapping
 * declarative so a new S3b table cannot be registered without a builder.
 */
export const HOUSE_DETERMINISTIC_ID_BUILDERS: Partial<
  Record<HouseLedgerTableName, (...parts: never[]) => string>
> = {
  householdMembers: houseDeterministicIds.householdMember as (...parts: never[]) => string,
  settings: houseDeterministicIds.setting as (...parts: never[]) => string,
  checklistItemCompletions: houseDeterministicIds.checklistItemCompletion as (
    ...parts: never[]
  ) => string,
  recurringReminders: houseDeterministicIds.recurringReminder as (...parts: never[]) => string,
  garbageSchedules: houseDeterministicIds.garbageSchedule as (...parts: never[]) => string,
  checklistInstances: houseDeterministicIds.checklistInstance as (...parts: never[]) => string,
  seasonalChecklists: houseDeterministicIds.seasonalChecklist as (...parts: never[]) => string,
  // H11 B2. Moved here from the staged map with their tables; `registryGuard`
  // feeds every builder in BOTH maps the same parts and asserts the ids are
  // distinct, which is the check that keeps `cq` and `qrq` apart.
  contractorQuotes: houseDeterministicIds.contractorQuote as (...parts: never[]) => string,
  quoteRequests: houseDeterministicIds.quoteRequest as (...parts: never[]) => string,
  // H11 B4. Moved here from the staged map with its table, which is the half of
  // the crossing that lives in a second file: a table in
  // `HOUSE_DETERMINISTIC_ID_TABLES` whose builder stayed staged fails
  // `registryGuard`'s "builder for every S3b table" check, and the reverse fails
  // its mirror.
  contractorJobRatings: houseDeterministicIds.contractorJobRating as (...parts: never[]) => string,
  // H11 C1. Moved here from the staged map with their tables — the same
  // two-file crossing B2 and B4 made. A table in `HOUSE_DETERMINISTIC_ID_TABLES`
  // whose builder stayed staged fails `registryGuard`'s "builder for every S3b
  // table" check, and the reverse fails its mirror.
  propertyTaxes: houseDeterministicIds.propertyTax as (...parts: never[]) => string,
  bcAssessmentData: houseDeterministicIds.bcAssessment as (...parts: never[]) => string,
  utilityTrends: houseDeterministicIds.utilityTrend as (...parts: never[]) => string,
  assistantOutboundLog: houseDeterministicIds.assistantOutbound as (...parts: never[]) => string,
  assistantTrustLedger: houseDeterministicIds.assistantTrust as (...parts: never[]) => string,
  assistantIdentity: houseDeterministicIds.assistantIdentityId as (...parts: never[]) => string,
  maintenanceSuggestions: houseDeterministicIds.maintenanceSuggestion as (
    ...parts: never[]
  ) => string,
  // Neighbours (0165) — the family's only S3b table. `neighbours` and
  // `neighbourPeople` take random ids on purpose; `schema.ts` argues why
  // deriving one from a label would merge two different families.
  neighbourhoods: houseDeterministicIds.neighbourhood as (...parts: never[]) => string,
};

/**
 * The same lookup for the staged waves (H11). Kept separate from the live map
 * because its keys are `HouseStagedTableName` — a table that is registered but
 * not yet merged. `registryGuard.test.ts` asserts both maps in both directions,
 * so a Wave-B/C table declared S3b without a builder here fails a test, which is
 * exactly the gap the plan's DoD says must fail loudly.
 *
 * **Empty since C1**, which took the last two staged S3b tables — three
 * sub-waves before the staged set itself emptied. That is the terminal state
 * rather than a hole: nothing left in Wave C carried a `uniqueIndex` in D1, and
 * `waveBCSchemaParity.test.ts` proves it by parsing the Drizzle sources rather
 * than by trusting this comment. C2, C3 and C4 each re-ran that check and each
 * took nothing.
 *
 * Since C4 the key type is `never`, so this is `Partial<Record<never, …>>` —
 * `{}` — and an entry cannot be added without first widening
 * `HouseStagedTableName`. The map stays for the same reason
 * `HOUSE_WAVE_B_TABLE_KEYS` does (see `schema.ts`): the guard that reads this
 * map is the guard that reads the live one, and the next table to stage will be
 * an S2 join whose whole problem is how to key a row.
 *
 * **Both staged loops in `registryGuard.test.ts` have been vacuous since C1**,
 * which is §11.1.3's third form arriving early. They are kept — they are the
 * mirror of the live pair and would fail on a re-populated map — and backed by a
 * positive `toEqual([])` on BOTH this map and
 * `HOUSE_STAGED_DETERMINISTIC_ID_TABLES`, because a builder left behind for a
 * table that has crossed is exactly the half-finished crossing the loops can no
 * longer catch.
 */
export const HOUSE_STAGED_DETERMINISTIC_ID_BUILDERS: Partial<
  Record<HouseStagedTableName, (...parts: never[]) => string>
> = {};
