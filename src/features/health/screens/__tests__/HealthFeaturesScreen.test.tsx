/**
 * Symply Health FEATURES switchboard — the admin-only tracker editor
 * (`/health-features`).
 *
 * `platform.featureFlags.test.ts` (`HEALTH-FLAG-001…047`) already owns the
 * catalog, the resolver and the tab/Home filtering. What it never touches is
 * this SCREEN: before this suite, `HealthFeaturesScreen.tsx` was named by no
 * test in the repo and driven by no Maestro flow, so its own admin gate — the
 * first of the three the file's header describes — was unpinned.
 *
 * That gate is what these cases mostly exist for. The screen's doc comment is
 * explicit that gate 1 is "cosmetic" next to the resolver, and it is right that
 * the resolver is the one that decides what a common user can SEE. But gate 1
 * is the only thing standing between a non-admin and the WRITE side: the
 * toggles here call `setFeature` directly, and `setFeature` accepts a write for
 * any key from anyone. If the redirect regressed, a deep link to
 * `/health-features` would hand a common user a working editor whose writes
 * persist — invisible to them thanks to gate 2, and waiting for the day their
 * role changes.
 *
 * The second invariant worth stating: the OPTIONAL header count is derived from
 * live state, not from the catalog. It is the only number on the screen that
 * tells an admin how far they are from a default install.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { HEALTH_FEATURES } from '@config/healthFeatures';
import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthFeaturesScreen } from '../HealthFeaturesScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

// The global setup stubs `Redirect` as `() => null`, which renders identically
// to "the screen chose to draw nothing". This suite has to tell the two apart,
// so it renders a marker instead.
jest.mock('expo-router', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) =>
      ReactMock.createElement(View, { testID: 'redirect', accessibilityLabel: href }),
    useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
  };
});

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title, onBackPress }: { title?: string; onBackPress?: () => void }) =>
      ReactMock.createElement(View, {
        testID: 'screen-header',
        accessibilityLabel: title,
        onPress: onBackPress,
      }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

const mockBack = jest.fn();
const mockSetFeature = jest.fn();
const mockResetAll = jest.fn();

let mockIsAdmin = true;
let mockBrandIsHealth = true;
let mockFeatures: Record<string, boolean> = {};

jest.mock('@hooks/useIsAdmin', () => ({ useIsAdmin: () => mockIsAdmin }));
jest.mock('@hooks/useHealthFeature', () => ({ useHealthFeatures: () => mockFeatures }));
jest.mock('@hooks/useLayoutPadding', () => ({ useLayoutPadding: () => ({ content: 16 }) }));
jest.mock('../../brandGuard', () => ({
  ...jest.requireActual('../../brandGuard'),
  isHealthBrand: () => mockBrandIsHealth,
}));

jest.mock('@stores/healthFeatureStore', () => ({
  useHealthFeatureStore: (selector: (state: unknown) => unknown) =>
    selector({ setFeature: mockSetFeature, resetAll: mockResetAll }),
}));

const CORE = HEALTH_FEATURES.filter((f) => f.enabledByDefault);
const OPTIONAL = HEALTH_FEATURES.filter((f) => !f.enabledByDefault);

/** Feature map matching the catalog defaults. */
function defaultFeatures(): Record<string, boolean> {
  return Object.fromEntries(HEALTH_FEATURES.map((f) => [f.key, f.enabledByDefault]));
}

type Rendered = ReactTestRenderer.ReactTestRenderer;

