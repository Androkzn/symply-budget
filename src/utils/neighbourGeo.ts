/**
 * The map's arithmetic, with no map in it.
 *
 * Everything here is a pure function over plain coordinates: distance, bearing,
 * the region that frames a set of pins, and the clustering that turns forty pins
 * into six bubbles. None of it imports `react-native-maps`, `expo-location` or a
 * component, which is the point — the parts of a map screen that are actually
 * WRONG when they are wrong are the numbers, and numbers can be tested without a
 * simulator.
 *
 * ## Why clustering is grid-based rather than distance-based
 *
 * The obvious algorithm is "merge any two pins closer than N metres", and it is
 * the wrong one for this screen. It is O(n²), it is order-dependent (the same
 * pins cluster differently depending on which one is read first, so a list
 * re-sort visibly reshuffles the map), and it produces chains — A near B near C
 * merges into one bubble spanning three houses that are nowhere near each other.
 *
 * Snapping to a grid whose cell is derived from the current zoom is O(n), gives
 * the same answer for the same input in any order, and bounds a bubble's extent
 * to one cell by construction. It is what mapping libraries actually do, and it
 * is the reason a cluster on this map can be labelled with a count that means
 * something.
 *
 * ## Why the grid is in DEGREES and the cell is per-axis
 *
 * A degree of latitude is ~111 km everywhere; a degree of longitude is ~111 km
 * at the equator and ~78 km in Vancouver. Using one cell size for both axes
 * produces cells that are visibly taller than they are wide at any latitude a
 * house is at, and the clusters then look wrong in a way a member can see
 * without measuring anything. The longitude cell is divided by `cos(latitude)`
 * so cells stay roughly square on screen.
 */

export const EARTH_RADIUS_M = 6_371_008.8;

export type LatLng = { latitude: number; longitude: number };

export type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Metres between two coordinates (haversine).
 *
 * Deliberately duplicated in `backend/src/services/neighbour-service.ts` and
 * `localNeighboursApi.ts` rather than shared through a package: the three sides
 * compute distances for rows the others cannot see, and both suites assert the
 * same fixtures so a divergence fails rather than drifts.
 */
export function distanceMeters(from: LatLng, to: LatLng): number {
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude));
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Compass bearing from → to, in degrees clockwise from north. */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** "NE" etc. — the eight-point compass, which is as precise as a street needs. */
export function compassPoint(bearing: number): (typeof COMPASS_POINTS)[number] {
  const index = Math.round(((bearing % 360) + 360) % 360 / 45) % 8;
  return COMPASS_POINTS[index]!;
}

/**
 * "120 m" / "1.4 km" / "350 ft" / "0.9 mi".
 *
 * Metric and imperial rather than metric-only, because the household already has
 * a `unit_system` and a Canadian member reading "40 m" understands it while a
 * US member reading the same number does not picture a house next door.
 */
export function formatDistance(meters: number | null, system: 'metric' | 'imperial'): string {
  if (meters === null || !Number.isFinite(meters)) return '';
  if (system === 'imperial') {
    const feet = meters * 3.280839895;
    if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
    return `${(feet / 5280).toFixed(feet / 5280 < 10 ? 1 : 0)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters / 1000 < 10 ? 1 : 0)} km`;
}

/**
 * The region that frames every point, with padding.
 *
 * Two guards that matter more than the arithmetic:
 *
 *  - **A single point has no extent**, so the naive max−min gives a delta of 0
 *    and `MapView` renders at maximum zoom — a grey square with one pin in it.
 *    The floor is `MIN_DELTA`, roughly a residential block.
 *  - **An empty set has no centre.** Callers get `null` and are expected to fall
 *    back to the household's own position; inventing `{0,0}` puts the member in
 *    the Gulf of Guinea, which has been shipped by enough apps to be a genre.
 */
export const MIN_REGION_DELTA = 0.004;

export function regionForPoints(points: readonly LatLng[], paddingRatio = 0.35): MapRegion | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const point of points) {
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLon = Math.min(minLon, point.longitude);
    maxLon = Math.max(maxLon, point.longitude);
  }
  const latitudeDelta = Math.max((maxLat - minLat) * (1 + paddingRatio), MIN_REGION_DELTA);
  const longitudeDelta = Math.max((maxLon - minLon) * (1 + paddingRatio), MIN_REGION_DELTA);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

