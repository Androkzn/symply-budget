/**
 * Polygon arithmetic for the Room Surface Model.
 *
 * Pure, dependency-free, and metre-denominated. Everything the editor and the
 * takeoff need to answer "is this shape valid, how big is it, and does it sit
 * inside that one" lives here, so that both the renderer and the quantity
 * calculation are working from one implementation rather than two that agree
 * until they do not.
 *
 * ## The tolerance, and why there is exactly one
 *
 * A member drags a vertex with a finger. The value that arrives is a float
 * derived from a pixel, divided by a scale factor — so two corners that are
 * "the same" are never equal, and a sub-area drawn flush to the top of a wall
 * is a hair outside it about half the time. Every containment and equality test
 * in this file therefore runs against `EPS_M`, and there is one constant rather
 * than a scattering of `0.001`s so that the editor's snapping and the
 * validator's tolerance can never drift apart: snapping at 1 cm while
 * validating at 1 mm produces a shape the editor just built and now refuses.
 */

import type { Vec2 } from '../room-surface-model';

/**
 * One millimetre, in metres.
 *
 * Chosen because it is the finest unit any real finish is specified in (grout
 * joints, tile faces) and it is two orders of magnitude below the smallest
 * thing a finger can place. Anything closer together than this is the same
 * point.
 */
export const EPS_M = 0.001;

/** Default snap step for the editor, metres. 5 cm reads as "tidy" on a plan. */
export const DEFAULT_SNAP_M = 0.05;

/** How far off-axis an edge may be and still be pulled square, degrees. */
export const ORTHO_TOLERANCE_DEG = 7;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Points and segments
// ---------------------------------------------------------------------------

