/**
 * Garden vector-object normalisation — the server's clamp, ported (H11 C3).
 *
 * Ported from `backend/src/services/garden-plan-vector-objects.ts`
 * (`normalizeVectorObjects` and its three helpers) — keep in sync.
 *
 * WHY THIS IS PORTED AND NOT REUSED
 * ---------------------------------
 * There is already a normaliser on the client. `@models/garden-objects` exports
 * `normalizeGardenObject`, the editor calls it while dragging, and it is NOT the
 * same function. The difference is one line and it moves things:
 *
 * ```
 *   server (this file)   x = clamp(x, 0, 1)
 *   client (@models)     x = clamp(x, width / 2, 1 - width / 2)
 * ```
 *
 * The client keeps an object's whole BODY inside the plan, so a tree dragged to
 * the left edge settles half its width in. The server keeps its CENTRE inside
 * the plan, so the same tree is stored flush against the edge with half of it
 * hanging off. Whichever is nicer, they are different numbers, and running the
 * client's on the save path would store a layout that a household on the server
 * and a household on the ledger draw differently — for every object any member
 * ever pushes to an edge.
 *
 * This is C2's `resolveSpaceAtPoint` situation exactly: there too a client helper
 * (`detectSpaceAtPoint`) did almost the same arithmetic as the Worker's, with one
 * extra normalisation, and the facade ported the Worker's rather than reaching
 * for the neighbour. The editor is welcome to keep using its own on the way to
 * the screen; what is STORED has to be the server's answer.
 *
 * WHY THE CLIENT NEEDS IT AT ALL (plan §6)
 * ----------------------------------------
 * `replaceObjects` is the object editor's save. It is a member arranging their
 * own beds and paths, it writes ledgered rows, and it runs no model and reaches
 * no bucket — so it is local, and the clamping that decides what gets written is
 * local with it. Remote, the save would 404 for a household whose plan the
 * server has never seen and the layout would be lost behind a spinner.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * `parseVectorObjectsJson` and `formatVectorObjectsForPrompt` live beside
 * `normalizeVectorObjects` in the same backend module and are not ported. Both
 * exist to feed the image model a description of what the member has placed;
 * generation is a P4 throw on device, so there is no prompt to build.
 */
import { GARDEN_OBJECT_TYPES, type GardenObjectType } from '@models/garden-objects';

/**
 * The most objects one plan may hold.
 *
 * `normalizeVectorObjects` opens with `objects.slice(0, 80)` and the route's zod
 * caps the array at 80 as well, so the excess is dropped SILENTLY on both
 * backends rather than rejected. Reproduced: a member who somehow places an
 * 81st shrub loses it identically online and offline, and "fixing" it here would
 * make the same save produce different rows on the two paths.
 */
export const GARDEN_PLAN_OBJECT_LIMIT = 80;

/** The service's bounds, named so the facade's tests can state them. */
export const GARDEN_OBJECT_BOUNDS = {
  /** Position is the object's CENTRE, clamped to the plan — see the header. */
  position: { min: 0, max: 1 },
  size: { min: 0.03, max: 0.8 },
  /** Zones are exempt from the size ceiling — see {@link sizeBoundsForType}. */
  zoneSize: { min: 0.01, max: 1 },
  /** `sanitizeText` truncates rather than rejecting. */
  labelMaxLength: 80,
  colorMaxLength: 24,
} as const;

/**
 * `sizeBoundsForType`, ported alongside the clamp it feeds.
 *
 * The Worker exempts `zone` from the `0.8` element ceiling because a zone is a
 * region of the lot rather than a thing on it — a back yard spanning the full
 * width of the lot is the normal case, not an abuse. Ported here for the reason
 * the whole file exists: the clamp that decides what gets WRITTEN has to be the
 * server's answer on both paths, or the same drag stores a different polygon
 * depending on whether the household is local-first.
 */
