/**
 * Local `garden-plans` — the ledger counterpart of `src/api/garden-plans.ts`
 * (plan §11, sub-wave C3). The third block of Wave C, and four tables in one
 * facade: `garden_plans`, `garden_plan_objects`, `garden_plan_markers`,
 * `garden_plan_boundary_drafts`.
 *
 * Four tables and twenty-three methods: fifteen local, eight throws. The plan
 * briefed "~23" and for once that was right — but the split is not where it
 * looks. Three of the eight throws are not P4 and not H6; they are a feature the
 * SERVER has already retired, which is a shape no previous sub-wave has had.
 *
 * ## C2 is the analogue, and copying it wholesale would be wrong twice
 *
 * `localFloorPlansApi` is the closest thing in the tree — a plan with markers,
 * an image the device cannot process, a soft-deleted parent — and the two
 * features are similar enough that the differences need stating out loud:
 *
 *  - **`createMarker` runs no hit-test and back-fills no task.**
 *    `FloorPlanService.createMarker` resolves the pin's room out of
 *    `household_spaces` and writes `tasks.space_id`;
 *    `GardenPlanService.createMarker` (`garden-plan-service.ts:372`) inserts and
 *    returns. Porting C2's arithmetic here would ADD behaviour the server does
 *    not have — the mirror image of the bug C2's port existed to prevent.
 *  - **The marker DTO's `linked_entity_type` has no route-level rescue.** C2's
 *    route wraps the field in a `z.preprocess` that rewrites `'task'` to
 *    `'maintenance_task'`. This route does not: `routes/garden-plans.ts:59` is a
 *    plain `z.enum(['maintenance_task', 'action_item'])`, so the only value
 *    `CreateMarkerRequest` permits is 400-rejected. See `createMarker`.
 *  - **There is no fourth, Tier-D table.** `schema-garden-plans.ts` declares
 *    exactly the four tables this facade owns. C2's whole "the trap is the table
 *    you did not register" story has no counterpart here.
 *
 * ## The cascade audit — run twice, because §11.1.1 says the FK half is the
 * half that matters less
 *
 * **1. The FK audit** (`backend/src/db/schema-garden-plans.ts`, and every other
 * `schema*.ts` grepped for a reference INTO these four):
 *
 * | Direction | Finding |
 * |---|---|
 * | `garden_plans` → children | `garden_plan_objects.garden_plan_id` and `garden_plan_markers.garden_plan_id` both declare `onDelete: 'cascade'` — and `GardenPlanService.delete` is a **soft** delete (`garden-plan-service.ts:229`, `set deleted_at`). The row survives, so D1 has nothing to cascade and both children keep their live foreign key |
 * | `garden_plan_objects` / `garden_plan_markers` → children | none exist; both are leaves, and both are soft-deleted too (`replaceObjects` sets `deleted_at` on the whole previous layer; `deleteMarker` sets it on one row) |
 * | `garden_plan_boundary_drafts` → children | **none.** It is a leaf, which matters because it is the one C3 table the server HARD-deletes (`garden-plan-boundary-service.ts:145`, `.delete(gardenPlanBoundaryDrafts)`). A hard delete with nothing to cascade is the safe combination, and this is the only place in Wave C it occurs |
 * | `garden_plans.boundary_draft_id` → the draft | **not a foreign key at all.** It is a plain indexed `text` column with no `references()`, so the hard delete above leaves it dangling — on the server as much as on the ledger. Reproduced rather than repaired; see `deleteBoundaryDraft` |
 * | `households` → `garden_plans`, `garden_plan_boundary_drafts` | `onDelete: 'cascade'` on both, but `deleteHousehold` is soft (`household-service.ts:257`). And on device deleting a property tears down its whole ledger rather than rows within it — C1's argument, unchanged |
 * | `household_spaces` → `garden_plan_markers.space_id` | `onDelete: 'set null'`, not cascade — and `deleteSpace` is soft (`household-space-service.ts:273`), so it never fires either |
 * | `users` → `created_by` (three tables) and `user_id` (the draft) | `onDelete: 'cascade'`, and `users` is not a ledger table in any wave |
 * | anything already live → a C3 table | **nothing.** The only foreign keys pointing at these four come from `households`, `householdSpaces` and `users`, all covered above. So no existing facade changes and `CONTRACTOR_CASCADE_TABLES` needs no new entry — the same clean result C1 and C2 had |
 *
 * Plan §11.1.2 pre-audited this sub-wave as "no. `gardenPlanBoundaryDrafts` IS
 * hard-deleted but is a leaf", and that is **correct in every particular**. It
 * is also, on its own, the wrong conclusion to draw.
 *
 * **2. The local-tombstone audit** — the question §11.1.1 was corrected to ask
 * separately: *if a member deletes this row on device, is any child left
 * unreachable?*
 *
 * | Table | Answer |
 * |---|---|
 * | `gardenPlans` | **YES.** `LocalGardenPlan` is `GardenPlan`, and that DTO declares no `deleted_at` (`types.ts`, divergence 4). A ledger row IS the DTO (§3.2), so `delete` REMOVES the row while the Worker merely sets a column — and every object and marker left behind points at a plan that exists on no device. `GARDEN_PLAN_CHILD_TABLES` below is that set, and `deleteGardenPlan` drops it in ONE op |
 * | `gardenPlanObjects` | no — a leaf |
 * | `gardenPlanMarkers` | no — a leaf |
 * | `gardenPlanBoundaryDrafts` | no — a leaf, and here the ledger and the server AGREE, because this is the one table the server hard-deletes too |
 *
 * **So the FK-cascade audit is genuinely empty for the parent, and this facade
 * cascades anyway.** The two facts are about two different mechanisms: D1's
 * cascade is dead because the parent row survives with a `deleted_at`, and the
 * ledger's obligation is live because it has no `deleted_at` to survive with.
 * `localAppliancesApi.delete` settled this in Wave A and `FLOOR_PLAN_CHILD_TABLES`
 * repeated it in C2; this is the third time and it is now the default assumption
 * rather than a discovery.
 *
 * The orphan here is worse than C2's, which is worth saying because it is the
 * argument against ever "simplifying" this. A floor-plan marker with no plan is
 * invisible — nothing reads it except `getMarkersForEntity`. A garden OBJECT with
 * no plan is invisible in exactly the same way, but `garden_plan_objects` is the
 * only table in the registry a member can write EIGHTY rows to in one tap, and
 * `replaceObjects` rewrites all eighty on every save. A household that deletes a
 * few generated plans over a year would accumulate thousands of unreachable rows,
 * replicated to every peer, carried by every checkpoint, export and backup.
 *
 * ## Eight throws, in three groups, and no remote-only method
 *
 * **H6 — the bytes (3).** `getUploadUrl`, `uploadFile` and `confirmUpload` are
 * the direct-to-R2 transfer. A garden plan IS an image; there is no
 * metadata-only split to fall back on the way `contractorDocuments` and
 * `projectProgressPhotos` have one, because `original_file_key` is `notNull` and
 * the row is created by the upload-url call itself. Throws rather than
 * remote-only for the reason B1 established: a missing key routes the upload to
 * a Worker that would happily accept the photo and file the resulting plan into
 * a household whose rows live somewhere else entirely.
 *
 * **P2/P4 — the model and the job around it (3).**
 * `generateFromBoundaryDraft` runs `gpt-image-1` over a reference image and
 * enqueues a job; `cancelGeneration` and `retryGeneration` drive that job
 * afterwards, through `ai_tool_pending` (Tier B), a KV rate-limit counter and a
 * queue binding. None of the three is reachable from a device, and a local-first
 * plan can never be `generating` in the first place, so the two controls have
 * nothing to act on.
 *
 * **Retired — the satellite boundary flow (2).** `createBoundaryDraft` and
 * `confirmBoundaryDraft` are the new shape. Their routes return **410 for
 * everyone** (`routes/garden-plans.ts:194` and `:220`), and the service methods
 * behind them throw `MAP_PREVIEW_REMOVED` before writing anything, so no row has
 * been created by that path since the map preview was removed. They are still
 * local throws rather than `remoteMethods`, and the reason is not tidiness:
 * `createBoundaryDraft` POSTs the household's ADDRESS. Declaring it remote would
 * send a local-first home's street address to a Worker that is supposed to hold
 * nothing but ciphertext, in exchange for a 410. Their copy says the flow is
 * gone rather than that it is off in private mode, because that is the truth.
 *
 * A knock-on worth recording: `GardenPlanAddressScreen` branches on
 * `error.response?.status === 410` to show the retirement message, and a
 * `HouseLocalUnsupportedError` carries no `response`. Under local-first that
 * screen falls to its generic toast instead. The screen is out of scope for this
 * sub-wave; the fix is for it to branch on the error's `code` as the P4 screens
 * already do.
 *
 * **Remote by design: none.** Like C2 and unlike C1 there is no Tier C surface
 * anywhere in this feature — no catalogue, no template set, no shared glossary.
 * Every column of all four tables is the member's own.
 *
 * ## The reads that had to be local, and why
 *
 * Three of the fifteen would render empty-and-correct if they were left remote,
 * which is the §6 failure the Proxy exists to prevent:
 *
 *  - **`listBoundaryDrafts`** is not a table dump. It filters on `user_id`,
 *    restricts to two of the five statuses, drops anything past `expires_at`,
 *    orders by `updated_at` and caps at ten — five decisions over ledgered rows.
 *  - **`listObjects`** projects and ORDERS by `sort_order`; a Worker with none of
 *    these rows answers `{ objects: [] }` with a 200, and the editor opens on an
 *    empty garden that the member then saves over the top of.
 *  - **`replaceObjects`** is the editor's save, over a member's own layout, with
 *    the server's clamping ported into `logic/gardenPlanObjects.ts`.
 *
 * `updateBoundary` is the same argument in write form and is the C2 lesson
 * repeating: it looks like part of the retired satellite flow and is not — it is
 * the in-app boundary editor's save (`useBoundaryEditor`), landing on one
 * ledgered column.
 *
 * ## No bulk path, with one near miss
 *
 * `replaceObjects` is the only multi-row write and it is capped at eighty rows
 * by `GARDEN_PLAN_OBJECT_LIMIT`, so it stays comfortably inside one op's
 * plaintext budget; `deleteGardenPlan` is the other, and a delete op carries row
 * keys rather than row bodies. `writeLocalBulk` is therefore unused here, as in
 * B3 and C2 — but this is the closest a facade has come to needing it, and a
 * future limit raise is the thing that would change the answer.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import type { GardenPlanObject } from '@models/garden-objects';

import { MAP_PLAN_CONTENT_TYPE } from '@api/garden-plans';
import type {
  CreateMapPlanRequest,
  GardenPlan,
  GardenPlanAddressInput,
  GardenPlanBoundaryDraft,
  GardenPlanBoundarySource,
  GardenPlanMarker,
  GardenPlanType,
  GeoJsonPolygonGeometry,
} from '@api/garden-plans';

import { getLocalHouseMemberId } from './engine';
import { HouseLocalUnknownPropertyError, HouseLocalUnsupportedError } from './errors';
import { newLocalId } from './ids';
import { activeHouseholdId, nowIso, rowsOf, writeLocal } from './localWrite';
import { normalizeGardenObjects } from './logic/gardenPlanObjects';
import type { HouseLedgerTableName } from './schema';
import type {
  LocalGardenPlan,
  LocalGardenPlanBoundaryDraft,
  LocalGardenPlanMarker,
  LocalGardenPlanObject,
} from './types';

// ---------------------------------------------------------------------------
// Input shapes — mirrors of the module-private request types in
// `src/api/garden-plans.ts`. They are not exported there, so they are restated
// rather than imported; `apiParity.test.ts` catches a method that disappears and
// `tsc` catches a field whose type changed on a DTO. Everything that IS exported
// (`GardenPlanType`, `GeoJsonPolygonGeometry`, `GardenPlanBoundarySource`, …) is
// imported instead — a restatement of a type that can be imported is a second
// copy waiting to drift.
// ---------------------------------------------------------------------------

export type UpdateLocalGardenPlanInput = {
  plan_type?: GardenPlanType;
  label?: string;
};

export type LocalGardenPlanFilters = {
  limit?: number;
  cursor?: string;
};

export type UpdateLocalGardenPlanBoundaryInput = {
  boundary_geojson: GeoJsonPolygonGeometry;
  boundary_source: GardenPlanBoundarySource;
};

/**
 * `linked_entity_type` admits only `'task'` here because the client's
 * `CreateMarkerRequest` admits only that, and this type has to accept what a
 * screen may send. No row can hold it — see `createMarker`.
 */
