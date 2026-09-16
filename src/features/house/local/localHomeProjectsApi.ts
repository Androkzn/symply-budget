/**
 * Local `home-projects` — the ledger counterpart of `src/api/home-projects.ts`
 * (plan §11, sub-wave C4). The fourth block of Wave C, the tenth facade of H11,
 * and the one that **completes the registry**: after this there is no staged
 * table left.
 *
 * Ten tables in one facade — `home_projects` and the nine children it owns —
 * and **thirty methods**, not the "~21" §11.2 budgeted. Twenty are local, ten
 * throw, and none is remote-only. It was seventeen and thirteen until migration
 * 0170 made the three linked-task methods local. Every previous brief undercounted
 * (utilities "~15+" was 24, floor plans "~22" was 25) and this one did too, so
 * the count was taken from `Object.keys(homeProjectsApi)` rather than from the
 * plan. The last three are the budget-line writes, added when the Budget tab
 * stopped being read-only; the ledger owns those rows already, so they were
 * local from the first line.
 *
 * ## This is NOT `projects`
 *
 * `localProjectsApi` (B3) is the labor-hub contractor JOB — a quote a household
 * accepted, with milestones, payments and progress photos. This is the
 * renovation PLANNER: what the household wants done, what it should cost, what
 * is being bought for it. Different Drizzle file, different screens, no shared
 * row. The two features share an English word and a `project_id` column name and
 * nothing else, which is why every ledger name in this family is prefixed.
 *
 * ## The cascade audit — run twice, and the result is nil twice over
 *
 * §11.1.1 insists these are two different questions and that the FK half is the
 * half that matters less. Both were run against
 * `backend/src/db/schema-home-projects.ts`, `backend/src/routes/home-projects.ts`
 * and `backend/src/services/home-projects-service.ts` before a line of this file
 * was written.
 *
 * **1. The FK audit.** `home_projects.id` is referenced with
 * `onDelete: 'cascade'` by **twelve** tables — more than any other row in the
 * registry, and more than double B4's contractor. Nine of them are ledgered here
 * (`HOME_PROJECT_CHILD_TABLES` below); `home_project_geometry` is Tier D and
 * `home_project_spaces` / `home_project_contractors` are hazard S2. It was
 * thirteen until migration 0170 dropped `home_project_tasks` and put that link
 * on the parent row as `linked_task_ids` — a column cascades from nothing.
 *
 * | Direction | Finding |
 * |---|---|
 * | `home_projects` → its twelve children | **The cascade fires, and it is discharged in ONE op.** `remove` (`DELETE /:projectId`, migration 0163) walks `HOME_PROJECT_CHILD_TABLES` — derived from the Drizzle cascade declarations and asserted against them by `localHomeProjectsApi.test.ts` — and drops every ledgered child in the same write as the parent. This paragraph used to read "the cascade cannot fire, because nothing deletes a home project"; that was true for exactly as long as the planner had no delete, which is what the next block predicted |
 * | `deleteSelection` / `deleteBudgetLine` | **both are leaves** — `home_project_budget_lines.selection_id` and `home_project_attachments.selection_id` are plain `text` with no `references()`, so removing a selection cascades nothing on either backend |
 * | `archive` | a status flip (`updateProject({ status: 'archived' })`), so the row survives. It is the REVERSIBLE answer, offered again inside the delete confirmation |
 * | anything already live → a C4 table | **nothing.** The only foreign keys pointing at these ten come from `households` (never hard-deleted on device — deleting a property tears down its whole ledger rather than rows within it) and `users` (not a ledger table in any wave). So no existing facade changes and `CONTRACTOR_CASCADE_TABLES` needs no new entry — the fourth consecutive sub-wave for which that is true |
 * | `home_project_plan_links.floor_plan_id` → C2's `floor_plans` | **not a foreign key at all** — a plain `notNull text` with no `references()`. So `localFloorPlansApi.delete` leaves this pointer dangling exactly as D1 does. Reproduced rather than repaired, for C3's reason on `garden_plans.boundary_draft_id`: repairing it locally would make a project's provenance differ between a household on the server and one on the ledger |
 *
 * **2. The local-tombstone audit** — *if a member deletes this row on device, is
 * any child left unreachable?* This is the half that caught C2 and C3 out, where
 * the server soft-deletes and the ledger has no `deleted_at` to soft-delete
 * with, so a local delete is a real tombstone and the children orphan forever.
 *
 * **It used to come back empty, because this facade exposed no delete at all.**
 * That is no longer true: `remove` is a real project delete (migration 0163),
 * and on a ledger a delete is a TOMBSTONE — a child left behind syncs to every
 * peer and is never read again, with no foreign key anywhere to complain to.
 *
 * **`HOME_PROJECT_CHILD_TABLES` is what discharges it, and it was named for
 * exactly this day.** The list predates its caller by a whole wave: it was
 * written when nothing deleted a project, on the argument that "a planner
 * without a delete is a gap somebody will fill". Somebody filled it, and the
 * list was already derived, already guarded against the Drizzle sources by
 * `localHomeProjectsApi.test.ts`, and already carrying the argument for
 * dropping the children in the SAME op. B2 shipped a silent four-way orphan
 * precisely because that list did not exist yet; here it cost nothing to use.
 *
 * The two remaining S2 joins (`home_project_spaces`, `home_project_contractors`)
 * are absent from it and cannot be added: they have no `id` column, so they are
 * not ledgered, so there is nothing on device to leave behind. The Worker deletes
 * them explicitly. `home_project_tasks` was a third until migration 0170; its
 * successor is a column on the parent and needs no cascade entry on either
 * backend.
 *
 * ## §5.2 matters more here than anywhere in the programme
 *
 * C4 is the only React-Query-NATIVE domain in House. B1–C3 all mapped their
 * tables to namespaces nobody subscribes to yet — those screens fetch
 * imperatively with `useState`/`useEffect`, so the entries are no-ops that
 * reserve a namespace for a future reader. `src/api/home-projects.ts` exports a
 * real key factory and four hooks, and the hub screen is built on them, so every
 * prefix in `sync/ledgerRefresh.ts`'s C4 block wakes a live subscriber.
 *
 * The trap is that `homeProjectKeys` looks like one namespace and is three:
 * `['home-projects', hh]`, `['home-project', pid]` and
 * `['home-project-activity', pid]`. React Query matches a prefix ELEMENT BY
 * ELEMENT, so those are as unrelated to each other as `['tasks']` and
 * `['garbage']` — mapping the family to one of them would leave two of the three
 * screens stale after every peer's sync. The fourth key,
 * `['home-project-templates']`, is a compiled-in catalogue and is named in
 * `HOUSE_NEVER_INVALIDATED_KEYS` so no delta can reach it.
 *
 * ## Ten throws, in four groups — thirteen until migration 0170 closed the one
 * group that was a shape H11 had not produced before
 *
 * **H6 — the bytes (3).** `createAttachmentUpload`, `uploadAttachmentBytes` and
 * `uploadSelectionPhoto`. The first is where the attachment ROW is created as
 * well as where the URL is minted (`r2_key` is built from the household, the
 * project and the new id), so there is no metadata-only half to keep working the
 * way `contractorDocuments` and `projectProgressPhotos` have one. Throws rather
 * than remote-only for B1's reason: a missing key would route the upload to a
 * Worker that would happily accept the photo and file the resulting attachment
 * into a household whose rows live somewhere else entirely.
 *
 * **Tier D — the geometry (4).** `putManualGeometry`, `putRoomPlanGeometry`,
 * `enqueueAiSchematic` and `cancelGeometry`. `home_project_geometry` is in
 * `HOUSE_TIER_D_TABLES` and must never be ledgered, so there is nowhere on
 * device to put a layout. This is C2's `listRegions` distinction, applied to a
 * WRITE for the first time: Tier C data exists on the server for every household
 * so fetching it answers correctly, whereas Tier D data exists for households the
 * server can see — and routing these four remote would not merely answer empty,
 * it would write a real geometry row into D1 that `getHub` (local) can never
 * read back. `cancelGeometry` is C3's `cancelGeneration` exactly: the
 * precondition can never hold, because a local-first project is never
 * `generating`.
 *
 * **P4 — the scope suggester.** REMOVED from both backends. It wrote selections
 * a member never typed ("Tile / flooring (AI suggestion)"), and the product rule
 * is now that nothing writes a material but a member. The paragraph that used to
 * argue for keeping it as a throw is gone with the method.
 *
 * The historical note, because the argument still holds for anything like it:
 * this facade that is a judgement call rather than a mechanism. **It runs no
 * model**: `suggestAiScope` (`:1340`) is a hardcoded array of three-to-five idea
 * names, branched on `project.type`, written through `createSelection`. Every
 * input is a ledgered row and the C2 precedent (`getAnalysis` "looks like AI and
 * is not") points straight at making it local. It is a throw because the route
 * is gated by `assertCanUseAI`, which resolves a real subscription entitlement —
 * so a local implementation would silently hand a paid feature to every
 * local-first household. That is a product decision this sub-wave has no
 * authority to make, and §11.1.5 is the precedent for flagging rather than
 * quietly changing one. **If the decision is that it should be local, it is
 * about fifteen lines and needs no new mechanism.** Its copy therefore promises
 * nothing about models and points at the thing that does work.
 *
 * **Egress — the link importer (0, and it used to be 1).** `createFromLink`
 * threw here, because the Worker's version fetches the product page behind
 * `safeFetchUrl`'s SSRF guard and a device doing the same would make an
 * unsolicited request from the member's own network to a vendor — the class of
 * outbound traffic H7's allowlist exists to forbid, and a disclosure that the
 * member is shopping.
 *
 * **That reasoning was right and the refusal was still wrong**, because it was
 * read on the screen as "you cannot add this link". The page is *still* never
 * fetched; what the device reads is the URL, which the member typed in
 * themselves and which usually names the product outright. `logic/materialLink.ts`
 * holds the two rungs — string work on device, then the member's OWN provider
 * key for the slug, which reaches an allowlisted assistant and never the shop.
 * No price is imported on either rung: nothing here can see one, and a guessed
 * figure would land in `estimate_total`.
 *
 * **S2 — the join tables nobody can key (0, and it used to be 3).** `listTasks`,
 * `linkTask` and `createTask` threw here, because the link lived in
 * `home_project_tasks` — a PK-less join parked in `HOUSE_S2_DEFERRED_TABLES`
 * behind a backend change (plan §1.5 hazard S2: neither a random nor a
 * deterministic id is safe for a link/unlink/re-link row). **It was a shape no
 * earlier sub-wave produced** — a gap caused not by a model, a file transfer or
 * a tier, but by a table that could not be given a row key at all — and the only
 * place in H11 where a member lost a feature to a schema decision.
 *
 * **The backend change landed.** Migration 0170 dropped the join and put the
 * link on the parent as `home_projects.linked_task_ids`, which is the plan's own
 * answer and the shape `projects.linked_task_ids` has carried since 0061. All
 * three are ordinary local writes now; the linked-tasks block at the foot of
 * this file states what a list-on-the-parent costs under LWW. The member-visible
 * consequence is that the Smart Project wizard's "Tasks" tick-box is no longer
 * disabled on a local-first household.
 *
 * **Unreachable — the PDF (1).** `downloadExportPdf`, which is unreachable rather than
 * blocked: `exportSummary` is LOCAL and answers `pdfUrl: null`, which is the
 * value the DTO already declares and the branch `HomeProjectHubScreen` already
 * takes (`if (pdfUrl && …)` falls through to a text share). Nothing calls this
 * method under local-first; it throws rather than being absent so that a future
 * caller gets copy instead of a token-authenticated fetch of a PDF that was
 * never written.
 *
 * **Remote by design: none.** Like C2 and C3, and unlike C1 and B4: there is no
 * Tier C surface anywhere in this feature. The one thing that LOOKS like one —
 * `listTemplates`, a global catalogue identical for every household — is local,
 * and deliberately so. See `logic/homeProjects.ts`: `createProject` has to seed
 * a template's phases, selections, blockers and budget lines as ledger rows, so
 * the catalogue must be on the device regardless, and serving the wizard's list
 * from the server as well would give one fact two sources.
 *
 * ## The reads that had to be local, and why
 *
 * `getHub` is the whole feature. It is not a table dump: it caps every child at
 * 200, orders three of them on a `sort_order` the DTO does not carry, and
 * computes `rollups` — the estimate, the actual, the contingency and the health
 * badge — out of `home_project_budget_lines` on every request. Left remote, a
 * Worker holding none of those rows answers `estimate_total: 0` with a 200, and
 * a member looking at a fully specified twelve-thousand-dollar bathroom is told
 * it costs nothing. That is C1's "$0.00 this month" failure with a bigger number
 * on it, and it is the §6 silence the Proxy exists to prevent.
 *
 * `list` applies four decisions over ledgered rows (archived hidden unless
 * asked for, status filter, title search, `updated_at` ordering), `listActivity`
 * ports the cursor pagination, and `exportSummary` composes a share document out
 * of the hub. All four would render empty-and-correct against a server that has
 * never seen this household.
 *
 * ## One op per write, and no bulk path
 *
 * `createProject` is the largest write in the facade — a template seeds up to
 * fifteen rows across five tables — and it is still ONE op, because a peer that
 * received the project without its phases would render a renovation with no
 * schedule and no way to tell that anything was missing. `createSelection` is
 * the same argument at three rows: the selection, its derived budget line and
 * the activity entry go together or the estimate is short by exactly one vanity.
 *
 * `writeLocalBulk` is unused, as in B3, C2 and C3. Fifteen small rows is
 * comfortably inside one op's plaintext budget, and — decisively — chunking
 * would defeat the point: the atomicity IS the requirement here, not a
 * side-effect of the size.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import * as FileSystem from 'expo-file-system/legacy';

import type {
  AreaUnit,
  CreateHomeProjectInput,
  HomeProject,
  HomeProjectActivityItem,
  HomeProjectBlocker,
  HomeProjectBudgetLine,
  HomeProjectComment,
  HomeProjectHub,
  HomeProjectOptionGroup,
  HomeProjectPhase,
  HomeProjectPlanLink,
  HomeProjectSelection,
  HomeProjectTemplate,
  MaterialExtractionOutcome,
  MaterialSpec,
} from '@api/home-projects';
import {
  canViewHomeProject,
  effectiveHomeProjectRole,
  normalizeHomeProjectRole,
  normalizeHomeProjectVisibility,
  parseHomeProjectAccessGrants,
  serializeHomeProjectAccessGrants,
  parseHomeProjectLinkedTaskIds,
  serializeHomeProjectLinkedTaskIds,
  withHomeProjectLinkedTask,
  type HomeProjectAccessGrant,
  type HomeProjectAccessMember,
  type HomeProjectAccessView,
  type HomeProjectRole,
  type HomeProjectVisibility,
} from '@symply/contracts';
import {
  buildExtractMaterialListingUserPrompt,
  compactRecord,
  extractReadableText,
  mergeListingIntoDraft,
  parseJsonLd,
  parseOpenGraph,
  EXTRACT_MATERIAL_LISTING_SCHEMA,
  EXTRACT_MATERIAL_LISTING_SYSTEM_PROMPT,
  type RawMaterialListing,
} from '@symply/contracts';
import {
  normalizeAttachmentImage,
  normalizedAttachmentFilename,
} from '@utils/attachmentImage';

import {
  buildHouseAiContext,
  houseByokPort,
  resolveHouseByokProvider,
  type HouseByokPort,
} from './ai';
import { type HouseBlobDescriptor, uploadHouseBlob } from './blobs';
import { getLocalHouseMemberId } from './engine';
import {
  HouseLocalUnknownPropertyError,
  HouseLocalUnsupportedError,
} from './errors';
import { newLocalId } from './ids';
// The ONE cross-facade import in H11, and it mirrors the server exactly:
// `createTaskFromProject` calls `TaskService.createTask` and then links what it
// got back. Restating a task's thirty defaults here would be a second copy of
// `task-service.ts:191` waiting to drift, which is the thing every header in
// this family argues against.
import { localTasksApi } from './localTasksApi';
import { activeHouseholdId, nowIso, rowsOf, writeLocal } from './localWrite';
import { fetchProductPage } from './logic/fetchProductPage';
import {
  budgetEstimateCents,
  buildHomeProjectSummaryLines,
  computeBudgetRollups,
  getHomeProjectTemplateSeed,
  HOME_PROJECT_HUB_CHILD_CAP,
  HOME_PROJECT_TEMPLATE_SEEDS,
} from './logic/homeProjects';
import { draftFromPage, draftFromUrl } from './logic/materialLink';
import type { HouseLedgerTableName } from './schema';
import type {
  LocalHomeProject,
  LocalHomeProjectActivity,
  LocalHomeProjectGeometry,
  LocalHomeProjectAttachment,
  LocalHomeProjectBlocker,
  LocalHomeProjectBudgetLine,
  LocalHomeProjectComment,
  LocalHomeProjectMilestone,
  LocalHomeProjectPhase,
  LocalHomeProjectPlanLink,
  LocalHomeProjectOptionGroup,
  LocalHomeProjectSelection,
  LocalTask,
} from './types';

// ---------------------------------------------------------------------------
// Input shapes — mirrors of the inline request types in
// `src/api/home-projects.ts`. They are declared inline on each method there
// rather than exported, so they are restated here; `apiParity.test.ts` catches a
// method that disappears and `tsc` catches a field whose type changed on a DTO.
// `CreateHomeProjectInput` IS exported, so it is imported rather than restated —
// a restatement of a type that can be imported is a second copy waiting to
// drift.
//
// Note these are camelCase, like C1's utilities inputs and unlike every
// labor-hub facade's snake_case ones. That is the remote module's convention
// here and the screens pass it, so the facade takes what they send rather than
// what the column is called.
// ---------------------------------------------------------------------------

/**
 * `PATCH /:projectId`. The remote module types this
 * `Partial<CreateHomeProjectInput> & { status?: string }`, which is a superset
 * of what the Worker's zod accepts in one direction and a subset in the other:
 *
 *  - `id`, `templateKey` and `spaceIds` are on this type and are STRIPPED by
 *    `patchProjectSchema`, so sending them changes nothing. Reproduced — they
 *    are ignored here too rather than quietly honoured, because honouring
 *    `templateKey` would re-seed a project that already has rows.
 *  - `goals`, `constraints`, `currency` and `targetStartAt` are accepted by the
 *    Worker and are NOT on this type, so no caller can send them. Not handled,
 *    for the same reason: a field no client can express is a branch no client
 *    can reach.
 */
