/**
 * Symply Health — the "More" hub, driven by the REAL Health tab pool.
 *
 * `TabOverflowSection` is the only way into a Health tab that is not pinned to
 * the bar, so a row that goes missing (or routes to the wrong screen) silently
 * deletes a whole feature from the app.
 * `e2e/maestro/health/more-overflow-all-tabs.yaml` proves this on a device;
 * that flow needs a booted simulator, a session and ~90 s, which is why it had
 * no unit-speed counterpart.
 *
 * The existing component suite (src/components/navigation/__tests__/
 * TabOverflowSection.test.tsx) mocks `useEffectiveTabs` and feeds it Kaizen
 * rows, so nothing anywhere asserted that HEALTH's pool reaches the hub. Here
 * `useEffectiveTabs` is REAL: brand pack → `buildTabConfig` →
 * `filterTabsByHealthFeatures` → `resolveEffectiveTabs` → rendered rows runs end
 * to end, and only the two user-owned inputs are injected — the saved tab
 * overrides and the resolved Health feature map.
 *
 * Two postures are covered, because Health now ships per-install feature
 * toggles (src/config/healthFeatures.ts): the DEFAULT install (four core
 * trackers on, everything else off — what the shared E2E account sees) and
 * EVERYTHING ON (an admin who switched the lot on). The toggle store and its
 * admin gate belong to their own suite; this file owns the hub's half of the
 * contract.
 *
 * Shared platform source (TabOverflowSection.tsx) is NOT modified.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { TabOverflowSection } from '@components/navigation/TabOverflowSection';
import { HEALTH_FEATURE_DEFAULTS, HEALTH_FEATURE_KEYS } from '@config/healthFeatures';
import { ThemeProvider } from '@contexts/ThemeContext';

const healthBrand = require('../../../../../brands/symply-health/brand.cjs');

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

// Swap ONLY the tab pool; a Proxy rather than a spread because @brand ⇄
// capabilities is a circular import (see platform.tabCustomization.test.tsx).
jest.mock('@brand', () => {
  const pack = require('../../../../../brands/symply-health/brand.cjs');
  const actual = jest.requireActual('@brand');
  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'brand') return pack;
      if (prop === 'brandId') return pack.id;
      return Reflect.get(target, prop);
    },
  });
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('@hooks/useFeature', () => ({
  useFeature: () => false,
}));

// The resolved feature map is an input, not a thing under test here — the
// resolver + admin gate are covered by the feature-toggle suite.
let mockFeatures: Record<string, boolean> = {};
jest.mock('@hooks/useHealthFeature', () => ({
  useHealthFeature: (key: string) => mockFeatures[key] !== false,
  useHealthFeatures: () => mockFeatures,
  isHealthFeatureEnabled: (key: string) => mockFeatures[key] !== false,
}));

// BrandSymbol pulls the native icon fonts + the generated per-brand PNG map;
// this suite asserts rows and routing, not glyphs — but it does check that the
// row was handed THIS brand's kit name.
jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    BrandSymbol: ({ brandIcon, ionicon }: { brandIcon?: string; ionicon?: string }) =>
      ReactMock.createElement(View, {
        testID: 'brand-symbol',
        accessibilityLabel: brandIcon ?? ionicon,
      }),
  };
});

// The user's saved customization — the other injected input.
let mockOverrides: Array<{ route: string; order: number; visible: boolean }> | null = null;
jest.mock('@stores/tabCustomizationStore', () => ({
  useTabCustomizationStore: (selector: (s: unknown) => unknown) =>
    selector({ overrides: mockOverrides, isHydrated: true, lastModified: null }),
}));

type Tree = ReactTestRenderer.ReactTestRenderer;
type PoolEntry = { route: string; label: string; brandIcon?: string; defaultHidden?: boolean };

const POOL: PoolEntry[] = healthBrand.tabs;
/** Every `defaultHidden` entry, in brand-pack order — the hub with everything on. */
const ALL_HIDDEN: PoolEntry[] = POOL.filter((t) => t.defaultHidden);
/** The hub a brand-new install actually shows: enabled features only. */
const DEFAULT_HUB = [
  'health-water',
  'health-food',
  'health-recipes',
  'health-goals',
];

