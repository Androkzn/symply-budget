/**
 * House V2 ledger registry — Stage H1.
 *
 * The single source of truth for *which* House tables are device-authoritative,
 * how each row is keyed, and how rows bucket for windowed reads. Everything
 * else about the merge (LWW, tombstones, parking, conflict surfacing) is the
 * shared core in `@symply/local-first/projection` — House supplies only this
 * descriptor. See `documents/requirements/House v2/house-local-first-implementation-plan.md`
 * §1.2 (tiering), §1.5 (schema hazards) and §3.2 (this registry).
 *
 * Rules this file encodes, each of which `__tests__/registryGuard.test.ts`
 * proves rather than trusts:
 *
 *  - **S3a — no natural keys.** Every value in `HOUSE_LEDGER_TABLE_KEYS` is
 *    `'id'`. A table keyed on a natural key diverges permanently the first time
 *    a row is deleted and recreated under the same key, because the tombstone is
 *    absorbing.
 *  - **S3b — deterministic ids where a business uniqueness constraint exists.**
 *    The ledger has no unique index, so two devices creating "the same" row
 *    offline would both survive the merge as duplicates. Those tables mint their
 *    `id` from the natural key (`HOUSE_DETERMINISTIC_ID_TABLES` + `ids.ts`).
 *  - **S1 — no duplicate LEDGER names, and exactly one repeated physical one.**
 *    `checklist_items` exists twice in the Drizzle tree (recurring checklists vs
 *    the labor hub) and the registry is a flat map, so Wave A registers the
 *    recurring one as `recurringChecklistItems` and B4 registers the labor-hub
 *    one as `visitChecklistItems`. Since B4 both halves are LIVE, so the live
 *    map is the one that now carries the repeat — until then it could still
 *    claim physical uniqueness, and the guard has been weakened in exactly one
 *    checkable way to match (one repeat, that repeat, nothing else).
 *    `municipality_configs` and `scheduled_notifications` (the other two
 *    collisions) stay out of the ledger entirely.
 *  - **Tier disjointness.** A table that is server-authoritative (Tier B),
 *    global reference (Tier C) or server-derived (Tier D) must never appear in
 *    Tier A.
 *
 * ## Live vs staged (H11)
 *
 * `HOUSE_LEDGER_TABLE_KEYS` is the **live** set: the tables `HouseLedger`
 * actually holds and the projection actually merges. Wave B and Wave C are
 * declared separately, in `HOUSE_WAVE_B_TABLE_KEYS` / `HOUSE_WAVE_C_TABLE_KEYS`,
 * and carry the same four proofs — physical name, row key, window, natural key —
 * without yet widening `HouseLedgerTableName`.
 *
 * **BOTH staged waves are now EMPTY, and so is every construct hanging off
 * them.** C4 completed Wave C on 2026-08-14, which completes H11: all 63
 * registered tables are live, `HouseStagedTableName` is `never`, and
 * `HOUSE_SUB_WAVE_TABLES` is `{}`. That is the terminal state of the whole
 * mechanism rather than a hole in it — see the note above
 * `HOUSE_WAVE_B_TABLE_KEYS`, which argued it first for one wave and now holds
 * for both.
 *
 * The split is not bookkeeping. `HouseLedgerTableName` is consumed by
 * `emptyHouseTables()` (`Pick<HouseLedger, LedgerTableName>`) and by
 * `HOUSE_TABLE_QUERY_KEYS` (an exhaustive `Record`), so widening it without the
 * matching `HouseLedger` arrays and query-key prefixes is a compile error, and
 * widening it *with* empty arrays would ship tables that sync into a ledger no
 * screen reads. Activating a sub-wave is therefore three edits made together:
 * its arrays on `HouseLedger`, its prefixes in `sync/ledgerRefresh.ts`, and
 * moving its block from `HOUSE_WAVE_*_TABLE_KEYS` into
 * `HOUSE_LEDGER_TABLE_KEYS`. Staging it here first means the physical names,
 * windows and natural keys are already verified against D1 and already guarded
 * when that day comes, instead of being re-derived under time pressure.
 *
 * **The move is a CUT, never a copy** — of the table key, of the physical name,
 * of the window, and of the natural key if it has one. A table left in both maps
 * survives the `HOUSE_REGISTERED_*` spreads silently (object keys dedupe, so the
 * count assertions still pass) and then sits in the ledger while
 * `HouseStagedTableName` still claims it is unbuilt. `registryGuard.test.ts`
 * proves live ∩ staged = ∅ for exactly that reason.
 *
 * ### Activated so far
 *
 *  - **B1 — the contractor record** (`contractors`, `contractor_visits`,
 *    `contractor_representatives`, `contractor_documents`). Live since H11 B1;
 *    `localContractorsApi.ts` is its facade. B1 was §11's first sub-wave because
 *    it gates B2: a quote has no meaning without a contractor to hang it on.
 *  - **B2 — quoting** (`appointments`, `quotes`, `contractor_quotes`,
 *    `quote_requests`). Live since H11 B2; `localAppointmentsApi.ts` and
 *    `localQuotesApi.ts` are its facades. Two of the four had no client DTO at
 *    all and were written for this sub-wave (`types.ts`), which is why they left
 *    `HOUSE_STAGED_TABLES_WITHOUT_DTO` in the same edit. B2 is also the first
 *    sub-wave to promote S3b tables: `contractorQuotes` and `quoteRequests`
 *    share the natural key `(task_id, contractor_id)` and their builders moved
 *    from the staged map to the live one alongside them.
 *  - **B3 — the project** (`projects`, `project_milestones`, `project_payments`,
 *    `project_progress_photos`). Live since H11 B3; `localProjectsApi.ts` is its
 *    facade. B3 is the first sub-wave whose tables form a PARENT AND ITS
 *    CHILDREN — three of the four cascade from `projects` in D1 and none of them
 *    carries a `household_id` — so it is the first activation whose correctness
 *    depends as much on the delete path as on the registry. It moved no natural
 *    key (none of the four carries a `uniqueIndex`) and it moved no DTO gap: all
 *    four DTOs already existed in `src/api/projects.ts`, three of them with
 *    documented divergences from D1 that `localProjectsApi.ts` names one by one.
 *  - **B4 — the on-site surface** (`visit_checklists`, `checklist_items`,
 *    `visit_notes`, `checklist_item_photos`, `contractor_messages`,
 *    `contractor_job_ratings`, `contractor_issue_resolutions`). Live since H11
 *    B4, which **completes Wave B**. Its facades are
 *    `localVisitChecklistsApi.ts`, `localMessagesApi.ts` and
 *    `localRatingsApi.ts`; two of the seven tables have no facade at all and are
 *    ledgered for convergence and for the cascade (see `types.ts`).
 *
 *    B4 moved more than any previous sub-wave: the last two Wave-B DTO gaps
 *    (both authored from the Drizzle columns), the S1 rename that makes
 *    `checklist_items` resolvable at all, and the S3b pair
 *    (`contractorJobRatings` + its `ids.ts` builder). It is also the sub-wave
 *    with the most cascade work by a distance — see below.
 *  - **C1 — utilities** (`utility_accounts`, `utility_bills`, `property_taxes`,
 *    `bc_assessment_data`, `utility_reminders`). Live since H11 C1, the FIRST
 *    Wave-C sub-wave; `localUtilitiesApi.ts` is its facade. It moved a DTO gap
 *    (`utility_reminders`, authored from the Drizzle columns), the last S3b pair
 *    in the registry (`propertyTaxes` / `bcAssessmentData` + their `ids.ts`
 *    builders) and two windows.
 *
 *    Three things about C1 are worth carrying into C2–C4. First, it holds the
 *    ONLY cascade obligation in the whole of Wave C — a pre-audit (plan §11.1.2)
 *    established that every other Wave-C parent either soft-deletes or has no
 *    delete at all, so `utilityBills` → `utility_reminders` is the one place a
 *    server delete actually fires a foreign key. Second, both of its S3b tables
 *    are keyed on an integer YEAR, which makes them the worked example of a
 *    natural key that cannot double as a window field. Third, it is the first
 *    sub-wave to ledger a table whose only purpose is to be cascaded — see
 *    `utilityReminders` in the live map below.
 *  - **C2 — floor plans** (`floor_plans`, `floor_plan_markers`,
 *    `floor_plan_annotations`). Live since H11 C2; `localFloorPlansApi.ts` is
 *    its facade. It moved three keys, three physical names, NO window, NO
 *    natural key and NO DTO gap — the smallest registry move of any sub-wave so
 *    far, and the largest facade relative to it.
 *
 *    What makes C2 worth reading is the *fourth* table in its Drizzle file.
 *    `floor_plan_regions` sits between the markers and the annotations in
 *    `schema-floor-plans.ts`, carries an `id`, a `floor_plan_id` and a
 *    `created_at` like they do, and is **Tier D** — the segmentation model's
 *    output, which H7 re-derives on device or the feature is off. Registering it
 *    would look entirely plausible and would make one phone's stale derivation
 *    the shared truth on the other. It is named in `HOUSE_TIER_D_TABLES` and
 *    `registryGuard.test.ts` asserts tier-disjointness over the whole registry,
 *    so the exclusion is proved rather than remembered.
 *
 *    C2 is also the first sub-wave whose parent is SOFT-deleted server-side and
 *    whose children the facade nevertheless drops. The two facts are not in
 *    tension: D1's `onDelete: 'cascade'` never fires because the row survives
 *    with a `deleted_at`, so the plan's cascade pre-audit correctly records "no
 *    cascade" — but the ledger has no `deleted_at` on this DTO, so a local
 *    delete is a real tombstone and a marker left behind is an orphan forever.
 *    `localAppliancesApi.delete` settled that exact distinction in Wave A; the
 *    full audit is on `FLOOR_PLAN_CHILD_TABLES` in `localFloorPlansApi.ts`.
 *  - **C3 — garden plans** (`garden_plans`, `garden_plan_objects`,
 *    `garden_plan_markers`, `garden_plan_boundary_drafts`). Live since H11 C3;
 *    `localGardenPlansApi.ts` is its facade. It moved four keys, four physical
 *    names, ONE window, no natural key and no DTO gap.
 *
 *    C3 repeats C2's delete shape exactly — a soft-deleted parent whose D1
 *    cascade is therefore dead, and a ledger tombstone that obliges the facade to
 *    drop the children anyway — so `GARDEN_PLAN_CHILD_TABLES` is the direct
 *    descendant of `FLOOR_PLAN_CHILD_TABLES` and is derived from the Drizzle
 *    sources the same way. What is NEW is on the row types rather than here:
 *    two of the four DTOs are hand-built PROJECTIONS, not row mirrors, so the
 *    ledger row had to reclaim the cascade key (`garden_plan_objects.
 *    garden_plan_id`), the sort order, the member scope
 *    (`garden_plan_boundary_drafts.user_id` — the only per-MEMBER row in the
 *    registry) and the window field. `types.ts` names all twenty-four
 *    divergences.
 *
 *    `garden_plan_boundary_drafts` is also the first table to cross carrying a
 *    window, which is why the window field had to be checked against the ROW
 *    TYPE and not only against D1: `rowBucket` reads `row['created_at']`, and
 *    that DTO does not declare one. The column is a perfectly good `text`, so
 *    `waveBCSchemaParity` was happy; the window would still have done nothing.
 *  - **C4 — home projects** (`home_projects`, `home_project_budget_lines`,
 *    `home_project_selections`, `home_project_phases`,
 *    `home_project_milestones`, `home_project_blockers`,
 *    `home_project_attachments`, `home_project_plan_links`,
 *    `home_project_comments`, `home_project_activity`). Live since H11 C4,
 *    which **completes Wave C and with it the whole registry**.
 *    `localHomeProjectsApi.ts` is its facade. It moved ten keys, ten physical
 *    names, SIX windows, no natural key — and the registry's last DTO gap.
 *
 *    Three things make C4 the one to read after C3. First, it is the only
 *    React-Query-NATIVE domain in House: `homeProjectKeys` is a real key factory
 *    with three live namespaces, where C1–C3 had no query key at all, so §5.2's
 *    per-table map does real work here rather than pre-registering a namespace
 *    for a future reader. Second, C3's inert-window hazard (§11.1.4b) recurred
 *    TWICE — `homeProjectBlockers` and `homeProjectAttachments` both window on a
 *    `created_at` their DTO does not declare — which is why the check is now
 *    "does the ROW TYPE carry the field", asserted at runtime as well as by
 *    `tsc`. Third, its cascade is the largest in the registry (thirteen children
 *    in D1) and discharges to NOTHING, because no delete for a home project
 *    exists anywhere: not a route, not a service method, not a client api
 *    method. The audit is written up in `localHomeProjectsApi.ts`.
 *
 *    Four of the file's fourteen tables are excluded and each exclusion is
 *    proved elsewhere rather than remembered here: `home_project_geometry` is
 *    Tier D, and the three PK-less joins are in `HOUSE_S2_DEFERRED_TABLES`.
 *
 * ### The correction — `applianceDocuments`, 2026-08-15
 *
 * **This is not a ninth sub-wave.** `appliance_documents` was never in Wave A,
 * Wave B or Wave C; it was never in a tier, never deferred and never excluded.
 * It belonged to no list at all, which is precisely why nothing failed. The
 * plan's 62 is not a budget this entry overspends — it is a count of the tables
 * somebody had classified, and this table was not among them.
 *
 * `registryCompleteness.test.ts` is what found it. Every other guard in this
 * directory asks *"is each registered table well-formed?"*; that one asks *"is
 * every House domain table registered?"*, and the two questions had never been
 * asked together. So the arithmetic moves from `62 + 0 + 0 = 62` to
 * `63 + 0 + 0 = 63` and the shape of the registry does not: no wave was
 * re-opened, no staged map gained an entry, and `HouseStagedTableName` is still
 * `never`.
 *
 * What the omission cost was concrete rather than theoretical.
 * `contractor_documents` — the same shape, an R2 key plus metadata for a
 * maintenance entity, on the same H6 blob channel — shipped in B1 and lists,
 * creates and deletes offline. Its twin could not, so
 * `localAppliancesApi.getDocuments` / `addDocument` threw, no appliance screen
 * could host `HouseAttachmentField`, and that component had no caller anywhere
 * in `src/`.
 *
 * Three properties of this entry differ from every sub-wave above it and are
 * argued at their own sites: it is **unwindowed** (see
 * `HOUSE_WINDOWED_DATE_FIELDS`), it carries **no natural key** (D1 declares two
 * plain lookup indexes on the table and no `uniqueIndex`), and its cascade is
 * the SECOND half of a delete `localAppliancesApi` already performed for
 * `applianceServiceHistory` — see `APPLIANCE_CASCADE_TABLES` there.
 *
 * ### The cascade obligation, which is not in this file
 *
 * A ledger delete is a tombstone, not a foreign key, so nothing in D1 can
 * enforce a cascade on device — an orphan simply syncs to every peer and is
 * never read. Every activation therefore has a second half in whichever facade
 * owns the PARENT of a newly live table, and that half is invisible from here:
 * B2 shipped with `localContractorsApi.delete` still cascading only B1's three
 * tables, and stranded four kinds of orphan until it was found. B3's own
 * children are handled in `localProjectsApi.deleteProject`, and `projects`
 * itself is added to `CONTRACTOR_CASCADE_TABLES` because D1 cascades it from
 * `contractors`. Before activating a sub-wave, grep `backend/src/db/schema*.ts`
 * for every `onDelete: 'cascade'` that points AT one of its tables.
 *
 * B4 is where that obligation is largest, because its tables sit UNDERNEATH two
 * already-live hard-delete parents rather than beside them. Three of the seven
 * cascade from `contractors` and two from `contractorVisits`, and one pair
 * (`visitChecklists` → `visitChecklistItems` → `checklistItemPhotos`) is a
 * two-hop chain inside B4's own facade. The full audit is written up on
 * `CONTRACTOR_CASCADE_TABLES` and `CONTRACTOR_TRANSITIVE_CASCADES` in
 * `localContractorsApi.ts`, which is also where the schema-derived guard lives.
 *
 * C1's obligation is smaller but is the only one Wave C has, and it is entirely
 * internal: `utility_reminders.bill_id` cascades from `utility_bills`, both are
 * C1 tables, and `localUtilitiesApi.deleteBill` performs it in one op. Nothing
 * else in C1 cascades — `utilityAccounts` is soft-deleted and the two annual
 * records have no delete at all — and, importantly, **nothing already live
 * cascades INTO C1 either**, which was the trap B2 fell into. The audit behind
 * both halves is on `BILL_CASCADE_TABLES` in `localUtilitiesApi.ts`.
 *
 * C2 and C3 share the OTHER shape, and it is the one §11.1.1 was corrected to
 * name. Both have a parent whose D1 cascade is real and DEAD — `floor_plans` and
 * `garden_plans` are both soft-deleted, so the foreign key never fires and the
 * plan's pre-audit correctly records "no cascade" for each. The ledger has no
 * `deleted_at` on either DTO, so a local delete is a real tombstone and the
 * children have to be dropped by hand anyway. **A soft server delete does not
 * discharge the local obligation; it hides it.** `FLOOR_PLAN_CHILD_TABLES` and
 * `GARDEN_PLAN_CHILD_TABLES` are those two lists, both derived from the Drizzle
 * sources rather than hand-written, and both guarded against them.
 *
 * Neither sub-wave changed an existing facade, for C1's reason: nothing already
 * live cascades INTO a C2 or C3 table. The only foreign keys pointing at them
 * come from `households`, `householdSpaces` and `users`, none of which is a
 * hard-delete ledger parent.
 *
 * C4 is the THIRD shape, and it is the one the programme spent four sub-waves
 * expecting to be the worst. `home_projects` is cascaded from by **thirteen**
 * tables in D1 — more than any other row in the registry — and the obligation is
 * **nil**, because nothing deletes a home project on either backend. There is no
 * delete route, no service method and no client api method; `archive` flips
 * `status` and the row stays. A cascade is only dangerous if something actually
 * removes the parent, which is the correction plan §11.1.2 made to its own
 * earlier draft. The full two-part audit — the FK half and the local-tombstone
 * half, which §11.1.1 insists are different questions — is on
 * `HOME_PROJECT_CHILD_TABLES` in `localHomeProjectsApi.ts`, where the list is
 * kept as a named constant DESPITE having no caller, so that the day a delete is
 * added it is a compile-time obligation rather than a rediscovery.
 *
 * And nothing already live cascades INTO a C4 table either — the fourth
 * consecutive sub-wave for which that is true. The only foreign keys pointing at
 * these ten come from `households` and `users`. The near miss worth naming is
 * `home_project_plan_links.floor_plan_id`, which points at C2's `floor_plans`
 * and carries **no `references()`**, so `localFloorPlansApi.delete` leaves it
 * dangling exactly as D1 does — C3's `garden_plans.boundary_draft_id` situation,
 * repeated, and reproduced rather than repaired.
 */