export type UpdateLocalHomeProjectInput = Omit<
  Partial<CreateHomeProjectInput>,
  'targetBudgetCents'
> & {
  status?: string;
  /** Null clears the cover, matching the Worker's `patch.x !== undefined` set. */
  coverAttachmentId?: string | null;
  /**
   * Null clears the target back to "no target", which the Worker's
   * `targetBudgetCents: z.number().nullable()` already accepts. `undefined` still
   * means "not mentioned" and leaves the stored figure alone.
   *
   * Omitted from the spread above before being re-declared: intersecting
   * `{x?: number}` with `{x?: number | null}` yields `number`, not `number | null`.
   */
  targetBudgetCents?: number | null;
  /**
   * Publish / unpublish (migration 0163). Inherited from
   * `CreateHomeProjectInput` through the spread, and re-declared here only to
   * name it — the Worker's `patchProjectSchema` accepts the same enum and NOT
   * `null`, because a project always has a visibility.
   */
  visibility?: HomeProjectVisibility;
};

export type LocalHomeProjectFilters = {
  status?: string;
  q?: string;
};

export type CreateLocalHomeProjectSelectionInput = {
  name: string;
  category?: string;
  unitPriceCents?: number;
  productUrl?: string;
  notes?: string;
  status?: string;
  qty?: number;
  unit?: string;
  vendor?: string;
  optionGroupId?: string;
  brand?: string;
  sku?: string;
  imageUrl?: string;
  coveragePerUnit?: number;
  coverageUnit?: AreaUnit;
  specs?: MaterialSpec[];
  /**
   * Appearance (migration 0164) — what a finish needs to be DRAWN rather than
   * listed. Carried so that a material added on a local-first household can be
   * put on a surface by `materialFromSelection` exactly as a server-backed one
   * can; absent stays absent, because a guessed colour or repeat is the one
   * thing that conversion refuses to invent.
   */
  colorHex?: string | null;
  groutColorHex?: string | null;
  unitWMm?: number | null;
  unitHMm?: number | null;
  /** Set by `createFromLink`; every other caller is `'manual'` by default. */
  extractionSource?: MaterialExtractionOutcome['source'];
  extractionConfidence?: string;
  /**
   * Position in the materials list, for a caller writing a whole PLAN one row
   * at a time — `materializeSmartProjectPlan` passes the index. Omitted by a
   * member-driven add, and the new material then goes on TOP.
   */
  sortOrder?: number;
};

export type UpdateLocalHomeProjectSelectionInput = {
  name?: string;
  status?: string;
  unitPriceCents?: number | null;
  productUrl?: string | null;
  notes?: string | null;
  qty?: number;
  unit?: string | null;
  vendor?: string | null;
  optionGroupId?: string | null;
  brand?: string | null;
  sku?: string | null;
  imageUrl?: string | null;
  coveragePerUnit?: number | null;
  coverageUnit?: AreaUnit | null;
  specs?: MaterialSpec[] | null;
  version?: number;
};

export type LocalCreateHomeProjectOptionGroupInput = {
  name: string;
  category?: string;
  areaValue?: number | null;
  areaUnit?: AreaUnit | null;
  wasteFactorPct?: number;
};

export type UpdateLocalHomeProjectOptionGroupInput = {
  name?: string;
  category?: string;
  areaValue?: number | null;
  areaUnit?: AreaUnit | null;
  wasteFactorPct?: number;
  version?: number;
};

export type CreateLocalHomeProjectBlockerInput = {
  title: string;
  severity?: string;
  notes?: string;
};

export type CreateLocalHomeProjectPhaseInput = {
  title: string;
};

export type CreateLocalHomeProjectPlanLinkInput = {
  floorPlanId: string;
  zonePayload?: unknown;
};

export type AddLocalHomeProjectCommentInput = {
  body: string;
  selectionId?: string;
};

/**
 * The ledgered tables D1 cascades when a `home_projects` row is deleted.
 *
 * **`remove` is its caller** (migration 0163), and it walks this list rather
 * than naming tables inline. That is the whole reason the list was written a
 * wave before anything deleted a project: the alternative is what B2 actually
 * did — `localContractorsApi.delete` shipped cascading three tables, four more
 * went live underneath it, nobody remembered, and every contractor deletion
 * stranded four kinds of orphan on every peer. Nothing failed, because a ledger
 * has no foreign key to complain to and an orphan is only visible to a reader
 * that goes looking for its parent.
 *
 * It is derived from the Drizzle sources rather than hand-written, and
 * `localHomeProjectsApi.test.ts` parses every
 * `references(() => homeProjects.id, { onDelete: 'cascade' })` and fails if a
 * ledgered table is missing here — so a fifteenth child added in a migration
 * fails in milliseconds instead of leaking rows forever. That equality is
 * load-bearing now rather than descriptive.
 *
 * Two tables that DO cascade from `home_projects` in D1 are absent, and the
 * absence is proved elsewhere rather than asserted here: `home_project_spaces`
 * and `home_project_contractors` are hazard S2 (`HOUSE_S2_DEFERRED_TABLES`, and
 * `waveBCSchemaParity` proves neither has an `id` column). Neither is in the
 * ledger, so neither can be cascaded here — the Worker deletes both explicitly.
 * `home_project_tasks` was a third until migration 0170 replaced it with
 * `home_projects.linked_task_ids`; a column on the parent needs no cascade.
 */
/**
 * Store a device-produced layout for a project (H13 D-wave).
 *
 * Both callers are genuinely local work, which is why these two stopped being
 * throws while `enqueueAiSchematic` did not:
 *
 *  - `manual` is the member drawing the layout by hand.
 *  - `roomplan` is Apple's RoomPlan, which runs the LiDAR scan and produces the
 *    geometry **on the device**. Routing it to the Worker was never sending work
 *    to a model — it was sending a result the phone had already computed.
 *
 * One row per (project, source): re-scanning a room replaces that project's
 * RoomPlan layout rather than accumulating a pile of scans, and a manual edit
 * does not clobber the scan beside it. `status` is `completed` on arrival
 * because there is no queue to wait for — the payload is in hand.
 */
async function writeGeometry(
  householdId: string,
  projectId: string,
  source: 'manual' | 'roomplan',
  payload: unknown,
): Promise<{ geometry: LocalHomeProjectGeometry }> {
  // A layout is project data, so a view-only member may not replace one. The
  // Worker gates both geometry writes at `'write'`.
  requireProjectOwner(householdId, projectId);
  const now = nowIso();
  const existing = rowsOf<LocalHomeProjectGeometry>('homeProjectGeometry').find(
    row => row.project_id === projectId && row.source === source,
  );
  const row: LocalHomeProjectGeometry = {
    id: existing?.id ?? newLocalId('hpg'),
    project_id: projectId,
    source,
    status: 'completed',
    payload_json:
      payload === undefined || payload === null
        ? null
        : JSON.stringify(payload),
    confidence: null,
    disclaimer: null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  } as LocalHomeProjectGeometry;

  await writeLocal(
    draft => {
      const index = draft.homeProjectGeometry.findIndex(r => r.id === row.id);
      if (index >= 0) draft.homeProjectGeometry[index] = row;
      else draft.homeProjectGeometry.push(row);
    },
    {
      opType: existing ? 'update' : 'create',
      entityType: 'homeProjectGeometry',
      entityId: row.id,
      payload: { source },
    },
  );

  return { geometry: row };
}

export const HOME_PROJECT_CHILD_TABLES = [
  'homeProjectBudgetLines',
  'homeProjectSelections',
  'homeProjectOptionGroups',
  'homeProjectPhases',
  'homeProjectMilestones',
  'homeProjectBlockers',
  'homeProjectAttachments',
  'homeProjectPlanLinks',
  'homeProjectComments',
  'homeProjectActivity',
  // H13 D-wave. Tenth of the thirteen children; Tier D when this list was
  // derived, ledgered now, so the derivation that excluded it no longer holds.
  // The three S2 joins remain excluded on their own separate ground.
  'homeProjectGeometry',
] as const satisfies readonly HouseLedgerTableName[];

/**
 * A version conflict, in the shape `isHomeProjectConflict` already reads.
 *
 * `src/api/home-projects.ts` exports
 * `axios.isAxiosError(error) && error.response?.status === 409`, and
 * `HomeProjectHubScreen.withConflict` branches on it to show "someone else
 * changed this — reload?" instead of a generic error. The Proxy's promise (§6)
 * is that a screen cannot tell which backend answered it, so the local conflict
 * has to arrive in the shape the screen already knows how to read.
 *
 * Mimicking a transport error is not something to do casually and it is right
 * here for C1's reason (`HouseLocalDuplicateBillError`): the alternative is
 * teaching an api module that has no other local-first knowledge a second error
 * shape. `axios.isAxiosError` is `isObject(payload) && payload.isAxiosError ===
 * true`, so the flag below is the whole contract.
 */
export class HouseLocalHomeProjectConflictError extends Error {
  readonly code = 'house_local_home_project_conflict';
  /** What `axios.isAxiosError` actually tests. */
  readonly isAxiosError = true;
  readonly response: { status: 409; data: { error: string } };

  constructor(message: string) {
    super(message);
    this.name = 'HouseLocalHomeProjectConflictError';
    this.response = { status: 409, data: { error: message } };
  }
}

/**
 * A view-only member trying to write, in the shape the Worker's 403 arrives in.
 *
 * Same argument as the conflict above, one status along: the hub screen shows
 * `e.message` in an alert for anything that is not a 409, and a future caller
 * that wants to branch on "forbidden" (rather than "failed") needs the same
 * `response.status` on both backends or it will branch on one of them only.
 *
 * This is NOT security theatre on the device's own behalf — the member could
 * edit the ledger file if they were determined. It is what stops an honest
 * client from writing an edit that every peer would then converge, with no
 * server in the path to refuse it.
 */
export class HouseLocalHomeProjectForbiddenError extends Error {
  readonly code = 'house_local_home_project_forbidden';
  /** What `axios.isAxiosError` actually tests. */
  readonly isAxiosError = true;
  readonly response: { status: 403; data: { error: string } };

  constructor(message: string) {
    super(message);
    this.name = 'HouseLocalHomeProjectForbiddenError';
    this.response = { status: 403, data: { error: message } };
  }
}

// ---------------------------------------------------------------------------
// Ported helpers — `home-projects-service.ts`, reproduced where the output is
// stored or member visible. The arithmetic and the template seeds live in
// `logic/homeProjects.ts`; what is here is scoping and ordering.
// ---------------------------------------------------------------------------

function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active)
    throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function projectsOf(householdId: string): LocalHomeProject[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalHomeProject>('homeProjects');
}

function budgetLinesOf(householdId: string): LocalHomeProjectBudgetLine[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalHomeProjectBudgetLine>('homeProjectBudgetLines');
}

function selectionsOf(householdId: string): LocalHomeProjectSelection[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalHomeProjectSelection>('homeProjectSelections');
}

function optionGroupsOf(householdId: string): LocalHomeProjectOptionGroup[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalHomeProjectOptionGroup>('homeProjectOptionGroups');
}

/**
 * `syncPreferredBudgetLine`, ported — make the group's one budget line say what
 * its winner costs.
 *
 * Mutates the draft in place so the caller can fold it into whatever op it is
 * already writing. That is not a convenience: the pick and the money have to
 * land in the SAME ledger op, or a peer replays a project priced for the option
 * the member just rejected.
 *
 * The group's line is found by "whose `selection_id` is ANY option of this
 * group", which is what makes switching an update rather than an insert — and
 * therefore what preserves `actual_cents` across a switch.
 */
function repricePreferredLine(
  draft: {
    homeProjectSelections: LocalHomeProjectSelection[];
    homeProjectBudgetLines: LocalHomeProjectBudgetLine[];
  },
  group: LocalHomeProjectOptionGroup,
): void {
  const winnerId = group.preferred_selection_id;
  if (!winnerId) return;
  const winner = draft.homeProjectSelections.find(row => row.id === winnerId);
  if (!winner) return;

  const estimate = budgetEstimateCents(
    {
      area_value: group.area_value,
      area_unit: group.area_unit,
      waste_factor_pct: group.waste_factor_pct,
    },
    {
      qty: winner.qty,
      unit_price_cents: winner.unit_price_cents,
      coverage_per_unit: winner.coverage_per_unit,
      coverage_unit: winner.coverage_unit,
    },
  );
  const label = `${group.name} — ${winner.name}`;
  const optionIds = new Set(
    draft.homeProjectSelections
      .filter(row => row.option_group_id === group.id)
      .map(row => row.id),
  );

  const existing = draft.homeProjectBudgetLines.find(
    line => line.selection_id != null && optionIds.has(line.selection_id),
  );

  if (existing) {
    existing.category = 'materials';
    existing.label = label;
    existing.estimate_cents = estimate;
    existing.selection_id = winnerId;
    existing.version += 1;
    return;
  }

  draft.homeProjectBudgetLines.push({
    id: newLocalId('hpbl'),
    household_id: group.household_id,
    project_id: group.project_id,
    category: 'materials',
    label,
    estimate_cents: estimate,
    actual_cents: 0,
    selection_id: winnerId,
    sort_order: 0,
    version: 1,
  });
}

function phasesOf(householdId: string): LocalHomeProjectPhase[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalHomeProjectPhase>('homeProjectPhases');
}

function milestonesOf(householdId: string): LocalHomeProjectMilestone[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalHomeProjectMilestone>('homeProjectMilestones');
}

function blockersOf(householdId: string): LocalHomeProjectBlocker[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalHomeProjectBlocker>('homeProjectBlockers');
}

function attachmentsOf(householdId: string): LocalHomeProjectAttachment[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalHomeProjectAttachment>('homeProjectAttachments');
}

function planLinksOf(householdId: string): LocalHomeProjectPlanLink[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalHomeProjectPlanLink>('homeProjectPlanLinks');
}

function activityOf(householdId: string): LocalHomeProjectActivity[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalHomeProjectActivity>('homeProjectActivity');
}

/**
 * `getOwnedProject` + `checkHouseholdAccess`, which the Worker performs in that
 * order and which collapse to one lookup here: the ledger holds one property,
 * and membership is the session.
 *
 * The message matches the Worker's `NotFoundError('Home project')` because it
 * reaches screens — `withConflict` renders `e.message` in an alert for anything
 * that is not a 409.
 *
 * **Someone else's draft is "not found", not "forbidden"** (migration 0163),
 * which is the Worker's answer for the Worker's reason: "you may not open this"
 * tells a member the project exists, and a draft's whole job is not to say so.
 * The stake is higher here than on the server — a peer's device HOLDS the draft
 * row, because a ledger replicates the household, not a per-member view — so
 * this function is the only thing between a private plan and the wrong reader.
 */
