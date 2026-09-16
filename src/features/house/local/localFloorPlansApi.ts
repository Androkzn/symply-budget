/**
 * Local `floor-plans` — the ledger counterpart of `src/api/floor-plans.ts`
 * (plan §11, sub-wave C2). The second block of Wave C, and three tables in one
 * facade: `floor_plans`, `floor_plan_markers`, `floor_plan_annotations`.
 *
 * Three tables and twenty-five methods, which is the ratio C1 warned about:
 * **estimate a Wave-C facade by what its methods COMPUTE, not by how many tables
 * it registers.** Eight of the twenty-five are throws and seventeen are local,
 * and four of the seventeen carry arithmetic ported out of the Worker.
 *
 * ## The fourth table, which is the trap this sub-wave sets
 *
 * `schema-floor-plans.ts` declares FOUR tables and only three may be ledgered.
 * `floor_plan_regions` sits between the markers and the annotations in that
 * file, has an `id`, a `floor_plan_id`, timestamps and a client DTO
 * (`FloorPlanRegion`) exactly as they do — and it is **Tier D**. It is the
 * segmentation model's output: crops, per-region SVG traces and space lists
 * derived from the image by `floor-plan-region-pipeline.ts`. H7 re-derives that
 * on device or the feature is off, and the one thing it must never be is synced
 * between members, because then a stale derivation from one phone becomes the
 * shared truth on the other. It is named in `HOUSE_TIER_D_TABLES` and
 * `registryGuard.test.ts` asserts tier-disjointness over the whole registry, so
 * the exclusion is proved rather than remembered. The three methods
 * that read or drive it (`listRegions`, `processPendingRegions`, `retryRegion`)
 * are throws, not remote-only, for the reason every throw in this file is.
 *
 * ## The cascade audit — the FK audit is empty, the ledger obligation is not
 *
 * Plan §11.1.2 pre-audited every Wave-C parent and recorded C2 as "no — markers
 * and annotations correctly survive". That was re-derived against
 * `backend/src/db/schema-floor-plans.ts` and `floor-plan-service.ts` before a
 * line of this file was written, and it is **correct**:
 *
 * | Direction | Finding |
 * |---|---|
 * | `floor_plans` → children | `floor_plan_regions`, `floor_plan_markers` and `floor_plan_annotations` all declare `onDelete: 'cascade'` — and `deleteFloorPlan` is a **soft** delete (`floor-plan-service.ts:334`, `set deleted_at`). The row survives, so D1 has nothing to cascade and all three children keep their live foreign key |
 * | `floor_plan_markers` / `floor_plan_annotations` → children | none exist; both are leaves, and both are soft-deleted too |
 * | `households` → `floor_plans` | `onDelete: 'cascade'`, but `deleteHousehold` is soft as well (`household-service.ts:257`). And on device deleting a property tears down its whole ledger rather than rows within it — C1's argument, unchanged |
 * | `householdSpaces` → `floor_plan_markers.space_id` | `onDelete: 'set null'`, not cascade — and `deleteSpace` is soft (`household-space-service.ts:273`), so it never fires either |
 * | `users` → `created_by` on both child tables | `onDelete: 'cascade'`, and `users` is not a ledger table in any wave |
 * | anything already live → a C2 table | **nothing.** The only foreign keys pointing at these three come from `households`, `householdSpaces` and `users`, all covered above. So no existing facade changes and `CONTRACTOR_CASCADE_TABLES` needs no new entry — the same clean result C1 had |
 *
 * **So the FK-cascade audit is genuinely empty, and this facade cascades
 * anyway.** The two facts are not in tension; they are about two different
 * mechanisms. D1's cascade is dead because the parent row survives with a
 * `deleted_at`. The LEDGER has no `deleted_at` on `LocalFloorPlan` — the DTO
 * does not declare one, and a ledger row IS the DTO (§3.2) — so a local delete
 * is a real tombstone, and a marker left behind points at a plan that no longer
 * exists on any device. That orphan is invisible (nothing reads a marker without
 * its plan, except `getMarkersForEntity`, which would hand a screen a pin it
 * cannot open) and permanent (a tombstone is absorbing).
 *
 * `localAppliancesApi.delete` settled exactly this distinction in Wave A, in
 * the same words: *"The Worker leaves the history rows behind (the appliance is
 * only soft-deleted, so nothing dangles); a ledger delete is a tombstone, and
 * orphaned children would sit in the ledger forever."* `FLOOR_PLAN_CHILD_TABLES`
 * below names the set and `deleteFloorPlan` performs it in ONE op.
 *
 * (`localTasksApi.delete` deliberately does the opposite for subtasks and notes
 * and §11.1.1 says not to "fix" it. The difference is what the child is FOR: a
 * completion is history a member may still want listed under a deleted task,
 * whereas a marker has no meaning at all without the drawing it is pinned to.)
 *
 * ## The three cross-table writes, all into LIVE Wave-A tables
 *
 * `createMarker` is not an insert. `FloorPlanService.createMarker` does three
 * things and two of them touch tables this facade does not own:
 *
 *  1. **Space hit-test.** When the caller supplies no `space_id`, the Worker
 *     hit-tests the marker's position against every `household_spaces` row
 *     placed on this plan (`resolveSpaceAtPoint`, `floor-plan-service.ts:1142`).
 *     `householdSpaces` is Wave A and live, so this is pure arithmetic over rows
 *     the device already holds — it MUST be local, or a pin dropped offline
 *     would lose the room it was dropped in.
 *  2. **Task space back-fill.** If a space was resolved and the linked entity is
 *     a maintenance task with no space of its own, the Worker writes
 *     `tasks.space_id`. `tasks` is Wave A and live. The facade writes
 *     `draft.tasks` directly in its OWN op, which is the precedent
 *     `localContractorsApi.createReceiptReminderTask` and
 *     `localUtilitiesApi.createBill` both set: two ops would let a peer hold a
 *     marker whose task has not moved, or a moved task with no marker.
 *  3. The insert itself.
 *
 * All three are one op, for the reason (2) gives.
 *
 * ## Eight throws, no remote-only method
 *
 * **H6 — the bytes (3).** `getUploadUrl`, `uploadFile` and `confirmUpload` are
 * the direct-to-R2 transfer. A floor plan IS an image; there is no metadata-only
 * split to fall back on the way `contractorDocuments` and
 * `projectProgressPhotos` have one, because `original_file_key` is `notNull` and
 * the row is created by the upload-url call itself. They are throws rather than
 * remote-only for the reason B1 established: a missing key routes the upload to
 * a Worker that would happily accept the PDF and file the resulting plan into a
 * household whose rows live somewhere else entirely.
 *
 * **P4 — the models (2).** `triggerAnalysis` and `triggerVectorization` each
 * pull the raster out of R2 and run Claude Vision over it. Under E2EE the Worker
 * holds ciphertext and the device holds no model.
 *
 * **Tier D — the derived geometry (3).** `listRegions`, `processPendingRegions`
 * and `retryRegion` read and drive `floor_plan_regions`. Declaring them
 * remote-only would be the §6 failure in its purest form: the Worker would
 * answer `{ regions: [] }` with a 200 for a plan it has never seen, and the
 * viewer would render a floor plan with no floors detected rather than a plan
 * whose detection is off.
 *
 * **Remote by design: none.** Unlike C1 (`getMunicipality`, Tier C) there is no
 * global reference data anywhere in this feature — every column of all three
 * tables is the member's own.
 *
 * ## What is deliberately NOT reproduced
 *
 *  - **The region re-sync inside `updateAnalysis`.** `updateAnalysisAreas` ends
 *    by calling `regionPipeline.syncRegionsAfterAreaEdit`, which invalidates and
 *    re-crops the regions whose bounding boxes moved. Regions are Tier D and
 *    there are none on device, so there is nothing to invalidate; the analysis
 *    write itself — which is the member's edit and lands on a ledgered column —
 *    happens exactly as the Worker performs it.
 *  - **The R2 `head` check in `confirmUpload`.** Moot: the method throws.
 *  - **`/files/…` URLs.** `getVectorAssets` builds them from the stored keys and
 *    the facade does too, unchanged, because the shape is what the screen reads.
 *    The keys themselves are H6 blob names; a local-first household's bytes are
 *    not behind that Worker route, which is what `triggerVectorization`'s throw
 *    is about. Emitting the same shape with the same nulls is what keeps the
 *    viewer's "no vector layer yet" branch working.
 *
 * ## No bulk path
 *
 * Every write is one row, or one row plus its children. `deleteFloorPlan` is the
 * one multi-row write and a delete op carries row keys rather than row bodies,
 * so it is one op regardless of how many pins the plan had. `writeLocalBulk` is
 * therefore unused here, exactly as in B3.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import type {
  BoundingBox,
  DetectedDimension,
  FloorPlan,
  FloorPlanAnalysis,
  FloorPlanAnnotation,
  FloorPlanMarker,
  FloorPlanVectorAssets,
  UpdateAnalysisRequest,
} from '@api/floor-plans';

import { getLocalHouseMemberId } from './engine';
import { HouseLocalUnknownPropertyError, HouseLocalUnsupportedError } from './errors';
import { newLocalId } from './ids';
import { activeHouseholdId, nowIso, rowsOf, writeLocal } from './localWrite';
import {
  applyAnalysisAreaEdit,
  convertLegacyFloorPlanAnalysis,
  emptyFloorPlanAnalysis,
  isLegacyFloorPlanAnalysis,
  type LegacyFloorPlanAnalysis,
} from './logic/floorPlanAnalysis';
import type { HouseLedgerTableName } from './schema';
import type {
  LocalFloorPlan,
  LocalFloorPlanAnnotation,
  LocalFloorPlanMarker,
  LocalFloorPlanRegion,
  LocalHouseholdSpace,
} from './types';

// ---------------------------------------------------------------------------
// Input shapes — mirrors of the module-private request types in
// `src/api/floor-plans.ts`. They are not exported there, so they are restated
// rather than imported; `apiParity.test.ts` catches a method that disappears and
// `tsc` catches a field whose type changed on the DTO. `UpdateAnalysisRequest`
// and `BoundingBox` ARE exported, so they are imported — a restatement of a type
// that can be imported is a second copy waiting to drift.
// ---------------------------------------------------------------------------

export type UpdateLocalFloorPlanInput = {
  building_name?: string;
  floor_number?: number;
  floor_label?: string;
  scale_pixels_per_foot?: number;
  scale_pixels_per_meter?: number;
  scale_unit?: 'feet' | 'meters' | 'inches';
};

export type LocalFloorPlanFilters = {
  building_name?: string;
  limit?: number;
  cursor?: string;
};

/**
 * `marker_type` admits `'task'` here because the client's `CreateMarkerRequest`
 * does, and this type has to accept what a screen may send. No row can hold it:
 * the create route's zod is `z.enum(['pin','circle','square'])`, so the Worker
 * 400s, and `FloorPlanMarker.marker_type` has no `'task'` member either. It is
 * mapped to the service's own default (`'pin'`) on the way in — see
 * `createMarker`. No screen sends it today; both call sites pass `'pin'`.
 */