const ALL_ON: Record<string, boolean> = Object.fromEntries(
  HEALTH_FEATURE_KEYS.map((k) => [k, true]),
);

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

async function renderHub(): Promise<Tree> {
  let tree!: Tree;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <TabOverflowSection />
      </ThemeProvider>,
    );
  });
  return tree;
}

/** Hub rows in render order (deduped: RN's View composite repeats the testID). */
function hubRows(tree: Tree): string[] {
  const seen = tree.root
    .findAll(
      (n) => typeof n.props?.testID === 'string' && n.props.testID.startsWith('more-tab-'),
    )
    .map((n) => String(n.props.testID).replace('more-tab-', ''));
  return [...new Set(seen)];
}

function tapRow(tree: Tree, testID: string): void {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function',
  );
  act(() => node.props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOverrides = null;
  mockFeatures = { ...HEALTH_FEATURE_DEFAULTS };
});

describe('Health More hub — a default install (HEALTH-MORE-068..070)', () => {
  it('HEALTH-MORE-068: lists exactly the enabled sections that are not pinned', async () => {
    const tree = await renderHub();

    // Water / Foods / Recipes are enabled but `defaultHidden`; Goals belongs to
    // no feature, so it is always here. Weight is pinned by default (not
    // `defaultHidden`), so it is NOT in the hub. The Workout library is its own
    // opt-in feature now and starts off, so it is not here either.
    expect(hubRows(tree)).toEqual(DEFAULT_HUB);
    expect(allText(tree.toJSON())).toContain('MORE TABS');
  });

  it('HEALTH-MORE-069: a disabled feature is absent from the hub, not merely from the bar', async () => {
    const tree = await renderHub();
    const rows = hubRows(tree);

    // These all have a `defaultHidden` pool entry AND a shipped screen, so the
    // only thing keeping them out of the hub is the feature gate. Hiding one
    // from the bar alone would leave it one tap away in More, which is not
    // "off" — this is the assertion that would fail if the filter were dropped
    // from `useEffectiveTabs`.
    for (const route of [
      'health-body',
      'health-habits',
      'health-cycle',
      'health-vitality',
      'health-fridge',
      'health-exercises',
      'health-injuries',
      'health-coach',
      'health-scan',
      'health-files',
    ]) {
      expect(rows).not.toContain(route);
    }
    const text = allText(tree.toJSON());
    for (const label of ['Cycle', 'Vitality', 'Workouts', 'Injuries', 'Coach', 'Scan', 'Files']) {
      expect(text).not.toContain(label);
    }
  });

  it('HEALTH-MORE-070: always offers Customize Tabs, whatever is switched on', async () => {
    mockFeatures = Object.fromEntries(HEALTH_FEATURE_KEYS.map((k) => [k, false]));
    const tree = await renderHub();

    // Only the ungated Goals tab is left, so this is close to an empty hub —
    // the editor entry must survive it, or a member who switched everything off
    // could never switch anything back into the bar.
    expect(allText(tree.toJSON())).toContain('Customize Tabs');
    tapRow(tree, 'more-customize-tabs');
    expect(mockPush).toHaveBeenCalledWith('/customize-tabs');
  });
});

