// Must precede @symply/local-first — @noble caches crypto at module load.
import './cryptoPolyfill';

import {
  MemoryLocalFirstStore,
  OpLog,
  aeadDecrypt,
  aeadEncrypt,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  createOpId,
  createUnlockMaterial,
  generateDeviceIdentity,
  generateHouseholdKeys,
  hexToBytes,
  minVersionVector,
  openRowBody,
  randomBytes,
  rowAad,
  sealRowBody,
  utf8Decode,
  utf8Encode,
  type CheckpointPlaintext,
  type DeviceIdentity,
  type HouseholdKeys,
  type LocalFirstStore,
  type StoredOperation,
  type VersionVector,
} from '@symply/local-first';

import { defaultHouseholdSpaces, defaultSeasonalChecklists } from './defaults';
import {
  HouseLocalEnrolmentPendingError,
  HouseLocalNotReadyError,
  HouseLocalUnknownPropertyError,
} from './errors';
import { openHouseLocalFirstStore } from './house-local-first-store';
import { clearLocalHousePersistence, loadDbKeyHex, saveDbKeyHex } from './persistence';
import {
  HOUSE_LEDGER_TABLE_KEYS,
  HOUSE_LEDGER_TABLE_NAMES,
  applyLedgerDelta,
  captureLedgerSnapshot,
  chunkLedgerDelta,
  collectRowWrites,
  decodeLedgerOpPayload,
  diffLedger,
  drainParkedRows,
  encodeLedgerOpPayload,
  installRowEnvelopes,
  RESTORE_HLC,
  restoreDeltaFromBackup,
  type LedgerConflict,
  type LedgerDelta,
  type LedgerLww,
  type LedgerTableName,
  type RowEnvelope,
} from './projection';
import { toLedgeredHousehold } from './types';
import type {
  LedgeredHousehold,
  LocalAppliance,
  LocalApplianceDocument,
  LocalApplianceServiceHistory,
  LocalAppointment,
  LocalBcAssessmentData,
  LocalChecklistInstance,
  LocalChecklistItemCompletion,
  LocalChecklistItemPhoto,
  LocalContractor,
  LocalContractorDocument,
  LocalContractorIssueResolution,
  LocalContractorJobRating,
  LocalContractorMessage,
  LocalContractorQuote,
  LocalContractorRepresentative,
  LocalContractorVisit,
  LocalFloorPlan,
  LocalFloorPlanAnnotation,
  LocalFloorPlanMarker,
  LocalGarbageSchedule,
  LocalGardenPlan,
  LocalGardenPlanBoundaryDraft,
  LocalGardenPlanMarker,
  LocalGardenPlanObject,
  LocalHomeFeature,
  LocalHomeProject,
  LocalHomeProjectActivity,
  LocalMaintenanceSuggestion,
  LocalContractorRecommendation,
  LocalUtilityTrend,
  LocalFloorPlanRegion,
  LocalHomeProjectGeometry,
  LocalAssistantBriefing,
  LocalAssistantOutboundLog,
  LocalAssistantTrustLedger,
  LocalAssistantIdentity,
  LocalAihousekeeperAttachment,
  LocalAuditLog,
  LocalNeighbour,
  LocalNeighbourPerson,
  LocalNeighbourhood,
  LocalHomeProjectAttachment,
  LocalHomeProjectBlocker,
  LocalHomeProjectBudgetLine,
  LocalHomeProjectComment,
  LocalHomeProjectMilestone,
  LocalHomeProjectPhase,
  LocalHomeProjectPlanLink,
  LocalHomeProjectSelection,
  LocalHomeProjectOptionGroup,
  LocalHousehold,
  LocalHouseholdMember,
  LocalHouseholdNote,
  LocalHouseholdSpace,
  LocalMaintenanceCompletion,
  LocalMaintenanceSubtask,
  LocalProject,
  LocalProjectMilestone,
  LocalProjectPayment,
  LocalProjectProgressPhoto,
  LocalPropertyTax,
  LocalQuote,
  LocalQuoteRequest,
  LocalRecurringChecklist,
  LocalRecurringChecklistItem,
  LocalRecurringReminder,
  LocalSeasonalChecklist,
  LocalSeasonalChecklistItem,
  LocalSetting,
  LocalTask,
  LocalTaskDraft,
  LocalTaskNote,
  LocalUtilityAccount,
  LocalUtilityBill,
  LocalUtilityReminder,
  LocalVisitChecklist,
  LocalVisitChecklistItem,
  LocalVisitNote,
} from './types';

export type * from './types';

/**
 * The House ledger — 63 device-authoritative tables for ONE property, which is
 * the whole registry: since C4 there is no staged table left, and since the
 * 2026-08-15 `applianceDocuments` correction there is no unclassified House
 * domain table left either (`schema.ts`).
 *
 * Structurally this mirrors `LocalBudgetLedger`; the differences that matter
 * are documented at each site. `household` is the control-plane binding (which
 * property this ledger IS), while `households` is the ledgered domain row that
 * carries address / unit system / photo / purchase price — those must not live
 * on the control plane, which is metadata-only (plan §1.5 hazard S5).
 *
 * H5 turns the module-level singleton below into a per-property map; the store
 * is already keyed `(household_id, tbl, row_key)`, so nothing here has to move.
 */
export interface HouseLedger {
  version: 1;
  /** Control-plane binding for this ledger — which property it addresses. */
  household: LocalHousehold;
  memberId: string;
  deviceId: string;
  // ---- Wave A, 21 tables (plan §1.2) + 1 correction ----
  households: LedgeredHousehold[];
  householdMembers: LocalHouseholdMember[];
  householdSpaces: LocalHouseholdSpace[];
  tasks: LocalTask[];
  maintenanceCompletions: LocalMaintenanceCompletion[];
  maintenanceSubtasks: LocalMaintenanceSubtask[];
  maintenanceTaskNotes: LocalTaskNote[];
  homeFeatures: LocalHomeFeature[];
  appliances: LocalAppliance[];
  applianceServiceHistory: LocalApplianceServiceHistory[];
  // The 2026-08-15 registry correction (`schema.ts`), which is why this line
  // sits inside the Wave A block and takes it to 22 rather than opening a block
  // of its own: `appliance_documents` belonged to no wave, so there is no
  // crossing to record — only an omission to close. Metadata only; the bytes are
  // in the H6 blob channel, keyed by the descriptor on `blob`.
  applianceDocuments: LocalApplianceDocument[];
  garbageSchedules: LocalGarbageSchedule[];
  seasonalChecklists: LocalSeasonalChecklist[];
  seasonalChecklistItems: LocalSeasonalChecklistItem[];
  recurringChecklists: LocalRecurringChecklist[];
  recurringChecklistItems: LocalRecurringChecklistItem[];
  checklistInstances: LocalChecklistInstance[];
  checklistItemCompletions: LocalChecklistItemCompletion[];
  householdNotes: LocalHouseholdNote[];
  settings: LocalSetting[];
  recurringReminders: LocalRecurringReminder[];
  taskDrafts: LocalTaskDraft[];
  // ---- H11 sub-wave B1, the contractor record (plan §11) ----
  // Promoted out of Wave B; `localContractorsApi.ts` is the facade that reads
  // and writes them. `contractorDocuments` holds metadata only — the bytes live
  // in the H6 blob channel, keyed by `file_key`.
  contractors: LocalContractor[];
  contractorVisits: LocalContractorVisit[];
  contractorRepresentatives: LocalContractorRepresentative[];
  contractorDocuments: LocalContractorDocument[];
  // ---- H11 sub-wave B2, quoting (plan §11) ----
  // `localAppointmentsApi.ts` owns the first, `localQuotesApi.ts` the second.
  // `contractorQuotes` and `quoteRequests` are the TASK-scoped pair: they are
  // ledgered so a quote a member already holds converges instead of duplicating,
  // but nothing on device can create one — a quote arrives from a third party
  // through a server, which is why `tasksApi`'s quote methods still throw.
  appointments: LocalAppointment[];
  quotes: LocalQuote[];
  contractorQuotes: LocalContractorQuote[];
  quoteRequests: LocalQuoteRequest[];
  // ---- H11 sub-wave B3, the project (plan §11) ----
  // `localProjectsApi.ts` owns all four. This is the first family on the ledger
  // where three tables have a parent inside the SAME sub-wave: D1 cascades
  // milestones, payments and photos from `projects`, and a ledger delete is a
  // tombstone rather than a foreign key, so that cascade has to be performed by
  // hand — in ONE op, so a peer applies the whole removal or none of it.
  projects: LocalProject[];
  projectMilestones: LocalProjectMilestone[];
  projectPayments: LocalProjectPayment[];
  projectProgressPhotos: LocalProjectProgressPhoto[];
  // ---- H11 sub-wave B4, the on-site surface (plan §11) ----
  // The block that COMPLETES Wave B. `localVisitChecklistsApi.ts` owns the first
  // three-table family, `localMessagesApi.ts` owns `contractorMessages` and
  // `localRatingsApi.ts` owns `contractorJobRatings`.
  //
  // `visitNotes` and `contractorIssueResolutions` are on the ledger with NO
  // facade, which is a first. Neither has a client api module to mirror
  // (`visit_notes` has a backend router and no client; the other has neither),
  // so there is no method to make local — but both cascade from tables that are
  // already live and hard-deleted server-side, and a table the registry does not
  // know about cannot be cascaded. They are here so `deleteVisit` and
  // `delete` can reach them, and so rows written before the household went
  // local-first converge rather than being dropped.
  //
  // `visitChecklists` → `visitChecklistItems` → `checklistItemPhotos` is the
  // first two-hop cascade chain wholly inside one facade; `contractorVisits` →
  // `contractorJobRatings` / `visitNotes` is the first transitive chain hanging
  // off a table that went live three sub-waves ago.
  visitChecklists: LocalVisitChecklist[];
  visitChecklistItems: LocalVisitChecklistItem[];
  visitNotes: LocalVisitNote[];
  checklistItemPhotos: LocalChecklistItemPhoto[];
  contractorMessages: LocalContractorMessage[];
  contractorJobRatings: LocalContractorJobRating[];
  contractorIssueResolutions: LocalContractorIssueResolution[];
  // ---- H11 sub-wave C1, utilities (plan §11) ----
  // The first block of Wave C, all five owned by `localUtilitiesApi.ts`. What
  // the home costs to run: the account with each provider, every bill against
  // it, and the two annual records that arrive on paper once a year.
  //
  // `utilityBills` is the one hard-delete parent in the whole of Wave C — a
  // pre-audit (plan §11.1.2) established that every other Wave-C parent either
  // soft-deletes or has no delete at all — and `utilityReminders.bill_id`
  // cascades from it in D1. Both are C1 tables, so unlike B4's chains this
  // cascade is entirely internal to one facade, and `deleteBill` performs it in
  // ONE op.
  //
  // `utilityReminders` is on the ledger with no facade METHOD of its own, which
  // is the position `visitNotes` and `contractorIssueResolutions` hold after B4.
  // Nothing reads it (there is no reminder method on `utilitiesApi` at all) and
  // nothing local writes it — H4's own scheduler reads the bill's `due_date`
  // directly. It is here so rows the server wrote before the household went
  // local-first converge, and so the cascade can reach them: an unregistered
  // table cannot be cascaded, and those rows would then outlive their bill on
  // every peer forever.
  utilityAccounts: LocalUtilityAccount[];
  utilityBills: LocalUtilityBill[];
  propertyTaxes: LocalPropertyTax[];
  bcAssessmentData: LocalBcAssessmentData[];
  utilityReminders: LocalUtilityReminder[];
  // ---- H11 sub-wave C2, floor plans (plan §11) ----
  // The second block of Wave C, all three owned by `localFloorPlansApi.ts`. The
  // drawing of the home, the pins that tie a task to a place on it, and the
  // freehand lines and measurements drawn over the top.
  //
  // `floorPlans` is the first ledger parent whose D1 cascade is REAL and DEAD at
  // the same time: `floor_plan_markers.floor_plan_id` and
  // `floor_plan_annotations.floor_plan_id` are both `onDelete: 'cascade'`, and
  // `floor-plan-service.ts:334` soft-deletes, so the cascade never fires
  // server-side. On the ledger there is no `deleted_at` to set, so a delete IS a
  // removal and the children would be orphans forever — which is why the facade
  // drops them in the SAME op. `localAppliancesApi.delete` made the identical
  // call in Wave A, and for the identical reason.
  //
  // The fourth table in `schema-floor-plans.ts` is `floor_plan_regions` and it
  // is Tier D. It is not here, it must not be added, and `registryGuard`
  // enforces that over the whole 63-table registry rather than over this block.
  floorPlans: LocalFloorPlan[];
  floorPlanMarkers: LocalFloorPlanMarker[];
  floorPlanAnnotations: LocalFloorPlanAnnotation[];
  // ---- H11 sub-wave C3, garden plans (plan §11) ----
  // The third block of Wave C, all four owned by `localGardenPlansApi.ts`. The
  // picture of the yard, the vector objects arranged over it, the pins that tie
  // a task to a spot in it, and the lot-boundary drafts the retired satellite
  // flow used to produce.
  //
  // `gardenPlans` is the SECOND ledger parent whose D1 cascade is real and dead
  // at the same time, and it is the same shape `floorPlans` has:
  // `garden_plan_objects.garden_plan_id` and `garden_plan_markers.garden_plan_id`
  // are both `onDelete: 'cascade'`, and `garden-plan-service.ts:229`
  // soft-deletes, so the cascade never fires server-side. On the ledger there is
  // no `deleted_at` to set, so a delete IS a removal and the children would be
  // orphans forever — which is why the facade drops them in the SAME op.
  //
  // `gardenPlanBoundaryDrafts` is the odd one out twice over. It is the only C3
  // table the server HARD-deletes, and it is a leaf, so that delete cascades
  // nothing. And it is the only PER-MEMBER row in this whole interface:
  // `listPendingDrafts` filters on `user_id`, so a draft belongs to the member
  // who started it. Every read of it in the facade carries that filter.
  gardenPlans: LocalGardenPlan[];
  gardenPlanObjects: LocalGardenPlanObject[];
  gardenPlanMarkers: LocalGardenPlanMarker[];
  gardenPlanBoundaryDrafts: LocalGardenPlanBoundaryDraft[];
  // ---- H11 sub-wave C4, home projects (plan §11) ----
  // The fourth block of Wave C, all ten owned by `localHomeProjectsApi.ts`, and
  // the block that COMPLETES this interface: with C4 live there is no staged
  // table left in the registry.
  //
  // NOT `projects` — that is B3's labor-hub contractor job, forty lines above.
  // These are the renovation planner's tables and every name here starts
  // `homeProject` for exactly that reason.
  //
  // `homeProjects` is cascaded from by THIRTEEN tables in D1, more than any
  // other row in the ledger — and it is the one parent in the registry with no
  // delete of any kind. There is no delete route, no service method and no
  // client api method; `archive` sets `status` and the row stays. So the cascade
  // cannot fire server-side, the facade exposes no delete to tombstone it
  // locally, and the obligation §11.1.1 exists to catch is genuinely nil here.
  // `HOME_PROJECT_CHILD_TABLES` names the nine ledgered children anyway, so the
  // day a delete is added the list is already derived and already guarded.
  //
  // Four of the file's fourteen tables are absent and must stay absent:
  // `home_project_geometry` is Tier D (C4's twin of C2's `floor_plan_regions`),
  // and `home_project_spaces`, `home_project_tasks` and
  // `home_project_contractors` are hazard S2 — no primary key at all. That last
  // exclusion is the only one in H11 that costs a member a visible feature: a
  // project cannot record which rooms, tasks or contractors it involves, which
  // is why the three methods that reach those joins are throws rather than
  // quietly empty reads.
  homeProjects: LocalHomeProject[];
  homeProjectBudgetLines: LocalHomeProjectBudgetLine[];
  homeProjectSelections: LocalHomeProjectSelection[];
  homeProjectOptionGroups: LocalHomeProjectOptionGroup[];
  homeProjectPhases: LocalHomeProjectPhase[];
  homeProjectMilestones: LocalHomeProjectMilestone[];
  homeProjectBlockers: LocalHomeProjectBlocker[];
  homeProjectAttachments: LocalHomeProjectAttachment[];
  homeProjectPlanLinks: LocalHomeProjectPlanLink[];
  homeProjectComments: LocalHomeProjectComment[];
  homeProjectActivity: LocalHomeProjectActivity[];
  // H13 D-wave — see the block in `schema.ts`. Two of these five are scoped by
  // a parent id rather than `household_id`, which changes nothing here (the
  // ledger is already per-property) but does put a cascade obligation on the
  // parent's delete.
  maintenanceSuggestions: LocalMaintenanceSuggestion[];
  contractorRecommendations: LocalContractorRecommendation[];
  utilityTrends: LocalUtilityTrend[];
  floorPlanRegions: LocalFloorPlanRegion[];
  homeProjectGeometry: LocalHomeProjectGeometry[];
  // H13 B-wave.
  assistantBriefings: LocalAssistantBriefing[];
  assistantOutboundLog: LocalAssistantOutboundLog[];
  assistantTrustLedger: LocalAssistantTrustLedger[];
  assistantIdentity: LocalAssistantIdentity[];
  aihousekeeperAttachments: LocalAihousekeeperAttachment[];
  auditLog: LocalAuditLog[];
  // ---- Neighbours (migration 0165) ----
  // The homes around this property and the people in them, all three owned by
  // `localNeighboursApi.ts`.
  //
  // `neighbours` is a hard-delete parent whose D1 cascade is real AND fires —
  // unusual in this interface, where most parents soft-delete and the cascade is
  // dead server-side. It changes nothing about the local obligation: the ledger
  // has no foreign keys, so `remove` drops the occupants in the SAME op, and a
  // peer applies the whole removal or none of it.
  //
  // `neighbourhoods` is the opposite shape and the more interesting one. D1
  // declares `ON DELETE SET NULL` on `neighbours.neighbourhood_id`, so deleting
  // an area must UNFILE its homes rather than remove them — the facade performs
  // that re-parenting by hand, in the same op as the delete, because a ledger
  // cannot express `SET NULL` either.
  neighbourhoods: LocalNeighbourhood[];
  neighbours: LocalNeighbour[];
  neighbourPeople: LocalNeighbourPerson[];
  ops: StoredOperation[];
  /** Per-row/field merge watermarks for multi-member LWW (TRD §8.4). */
  lww?: LedgerLww;
  /** Auto-merges that discarded a member's intent, for the UI (BR-044). */
  conflicts?: LedgerConflict[];
  /** Set between claiming an invite and receiving the household data key. */
  pendingEnrolment?: boolean;
  /** Persisted crypto material (required for multi-device sync). */
  crypto?: {
    signingPrivateKeyHex: string;
    signingPublicKeyHex: string;
    agreementPrivateKeyHex: string;
    agreementPublicKeyHex: string;
    hdkHex: string;
    keyEpoch: number;
    /**
     * Retired household keys, `epoch → hdk` hex (H6 §8.2).
     *
     * A device revoke rotates by minting a WHOLE NEW random HDK
     * (`generateHouseholdKeys(id, nextEpoch)`) and, before this existed, simply
     * discarded the old one. That is harmless for everything that predates H6 —
     * rows are sealed under the device-local DEK, ops are transient behind a
     * 14-day mailbox TTL, and the owner republishes checkpoints under the new
     * epoch — but **attachments are the first durable HDK-sealed data in the
     * system**, so every blob uploaded before a rotation became permanently
     * unreadable the moment any member's device was revoked.
     *
     * Retaining the old key is what makes those blobs readable again. It does
     * NOT weaken the revoke: the revoked device never receives this keyring, and
     * the ops/checkpoints it could still open with its stale copy are the same
     * ones it already held. Absent on sessions written before this landed, which
     * is why every read is `?? {}`.
     */
    retiredHdksByEpoch?: Record<string, string>;
  };
}