export type CreateLocalFloorPlanMarkerInput = {
  x_percent: number;
  y_percent: number;
  linked_entity_type: 'task';
  linked_entity_id: string;
  marker_type?: 'pin' | 'circle' | 'square' | 'task';
  marker_color?: string;
  marker_icon?: string;
  label?: string;
  show_label?: boolean;
  space_id?: string;
};

export type UpdateLocalFloorPlanMarkerInput = {
  x_percent?: number;
  y_percent?: number;
  marker_type?: 'pin' | 'circle' | 'square';
  marker_color?: string;
  marker_icon?: string;
  label?: string;
  show_label?: boolean;
  space_id?: string;
};

export type CalibrateLocalScaleInput = {
  pixel_distance: number;
  actual_distance: number;
  unit: 'feet' | 'meters' | 'inches';
};

/**
 * Ledger tables D1 cascades when a `floor_plans` row is deleted **and that this
 * facade must therefore drop by hand.**
 *
 * The name is `CHILD` and not `CASCADE` on purpose. `BILL_CASCADE_TABLES` in
 * `localUtilitiesApi.ts` names a cascade that genuinely fires: the Worker HARD
 * deletes the bill, so D1 removes the reminders and the ledger must match. Here
 * the Worker SOFT deletes the plan, so D1 removes nothing and the obligation
 * comes from the other end — the ledger's own delete is a tombstone, so the
 * children have to go with it or they orphan forever (see this module's header,
 * and `localAppliancesApi.delete` for the Wave-A precedent).
 *
 * The list is still derived from the schema rather than hand-written, because
 * the foreign keys are real even though nothing fires them: a fourth ledgered
 * table declaring `references(() => floorPlans.id, { onDelete: 'cascade' })`
 * would be a new orphan source, and `localFloorPlansApi.test.ts` parses the
 * Drizzle sources and fails on one that is missing here. That guard also proves
 * the deliberate omission: `floor_plan_regions` declares the same foreign key
 * and is absent from this list *because it is not in the registry at all*,
 * which is the honest reason rather than an exception.
 */
