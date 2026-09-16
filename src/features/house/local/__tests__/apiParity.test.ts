/**
 * DoD H3, bullet 1 — the programmatic method diff.
 *
 * "Every remote method gets a local counterpart. Gaps are expressed as a
 * *thrown* `HouseLocalUnsupportedError`, **never** as a missing key — a missing
 * key silently routes to an empty server."
 *
 * That rule is unenforceable by review: `tasksApi` has ~31 methods across 10
 * modules and the next person to add one to the remote module has no reason to
 * think about the ledger. So the diff runs in `npm test`, in both directions:
 *
 *  - **missingLocally** — a remote method with no local counterpart and no
 *    explicit declaration. This is the dangerous direction: under local-first
 *    the call reaches a server that holds no rows for this household, so the
 *    screen renders empty AND correct, and nobody finds out.
 *  - **extraLocally** — a local method the remote module does not have. Usually
 *    a rename that only landed on one side, which means screens still call the
 *    old name and get the server.
 *
 * Every intentional gap is declared here with a reason, so "this one is remote"
 * is a decision in the repository rather than an omission.
 */
import { parityGap } from '../localApiProxy';

/**
 * Methods that are deliberately NOT local, with the tier or stage that owns
 * them. Anything not in this list must have a local counterpart.
 */
type ParityCase = {
  module: string;
  remote: () => object;
  local: () => object;
  /** Remote-only methods, each with the reason it stays remote. */
  remoteOnly: Record<string, string>;
};

/**
 * Lazily required so a module that fails to load reports as ITS OWN failure
 * rather than taking the whole suite down at import time.
 */
function requireModule<T>(path: string, name: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(path) as Record<string, unknown>;
  const value = mod[name];
  if (!value) throw new Error(`${path} does not export ${name}`);
  return value as T;
}