/** Ledger tables that participate in sync, mapped to their row-key field. */
export const HOUSE_LEDGER_TABLE_KEYS = {
  households: 'id',
  householdMembers: 'id',
  householdSpaces: 'id',
  tasks: 'id',
  maintenanceCompletions: 'id',
  maintenanceSubtasks: 'id',
  maintenanceTaskNotes: 'id',
  homeFeatures: 'id',
  appliances: 'id',
  applianceServiceHistory: 'id',
  // The 2026-08-15 CORRECTION, not a sub-wave — see the header. Kept beside its
  // siblings rather than appended in a block of its own, because the failure it
  // fixes is exactly that a reader of the appliance family could not see the
  // table was missing. `appliance_documents` is the twin of B1's
  // `contractor_documents`: metadata for a file whose bytes live in the H6 blob
  // channel, cascaded from its parent, and read only through that parent.
  applianceDocuments: 'id',
  garbageSchedules: 'id',
  seasonalChecklists: 'id',
  seasonalChecklistItems: 'id',
  recurringChecklists: 'id',
  recurringChecklistItems: 'id',
  checklistInstances: 'id',
  checklistItemCompletions: 'id',
  householdNotes: 'id',
  settings: 'id',
  recurringReminders: 'id',
  taskDrafts: 'id',
  // H11 B1 — the contractor record and its history, activated out of Wave B.
  // Kept as one block so the next sub-wave's cut lands beside it rather than
  // being scattered through the "core home" list above.
  contractors: 'id',
  contractorVisits: 'id',
  contractorRepresentatives: 'id',
  contractorDocuments: 'id',
  // H11 B2 — quoting, activated out of Wave B. `quotes` is the labor-hub quote
  // raised against an appointment; `contractorQuotes` is the 42-column
  // task-scoped one with the AI-extraction block. Two different tables, kept
  // adjacent so nobody reading this list assumes one is a typo for the other.
  appointments: 'id',
  quotes: 'id',
  contractorQuotes: 'id',
  quoteRequests: 'id',
  // H11 B3 — the project: the job a household actually commissioned, plus the
  // three child tables it owns. `projects` is the only one of the four with a
  // `household_id` column; the other three inherit scope from their parent in
  // D1 and gain the column on the ledger row (`types.ts`, `& Owned`), because a
  // row in a flat op log carries no context about which home it belongs to.
  projects: 'id',
  projectMilestones: 'id',
  projectPayments: 'id',
  projectProgressPhotos: 'id',
  // H11 B4 — the on-site surface, and the last block Wave B had to give. What a
  // member checks off while the contractor is in the room, the notes and photos
  // taken beside it, the correspondence with the company, how the job was rated
  // and whether the issue was actually fixed.
  //
  // `visitChecklistItems` is the S1 rename: its physical table is
  // `checklist_items`, which `recurringChecklistItems` (Wave A) already claims.
  // Both are live from here on, so the LIVE map is the one that carries the
  // repeat — see the S1 note at the top of this file, and `sectionFileName` in
  // `export/houseLedgerExport.ts`, whose disambiguation engages for the first
  // time with this block.
  //
  // `visitNotes` and `contractorIssueResolutions` have no facade of their own.
  // That is deliberate rather than unfinished: neither has a client api module
  // to mirror, and they are ledgered so existing rows converge and so the
  // contractor/visit cascades can reach them (`types.ts` argues both).
  visitChecklists: 'id',
  visitChecklistItems: 'id',
  visitNotes: 'id',
  checklistItemPhotos: 'id',
  contractorMessages: 'id',
  contractorJobRatings: 'id',
  contractorIssueResolutions: 'id',
  // H11 sub-wave C1 — utilities, and the first block of Wave C. What the home
  // costs to run: the account with each provider, every bill against it, and the
  // two annual records that arrive on paper once a year.
  //
  // `utilityReminders` is the one table here with no facade method of its own.
  // That is deliberate and is argued on the type (`types.ts`): the server writes
  // these rows for its own cron, on-device reminders are H4's scheduler reading
  // the bill directly, and the reason the table must nevertheless be registered
  // is the cascade — `utility_reminders.bill_id` is the only `onDelete:
  // 'cascade'` in the whole of Wave C that a server delete actually fires, and
  // an unregistered table cannot be cascaded.
  utilityAccounts: 'id',
  utilityBills: 'id',
  propertyTaxes: 'id',
  bcAssessmentData: 'id',
  utilityReminders: 'id',
  // H11 sub-wave C2 — floor plans, and the second block of Wave C. The drawing
  // of the home itself, the pins a member drops on it to tie a task to a place,
  // and the freehand lines and measurements drawn over the top.
  //
  // Only the USER-EDITABLE surface. `floor_plan_regions` — the fourth table in
  // `schema-floor-plans.ts`, and the one that looks most like it belongs here —
  // is Tier D and must never be registered: it is the segmentation model's
  // output, re-derived on device by H7 or the feature is off, and syncing it
  // would make one phone's stale derivation authoritative on the other.
  floorPlans: 'id',
  floorPlanMarkers: 'id',
  floorPlanAnnotations: 'id',
  // H11 sub-wave C3 — garden plans, and the third block of Wave C. The picture
  // of the yard, the vector objects a member arranges over it, the pins that tie
  // a task to a spot in it, and the lot-boundary drafts the satellite flow used
  // to produce before that flow was retired.
  //
  // All four tables in `schema-garden-plans.ts` are here, which makes this the
  // first Wave-C block with NO excluded sibling: C1 had to leave out two Tier-C
  // tables and a Tier-D one, C2 had to leave out `floor_plan_regions`, and this
  // file declares four tables that are all the member's own.
  //
  // `gardenPlanBoundaryDrafts` is scoped to a MEMBER rather than to the property
  // — `listPendingDrafts` filters on `user_id` — which is unique in this
  // registry and is argued on the type. It is also the only C3 table the server
  // HARD-deletes, and it is a leaf, so that delete cascades nothing.
  gardenPlans: 'id',
  gardenPlanObjects: 'id',
  gardenPlanMarkers: 'id',
  gardenPlanBoundaryDrafts: 'id',
  // H11 sub-wave C4 — home projects, the fourth block of Wave C and the block
  // that COMPLETES the registry. The renovation a household is planning: what it
  // is, what it should cost, what is being bought for it, when each stage
  // happens, what is in the way, the paperwork, the plan it sits on, the
  // conversation about it and the log of everything that was done to it.
  //
  // NOT `projects`, which is B3's labor-hub contractor job and sits thirty lines
  // above. Two different features in two different Drizzle files, and only the
  // `homeProject` prefix keeps them apart.
  //
  // Ten of the file's FOURTEEN tables. `home_project_geometry` is Tier D (the
  // generated layout, re-derived on device by H7 or the feature is off), and
  // `home_project_spaces`, `home_project_tasks` and `home_project_contractors`
  // are hazard S2 — join tables with no primary key at all, which is why a
  // project cannot record which rooms, tasks or contractors it involves until
  // the backend models them as arrays on the parent.
  //
  // `homeProjectComments` is the one table here with no reader at all: nothing
  // lists a comment back, on either backend. It is registered for convergence,
  // the position `visitNotes` and `utilityReminders` hold — and unlike them it
  // IS written locally, because `addComment` is on the client module.
  homeProjects: 'id',
  homeProjectBudgetLines: 'id',
  homeProjectSelections: 'id',
  homeProjectOptionGroups: 'id',
  homeProjectPhases: 'id',
  homeProjectMilestones: 'id',
  homeProjectBlockers: 'id',
  homeProjectAttachments: 'id',
  homeProjectPlanLinks: 'id',
  homeProjectComments: 'id',
  homeProjectActivity: 'id',

  // H13 D-wave — the five tables that used to be Tier D, "server-derived:
  // re-derived on device (H7) or the feature is off".
  //
  // Tier D was never a claim that the data does not belong to a household; it
  // was a claim about WHO COMPUTES it. H7 settled that half — `useHomeInsight`
  // and `useGarbageDayInference` derive on device against the ledger — and once
  // the derivation is local, the *result* has nowhere to live but the ledger.
  // A derived row that is only ever recomputed is not free: it costs the
  // recompute on every cold open, and it cannot carry a member's edit (a
  // dismissed suggestion, a renamed region) because the next derivation
  // overwrites it.
  //
  // Two of the five are not household-scoped by a column at all — they hang off
  // an already-live parent (`floor_plan_regions.floor_plan_id`,
  // `home_project_geometry.project_id`). That is the same shape B3 established
  // for `contractors → projects → milestones`, so they inherit the parent's
  // ledger without a scoping decision of their own, and they inherit its
  // cascade obligation too: see the delete passes in `localFloorPlansApi` and
  // `localHomeProjectsApi`, which now have a third and second drop respectively.
  maintenanceSuggestions: 'id',
  contractorRecommendations: 'id',
  utilityTrends: 'id',
  floorPlanRegions: 'id',
  homeProjectGeometry: 'id',

  // H13 B-wave — eleven of the twenty-one tables Tier B held.
  //
  // Tier B meant "server-authoritative, never ledgered", which conflated two
  // different claims. For most of these it only ever meant "the server is where
  // it happens to live"; for a few it means something structural, and those are
  // NOT here. Three groups stayed behind, on grounds no re-tier discharges:
  //
  //  - the report pipeline (`reports`, `report_chunks`, `findings`,
  //    `finding_spaces`, `report_images`, `report_summaries`,
  //    `processing_jobs`) — the Lambda has to read the PDF, so the work is
  //    server-side by construction and the rows are its output;
  //  - `subscriptions` — RevenueCat is the entitlement authority; a device that
  //    owns its own entitlement row owns its own paywall;
  //  - `scheduled_notifications` and `notification_history` — the first is APNs
  //    infrastructure the cron drains, the second is keyed by `user_id` and
  //    spans households, so it has no single ledger to belong to.
  //
  // `chatRoomParticipants` and `chatRoomReads` are the wave's S3a tables: both
  // are PK-less in D1 (composite `(room_id, user_id)`), so they have no `id`
  // column to key on and get a deterministic one built from the natural key.
  // Registering them with a random id would let the same member join a room
  // twice on two devices.
  assistantBriefings: 'id',
  assistantOutboundLog: 'id',
  assistantTrustLedger: 'id',
  assistantIdentity: 'id',
  aihousekeeperAttachments: 'id',
  auditLog: 'id',

  // --- Neighbours (migration 0165) -----------------------------------------
  //
  // Three new tables, Tier A on arrival for the same reason the contractor
  // address book was: this is the member's own record of who lives around them,
  // written offline, and there is nothing in it a server could compute or a
  // model should read. It is the most sensitive family on the ledger by some
  // distance — every row is a third party who did not install this app — so the
  // decision that it never leaves the household's devices is the design, not a
  // consequence of the tier.
  //
  // `neighbourhoods` carries a business `uniqueIndex` (`household_id, name`) and
  // is therefore S3b: its id is minted from the natural key so two members
  // naming the same area offline merge instead of duplicating. The other two
  // have no uniqueness — two homes may share a label ("The Smiths" twice on one
  // street is a coincidence, not an error) and two occupants certainly may.
  neighbourhoods: 'id',
  neighbours: 'id',
  neighbourPeople: 'id',
} as const;

