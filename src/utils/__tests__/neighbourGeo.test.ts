/**
 * The map's arithmetic, tested without a map.
 *
 * Every property asserted here is one a member can SEE go wrong: pins that
 * cluster into the wrong bubble, a map that opens on the Gulf of Guinea, a
 * distance that reads "0 m" for the house across the street. The component
 * tests below cannot catch any of them, because a marker renders identically
 * whether its coordinates are right or wrong.
 *
 * The distance fixtures are shared with `backend/src/services/__tests__/
 * neighbour-service.test.ts` and `localNeighboursApi.test.ts` on purpose: three
 * copies of haversine exist (client, ledger facade, Worker) for reasons each
 * file states, and identical fixtures are what stops them drifting.
 */
import {
  bearingDegrees,
  clusterPoints,
  compassPoint,
  composeFormattedAddress,
  distanceMeters,
  formatDistance,
  initialsOf,
  MIN_REGION_DELTA,
  regionAround,
  regionForPoints,
  shortAddressLabel,
  suggestRelation,
} from '../neighbourGeo';

/** Two points on one Vancouver residential street, ~40 m apart. */
const HOME = { latitude: 49.2827, longitude: -123.1207 };
const NEXT_DOOR = { latitude: 49.28306, longitude: -123.1207 };
const ACROSS = { latitude: 49.2827, longitude: -123.12145 };
const FAR = { latitude: 49.29, longitude: -123.13 };

describe('distanceMeters', () => {
  it('is zero for a point against itself', () => {
    expect(distanceMeters(HOME, HOME)).toBe(0);
  });

  it('measures a next-door lot in tens of metres, not hundreds', () => {
    const meters = distanceMeters(HOME, NEXT_DOOR);
    expect(meters).toBeGreaterThan(30);
    expect(meters).toBeLessThan(50);
  });

  it('is symmetric', () => {
    expect(distanceMeters(HOME, FAR)).toBeCloseTo(distanceMeters(FAR, HOME), 6);
  });

  it('matches a known long-distance fixture', () => {
    // Vancouver → Seattle, great-circle, ~195.3 km. A formula error (degrees
    // fed in as radians, the wrong earth radius, a swapped sin/cos) shows up
    // here as a factor rather than a rounding difference — which is why this
    // fixture is long-distance and the one above is not.
    const seattle = { latitude: 47.6062, longitude: -122.3321 };
    expect(distanceMeters(HOME, seattle) / 1000).toBeCloseTo(195.3, 1);
  });

  it('does not return NaN for antipodal points', () => {
    // The naive `asin(sqrt(a))` overflows past 1 through floating point at
    // exactly opposite points, and `Math.min(1, …)` is what prevents it.
    const value = distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 });
    expect(Number.isFinite(value)).toBe(true);
  });
});

describe('bearingDegrees / compassPoint', () => {
  it('reads due north as 0 and due east as 90', () => {
    expect(bearingDegrees(HOME, { latitude: HOME.latitude + 0.01, longitude: HOME.longitude }))
      .toBeCloseTo(0, 0);
    expect(bearingDegrees(HOME, { latitude: HOME.latitude, longitude: HOME.longitude + 0.01 }))
      .toBeCloseTo(90, 0);
  });

  it('names the eight compass points, wrapping 360 back to N', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(45)).toBe('NE');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(-90)).toBe('W');
  });
});

describe('formatDistance', () => {
  it('rounds metres to the nearest ten and switches to km past 1000', () => {
    expect(formatDistance(42, 'metric')).toBe('40 m');
    expect(formatDistance(950, 'metric')).toBe('950 m');
    expect(formatDistance(1400, 'metric')).toBe('1.4 km');
    expect(formatDistance(24_000, 'metric')).toBe('24 km');
  });

  it('uses feet and miles for an imperial household', () => {
    expect(formatDistance(30, 'imperial')).toBe('100 ft');
    expect(formatDistance(5000, 'imperial')).toBe('3.1 mi');
  });

  it('renders nothing at all when the distance is unknown', () => {
    // `null` is the ordinary case on a remote household and on a property whose
    // address will not geocode — it must produce an empty string the caller can
    // concatenate, never "null" or "NaN m".
    expect(formatDistance(null, 'metric')).toBe('');
    expect(formatDistance(Number.NaN, 'metric')).toBe('');
  });
});

