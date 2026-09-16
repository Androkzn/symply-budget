import { z } from 'zod';

/**
 * Room Surface Model (RSM) — the finish-schedule document for a home project.
 *
 * ## What this is
 *
 * A room, described as the set of **surfaces** a member can finish — the floor,
 * the ceiling and one wall per edge of the floor plan — where every surface
 * carries its own polygon outline, its own openings, and any number of
 * **sub-areas** that each take their own material. "The bottom metre of the
 * north wall is panelling and the rest is paint" is two sub-areas on one
 * surface, and that is the case the whole model exists to express.
 *
 * ## Where it lives, and why it is not a set of tables
 *
 * This document is the `payload_json` of a `home_project_geometry` row — the
 * same column `FloorPlanEditor` has always written, carrying
 * `schema_version: 2` instead of the flat v1 shape. That choice is deliberate
 * and is the single most load-bearing decision in the feature:
 *
 *  - **A layout is one value, not a hundred rows.** Two members editing the
 *    same room offline and merging per-field would produce a polygon with one
 *    member's vertex 3 and the other's vertex 4 — a shape neither of them drew
 *    and possibly not even a simple polygon. Last-writer-wins over the whole
 *    document loses one member's edit, which is honest and recoverable;
 *    per-field merge silently invents a third room. The local-first ledger
 *    merges per field, so the only way to get document semantics is to *be* one
 *    field.
 *  - **It ships on both backends with no migration.** `PUT
 *    /:projectId/geometry/manual` stores whatever JSON it is handed, and
 *    `localHomeProjectsApi.putManualGeometry` writes the same payload to the
 *    ledger. Neither needed a column, a table or a Drizzle change to carry v2.
 *  - **The version travels inside the document.** `home_project_geometry` has a
 *    `schema_version` column and it is **not on the DTO** — `HomeProjectGeometry`
 *    in `src/api/home-projects.ts` never exposed it, so no client has ever seen
 *    it and the local ledger row does not carry it either. A version a reader
 *    cannot read is not a version. `schema_version` below is the real one.
 *
 * Material *bytes* are the exception and are not in here: a tile photo is an
 * attachment (`home_project_attachments`, sealed as an H6 blob on a local-first
 * household and an R2 object on a server-backed one) and a `Material` holds only
 * its id. Embedding image data in a document that is rewritten on every vertex
 * drag would put megabytes through the ledger on each edit.
 *
 * ## Reading an older or newer document
 *
 * `parseRoomSurfaceModel` accepts three things and answers one: a v2 document,
 * a v1 payload (upgraded — see `roomSurfaceModelFromLegacy` in the app's
 * `surfaces/migrate.ts`), or junk (`null`). It never throws, because the caller
 * is a render path: a project whose geometry row was written by a build that
 * does not exist yet must show an empty editor, not a red screen.
 *
 * ## Coordinates and units
 *
 * Everything is **metres**, and every polygon is in the surface's **own local
 * frame** with the origin at the bottom-left of its bounding box:
 *
 *  - **plan** (`room.outline`, and therefore floor and ceiling): `+x` east,
 *    `+y` **north**. Drawing code flips y, because screens grow downwards; the
 *    model does not, because "north" is what a member means by "up" on a plan
 *    and a model that stores screen coordinates cannot be rotated later.
 *  - **wall** (`kind: 'wall'`): `+x` along the wall run, left-to-right as seen
 *    by someone standing in the room facing it; `+y` **up** from the floor.
 *    This is the "unfolded elevation" convention every drafting tool uses, and
 *    it is what makes a wall's outline non-rectangular in a useful way — a
 *    gable end or a stairwell wall is just a polygon in this frame.
 */

/** Bumped only for a change no older reader can survive. See the header. */
export const ROOM_SURFACE_SCHEMA_VERSION = 2 as const;

/**
 * A point, metres, in the surface's local frame.
 *
 * A tuple rather than `{x, y}` because a room outline is rewritten on every
 * drag and a 24-vertex polygon is 24 two-element arrays instead of 24 objects
 * with two keys each — roughly a third of the JSON, on a document that goes
 * through the ledger, every checkpoint and every backup.
 */
export const vec2Schema = z.tuple([z.number().finite(), z.number().finite()]);
export type Vec2 = z.infer<typeof vec2Schema>;

/**
 * A polygon outline. Three points is the minimum that encloses anything; 200 is
 * a ceiling chosen to bound a pathological import rather than to constrain a
 * member, who will not hand-place more than a dozen.
 */