function sizeBoundsForType(type: GardenObjectType): { min: number; max: number } {
  return type === 'zone' ? GARDEN_OBJECT_BOUNDS.zoneSize : GARDEN_OBJECT_BOUNDS.size;
}

/**
 * The normalised shape, which is the DTO minus the id.
 *
 * `GardenPlanObject.id` is required and `normalizeVectorObjects` carries the
 * caller's through — but `replaceObjects` then discards it and mints a fresh one
 * per row, so the id this function would preserve is never the id that is
 * stored. Omitting it here keeps that from looking like an oversight at the call
 * site.
 */
export type NormalizedGardenObject = {
  type: GardenObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string | null;
  color: string | null;
  metadata: Record<string, unknown> | null;
};

/** An object as a caller may hand it in — the DTO, with everything optional. */
export type GardenObjectInput = {
  id?: string;
  type: GardenObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label?: string | null;
  color?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * `normalizeVectorObjects`, ported.
 *
 * Order matters and is the service's: the array is truncated FIRST, so the 81st
 * object is dropped whatever its coordinates, and each survivor is then clamped
 * independently. Note that width and height are clamped but position is not
 * re-clamped afterwards, so an object at `x: 1` with a clamped width still sits
 * half outside the plan — the server's answer, reproduced.
 */
export function normalizeGardenObjects(
  objects: readonly GardenObjectInput[],
): NormalizedGardenObject[] {
  return objects.slice(0, GARDEN_PLAN_OBJECT_LIMIT).map((object) => {
    const size = sizeBoundsForType(object.type);
    return {
      type: object.type,
      x: clamp(object.x, GARDEN_OBJECT_BOUNDS.position.min, GARDEN_OBJECT_BOUNDS.position.max),
      y: clamp(object.y, GARDEN_OBJECT_BOUNDS.position.min, GARDEN_OBJECT_BOUNDS.position.max),
      width: clamp(object.width, size.min, size.max),
      height: clamp(object.height, size.min, size.max),
      rotation: normalizeRotation(object.rotation),
      label: sanitizeText(object.label, GARDEN_OBJECT_BOUNDS.labelMaxLength),
      color: sanitizeText(object.color, GARDEN_OBJECT_BOUNDS.colorMaxLength),
      metadata: object.metadata ?? null,
    };
  });
}

/**
 * `isGardenPlanVectorObject`, ported — the type guard the backend applies when
 * it parses objects out of stored JSON.
 *
 * Exported because the FACADE needs it where the backend does not: the route's
 * zod rejects an unknown `type` before the service ever sees it, and there is no
 * zod on device. Note the guard checks `type`, `x`, `y`, `width` and `height`
 * and NOT `rotation`, which `normalizeRotation` handles by coercing a
 * non-finite value to 0. Reproduced rather than tightened.
 */
export function isGardenObjectInput(value: unknown): value is GardenObjectInput {
  if (!value || typeof value !== 'object') return false;
  const object = value as Record<string, unknown>;
  return (
    typeof object.type === 'string' &&
    (GARDEN_OBJECT_TYPES as readonly string[]).includes(object.type) &&
    typeof object.x === 'number' &&
    typeof object.y === 'number' &&
    typeof object.width === 'number' &&
    typeof object.height === 'number'
  );
}

/**
 * `sanitizeText`, ported. Trims, drops an empty result to null, then truncates.
 *
 * The order is the service's and is observable: a 90-character label of which
 * the first 5 are spaces keeps 80 characters of TEXT, not 75. Empty and
 * whitespace-only both become null rather than `''`.
 */
function sanitizeText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
}

/**
 * `clamp`, ported — and the `!Number.isFinite` branch returns MIN, not 0.
 *
 * For position that is the same thing; for width and height it is not. A `NaN`
 * width becomes 0.03 (the smallest legal object) rather than 0 (an invisible
 * one), which is why the branch is reproduced rather than replaced with a
 * `?? 0`.
 */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/** `normalizeRotation`, ported — degrees into `[0, 360)`, non-finite to 0. */
function normalizeRotation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}
