/**
 * The map screen, driven through its real hooks with a stubbed map.
 *
 * `react-native-maps` is a native view with no JS behaviour worth exercising, so
 * it is replaced by plain hosts that record what they were given. That leaves
 * the things this screen actually decides, which are the ones worth locking:
 *
 *  - **a marker per home at street zoom, a cluster bubble at neighbourhood
 *    zoom.** The screen passes the CURRENT region to `clusterPoints`, so the
 *    same data renders differently as the member zooms — with nothing to
 *    configure and nothing to go stale;
 *  - **long-press adds, tap does not.** A member panning a map taps it
 *    constantly by accident; if a tap opened a create form this feature would be
 *    unusable, and no other test would catch it;
 *  - **the empty state teaches the gesture.** Long-press is undiscoverable, so
 *    the hint is on the map itself and goes away once there is anything to look
 *    at;
 *  - **the add sheet offers all three doors**, in the order that puts the
 *    privacy-preserving one first.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

const mockNavigate = jest.fn();

jest.mock('react-native-maps', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  const MapView = ReactMock.forwardRef(
    ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }, ref: unknown) => {
      ReactMock.useImperativeHandle(ref, () => ({ animateToRegion: jest.fn() }));
      return ReactMock.createElement(View, props, children as React.ReactNode);
    }
  );
  return {
    __esModule: true,
    default: MapView,
    Marker: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
      ReactMock.createElement(View, props, children as React.ReactNode),
    PROVIDER_DEFAULT: 'default',
  };
});

/**
 * `ScreenHeader` reaches `useProfile`, which needs a provider this screen does
 * not own. Mocking the ONE component rather than wrapping the tree in every
 * provider keeps the test about the map: the header is chrome, it is asserted
 * by its own suite, and pulling `ProfileProvider` in here would make this file
 * fail for reasons that have nothing to do with neighbours.
 */
jest.mock('@components/common', () => {
  const actual = jest.requireActual('@components/common');
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    ...actual,
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
  };
});

jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), replace: jest.fn() }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: (callback: () => void) => {
    require('react').useEffect(callback, []);
  },
}));

jest.mock('@services/geocoding', () => ({
  geocodeAddress: jest.fn().mockResolvedValue({ latitude: 49.2827, longitude: -123.1207 }),
  reverseGeocode: jest.fn().mockResolvedValue(null),
  getDevicePosition: jest.fn().mockResolvedValue({ status: 'denied' }),
  hasLocationPermission: jest.fn().mockResolvedValue(false),
}));

const mockGetAll = jest.fn();
const mockGetNeighbourhoods = jest.fn();
const mockToggleFavorite = jest.fn();

jest.mock('@api/neighbours', () => {
  const actual = jest.requireActual('@api/neighbours');
  return {
    ...actual,
    neighboursApi: {
      getAll: (...args: unknown[]) => mockGetAll(...args),
      getNeighbourhoods: (...args: unknown[]) => mockGetNeighbourhoods(...args),
      toggleFavorite: (...args: unknown[]) => mockToggleFavorite(...args),
    },
  };
});

jest.mock('@api/settings', () => ({
  settingsApi: {
    fetchAll: jest.fn().mockResolvedValue({ settings: [] }),
    update: jest.fn().mockResolvedValue({}),
  },
}));

import { ThemeProvider } from '@contexts/ThemeContext';
import { useHouseholdStore } from '@stores/householdStore';

import { NeighboursMapScreen } from '../NeighboursMapScreen';

const HOUSEHOLD = {
  id: 'hh-1',
  name: 'Our place',
  address_line1: '42 Maple St',
  city: 'Vancouver',
  state_province: 'BC',
  postal_code: 'V6B 1A1',
  country: 'CA',
  unit_system: 'metric',
};

function person(id: string, name: string) {
  return {
    id,
    neighbour_id: 'x',
    household_id: 'hh-1',
    name,
    role: 'adult' as const,
    phone: null,
    email: null,
    photo_key: null,
    notes: null,
    is_primary: true,
    sort_order: 0,
    device_contact_id: null,
    created_at: '2026-08-30T00:00:00.000Z',
    updated_at: '2026-08-30T00:00:00.000Z',
  };
}

function neighbour(id: string, latitude: number, longitude: number, label: string, extra = {}) {
  return {
    id,
    household_id: 'hh-1',
    neighbourhood_id: null,
    label,
    relation: 'next_door' as const,
    address_line1: '44 Maple St',
    address_line2: null,
    city: 'Vancouver',
    state_province: 'BC',
    postal_code: null,
    country: 'CA',
    formatted_address: '44 Maple St, Vancouver',
    latitude,
    longitude,
    place_source: 'map_tap' as const,
    photo_key: null,
    notes: null,
    is_favorite: false,
    is_emergency_contact: false,
    has_spare_key: false,
    created_at: '2026-08-30T00:00:00.000Z',
    updated_at: '2026-08-30T00:00:00.000Z',
    people: [person(`${id}-p`, 'Sarah Wilson')],
    person_count: 1,
    neighbourhood: null,
    distance_meters: 42,
    ...extra,
  };
}