export const FLOOR_PLAN_CHILD_TABLES = [
  'floorPlanMarkers',
  'floorPlanAnnotations',
  // H13 D-wave. `floor_plan_regions` was Tier D when this list was written, so
  // the drawing's third child was invisible to it. Now that regions are
  // ledgered they inherit the same rule the header states: a region has no
  // meaning without the drawing it segments, and a ledger has no FK to reap it,
  // so the delete must drop it in the SAME op or the rows sync forever.
  'floorPlanRegions',
] as const satisfies readonly HouseLedgerTableName[];

/** The column each child points back at the plan with. */
const FLOOR_PLAN_CHILD_COLUMNS: Record<(typeof FLOOR_PLAN_CHILD_TABLES)[number], string> = {
  floorPlanMarkers: 'floor_plan_id',
  floorPlanAnnotations: 'floor_plan_id',
  floorPlanRegions: 'floor_plan_id',
};

/**
 * The value D1 actually stores for the client's `'task'`.
 *
 * `routes/floor-plans.ts:75` wraps `linked_entity_type` in a `z.preprocess` that
 * rewrites `'task'` to `'maintenance_task'` before the service sees it, so no
 * stored row has ever held `'task'` — even though `FloorPlanMarker` types the
 * field as exactly that. Writing the raw client value on device would produce a
 * marker that a server-written household could not find and vice versa.
 */
const STORED_LINKED_ENTITY_TYPE = 'maintenance_task';

// ---------------------------------------------------------------------------
// Ported helpers — `floor-plan-service.ts`, reproduced where the output is
// stored or member visible.
// ---------------------------------------------------------------------------

function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function plansOf(householdId: string): LocalFloorPlan[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalFloorPlan>('floorPlans');
}

function markersOf(householdId: string): LocalFloorPlanMarker[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalFloorPlanMarker>('floorPlanMarkers');
}

function annotationsOf(householdId: string): LocalFloorPlanAnnotation[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalFloorPlanAnnotation>('floorPlanAnnotations');
}

/**
 * `getFloorPlanInternal` + the household check + the `deleted_at` check, which
 * the Worker performs in that order and which collapse to one lookup here: the
 * ledger holds one property and a deleted row is simply absent.
 */
function requirePlan(householdId: string, floorPlanId: string): LocalFloorPlan {
  const plan = plansOf(householdId).find((row) => row.id === floorPlanId);
  if (!plan) throw new Error('Floor plan not found');
  return plan;
}

/**
 * A marker is addressed by its own id with NO plan id — `updateMarker` and
 * `deleteMarker` take `(householdId, markerId)` — and the Worker reaches the
 * household through the marker's plan. Here the ledger is already one property,
 * so the lookup is direct; the `Marker` message matches the Worker's
 * `NotFoundError('Marker')` because it reaches screens.
 */
function requireMarker(householdId: string, markerId: string): LocalFloorPlanMarker {
  const marker = markersOf(householdId).find((row) => row.id === markerId);
  if (!marker) throw new Error('Marker not found');
  return marker;
}

function requireAnnotation(householdId: string, annotationId: string): LocalFloorPlanAnnotation {
  const annotation = annotationsOf(householdId).find((row) => row.id === annotationId);
  if (!annotation) throw new Error('Annotation not found');
  return annotation;
}

/** Server order for plans, markers and annotations alike: `created_at` desc. */
function byCreatedAtDesc(a: { created_at: string }, b: { created_at: string }): number {
  return b.created_at.localeCompare(a.created_at);
}

/**
 * The read-time legacy migration, applied to a COPY.
 *
 * The Worker converts on read and never writes the result back
 * (`getFloorPlan` returns `{ ...floorPlan, ai_analysis_data: <converted> }` and
 * leaves the row alone), so this must not mutate the ledger row — a read that
 * wrote would emit an op for opening a screen, on every device, forever.
 */