export type HouseLedgerTableName = keyof typeof HOUSE_LEDGER_TABLE_KEYS;

export const HOUSE_LEDGER_TABLE_NAMES = Object.keys(
  HOUSE_LEDGER_TABLE_KEYS,
) as HouseLedgerTableName[];

/**
 * The live ledger — 21 "core home" tables (plan §1.2) plus the 4 that sub-wave
 * B1 promoted out of Wave B, the 4 that B2 did, the 4 that B3 did, the 7 that B4
 * did, the 5 that C1 did, the 3 that C2 did, the 4 that C3 did and the 10 that
 * C4 did, **plus one table that was in no wave at all**. The name stays `WAVE_A`
 * because it is what `HouseLedgerTableName` spans, and because the arithmetic
 * `A + B + C = REGISTERED` has to keep holding as tables migrate between the
 * three buckets; each activation moves the boundary, never the total.
 *
 * With B4 the whole of Wave B had crossed, so this number became "Wave A plus
 * all of Wave B" and `HOUSE_WAVE_B_TABLE_COUNT` went to 0; C1 was the first
 * sub-wave to move the Wave C boundary the same way, and C4 was the last.
 *
 * **The arithmetic is now `74 + 0 + 0 = 74`, and it is still worth checking.**
 * Both addends being zero is the terminal state, not a reason to collapse the
 * sum: the identity is what catches a table that goes missing from
 * `HOUSE_LEDGER_TABLE_KEYS` without being put back anywhere, which is a real
 * edit somebody will make. Expressing it as three addends is precisely what
 * survived eight crossings; removing two of them now would throw that away on
 * the day it stops moving.
 *
 * **62 → 63 is a CORRECTION OF AN OMISSION, not a ninth crossing.** The plan's
 * 62 counted the tables that had been classified, and `appliance_documents` had
 * not been: it appeared in no wave map, no tier, no deferral list and no
 * exclusion list, so no guard could see it was absent. The addend that grew is
 * this one *because there was no staged bucket to take it from* — Wave B and
 * Wave C were already empty when the table was found. Nothing crossed; the count
 * simply became true. See the header for the full argument, and
 * `registryCompleteness.test.ts` for the guard that will not let a second table
 * hide the same way.
 *
 * **74 → 75 is a NEW TABLE, and the first growth here that is neither a
 * crossing nor a correction.** Migration 0162 added
 * `home_project_option_groups` — the surface a member is choosing a material
 * for, carrying its area, its waste allowance and which option won. It is Tier
 * A on arrival rather than staged: it is the member's own planning, it is
 * written offline by `localHomeProjectsApi.createOptionGroup`, and the option
 * cards are unreadable without it. Wave B and Wave C were already empty, so as
 * with `appliance_documents` this addend is the only one that could take it.
 *
 * **75 → 78 is the Neighbours family**, migration 0165: `neighbourhoods`,
 * `neighbours` and `neighbour_people`. Same category as 0162 — new tables, not
 * a crossing and not a correction — and the same reasoning puts them here on
 * arrival. What is different is the privacy argument, which is stronger than any
 * previous addition's: these rows describe people who never agreed to anything,
 * so "the ledger owns it and no server can read it" is the feature's premise
 * rather than a property it happens to inherit. `egressAllowlist.test.ts` proves
 * all three stay out of every AI payload.
 */
export const HOUSE_WAVE_A_TABLE_COUNT = 78;

/**
 * Ledger name → physical D1 table. Two ledger names deliberately differ from
 * the physical name (S1 disambiguation); the rest are the snake_case form.
 */