/** Every live table, empty. One place to add a table, not forty. */
export function emptyHouseTables(): Pick<HouseLedger, LedgerTableName> {
  return {
    households: [],
    householdMembers: [],
    householdSpaces: [],
    tasks: [],
    maintenanceCompletions: [],
    maintenanceSubtasks: [],
    maintenanceTaskNotes: [],
    homeFeatures: [],
    appliances: [],
    applianceServiceHistory: [],
    applianceDocuments: [],
    garbageSchedules: [],
    seasonalChecklists: [],
    seasonalChecklistItems: [],
    recurringChecklists: [],
    recurringChecklistItems: [],
    checklistInstances: [],
    checklistItemCompletions: [],
    householdNotes: [],
    settings: [],
    recurringReminders: [],
    taskDrafts: [],
    contractors: [],
    contractorVisits: [],
    contractorRepresentatives: [],
    contractorDocuments: [],
    appointments: [],
    quotes: [],
    contractorQuotes: [],
    quoteRequests: [],
    projects: [],
    projectMilestones: [],
    projectPayments: [],
    projectProgressPhotos: [],
    visitChecklists: [],
    visitChecklistItems: [],
    visitNotes: [],
    checklistItemPhotos: [],
    contractorMessages: [],
    contractorJobRatings: [],
    contractorIssueResolutions: [],
    utilityAccounts: [],
    utilityBills: [],
    propertyTaxes: [],
    bcAssessmentData: [],
    utilityReminders: [],
    floorPlans: [],
    floorPlanMarkers: [],
    floorPlanAnnotations: [],
    gardenPlans: [],
    gardenPlanObjects: [],
    gardenPlanMarkers: [],
    gardenPlanBoundaryDrafts: [],
    homeProjects: [],
    homeProjectBudgetLines: [],
    homeProjectSelections: [],
    homeProjectOptionGroups: [],
    homeProjectPhases: [],
    homeProjectMilestones: [],
    homeProjectBlockers: [],
    homeProjectAttachments: [],
    homeProjectPlanLinks: [],
    homeProjectComments: [],
    homeProjectActivity: [],
    maintenanceSuggestions: [],
    contractorRecommendations: [],
    utilityTrends: [],
    floorPlanRegions: [],
    homeProjectGeometry: [],
    assistantBriefings: [],
    assistantOutboundLog: [],
    assistantTrustLedger: [],
    assistantIdentity: [],
    aihousekeeperAttachments: [],
    auditLog: [],
    neighbourhoods: [],
    neighbours: [],
    neighbourPeople: [],
  };
}

/**
 * Backfill every table a persisted snapshot may predate.
 *
 * Wave B and Wave C add tables to this ledger later; a device that opens a
 * Wave-A snapshot on a Wave-B build must not find `undefined` where the
 * projection expects an array (`rowsOf` tolerates it, but every call site would
 * have to). Sub-wave B1 is the first time that path carried real traffic: every
 * device that had a session before B1 shipped opens a snapshot with no
 * `contractors` key at all.
 */
function normalizeLedger(ledger: HouseLedger): HouseLedger {
  const empty = emptyHouseTables();
  const tables = {} as Pick<HouseLedger, LedgerTableName>;
  for (const table of Object.keys(empty) as LedgerTableName[]) {
    const current = ledger[table];
    (tables as Record<string, unknown>)[table] = Array.isArray(current) ? current : [];
  }
  return {
    ...ledger,
    ...tables,
    lww: ledger.lww ?? {},
    conflicts: ledger.conflicts ?? [],
    pendingEnrolment: ledger.pendingEnrolment ?? false,
  };
}

/**
 * One open property. H5 turned the single module-level `engine` into a map of
 * these — see `HouseLocalSessionManager` below.
 *
 * `dbKey`, `store` and `identity` are DEVICE-scoped and shared by every
 * session: one SQLite file, one DEK, one device keypair. `householdKeys` (the
 * HDK), the OpLog and the ledger are PROPERTY-scoped, because each property is
 * its own membership with its own key epoch — a user can be owner of one and a
 * member of another.
 */
type EngineState = {
  householdId: string;
  dbKey: Uint8Array;
  store: LocalFirstStore;
  identity: DeviceIdentity;
  householdKeys: HouseholdKeys;
  /**
   * Retired HDKs for THIS property, `epoch → key` (H6 §8.2). Property-scoped
   * like `householdKeys` itself — each property rotates on its own schedule.
   */
  retiredHouseholdKeys: Map<number, Uint8Array>;
  opLog: OpLog;
  ledger: HouseLedger;
  /**
   * False until this property's rows have been decrypted into memory. Lazy
   * hydration is the whole point of H5's §3 rule: H10 measured cold open at
   * 34–37 µs/row (1.03 s at ten years on V8, 1.5–15 s on Hermes), so a
   * three-property user must not pay it three times to open the app.
   */
  hydrated: boolean;
  /** Set between claiming an invite and receiving this property's HDK. */
  awaitingKeys: boolean;
  /** Remote deltas merged but not yet persisted, for THIS property. */
  pendingRemoteDeltas: LedgerDelta[];
};

/**
 * The session registry (plan §7).
 *
 * `lf_rows` is `WITHOUT ROWID` with PK `(household_id, tbl, row_key)` and every
 * store call is household-scoped, so nothing in `@symply/local-first` had to
 * change for this — the household was always a column, not a database.
 */
const sessions = new Map<string, EngineState>();
let activeHouseholdId: string | null = null;

/**
 * This device's store and keypair with NO household attached.
 *
 * The state a brand-new account is in between signing up and getting its first
 * home. Sign-up no longer mints one (see `decideWhatAnEmptyDeviceMayDo` — an
 * account that owns nothing gets a home when a person asks for one, not
 * because they registered), and joining somebody else's home is one of the two
 * ways to ask.
 *
 * That is what this exists for: claiming an invite has to present a device
 * keypair BEFORE there is any household to hang it on — the claim carries the
 * public keys the owner's SAS is derived from, and the adopt that follows must
 * reuse the very same keypair or the key gets wrapped to a device that no
 * longer exists. One device, one identity, established before the household
 * rather than by it.
 *
 * Never a substitute for a session: `isLocalHouseSessionOpen()` stays false
 * while this is all there is, because there is still no property to read or
 * write. It holds the shared SQLite handle, so the session open path closes it
 * rather than opening a second handle on the same file.
 */
type PendingDeviceState = {
  store: LocalFirstStore;
  dbKey: Uint8Array;
  identity: DeviceIdentity;
  deviceId: string;
  memberId: string;
};

let pendingDevice: PendingDeviceState | null = null;

/**
 * Bumped whenever a *remote* op changes the projections, so React Query caches
 * (which read `getLocalHouseLedger()` synchronously and would otherwise keep
 * serving a stale snapshot until their own staleTime elapsed) can be
 * invalidated the moment a peer's change lands.
 */
let ledgerRevision = 0;

/**
 * Listeners receive WHICH TABLES moved, not just that something did.
 *
 * Budget's bridge fires a blanket `queryClient.invalidateQueries()` on every
 * bump, which is fine there — few query keys, and its screens are Zustand +
 * `dataRevision`. House holds ~15 active query keys and several of them are
 * Tier B server data (chat, AI Housekeeper, reports, weather) that a LOCAL
 * write has no business refetching. A blanket invalidate would turn every sync
 * into a burst of requests against exactly the endpoints local-first exists to
 * stop calling. So the table list travels with the notification and
 * `sync/ledgerRefresh.ts` maps it to a bounded key set (plan §5.2).
 *
 * An empty array means "something changed but not a table" — a conflict list
 * cleared, an enrolment completed — and subscribers should treat it as a
 * session-level bump, not a data invalidation.
 */
