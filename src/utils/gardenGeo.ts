/**
 * Geometry for the map-drawn yard plan — the bridge between the two coordinate
 * spaces this feature has always had, and never had a name for.
 *
 * ## The two spaces, and why both exist
 *
 * A yard plan stores geometry twice over, in different units, for different
 * reasons:
 *
 *  - **`garden_plans.boundary_geojson` is GEOGRAPHIC.** Longitude/latitude
 *    pairs, WGS84, GeoJSON ring order (`[lon, lat]`). It has to be: the lot is a
 *    real place, the satellite tiles under it are geo-referenced, and a boundary
 *    that moved when the member panned the map would be worthless.
 *  - **`garden_plan_objects.{x,y,width,height}` is NORMALIZED.** `0..1` over the
 *    boundary's bounding box, y increasing DOWNWARD (screen convention, not
 *    latitude's). It has to be that too: the same objects are drawn over an
 *    uploaded photo, which has no coordinates at all, and the renderer that puts
 *    a shrub on a JPEG cannot ask a JPEG where north is.
 *
 * So the wizard DRAWS in geographic space — `MapView` owns the projection while
 * a member drags a corner, which is the only way a vertex stays on the fence it
 * was put on across a pan and a zoom — and CONVERTS to normalized space once, at
 * save. Everything downstream (`GardenPlanVectorEditor`,
 * `GardenPlanUnifiedViewer`, `GardenObjectRenderer`) then reads exactly the
 * shape it already reads today. Nothing downstream learns a new space.
 *
 * ## The y flip is the whole trap
 *
 * Latitude increases NORTHWARD; canvas y increases DOWNWARD. Every conversion
 * here flips it, and a conversion that forgets to is not obviously broken — it
 * produces a plan that is mirrored top-to-bottom, which looks like a plausible
 * yard until the member notices the house is behind the back fence. The flip
 * lives in exactly two functions ({@link geoToNormalized} and
 * {@link normalizedToGeo}) and they are inverses; the round-trip test asserts
 * that and is the reason to keep it that way.
 *
 * ## Areas are planar, deliberately
 *
 * {@link polygonAreaSqM} projects to a local equirectangular plane scaled at the
 * ring's mean latitude rather than doing spherical excess. Over a residential
 * lot — hundreds of metres, never kilometres — the error is far below the error
 * in where the member put the corners, and the planar form is the one
 * `useBoundaryEditor` already ships. Matching it matters more than being
 * marginally more correct than the number displayed on the previous screen.
 */
import type { LatLng } from 'react-native-maps';

import {
  closedRing,
  haversineM,
  ringFromGeoJson,
  toBoundaryGeoJson,
} from '@hooks/garden/useBoundaryEditor';

// The GeoJSON encoder/decoder pair is deliberately NOT re-implemented here.
// `useBoundaryEditor` already owns the exact ring encoding that
// `gardenPlansApi.updateBoundary` stores and that every viewer parses back, and
// a second encoder is how the two drift into disagreeing about whether a ring is
// closed. Re-exported so callers have one import site rather than two.
export { closedRing, haversineM, ringFromGeoJson, toBoundaryGeoJson };

export const METERS_TO_FEET = 3.280839895;
export const SQ_METERS_TO_SQ_FEET = 10.7639104167;

/** Metres per degree of latitude. Constant enough at any latitude a house is at. */
const M_PER_DEG_LAT = 111_320;

export type MeasurementUnit = 'feet' | 'meters';

/** The geographic bounding box a normalized plan is expressed over. */
export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** A point in normalized plan space: `0..1`, y DOWNWARD. */
export interface NormalizedPoint {
  x: number;
  y: number;
}

/** An axis-aligned box in normalized plan space, `x`/`y` being the CENTRE. */
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The bounding box of a ring.
 *
 * Returns `null` rather than an empty box for fewer than three points, because
 * every caller's next move is to divide by the box's span and a degenerate box
 * makes that a division by zero that silently yields `Infinity` rather than an
 * error anyone sees.
 */