export const HOUSE_LEDGER_PHYSICAL_TABLES: Record<HouseLedgerTableName, string> = {
  households: 'households',
  householdMembers: 'household_members',
  householdSpaces: 'household_spaces',
  tasks: 'tasks',
  maintenanceCompletions: 'maintenance_completions',
  maintenanceSubtasks: 'maintenance_subtasks',
  maintenanceTaskNotes: 'maintenance_task_notes',
  homeFeatures: 'home_features',
  appliances: 'appliances',
  applianceServiceHistory: 'appliance_service_history',
  // The 2026-08-15 correction. Plain snake_case, no S1 rename — and no
  // near-neighbour to confuse it with either: `appliance_documents` is the only
  // `*_documents` table in `schema-maintenance.ts`, and B1's
  // `contractor_documents` lives in a different file under a different ledger
  // name. The hazard here was never ambiguity; it was absence.
  applianceDocuments: 'appliance_documents',
  garbageSchedules: 'garbage_schedules',
  seasonalChecklists: 'seasonal_checklists',
  seasonalChecklistItems: 'seasonal_checklist_items',
  // S1: `checklists` + `checklist_items` collide with the labor-hub pair.
  recurringChecklists: 'checklists',
  recurringChecklistItems: 'checklist_items',
  checklistInstances: 'checklist_instances',
  checklistItemCompletions: 'checklist_item_completions',
  householdNotes: 'household_notes',
  settings: 'settings',
  recurringReminders: 'recurring_reminders',
  taskDrafts: 'task_drafts',
  // H11 B1. None of these needed an S1 rename — the labor hub's only physical
  // collision with Wave A is `checklist_items`, which belongs to B4.
  contractors: 'contractors',
  contractorVisits: 'contractor_visits',
  contractorRepresentatives: 'contractor_representatives',
  contractorDocuments: 'contractor_documents',
  // H11 B2. All four are the plain snake_case of the ledger name — no S1 rename
  // was needed, because the two quote tables collide in ENGLISH ("the quotes
  // table") and not in SQL: `quotes` and `contractor_quotes` are distinct
  // physical names, so the flat map holds both without help.
  appointments: 'appointments',
  quotes: 'quotes',
  contractorQuotes: 'contractor_quotes',
  quoteRequests: 'quote_requests',
  // H11 B3. Plain snake_case again — and worth stating that `projects` is NOT
  // `home_projects`. Those are two different features in two different Drizzle
  // files: `projects` (schema-labor-hub.ts) is the contractor job this sub-wave
  // ledgers, `home_projects` (schema-home-projects.ts) is the C4 renovation
  // planner, and the C4 block below registers its own family under names that
  // all begin `homeProject`. Nothing disambiguates them but the prefix, so a
  // `projects` entry pointing at `home_projects` would look plausible and would
  // merge two unrelated features into one table.
  projects: 'projects',
  projectMilestones: 'project_milestones',
  projectPayments: 'project_payments',
  projectProgressPhotos: 'project_progress_photos',
  // H11 B4, and the one block in this map where a rename is load-bearing rather
  // than cosmetic. `visitChecklistItems` → `checklist_items` is the second half
  // of the S1 fix begun by `recurringChecklistItems` above: two different
  // Drizzle tables (`schema-checklists.ts:41` and `schema-labor-hub.ts:344`)
  // declare that physical name, and a flat map cannot hold it twice.
  //
  // From here the LIVE map contains the repeat, which changes two guards that
  // used to be able to assert live physical-name uniqueness — `registryGuard`
  // and `houseLedgerExport` — and engages `sectionFileName`'s disambiguation.
  // Nothing else in the block needed renaming; the rest are plain snake_case.
  visitChecklists: 'visit_checklists',
  visitChecklistItems: 'checklist_items',
  visitNotes: 'visit_notes',
  checklistItemPhotos: 'checklist_item_photos',
  contractorMessages: 'contractor_messages',
  contractorJobRatings: 'contractor_job_ratings',
  contractorIssueResolutions: 'contractor_issue_resolutions',
  // H11 C1. Plain snake_case, no rename needed — but two names in this block are
  // one character away from a table that must NOT be ledgered.
  // `utility_providers` is Tier C (the provider catalogue every household
  // shares) and `utility_trends` is Tier D (server-derived monthly rollups); an
  // entry here pointing at either would look entirely plausible and would sync
  // reference data or a stale derivation between members as if it were theirs.
  // `municipality_configs`, the third utilities table in that file, is Tier C
  // AND one of the three physical-name collisions, so it stays out twice over.
  utilityAccounts: 'utility_accounts',
  utilityBills: 'utility_bills',
  propertyTaxes: 'property_taxes',
  bcAssessmentData: 'bc_assessment_data',
  utilityReminders: 'utility_reminders',
  // H11 C2. Plain snake_case, no rename needed — and the block where the ABSENT
  // entry matters more than the present ones. `floor_plan_regions` is the only
  // other table in `schema-floor-plans.ts` shaped like a ledger row, it sorts
  // between these two in the file, and it is Tier D. An entry here pointing at
  // it would look like the most natural line in the block.
  floorPlans: 'floor_plans',
  floorPlanMarkers: 'floor_plan_markers',
  floorPlanAnnotations: 'floor_plan_annotations',
  // H11 C3. Plain snake_case, no rename needed — and the first Wave-C block
  // whose Drizzle file has NOTHING left over: `schema-garden-plans.ts` declares
  // exactly these four tables. C1 had to exclude three of its file's eight and
  // C2 one of its four, so the "which sibling must not be here" note that both
  // of those blocks carry has no counterpart in this one.
  //
  // Two names are near-neighbours of a LIVE table rather than of an excluded
  // one: `garden_plan_markers` beside `floor_plan_markers`, and
  // `garden_plan_objects` beside nothing at all. The pair of marker tables is
  // the hazard here — they are similar enough that C2's facade could be copied
  // onto this one by mistake, and they differ in three columns and one whole
  // behaviour (see `types.ts`).
  gardenPlans: 'garden_plans',
  gardenPlanObjects: 'garden_plan_objects',
  gardenPlanMarkers: 'garden_plan_markers',
  gardenPlanBoundaryDrafts: 'garden_plan_boundary_drafts',
  // H11 C4. Plain snake_case, no rename needed — and the block with the most
  // excluded siblings of any in the map. `schema-home-projects.ts` declares
  // FOURTEEN tables and only ten may be ledgered:
  //
  //  - `home_project_geometry` is Tier D. It is the C4 twin of C2's
  //    `floor_plan_regions`: machine output, re-derived on device by H7 or the
  //    feature is off, sitting in the same file as ten tables that ARE the
  //    member's own, and an entry for it here would look like the most natural
  //    line in the block.
  //  - `home_project_spaces`, `home_project_tasks` and
  //    `home_project_contractors` are hazard S2 — no primary key at all, so
  //    there is nothing to key a row on. They are named in
  //    `HOUSE_S2_DEFERRED_TABLES` and `waveBCSchemaParity` proves against the
  //    Drizzle sources that none of the three has an `id` column, so the
  //    exclusion is checkable rather than remembered.
  //
  // The prefix is doing real work in this block. `homeProjects` →
  // `home_projects` sits in the same flat map as B3's `projects` → `projects`,
  // and either entry pointing at the other's table would merge two unrelated
  // features into one ledger table while every count assertion still passed.
  homeProjects: 'home_projects',
  homeProjectBudgetLines: 'home_project_budget_lines',
  homeProjectSelections: 'home_project_selections',
  homeProjectOptionGroups: 'home_project_option_groups',
  homeProjectPhases: 'home_project_phases',
  homeProjectMilestones: 'home_project_milestones',
  homeProjectBlockers: 'home_project_blockers',
  homeProjectAttachments: 'home_project_attachments',
  homeProjectPlanLinks: 'home_project_plan_links',
  homeProjectComments: 'home_project_comments',
  homeProjectActivity: 'home_project_activity',

  // H13 D-wave. `homeProjectGeometry` is the third entry in this map whose
  // prefix is load-bearing rather than cosmetic: `home_project_geometry` is a
  // sibling of `home_projects`, not a table named `geometry`, and the flat map
  // gives no other signal.
  maintenanceSuggestions: 'maintenance_suggestions',
  contractorRecommendations: 'contractor_recommendations',
  utilityTrends: 'utility_trends',
  floorPlanRegions: 'floor_plan_regions',
  homeProjectGeometry: 'home_project_geometry',

  // H13 B-wave.
  assistantBriefings: 'assistant_briefings',
  assistantOutboundLog: 'assistant_outbound_log',
  assistantTrustLedger: 'assistant_trust_ledger',
  assistantIdentity: 'assistant_identity',
  aihousekeeperAttachments: 'aihousekeeper_attachments',
  auditLog: 'audit_log',
  // Neighbours (0165). All three ledger names are the plain camelCase form of
  // the physical name — no S1 disambiguation is needed, because none of the
  // three collides with anything already in the Drizzle tree.
  neighbourhoods: 'neighbourhoods',
  neighbours: 'neighbours',
  neighbourPeople: 'neighbour_people',
};

/**
 * Windowed-read date fields, first match wins. Anything unparseable — and every
 * tombstone — degrades to the always-resident bucket, never to "invisible".
 *
 * The column names are the D1 ones, verified against the schema: `tasks` has
 * `next_due_date` and `scheduled_work_date` (there is no `due_date`), and
 * `checklist_instances` windows on `period_start` (it has no due date at all).
 *
 * B1's two event tables lead with the DOMAIN date and fall back to `created_at`,
 * because bucketing a call-out by when the row happened to be written rather
 * than by when the contractor came would scatter one job across two months.
 * `contractors` and `contractorRepresentatives` are deliberately absent: they
 * are the address book — a few dozen rows every labor screen reads on first
 * render — and windowing them would hide a plumber whose record is merely old.
 *
 * B2 is entirely event-shaped and so all four of its tables are windowed. Each
 * leads with the moment the EVENT happened rather than the moment the row was
 * written: an appointment belongs to the month it is booked for, a quote to the
 * month it was submitted, a request to the month it was sent. `quotes` is the
 * exception that proves the rule — it has no domain date at all (`valid_until`
 * is an expiry, not an occurrence, and bucketing by it would file a quote under
 * a month in which nothing happened), so `created_at` is the honest answer
 * rather than a fallback.
 *
 * B3 windows all four of its tables, and it is the first family where the
 * PARENT and its children deliberately window on DIFFERENT fields. A project
 * buckets by when the work started; its milestones by when each is due; its
 * payments by when each falls due (then when it was paid); its photos by when
 * the picture was taken. That is the opposite of the rule `visitChecklists` /
 * `visitChecklistItems` follow, and the difference is real rather than
 * inconsistent: a checklist and its items are one screen written in one moment,
 * so splitting them across buckets would render a checklist whose items are
 * missing, whereas a project spans months by definition and its children are
 * events strung along that span. `localProjectsApi` reads a project's children
 * through the project, so a milestone in a colder bucket is hydrated with the
 * project rather than orphaned by it.
 *
 * B4 windows all seven, and carried its field lists across unchanged. Its rule
 * is the SAME-BUCKET one: `visitChecklists` and `visitChecklistItems` both
 * window on `created_at`, and `checklistItemPhotos` leads with `taken_at` only
 * because a photo genuinely has a moment of its own. Every other table in the
 * block leads with the instant the event happened — a note when it was dictated,
 * a message when it was sent, a resolution when the issue was closed — and falls
 * back to `created_at`, which is the only field guaranteed to be set.
 * `contractorJobRatings` is the one with no domain date at all: a rating is
 * written once, at the moment it is given, so `created_at` IS the occurrence
 * rather than a fallback. `quotes` is the same argument, made in B2.
 *
 * C2 adds NOTHING to this map, which is the first time a sub-wave has crossed
 * without contributing a window and is a decision rather than an omission. A
 * drawing is not a list. A task outside the window is absent and obviously so; a
 * MARKER outside the window renders a floor plan that looks complete and is
 * wrong — the boiler simply is not on it, and nothing on the screen suggests
 * anything is missing. Plans are also few (a household has one per floor, not
 * one per month), so there is nothing to win by windowing them. The claim that
 * all three stay unwindowed is asserted positively in `waveC.test.ts` rather
 * than left to the absence of an entry here.
 *
 * C3 adds exactly ONE, and the split inside its own four tables is the same
 * argument made twice. Three of them are drawing content — the yard plan, the
 * objects arranged on it and the pins dropped on it — so they follow C2's rule
 * and stay resident. The fourth, `gardenPlanBoundaryDrafts`, is the opposite
 * kind of row: it is TRANSIENT scaffolding with an `expires_at`, discarded once
 * a plan is generated from it, and `listBoundaryDrafts` already refuses to
 * return an expired one. A draft outside the read window is one the only reader
 * would have filtered out anyway, so the window costs nothing and bounds a table
 * that would otherwise accumulate forever.
 *
 * It is also the first window whose field had to be checked against the ROW TYPE
 * rather than only against D1. `rowBucket` reads `row['created_at']`; the
 * `GardenPlanBoundaryDraft` DTO does not declare one, so before C3 added it the
 * entry below would have parsed nothing and bucketed everything always-resident
 * — configured-looking and inert, which is precisely §11.1.3's hazard reaching a
 * place `waveBCSchemaParity` cannot see (the D1 column is a fine `text`).
 *
 * C4 windows SIX of its ten and leaves four resident, and the split is the
 * clearest statement of this map's rule anywhere in the registry. The four
 * resident ones — budget lines, selections, phases, plan links — ARE the
 * project: `getHub` reads every one of them on the first render, so a row in a
 * colder bucket is an estimate that is short by one line, which is C2's
 * "complete and wrong" failure with a number attached. The six windowed ones are
 * events strung along the job: the project itself buckets by when the work
 * starts, a milestone by when it is due, and the four append-only tables
 * (blockers, attachments, comments, activity) by when each was written.
 *
 * **Two of those six windows had to be rescued the way C3's was**, and this is
 * the paragraph to read before adding a window anywhere. `homeProjectBlockers`
 * and `homeProjectAttachments` both window on `created_at`, and NEITHER
 * `HomeProjectBlocker` nor `HomeProjectAttachment` declares such a field. Both
 * D1 columns are perfectly good `notNull text`, so `waveBCSchemaParity` was
 * satisfied and both windows would still have bucketed every row
 * always-resident. C4 carries the field on both row types (`types.ts`) and
 * `localHomeProjectsApi.test.ts` asserts `rowBucket` at runtime for both, which
 * is the only form of the check that fails when the registry entry is the half
 * that goes missing.
 *
 * **`applianceDocuments` (the 2026-08-15 correction) is deliberately ABSENT**,
 * and it is the entry a reader is most likely to think was forgotten — because
 * its twin `contractorDocuments` sits a few lines below, windowed on
 * `['document_date', 'created_at']`. Three reasons, and the third decides it:
 *
 *  1. **The row type has no window-able field.** `ApplianceDocument` declares
 *     exactly one date, `uploaded_at`, and `appliance_documents` has **no such
 *     D1 column** — the table's own dates are `upload_date` and `created_at`,
 *     and the Worker's own response returns neither under the DTO's name (see
 *     `types.ts`, where that divergence is written down). So the obvious entry,
 *     `['uploaded_at']`, fails `waveBCSchemaParity` outright, which is that
 *     guard doing exactly what it exists for.
 *  2. **The rescue C3 and C4 used would cost a DUPLICATED FACT here.** Carrying
 *     `upload_date` on the row type alongside `uploaded_at` would put one
 *     instant in two fields of one row, and per-field LWW is free to converge
 *     them to different answers — the failure `types.ts` states as its
 *     derived-collection rule. C3's `gardenPlanBoundaryDrafts` and C4's two
 *     rescues each added a field the DTO was simply MISSING; not one of them
 *     added a second name for a field it already had.
 *  3. **Product: these documents ARE the appliance, not events against it.**
 *     C4's line — "is this row part of the thing, or something that happened to
 *     the thing" — puts the manual, the receipt and the warranty scan on the
 *     resident side beside budget lines and selections. They are read as a set
 *     the moment `ApplianceDetailScreen` opens, they number a handful per
 *     appliance forever, and one in a colder bucket renders an appliance that
 *     looks like it has no warranty paperwork with nothing on screen to say
 *     otherwise — C2's "complete and wrong", applied to the member's most
 *     consequential piece of filing.
 *
 * The claim is asserted POSITIVELY rather than left to this absence:
 * `waveBCSchemaParity.test.ts` proves against the Drizzle source that no
 * `uploaded_at` column exists, that `upload_date` and `created_at` are both
 * perfectly good `text` (so this is a DECLINED window, not an impossible one),
 * and that this entry is `undefined`; `localAppliancesApi.test.ts` then asserts
 * at runtime that a real document row buckets to `ALWAYS_RESIDENT_BUCKET`. That is C3's and C4's
 * two-sided check pointed the other way: they proved a configured window is not
 * inert, this proves an absent window is a decision and not an oversight.
 */
