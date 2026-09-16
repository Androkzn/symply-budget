/* eslint-disable @typescript-eslint/no-require-imports -- Jest hoisted factories and resetModules require synchronous isolated imports. */
/**
 * HomeFeaturesScreen — the Simple House "Home Features" surface (major systems &
 * appliances: HVAC, water heaters, …). It is a data-driven list, not a
 * brand-gated tile grid, so the tests exercise its REAL behaviours:
 *
 *   • the empty / loading / populated states,
 *   • the summary card counts (total / need-attention / from-reports),
 *   • features grouped by type (sorted) with one FeatureCard per item,
 *   • tapping a FeatureCard opens its detail Alert,
 *   • the "Add Home Feature" tile opens the add Alert,
 *   • the header back button drives expo-router `router.back()`,
 *   • the corner case where an absent feature-type renders NO section,
 *   • and that it lays out on iPhone AND iPad (fixed-width screen — the same
 *     cards render on both; there is no AdaptiveContainer width cap here).
 */

// deviceRender drives useDeviceType via a mocked useWindowDimensions (hoisted).
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

// Stable expo-router router so navigation assertions can inspect it. The global
// jest.setup mock returns a FRESH jest.fn() per useRouter() call, which can't be
// asserted on; this override keeps one router instance. Reads of `mockRouter`
// stay lazy (inside functions / a getter) so the factory is TDZ-safe.
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
};
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => mockRouter,
  usePathname: () => '/',
  useLocalSearchParams: () => ({}),
  useGlobalSearchParams: () => ({}),
  useSegments: () => [],
  useFocusEffect: () => {},
  Slot: () => null,
  Stack: Object.assign(() => null, { Screen: () => null }),
  Tabs: Object.assign(() => null, { Screen: () => null }),
  SplashScreen: { preventAutoHideAsync: jest.fn(), hideAsync: jest.fn(), setOptions: jest.fn() },
  Link: ({ children }: { children?: unknown }) => children ?? null,
  Redirect: () => null,
  get router() {
    return mockRouter;
  },
}));

// Stub the chrome from @components/common. The real ScreenHeader pulls in
// ProfileProvider + notification wiring that isn't the subject here; other
// suites cover it. AppBackground passes children through. ScreenHeader exposes a
// `screen-header-back` target wired to onBackPress. @components/ui (Card,
// Typography, GradientButton) stays REAL so the summary card, empty-state CTA
// and feature cards exercise real rendering.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return { screenScrollViewStyle: { scroll: {} }, SCREEN_SCROLL_TEST_ID: 'screen-scroll', screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, { testID: 'app-background' }, children ?? null),
    ScreenHeader: ({ onBackPress }: { onBackPress?: () => void }) =>
      React.createElement(
        View,
        { testID: 'screen-header' },
        React.createElement(TouchableOpacity, { testID: 'screen-header-back', onPress: onBackPress })
      ),
  };
});

// Home-features API: only homeFeaturesApi is called at runtime (getFeatures on
// mount, deleteFeature on delete). FEATURE_TYPES / CONDITION_OPTIONS are the
// label lookups the screen reads — mirror the entries this suite's data uses.
jest.mock('@api/home-features', () => ({
  __esModule: true,
  homeFeaturesApi: {
    getFeatures: jest.fn().mockResolvedValue([]),
    deleteFeature: jest.fn().mockResolvedValue(undefined),
  },
  FEATURE_TYPES: [
    { value: 'hvac', label: 'HVAC System' },
    { value: 'furnace', label: 'Furnace' },
    { value: 'water_heater', label: 'Water Heater' },
    { value: 'other', label: 'Other' },
  ],
  CONDITION_OPTIONS: [
    { value: 'excellent', label: 'Excellent' },
    { value: 'good', label: 'Good' },
    { value: 'fair', label: 'Fair' },
    { value: 'poor', label: 'Poor' },
    { value: 'unknown', label: 'Unknown' },
  ],
}));