/** A region centred on one point, at a fixed zoom. The "no neighbours yet" view. */
export function regionAround(point: LatLng, delta = MIN_REGION_DELTA * 2): MapRegion {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };
}

export type ClusterItem<T> = {
  /** Stable across renders at one zoom — a cell key, or the single item's id. */
  key: string;
  latitude: number;
  longitude: number;
  items: T[];
};

/**
 * How many grid cells span the visible region.
 *
 * Lower = bigger cells = more aggressive clustering. Eight is the number that
 * keeps a bubble roughly the size of the marker that renders it: fewer and two
 * homes across a street merge, more and a dense block stays as overlapping pins.
 */
export const CLUSTER_CELLS_ACROSS = 8;

/**
 * How close two cell centroids must be before their cells are merged, as a
 * fraction of one cell. See `clusterPoints`' second pass.
 */
export const CLUSTER_MERGE_FRACTION = 0.5;

/**
 * Group points into grid cells sized by the current zoom, then heal the seams.
 *
 * ## Pass one: the grid
 *
 * O(n), order-independent, and it bounds a cluster's extent to one cell. See the
 * file header for why this beats "merge anything closer than N metres".
 *
 * ## Pass two: merging across cell boundaries, and why it is not optional
 *
 * A plain grid has one visible failure and it is not subtle: two houses five
 * metres apart that happen to straddle a cell boundary render as two separate
 * bubbles, while a whole block inside one cell renders as one. The member sees
 * a map that has grouped the wrong things, and there is nothing they can do
 * about it — the boundary is invisible.
 *
 * So a second pass merges any two clusters whose centroids are within half a
 * cell of each other. It is:
 *
 *  - **cheap** — the candidate set is at most `cellsAcross²` (64), not `n`, so
 *    this is a fixed 64² worst case regardless of how many homes there are;
 *  - **deterministic** — clusters are visited in sorted key order and each one
 *    merges into the first EARLIER cluster it is close to, so the result does
 *    not depend on the order points arrived in. That property is asserted;
 *  - **bounded to one hop** — a merged cluster is not itself re-examined as a
 *    merge target's target, which is what stops the chaining that makes
 *    distance-threshold clustering produce bubbles spanning a whole street.
 *
 * Returns clusters in a STABLE order — key ascending — so React reconciles
 * markers across a pan instead of remounting them, which on a map reads as every
 * bubble blinking. A single-item cluster keeps the item's own id as its key for
 * the same reason: the marker survives the moment its neighbours cluster away.
 */