export type HouseLedgerChange = {
  revision: number;
  tables: readonly LedgerTableName[];
  /**
   * Which property moved. A background property syncing must not repaint the
   * screen the member is looking at, so subscribers compare this against the
   * active id before invalidating anything.
   */
  householdId: string | null;
};

const ledgerListeners = new Set<(change: HouseLedgerChange) => void>();

export function getHouseLedgerRevision(): number {
  return ledgerRevision;
}

export function subscribeToHouseLedgerChanges(
  listener: (change: HouseLedgerChange) => void,
): () => void {
  ledgerListeners.add(listener);
  return () => {
    ledgerListeners.delete(listener);
  };
}

/** Tables a delta actually touched — upserts and tombstones alike. */
function tablesInDelta(delta: LedgerDelta): LedgerTableName[] {
  const touched = new Set<LedgerTableName>();
  for (const table of Object.keys(delta.u ?? {}) as LedgerTableName[]) touched.add(table);
  for (const table of Object.keys(delta.d ?? {}) as LedgerTableName[]) touched.add(table);
  return [...touched];
}

/**
 * Notifications held back while a batch of incoming work lands.
 *
 * A sync run merges ops ONE AT A TIME — `projectionFor().apply` fires per op —
 * and every one of them used to reach the screen: `ledgerRefresh` maps the
 * moved tables to query keys and invalidates them per event, so a member
 * receiving a home's history repainted every House surface hundreds of times in
 * a row. That is the flicker: not a rendering bug, a notification storm, and the
 * only fix that removes it rather than smoothing it over is to stop emitting the
 * intermediate states at all.
 *
 * Scoped PER PROPERTY, not globally, and that is not a detail. The fan-out syncs
 * every property CONCURRENTLY, so a single global gate would hold the foreground
 * home's repaint until the slowest background home — one the member cannot see
 * and may not have opened in weeks — finished its round. A property's batch
 * covers only its own notifications, which is also the grouping `ledgerRefresh`
 * needs: it filters on `householdId`, and merging two properties into one event
 * would repaint the foreground off a background sync.
 *
 * Depth-counted rather than boolean, because the apply region nests: a
 * checkpoint install sits inside a sync run, and a boolean would let the inner
 * one flush the outer.
 *
 * `ledgerRevision` does not move while a batch is open, deliberately: it is the
 * `useSyncExternalStore` snapshot, so a revision that moved without a delivered
 * event would let React re-read a half-merged ledger.
 */
const ledgerBatchDepth = new Map<string | null, number>();
const batchedLedgerTables = new Map<string | null, Set<LedgerTableName>>();

/** Open a batch for one property. ALWAYS pair with `endLedgerBatch`. */
export function beginLedgerBatch(householdId: string | null): void {
  ledgerBatchDepth.set(householdId, (ledgerBatchDepth.get(householdId) ?? 0) + 1);
}

/** Close a batch, emitting one coalesced event if that property moved. */
export function endLedgerBatch(householdId: string | null): void {
  const depth = ledgerBatchDepth.get(householdId) ?? 0;
  if (depth === 0) return;
  if (depth > 1) {
    ledgerBatchDepth.set(householdId, depth - 1);
    return;
  }
  ledgerBatchDepth.delete(householdId);
  const held = batchedLedgerTables.get(householdId);
  if (!held) return;
  batchedLedgerTables.delete(householdId);
  dispatchLedgerChange([...held], householdId);
}

/**
 * Run `work` with this property's ledger notifications coalesced into one event
 * at the end.
 *
 * The `finally` is the whole point: a sync that throws mid-merge must not leave
 * the batch open, or every subsequent change to that property is swallowed and
 * its screens freeze on stale data with nothing in the log to say why.
 */
export async function withLedgerBatch<T>(
  householdId: string | null,
  work: () => Promise<T>,
): Promise<T> {
  beginLedgerBatch(householdId);
  try {
    return await work();
  } finally {
    endLedgerBatch(householdId);
  }
}

function dispatchLedgerChange(
  tables: readonly LedgerTableName[],
  householdId: string | null,
): void {
  ledgerRevision += 1;
  const change: HouseLedgerChange = { revision: ledgerRevision, tables, householdId };
  for (const listener of ledgerListeners) {
    try {
      listener(change);
    } catch (error) {
      console.warn('[house.local] ledger listener failed', error);
    }
  }
}

function notifyLedgerChanged(
  tables: readonly LedgerTableName[] = [],
  // Default expression, evaluated per call: it must read the live active id, not
  // whatever was active when the module loaded.
  householdId: string | null = activeHouseholdId,
): void {
  if ((ledgerBatchDepth.get(householdId) ?? 0) > 0) {
    let held = batchedLedgerTables.get(householdId);
    if (!held) {
      held = new Set<LedgerTableName>();
      batchedLedgerTables.set(householdId, held);
    }
    // An empty `tables` is a session-level bump and stays one: the entry exists,
    // so the property still gets its single event at the end of the batch.
    for (const table of tables) held.add(table);
    return;
  }
  dispatchLedgerChange(tables, householdId);
}

/**
 * Projection handler wired into a property's OpLog so *every* verified op —
 * local echo and peer alike — merges into THAT property's ledger under LWW.
 *
 * Bound per household rather than shared: each session owns an OpLog, and a
 * single shared handler reading a module-level `engine` would merge a
 * background property's incoming ops into whichever ledger happened to be
 * active. That is the exact cross-household row bleed H5 exists to prevent, and
 * it would be invisible until two properties diverged.
 */
function projectionFor(householdId: string) {
  return {
    async apply(args: {
      opId: string;
      opType: string;
      entityType: string;
      entityId: string;
      plaintextPayload: Uint8Array;
      authorMemberId: string;
      hlc: string;
    }): Promise<void> {
      const session = sessions.get(householdId);
      if (!session) return;
      let delta;
      try {
        delta = decodeLedgerOpPayload(JSON.parse(utf8Decode(args.plaintextPayload)));
      } catch {
        console.warn('[house.local] unparsable op payload', args.opId, args.opType);
        return;
      }
      if (!delta) return;

      const isLocalEcho = args.authorMemberId === session.ledger.memberId;
      const result = applyLedgerDelta(session.ledger, delta, {
        hlc: args.hlc,
        authorMemberId: args.authorMemberId,
        opId: args.opId,
      });
      if (!isLocalEcho) {
        session.pendingRemoteDeltas.push(delta);
        if (result.applied > 0 || result.deleted > 0) {
          reportRemoteRows(householdId, result.applied + result.deleted);
          notifyLedgerChanged(tablesInDelta(delta), householdId);
        }
      }
    },
  };
}

function requireEngine(): EngineState {
  const session = activeHouseholdId ? sessions.get(activeHouseholdId) : null;
  if (!session) {
    throw new HouseLocalNotReadyError();
  }
  return session;
}

/** The session for one property, whether or not it is the active one. */
function requireSession(householdId: string): EngineState {
  const session = sessions.get(householdId);
  if (!session) {
    throw new HouseLocalUnknownPropertyError(householdId);
  }
  return session;
}

export function isLocalHouseSessionOpen(): boolean {
  return activeHouseholdId !== null && sessions.has(activeHouseholdId);
}

export function getLocalHouseLedger(): HouseLedger {
  return requireEngine().ledger;
}

export function getLocalHouseMemberId(): string {
  return requireEngine().ledger.memberId;
}

/**
 * This device's keypair — from the open session, or from the household-less
 * device state when there is no session yet.
 *
 * The fallback is what lets an account with no home at all claim an invite.
 * There is exactly one device identity either way: `openHouseDeviceForEnrolment`
 * generates it once and `adoptJoinedHousehold` carries that same one into the
 * session it builds, so the keys the owner approves are the keys the wrapped
 * HDK is addressed to.
 */
export function getLocalHouseIdentity(): DeviceIdentity {
  const session = activeHouseholdId ? sessions.get(activeHouseholdId) : null;
  if (session) return session.identity;
  if (pendingDevice) return pendingDevice.identity;
  throw new HouseLocalNotReadyError();
}

/**
 * This device's id, readable before it holds a household.
 *
 * `getLocalHouseLedger().deviceId` is the same value once a session exists, and
 * is what the enrolment calls used to read — but a device with no home has no
 * ledger to read it out of, and that is precisely the device that is claiming.
 */
export function getLocalHouseDeviceId(): string {
  const session = activeHouseholdId ? sessions.get(activeHouseholdId) : null;
  if (session) return session.ledger.deviceId;
  if (pendingDevice) return pendingDevice.deviceId;
  throw new HouseLocalNotReadyError();
}

export function getLocalHouseholdKeys(): HouseholdKeys {
  return requireEngine().householdKeys;
}

export function getLocalHouseOpLog(): OpLog {
  return requireEngine().opLog;
}

export function getLocalHouseStore(): LocalFirstStore {
  return requireEngine().store;
}

/**
 * True between claiming an invite and receiving that property's household data
 * key. While set, this device holds the joined household id but still its own
 * pre-join HDK, so it must not author ops for that property.
 *
 * Per property, not per device: a member can be fully enrolled in one property
 * and still awaiting approval on another, and blocking writes to the first
 * because of the second would be wrong.
 */
export function isAwaitingHouseEnrolment(householdId?: string): boolean {
  const session = householdId
    ? sessions.get(householdId)
    : activeHouseholdId
      ? sessions.get(activeHouseholdId)
      : null;
  return session?.awaitingKeys === true;
}

/** Install the HDK received from an approved peer (enrolment). Rebuilds the OpLog. */
export async function installHouseholdKeys(
  next: HouseholdKeys,
  forHouseholdId?: string,
  /**
   * Older epochs delivered ALONGSIDE the current one, by an enrolment wrap.
   *
   * A joiner has no history of its own to retire, so without these it can open
   * only what the home has written since its last rotation: ops carry their
   * authoring epoch and a checkpoint carries the publisher's, and neither is
   * ever re-sealed. A member admitted to a home that has rotated syncs, acks,
   * and sits on an empty ledger with no error anywhere.
   */
  retired?: Map<number, Uint8Array>,
): Promise<void> {
  const state = forHouseholdId ? requireSession(forHouseholdId) : requireEngine();
  // H6 §8.2 — retire, do not discard. A revoke replaces the HDK wholesale, and
  // attachments sealed under the outgoing key stay on R2 long after it is gone.
  // Only retire a genuinely older epoch: enrolment also lands here (installing
  // the FIRST key, and re-installing the same epoch), and neither is a rotation.
  const previous = state.householdKeys;
  if (previous?.hdk?.length && previous.keyEpoch < next.keyEpoch) {
    state.retiredHouseholdKeys.set(previous.keyEpoch, previous.hdk);
  }
  // Merged, never assigned over: this device's own retired keys are the ones it
  // can still read its own history with, and a wrap that carries fewer of them
  // must not take them away.
  for (const [epoch, hdk] of retired ?? []) {
    if (epoch >= next.keyEpoch) continue;
    state.retiredHouseholdKeys.set(epoch, hdk);
  }
  state.householdKeys = next;
  state.awaitingKeys = false;
  state.ledger.pendingEnrolment = false;
  state.opLog = new OpLog({
    store: state.store,
    identity: state.identity,
    householdKeys: next,
    projection: projectionFor(state.householdId),
  });
  state.ledger.crypto = cryptoBundle(state.identity, next, state.retiredHouseholdKeys);
  await persistSession(state, null);
  // Delivered IMMEDIATELY, past any open batch, and that exception is
  // deliberate. This runs inside the sync run's apply batch, and holding it
  // would keep "Waiting to be let in" on screen for the whole history download —
  // beside a progress card already saying the history is downloading. Two panels
  // contradicting each other is worse than one extra repaint, and the repaint is
  // cheap: nothing has been merged at this point in the run, so the screen it
  // paints is the empty one already showing.
  dispatchLedgerChange([], state.householdId);
}

function cryptoBundle(
  identity: DeviceIdentity,
  householdKeys: HouseholdKeys,
  retired?: Map<number, Uint8Array>,
) {
  const retiredHdksByEpoch: Record<string, string> = {};
  for (const [epoch, hdk] of retired ?? []) {
    retiredHdksByEpoch[String(epoch)] = bytesToHex(hdk);
  }
  return {
    signingPrivateKeyHex: bytesToHex(identity.signingPrivateKey),
    signingPublicKeyHex: bytesToHex(identity.signingPublicKey),
    agreementPrivateKeyHex: bytesToHex(identity.agreementPrivateKey),
    agreementPublicKeyHex: bytesToHex(identity.agreementPublicKey),
    hdkHex: bytesToHex(householdKeys.hdk),
    keyEpoch: householdKeys.keyEpoch,
    ...(Object.keys(retiredHdksByEpoch).length > 0 ? { retiredHdksByEpoch } : {}),
  };
}

/** Rehydrate the retired-key map from a persisted crypto bundle. */
function retiredKeysFromCrypto(
  crypto: NonNullable<HouseLedger['crypto']> | undefined,
): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  for (const [epoch, hex] of Object.entries(crypto?.retiredHdksByEpoch ?? {})) {
    const parsedEpoch = Number(epoch);
    if (Number.isInteger(parsedEpoch) && hex) out.set(parsedEpoch, hexToBytes(hex));
  }
  return out;
}

function identityFromCrypto(
  deviceId: string,
  crypto: NonNullable<HouseLedger['crypto']>,
): DeviceIdentity {
  return {
    deviceId,
    signingPrivateKey: hexToBytes(crypto.signingPrivateKeyHex),
    signingPublicKey: hexToBytes(crypto.signingPublicKeyHex),
    agreementPrivateKey: hexToBytes(crypto.agreementPrivateKeyHex),
    agreementPublicKey: hexToBytes(crypto.agreementPublicKeyHex),
  };
}

