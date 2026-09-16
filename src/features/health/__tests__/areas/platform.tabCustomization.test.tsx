/**
 * Symply Health — the tab-pool CONTRACT, driven through the real editor.
 *
 * Health opts into the customizable-tabs model (`customizableTabs: true`,
 * `maxVisibleTabs: 5` in brands/symply-health/brand.cjs) — donor parity with the
 * Swift app's tab-customization screen. `src/navigation/__tests__/
 * healthTabShell.test.ts` pins the POOL and the pure resolver; nothing pinned the
 * SCREEN a Health member actually uses to change the bar, so every rule the
 * editor enforces (the 5-slot cap, the locked Home/More slots, the dirty gate,
 * the exact override payload Save persists) was unexecuted.
 *
 * `@brand` is partially mocked so `brand.tabs` / `maxVisibleTabs` are Health's
 * while everything else (theme tokens, capabilities) stays the House-baselined
 * default the rest of the mobile suite runs on — this file asserts navigation
 * structure, never colours. Same isolation reason as healthTabShell.test.ts:
 * flipping APP_BRAND would swap the generated icon/token files too.
 *
 * The screen itself (src/screens/settings/TabCustomizationScreen.tsx) is shared
 * platform code and is NOT modified here.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { buildTabConfig } from '@navigation/tabRegistry';
import { resolveEffectiveTabs } from '@navigation/useEffectiveTabs';
import { TabCustomizationScreen } from '@screens/settings/TabCustomizationScreen';

const healthBrand = require('../../../../../brands/symply-health/brand.cjs');

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

// Only the tab pool is swapped. Everything else resolves to the real module so
// the screen's theme/capability lookups behave exactly as they ship.
//
// A Proxy, NOT a spread: `src/brand/index.ts` ⇄ `src/brand/capabilities.ts` is a
// circular import, and spreading the namespace eagerly fires the re-export
// getters mid-cycle ("Cannot read properties of undefined"). The Proxy defers
// every read to the moment the app itself would make it.
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
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  NotificationFeedbackType: { Warning: 'warning', Success: 'success' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

const mockShowToast = jest.fn();
jest.mock('@services/toastManager', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

// The store is a seam: this suite owns what the EDITOR does, and
// platform.tabPersistence.test.ts owns what the store does with it.
let mockOverrides: Array<{ route: string; order: number; visible: boolean }> | null = null;
const mockSetOverrides = jest.fn();
const mockResetToDefaults = jest.fn();
jest.mock('@stores/tabCustomizationStore', () => ({
  useTabCustomizationStore: (selector: (s: unknown) => unknown) =>
    selector({
      overrides: mockOverrides,
      setOverrides: mockSetOverrides,
      resetToDefaults: mockResetToDefaults,
      lastModified: null,
      isHydrated: true,
    }),
}));

jest.mock('@hooks/useFeature', () => ({
  useFeature: () => false,
}));

// Health gates its sections behind per-install feature toggles
// (src/config/healthFeatures.ts). This suite is about the EDITOR's rules — the
// 5-slot cap, the locked slots, the payload Save writes — so it runs with every
// feature ON: a default install has most of them off, and a toggle-default flip
// must not silently shrink what these cases assert. What a member with the
// shipped defaults actually sees is pinned by
// src/navigation/__tests__/healthTabShell.test.ts (HEALTH-TAB-045..047).
jest.mock('@hooks/useHealthFeature', () => {
  const { HEALTH_FEATURE_KEYS } = require('@config/healthFeatures');
  const allOn = Object.fromEntries(HEALTH_FEATURE_KEYS.map((k: string) => [k, true]));
  return {
    useHealthFeature: () => true,
    useHealthFeatures: () => allOn,
    isHealthFeatureEnabled: () => true,
    HEALTH_FEATURE_KEYS,
  };
});

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    // Renders `rightElement` so the Save affordance is reachable, and forwards
    // `onBackPress` so the header's back path stays drivable.
    ScreenHeader: ({
      title,
      rightElement,
      onBackPress,
    }: {
      title?: string;
      rightElement?: React.ReactNode;
      onBackPress?: () => void;
    }) =>
      ReactMock.createElement(
        View,
        { testID: 'screen-header', accessibilityLabel: title, onPress: onBackPress },
        rightElement,
      ),
    HeaderActionButton: ({
      label,
      onPress,
      disabled,
      testID,
    }: {
      label?: string;
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
    }) => ReactMock.createElement(View, { testID, onPress, disabled }, label),
    BrandSymbol: () => ReactMock.createElement(View, { testID: 'brand-symbol' }),
    screenScrollViewStyle: { scroll: {} },
  };
});

// The drag handle is a presentation concern; this stand-in surfaces the row's
// title and its locked flag so both are assertable without a real gesture.
jest.mock('@components/customization', () => {
  const ReactMock = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    DraggableTabItem: ({ title, isRequired }: { title?: string; isRequired?: boolean }) =>
      ReactMock.createElement(
        View,
        { testID: isRequired ? `tab-customize-locked-${title}` : `tab-customize-row-${title}` },
        ReactMock.createElement(Text, null, title),
      ),
    // Home/Weight/Activity widget-layout sections rendered below the tab bar
    // editor (Health only) — this suite is about the tab pool, not the
    // per-screen widget order, so a stand-in that just surfaces its testID
    // prefix + title is enough to keep the tree renderable.
    WidgetOrderSection: ({ testIDPrefix, title }: { testIDPrefix?: string; title?: string }) =>
      ReactMock.createElement(
        View,
        { testID: `${testIDPrefix}-widget-order-section` },
        ReactMock.createElement(Text, null, title),
      ),
  };
});

// A drag-free stand-in that hands the suite the list's `onDragEnd`, so a
// reorder can be simulated directly (same pattern as MortgageTabsScreen.test).
jest.mock('react-native-draggable-flatlist', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({
      data,
      renderItem,
      keyExtractor,
      onDragEnd,
      onDragBegin,
    }: {
      data: Array<{ route: string }>;
      renderItem: (p: unknown) => React.ReactNode;
      keyExtractor: (i: { route: string }) => string;
      onDragEnd?: (p: { data: Array<{ route: string }> }) => void;
      onDragBegin?: () => void;
    }) =>
      ReactMock.createElement(
        View,
        { testID: 'customize-tabs-shown-list', onDragEnd, onDragBegin, accessibilityValue: { text: data.map((d) => d.route).join(',') } },
        data.map((item) =>
          ReactMock.createElement(
            ReactMock.Fragment,
            { key: keyExtractor(item) },
            renderItem({ item, drag: jest.fn(), isActive: false }),
          ),
        ),
      ),
    ScaleDecorator: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, null, children ?? null),
  };
});

type Tree = ReactTestRenderer.ReactTestRenderer;
type Override = { route: string; order: number; visible: boolean };

/** Health's own pool, straight from the brand pack. */
const POOL_ROUTES: string[] = healthBrand.tabs.map((t: { route: string }) => t.route);
/** The four editable slots Health ships pinned (More is reserved, not editable). */
const DEFAULT_SHOWN = ['index', 'health-weight', 'health-nutrition', 'health-activity'];
/** Every `defaultHidden` entry, in brand-pack order. */
const DEFAULT_HIDDEN = POOL_ROUTES.filter(
  (r) => healthBrand.tabs.find((t: { route: string }) => t.route === r)?.defaultHidden,
);

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