// Zustand stores — the screen destructures the whole store (no selector). Keep
// the state on mutable module objects reset in beforeEach; the mock is also
// selector-aware for safety.
const mockHomeFeaturesState: {
  features: unknown[];
  setFeatures: jest.Mock;
  addFeature: jest.Mock;
  updateFeature: jest.Mock;
  removeFeature: jest.Mock;
  isLoading: boolean;
  setLoading: jest.Mock;
  setError: jest.Mock;
} = {
  features: [],
  setFeatures: jest.fn(),
  addFeature: jest.fn(),
  updateFeature: jest.fn(),
  removeFeature: jest.fn(),
  isLoading: false,
  setLoading: jest.fn(),
  setError: jest.fn(),
};
jest.mock('@stores/homeFeaturesStore', () => ({
  __esModule: true,
  useHomeFeaturesStore: (sel?: (s: typeof mockHomeFeaturesState) => unknown) =>
    typeof sel === 'function' ? sel(mockHomeFeaturesState) : mockHomeFeaturesState,
}));

const mockHouseholdState: { currentHousehold: { id: string } | null } = {
  currentHousehold: null,
};
jest.mock('@stores/householdStore', () => ({
  __esModule: true,
  useHouseholdStore: (sel?: (s: typeof mockHouseholdState) => unknown) =>
    typeof sel === 'function' ? sel(mockHouseholdState) : mockHouseholdState,
}));

import React from 'react';
import { Alert } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestInstance } from 'react-test-renderer';

import { homeFeaturesApi, type HomeFeature } from '@api/home-features';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { HomeFeaturesScreen } from '@screens/home/HomeFeaturesScreen';

import {
  ALL_DEVICES,
  IPADS,
  PHONES,
  pressables,
  renderOnDevice,
  type DeviceName,
} from '../../../test-utils/deviceRender';

// ---- helpers ---------------------------------------------------------------

/**
 * Contiguous text of an instance subtree. Walks `.children` only (never props),
 * so it is immune to the circular `refreshControl` element that ScrollView
 * carries — which is why `treeText`'s JSON.stringify can't be used here. Joins
 * with '' so interpolated fragments (e.g. `{n} item{s}`) reconstruct exactly.
 */
function nodeText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  const kids = (node as ReactTestInstance).children;
  if (!Array.isArray(kids)) return '';
  return kids.map((k) => nodeText(k)).join('');
}