export function clusterPoints<T extends LatLng & { id: string }>(
  points: readonly T[],
  region: MapRegion,
  cellsAcross = CLUSTER_CELLS_ACROSS
): ClusterItem<T>[] {
  if (points.length === 0) return [];
  const latCell = Math.max(region.latitudeDelta / cellsAcross, 1e-6);
  // Keep cells square on screen: a degree of longitude shrinks with latitude.
  const cosLat = Math.max(Math.cos(toRad(region.latitude)), 0.01);
  const lonCell = Math.max(region.longitudeDelta / cellsAcross, 1e-6) / cosLat;

  const buckets = new Map<string, T[]>();
  for (const point of points) {
    const row = Math.floor(point.latitude / latCell);
    const col = Math.floor(point.longitude / lonCell);
    const key = `${row}:${col}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }

  // Sorted first, so pass two visits cells in an order that does not depend on
  // the input order. Everything below relies on this.
  const cells = Array.from(buckets.entries())
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const merged: { key: string; items: T[]; latitude: number; longitude: number }[] = [];
  for (const cell of cells) {
    const centre = centroid(cell.items);
    const target = merged.find(
      (candidate) =>
        Math.abs(candidate.latitude - centre.latitude) <= latCell * CLUSTER_MERGE_FRACTION &&
        Math.abs(candidate.longitude - centre.longitude) <= lonCell * CLUSTER_MERGE_FRACTION
    );
    if (target) {
      target.items.push(...cell.items);
      const next = centroid(target.items);
      target.latitude = next.latitude;
      target.longitude = next.longitude;
      continue;
    }
    merged.push({ key: cell.key, items: cell.items, ...centre });
  }

  return merged
    .map((cluster) => ({
      // A cluster sits at the CENTROID of its members, never at its cell centre:
      // the cell is an implementation detail of the grouping, and drawing the
      // bubble on it would float it off the houses it stands for.
      key: cluster.items.length === 1 ? cluster.items[0]!.id : cluster.key,
      latitude: cluster.latitude,
      longitude: cluster.longitude,
      items: cluster.items,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function centroid(items: readonly LatLng[]): LatLng {
  return {
    latitude: items.reduce((sum, item) => sum + item.latitude, 0) / items.length,
    longitude: items.reduce((sum, item) => sum + item.longitude, 0) / items.length,
  };
}

/**
 * Suggest a relation from where a pin landed relative to the home.
 *
 * A SUGGESTION, never a decision: it pre-selects a chip on the add form and the
 * member can change it in one tap. Getting it right most of the time removes a
 * field from the common path; getting it wrong costs one tap, which is why the
 * thresholds are deliberately loose rather than clever.
 *
 * The bands come from what a lot actually measures. Under ~35 m of a typical
 * suburban home is the property beside it; a street is 15–30 m wide, so
 * something 25–60 m away on a bearing roughly perpendicular to the frontage is
 * across it. Beyond ~150 m nothing about the geometry is informative and the
 * honest answer is "nearby".
 */
export function suggestRelation(
  origin: LatLng | null,
  point: LatLng
): 'next_door' | 'across' | 'behind' | 'nearby' {
  if (!origin) return 'nearby';
  const meters = distanceMeters(origin, point);
  if (meters > 150) return 'nearby';
  if (meters <= 35) return 'next_door';
  const bearing = bearingDegrees(origin, point);
  // North/south of the home reads as "behind or in front"; east/west reads as
  // "along the street". Without the home's actual orientation this is the best
  // available guess, and it is why the result is a suggestion.
  const northSouth = bearing < 45 || bearing > 315 || (bearing > 135 && bearing < 225);
  if (meters <= 90) return northSouth ? 'behind' : 'across';
  return 'nearby';
}

/**
 * Split the address the OS geocoder returns into the columns a row stores.
 *
 * The geocoder's own field names differ per platform and per locale; this is the
 * one place that mapping lives, so a screen never reaches into a raw geocode
 * result. `formatted` is kept verbatim alongside the components — see the
 * migration's header for why neither is recomputed from the other.
 */
export type ParsedAddress = {
  address_line1: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country: string | null;
  formatted_address: string | null;
};

export function composeFormattedAddress(parts: Omit<ParsedAddress, 'formatted_address'>): string {
  return [parts.address_line1, parts.city, parts.state_province, parts.postal_code]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)
    .join(', ');
}

/** A short one-line label for a pin: the street line, or the coordinates. */
export function shortAddressLabel(
  neighbour: Pick<ParsedAddress, 'address_line1' | 'formatted_address'> & LatLng
): string {
  if (neighbour.address_line1?.trim()) return neighbour.address_line1.trim();
  if (neighbour.formatted_address?.trim()) return neighbour.formatted_address.trim();
  // Five decimal places is ~1 m — enough to tell two houses apart, short enough
  // to fit a card. A pin with no address at all is a normal state on this
  // screen: tapping a roof and typing a name is the fastest path through it.
  return `${neighbour.latitude.toFixed(5)}, ${neighbour.longitude.toFixed(5)}`;
}

/** Initials for an avatar with no photo — at most two letters, uppercase. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase();
}
