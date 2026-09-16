/**
 * Bridge between "a peer's op merged into the ledger" and "the screen shows it"
 * — with a per-table query-key map, which is the one place Budget's pattern must
 * NOT be copied (plan §5.2).
 *
 * WHY NOT A BLANKET INVALIDATE
 * ----------------------------
 * `budget/local/sync/ledgerRefresh.ts` fires `queryClient.invalidateQueries()`
 * with no arguments on every ledger bump. That is defensible for Budget: its
 * screens are Zustand + `dataRevision` effects and it holds few React Query
 * keys. House holds ~15 active query keys and several of them are **Tier B
 * server data** — chat, AI Housekeeper, reports, notification history, weather.
 * A blanket invalidate on every remote op turns each sync into a burst of
 * network requests against exactly the endpoints local-first exists to stop
 * calling, and it does it once per sync, per member, forever.
 *
 * So `subscribeToHouseLedgerChanges` reports WHICH tables moved and this module
 * maps them to a bounded key set. A `tasks` delta invalidates task keys and
 * nothing else.
 *
 * WHY THERE IS NO STORE `markDirty` HERE
 * --------------------------------------
 * Budget's bridge also pokes four Zustand stores. House's stores
 * (`taskStore`, `spaceStore`, `homeFeaturesStore`, `taskDraftStore`, …) are pure
 * state containers with setters — they are populated BY the query hooks, not
 * alongside them — so invalidating the query is the whole job. If a House store
 * ever grows its own fetch, add it here rather than reaching for a blanket
 * invalidate.
 */
import { queryClient } from '@/lib/queryClient';

import { subscribeToHouseLedgerChanges, type HouseLedgerChange } from '../engine';
import { HOUSE_LEDGER_TABLE_NAMES, type HouseLedgerTableName } from '../schema';

/**
 * Ledger table → the query-key PREFIXES a change to it can invalidate.
 *
 * Prefixes, not exact keys: React Query matches by prefix, so
 * `['home', 'appliances']` covers `['home', 'appliances', householdId]` without
 * this module having to know the household id. Keep every entry justified — an
 * over-broad prefix here is the blanket invalidate coming back through the side
 * door.
 */