async function render(): Promise<Rendered> {
  let tree!: Rendered;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthFeaturesScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

function maybe(tree: Rendered, testID: string) {
  return tree.root.findAll((n) => n.props?.testID === testID)[0];
}

function node(tree: Rendered, testID: string) {
  const found = maybe(tree, testID);
  if (!found) throw new Error(`no element with testID ${testID}`);
  return found;
}

function textOf(tree: Rendered): string {
  return tree.root
    .findAll((n) => typeof n.type === 'string')
    .map((n) => {
      const c = n.props?.children;
      return (Array.isArray(c) ? c : [c])
        .filter((child) => typeof child === 'string' || typeof child === 'number')
        .map(String)
        .join('');
    })
    .filter((text) => text.length > 0)
    .join(' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsAdmin = true;
  mockBrandIsHealth = true;
  mockFeatures = defaultFeatures();
});

/* ------------------------------------------------------------------ */
/* THE ADMIN GATE                                                      */
/* ------------------------------------------------------------------ */

describe('the admin gate', () => {
  it('mounts the editor for an admin on the Health brand', async () => {
    const tree = await render();

    expect(maybe(tree, 'health-features-screen')).toBeDefined();
    expect(maybe(tree, 'redirect')).toBeUndefined();
  });

  it('redirects a common user Home instead of rendering the editor', async () => {
    mockIsAdmin = false;
    const tree = await render();

    expect(node(tree, 'redirect').props.accessibilityLabel).toBe('/');
    expect(maybe(tree, 'health-features-screen')).toBeUndefined();
  });

  it('renders NO toggle for a common user — the write side is unreachable, not just hidden', async () => {
    // `setFeature` accepts a write for any key from anyone, so the absence of
    // the controls is the whole of gate 1.
    mockIsAdmin = false;
    const tree = await render();

    for (const feature of HEALTH_FEATURES) {
      expect(maybe(tree, `health-feature-toggle-${feature.key}`)).toBeUndefined();
    }
    expect(maybe(tree, 'health-features-reset')).toBeUndefined();
  });

  it('redirects on another brand even for an admin', async () => {
    // House/Budget/Kaizen admins are admins of THEIR app; the Health tracker
    // catalog is not theirs to edit.
    mockBrandIsHealth = false;
    const tree = await render();

    expect(node(tree, 'redirect').props.accessibilityLabel).toBe('/');
  });

  it('redirects when BOTH gates fail, rather than throwing', async () => {
    mockIsAdmin = false;
    mockBrandIsHealth = false;
    const tree = await render();

    expect(maybe(tree, 'redirect')).toBeDefined();
  });

  it('tells the admin the screen is admin-only', async () => {
    const tree = await render();
    expect(node(tree, 'health-features-admin-note')).toBeDefined();
    expect(textOf(tree)).toContain('Only admins see this screen');
  });
});

/* ------------------------------------------------------------------ */
/* THE CATALOG, ON SCREEN                                              */
/* ------------------------------------------------------------------ */

describe('the rows', () => {
  it('renders one row per catalog entry — nothing is unreachable from here', async () => {
    const tree = await render();

    for (const feature of HEALTH_FEATURES) {
      expect(maybe(tree, `health-feature-row-${feature.key}`)).toBeDefined();
      expect(maybe(tree, `health-feature-toggle-${feature.key}`)).toBeDefined();
    }
  });

  it('splits the catalog into DEFAULT TRACKERS and OPTIONAL', async () => {
    const tree = await render();
    const text = textOf(tree);

    expect(text).toContain('DEFAULT TRACKERS');
    expect(text).toContain('OPTIONAL');
    // Both halves are non-empty, or the split is meaningless.
    expect(CORE.length).toBeGreaterThan(0);
    expect(OPTIONAL.length).toBeGreaterThan(0);
  });

  it('shows each row’s label and description', async () => {
    const tree = await render();
    const text = textOf(tree);

    for (const feature of HEALTH_FEATURES) {
      expect(text).toContain(feature.label);
      expect(text).toContain(feature.description);
    }
  });

  it('reflects live state on the toggle, not the catalog default', async () => {
    const optional = OPTIONAL[0];
    mockFeatures = { ...defaultFeatures(), [optional.key]: true };
    const tree = await render();

    expect(node(tree, `health-feature-toggle-${optional.key}`).props.value).toBe(true);
  });

  it('labels each toggle with its feature, so the row is addressable by name', async () => {
    const tree = await render();
    const feature = HEALTH_FEATURES[0];

    expect(node(tree, `health-feature-toggle-${feature.key}`).props.accessibilityLabel).toBe(
      feature.label
    );
  });
});

/* ------------------------------------------------------------------ */
/* THE OPTIONAL COUNT                                                  */
/* ------------------------------------------------------------------ */

describe('the optional count', () => {
  it('reads 0 of N on a default install', async () => {
    const tree = await render();

    expect(node(tree, 'health-features-optional-header').props.children).toBe(
      `OPTIONAL — 0 OF ${OPTIONAL.length} ON`
    );
  });

  it('counts only the OPTIONAL features that are on, never the core ones', async () => {
    mockFeatures = { ...defaultFeatures(), [OPTIONAL[0].key]: true, [OPTIONAL[1].key]: true };
    const tree = await render();

    expect(node(tree, 'health-features-optional-header').props.children).toBe(
      `OPTIONAL — 2 OF ${OPTIONAL.length} ON`
    );
  });

  it('is unaffected by a core tracker being switched OFF', async () => {
    mockFeatures = { ...defaultFeatures(), [CORE[0].key]: false };
    const tree = await render();

    expect(node(tree, 'health-features-optional-header').props.children).toBe(
      `OPTIONAL — 0 OF ${OPTIONAL.length} ON`
    );
  });

  it('reaches N of N with every optional tracker on', async () => {
    mockFeatures = Object.fromEntries(HEALTH_FEATURES.map((f) => [f.key, true]));
    const tree = await render();

    expect(node(tree, 'health-features-optional-header').props.children).toBe(
      `OPTIONAL — ${OPTIONAL.length} OF ${OPTIONAL.length} ON`
    );
  });
});

/* ------------------------------------------------------------------ */
/* WRITES                                                              */
/* ------------------------------------------------------------------ */

describe('writes', () => {
  it('switching an optional tracker ON writes that key, and only that key', async () => {
    const optional = OPTIONAL[0];
    const tree = await render();

    await act(async () => {
      node(tree, `health-feature-toggle-${optional.key}`).props.onValueChange(true);
    });

    expect(mockSetFeature).toHaveBeenCalledTimes(1);
    expect(mockSetFeature).toHaveBeenCalledWith(optional.key, true);
  });

  it('switching one OFF writes false rather than deleting the override', async () => {
    const optional = OPTIONAL[0];
    mockFeatures = { ...defaultFeatures(), [optional.key]: true };
    const tree = await render();

    await act(async () => {
      node(tree, `health-feature-toggle-${optional.key}`).props.onValueChange(false);
    });

    expect(mockSetFeature).toHaveBeenCalledWith(optional.key, false);
  });

  it('a CORE tracker is editable too — the row is not a lie about the store', async () => {
    // The screen's own comment commits to this: an admin who wants a
    // water-only install should get one.
    const core = CORE[0];
    const tree = await render();

    await act(async () => {
      node(tree, `health-feature-toggle-${core.key}`).props.onValueChange(false);
    });

    expect(mockSetFeature).toHaveBeenCalledWith(core.key, false);
  });

  it('every catalog key can be written from its own row', async () => {
    const tree = await render();

    for (const feature of HEALTH_FEATURES) {
      mockSetFeature.mockClear();
      await act(async () => {
        node(tree, `health-feature-toggle-${feature.key}`).props.onValueChange(true);
      });
      expect(mockSetFeature).toHaveBeenCalledWith(feature.key, true);
    }
  });

  it('reset clears every override in one action', async () => {
    const tree = await render();

    await act(async () => node(tree, 'health-features-reset').props.onPress());

    expect(mockResetAll).toHaveBeenCalledTimes(1);
    expect(mockSetFeature).not.toHaveBeenCalled();
  });

  it('says switching a tracker off keeps the logged history', async () => {
    // A destructive-looking switch that isn't destructive still stops people
    // using it, so the copy is load-bearing.
    const tree = await render();
    expect(textOf(tree)).toContain('never deletes anything you have');
  });
});
