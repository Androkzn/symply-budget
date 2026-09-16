/**
 * Reading and writing the surface document to `home_project_geometry`.
 *
 * Two functions matter here and both are about not breaking readers that have
 * no idea v2 exists.
 *
 * ## `withLegacyMirror` — compatibility that is load-bearing
 *
 * Every v2 save carries the v1 keys, recomputed. Two live readers still parse
 * the old shape out of the same column:
 *
 *  - `home-projects-service.ts#suggestTakeoffFromGeometry` reads
 *    `floor.area_m2` and `walls[].width_m * height_m` to seed flooring and
 *    paint selections when a RoomPlan scan lands. Drop the mirror and it
 *    computes zero, seeds nothing, and reports success.
 *  - `FloorPlanEditor#dimsFromPayloadJson` reads `floor.polygon` to prefill its
 *    width and depth. Drop the mirror and a member who opens the old editor on
 *    a v2 project is shown 3.2 × 2.4 for a room that is neither — and saving
 *    from there would write those numbers back.
 *
 * Neither failure raises anything. Both are the silent-wrong-answer class the
 * repo's local-first work spends most of its comments on, so the mirror is
 * written on every save and `serialize.test.ts` asserts the two fields those
 * readers actually touch.
 *
 * ## `loadRoomSurfaceModel` — one door, three inputs
 *
 * A geometry row can hold a v2 document, a v1 payload from any build since the
 * feature shipped, or nothing. The caller gets a model and a flag saying
 * whether it came from an upgrade, because an upgraded document is **not yet
 * saved** — and the decision to write it belongs to a member action, not to a
 * render.
 */

import {
  ROOM_SURFACE_SCHEMA_VERSION,
  parseRoomSurfaceModel,
  type RoomSurfaceModel,
  type Vec2,
} from '../room-surface-model';

import { roomSurfaceModelFromLegacy } from './derive';
import { round4 } from './geometry';
import { surfaceGrossArea } from './subareas';

export type SurfaceModelOrigin = 'v2' | 'upgraded_v1' | 'empty';

export interface LoadedSurfaceModel {
  model: RoomSurfaceModel | null;
  origin: SurfaceModelOrigin;
  /** True when `model` exists but has never been written in this shape. */
  needsSave: boolean;
}

/**
 * Read a `home_project_geometry.payload_json`.
 *
 * Never throws. A project whose payload was written by a build that does not
 * exist yet, or which was corrupted in transit, must open an empty editor
 * rather than take the hub down with it.
 */
export function loadRoomSurfaceModel(payloadJson: string | null | undefined): LoadedSurfaceModel {
  const v2 = parseRoomSurfaceModel(payloadJson);
  if (v2) return { model: v2, origin: 'v2', needsSave: false };
  const upgraded = roomSurfaceModelFromLegacy(payloadJson);
  if (upgraded) return { model: upgraded, origin: 'upgraded_v1', needsSave: true };
  return { model: null, origin: 'empty', needsSave: false };
}

/**
 * The v1 keys, recomputed from the v2 surfaces.
 *
 * Derived on the way out and never read back in a v2 code path — the moment
 * anything here becomes an input, the same fact has two owners and they will
 * disagree.
 *
 * `walls` deliberately reports the **bounding run and height** of each wall
 * rather than its true polygon area, because that is what the v1 field means
 * (`width_m * height_m` is how the server multiplies it) and a gable reported
 * as its net area would make the old takeoff quietly under-order paint. A v1
 * reader gets a v1 answer; the accurate figure is `computeTakeoff`.
 */
export function withLegacyMirror(model: RoomSurfaceModel): RoomSurfaceModel {
  const floor = model.surfaces.find((surface) => surface.kind === 'floor');
  const ceiling = model.surfaces.find((surface) => surface.kind === 'ceiling');
  const walls = model.surfaces.filter((surface) => surface.kind === 'wall');
  const floorArea = floor ? surfaceGrossArea(floor) : 0;

  return {
    ...model,
    floor: {
      polygon: model.room.outline,
      area_m2: round4(floorArea),
      openings: [],
    },
    // `id` is the v2 surface id rather than v1's 'w1'…'w4'. Nothing reads a v1
    // wall id — the service multiplies width by height and the old editor never
    // looked at them — so using the real id at least means a v1 reader and a v2
    // reader are talking about the same wall.
    walls: walls.map((wall) => ({
      id: wall.id,
      label: wall.label,
      width_m: round4(wall.run_m ?? boundingRun(wall.outline)),
      height_m: round4(wall.height_m ?? model.room.wallHeight_m),
      openings: wall.openings,
    })),
    ceiling: { area_m2: round4(ceiling ? surfaceGrossArea(ceiling) : floorArea) },
  };
}

function boundingRun(outline: readonly Vec2[]): number {
  if (outline.length === 0) return 0;
  const xs = outline.map(([x]) => x);
  return Math.max(...xs) - Math.min(...xs);
}

/**
 * The exact object to hand `homeProjectsApi.putManualGeometry`.
 *
 * Stamps `captured_at` on every save. That timestamp is the only provenance a
 * geometry row carries that a member can read, and "when did we last touch the
 * layout" is a question the hub answers from it.
 */
export function serializeRoomSurfaceModel(model: RoomSurfaceModel): RoomSurfaceModel {
  return withLegacyMirror({
    ...model,
    schema_version: ROOM_SURFACE_SCHEMA_VERSION,
    units: 'm',
    source_meta: { ...model.source_meta, captured_at: new Date().toISOString() },
  });
}

/**
 * Are these two documents the same layout?
 *
 * Used to skip a save that would change nothing. It compares everything except
 * `source_meta` and the derived mirror, because both change on every
 * serialisation and comparing them would make the answer always "no" — which
 * would put a write through the ledger on every screen focus.
 */
export function sameSurfaceModel(a: RoomSurfaceModel, b: RoomSurfaceModel): boolean {
  const strip = (model: RoomSurfaceModel) =>
    JSON.stringify({
      room: model.room,
      surfaces: model.surfaces,
      materials: model.materials,
    });
  return strip(a) === strip(b);
}