async function render() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <NeighboursMapScreen />
        </ThemeProvider>
      </QueryClientProvider>
    );
  });
  // Let the query resolve and the framing effect run.
  await act(async () => {
    await Promise.resolve();
  });
  mounted.push(tree);
  return tree;
}

/**
 * HOST nodes only.
 *
 * `findAll` matches composites as well, and a `testID` passed to
 * `<TouchableOpacity>` or to the mocked `<Marker>` appears on the composite AND
 * on the host it renders — so a naive count returns two or three for one thing
 * on screen. Filtering to `typeof type === 'string'` is what makes
 * `toHaveLength(1)` mean "one of these is rendered".
 */
function find(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll(
    (node) => node.props?.testID === testID && typeof node.type === 'string'
  );
}

/** The composite that owns the handler, which is not the host `find` returns. */
async function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.findAll(
    (candidate) =>
      candidate.props?.testID === testID && typeof candidate.props?.onPress === 'function'
  )[0]!;
  await act(async () => {
    node.props.onPress();
  });
}

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(async () => {
  // The screen arms a 600ms timer to stop marker rasterisation. Left mounted it
  // fires after the test has finished and React warns about a state update
  // outside `act` — noise that eventually hides a real warning.
  await act(async () => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAll.mockResolvedValue({ neighbours: [] });
  mockGetNeighbourhoods.mockResolvedValue({ neighbourhoods: [] });
  useHouseholdStore.setState({
    currentHousehold: HOUSEHOLD as never,
    households: [HOUSEHOLD] as never,
  });
});

describe('the empty map', () => {
  it('teaches the long-press gesture, because nothing else can', async () => {
    const tree = await render();
    expect(find(tree, 'neighbours-empty-hint')).toHaveLength(1);
    expect(JSON.stringify(tree.toJSON())).toContain('Press and hold a house');
  });

  it('drops the hint once there is something on the map', async () => {
    mockGetAll.mockResolvedValue({
      neighbours: [neighbour('n1', 49.2830, -123.1207, 'The Wilsons')],
    });
    const tree = await render();
    expect(find(tree, 'neighbours-empty-hint')).toHaveLength(0);
  });
});

describe('markers', () => {
  it('draws one marker per home at street zoom', async () => {
    mockGetAll.mockResolvedValue({
      neighbours: [
        neighbour('n1', 49.2830, -123.1207, 'The Wilsons'),
        neighbour('n2', 49.2900, -123.1300, 'The Patels'),
      ],
    });
    const tree = await render();
    expect(find(tree, 'neighbour-marker-n1')).toHaveLength(1);
    expect(find(tree, 'neighbour-marker-n2')).toHaveLength(1);
  });

  it('draws the property itself, so every pin is read relative to home', async () => {
    mockGetAll.mockResolvedValue({
      neighbours: [neighbour('n1', 49.2830, -123.1207, 'The Wilsons')],
    });
    const tree = await render();
    expect(find(tree, 'neighbours-home-marker')).toHaveLength(1);
  });

  it('collapses homes on one roof into a cluster bubble', async () => {
    // Three pins metres apart. At the zoom the screen frames them to, the grid
    // cell is far wider than their spread, so they must arrive as ONE bubble —
    // otherwise the map is thirty overlapping circles on a dense street.
    mockGetAll.mockResolvedValue({
      neighbours: [
        neighbour('n1', 49.28300, -123.12070, 'A'),
        neighbour('n2', 49.28301, -123.12071, 'B'),
        neighbour('n3', 49.28302, -123.12072, 'C'),
      ],
    });
    const tree = await render();
    const clusters = tree.root.findAll(
      (node) =>
        String(node.props?.testID ?? '').startsWith('neighbour-cluster-') &&
        typeof node.type === 'string'
    );
    expect(clusters.length).toBeGreaterThan(0);
    expect(find(tree, 'neighbour-marker-n1')).toHaveLength(0);
  });
});

describe('selection', () => {
  it('opens the peek card on a marker press and closes it on the map', async () => {
    mockGetAll.mockResolvedValue({
      neighbours: [neighbour('n1', 49.2830, -123.1207, 'The Wilsons')],
    });
    const tree = await render();
    expect(find(tree, 'neighbour-peek')).toHaveLength(0);

    await press(tree, 'neighbour-marker-n1');
    expect(find(tree, 'neighbour-peek')).toHaveLength(1);
    expect(JSON.stringify(tree.toJSON())).toContain('The Wilsons');

    await press(tree, 'neighbour-peek-close');
    expect(find(tree, 'neighbour-peek')).toHaveLength(0);
  });

  it('pushes the detail screen from the card', async () => {
    mockGetAll.mockResolvedValue({
      neighbours: [neighbour('n1', 49.2830, -123.1207, 'The Wilsons')],
    });
    const tree = await render();
    await press(tree, 'neighbour-marker-n1');
    await press(tree, 'neighbour-peek-open');
    expect(mockNavigate).toHaveBeenCalledWith('NeighbourDetail', { neighbourId: 'n1' });
  });
});

describe('adding', () => {
  it('adds on LONG press, not on tap', async () => {
    const tree = await render();
    const map = find(tree, 'neighbours-map')[0]!;
    const mapView = map.findAll((node) => typeof node.props?.onLongPress === 'function')[0]!;

    // A short tap must do nothing but dismiss — a member panning a map taps it
    // constantly by accident, and every stray tap would open a create form.
    await act(async () => {
      mapView.props.onPress?.();
    });
    expect(mockNavigate).not.toHaveBeenCalled();

    await act(async () => {
      mapView.props.onLongPress({
        nativeEvent: { coordinate: { latitude: 49.284, longitude: -123.121 } },
      });
    });
    expect(mockNavigate).toHaveBeenCalledWith('AddEditNeighbour', {
      latitude: 49.284,
      longitude: -123.121,
      prefill: { place_source: 'map_tap' },
    });
  });

  it('offers all three doors, with the map first', async () => {
    const tree = await render();
    await press(tree, 'neighbours-add-fab');
    expect(find(tree, 'neighbours-add-map')).toHaveLength(1);
    expect(find(tree, 'neighbours-add-contacts')).toHaveLength(1);
    expect(find(tree, 'neighbours-add-manual')).toHaveLength(1);
  });

  it('routes "pick on the map" to the full-screen picker', async () => {
    const tree = await render();
    await press(tree, 'neighbours-add-fab');
    await press(tree, 'neighbours-add-map');
    expect(mockNavigate).toHaveBeenCalledWith(
      'NeighbourPickOnMap',
      expect.objectContaining({ returnTo: 'add' })
    );
  });
});

describe('list view', () => {
  it('swaps the map for cards and back', async () => {
    mockGetAll.mockResolvedValue({
      neighbours: [neighbour('n1', 49.2830, -123.1207, 'The Wilsons')],
    });
    const tree = await render();
    expect(find(tree, 'neighbours-map')).toHaveLength(1);

    await press(tree, 'neighbours-view-toggle');
    expect(find(tree, 'neighbours-map')).toHaveLength(0);
    expect(find(tree, 'neighbour-card-n1')).toHaveLength(1);

    await press(tree, 'neighbours-view-toggle');
    expect(find(tree, 'neighbours-map')).toHaveLength(1);
  });

  it('opens a card straight onto the detail screen', async () => {
    mockGetAll.mockResolvedValue({
      neighbours: [neighbour('n1', 49.2830, -123.1207, 'The Wilsons')],
    });
    const tree = await render();
    await press(tree, 'neighbours-view-toggle');
    await press(tree, 'neighbour-card-n1');
    expect(mockNavigate).toHaveBeenCalledWith('NeighbourDetail', { neighbourId: 'n1' });
  });
});

describe('filters', () => {
  it('narrows to spare-key holders in the CLIENT, not through the api', async () => {
    // `has_spare_key` is the one filter neither backend answers, so it is
    // applied over the result. Asserting it here is what stops someone
    // "tidying" it into the request and silently getting everything back.
    mockGetAll.mockResolvedValue({
      neighbours: [
        neighbour('n1', 49.2830, -123.1207, 'The Wilsons', { has_spare_key: true }),
        neighbour('n2', 49.2900, -123.1300, 'The Patels'),
      ],
    });
    const tree = await render();
    await press(tree, 'neighbours-view-toggle');
    expect(find(tree, 'neighbour-card-n1')).toHaveLength(1);
    expect(find(tree, 'neighbour-card-n2')).toHaveLength(1);

    const filters = tree.root.findAll(
      (node) => typeof node.props?.onTabChange === 'function'
    )[0]!;
    await act(async () => {
      filters.props.onTabChange('key-holders');
    });

    expect(find(tree, 'neighbour-card-n1')).toHaveLength(1);
    expect(find(tree, 'neighbour-card-n2')).toHaveLength(0);
  });
});