export type CreateLocalGardenPlanMarkerInput = {
  x_percent: number;
  y_percent: number;
  linked_entity_type: 'task';
  linked_entity_id: string;
  marker_color?: string;
  marker_icon?: string;
  label?: string;
  show_label?: boolean;
  space_id?: string;
};

export type UpdateLocalGardenPlanMarkerInput = {
  x_percent?: number;
  y_percent?: number;
  marker_color?: string;
  marker_icon?: string;
  label?: string;
  show_label?: boolean;
  space_id?: string;
};

/**
 * Ledger tables D1 cascades when a `garden_plans` row is deleted **and that this
 * facade must therefore drop by hand.**
 *
 * The name is `CHILD` and not `CASCADE` on purpose, for the reason
 * `FLOOR_PLAN_CHILD_TABLES` gives: `BILL_CASCADE_TABLES` names a cascade that
 * genuinely fires (the Worker hard-deletes the bill, so D1 removes the reminders
 * and the ledger must match), whereas here the Worker SOFT deletes the plan, D1
 * removes nothing, and the obligation comes from the other end — the ledger's
 * own delete is a tombstone, so the children have to go with it or they orphan
 * forever. The full two-part audit is in this module's header.
 *
 * The list is still derived from the schema rather than hand-written, because
 * the foreign keys are real even though nothing fires them: a third ledgered
 * table declaring `references(() => gardenPlans.id, { onDelete: 'cascade' })`
 * would be a new orphan source, and `localGardenPlansApi.test.ts` parses the
 * Drizzle sources and fails on one that is missing here.
 *
 * Note what is NOT in this list and could look like it belongs:
 * `gardenPlanBoundaryDrafts`. `garden_plans.boundary_draft_id` points AT a
 * draft, in the opposite direction, and it carries no `references()` at all — so
 * a draft is not a child of a plan by any mechanism, and the schema-derived
 * guard proves the absence rather than the comment asserting it.
 */