export const outlineSchema = z.array(vec2Schema).min(3).max(200);

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

export const openingTypeSchema = z.enum([
  'door',
  'window',
  'passage',
  'niche',
  'fixture',
  'other',
]);
export type OpeningType = z.infer<typeof openingTypeSchema>;

/**
 * A hole in a surface, as an axis-aligned rectangle in the surface's local
 * frame.
 *
 * **`deducts` is the field that matters and it is not implied by `type`.** A
 * door removes area from the paint takeoff; a niche is a recess that still gets
 * tiled, so it does not; a radiator (`fixture`) is painted behind by some
 * members and not by others. Deriving this from `type` would quietly cost or
 * add material on a real quote, so it is stored, defaulted per type at creation
 * time, and editable.
 *
 * Rectangles rather than polygons because an arched window costs a member two
 * minutes of drawing to change a takeoff by a fraction of a square metre, and
 * the rectangle is what every trade actually measures.
 */
export const openingSchema = z.object({
  id: z.string().min(1),
  type: openingTypeSchema,
  label: z.string().max(120).optional(),
  /** Bottom-left corner, surface-local metres. */
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  /** Whether this hole is removed from the surface's net finished area. */
  deducts: z.boolean(),
});
export type Opening = z.infer<typeof openingSchema>;

/** The `deducts` default a newly placed opening of each type gets. */
export const OPENING_DEDUCTS_BY_DEFAULT: Record<OpeningType, boolean> = {
  door: true,
  window: true,
  passage: true,
  niche: false,
  fixture: false,
  other: true,
};

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export const materialKindSchema = z.enum([
  'paint',
  'tile',
  'flooring',
  'panel',
  'wallpaper',
  'stone',
  'other',
]);
export type MaterialKind = z.infer<typeof materialKindSchema>;

/**
 * How repeating units are laid out across a surface.
 *
 * These are the layouts a tile setter actually offers, and each changes the
 * *quantity* as well as the look — a 45° layout wastes more at the perimeter,
 * which is why `wastePct` and `pattern` are both on the material.
 */
export const tilePatternSchema = z.enum([
  /** Aligned grid — every joint continuous in both directions. */
  'grid',
  /** Running bond, 50% offset row to row. The default for subway tile. */
  'brick',
  /** Running bond, 1/3 offset. Standard for plank flooring. */
  'brick_third',
  /** 90° herringbone. */
  'herringbone',
  /** Stacked vertically — grid, rotated a quarter turn. */
  'vertical_stack',
]);
export type TilePattern = z.infer<typeof tilePatternSchema>;

/**
 * One finish in the project's palette.
 *
 * **`colorHex` is required even for a material that has a photo.** It is the
 * fallback the renderer draws when the texture has not downloaded yet, when the
 * member is offline and the blob is not cached, and when the surface is drawn
 * at thumbnail size where a texture would be noise. A tile with no colour
 * renders as a hole in the room, which reads as a bug.
 *
 * **`unit_w_mm` / `unit_h_mm` are the real-world size of one repeat**, and they
 * are what makes the preview honest: a 600×600 porcelain tile and a 75×300
 * subway tile are the same photograph scaled differently, and a visualiser that
 * stretches the image to the wall — which is what "apply this texture" usually
 * means — shows the member a room that cannot be built. Every quantity in
 * `takeoff.ts` and every pattern cell in the renderer is derived from these two
 * numbers.
 */
export const materialSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(160),
  kind: materialKindSchema,
  /** `#rrggbb`. Always present — see the note above. */
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'colorHex must be #rrggbb'),

  /**
   * `home_project_attachments.id` of the swatch/tile photo, or null for a plain
   * colour. Resolving it to bytes is backend-specific (a sealed blob on a
   * local-first household, an R2 url otherwise), which is why only the id is
   * here.
   */
  textureAttachmentId: z.string().min(1).nullable().optional(),

  /** Real size of one repeat, millimetres. Absent → a non-repeating finish. */
  unit_w_mm: z.number().finite().positive().max(10_000).optional(),
  unit_h_mm: z.number().finite().positive().max(10_000).optional(),
  /** Joint width between repeats, millimetres. */
  groutMm: z.number().finite().nonnegative().max(100).optional(),
  groutColorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  pattern: tilePatternSchema.optional(),
  /** Whole-field rotation, degrees. 45 is the common "diagonal lay". */
  rotationDeg: z.number().finite().min(-180).max(180).optional(),

  // ---- takeoff -----------------------------------------------------------
  /** Cut/breakage allowance added to the net area before ordering. */
  wastePct: z.number().finite().min(0).max(100).optional(),
  /** m² one purchase unit covers — litres of paint, a box of flooring. */
  coverageM2PerUnit: z.number().finite().positive().optional(),
  /** How many passes the paint takeoff assumes. Ignored by other kinds. */
  coats: z.number().int().min(1).max(6).optional(),
  /** What the member buys: 'L', 'box', 'tile', 'm²'. Display only. */
  unitLabel: z.string().max(24).optional(),
  unitPriceCents: z.number().int().nonnegative().optional(),

  // ---- provenance --------------------------------------------------------
  sku: z.string().max(120).optional(),
  vendor: z.string().max(160).optional(),
  productUrl: z.string().max(2048).optional(),
  /**
   * `home_project_selections.id`, when this material was promoted to a priced
   * selection. Write-only from the model's side — the selection is the row that
   * carries money into the budget, and this is the back-pointer that stops a
   * second promotion creating a duplicate line.
   */
  selectionId: z.string().min(1).nullable().optional(),
});
export type Material = z.infer<typeof materialSchema>;