export const HOUSE_TABLE_QUERY_KEYS: Record<HouseLedgerTableName, readonly (readonly string[])[]> = {
  // --- the property itself -------------------------------------------------
  households: [['households'], ['home', 'insight']],
  householdMembers: [['households'], ['members']],

  // --- tasks and their satellites -----------------------------------------
  tasks: [['tasks'], ['home', 'insight'], ['home', 'drafts']],
  maintenanceCompletions: [['tasks'], ['home', 'insight']],
  maintenanceSubtasks: [['tasks']],
  maintenanceTaskNotes: [['tasks']],
  taskDrafts: [['home', 'drafts'], ['tasks']],

  // --- the home itself -----------------------------------------------------
  householdSpaces: [['spaces'], ['home', 'insight'], ['home', 'appliances']],
  homeFeatures: [['home-features'], ['home', 'insight']],
  appliances: [['home', 'appliances'], ['home', 'insight']],
  applianceServiceHistory: [['home', 'appliances']],
  // The 2026-08-15 registry correction. Same prefix as the service history and
  // for the same reason: `ApplianceDetailScreen` reads the appliance, its
  // history and its documents together on one render, so three prefixes would
  // invalidate all three on nearly every change anyway.
  //
  // Deliberately NOT `['home', 'insight']`. Attaching a manual changes no
  // maintenance fact the home insight computes, and `appliance_documents` is not
  // in the AI egress allowlist at all — invalidating that key here would refetch
  // an insight on a write that provably cannot move it.
  applianceDocuments: [['home', 'appliances']],

  // --- schedules and checklists -------------------------------------------
  garbageSchedules: [['garbage']],
  seasonalChecklists: [['seasonal-checklists']],
  seasonalChecklistItems: [['seasonal-checklists']],
  recurringChecklists: [['checklists']],
  recurringChecklistItems: [['checklists']],
  checklistInstances: [['checklists']],
  checklistItemCompletions: [['checklists']],

  // --- small domain tables -------------------------------------------------
  householdNotes: [['household-notes']],
  settings: [['settings']],
  recurringReminders: [['recurring-reminders']],

  // --- H11 B1, the labor hub's contractor record ---------------------------
  //
  // One namespace for the whole family, the same shape `['checklists']` uses for
  // its four tables: the contractor list, a contractor's detail, its visits and
  // its documents are all read together off one screen, so splitting them into
  // four prefixes would invalidate three of them anyway on nearly every change.
  //
  // Nothing subscribes to `['contractors']` YET — the labor screens still fetch
  // imperatively with `useState`/`useEffect` (`ContractorsListScreen`,
  // `ContractorDetailScreen`, `LaborHubDashboard`), so today these entries make
  // the bridge invalidate a key no query holds, which React Query treats as a
  // no-op. They are here because `HOUSE_TABLE_QUERY_KEYS` is exhaustive over the
  // live registry by construction, and because the alternative — pointing them
  // at a key that DOES exist, like `['tasks']` — would refetch data a contractor
  // write never touched. When those screens move to React Query they must adopt
  // this namespace rather than mint their own.
  contractors: [['contractors']],
  // Deliberately NOT also `['tasks']`. `createReceiptReminderTask` does write a
  // task alongside the visit, but it writes it into `tasks`, and the delta
  // therefore names `tasks` too — the task keys are invalidated by the table
  // that actually changed, not by a neighbour guessing on its behalf.
  contractorVisits: [['contractors']],
  contractorRepresentatives: [['contractors']],
  contractorDocuments: [['contractors']],

  // --- H11 B2, quoting -----------------------------------------------------
  //
  // Unlike B1, one of these keys is LIVE. `useHomeDashboard` holds
  // `['home', 'quotes', householdId]` and renders the pending-quote count on the
  // home tab, so a local quote write has a real subscriber to wake — which is
  // also why the prefix is the two-segment `['home', 'quotes']` and not a bare
  // `['home']`: the one-segment form would drag in `['home', 'home-budget']`,
  // which is Tier B and is named in `HOUSE_NEVER_INVALIDATED_KEYS` for exactly
  // that reason.
  appointments: [['appointments']],
  quotes: [['home', 'quotes']],
  // The task-scoped pair gets its own namespace rather than joining `quotes`.
  // Nothing subscribes to it yet — `QuoteManagementScreen` and
  // `QuoteComparisonScreen` reach these rows through `tasksApi.getTaskQuotes`,
  // which fetches imperatively and, under local-first, throws. Pointing them at
  // `['home', 'quotes']` would refetch the dashboard's pending-quote count on a
  // write that cannot change it (different table), and pointing them at
  // `['tasks']` would refetch the whole task list; both are the blanket
  // invalidate arriving one table at a time. When those screens adopt React
  // Query they must take this namespace rather than mint their own.
  contractorQuotes: [['task-quotes']],
  quoteRequests: [['task-quotes']],

  // --- H11 B3, the project -------------------------------------------------
  //
  // `useHomeDashboard` holds `['home', 'projects', householdId]` and renders the
  // active-project cards on the home tab, so — like `quotes` — this one has a
  // real subscriber. The prefix is the two-segment `['home', 'projects']` for
  // the same reason: a bare `['home']` reaches `['home', 'home-budget']`, which
  // is Tier B and named in `HOUSE_NEVER_INVALIDATED_KEYS`.
  //
  // The namespace is `home` rather than a top-level `projects` because that is
  // where the only live key already sits — it is read off `useHomeDashboard`,
  // not invented here. `ProjectsScreen`, `ProjectDetailScreen`,
  // `AddEditProjectScreen`, `LaborHubDashboard` and `HomeActiveProjectsSection`
  // all still fetch imperatively with `useState`/`useEffect`, so nothing else
  // subscribes yet; when they adopt React Query they should take this prefix
  // rather than mint a second one.
  projects: [['home', 'projects']],
  // The three children share the parent's key rather than taking their own,
  // and this is the one place in the map where that is not the usual
  // one-namespace-per-family convenience. `projectsApi.getAll` returns
  // `ProjectWithDetails`, which EMBEDS the milestones, the payments, the photos
  // and a `progress` block derived from all three — so a milestone write
  // genuinely changes what the dashboard's project query returns. A separate
  // prefix here would be precise about the table and wrong about the query.
  projectMilestones: [['home', 'projects']],
  projectPayments: [['home', 'projects']],
  projectProgressPhotos: [['home', 'projects']],

  // --- H11 B4, the on-site surface -----------------------------------------
  //
  // Three namespaces for seven tables, one per remote module, because that is
  // how the reads are actually shaped rather than how the tables are.
  //
  // `visit-checklists` and NOT `checklists`: the Wave-A key `['checklists']`
  // belongs to the RECURRING checklists (`localChecklistsApi`), a completely
  // different feature that happens to share the physical table name
  // `checklist_items`. Reusing it would make ticking off a question on a
  // contractor visit refetch the household's weekly chore lists — the S1
  // collision leaking out of the registry and into the refresh bridge.
  visitChecklists: [['visit-checklists']],
  // Items and photos share the checklist's key rather than taking their own,
  // for B3's reason: every `visitChecklistsApi` read returns
  // `ChecklistWithItems`, which EMBEDS the items, and the photo count is read
  // per item off the same screen. A separate prefix would be precise about the
  // table and wrong about the query.
  visitChecklistItems: [['visit-checklists']],
  checklistItemPhotos: [['visit-checklists']],
  // `visit_notes` has no client module at all, so nothing can subscribe to a
  // key for it today. It still gets one rather than an empty array: the map is
  // exhaustive over the live registry by construction, and a note only ever
  // moves as part of a visit — `deleteVisit` drops its notes in the same op —
  // so the contractor namespace is where a future reader would look for it.
  visitNotes: [['contractors']],
  contractorMessages: [['messages']],
  // Two prefixes, and the second is the interesting one. A rating is read from
  // its own screens (`['ratings']`) AND shown on the contractor record, because
  // `ContractorWithStats` renders the average — which `localRatingsApi`
  // recomputes from these rows rather than storing. A rating write therefore
  // genuinely changes what a contractor read answers, so the contractor keys go
  // stale with it. Nothing subscribes to either yet; both are here for the same
  // reason B1's are, and a future reader must adopt these rather than mint new
  // ones.
  contractorJobRatings: [['ratings'], ['contractors']],
  // Same position as `visitNotes`: no client module, no subscriber, and the
  // rows are reached through the contractor whose record they annotate.
  contractorIssueResolutions: [['contractors']],

  // --- H11 C1, utilities ---------------------------------------------------
  //
  // Two namespaces for five tables, split by SCREEN rather than by schema, and
  // both are single-segment because neither belongs under `home`. A one-segment
  // prefix is only dangerous in that namespace — a bare `['home']` reaches
  // `['home','home-budget']`, which is Tier B and named in
  // `HOUSE_NEVER_INVALIDATED_KEYS` — and there is nothing to reach here: no key
  // in the forbidden list starts with `utilities` or `property`. Note
  // `['municipalities']` IS forbidden and is a near neighbour of this feature;
  // it stays reachable only by the Tier-C read that owns it.
  //
  // Nothing subscribes to either key YET. Every utilities screen still fetches
  // imperatively with `useState`/`useEffect` (`UtilitiesScreen`,
  // `UtilityBillsScreen`, `UtilityDetailScreen`, `UtilityChartsScreen`,
  // `PropertyTaxScreen`, `PropertyDetailScreen` and the two property tabs), so
  // today these entries invalidate a key no query holds, which React Query
  // treats as a no-op. They are here because `HOUSE_TABLE_QUERY_KEYS` is
  // exhaustive over the live registry by construction, and because the
  // alternative — pointing them at a key that DOES exist, like `['households']`
  // for the property tabs — would refetch the property list on a write that
  // cannot change it. When those screens adopt React Query they must take these
  // namespaces rather than mint their own.
  utilityAccounts: [['utilities']],
  // Deliberately NOT also `['tasks']`, for the reason `contractorVisits` gives:
  // a bill write DOES touch `tasks` (the "Pay <provider> bill" reminder is
  // minted, dropped and deleted alongside the bill), but it writes into `tasks`,
  // so the delta names that table too and the task keys are invalidated by the
  // table that actually changed rather than by a neighbour guessing on its
  // behalf.
  utilityBills: [['utilities']],
  // The two annual records take `property`, not `utilities`, because that is
  // where they are read: `getPropertyInsights` composes both into the Property
  // detail screen's tiles and charts. They are reached from the utilities tab as
  // well, which is why the split is by screen and not by Drizzle file.
  propertyTaxes: [['property']],
  bcAssessmentData: [['property']],
  // No client module, no subscriber, and nothing local writes one — the same
  // position `visitNotes` holds. It still gets a key rather than an empty array,
  // because the map is exhaustive over the live registry by construction, and a
  // reminder only ever moves as part of a bill (`deleteBill` drops its reminders
  // in the same op), so the bill's namespace is where a future reader would look.
  utilityReminders: [['utilities']],

  // --- H11 C2, floor plans -------------------------------------------------
  //
  // ONE single-segment namespace for all three tables, and the segment count is
  // the decision that needed checking rather than the namespace.
  //
  // Floor plans DO appear on home and dashboard surfaces — `MyHomeScreen` reads
  // `list` and then `get` + `getAnalysis` per plan, and `LaborHubDashboard`
  // reads `list` — so `['home', 'floor-plans']` looked like the obvious shape,
  // by analogy with B2's `['home', 'quotes']` and B3's `['home', 'projects']`.
  // It is not, and the reason is that those two prefixes were not invented
  // either: `useHomeDashboard` genuinely holds `['home', 'quotes', householdId]`
  // and `['home', 'projects', householdId]`, so the namespace was read off a
  // live subscriber. Grepping every `queryKey` in `src/` finds NO floor-plan key
  // at all — every one of those screens fetches imperatively with
  // `useState`/`useEffect`, including the two on the home tab. Minting a `home`
  // sub-key for a query that does not exist would put this family one careless
  // edit away from a bare `['home']`, which reaches `['home', 'home-budget']` —
  // Tier B, and named in `HOUSE_NEVER_INVALIDATED_KEYS` for exactly that reason.
  //
  // So it is the single segment C1 used, and it is safe for C1's reason: nothing
  // in the forbidden list starts with `floor-plans`. The entries invalidate a key
  // no query holds today, which React Query treats as a no-op; they are here
  // because this map is exhaustive over the live registry by construction, and
  // because the alternative — pointing them at a key that DOES exist, like
  // `['spaces']` (a marker really does write `tasks.space_id`) — would refetch
  // the space list on a write that cannot change it. When `FloorPlansScreen`,
  // `FloorPlanViewerScreen`, `MyHomeScreen` and the rest adopt React Query they
  // must take this namespace rather than mint their own.
  floorPlans: [['floor-plans']],
  // Markers and annotations share the plan's key rather than taking their own,
  // for the reason B3's children do: every marker and annotation is read through
  // the plan it is drawn on (`listMarkers`, `listAnnotations` are both scoped by
  // `floorPlanId`), so a separate prefix would be precise about the table and
  // wrong about the query. `deleteFloorPlan` also drops both in the same op, so
  // the delta names all three at once regardless.
  //
  // Deliberately NOT also `['tasks']` or `['spaces']`, for the reason
  // `contractorVisits` and `utilityBills` give: `createMarker` DOES write
  // `tasks.space_id` when it can resolve a space, but it writes it into `tasks`,
  // so the delta names that table too and the task keys are invalidated by the
  // table that actually changed rather than by a neighbour guessing on its
  // behalf.
  floorPlanMarkers: [['floor-plans']],
  floorPlanAnnotations: [['floor-plans']],

  // --- H11 C3, garden plans ------------------------------------------------
  //
  // ONE single-segment namespace for all four tables, and the check that
  // produced it is the one C2 ran rather than the answer C2 reached.
  //
  // Garden plans reach the home tab through the AI Housekeeper — `ApprovalsScreen`
  // creates them and `GardenPlansScreen`, `GardenPlanViewerScreen` and the two
  // editors read them — so `['home', 'garden-plans']` was the shape to consider,
  // by analogy with B2's `['home', 'quotes']` and B3's `['home', 'projects']`.
  // It is not, for C2's reason: those two prefixes were READ OFF a live
  // subscriber (`useHomeDashboard` genuinely holds both), and grepping every
  // `queryKey` in `src/` finds NO garden key at all — not `garden`, not
  // `garden-plans`, not one under `home`. Every garden screen fetches
  // imperatively with `useState`/`useEffect`, including the boundary editor hook.
  // Minting a `home` sub-key for a query that does not exist would leave this
  // family one careless edit away from a bare `['home']`, which reaches
  // `['home', 'home-budget']` — Tier B, and named in
  // `HOUSE_NEVER_INVALIDATED_KEYS` for exactly that reason.
  //
  // So it is the single segment C1 and C2 used, and it is safe for their reason:
  // nothing in the forbidden list starts with `garden-plans`. The entries
  // invalidate a key no query holds today, which React Query treats as a no-op;
  // they are here because this map is exhaustive over the live registry by
  // construction, and because the alternative — pointing them at a key that DOES
  // exist, like `['tasks']` (a garden pin really does link a task) — would
  // refetch the task list on a write that cannot change it.
  //
  // NOT `['floor-plans']`, which is the mistake this block is closest to. The
  // two features have near-identical marker tables and a shared vocabulary, and
  // folding them into one namespace would make dropping a pin in the garden
  // refetch the floor-plan viewer — the S1-style confusion leaking out of the
  // registry and into the refresh bridge, which is what `visitChecklists` had to
  // avoid against `['checklists']`.
  gardenPlans: [['garden-plans']],
  // The objects and markers share the plan's key rather than taking their own,
  // for the reason B3's children and C2's do: both are read through the plan
  // they are drawn on (`listObjects` and `listMarkers` are scoped by
  // `gardenPlanId`), so a separate prefix would be precise about the table and
  // wrong about the query. `delete` also drops both in the same op, so the delta
  // names all three at once regardless.
  gardenPlanObjects: [['garden-plans']],
  gardenPlanMarkers: [['garden-plans']],
  // The boundary draft is the one table here that is NOT read through a plan —
  // `GardenPlansScreen` lists pending drafts beside the plans and
  // `GardenPlanBoundaryConfirmScreen` opens one by id. It still takes the same
  // namespace rather than its own, because both readers are the garden surface
  // and a draft only ever changes what that surface shows. Splitting it out
  // would invalidate two keys on every screen that already invalidates this one.
  gardenPlanBoundaryDrafts: [['garden-plans']],

  // --- H11 C4, home projects -----------------------------------------------
  //
  // **The only React-Query-NATIVE family in the whole map, and the reason §5.2
  // matters more here than anywhere in the programme.**
  //
  // Every block above this one had to reason about a namespace nobody
  // subscribes to yet: B1's labor screens, C1's utilities screens, C2's floor
  // plans and C3's gardens all fetch imperatively with `useState`/`useEffect`,
  // so their entries invalidate keys no query holds and React Query treats them
  // as no-ops. That is not the situation here. `src/api/home-projects.ts`
  // exports a real key factory — `homeProjectKeys` — and four hooks that use it,
  // and `HomeProjectHubScreen` and `CreateHomeProjectWizard` are built on them.
  // Every prefix below wakes a live subscriber, so getting one wrong is a
  // stale screen or a refetch storm rather than a no-op.
  //
  // The factory declares FOUR keys and they are three unrelated namespaces plus
  // one that must never be reached:
  //
  //   all(householdId)  → ['home-projects', householdId]      the list
  //   hub(projectId)    → ['home-project',  projectId]        the whole project
  //   activity(pid)     → ['home-project-activity', projectId] the audit feed
  //   templates()       → ['home-project-templates']          a static catalogue
  //
  // **These do not nest.** React Query matches a prefix ELEMENT BY ELEMENT, not
  // by string prefix, so `['home-project']` reaches the hub and reaches neither
  // `['home-projects', …]` nor `['home-project-activity', …]` — the three
  // namespaces are as unrelated to each other as `['tasks']` and `['garbage']`
  // are. A reader who assumes otherwise will map the whole family to one prefix
  // and leave two of the three screens stale after every peer's sync. That is
  // the specific mistake this block exists to prevent, and it is why the map
  // below is three namespaces rather than the single-segment one C1, C2 and C3
  // each settled on.
  //
  // `['home-project-templates']` is deliberately UNREACHABLE from here and is
  // named in `HOUSE_NEVER_INVALIDATED_KEYS`. It is a static catalogue compiled
  // into the app (`logic/homeProjects.ts`), not a function of any ledger row, so
  // no delta can make it stale — the same position `['maintenance-templates']`
  // holds. Note it is also the one key in this family a careless prefix could
  // actually hit: nothing here may shorten to `['home-project-templates']`, and
  // the never-list is what proves it.
  //
  // And the rule every block since B2 has restated, because it is the one that
  // bites: NOT a bare `['home']`. That reaches `['home', 'home-budget']`, which
  // is Tier B. B2 and B3 legitimately use two-segment `['home', …]` prefixes
  // because `useHomeDashboard` genuinely holds those keys; this family's keys
  // are top-level and must stay that way.
  //
  // The project row is read by BOTH the list and the hub — `getHub` embeds
  // `project` — so it is the one table here with two prefixes.
  homeProjects: [['home-projects'], ['home-project']],
  // The seven children below take the hub key ALONE, and this is the strongest
  // case in the map for B3's "share the parent's key" rule rather than the
  // weakest. `getHub` returns one composite document containing the selections,
  // the budget lines, the phases, the milestones, the blockers, the attachments
  // and the plan links — plus `rollups`, which is arithmetic over the budget
  // lines. There is no per-child query to invalidate, so a separate prefix would
  // be precise about the table and wrong about the query, and the LIST key is
  // deliberately not included: adding a phase does not change the project's row,
  // and refetching every project in the household on it would be the blanket
  // invalidate arriving one table at a time.
  homeProjectBudgetLines: [['home-project']],
  homeProjectSelections: [['home-project']],
  // The hub carries the groups and every card is priced against its group's
  // area, so a peer changing 24 m² to 48 m² has to re-render the whole option
  // list — not just the group header.
  homeProjectOptionGroups: [['home-project']],
  homeProjectPhases: [['home-project']],
  homeProjectMilestones: [['home-project']],
  homeProjectBlockers: [['home-project']],
  homeProjectAttachments: [['home-project']],
  homeProjectPlanLinks: [['home-project']],
  // The audit feed is its own query with its own hook (`useHomeProjectActivity`)
  // and its own cursor, so it gets its own prefix. Deliberately NOT also
  // `['home-project']`: a peer's activity row is appended constantly — it is the
  // highest-cardinality table in C4 — and dragging the hub along would refetch
  // the whole composite document on every logged event.
  homeProjectActivity: [['home-project-activity']],

  // H13 D-wave. Each prefix is the key the owning screen already queries under,
  // and none of them is a prefix of a Tier-B/C key — the property this file's
  // guard proves, and the reason these are spelled out rather than derived from
  // the table name.
  //
  // `floorPlanRegions` and `homeProjectGeometry` deliberately invalidate their
  // PARENT's key as well: neither has a screen of its own, both render inside
  // the plan and the project, so invalidating only their own key would leave
  // the surface a member is actually looking at stale.
  maintenanceSuggestions: [['maintenance-suggestions']],
  contractorRecommendations: [['contractor-recommendations']],
  utilityTrends: [['utility-trends']],
  floorPlanRegions: [['floor-plan-regions'], ['floor-plans']],
  homeProjectGeometry: [['home-project-geometry'], ['home-projects']],

  // H13 B-wave. The child tables invalidate their parent room / assistant
  // surface as well, for the reason the D-wave block gives: none of them has a
  // screen of its own.
  //
  // Every prefix below is checked against `HOUSE_NEVER_INVALIDATED_KEYS` by
  // this file's guard, which matters more here than in the D-wave: `chat-*` and
  // `assistant-*` keys sit next to the report and subscription keys that must
  // never be invalidated by a local write, and a prefix like `['chat']` would
  // have reached them.
  assistantBriefings: [['assistant-briefings']],
  assistantOutboundLog: [['assistant-outbound-log']],
  assistantTrustLedger: [['assistant-trust-ledger']],
  assistantIdentity: [['assistant-identity']],
  aihousekeeperAttachments: [['aihousekeeper-attachments']],
  auditLog: [['audit-log']],
  // The comment has no reader on any backend — there is no list route and no
  // client method — so nothing can subscribe to a key for it today. It takes the
  // ACTIVITY namespace rather than the hub's, and that is a considered answer
  // rather than a shrug: `addComment` writes this row and an activity row
  // together, the feed is the only place a member ever sees that a comment
  // happened, and the hub document does not contain comments at all. A future
  // comment list belongs on that screen, so this is where a reader would look.
  // (The activity key is invalidated by `homeProjectActivity` too, on the same
  // delta — this entry is what keeps the mapping honest if that ever stops
  // being true, exactly as `visitNotes` → `['contractors']` does.)
  homeProjectComments: [['home-project-activity']],

  // --- Neighbours (0165) ---------------------------------------------------
  //
  // One namespace for all three tables, and unlike B1's `['contractors']` this
  // one has real subscribers from the day it ships: `useNeighbours` holds
  // `['neighbours', householdId]` and `['neighbours', householdId,
  // 'neighbourhoods']`, and the map screen re-renders off it.
  //
  // The people share the home's key rather than taking their own. That is not
  // the usual one-namespace-per-family convenience — it is required here.
  // `neighboursApi.getAll` returns `NeighbourWithPeople`, which EMBEDS the
  // occupants and the `person_count` the map bubble renders, so adding a person
  // genuinely changes what the neighbours query returns. A separate prefix would
  // be precise about the table and wrong about the query: the bubble would keep
  // showing "2" after a third occupant was added, which is the exact silence
  // this map exists to prevent. B3's `projectMilestones` made the same call for
  // the same reason.
  //
  // `neighbourhoods` takes the SAME prefix and additionally invalidates the
  // areas key, because deleting an area unfiles its homes — a write to one table
  // that changes rows in another.
  neighbours: [['neighbours']],
  neighbourPeople: [['neighbours']],
  neighbourhoods: [['neighbours']],
};