export const HOUSE_WINDOWED_DATE_FIELDS: Partial<
  Record<HouseLedgerTableName, readonly string[]>
> = {
  tasks: ['next_due_date', 'scheduled_work_date', 'created_at'],
  maintenanceCompletions: ['completed_at'],
  maintenanceTaskNotes: ['created_at'],
  applianceServiceHistory: ['service_date'],
  checklistInstances: ['period_start'],
  checklistItemCompletions: ['completed_at'],
  householdNotes: ['created_at'],
  taskDrafts: ['created_at'],
  // H11 B1. `visit_date` is notNull in D1 and `document_date` is nullable, but
  // both keep the `created_at` fallback: notNull on a `text` column is not
  // well-formed, and first-match-wins costs nothing when the lead field is set.
  contractorVisits: ['visit_date', 'created_at'],
  contractorDocuments: ['document_date', 'created_at'],
  // H11 B2, carried across from the staged map with their field lists intact.
  appointments: ['scheduled_date', 'created_at'],
  quotes: ['created_at'],
  contractorQuotes: ['submitted_at', 'created_at'],
  quoteRequests: ['requested_at', 'created_at'],
  // H11 B3, carried across from the staged map with their field lists intact.
  // `projectPayments` leads with `due_date` and falls back to `paid_date`
  // because a payment schedule is agreed up front and settled later: the due
  // date is the field that exists for every row, and the paid date only for
  // rows that have been settled.
  projects: ['start_date', 'created_at'],
  projectMilestones: ['due_date', 'created_at'],
  projectPayments: ['due_date', 'paid_date', 'created_at'],
  projectProgressPhotos: ['taken_at', 'created_at'],
  // H11 B4, carried across from the staged map with their field lists intact.
  // The checklist and its items share ONE field on purpose — see the note above.
  visitChecklists: ['created_at'],
  visitChecklistItems: ['created_at'],
  visitNotes: ['timestamp', 'created_at'],
  checklistItemPhotos: ['taken_at', 'created_at'],
  contractorMessages: ['sent_at', 'created_at'],
  contractorJobRatings: ['created_at'],
  contractorIssueResolutions: ['resolved_at', 'created_at'],
  // H11 C1, carried across from the staged map with their field lists intact.
  // Only two of the five are windowed, and the other three are absent for three
  // DIFFERENT reasons rather than by oversight:
  //
  //  - `utilityAccounts` is the address book — a handful of rows every utilities
  //    screen reads on first render, the same argument `contractors` makes;
  //  - `propertyTaxes` and `bcAssessmentData` CANNOT be windowed. Their only
  //    period column is `tax_year` / `assessment_year`, which D1 declares
  //    `integer`, and `rowBucket` reads a `YYYY-MM` prefix off a string — so a
  //    window naming them would look configured and do nothing at all. They are
  //    also one row per year, so always-resident is the right answer anyway, and
  //    House has no `bucketOverride` (unlike Budget's `goals`) to reach for.
  //    `waveBCSchemaParity.test.ts` asserts BOTH halves: the column type, and
  //    the absence of a window.
  //
  // `utilityBills` leads with the billing PERIOD rather than the due date
  // because the period is what a member searches by ("last winter's gas"), and a
  // due date routinely falls in the following month. Both are notNull, so the
  // order is a real choice rather than a fallback. `utilityReminders` leads with
  // `scheduled_for`, the moment the reminder is FOR, not when the row was made.
  utilityBills: ['billing_period_start', 'due_date', 'created_at'],
  utilityReminders: ['scheduled_for', 'created_at'],
  // H11 C3, carried across from the staged map with its field list intact — the
  // only one of C3's four tables that is windowed at all. `expires_at` was the
  // tempting lead field and is wrong: it is a deadline, not an occurrence, and a
  // draft created in January that expires in February would bucket under
  // February on every device, which is the mistake B2 declined to make on
  // `quotes.valid_until`. `created_at` is `notNull` in D1 and, since C3, on the
  // row type as well — which is the half that makes this entry do anything.
  gardenPlanBoundaryDrafts: ['created_at'],
  // H11 C4, carried across from the staged map with their field lists intact —
  // six of the ten, and the largest window block any sub-wave has moved.
  //
  // `homeProjects` leads with `target_start_at`, the month the work is meant to
  // begin, and the `created_at` fallback is load-bearing rather than defensive:
  // the column is nullable, and capturing a project long before scheduling it is
  // the ordinary case ("someday: redo the ensuite").
  //
  // `homeProjectMilestones` leads with `due_on` for B3's reason — a project
  // spans months by definition and its milestones are events strung along that
  // span — and it is safe for B3's reason too: `getHub` reads a milestone
  // THROUGH its project, never standalone, so one in a colder bucket is hydrated
  // with the project rather than orphaned by it.
  //
  // The four append-only tables lead with `created_at` because none of them has
  // a domain date at all. A blocker is raised, a photo is attached, a comment is
  // posted and an activity row is written, each once, at the moment it happens —
  // so `created_at` IS the occurrence rather than a fallback. `quotes` (B2) and
  // `contractorJobRatings` (B4) made the same argument.
  //
  // `homeProjectBlockers` and `homeProjectAttachments` are the two entries whose
  // field is NOT on the DTO their row type is built from — see this map's header
  // and `types.ts`. The field is carried on the row type; without it these two
  // lines would be inert.
  homeProjects: ['target_start_at', 'created_at'],
  homeProjectMilestones: ['due_on', 'created_at'],
  homeProjectBlockers: ['created_at'],
  homeProjectAttachments: ['created_at'],
  homeProjectComments: ['created_at'],
  /** Append-only audit trail — the highest-cardinality table in C4. */
  homeProjectActivity: ['created_at'],
  // Neighbours (0165) declines a window on all THREE tables, and the reason is
  // the sharpest instance of C2's "complete and wrong" in the registry.
  //
  // A task outside the read window is absent and obviously so — the list is
  // short, the member notices. A NEIGHBOUR outside it is a hole in a map: the
  // pins around it render, the street looks fully surveyed, and the one home
  // that is missing is indistinguishable from a home nobody has added. There is
  // nothing on screen that could say otherwise, because a map has no empty rows.
  //
  // The cardinality argument agrees rather than merely permitting it. This is an
  // address book of the homes within sight of one property: a few dozen rows at
  // the outside, bounded by geography rather than by time, exactly like
  // `contractors` (B1) and `utilityAccounts` (C1). `created_at` would be the only
  // candidate field on any of the three, and bucketing an address book by when
  // its entries were typed sorts on a fact nobody reads.
};

/**
 * S3b — Tier-A tables whose D1 row carries a business `uniqueIndex`. Each maps
 * to the natural-key columns the deterministic id is derived from, so the guard
 * can prove every one of them has a registered builder in `ids.ts`.
 */
export const HOUSE_DETERMINISTIC_ID_TABLES: Partial<
  Record<HouseLedgerTableName, readonly string[]>
> = {
  householdMembers: ['household_id', 'user_id'],
  /**
   * Not a D1 `uniqueIndex`, but a business uniqueness constraint all the same:
   * the server enforces at-most-one-active schedule per household, and
   * `getSchedule` AUTO-CREATES one the first time the Garbage tab is opened.
   * Two members opening that tab offline would each mint a row and both would
   * survive the merge — the S3b failure mode arriving through a read rather
   * than a write. Found during the H3 port.
   */
  garbageSchedules: ['household_id'],
  settings: ['user_id', 'household_id', 'key'],
  checklistItemCompletions: ['instance_id', 'item_id'],
  /**
   * Not D1 uniqueIndexes, but natural keys all the same — and both are minted by
   * a READ that auto-materializes (`getProgress` creates the current instance,
   * `getCurrent` creates the season's shell). Two members opening the tab
   * offline would each mint a row. Registered so `registryGuard` covers them
   * rather than leaving the discipline to whoever writes the next call site.
   * Found during the H3 port.
   */
  checklistInstances: ['checklist_id', 'period_start'],
  seasonalChecklists: ['household_id', 'season', 'year'],
  recurringReminders: ['household_id', 'type', 'reference_id', 'period_key'],
  /**
   * H11 B2, and the first pair of live tables to SHARE a natural key:
   * `contractor_quotes_task_contractor_unique_idx` and
   * `quote_requests_task_contractor_unique_idx` are both `(task_id,
   * contractor_id)`. Their ids must still differ, which is what the per-table
   * prefix in `deterministicRowId` buys — without it, asking a contractor for a
   * quote and receiving one would collide into a single row and accepting the
   * quote would overwrite the request that produced it.
   *
   * These are also the first S3b tables whose double-create is an ORDINARY
   * event rather than a race: a quote arrives as a PDF that either member may
   * file, and "we both saved the same estimate" is a Tuesday.
   */
  contractorQuotes: ['task_id', 'contractor_id'],
  quoteRequests: ['task_id', 'contractor_id'],
  /**
   * H11 B4, and the first live S3b table with a SINGLE-column natural key.
   * `contractor_job_ratings_visit_id_idx` is a real D1 `uniqueIndex` and
   * `rating-service.ts` raises `A rating already exists for this visit` on top
   * of it — one call-out, one rating.
   *
   * The offline double-create here is ordinary rather than a race: a follow-up
   * notification asks both members to rate the visit, and both can answer it
   * with no signal. With random ids the merge would keep two rows and the
   * contractor's average would count the same job twice.
   */
  contractorJobRatings: ['visit_id'],
  /**
   * H11 C1, and the first live S3b pair whose natural key is a YEAR.
   * `property_taxes_household_year_idx` and
   * `bc_assessment_data_household_year_idx` are both real D1 `uniqueIndex`es:
   * one notice per property per year, which is the whole point of the tables.
   *
   * The double-create is ordinary rather than a race. Both documents arrive on
   * paper, once a year, and either member may photograph and file one — often
   * the same evening, often with no signal. With random ids the merge would keep
   * two rows and the year-over-year chart would plot 2026 twice, which reads as
   * the assessment having doubled.
   *
   * The year is a D1 `integer` and the builders take it as a `number`; the shared
   * `deterministicRowId` stringifies its parts, exactly as `seasonalChecklist`
   * already does with its own `year`. Note this is the ONE thing the year is good
   * for here — it cannot also be a window field (see above).
   */
  propertyTaxes: ['household_id', 'tax_year'],
  bcAssessmentData: ['household_id', 'assessment_year'],

  // H13 D-wave — the wave's ONLY S3b table, and the reason this map had to be
  // touched at all. The other four promoted tables carry a surrogate `id` with
  // no business uniqueIndex behind it, so a random id is safe for them.
  //
  // `utility_trends` is not like that: D1 declares
  // `(household_id, utility_type, year, month)` unique, and that constraint is
  // the only thing stopping the same month existing twice. A ledger cannot
  // enforce it — two devices computing October while offline would each mint a
  // surrogate id, the LWW map would keep BOTH rows because they disagree on no
  // field it can compare, and the member would see October listed twice with
  // different totals. Deriving the id from the natural key instead makes the
  // two devices produce the SAME id, so LWW merges them the way it merges any
  // concurrent edit to one row.
  //
  // `month` is nullable — it is null on the annual roll-up — and the builder
  // must encode that rather than drop it, or the year row and January collapse
  // onto one id.
  utilityTrends: ['household_id', 'utility_type', 'year', 'month'],

  // H13 B-wave — four constrained tables, in two different shapes.
  //
  // The first two are S3a, the rarer and nastier kind: D1 gives them a
  // COMPOSITE PRIMARY KEY and no `id` column at all, so there is no surrogate to
  // fall back on. Registering them with a random id would let the same member
  // appear twice in one room's participant list, or carry two disagreeing read
  // cursors, with nothing in the LWW map able to tell the rows apart.

  // The second two are idempotency keys, which is a natural key by another
  // name — and the one place where getting this wrong is actively harmful
  // rather than merely untidy. `assistant_outbound_log` exists to guarantee the
  // assistant sends a given message ONCE; if two devices mint different ids for
  // the same logical send, the guarantee is gone and the member gets the
  // message twice. `assistant_trust_ledger` is keyed on the event key ALONE,
  // with no household component, because the key is already globally unique.
  assistantOutboundLog: ['household_id', 'idempotency_key'],
  assistantTrustLedger: ['event_idempotency_key'],

  // The wave's THIRD S3a table, and the one that was not predicted:
  // `assistant_identity` is PK'd on `household_id` with no `id` column at all —
  // one persona per household. It reads like an ordinary settings row, which is
  // exactly why the S3a guard caught it and a reviewer would not have.
  assistantIdentity: ['household_id'],

  // `maintenance_suggestions` — the one S3b entry here that D1 does NOT declare,
  // and the only reason this map has an entry no uniqueIndex backs.
  //
  // The constraint is real but it lives in the SERVICE, not the schema:
  // `maintenance-suggestion-service.ts` reads for an existing
  // `(household_id, home_feature_id, template_id)` before inserting. On the
  // Worker that read-then-write is serialised by the request; on device it is
  // not serialised by anything. Generation used to be a server operation and is
  // a local one now, so two devices coming online after adding the same
  // appliance would each generate the same suggestion and the member would see
  // every recommendation twice.
  //
  // The schema-derived S3b guard cannot catch this — it asks D1 what is unique,
  // and D1 says nothing here. Moving work on-device is exactly how a constraint
  // that was implicit in "the server does it" becomes load-bearing.
  maintenanceSuggestions: ['household_id', 'home_feature_id', 'template_id'],

  // Neighbours (0165). ONE of the family's three tables is constrained, and the
  // choice of which is the design:
  //
  //  - `neighbourhoods (household_id, name)` IS a D1 `uniqueIndex`. Two areas
  //    called "Maple Court" on one property is a mistake every time, and the
  //    offline double-create is ordinary rather than a race — two members
  //    tidying their pins on the same evening, with no signal, both reaching
  //    for the obvious name. Random ids would keep both, and every home would
  //    then be filed under whichever one its device happened to see.
  //  - `neighbours` and `neighbour_people` are deliberately NOT here. Two homes
  //    may legitimately carry the same label ("The Smiths" twice on one street
  //    is a coincidence, not an error) and so may two occupants; deriving an id
  //    from the label would silently MERGE two different families the first time
  //    a street repeated a surname, which is worse than a duplicate a member can
  //    see and delete.
  neighbourhoods: ['household_id', 'name'],
};