function requireProject(
  householdId: string,
  projectId: string,
): LocalHomeProject {
  const project = projectsOf(householdId).find(row => row.id === projectId);
  if (!project) throw new Error('Home project not found');
  if (!canViewHomeProject(project, getLocalHouseMemberId())) {
    throw new Error('Home project not found');
  }
  return project;
}

/**
 * `requireProjectAccess(…, 'write')`, ported — the gate every local WRITE goes
 * through.
 *
 * A `viewer` grant has to be enforced on device or it is not a grant at all: the
 * ledger accepts whatever the facade writes and syncs it to every peer, so a
 * viewer whose device let the edit through would converge that edit into the
 * household — no Worker in the path to refuse it. The message is the Worker's,
 * because `withConflict` puts it straight into an alert.
 */
function requireProjectOwner(
  householdId: string,
  projectId: string,
): LocalHomeProject {
  const project = requireProject(householdId, projectId);
  if (effectiveHomeProjectRole(project, getLocalHouseMemberId()) !== 'owner') {
    throw new HouseLocalHomeProjectForbiddenError(
      'You have view-only access to this project',
    );
  }
  return project;
}

/** The hub's ordered children all sort on the same column. */
function bySortOrder(
  a: { sort_order: number },
  b: { sort_order: number },
): number {
  return a.sort_order - b.sort_order;
}

/**
 * The next free position in a project's phase or blocker list — the local half
 * of the Worker's `nextSortOrder`, and it must stay the same arithmetic.
 *
 * A household that moved between backends with a different rule would find its
 * lists renumbered relative to each other, which is exactly the class of drift
 * `local-mirror-must-match-worker-encoding` exists to prevent.
 */
function nextSortOrder(
  rows: { project_id: string; sort_order: number }[],
  projectId: string,
): number {
  let max = -1;
  for (const row of rows) {
    if (row.project_id === projectId && row.sort_order > max) {
      max = row.sort_order;
    }
  }
  return max + 1;
}

/**
 * The position a NEW material takes: above everything already on the project —
 * the local half of the Worker's `topSelectionSortOrder`, same arithmetic for
 * the same reason `nextSortOrder` mirrors its counterpart.
 *
 * The materials list prepends where phases and blockers append, because it is
 * the one list that is not a plan: the row a member wants to see is the one
 * they just added, not the eighth item of an AI-seeded shopping list. An empty
 * project starts at 0, so the first material matches every row written before
 * this rule existed.
 */
function topSortOrder(
  rows: { project_id: string; sort_order: number }[],
  projectId: string,
): number {
  let min: number | null = null;
  for (const row of rows) {
    if (row.project_id !== projectId) continue;
    if (min === null || row.sort_order < min) min = row.sort_order;
  }
  return min === null ? 0 : min - 1;
}

/**
 * Resolve a requested order into the full list of this project's ids — the
 * local half of the Worker's `applyOrder`, forgiving in the same way and strict
 * in the same way.
 *
 * Ids the caller omitted keep their place at the END, in their current order, so
 * a row another device added between the read and the drop survives the drop
 * instead of failing it. An id belonging to another project throws: that is a
 * caller bug, not a race, and renumbering someone else's list is the sort of
 * thing nobody finds for months.
 */
function orderIdsForProject(
  rows: { id: string; project_id: string; sort_order: number }[],
  projectId: string,
  ids: string[],
  label: 'Phase' | 'Blocker',
): string[] {
  const mine = rows
    .filter(row => row.project_id === projectId)
    .sort(bySortOrder);
  const owned = new Set(mine.map(row => row.id));

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of ids) {
    if (!owned.has(id)) {
      throw new Error(`${label} ${id} is not part of this project`);
    }
    // First mention wins — a repeated id would otherwise leave one row
    // unnumbered and the result would not be a permutation.
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  for (const row of mine) {
    if (!seen.has(row.id)) ordered.push(row.id);
  }
  return ordered;
}

/** `createAttachmentUpload`'s input, named so the facade can type its half. */
export type LocalCreateAttachmentUploadInput = {
  filename: string;
  file_size: number;
  content_type: string;
  kind?: string;
  selectionId?: string;
  tags?: Array<'before' | 'after'>;
};

/**
 * One attachment row.
 *
 * `status` is the fork the hub filters on (`kind === 'photo' && status ===
 * 'ready'`). A row minted by `createAttachmentUpload` has no bytes yet, so it
 * starts at `'pending_upload'` exactly as D1's default does; one minted by
 * `uploadSelectionPhoto` already has its sealed descriptor and is `'ready'` in
 * the same write. `r2_key` and `url` stay null on a ledger for the reason
 * `localTasksApi` gives: the bytes have no server-side address, and inventing
 * one produces a request that can never resolve.
 */
function attachmentRow(
  householdId: string,
  projectId: string,
  input: LocalCreateAttachmentUploadInput,
  blob: HouseBlobDescriptor | null,
): LocalHomeProjectAttachment {
  return {
    id: newLocalId('hpatt'),
    household_id: householdId,
    project_id: projectId,
    selection_id: input.selectionId ?? null,
    kind: input.kind ?? 'photo',
    filename: input.filename,
    content_type: input.content_type,
    status: blob ? 'ready' : 'pending_upload',
    // JSON, byte-for-byte what the Worker writes (`home-projects-service.ts`:
    // `tags.length ? JSON.stringify(tags) : null`). A comma-joined string looks
    // equivalent and is not: the hub reads this column with `JSON.parse`, so
    // `before` throws, the catch returns [], and a photo the member had just
    // tagged rendered as "untagged" — and the before/after filter then hid it.
    // Caught on device by `home-projects-photos.yaml`; the unit test missed it
    // because it asserted MY encoding rather than the server's.
    tags:
      input.tags && input.tags.length > 0 ? JSON.stringify(input.tags) : null,
    created_at: nowIso(),
    ...(blob ? { blob } : {}),
  };
}

/** Flip a `pending_upload` row to `ready` once its bytes are sealed. */
async function markAttachmentReady(
  householdId: string,
  attachmentId: string,
  blob: HouseBlobDescriptor,
): Promise<LocalHomeProjectAttachment> {
  await writeLocal(
    draft => {
      const row = draft.homeProjectAttachments.find(
        item => item.id === attachmentId,
      );
      if (!row) return;
      row.status = 'ready';
      row.blob = blob;
      row.content_type = blob.mime;
    },
    {
      opType: 'HOME_PROJECT_ATTACHMENT_READY',
      entityType: 'home_project_attachment',
      entityId: attachmentId,
      payload: { status: 'ready', blob },
    },
  );
  const updated = attachmentsOf(householdId).find(
    row => row.id === attachmentId,
  );
  if (!updated)
    throw new Error(`home project attachment ${attachmentId} not found`);
  return updated;
}

/** `ArrayBuffer | Blob` → base64, the only encoding `FileSystem` will write. */
async function toBase64(bytes: ArrayBuffer | Blob): Promise<string> {
  const buffer =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(await bytes.arrayBuffer());
  let binary = '';
  // Chunked so a large scan does not blow the argument limit of `fromCharCode`.
  const STRIDE = 0x8000;
  for (let index = 0; index < buffer.length; index += STRIDE) {
    binary += String.fromCharCode(...buffer.subarray(index, index + STRIDE));
  }
  return globalThis.btoa(binary);
}

/** `listActivity`'s order: newest first. */
function byCreatedAtDesc(
  a: { created_at: string },
  b: { created_at: string },
): number {
  return b.created_at.localeCompare(a.created_at);
}

/**
 * `recordActivity`, ported — minus the idempotency branch.
 *
 * `recordActivity` takes an optional `idempotencyKey` and **no call site in the
 * service ever passes one**, so the dedupe select it guards is dead code on the
 * server. The column is not on the DTO and is not ledgered (`types.ts`), and
 * reproducing the dedupe would be actively wrong on a ledger: two members acting
 * offline are two events, and folding them together on a key nobody sets would
 * hide one member's work from the other.
 *
 * Returns the row rather than pushing it, because every caller writes it inside
 * the SAME op as the thing it records — a peer that received "selection added"
 * without the selection would show an event for a row it does not have.
 */
function activityRow(
  householdId: string,
  projectId: string,
  action: string,
  entityType: string | null,
  entityId: string | null,
  meta?: Record<string, unknown>,
): LocalHomeProjectActivity {
  return {
    id: newLocalId('hpact'),
    household_id: householdId,
    project_id: projectId,
    actor_user_id: getLocalHouseMemberId(),
    action,
    entity_type: entityType,
    entity_id: entityId,
    meta_json: meta ? JSON.stringify(meta) : null,
    created_at: nowIso(),
  };
}

/**
 * `getHub`, ported — shared by `getHub` and `exportSummary` so the two cannot
 * drift, exactly as the Worker shares it (`exportProjectSummary` calls
 * `this.getHub`).
 *
 * Three details are the service's and are easy to lose by being reasonable:
 *
 *  - **`rollups` is computed over the CAPPED lines**, not over all of them
 *    (`computeRollups(project, budgetLines.slice(0, HUB_CHILD_CAP))`). A project
 *    with 201 budget lines therefore reports a total that omits the last one, on
 *    both backends. Reproduced.
 *  - **only three children are ordered.** Selections, budget lines and phases
 *    carry `.orderBy(asc(sort_order))`; milestones, blockers, attachments and
 *    plan links are returned in whatever order the query gave. On the ledger
 *    "whatever order" is the row array's, which is not the same arbitrary order
 *    D1 would produce — but neither is stable and no screen depends on either.
 *  - **`geometry` is the newest row, ordered by `updated_at`** — the Worker's
 *    `.orderBy(desc(homeProjectGeometry.updated_at))`, reproduced.
 *
 *    This used to return a hardcoded `null`, on the grounds that
 *    `home_project_geometry` was Tier D and never ledgered. **That stopped
 *    being true at the H13 D-wave**, which ledgered the table and made
 *    `putManualGeometry` / `putRoomPlanGeometry` local writes — but the read
 *    was never updated to match. The result was the worst shape a local-first
 *    gap can take: the write succeeded, the row was in the ledger, it synced to
 *    every peer, and `getHub` reported no geometry to anybody. A member laid
 *    out a room, watched it save, went back to the hub and was offered the
 *    empty state again.
 *
 *    Nothing failed and nothing logged. It was only visible because the surface
 *    planner holds its model in component state after creating it, so the room
 *    was there until the screen was left.
 *
 * `space_ids` is `[]` for a harder reason, and it is the one place in this
 * facade where a member genuinely loses something. `home_project_spaces` is a
 * PK-less join table (hazard S2) and cannot be ledgered at all, so the rooms a
 * member ticks in the create wizard are accepted and not stored. Nothing renders
 * `space_ids` today — the wizard reads its own draft state — so the loss is
 * invisible rather than wrong, and it un-blocks itself the day the backend
 * models the link as an array on the parent — which is exactly what migration
 * 0170 did for `home_project_tasks`, and is the worked example to copy when
 * somebody takes `home_project_spaces` next.
 */
function buildHub(householdId: string, projectId: string): HomeProjectHub {
  const project = requireProject(householdId, projectId);
  const cap = HOME_PROJECT_HUB_CHILD_CAP;
  const forProject = <T extends { project_id: string }>(rows: T[]): T[] =>
    rows.filter(row => row.project_id === projectId);

  const selections = forProject(selectionsOf(householdId)).sort(bySortOrder);
  const budgetLines = forProject(budgetLinesOf(householdId)).sort(bySortOrder);
  const phases = forProject(phasesOf(householdId)).sort(bySortOrder);

  return {
    project,
    // The hub is the only read every project surface makes, so the role rides
    // on it here exactly as it does on the Worker's — the screen must not have
    // to resolve `access_json` itself, or the button it disables and the write
    // this facade refuses stop being the same rule.
    my_role: effectiveHomeProjectRole(project, getLocalHouseMemberId()),
    space_ids: [],
    rollups: computeBudgetRollups(project, budgetLines.slice(0, cap)),
    selections: selections.slice(0, cap),
    option_groups: forProject(optionGroupsOf(householdId))
      .sort(bySortOrder)
      .slice(0, cap),
    budget_lines: budgetLines.slice(0, cap),
    phases: phases.slice(0, cap),
    milestones: forProject(milestonesOf(householdId)).slice(0, cap),
    // Sorted since migration 0171 gave blockers a `sort_order` and the Worker's
    // `getProject` started ordering on it. Unsorted here would mean the same
    // household saw a different blocker order depending on which backend
    // answered — the one thing this facade exists not to do.
    blockers: forProject(blockersOf(householdId))
      .sort(bySortOrder)
      .slice(0, cap),
    attachments: forProject(attachmentsOf(householdId)).slice(0, cap),
    plan_links: forProject(planLinksOf(householdId)).slice(0, cap),
    geometry: newestGeometry(householdId, projectId),
  };
}

/**
 * The newest geometry row for a project, or null.
 *
 * `updated_at` descending — the Worker's order
 * (`orderBy(desc(homeProjectGeometry.updated_at))`) — and it matters because a
 * project can hold one row per source: a hand-drawn layout beside a RoomPlan
 * scan. The hub shows whichever was touched last.
 *
 * **`created_at` and then `id` break a tie, which the Worker does not do.**
 * `nowIso()` has millisecond resolution, so two writes in the same millisecond
 * carry the same `updated_at`, and with no tiebreak the answer is whatever the
 * sort happened to do — a coin flip deciding *which room layout a member sees*.
 * D1 leaves that to SQLite's scan order, which is unspecified and not something
 * to reproduce. An arbitrary but stable rule is strictly better than an
 * arbitrary unstable one, and the divergence is unreachable through the UI:
 * picking manual and then scanning are seconds apart, not microseconds.
 *
 * String comparison throughout: `nowIso()` is `toISOString()`, and ISO-8601 in
 * UTC sorts lexicographically. Parsing to `Date` is the same answer with more
 * allocation.
 */
function newestGeometry(
  householdId: string,
  projectId: string,
): LocalHomeProjectGeometry | null {
  requireActiveProperty(householdId);
  const rows = rowsOf<LocalHomeProjectGeometry>('homeProjectGeometry')
    .filter(row => row.project_id === projectId)
    .sort(
      (a, b) =>
        (b.updated_at ?? '').localeCompare(a.updated_at ?? '') ||
        (b.created_at ?? '').localeCompare(a.created_at ?? '') ||
        b.id.localeCompare(a.id),
    );
  return rows[0] ?? null;
}