export const GARDEN_PLAN_CHILD_TABLES = [
  'gardenPlanObjects',
  'gardenPlanMarkers',
] as const satisfies readonly HouseLedgerTableName[];

/** The column each child points back at the plan with. */
const GARDEN_PLAN_CHILD_COLUMNS: Record<(typeof GARDEN_PLAN_CHILD_TABLES)[number], string> = {
  gardenPlanObjects: 'garden_plan_id',
  gardenPlanMarkers: 'garden_plan_id',
};

/**
 * The value D1 actually stores for the client's `'task'`.
 *
 * `GARDEN_MARKER_LINKED_ENTITY_TYPES` is `['maintenance_task', 'action_item']`
 * and `GardenPlanMarker.linked_entity_type` is `'task'`, so the DTO names a
 * value no stored row has ever held. Unlike floor plans there is no
 * `z.preprocess` on the route to bridge them — see `createMarker`.
 */
const STORED_LINKED_ENTITY_TYPE = 'maintenance_task';

/**
 * The two statuses `listPendingDrafts` admits (`garden-plan-boundary-service.ts:130`).
 *
 * `generating`, `generated` and `expired` are the other three. A generated draft
 * is deliberately hidden from the list — its plan is what the member sees now —
 * and `deleteBoundaryDraft` refuses one for the same reason.
 */
const PENDING_DRAFT_STATUSES = new Set(['draft', 'confirmed']);

/** `listPendingDrafts`' own cap, ported. */
const PENDING_DRAFT_LIMIT = 10;

// ---------------------------------------------------------------------------
// Ported helpers — `garden-plan-service.ts` and
// `garden-plan-boundary-service.ts`, reproduced where the output is stored or
// member visible.
// ---------------------------------------------------------------------------

function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function plansOf(householdId: string): LocalGardenPlan[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalGardenPlan>('gardenPlans');
}

function objectsOf(householdId: string): LocalGardenPlanObject[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalGardenPlanObject>('gardenPlanObjects');
}

function markersOf(householdId: string): LocalGardenPlanMarker[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalGardenPlanMarker>('gardenPlanMarkers');
}

/**
 * Boundary drafts belonging to THIS member.
 *
 * The `user_id` filter is not defensive. `garden_plan_boundary_drafts` is the
 * only per-member table in the registry — every read in
 * `GardenPlanBoundaryService` carries `eq(user_id, userId)`, including
 * `getInternal`, which is why a peer's draft 404s rather than opening. Rows still
 * SYNC between devices (they are ledgered like anything else); what is scoped is
 * who may read one.
 */
function draftsOf(householdId: string): LocalGardenPlanBoundaryDraft[] {
  requireActiveProperty(householdId);
  const userId = getLocalHouseMemberId();
  return rowsOf<LocalGardenPlanBoundaryDraft>('gardenPlanBoundaryDrafts').filter(
    (row) => row.user_id === userId,
  );
}

/**
 * `getInternal` + the household check + the `deleted_at` check, which the Worker
 * performs in that order and which collapse to one lookup here: the ledger holds
 * one property and a deleted row is simply absent.
 */
function requirePlan(householdId: string, gardenPlanId: string): LocalGardenPlan {
  const plan = plansOf(householdId).find((row) => row.id === gardenPlanId);
  if (!plan) throw new Error('Garden plan not found');
  return plan;
}

/**
 * A marker is addressed by its own id with NO plan id — `updateMarker` and
 * `deleteMarker` take `(householdId, markerId)` — and the Worker reaches the
 * household through the marker's plan. Here the ledger is already one property,
 * so the lookup is direct; the `Marker` message matches the Worker's
 * `NotFoundError('Marker')` because it reaches screens.
 */
function requireMarker(householdId: string, markerId: string): LocalGardenPlanMarker {
  const marker = markersOf(householdId).find((row) => row.id === markerId);
  if (!marker) throw new Error('Marker not found');
  return marker;
}