// ---------------------------------------------------------------------------
// H11 — Wave B and Wave C, both complete. Everything below this line is empty,
// and the block comment on `HOUSE_WAVE_B_TABLE_KEYS` argues why it stays.
// ---------------------------------------------------------------------------

/**
 * Wave B — the labor hub. **Empty: all 19 tables are live.**
 *
 * B1's four, B2's four, B3's four and B4's seven crossed into
 * `HOUSE_LEDGER_TABLE_KEYS`; see "Activated so far" at the top of this file.
 *
 * ## Why the map stays, empty, rather than being deleted
 *
 * This was written at B4 for one empty wave. C4 emptied the other one, so the
 * question is now "why keep the whole staging mechanism when nothing is staged",
 * and the answer is the same three points with the third one rewritten:
 *
 *  1. **The arithmetic.** `A + B + C = REGISTERED` is what stops a table being
 *     lost or double-counted, and it is checked on every run. `63 + 0 + 0 = 63`
 *     is a real assertion: it fails the moment a table leaves
 *     `HOUSE_LEDGER_TABLE_KEYS` without arriving anywhere else. Collapsing it to
 *     `63 = 63` would be a tautology, and a registry that can only assert
 *     tautologies about its own size has stopped checking anything.
 *  2. **Disjointness.** `registryGuard` proves live ∩ staged = ∅ and that
 *     `|live| + |staged| = |registered|`. Both halves still run over the real
 *     spreads, so a name accidentally added to a staged map — the most likely
 *     way someone re-opens this mechanism — fails immediately instead of
 *     shadowing a live table through `HOUSE_REGISTERED_TABLE_KEYS`.
 *  3. **The next wave.** H11 is finished, but the registry is not closed: a
 *     backend change that gives the three S2 join tables a key, or a decision to
 *     re-tier `home_project_geometry`, lands here as a staged block first. That
 *     is the whole point of staging — the physical names, windows and natural
 *     keys are verified and guarded before the facade exists — and deleting the
 *     mechanism the day its last user finishes means rebuilding it, or worse,
 *     not rebuilding it and registering the table live in one unchecked edit.
 *
 * ## What `never` means here, and why no stub entry
 *
 * `HouseWaveBTableName` is `keyof {}` — `never` — and that is the CORRECT type,
 * not a degenerate one. It says "there is no such thing as a staged Wave-B
 * table", which is exactly the fact B4 established: any code that tries to name
 * one now fails to compile rather than compiling against a name that no longer
 * means anything. `HOUSE_WAVE_B_TABLE_NAMES` is `[]` and
 * `HOUSE_WAVE_B_PHYSICAL_TABLES` is `{}` for the same reason.
 *
 * A stub entry to keep the type inhabited would be a lie in the registry — a
 * table claiming to be staged that is not — and every guard that walks the
 * staged set would then walk a name with no D1 table behind it. The tests were
 * changed to assert emptiness directly instead; where a per-table claim still
 * meant something (B1/B2/B3 "left no copy behind"), `waveB.test.ts` casts these
 * maps to plain records so the assertion keeps running rather than being deleted
 * along with the type that made it expressible.
 *
 * **Since C4, `HouseWaveCTableName` is `never` too, and so is
 * `HouseStagedTableName`.** `HouseRegisteredTableName` therefore collapses to
 * `HouseLedgerTableName`, which is true and not a workaround: everything the
 * registry knows about is live. `waveC.test.ts` took the same plain-record cast
 * `waveB.test.ts` uses, for the same reason and on the same day it needed it.
 */
export const HOUSE_WAVE_B_TABLE_KEYS = {} as const;

/**
 * Wave C — the long tail. **Empty: all 22 ledgerable tables are live.**
 *
 * The plan budgets 26 and 22 could be rows. Four of the fourteen `home_project_*`
 * tables cannot be ledgered as rows and were excluded rather than registered and
 * hoped for: `home_project_geometry` is Tier D (server-derived), and the three
 * PK-less join tables are hazard S2 — see `HOUSE_S2_DEFERRED_TABLES`. Those four
 * are the difference between the plan's 66 and the 62 the registry counted until
 * `appliance_documents` — which was in no wave, and so in neither number — was
 * classified on 2026-08-15 and took the registry to 63.
 *
 * C1's five, C2's three, C3's four and C4's ten crossed into
 * `HOUSE_LEDGER_TABLE_KEYS` and are counted by `HOUSE_WAVE_A_TABLE_COUNT`
 * instead; see "Activated so far" at the top of this file.
 *
 * **This map going empty is what makes every filter over a staged construct
 * vacuous at once**, which is §11.1.3's hazard reaching its terminal form: a
 * `HOUSE_WAVE_C_TABLE_NAMES.filter(...)` now resolves to `[]` and passes while
 * proving nothing. `HOUSE_STAGED_DETERMINISTIC_ID_TABLES` and its builders map
 * got there at C1, three sub-waves early; C2 and C3 each swept every remaining
 * loop before trusting a green run, and C4 swept the rest. Every one of them is
 * now backed by a POSITIVE terminal-state assertion — `toEqual([])`, `toEqual({})`
 * or an explicit count — in `registryGuard.test.ts`, `waveB.test.ts` and
 * `waveC.test.ts`, because a filter over an empty set is exactly the assertion
 * that looks strongest when it has stopped meaning anything.
 */
export const HOUSE_WAVE_C_TABLE_KEYS = {} as const;

export type HouseWaveBTableName = keyof typeof HOUSE_WAVE_B_TABLE_KEYS;
export type HouseWaveCTableName = keyof typeof HOUSE_WAVE_C_TABLE_KEYS;

/** Registered but not yet merged — Wave B and Wave C together. */
export type HouseStagedTableName = HouseWaveBTableName | HouseWaveCTableName;

/** Everything the registry knows about, live or staged. */
export type HouseRegisteredTableName = HouseLedgerTableName | HouseStagedTableName;

export const HOUSE_STAGED_TABLE_KEYS = {
  ...HOUSE_WAVE_B_TABLE_KEYS,
  ...HOUSE_WAVE_C_TABLE_KEYS,
} as const;

export const HOUSE_REGISTERED_TABLE_KEYS: Record<HouseRegisteredTableName, 'id'> = {
  ...HOUSE_LEDGER_TABLE_KEYS,
  ...HOUSE_STAGED_TABLE_KEYS,
};

export const HOUSE_WAVE_B_TABLE_NAMES = Object.keys(
  HOUSE_WAVE_B_TABLE_KEYS,
) as HouseWaveBTableName[];

export const HOUSE_WAVE_C_TABLE_NAMES = Object.keys(
  HOUSE_WAVE_C_TABLE_KEYS,
) as HouseWaveCTableName[];

export const HOUSE_STAGED_TABLE_NAMES = Object.keys(
  HOUSE_STAGED_TABLE_KEYS,
) as HouseStagedTableName[];

export const HOUSE_REGISTERED_TABLE_NAMES = Object.keys(
  HOUSE_REGISTERED_TABLE_KEYS,
) as HouseRegisteredTableName[];

/**
 * Wave B is the labor hub — 19 tables in the plan, **0 still staged**. All of
 * them moved into `HOUSE_LEDGER_TABLE_KEYS` across B1–B4 and are counted by
 * `HOUSE_WAVE_A_TABLE_COUNT` instead; the registered total is unchanged, which
 * is the invariant the three-addend arithmetic exists to check.
 */
export const HOUSE_WAVE_B_TABLE_COUNT = 0;

/**
 * Wave C is the long tail — 22 ledgerable tables, **0 still staged**. The plan
 * says 26; the four missing ones are `home_project_geometry` (Tier D) plus the
 * three S2 joins. C1's five, C2's three, C3's four and C4's ten moved into
 * `HOUSE_LEDGER_TABLE_KEYS` and are counted by `HOUSE_WAVE_A_TABLE_COUNT`
 * instead; the registered total is unchanged, which is the invariant the
 * three-addend arithmetic exists to check — and is the reason both zero addends
 * stay rather than being folded away.
 */
export const HOUSE_WAVE_C_TABLE_COUNT = 0;

/**
 * Waves A + B + C. The plan's headline is 66; four of Wave C cannot be rows, and
 * one table (`appliance_documents`) was in none of the three waves at all.
 *
 * 62 → 63 on 2026-08-15 is a **correction of an omission, not a new wave**: the
 * plan's 62 never included this table because nobody had classified it, in
 * either direction. See `HOUSE_WAVE_A_TABLE_COUNT` and the file header.
 *
 * 74 → 75 is a table that did not exist when the waves were drawn:
 * `home_project_option_groups`, migration 0162. See `HOUSE_WAVE_A_TABLE_COUNT`.
 *
 * 75 → 78 is the Neighbours family, migration 0165 — three more tables that did
 * not exist when the waves were drawn. Same category as 0162.
 */
export const HOUSE_REGISTERED_TABLE_COUNT = 78;