async function renderEditor(): Promise<Tree> {
  let tree!: Tree;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <TabCustomizationScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

/** Host (string-typed) nodes only — RN's `View` is a composite that renders one
 *  more node carrying the same testID, so an unfiltered findAll double-counts. */
function findAllByTestId(tree: Tree, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

/** The routes currently in the "SHOWN TABS" list, in list order. */
function shownRoutes(tree: Tree): string[] {
  const list = tree.root.find((n) => n.props?.testID === 'customize-tabs-shown-list');
  const raw = (list.props.accessibilityValue as { text: string }).text;
  return raw ? raw.split(',') : [];
}

/** The routes currently in the "IN MORE" list, in list order. */
function hiddenRoutes(tree: Tree): string[] {
  const seen = tree.root
    .findAll(
      (n) =>
        typeof n.props?.testID === 'string' && n.props.testID.startsWith('tab-customize-add-'),
    )
    .map((n) => String(n.props.testID).replace('tab-customize-add-', ''));
  return [...new Set(seen)];
}

function tapAdd(tree: Tree, route: string): void {
  const node = tree.root.find((n) => n.props?.testID === `tab-customize-add-${route}`);
  if (node.props.disabled) {
    // The row is still pressable in the shipped screen only when a slot is free;
    // when it is disabled RN swallows the press, so mirror that here.
    return;
  }
  act(() => node.props.onPress());
}

/** Press an "IN MORE" row even when it is disabled — proves the guard, not the pointer. */
function tapAddIgnoringDisabled(tree: Tree, route: string): void {
  const node = tree.root.find((n) => n.props?.testID === `tab-customize-add-${route}`);
  act(() => node.props.onPress());
}

function tapRemove(tree: Tree, route: string): void {
  const node = tree.root.find((n) => n.props?.testID === `tab-customize-remove-${route}`);
  act(() => node.props.onPress());
}

function saveButton(tree: Tree) {
  return tree.root.find((n) => n.props?.testID === 'customize-tabs-save');
}

function tapSave(tree: Tree): void {
  const btn = saveButton(tree);
  expect(btn.props.disabled).toBe(false);
  act(() => btn.props.onPress());
}

function alertCall(title: string) {
  return (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === title);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOverrides = null;
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore();
});

describe('Health tab editor — the shipped default layout (HEALTH-TAB-034..035)', () => {
  it('HEALTH-TAB-034: opens with the four donor-parity slots filled and every hidden tab listed', async () => {
    const tree = await renderEditor();

    // The bar is 5 wide with the last slot reserved for More, so the editable
    // list is capped at 4 — and Health ships it FULL.
    expect(allText(tree.toJSON())).toContain('SHOWN TABS (4/4)');
    expect(shownRoutes(tree)).toEqual(DEFAULT_SHOWN);

    // Every `defaultHidden` pool entry is offered, in brand-pack order. Most of
    // Health's pool starts here; a tab missing from BOTH lists is a feature no
    // member can reach. Counted from the pack, not hard-coded — the Health pool
    // is still growing, and this contract is "all of them", not "twelve".
    expect(hiddenRoutes(tree)).toEqual(DEFAULT_HIDDEN);
    expect(DEFAULT_HIDDEN).toHaveLength(POOL_ROUTES.length - DEFAULT_SHOWN.length - 1);
    expect(DEFAULT_HIDDEN.length).toBeGreaterThan(4);
    expect([...shownRoutes(tree), 'settings', ...hiddenRoutes(tree)].sort()).toEqual(
      [...POOL_ROUTES].sort(),
    );

    const text = allText(tree.toJSON());
    expect(text).toContain('IN MORE');
    expect(text).toContain('Home and More are always shown. Drag to reorder.');
  });

  it('HEALTH-TAB-035: Home cannot be unpinned and More is not editable at all', async () => {
    const tree = await renderEditor();

    // `index` is `locked: true` → rendered as required, with NO remove control.
    expect(findAllByTestId(tree, 'tab-customize-remove-index')).toHaveLength(0);
    expect(findAllByTestId(tree, 'tab-customize-locked-Dashboard')).toHaveLength(1);

    // `settings` (More) is `locked` AND reserved for the final slot, so it never
    // enters the editable list — it can be neither removed nor reordered.
    expect(findAllByTestId(tree, 'tab-customize-remove-settings')).toHaveLength(0);
    expect(shownRoutes(tree)).not.toContain('settings');
    expect(hiddenRoutes(tree)).not.toContain('settings');

    // Everything else in the bar IS removable.
    for (const route of ['health-weight', 'health-nutrition', 'health-activity']) {
      expect(findAllByTestId(tree, `tab-customize-remove-${route}`)).toHaveLength(1);
    }
  });

  it('HEALTH-TAB-036: Save is inert until something actually changes', async () => {
    const tree = await renderEditor();
    expect(saveButton(tree).props.disabled).toBe(true);

    // `addTab` always appends to the END of the shown list, so removing then
    // re-adding Nutrition is NOT a no-op here: Nutrition ships 3rd, so the
    // round trip leaves it last (after Activity) instead of restoring the
    // shipped order — Save correctly stays dirty. (Activity itself already
    // ships last, so round-tripping IT would be a true no-op and prove
    // nothing.)
    tapRemove(tree, 'health-nutrition');
    expect(saveButton(tree).props.disabled).toBe(false);
    tapAdd(tree, 'health-nutrition');
    expect(shownRoutes(tree)).toEqual([
      'index',
      'health-weight',
      'health-activity',
      'health-nutrition',
    ]);
    expect(saveButton(tree).props.disabled).toBe(false);

    // A drag back into the shipped order IS the true no-op: the signature
    // matches the baseline again, so Save goes inert without persisting
    // anything.
    const list = tree.root.find((n) => n.props?.testID === 'customize-tabs-shown-list');
    const pool = buildTabConfig({ showTasks: false });
    const byRoute = (route: string) => pool.find((t) => t.route === route)!;
    act(() => {
      list.props.onDragEnd({ data: DEFAULT_SHOWN.map(byRoute) });
    });
    expect(shownRoutes(tree)).toEqual(DEFAULT_SHOWN);
    expect(saveButton(tree).props.disabled).toBe(true);
    expect(mockSetOverrides).not.toHaveBeenCalled();
  });
});

describe('Health tab editor — the 5-slot cap (HEALTH-TAB-037..038)', () => {
  it('HEALTH-TAB-037: pinning a SIXTH tab is refused, with an Alert and no state change', async () => {
    const tree = await renderEditor();
    const before = shownRoutes(tree);
    const beforeHidden = hiddenRoutes(tree);

    // Health ships the bar full (4 + More), so every "IN MORE" row is disabled.
    const habits = tree.root.find((n) => n.props?.testID === 'tab-customize-add-health-habits');
    expect(habits.props.disabled).toBe(true);

    // Drive the handler anyway: the guard must live in `addTab`, not only in the
    // pointer state, or a stale render would let a 6th tab through.
    tapAddIgnoringDisabled(tree, 'health-habits');

    const call = alertCall('Bar is full');
    expect(call).toBeDefined();
    expect(String(call?.[1])).toContain('You can pin up to 4 tabs plus More.');
    expect(shownRoutes(tree)).toEqual(before);
    expect(hiddenRoutes(tree)).toEqual(beforeHidden);
    expect(saveButton(tree).props.disabled).toBe(true);
  });

  it('HEALTH-TAB-038: freeing a slot then pinning Habits saves the exact bar it promised', async () => {
    const tree = await renderEditor();

    tapRemove(tree, 'health-activity');
    expect(allText(tree.toJSON())).toContain('SHOWN TABS (3/4)');
    // A removed tab goes to the FRONT of the hub so it is the first thing the
    // member sees after demoting it.
    expect(hiddenRoutes(tree)[0]).toBe('health-activity');

    tapAdd(tree, 'health-habits');
    // `addTab` appends to the END of shown — Habits lands last, after the
    // three tabs that survive the removal (Home stays first; it was never
    // touched).
    expect(shownRoutes(tree)).toEqual([
      'index',
      'health-weight',
      'health-nutrition',
      'health-habits',
    ]);
    expect(hiddenRoutes(tree)).not.toContain('health-habits');

    tapSave(tree);

    expect(mockSetOverrides).toHaveBeenCalledTimes(1);
    const written = mockSetOverrides.mock.calls[0][0] as Override[];
    // Shape: the four pinned in bar order, then More, then everything else
    // hidden — orders are contiguous and every pool route is accounted for.
    expect(written.slice(0, 5)).toEqual([
      { route: 'index', order: 0, visible: true },
      { route: 'health-weight', order: 1, visible: true },
      { route: 'health-nutrition', order: 2, visible: true },
      { route: 'health-habits', order: 3, visible: true },
      { route: 'settings', order: 4, visible: true },
    ]);
    expect(written.map((o) => o.route).sort()).toEqual([...POOL_ROUTES].sort());
    expect(written.map((o) => o.order)).toEqual(written.map((_, i) => i));
    expect(written.filter((o) => o.visible).map((o) => o.route)).toEqual([
      'index',
      'health-weight',
      'health-nutrition',
      'health-habits',
      'settings',
    ]);

    // …and the payload REALLY produces that bar. Asserting the write shape alone
    // would pass on an override set the resolver reads differently.
    const { pinned, overflow } = resolveEffectiveTabs(
      buildTabConfig({ showTasks: false }),
      written as never,
      5,
    );
    expect(pinned.map((t) => t.route)).toEqual([
      'index',
      'health-weight',
      'health-nutrition',
      'health-habits',
      'settings',
    ]);
    expect(overflow.map((t) => t.route)).toContain('health-activity');
    // One in, one out — the hub keeps exactly the tabs the bar did not take.
    expect(overflow).toHaveLength(DEFAULT_HIDDEN.length);

    expect(mockShowToast).toHaveBeenCalledWith('success', 'Tabs updated');
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-TAB-039: unpinning down to the minimum leaves Home + More, never fewer', async () => {
    const tree = await renderEditor();

    for (const route of ['health-weight', 'health-nutrition', 'health-activity']) {
      tapRemove(tree, route);
    }
    expect(allText(tree.toJSON())).toContain('SHOWN TABS (1/4)');
    expect(shownRoutes(tree)).toEqual(['index']);
    // Home stays un-removable at the floor — there is no way to reach an empty bar.
    expect(findAllByTestId(tree, 'tab-customize-remove-index')).toHaveLength(0);
    expect(hiddenRoutes(tree)).toHaveLength(DEFAULT_HIDDEN.length + 3);

    tapSave(tree);
    const written = mockSetOverrides.mock.calls[0][0] as Override[];
    const { pinned, overflow } = resolveEffectiveTabs(
      buildTabConfig({ showTasks: false }),
      written as never,
      5,
    );
    // The donor's floor: two slots — Home and More.
    expect(pinned.map((t) => t.route)).toEqual(['index', 'settings']);
    expect(overflow).toHaveLength(DEFAULT_HIDDEN.length + 3);
  });
});

describe('Health tab editor — reordering (HEALTH-TAB-040)', () => {
  it('HEALTH-TAB-040: a drag reorder is what Save persists, in the dragged order', async () => {
    const tree = await renderEditor();
    const list = tree.root.find((n) => n.props?.testID === 'customize-tabs-shown-list');
    const pool = buildTabConfig({ showTasks: false });
    const byRoute = (route: string) => pool.find((t) => t.route === route)!;

    // The drag START handler (haptic feedback only, no state change) — the drag
    // library calls this before `onDragEnd`, and it was otherwise never invoked.
    expect(() => act(() => list.props.onDragBegin())).not.toThrow();

    act(() => {
      list.props.onDragEnd({
        data: [
          byRoute('index'),
          byRoute('health-activity'),
          byRoute('health-weight'),
          byRoute('health-nutrition'),
        ],
      });
    });

    expect(shownRoutes(tree)).toEqual([
      'index',
      'health-activity',
      'health-weight',
      'health-nutrition',
    ]);
    tapSave(tree);

    const written = mockSetOverrides.mock.calls[0][0] as Override[];
    expect(written.slice(0, 4).map((o) => o.route)).toEqual([
      'index',
      'health-activity',
      'health-weight',
      'health-nutrition',
    ]);
    const { pinned } = resolveEffectiveTabs(pool, written as never, 5);
    expect(pinned.map((t) => t.route)).toEqual([
      'index',
      'health-activity',
      'health-weight',
      'health-nutrition',
      'settings',
    ]);
  });
});

describe('Health tab editor — reset (HEALTH-TAB-041..042)', () => {
  it('HEALTH-TAB-041: cancelling Reset changes nothing', async () => {
    const tree = await renderEditor();
    tapRemove(tree, 'health-activity');

    const reset = tree.root.find(
      (n) => typeof n.props?.onPress === 'function' && n.props?.title === 'Reset to Defaults',
    );
    act(() => reset.props.onPress());

    const buttons = (alertCall('Reset tabs?')?.[2] ?? []) as Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }>;
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Reset']);

    act(() => buttons.find((b) => b.style === 'cancel')?.onPress?.());
    expect(mockResetToDefaults).not.toHaveBeenCalled();
    expect(shownRoutes(tree)).toEqual(['index', 'health-weight', 'health-nutrition']);
  });

  it('HEALTH-TAB-042: confirming Reset restores the donor default bar and clears the dirty flag', async () => {
    // Start from a member who already customized: Habits pinned in place of
    // Activity, Weight left in its default (pinned) slot.
    mockOverrides = [
      { route: 'index', order: 0, visible: true },
      { route: 'health-weight', order: 1, visible: true },
      { route: 'health-nutrition', order: 2, visible: true },
      { route: 'health-habits', order: 3, visible: true },
      { route: 'settings', order: 4, visible: true },
      { route: 'health-activity', order: 5, visible: false },
    ];
    const tree = await renderEditor();
    expect(shownRoutes(tree)).toEqual([
      'index',
      'health-weight',
      'health-nutrition',
      'health-habits',
    ]);

    const reset = tree.root.find(
      (n) => typeof n.props?.onPress === 'function' && n.props?.title === 'Reset to Defaults',
    );
    act(() => reset.props.onPress());
    const buttons = (alertCall('Reset tabs?')?.[2] ?? []) as Array<{
      style?: string;
      onPress?: () => void;
    }>;
    act(() => buttons.find((b) => b.style === 'destructive')?.onPress?.());

    expect(mockResetToDefaults).toHaveBeenCalledTimes(1);
    expect(shownRoutes(tree)).toEqual(DEFAULT_SHOWN);
    expect(hiddenRoutes(tree)).toEqual(DEFAULT_HIDDEN);
    // Reset rebases the baseline, so Save does not stay armed with a layout the
    // store has already been told to forget.
    expect(saveButton(tree).props.disabled).toBe(true);
  });
});