function requireDraft(householdId: string, draftId: string): LocalGardenPlanBoundaryDraft {
  const draft = draftsOf(householdId).find((row) => row.id === draftId);
  if (!draft) throw new Error('Garden plan boundary draft not found');
  return draft;
}

/** Server order for plans and markers alike: `created_at` desc. */
function byCreatedAtDesc(a: { created_at: string }, b: { created_at: string }): number {
  return b.created_at.localeCompare(a.created_at);
}

/**
 * `toResponse`, ported — the projection that turns a draft ROW into the DTO.
 *
 * Only the derived half is rebuilt here, because the ledger row already holds
 * the parsed `address`, `geocode` and `confirmed_boundary` (`types.ts` argues
 * each). What it deliberately does NOT hold is `preview_image_url`, so this
 * rebuilds it from the key on every read — the same call
 * `localFloorPlansApi.getVectorAssets` makes, and for the same two reasons: a
 * stored URL is per-viewer and goes stale, and per-field LWW would carry one
 * member's dead link to every peer (`LedgeredHousehold.photo_url`, Wave A).
 *
 * The path is the relative `/files/<key>` C2 used rather than the Worker's
 * `${API_URL}/files/<key>`. On a local-first household the bytes are in the H6
 * blob channel and are not behind that route at all, so neither form resolves;
 * emitting the same SHAPE with the same null is what keeps the screen's "no
 * preview yet" branch working.
 */
function draftResponse(draft: LocalGardenPlanBoundaryDraft): GardenPlanBoundaryDraft {
  return {
    id: draft.id,
    status: draft.status,
    address: draft.address,
    formatted_address: draft.formatted_address,
    geocode: draft.geocode,
    parcel: null,
    confirmed_boundary: draft.confirmed_boundary,
    boundary_source: draft.boundary_source,
    preview_image_key: draft.preview_image_key,
    preview_image_url: draft.preview_image_key ? `/files/${draft.preview_image_key}` : null,
    reference_image_key: draft.reference_image_key,
    expires_at: draft.expires_at,
  };
}

/**
 * `listObjects`' projection, ported — ten of the sixteen columns.
 *
 * The row carries `garden_plan_id`, `sort_order` and `household_id` that the DTO
 * does not (`types.ts`, divergences 1 and 2), so a read has to drop them rather
 * than spreading the row: handing a screen extra keys would be harmless today
 * and would make the next reader assume the DTO has them.
 */
function objectResponse(row: LocalGardenPlanObject): GardenPlanObject {
  return {
    id: row.id,
    type: row.type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    label: row.label ?? null,
    color: row.color ?? null,
    metadata: row.metadata ?? null,
  };
}

/**
 * `update`'s field semantics: absent means "leave it alone".
 *
 * The Worker spreads `data` straight onto the update (`{ ...data, updated_at }`)
 * and Drizzle skips `undefined` keys, so an empty string is stored as an empty
 * string and never coalesced to null — the same quirk `localProjectsApi` and
 * `localFloorPlansApi` reproduce, and for the same reason: matching each
 * service's own behaviour is what keeps a plan renamed offline and one renamed
 * online byte-identical.
 */
function planPatch(data: UpdateLocalGardenPlanInput): Partial<LocalGardenPlan> {
  const patch: Partial<LocalGardenPlan> = {};
  if (data.plan_type !== undefined) patch.plan_type = data.plan_type;
  if (data.label !== undefined) patch.label = data.label;
  return patch;
}

function markerPatch(data: UpdateLocalGardenPlanMarkerInput): Partial<LocalGardenPlanMarker> {
  const patch: Partial<LocalGardenPlanMarker> = {};
  if (data.x_percent !== undefined) patch.x_percent = data.x_percent;
  if (data.y_percent !== undefined) patch.y_percent = data.y_percent;
  if (data.marker_color !== undefined) patch.marker_color = data.marker_color;
  if (data.marker_icon !== undefined) patch.marker_icon = data.marker_icon;
  if (data.label !== undefined) patch.label = data.label;
  if (data.show_label !== undefined) patch.show_label = data.show_label;
  if (data.space_id !== undefined) patch.space_id = data.space_id;
  return patch;
}