export const localHomeProjectsApi = {
  // ---- the catalogue ------------------------------------------------------

  /**
   * `GET /templates` — LOCAL, out of a compiled-in constant.
   *
   * The one method here that looks like a Tier C read. It is not declared
   * remote-only for a reason that has nothing to do with privacy: `create` seeds
   * a template's phases, selections, blockers and budget lines as LEDGER ROWS,
   * so `logic/homeProjects.ts` has to hold the catalogue anyway, and serving the
   * wizard's list from the Worker as well would give one fact two sources. It
   * also works with no signal, which the remote one does not.
   *
   * The route does NOT check household membership (`/templates` is the only
   * home-project route without `checkHouseholdAccess`), so neither does this —
   * `requireActiveProperty` is deliberately absent. A wizard opened while a
   * different property is active must still be able to list templates.
   *
   * The cost hint both backends used to carry is gone — see `listTemplates` in
   * `home-projects-service.ts`. Three fields is now the whole DTO, so the
   * omit-vs-undefined care this comment used to describe no longer applies.
   */
  listTemplates: async (
    _householdId: string,
  ): Promise<{ templates: HomeProjectTemplate[] }> => ({
    templates: Object.values(HOME_PROJECT_TEMPLATE_SEEDS).map(seed => ({
      key: seed.key,
      title: seed.title,
      type: seed.type,
    })),
  }),

  // ---- the project --------------------------------------------------------

  /**
   * `GET /` — LOCAL, and four decisions rather than a table dump.
   *
   * `listProjects` hides archived projects UNLESS a status filter asks for them
   * (`else conditions.push(ne(status, 'archived'))`), so passing
   * `{ status: 'archived' }` is the only way to see one — which is exactly what
   * `useHomeProjects({ includeArchived: true })` does, in a second call. Both
   * halves are ported, because getting the `else` wrong would either hide every
   * archived project forever or show them all in the default list.
   *
   * The title search is D1's `like(title, '%q%')`, and SQLite's `LIKE` is
   * case-insensitive for ASCII, so the local form lower-cases both sides. The
   * service's `type` and `spaceId` filters have no counterpart: the client
   * module cannot express either (and `spaceId` reads `home_project_spaces`,
   * which is S2 and unledgerable).
   *
   * The DRAFT filter (migration 0163) is the fifth decision and the one that
   * has to be exact. A ledger is not a per-member view: every member's device
   * holds every row of the household, including another member's private draft,
   * so unlike the Worker — which could simply not SELECT it — the only thing
   * standing between a draft and the wrong pair of eyes is this predicate. It is
   * `canViewHomeProject` from `@symply/contracts`, the same function the Worker
   * calls, because a draft that is private online and listed offline is not a
   * draft.
   */
  list: async (householdId: string, params?: LocalHomeProjectFilters) => {
    const query = params?.q?.toLowerCase();
    const memberId = getLocalHouseMemberId();
    const projects = projectsOf(householdId)
      .filter(row => {
        if (!canViewHomeProject(row, memberId)) return false;
        if (params?.status) {
          if (row.status !== params.status) return false;
        } else if (row.status === 'archived') {
          return false;
        }
        if (query && !row.title.toLowerCase().includes(query)) return false;
        return true;
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    // The list card renders the cover, and on this backend `cover_attachment_id`
    // resolves to a SEALED BLOB, never a URL — the Worker's `cover_url` has no
    // meaning here, so the descriptor rides along instead and `HouseBlobImage`
    // is the only thing that can open it. Same shape the hub's photo rows use.
    const covers = attachmentsOf(householdId);
    return {
      projects: projects.map(row => {
        const my_role = effectiveHomeProjectRole(row, memberId);
        if (!row.cover_attachment_id) {
          return { ...row, cover_url: null, cover_blob: null, my_role };
        }
        const cover = covers.find(
          a => a.id === row.cover_attachment_id && a.project_id === row.id,
        );
        return {
          ...row,
          cover_url: null,
          cover_blob: cover?.status === 'ready' ? cover.blob ?? null : null,
          my_role,
        };
      }),
    };
  },

  /**
   * `POST /` — the biggest write in the facade, and ONE op.
   *
   * A template seeds up to six phases, six selections, three blockers and five
   * budget lines alongside the project and its activity row — twenty rows across
   * five tables at the widest. One op, because a peer that received the project
   * without its phases would render a renovation with no schedule and nothing on
   * the screen would suggest anything was missing. B3's `deleteProject` made the
   * same call in the opposite direction.
   *
   * Three details are the service's:
   *
   *  - **an explicit `id` makes this idempotent.** `createProject` looks the id
   *    up first and RETURNS the existing project rather than erroring, which is
   *    what lets the wizard retry a create it is not sure landed. Reproduced —
   *    and the `ConflictError` branch beside it (id exists in another household)
   *    cannot arise on a ledger that holds one property.
   *  - **the title falls back through the template**, then to
   *    `'New home project'`, and `input.title?.trim() ||` means a
   *    whitespace-only title takes the fallback rather than being stored.
   *  - **`contingency_pct` falls through to 0**, not to 15. Templates seed no
   *    rate, so a project created without one gets no buffer either — the member
   *    turns contingency on from the Budget tab if they want it.
   *
   * `spaceIds` is accepted and not stored — `home_project_spaces` is S2. See
   * `buildHub`.
   */
  create: async (householdId: string, input: CreateHomeProjectInput) => {
    requireActiveProperty(householdId);
    const existingId = input.id;
    if (existingId) {
      const existing = projectsOf(householdId).find(
        row => row.id === existingId,
      );
      if (existing) return { project: existing };
    }

    const template = getHomeProjectTemplateSeed(input.templateKey);
    const projectId = existingId || newLocalId('hpj');
    const now = nowIso();
    const memberId = getLocalHouseMemberId();
    // 0, not 15 — matching `home-projects-service.ts`. A project the app has never
    // seen priced does not get a buffer invented for it, and every template seeds
    // 0 too, so this last fallback (no template at all) must agree with them.
    const contingencyPct =
      input.contingencyPct ?? template?.contingencyPct ?? 0;

    const project: LocalHomeProject = {
      id: projectId,
      household_id: householdId,
      title: input.title?.trim() || template?.title || 'New home project',
      type: input.type || template?.type || 'renovation',
      template_key: template?.key ?? input.templateKey ?? null,
      status: 'planning',
      // The Worker normalises the same way, so an unrecognised string is
      // `published` on both backends rather than stored raw on one of them.
      visibility: normalizeHomeProjectVisibility(input.visibility),
      // D1's defaults, written explicitly because a ledger has none: an absent
      // `default_role` would be `undefined` on the row, and while
      // `normalizeHomeProjectRole` reads that as `owner` anyway, a column the
      // access sheet writes has to exist before it can be edited.
      default_role: 'owner',
      access_json: null,
      summary: input.summary ?? null,
      // Not on `CreateHomeProjectInput`, so no caller can seed them; D1 has both
      // columns and the service writes null for the same reason.
      goals: null,
      constraints: null,
      target_budget_cents: input.targetBudgetCents ?? null,
      currency: 'USD',
      contingency_pct: contingencyPct,
      target_start_at: null,
      target_end_at: input.targetEndAt ?? null,
      cover_attachment_id: null,
      created_by: memberId,
      updated_by: memberId,
      created_at: now,
      updated_at: now,
    };

    const phases: LocalHomeProjectPhase[] = (template?.phases ?? []).map(
      seed => ({
        id: newLocalId('hpph'),
        household_id: householdId,
        project_id: projectId,
        title: seed.title,
        status: 'pending',
        starts_on: null,
        ends_on: null,
        sort_order: seed.sortOrder,
      }),
    );

    // `sort_order` is the seed's INDEX, matching the Worker: unlike
    // `template.phases` the blocker seeds carry no `sortOrder` of their own, and
    // the order the template lists them in is the order it means.
    const blockers: LocalHomeProjectBlocker[] = (template?.blockers ?? []).map(
      (seed, index) => ({
        id: newLocalId('hpblk'),
        household_id: householdId,
        project_id: projectId,
        title: seed.title,
        severity: seed.severity,
        status: 'open',
        notes: null,
        sort_order: index,
        created_at: now,
      }),
    );

    // A template seeds the budget ROWS, never the money, and a project with no
    // template seeds nothing at all. Both used to seed a `contingency` line — the
    // template with a national-average figure, the blank one at zero — and
    // `computeBudgetRollups` prefers an explicit contingency line to the
    // percentage (`??`, and zero is a value). So a blank project's buffer was
    // pegged at zero for life, and a templated one opened on a number nobody in
    // this household had agreed to.
    const budgetLines: LocalHomeProjectBudgetLine[] = (
      template?.budgetLines ?? []
    ).map(seed => ({
      id: newLocalId('hpbl'),
      household_id: householdId,
      project_id: projectId,
      category: seed.category,
      label: seed.label,
      estimate_cents: 0,
      actual_cents: 0,
      // A template line is a row to price by hand, not one derived from a
      // selection — the derived ones are minted by `createSelection`.
      selection_id: null,
      sort_order: seed.sortOrder,
      version: 1,
    }));

    // `JSON.stringify({ templateKey: undefined })` is `'{}'`, which is what the
    // Worker stores for a blank project. Reproduced by passing the same object.
    const activity = activityRow(
      householdId,
      projectId,
      'project_created',
      'project',
      projectId,
      {
        templateKey: template?.key,
      },
    );

    await writeLocal(
      draft => {
        draft.homeProjects.push(project);
        draft.homeProjectPhases.push(...phases);
        draft.homeProjectBlockers.push(...blockers);
        draft.homeProjectBudgetLines.push(...budgetLines);
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_CREATE',
        entityType: 'home_project',
        entityId: projectId,
        payload: { ...project, template_key: project.template_key },
      },
    );

    return { project };
  },

  /**
   * `GET /:projectId/hub` — the whole feature in one read, and the method that
   * makes leaving this module remote unthinkable. See `buildHub`.
   */
  getHub: async (
    householdId: string,
    projectId: string,
  ): Promise<HomeProjectHub> => buildHub(householdId, projectId),

  /**
   * `PATCH /:projectId` — absent means "leave it alone".
   *
   * The Worker builds its `set` out of `patch.x !== undefined ? { … } : {}` per
   * field, so an explicit `null` clears a column and an empty string is stored
   * as an empty string. Reproduced field by field rather than by spreading, for
   * `localProjectsApi`'s reason: matching the service exactly is what keeps a
   * project renamed offline and one renamed online byte-identical.
   *
   * `updated_by` and `updated_at` are always written, even for an empty patch —
   * the service does the same — and the `project_updated` activity row goes in
   * the SAME op.
   *
   * **A publish is its own event.** When `visibility` is in the patch the
   * activity row is `project_published` / `project_unpublished` rather than
   * `project_updated`, exactly as the Worker records it. The feed is the only
   * record a household has of when a plan stopped being one person's private
   * draft, and folding it into the generic update erases that on one backend
   * and not the other.
   */
  update: async (
    householdId: string,
    projectId: string,
    patch: UpdateLocalHomeProjectInput,
  ) => {
    requireProjectOwner(householdId, projectId);
    // The service rejects a cover that is not this project's own attachment
    // (`home-projects-service.ts`), and the same guard has to stand here or a
    // project fixed up offline would converge with an id the Worker refused.
    if (patch.coverAttachmentId) {
      const cover = attachmentsOf(householdId).find(
        row =>
          row.id === patch.coverAttachmentId && row.project_id === projectId,
      );
      if (!cover) throw new Error('Cover attachment not found');
    }
    const memberId = getLocalHouseMemberId();
    const visibility =
      patch.visibility !== undefined
        ? normalizeHomeProjectVisibility(patch.visibility)
        : undefined;
    const activity =
      visibility !== undefined
        ? activityRow(
            householdId,
            projectId,
            visibility === 'published'
              ? 'project_published'
              : 'project_unpublished',
            'project',
            projectId,
            { visibility },
          )
        : activityRow(
            householdId,
            projectId,
            'project_updated',
            'project',
            projectId,
          );

    await writeLocal(
      draft => {
        const project = draft.homeProjects.find(
          row => row.id === projectId && row.household_id === householdId,
        );
        if (!project) throw new Error('Home project not found');
        if (patch.title !== undefined) project.title = patch.title;
        if (patch.type !== undefined) project.type = patch.type;
        if (patch.status !== undefined) project.status = patch.status;
        if (patch.summary !== undefined) project.summary = patch.summary;
        if (patch.targetBudgetCents !== undefined) {
          project.target_budget_cents = patch.targetBudgetCents;
        }
        if (patch.contingencyPct !== undefined)
          project.contingency_pct = patch.contingencyPct;
        if (patch.targetEndAt !== undefined)
          project.target_end_at = patch.targetEndAt;
        if (patch.coverAttachmentId !== undefined) {
          project.cover_attachment_id = patch.coverAttachmentId;
        }
        if (visibility !== undefined) project.visibility = visibility;
        project.updated_by = memberId;
        project.updated_at = nowIso();
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_UPDATE',
        entityType: 'home_project',
        entityId: projectId,
        payload: patch,
      },
    );

    return { project: requireProject(householdId, projectId) };
  },

  /**
   * `POST /:projectId/archive` — a status flip, and the closest thing this
   * feature has to a delete.
   *
   * `archiveProject` is literally `updateProject({ status: 'archived' })`, so it
   * records `project_updated` rather than an archive-specific event and it
   * leaves every child row in place. That is why the thirteen-way cascade in D1
   * has nothing to do: the parent never leaves. See this module's header.
   */
  archive: async (householdId: string, projectId: string) =>
    localHomeProjectsApi.update(householdId, projectId, { status: 'archived' }),

  /**
   * `DELETE /:projectId` — the project AND its ten ledgered children, in ONE op.
   *
   * This is the caller `HOME_PROJECT_CHILD_TABLES` was named for, and the
   * comment above it that said "nothing deletes a home project on either
   * backend" is now wrong — deliberately so. Everything it warned about still
   * applies:
   *
   *  - **A ledger has no foreign key.** D1 cascades thirteen children; here the
   *    parent simply disappears and any child left behind is an orphan that
   *    syncs to every peer and is never read again. B2 shipped exactly that at
   *    the contractor level and nothing failed, because an orphan has nothing to
   *    complain to.
   *  - **ONE op, not eleven.** `mutateLocalHouseLedger` diffs the whole ledger
   *    per call, so eleven writes would be eleven ops a peer applies one at a
   *    time — and in between it holds budget lines belonging to a project that
   *    no longer exists, which is how a "total spent" figure outlives the
   *    renovation it paid for.
   *  - **The three S2 joins are not in the list and cannot be.**
   *    `home_project_spaces`, `home_project_tasks` and `home_project_contractors`
   *    have no `id` column, so they are not ledgered at all — there is nothing
   *    on device to leave behind.
   *
   * Sealed attachment blobs are NOT unsealed here. The H6 channel is content
   * addressed and a blob may be referenced by more than one row; dropping the
   * rows makes the bytes unreachable, and reclaiming them is the blob GC's job,
   * not this write's.
   */
  remove: async (householdId: string, projectId: string): Promise<void> => {
    requireProjectOwner(householdId, projectId);
    await writeLocal(
      draft => {
        draft.homeProjects = draft.homeProjects.filter(
          row => row.id !== projectId,
        );
        for (const table of HOME_PROJECT_CHILD_TABLES) {
          draft[table] = (
            draft[table] as unknown as Array<{ project_id: string }>
          ).filter(row => row.project_id !== projectId) as never;
        }
      },
      {
        opType: 'HOME_PROJECT_DELETE',
        entityType: 'home_project',
        entityId: projectId,
        payload: { id: projectId },
      },
    );
  },

  /**
   * `GET /:projectId/access` — every household member and their role here.
   *
   * The Worker joins `household_members` to `users`; the device has neither
   * table. What it has is `householdRoster`, which turns control-plane state
   * into the SAME `HouseholdMember[]` shape and publishes it into
   * `householdStore` — so the roster is read from the store rather than the
   * ledger, and this is the one method in the facade that reaches outside it.
   *
   * A roster that has not landed yet (fresh install, no control-plane trip)
   * yields just this device's own member, which is what `ensureSession` seeds.
   * That is an honest answer — one row that says "you, owner" — and not a
   * silence: the sheet renders it and says a roster is still syncing rather
   * than showing an empty household.
   */
  getAccess: async (
    householdId: string,
    projectId: string,
  ): Promise<HomeProjectAccessView> => {
    const project = requireProject(householdId, projectId);
    const memberId = getLocalHouseMemberId();
    const grantByUser = new Map(
      parseHomeProjectAccessGrants(project.access_json).map(g => [
        g.user_id,
        g.role,
      ]),
    );
    const defaultRole = normalizeHomeProjectRole(project.default_role);

    // Narrow require, for `localApiProxy.ts`'s reason: the store barrel drags
    // the sync orchestrator into every facade call from every screen.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useHouseholdStore } = require('@stores/householdStore');
    const roster = useHouseholdStore.getState()
      .currentHouseholdMembers as Array<{
      user_id: string;
      display_name: string | null;
      email: string | null;
      avatar_url: string | null;
    }>;

    const members: HomeProjectAccessMember[] = (roster ?? []).map(row => {
      const isCreator =
        !!project.created_by && project.created_by === row.user_id;
      const granted = grantByUser.get(row.user_id);
      return {
        user_id: row.user_id,
        display_name: row.display_name ?? null,
        email: row.email ?? null,
        avatar_url: row.avatar_url ?? null,
        role: isCreator ? 'owner' : granted ?? defaultRole,
        source: isCreator ? 'creator' : granted ? 'grant' : 'default',
      };
    });

    return {
      project_id: projectId,
      visibility: normalizeHomeProjectVisibility(project.visibility),
      default_role: defaultRole,
      my_role: effectiveHomeProjectRole(project, memberId),
      members,
    };
  },

  /**
   * `PUT /:projectId/access` — the whole list, one op.
   *
   * The Worker drops grants naming someone who is not a household member. That
   * filter is deliberately NOT reproduced: on device the roster is
   * control-plane state that may not have arrived, and filtering against an
   * empty roster would silently discard every grant the member just set. The
   * grants are stored as given; `effectiveHomeProjectRole` only ever consults
   * the entry matching the reader, so a stale user id is inert rather than
   * wrong. The creator's entry IS dropped, because their `owner` is pinned by
   * the resolver and storing an override that cannot take effect reads, on the
   * next open, like a rule being ignored.
   */
  setAccess: async (
    householdId: string,
    projectId: string,
    input: { defaultRole: HomeProjectRole; grants: HomeProjectAccessGrant[] },
  ): Promise<HomeProjectAccessView> => {
    const project = requireProjectOwner(householdId, projectId);
    const grants = input.grants.filter(
      grant => grant.user_id !== project.created_by,
    );
    const defaultRole = normalizeHomeProjectRole(input.defaultRole);
    const accessJson = serializeHomeProjectAccessGrants(grants);
    const memberId = getLocalHouseMemberId();
    const activity = activityRow(
      householdId,
      projectId,
      'project_access_changed',
      'project',
      projectId,
      { defaultRole, grants: grants.length },
    );

    await writeLocal(
      draft => {
        const row = draft.homeProjects.find(
          p => p.id === projectId && p.household_id === householdId,
        );
        if (!row) throw new Error('Home project not found');
        row.default_role = defaultRole;
        row.access_json = accessJson;
        row.updated_by = memberId;
        row.updated_at = nowIso();
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_ACCESS_SET',
        entityType: 'home_project',
        entityId: projectId,
        payload: { default_role: defaultRole, access_json: accessJson },
      },
    );

    return localHomeProjectsApi.getAccess(householdId, projectId);
  },

  // ---- selections ---------------------------------------------------------

  /**
   * `POST /:projectId/selections` — the selection, its derived budget line and
   * the activity row, in ONE op.
   *
   * The budget line is the part worth reading. `createSelection` calls
   * `createBudgetLine` when `unitPriceCents` is present AND positive, with
   * `estimateCents: unitPriceCents * qty` and `category: 'materials'` — so
   * pricing a vanity at $800 puts $800 into the estimate immediately, and the
   * rollup badge moves. Splitting that across two ops would let a peer hold a
   * priced selection whose money is missing from the total.
   *
   * `selection_id` is NOT recorded on the line, because the DTO has no such
   * field and nothing reads it (`types.ts`, divergence 3). The link is
   * write-only on the server too — even `deleteSelection` leaves the derived
   * line in place.
   *
   * `maybeNotifyBudgetOver` is deliberately not reproduced: it pushes a
   * notification to the other members, and notifications are Tier B. A device
   * with no signal has nothing to send one with, and the badge the member
   * actually looks at is `rollups.budget_health`, which is recomputed on every
   * hub read.
   */
  createSelection: async (
    householdId: string,
    projectId: string,
    input: CreateLocalHomeProjectSelectionInput,
  ) => {
    requireProjectOwner(householdId, projectId);
    if (input.optionGroupId) {
      const group = optionGroupsOf(householdId).find(
        row => row.id === input.optionGroupId && row.project_id === projectId,
      );
      if (!group) throw new Error('Option group not found');
    }

    const selection: LocalHomeProjectSelection = {
      id: newLocalId('hpsel'),
      household_id: householdId,
      project_id: projectId,
      name: input.name,
      category: input.category ?? 'other',
      status: input.status ?? 'idea',
      qty: input.qty ?? 1,
      unit: input.unit ?? null,
      unit_price_cents: input.unitPriceCents ?? null,
      vendor: input.vendor ?? null,
      product_url: input.productUrl ?? null,
      notes: input.notes ?? null,
      option_group_id: input.optionGroupId ?? null,
      brand: input.brand ?? null,
      sku: input.sku ?? null,
      image_url: input.imageUrl ?? null,
      coverage_per_unit: input.coveragePerUnit ?? null,
      coverage_unit: input.coverageUnit ?? null,
      specs_json: input.specs?.length ? JSON.stringify(input.specs) : null,
      // Appearance and the offer (migration 0164). Written as explicit nulls
      // rather than left off the row: the ledger row IS the DTO, and a key that
      // is absent here is a key the projection cannot distinguish from one the
      // member cleared. The offer columns have no local writer yet — the sale
      // is a fact off a shop page, which only the link import reads.
      color_hex: input.colorHex ?? null,
      grout_color_hex: input.groutColorHex ?? null,
      unit_w_mm: input.unitWMm ?? null,
      unit_h_mm: input.unitHMm ?? null,
      list_price_cents: null,
      sale_price_cents: null,
      discount_pct: null,
      sale_ends_at: null,
      // `createFromLink` is the only caller that passes anything else, and
      // never `'link_og'` — no page is fetched on this backend.
      extraction_source: input.extractionSource ?? 'manual',
      extraction_confidence: input.extractionConfidence ?? null,
      // TOP of the list, not the bottom — see `topSortOrder`. A caller seeding
      // a plan names its own positions instead, which is the only way the
      // Smart Project wizard's row-at-a-time write keeps the plan's order.
      sort_order:
        input.sortOrder ??
        topSortOrder(selectionsOf(householdId), projectId),
      version: 1,
    };

    // A GROUPED option is a candidate, not a decision, so it buys nothing until
    // it wins — five flooring options must not put five floors in the estimate.
    // Ungrouped selections keep the original rule byte for byte.
    const priced =
      !input.optionGroupId &&
      input.unitPriceCents != null &&
      input.unitPriceCents > 0;
    const budgetLine: LocalHomeProjectBudgetLine | null = priced
      ? {
          id: newLocalId('hpbl'),
          household_id: householdId,
          project_id: projectId,
          category: 'materials',
          label: input.name,
          estimate_cents: input.unitPriceCents! * selection.qty,
          actual_cents: 0,
          selection_id: selection.id,
          sort_order: 0,
          version: 1,
        }
      : null;

    const activity = activityRow(
      householdId,
      projectId,
      'selection_added',
      'selection',
      selection.id,
    );

    await writeLocal(
      draft => {
        draft.homeProjectSelections.push(selection);
        if (budgetLine) draft.homeProjectBudgetLines.push(budgetLine);
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_SELECTION_CREATE',
        entityType: 'home_project_selection',
        entityId: selection.id,
        payload: selection,
      },
    );

    return { selection };
  },

  /**
   * `PATCH /:projectId/selections/:selectionId` — with the optimistic-concurrency
   * check, which is the only 409 in the facade.
   *
   * The Worker compares the caller's `version` against the stored one and raises
   * `ConflictError('Selection was updated by someone else')` when they differ.
   * That is reproduced exactly, in the axios-shaped form
   * `isHomeProjectConflict` reads — see `HouseLocalHomeProjectConflictError`.
   *
   * **On a ledger the check is weaker than it looks, and that is not a defect.**
   * Two members editing offline both hold version 3, both write version 4, and
   * per-field LWW resolves the fields rather than the row — so neither sees a
   * conflict and the later HLC wins per column. The version guard still does its
   * job for the case it was written for (a stale screen on THIS device, which is
   * how a member actually hits it) and the merge does the multi-device job
   * properly, surfacing the loss through `conflicts` (BR-044) rather than through
   * a 409 nobody would be there to read.
   *
   * `version` is incremented from the STORED row, not from the caller's, which
   * matters when the caller omits it.
   */
  updateSelection: async (
    householdId: string,
    projectId: string,
    selectionId: string,
    patch: UpdateLocalHomeProjectSelectionInput,
  ) => {
    requireProjectOwner(householdId, projectId);
    const existing = selectionsOf(householdId).find(
      row => row.id === selectionId && row.project_id === projectId,
    );
    if (!existing) throw new Error('Selection not found');
    if (patch.version != null && patch.version !== existing.version) {
      throw new HouseLocalHomeProjectConflictError(
        'Selection was updated by someone else',
      );
    }

    const activity = activityRow(
      householdId,
      projectId,
      'selection_updated',
      'selection',
      selectionId,
    );

    await writeLocal(
      draft => {
        const selection = draft.homeProjectSelections.find(
          row => row.id === selectionId,
        );
        if (!selection) throw new Error('Selection not found');
        if (patch.name !== undefined) selection.name = patch.name;
        if (patch.status !== undefined) selection.status = patch.status;
        if (patch.unitPriceCents !== undefined) {
          selection.unit_price_cents = patch.unitPriceCents;
        }
        if (patch.productUrl !== undefined)
          selection.product_url = patch.productUrl;
        if (patch.notes !== undefined) selection.notes = patch.notes;
        if (patch.qty !== undefined) selection.qty = patch.qty;
        if (patch.unit !== undefined) selection.unit = patch.unit;
        if (patch.vendor !== undefined) selection.vendor = patch.vendor;
        if (patch.optionGroupId !== undefined) {
          selection.option_group_id = patch.optionGroupId;
        }
        if (patch.brand !== undefined) selection.brand = patch.brand;
        if (patch.sku !== undefined) selection.sku = patch.sku;
        if (patch.imageUrl !== undefined) selection.image_url = patch.imageUrl;
        if (patch.coveragePerUnit !== undefined) {
          selection.coverage_per_unit = patch.coveragePerUnit;
        }
        if (patch.coverageUnit !== undefined)
          selection.coverage_unit = patch.coverageUnit;
        if (patch.specs !== undefined) {
          selection.specs_json = patch.specs?.length
            ? JSON.stringify(patch.specs)
            : null;
        }
        selection.version = existing.version + 1;

        // Editing the WINNER's price, coverage or qty changes what the project
        // costs, so its line moves in the same op. Editing a loser changes
        // nothing, which is the whole point of shopping options.
        if (selection.option_group_id) {
          const group = draft.homeProjectOptionGroups.find(
            row => row.id === selection.option_group_id,
          );
          if (group?.preferred_selection_id === selectionId) {
            repricePreferredLine(draft, group);
          }
        }
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_SELECTION_UPDATE',
        entityType: 'home_project_selection',
        entityId: selectionId,
        payload: patch,
      },
    );

    const updated = selectionsOf(householdId).find(
      row => row.id === selectionId,
    );
    if (!updated) throw new Error('Selection not found');
    return { selection: updated as HomeProjectSelection };
  },

  /**
   * `POST /:projectId/selections/from-link` — an EGRESS throw, which is a
   * category no earlier sub-wave produced.
   *
   * The Worker fetches the URL the member pasted (`safeFetchUrl`, behind an SSRF
   * guard), parses its OpenGraph tags and turns the title, description and price
   * into a selection. Nothing about that needs a model or a bucket, so it looks
   * portable — and it is not. A device doing the fetch would make an unsolicited
   * request from the member's own network to a vendor's server, revealing their
   * IP and the fact that they are shopping for a bathroom, which is precisely the
   * class of outbound traffic H7's egress allowlist exists to forbid. Routing it
   * to the Worker instead is no better: the URL is the member's own browsing.
   *
   * The copy therefore names the one-step workaround rather than the mechanism —
   * add the selection and paste the link into it — because that produces the
   * same row with one more tap.
   */
  /**
   * `DELETE /:projectId/selections/:selectionId` — LOCAL, and the FIRST delete
   * this facade has ever exposed.
   *
   * The module header's cascade audit concluded "nothing deletes a home
   * project row on either backend", and named `HOME_PROJECT_CHILD_TABLES`
   * against the day one appeared. This is that day, at the leaf rather than at
   * the parent: a member could add a material and never remove it, so a project
   * accumulated every mistake and every template-seeded guess forever.
   *
   * **The two side-effects are the service's and both matter.** A selection can
   * be a group's chosen winner, and neither pointer is a foreign key —
   * `option_groups.preferred_selection_id` and `budget_lines.selection_id` are
   * plain text by design (0162), so nothing cascades on either backend:
   *
   *  - the group goes back to undecided, and
   *  - **its money leaves the estimate with it.** Leaving the budget line would
   *    quote a floor the project no longer has an option for.
   *
   * All of it in ONE op, including the activity row: a peer that received the
   * deletion without the budget correction would hold a total that cannot be
   * reproduced from its own rows.
   */
  deleteSelection: async (
    householdId: string,
    projectId: string,
    selectionId: string,
  ) => {
    requireProject(householdId, projectId);
    const existing = selectionsOf(householdId).find(
      row => row.id === selectionId && row.project_id === projectId,
    );
    if (!existing) return { success: true as const };

    const group = existing.option_group_id
      ? optionGroupsOf(householdId).find(
          row => row.id === existing.option_group_id,
        )
      : undefined;
    const wasPreferred = group?.preferred_selection_id === selectionId;

    const activity = activityRow(
      householdId,
      projectId,
      'selection_deleted',
      'selection',
      selectionId,
    );

    await writeLocal(
      draft => {
        draft.homeProjectSelections = draft.homeProjectSelections.filter(
          row => !(row.id === selectionId && row.project_id === projectId),
        );
        if (wasPreferred && group) {
          const target = draft.homeProjectOptionGroups.find(
            row => row.id === group.id,
          );
          if (target) target.preferred_selection_id = null;
          draft.homeProjectBudgetLines = draft.homeProjectBudgetLines.filter(
            row =>
              !(
                row.project_id === projectId && row.selection_id === selectionId
              ),
          );
        }
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_SELECTION_DELETE',
        entityType: 'home_project_selection',
        entityId: selectionId,
        payload: { projectId, wasPreferred },
      },
    );

    return { success: true as const };
  },

  /**
   * `POST /:projectId/selections/from-link` — LOCAL, and it reads the page.
   *
   * This threw once, on egress grounds, and then read only the URL. Neither is
   * what the member is looking at: the form says the page will be read for the
   * photo, the price, what one box covers and the specs, and two of those are
   * numbers that decide a renovation. A slug cannot give them.
   *
   * So the ladder is the Worker's, run on the device:
   *
   *  1. `draftFromUrl` — the slug. Free, offline, always produces a row.
   *  2. `fetchProductPage` + `draftFromPage` — the shop's own OpenGraph tags,
   *     including `product:price:amount` where it publishes one.
   *  3. `mergeListingIntoDraft` over a BYOK extraction — the retailer's JSON-LD,
   *     the OG tags and the stripped page text, through the member's OWN key,
   *     using the same prompt and schema the Worker uses.
   *
   * Every rung is additive and every failure falls back to the one below, so a
   * shop that blocks the fetch or a provider that times out costs detail and
   * never the row. `extraction.source` says which rung actually answered, which
   * is the difference between "the AI did not run" and "the AI found nothing" —
   * a distinction that was invisible before, because nothing logged it.
   */
  createFromLink: async (
    householdId: string,
    projectId: string,
    url: string,
    optionGroupId?: string,
    byok: HouseByokPort = houseByokPort,
  ) => {
    requireProjectOwner(householdId, projectId);

    let draft = draftFromUrl(url);
    let extraction: MaterialExtractionOutcome = {
      source: 'link_url',
      confidence: null,
    };

    // ── the page ──────────────────────────────────────────────────────────
    const page = await fetchProductPage(url);
    if (page.ok && page.html) {
      draft = draftFromPage(draft, page.html, page.finalUrl);
      extraction = { source: 'link_og', confidence: null };
      console.log('[link-import] page read', {
        status: page.status,
        bytes: page.html.length,
        gotPrice: draft.unitPriceCents != null,
        gotImage: !!draft.imageUrl,
      });
    } else {
      extraction = { source: 'link_url', confidence: null, error: page.error };
      console.log('[link-import] page not read', {
        reason: page.error,
        status: page.status,
      });
    }

    // ── the member's own model over it ────────────────────────────────────
    const hasKey = await byok.hasKey().catch(() => false);
    if (!hasKey) {
      console.log(
        '[link-import] no AI provider key on this device — stopping at',
        extraction.source,
      );
      // Said out loud rather than left to the card: without this the member
      // sees a photo and no price and has no way to know why.
      extraction = { ...extraction, needsAiProvider: true };
    } else if (!page.ok || !page.html) {
      // Nothing to extract FROM. Asking a model to describe a page it was not
      // given is how a confident, invented listing gets into a budget.
      console.log(
        '[link-import] key present but no page to read — stopping at link_url',
      );
    } else {
      try {
        const listing = await byok.generate<RawMaterialListing>({
          systemPrompt: EXTRACT_MATERIAL_LISTING_SYSTEM_PROMPT,
          userPrompt: buildExtractMaterialListingUserPrompt({
            url: page.finalUrl,
            jsonLd: parseJsonLd(page.html),
            openGraph: compactRecord(parseOpenGraph(page.html)),
            bodyText: extractReadableText(page.html),
          }),
          schema: EXTRACT_MATERIAL_LISTING_SCHEMA,
          // Nothing out of the ledger: reading a public product page needs none
          // of it, so there is no payload for the allowlist to filter.
          context: buildHouseAiContext({}, []),
          maxTokens: 2000,
        });
        draft = mergeListingIntoDraft(draft, listing, page.finalUrl, 'USD');
        extraction = {
          source: 'link_ai',
          confidence: listing.confidence ?? null,
        };
        console.log('[link-import] extracted', {
          // Named, because "it works on all three providers" is otherwise an
          // assumption: the ladder picks the member's default silently, and a
          // log that does not say which one answered cannot tell you whether
          // the one you meant to test was ever used.
          provider: await resolveHouseByokProvider().catch(() => 'unknown'),
          confidence: listing.confidence,
          gotPrice: draft.unitPriceCents != null,
          gotCoverage: draft.coveragePerUnit != null,
          specs: draft.specs?.length ?? 0,
        });
      } catch (error) {
        // The OG draft stands. The member keeps the row and whatever the page
        // stated about itself.
        extraction = {
          ...extraction,
          error: error instanceof Error ? error.message : 'extraction_failed',
        };
        console.warn('[link-import] extraction failed', error);
      }
    }

    const { selection } = await localHomeProjectsApi.createSelection(
      householdId,
      projectId,
      {
        name: draft.name,
        category: draft.category,
        status: 'idea',
        productUrl: draft.productUrl,
        vendor: draft.vendor,
        brand: draft.brand,
        sku: draft.sku,
        unit: draft.unit,
        unitPriceCents: draft.unitPriceCents,
        coveragePerUnit: draft.coveragePerUnit,
        coverageUnit: draft.coverageUnit as AreaUnit | undefined,
        imageUrl: draft.imageUrl,
        notes: draft.notes,
        specs: draft.specs?.length ? draft.specs : undefined,
        optionGroupId,
        extractionSource: extraction.source,
        extractionConfidence: extraction.confidence ?? undefined,
      },
    );

    return { selection, extraction };
  },

  // ---- material option groups (migration 0162) ----------------------------

  /**
   * `POST /:projectId/option-groups` — LOCAL, and deliberately so.
   *
   * Comparing five floors is a planning act with no egress in it: the member
   * types a name and an area, and the arithmetic that turns those into "what
   * this floor costs" is `priceOption` in `logic/homeProjects.ts`, ported from
   * the Worker's `pricing.ts` and driven from the same fixture table. Only the
   * *link import* touches the network, and that is the one method here that
   * still throws.
   *
   * **`area_source` is always `'manual'` on this backend.** The Worker prefills
   * the area from `home_project_geometry.floor.area_m2` when the member gives
   * none, and that table is Tier D — never ledgered, for the reason
   * `suggestTakeoffFromGeometry` is not ported either. Claiming `'geometry'`
   * with no geometry to read would put "from your floor plan" under a number
   * nobody measured.
   */
  createOptionGroup: async (
    householdId: string,
    projectId: string,
    input: LocalCreateHomeProjectOptionGroupInput,
  ) => {
    requireProjectOwner(householdId, projectId);
    const group: LocalHomeProjectOptionGroup = {
      id: newLocalId('hpog'),
      household_id: householdId,
      project_id: projectId,
      name: input.name,
      category: input.category ?? 'finish',
      area_value: input.areaValue ?? null,
      area_unit: input.areaUnit ?? null,
      area_source: 'manual',
      waste_factor_pct: input.wasteFactorPct ?? 10,
      preferred_selection_id: null,
      sort_order: 0,
      version: 1,
    };

    const activity = activityRow(
      householdId,
      projectId,
      'option_group_added',
      'option_group',
      group.id,
    );

    await writeLocal(
      draft => {
        draft.homeProjectOptionGroups.push(group);
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_OPTION_GROUP_CREATE',
        entityType: 'home_project_option_group',
        entityId: group.id,
        payload: group,
      },
    );

    return { option_group: group as HomeProjectOptionGroup };
  },

  /**
   * `PATCH /:projectId/option-groups/:groupId` — with the same version guard the
   * selection carries, and the same re-pricing of the winner.
   *
   * Area and waste are inputs to what the chosen option costs, so a group edited
   * from 24 m² to 48 m² has to move its budget line in the SAME op. Splitting
   * them would let a peer hold a 48 m² room still priced for 24.
   */
  updateOptionGroup: async (
    householdId: string,
    projectId: string,
    groupId: string,
    patch: UpdateLocalHomeProjectOptionGroupInput,
  ) => {
    requireProjectOwner(householdId, projectId);
    const existing = optionGroupsOf(householdId).find(
      row => row.id === groupId && row.project_id === projectId,
    );
    if (!existing) throw new Error('Option group not found');
    if (patch.version != null && patch.version !== existing.version) {
      throw new HouseLocalHomeProjectConflictError(
        'Option group was updated by someone else',
      );
    }

    const activity = activityRow(
      householdId,
      projectId,
      'option_group_updated',
      'option_group',
      groupId,
    );

    await writeLocal(
      draft => {
        const group = draft.homeProjectOptionGroups.find(
          row => row.id === groupId,
        );
        if (!group) throw new Error('Option group not found');
        if (patch.name !== undefined) group.name = patch.name;
        if (patch.category !== undefined) group.category = patch.category;
        if (patch.areaValue !== undefined) {
          group.area_value = patch.areaValue;
          // Typing over a prefill makes the number the member's own.
          group.area_source = 'manual';
        }
        if (patch.areaUnit !== undefined) group.area_unit = patch.areaUnit;
        if (patch.wasteFactorPct !== undefined)
          group.waste_factor_pct = patch.wasteFactorPct;
        group.version = existing.version + 1;

        repricePreferredLine(draft, group);
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_OPTION_GROUP_UPDATE',
        entityType: 'home_project_option_group',
        entityId: groupId,
        payload: patch,
      },
    );

    const updated = optionGroupsOf(householdId).find(row => row.id === groupId);
    if (!updated) throw new Error('Option group not found');
    return { option_group: updated as HomeProjectOptionGroup };
  },

  /**
   * `DELETE /:projectId/option-groups/:groupId` — the group goes, the research
   * stays.
   *
   * Its options are un-parented rather than deleted, because "we are not
   * deciding this here" is not "throw away the five materials we found", and the
   * member asked for the first thing. The winner's budget line does go: nothing
   * is chosen any more.
   */
  deleteOptionGroup: async (
    householdId: string,
    projectId: string,
    groupId: string,
  ) => {
    requireProjectOwner(householdId, projectId);
    const existing = optionGroupsOf(householdId).find(
      row => row.id === groupId && row.project_id === projectId,
    );
    if (!existing) throw new Error('Option group not found');

    const activity = activityRow(
      householdId,
      projectId,
      'option_group_deleted',
      'option_group',
      groupId,
    );

    await writeLocal(
      draft => {
        for (const selection of draft.homeProjectSelections) {
          if (selection.option_group_id === groupId)
            selection.option_group_id = null;
        }
        if (existing.preferred_selection_id) {
          const winner = existing.preferred_selection_id;
          draft.homeProjectBudgetLines = draft.homeProjectBudgetLines.filter(
            line => line.selection_id !== winner,
          );
        }
        draft.homeProjectOptionGroups = draft.homeProjectOptionGroups.filter(
          row => row.id !== groupId,
        );
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_OPTION_GROUP_DELETE',
        entityType: 'home_project_option_group',
        entityId: groupId,
        payload: { id: groupId },
      },
    );
  },

  /**
   * `POST /:projectId/option-groups/:groupId/preferred` — pick the one that gets
   * built. `selectionId: null` un-picks.
   *
   * One op, because the pick, the statuses and the money are one decision. A
   * peer that received the new `preferred_selection_id` without the re-pointed
   * budget line would show a project priced for the tile the member just
   * rejected.
   *
   * The line is **re-pointed, never recreated** — `actual_cents` is a deposit
   * somebody has already paid against this surface, and comparing two tiles must
   * not spend it.
   */
  setPreferredOption: async (
    householdId: string,
    projectId: string,
    groupId: string,
    selectionId: string | null,
  ) => {
    requireProjectOwner(householdId, projectId);
    const group = optionGroupsOf(householdId).find(
      row => row.id === groupId && row.project_id === projectId,
    );
    if (!group) throw new Error('Option group not found');

    if (selectionId != null) {
      const winner = selectionsOf(householdId).find(
        row => row.id === selectionId && row.project_id === projectId,
      );
      if (!winner) throw new Error('Selection not found');
      if (winner.option_group_id !== groupId) {
        throw new Error('Selection is not an option in this group');
      }
    }

    const activity = activityRow(
      householdId,
      projectId,
      selectionId == null ? 'option_unpicked' : 'option_picked',
      selectionId == null ? 'option_group' : 'selection',
      selectionId ?? groupId,
    );

    await writeLocal(
      draft => {
        const draftGroup = draft.homeProjectOptionGroups.find(
          row => row.id === groupId,
        );
        if (!draftGroup) throw new Error('Option group not found');

        if (selectionId == null) {
          if (draftGroup.preferred_selection_id) {
            const previous = draftGroup.preferred_selection_id;
            draft.homeProjectBudgetLines = draft.homeProjectBudgetLines.filter(
              line => line.selection_id !== previous,
            );
          }
          draftGroup.preferred_selection_id = null;
          draftGroup.version = group.version + 1;
        } else {
          draftGroup.preferred_selection_id = selectionId;
          draftGroup.version = group.version + 1;
          // `approved` / `shortlisted`, matching the Worker exactly — see the
          // long note in `home-projects-service.ts#setPreferredSelection`. The
          // ledger has no CHECK constraint to enforce it, which is precisely why
          // it has to be written down here: a household that switched backends
          // would otherwise carry two different words for one decision, and the
          // one this facade invented is the one D1 rejects.
          for (const selection of draft.homeProjectSelections) {
            if (selection.option_group_id !== groupId) continue;
            if (selection.id === selectionId) selection.status = 'approved';
            else if (selection.status === 'approved')
              selection.status = 'shortlisted';
          }
          repricePreferredLine(draft, draftGroup);
        }
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_OPTION_PREFERRED_SET',
        entityType: 'home_project_option_group',
        entityId: groupId,
        payload: { groupId, selectionId },
      },
    );

    const updated = optionGroupsOf(householdId).find(row => row.id === groupId);
    if (!updated) throw new Error('Option group not found');
    const line =
      updated.preferred_selection_id == null
        ? null
        : budgetLinesOf(householdId).find(
            row => row.selection_id === updated.preferred_selection_id,
          ) ?? null;
    return {
      option_group: updated as HomeProjectOptionGroup,
      budget_line: (line as HomeProjectBudgetLine | null) ?? null,
    };
  },

  // ---- budget lines -------------------------------------------------------

  /**
   * `POST /:projectId/budget-lines` — a row the member priced themselves.
   *
   * `sort_order` is the DIVERGENCE to watch. The column is local-only (see
   * `types.ts`) and D1 defaults it to 0, so the Worker's own hand-added lines all
   * sort equal and land in insertion order. Here they would too — the ledger's
   * array order is the insertion order — but `buildHub` sorts on the column, and
   * a stable sort over a field that is 0 everywhere is only insertion order by
   * accident. New lines therefore take a sort_order past the highest on the
   * project, which keeps "the one I just added is at the bottom" true after a
   * replay reorders the array.
   *
   * No activity row: `createBudgetLine` on the server records none either, and
   * the feed is member-visible — adding one here would give a household that
   * switched backends a different history for the same action.
   */
  createBudgetLine: async (
    householdId: string,
    projectId: string,
    input: {
      category: string;
      label: string;
      estimateCents?: number;
      actualCents?: number;
      selectionId?: string;
    },
  ) => {
    requireProjectOwner(householdId, projectId);
    const siblings = budgetLinesOf(householdId).filter(
      row => row.project_id === projectId,
    );
    const line: LocalHomeProjectBudgetLine = {
      id: newLocalId('hpbl'),
      household_id: householdId,
      project_id: projectId,
      category: input.category,
      label: input.label,
      estimate_cents: input.estimateCents ?? 0,
      actual_cents: input.actualCents ?? 0,
      selection_id: input.selectionId ?? null,
      sort_order:
        siblings.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1,
      version: 1,
    };

    await writeLocal(
      draft => {
        draft.homeProjectBudgetLines.push(line);
      },
      {
        opType: 'HOME_PROJECT_BUDGET_LINE_CREATE',
        entityType: 'home_project_budget_line',
        entityId: line.id,
        payload: line,
      },
    );

    return { budget_line: line as HomeProjectBudgetLine };
  },

  /**
   * `PATCH /:projectId/budget-lines/:lineId` — correct a figure.
   *
   * `version` is checked the way `updateOptionGroup` checks it, and for a sharper
   * reason: two members pricing the same job offline both believe their number is
   * the current one, and last-write-wins on money is the failure a household
   * notices. `maybeNotifyBudgetOver` is Tier B and is not reproduced — the header
   * still turns red on the next read, which is the part the member sees.
   */
  updateBudgetLine: async (
    householdId: string,
    projectId: string,
    lineId: string,
    patch: {
      category?: string;
      label?: string;
      estimateCents?: number;
      actualCents?: number;
      version?: number;
    },
  ) => {
    requireProjectOwner(householdId, projectId);
    const existing = budgetLinesOf(householdId).find(
      row => row.id === lineId && row.project_id === projectId,
    );
    if (!existing) throw new Error('Budget line not found');
    if (patch.version != null && patch.version !== existing.version) {
      throw new HouseLocalHomeProjectConflictError(
        'Budget line was updated by someone else',
      );
    }

    await writeLocal(
      draft => {
        const line = draft.homeProjectBudgetLines.find(
          row => row.id === lineId,
        );
        if (!line) throw new Error('Budget line not found');
        if (patch.category !== undefined) line.category = patch.category;
        if (patch.label !== undefined) line.label = patch.label;
        if (patch.estimateCents !== undefined)
          line.estimate_cents = patch.estimateCents;
        if (patch.actualCents !== undefined)
          line.actual_cents = patch.actualCents;
        line.version = existing.version + 1;
      },
      {
        opType: 'HOME_PROJECT_BUDGET_LINE_UPDATE',
        entityType: 'home_project_budget_line',
        entityId: lineId,
        payload: patch,
      },
    );

    const updated = budgetLinesOf(householdId).find(row => row.id === lineId);
    if (!updated) throw new Error('Budget line not found');
    return { budget_line: updated as HomeProjectBudgetLine };
  },

  /**
   * `DELETE /:projectId/budget-lines/:lineId`.
   *
   * A leaf delete — `home_project_budget_lines.selection_id` is plain text with
   * no `references()`, so nothing cascades and the material the line was derived
   * from is untouched. That asymmetry is the server's too: `deleteSelection`
   * likewise leaves the derived line in place.
   */
  deleteBudgetLine: async (
    householdId: string,
    projectId: string,
    lineId: string,
  ): Promise<void> => {
    requireProjectOwner(householdId, projectId);
    const existing = budgetLinesOf(householdId).find(
      row => row.id === lineId && row.project_id === projectId,
    );
    if (!existing) throw new Error('Budget line not found');

    await writeLocal(
      draft => {
        draft.homeProjectBudgetLines = draft.homeProjectBudgetLines.filter(
          row => row.id !== lineId,
        );
      },
      {
        opType: 'HOME_PROJECT_BUDGET_LINE_DELETE',
        entityType: 'home_project_budget_line',
        entityId: lineId,
        payload: { id: lineId },
      },
    );
  },

  // ---- blockers and phases ------------------------------------------------

  /**
   * `POST /:projectId/blockers` — the blocker and its activity row, in one op.
   *
   * `notifyHousehold` is not reproduced (Tier B, as on `createSelection`).
   * `status` is always `'open'`: the service hardcodes it, and the member
   * resolves a blocker afterwards through `updateBlocker`. `resolved_at` stays
   * unwritten on BOTH backends — see `updateBlocker` — which is why it is still
   * not on the row type.
   *
   * `sort_order` appends, matching the Worker's `nextSortOrder`.
   */
  createBlocker: async (
    householdId: string,
    projectId: string,
    input: CreateLocalHomeProjectBlockerInput,
  ) => {
    requireProjectOwner(householdId, projectId);
    const blocker: LocalHomeProjectBlocker = {
      id: newLocalId('hpblk'),
      household_id: householdId,
      project_id: projectId,
      title: input.title,
      severity: input.severity ?? 'medium',
      status: 'open',
      notes: input.notes ?? null,
      sort_order: nextSortOrder(blockersOf(householdId), projectId),
      created_at: nowIso(),
    };
    const activity = activityRow(
      householdId,
      projectId,
      'blocker_added',
      'blocker',
      blocker.id,
    );

    await writeLocal(
      draft => {
        draft.homeProjectBlockers.push(blocker);
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_BLOCKER_CREATE',
        entityType: 'home_project_blocker',
        entityId: blocker.id,
        payload: blocker,
      },
    );

    return { blocker: blocker as HomeProjectBlocker };
  },

  /**
   * `PATCH /:projectId/blockers/:blockerId` — reword it, re-rate it, note what
   * you found out, or mark it out of the way.
   *
   * Records `blocker_updated` because `createBlocker` records `blocker_added`:
   * blockers are the one list in this feature whose history the household
   * already sees, and a "Blocker added" with no matching later entry reads as if
   * the blocker is still open.
   *
   * `resolved_at` is NOT written when `status` goes to `'resolved'`, on this
   * backend or the Worker. The column has no reader and no writer, and it is not
   * carried by `LocalHomeProjectBlocker` — writing it in D1 alone would put a
   * fact in one household's row that another household could never hold.
   */
  updateBlocker: async (
    householdId: string,
    projectId: string,
    blockerId: string,
    patch: {
      title?: string;
      severity?: string;
      status?: string;
      notes?: string | null;
    },
  ) => {
    requireProjectOwner(householdId, projectId);
    const existing = blockersOf(householdId).find(
      row => row.id === blockerId && row.project_id === projectId,
    );
    if (!existing) throw new Error('Blocker not found');
    const activity = activityRow(
      householdId,
      projectId,
      'blocker_updated',
      'blocker',
      blockerId,
    );

    await writeLocal(
      draft => {
        const blocker = draft.homeProjectBlockers.find(
          row => row.id === blockerId,
        );
        if (!blocker) throw new Error('Blocker not found');
        if (patch.title !== undefined) blocker.title = patch.title;
        if (patch.severity !== undefined) blocker.severity = patch.severity;
        if (patch.status !== undefined) blocker.status = patch.status;
        if (patch.notes !== undefined) blocker.notes = patch.notes;
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_BLOCKER_UPDATE',
        entityType: 'home_project_blocker',
        entityId: blockerId,
        payload: patch,
      },
    );

    const updated = blockersOf(householdId).find(row => row.id === blockerId);
    if (!updated) throw new Error('Blocker not found');
    return { blocker: updated as HomeProjectBlocker };
  },

  /**
   * `DELETE /:projectId/blockers/:blockerId` — a leaf delete with its activity
   * row, the pair `deleteSelection` writes and `deletePhase` does not.
   */
  deleteBlocker: async (
    householdId: string,
    projectId: string,
    blockerId: string,
  ): Promise<void> => {
    requireProjectOwner(householdId, projectId);
    const existing = blockersOf(householdId).find(
      row => row.id === blockerId && row.project_id === projectId,
    );
    if (!existing) throw new Error('Blocker not found');
    const activity = activityRow(
      householdId,
      projectId,
      'blocker_deleted',
      'blocker',
      blockerId,
    );

    await writeLocal(
      draft => {
        draft.homeProjectBlockers = draft.homeProjectBlockers.filter(
          row => row.id !== blockerId,
        );
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_BLOCKER_DELETE',
        entityType: 'home_project_blocker',
        entityId: blockerId,
        payload: { id: blockerId },
      },
    );
  },

  /** `POST /:projectId/blockers/reorder`. One op, for `reorderPhases`' reason. */
  reorderBlockers: async (
    householdId: string,
    projectId: string,
    blockerIds: string[],
  ) => {
    requireProjectOwner(householdId, projectId);
    const ordered = orderIdsForProject(
      blockersOf(householdId),
      projectId,
      blockerIds,
      'Blocker',
    );

    await writeLocal(
      draft => {
        for (const [index, id] of ordered.entries()) {
          const blocker = draft.homeProjectBlockers.find(row => row.id === id);
          if (blocker) blocker.sort_order = index;
        }
      },
      {
        opType: 'HOME_PROJECT_BLOCKER_REORDER',
        entityType: 'home_project',
        entityId: projectId,
        payload: { blockerIds: ordered },
      },
    );

    return {
      blockers: blockersOf(householdId)
        .filter(row => row.project_id === projectId)
        .sort(bySortOrder) as HomeProjectBlocker[],
    };
  },

  /**
   * `POST /:projectId/phases` — and the one write in this facade that records
   * NO activity.
   *
   * `createPhase` is the only creating method in `home-projects-service.ts` with
   * no `recordActivity` call. That is almost certainly an oversight on the
   * server and it is reproduced rather than corrected, because the activity feed
   * is member-visible: adding the row here would make a household that switched
   * backends see a different history for the same actions.
   *
   * `startsOn` and `endsOn` are on the service's input and not on the client's,
   * so a phase is always created undated. `sort_order` APPENDS — `max + 1`
   * across the project's phases, matching the Worker's `nextSortOrder`. It used
   * to take D1's default of 0 on both backends, which was harmless only while
   * nothing could reorder: with every hand-added phase sharing one key, the
   * order of the second half of the list was whatever the store returned.
   */
  createPhase: async (
    householdId: string,
    projectId: string,
    input: CreateLocalHomeProjectPhaseInput,
  ) => {
    requireProjectOwner(householdId, projectId);
    const phase: LocalHomeProjectPhase = {
      id: newLocalId('hpph'),
      household_id: householdId,
      project_id: projectId,
      title: input.title,
      status: 'pending',
      starts_on: null,
      ends_on: null,
      sort_order: nextSortOrder(phasesOf(householdId), projectId),
    };

    await writeLocal(
      draft => {
        draft.homeProjectPhases.push(phase);
      },
      {
        opType: 'HOME_PROJECT_PHASE_CREATE',
        entityType: 'home_project_phase',
        entityId: phase.id,
        payload: phase,
      },
    );

    return { phase: phase as HomeProjectPhase };
  },

  /**
   * `PATCH /:projectId/phases/:phaseId` — rename a phase, or move it on.
   *
   * No activity row, matching `createPhase` and matching the Worker. The feed
   * is member-visible and written by two backends; a phase edit that shows up in
   * one household's history and not another's is a difference they can see.
   *
   * No `version` check either, and that is a deliberate difference from
   * `updateBudgetLine`: a phase carries no `version` column on either backend,
   * and the thing being overwritten is a title or a status rather than a number
   * a household is about to spend against.
   */
  updatePhase: async (
    householdId: string,
    projectId: string,
    phaseId: string,
    patch: {
      title?: string;
      status?: string;
      startsOn?: string | null;
      endsOn?: string | null;
    },
  ) => {
    requireProjectOwner(householdId, projectId);
    const existing = phasesOf(householdId).find(
      row => row.id === phaseId && row.project_id === projectId,
    );
    if (!existing) throw new Error('Phase not found');

    await writeLocal(
      draft => {
        const phase = draft.homeProjectPhases.find(row => row.id === phaseId);
        if (!phase) throw new Error('Phase not found');
        if (patch.title !== undefined) phase.title = patch.title;
        if (patch.status !== undefined) phase.status = patch.status;
        if (patch.startsOn !== undefined) phase.starts_on = patch.startsOn;
        if (patch.endsOn !== undefined) phase.ends_on = patch.endsOn;
      },
      {
        opType: 'HOME_PROJECT_PHASE_UPDATE',
        entityType: 'home_project_phase',
        entityId: phaseId,
        payload: patch,
      },
    );

    const updated = phasesOf(householdId).find(row => row.id === phaseId);
    if (!updated) throw new Error('Phase not found');
    return { phase: updated as HomeProjectPhase };
  },

  /**
   * `DELETE /:projectId/phases/:phaseId`.
   *
   * A leaf delete. `home_project_milestones.phase_id` is plain text with no
   * `references()` on either backend, so a milestone that pointed here is left
   * pointing at an id that no longer resolves — the Worker's behaviour, and
   * unobservable today because nothing reads `phase_id`.
   */
  deletePhase: async (
    householdId: string,
    projectId: string,
    phaseId: string,
  ): Promise<void> => {
    requireProjectOwner(householdId, projectId);
    const existing = phasesOf(householdId).find(
      row => row.id === phaseId && row.project_id === projectId,
    );
    if (!existing) throw new Error('Phase not found');

    await writeLocal(
      draft => {
        draft.homeProjectPhases = draft.homeProjectPhases.filter(
          row => row.id !== phaseId,
        );
      },
      {
        opType: 'HOME_PROJECT_PHASE_DELETE',
        entityType: 'home_project_phase',
        entityId: phaseId,
        payload: { id: phaseId },
      },
    );
  },

  /**
   * `POST /:projectId/phases/reorder` — the whole list, renumbered.
   *
   * ONE op for the whole list rather than one per row, and that is the point
   * rather than an optimisation: a drag is a single member action, and splitting
   * it into seven independent per-row writes lets per-field LWW interleave two
   * members' drags into an order neither of them chose. As one op the loser's
   * drag is overwritten whole, which is a re-drag rather than a scramble.
   */
  reorderPhases: async (
    householdId: string,
    projectId: string,
    phaseIds: string[],
  ) => {
    requireProjectOwner(householdId, projectId);
    const ordered = orderIdsForProject(
      phasesOf(householdId),
      projectId,
      phaseIds,
      'Phase',
    );

    await writeLocal(
      draft => {
        for (const [index, id] of ordered.entries()) {
          const phase = draft.homeProjectPhases.find(row => row.id === id);
          if (phase) phase.sort_order = index;
        }
      },
      {
        opType: 'HOME_PROJECT_PHASE_REORDER',
        entityType: 'home_project',
        entityId: projectId,
        payload: { phaseIds: ordered },
      },
    );

    return {
      phases: phasesOf(householdId)
        .filter(row => row.project_id === projectId)
        .sort(bySortOrder) as HomeProjectPhase[],
    };
  },

  // ---- geometry (Tier D) --------------------------------------------------

  /**
   * `PUT /:projectId/geometry/manual` — Tier D, and the first WRITE this
   * programme has refused on tier grounds.
   *
   * `home_project_geometry` is in `HOUSE_TIER_D_TABLES`, so there is nowhere on
   * device to put a room layout, and `registryGuard` asserts that exclusion over
   * the whole registry. Routing it remote would be worse than answering empty:
   * the Worker would accept the write and store a real geometry row that
   * `getHub` — which is local — could never read back, so the member would enter
   * their measurements and watch them vanish.
   *
   * A member measuring a room by hand is genuinely local work, so this is the
   * throw in the group most likely to be revisited. The blocker is the tier
   * decision, not the arithmetic.
   */
  putManualGeometry: async (
    householdId: string,
    projectId: string,
    payload: unknown,
  ) => writeGeometry(householdId, projectId, 'manual', payload),

  /**
   * `POST /:projectId/geometry/roomplan` — the LiDAR scan, same tier, and one
   * extra reason.
   *
   * `putRoomPlanGeometry` also runs `suggestTakeoffFromGeometry`, which turns
   * wall and floor areas into paint and flooring selections. That half reads the
   * geometry payload it was just handed rather than the table, so it would port
   * — but it exists to annotate a stored scan, and with nothing stored there is
   * nothing for the suggestions to hang off.
   */
  putRoomPlanGeometry: async (
    householdId: string,
    projectId: string,
    payload: unknown,
  ) => writeGeometry(householdId, projectId, 'roomplan', payload),

  /** `POST /:projectId/geometry/ai-schematic` — a queue, a model and Tier D. */
  enqueueAiSchematic: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('homeProjectsApi.enqueueAiSchematic');
  },

  /**
   * Smart Project — the whole surface throws, for `enqueueAiSchematic`'s reason
   * carried further than it has been so far.
   *
   * Describe-to-draft does not merely *call* a model: it writes a project, its
   * phases, its surfaces, its materials and a geometry row, all in D1, for a
   * household whose home projects live in this ledger. Routing it remote would
   * not answer empty — it would create a real project on the server that
   * `list` (local) can never return and the member can never open, and then
   * notify them that their draft was ready. An orphan is worse than an error.
   *
   * These stay throws rather than being ledgered because the generation itself
   * is server-only: the provider key, the queue and the retry policy are all
   * Worker-side, and there is no version of this that runs on the device. The
   * UI gates the entry point on `isHouseLocalFirst()` so a member never reaches
   * these — the throws are the backstop for a gate that regresses, which is
   * exactly the failure the strict proxy exists to catch.
   *
   * Revisit with BRD open question Q4 (`HomeProjects_SmartProject_BRD.md` §12),
   * which is precisely "what should local-first do here".
   */
  startSmartDraft: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('homeProjectsApi.startSmartDraft');
  },

  getSmartDraft: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('homeProjectsApi.getSmartDraft');
  },

  cancelSmartDraft: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('homeProjectsApi.cancelSmartDraft');
  },

  /**
   * Publishing is a Smart Project act and shares their fate.
   *
   * A local-first project is never a Smart Project draft — nothing on device
   * creates one — so there is no local row this could flip. Ledgering it would
   * mean writing a `publish` that can only ever be called on a project that
   * cannot exist.
   */
  publishProject: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('homeProjectsApi.publishProject');
  },

  listAsIs: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('homeProjectsApi.listAsIs');
  },

  upsertAsIs: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('homeProjectsApi.upsertAsIs');
  },

  deleteAsIs: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('homeProjectsApi.deleteAsIs');
  },

  /**
   * `POST /:projectId/geometry/:geometryId/cancel` — the control, not the model,
   * and still a throw. C3's `cancelGeneration`, one feature over.
   *
   * The precondition can never hold: `cancelGeometryJob` raises its own 409
   * unless the row is `generating`, and a local-first project has no geometry row
   * at all — the schematic queue cannot start for a household the Worker cannot
   * read. A local implementation would answer the server's own conflict error to
   * every caller forever, which is a worse lie than an honest refusal.
   */
  /**
   * `DELETE /:projectId/geometry/:geometryId`.
   *
   * The old note said the precondition "can never hold, because a local-first
   * project is never `generating`". That was true while the only way to get a
   * geometry row was the AI schematic queue. It is not true now: a member can
   * put a manual layout or a RoomPlan scan, and cancelling one has to remove
   * it. `enqueueAiSchematic` is still a throw, so a `generating` row still
   * cannot exist — which is why this deletes rather than transitioning a status.
   */
  cancelGeometry: async (
    householdId: string,
    projectId: string,
    geometryId: string,
  ) => {
    requireProjectOwner(householdId, projectId);
    await writeLocal(
      draft => {
        draft.homeProjectGeometry = draft.homeProjectGeometry.filter(
          row => !(row.id === geometryId && row.project_id === projectId),
        );
      },
      {
        opType: 'delete',
        entityType: 'homeProjectGeometry',
        entityId: geometryId,
      },
    );
    return { success: true };
  },

  /**
   * `POST /:projectId/surfaces/:surfaceId/preview` — a model, and a throw.
   *
   * This is the one refusal in the facade where almost nothing is actually
   * lost, and the copy is written to say so. The surface planner is entirely
   * local: `home_project_geometry` has been ledgered since the H13 D-wave, the
   * room document is written by `putManualGeometry` above, and every number a
   * member plans and orders with — net areas, tile counts, litres of paint,
   * costs — is computed on the device by `@symply/contracts/room-surface` from
   * that document. The scale-true drawing is `SurfaceCanvas`, which is SVG and
   * needs nothing but the row.
   *
   * What needs a server is the **photorealistic render**: an image model, an
   * entitlement check, and a bucket for the result. All three are exactly the
   * shape `enqueueAiSchematic` refuses for, and routing this remote would be
   * worse than refusing — the Worker would read a geometry row that does not
   * exist for this household and render an empty room with confidence.
   */
  generateSurfacePreview: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError(
      'homeProjectsApi.generateSurfacePreview',
    );
  },

  // ---- export -------------------------------------------------------------

  /**
   * `POST /:projectId/export.pdf` — LOCAL, and the half that matters.
   *
   * `exportProjectSummary` does two things: it composes a share document out of
   * the hub, and it writes that document to R2 twice (text and PDF) so the
   * second method below can fetch it. Only the second half needs a server, and
   * the DTO already admits the split — `pdfUrl` is typed `string | null`, and
   * `HomeProjectHubScreen` guards `if (pdfUrl && …)` before falling through to
   * a plain text share it writes to the cache directory itself.
   *
   * So the local answer is the full `shareText` and a null `pdfUrl`, and the
   * screen takes the branch it already has. That is a genuinely complete
   * feature offline rather than a degraded one: the text is what a member sends
   * to a contractor, and it is composed from rows the device holds.
   *
   * Every formatting decision is the server's, ported into
   * `logic/homeProjects.ts` — cents divided by 100 and rendered with
   * `toFixed(0)`, `'n/a'` for an unset target, the blank lines before each list.
   * A household that switched backends would otherwise share two
   * different-looking documents for the same project.
   */
  exportSummary: async (householdId: string, projectId: string) => {
    const hub = buildHub(householdId, projectId);
    const lines = buildHomeProjectSummaryLines({
      project: hub.project,
      rollups: hub.rollups,
      selections: hub.selections,
      phases: hub.phases,
    });
    return { shareText: lines.join('\n'), pdfUrl: null as string | null };
  },

  /**
   * `GET /:projectId/exports/:exportId/pdf` — unreachable rather than blocked.
   *
   * `exportSummary` answers `pdfUrl: null` above, so no local caller reaches
   * this. It throws rather than being absent because a missing key is the one
   * thing the coverage rule forbids: it would route a token-authenticated fetch
   * to a Worker for a PDF that was never written, and `Sharing.shareAsync` would
   * then be handed the path of a file containing an error body.
   */
  downloadExportPdf: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('homeProjectsApi.downloadExportPdf');
  },

  // ---- plan links ---------------------------------------------------------

  /**
   * `POST /:projectId/plan-links` — LOCAL, and a plain row write.
   *
   * `zone_payload` is stored as the JSON STRING the Worker stores, not as the
   * object the caller passed: the DTO types it `string | null` and the route
   * stringifies on the way in. Same call C3 made on
   * `garden_plans.boundary_geojson`, and the opposite of C2's `svg_data` — the
   * rule is always "satisfy the DTO", and here the DTO agrees with D1.
   *
   * `floor_plan_id` is not validated against `floor_plans`, because the Worker
   * does not validate it either — the column carries no `references()`. A plan
   * link therefore survives the deletion of the floor plan it names, on both
   * backends. See this module's header.
   */
  createPlanLink: async (
    householdId: string,
    projectId: string,
    input: CreateLocalHomeProjectPlanLinkInput,
  ) => {
    requireProjectOwner(householdId, projectId);
    const planLink: LocalHomeProjectPlanLink = {
      id: newLocalId('hppl'),
      household_id: householdId,
      project_id: projectId,
      floor_plan_id: input.floorPlanId,
      zone_payload: input.zonePayload
        ? JSON.stringify(input.zonePayload)
        : null,
      created_at: nowIso(),
    };

    await writeLocal(
      draft => {
        draft.homeProjectPlanLinks.push(planLink);
      },
      {
        opType: 'HOME_PROJECT_PLAN_LINK_CREATE',
        entityType: 'home_project_plan_link',
        entityId: planLink.id,
        payload: planLink,
      },
    );

    return { plan_link: planLink as HomeProjectPlanLink };
  },

  // ---- attachments (H6) ---------------------------------------------------

  /**
   * `POST /:projectId/attachments/upload-url` — H6, and the throw that gates the
   * other two.
   *
   * This method creates the attachment ROW as well as minting the URL: `r2_key`
   * is built from the household, the project and the new id, and `status` starts
   * at `'pending_upload'`. So there is no metadata-only half to keep working the
   * way `contractorsApi.createDocument` and `projectsApi.addProgressPhoto` have
   * one — a row here names an object that does not exist yet and never will.
   *
   * The table is still ledgered, and the copy says why in member's terms: an
   * attachment a household added BEFORE going local-first converges, is carried
   * by every checkpoint, export and backup, and shows in the hub.
   */
  createAttachmentUpload: async (
    householdId: string,
    projectId: string,
    input: LocalCreateAttachmentUploadInput,
  ) => {
    requireProjectOwner(householdId, projectId);
    const attachment = attachmentRow(householdId, projectId, input, null);
    await writeLocal(
      draft => {
        draft.homeProjectAttachments.push(attachment);
      },
      {
        opType: 'HOME_PROJECT_ATTACHMENT_CREATE',
        entityType: 'home_project_attachment',
        entityId: attachment.id,
        payload: attachment,
      },
    );
    // `upload_url` is deliberately EMPTY rather than a fabricated `/files/…`
    // path, for the reason `localTasksApi.buildPhotoRows` gives about
    // `photo_url`: on a ledger there is no object to address, and a URL that
    // will never resolve is worse than an absent one at every call site.
    return { attachment_id: attachment.id, upload_url: '', attachment };
  },

  /**
   * `PUT /:projectId/attachments/:id/upload` — the bytes themselves.
   *
   * The remote takes an `ArrayBuffer | Blob` and PUTs it. `uploadHouseBlob`
   * reads from a FILE, chunk by chunk, so that a 40 MB scan is never held in
   * memory whole — so the bytes are spilled to one temp file first and removed
   * once they are sealed. `uploadSelectionPhoto` below never pays for that: it
   * has a URI already and seals it directly.
   */
  uploadAttachmentBytes: async (
    householdId: string,
    projectId: string,
    attachmentId: string,
    bytes: ArrayBuffer | Blob,
    contentType: string,
  ) => {
    requireProjectOwner(householdId, projectId);
    const existing = attachmentsOf(householdId).find(
      row => row.id === attachmentId,
    );
    if (!existing) {
      throw new Error(`home project attachment ${attachmentId} not found`);
    }

    const stagedUri = `${
      FileSystem.cacheDirectory ?? ''
    }hp-attachment-${attachmentId}`;
    await FileSystem.writeAsStringAsync(stagedUri, await toBase64(bytes), {
      encoding: FileSystem.EncodingType.Base64,
    });
    try {
      const descriptor = await uploadHouseBlob({
        sourceUri: stagedUri,
        mime: contentType,
        householdId,
      });
      const attachment = await markAttachmentReady(
        householdId,
        attachmentId,
        descriptor,
      );
      return { attachment };
    } finally {
      await FileSystem.deleteAsync(stagedUri, { idempotent: true }).catch(
        () => {},
      );
    }
  },

  /**
   * The picker-to-blob composite — the one the hub actually calls.
   *
   * Normalises before sealing (`normalizeAttachmentImage`): every other member
   * of the household downloads and decrypts these bytes, so a 12 MP HEIC
   * original would be charged to all of them, against the household blob quota,
   * in a format a non-Apple peer cannot decode. 2048 on the long edge at JPEG
   * 0.85 is still sharp full-screen and is roughly a fifth of the bytes.
   *
   * Row and bytes go in ONE write: an attachment row whose bytes never sealed is
   * exactly the orphan the row-and-its-event rule exists to prevent, and it is
   * what the old server path produced when the PUT failed after the upload-url
   * POST had already committed the row.
   */
  uploadSelectionPhoto: async (
    householdId: string,
    projectId: string,
    uri: string,
    selectionId?: string,
    tags?: Array<'before' | 'after'>,
    // Trailing and defaulted, exactly as on the remote module: `'texture'` is a
    // material swatch for the Room Surface Model, and `'reference'` is a room
    // the member liked in this colour. Both are the same seal-and-row write
    // under a label the hub's photo gallery filters out — it takes `'photo'`
    // only, so neither can wander into the project's before/after strip or be
    // offered as the project cover.
    kind: 'photo' | 'texture' | 'reference' = 'photo',
  ): Promise<LocalHomeProjectAttachment> => {
    requireProjectOwner(householdId, projectId);
    const normalized = await normalizeAttachmentImage(uri);
    const descriptor = await uploadHouseBlob({
      sourceUri: normalized.uri,
      mime: normalized.mime,
      householdId,
    });

    const attachment = attachmentRow(
      householdId,
      projectId,
      {
        filename: normalizedAttachmentFilename(uri),
        file_size: descriptor.bytes,
        content_type: normalized.mime,
        kind,
        selectionId,
        tags,
      },
      descriptor,
    );
    const activity = activityRow(
      householdId,
      projectId,
      'attachment_added',
      'attachment',
      attachment.id,
    );

    await writeLocal(
      draft => {
        draft.homeProjectAttachments.push(attachment);
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_ATTACHMENT_UPLOAD',
        entityType: 'home_project_attachment',
        entityId: attachment.id,
        payload: attachment,
      },
    );

    return attachment;
  },

  // ---- comments and activity ----------------------------------------------

  /**
   * `POST /:projectId/comments` — the comment and its activity row, in one op.
   *
   * Nothing reads a comment back on either backend: there is no list route and
   * no client method, so the activity feed's `comment_added` entry is the only
   * trace a member ever sees. The row is ledgered anyway — see `types.ts` — and
   * the two rows go together because an event for a comment that did not arrive
   * is exactly the orphan the one-op rule exists to prevent.
   *
   * `@mention` notifications are not reproduced: the Worker scans the body for
   * `@userId`, checks each against the household roster and pushes to the
   * matches. Notifications are Tier B, and the body is stored either way, so the
   * mention survives — only the push does not. On device the member's own
   * reminders are H4's scheduler, which has no notion of a mention.
   *
   * The empty-body guard is the service's `ValidationError`, and the body is
   * stored trimmed.
   */
  addComment: async (
    householdId: string,
    projectId: string,
    input: AddLocalHomeProjectCommentInput,
  ) => {
    requireProjectOwner(householdId, projectId);
    if (!input.body.trim()) throw new Error('Comment body required');

    const comment: LocalHomeProjectComment = {
      id: newLocalId('hpcm'),
      household_id: householdId,
      project_id: projectId,
      selection_id: input.selectionId ?? null,
      user_id: getLocalHouseMemberId(),
      body: input.body.trim(),
      created_at: nowIso(),
    };
    const activity = activityRow(
      householdId,
      projectId,
      'comment_added',
      'comment',
      comment.id,
    );

    await writeLocal(
      draft => {
        draft.homeProjectComments.push(comment);
        draft.homeProjectActivity.push(activity);
      },
      {
        opType: 'HOME_PROJECT_COMMENT_CREATE',
        entityType: 'home_project_comment',
        entityId: comment.id,
        payload: comment,
      },
    );

    return { comment: comment as HomeProjectComment };
  },

  /**
   * `GET /:projectId/activity` — LOCAL, with the Worker's cursor paging ported
   * including the part that is wrong.
   *
   * `listActivity` sorts newest first, slices from the row AFTER the cursor id,
   * takes `limit` (50, and the client cannot override it), and then computes
   * `next_cursor` as **the last id of the page, but only when the REMAINING set
   * was longer than the limit** — `filtered.length > limit`. That comparison is
   * against the pre-slice array, so a project with exactly 50 events returns a
   * null cursor and one with 51 returns a real one, which is correct; what is
   * odd is that a cursor whose id is not found falls back to the whole list
   * rather than erroring, so a stale cursor silently restarts the feed.
   * Reproduced, because `useHomeProjectActivity` reads only the first page and
   * changing the paging would make the two backends disagree the moment it does
   * not.
   */
  listActivity: async (
    householdId: string,
    projectId: string,
    cursor?: string,
  ) => {
    // A READ — the Worker gates this at `'read'`, so a viewer sees the feed.
    requireProject(householdId, projectId);
    const limit = 50;
    const rows = activityOf(householdId)
      .filter(row => row.project_id === projectId)
      .sort(byCreatedAtDesc);
    let filtered = rows;
    if (cursor) {
      const index = rows.findIndex(row => row.id === cursor);
      filtered = index >= 0 ? rows.slice(index + 1) : rows;
    }
    const page = filtered.slice(0, limit);
    const nextCursor =
      filtered.length > limit ? page[page.length - 1]?.id ?? null : null;
    return {
      items: page as HomeProjectActivityItem[],
      next_cursor: nextCursor,
    };
  },

  // ---- linked tasks -------------------------------------------------------

  /**
   * `GET /:projectId/tasks` — and the last of H11's S2 refusals to become an
   * ordinary local method.
   *
   * These three used to throw. The link lived in `home_project_tasks`, a join
   * carrying `project_id`, `task_id` and a timestamp and **no primary key at
   * all**, so there was nothing to key a ledger row on — and both ways of
   * inventing one were worse than waiting (plan §1.5): a random surrogate
   * re-created the S3b duplicate, and a deterministic one walked into S3a
   * instead, because link/unlink/re-link is the NORMAL action on a join row and
   * the tombstone is absorbing, so the second link would never come back.
   *
   * Migration 0170 took the plan's own third option and moved the link onto the
   * parent as `home_projects.linked_task_ids`, exactly as
   * `projects.linked_task_ids` already does. The parent is keyed, ledgered and
   * already loaded by every screen that renders these, so all three methods are
   * now local with no new table and no new hazard.
   *
   * **What the move costs, said once here and once in the contract:** under
   * per-field LWW two devices that link two DIFFERENT tasks offline converge on
   * one device's array and the other link is lost. The task itself is a
   * separate keyed row and survives either way, so that is a link to re-make —
   * not a row that can never come back, which is what S3a would have meant.
   *
   * A READ, so it is gated at `'read'` like the Worker's: a viewer sees the
   * project's jobs.
   */
  listTasks: async (householdId: string, projectId: string) => {
    const project = requireProject(householdId, projectId);
    const linkedIds = parseHomeProjectLinkedTaskIds(project.linked_task_ids);
    if (!linkedIds.length) return { tasks: [] };

    const byId = new Map(
      rowsOf<LocalTask>('tasks')
        .filter(row => row.household_id === householdId)
        .map(row => [row.id, row]),
    );
    // A task the member has since deleted is SKIPPED, not reported — the same
    // behaviour the Worker has, and the same it had under the join table, which
    // had no foreign key to `tasks` and so always tolerated a dangling id.
    return {
      tasks: linkedIds.flatMap(taskId => {
        const task = byId.get(taskId);
        return task
          ? [
              {
                task_id: task.id,
                title: task.title,
                next_due_date: task.next_due_date,
              },
            ]
          : [];
      }),
    };
  },

  /**
   * `POST /:projectId/tasks` with a `taskId` — attach a job that already exists.
   *
   * Idempotent through `withHomeProjectLinkedTask`, which returns the array it
   * was handed when the id is already present: a re-link writes no op and
   * records no second activity entry, which is what the join table's existence
   * check did.
   */
  linkTask: async (
    householdId: string,
    projectId: string,
    taskId: string,
  ) => {
    const project = requireProjectOwner(householdId, projectId);
    // The Worker refuses a task from another household before it writes
    // anything (`home-projects-service.ts`), and the same guard has to stand
    // here or a link made offline would converge as an id no backend can
    // resolve.
    const task = rowsOf<LocalTask>('tasks').find(
      row => row.id === taskId && row.household_id === householdId,
    );
    if (!task) throw new Error('Task not found');

    const current = parseHomeProjectLinkedTaskIds(project.linked_task_ids);
    const next = withHomeProjectLinkedTask(current, taskId);
    if (next !== current) {
      const memberId = getLocalHouseMemberId();
      const serialized = serializeHomeProjectLinkedTaskIds(next);
      const activity = activityRow(
        householdId,
        projectId,
        'task_linked',
        'task',
        taskId,
      );
      await writeLocal(
        draft => {
          const row = draft.homeProjects.find(
            entry => entry.id === projectId && entry.household_id === householdId,
          );
          if (!row) throw new Error('Home project not found');
          row.linked_task_ids = serialized;
          row.updated_by = memberId;
          row.updated_at = nowIso();
          draft.homeProjectActivity.push(activity);
        },
        {
          opType: 'HOME_PROJECT_TASK_LINK',
          entityType: 'home_project',
          entityId: projectId,
          payload: { task_id: taskId },
        },
      );
    }
    return { link: { project_id: projectId, task_id: taskId } };
  },

  /**
   * `POST /:projectId/tasks` with a `title` — mint a job and attach it.
   *
   * Mirrors `createTaskFromProject` step for step, including the description
   * fallback that names the project, so a household reading a task a week later
   * sees the same sentence on either backend.
   *
   * **Two ops, and the order is the point.** The ownership check runs BEFORE
   * the task is created, so the one failure that could strand a task — a viewer
   * being refused the link — is refused before there is a task to strand.
   * After that the pair is a create and an update in one ordered op log: a peer
   * that has applied only the first has a task not yet attached, which the very
   * next op fixes. That is a transient state, not the permanent detachment the
   * old refusal existed to prevent.
   */
  createTask: async (
    householdId: string,
    projectId: string,
    input: { title: string; description?: string },
  ) => {
    const project = requireProjectOwner(householdId, projectId);
    const title = input.title.trim();
    if (!title) throw new Error('Task title required');

    const { task } = await localTasksApi.create(householdId, {
      title,
      description:
        input.description?.trim() || `From home project “${project.title}”.`,
      frequency: 'one_time',
      priority_severity: 'medium',
    });

    await localHomeProjectsApi.linkTask(householdId, projectId, task.id);
    return { link: { project_id: projectId, task_id: task.id, title: task.title } };
  },
};

/**
 * Re-exported for the tests and for whichever facade next needs to know what a
 * home project looks like on the ledger. Not part of the Proxy surface —
 * `apiParity.test.ts` compares FUNCTIONS, so a type export is invisible to it.
 */
export type {
  CreateHomeProjectInput,
  HomeProject,
  HomeProjectHub,
  HomeProjectTemplate,
};