/**
 * Query-key prefixes this bridge must NEVER invalidate.
 *
 * All Tier B/C: server-authoritative or global reference data that no local
 * write can change. Asserted by `__tests__/ledgerRefresh.test.ts` against the
 * map above, so an over-broad prefix added later fails a test rather than
 * quietly reinstating the request burst.
 */
export const HOUSE_NEVER_INVALIDATED_KEYS: readonly (readonly string[])[] = [
  ['chat'],
  ['aihousekeeper'],
  ['reports'],
  ['notifications'],
  ['weather'],
  ['ai-usage'],
  ['ai-models'],
  ['oauth-google-status'],
  ['home', 'home-budget'],
  ['municipalities'],
  ['maintenance-templates'],
  ['service-providers'],
  // H11 C4. A static catalogue compiled into the app (`logic/homeProjects.ts`),
  // not a function of any ledger row — the same position `maintenance-templates`
  // holds. It is listed here rather than merely left out of the map because it
  // is the one key in the home-project family a careless prefix could reach, and
  // because `homeProjects` maps to `['home-projects']` and `['home-project']`,
  // both of which sit one plausible edit away from it.
  ['home-project-templates'],
];

/** Deduped key prefixes for a set of changed tables. */
export function queryKeysForTables(
  tables: readonly HouseLedgerTableName[],
): (readonly string[])[] {
  const seen = new Set<string>();
  const out: (readonly string[])[] = [];
  for (const table of tables) {
    for (const key of HOUSE_TABLE_QUERY_KEYS[table] ?? []) {
      const id = key.join('');
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(key);
    }
  }
  return out;
}