describe('Health tab editor — leaving without saving (HEALTH-TAB-039b)', () => {
  it('the header back control pops the screen without persisting anything', async () => {
    const tree = await renderEditor();
    tapRemove(tree, 'health-activity');
    expect(saveButton(tree).props.disabled).toBe(false);

    const header = tree.root.find((n) => n.props?.testID === 'screen-header');
    act(() => header.props.onPress());

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockSetOverrides).not.toHaveBeenCalled();
  });
});

describe('Health tab editor — brand isolation (HEALTH-TAB-043)', () => {
  it('HEALTH-TAB-043: offers no House/Budget/Kaizen/Language tab in either list', async () => {
    const tree = await renderEditor();
    const routes = [...shownRoutes(tree), ...hiddenRoutes(tree)];

    for (const foreign of [
      'my-home',
      'tasks',
      'contractors',
      'reports',
      'chat',
      'utilities',
      'gardening',
      'mira',
      'budget',
      'planning',
      'spending',
      'savings',
      'pension',
      'bills',
      'wishes',
      'mortgage',
      'kaizen-assess',
      'kaizen-career',
      'kaizen-learn',
      'kaizen-systems',
      'language-assessment',
      'language-dialogue',
      'language-plan',
      'language-review',
    ]) {
      expect(routes).not.toContain(foreign);
      expect(findAllByTestId(tree, `tab-customize-add-${foreign}`)).toHaveLength(0);
    }

    const text = allText(tree.toJSON());
    for (const label of ['Mira', 'Contractors', 'Mortgage', 'Career', 'Dialogue', 'Symply House']) {
      expect(text).not.toContain(label);
    }
  });
});