// ---------------------------------------------------------------------------
// Sub-areas and surfaces
// ---------------------------------------------------------------------------

/**
 * A region of one surface that takes its own material.
 *
 * Sub-areas **carve** the surface rather than sitting on top of it: the base
 * material's net area is the outline minus every sub-area, so assigning a
 * wainscot does not double-count the wall behind it. `sortOrder` is paint
 * order for the renderer only — later draws on top — and it deliberately does
 * *not* affect the arithmetic, because two overlapping sub-areas are a mistake
 * the editor refuses to create rather than a stacking rule to interpret.
 */
export const subAreaSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(160),
  outline: outlineSchema,
  materialId: z.string().min(1).nullable(),
  sortOrder: z.number().int(),
  /** Member note — "panelling to chair rail height". */
  notes: z.string().max(500).optional(),
});
export type SubArea = z.infer<typeof subAreaSchema>;

export const surfaceKindSchema = z.enum(['floor', 'ceiling', 'wall']);
export type SurfaceKind = z.infer<typeof surfaceKindSchema>;

/**
 * One finishable face of the room.
 *
 * **`outlineLocked` is the field that makes editing safe.** Walls are *derived*
 * from the floor plan — one per plan edge, run × height — and the plan can be
 * edited after the walls exist. Re-deriving blindly would throw away a gable
 * that a member cut by hand; never re-deriving would leave a wall the wrong
 * length after they moved a corner. So a derived wall tracks its plan edge and
 * is re-derived freely until the member edits its outline, at which point it
 * locks and re-derivation reports it as stale instead of overwriting it.
 */
export const surfaceSchema = z.object({
  id: z.string().min(1),
  kind: surfaceKindSchema,
  label: z.string().min(1).max(160),
  outline: outlineSchema,
  openings: z.array(openingSchema).max(60),
  subAreas: z.array(subAreaSchema).max(60),
  /** The background finish — what is left after the sub-areas are carved out. */
  materialId: z.string().min(1).nullable(),
  /** Excluded from the takeoff and dimmed in the UI, without being deleted. */
  excluded: z.boolean().optional(),

  // ---- walls only --------------------------------------------------------
  /**
   * Index of the `room.outline` edge this wall stands on — edge `i` runs from
   * vertex `i` to vertex `(i + 1) % n`. Null for a wall the member added by
   * hand that no plan edge produced.
   */
  planEdge: z.number().int().nonnegative().nullable().optional(),
  /** The run and height that produced the derived rectangle, metres. */
  run_m: z.number().finite().positive().optional(),
  height_m: z.number().finite().positive().optional(),
  /** Set once the member edits the outline. See the note above. */
  outlineLocked: z.boolean().optional(),
});
export type Surface = z.infer<typeof surfaceSchema>;

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * The v1 payload `FloorPlanEditor` has written since the feature shipped, and
 * which the Worker's `suggestTakeoffFromGeometry` still reads.
 *
 * It is declared here — in the contract, beside its successor — for two
 * reasons. It is the input to the upgrade, so the upgrade has something to
 * validate against instead of trusting `as`. And it is the shape v2 keeps
 * mirroring: see `legacyMirrorSchema` on the document below.
 */