/**
 * Invalidate exactly the keys the changed tables map to.
 *
 * An empty `tables` array means "something changed that is not table data" — a
 * conflict log cleared, an enrolment completed — and invalidates nothing, which
 * is correct: no query is stale.
 */
export function invalidateForTables(tables: readonly HouseLedgerTableName[]): void {
  for (const queryKey of queryKeysForTables(tables)) {
    void queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}

let unsubscribe: (() => void) | null = null;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingTables = new Set<HouseLedgerTableName>();

/**
 * How long events are gathered before the invalidation runs once.
 *
 * The sync run already coalesces its own merges (`withLedgerBatch` in the
 * engine), so this is not the primary defence — it is the one that covers every
 * OTHER burst: a restore, a property switch that lands beside an arriving op, a
 * bulk local write, a future caller that forgets the batch. Trailing-only,
 * because a leading edge would invalidate off the first op of a burst and
 * reintroduce exactly the half-merged frame this exists to remove.
 *
 * Short enough to be imperceptible, and it delays only ledger-driven refreshes:
 * a local write repaints through the mutation that made it.
 *
 * The tables are ACCUMULATED across the window rather than replaced. Dropping
 * all but the last change would be worse than no coalescing at all — it would
 * silently skip the invalidation for every table that moved earlier in the
 * burst, which is a screen left stale rather than a screen repainted twice.
 */
const REFRESH_COALESCE_MS = 120;

function flushRefresh(): void {
  coalesceTimer = null;
  const tables = [...pendingTables];
  pendingTables.clear();
  try {
    invalidateForTables(tables);
  } catch (error) {
    console.warn('[house.local] ledger refresh bridge failed', error);
  }
}

/** Idempotent — safe to call on every session open. */
export function startHouseLedgerRefreshBridge(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeToHouseLedgerChanges((change: HouseLedgerChange) => {
    for (const table of change.tables) pendingTables.add(table);
    if (coalesceTimer) clearTimeout(coalesceTimer);
    coalesceTimer = setTimeout(flushRefresh, REFRESH_COALESCE_MS);
  });
}

export function stopHouseLedgerRefreshBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (coalesceTimer) {
    clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
  pendingTables.clear();
}

/** Every table has a mapping — the guard that keeps the map exhaustive. */
export function tablesWithoutQueryKeys(): HouseLedgerTableName[] {
  return HOUSE_LEDGER_TABLE_NAMES.filter(
    (table) => (HOUSE_TABLE_QUERY_KEYS[table] ?? []).length === 0,
  );
}
