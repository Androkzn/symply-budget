export const GARDEN_OBJECT_TYPES = [
  'tree',
  'shrub',
  'flower',
  'raised_bed',
  'path',
  'patio',
  'label',
  // An AREA rather than a thing — front yard, back yard, the house footprint.
  // Its ring lives in `metadata.zone.polygon`; see `@models/garden-zones` for
  // why zones are stored as objects instead of in a table of their own.
  'zone',
] as const;

export type GardenObjectType = (typeof GARDEN_OBJECT_TYPES)[number];

/**
 * Zones are exempt from the element size clamp, and have to be.
 *
 * `0.8` is a sensible ceiling for a shed: nothing a member drops on their lot
 * should be able to cover it. It is a nonsense ceiling for a back yard, which
 * routinely spans the full width of the lot and most of its depth — clamping one
 * to `0.8` would visibly shrink the polygon the member just traced, on save, in
 * the one step of the wizard where the whole promise is "this is your actual
 * yard".
 *
 * The same exemption exists on the Worker
 * (`backend/src/services/garden-plan-vector-objects.ts`) and in the local port
 * (`features/house/local/logic/gardenPlanObjects.ts`). All three must agree:
 * a clamp that differs between the two save paths stores a different polygon
 * depending on whether the household is local-first, which is the exact class of
 * divergence the ported-normalizer header warns about.
 */
export function sizeBoundsForType(type: GardenObjectType): { min: number; max: number } {
  return type === 'zone' ? { min: 0.01, max: 1 } : { min: 0.03, max: 0.8 };
}

export interface GardenPlanObject {
  id: string;
  type: GardenObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label?: string | null;
  color?: string | null;
  metadata?: Record<string, unknown> | null;
}

export type GardenObjectDraft = Omit<GardenPlanObject, 'id'> & {
  id?: string;
};

export const GARDEN_OBJECT_DEFAULTS: Record<
  GardenObjectType,
  Pick<GardenPlanObject, 'width' | 'height' | 'color' | 'label'>
> = {
  tree: { width: 0.12, height: 0.12, color: '#2F855A', label: 'Tree' },
  shrub: { width: 0.09, height: 0.09, color: '#68A357', label: 'Shrub' },
  flower: { width: 0.1, height: 0.1, color: '#D946EF', label: 'Flowers' },
  raised_bed: { width: 0.18, height: 0.1, color: '#A16207', label: 'Raised bed' },
  path: { width: 0.24, height: 0.05, color: '#94A3B8', label: 'Path' },
  patio: { width: 0.18, height: 0.14, color: '#64748B', label: 'Patio' },
  label: { width: 0.16, height: 0.06, color: '#0F766E', label: 'Note' },
  // Only a fallback: a real zone always overrides all four from its traced ring.
  zone: { width: 0.4, height: 0.4, color: '#15803D', label: 'Area' },
};

export function createGardenObject(type: GardenObjectType): GardenPlanObject {
  const defaults = GARDEN_OBJECT_DEFAULTS[type];
  return normalizeGardenObject({
    id: `garden-object-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    x: 0.5,
    y: 0.5,
    width: defaults.width,
    height: defaults.height,
    rotation: 0,
    color: defaults.color,
    label: defaults.label,
    metadata: null,
  });
}

export function normalizeGardenObject(object: GardenPlanObject): GardenPlanObject {
  const bounds = sizeBoundsForType(object.type);
  const width = clamp(object.width, bounds.min, bounds.max);
  const height = clamp(object.height, bounds.min, bounds.max);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return {
    ...object,
    // Keep object center constrained so the body stays inside the plan bounds.
    x: clamp(object.x, halfWidth, 1 - halfWidth),
    y: clamp(object.y, halfHeight, 1 - halfHeight),
    width,
    height,
    rotation: normalizeRotation(object.rotation),
  };
}

export function normalizeGardenObjects(objects: GardenPlanObject[]): GardenPlanObject[] {
  return objects.map(normalizeGardenObject);
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
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