export function samePoint(a: Vec2, b: Vec2, eps = EPS_M): boolean {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Round to the nearest `step`, then to 4dp so JSON stays short and stable. */
export function snap(value: number, step = DEFAULT_SNAP_M): number {
  if (step <= 0) return round4(value);
  return round4(Math.round(value / step) * step);
}

export function snapPoint(p: Vec2, step = DEFAULT_SNAP_M): Vec2 {
  return [snap(p[0], step), snap(p[1], step)];
}

/**
 * 4 decimal places — a tenth of a millimetre.
 *
 * Not cosmetic. Without it every drag writes `2.4000000000000004` into a
 * document that goes through the ledger, so two devices that agree on the room
 * still produce different bytes, and the merge sees a change where there is
 * none. Rounding at the point of *construction* is what makes an idempotent
 * save actually idempotent.
 */
export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// Polygons
// ---------------------------------------------------------------------------

/**
 * Signed area, shoelace. Positive is counter-clockwise in a `+y`-up frame,
 * which is the frame the model stores (see the contract header).
 */
export function signedArea(polygon: readonly Vec2[]): number {
  const n = polygon.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Area in m², always positive. This is what a takeoff means by "area". */
export function polygonArea(polygon: readonly Vec2[]): number {
  return Math.abs(signedArea(polygon));
}

export function polygonPerimeter(polygon: readonly Vec2[]): number {
  const n = polygon.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    sum += distance(polygon[i], polygon[(i + 1) % n]);
  }
  return sum;
}

/**
 * Force counter-clockwise winding.
 *
 * The renderer does not care, but every containment test and the SVG even-odd
 * fill rule do: a sub-area wound the other way from its parent punches a hole
 * instead of covering a region. Normalising once at construction is cheaper
 * than defending every consumer.
 */
export function ensureCounterClockwise(polygon: readonly Vec2[]): Vec2[] {
  return signedArea(polygon) < 0 ? [...polygon].reverse() : [...polygon];
}

export function polygonBounds(polygon: readonly Vec2[]): Bounds {
  if (polygon.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function polygonCentroid(polygon: readonly Vec2[]): Vec2 {
  const n = polygon.length;
  const area = signedArea(polygon);
  // A degenerate ring (zero area — collinear points) has no centroid by the
  // standard formula; the vertex mean is the sensible thing to label.
  if (n < 3 || Math.abs(area) < 1e-9) {
    const sum = polygon.reduce<[number, number]>((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return n === 0 ? [0, 0] : [round4(sum[0] / n), round4(sum[1] / n)];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [round4(cx / (6 * area)), round4(cy / (6 * area))];
}

/** Translate every vertex so the polygon's bounding box starts at the origin. */
export function normalizeToOrigin(polygon: readonly Vec2[]): Vec2[] {
  const b = polygonBounds(polygon);
  return polygon.map(([x, y]) => [round4(x - b.minX), round4(y - b.minY)] as Vec2);
}

export function translatePolygon(polygon: readonly Vec2[], dx: number, dy: number): Vec2[] {
  return polygon.map(([x, y]) => [round4(x + dx), round4(y + dy)] as Vec2);
}

/** An axis-aligned rectangle as a CCW polygon in a `+y`-up frame. */
export function rectPolygon(x: number, y: number, width: number, height: number): Vec2[] {
  return [
    [round4(x), round4(y)],
    [round4(x + width), round4(y)],
    [round4(x + width), round4(y + height)],
    [round4(x), round4(y + height)],
  ];
}

// ---------------------------------------------------------------------------
// Containment and intersection
// ---------------------------------------------------------------------------

/** Perpendicular distance from `p` to segment `a`–`b`. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-12) return distance(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return distance(p, [a[0] + t * dx, a[1] + t * dy]);
}

export function isPointOnBoundary(p: Vec2, polygon: readonly Vec2[], eps = EPS_M): boolean {
  const n = polygon.length;
  for (let i = 0; i < n; i += 1) {
    if (distanceToSegment(p, polygon[i], polygon[(i + 1) % n]) <= eps) return true;
  }
  return false;
}

/**
 * Ray casting, with the boundary counted as **inside**.
 *
 * The boundary rule is the whole reason this is not three lines of copied
 * code. A sub-area that shares an edge with its surface — a wainscot running to
 * the corners of the wall, which is every wainscot — has half its vertices
 * exactly on the outline. Counting those as outside rejects the most common
 * shape the feature exists to draw.
 */
export function pointInPolygon(p: Vec2, polygon: readonly Vec2[], eps = EPS_M): boolean {
  if (polygon.length < 3) return false;
  if (isPointOnBoundary(p, polygon, eps)) return true;
  const [px, py] = p;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const straddles = yi > py !== yj > py;
    if (!straddles) continue;
    const xCross = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (px < xCross) inside = !inside;
  }
  return inside;
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 1e-12) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a: Vec2, b: Vec2, c: Vec2): boolean {
  return (
    b[0] <= Math.max(a[0], c[0]) + EPS_M &&
    b[0] >= Math.min(a[0], c[0]) - EPS_M &&
    b[1] <= Math.max(a[1], c[1]) + EPS_M &&
    b[1] >= Math.min(a[1], c[1]) - EPS_M
  );
}

/** Proper or improper intersection of two closed segments. */
export function segmentsIntersect(p1: Vec2, q1: Vec2, p2: Vec2, q2: Vec2): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

/**
 * Does the ring cross itself?
 *
 * A bowtie has a perfectly good shoelace area — smaller than either lobe,
 * because the lobes cancel — so an un-checked self-intersection is a room that
 * quietly under-orders material. This is the check that turns that into a
 * refusal at draw time.
 *
 * Adjacent edges share a vertex and always "intersect"; only non-adjacent pairs
 * are tested.
 */
export function isSimplePolygon(polygon: readonly Vec2[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i += 1) {
    const a1 = polygon[i];
    const a2 = polygon[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue;
      const b1 = polygon[j];
      const b2 = polygon[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

/**
 * Is `inner` wholly inside `outer` (edges may touch)?
 *
 * Vertex containment alone is not enough — a star-shaped inner ring can have
 * every vertex inside a concave outer one while its edges cut across a notch —
 * so edge crossings are checked too, and the midpoint of each inner edge is
 * sampled to catch the degenerate case where every vertex sits exactly on the
 * boundary.
 */
export function polygonContainsPolygon(
  outer: readonly Vec2[],
  inner: readonly Vec2[],
  eps = EPS_M
): boolean {
  if (outer.length < 3 || inner.length < 3) return false;
  for (const p of inner) {
    if (!pointInPolygon(p, outer, eps)) return false;
  }
  for (let i = 0; i < inner.length; i += 1) {
    const a = inner[i];
    const b = inner[(i + 1) % inner.length];
    if (!pointInPolygon(midpoint(a, b), outer, eps)) return false;
    for (let j = 0; j < outer.length; j += 1) {
      const c = outer[j];
      const d = outer[(j + 1) % outer.length];
      // A shared or touching edge is legal; a genuine crossing is not. The
      // midpoint test above is what separates the two, so a boundary-only
      // contact here is skipped rather than rejected.
      if (!segmentsIntersect(a, b, c, d)) continue;
      const touching =
        isPointOnBoundary(a, outer, eps) &&
        isPointOnBoundary(b, outer, eps) &&
        isPointOnBoundary(midpoint(a, b), outer, eps);
      if (!touching && crossesProperly(a, b, c, d)) return false;
    }
  }
  return true;
}

function crossesProperly(p1: Vec2, q1: Vec2, p2: Vec2, q2: Vec2): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/**
 * Do two polygons share interior area?
 *
 * Shapes that merely touch along an edge — a wainscot and the paint above it,
 * which is the canonical pair — must answer **false**, or the editor refuses
 * the split it just performed. So a crossing is only counted when it is
 * proper, and containment is tested from an interior sample point rather than a
 * vertex.
 */
export function polygonsOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      if (crossesProperly(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return (
    pointInPolygon(interiorSample(a), b, -EPS_M) || pointInPolygon(interiorSample(b), a, -EPS_M)
  );
}

/**
 * A point strictly inside the polygon.
 *
 * The centroid is inside for a convex ring and can be outside a concave one (an
 * L, which is the second shape any member draws), so it is used only when it
 * passes; otherwise the midpoints of the diagonals from vertex 0 are tried,
 * one of which is interior for any simple polygon.
 */
export function interiorSample(polygon: readonly Vec2[]): Vec2 {
  const c = polygonCentroid(polygon);
  if (pointInPolygon(c, polygon, -EPS_M)) return c;
  for (let i = 2; i < polygon.length; i += 1) {
    const candidate = midpoint(polygon[0], polygon[i]);
    if (pointInPolygon(candidate, polygon, -EPS_M)) return candidate;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Editing helpers
// ---------------------------------------------------------------------------

/**
 * Pull near-axis edges square.
 *
 * Real rooms are overwhelmingly orthogonal and fingers are not, so an edge
 * within `toleranceDeg` of an axis is snapped to it by moving its **end**
 * vertex. Walking the ring in order means each correction feeds the next, which
 * is what closes an almost-rectangle into a rectangle instead of leaving a
 * 3 mm step at the last corner.
 *
 * Edges that are genuinely diagonal — a bay, a canted corner — are outside the
 * tolerance and are left exactly as drawn.
 */
export function orthogonalize(
  polygon: readonly Vec2[],
  toleranceDeg = ORTHO_TOLERANCE_DEG
): Vec2[] {
  const n = polygon.length;
  if (n < 3) return [...polygon];
  const out: Vec2[] = polygon.map((p) => [p[0], p[1]] as Vec2);
  const tol = (toleranceDeg * Math.PI) / 180;
  for (let i = 0; i < n; i += 1) {
    const a = out[i];
    const b = out[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (Math.hypot(dx, dy) < EPS_M) continue;
    const angle = Math.atan2(dy, dx);
    const horizontal = Math.min(Math.abs(angle), Math.abs(Math.abs(angle) - Math.PI));
    const vertical = Math.abs(Math.abs(angle) - Math.PI / 2);
    if (horizontal <= tol) {
      out[(i + 1) % n] = [round4(b[0]), round4(a[1])];
    } else if (vertical <= tol) {
      out[(i + 1) % n] = [round4(a[0]), round4(b[1])];
    }
  }
  return out;
}

/**
 * Drop vertices that add nothing: duplicates, and points collinear with their
 * neighbours.
 *
 * Both are produced constantly by ordinary editing — a double-tap adds a
 * duplicate, splitting an edge and then dragging the new vertex back onto it
 * leaves a collinear one — and both break `isSimplePolygon`'s adjacency
 * assumptions and clutter the handle layer. `toleranceM` is a *distance* from
 * the chord rather than an angle so that the test behaves the same on a 30 cm
 * edge and a 6 m one.
 */
export function simplifyPolygon(polygon: readonly Vec2[], toleranceM = EPS_M): Vec2[] {
  const deduped: Vec2[] = [];
  for (const p of polygon) {
    if (deduped.length === 0 || !samePoint(deduped[deduped.length - 1], p, toleranceM)) {
      deduped.push([round4(p[0]), round4(p[1])]);
    }
  }
  while (deduped.length > 1 && samePoint(deduped[0], deduped[deduped.length - 1], toleranceM)) {
    deduped.pop();
  }
  if (deduped.length < 4) return deduped;

  const out: Vec2[] = [];
  for (let i = 0; i < deduped.length; i += 1) {
    const prev = deduped[(i - 1 + deduped.length) % deduped.length];
    const cur = deduped[i];
    const next = deduped[(i + 1) % deduped.length];
    if (distanceToSegment(cur, prev, next) > toleranceM) out.push(cur);
  }
  return out.length >= 3 ? out : deduped;
}

/** Insert a vertex at the midpoint of edge `edgeIndex` (vertex i → i+1). */
export function insertVertexOnEdge(polygon: readonly Vec2[], edgeIndex: number): Vec2[] {
  const n = polygon.length;
  if (n < 2) return [...polygon];
  const i = ((edgeIndex % n) + n) % n;
  const point = midpoint(polygon[i], polygon[(i + 1) % n]);
  const out = [...polygon];
  out.splice(i + 1, 0, [round4(point[0]), round4(point[1])]);
  return out;
}

/** Remove a vertex, refusing to go below a triangle. */
export function removeVertex(polygon: readonly Vec2[], index: number): Vec2[] {
  if (polygon.length <= 3) return [...polygon];
  const out = [...polygon];
  out.splice(((index % polygon.length) + polygon.length) % polygon.length, 1);
  return out;
}

/** Index of the vertex within `radius` of `p`, or -1. Nearest wins. */
export function hitTestVertex(polygon: readonly Vec2[], p: Vec2, radius: number): number {
  let best = -1;
  let bestDistance = radius;
  polygon.forEach((vertex, index) => {
    const d = distance(vertex, p);
    if (d <= bestDistance) {
      bestDistance = d;
      best = index;
    }
  });
  return best;
}

/** Index of the edge within `radius` of `p`, or -1. Nearest wins. */
export function hitTestEdge(polygon: readonly Vec2[], p: Vec2, radius: number): number {
  let best = -1;
  let bestDistance = radius;
  const n = polygon.length;
  for (let i = 0; i < n; i += 1) {
    const d = distanceToSegment(p, polygon[i], polygon[(i + 1) % n]);
    if (d <= bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/**
 * Clamp a point to the polygon: unchanged if inside, otherwise moved to the
 * nearest point on the boundary.
 *
 * Used while dragging a sub-area handle, so that a finger leaving the wall
 * produces a shape stuck to its edge rather than an invalid one the validator
 * has to reject after the fact. Refusing at drop time is a worse interaction
 * than not letting it happen.
 */
export function clampPointToPolygon(p: Vec2, polygon: readonly Vec2[]): Vec2 {
  if (pointInPolygon(p, polygon)) return p;
  let best: Vec2 = p;
  let bestDistance = Infinity;
  const n = polygon.length;
  for (let i = 0; i < n; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq < 1e-12 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    const candidate: Vec2 = [a[0] + t * dx, a[1] + t * dy];
    const d = distance(p, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return [round4(best[0]), round4(best[1])];
}

/**
 * Cut a polygon with a horizontal or vertical line, returning the pieces.
 *
 * This is the operation behind "split this wall at 1.1 m" — the wainscot case —
 * and it is a **half-plane clip** (Sutherland–Hodgman) rather than a general
 * boolean, run twice with opposite tests. That is the right trade here: it is
 * exact for any convex or concave *simple* polygon cut by one straight line,
 * it is about thirty lines, and it cannot produce the topology a general
 * polygon boolean can (multiple disjoint pieces from one cut) — which the model
 * has no way to store anyway, since a sub-area is a single ring.
 *
 * A cut that misses the polygon returns the polygon and an empty piece, so the
 * caller can refuse without a special case.
 */
export function splitPolygonByLine(
  polygon: readonly Vec2[],
  axis: 'x' | 'y',
  at: number
): { low: Vec2[]; high: Vec2[] } {
  const value = (p: Vec2) => (axis === 'x' ? p[0] : p[1]);
  const clip = (keepBelow: boolean): Vec2[] => {
    const out: Vec2[] = [];
    const n = polygon.length;
    for (let i = 0; i < n; i += 1) {
      const current = polygon[i];
      const next = polygon[(i + 1) % n];
      const cv = value(current);
      const nv = value(next);
      const currentIn = keepBelow ? cv <= at + EPS_M : cv >= at - EPS_M;
      const nextIn = keepBelow ? nv <= at + EPS_M : nv >= at - EPS_M;
      if (currentIn) out.push([round4(current[0]), round4(current[1])]);
      if (currentIn !== nextIn && Math.abs(nv - cv) > 1e-12) {
        const t = (at - cv) / (nv - cv);
        const crossing: Vec2 = [
          round4(current[0] + t * (next[0] - current[0])),
          round4(current[1] + t * (next[1] - current[1])),
        ];
        out.push(crossing);
      }
    }
    return simplifyPolygon(out);
  };

  const low = clip(true);
  const high = clip(false);
  return {
    low: low.length >= 3 && polygonArea(low) > EPS_M ? low : [],
    high: high.length >= 3 && polygonArea(high) > EPS_M ? high : [],
  };
}

/**
 * Shrink a polygon by `insetM` on every side — the "border" sub-area.
 *
 * A true polygon offset (mitred, with self-intersection cleanup) is a large and
 * fiddly algorithm whose failure modes are exactly the concave corners a room
 * is full of. This scales about the centroid to hit the requested inset on the
 * *bounding box*, which is exact for a rectangle — the shape members inset
 * ninety-nine times out of a hundred — and is a visually correct approximation
 * elsewhere. `null` when the inset would consume the shape, so the caller
 * refuses rather than drawing a degenerate ring.
 */
export function insetPolygon(polygon: readonly Vec2[], insetM: number): Vec2[] | null {
  if (insetM <= 0) return [...polygon];
  const b = polygonBounds(polygon);
  if (b.width <= insetM * 2 + EPS_M || b.height <= insetM * 2 + EPS_M) return null;
  const scaleX = (b.width - insetM * 2) / b.width;
  const scaleY = (b.height - insetM * 2) / b.height;
  const cx = b.minX + b.width / 2;
  const cy = b.minY + b.height / 2;
  return polygon.map(
    ([x, y]) => [round4(cx + (x - cx) * scaleX), round4(cy + (y - cy) * scaleY)] as Vec2
  );
}

/**
 * Set one edge to an exact length, keeping the ring closed.
 *
 * The other half of "drag a corner": a member who measured a wall at 3.62 m
 * cannot produce that with a finger, and every quantity in the project is
 * derived from these numbers. Typing the wall you measured is the whole point
 * of measuring it.
 *
 * ## Which vertices move
 *
 * A closed ring cannot have one edge lengthened in isolation — something else
 * has to give. For an **axis-aligned** edge (which is what the presets produce
 * and what `orthogonalize` maintains) the rule that matches what a member
 * expects is: move the edge's far endpoint, **and every other vertex sharing
 * that endpoint's coordinate on the edge's axis**, by the same delta.
 *
 * On a rectangle that widens the room. On an L, lengthening the bottom wall
 * pushes the whole right-hand side out and leaves the upper part where it was,
 * which is what "make this wall longer" means when you are standing in the
 * room. Moving only the single endpoint would instead skew the two walls
 * either side of it into diagonals.
 *
 * **The edge attached to the far end stretches rather than translating.** On
 * that same L the cut-out gets wider, because its inner corner does not share
 * the coordinate that moved. That is a real trade and it is the right one: the
 * alternative — translating a whole chain of vertices — has no unambiguous
 * answer on a closed ring, and would move walls the member can see are
 * untouched. The stretched edge has its own row in the editor and its own
 * number, so putting it back is one more tap. `edgeResizeAffects` is what lets
 * the editor say which corners will move before they do.
 *
 * A **diagonal** edge (a bay, a canted corner) has no such shared coordinate,
 * so only its far endpoint moves. That changes the length of the neighbouring
 * edge too, which is unavoidable and is why the editor tells the member which
 * walls a change will move.
 *
 * Returns `null` rather than a broken room when the result would be
 * self-intersecting or degenerate — a wall dragged through the opposite wall is
 * a refusal, not a shape to store.
 */
export function resizeEdge(
  outline: readonly Vec2[],
  edgeIndex: number,
  targetLengthM: number
): Vec2[] | null {
  const n = outline.length;
  if (n < 3 || targetLengthM <= EPS_M) return null;
  const i = ((edgeIndex % n) + n) % n;
  const a = outline[i];
  const b = outline[(i + 1) % n];

  const current = distance(a, b);
  if (current <= EPS_M) return null;
  if (Math.abs(current - targetLengthM) <= EPS_M) return [...outline];

  const scale = (targetLengthM - current) / current;
  const shift: Vec2 = [(b[0] - a[0]) * scale, (b[1] - a[1]) * scale];

  const horizontal = Math.abs(b[1] - a[1]) <= EPS_M;
  const vertical = Math.abs(b[0] - a[0]) <= EPS_M;

  let next: Vec2[];
  if (horizontal || vertical) {
    // The axis the edge runs along — the one whose coordinate differs between
    // its endpoints, and therefore the one the far vertices are grouped by.
    const axis = horizontal ? 0 : 1;
    const anchorValue = b[axis];
    next = outline.map((point) =>
      Math.abs(point[axis] - anchorValue) <= EPS_M
        ? ([round4(point[0] + shift[0]), round4(point[1] + shift[1])] as Vec2)
        : ([round4(point[0]), round4(point[1])] as Vec2)
    );
  } else {
    next = outline.map((point, index) =>
      index === (i + 1) % n
        ? ([round4(point[0] + shift[0]), round4(point[1] + shift[1])] as Vec2)
        : ([round4(point[0]), round4(point[1])] as Vec2)
    );
  }

  const cleaned = simplifyPolygon(next);
  if (cleaned.length < 3) return null;
  if (!isSimplePolygon(cleaned)) return null;
  if (polygonArea(cleaned) < 0.05) return null;
  return cleaned;
}

/**
 * Which vertices `resizeEdge` would move — so the editor can say so before it
 * happens, rather than surprising the member with a wall they did not touch.
 */
export function edgeResizeAffects(
  outline: readonly Vec2[],
  edgeIndex: number
): number[] {
  const n = outline.length;
  if (n < 3) return [];
  const i = ((edgeIndex % n) + n) % n;
  const a = outline[i];
  const b = outline[(i + 1) % n];
  const horizontal = Math.abs(b[1] - a[1]) <= EPS_M;
  const vertical = Math.abs(b[0] - a[0]) <= EPS_M;
  if (!horizontal && !vertical) return [(i + 1) % n];
  const axis = horizontal ? 0 : 1;
  const anchorValue = b[axis];
  const moved: number[] = [];
  outline.forEach((point, index) => {
    if (Math.abs(point[axis] - anchorValue) <= EPS_M) moved.push(index);
  });
  return moved;
}

// ---------------------------------------------------------------------------
// Compass labelling
// ---------------------------------------------------------------------------

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

/**
 * Which way does an edge's outward normal face?
 *
 * Used to name derived walls "North wall", "East wall" and so on, which is how
 * members refer to them and what makes the surface picker readable without a
 * plan open beside it. The frame is the model's — `+x` east, `+y` north — and
 * the normal is taken as the edge direction rotated a quarter turn, then
 * flipped if it points at the polygon rather than away from it.
 *
 * Note the label describes **which wall of the room it is**, not which way the
 * finished face points: the north wall's finished face looks south. Members
 * mean the former.
 */
export function edgeCompassPoint(
  a: Vec2,
  b: Vec2,
  polygonCentroid_: Vec2
): CompassPoint {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let nx = dy;
  let ny = -dx;
  const mid = midpoint(a, b);
  const towardCentroid = [polygonCentroid_[0] - mid[0], polygonCentroid_[1] - mid[1]];
  if (nx * towardCentroid[0] + ny * towardCentroid[1] > 0) {
    nx = -nx;
    ny = -ny;
  }
  // atan2(x, y) — not (y, x) — because the compass measures clockwise from
  // north, and north is +y here.
  const bearing = (Math.atan2(nx, ny) * 180) / Math.PI;
  const normalized = (bearing + 360) % 360;
  return COMPASS_POINTS[Math.round(normalized / 45) % 8];
}
