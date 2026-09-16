import {
  GARDEN_PLAN_OBJECT_TYPES,
  type GardenPlanObjectType,
} from '../db/schema-garden-plans';

export interface GardenPlanVectorObject {
  id?: string;
  type: GardenPlanObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label?: string | null;
  color?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Size bounds, which differ for zones.
 *
 * `0.03..0.8` is the element rule: nothing a member drops on the plan may be
 * smaller than a dot or larger than most of the lot. A ZONE is not a thing on
 * the lot, it is a region OF it — a back yard commonly spans the full width and
 * most of the depth — so clamping one to `0.8` would shrink the area the member
 * just traced at the moment they saved it.
 *
 * The client mirrors this in two places (`src/types/garden-objects.ts` for the
 * editor and `src/features/house/local/logic/gardenPlanObjects.ts` for the
 * local-first save path). All three must agree: a household on the ledger and a
 * household on D1 have to store the same polygon for the same drag.
 */
function sizeBoundsForType(type: GardenPlanObjectType): { min: number; max: number } {
  return type === 'zone' ? { min: 0.01, max: 1 } : { min: 0.03, max: 0.8 };
}

export function normalizeVectorObjects(objects: GardenPlanVectorObject[]): GardenPlanVectorObject[] {
  return objects.slice(0, 80).map(object => {
    const bounds = sizeBoundsForType(object.type);
    return {
      id: object.id,
      type: object.type,
      x: clamp(object.x, 0, 1),
      y: clamp(object.y, 0, 1),
      width: clamp(object.width, bounds.min, bounds.max),
      height: clamp(object.height, bounds.min, bounds.max),
      rotation: normalizeRotation(object.rotation),
      label: sanitizeText(object.label, 80),
      color: sanitizeText(object.color, 24),
      metadata: object.metadata ?? null,
    };
  });
}

export function parseVectorObjectsJson(value: string | null | undefined): GardenPlanVectorObject[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizeVectorObjects(parsed.filter(isGardenPlanVectorObject));
  } catch {
    return [];
  }
}

export function formatVectorObjectsForPrompt(objects: GardenPlanVectorObject[]): string | null {
  const normalized = normalizeVectorObjects(objects);
  if (normalized.length === 0) return null;

  const descriptions = normalized.map((object, index) => {
    const label = object.label?.trim() || object.type.replace(/_/g, ' ');
    const x = Math.round(object.x * 100);
    const y = Math.round(object.y * 100);
    const width = Math.round(object.width * 100);
    const height = Math.round(object.height * 100);
    return `${index + 1}. ${label} (${object.type}) at ${x}% from left, ${y}% from top; size ${width}% x ${height}%; rotation ${Math.round(object.rotation)} degrees`;
  });

  return `User placed editable vector garden objects to respect in the layout: ${descriptions.join('; ')}.`;
}

function isGardenPlanVectorObject(value: unknown): value is GardenPlanVectorObject {
  if (!value || typeof value !== 'object') return false;
  const object = value as Record<string, unknown>;
  return (
    typeof object.type === 'string' &&
    GARDEN_PLAN_OBJECT_TYPES.includes(object.type as GardenPlanObjectType) &&
    typeof object.x === 'number' &&
    typeof object.y === 'number' &&
    typeof object.width === 'number' &&
    typeof object.height === 'number'
  );
}

function sanitizeText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeRotation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}