export const legacyGeometryPayloadSchema = z.object({
  units: z.literal('m').optional(),
  floor: z
    .object({
      polygon: z.array(vec2Schema).optional(),
      area_m2: z.number().optional(),
      openings: z.array(z.unknown()).optional(),
    })
    .optional(),
  walls: z
    .array(
      z.object({
        id: z.string().optional(),
        label: z.string().optional(),
        width_m: z.number().optional(),
        height_m: z.number().optional(),
        openings: z.array(z.unknown()).optional(),
      })
    )
    .optional(),
  ceiling: z.object({ area_m2: z.number().optional() }).optional(),
  source_meta: z.object({ captured_at: z.string().optional() }).partial().optional(),
});
export type LegacyGeometryPayload = z.infer<typeof legacyGeometryPayloadSchema>;

/**
 * The v1 keys, recomputed from the v2 surfaces and written alongside them.
 *
 * **This is compatibility that is actually load-bearing, not politeness.** Two
 * readers still parse the v1 shape out of the same column and neither knows v2
 * exists:
 *
 *  - `home-projects-service.ts#suggestTakeoffFromGeometry` reads
 *    `floor.area_m2` and `walls[].width_m * height_m` to seed flooring and
 *    paint selections. Without the mirror it computes zero and seeds nothing,
 *    silently.
 *  - `FloorPlanEditor#dimsFromPayloadJson` reads `floor.polygon` to prefill its
 *    two boxes. Without the mirror it shows 3.2 × 2.4 for a room that is
 *    neither.
 *
 * A v2 writer therefore *always* emits these, and `withLegacyMirror` in the
 * app's `surfaces/serialize.ts` is what guarantees it. They are derived: nothing
 * may read them back in a v2 code path, or the same fact has two owners.
 */
export const legacyMirrorSchema = z.object({
  floor: z.object({
    polygon: z.array(vec2Schema),
    area_m2: z.number(),
    openings: z.array(z.unknown()),
  }),
  walls: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      width_m: z.number(),
      height_m: z.number(),
      openings: z.array(z.unknown()),
    })
  ),
  ceiling: z.object({ area_m2: z.number() }),
});

export const roomSurfaceModelSchema = z
  .object({
    schema_version: z.literal(ROOM_SURFACE_SCHEMA_VERSION),
    units: z.literal('m'),
    room: z.object({
      /** The floor-plan polygon. Also the floor and ceiling outline. */
      outline: outlineSchema,
      /** Default height for derived walls, metres. */
      wallHeight_m: z.number().finite().positive().max(30),
      label: z.string().max(160).optional(),
    }),
    surfaces: z.array(surfaceSchema).max(64),
    materials: z.array(materialSchema).max(120),
    source_meta: z.object({
      captured_at: z.string(),
      /** `manual`, `roomplan`, or `upgraded_v1` when this came from a v1 row. */
      origin: z.string().max(40).optional(),
      app_version: z.string().max(40).optional(),
    }),
  })
  // The mirror is `.partial()`-shaped rather than required so that a document
  // hand-built in a test is still valid. Writers must emit it; readers must not
  // depend on it.
  .merge(legacyMirrorSchema.partial());

export type RoomSurfaceModel = z.infer<typeof roomSurfaceModelSchema>;

/**
 * Read a `home_project_geometry.payload_json` as a v2 document.
 *
 * **Never throws, and never upgrades.** A render path calls this, and a project
 * whose payload was written by a build that does not exist yet must show an
 * empty editor rather than crash the hub. Upgrading a v1 payload is a separate,
 * explicit step (`roomSurfaceModelFromLegacy`) because it produces a document
 * that must then be *saved*, and a reader that silently rewrote the row on
 * every read would fight every other device in the household.
 */
export function parseRoomSurfaceModel(input: unknown): RoomSurfaceModel | null {
  let candidate = input;
  if (typeof input === 'string') {
    if (input.trim() === '') return null;
    try {
      candidate = JSON.parse(input);
    } catch {
      return null;
    }
  }
  const parsed = roomSurfaceModelSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Read the same column as a v1 payload — the input to the upgrade.
 *
 * Returns null for a v2 document, so callers can branch on "which is it" with
 * two calls and no version sniffing. That matters because v2 carries the v1
 * keys as a mirror and would otherwise parse as *both*.
 */
export function parseLegacyGeometryPayload(input: unknown): LegacyGeometryPayload | null {
  let candidate = input;
  if (typeof input === 'string') {
    if (input.trim() === '') return null;
    try {
      candidate = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (
    candidate &&
    typeof candidate === 'object' &&
    (candidate as { schema_version?: unknown }).schema_version === ROOM_SURFACE_SCHEMA_VERSION
  ) {
    return null;
  }
  const parsed = legacyGeometryPayloadSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