export function boundsOfRing(ring: readonly LatLng[]): GeoBounds | null {
  if (ring.length < 3) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const point of ring) {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLon = Math.min(minLon, point.longitude);
    maxLon = Math.max(maxLon, point.longitude);
  }
  if (![minLat, maxLat, minLon, maxLon].every(Number.isFinite)) return null;
  if (maxLat - minLat <= 0 || maxLon - minLon <= 0) return null;
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Geographic point → normalized plan point.
 *
 * The latitude term is inverted (`maxLat` first) — see the header. Results are
 * NOT clamped: a zone corner a metre outside the lot is a real thing a member
 * can draw, and clamping it here would silently square off their driveway. The
 * storage clamp in `normalizeGardenObjects` is the place that decides what is
 * legal to persist.
 */
export function geoToNormalized(point: LatLng, bounds: GeoBounds): NormalizedPoint {
  const lonSpan = bounds.maxLon - bounds.minLon;
  const latSpan = bounds.maxLat - bounds.minLat;
  return {
    x: (point.longitude - bounds.minLon) / lonSpan,
    y: (bounds.maxLat - point.latitude) / latSpan,
  };
}

/** Normalized plan point → geographic point. Inverse of {@link geoToNormalized}. */
export function normalizedToGeo(point: NormalizedPoint, bounds: GeoBounds): LatLng {
  const lonSpan = bounds.maxLon - bounds.minLon;
  const latSpan = bounds.maxLat - bounds.minLat;
  return {
    longitude: bounds.minLon + point.x * lonSpan,
    latitude: bounds.maxLat - point.y * latSpan,
  };
}

/** Convert a whole ring at once. */
export function ringToNormalized(
  ring: readonly LatLng[],
  bounds: GeoBounds,
): NormalizedPoint[] {
  return ring.map((point) => geoToNormalized(point, bounds));
}

/** Convert a normalized ring back to geography. */
export function ringToGeo(
  ring: readonly NormalizedPoint[],
  bounds: GeoBounds,
): LatLng[] {
  return ring.map((point) => normalizedToGeo(point, bounds));
}

/**
 * Planar area of a geographic ring, in square metres.
 *
 * Shoelace over an equirectangular projection scaled at the ring's mean
 * latitude. See the header for why this is planar on purpose. Fewer than three
 * points has no area rather than being an error — a half-drawn polygon reads
 * `0 m²` while the member is still tapping, which is what they expect to see.
 */
export function polygonAreaSqM(ring: readonly LatLng[]): number {
  if (ring.length < 3) return 0;
  const meanLat = ring.reduce((sum, p) => sum + p.latitude, 0) / ring.length;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);
  const projected = ring.map((p) => ({
    x: p.longitude * mPerDegLon,
    y: p.latitude * M_PER_DEG_LAT,
  }));
  let sum = 0;
  for (let i = 0; i < projected.length; i += 1) {
    const j = (i + 1) % projected.length;
    sum += projected[i].x * projected[j].y - projected[j].x * projected[i].y;
  }
  return Math.abs(sum) / 2;
}

/** Total edge length of a closed ring, in metres. */
export function polygonPerimeterM(ring: readonly LatLng[]): number {
  if (ring.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    total += haversineM(ring[i], ring[(i + 1) % ring.length]);
  }
  return total;
}

/**
 * Centroid of a ring — the AVERAGE of its vertices, not the area centroid.
 *
 * The vertex mean is used deliberately: it is what the label of a zone should
 * sit on for the shapes members actually draw (convex-ish quadrilaterals), it
 * cannot land outside a mildly concave shape the way an area centroid can for an
 * L-shaped back yard, and it is defined for a two-point degenerate ring where
 * the shoelace centroid divides by zero.
 */
export function ringCentroid(ring: readonly LatLng[]): LatLng | null {
  if (ring.length === 0) return null;
  const lat = ring.reduce((sum, p) => sum + p.latitude, 0) / ring.length;
  const lon = ring.reduce((sum, p) => sum + p.longitude, 0) / ring.length;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { latitude: lat, longitude: lon };
}

/** Metres → degrees of latitude. */
export function metersToLatDegrees(meters: number): number {
  return meters / M_PER_DEG_LAT;
}

/** Metres → degrees of longitude at a given latitude. */
export function metersToLonDegrees(meters: number, atLatitude: number): number {
  const scale = Math.cos((atLatitude * Math.PI) / 180);
  if (Math.abs(scale) < 1e-9) return 0;
  return meters / (M_PER_DEG_LAT * scale);
}