function withMigratedAnalysis(plan: LocalFloorPlan): LocalFloorPlan {
  if (!plan.ai_analysis_data) return plan;
  if (!isLegacyFloorPlanAnalysis(plan.ai_analysis_data)) return plan;
  return {
    ...plan,
    ai_analysis_data: convertLegacyFloorPlanAnalysis(
      plan.ai_analysis_data as unknown as LegacyFloorPlanAnalysis,
    ),
  };
}

/**
 * Hit-test a marker position against the spaces placed on this plan —
 * `resolveSpaceAtPoint` (`floor-plan-service.ts:1142`), ported.
 *
 * Reproduced here rather than reusing `@utils/spaceHitTest`'s
 * `detectSpaceAtPoint`, which is the same test with one addition: that helper
 * treats a coordinate `<= 1` as a 0–1 fraction and multiplies by 100. The Worker
 * does not, and the create route's zod bounds the inputs to 0–100 anyway, so
 * normalising here would make a pin dropped at x=0.5 land in a different room
 * offline than online — for the one household in a thousand that has a room
 * hugging the left edge. The screens call `detectSpaceAtPoint` themselves for
 * the live preview and pass an explicit `space_id`, so this path only runs when
 * they did not.
 *
 * First match wins, in ledger order, exactly as the Worker's loop does; a point
 * inside two overlapping spaces resolves to whichever the ledger lists first.
 */
function resolveSpaceAtPoint(
  householdId: string,
  floorPlanId: string,
  xPercent: number,
  yPercent: number,
): string | undefined {
  const spaces = rowsOf<LocalHouseholdSpace>('householdSpaces').filter(
    (space) => space.household_id === householdId && space.floor_plan_id === floorPlanId,
  );
  for (const space of spaces) {
    if (
      space.plan_x_percent == null ||
      space.plan_y_percent == null ||
      space.plan_width_percent == null ||
      space.plan_height_percent == null
    ) {
      continue;
    }
    const x1 = space.plan_x_percent;
    const y1 = space.plan_y_percent;
    const x2 = x1 + space.plan_width_percent;
    const y2 = y1 + space.plan_height_percent;
    if (xPercent >= x1 && xPercent <= x2 && yPercent >= y1 && yPercent <= y2) {
      return space.id;
    }
  }
  return undefined;
}

/**
 * `updateFloorPlan`'s field semantics: absent means "leave it alone".
 *
 * The Worker spreads `data` straight onto the update (`...data`), so an empty
 * string is stored as an empty string and never coalesced to null — the same
 * quirk `localProjectsApi.projectPatch` reproduces, and for the same reason:
 * matching each service's own behaviour is what keeps a plan renamed offline and
 * one renamed online byte-identical.
 */
function planPatch(data: UpdateLocalFloorPlanInput): Partial<LocalFloorPlan> {
  const patch: Partial<LocalFloorPlan> = {};
  if (data.building_name !== undefined) patch.building_name = data.building_name;
  if (data.floor_number !== undefined) patch.floor_number = data.floor_number;
  if (data.floor_label !== undefined) patch.floor_label = data.floor_label;
  if (data.scale_pixels_per_foot !== undefined) {
    patch.scale_pixels_per_foot = data.scale_pixels_per_foot;
  }
  if (data.scale_pixels_per_meter !== undefined) {
    patch.scale_pixels_per_meter = data.scale_pixels_per_meter;
  }
  if (data.scale_unit !== undefined) patch.scale_unit = data.scale_unit;
  return patch;
}

function markerPatch(data: UpdateLocalFloorPlanMarkerInput): Partial<LocalFloorPlanMarker> {
  const patch: Partial<LocalFloorPlanMarker> = {};
  if (data.x_percent !== undefined) patch.x_percent = data.x_percent;
  if (data.y_percent !== undefined) patch.y_percent = data.y_percent;
  if (data.marker_type !== undefined) patch.marker_type = data.marker_type;
  if (data.marker_color !== undefined) patch.marker_color = data.marker_color;
  if (data.marker_icon !== undefined) patch.marker_icon = data.marker_icon;
  if (data.label !== undefined) patch.label = data.label;
  if (data.show_label !== undefined) patch.show_label = data.show_label;
  // NOTE the Worker does NOT re-run the hit-test on update: a marker dragged to
  // a new position keeps the space it was first dropped in unless the caller
  // sends a new `space_id`. Reproduced rather than improved — "fixing" it would
  // move a task between rooms on one backend and not the other.
  if (data.space_id !== undefined) patch.space_id = data.space_id;
  return patch;
}