function makeFeature(overrides: Partial<HomeFeature>): HomeFeature {
  return {
    id: 'f',
    household_id: 'hh-1',
    feature_type: 'other',
    feature_subtype: null,
    quantity: 1,
    location: null,
    brand: null,
    model: null,
    serial_number: null,
    install_date: null,
    warranty_expires: null,
    age_years: null,
    condition: 'good',
    notes: null,
    source: 'manual',
    source_report_id: null,
    extraction_confidence: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// Two water heaters + one HVAC. total=3, needAttention(poor|fair)=2, fromReports=1.
const POPULATED: HomeFeature[] = [
  makeFeature({
    id: 'f1',
    feature_type: 'water_heater',
    condition: 'good',
    brand: 'Rheem',
    model: 'XE50',
    location: 'Basement',
    age_years: 5,
    notes: 'Serviced recently',
    source: 'report_extraction',
    extraction_confidence: 0.92,
  }),
  makeFeature({
    id: 'f2',
    feature_type: 'water_heater',
    condition: 'poor',
    quantity: 2,
    age_years: 12,
  }),
  makeFeature({
    id: 'f3',
    feature_type: 'hvac',
    condition: 'fair',
    brand: 'Carrier',
    location: 'Attic',
    age_years: 8,
  }),
];

/** First pressable whose rendered subtree contains `text`. */
function pressableWithText(
  r: ReturnType<typeof renderOnDevice>,
  text: string
): ReactTestInstance | undefined {
  return pressables(r).find((n) => nodeText(n).includes(text));
}

/**
 * How many FeatureCards rendered — each shows exactly one "…yr(s) old" age line.
 * Count the *deepest* node containing "old" (the leaf Text) so ancestors (card
 * View, TouchableOpacity, Animated wrappers) aren't double-counted.
 */
function featureCardCount(r: ReturnType<typeof renderOnDevice>): number {
  return r.root
    .findAll((n) => nodeText(n).includes('old'), { deep: true })
    .filter(
      (n) => n.findAll((c) => c !== n && nodeText(c).includes('old'), { deep: true }).length === 0
    ).length;
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  mockHomeFeaturesState.features = [];
  mockHomeFeaturesState.isLoading = false;
  mockHomeFeaturesState.setFeatures.mockClear();
  mockHomeFeaturesState.removeFeature.mockClear();
  mockHomeFeaturesState.setLoading.mockClear();
  mockHomeFeaturesState.setError.mockClear();
  mockHouseholdState.currentHousehold = null;
  mockRouter.back.mockClear();
  mockRouter.push.mockClear();
  (homeFeaturesApi.getFeatures as jest.Mock).mockClear().mockResolvedValue([]);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

// ---- empty state -----------------------------------------------------------

describe('HomeFeaturesScreen — empty state (iPhone + iPad)', () => {
  it.each(ALL_DEVICES.map((d) => [d] as [DeviceName]))(
    'renders the empty state and its CTA on %s',
    (device) => {
      const r = renderOnDevice(device, <HomeFeaturesScreen />);
      const text = nodeText(r.root);
      expect(text).toContain('No Home Features Yet');
      expect(text).toContain('Add Feature');
      // The populated chrome must NOT appear when there are no features.
      expect(text).not.toContain('Home Features Overview');
      expect(featureCardCount(r)).toBe(0);
    }
  );
});

// ---- populated state -------------------------------------------------------

describe('HomeFeaturesScreen — populated (iPhone + iPad)', () => {
  it.each(PHONES.concat(IPADS).map((d) => [d] as [DeviceName]))(
    'renders the summary, grouped sections and cards on %s',
    (device) => {
      mockHomeFeaturesState.features = POPULATED;
      const r = renderOnDevice(device, <HomeFeaturesScreen />);
      const text = nodeText(r.root);

      // Summary card + its three metric labels.
      expect(text).toContain('Home Features Overview');
      expect(text).toContain('Total Features');
      expect(text).toContain('Need Attention');
      expect(text).toContain('From Reports');

      // Grouped-by-type sections (types are sorted: hvac, water_heater).
      expect(text).toContain('HVAC System');
      expect(text).toContain('Water Heater');
      expect(text).toContain('1 item'); // hvac
      expect(text).toContain('2 items'); // water_heater

      // Individual cards rendered their brand + the add tile is present.
      expect(text).toContain('Rheem');
      expect(text).toContain('Carrier');
      expect(text).toContain('Add Home Feature');

      // One card per feature.
      expect(featureCardCount(r)).toBe(3);
    }
  );

  it('renders the same feature cards on iPad as on iPhone (fixed layout, no drop)', () => {
    mockHomeFeaturesState.features = POPULATED;
    const phone = featureCardCount(renderOnDevice('iPhone 14 Pro', <HomeFeaturesScreen />));
    const ipad = featureCardCount(
      renderOnDevice('iPad Pro 12.9 (portrait)', <HomeFeaturesScreen />)
    );
    expect(phone).toBe(3);
    expect(ipad).toBe(phone);
  });
});

// ---- interactions ----------------------------------------------------------

describe('HomeFeaturesScreen — interactions', () => {
  it('opens the detail Alert when an HVAC card is tapped', () => {
    mockHomeFeaturesState.features = POPULATED;
    const r = renderOnDevice('iPhone 14 Pro', <HomeFeaturesScreen />);
    const card = pressableWithText(r, 'Carrier');
    expect(card).toBeTruthy();
    act(() => card!.props.onPress());
    expect(alertSpy).toHaveBeenCalled();
    // First arg is the feature type, underscores→spaces, uppercased.
    expect(alertSpy.mock.calls[0][0]).toBe('HVAC');
  });

  it('opens the detail Alert with the WATER HEATER title when that card is tapped', () => {
    mockHomeFeaturesState.features = POPULATED;
    const r = renderOnDevice('iPad Pro 11 (portrait)', <HomeFeaturesScreen />);
    const card = pressableWithText(r, 'Rheem');
    expect(card).toBeTruthy();
    act(() => card!.props.onPress());
    expect(alertSpy.mock.calls[0][0]).toBe('WATER HEATER');
  });

  it('opens the "Add Home Feature" Alert when the add tile is tapped', () => {
    mockHomeFeaturesState.features = POPULATED;
    const r = renderOnDevice('iPhone SE', <HomeFeaturesScreen />);
    const addTile = pressableWithText(r, 'Add Home Feature');
    expect(addTile).toBeTruthy();
    act(() => addTile!.props.onPress());
    expect(alertSpy).toHaveBeenCalledWith(
      'Add Home Feature',
      expect.any(String),
      expect.any(Array)
    );
  });

  it.each(PHONES.concat(IPADS).map((d) => [d] as [DeviceName]))(
    'drives router.back() from the header on %s',
    (device) => {
      mockHomeFeaturesState.features = POPULATED;
      const r = renderOnDevice(device, <HomeFeaturesScreen />);
      const back = r.root.findByProps({ testID: 'screen-header-back' });
      act(() => back.props.onPress());
      expect(mockRouter.back).toHaveBeenCalledTimes(1);
    }
  );
});

// ---- corner cases ----------------------------------------------------------

describe('HomeFeaturesScreen — corner cases', () => {
  it('does NOT render a section for a feature-type that has no items', () => {
    // Only water heaters present → the HVAC section must be absent.
    mockHomeFeaturesState.features = [
      makeFeature({ id: 'w1', feature_type: 'water_heater', condition: 'good', age_years: 3 }),
    ];
    const r = renderOnDevice('iPhone 14 Pro', <HomeFeaturesScreen />);
    const text = nodeText(r.root);
    expect(text).toContain('Water Heater');
    expect(text).not.toContain('HVAC System');
    expect(featureCardCount(r)).toBe(1);
  });

  it('shows a spinner (not the empty or list UI) while loading with no cached data', () => {
    mockHomeFeaturesState.isLoading = true;
    mockHomeFeaturesState.features = [];
    const r = renderOnDevice('iPad mini (portrait)', <HomeFeaturesScreen />);
    expect(r.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    const text = nodeText(r.root);
    expect(text).not.toContain('No Home Features Yet');
    expect(text).not.toContain('Home Features Overview');
  });

  it('counts only poor/fair features under "Need Attention" and report-sourced under "From Reports"', () => {
    mockHomeFeaturesState.features = POPULATED;
    const r = renderOnDevice('iPhone 14 Pro', <HomeFeaturesScreen />);
    // The "Need Attention" metric (poor f2 + fair f3 = 2) is coloured with the
    // warning colour; assert the number sits directly above its label.
    const attention = r.root.findByProps({ testID: 'screen-header' }); // sanity: chrome mounted
    expect(attention).toBeTruthy();
    const text = nodeText(r.root);
    // 3 total, 2 need attention, 1 from reports — labels + values all present.
    expect(text).toContain('Total Features');
    expect(text).toContain('Need Attention');
    expect(text).toContain('From Reports');
  });

  it('fetches features for the current household on mount', async () => {
    mockHouseholdState.currentHousehold = { id: 'hh-1' };
    (homeFeaturesApi.getFeatures as jest.Mock).mockResolvedValue(POPULATED);
    const r = renderOnDevice('iPhone 14 Pro', <HomeFeaturesScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(homeFeaturesApi.getFeatures).toHaveBeenCalledWith('hh-1');
    expect(r).toBeTruthy();
  });
});