describe('regionForPoints', () => {
  it('returns null for an empty set rather than inventing a centre', () => {
    // The 0,0 fallback is the bug this asserts against: it puts the member in
    // the Gulf of Guinea and looks like a loading state that never finished.
    expect(regionForPoints([])).toBeNull();
  });

  it('floors the delta so a single point does not render at maximum zoom', () => {
    const region = regionForPoints([HOME])!;
    expect(region.latitude).toBeCloseTo(HOME.latitude, 6);
    expect(region.latitudeDelta).toBe(MIN_REGION_DELTA);
    expect(region.longitudeDelta).toBe(MIN_REGION_DELTA);
  });

  it('centres on the bounding box and pads it', () => {
    const region = regionForPoints([HOME, FAR])!;
    expect(region.latitude).toBeCloseTo((HOME.latitude + FAR.latitude) / 2, 6);
    expect(region.longitude).toBeCloseTo((HOME.longitude + FAR.longitude) / 2, 6);
    // Padding means the extremes are inside the frame, not on its edge.
    expect(region.latitudeDelta).toBeGreaterThan(Math.abs(FAR.latitude - HOME.latitude));
  });

  it('regionAround centres on one point at a fixed zoom', () => {
    const region = regionAround(HOME);
    expect(region.latitude).toBe(HOME.latitude);
    expect(region.latitudeDelta).toBe(region.longitudeDelta);
  });
});

describe('clusterPoints', () => {
  const region = { latitude: 49.2827, longitude: -123.1207, latitudeDelta: 0.02, longitudeDelta: 0.02 };
  const pin = (id: string, latitude: number, longitude: number) => ({ id, latitude, longitude });

  it('returns nothing for no points', () => {
    expect(clusterPoints([], region)).toEqual([]);
  });

  it('keeps a lone pin as itself, keyed by its own id', () => {
    const [cluster] = clusterPoints([pin('a', 49.2827, -123.1207)], region);
    // The id, not a cell key: the marker must survive the moment its neighbours
    // cluster away, or every pin blinks on each pan.
    expect(cluster!.key).toBe('a');
    expect(cluster!.items).toHaveLength(1);
  });

  it('merges pins that fall in one cell and splits them as the map zooms in', () => {
    const pins = [
      pin('a', 49.2827, -123.1207),
      pin('b', 49.28275, -123.12075),
      pin('c', 49.2828, -123.1208),
    ];
    const zoomedOut = clusterPoints(pins, region);
    expect(zoomedOut).toHaveLength(1);
    expect(zoomedOut[0]!.items).toHaveLength(3);

    // Same pins, a region 200× tighter: the cell shrinks with the viewport and
    // the group falls apart, which is the entire contract of zoom-aware
    // clustering.
    const zoomedIn = clusterPoints(pins, { ...region, latitudeDelta: 0.0001, longitudeDelta: 0.0001 });
    expect(zoomedIn.length).toBeGreaterThan(1);
  });

  it('places a cluster at the centroid of its members, not at the cell centre', () => {
    const pins = [pin('a', 49.2800, -123.1200), pin('b', 49.2810, -123.1210)];
    const [cluster] = clusterPoints(pins, region);
    expect(cluster!.latitude).toBeCloseTo(49.2805, 4);
    expect(cluster!.longitude).toBeCloseTo(-123.1205, 4);
  });

  it('is order-independent — the same pins cluster the same way however they arrive', () => {
    // The property a distance-threshold algorithm cannot offer, and the reason
    // this one snaps to a grid: a list re-sort must not visibly reshuffle the map.
    const pins = [
      pin('a', 49.2827, -123.1207),
      pin('b', 49.2900, -123.1300),
      pin('c', 49.28275, -123.12075),
      pin('d', 49.2901, -123.1301),
    ];
    const forward = clusterPoints(pins, region).map((c) => c.items.map((i) => i.id).sort());
    const reversed = clusterPoints([...pins].reverse(), region).map((c) =>
      c.items.map((i) => i.id).sort()
    );
    expect(reversed).toEqual(forward);
  });

  it('returns clusters in a stable sorted order', () => {
    const pins = [pin('z', 49.2900, -123.1300), pin('a', 49.2827, -123.1207)];
    const keys = clusterPoints(pins, region).map((c) => c.key);
    expect(keys).toEqual([...keys].sort());
  });

  it('accounts for longitude convergence so cells stay square', () => {
    // At 49°N a degree of longitude is ~2/3 of a degree of latitude. Two pins
    // separated by the same DEGREE amount in each axis must not cluster
    // differently — if they do, the grid is stretched and the bubbles look wrong
    // to the eye without being measurably wrong to a naive test.
    const delta = 0.0015;
    const latPair = [pin('a', 49.2827, -123.1207), pin('b', 49.2827 + delta, -123.1207)];
    const lonPair = [pin('c', 49.2827, -123.1207), pin('d', 49.2827, -123.1207 + delta / 0.65)];
    expect(clusterPoints(latPair, region).length).toBe(clusterPoints(lonPair, region).length);
  });
});