const CASES: ParityCase[] = [
  {
    module: 'tasks',
    remote: () => requireModule<object>('@api/tasks', 'tasksApi'),
    local: () => requireModule<object>('../localTasksApi', 'localTasksApi'),
    remoteOnly: {},
  },
  {
    module: 'household-spaces',
    remote: () => requireModule<object>('@api/household-spaces', 'householdSpacesApi'),
    local: () => requireModule<object>('../localSpacesApi', 'localSpacesApi'),
    remoteOnly: {},
  },
  {
    module: 'home-features',
    remote: () => requireModule<object>('@api/home-features', 'homeFeaturesApi'),
    local: () => requireModule<object>('../localHomeFeaturesApi', 'localHomeFeaturesApi'),
    remoteOnly: {},
  },
  /**
   * `appliances` has no gap of any kind since 2026-08-15 — not a remote-only
   * method, and not a local one that throws. Nine methods, nine local
   * counterparts, and it is the only module in this list whose gap count went
   * DOWN rather than a new module's going in at zero.
   *
   * `getDocuments` and `addDocument` threw `HouseLocalUnsupportedError` until
   * that day, on copy that said the encrypted file channel was "on its way".
   * H6 had shipped and was live on eight D1s; what was missing was a registry
   * entry for `appliance_documents`, which belonged to no wave, no tier and no
   * deferral list — so there was no ledger table to write a document row into.
   * `registryCompleteness.test.ts` found it, `schema.ts` records the correction,
   * and both methods are now ordinary ledger operations. Their entries in
   * `HOUSE_UNSUPPORTED_COPY` were removed in the same edit, which
   * `unsupportedCopy.test.ts` enforces: copy for a method that no longer throws
   * is drift between the map and the code.
   *
   * `remoteOnly` is EMPTY and the direction that matters here is the OTHER one.
   * The remote module has no `deleteDocument` — `routes/appliances.ts` exposes
   * exactly two document routes and `appliance-service.ts` has no delete method
   * — so adding one locally, however natural it looks beside B1's
   * `contractorsApi.deleteDocument`, would fail `extraLocally` below. That is
   * the check doing its job rather than being in the way: a screen calling a
   * local-only method works on a local-first build and 404s everywhere else.
   * An appliance document leaves the ledger with its appliance, through
   * `APPLIANCE_CASCADE_TABLES`.
   */
  {
    module: 'appliances',
    remote: () => requireModule<object>('@api/appliances', 'appliancesApi'),
    local: () => requireModule<object>('../localAppliancesApi', 'localAppliancesApi'),
    remoteOnly: {},
  },
  {
    module: 'checklists',
    remote: () => requireModule<object>('@api/checklists', 'checklistsApi'),
    local: () => requireModule<object>('../localChecklistsApi', 'localChecklistsApi'),
    remoteOnly: {},
  },
  /**
   * H13 D-wave. `remoteOnly` is EMPTY on purpose, and it is the one entry here
   * where that deserves a note.
   *
   * `SuggestionWithTemplate` joins `maintenance_templates`, which is Tier C and
   * never ledgered — so the obvious shape would have been a remote-by-design
   * read for the template half. It is not, because a read that works offline
   * for the suggestion and fails online-only for its template is worse than
   * either: the card would render half-populated exactly when the member has no
   * signal. The local module reaches the catalogue through `catalogCache`
   * instead, which answers from disk and refreshes behind the render.
   */
  /**
   * H13 B-wave. The largest `remoteOnly` in this file, and the split it records
   * is the point of the wave rather than an exception to it: the assistant's
   * RECORDS are local (persona, briefings, trust ledger) while everything that
   * RUNS A MODEL stays on the Worker.
   *
   * Listed from the module's own exported constant rather than repeated here, so
   * the facade and this gate cannot drift.
   */
  {
    module: 'aihousekeeper',
    remote: () => requireModule<object>('@api/aihousekeeper', 'aihousekeeperApi'),
    local: () => requireModule<object>('../localAihousekeeperApi', 'localAihousekeeperApi'),
    remoteOnly: Object.fromEntries(
      (
        requireModule<readonly string[]>(
          '../localAihousekeeperApi',
          'HOUSE_LOCAL_AIHOUSEKEEPER_REMOTE_METHODS',
        ) as readonly string[]
      ).map((method) => [method, 'runs a model, a server-side queue, or transfers bytes']),
    ),
  },
  {
    module: 'maintenance-suggestions',
    remote: () =>
      requireModule<object>('@api/maintenance-suggestions', 'maintenanceSuggestionsApi'),
    local: () =>
      requireModule<object>(
        '../localMaintenanceSuggestionsApi',
        'localMaintenanceSuggestionsApi',
      ),
    remoteOnly: {},
  },
  {
    module: 'seasonal-checklists',
    remote: () => requireModule<object>('@api/seasonal-checklists', 'seasonalChecklistsApi'),
    local: () =>
      requireModule<object>('../localSeasonalChecklistsApi', 'localSeasonalChecklistsApi'),
    remoteOnly: {},
  },
  {
    module: 'settings',
    remote: () => requireModule<object>('@api/settings', 'settingsApi'),
    local: () => requireModule<object>('../localSettingsApi', 'localSettingsApi'),
    remoteOnly: {},
  },
  {
    module: 'task-drafts',
    remote: () => requireModule<object>('@api/task-drafts', 'taskDraftsApi'),
    local: () => requireModule<object>('../localTaskDraftsApi', 'localTaskDraftsApi'),
    remoteOnly: {},
  },
  {
    module: 'garbage-collection',
    remote: () => requireModule<object>('@api/garbage-collection', 'garbageCollectionApi'),
    local: () => requireModule<object>('../localGarbageApi', 'localGarbageApi'),
    remoteOnly: {
      getMunicipalities: 'Tier C — global reference data, fetched and cached, never ledgered',
      getMunicipality: 'Tier C — global reference data',
      getWasteRegulations: 'Tier C — global reference data',
    },
  },
  {
    module: 'households',
    remote: () => requireModule<object>('@api/households', 'householdsApi'),
    local: () => requireModule<object>('../localHouseholdsApi', 'localHouseholdsApi'),
    remoteOnly: {},
  },
  /**
   * H11 sub-wave B1. `remoteOnly` is empty on purpose for both: the three
   * contractor methods that cannot work offline (`getUploadUrl`,
   * `uploadDocument`, `aiLookup`) are PRESENT locally as throws, which is what
   * the coverage rule asks for. Declaring them remote-only instead would send
   * them to a Worker whose bucket holds nothing for this household, and the
   * screen would render an empty document list with a 200.
   */
  {
    module: 'contractors',
    remote: () => requireModule<object>('@api/contractors', 'contractorsApi'),
    local: () => requireModule<object>('../localContractorsApi', 'localContractorsApi'),
    remoteOnly: {},
  },
  {
    module: 'representatives',
    remote: () => requireModule<object>('@api/representatives', 'representativesApi'),
    local: () => requireModule<object>('../localContractorsApi', 'localRepresentativesApi'),
    remoteOnly: {},
  },
  /**
   * H11 sub-wave B2. `remoteOnly` is empty for both, for two different reasons.
   *
   * `appointments` has no gap at all — all 13 methods work on device, because an
   * appointment carries no attachment, runs no model and reaches no third party.
   *
   * `quotes` has two methods that cannot work offline (`compareWithAI`,
   * `getDocumentUrl`) and both are PRESENT locally as throws, which is what the
   * coverage rule asks for. Declaring them remote-only would send them to a
   * Worker whose bucket and quote table hold nothing for this household, and the
   * screen would render an empty comparison with a 200.
   */
  {
    module: 'appointments',
    remote: () => requireModule<object>('@api/appointments', 'appointmentsApi'),
    local: () => requireModule<object>('../localAppointmentsApi', 'localAppointmentsApi'),
    remoteOnly: {},
  },
  {
    module: 'quotes',
    remote: () => requireModule<object>('@api/quotes', 'quotesApi'),
    local: () => requireModule<object>('../localQuotesApi', 'localQuotesApi'),
    remoteOnly: {},
  },
  /**
   * H11 sub-wave B3, and the first labor-hub module with no gap of ANY kind —
   * not a remote-only method, and not a local method that throws either.
   *
   * That was not the expectation going in. A table called
   * `project_progress_photos` reads like an H6 blob surface, and every previous
   * sub-wave that touched files produced at least one throw site. `projectsApi`
   * has no upload method and no URL builder: `addProgressPhoto` records a
   * `photo_key` the caller already holds, which is the same metadata-only split
   * B1 settled on `contractorDocuments`. So all 16 are local, `unsupportedCopy`
   * gained no entry, and `remoteOnly` is empty because there is genuinely
   * nothing to declare.
   *
   * NOTE this is `@api/projects` (the labor-hub job), not `@api/home-projects`
   * (the C4 renovation planner). The latter has no facade yet and must get its
   * own case here rather than being folded into this one.
   */
  {
    module: 'projects',
    remote: () => requireModule<object>('@api/projects', 'projectsApi'),
    local: () => requireModule<object>('../localProjectsApi', 'localProjectsApi'),
    remoteOnly: {},
  },
  /**
   * H11 sub-wave B4, which completes Wave B — and the first labor-hub sub-wave
   * with genuine `remoteOnly` entries.
   *
   * B1's, B2's and B3's `remoteOnly` maps were all empty, because every gap in
   * them was a P4 model or an H6 transfer, and those are PRESENT locally as
   * throws. B4 is different: four of `visitChecklists`'s methods and three of
   * `messages`'s read TIER C tables — `checklist_templates`, `technical_terms`
   * and `message_templates` — which are global reference data, identical for
   * every household, carrying nothing of theirs. Those genuinely belong on the
   * server, exactly as `garbageCollectionApi.getMunicipalities` does, and are
   * declared with a reason apiece below.
   *
   * The four that CANNOT work offline for a real reason — `createFromTemplate`
   * and the three AI methods — are local throws, not remote-only, because the
   * coverage rule is about not letting a Worker answer 200 with an empty list.
   */
  {
    module: 'visit-checklists',
    remote: () => requireModule<object>('@api/visit-checklists', 'visitChecklistsApi'),
    local: () =>
      requireModule<object>('../localVisitChecklistsApi', 'localVisitChecklistsApi'),
    remoteOnly: {
      getTemplates: 'Tier C — `checklist_templates` is global reference data, never ledgered',
      getTemplatesByCategory: 'Tier C — the same catalogue, filtered by specialty',
      getTemplate: 'Tier C — one template out of the global catalogue',
      getTechnicalTerm:
        'Tier C — `technical_terms` is the shared jargon glossary, identical for every household',
    },
  },
  {
    module: 'messages',
    remote: () => requireModule<object>('@api/messages', 'messagesApi'),
    local: () => requireModule<object>('../localMessagesApi', 'localMessagesApi'),
    remoteOnly: {
      getTemplates: 'Tier C — `message_templates` is global reference data, never ledgered',
      getTemplate: 'Tier C — one canned message out of the global catalogue',
      applyTemplate:
        'Tier C — substitutes placeholders in template text and returns a string; touches no household row',
    },
  },
  /**
   * `ratings` has no gap of any kind — not a remote-only method, and not a local
   * one that throws. Six methods, six local counterparts. Rating a contractor
   * needs no server, no model and no file, and every figure in the summary is
   * arithmetic over rows the device already holds.
   */
  {
    module: 'ratings',
    remote: () => requireModule<object>('@api/ratings', 'ratingsApi'),
    local: () => requireModule<object>('../localRatingsApi', 'localRatingsApi'),
    remoteOnly: {},
  },
  /**
   * H11 sub-wave C1 — the first Wave-C module, and the one whose `remoteOnly`
   * list is shortest for the most interesting reason.
   *
   * Three of its 24 methods look like server features and are not:
   * `getDashboard`, `getAnalytics` and `getPropertyInsights` are pure functions
   * of `utility_bills`, `property_taxes` and `bc_assessment_data` — computed per
   * request, never stored. They are LOCAL, because declaring them remote would
   * send them to a Worker holding none of those rows and answer 200 with
   * "$0.00 this month" over a full year of imported bills, which is the exact
   * silence the coverage rule exists to prevent and is far more convincing than
   * an empty list. The table that DOES pre-compute this server-side,
   * `utility_trends`, is Tier D and is never ledgered.
   *
   * The four extraction methods are PRESENT locally as throws rather than
   * declared remote-only: a missing key would route the upload to a Worker that
   * would accept the PDF and file the resulting record into a household whose
   * rows live somewhere else entirely.
   */
  {
    module: 'utilities',
    remote: () => requireModule<object>('@features/utilities/api/utilities', 'utilitiesApi'),
    local: () => requireModule<object>('../localUtilitiesApi', 'localUtilitiesApi'),
    remoteOnly: {
      getMunicipality:
        'Tier C — `municipality_configs` is global reference data (due dates, penalty schedules, portal links per BC municipality), identical for every household and never ledgered; the same call `garbageCollectionApi.getMunicipality` makes',
    },
  },
  /**
   * H11 sub-wave C2 — floor plans, and the module with the most local throws of
   * any so far (eight of 25) and an EMPTY `remoteOnly` map.
   *
   * The empty map is the finding. C1 had one Tier C read and B4 had seven, so
   * the expectation going in was that a feature this server-heavy would have
   * some global reference surface to declare. It has none: every column of
   * `floor_plans`, `floor_plan_markers` and `floor_plan_annotations` is the
   * member's own drawing, their own pins and their own lines. There is no
   * catalogue, no template set and no shared glossary anywhere in it.
   *
   * The three region methods (`listRegions`, `processPendingRegions`,
   * `retryRegion`) are the ones that most look like they belong here, because
   * `floor_plan_regions` is Tier D and Tier D means "the server computes it".
   * They are LOCAL THROWS instead, and the distinction matters: Tier C data
   * exists on the server for every household, so fetching it leaks nothing and
   * answers correctly. Tier D data exists on the server for households the
   * server can see, and a local-first household is not one of them — so the
   * Worker would answer `{ regions: [] }` with a 200 and the viewer would render
   * a plan whose floors were never found rather than one whose detection is off.
   *
   * `getAnalysis` and `updateAnalysis` are the C1 lesson repeating one sub-wave
   * later: both look like AI and neither runs a model. They read and write
   * `floor_plans.ai_analysis_data`, a ledgered column, so they are local.
   */
  {
    module: 'floor-plans',
    remote: () => requireModule<object>('@api/floor-plans', 'floorPlansApi'),
    local: () => requireModule<object>('../localFloorPlansApi', 'localFloorPlansApi'),
    remoteOnly: {},
  },
  /**
   * H11 sub-wave C3 — garden plans, and the case that stretches the "declare it
   * remote-only" question furthest without changing the answer.
   *
   * `remoteOnly` names exactly ONE method, and it is not a table read: every
   * column of all four tables is the member's own, so there is no Tier C
   * catalogue, no template set and no shared glossary to send to a Worker. Eight
   * of the methods are gaps and all eight are local throws.
   *
   * **The creation hole this module used to have, and how it closed.** Read the
   * three H6 throws together and the consequence is easy to miss: `getUploadUrl`
   * is where the `garden_plans` ROW is created, not merely where a presigned URL
   * is minted, so while it was the only creation path a local-first household
   * could not make a yard plan by ANY route. Fifteen careful local ports, an
   * object editor and a marker layer, all operating on a table that could never
   * acquire a first row. `createMapPlan` closed it: a plan traced on a map has no
   * bytes — the imagery is the device's own map tiles and the plan IS the
   * geometry — so it needs no bucket, and it is local like everything else here.
   *
   * **Two of them are the interesting ones**, and they are a shape no earlier
   * sub-wave produced. `createBoundaryDraft` and `confirmBoundaryDraft` are not
   * blocked by private mode at all — their routes return **410 to every
   * household**, because the satellite lot tracing was retired. A remote-only
   * declaration would therefore give the RIGHT answer (the server's own 410) and
   * is still wrong on two counts: `createBoundaryDraft` posts the household's
   * street address, so routing it would leak a local-first home's address to a
   * Worker that is meant to hold ciphertext, and an offline device would get a
   * network error rather than the retirement message anyway. They are throws with
   * copy that says the flow is gone rather than that it is off.
   *
   * The three generation methods are the ordinary P4 case with one twist:
   * `cancelGeneration` and `retryGeneration` drive a QUEUED JOB rather than a
   * model, through `ai_tool_pending` (Tier B) and a KV counter. They are throws
   * rather than remote-only because a local-first plan can never be `generating`,
   * so the Worker would answer its own 409 to every caller forever.
   *
   * And the C1 lesson repeating a second time: `updateBoundary`, `listObjects`,
   * `replaceObjects` and `listBoundaryDrafts` all look like server features and
   * are pure functions of ledgered rows, so all four are local.
   */
  {
    module: 'garden-plans',
    remote: () => requireModule<object>('@api/garden-plans', 'gardenPlansApi'),
    local: () => requireModule<object>('../localGardenPlansApi', 'localGardenPlansApi'),
    remoteOnly: {
      /**
       * The AI plan reader — this module's only remote-by-design method, and the
       * same argument `homeProjectsApi.generateSmartProjectPlan` makes.
       *
       * It needs the model, the provider key and the member's image, none of
       * which exist on device. These ARE bytes leaving a sealed household, which
       * is what H6 exists to prevent, so the exemption has to earn itself:
       *
       *  - the member has just chosen a feature whose entire purpose is to show
       *    this plan to a model, so the bytes reach a third party either way;
       *  - it STORES NOTHING. The image arrives inline as base64 and is never
       *    written to R2, so unlike the Smart Project photo path there is not
       *    even a transient bucket key to purge;
       *  - what comes back is a DRAFT, saved through `createMapPlan` — which is
       *    local, so the finished plan lands in the ledger and the server keeps
       *    no copy of the yard it just described.
       *
       * The home's ADDRESS still never leaves the device; the coordinates come
       * from the lot the member traced on their own map. That is the line
       * `createBoundaryDraft` crossed and this one does not.
       */
      analyzePlanImage:
        'Vision model over a member-supplied plan image; stores nothing, returns a draft the local createMapPlan saves.',
    },
  },
  /**
   * H11 sub-wave C4 — home projects, the last case this list will get, and the
   * module with the most local throws of any: **thirteen of 27**.
   *
   * `remoteOnly` is EMPTY, as in C2 and C3, and the one method that argues
   * hardest for an entry is `listTemplates` — a catalogue of sixteen renovation
   * and replacement templates, identical for every household, carrying nothing of
   * theirs. That is `garbageCollectionApi.getMunicipalities` on paper. It is
   * LOCAL because `create` seeds a template's phases, selections, blockers and
   * budget lines as LEDGER ROWS, so the catalogue has to be on the device
   * regardless (`logic/homeProjects.ts`); serving the wizard's list from the
   * Worker as well would give one fact two sources. It is a compiled-in constant
   * rather than a D1 table, which is why it is not Tier C in the first place.
   *
   * The thirteen gaps fall into five groups and the last two are new to H11:
   *
   *  - **H6 (3)** — the attachment upload path. `createAttachmentUpload` mints
   *    the ROW as well as the URL, so there is no metadata-only half.
   *  - **Tier D (4)** — the four geometry methods. `home_project_geometry` is in
   *    `HOUSE_TIER_D_TABLES`, and these are the first WRITES the programme has
   *    refused on tier grounds: routing them remote would not answer empty, it
   *    would store a row the local `getHub` can never read back, so a member
   *    would type their measurements and watch them disappear. C2's
   *    `listRegions` distinction, applied to a write.
   *  - **P4 (1)** — `suggestAiScope`, and it is a PRODUCT decision rather than a
   *    mechanism. It runs no model (a hardcoded list of three-to-five idea names
   *    branched on `project.type`), so by C2's `getAnalysis` precedent it should
   *    be local. Its route is gated by `assertCanUseAI`, which resolves a real
   *    subscription entitlement, and quietly handing a gated feature to every
   *    local-first household is not this sub-wave's call to make — §11.1.5's
   *    precedent. Flagged in the facade with the fifteen-line alternative named.
   *  - **Egress (0)** — `createFromLink` was refused on these grounds and is
   *    now local. The Worker fetches the shop page; the device never does, and
   *    that half of the reasoning stands. It reads the URL instead — on device,
   *    then optionally through the member's own provider key, which reaches an
   *    allowlisted assistant rather than the vendor. The refusal it replaced was
   *    correct about the page and wrong about the member, who read it as being
   *    unable to save a link at all.
   *  - **S2 (4)** — `listTasks`, `linkTask`, `createTask` and (by consequence)
   *    `downloadExportPdf`. The first three reach `home_project_tasks`, a PK-less
   *    join table parked in `HOUSE_S2_DEFERRED_TABLES` behind a backend change.
   *    **This is the only place in H11 where a member loses a working feature to
   *    a schema decision** rather than to a model, a file transfer or a tier, and
   *    it is why those three throw rather than answering an empty list:
   *    `createTask` in particular could mint the task and silently fail to link
   *    it, leaving a job the project can never show.
   *
   * And the C1 lesson repeating a third time: `getHub`, `list`, `listActivity`
   * and `exportSummary` all look like server features and are pure functions of
   * ledgered rows, so all four are local. `getHub` is the sharpest case in the
   * programme — it computes the budget rollups, so remote it would answer
   * `estimate_total: 0` with a 200 over a fully specified renovation.
   */
  {
    module: 'home-projects',
    remote: () => requireModule<object>('@api/home-projects', 'homeProjectsApi'),
    local: () => requireModule<object>('../localHomeProjectsApi', 'localHomeProjectsApi'),
    remoteOnly: {
      /**
       * Smart Project's AI call, and the ONLY method in this module that is
       * remote without being a leak.
       *
       * It needs the model, the provider key and the uploaded photos — none of
       * which exist on device — and it STORES NOTHING. It returns a drafted
       * plan; the caller then saves it through this same api module, so the
       * project lands in the encrypted ledger on a local-first household and in
       * D1 on a server-backed one.
       *
       * That split is the whole reason the feature can ship on House. The
       * earlier design had the Worker write the project into D1 directly, which
       * on a local-first household produced a project the member's own phone
       * could never open — so it had to be hidden from everybody. The seven
       * write-through methods beside it (`startSmartDraft`, `publishProject`,
       * the as-is trio…) remain LOCAL THROWS precisely because they do store,
       * and this one is remote precisely because it does not.
       */
      generateSmartProjectPlan:
        'Needs the model and the provider key; stores nothing — the caller saves the plan through this same module.',
      /**
       * The same call's other half: the photos the member attaches on step 3.
       *
       * The objection deserves stating rather than waving through — these are
       * bytes leaving a sealed household's device, which is the thing H6 exists
       * to prevent. It is nonetheless a different act from an attachment
       * upload, on three counts:
       *
       *  - the member has just chosen a feature whose whole purpose is to show
       *    these photos to a model, so the bytes reach a third party either
       *    way. R2 is transit here, not a new audience.
       *  - the Worker purges every key as soon as the plan returns
       *    (`purgeSmartDraftPhotos`), so nothing settles in a bucket that no
       *    screen lists and no delete reaches.
       *  - the copy the member KEEPS does not use this method at all. The
       *    wizard attaches it to the materialised project through
       *    `uploadSelectionPhoto`, which is local and seals it into the H6 blob
       *    channel — so the photo they can still open in a year never went to a
       *    server.
       *
       * A local counterpart would therefore have to be a throw, and a throw
       * here would remove the photo step from every House household by default
       * — which is the mistake the whole `generateSmartProjectPlan` split
       * exists to undo.
       */
      uploadSmartDraftPhoto:
        'A transient AI input the Worker purges after generating; the kept copy goes through local uploadSelectionPhoto.',
    },
  },
  /**
   * Neighbours (migration 0165) — the first module in this list with **no gap in
   * either direction and no argument to have one**.
   *
   * `ratings` was the previous cleanest case and it got there by accident of
   * scope: rating a contractor happens to need no server. This one is clean by
   * DESIGN. Every row in the family describes a third party who never installed
   * this app, all three tables are named in `HOUSE_AI_EGRESS_FORBIDDEN_TABLES`,
   * and the whole point of the feature is that the record never leaves the
   * household's devices. So there is nothing here a Worker could add:
   *
   *  - no Tier C catalogue — a neighbour is not drawn from a shared list;
   *  - no model — nothing is extracted, summarised or suggested by an AI;
   *  - no H6 gap either, and this is the one worth naming. Photos DO go through
   *    the encrypted blob channel, but the api never touches the bytes: the row
   *    carries a `HouseBlobDescriptor` that `HouseAttachmentField` produced, so
   *    the upload path is the screen's and not this module's. That is why there
   *    is no `getUploadUrl` here to be a local throw.
   *
   * The geocoder is the one external service this feature uses, and it is
   * deliberately NOT an api method: `@services/geocoding` calls the OS geocoder
   * directly, so the address of a neighbour is resolved by Apple or Google under
   * terms the member already accepted rather than by a Symply endpoint. A
   * `neighboursApi.geocode` would have had to appear in this list as remote-only,
   * and it would have been the one place the feature leaked.
   */
  {
    module: 'neighbours',
    remote: () => requireModule<object>('@api/neighbours', 'neighboursApi'),
    local: () => requireModule<object>('../localNeighboursApi', 'localNeighboursApi'),
    remoteOnly: {},
  },
];