export const localGardenPlansApi = {
  // ---- upload (H6) --------------------------------------------------------

  /**
   * `POST /garden-plans/upload-url` — H6, and the throw that gates the other two.
   *
   * This method is where the `garden_plans` ROW is created, not just where the
   * URL is minted, so there is no metadata-only half to keep working the way
   * `contractorsApi.createDocument` and `projectsApi.addProgressPhoto` have one:
   * `original_file_key` is `notNull` and names an object that does not exist
   * yet.
   */
  getUploadUrl: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('gardenPlansApi.getUploadUrl');
  },

  uploadFile: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('gardenPlansApi.uploadFile');
  },

  confirmUpload: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('gardenPlansApi.confirmUpload');
  },

  // ---- map-drawn plans ----------------------------------------------------

  /**
   * `POST /garden-plans/map-plan` — LOCAL, and the only way a local-first
   * household can create a yard plan at all.
   *
   * ## Why this method exists
   *
   * Read the three throws above together and the hole is obvious: under
   * local-first, `getUploadUrl` is where the `garden_plans` ROW is created, and
   * it refuses, so `confirmUpload` has nothing to confirm and every other method
   * in this facade — fifteen careful local ports, an object editor, a marker
   * layer — operates on a table that can never acquire a first row. The feature
   * was reachable and completely inert.
   *
   * The reason `getUploadUrl` refuses is H6: it mints an R2 presigned URL and
   * `original_file_key` is `notNull` and names an object that does not exist
   * yet. That reasoning is sound and is not disturbed here. It simply does not
   * apply to a plan traced on a map, because **a map plan has no bytes**. The
   * satellite imagery is the device's own map tiles; the plan is the geometry.
   * There is no object to presign, no bucket to reach, and nothing to upload —
   * so `original_file_key` is honestly empty rather than dishonestly pointing at
   * an R2 key nobody wrote.
   *
   * ## Why the address never leaves the device
   *
   * The retired satellite flow (`createBoundaryDraft`, below) POSTed the
   * household's street address to the Worker so the Worker could geocode it and
   * fetch a static satellite image. That is the leak that retired it, and it is
   * why that method is a local throw rather than a remote passthrough.
   *
   * This method inverts that. Geocoding happens ON DEVICE through the OS
   * geocoder (`@services/geocoding` — CLGeocoder / Android's `Geocoder`, no API
   * key, no Symply server involved), the map tiles come from the platform's own
   * map, and what lands here is geometry the member drew. `geocode_place_name`
   * is written straight to the ledger. Nothing about the home's location is
   * transmitted anywhere, which is the standard the rest of this file is held to.
   *
   * ## One op, not three
   *
   * The plan row, its zones and its elements are written in a SINGLE op for
   * `deleteGardenPlan`'s reason: between a plan-create op and an objects-insert
   * op, every peer would hold a traced lot with no areas in it and no signal
   * that more was coming. A plan is never partially real on any device.
   *
   * Objects are normalised through the SAME ported clamp `replaceObjects` uses,
   * so a zone traced in the wizard and the identical zone dragged in the editor
   * store identical numbers.
   */
  createMapPlan: async (householdId: string, data: CreateMapPlanRequest) => {
    requireActiveProperty(householdId);
    const timestamp = nowIso();
    const planId = newLocalId('gp');
    const memberId = getLocalHouseMemberId();
    const label = data.label?.trim() ? data.label.trim() : null;

    const plan: LocalGardenPlan = {
      id: planId,
      household_id: householdId,
      plan_type: data.plan_type,
      // Empty rather than a fabricated key. Every reader that would fetch bytes
      // checks `content_type` first (`isMapDrawnPlan`), and a plausible-looking
      // R2 key that resolves to nothing is worse than an obviously absent one.
      original_file_key: '',
      display_image_key: null,
      thumbnail_key: null,
      filename: `${label ?? 'yard-plan'}.geojson`,
      file_size: 0,
      content_type: MAP_PLAN_CONTENT_TYPE,
      label,
      width_px: null,
      height_px: null,
      // `completed` is the truth, not an optimism: nothing is queued, no model
      // runs, and the plan is fully viewable the instant this write lands.
      status: 'completed',
      error_message: null,
      reference_image_source: null,
      boundary_draft_id: null,
      boundary_source: data.boundary_source ?? 'user_drawn',
      // Stored as the JSON STRING D1 stores and `ringFromGeoJson` parses, for
      // `updateBoundary`'s reason: the DTO types this column `string`.
      boundary_geojson: JSON.stringify(data.boundary_geojson),
      geocode_place_name: data.geocode_place_name ?? null,
      created_by: memberId,
      created_at: timestamp,
      updated_at: timestamp,
    };

    const objectRows: LocalGardenPlanObject[] = normalizeGardenObjects(data.objects ?? []).map(
      (object, index) => ({
        id: newLocalId('gpo'),
        household_id: householdId,
        garden_plan_id: planId,
        type: object.type,
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rotation: object.rotation,
        label: object.label,
        color: object.color,
        metadata: object.metadata,
        sort_order: index,
      }),
    );

    await writeLocal(
      (draft) => {
        draft.gardenPlans.push(plan);
        if (objectRows.length > 0) {
          draft.gardenPlanObjects = [...draft.gardenPlanObjects, ...objectRows];
        }
      },
      {
        opType: 'GARDEN_PLAN_MAP_CREATE',
        entityType: 'garden_plan',
        entityId: planId,
        payload: { garden_plan: plan, object_count: objectRows.length },
      },
    );

    return { garden_plan: plan };
  },

  // ---- garden plans -------------------------------------------------------

  /**
   * `GET /garden-plans` — the list, with the Worker's cursor pagination.
   *
   * `limit` is `min(limit || 50, 100)` and the cursor is the LAST ROW'S ID of
   * the page, both ported — including the quirk C2 found in the identical floor
   * plan code: the Worker selects `limit + 1` rows, returns the id of the last
   * row it kept, and then never uses it as an offset. `GardenPlanService.list`
   * accepts `cursor` and does not filter on it, so requesting page two returns
   * page one. Reproduced rather than fixed: a household with 51 plans would
   * otherwise page differently on the two backends, and no screen passes a
   * cursor at all.
   *
   * The Worker's `isNull(deleted_at)` has no counterpart because a deleted row
   * is simply absent from the ledger.
   */
  list: async (householdId: string, filters?: LocalGardenPlanFilters) => {
    const limit = Math.min(filters?.limit || 50, 100);
    const rows = plansOf(householdId).sort(byCreatedAtDesc);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      garden_plans: items,
      next_cursor: hasMore ? items[items.length - 1]!.id : undefined,
    };
  },

  get: async (householdId: string, gardenPlanId: string) => ({
    garden_plan: requirePlan(householdId, gardenPlanId),
  }),

  update: async (householdId: string, gardenPlanId: string, data: UpdateLocalGardenPlanInput) => {
    requirePlan(householdId, gardenPlanId);
    const patch = planPatch(data);
    await writeLocal(
      (draft) => {
        const plan = draft.gardenPlans.find(
          (row) => row.id === gardenPlanId && row.household_id === householdId,
        );
        if (!plan) throw new Error('Garden plan not found');
        Object.assign(plan, patch);
        plan.updated_at = nowIso();
      },
      {
        opType: 'GARDEN_PLAN_UPDATE',
        entityType: 'garden_plan',
        entityId: gardenPlanId,
        payload: data,
      },
    );
    return { garden_plan: requirePlan(householdId, gardenPlanId) };
  },

  /**
   * `PATCH /garden-plans/:id/boundary` — the in-app boundary editor's save, and
   * the C2 lesson repeating one sub-wave later.
   *
   * This LOOKS like part of the retired satellite flow and is not. The two
   * methods that are retired take a DRAFT id and are 410 for everyone; this one
   * takes a PLAN id and is `useBoundaryEditor`'s save, where a member drags the
   * outline of their own lot over their own photo. It writes two ledgered
   * columns and nothing else — no geocode, no map, no model.
   *
   * The geometry is stored as the JSON STRING the Worker stores, not as the
   * object the caller passed. That is the opposite of the call C2 made on
   * `svg_data` and B3 made on `linked_report_ids`, and the reason is that the
   * DTO agrees with D1 here: `GardenPlan.boundary_geojson` is typed `string`,
   * `useBoundaryEditor` calls `JSON.parse` on it, and storing an object would
   * break that parse on every read.
   */
  updateBoundary: async (
    householdId: string,
    gardenPlanId: string,
    data: UpdateLocalGardenPlanBoundaryInput,
  ) => {
    requirePlan(householdId, gardenPlanId);
    const geojson = JSON.stringify(data.boundary_geojson);
    await writeLocal(
      (draft) => {
        const plan = draft.gardenPlans.find(
          (row) => row.id === gardenPlanId && row.household_id === householdId,
        );
        if (!plan) throw new Error('Garden plan not found');
        plan.boundary_geojson = geojson;
        plan.boundary_source = data.boundary_source;
        plan.updated_at = nowIso();
      },
      {
        opType: 'GARDEN_PLAN_BOUNDARY_UPDATE',
        entityType: 'garden_plan',
        entityId: gardenPlanId,
        payload: data,
      },
    );
    return { garden_plan: requirePlan(householdId, gardenPlanId) };
  },

  /**
   * `DELETE /garden-plans/:id` — the plan AND its objects and markers, in ONE op.
   *
   * The Worker soft-deletes and leaves the children with a live foreign key. The
   * ledger has no `deleted_at` on this DTO, so the delete is a tombstone and a
   * child left behind is an orphan that syncs to every peer and is never read.
   * `localAppliancesApi.delete` made this call first and C2 repeated it; the full
   * two-part audit is in this module's header.
   *
   * ONE op rather than three is the other half, for `localProjectsApi`'s reason:
   * between the first write and the last, a peer would hold eighty objects
   * belonging to a plan it no longer has.
   *
   * The plan's `boundary_draft_id` is deliberately NOT followed. A draft is not a
   * child of a plan by any mechanism — the column has no `references()` — and the
   * server leaves the draft alone here too; a member who generated three plans
   * from one traced lot would otherwise lose the tracing by deleting one of them.
   */
  delete: async (householdId: string, gardenPlanId: string) => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const exists = draft.gardenPlans.some(
          (row) => row.id === gardenPlanId && row.household_id === householdId,
        );
        if (!exists) throw new Error('Garden plan not found');
        draft.gardenPlans = draft.gardenPlans.filter((row) => row.id !== gardenPlanId);
        for (const table of GARDEN_PLAN_CHILD_TABLES) {
          const column = GARDEN_PLAN_CHILD_COLUMNS[table];
          const rows = draft[table] as unknown as Record<string, unknown>[];
          (draft[table] as unknown) = rows.filter((row) => row[column] !== gardenPlanId);
        }
      },
      {
        opType: 'GARDEN_PLAN_DELETE',
        entityType: 'garden_plan',
        entityId: gardenPlanId,
        payload: { id: gardenPlanId },
      },
    );
  },

  // ---- AI generation and the job around it (P2/P4) ------------------------

  /**
   * `POST /garden-plans/boundary-drafts/:id/generate` — P2/P4.
   *
   * `createVectorGardenPlanFromBoundary` builds a prompt from the member's
   * answers, sends it and a satellite or photo reference to `gpt-image-1`, and
   * enqueues the result. Under E2EE the Worker holds ciphertext and the device
   * holds no model.
   */
  generateFromBoundaryDraft: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('gardenPlansApi.generateFromBoundaryDraft');
  },

  /**
   * `POST /garden-plans/:id/cancel` — the control, not the model, and still a
   * throw.
   *
   * It looks like a local state change: `status` goes `generating` → `failed`
   * and both are ledgered columns. It is not. `cancelGardenPlanGeneration` also
   * flips the linked `ai_tool_pending` row (Tier B, never ledgered) and refunds
   * a KV rate-limit counter, and neither is reachable from a device. More to the
   * point, the precondition can never hold: a plan is only ever `generating`
   * because a server job put it there, and that job cannot start for a
   * local-first household. A local implementation would answer the Worker's own
   * 409 to every caller, forever, which is a worse lie than an honest refusal.
   */
  cancelGeneration: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('gardenPlansApi.cancelGeneration');
  },

  /** `POST /garden-plans/:id/retry` — re-enqueues the model run above. */
  retryGeneration: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('gardenPlansApi.retryGeneration');
  },

  // ---- boundary drafts ----------------------------------------------------

  /**
   * `POST /garden-plans/boundary-drafts` — retired, and a throw rather than a
   * remote-only declaration.
   *
   * The route returns **410 to every household** and the service throws
   * `MAP_PREVIEW_REMOVED` before it writes anything, so this is not a
   * local-first gap at all — the satellite lot tracing is gone for everyone. It
   * is still a local throw, because the request BODY is the household's postal
   * address: routing it to the Worker would leak a local-first home's street
   * address in exchange for a 410. The copy says the flow is retired rather than
   * that it is off in private mode, because that is what is true.
   */
  createBoundaryDraft: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('gardenPlansApi.createBoundaryDraft');
  },

  /** `PATCH /garden-plans/boundary-drafts/:id/boundary` — retired, as above. */
  confirmBoundaryDraft: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('gardenPlansApi.confirmBoundaryDraft');
  },

  /**
   * `GET /garden-plans/boundary-drafts/:id` — LOCAL.
   *
   * `getInternal` matches on `(id, household_id, user_id)` and 404s otherwise,
   * so a draft another member started is not readable even though the row syncs.
   * Ported exactly: `draftsOf` carries the `user_id` filter.
   */
  getBoundaryDraft: async (householdId: string, draftId: string) => ({
    boundary_draft: draftResponse(requireDraft(householdId, draftId)),
  }),

  /**
   * `GET /garden-plans/boundary-drafts` — LOCAL, and five decisions rather than
   * a table dump.
   *
   * `listPendingDrafts` filters on the member, keeps only `draft` and
   * `confirmed`, drops anything whose `expires_at` has passed, orders by
   * `updated_at` descending and caps at ten. Every one of those is a function of
   * rows the device already holds, so remote it would answer `{ boundary_drafts:
   * [] }` with a 200 and `GardenPlansScreen` would show no pending tracing at
   * all — the §6 silence, in the one place a member would read it as "I never
   * started one".
   *
   * The expiry comparison is a string comparison, as the Worker's
   * `gt(expires_at, nowIso())` is: both sides are ISO-8601, which sorts
   * lexicographically.
   */
  listBoundaryDrafts: async (householdId: string) => {
    const now = nowIso();
    const rows = draftsOf(householdId)
      .filter((row) => PENDING_DRAFT_STATUSES.has(row.status) && row.expires_at > now)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, PENDING_DRAFT_LIMIT);
    return { boundary_drafts: rows.map(draftResponse) };
  },

  /**
   * `DELETE /garden-plans/boundary-drafts/:id` — LOCAL, and the one delete in
   * this facade where the ledger and the server already agreed.
   *
   * `deleteDraft` HARD-deletes (`.delete(gardenPlanBoundaryDrafts)`), which is
   * the only hard delete in the whole of Wave C outside C1's bill — and the table
   * is a leaf, so it cascades nothing on either backend. That is why the
   * pre-audit's "hard-deleted but a LEAF" was the right answer here and the wrong
   * one for the plan above.
   *
   * The status guard is the Worker's and is reproduced: a draft that has already
   * been `generated` (or is mid-generation, or has expired) 404s rather than
   * being removed, because the plan built from it is what the member has now.
   *
   * `garden_plans.boundary_draft_id` is left pointing at the removed row. That is
   * a dangling pointer on BOTH backends — the column carries no `references()`,
   * so D1 does not clear it either — and the one reader,
   * `retryGardenPlanGeneration`, already tolerates a missing draft
   * (`draft?.reference_image_key ?? null`). Repairing it locally would make a
   * plan's provenance differ between a household on the server and one on the
   * ledger.
   */
  deleteBoundaryDraft: async (householdId: string, draftId: string) => {
    const draft = requireDraft(householdId, draftId);
    if (!PENDING_DRAFT_STATUSES.has(draft.status)) {
      throw new Error('Garden plan boundary draft not found');
    }
    await writeLocal(
      (mutable) => {
        mutable.gardenPlanBoundaryDrafts = mutable.gardenPlanBoundaryDrafts.filter(
          (row) => row.id !== draftId,
        );
      },
      {
        opType: 'GARDEN_PLAN_BOUNDARY_DRAFT_DELETE',
        entityType: 'garden_plan_boundary_draft',
        entityId: draftId,
        payload: { id: draftId },
      },
    );
  },

  // ---- vector objects -----------------------------------------------------

  /**
   * `GET /garden-plans/:id/objects` — LOCAL, and ordered.
   *
   * `sort_order` is what makes this a real read rather than a dump: the D1 query
   * ends `.orderBy(gardenPlanObjects.sort_order)` and the JSON array's order is
   * the only place that value survives to the screen. A ledger is an unordered
   * row set, so the column had to be added to the row type (`types.ts`,
   * divergence 2) and sorted on here, or two devices draw the same garden with
   * the beds and the paths stacked in a different order.
   */
  listObjects: async (householdId: string, gardenPlanId: string) => {
    requirePlan(householdId, gardenPlanId);
    return {
      objects: objectsOf(householdId)
        .filter((row) => row.garden_plan_id === gardenPlanId)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(objectResponse),
    };
  },

  /**
   * `PUT /garden-plans/:id/objects` — the object editor's save, in ONE op.
   *
   * The Worker's shape, ported whole: normalise (`logic/gardenPlanObjects.ts`),
   * drop every existing object for this plan, insert the survivors with FRESH
   * ids and `sort_order` set to the array index, then read back. Three details
   * are the service's and are easy to lose by being reasonable:
   *
   *  - **the caller's `id` is discarded.** `replaceObjects` mints
   *    `generateId()` per row even though its input type carries an id, so a
   *    saved tree is a new row every time. Reproduced.
   *  - **the excess is dropped silently** at eighty objects, on both backends.
   *  - **an empty array is a legal save** — it clears the layer rather than
   *    being ignored, which is how a member removes the last object.
   *
   * ONE op for `deleteGardenPlan`'s reason and one more: a peer that received the
   * drop without the insert would render an empty garden, and a peer that
   * received them out of order would render a doubled one.
   *
   * **The one place the local answer differs, named rather than hidden.**
   * Server-side this method is last-write-wins over the whole layer: if two
   * members save offline, whoever reaches the Worker second erases the other's
   * arrangement completely. On the ledger each row is its own tombstone or
   * insert, so the merge keeps BOTH members' objects — the garden gains
   * everything either of them placed instead of losing one of them wholesale.
   * That is the CRDT-native answer and it loses no work, which is why it is not
   * "fixed": there is no way to reproduce the server's silent overwrite without
   * a ledger-wide notion of "replace this table for this parent", and inventing
   * one to discard a member's edits would be a strange thing to build.
   */
  replaceObjects: async (
    householdId: string,
    gardenPlanId: string,
    vectorObjects: GardenPlanObject[],
  ) => {
    requirePlan(householdId, gardenPlanId);
    const timestamp = nowIso();
    const rows: LocalGardenPlanObject[] = normalizeGardenObjects(vectorObjects ?? []).map(
      (object, index) => ({
        // Random id: `garden_plan_objects` carries no `uniqueIndex` in D1 and
        // needs none — two members each placing a shrub made two shrubs on
        // purpose, and a deterministic id would merge them.
        id: newLocalId('gpo'),
        // D1 scopes an object by its plan alone; H5 puts several properties on
        // one device, so the ledger row carries the property too (`types.ts`).
        household_id: householdId,
        garden_plan_id: gardenPlanId,
        type: object.type,
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rotation: object.rotation,
        label: object.label,
        color: object.color,
        metadata: object.metadata,
        sort_order: index,
      }),
    );

    await writeLocal(
      (draft) => {
        draft.gardenPlanObjects = [
          ...draft.gardenPlanObjects.filter((row) => row.garden_plan_id !== gardenPlanId),
          ...rows,
        ];
      },
      {
        opType: 'GARDEN_PLAN_OBJECTS_REPLACE',
        entityType: 'garden_plan',
        entityId: gardenPlanId,
        payload: { garden_plan_id: gardenPlanId, count: rows.length, updated_at: timestamp },
      },
    );

    return { objects: rows.map(objectResponse) };
  },

  // ---- markers ------------------------------------------------------------

  listMarkers: async (householdId: string, gardenPlanId: string) => {
    requirePlan(householdId, gardenPlanId);
    return {
      markers: markersOf(householdId)
        .filter((row) => row.garden_plan_id === gardenPlanId)
        .sort(byCreatedAtDesc),
    };
  },

  /**
   * `GET /garden-plans/markers/for-entity/:type/:id` — every garden pin for one
   * task.
   *
   * The same translation gap C2 found, one table over: the route reads the path
   * parameter raw (`routes/garden-plans.ts:489`) and compares it to the stored
   * column, so a caller passing the only value the client type allows —
   * `'task'` — matches nothing on the server, every time, for every household.
   * Reproducing that would be the §6 failure by hand, so both spellings are
   * matched.
   */
  getMarkersForEntity: async (householdId: string, entityType: 'task', entityId: string) => {
    requireActiveProperty(householdId);
    // Both spellings, widened to `string` because the DTO's literal union is
    // exactly the value D1 never stores — comparing the stored form against it
    // is a type error and would be silently `false` if it were not.
    const accepted = new Set<string>([entityType, STORED_LINKED_ENTITY_TYPE]);
    return {
      markers: markersOf(householdId).filter(
        (row) =>
          accepted.has(row.linked_entity_type as string) && row.linked_entity_id === entityId,
      ),
    };
  },

  /**
   * `POST /garden-plans/:id/markers` — the insert, and nothing else.
   *
   * **This method works on device and does not work against the server**, which
   * is a stronger claim than C2's and is worth stating plainly. The route's zod
   * is `z.enum(['maintenance_task', 'action_item'])` with no `z.preprocess` to
   * bridge the DTO's `'task'` — floor plans have one, this does not — and
   * `GardenPlanViewerScreen` sends `linked_entity_type: 'task'`, the only value
   * `CreateMarkerRequest` permits. So every attempt to pin a task to a yard plan
   * has 400'd, for every household, since the feature shipped. The facade stores
   * `'maintenance_task'`, which is what a working call would have written, and
   * `getMarkersForEntity` above finds it under either name.
   *
   * No space hit-test and no task back-fill: `GardenPlanService.createMarker`
   * has neither, and adding C2's would file a task into a room because a member
   * dropped a pin on a photo of the lawn.
   *
   * `marker_icon` defaults to a leaf emoji and `marker_color` to `#4CAF50` —
   * both stored rather than defaulted at render time, because D1 declares them
   * `.notNull()` with those defaults and a member may change either. Note both
   * differ from the floor-plan marker's defaults (`📍` and `#FF6B6B`).
   */
  createMarker: async (
    householdId: string,
    gardenPlanId: string,
    data: CreateLocalGardenPlanMarkerInput,
  ) => {
    requirePlan(householdId, gardenPlanId);

    const timestamp = nowIso();
    const marker: LocalGardenPlanMarker = {
      // Random id: `garden_plan_markers` carries no `uniqueIndex` in D1 and
      // needs none. Two members pinning the same shrub offline made two pins on
      // purpose, and a deterministic id would merge them.
      id: newLocalId('gpm'),
      household_id: householdId,
      garden_plan_id: gardenPlanId,
      x_percent: data.x_percent,
      y_percent: data.y_percent,
      // What the route WOULD have stored, if the route accepted the value the
      // client type sends. `'task'` is what the DTO says and
      // `'maintenance_task'` is what every row holds.
      linked_entity_type: STORED_LINKED_ENTITY_TYPE as GardenPlanMarker['linked_entity_type'],
      linked_entity_id: data.linked_entity_id,
      marker_color: data.marker_color || '#4CAF50',
      marker_icon: data.marker_icon || '🌿',
      label: data.label ?? null,
      show_label: data.show_label ?? true,
      space_id: data.space_id ?? null,
      created_by: getLocalHouseMemberId(),
      created_at: timestamp,
      updated_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        draft.gardenPlanMarkers.push(marker);
      },
      {
        opType: 'GARDEN_PLAN_MARKER_CREATE',
        entityType: 'garden_plan_marker',
        entityId: marker.id,
        payload: marker,
      },
    );
    return { marker };
  },

  updateMarker: async (
    householdId: string,
    markerId: string,
    data: UpdateLocalGardenPlanMarkerInput,
  ) => {
    requireMarker(householdId, markerId);
    const patch = markerPatch(data);
    await writeLocal(
      (draft) => {
        const marker = draft.gardenPlanMarkers.find((row) => row.id === markerId);
        if (!marker) throw new Error('Marker not found');
        Object.assign(marker, patch);
        marker.updated_at = nowIso();
      },
      {
        opType: 'GARDEN_PLAN_MARKER_UPDATE',
        entityType: 'garden_plan_marker',
        entityId: markerId,
        payload: data,
      },
    );
    return { marker: requireMarker(householdId, markerId) };
  },

  /**
   * `DELETE /garden-plans/markers/:id` — a leaf, so no cascade of any kind.
   *
   * The linked task is deliberately untouched, for C2's reason: the pin recorded
   * where the job is, and taking it off the drawing is not a claim that the job
   * moved. `GardenPlanService.deleteMarker` does not touch it either.
   */
  deleteMarker: async (householdId: string, markerId: string) => {
    requireMarker(householdId, markerId);
    await writeLocal(
      (draft) => {
        draft.gardenPlanMarkers = draft.gardenPlanMarkers.filter((row) => row.id !== markerId);
      },
      {
        opType: 'GARDEN_PLAN_MARKER_DELETE',
        entityType: 'garden_plan_marker',
        entityId: markerId,
        payload: { id: markerId },
      },
    );
  },
};

/**
 * Re-exported for the tests and for whichever facade next needs to know what a
 * garden plan looks like on the ledger. Not part of the Proxy surface —
 * `apiParity.test.ts` compares FUNCTIONS, so a type export is invisible to it.
 */
export type {
  GardenPlan,
  GardenPlanAddressInput,
  GardenPlanBoundaryDraft,
  GardenPlanBoundarySource,
  GardenPlanMarker,
  GardenPlanObject,
  GardenPlanType,
  GeoJsonPolygonGeometry,
};