/**
 * A rectangle centred on a point, for seeding step one.
 *
 * The wizard never opens on an empty map. A member who is handed a blank
 * satellite view and told to "trace your lot" has to invent both the shape and
 * the interaction; one who is handed a rectangle roughly the size of a suburban
 * lot, sitting over their roof, only has to drag four corners onto four fences.
 * That is the single biggest difference between this flow and the one it
 * replaces, and it is four lines of arithmetic.
 *
 * Corners are returned clockwise from north-west, matching the order
 * `MapPolygon` draws and the order the vertex handles are indexed in.
 */
export function seedRectangle(
  center: LatLng,
  widthMeters: number,
  depthMeters: number,
): LatLng[] {
  const halfLat = metersToLatDegrees(depthMeters / 2);
  const halfLon = metersToLonDegrees(widthMeters / 2, center.latitude);
  return [
    { latitude: center.latitude + halfLat, longitude: center.longitude - halfLon },
    { latitude: center.latitude + halfLat, longitude: center.longitude + halfLon },
    { latitude: center.latitude - halfLat, longitude: center.longitude + halfLon },
    { latitude: center.latitude - halfLat, longitude: center.longitude - halfLon },
  ];
}

/**
 * Is a point inside a ring? Ray casting, half-open on the upper edge.
 *
 * Used to decide which zone an element was dropped into, so that placing a tree
 * in the back yard files it under the back yard without the member saying so.
 * Points exactly on an edge are not guaranteed either way, which is correct for
 * the caller: an element on the boundary between two zones genuinely belongs to
 * neither in particular.
 */
export function isPointInRing(point: NormalizedPoint, ring: readonly NormalizedPoint[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

/** The normalized bounding box of a normalized ring, `x`/`y` being its CENTRE. */
export function boxOfNormalizedRing(ring: readonly NormalizedPoint[]): NormalizedBox | null {
  if (ring.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    width: Math.max(maxX - minX, 0),
    height: Math.max(maxY - minY, 0),
  };
}

/** `123.4 m` / `405 ft`. Sheds the decimal once the number is long enough not to need it. */
export function formatLength(meters: number, unit: MeasurementUnit): string {
  const value = unit === 'feet' ? meters * METERS_TO_FEET : meters;
  const suffix = unit === 'feet' ? 'ft' : 'm';
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${suffix}`;
}

/** `450 m²` / `4,844 ft²`. */
export function formatArea(areaSqMeters: number, unit: MeasurementUnit): string {
  const value = unit === 'feet' ? areaSqMeters * SQ_METERS_TO_SQ_FEET : areaSqMeters;
  const suffix = unit === 'feet' ? 'ft²' : 'm²';
  const rounded = value >= 1000 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded.toLocaleString('en-US')} ${suffix}`;
}

/**
 * Insert a vertex at the midpoint of the edge nearest a tapped point.
 *
 * Returns the new ring and the index the vertex landed at, so the caller can
 * select it — a member who taps "add a corner" expects the corner they just made
 * to be the one that moves next.
 */
export function insertVertexNearest(
  ring: readonly LatLng[],
  target: LatLng,
): { ring: LatLng[]; insertedIndex: number } {
  if (ring.length < 2) {
    return { ring: [...ring, target], insertedIndex: ring.length };
  }
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const distance = distanceToSegmentM(target, a, b);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  const insertedIndex = bestIndex + 1;
  const next = [...ring];
  next.splice(insertedIndex, 0, target);
  return { ring: next, insertedIndex };
}

/**
 * Distance from a point to a segment, in metres.
 *
 * Projected onto the same local plane {@link polygonAreaSqM} uses, for the same
 * reason: over a lot the difference from a geodesic is far below a fingertip.
 */
export function distanceToSegmentM(point: LatLng, a: LatLng, b: LatLng): number {
  const meanLat = (a.latitude + b.latitude) / 2;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);
  const toXy = (p: LatLng) => ({
    x: p.longitude * mPerDegLon,
    y: p.latitude * M_PER_DEG_LAT,
  });
  const p = toXy(point);
  const v = toXy(a);
  const w = toXy(b);
  const dx = w.x - v.x;
  const dy = w.y - v.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  const t = Math.max(0, Math.min(1, ((p.x - v.x) * dx + (p.y - v.y) * dy) / lengthSq));
  return Math.hypot(p.x - (v.x + t * dx), p.y - (v.y + t * dy));
}