describe('H3 parity — every remote method has a local counterpart', () => {
  it.each(CASES.map((c) => [c.module, c] as const))(
    '%s: no remote method is missing locally',
    (_name, testCase) => {
      const gap = parityGap(
        testCase.remote(),
        testCase.local(),
        Object.keys(testCase.remoteOnly),
      );
      // The message names the offenders, because "expected [] to equal
      // ['reorderSubtasks']" is the whole diagnosis.
      expect(gap.missingLocally).toEqual([]);
    },
  );

  it.each(CASES.map((c) => [c.module, c] as const))(
    '%s: no local method is absent from the remote module',
    (_name, testCase) => {
      const gap = parityGap(testCase.remote(), testCase.local(), Object.keys(testCase.remoteOnly));
      expect(gap.extraLocally).toEqual([]);
    },
  );

  it('declares a REASON for every method that stays remote', () => {
    for (const testCase of CASES) {
      for (const [method, reason] of Object.entries(testCase.remoteOnly)) {
        expect(`${testCase.module}.${method}: ${reason}`.length).toBeGreaterThan(
          `${testCase.module}.${method}: `.length,
        );
      }
    }
  });

  it('is capable of failing — parityGap really reports a missing method', () => {
    // Proof the harness is not vacuous.
    const gap = parityGap({ a: () => 1, b: () => 2 }, { a: () => 1 });
    expect(gap.missingLocally).toEqual(['b']);
    expect(parityGap({ a: () => 1 }, { a: () => 1, z: () => 9 }).extraLocally).toEqual(['z']);
    // …and that an explicit declaration silences it.
    expect(parityGap({ a: () => 1, b: () => 2 }, { a: () => 1 }, ['b']).missingLocally).toEqual([]);
  });
});