/**
 * Per-property identity record. H5 made this a family of keys rather than one
 * blob: `ledger.identity.v2:<householdId>`. The index (`PROPERTIES_META`) is
 * what a cold open enumerates before it decides which property to hydrate.
 *
 * No migration from the single-key layout, deliberately — §1.1 authorizes a
 * wipe and there is no client in the field to read the old shape.
 */
const identityMetaKey = (householdId: string) => `ledger.identity.v2:${householdId}`;
const PROPERTIES_META = 'ledger.properties.v1';
const ACTIVE_META = 'ledger.active_household.v1';
const MEMBER_META = 'ledger.member_id';
const HOUSEHOLD_META = 'ledger.household_id';
const IDENTITY_AAD = utf8Encode('lf-meta:identity');

type PersistedIdentity = {
  household: LocalHousehold;
  memberId: string;
  deviceId: string;
  pendingEnrolment?: boolean;
  conflicts?: LedgerConflict[];
  crypto?: HouseLedger['crypto'];
};

async function persistIdentity(state: EngineState): Promise<void> {
  state.ledger.crypto = cryptoBundle(state.identity, state.householdKeys, state.retiredHouseholdKeys);
  const payload: PersistedIdentity = {
    household: state.ledger.household,
    memberId: state.ledger.memberId,
    deviceId: state.ledger.deviceId,
    pendingEnrolment: state.ledger.pendingEnrolment ?? false,
    conflicts: state.ledger.conflicts ?? [],
    crypto: state.ledger.crypto,
  };
  const sealed = aeadEncrypt(state.dbKey, utf8Encode(JSON.stringify(payload)), IDENTITY_AAD);
  await state.store.setMeta(identityMetaKey(state.householdId), bytesToBase64(sealed));
  await state.store.setMeta(MEMBER_META, state.ledger.memberId);
  // The ACTIVE property, and the index of every property this device holds.
  await state.store.setMeta(HOUSEHOLD_META, state.ledger.household.id);
  await rememberProperty(state.store, state.householdId);
}

/** Append a property to the on-disk index a cold open enumerates. */
async function rememberProperty(store: LocalFirstStore, householdId: string): Promise<void> {
  const known = await listPersistedProperties(store);
  if (known.includes(householdId)) return;
  await store.setMeta(PROPERTIES_META, JSON.stringify([...known, householdId]));
}

async function forgetProperty(store: LocalFirstStore, householdId: string): Promise<void> {
  const known = await listPersistedProperties(store);
  await store.setMeta(PROPERTIES_META, JSON.stringify(known.filter((id) => id !== householdId)));
}