/**
 * Documented edge, not a shipped defect: `locked` guarantees a tab is VISIBLE,
 * not that it is PINNED. An override that orders a locked tab past the 4-slot
 * cap drops it into the More hub. The shipped editor cannot produce such a
 * payload (Home always sits inside a `shown` list capped at 4), so this pins the
 * resolver's real behaviour for whoever next hand-writes or migrates overrides.
 */
describe('Health tab editor — locked ≠ pinned (HEALTH-TAB-044)', () => {
  it('HEALTH-TAB-044: a hand-written override ordering Home past the cap moves it to the hub', async () => {
    const pool = buildTabConfig({ showTasks: false });
    const { pinned, overflow } = resolveEffectiveTabs(
      pool,
      [
        { route: 'health-nutrition', order: 0, visible: true },
        { route: 'health-activity', order: 1, visible: true },
        { route: 'health-trends', order: 2, visible: true },
        { route: 'health-habits', order: 3, visible: true },
        // Explicitly hidden so it does not compete for a slot on its own
        // (unoverridden) pool-default visibility — this case is about Home,
        // not Weight.
        { route: 'health-weight', order: 4, visible: false },
        { route: 'index', order: 90, visible: true },
        { route: 'settings', order: 91, visible: true },
      ] as never,
      5,
    );

    expect(pinned.map((t) => t.route)).toEqual([
      'health-nutrition',
      'health-activity',
      'health-trends',
      'health-habits',
      'settings',
    ]);
    // Still reachable — it lands in the hub, it is never dropped from the app.
    expect(overflow.map((t) => t.route)).toContain('index');
    expect([...pinned, ...overflow]).toHaveLength(POOL_ROUTES.length);
  });
});