/**
 * §11 sequences H11 by sub-wave, not by table count, because each sub-wave has
 * its own gate (B1 gated B2; every one of them gates on H6 for attachments).
 * Expressing the split as data rather than prose lets the guard prove that the
 * sub-waves partition the STAGED set exactly — no table registered but
 * unscheduled, none scheduled twice.
 *
 * So this map is the REMAINING schedule, not a record of the plan: a sub-wave
 * leaves it on the day it activates. **All eight have now left, so it is `{}`
 * and its key union is `never`.** Keeping an activated sub-wave here would
 * either break the partition (its tables are no longer staged) or force the
 * entry to `[]`, and an empty array says nothing a reader can act on. What each
 * of them contained is recorded in the "Activated so far" list at the top of
 * this file, next to the facades that now own those tables.
 *
 * **What the empty record costs, and what replaced it.** Three assertions used
 * to run over this map and two of them are now vacuous:
 * `new Set(scheduled).size === scheduled.length` can no longer catch a table
 * scheduled twice (there is nothing to schedule), and
 * `scheduled.length === HOUSE_WAVE_C_TABLE_COUNT` compares 0 to 0. C3 flagged
 * the first of those the day the record dropped to a single key; C4 is when both
 * went. The surviving form is the two-way comparison against
 * `HOUSE_STAGED_TABLE_NAMES`, which is a claim about the registry as a whole and
 * is now backed by an explicit `toEqual({})` / `toEqual([])` on both sides —
 * §11.1.3's rule applied to its own terminal case: assert the terminal state
 * positively, never by filtering the empty side.
 */
export const HOUSE_SUB_WAVE_TABLES: Record<never, readonly HouseStagedTableName[]> = {};

/**
 * Ledger name → physical D1 table, verified against `backend/src/db/**`.
 *
 * Empty since B4 — `Record<never, string>` is `{}`. The seven entries moved to
 * `HOUSE_LEDGER_PHYSICAL_TABLES` intact, including the S1 rename
 * (`visitChecklistItems` → `checklist_items`), which is the one that had to
 * survive the crossing: a name that drifted on the way would produce an export
 * section that is always empty and a sync mapping that never matches, both
 * silently.
 */
export const HOUSE_WAVE_B_PHYSICAL_TABLES: Record<HouseWaveBTableName, string> = {};

/**
 * Empty since C4 — `Record<never, string>` is `{}`. The ten entries moved to
 * `HOUSE_LEDGER_PHYSICAL_TABLES` intact.
 *
 * No rename had to survive this crossing (all ten are the plain snake_case of
 * their ledger name), which is what makes it the easy half of C4. The hard half
 * is the one this map cannot express: `home_projects` is one underscore away
 * from B3's live `projects`, and a name that drifted the other way would have
 * merged two unrelated features while every count assertion still passed.
 */
export const HOUSE_WAVE_C_PHYSICAL_TABLES: Record<HouseWaveCTableName, string> = {};

/**
 * Every ledger name in the registry → its physical table.
 *
 * Across the whole registry the physical name is **not** unique, and cannot be:
 * `recurringChecklistItems` (Wave A) and `visitChecklistItems` (B4) are two
 * different Drizzle tables that share the name `checklist_items`. The guard
 * pins the repeat to exactly that pair rather than forbidding repeats, which is
 * the strongest true statement available.
 *
 * Since B4 both halves are LIVE, so the same weakened invariant now applies to
 * `HOUSE_LEDGER_PHYSICAL_TABLES` and not only to this spread. The consequence
 * flagged when the pair was staged has arrived and is handled:
 * `houseLedgerExport`'s `sectionFileName` derives a CSV name from the physical
 * table, so both would have claimed `checklist_items.csv` — it detects the
 * second claimant and emits `checklist_items__<ledgerName>.csv` for both. That
 * branch was written dormant in H9 and engages for the first time here.
 */
export const HOUSE_REGISTERED_PHYSICAL_TABLES: Record<HouseRegisteredTableName, string> = {
  ...HOUSE_LEDGER_PHYSICAL_TABLES,
  ...HOUSE_WAVE_B_PHYSICAL_TABLES,
  ...HOUSE_WAVE_C_PHYSICAL_TABLES,
};

/**
 * Windowed-read date fields for the staged waves. Same policy as Wave A: first
 * field yielding `YYYY-MM` wins, anything unparseable falls to always-resident.
 *
 * Every field named below is a D1 `text` column, checked one by one — an
 * `integer` column silently fails to parse and the windowing then does nothing
 * at all. C1's `propertyTaxes` / `bcAssessmentData` are the worked example of
 * that hazard and the argument now lives beside them in the live map.
 *
 * Absent tables are always-resident on purpose, in one remaining group:
 *  - **project definition** (`homeProjectBudgetLines`, `homeProjectSelections`,
 *    `homeProjectPhases`, `homeProjectPlanLinks`) — read as a whole whenever the
 *    project is opened.
 *
 * B1's `contractorVisits` and `contractorDocuments` moved to
 * `HOUSE_WINDOWED_DATE_FIELDS` with their field lists intact, and B2's four,
 * B3's four, B4's seven, C1's two and C3's one followed — so nothing from Wave B
 * or from C1–C3 remains here at all. The two maps are merged nowhere —
 * `projection.ts` reads only the live one — so a table left in both would be
 * windowed by whichever map the reader happened to consult.
 *
 * C2 moved nothing OUT of this map, because it had nothing here to move: all
 * three floor-plan tables were already always-resident and stayed that way. That
 * is the one crossing shape this map cannot record, so the claim moved to the
 * live side instead — `waveC.test.ts` now asserts `HOUSE_WINDOWED_DATE_FIELDS`
 * has no entry for any of the three, positively, rather than checking that this
 * map still does not. Indexing a `Partial<Record<HouseStagedTableName, …>>` by a
 * name that is no longer staged does not compile, so the old assertion could not
 * have simply stayed.
 *
 * C3 moved BOTH shapes at once, which is why it is the useful worked example.
 * Three of its tables were absent here and stayed unwindowed (the drawing-content
 * argument, now asserted on the live map), and the fourth —
 * `gardenPlanBoundaryDrafts` — was the one entry here that a sub-wave has ever
 * carried across. Both halves are asserted in `waveC.test.ts`: the three by
 * `HOUSE_WINDOWED_DATE_FIELDS[table] === undefined`, the fourth by its field
 * list arriving on the live map with nothing left behind here.
 *
 * **C4 emptied this map**, moving six windows out and leaving four tables
 * unwindowed — the project definition group named above, which is the last
 * remaining absence this comment described and is now asserted on the live side
 * in `waveC.test.ts`. `HouseStagedTableName` is `never`, so this is
 * `Partial<Record<never, …>>` — `{}` — and an entry cannot be added to it
 * without first widening the type, which is the property that makes the empty
 * map worth keeping rather than deleting.
 *
 * The last thing this map taught, and it taught it twice on the way out:
 * **a window is a claim about THREE things** — the entry here, the D1 column,
 * and the ROW TYPE. `waveBCSchemaParity` only ever checked the first two.
 * `homeProjectBlockers` and `homeProjectAttachments` both named a `created_at`
 * their DTO did not declare, and both would have crossed looking configured and
 * doing nothing at all. See `HOUSE_WINDOWED_DATE_FIELDS`'s header.
 */
export const HOUSE_STAGED_WINDOWED_DATE_FIELDS: Partial<
  Record<HouseStagedTableName, readonly string[]>
> = {};

/**
 * S3b for the staged waves — **empty since C1**, and that is the terminal state
 * for this map rather than a hole in it.
 *
 * B2 took `contractorQuotes` and `quoteRequests` out of it and into
 * `HOUSE_DETERMINISTIC_ID_TABLES`, builders included. The pair is the reason the
 * per-table id prefix exists at all, so the argument for it now lives beside
 * them in the live map rather than here.
 *
 * B3 took nothing out, and that is a finding rather than an oversight: not one
 * of `projects`, `project_milestones`, `project_payments` or
 * `project_progress_photos` carries a `uniqueIndex` in D1, and none of them has
 * a business uniqueness constraint either. Two members offline are genuinely
 * allowed to add two "deposit" payments, two milestones with the same title and
 * two photos of the same wall — those are two rows, and a deterministic id
 * would MERGE work the members meant to keep apart, which is the opposite
 * failure to the one S3b guards. Random ids throughout, therefore.
 *
 * B4 took the last Wave-B entry, `contractorJobRatings` (unique on `visit_id`),
 * and C1 took the last two of any wave — `propertyTaxes` and `bcAssessmentData`,
 * the year-scoped pair — into `HOUSE_DETERMINISTIC_ID_TABLES` with their
 * builders.
 *
 * **Nothing left in Wave C carried a uniqueIndex**, which was checkable rather
 * than assumed: `waveBCSchemaParity.test.ts` parses every `uniqueIndex`
 * declaration out of the Drizzle sources, maps it to whichever ledger name
 * claims that physical table, and requires a natural key in EITHER map. So this
 * map being `{}` is asserted against the schema, not merely stated here — and
 * C3 and C4 each re-ran that check on the day they crossed.
 *
 * C2 re-ran it and took nothing, which is a finding rather than an oversight.
 * `schema-floor-plans.ts` declares five indexes across its four tables and not
 * one of them is a `uniqueIndex`: a household may hold two plans of the same
 * floor (a survey and a builder's drawing), two markers may sit on the same
 * point for two different tasks, and two annotations may trace the same wall.
 * Every one of those is two rows the members meant to keep apart, so a
 * deterministic id would MERGE work rather than de-duplicate it — the opposite
 * failure to the one S3b guards, and the same call B3 made.
 *
 * C3 re-ran it and took nothing either. `schema-garden-plans.ts` declares eight
 * indexes across its four tables and not one is a `uniqueIndex`. Two of them
 * look like constraints and are not: `garden_plans_boundary_draft_idx` is a
 * plain lookup index on a column with no `references()` at all, and
 * `garden_boundary_drafts_household_status_idx` is the read path for
 * `listPendingDrafts` rather than a uniqueness claim — one member may have
 * several drafts open at once, which is exactly why that query carries a
 * `limit(10)`.
 *
 * C4 re-ran it a last time and took nothing. `schema-home-projects.ts` declares
 * fifteen indexes across its fourteen tables and **not one is a `uniqueIndex`**,
 * which is right rather than an omission: two blockers with the same title are
 * two blockers, two "Paint" selections are two rooms' worth of paint, two
 * comments with the same body are two people agreeing, and two activity rows are
 * two things that happened. A deterministic id anywhere in that family would
 * MERGE work the members meant to keep apart — the opposite failure to the one
 * S3b guards, and the call B3, C2 and C3 all made before it.
 *
 * Two S3b tables the plan lists are deliberately absent, because Wave B never
 * ledgered them: `contractor_shares` (unique on `share_token`, a server-minted
 * public link) and `labor_notification_preferences` (unique on
 * `(household_id, user_id)`). Registering natural keys for tables outside the
 * ledger would make the guard assert something it cannot check.
 */
export const HOUSE_STAGED_DETERMINISTIC_ID_TABLES: Partial<
  Record<HouseStagedTableName, readonly string[]>
> = {};