async function listPersistedProperties(store: LocalFirstStore): Promise<string[]> {
  const raw = await store.getMeta(PROPERTIES_META);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function sealWrites(
  state: EngineState,
  writes: ReturnType<typeof collectRowWrites>,
  updatedHlc: string,
) {
  const householdId = state.ledger.household.id;
  const keyEpoch = state.householdKeys.keyEpoch;
  return writes.map((write) => {
    const sealed = sealRowBody(
      state.dbKey,
      utf8Encode(JSON.stringify(write.envelope)),
      rowAad(householdId, write.table, write.rowKey, keyEpoch),
    );
    return {
      householdId,
      table: write.table,
      rowKey: write.rowKey,
      bucket: write.bucket,
      deleted: write.deleted,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
      keyEpoch,
      updatedHlc,
    };
  });
}

async function persistRows(
  state: EngineState,
  delta: LedgerDelta | 'all' | null,
  opIds: readonly string[] = [],
): Promise<void> {
  await persistIdentity(state);
  if (delta) {
    const writes = collectRowWrites(state.ledger, delta);
    const hlc = state.ledger.ops[state.ledger.ops.length - 1]?.hlc ?? String(Date.now());
    await state.store.putRows(sealWrites(state, writes, hlc));
  }
  if (opIds.length > 0) {
    await state.store.markProjected(opIds, Date.now());
  }
}

async function persistSession(
  state: EngineState,
  delta: LedgerDelta | 'all' | null = 'all',
  opIds: readonly string[] = [],
): Promise<void> {
  await state.store.runInTransaction(async () => {
    await persistRows(state, delta, opIds);
  });
}

async function persist(
  delta: LedgerDelta | 'all' | null = 'all',
  opIds: readonly string[] = [],
): Promise<void> {
  await persistSession(requireEngine(), delta, opIds);
}

async function loadIdentity(
  store: LocalFirstStore,
  dbKey: Uint8Array,
  householdId: string,
): Promise<PersistedIdentity | null> {
  const sealedB64 = await store.getMeta(identityMetaKey(householdId));
  if (!sealedB64) return null;
  try {
    const plain = aeadDecrypt(dbKey, base64ToBytes(sealedB64), IDENTITY_AAD);
    return JSON.parse(utf8Decode(plain)) as PersistedIdentity;
  } catch {
    return null;
  }
}

async function loadRowsIntoLedger(
  state: Pick<EngineState, 'dbKey' | 'store' | 'householdKeys' | 'ledger'>,
): Promise<number> {
  const stored = await state.store.listRows({ householdId: state.ledger.household.id });
  const writes: Array<{
    table: LedgerTableName;
    rowKey: string;
    deleted: boolean;
    envelope: RowEnvelope;
  }> = [];
  for (const row of stored) {
    try {
      const plain = openRowBody(
        state.dbKey,
        row.nonce,
        row.ciphertext,
        rowAad(row.householdId, row.table, row.rowKey, row.keyEpoch),
      );
      writes.push({
        table: row.table as LedgerTableName,
        rowKey: row.rowKey,
        deleted: row.deleted,
        envelope: JSON.parse(utf8Decode(plain)) as RowEnvelope,
      });
    } catch {
      console.warn('[HouseLocal] skipping undecryptable row', row.table, row.rowKey);
    }
  }
  installRowEnvelopes(state.ledger, writes);
  return writes.length;
}

async function replayUnprojected(state: EngineState): Promise<void> {
  const pending = await state.store.listUnprojectedOperations(state.ledger.household.id);
  if (pending.length === 0) return;
  for (const op of pending) {
    try {
      const aad = utf8Encode(`${op.householdId}:${op.keyEpoch}:${op.opId}`);
      const plaintext = aeadDecrypt(state.householdKeys.hdk, op.payload, aad);
      const delta = decodeLedgerOpPayload(JSON.parse(utf8Decode(plaintext)));
      if (!delta) continue;
      applyLedgerDelta(state.ledger, delta, {
        hlc: op.hlc,
        authorMemberId: op.authorMemberId,
        opId: op.opId,
      });
    } catch {
      console.warn('[HouseLocal] unprojected op failed to replay', op.opId);
    }
  }
  await persistRows(
    state,
    'all',
    pending.map((op) => op.opId),
  );
}

/**
 * The control-plane binding row. Domain fields start null and are edited
 * through the ledger, never through `lf_households` (plan §1.5 hazard S5).
 */
/**
 * The device's country, or null when we cannot tell.
 *
 * Required lazily, like every other native touch in this file: the engine is
 * exercised in unit tests with no native bind, and `resolveLocaleTaxRegion`
 * already swallows that case. Null is the honest answer for anywhere outside
 * Canada and the US — the address-capture gate then asks, which is better than
 * recording a country the member never chose.
 */
function resolveHouseholdCountryFromLocale(): 'CA' | 'US' | null {
  try {
    const { resolveLocaleTaxRegion } = require('@config/regions') as typeof import('@config/regions');
    const resolved = resolveLocaleTaxRegion();
    if (resolved?.country === 'CA' || resolved?.country === 'US') return resolved.country;
  } catch {
    // No native locale module (tests, headless) — leave it unset.
  }
  return null;
}

function buildHousehold(id: string, name: string): LocalHousehold {
  const now = new Date().toISOString();
  return {
    id,
    name,
    address_line1: null,
    address_line2: null,
    city: null,
    state_province: null,
    postal_code: null,
    // Read the device's region rather than assuming Canada. A hardcoded 'CA'
    // put every US member's home in the wrong country, and invisibly: the
    // province is null either way, so nothing on screen contradicted it — but
    // the property surface resolves its jurisdiction from this pair, so the
    // wrong country silently picks the wrong registry the moment a province
    // arrives. `resolveLocaleTaxRegion` returns only 'CA' or 'US' and null for
    // anything else, so an unknown region stays unset and gets asked for.
    country: resolveHouseholdCountryFromLocale(),
    unit_system: null,
    photo_key: null,
    photo_url: null,
    purchase_price: null,
    purchase_date: null,
    created_at: now,
    updated_at: now,
    member_count: 1,
    my_role: 'owner',
  };
}

/**
 * "This device just authored an op for property X."
 *
 * A CALLBACK rather than a direct call into the sync layer, and that is the
 * whole reason it exists: `sync/orchestrator` imports this module, so the engine
 * cannot import it back. The auto-sync module registers itself at session open
 * and deregisters at teardown, which also means a build that never syncs never
 * pays for this.
 *
 * Fired from `appendLedgerOp`, the single funnel every local write goes through
 * (`mutateLocalHouseLedger`, the bulk paths, restore, property create). Anything
 * registered here MUST return immediately without awaiting: the call happens
 * inside the op-log append, so real work started synchronously would hold a
 * SQLite write transaction open across a network round trip.
 */
type LocalWriteListener = (householdId: string) => void;
let localWriteListener: LocalWriteListener | null = null;

export function setLocalHouseWriteListener(listener: LocalWriteListener | null): void {
  localWriteListener = listener;
}

/**
 * "N records from peers just landed in property X."
 *
 * Same callback shape and the same reason as the write listener: the sync status
 * store lives under `sync/`, which imports this module, so the engine reports
 * outward rather than reaching in.
 *
 * ROWS, not ops. A member watching a sync wants to know how much of their home
 * has arrived, and one op can carry a single renamed room or four hundred rows
 * from a floor-plan import — so an op counter tells them almost nothing. This is
 * fired from both places rows enter a ledger from outside: the per-op projection
 * handler, and the checkpoint install (which is the one that matters on a join,
 * where a single "op" is the property's entire history).
 */
type RemoteApplyListener = (householdId: string, rows: number) => void;
let remoteApplyListener: RemoteApplyListener | null = null;

export function setRemoteApplyListener(listener: RemoteApplyListener | null): void {
  remoteApplyListener = listener;
}

function reportRemoteRows(householdId: string, rows: number): void {
  if (rows <= 0) return;
  try {
    remoteApplyListener?.(householdId, rows);
  } catch (error) {
    // A progress number must never be the reason a merge fails.
    console.warn('[house.local] remote-apply listener threw', error);
  }
}

async function appendLedgerOp(
  state: EngineState,
  opType: string,
  entityType: string,
  entityId: string,
  payload: unknown,
  extra?: { hlc?: string },
): Promise<StoredOperation> {
  const stored = await state.opLog.append({
    opId: createOpId(),
    authorMemberId: state.ledger.memberId,
    parents: [],
    opType,
    entityType,
    entityId,
    plaintextPayload: utf8Encode(JSON.stringify(payload)),
    ...(extra?.hlc ? { hlc: extra.hlc } : {}),
  });
  state.ledger.ops.push(stored);
  try {
    localWriteListener?.(state.householdId);
  } catch (error) {
    // A write that succeeded must never be reported as failed because the thing
    // that schedules its delivery threw. The op is durable either way; the worst
    // case is that it leaves on the next trigger instead of this one.
    console.warn('[house.local] local-write listener failed', error);
  }
  return stored;
}

/**
 * Serializes session open/close. Both callers are floated promises, so a fast
 * sign-out/sign-in can otherwise run teardown and open concurrently and the
 * different-user guard never fires.
 */
let sessionChain: Promise<unknown> = Promise.resolve();

function queueSessionWork<T>(work: () => Promise<T>): Promise<T> {
  const next = sessionChain.then(work, work);
  sessionChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * What a device holding NO ledger is allowed to do — decided by the CALLER.
 *
 * The engine used to decide this for itself, and could only ever decide it one
 * way: nothing on disk meant mint, with a fresh random `hh_local_*` id.
 * `ensureHouseLocalSession` then registered that id at the control plane as an
 * owner-create. On the ordinary reinstall / new-phone / restore case — device
 * empty, account onboarded months ago — that published a second, empty home
 * named after the member (staging collected 17 of them, every one with a null
 * address), and `syncHouseholdStoreFromLocalLedger` then REPLACED the member's
 * real home in "My Properties" with it.
 *
 * The engine cannot make this call, because the fact that settles it — "does
 * this account already own a home?" — lives on the control plane, one network
 * round trip away, and the engine is the layer that must work with no network
 * at all. So the caller decides and the engine executes.
 *
 * NOT a deterministic id: a household has no natural key, so a landlord's three
 * properties must get three ids. The fix is reconciliation, not derivation.
 */
export type HouseEmptyDeviceDecision =
  /** No home anywhere — a genuine first run. Mint, exactly as before. */
  | { allowMint: true }
  /**
   * Do not mint. `adopt` names the homes the account already owns: each gets a
   * session in the pending-enrolment shape a joined home has between claiming
   * an invite and the key arriving, so the member lands on the recovery routes
   * (device sync, recovery phrase) instead of on a new empty home.
   *
   * Empty/omitted `adopt` means the caller could not find out (offline, auth
   * expired). Nothing is minted and nothing is opened — deferring costs a
   * relaunch, minting costs an orphan that is then pushed to the server.
   */
  | { allowMint: false; adopt?: Array<{ householdId: string; displayName?: string | null }> };

/** A session open that is allowed to decline to open one. */
export type HouseSessionOpenResult =
  | { status: 'open'; ledger: HouseLedger }
  /** Nothing on disk, and — deliberately — nothing minted. */
  | { status: 'no-local-ledger' };

/**
 * Open the ledger, minting on an empty device exactly as this has always done.
 *
 * Kept as the no-opinion entry point: every caller that is not the launch
 * bootstrap (tests, `index.ts`) genuinely wants "give me a ledger", and making
 * them all reason about the control plane would be the wrong trade. The launch
 * bootstrap — the one caller whose empty-device case is a reinstall rather than
 * a first run — uses `openLocalHouseSessionWithMintDecision` instead.
 */
export function openLocalHouseSession(input: {
  userId: string;
  displayName?: string | null;
}): Promise<HouseLedger> {
  return queueSessionWork(() =>
    openLocalHouseSessionInner({
      ...input,
      decideEmptyDevice: async (): Promise<HouseEmptyDeviceDecision> => ({ allowMint: true }),
    }),
  ).then((result) => {
    // Unreachable — `allowMint: true` always opens — but typed rather than
    // asserted, because a cast here would hide the day it stops being true.
    if (result.status !== 'open') throw new HouseLocalNotReadyError();
    return result.ledger;
  });
}

/**
 * Open the ledger, asking the caller what an EMPTY device may do.
 *
 * `decideEmptyDevice` is invoked only when the device holds no ledger at all,
 * which is what keeps this off the hot path: a device that already has a home
 * returns from disk having touched no network, and this runs on every sign-in
 * AND every auth rehydrate.
 *
 * The decision is taken INSIDE `queueSessionWork`, so a second bootstrap that
 * arrives while the first is still asking the control plane queues behind it and
 * then finds the session already open — two rehydrates cannot mint two homes.
 * The cost accepted: session work is blocked for the length of one GET, on the
 * one launch in a device's life where there is nothing else to do anyway.
 */
export function openLocalHouseSessionWithMintDecision(input: {
  userId: string;
  displayName?: string | null;
  decideEmptyDevice: () => Promise<HouseEmptyDeviceDecision>;
}): Promise<HouseSessionOpenResult> {
  return queueSessionWork(() => openLocalHouseSessionInner(input));
}

/**
 * Give a device with NO household the keypair an enrolment claim needs.
 *
 * Called by the join path before it claims. A no-op the moment a session is
 * open — a device that holds a home already has its identity, and the one it
 * holds is the one every peer knows it by, so generating another here would be
 * the bug this function exists to avoid.
 *
 * Idempotent per account: a second join attempt reuses the keypair the first
 * one presented, which is what makes retrying a claim safe. A DIFFERENT account
 * discards the previous one — those keys belong to whoever was signed in when
 * they were made.
 *
 * Deliberately does not mint, adopt, or activate anything. It opens no property
 * and publishes nothing, so a claim that fails leaves a device that is still
 * empty rather than one holding a home nobody asked for.
 */
export function openHouseDeviceForEnrolment(input: { userId: string }): Promise<void> {
  return queueSessionWork(async () => {
    if (isLocalHouseSessionOpen()) return;
    if (pendingDevice) {
      if (pendingDevice.memberId === input.userId) return;
      // The previous account's handle on the shared database, and its keys.
      const stale = pendingDevice;
      pendingDevice = null;
      await stale.store.close();
    }

    let dbKeyHex = await loadDbKeyHex();
    if (!dbKeyHex) {
      dbKeyHex = bytesToHex(createUnlockMaterial().localDatabaseKey);
      await saveDbKeyHex(dbKeyHex);
    }
    const dbKey = hexToBytes(dbKeyHex);
    const deviceId = `dev_${bytesToHex(randomBytes(6))}`;
    pendingDevice = {
      store: await openHouseLocalFirstStore(dbKey),
      dbKey,
      identity: generateDeviceIdentity(deviceId),
      deviceId,
      memberId: input.userId,
    };
  });
}

/** Test seam — the household-less device state is process-global, like the sessions. */
export function __resetHousePendingDeviceForTests(): void {
  pendingDevice = null;
}

/**
 * Build a session for one property WITHOUT decrypting its rows.
 *
 * The split from hydration is the point: opening the app enumerates every
 * property the device holds (cheap — one meta read each), but only the active
 * one pays cold open. H10 measured that at 34–37 µs/row, so a three-property
 * user would otherwise wait three times over for data two of which they are not
 * looking at.
 */
async function buildSessionFromDisk(input: {
  store: LocalFirstStore;
  dbKey: Uint8Array;
  householdId: string;
  userId: string;
}): Promise<EngineState | null> {
  const parsed = await loadIdentity(input.store, input.dbKey, input.householdId);
  if (!parsed?.crypto?.hdkHex || !parsed.crypto.signingPrivateKeyHex) return null;

  const deviceId = parsed.deviceId || `dev_${input.userId.slice(0, 8)}`;
  const identity = identityFromCrypto(deviceId, parsed.crypto);
  const householdKeys: HouseholdKeys = {
    householdId: parsed.household.id,
    hdk: hexToBytes(parsed.crypto.hdkHex),
    keyEpoch: parsed.crypto.keyEpoch ?? 1,
  };
  const opLog = new OpLog({
    store: input.store,
    identity,
    householdKeys,
    projection: projectionFor(parsed.household.id),
  });
  const ops = await input.store.listOperationsByHlc(parsed.household.id);
  const ledger: HouseLedger = normalizeLedger({
    version: 1,
    household: parsed.household,
    memberId: parsed.memberId,
    deviceId,
    ...emptyHouseTables(),
    ops,
    lww: {},
    conflicts: parsed.conflicts ?? [],
    pendingEnrolment: parsed.pendingEnrolment ?? false,
    crypto: cryptoBundle(identity, householdKeys),
  });
  return {
    householdId: parsed.household.id,
    dbKey: input.dbKey,
    store: input.store,
    identity,
    householdKeys,
    // Restored from the persisted bundle — a cold open after a rotation must
    // still be able to read attachments sealed under the previous epoch.
    retiredHouseholdKeys: retiredKeysFromCrypto(parsed.crypto),
    opLog,
    ledger,
    hydrated: false,
    awaitingKeys: ledger.pendingEnrolment === true,
    pendingRemoteDeltas: [],
  };
}

/** Decrypt a property's rows into memory, once. Idempotent. */
async function hydrateSession(state: EngineState): Promise<EngineState> {
  if (state.hydrated) return state;
  await loadRowsIntoLedger(state);
  await replayUnprojected(state);
  state.hydrated = true;
  return state;
}

async function openLocalHouseSessionInner(input: {
  userId: string;
  displayName?: string | null;
  decideEmptyDevice: () => Promise<HouseEmptyDeviceDecision>;
}): Promise<HouseSessionOpenResult> {
  const open = activeHouseholdId ? sessions.get(activeHouseholdId) : null;
  if (open) {
    // An open session belongs to ONE account. Returning it without checking who
    // asked would hand the new user the previous user's home.
    if (open.ledger.memberId === input.userId) {
      return { status: 'open', ledger: open.ledger };
    }
    console.log('[HouseLocal] session open for a different user — closing before reopen');
    await closeLocalHouseSessionInner();
  }

  // The enrolment bootstrap may be holding an open handle on the very database
  // this is about to open. Released rather than reused: `openHouseLocalFirstStore`
  // hands out a handle, not a lock, so a second one would leave two connections
  // on one SQLite file and a write landing in whichever the caller happened to
  // reach. The claim it was opened for has already been adopted into a real
  // session by the time this runs, or it failed and there is nothing to keep.
  if (pendingDevice) {
    const stale = pendingDevice;
    pendingDevice = null;
    await stale.store.close();
  }

  let dbKeyHex = await loadDbKeyHex();
  let dbKey: Uint8Array;
  if (dbKeyHex) {
    dbKey = hexToBytes(dbKeyHex);
  } else {
    const material = createUnlockMaterial();
    dbKey = material.localDatabaseKey;
    await saveDbKeyHex(bytesToHex(dbKey));
  }

  let store = await openHouseLocalFirstStore(dbKey);
  const storedMemberId = await store.getMeta(MEMBER_META);
  if (storedMemberId && storedMemberId !== input.userId) {
    console.log('[HouseLocal] different user on this device — resetting local ledger');
    await store.close();
    // The registry too, not just the disk. This used to `return mintNewHousehold`
    // straight away and could not be reached with sessions still in it; it now
    // falls through to the shared empty-device path, where a leftover session
    // would read as "this device holds a ledger" over persistence that was just
    // wiped — the previous account's home, resurrected for the new one.
    sessions.clear();
    activeHouseholdId = null;
    await clearLocalHousePersistence();
    const material = createUnlockMaterial();
    dbKey = material.localDatabaseKey;
    dbKeyHex = bytesToHex(dbKey);
    await saveDbKeyHex(dbKeyHex);
    // Falls THROUGH to the empty-device decision rather than minting here. A
    // device wiped for a different account is empty for exactly the reason a
    // reinstall is, and minting for it publishes exactly the same orphan — the
    // new account may already own a home from another phone.
    store = await openHouseLocalFirstStore(dbKey);
  }

  // Enumerate every property this device holds, cheaply; hydrate only one.
  const known = await listPersistedProperties(store);
  for (const householdId of known) {
    if (sessions.has(householdId)) continue;
    const session = await buildSessionFromDisk({ store, dbKey, householdId, userId: input.userId });
    if (session) sessions.set(householdId, session);
  }

  if (sessions.size === 0) {
    return openEmptyDevice(input, dbKey, store);
  }

  const preferred = (await store.getMeta(ACTIVE_META)) ?? known[0]!;
  const target = sessions.has(preferred) ? preferred : [...sessions.keys()][0]!;
  activeHouseholdId = target;
  await hydrateSession(sessions.get(target)!);
  return { status: 'open', ledger: sessions.get(target)!.ledger };
}

/**
 * The one branch the orphan-household bug lived in: no ledger on this device.
 *
 * "No ledger" is not "no home" — it is the reinstall, the new phone and the
 * restore, and on all three the account's real home is sitting on the control
 * plane. So nothing here decides anything; it executes what the caller decided
 * with that fact in hand.
 */
async function openEmptyDevice(
  input: {
    userId: string;
    displayName?: string | null;
    decideEmptyDevice: () => Promise<HouseEmptyDeviceDecision>;
  },
  dbKey: Uint8Array,
  store: LocalFirstStore,
): Promise<HouseSessionOpenResult> {
  const decision = await input.decideEmptyDevice();

  if (decision.allowMint) {
    return { status: 'open', ledger: await mintNewHousehold(input, dbKey, store) };
  }

  const adopt = decision.adopt ?? [];
  if (adopt.length === 0) {
    // Undecided — offline, or the account's homes could not be listed. The
    // store is closed rather than left dangling: nothing holds it, and every
    // rehydrate would otherwise open another handle on the same database.
    await store.close();
    return { status: 'no-local-ledger' };
  }

  // ONE device identity for every property adopted here, matching a device that
  // grew its properties one at a time (`createLocalHouseProperty` reuses the
  // current identity). A per-property keypair would make each of the member's
  // own homes see the others as different devices.
  const deviceId = `dev_${bytesToHex(randomBytes(6))}`;
  const identity = generateDeviceIdentity(deviceId);
  for (const home of adopt) {
    await adoptHouseholdSession({
      householdId: home.householdId,
      displayName: home.displayName,
      store,
      dbKey,
      identity,
      memberId: input.userId,
      deviceId,
    });
  }

  // Each adopt activates itself (it is written for the join, where the member
  // has just walked into that home); land on the first instead, so a member with
  // three homes opens the same one every launch rather than the last in the list.
  const primary = adopt[0]!.householdId;
  activeHouseholdId = primary;
  await store.setMeta(ACTIVE_META, primary);
  await store.setMeta(HOUSEHOLD_META, primary);
  return { status: 'open', ledger: sessions.get(primary)!.ledger };
}

// ---------------------------------------------------------------------------
// Multi-property session manager (plan §7)
// ---------------------------------------------------------------------------

export type HousePropertySummary = {
  householdId: string;
  /** This device's id — the same for every property; one device, one identity. */
  deviceId: string;
  name: string;
  role: string;
  isActive: boolean;
  /** False until this property's rows have been decrypted into memory. */
  hydrated: boolean;
  awaitingEnrolment: boolean;
};

/** Every property this device holds, active first-class rather than implied. */
export function listLocalHouseProperties(): HousePropertySummary[] {
  return [...sessions.values()].map((session) => ({
    householdId: session.householdId,
    deviceId: session.ledger.deviceId,
    name: String(session.ledger.household.name ?? ''),
    role: String(session.ledger.household.my_role ?? 'member'),
    isActive: session.householdId === activeHouseholdId,
    hydrated: session.hydrated,
    awaitingEnrolment: session.awaitingKeys,
  }));
}

export function getActiveHouseholdId(): string | null {
  return activeHouseholdId;
}

/**
 * A live handle on ONE property's session.
 *
 * Everything sync needs, bound to a household rather than to "whatever is
 * active". The global `getLocalHouse*` accessors read the active session, which
 * is right for the UI and catastrophically wrong for a background sync: it
 * would seal property B's ops under property A's HDK and address them to A's
 * peers. The orchestrator uses this instead, and re-reads it after enrolment
 * because installing an HDK swaps both `householdKeys` and `opLog`.
 */
export type HouseSessionHandle = {
  householdId: string;
  ledger: HouseLedger;
  identity: DeviceIdentity;
  householdKeys: HouseholdKeys;
  /**
   * HDKs this device has held for this property before the current epoch
   * (H6 §8.2). The attachment channel needs them: a blob is sealed under the
   * epoch that was current at upload time, and that key is gone from
   * `householdKeys` the moment anyone is revoked.
   */
  retiredHouseholdKeys: Map<number, Uint8Array>;
  opLog: OpLog;
  store: LocalFirstStore;
  awaitingEnrolment: boolean;
};

/**
 * One property's key material, WITHOUT hydrating its ledger.
 *
 * `getLocalHouseSession` is the general handle, and it hydrates — it loads and
 * decrypts every row so the caller can read `ledger`. A caller that only needs
 * the HDK (sealing an AI key share for this property, say) would pay a full
 * ledger decrypt per property to read a key that has been in memory since the
 * session opened. The keys are on the raw session, so serve them from there.
 *
 * Returns null for a property this device does not hold, rather than throwing:
 * every caller so far is enumerating and "no keys here" is an ordinary answer.
 * `null` keys also cover a claimed-but-not-yet-enrolled property, where the
 * placeholder HDK would seal junk.
 */
export function getLocalHouseHouseholdKeys(
  householdId: string,
): { householdKeys: HouseholdKeys; retiredHouseholdKeys: Map<number, Uint8Array> } | null {
  const session = sessions.get(householdId);
  if (!session || session.awaitingKeys) return null;
  return {
    householdKeys: session.householdKeys,
    retiredHouseholdKeys: session.retiredHouseholdKeys,
  };
}

export async function getLocalHouseSession(householdId: string): Promise<HouseSessionHandle> {
  const session = await hydrateSession(requireSession(householdId));
  return {
    householdId: session.householdId,
    ledger: session.ledger,
    identity: session.identity,
    householdKeys: session.householdKeys,
    retiredHouseholdKeys: session.retiredHouseholdKeys,
    opLog: session.opLog,
    store: session.store,
    awaitingEnrolment: session.awaitingKeys,
  };
}

/** Conflicts for one property. */
export function getLocalHouseConflictsFor(householdId: string): LedgerConflict[] {
  return requireSession(householdId).ledger.conflicts ?? [];
}

/** The ledger for a property, whether or not it is active. Hydrates on demand. */
export async function getLocalHouseLedgerFor(householdId: string): Promise<HouseLedger> {
  const session = await hydrateSession(requireSession(householdId));
  return session.ledger;
}

/**
 * Make a property the active one, hydrating it if this is its first activation.
 *
 * Cheap on re-activation: a hydrated session keeps its rows, so switching back
 * and forth costs nothing after the first visit to each property.
 */
export function createLocalHouseProperty(input: {
  displayName?: string | null;
}): Promise<HouseLedger> {
  return queueSessionWork(async () => {
    const current = requireEngine();
    const householdId = `hh_local_${bytesToHex(randomBytes(8))}`;

    // The DEVICE identity is reused — one device, one keypair, registered per
    // property on the control plane. Only the HDK is new, because the new
    // property is a new membership with its own key epoch.
    const identity = current.identity;
    const householdKeys = generateHouseholdKeys(householdId, 1);
    const opLog = new OpLog({
      store: current.store,
      identity,
      householdKeys,
      projection: projectionFor(householdId),
    });
    const household = buildHousehold(householdId, input.displayName?.trim() || 'My home');
    const seasonal = defaultSeasonalChecklists(householdId);

    const ledger: HouseLedger = {
      version: 1,
      household,
      memberId: current.ledger.memberId,
      deviceId: current.ledger.deviceId,
      ...emptyHouseTables(),
      households: [toLedgeredHousehold(household)],
      householdSpaces: defaultHouseholdSpaces(householdId),
      seasonalChecklists: seasonal.checklists,
      seasonalChecklistItems: seasonal.items,
      ops: [],
      lww: {},
      conflicts: [],
      crypto: cryptoBundle(identity, householdKeys),
    };

    const session: EngineState = {
      householdId,
      dbKey: current.dbKey,
      store: current.store,
      identity,
      householdKeys,
      retiredHouseholdKeys: new Map(),
      opLog,
      ledger,
      hydrated: true,
      awaitingKeys: false,
      pendingRemoteDeltas: [],
    };
    sessions.set(householdId, session);
    await appendLedgerOp(session, 'HOUSEHOLD_CREATE', 'household', householdId, {
      name: household.name,
    });
    const createdId = session.ledger.ops[session.ledger.ops.length - 1]?.opId;
    await persistSession(session, 'all', createdId ? [createdId] : []);
    return ledger;
  });
}

/**
 * Meta rows OTHER modules key by household, purged here.
 *
 * Each is a fact about a property that outlives its rows, and each would be
 * inherited by a re-join under the same id: a checkpoint watermark that skips
 * the bootstrap the new member needs, and a "this property is on the control
 * plane" marker that lets a property nobody registered start syncing.
 */
const FOREIGN_HOUSEHOLD_META_KEYS = [
  /** `sync/checkpoints.ts` — publishedEpochMetaKey. */
  (householdId: string) => `lf.checkpoint.epoch:${householdId}`,
  /** `controlPlaneClient.ts` — registeredMetaKey. */
  (householdId: string) => `lf.cp.registered:${householdId}`,
  /**
   * `checkpointVvMetaKey` — the watermark the header above already promised was
   * cleared and was not. Inherited by a re-join under the same id it tells
   * compaction this device has already proved a snapshot it no longer holds a
   * single row of.
   */
  (householdId: string) => `lf.checkpoint.vv:${householdId}`,
  /**
   * `bootstrapPendingMetaKey`. Left behind, a stale '1' would put a property the
   * member re-joins into a backfill it has already completed; left behind on the
   * other side, a stale '' would deny the re-join its backfill entirely. Both are
   * wrong, so the key goes with the rest of the property.
   */
  (householdId: string) => `lf.bootstrap.pending:${householdId}`,
];

/**
 * Drop a property from this device: clear its rows, its identity and key
 * material, its sync cursors, its watermarks and its index entry, leaving every
 * other property untouched.
 *
 * This is the ONLY path that clears rows. `adoptJoinedHousehold` used to, which
 * is how joining destroyed the member's existing home; removal is now an
 * explicit act with an explicit call.
 *
 * It is also what "leave this home" is built on, and that is why the cleanup has
 * to be total rather than merely enough to hide the property: the promise made
 * to the member at the confirm is that everything of that home's is gone from
 * this phone.
 */
export function removeLocalHouseProperty(householdId: string): Promise<void> {
  return queueSessionWork(async () => {
    const session = requireSession(householdId);
    if (sessions.size === 1) {
      throw new Error('removeLocalHouseProperty: cannot remove the last property');
    }
    await session.store.clearSyncPeerStates(householdId);
    await session.store.clearRows(householdId);
    // The identity blob carries this property's device keypair AND its household
    // key ring, so blanking it is what makes the erasure real rather than a
    // matter of the rows being unreachable.
    await session.store.setMeta(identityMetaKey(householdId), '');
    for (const key of FOREIGN_HOUSEHOLD_META_KEYS) {
      await session.store.setMeta(key(householdId), '');
    }
    await forgetProperty(session.store, householdId);
    sessions.delete(householdId);
    if (activeHouseholdId === householdId) {
      const next = [...sessions.keys()][0]!;
      activeHouseholdId = next;
      await hydrateSession(sessions.get(next)!);
      await session.store.setMeta(ACTIVE_META, next);
      // Both pointers, always together: `HOUSEHOLD_META` is what a cold open
      // reads to decide which property it is looking at, and leaving it naming
      // the property just removed is how a relaunch lands on a ledger that is
      // no longer there.
      await session.store.setMeta(HOUSEHOLD_META, next);
      notifyLedgerChanged(HOUSE_LEDGER_TABLE_NAMES, next);
    }
  });
}

export function activateLocalHouseProperty(householdId: string): Promise<HouseLedger> {
  return queueSessionWork(async () => {
    const session = requireSession(householdId);
    await hydrateSession(session);
    activeHouseholdId = householdId;
    await session.store.setMeta(ACTIVE_META, householdId);
    await session.store.setMeta(HOUSEHOLD_META, householdId);
    notifyLedgerChanged(HOUSE_LEDGER_TABLE_NAMES, householdId);
    return session.ledger;
  });
}

/**
 * A device with no ledger mints its own private property.
 *
 * The seed is the House equivalent of Budget's 10 default categories: the
 * preset spaces and the four seasonal-checklist shells, both with deterministic
 * ids so a re-seed merges instead of duplicating. It is emitted as ONE op —
 * looping single writes is quadratic (capture+diff+seal over a growing ledger)
 * and this runs at onboarding while the user is watching (plan §3.3).
 */
async function mintNewHousehold(
  input: { userId: string; displayName?: string | null },
  dbKey: Uint8Array,
  store: LocalFirstStore,
): Promise<HouseLedger> {
  const householdId = `hh_local_${bytesToHex(randomBytes(8))}`;
  const deviceId = `dev_${bytesToHex(randomBytes(6))}`;
  const identity = generateDeviceIdentity(deviceId);
  const householdKeys = generateHouseholdKeys(householdId, 1);
  const opLog = new OpLog({ store, identity, householdKeys, projection: projectionFor(householdId) });
  const household = buildHousehold(householdId, input.displayName?.trim() || 'My home');
  const seasonal = defaultSeasonalChecklists(householdId);

  const ledger: HouseLedger = {
    version: 1,
    household,
    memberId: input.userId,
    deviceId,
    ...emptyHouseTables(),
    households: [toLedgeredHousehold(household)],
    householdSpaces: defaultHouseholdSpaces(householdId),
    seasonalChecklists: seasonal.checklists,
    seasonalChecklistItems: seasonal.items,
    ops: [],
    lww: {},
    conflicts: [],
    crypto: cryptoBundle(identity, householdKeys),
  };

  const session: EngineState = {
    householdId,
    dbKey,
    store,
    identity,
    householdKeys,
    retiredHouseholdKeys: new Map(),
    opLog,
    ledger,
    // Minted in memory, so it is hydrated by construction — there is nothing on
    // disk to read back.
    hydrated: true,
    awaitingKeys: false,
    pendingRemoteDeltas: [],
  };
  sessions.set(householdId, session);
  activeHouseholdId = householdId;
  await appendLedgerOp(session, 'HOUSEHOLD_CREATE', 'household', householdId, {
    name: household.name,
  });
  const createdId = session.ledger.ops[session.ledger.ops.length - 1]?.opId;
  await persistSession(session, 'all', createdId ? [createdId] : []);
  await store.setMeta(ACTIVE_META, householdId);
  return ledger;
}

async function closeLocalHouseSessionInner(): Promise<void> {
  // The household-less device state goes with the sessions: it holds one
  // account's keypair and a handle on the same database, and the next sign-in
  // may be a different person entirely.
  const pending = pendingDevice;
  pendingDevice = null;
  if (sessions.size === 0) {
    // Only when there is no session to close it — they share the one handle.
    if (pending) await pending.store.close();
    return;
  }
  // Every session shares ONE store (one SQLite file, one DEK), so it is closed
  // once, not once per property.
  const store = [...sessions.values()][0]!.store;
  sessions.clear();
  activeHouseholdId = null;
  await store.close();
}

export function closeLocalHouseSession(): Promise<void> {
  return queueSessionWork(closeLocalHouseSessionInner);
}

export function resetLocalHouseSession(): Promise<void> {
  return queueSessionWork(async () => {
    await closeLocalHouseSessionInner();
    await clearLocalHousePersistence();
  });
}

/** Close every property. Alias kept explicit so callers read as they intend. */
export function closeAllLocalHouseSessions(): Promise<void> {
  return closeLocalHouseSession();
}

/**
 * The one write path. Capture → mutate → diff → op append (HDK-sealed,
 * Ed25519-signed) → per-row DEK seal → putRows + markProjected, all inside one
 * store transaction, with the enrolment-pending guard and NO implicit sync kick.
 *
 * Bulk callers must pre-chunk with `chunkRowsForOp` and call this once per
 * chunk. One op per row is quadratic: every call re-captures and re-diffs the
 * whole ledger.
 */
export async function mutateLocalHouseLedger(
  mutator: (ledger: HouseLedger) => void,
  op: { opType: string; entityType: string; entityId: string; payload: unknown },
): Promise<HouseLedger> {
  const state = requireEngine();
  if (state.awaitingKeys) {
    throw new HouseLocalEnrolmentPendingError();
  }
  // Snapshot BEFORE the mutator: mutators edit rows in place, so the pre-image
  // has to be materialized eagerly or the diff has nothing to compare against.
  const before = captureLedgerSnapshot(state.ledger);
  mutator(state.ledger);
  state.ledger.household.updated_at = new Date().toISOString();
  const delta = diffLedger(before, state.ledger);
  await state.store.runInTransaction(async () => {
    await appendLedgerOp(
      state,
      op.opType,
      op.entityType,
      op.entityId,
      encodeLedgerOpPayload(op.payload, delta),
    );
    const opId = state.ledger.ops[state.ledger.ops.length - 1]?.opId;
    await persistRows(state, delta ?? null, opId ? [opId] : []);
  });
  return state.ledger;
}

/**
 * Move a session — and everything on disk that is keyed by household id — from
 * one id to another, because `ledger.household` was replaced under it.
 *
 * `sessions` is keyed by household id, and so is the sealed identity blob, the
 * on-disk property index, `ACTIVE_META`, `householdKeys.householdId` (which is
 * what the OpLog stamps onto every op and what the mailbox addresses) and the
 * OpLog's own projection binding. Swapping `ledger.household` alone leaves the
 * registry holding the OLD key over a ledger that now answers to the new one,
 * and the very next `requireSession(newId)` — `restoreHouseBackup` re-reads the
 * session by the archive's id the moment the restore returns — throws
 * `HouseLocalUnknownPropertyError` over rows that were already written.
 *
 * The HDK BYTES travel unchanged, only their label moves: an archive carries no
 * crypto material (`snapshotFromHouseLedger` drops it), so there is no other key
 * to adopt. That is the pre-existing bargain of a household replace, not
 * something this re-key introduces.
 */
async function rekeySessionHousehold(state: EngineState, previousId: string): Promise<void> {
  const nextId = state.ledger.household.id;
  sessions.delete(previousId);
  state.householdId = nextId;
  sessions.set(nextId, state);
  if (activeHouseholdId === previousId) activeHouseholdId = nextId;
  state.householdKeys = { ...state.householdKeys, householdId: nextId };
  state.opLog = new OpLog({
    store: state.store,
    identity: state.identity,
    householdKeys: state.householdKeys,
    retiredHdks: state.retiredHouseholdKeys,
    projection: projectionFor(nextId),
  });
  await forgetProperty(state.store, previousId);
  await rememberProperty(state.store, nextId);
  // Only when this session IS the active one. A re-key on a background property
  // (a restore aimed at a home the member is not looking at) must not silently
  // move the "open this on next launch" pointer to it.
  if (activeHouseholdId === nextId) {
    await state.store.setMeta(ACTIVE_META, nextId);
    await state.store.setMeta(HOUSEHOLD_META, nextId);
  }
}

/**
 * Device-local backup restore: merge backup tables through LWW with a synthetic
 * ancient stamp so live field writes and tombstones win. The op payload carries
 * a real delta so peers converge instead of silently forking.
 */
export async function applyLocalHouseRestore(
  backup: HouseLedger,
  op: {
    entityId: string;
    payload: Record<string, unknown>;
    replaceHousehold?: boolean;
    /**
     * Which property the rows land in. Omit for the active one, which is what
     * every single-home restore means.
     *
     * A backup file may hold SEVERAL homes (`backup/houseBackup.ts`), and each
     * section has to merge into its own property. Without this the whole file
     * would be written into whichever home happens to be active — every section
     * on top of the last — which is precisely the cross-household mixing the
     * sectioned archive format exists to prevent.
     */
    householdId?: string;
  },
): Promise<HouseLedger> {
  const state = op.householdId ? requireSession(op.householdId) : requireEngine();
  /**
   * The enrolment guard is about KEYS, not about restore.
   *
   * An `awaitingKeys` property is a placeholder: the account's REAL household id
   * and name, and a throwaway HDK (`adoptHouseholdSession`). What must never
   * happen to it is an AUTHORED op — sealed under a key no peer holds, it comes
   * back `key_epoch_mismatch`, which `applyRemote` treats as RETRYABLE, so it is
   * never acked and never leaves the relay.
   *
   * Restoring the SAME household into it is not that. It is the disaster-recovery
   * case the recovery phrase exists for — the member whose old phone is gone,
   * whose device adopted their real home and was then told to go fetch that phone
   * — and the rows it writes are sealed with the DEVICE key, not the HDK, so it
   * needs no household key at all. Only the op does, and below it is skipped.
   */
  const intoPendingProperty = state.awaitingKeys;
  if (
    intoPendingProperty &&
    (op.replaceHousehold === true || backup.household?.id !== state.ledger.household.id)
  ) {
    // A placeholder for a DIFFERENT home is not a home this device is
    // recovering. Filling it with another household's rows is the data-mixing
    // `allowHouseholdReplace` refuses on a keyed session, and here there is not
    // even a key to seal the result under.
    throw new HouseLocalEnrolmentPendingError();
  }
  if (op.replaceHousehold && backup.household) {
    const previousId = state.householdId;
    state.ledger.household = backup.household;
    if (backup.memberId) state.ledger.memberId = backup.memberId;
    if (previousId !== state.ledger.household.id) {
      await rekeySessionHousehold(state, previousId);
    }
  } else if (backup.household && backup.household.id === state.ledger.household.id) {
    /**
     * Same home, no identity change — adopt the archived record's DOMAIN fields
     * for anything this device is missing.
     *
     * `state.ledger.household` is the singular active-property record, and it is
     * what `syncHouseholdStoreFromLocalLedger` copies into `currentHousehold` —
     * so it is what every screen means by "my home". The line above only ever
     * updates it while REPLACING an identity, which the ordinary restore never
     * does: `restoreHouseBackup` sets `replaceHousehold` only when the ids
     * differ, and the multi-home path never sets it at all.
     *
     * The rows were fine. `restoreDeltaFromBackup` below merges the `households`
     * TABLE, so the archived record — address included — did land on the device.
     * It just landed somewhere no screen reads, while this record kept the
     * bootstrap placeholder's fields: the account's real id and name from the
     * control plane (see the enrolment note above) and nothing else.
     *
     * Reported from a device: a member restored their backup, and the property
     * address gate opened on a home whose address was sitting in the ledger one
     * field away. The name was right, which made it look like the restore had
     * worked and the home had simply never had an address.
     *
     * Filled ONLY where the live value is empty, never overwritten. A restore is
     * month-old data by construction and D-20's rule is that live writes win —
     * so this may repair a gap and may not touch anything the member has since
     * typed. Identity (`id`), membership (`member_count`, `my_role`) and the
     * audit stamps are excluded outright: they describe this device's session,
     * not the archived home.
     */
    const live = state.ledger.household as unknown as Record<string, unknown>;
    const archived = backup.household as unknown as Record<string, unknown>;
    const RESTORABLE_HOUSEHOLD_FIELDS = [
      'name',
      'address_line1',
      'address_line2',
      'city',
      'state_province',
      'postal_code',
      'country',
      'unit_system',
      'photo_key',
      'photo_url',
      'purchase_price',
      'purchase_date',
    ] as const;
    for (const field of RESTORABLE_HOUSEHOLD_FIELDS) {
      const current = live[field];
      const isEmpty =
        current === null ||
        current === undefined ||
        (typeof current === 'string' && current.trim() === '');
      const incoming = archived[field];
      if (isEmpty && incoming !== null && incoming !== undefined && incoming !== '') {
        live[field] = incoming;
      }
    }
  }
  state.ledger.household.updated_at = new Date().toISOString();

  const delta = restoreDeltaFromBackup(state.ledger, backup);
  const restoreEpoch =
    typeof op.payload.restoreEpoch === 'number' ? op.payload.restoreEpoch : Date.now();
  const chunks = delta ? chunkLedgerDelta(delta) : [];
  const opIds: string[] = [];

  await state.store.runInTransaction(async () => {
    if (intoPendingProperty) {
      // Merged straight into the ledger, exactly as the OpLog's projection
      // handler would have — same RESTORE_HLC, same author — but with no op
      // behind it, per the guard above. The restored rows stay device-local
      // until enrolment completes and this device may author for real.
      if (delta) {
        applyLedgerDelta(state.ledger, delta, {
          hlc: RESTORE_HLC,
          authorMemberId: state.ledger.memberId,
          opId: createOpId(),
        });
      }
    } else if (chunks.length === 0) {
      const stored = await appendLedgerOp(
        state,
        'BACKUP_RESTORE',
        'household',
        op.entityId,
        encodeLedgerOpPayload({ ...op.payload, restoreEpoch }, { v: 1 }),
        { hlc: RESTORE_HLC },
      );
      opIds.push(stored.opId);
    } else {
      for (const chunk of chunks) {
        const stored = await appendLedgerOp(
          state,
          'BACKUP_RESTORE',
          'household',
          op.entityId,
          encodeLedgerOpPayload({ ...op.payload, restoreEpoch }, chunk),
          { hlc: RESTORE_HLC },
        );
        opIds.push(stored.opId);
      }
    }
    drainParkedRows(state.ledger);
    await persistRows(state, delta ?? 'all', opIds);
  });
  // A restore can touch any table, so this is one of the few legitimate
  // whole-ledger invalidations. Named for the property that was actually
  // written: a multi-home restore fires this once per home, and a listener that
  // was told "the active one" three times would refetch the wrong two.
  notifyLedgerChanged(HOUSE_LEDGER_TABLE_NAMES, state.householdId);
  return state.ledger;
}

/**
 * Record ops that sync already verified, decrypted and projected (the OpLog's
 * projection handler runs inside `applyRemote`), then persist the merged ledger
 * so a relaunch keeps the peer's changes.
 */
export async function noteRemoteHouseOpsApplied(
  ops: StoredOperation[],
  forHouseholdId?: string,
): Promise<void> {
  const state = forHouseholdId ? requireSession(forHouseholdId) : requireEngine();
  for (const op of ops) {
    if (!state.ledger.ops.some((existing) => existing.opId === op.opId)) {
      state.ledger.ops.push(op);
    }
  }
  const deltas = state.pendingRemoteDeltas;
  state.pendingRemoteDeltas = [];
  await state.store.runInTransaction(async () => {
    if (deltas.length === 0) {
      await persistIdentity(state);
    } else {
      for (const delta of deltas) {
        await persistRows(state, delta);
      }
    }
    await state.store.markProjected(
      ops.map((op) => op.opId),
      Date.now(),
    );
  });
}

/**
 * ADD the property this device just joined, beside the ones it already holds.
 *
 * Before enrolment every device runs a private "home of one" whose id was
 * minted locally, and every projected row carries that id. Keeping that id
 * after joining breaks sync invisibly: mailbox and control-plane calls are
 * addressed by `ledger.household.id`, so the device would poll its own empty
 * household forever, and the facades filter rows by `household_id`, so a peer's
 * rows would be merged and then hidden. So the joined property gets a session of
 * its own, and that session becomes the active one.
 *
 * **It used to REPLACE.** The joined property took over the running session and
 * the previous one's rows, sync cursors and index entry were cleared — so
 * accepting an invite destroyed whatever the member had set up on their own
 * phone, irreversibly, and the confirm dialog had to warn about it. That was
 * sound only while the engine could hold one property at a time; it has held a
 * session registry since §7, and every other path into that registry
 * (`createLocalHouseProperty`, `activateLocalHouseProperty`,
 * `removeLocalHouseProperty`) already adds rather than replaces. Joining was the
 * odd one out, and the cost of the inconsistency was somebody's home.
 *
 * Idempotent: claiming the same invite twice, or joining a property this device
 * already holds, ACTIVATES it rather than building a second session over the
 * top of the first.
 *
 * The shared history arrives afterwards as ops from peers (bootstrap), which is
 * why the tables start empty and why nothing is seeded here — seeding the preset
 * spaces and seasonal shells into a home that already has its own would push
 * duplicates at every peer the moment the HDK lands.
 */
export async function adoptJoinedHousehold(input: {
  householdId: string;
  displayName?: string | null;
}): Promise<HouseLedger> {
  // Read FIRST, so joining with nothing on this device at all still fails as
  // "not ready" rather than as something stranger further in.
  //
  // Two devices arrive here. One already holds a home and adopts the joined one
  // BESIDE it. The other holds nothing — a brand-new account whose sign-up
  // minted no home — and the joined property is the first thing it will hold;
  // it brings the keypair it claimed the invite with, which is the only keypair
  // the owner has approved.
  const current = activeHouseholdId ? sessions.get(activeHouseholdId) : null;
  const base = current
    ? {
        store: current.store,
        dbKey: current.dbKey,
        identity: current.identity,
        memberId: current.ledger.memberId,
        deviceId: current.ledger.deviceId,
      }
    : pendingDevice;
  if (!base) throw new HouseLocalNotReadyError();

  const ledger = await adoptHouseholdSession({
    householdId: input.householdId,
    displayName: input.displayName,
    store: base.store,
    dbKey: base.dbKey,
    identity: base.identity,
    memberId: base.memberId,
    deviceId: base.deviceId,
  });
  // The store now belongs to a session, which owns closing it. Left set, the
  // next session open would close a handle its own sessions are still using.
  pendingDevice = null;
  return ledger;
}

/**
 * Build the pending-enrolment session `adoptJoinedHousehold` describes.
 *
 * Split out from it, not duplicated, because a device with NO ledger at all
 * needs exactly this shape: a home the account owns, present under its real id
 * and real name, holding no keys and therefore no data yet. The only difference
 * between the two callers is where the device identity comes from — an existing
 * session's, or one generated for a device that has none — so that is all this
 * takes as an argument.
 */
async function adoptHouseholdSession(input: {
  householdId: string;
  displayName?: string | null;
  store: LocalFirstStore;
  dbKey: Uint8Array;
  identity: DeviceIdentity;
  memberId: string;
  deviceId: string;
}): Promise<HouseLedger> {
  const existing = sessions.get(input.householdId);
  if (existing) {
    activeHouseholdId = input.householdId;
    await existing.store.setMeta(ACTIVE_META, input.householdId);
    await existing.store.setMeta(HOUSEHOLD_META, input.householdId);
    notifyLedgerChanged(HOUSE_LEDGER_TABLE_NAMES, input.householdId);
    return existing.ledger;
  }

  const household = buildHousehold(input.householdId, input.displayName?.trim() || 'Shared home');
  // `member`, even when the account OWNS this home and the control plane says so.
  //
  // `my_role` is what `registerHouseholdOnce` branches on, and `owner` sends it
  // down `POST /v2/households` — a household CREATE, carrying this device's own
  // name for a home that already exists. That is the exact call the orphan bug
  // was made of, and it must not be reachable from a device that is recovering.
  // A member registers its DEVICE against the existing home instead, which is
  // the call that lets a peer wrap the key to it. The real role arrives with the
  // roster, as it already does for an owner's second device.
  household.my_role = 'member';

  // A THROWAWAY key, not the current property's.
  //
  // The old replace-in-place carried the pre-join HDK across because the key was
  // about to be overwritten anyway. Adding a session cannot do that: copying
  // property A's key bytes into property B's sealed identity blob is exactly the
  // cross-property key smear the session registry exists to prevent. Nothing is
  // ever sealed with this — `awaitingKeys` refuses every write until the real
  // wrap arrives, and rows are sealed with the device DEK, not the HDK.
  const householdKeys = generateHouseholdKeys(input.householdId, 1);
  const opLog = new OpLog({
    store: input.store,
    identity: input.identity,
    householdKeys,
    projection: projectionFor(input.householdId),
  });

  const ledger: HouseLedger = {
    version: 1,
    household,
    memberId: input.memberId,
    deviceId: input.deviceId,
    ...emptyHouseTables(),
    ops: [],
    lww: {},
    conflicts: [],
    pendingEnrolment: true,
    crypto: cryptoBundle(input.identity, householdKeys),
  };

  const session: EngineState = {
    householdId: input.householdId,
    dbKey: input.dbKey,
    store: input.store,
    identity: input.identity,
    householdKeys,
    retiredHouseholdKeys: new Map(),
    opLog,
    ledger,
    // Built in memory and empty; there is nothing on disk for this property yet,
    // so there is nothing to hydrate.
    hydrated: true,
    awaitingKeys: true,
    pendingRemoteDeltas: [],
  };
  sessions.set(input.householdId, session);
  activeHouseholdId = input.householdId;

  await persistSession(session, 'all');
  // Set BEFORE the property is announced, and durable: from this moment every
  // sync pass owes this property a full backfill, and an app killed between here
  // and the first successful install resumes owing it.
  await input.store.setMeta(bootstrapPendingMetaKey(input.householdId), '1');
  await input.store.setMeta(ACTIVE_META, input.householdId);
  await input.store.setMeta(HOUSEHOLD_META, input.householdId);
  // The member is now looking at an entirely different property.
  notifyLedgerChanged(HOUSE_LEDGER_TABLE_NAMES, input.householdId);
  return session.ledger;
}

/**
 * Take a half-joined property off this device.
 *
 * The exit from the dead end a dead claim leaves behind: an invite that was
 * cancelled or expired leaves a property that 403s every request and a set of
 * join controls disabled by the very wait it is stuck in — on the exact screen
 * the member needs in order to claim the replacement invite.
 *
 * Refuses to touch a property that is NOT awaiting keys — an enrolled property
 * holds real home data and only an explicit act may remove it — and refuses to
 * drop the last one, which would leave the app with no ledger at all. Returns
 * whether anything was dropped.
 */
export async function abandonHouseEnrolment(householdId: string): Promise<boolean> {
  const session = sessions.get(householdId);
  if (!session?.awaitingKeys) return false;
  // Unreachable in practice — adopting requires an open session to adopt BESIDE
  // — but a device with one property and nothing to fall back to is better left
  // stuck than left empty.
  if (sessions.size === 1) return false;
  // NOT wrapped in `queueSessionWork`: the removal takes the chain itself, and
  // taking it twice would queue the inner link behind the outer one forever.
  await removeLocalHouseProperty(householdId);
  return true;
}

/** Does this device hold a ledger for that property? */
export function hasLocalHouseProperty(householdId: string): boolean {
  return sessions.has(householdId);
}

/**
 * Rename a property this device holds.
 *
 * The name lives in the sealed identity blob, NOT in the projection: a rename is
 * an identity write plus a re-seal, with no new op type — there is nothing for a
 * peer to merge. `persistIdentity` rather than `persistSession`: the latter
 * writes projection rows, so a rename that went through it alone would be lost
 * on the next session open.
 *
 * Peers keep their own name for this property until the control plane hands them
 * ours — `syncLocalHouseholdToControlPlane` pushes it outward.
 */
export async function renameLocalHouseProperty(
  name: string,
  forHouseholdId?: string,
): Promise<LocalHousehold> {
  const state = forHouseholdId ? requireSession(forHouseholdId) : requireEngine();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Property name is required');

  state.ledger.household = {
    ...state.ledger.household,
    name: trimmed,
    updated_at: new Date().toISOString(),
  };
  await persistIdentity(state);
  // No table moved — the name lives in the identity blob — so this is a
  // session-level bump for whichever property was renamed.
  notifyLedgerChanged([], state.householdId);
  return state.ledger.household;
}

/** Auto-merges that discarded a member's intent, newest last (BR-044). */
export function getLocalHouseConflicts(): LedgerConflict[] {
  return requireEngine().ledger.conflicts ?? [];
}

/** Dismiss the surfaced conflict log once the member has seen it. */
export async function clearLocalHouseConflicts(): Promise<void> {
  const state = requireEngine();
  state.ledger.conflicts = [];
  await persist(null);
  notifyLedgerChanged();
}

/**
 * Per property: two properties publish independently, so one shared watermark
 * would let a compaction on property A truncate below what property B still
 * needs to prove it has.
 */
const checkpointVvMetaKey = (householdId: string) => `lf.checkpoint.vv:${householdId}`;

/**
 * "This property was JOINED and its history has not landed yet."
 *
 * Written by `adoptJoinedHousehold`, cleared only when the backfill provably
 * succeeded, and durable so an app killed mid-join resumes instead of giving up.
 *
 * It exists because the old bootstrap gate was `the version vector is empty`,
 * which is not a fact about whether the history arrived — it is a fact about
 * whether ANY op has been stored. The owner deposits the household key and the
 * checkpoint independently, so a joiner routinely gets the key first, finds no
 * checkpoint published yet, and then applies one live op from the mailbox. That
 * single op makes the vector non-empty and closes the only window the joiner
 * ever had: the ops that carry the older history are long since compacted at the
 * owner, so the member is left holding whatever has happened since they joined —
 * no rooms, no appliances, no documents — with every log line reporting a
 * healthy sync. This marker replaces the inference with a record.
 */
const bootstrapPendingMetaKey = (householdId: string) => `lf.bootstrap.pending:${householdId}`;

/**
 * Does this property still owe the member the history that predates their join?
 *
 * False for every property this device MINTED — there is no history elsewhere to
 * fetch — and false for a joined property whose backfill has completed. The sync
 * run retries the backfill on every pass for as long as this is true, which is
 * what makes the delivery guaranteed rather than a single race the owner's
 * upload timing decides.
 *
 * Answers false for an unknown property rather than throwing: callers are
 * background passes, and a property removed mid-flight owes nobody anything.
 */
export async function isHouseholdBootstrapPending(householdId: string): Promise<boolean> {
  const state = sessions.get(householdId);
  if (!state) return false;
  return (await state.store.getMeta(bootstrapPendingMetaKey(householdId))) === '1';
}

/** The backfill landed (or provably had nothing to land) — stop retrying. */
export async function clearHouseholdBootstrapPending(householdId: string): Promise<void> {
  const state = sessions.get(householdId);
  if (!state) return;
  await state.store.setMeta(bootstrapPendingMetaKey(householdId), '');
}

/**
 * Re-arm the backfill for a property already on this device.
 *
 * The repair path, and the only reason it is exported: devices that joined
 * BEFORE the marker existed are sitting on a partial ledger right now, and
 * nothing about their state distinguishes them from a fully-synced member. The
 * member asks for the history from Device sync, this marks the property, and the
 * next run installs the checkpoint — which replaces the projection and then
 * replays every local op newer than the snapshot, so nothing written on this
 * device is lost by asking.
 */
export async function requestHouseholdBackfill(householdId: string): Promise<void> {
  const state = requireSession(householdId);
  await state.store.setMeta(bootstrapPendingMetaKey(householdId), '1');
}

/** Snapshot the current projection as HDK-sealable checkpoint plaintext. */
export async function exportHouseCheckpointPlaintext(
  forHouseholdId?: string,
): Promise<CheckpointPlaintext> {
  const state = forHouseholdId
    ? await hydrateSession(requireSession(forHouseholdId))
    : requireEngine();
  const householdId = state.ledger.household.id;
  const records = await state.store.listRows({ householdId });
  const rows: CheckpointPlaintext['rows'] = [];
  for (const record of records) {
    const body = openRowBody(
      state.dbKey,
      record.nonce,
      record.ciphertext,
      rowAad(householdId, record.table, record.rowKey, record.keyEpoch),
    );
    rows.push({
      table: record.table,
      rowKey: record.rowKey,
      bucket: record.bucket,
      deleted: record.deleted,
      bodyJson: utf8Decode(body),
      updatedHlc: record.updatedHlc,
    });
  }
  return {
    v: 1,
    householdId,
    keyEpoch: state.householdKeys.keyEpoch,
    versionVector: await state.store.getVersionVector(householdId),
    household: state.ledger.household,
    rows,
  };
}

/**
 * Replace the projection with a verified checkpoint, then replay local ops
 * newer than the checkpoint watermark (unpublished tail).
 */
export async function installHouseCheckpointPlaintext(
  plain: CheckpointPlaintext,
  forHouseholdId?: string,
): Promise<void> {
  const state = forHouseholdId
    ? await hydrateSession(requireSession(forHouseholdId))
    : requireEngine();
  if (state.awaitingKeys) {
    throw new HouseLocalEnrolmentPendingError();
  }
  const householdId = state.ledger.household.id;
  if (plain.householdId !== householdId) {
    throw new Error('installHouseCheckpointPlaintext: household mismatch');
  }
  const writes: Array<{
    table: LedgerTableName;
    rowKey: string;
    deleted: boolean;
    envelope: RowEnvelope;
  }> = [];
  for (const row of plain.rows) {
    if (!(row.table in HOUSE_LEDGER_TABLE_KEYS)) continue;
    const envelope = JSON.parse(row.bodyJson) as RowEnvelope;
    writes.push({
      table: row.table as LedgerTableName,
      rowKey: row.rowKey,
      deleted: row.deleted,
      envelope,
    });
  }
  await state.store.clearRows(householdId);
  installRowEnvelopes(state.ledger, writes);
  // The whole snapshot lands as ONE event — `installRowEnvelopes` writes the lot
  // in a single pass — so this is genuinely one report and the counter jumps
  // rather than climbs. What climbs during the download is the CHUNK fraction
  // (`tryInstallLatestCheckpoint`'s `onProgress`); this is the count that tells
  // the member what the download turned out to contain.
  reportRemoteRows(householdId, writes.length);
  if (plain.household && typeof plain.household === 'object') {
    state.ledger.household = {
      ...state.ledger.household,
      ...(plain.household as LocalHousehold),
      id: householdId,
    };
  }
  for (const [deviceId, seq] of Object.entries(plain.versionVector)) {
    await state.store.setAuthorBaseline(householdId, deviceId, seq);
  }
  await persistSession(state, 'all');

  const tail = await state.store.listOperationsSince(householdId, plain.versionVector);
  for (const op of tail) {
    try {
      const aad = utf8Encode(`${op.householdId}:${op.keyEpoch}:${op.opId}`);
      const payload = JSON.parse(utf8Decode(aeadDecrypt(state.householdKeys.hdk, op.payload, aad)));
      const delta = decodeLedgerOpPayload(payload);
      if (!delta) continue;
      applyLedgerDelta(state.ledger, delta, {
        hlc: op.hlc,
        authorMemberId: op.authorMemberId,
        opId: op.opId,
      });
    } catch {
      console.warn('[HouseLocal] checkpoint tail replay failed', op.opId);
    }
  }
  await persistSession(state, 'all');
  await state.store.setMeta(checkpointVvMetaKey(state.householdId), JSON.stringify(plain.versionVector));
  // The checkpoint replaced the whole projection.
  notifyLedgerChanged(HOUSE_LEDGER_TABLE_NAMES, state.householdId);
}

/** Truncate the op log below checkpoint VV ∩ every active peer VV. */
export async function compactLocalHouseLogIfSafe(forHouseholdId?: string): Promise<number> {
  const state = forHouseholdId ? requireSession(forHouseholdId) : requireEngine();
  const raw = await state.store.getMeta(checkpointVvMetaKey(state.householdId));
  if (!raw) return 0;
  let checkpointVv: VersionVector;
  try {
    checkpointVv = JSON.parse(raw) as VersionVector;
  } catch {
    return 0;
  }
  const householdId = state.ledger.household.id;
  const ours = await state.store.getVersionVector(householdId);
  const peers = await state.store.listSyncPeerStates(householdId);
  const retain = minVersionVector([checkpointVv, ours, ...peers.map((peer) => peer.knownVv)]);
  if (Object.keys(retain).length === 0) return 0;
  return state.store.compactOperations(householdId, retain);
}

export async function rememberPublishedHouseCheckpoint(
  vv: VersionVector,
  forHouseholdId?: string,
): Promise<void> {
  const state = forHouseholdId ? requireSession(forHouseholdId) : requireEngine();
  await state.store.setMeta(checkpointVvMetaKey(state.householdId), JSON.stringify(vv));
}

/** Test helper — inject an in-memory session without SecureStore/MMKV. */
export async function openLocalHouseSessionForTests(input: {
  userId: string;
  householdName?: string;
}): Promise<HouseLedger> {
  // Inner, not the queued export: this helper builds its own engine directly, so
  // going through the chain would let it deadlock if ever called from within a
  // queued operation.
  await closeLocalHouseSessionInner();
  const dbKey = randomBytes(32);
  const store = new MemoryLocalFirstStore();
  await store.open(dbKey);
  const householdId = `hh_test_${bytesToHex(randomBytes(4))}`;
  const deviceId = `dev_test_${bytesToHex(randomBytes(4))}`;
  const identity = generateDeviceIdentity(deviceId);
  const householdKeys = generateHouseholdKeys(householdId, 1);
  const opLog = new OpLog({ store, identity, householdKeys, projection: projectionFor(householdId) });
  const household = buildHousehold(householdId, input.householdName ?? 'Test home');
  const seasonal = defaultSeasonalChecklists(householdId);
  const ledger: HouseLedger = {
    version: 1,
    household,
    memberId: input.userId,
    deviceId,
    ...emptyHouseTables(),
    households: [toLedgeredHousehold(household)],
    householdSpaces: defaultHouseholdSpaces(householdId),
    seasonalChecklists: seasonal.checklists,
    seasonalChecklistItems: seasonal.items,
    ops: [],
    lww: {},
    conflicts: [],
    crypto: cryptoBundle(identity, householdKeys),
  };
  sessions.set(householdId, {
    householdId,
    dbKey,
    store,
    identity,
    householdKeys,
    retiredHouseholdKeys: new Map(),
    opLog,
    ledger,
    hydrated: true,
    awaitingKeys: false,
    pendingRemoteDeltas: [],
  });
  activeHouseholdId = householdId;
  return ledger;
}