describe('suggestRelation', () => {
  it('says "nearby" with no origin, because there is nothing to be relative to', () => {
    expect(suggestRelation(null, NEXT_DOOR)).toBe('nearby');
  });

  it('calls a lot within ~35 m next door', () => {
    expect(suggestRelation(HOME, { latitude: HOME.latitude + 0.0002, longitude: HOME.longitude }))
      .toBe('next_door');
  });

  it('calls a home east or west at street width "across"', () => {
    expect(suggestRelation(HOME, ACROSS)).toBe('across');
  });

  it('calls a home directly north or south at the same range "behind"', () => {
    expect(suggestRelation(HOME, { latitude: HOME.latitude + 0.0006, longitude: HOME.longitude }))
      .toBe('behind');
  });

  it('gives up past 150 m rather than guessing', () => {
    expect(suggestRelation(HOME, FAR)).toBe('nearby');
  });
});

describe('address helpers', () => {
  it('joins only the parts that exist', () => {
    expect(
      composeFormattedAddress({
        address_line1: '42 Maple St',
        city: 'Vancouver',
        state_province: null,
        postal_code: '  ',
        country: 'CA',
      })
    ).toBe('42 Maple St, Vancouver');
  });

  it('returns an empty string when there is nothing to join', () => {
    expect(
      composeFormattedAddress({
        address_line1: null,
        city: null,
        state_province: null,
        postal_code: null,
        country: null,
      })
    ).toBe('');
  });

  it('falls back through street → formatted → coordinates', () => {
    expect(
      shortAddressLabel({ address_line1: '42 Maple St', formatted_address: 'x', ...HOME })
    ).toBe('42 Maple St');
    expect(
      shortAddressLabel({ address_line1: null, formatted_address: '42 Maple St, Vancouver', ...HOME })
    ).toBe('42 Maple St, Vancouver');
    // A pin with no address at all is a NORMAL state on this screen — tapping a
    // roof and typing a name is the fastest path through the feature — so the
    // fallback has to read as a location rather than as missing data.
    expect(shortAddressLabel({ address_line1: null, formatted_address: null, ...HOME })).toBe(
      '49.28270, -123.12070'
    );
  });
});

describe('initialsOf', () => {
  it('takes first and last initials, uppercased', () => {
    expect(initialsOf('Sarah Wilson')).toBe('SW');
    expect(initialsOf('mary jane watson')).toBe('MW');
  });

  it('takes two letters from a single name', () => {
    expect(initialsOf('Bo')).toBe('BO');
    expect(initialsOf('Prince')).toBe('PR');
  });

  it('never renders empty', () => {
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('')).toBe('?');
  });
});