describe('Health More hub — everything switched on (HEALTH-MORE-071..072)', () => {
  beforeEach(() => {
    mockFeatures = ALL_ON;
  });

  it('HEALTH-MORE-071: lists every defaultHidden Health tab, in brand-pack order', async () => {
    const tree = await renderHub();

    expect(hubRows(tree)).toEqual(ALL_HIDDEN.map((t) => t.route));
    // Rows are asserted by BOTH id and label: an id-only check passes on a
    // relabelled row, a label-only check passes on a row wired to a dead route.
    const text = allText(tree.toJSON());
    for (const tab of ALL_HIDDEN) {
      expect(text).toContain(tab.label);
    }
    // …and each row carries this brand's kit glyph, not a generic default.
    const symbols = tree.root
      .findAll((n) => typeof n.type === 'string' && n.props?.testID === 'brand-symbol')
      .map((n) => n.props.accessibilityLabel);
    for (const tab of ALL_HIDDEN) {
      expect(symbols).toContain(tab.brandIcon);
    }
  });

  it('HEALTH-MORE-072: the pinned tabs are not duplicated, and every pool route is reachable', async () => {
    const tree = await renderHub();
    const rows = hubRows(tree);

    // Health's donor-parity bar; each of these is reachable from the tab bar, so
    // repeating it here would be a second, divergent entry point.
    const pinned = ['health-weight', 'health-nutrition', 'health-activity', 'index', 'settings'];
    for (const route of pinned) {
      expect(rows).not.toContain(route);
    }
    // Every pool route is in exactly one place: the bar or the hub.
    expect([...rows, ...pinned].sort()).toEqual(POOL.map((t) => t.route).sort());
  });

  it('HEALTH-MORE-073: every hub row opens its own /health-* route', async () => {
    const tree = await renderHub();

    for (const tab of ALL_HIDDEN) {
      mockPush.mockClear();
      tapRow(tree, `more-tab-${tab.route}`);
      // `index` is the one route the hub rewrites to "/"; Health never parks
      // Home in the hub by default, so every row here is a plain /<route>.
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(tab.route === 'index' ? '/' : `/${tab.route}`);
    }
  });
});

describe('Health More hub — reacts to the saved customization (HEALTH-MORE-074..075)', () => {
  beforeEach(() => {
    mockFeatures = ALL_ON;
  });

  it('HEALTH-MORE-074: pinning Habits removes it from the hub and demotes Activity into it', async () => {
    // The exact override the editor writes when a member swaps Activity for
    // Habits (see platform.tabCustomization.test.tsx, HEALTH-TAB-038).
    mockOverrides = [
      { route: 'index', order: 0, visible: true },
      { route: 'health-weight', order: 1, visible: true },
      { route: 'health-nutrition', order: 2, visible: true },
      { route: 'health-habits', order: 3, visible: true },
      { route: 'settings', order: 4, visible: true },
      { route: 'health-activity', order: 5, visible: false },
    ];
    const tree = await renderHub();
    const rows = hubRows(tree);

    expect(rows).not.toContain('health-habits');
    expect(rows).toContain('health-activity');
    // Nothing else moved: the hub is still the complement of the bar.
    expect(rows).toHaveLength(ALL_HIDDEN.length);

    // And the demoted tab still routes — a demoted section must not become dead.
    tapRow(tree, 'more-tab-health-activity');
    expect(mockPush).toHaveBeenCalledWith('/health-activity');
  });

  it('HEALTH-MORE-075: an override from another brand cannot inject a foreign row', async () => {
    // A member who used Budget on the same account can carry `navigation.customTabs`
    // across through the settings-sync KV. Health must ignore every route that is
    // not in its own pool.
    mockOverrides = [
      { route: 'budget', order: 0, visible: true },
      { route: 'mortgage', order: 1, visible: false },
      { route: 'my-home', order: 2, visible: false },
    ];
    const tree = await renderHub();
    const rows = hubRows(tree);

    for (const foreign of ['budget', 'mortgage', 'my-home', 'tasks', 'kaizen-career']) {
      expect(rows).not.toContain(foreign);
    }
    // The hub still shows Health's own hidden tabs — the foreign override is
    // ignored, not treated as "the user hid everything".
    expect(rows).toEqual(ALL_HIDDEN.map((t) => t.route));

    const text = allText(tree.toJSON());
    for (const label of ['Budget', 'Mortgage', 'My Home', 'Contractors', 'Mira', 'Symply House']) {
      expect(text).not.toContain(label);
    }
  });
});