/**
 * Staged tables with no client DTO anywhere in `src/`.
 *
 * §3.2 says a ledger row IS the DTO the remote API returned — so a table with no
 * DTO has no row type, and `types.ts` deliberately does not invent one until the
 * sub-wave that needs it.
 *
 * Authoring the DTO is therefore step one of each sub-wave's facade, not an
 * afterthought — hence naming them in the registry rather than in a comment. B2
 * is the worked example: `contractor_quotes` (42 columns, with the AI-extraction
 * block) and `quote_requests` were both on this list, both fully built in D1
 * with `uniqueIndex`es, and both reachable only through a remote method typed
 * `{ quotes: any[] }`. Their DTOs were written from the Drizzle columns FIRST
 * (`types.ts`, `LocalContractorQuote` / `LocalQuoteRequest`) and they left this
 * list in the same edit that put them in the ledger.
 *
 * B4 took the last two Wave-B entries the same way, and they were emptier still:
 * `visit_notes` has a full backend router and service but NO client module, and
 * `contractor_issue_resolutions` has neither. Both DTOs were written from the
 * Drizzle columns (`LocalVisitNote` / `LocalContractorIssueResolution`) and
 * both tables are ledgered without a facade — for convergence and, decisively,
 * so the contractor and visit cascades can reach them at all.
 *
 * C1 took `utility_reminders` the same way and for the same reasons, which is
 * now a pattern rather than a coincidence: **the tables with no DTO are exactly
 * the tables no screen reads, and the reason to ledger one is almost always that
 * something above it cascades.** `LocalUtilityReminder` was written from
 * `schema-utilities.ts:189`, and the table earns its registration because
 * `bill_id` is the one `onDelete: 'cascade'` in Wave C that a server delete
 * actually fires.
 *
 * C2 took nothing off this list, which is the first crossing since B1 for which
 * that is true. All three floor-plan DTOs already existed in
 * `src/api/floor-plans.ts` and are exported, so the work was the opposite one:
 * checking each against the D1 columns and RECORDING the divergences on the
 * types rather than authoring a shape. There are eight of them and they are
 * named one by one in `types.ts` — a divergent DTO is still the DTO, but a
 * silent divergence is a bug. B3 set that precedent with `linked_report_ids`.
 *
 * C3 took nothing off it either, and found the sharpest reason yet why "has a
 * DTO" is not the same as "has a row shape". Two of its four DTOs are hand-built
 * PROJECTIONS rather than row mirrors — `listObjects` composes one and
 * `GardenPlanBoundaryService.toResponse` composes the other — so taking them
 * literally would have produced ledger rows with no cascade key, no sort order,
 * no member scope and no window field, all while this list was empty and every
 * guard was green. **This list catches an ABSENT DTO; it cannot catch a DTO that
 * is present and lossy.** Twenty-four divergences are named in `types.ts` and
 * four of them are additions to the row rather than notes about it.
 *
 * **C4 took the last one, `home_project_milestones`, and the list is now `[]`
 * for the first time since H11 began.** That table has a create route, a service
 * method and a place in the hub response — where the client types it
 * `milestones: unknown[]`, which is why it counted as absent: `unknown` makes
 * every field a guess at the call site and the row unprojectable.
 * `LocalHomeProjectMilestone` was written from `schema-home-projects.ts:140`
 * column by column, exactly as B2, B4 and C1 wrote theirs.
 *
 * And C4 proved C3's warning twice over on the way past. Two of its NINE
 * existing DTOs are present and lossy in the one way that changes behaviour
 * rather than shape: `HomeProjectBlocker` and `HomeProjectAttachment` each omit
 * the `created_at` the registry windows their table on, so both windows would
 * have been inert while this list stood at zero and every guard stayed green.
 * There are twenty-eight divergences in `types.ts` and four of them are
 * additions to the row rather than notes about it.
 *
 * The list stays, empty, for the reason `HOUSE_WAVE_B_TABLE_KEYS` gives at
 * length: the next table registered here will be one of the S2 joins or a
 * re-tiered `home_project_geometry`, and neither has a client DTO today.
 */
export const HOUSE_STAGED_TABLES_WITHOUT_DTO: readonly HouseStagedTableName[] = [];

/**
 * Hazard S2 — join tables with no primary key at all (plan §1.5).
 *
 * These carry only their two foreign keys (`home_project_spaces` does not even
 * have `created_at`), so there is nothing to key a row on. Both available fixes
 * are worse than waiting:
 *
 *  - a **random** surrogate `id` re-creates the S3b duplicate: two members
 *    linking the same space to the same project offline get two link rows;
 *  - a **deterministic** id derived from `(project_id, space_id)` fixes that but
 *    walks into S3a instead, because link/unlink/re-link is the *normal* user
 *    action on a join row and the tombstone is absorbing — the second link would
 *    never come back.
 *
 * The plan's own answer is the third option: model them as an array field on the
 * parent row, exactly as `projects.linked_task_ids` already does. That is a
 * backend schema change, so these stay out of the ledger until it lands.
 *
 * **`home_project_tasks` WAS the third entry and is gone**, because that change
 * landed for it: migration 0170 dropped the join and put the link on the parent
 * as `home_projects.linked_task_ids`. It is not "no longer deferred" — the table
 * does not exist, which is why it is absent from this list rather than moved to
 * another one, and `registryCompleteness` no longer sees it in the schema files
 * either. `listTasks` / `linkTask` / `createTask` are ordinary local methods as
 * of that migration.
 *
 * The other two are NOT moved by analogy. `home_project_contractors` carries a
 * `quote_id`, so it is a link with a payload rather than a pure join and wants
 * its own decision; `home_project_spaces` has no timestamp at all and is seeded
 * in bulk at project creation, where a lost link reads differently. Each gets
 * the argument made for it, on the day it is made.
 */
export const HOUSE_S2_DEFERRED_TABLES: readonly string[] = [
  'home_project_spaces',
  'home_project_contractors',
];

/**
 * Tables in House's own Drizzle files that are deliberately NOT House domain
 * data, with the reason each is excluded.
 *
 * Until 2026-08-15 the registry had no notion of completeness. Every guard
 * asked "is each REGISTERED table well-formed?" and none asked "is every table
 * registered?", so a House domain table could sit in `schema-maintenance.ts`
 * belonging to no wave, no tier, and no deferral list, and nothing failed.
 * `appliance_documents` did exactly that — which is why appliance attachments
 * could not be hosted while the identical `contractorDocuments` shipped in B1.
 *
 * The list below is the answer to "why is this table not in the registry", one
 * entry at a time. `registryCompleteness.test.ts` requires every table in the
 * House schema files to appear in exactly one of: the live ledger, Tier B/C/D,
 * `HOUSE_S2_DEFERRED_TABLES`, this list, or `HOUSE_UNCLASSIFIED_PENDING`.
 */
export const HOUSE_NON_DOMAIN_TABLES: readonly string[] = [
  // Auth and identity. Owned by the platform, never a household's data.
  'users',
  'refresh_tokens',
  'email_verifications',
  'password_resets',
  'token_exchange_jtis',
  'user_entitlements',
  'user_app_entitlements',
  // The platform bridge — cross-app identity, profile mirroring and deletion.
  // Every one of these is infrastructure between apps, not content inside one.
  'platform_profiles',
  'platform_profile_mirrors',
  'platform_profile_outbox',
  'platform_identity_links',
  'platform_credentials',
  'platform_refresh_tokens',
  'platform_idp_challenges',
  'platform_session_revocations',
  'platform_session_revocation_outbox',
  'platform_deletion_requests',
  'platform_deletion_outbox',
  'platform_request_idempotency',
  'platform_bridge_control',
  // Soft Transfer. Consent receipts and package bookkeeping between apps.
  'transfer_consents',
  'transfer_import_receipts',
  'transfer_onboarding_contexts',
  'transfer_package_events',
  'transfer_prepare_operations',
  // The legacy invite model. Q14 collapses all three into the `lf_invites`
  // device-enrolment handshake (§5.1); they are being revoked, not ledgered.
  'household_invitations',
  'household_invite_links',
  'household_join_requests',
  // Embedded on a ledgered row rather than ledgered itself: task photos live
  // on `tasks.photos`, which is how H6 carries a blob descriptor per photo.
  'task_photos',
];

/**
 * ⚠️ House domain tables that are genuinely unclassified — a decision is owed.
 *
 * These are real household content in House's own schema files, and none of
 * them is ledgered, tiered or deferred. They were invisible until the
 * completeness guard existed. The list is asserted to be EXACTLY these entries,
 * so it cannot grow silently: a new unclassified table fails the guard, and
 * classifying one of these means deleting its line here.
 *
 * Two of them are named in the plan's own S3b hazard table as "in Tier A/B"
 * (§1.4) — `contractor_shares` and `labor_notification_preferences` — which is
 * the sharpest evidence that prose in a plan is not a registry.
 *
 * **`appliance_documents` was the fifth entry and left on 2026-08-15** — the
 * first line this list has ever lost, and the worked example of it doing its
 * job. It was the twin of B1's `contractor_documents` (an R2 key plus metadata
 * for a maintenance entity, on the same H6 blob channel), and while it sat here
 * `localAppliancesApi.getDocuments` / `addDocument` threw and
 * `HouseAttachmentField` had no caller anywhere in `src/`. Classifying it meant
 * deleting its line and adding it to `HOUSE_LEDGER_TABLE_KEYS` — and deleting
 * the line FAILED `registryCompleteness.test.ts` until that suite's expectation
 * was updated in the same edit, which is precisely the deliberateness this list
 * is designed to force.
 */
export const HOUSE_UNCLASSIFIED_PENDING: readonly string[] = [
  // Reviews of the GLOBAL `service_providers` catalogue (Tier C). Whether a
  // member's own review is household content or shared reference data is a
  // product question, not an engineering one.
  'service_provider_reviews',
  // Sharing a contractor with another household. Cross-household by
  // definition, so it may not belong to any one ledger.
  'contractor_shares',
  // Per-user labor notification settings. Plausibly ledgerable settings,
  // plausibly notification infrastructure like `scheduled_notifications`.
  'labor_notification_preferences',
  // AI conversation state for the contractor info assistant. Almost certainly
  // Tier B alongside the other assistant tables, but it is in the labor-hub
  // file rather than an AI one, so it was never swept in.
  'ai_info_conversations',
];

/**
 * Tier B — server-authoritative, never ledgered (plan §1.2). Listed by physical
 * table name so the guard can assert disjointness with Tier A.
 */
export const HOUSE_TIER_B_TABLES: readonly string[] = [
  // Smart Project (migration 0166). Server-authoritative by CONSTRUCTION, the
  // same way the report pipeline below is: a draft is produced by a queue, a
  // provider key and a model that exist only on the Worker, so a device cannot
  // write these rows even in principle. `localHomeProjectsApi` throws on every
  // Smart Project method rather than routing them remote, because a draft
  // generated for a local-first household would be a project in D1 that the
  // device's own `list` can never return.
  //
  // Note these are NOT the twins of `home_project_geometry`, which IS ledgered:
  // a layout is something the member draws or a LiDAR scan produces on device.
  // These two only ever come back from a model.
  'home_project_as_is',
  'home_project_smart_drafts',

  // The report pipeline. Server-authoritative by CONSTRUCTION, not by habit:
  // the Lambda opens the PDF and everything below is its output, so a device
  // cannot produce these rows even in principle. `processing_jobs` is the
  // pipeline's own state machine.
  'reports',
  'report_chunks',
  'findings',
  'finding_spaces',
  'report_images',
  'report_summaries',
  'processing_jobs',

  // Push infrastructure, not household content. The cron drains
  // `scheduled_notifications`; a device that owned the queue could not deliver
  // from it while the app is closed, which is the only time it matters.
  'scheduled_notifications',

  // Keyed by `user_id`, and a user's notifications span every household they
  // belong to. The ledger is per-property, so this row has no single ledger to
  // live in — the one table here excluded for a SHAPE reason rather than an
  // authority one.
  'notification_history',

  // RevenueCat is the entitlement authority. A device that owns its own
  // entitlement row owns its own paywall.
  'subscriptions',

  // Household chat. Excluded because THE ASSISTANT IS A PARTICIPANT, and it
  // runs on the Worker.
  //
  // `chat-room-service-core.ts:742` reads the message BODY to detect an
  // `@assistant` mention and decide whether to generate a reply. A ledgered
  // `chat_messages` is sealed under the household HDK, so the Worker would see
  // ciphertext, never match the mention, and the assistant would simply stop
  // answering — with no error anywhere, which is the worst shape this failure
  // could take.
  //
  // This is the same class as the report pipeline: not "the server happens to
  // own it" but "the feature is a server-side read of the plaintext". The three
  // sibling tables follow the messages; a room whose messages are
  // server-authoritative has nothing left to be local about, and the two
  // PK-less join tables are meaningless without the room.
  //
  // A local-first chat is possible, but it is a PRODUCT change (member-to-member
  // rooms local, assistant rooms server-side, and a member told which is which)
  // rather than a re-tiering, so it is not taken here.
  'chat_rooms',
  'chat_messages',
  'chat_room_participants',
  'chat_room_reads',

  // Google OAuth access + refresh tokens, scoped by `member_id`. Excluded on
  // SECURITY grounds, which no other row in this list rests on, and which the
  // original Tier-B note did not state.
  //
  // The ledger is per-HOUSEHOLD and syncs to every enrolled device; these
  // credentials are per-MEMBER. Ledgering them would replicate one member's
  // Google refresh token onto every other member's phone and into every backup
  // and export — handing each member standing access to the others' calendars,
  // long after they left the household. The encryption does not help: every
  // member's device holds the HDK that decrypts it.
  'google_calendar_tokens',
];

/** Tier C — global reference data: fetched over HTTP, cached, never synced. */
export const HOUSE_TIER_C_TABLES: readonly string[] = [
  'maintenance_templates',
  'maintenance_task_templates',
  'municipality_configs',
  'service_providers',
  'utility_providers',
  'technical_terms',
  'checklist_templates',
  'message_templates',
];

/** Tier D — server-derived: re-derived on device (H7) or the feature is off. */
export const HOUSE_TIER_D_TABLES: readonly string[] = [];