export const localFloorPlansApi = {
  // ---- upload (H6) --------------------------------------------------------

  /**
   * `POST /floor-plans/upload-url` — H6, and the throw that gates the other two.
   *
   * This method is where the `floor_plans` ROW is created, not just where the
   * URL is minted, so there is no metadata-only half to keep working the way
   * `contractorsApi.createDocument` and `projectsApi.addProgressPhoto` have one:
   * `original_file_key` is `notNull` and names an object that does not exist
   * yet. Present as a throw rather than declared remote-only because a missing
   * key would route the upload to a Worker that would accept the PDF, mint a
   * row and file it into a household whose rows live somewhere else entirely.
   */
  getUploadUrl: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('floorPlansApi.getUploadUrl');
  },

  uploadFile: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('floorPlansApi.uploadFile');
  },

  confirmUpload: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('floorPlansApi.confirmUpload');
  },

  // ---- floor plans --------------------------------------------------------

  /**
   * `GET /floor-plans/:id/status` — four columns off the ledgered row.
   *
   * Looks like a server poll and is not. The viewer polls it while an upload
   * settles, and on device those columns only ever change when this facade
   * writes them, so the honest local answer is whatever the row says.
   */
  getProcessingStatus: async (householdId: string, floorPlanId: string) => {
    const plan = requirePlan(householdId, floorPlanId);
    return {
      status: plan.status,
      processing_stage: plan.processing_stage,
      error_message: plan.error_message,
      ocr_status: plan.ocr_status,
    };
  },

  /**
   * `GET /floor-plans` — the list, with the Worker's cursor pagination.
   *
   * `limit` is `min(limit ?? 50, 100)` and the cursor is the LAST ROW'S ID of
   * the previous page, both ported. The Worker's cursor is a quirk worth naming:
   * it selects `limit + 1` rows, returns the id of the last row it kept, and
   * then… never uses it as an offset — `listFloorPlans` accepts `cursor` and
   * does not filter on it, so requesting page two returns page one. That is
   * reproduced rather than fixed: a household with 51 plans would otherwise page
   * differently on the two backends, and no screen passes a cursor at all.
   */
  list: async (householdId: string, filters?: LocalFloorPlanFilters) => {
    const limit = Math.min(filters?.limit || 50, 100);
    const rows = plansOf(householdId)
      .filter((row) =>
        filters?.building_name ? row.building_name === filters.building_name : true,
      )
      .sort(byCreatedAtDesc);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      floor_plans: items.map(withMigratedAnalysis),
      next_cursor: hasMore ? items[items.length - 1]!.id : undefined,
    };
  },

  get: async (householdId: string, floorPlanId: string) => ({
    floor_plan: withMigratedAnalysis(requirePlan(householdId, floorPlanId)),
  }),

  update: async (householdId: string, floorPlanId: string, data: UpdateLocalFloorPlanInput) => {
    requirePlan(householdId, floorPlanId);
    const patch = planPatch(data);
    await writeLocal(
      (draft) => {
        const plan = draft.floorPlans.find(
          (row) => row.id === floorPlanId && row.household_id === householdId,
        );
        if (!plan) throw new Error('Floor plan not found');
        Object.assign(plan, patch);
        plan.updated_at = nowIso();
      },
      {
        opType: 'FLOOR_PLAN_UPDATE',
        entityType: 'floor_plan',
        entityId: floorPlanId,
        payload: data,
      },
    );
    return { floor_plan: withMigratedAnalysis(requirePlan(householdId, floorPlanId)) };
  },

  /**
   * `DELETE /floor-plans/:id` — the plan AND its markers and annotations, in
   * ONE op.
   *
   * The Worker soft-deletes and leaves the children with a live foreign key. The
   * ledger has no `deleted_at` on this DTO, so the delete is a tombstone and a
   * child left behind is an orphan that syncs to every peer and is never read —
   * except by `getMarkersForEntity`, which would hand a task screen a pin
   * pointing at a drawing that does not exist. `localAppliancesApi.delete` made
   * this call first; the full audit is in this module's header.
   *
   * ONE op rather than three is the other half, for `localProjectsApi`'s reason:
   * between the first write and the last, a peer would hold annotations
   * belonging to a plan it no longer has.
   */
  delete: async (householdId: string, floorPlanId: string) => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const exists = draft.floorPlans.some(
          (row) => row.id === floorPlanId && row.household_id === householdId,
        );
        if (!exists) throw new Error('Floor plan not found');
        draft.floorPlans = draft.floorPlans.filter((row) => row.id !== floorPlanId);
        for (const table of FLOOR_PLAN_CHILD_TABLES) {
          const column = FLOOR_PLAN_CHILD_COLUMNS[table];
          const rows = draft[table] as unknown as Record<string, unknown>[];
          (draft[table] as unknown) = rows.filter((row) => row[column] !== floorPlanId);
        }
      },
      {
        opType: 'FLOOR_PLAN_DELETE',
        entityType: 'floor_plan',
        entityId: floorPlanId,
        payload: { id: floorPlanId },
      },
    );
  },

  /**
   * `POST /floor-plans/:id/calibrate-scale` — ported arithmetic, and the
   * clearest small example of why a method that "obviously talks to the server"
   * does not.
   *
   * The whole computation is `pixel_distance / actual_distance`, written to
   * whichever of the two scale columns the unit names. The Worker writes NEITHER
   * for `inches` — the branch is `feet`/`meters` only — so a calibration in
   * inches records the unit and the method and no ratio at all. Reproduced: the
   * viewer reads `scale_pixels_per_foot` to draw a measurement, and a device
   * that filled in a third column would measure differently from the server.
   */
  calibrateScale: async (
    householdId: string,
    floorPlanId: string,
    data: CalibrateLocalScaleInput,
  ) => {
    requirePlan(householdId, floorPlanId);
    const pixelsPerUnit = data.pixel_distance / data.actual_distance;
    await writeLocal(
      (draft) => {
        const plan = draft.floorPlans.find(
          (row) => row.id === floorPlanId && row.household_id === householdId,
        );
        if (!plan) throw new Error('Floor plan not found');
        plan.scale_unit = data.unit;
        plan.scale_calibration_method = 'manual';
        if (data.unit === 'feet') plan.scale_pixels_per_foot = pixelsPerUnit;
        else if (data.unit === 'meters') plan.scale_pixels_per_meter = pixelsPerUnit;
        plan.updated_at = nowIso();
      },
      {
        opType: 'FLOOR_PLAN_CALIBRATE_SCALE',
        entityType: 'floor_plan',
        entityId: floorPlanId,
        payload: data,
      },
    );
    return { floor_plan: withMigratedAnalysis(requirePlan(householdId, floorPlanId)) };
  },

  // ---- markers ------------------------------------------------------------

  listMarkers: async (householdId: string, floorPlanId: string) => {
    requirePlan(householdId, floorPlanId);
    return {
      markers: markersOf(householdId)
        .filter((row) => row.floor_plan_id === floorPlanId)
        .sort(byCreatedAtDesc),
    };
  },

  /**
   * `GET /floor-plans/markers-for-entity` — every pin for one task, across all
   * plans.
   *
   * This is the one method whose local answer deliberately differs from the
   * Worker's, and the difference is that the local one WORKS. The create route
   * normalises `'task'` to `'maintenance_task'` before storing
   * (`routes/floor-plans.ts:75`); this route reads the query parameter raw
   * (`routes/floor-plans.ts:550`) and compares it to the stored column. So a
   * caller passing the only value the client type allows — `'task'`, which is
   * also the only value either call site sends — matches nothing on the server,
   * every time, for every household.
   *
   * Reproducing that would be the §6 failure by hand: an empty list with a 200
   * for a member who can see the pin on the drawing. So both spellings are
   * matched. Nothing in `src/` calls this method today, which is why the
   * divergence is stated here rather than negotiated.
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
   * `POST /floor-plans/:id/markers` — the insert, the space hit-test and the
   * task back-fill, in ONE op.
   *
   * See the header for why all three belong here. Two details are the Worker's
   * and are easy to get wrong by being reasonable:
   *
   *  - the back-fill only runs when a space was RESOLVED and the task has no
   *    space of its own. A task already filed under a room is never moved by
   *    dropping a pin elsewhere;
   *  - it only runs for `maintenance_task`, not `action_item` — which, after the
   *    route's normalisation, is every marker a screen can create.
   *
   * `marker_icon` defaults to a pin emoji and `marker_color` to `#FF6B6B`, both
   * stored rather than defaulted at render time, because D1 declares them
   * `.notNull()` with those defaults and a member may change either.
   */
  createMarker: async (
    householdId: string,
    floorPlanId: string,
    data: CreateLocalFloorPlanMarkerInput,
  ) => {
    requirePlan(householdId, floorPlanId);

    const spaceId =
      data.space_id ??
      resolveSpaceAtPoint(householdId, floorPlanId, data.x_percent, data.y_percent);

    const timestamp = nowIso();
    const marker: LocalFloorPlanMarker = {
      // Random id: `floor_plan_markers` carries no `uniqueIndex` in D1 and needs
      // none. Two members pinning the same boiler offline made two pins on
      // purpose, and a deterministic id would merge them.
      id: newLocalId('fpm'),
      // D1 scopes a marker by its plan alone; H5 puts several properties on one
      // device, so the ledger row carries the property too (`types.ts`, `& Owned`).
      household_id: householdId,
      floor_plan_id: floorPlanId,
      x_percent: data.x_percent,
      y_percent: data.y_percent,
      // The route's `z.preprocess`, performed here. `'task'` is what the DTO
      // says and `'maintenance_task'` is what every row holds.
      linked_entity_type: STORED_LINKED_ENTITY_TYPE as FloorPlanMarker['linked_entity_type'],
      linked_entity_id: data.linked_entity_id,
      // `'task'` cannot reach a row — the route's zod rejects it — so it folds
      // into the service's own `|| 'pin'` default rather than being stored.
      marker_type: data.marker_type && data.marker_type !== 'task' ? data.marker_type : 'pin',
      marker_color: data.marker_color || '#FF6B6B',
      marker_icon: data.marker_icon || '📍',
      label: data.label ?? null,
      show_label: data.show_label ?? true,
      space_id: spaceId ?? null,
      created_by: getLocalHouseMemberId(),
      created_at: timestamp,
      updated_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        draft.floorPlanMarkers.push(marker);
        if (!spaceId) return;
        const task = draft.tasks.find(
          (row) => row.id === data.linked_entity_id && row.household_id === householdId,
        );
        if (task && !task.space_id) {
          task.space_id = spaceId;
          task.updated_at = timestamp;
        }
      },
      {
        opType: 'FLOOR_PLAN_MARKER_CREATE',
        entityType: 'floor_plan_marker',
        entityId: marker.id,
        payload: marker,
      },
    );
    return { marker };
  },

  updateMarker: async (
    householdId: string,
    markerId: string,
    data: UpdateLocalFloorPlanMarkerInput,
  ) => {
    requireMarker(householdId, markerId);
    const patch = markerPatch(data);
    await writeLocal(
      (draft) => {
        const marker = draft.floorPlanMarkers.find((row) => row.id === markerId);
        if (!marker) throw new Error('Marker not found');
        Object.assign(marker, patch);
        marker.updated_at = nowIso();
      },
      {
        opType: 'FLOOR_PLAN_MARKER_UPDATE',
        entityType: 'floor_plan_marker',
        entityId: markerId,
        payload: data,
      },
    );
    return { marker: requireMarker(householdId, markerId) };
  },

  /**
   * `DELETE /floor-plans/markers/:id` — a leaf, so no cascade of any kind.
   *
   * The task's `space_id` is deliberately NOT cleared. The Worker does not clear
   * it either, and the reason is real rather than an omission: the pin recorded
   * where the job is, the task now says the same thing, and removing the pin
   * from the drawing is not a claim that the boiler left the utility room.
   */
  deleteMarker: async (householdId: string, markerId: string) => {
    requireMarker(householdId, markerId);
    await writeLocal(
      (draft) => {
        draft.floorPlanMarkers = draft.floorPlanMarkers.filter((row) => row.id !== markerId);
      },
      {
        opType: 'FLOOR_PLAN_MARKER_DELETE',
        entityType: 'floor_plan_marker',
        entityId: markerId,
        payload: { id: markerId },
      },
    );
  },

  // ---- annotations --------------------------------------------------------

  listAnnotations: async (householdId: string, floorPlanId: string) => {
    requirePlan(householdId, floorPlanId);
    return {
      annotations: annotationsOf(householdId)
        .filter((row) => row.floor_plan_id === floorPlanId)
        .sort(byCreatedAtDesc),
    };
  },

  /**
   * `POST /floor-plans/:id/annotations`.
   *
   * The remote signature is `Partial<FloorPlanAnnotation>`, which is wider than
   * the route accepts — its zod requires `annotation_type` and ignores `id`,
   * `created_by` and the timestamps. Mirrored: a caller's `id` cannot become the
   * row key, because a peer's identical write would then merge into it.
   *
   * `svg_data` is stored as the OBJECT the DTO declares rather than the JSON
   * text D1 holds (`types.ts`), which is the same call B3 made on
   * `linked_report_ids`. The Worker stringifies `undefined` into the literal
   * string `"undefined"` when `svg_data` is omitted; storing an empty object
   * instead is the one place this facade declines to reproduce a defect, because
   * the value round-trips through `JSON.parse` on every read and the server's
   * would throw.
   */
  createAnnotation: async (
    householdId: string,
    floorPlanId: string,
    data: Partial<FloorPlanAnnotation>,
  ) => {
    requirePlan(householdId, floorPlanId);
    if (!data.annotation_type) throw new Error('annotation_type is required');

    const timestamp = nowIso();
    const annotation: LocalFloorPlanAnnotation = {
      id: newLocalId('fpa'),
      household_id: householdId,
      floor_plan_id: floorPlanId,
      annotation_type: data.annotation_type,
      svg_data: data.svg_data ?? {},
      stroke_color: data.stroke_color || '#000000',
      // `|| 2` and not `?? 2`: the Worker writes `data.stroke_width || 2`, so a
      // zero-width line is stored as 2 on both backends. The same applies to
      // `opacity` (a fully transparent annotation is stored as opaque) and to
      // `font_size`. Reproduced rather than corrected — an annotation drawn
      // offline must render identically to one drawn online.
      stroke_width: data.stroke_width || 2,
      fill_color: data.fill_color ?? null,
      opacity: data.opacity || 1,
      text_content: data.text_content ?? null,
      font_size: data.font_size || 14,
      measurement_value: data.measurement_value ?? null,
      measurement_unit: data.measurement_unit ?? null,
      created_by: getLocalHouseMemberId(),
      created_at: timestamp,
      updated_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        draft.floorPlanAnnotations.push(annotation);
      },
      {
        opType: 'FLOOR_PLAN_ANNOTATION_CREATE',
        entityType: 'floor_plan_annotation',
        entityId: annotation.id,
        payload: annotation,
      },
    );
    return { annotation };
  },

  deleteAnnotation: async (householdId: string, annotationId: string) => {
    requireAnnotation(householdId, annotationId);
    await writeLocal(
      (draft) => {
        draft.floorPlanAnnotations = draft.floorPlanAnnotations.filter(
          (row) => row.id !== annotationId,
        );
      },
      {
        opType: 'FLOOR_PLAN_ANNOTATION_DELETE',
        entityType: 'floor_plan_annotation',
        entityId: annotationId,
        payload: { id: annotationId },
      },
    );
  },

  // ---- AI analysis --------------------------------------------------------

  /**
   * `POST /floor-plans/:id/analyze` — P4.
   *
   * The per-region pipeline: layout detection over the raster, then a crop, a
   * space list and a semantic SVG per region, all Claude Vision over bytes in
   * R2. Under E2EE the Worker holds ciphertext and the device holds no model.
   */
  triggerAnalysis: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('floorPlansApi.triggerAnalysis');
  },

  /**
   * `GET /floor-plans/:id/analysis` — LOCAL, and the C1 lesson repeating.
   *
   * This reads `ai_analysis_data` off a ledgered row and migrates its shape.
   * Nothing here runs a model — the method that does is the throw above — so
   * declaring it remote would send it to a Worker that has never seen this
   * household's plan and answer either a 404 or, for a household mid-migration,
   * the analysis as it stood before the cutover, silently discarding every area
   * the member has renamed since. The viewer's whole room overlay comes from
   * this call.
   *
   * The three-branch answer is the Worker's: no data at all returns the plan's
   * own status with a message (the failure message when it failed, "no analysis
   * yet" otherwise), and data present returns `completed` regardless of what the
   * status column says.
   */
  getAnalysis: async (householdId: string, floorPlanId: string) => {
    const plan = requirePlan(householdId, floorPlanId);
    if (!plan.ai_analysis_data) {
      return {
        status: plan.ai_analysis_status || 'pending',
        analysis: null,
        message:
          plan.ai_analysis_status === 'failed' ? plan.error_message : 'No analysis available yet',
      };
    }
    const analysis = withMigratedAnalysis(plan).ai_analysis_data;
    return {
      status: 'completed' as const,
      analysis,
      analyzed_at: plan.ai_analyzed_at ?? undefined,
    };
  },

  /**
   * `PATCH /floor-plans/:id/analysis` — the area editor's save, and LOCAL for a
   * stronger reason than `getAnalysis`.
   *
   * This is a member EDITING their own data: renaming "Floor 1" to "Upstairs",
   * dragging a bounding box. It writes `ai_analysis_data`, `ai_floor_count` and
   * `ai_analysis_status` — three ledgered columns — and the merge that produces
   * them is `applyAnalysisAreaEdit` (`logic/floorPlanAnalysis.ts`), ported so a
   * rename keeps its rooms. Remote, it would 404 for a household whose plan the
   * server has never seen, and the edit would be lost with a spinner.
   *
   * The Worker's trailing `syncRegionsAfterAreaEdit` is deliberately not
   * reproduced: regions are Tier D and there are none on device to invalidate.
   *
   * `ai_analysis_status` is set to `completed` even when nothing has ever been
   * analysed, because the Worker sets it unconditionally — a member who names
   * the floors by hand has, as far as the app is concerned, an analysis.
   */
  updateAnalysis: async (
    householdId: string,
    floorPlanId: string,
    data: UpdateAnalysisRequest,
  ) => {
    const plan = requirePlan(householdId, floorPlanId);
    const existing = plan.ai_analysis_data
      ? withMigratedAnalysis(plan).ai_analysis_data!
      : emptyFloorPlanAnalysis();
    const next = applyAnalysisAreaEdit(existing, data);
    const timestamp = nowIso();

    await writeLocal(
      (draft) => {
        const row = draft.floorPlans.find(
          (candidate) => candidate.id === floorPlanId && candidate.household_id === householdId,
        );
        if (!row) throw new Error('Floor plan not found');
        row.ai_analysis_data = next;
        row.ai_floor_count = next.metadata.floor_count;
        row.ai_analysis_status = 'completed';
        row.updated_at = timestamp;
      },
      {
        opType: 'FLOOR_PLAN_ANALYSIS_UPDATE',
        entityType: 'floor_plan',
        entityId: floorPlanId,
        payload: data,
      },
    );

    return {
      status: 'completed' as const,
      analysis: next,
      // The Worker's `?? now()`, which stamps a plan that was never analysed
      // with the moment it was first edited by hand.
      analyzed_at: plan.ai_analyzed_at ?? timestamp,
    };
  },

  // ---- regions (Tier D) ---------------------------------------------------

  /**
   * `GET /floor-plans/:id/regions` — Tier D, and a throw rather than a
   * remote-only declaration.
   *
   * `floor_plan_regions` is server-derived geometry that H7 re-derives on device
   * or the feature is off (plan §1.2). Sending this to the Worker would answer
   * `{ regions: [] }` with a 200 for a plan it has never seen, and the viewer
   * would render a floor plan with no floors detected — which looks exactly like
   * a plan whose detection found nothing, rather than one whose detection is
   * off. That is the §6 silence the Proxy exists to prevent.
   */
  listRegions: async (householdId: string, floorPlanId: string) => {
    requireActiveProperty(householdId);
    // Scoped by `floor_plan_id`, not by `household_id` — the table has no such
    // column. It inherits the plan's ledger, and the plan is already scoped.
    const regions = rowsOf<LocalFloorPlanRegion>('floorPlanRegions')
      .filter((row) => row.floor_plan_id === floorPlanId)
      .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || (a.name ?? '').localeCompare(b.name ?? ''));
    return { regions };
  },

  /**
   * `POST /floor-plans/:id/regions/process` — still a throw, but the REASON
   * changed with the H13 D-wave and that matters.
   *
   * It was unsupported because `floor_plan_regions` was Tier D and there was
   * nowhere on device to put a region. The rows are ledgered now, so
   * `listRegions` above is a real local read — but this method does not read
   * regions, it RUNS THE SEGMENTATION MODEL over the plan image, and two things
   * are still true for a local-first household: the device holds no model, and
   * the image is sealed in the H6 blob channel, so the Worker cannot see the
   * plan it would need to segment.
   *
   * That is an AI-capability throw, the same shape as `triggerVectorization`
   * below — not a storage one. Worth keeping distinct: the storage reason is
   * discharged and the capability reason is not.
   */
  processPendingRegions: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('floorPlansApi.processPendingRegions');
  },

  /** Retries one region through the same model. See `processPendingRegions`. */
  retryRegion: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('floorPlansApi.retryRegion');
  },

  // ---- vectorization ------------------------------------------------------

  /** `POST /floor-plans/:id/vectorize` — P4: Claude Vision redraws the raster. */
  triggerVectorization: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('floorPlansApi.triggerVectorization');
  },

  /**
   * `GET /floor-plans/:id/vector` — LOCAL, because it is six columns and a
   * string template.
   *
   * Nothing is fetched: the Worker reads the same row this facade reads and
   * builds `/files/<key>` from the stored keys. On a local-first household those
   * keys are null (nothing has vectorized the plan — `triggerVectorization`
   * throws), so the honest answer is `pending` with null layers, which is
   * precisely the shape the viewer's "no vector layer yet" branch expects.
   * Remote, the same call would 404 rather than answering that.
   */
  getVectorAssets: async (
    householdId: string,
    floorPlanId: string,
  ): Promise<FloorPlanVectorAssets> => {
    const plan = requirePlan(householdId, floorPlanId);
    const fileUrl = (key: string | null) => (key ? `/files/${key}` : null);
    return {
      status: (plan.vectorization_status ||
        'pending') as FloorPlanVectorAssets['status'],
      vector_semantic_key: plan.vector_semantic_key,
      vector_semantic_url: fileUrl(plan.vector_semantic_key),
      vector_trace_key: plan.vector_trace_key,
      vector_trace_url: fileUrl(plan.vector_trace_key),
      vectorized_at: plan.vectorized_at,
      error: plan.vectorization_error,
    };
  },
};

/**
 * Re-exported for the tests and for whichever facade next needs to know what a
 * floor plan looks like on the ledger. Not part of the Proxy surface —
 * `apiParity.test.ts` compares FUNCTIONS, so a type export is invisible to it.
 */
export type {
  BoundingBox,
  DetectedDimension,
  FloorPlan,
  FloorPlanAnalysis,
  FloorPlanAnnotation,
  FloorPlanMarker,
};
