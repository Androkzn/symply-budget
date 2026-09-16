/**
 * HealthMoreScreen — Symply Health (`symply-health`) More/settings tab.
 *
 * Renders the REAL screen through <ThemeProvider> and drives every control it
 * has: the six navigating rows (Profile, Goals, Notifications, Widget, AI
 * assistance, Symply apps), the inline Units (Metric/Imperial) picker, the Apple Health
 * connect card's whole state machine, the two DATA verbs (export and clear-all)
 * with their blocking overlay, the admin-only feature switchboard, the privacy
 * explainer, the inert roadmap row, and the sign-out confirmation. Also asserts
 * it mounts on iPad-class dimensions.
 *
 * ── 2026-07-26: the tab grew, and this suite was rebuilt against it ──────────
 * The screen this file was originally written for offered a Weight-units ALERT
 * and nothing else that wrote. It now ships a real inline picker, Goals /
 * Notifications / Widget rows, an admin section, and — the two that matter most
 * — "Export my data" and "Clear all health data". Cases that asserted the old
 * shape (the units Alert, the "Apple Health sync" roadmap row) are rewritten
 * rather than deleted: their matrix IDs still describe a real behaviour, it just
 * has a different mechanism now.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Alert, Linking } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { AdaptiveContainer } from '@components/layout';
import { Card, Icon, Typography } from '@components/ui';
import { HEALTH_FEATURES } from '@config/healthFeatures';
import { ThemeProvider } from '@contexts/ThemeContext';
import { useAppColors } from '@theme';

import { clearAllHealthData, HEALTH_CLEAR_DELETES, HEALTH_CLEAR_KEPT } from '../../healthDataReset';
import { exportHealthData } from '../../healthExport';
import { healthKit, type HealthKitStatus } from '../../healthKit';
import { loadHealthPrefs, setUnitSystem, type HealthPrefs } from '../../healthLocalStorage';
import {
  DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
  describeNotificationPreferences,
  loadNotificationPreferences,
} from '../../healthSettingsStorage';
import {
  DEFAULT_HEALTH_WIDGET_PREFERENCES,
  describeWidgetPreferences,
  loadWidgetPreferences,
} from '../../healthWidgetStorage';
import { HealthMoreScreen } from '../HealthMoreScreen';

const IPHONE = { width: 393, height: 852, scale: 3, fontScale: 1 };
const IPAD = { width: 1024, height: 1366, scale: 2, fontScale: 1 };
let mockWindow = IPHONE;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: () => ReactMock.createElement(View, { testID: 'screen-header' }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    // The shared blocking loader. Stubbed to a marker that carries its copy, so
    // the cases below can assert WHICH job is running without depending on the
    // primitive's own rendering (that belongs to its own suite). Renders nothing
    // when hidden, which is what makes "no overlay at rest" assertable.
    ProcessingOverlay: ({
      visible,
      message,
      caption,
      testID,
    }: {
      visible: boolean;
      message?: string;
      caption?: string;
      testID?: string;
    }) =>
      visible
        ? ReactMock.createElement(View, { testID }, message ?? '', ' ', caption ?? '')
        : null,
  };
});

// Health opts into customizable tabs, so More renders the shared overflow hub
// (unpinned tabs + "Customize Tabs") above its own rows. It pulls in BrandSymbol
// and the tab registry, which this suite deliberately does not exercise —
// src/navigation/__tests__/healthTabShell.test.ts owns that contract. Stubbed to
// a marker so these cases stay about HealthMoreScreen's own rows.
jest.mock('@components/navigation/TabOverflowSection', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    TabOverflowSection: () => ReactMock.createElement(View, { testID: 'tab-overflow-section' }),
  };
});

// Health opts into customizable tabs, so More renders the shared overflow hub
// (unpinned tabs + "Customize Tabs") above its own rows. It pulls in BrandSymbol
// and the tab registry, which this suite deliberately does not exercise —
// src/navigation/__tests__/healthTabShell.test.ts owns that contract. Stubbed to
// a marker so these cases stay about HealthMoreScreen's own rows.
jest.mock('@components/navigation/TabOverflowSection', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    TabOverflowSection: () => ReactMock.createElement(View, { testID: 'tab-overflow-section' }),
  };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

// Shared AI-access entry (identical for every brand) — mock its resolved shape
// so this suite does not depend on the AI-entitlement query.
//
// MUTABLE on purpose. `useAIAccessEntry` is the single source of truth for the
// row's gate, route, copy and icon, and every brand is required to consume it
// VERBATIM. A frozen `show: true` mock can only ever prove the entitled case, so
// the ungated state (MORE-068) and the "renders the hook's values, not its own"
// contract (MORE-069) were both unreachable. Reset in `beforeEach`.
const DEFAULT_AI_ENTRY = {
  show: true,
  route: '/ai-access',
  title: 'AI assistance',
  subtitle: 'Connect OpenAI, Claude, or Gemini',
  icon: 'sparkles-outline',
};
let mockAiEntry: Record<string, unknown> = { ...DEFAULT_AI_ENTRY };
jest.mock('@components/ai/useAIAccessEntry', () => ({
  useAIAccessEntry: () => mockAiEntry,
}));

// The ADMIN section is staff tooling. Both of its inputs are mocked so the
// member view (the one nearly everybody gets) and the staff view can each be
// rendered deliberately.
let mockIsAdmin = false;
jest.mock('@hooks/useIsAdmin', () => ({
  useIsAdmin: () => mockIsAdmin,
  isAdminUser: () => mockIsAdmin,
}));

// The local-first gate behind the "YOUR DEVICES" section. Mocked rather than
// left to the real `isHealthLocalFirst()` so both cases are reachable AND both
// jest runs behave the same — the required `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=1`
// pin would otherwise flip this section on for every case in the file.
let mockLocalFirst = false;
jest.mock('../../local/flag', () => ({
  isHealthLocalFirst: () => mockLocalFirst,
  isHealthP2PEnabled: () => false,
}));

let mockFeatureMap: Record<string, boolean> = {};
jest.mock('@hooks/useHealthFeature', () => ({
  useHealthFeatures: () => mockFeatureMap,
  useHealthFeature: (key: string) => mockFeatureMap[key] ?? true,
}));

const mockLogout = jest.fn();
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: null, logout: mockLogout }),
}));

jest.mock('../../healthLocalStorage', () => {
  const actual = jest.requireActual('../../healthLocalStorage');
  return {
    ...actual,
    loadHealthPrefs: jest.fn(),
    setUnitSystem: jest.fn(),
  };
});

// The two preference READS behind the Notifications and Widget subtitles. The
// `describe*` formatters stay REAL — the subtitle is the only place those
// summaries are shown, so stubbing them would make the rows assert nothing.
jest.mock('../../healthSettingsStorage', () => {
  const actual = jest.requireActual('../../healthSettingsStorage');
  return { ...actual, loadNotificationPreferences: jest.fn() };
});

jest.mock('../../healthWidgetStorage', () => {
  const actual = jest.requireActual('../../healthWidgetStorage');
  return { ...actual, loadWidgetPreferences: jest.fn() };
});

// The two DATA verbs. Both walk the whole account and touch the file system and
// the share sheet, so they are seams here: this screen owns WHEN they run, what
// it blocks while they do, and what it says afterwards — not what they do.
// `healthExport.test.ts` / `healthDataReset.test.ts` own the verbs themselves.
jest.mock('../../healthExport', () => {
  const actual = jest.requireActual('../../healthExport');
  return { ...actual, exportHealthData: jest.fn() };
});

jest.mock('../../healthDataReset', () => {
  const actual = jest.requireActual('../../healthDataReset');
  return { ...actual, clearAllHealthData: jest.fn() };
});

// The HealthKit service itself is covered by src/features/health/__tests__/
// healthKit.test.ts. Here it is a seam: More owns the CONNECT flow — which of
// getStatus / requestPermission / importNow run, in which order, for each of
// the four states — and that orchestration lives in this screen, not in the
// service.
jest.mock('../../healthKit', () => ({
  healthKit: {
    getStatus: jest.fn(),
    requestPermission: jest.fn(),
    importNow: jest.fn(),
  },
}));

const mockLoadHealthPrefs = loadHealthPrefs as jest.Mock;
const mockSetUnitSystem = setUnitSystem as jest.Mock;
const mockLoadNotifyPrefs = loadNotificationPreferences as jest.Mock;
const mockLoadWidgetPrefs = loadWidgetPreferences as jest.Mock;
const mockExport = exportHealthData as jest.Mock;
const mockClearAll = clearAllHealthData as jest.Mock;

const mockGetStatus = healthKit.getStatus as jest.Mock;
const mockRequestPermission = healthKit.requestPermission as jest.Mock;
const mockImportNow = healthKit.importNow as jest.Mock;

/** A HealthKitStatus in `state`, with the shape the card actually reads. */
function hkStatus(
  state: HealthKitStatus['state'],
  over: Partial<HealthKitStatus> = {}
): HealthKitStatus {
  return {
    state,
    availability: state === 'unavailable' ? 'unavailable' : 'available',
    perType: {},
    requestedAt: state === 'not-requested' ? null : '2026-07-25T08:00:00.000Z',
    lastSyncedAt: null,
    ...over,
  } as HealthKitStatus;
}

const prefs = (unit: HealthPrefs['preferredUnit']): HealthPrefs => ({
  unitSystem: unit === 'lb' ? 'imperial' : 'metric',
  preferredUnit: unit,
  healthKitEnabled: false,
  aiEnabled: false,
});

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function byTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

/** Concatenated text of a single instance's host subtree. */
function instanceText(inst: ReactTestRenderer.ReactTestInstance): string {
  return inst
    .findAll((n) => typeof n.type === 'string')
    .flatMap((n) => {
      const c = n.props?.children;
      return Array.isArray(c) ? c : [c];
    })
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .map(String)
    .join('');
}

/** Fire onPress on the outermost pressable whose rendered subtree contains `text`. */
function pressByText(tree: ReactTestRenderer.ReactTestRenderer, text: string): void {
  const matches = tree.root.findAll(
    (n) => typeof n.props?.onPress === 'function' && instanceText(n).includes(text),
  );
  if (matches.length === 0) throw new Error(`No pressable found containing text: "${text}"`);
  matches[0].props.onPress();
}

/** Fire onPress on the node carrying `testID` (rows, picker options, buttons). */
function pressById(tree: ReactTestRenderer.ReactTestRenderer, testID: string): void {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function',
  );
  node.props.onPress();
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthMoreScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  mockAiEntry = { ...DEFAULT_AI_ENTRY };
  mockIsAdmin = false;
  mockLocalFirst = false;
  mockFeatureMap = Object.fromEntries(HEALTH_FEATURES.map((f) => [f.key, true]));
  jest.clearAllMocks();
  mockLoadHealthPrefs.mockResolvedValue(prefs('kg'));
  mockSetUnitSystem.mockResolvedValue(prefs('lb'));
  mockLoadNotifyPrefs.mockResolvedValue(DEFAULT_HEALTH_NOTIFICATION_PREFERENCES);
  mockLoadWidgetPrefs.mockResolvedValue(DEFAULT_HEALTH_WIDGET_PREFERENCES);
  mockExport.mockResolvedValue({ status: 'shared', message: 'Saved 412 entries.', rows: 412 });
  mockClearAll.mockResolvedValue({
    status: 'cleared',
    message: 'Your health data has been deleted.',
    deleted: 412,
    failed: 0,
  });
  // No native bridge in Jest, so `unavailable` is the honest default state.
  mockGetStatus.mockResolvedValue(hkStatus('unavailable'));
  mockRequestPermission.mockResolvedValue(hkStatus('denied'));
  mockImportNow.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore();
});

describe('HealthMoreScreen — content', () => {
  it('renders every section and row', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(byTestId(tree, 'health-more-screen').length).toBe(1);
    expect(text).toContain('ACCOUNT');
    expect(text).toContain('Profile');
    expect(text).toContain('PREFERENCES');
    expect(text).toContain('Units');
    expect(text).toContain('Goals and targets');
    expect(text).toContain('Notifications');
    expect(text).toContain('Widget');
    expect(text).toContain('PRIVACY');
    expect(text).toContain('Where your data lives');
    expect(text).toContain('Apple Health');
    expect(text).toContain('AI assistance');
    expect(text).toContain('Export my data');
    expect(text).toContain('Clear all health data');
    expect(text).toContain('MORE SYMPLY APPS');
    expect(text).toContain('Symply apps');
    expect(text).toContain('COMING SOON');
    expect(text).toContain('Sign out');
  });

  it('routes the Symply apps row to the ecosystem grid', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Symply apps'));
    expect(mockPush).toHaveBeenCalledWith('/symply-apps');
  });

  it('reflects the loaded unit system in the Units subtitle', async () => {
    mockLoadHealthPrefs.mockResolvedValue(prefs('lb'));
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Imperial (lb, ft/in, mi)');
  });
});

describe('HealthMoreScreen — navigation', () => {
  it('routes Profile and AI assistance to their screens', async () => {
    const tree = await renderScreen();
    act(() => pressById(tree, 'health-setting-profile'));
    expect(mockPush).toHaveBeenCalledWith('/profile');

    act(() => pressById(tree, 'health-setting-ai-assistance'));
    expect(mockPush).toHaveBeenCalledWith('/ai-access');
  });

  it('HEALTH-MORE-090: routes Goals, Notifications and Widget to their own screens', async () => {
    // Three rows added 2026-07-26. Each is a settings-shaped way into a screen
    // that also exists elsewhere (Goals is a tab; Notifications and Widget are
    // only reachable from here), so a mis-wired route silently strands a whole
    // surface.
    const tree = await renderScreen();

    act(() => pressById(tree, 'health-setting-goals'));
    expect(mockPush).toHaveBeenCalledWith('/health-goals');

    act(() => pressById(tree, 'health-setting-notifications'));
    expect(mockPush).toHaveBeenCalledWith('/health-notifications');

    act(() => pressById(tree, 'health-setting-widget'));
    expect(mockPush).toHaveBeenCalledWith('/health-widget');

    expect(mockPush).toHaveBeenCalledTimes(3);
  });

  it('HEALTH-MORE-091: summarises the LOADED notification and widget preferences', async () => {
    // The subtitles are computed from the stored records, not hardcoded. A row
    // that always said "Push on · 6 of 6" would be a settings screen lying about
    // settings — the one thing it exists to report.
    const notify = {
      ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
      receive_push_notifications: false,
      receive_inapp_notifications: false,
      notify_recipe_created: false,
    };
    const widget = {
      ...DEFAULT_HEALTH_WIDGET_PREFERENCES,
      small_widget_metric: 'water' as const,
      show_weight: false,
      show_nutrition: false,
      show_workouts: false,
    };
    mockLoadNotifyPrefs.mockResolvedValue(notify);
    mockLoadWidgetPrefs.mockResolvedValue(widget);

    const tree = await renderScreen();

    // Compared against the REAL formatters, so a change to either summary shows
    // up here as a change, not as a rewritten expectation.
    expect(allText(byTestId(tree, 'health-setting-notifications-subtitle')[0].props.children)).toBe(
      describeNotificationPreferences(notify),
    );
    expect(allText(byTestId(tree, 'health-setting-widget-subtitle')[0].props.children)).toBe(
      describeWidgetPreferences(widget),
    );
    // …and they really did change from the defaults.
    expect(describeNotificationPreferences(notify)).toContain('All off');
    expect(describeWidgetPreferences(widget)).toContain('Water only');
  });
});

/* ------------------------------------------------------------------ *
 * The Units (Metric/Imperial) picker (matrix 092-094, and 036/072 rewritten).
 *
 * This was an Alert until 2026-07-26. An iOS alert cannot show which option is
 * already chosen, so the member had to close it, read the subtitle and open it
 * again to be sure. It is now an inline panel where both options and the
 * current one are on screen together.
 * ------------------------------------------------------------------ */

describe('HealthMoreScreen — units picker', () => {
  it('HEALTH-MORE-092: opens and closes in place, and the chevron says which', async () => {
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-units-picker')).toHaveLength(0);
    expect(chevronNames(rowByTitle(tree, 'Units'))).toContain('chevron-down');

    act(() => pressById(tree, 'health-setting-units'));
    expect(byTestId(tree, 'health-units-picker')).toHaveLength(1);
    expect(chevronNames(rowByTitle(tree, 'Units'))).toContain('chevron-up');

    // Tapping the row again closes it — a row that only ever opened would trap
    // the panel on screen for anyone who opened it by accident.
    act(() => pressById(tree, 'health-setting-units'));
    expect(byTestId(tree, 'health-units-picker')).toHaveLength(0);
    expect(chevronNames(rowByTitle(tree, 'Units'))).toContain('chevron-down');
  });

  it('HEALTH-MORE-093: lists every unit and marks the current one as selected', async () => {
    const tree = await renderScreen();
    act(() => pressById(tree, 'health-setting-units'));

    const kg = tree.root.find((n) => n.props?.testID === 'health-unit-system-metric');
    const lb = tree.root.find((n) => n.props?.testID === 'health-unit-system-imperial');

    // Both options are on screen at once — the whole reason this replaced an Alert.
    expect(instanceText(kg)).toContain('Metric (kg, cm, km)');
    expect(instanceText(lb)).toContain('Imperial (lb, ft/in, mi)');

    // …and the stored one is announced as selected, not merely styled.
    expect(kg.props.accessibilityState).toEqual({ selected: true });
    expect(lb.props.accessibilityState).toEqual({ selected: false });
    expect(kg.props.accessibilityRole).toBe('button');
  });

  it('HEALTH-MORE-094: persists the chosen unit and closes the panel', async () => {
    const tree = await renderScreen();
    act(() => pressById(tree, 'health-setting-units'));

    await act(async () => {
      pressById(tree, 'health-unit-system-imperial');
    });

    expect(mockSetUnitSystem).toHaveBeenCalledWith('imperial');
    expect(byTestId(tree, 'health-units-picker')).toHaveLength(0);
    expect(allText(byTestId(tree, 'health-setting-units-subtitle')[0].props.children)).toBe(
      'Imperial (lb, ft/in, mi)',
    );
  });

  it('HEALTH-MORE-094b: persists kilograms when that option is chosen', async () => {
    mockLoadHealthPrefs.mockResolvedValue(prefs('lb'));
    mockSetUnitSystem.mockResolvedValue(prefs('kg'));
    const tree = await renderScreen();

    act(() => pressById(tree, 'health-setting-units'));
    await act(async () => {
      pressById(tree, 'health-unit-system-metric');
    });

    expect(mockSetUnitSystem).toHaveBeenCalledWith('metric');
    expect(allText(byTestId(tree, 'health-setting-units-subtitle')[0].props.children)).toBe(
      'Metric (kg, cm, km)',
    );
  });

  it('HEALTH-MORE-036: closing the picker without choosing writes nothing', async () => {
    // The CANCEL path. It used to be an Alert's `style: 'cancel'` button; the
    // equivalent now is dismissing the panel by tapping the row again.
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Metric (kg, cm, km)');

    act(() => pressById(tree, 'health-setting-units'));
    act(() => pressById(tree, 'health-setting-units'));

    expect(mockSetUnitSystem).not.toHaveBeenCalled();
    expect(allText(byTestId(tree, 'health-setting-units-subtitle')[0].props.children)).toBe(
      'Metric (kg, cm, km)',
    );
  });

  it('HEALTH-MORE-072: settles on the unit STORAGE returned, not the one tapped', async () => {
    // `chooseUnitSystem` is optimistic and then authoritative: it paints the
    // tap immediately, then overwrites with whatever `setUnitSystem` resolved.
    // If the write coerced or fell back, the row must end up saying what the
    // rest of the app will actually use — an optimistic-only row would leave
    // the member reading a unit nothing else agrees with.
    mockSetUnitSystem.mockResolvedValue(prefs('kg'));
    const tree = await renderScreen();

    act(() => pressById(tree, 'health-setting-units'));
    await act(async () => {
      pressById(tree, 'health-unit-system-imperial');
    });

    expect(mockSetUnitSystem).toHaveBeenCalledWith('imperial');
    expect(allText(byTestId(tree, 'health-setting-units-subtitle')[0].props.children)).toBe(
      'Metric (kg, cm, km)',
    );
  });
});

describe('HealthMoreScreen — privacy info', () => {
  it('shows an explanatory alert for where-your-data-lives', async () => {
    const tree = await renderScreen();

    act(() => pressByText(tree, 'Where your data lives'));
    expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Where your data lives')).toBe(true);
  });

  it('HEALTH-MORE-047: renders the Apple Health CARD, not a static row + alert', async () => {
    // Apple Health used to be a `SettingItem` whose only behaviour was an alert
    // saying "HealthKit is not connected". `HealthKitConnectCard` replaces it:
    // it owns every state (unavailable / not-requested / denied / connected),
    // lists exactly which data types are read, and always states that manual
    // entry keeps working. The card renders once `getStatus()` resolves — that
    // call never throws, so an absent native bridge shows the `unavailable`
    // state rather than nothing.
    const tree = await renderScreen();

    const card = tree.root.findAll(
      (n) => typeof n.type === 'string' && n.props?.testID === 'health-setting-apple-health'
    );
    expect(card.length).toBeGreaterThan(0);

    // The retired alert path must be gone.
    expect(
      (Alert.alert as jest.Mock).mock.calls.some((c) => /HealthKit is not connected/i.test(String(c[1])))
    ).toBe(false);
  });
});

describe('HealthMoreScreen — sign out', () => {
  it('confirms before signing out and logs out on the destructive action', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Sign out'));

    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Sign out');
    expect(call).toBeDefined();
    const buttons = call[2] as Array<{ text: string; style?: string; onPress?: () => void }>;
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Sign out']);
    expect(mockLogout).not.toHaveBeenCalled(); // not until confirmed

    act(() => buttons.find((b) => b.style === 'destructive')?.onPress?.());
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});

describe('HealthMoreScreen — iPad rendering', () => {
  it('mounts on iPad-class dimensions (tablet max-width path)', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-more-screen').length).toBe(1);
    expect(allText(tree.toJSON())).toContain('PREFERENCES');
  });
});

/* ------------------------------------------------------------------ *
 * Matrix HEALTH-MORE-030..044 — row-level treatment, affordances,
 * cancel paths, and screen scoping.
 * ------------------------------------------------------------------ */

type AlertButton = { text: string; style?: string; onPress?: () => void };

/** Buttons passed to the Alert whose title is `title`. */
function alertButtons(title: string): AlertButton[] {
  const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === title);
  expect(call).toBeDefined();
  return (call?.[2] ?? []) as AlertButton[];
}

/** The <Card> row (SettingItem) whose subtree text contains `title` (first match). */
function rowByTitle(tree: ReactTestRenderer.ReactTestRenderer, title: string) {
  const rows = tree.root.findAll((n) => n.type === Card && instanceText(n).includes(title), {
    deep: true,
  });
  if (rows.length === 0) throw new Error(`No SettingItem row containing: "${title}"`);
  return rows[0];
}

function rowIcons(row: ReactTestRenderer.ReactTestInstance) {
  return row.findAll((n) => n.type === Icon, { deep: true });
}

/** Every `chevron-*` glyph in a row — `forward` navigates, `down`/`up` expand. */
function chevronNames(row: ReactTestRenderer.ReactTestInstance): string[] {
  return rowIcons(row)
    .map((i) => String(i.props.name))
    .filter((name) => name.startsWith('chevron-'));
}

function hasChevron(row: ReactTestRenderer.ReactTestInstance): boolean {
  return chevronNames(row).length > 0;
}

/** Resolve the live theme palette the screen renders with. */
async function themeColors(): Promise<Record<string, string>> {
  let captured: Record<string, string> = {};
  function Probe() {
    captured = useAppColors() as unknown as Record<string, string>;
    return null;
  }
  await act(async () => {
    ReactTestRenderer.create(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
  });
  return captured;
}

describe('HealthMoreScreen — row treatment (matrix 030-034)', () => {
  it('HEALTH-MORE-030: renders the sign-out row with the danger treatment', async () => {
    const colors = await themeColors();
    const tree = await renderScreen();

    const signOut = rowByTitle(tree, 'Sign out');
    // danger → the leading icon is tinted with the error colour, not primary.
    expect(rowIcons(signOut)[0].props.color).toBe(colors.error);

    // danger → the title Typography is ALSO error-coloured.
    const signOutTitle = signOut
      .findAll((n) => n.type === Typography, { deep: true })
      .find((n) => n.props.children === 'Sign out');
    expect(signOutTitle?.props.color).toBe(colors.error);

    // Normal rows: icon tint matches the title (textPrimary), not brand primary.
    const profile = rowByTitle(tree, 'Profile');
    expect(rowIcons(profile)[0].props.color).toBe(colors.textPrimary);
    const profileTitle = profile
      .findAll((n) => n.type === Typography, { deep: true })
      .find((n) => n.props.children === 'Profile');
    expect(profileTitle?.props.color).toBe(colors.textPrimary);
    expect(colors.error).not.toBe(colors.primary);
  });

  it('HEALTH-MORE-030b: gives Clear all health data the same danger treatment', async () => {
    // The other destructive row, added 2026-07-26. It must read as destructive
    // BEFORE it is tapped — it sits between "Export my data" and a roadmap row,
    // and the only thing separating it from them visually is this tint.
    const colors = await themeColors();
    const tree = await renderScreen();

    const clear = rowByTitle(tree, 'Clear all health data');
    expect(rowIcons(clear)[0].props.color).toBe(colors.error);
    const title = clear
      .findAll((n) => n.type === Typography, { deep: true })
      .find((n) => n.props.children === 'Clear all health data');
    expect(title?.props.color).toBe(colors.error);

    // Export is NOT destructive and must not borrow the treatment.
    expect(rowIcons(rowByTitle(tree, 'Export my data'))[0].props.color).toBe(colors.textPrimary);
  });

  it('HEALTH-MORE-031: renders no subtitle node on the sign-out row', async () => {
    const tree = await renderScreen();
    const signOut = rowByTitle(tree, 'Sign out');

    // `subtitle &&` false branch: the row has exactly ONE Typography (the title).
    const typographies = signOut.findAll((n) => n.type === Typography, { deep: true });
    expect(typographies).toHaveLength(1);
    expect(typographies[0].props.children).toBe('Sign out');
    expect(byTestId(tree, 'health-sign-out-subtitle')).toHaveLength(0);
    // Nothing renders below the title (the Ionicons fallback glyph aside).
    expect(instanceText(signOut).replace(/[^\x20-\x7e]/g, '')).toBe('Sign out');
  });

  it('HEALTH-MORE-032: exposes `${testID}-subtitle` only for rows that have a testID', async () => {
    const tree = await renderScreen();

    // Row WITH a testID → addressable subtitle node.
    const subtitleNodes = byTestId(tree, 'health-setting-units-subtitle');
    expect(subtitleNodes).toHaveLength(1);
    expect(allText(subtitleNodes[0].props.children)).toContain('Metric (kg, cm, km)');

    // The Profile row now carries one too (it was the last row without a
    // testID, which forced MORE-040 and the Maestro flows to match its title
    // text). Fixed 2026-07-26 — the assertion below is what CLOSED that defect.
    const profileSubtitle = byTestId(tree, 'health-setting-profile-subtitle');
    expect(profileSubtitle).toHaveLength(1);
    expect(allText(profileSubtitle[0].props.children)).toContain('Name, photo, and account');
    // The `${testID}-subtitle` suffix is only appended for rows that HAVE a
    // testID, so a row without one must never mint the literal string.
    expect(byTestId(tree, 'undefined-subtitle')).toHaveLength(0);
  });

  it('HEALTH-MORE-033: renders a FORWARD chevron on every navigating row', async () => {
    const tree = await renderScreen();
    for (const title of [
      'Profile',
      'Goals and targets',
      'Notifications',
      'Widget',
      'Where your data lives',
      // 'Apple Health' is no longer a chevron row — it is HealthKitConnectCard,
      // covered by HEALTH-MORE-047.
      'AI assistance',
      'Export my data',
      'Symply apps',
    ]) {
      expect([title, chevronNames(rowByTitle(tree, title))]).toEqual([title, ['chevron-forward']]);
    }
  });

  it('HEALTH-MORE-033b: renders a DISCLOSURE chevron on the two expanding rows', async () => {
    // Direction is the affordance: `forward` promises a new screen, `down`
    // promises the answer appears here. The units row and the clear-data row are
    // the only two that expand in place, and both used to claim `forward`.
    const tree = await renderScreen();
    expect(chevronNames(rowByTitle(tree, 'Units'))).toEqual(['chevron-down']);
    expect(chevronNames(rowByTitle(tree, 'Clear all health data'))).toEqual(['chevron-down']);

    act(() => pressById(tree, 'health-setting-clear-data'));
    expect(chevronNames(rowByTitle(tree, 'Clear all health data'))).toEqual(['chevron-up']);
  });

  it('HEALTH-MORE-034: renders no chevron on the COMING SOON row or on sign out', async () => {
    const tree = await renderScreen();

    // showChevron={false} + no onPress.
    expect(hasChevron(rowByTitle(tree, 'Body photos'))).toBe(false);

    // Key case: Sign out HAS an onPress but showChevron={false} — the chevron
    // requires BOTH conditions (`showChevron && onPress`).
    const signOut = rowByTitle(tree, 'Sign out');
    expect(typeof signOut.props.onPress).toBe('function');
    expect(hasChevron(signOut)).toBe(false);
  });
});

describe('HealthMoreScreen — COMING SOON rows (matrix 035, 103)', () => {
  it('HEALTH-MORE-035: renders the COMING SOON row as non-pressable', async () => {
    const tree = await renderScreen();

    // Nutrition / Activity / Body all SHIPPED as tabs, and Apple Health sync
    // shipped as the connect card, so the roadmap list is down to the one thing
    // that still needs its own privacy review.
    const row = rowByTitle(tree, 'Body photos');
    // `pressable={!!onPress}` is false → Card renders a plain View.
    expect(row.props.onPress).toBeUndefined();
    expect(row.props.pressable).toBe(false);
    expect(row.findAll((n) => n.props?.accessibilityRole === 'button', { deep: true })).toHaveLength(
      0,
    );
    // No host node inside the row wires an onPress handler.
    expect(
      row.findAll((n) => typeof n.type === 'string' && typeof n.props?.onPress === 'function'),
    ).toHaveLength(0);
    expect(instanceText(row)).toContain('Needs its own storage and deletion review first');

    // Tapping it is impossible → nothing navigates, alerts, or writes.
    expect(mockPush).not.toHaveBeenCalled();
    expect(Alert.alert as jest.Mock).not.toHaveBeenCalled();
    expect(mockSetUnitSystem).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('HEALTH-MORE-103: no longer claims Apple Health sync is unbuilt', async () => {
    // Replaces the old HEALTH-MORE-039, which asserted the "Apple Health sync /
    // Scoped, opt-in, privacy-reviewed" roadmap row EXISTS. That row shipped as
    // `HealthKitConnectCard` — leaving the roadmap entry in place told the
    // member a working, connectable capability had not been built yet, which is
    // the same class of untruth as the privacy copy this screen is careful
    // about. The negative is the assertion now.
    const tree = await renderScreen();
    const text = allText(tree.toJSON());

    expect(text).not.toContain('Apple Health sync');
    expect(text).not.toContain('Scoped, opt-in, privacy-reviewed');
    // …and the real thing is on screen instead.
    expect(byTestId(tree, 'health-setting-apple-health').length).toBeGreaterThan(0);
  });
});

describe('HealthMoreScreen — Alert cancel paths (matrix 037)', () => {
  it('HEALTH-MORE-037: cancelling the sign-out Alert does not log out', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Sign out'));

    const cancel = alertButtons('Sign out').find((b) => b.style === 'cancel');
    expect(cancel?.text).toBe('Cancel');

    await act(async () => {
      cancel?.onPress?.();
    });

    expect(mockLogout).not.toHaveBeenCalled();
    // Screen is still mounted and interactive.
    expect(byTestId(tree, 'health-more-screen')).toHaveLength(1);
    expect(allText(tree.toJSON())).toContain('Sign out');
  });
});

describe('HealthMoreScreen — privacy copy (matrix 038)', () => {
  it('HEALTH-MORE-038: states where the data actually lives, honestly', async () => {
    // Rewritten 2026-07-25. This used to assert "on this device only" and "no
    // cloud sync". Parity phase P1 moved the record of truth to Health's own
    // Worker + D1, so that copy became FALSE — the app was telling users their
    // health data never left the handset while it was being synced. The claims
    // asserted here are the ones that are still true, and the negative below
    // stops the old wording creeping back.
    //
    // ONE OF THEM IS STILL WRONG: see HEALTH-MORE-083 in
    // src/features/health/__tests__/areas/more.signout-privacy-posture.test.ts —
    // "never sent to an AI provider" is contradicted by the shipped Coach.
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Where your data lives'));

    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Where your data lives');
    const body: string = call?.[1] ?? '';

    expect(body).toMatch(/private Symply Health account/i);
    expect(body).toMatch(/never shared with other Symply apps/i);
    expect(body).toMatch(/signing out clears the copy cached on this device/i);

    // The retired, now-untrue claims must not return.
    expect(body).not.toMatch(/on this device only/i);
    expect(body).not.toMatch(/no cloud sync/i);
  });
});

describe('HealthMoreScreen — profile navigation (matrix 040)', () => {
  it('HEALTH-MORE-040: routes the Profile row to /profile', async () => {
    const tree = await renderScreen();
    // Addressable by testID since 2026-07-26 — `more-navigation-rows.yaml` taps
    // `health-setting-profile` rather than matching the word "Profile", which
    // also appears in the header and in the avatar's accessibility label.
    expect(byTestId(tree, 'health-setting-profile')).not.toHaveLength(0);

    act(() => pressById(tree, 'health-setting-profile'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/profile');
  });
});

/* ------------------------------------------------------------------ *
 * Apple Health connect flow (matrix HEALTH-MORE-048..054).
 *
 * `handleHealthKit` is the whole orchestration behind the card: it re-reads the
 * status, asks for permission only when not already connected, imports on
 * success, and re-reads once more so "last synced" is true. Every branch of it
 * was unexecuted — the card rendered, but nothing ever tapped it.
 *
 * The invariant across all of them: a denied or unavailable HealthKit is a
 * NORMAL state. No alert, no toast, no system string, and manual entry is never
 * blocked.
 * ------------------------------------------------------------------ */

describe('HealthMoreScreen — Apple Health connect flow', () => {
  it('HEALTH-MORE-048: connecting asks for permission, imports, then re-reads the status', async () => {
    mockGetStatus
      .mockResolvedValueOnce(hkStatus('not-requested'))
      .mockResolvedValueOnce(hkStatus('not-requested'))
      // RELATIVE to now, not a fixed date. A hard-coded `2026-07-25T09:00Z`
      // rendered "Synced 2 h ago" while it was still that morning and
      // "Synced yesterday" after midnight — a test that passed or failed
      // depending on the wall clock when it happened to run.
      .mockResolvedValue(
        hkStatus('connected', {
          lastSyncedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        }),
      );
    mockRequestPermission.mockResolvedValue(hkStatus('connected'));

    const tree = await renderScreen();
    await act(async () => {
      pressById(tree, 'health-setting-apple-health-action');
    });

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    // The import must run only AFTER permission came back connected…
    expect(mockImportNow).toHaveBeenCalledTimes(1);
    // …and the status is re-read afterwards, or "last synced" would show the
    // instant before the import instead of the one after it.
    expect(mockGetStatus).toHaveBeenCalledTimes(3);
    expect(allText(tree.toJSON())).toContain('Apple Health connected');
    expect(allText(tree.toJSON())).toMatch(/Synced .* ago/);
  });

  it('HEALTH-MORE-049: an already-connected card syncs WITHOUT re-prompting', async () => {
    // "Sync now" on a connected card must not put the OS permission sheet back
    // in front of someone who already granted it.
    mockGetStatus.mockResolvedValue(hkStatus('connected'));

    const tree = await renderScreen();
    await act(async () => {
      pressById(tree, 'health-setting-apple-health-action');
    });

    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(mockImportNow).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-MORE-050: a DENIED result imports nothing and surfaces no error', async () => {
    // Denied is a legitimate privacy choice, not a failure: no alert, no system
    // string, and the card explains the state itself.
    mockGetStatus.mockResolvedValue(hkStatus('not-requested'));
    mockRequestPermission.mockResolvedValue(hkStatus('denied'));

    const tree = await renderScreen();
    await act(async () => {
      pressById(tree, 'health-setting-apple-health-action');
    });

    expect(mockImportNow).not.toHaveBeenCalled();
    expect(Alert.alert as jest.Mock).not.toHaveBeenCalled();
    expect(allText(tree.toJSON())).not.toMatch(/error|failed|denied by the system/i);
    // The banner is now collapsed to a single row + action; the calm refusal
    // and "everything still works" copy live one (i) tap away.
    expect(byTestId(tree, 'health-setting-apple-health-action').length).toBeGreaterThan(0);
    await act(async () => {
      pressById(tree, 'health-setting-apple-health-info');
    });
    const text = allText(tree.toJSON());
    expect(text).toContain('That’s a fine choice');
    expect(text).toContain('Everything still works.');
  });

  it('HEALTH-MORE-051: the denied card routes to iOS Settings rather than nagging', async () => {
    mockGetStatus.mockResolvedValue(hkStatus('denied'));
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);

    const tree = await renderScreen();
    await act(async () => {
      pressById(tree, 'health-setting-apple-health-action');
    });

    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });

  it('HEALTH-MORE-052: a REJECTED import leaks no system string and unsticks the button', async () => {
    // FIXED 2026-07-25. `handleHealthKit` had a `try/finally` and no `catch`,
    // and the call site is `void handleHealthKit()` — so a native bridge
    // rejection (an HKError, a grant revoked mid-import) escaped as an
    // UNHANDLED promise rejection carrying the raw `HKErrorDomain` string, in
    // the one screen that promises never to show a system string. It now
    // re-reads the status instead: whatever the OS reports is the truth, and
    // the card has honest copy for every state.
    mockGetStatus.mockResolvedValue(hkStatus('connected'));
    mockImportNow.mockRejectedValue(new Error('HKErrorDomain 6'));

    const tree = await renderScreen();
    await act(async () => {
      pressById(tree, 'health-setting-apple-health-action');
    });

    const action = tree.root.find(
      (n) => n.props?.testID === 'health-setting-apple-health-action' && 'disabled' in n.props,
    );
    expect(action.props.disabled).toBe(false);
    expect(allText(tree.toJSON())).not.toContain('HKErrorDomain');
    expect(Alert.alert as jest.Mock).not.toHaveBeenCalled();
    // Manual entry is untouched — the units picker still opens.
    act(() => pressById(tree, 'health-setting-units'));
    expect(byTestId(tree, 'health-units-picker')).toHaveLength(1);
  });

  it('HEALTH-MORE-054: a status re-read that ALSO fails leaves the card silent, not crashed', async () => {
    // The worst case: the import rejects and the follow-up `getStatus()` rejects
    // too. Rendering no card at all is the honest outcome; a second unhandled
    // rejection is not.
    mockGetStatus
      .mockResolvedValueOnce(hkStatus('connected'))
      .mockResolvedValueOnce(hkStatus('connected'))
      .mockRejectedValue(new Error('bridge gone'));
    mockImportNow.mockRejectedValue(new Error('HKErrorDomain 6'));

    const tree = await renderScreen();
    await act(async () => {
      pressById(tree, 'health-setting-apple-health-action');
    });

    expect(byTestId(tree, 'health-setting-apple-health')).toHaveLength(0);
    expect(allText(tree.toJSON())).not.toContain('bridge gone');
    // The rest of the tab is unaffected.
    expect(byTestId(tree, 'health-more-screen')).toHaveLength(1);
    expect(allText(tree.toJSON())).toContain('PREFERENCES');
  });

  it('HEALTH-MORE-053: an unavailable bridge offers no action at all', async () => {
    // No simulator, no iPhone, no HealthKit — the card states it and stops.
    // Offering a Connect button that can only ever fail would be a lie.
    mockGetStatus.mockResolvedValue(hkStatus('unavailable'));

    const tree = await renderScreen();

    expect(byTestId(tree, 'health-setting-apple-health-action')).toHaveLength(0);
    expect(byTestId(tree, 'health-setting-apple-health-settings')).toHaveLength(0);
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });
});

describe('HealthMoreScreen — layout & scoping (matrix 041, 043, 044)', () => {
  it('HEALTH-MORE-041: caps AdaptiveContainer width on iPad and leaves it uncapped on phone', async () => {
    const phone = await renderScreen();
    expect(phone.root.findByType(AdaptiveContainer).props.maxWidth).toBeUndefined();

    mockWindow = IPAD;
    const tablet = await renderScreen();
    expect(tablet.root.findByType(AdaptiveContainer).props.maxWidth).toBe(1000);
  });

  it('HEALTH-MORE-043: exposes the scroll container and the scroll-end sentinel', async () => {
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-more-scroll')).toHaveLength(1);
    expect(byTestId(tree, 'health-more-screen-scroll-end')).toHaveLength(1);
  });

  it('HEALTH-MORE-044: shows no House/Budget surfaces on the Health More tab', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    for (const forbidden of [
      'Households',
      'Properties',
      'Contractors',
      'Subscription',
      'Budget',
      'Reports',
      'Chat',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Matrix HEALTH-MORE-068..075 — the states this screen can be in that
 * nothing rendered before: an UNENTITLED account, a hook whose copy
 * changed, the first paint before the async reads resolve, and the
 * in-flight import.
 * ------------------------------------------------------------------ */

/** A promise that never settles — models "the read has not come back yet". */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

describe('HealthMoreScreen — AI assistance gate (matrix 068-069)', () => {
  it('HEALTH-MORE-068: hides the AI row entirely when the entry is not shown', async () => {
    // `show` is false for an account with no AI entitlement and no BYOK — the
    // row must be ABSENT, not disabled-but-tappable. A rendered-then-refused
    // row would advertise a paid surface inside a privacy section, and the
    // route it points at is the one place BYOK keys are entered.
    mockAiEntry = { ...DEFAULT_AI_ENTRY, show: false };
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-setting-ai-assistance')).toHaveLength(0);
    const text = allText(tree.toJSON());
    expect(text).not.toContain('AI assistance');
    expect(text).not.toContain('Connect OpenAI, Claude, or Gemini');

    // The rest of PRIVACY & DATA is untouched — hiding the row must not take
    // the section (or the HealthKit card and the two data verbs) with it.
    expect(text).toContain('PRIVACY');
    expect(byTestId(tree, 'health-setting-on-device-storage')).toHaveLength(1);
    expect(byTestId(tree, 'health-setting-apple-health').length).toBeGreaterThan(0);
    expect(byTestId(tree, 'health-setting-export')).toHaveLength(1);
    expect(byTestId(tree, 'health-setting-clear-data')).toHaveLength(1);

    // And nothing on the screen can reach the hub while the gate is closed.
    for (const id of ['health-setting-on-device-storage', 'health-setting-profile']) {
      act(() => pressById(tree, id));
    }
    expect(mockPush).not.toHaveBeenCalledWith('/ai-access');
  });

  it('HEALTH-MORE-069: renders the SHARED entry verbatim rather than its own copy', async () => {
    // `useAIAccessEntry` is the single source of truth for this row across all
    // five brands: same gate, same destination, same words, same glyph. The
    // screen is only allowed to render what the hook returns. Feeding it a
    // different entry proves nothing here is hardcoded — if Health had baked in
    // "AI assistance" / 'sparkles-outline', the strings below would not appear.
    mockAiEntry = {
      ...DEFAULT_AI_ENTRY,
      title: 'AI providers',
      subtitle: 'Anthropic active',
      icon: 'key-outline',
    };
    const tree = await renderScreen();

    const text = allText(tree.toJSON());
    expect(text).toContain('AI providers');
    expect(text).toContain('Anthropic active');
    expect(text).not.toContain('Connect OpenAI, Claude, or Gemini');

    const row = rowByTitle(tree, 'AI providers');
    expect(rowIcons(row)[0].props.name).toBe('key-outline');

    // The destination is the hook's too, not a literal in this file.
    act(() => pressById(tree, 'health-setting-ai-assistance'));
    expect(mockPush).toHaveBeenCalledWith(mockAiEntry.route);
  });
});

describe('HealthMoreScreen — first paint (matrix 070, 075)', () => {
  it('HEALTH-MORE-070: renders no Apple Health card until getStatus() resolves', async () => {
    // `healthKitStatus` starts null and the card is behind `status ? … : null`.
    // Until the bridge answers there is nothing honest to say about it, so the
    // section renders WITHOUT the card rather than with a guessed state — and
    // the rest of the tab has to stay fully usable meanwhile.
    mockGetStatus.mockReturnValue(pending<HealthKitStatus>());
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-setting-apple-health')).toHaveLength(0);
    expect(byTestId(tree, 'health-setting-apple-health-action')).toHaveLength(0);
    expect(byTestId(tree, 'health-more-screen')).toHaveLength(1);
    expect(allText(tree.toJSON())).toContain('Where your data lives');

    // Still interactive: the info alert opens with no HealthKit status at all.
    act(() => pressById(tree, 'health-setting-on-device-storage'));
    expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Where your data lives')).toBe(
      true,
    );
  });

  it('HEALTH-MORE-075: shows DEFAULTS, never a blank subtitle, before the reads land', async () => {
    // Three async reads feed three subtitles. `useState(DEFAULT_*)` is what
    // stops each of them rendering an empty second line for the frame between
    // mount and the answer — and the documented defaults are the same values
    // the Worker returns for an account that never saved, so the row does not
    // flicker from one truth to another either.
    mockLoadHealthPrefs.mockReturnValue(pending<HealthPrefs>());
    mockLoadNotifyPrefs.mockReturnValue(pending());
    mockLoadWidgetPrefs.mockReturnValue(pending());
    const tree = await renderScreen();

    expect(allText(byTestId(tree, 'health-setting-units-subtitle')[0].props.children)).toBe(
      'Metric (kg, cm, km)',
    );
    expect(allText(byTestId(tree, 'health-setting-notifications-subtitle')[0].props.children)).toBe(
      describeNotificationPreferences(DEFAULT_HEALTH_NOTIFICATION_PREFERENCES),
    );
    expect(allText(byTestId(tree, 'health-setting-widget-subtitle')[0].props.children)).toBe(
      describeWidgetPreferences(DEFAULT_HEALTH_WIDGET_PREFERENCES),
    );
  });
});

describe('HealthMoreScreen — in-flight import (matrix 071)', () => {
  it('HEALTH-MORE-071: disables the action and says "Syncing…" while the import runs', async () => {
    // `healthKitBusy` exists so a second tap cannot start a second import over
    // the top of the first. It was set and cleared but never OBSERVED: every
    // existing case resolves `importNow` inside the same `act`, so the busy
    // frame was never rendered and a regression that dropped `busy` (or left it
    // stuck true, stranding the button forever) would have passed.
    mockGetStatus.mockResolvedValue(hkStatus('connected'));
    let releaseImport!: () => void;
    mockImportNow.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseImport = () => resolve();
        }),
    );

    const tree = await renderScreen();
    const action = () =>
      tree.root.find(
        (n) => n.props?.testID === 'health-setting-apple-health-action' && 'disabled' in n.props,
      );
    expect(action().props.disabled).toBe(false);

    await act(async () => {
      pressById(tree, 'health-setting-apple-health-action');
    });

    // Mid-import: locked, and the label says what is happening rather than
    // swapping the text out for a spinner.
    expect(action().props.disabled).toBe(true);
    expect(allText(tree.toJSON())).toContain('Syncing…');
    expect(mockImportNow).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseImport();
    });

    expect(action().props.disabled).toBe(false);
    expect(allText(tree.toJSON())).not.toContain('Syncing…');
    expect(mockImportNow).toHaveBeenCalledTimes(1);
  });
});

describe('HealthMoreScreen — inert info alert (matrix 073)', () => {
  it('HEALTH-MORE-073: the privacy explainer is an INERT alert — title, message, no actions', async () => {
    // `showInfo` passes two arguments only, so iOS renders a lone OK. This row
    // sits in the same visual family as rows that DO write (units, export,
    // clear, sign out); if it ever grew a button array, a destructive action
    // would be one edit away from a row that promises to only explain.
    const tree = await renderScreen();
    act(() => pressById(tree, 'health-setting-on-device-storage'));

    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Where your data lives');
    expect(call).toBeDefined();
    expect(call).toHaveLength(2);
    expect(typeof call?.[1]).toBe('string');
    expect(mockSetUnitSystem).not.toHaveBeenCalled();
    expect(mockClearAll).not.toHaveBeenCalled();
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * The ADMIN switchboard (matrix 095-096).
 *
 * `HEALTH_FEATURES` gates whole trackers. The row is staff tooling — a member
 * who could reach it could switch off half their own app and would have no way
 * to tell that is what they had done.
 * ------------------------------------------------------------------ */

describe('HealthMoreScreen — admin section', () => {
  it('HEALTH-MORE-095: renders no ADMIN section for an ordinary member', async () => {
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).not.toContain('ADMIN');
    expect(byTestId(tree, 'health-setting-features')).toHaveLength(0);
  });

  it('HEALTH-MORE-096: shows the switchboard to staff, counting what is on', async () => {
    mockIsAdmin = true;
    mockFeatureMap = Object.fromEntries(
      HEALTH_FEATURES.map((f, index) => [f.key, index % 2 === 0]),
    );
    const expectedOn = HEALTH_FEATURES.filter((f) => mockFeatureMap[f.key]).length;

    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('ADMIN');
    expect(allText(byTestId(tree, 'health-setting-features-subtitle')[0].props.children)).toBe(
      `${expectedOn} of ${HEALTH_FEATURES.length} trackers on`,
    );

    act(() => pressById(tree, 'health-setting-features'));
    expect(mockPush).toHaveBeenCalledWith('/health-features');
  });
});

/* ------------------------------------------------------------------ *
 * The two DATA verbs (matrix 097-102).
 *
 * Both walk the WHOLE account, both block the screen while they run, and both
 * report in words a member can act on. Neither may ever put a system or network
 * string on screen — this is the same screen that promises it never does.
 * ------------------------------------------------------------------ */

describe('HealthMoreScreen — export my data', () => {
  it('HEALTH-MORE-097: blocks the screen while exporting, then reports the outcome', async () => {
    let release!: (value: unknown) => void;
    mockExport.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    const tree = await renderScreen();
    expect(byTestId(tree, 'health-data-overlay')).toHaveLength(0); // nothing at rest

    await act(async () => {
      pressById(tree, 'health-setting-export');
    });

    // Mid-export: the shared blocking overlay, with the EXPORT copy — the same
    // overlay serves the clear job, so the message is how a member knows which
    // of the two irreversible-looking jobs is actually running.
    const overlay = byTestId(tree, 'health-data-overlay');
    expect(overlay).toHaveLength(1);
    expect(allText(overlay[0].props.children)).toContain('Preparing your export…');
    expect(allText(overlay[0].props.children)).toContain('Collecting every entry in your account');
    expect(Alert.alert as jest.Mock).not.toHaveBeenCalled();

    await act(async () => {
      release({ status: 'shared', message: 'Saved 412 entries.', rows: 412 });
    });

    expect(byTestId(tree, 'health-data-overlay')).toHaveLength(0);
    expect(Alert.alert as jest.Mock).toHaveBeenCalledWith('Export ready', 'Saved 412 entries.');
  });

  it('HEALTH-MORE-098: a failed export says so in words and clears the overlay', async () => {
    // The failure title is deliberately NOT "Export ready", and the message is
    // the verb's friendly copy — never a network or file-system string.
    mockExport.mockResolvedValue({
      status: 'failed',
      message: 'We could not put your export together just now. Check your connection and try again.',
      rows: 0,
    });

    const tree = await renderScreen();
    await act(async () => {
      pressById(tree, 'health-setting-export');
    });

    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Export');
    expect(call).toBeDefined();
    expect(String(call?.[1])).toMatch(/could not put your export together/i);
    expect(String(call?.[1])).not.toMatch(/error|ENOENT|Network request failed/i);
    expect(byTestId(tree, 'health-data-overlay')).toHaveLength(0);
    // The screen is still usable after a failure.
    expect(byTestId(tree, 'health-more-screen')).toHaveLength(1);
  });
});

describe('HealthMoreScreen — clear all health data', () => {
  it('HEALTH-MORE-099: the row expands an inventory panel and deletes nothing yet', async () => {
    // Step one of two. The panel enumerates what goes and what stays BEFORE any
    // confirmation is offered, because "delete everything" is exactly the kind
    // of promise a member should be able to check rather than trust.
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-clear-data-panel')).toHaveLength(0);

    act(() => pressById(tree, 'health-setting-clear-data'));

    const panel = byTestId(tree, 'health-clear-data-panel');
    expect(panel).toHaveLength(1);
    const text = instanceText(panel[0]);
    expect(text).toContain('This deletes');
    expect(text).toContain('This is kept');
    for (const line of HEALTH_CLEAR_DELETES) expect(text).toContain(line);
    for (const line of HEALTH_CLEAR_KEPT) expect(text).toContain(line);
    expect(text).toContain('It cannot be undone');

    // Opening the panel is not a confirmation.
    expect(mockClearAll).not.toHaveBeenCalled();
    expect(Alert.alert as jest.Mock).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-data-overlay')).toHaveLength(0);

    // …and it collapses again without doing anything.
    act(() => pressById(tree, 'health-setting-clear-data'));
    expect(byTestId(tree, 'health-clear-data-panel')).toHaveLength(0);
    expect(mockClearAll).not.toHaveBeenCalled();
  });

  it('HEALTH-MORE-100: the panel button asks the system, and Cancel deletes nothing', async () => {
    const tree = await renderScreen();
    act(() => pressById(tree, 'health-setting-clear-data'));
    act(() => pressById(tree, 'health-clear-data-confirm'));

    const call = (Alert.alert as jest.Mock).mock.calls.find(
      (c) => c[0] === 'Delete all health data?',
    );
    expect(call).toBeDefined();
    expect(String(call?.[1])).toMatch(/cannot be undone/i);
    const buttons = alertButtons('Delete all health data?');
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Delete everything']);
    expect(buttons[1].style).toBe('destructive');

    await act(async () => {
      buttons.find((b) => b.style === 'cancel')?.onPress?.();
    });

    expect(mockClearAll).not.toHaveBeenCalled();
    // The panel stays open so the member can read it again or confirm properly.
    expect(byTestId(tree, 'health-clear-data-panel')).toHaveLength(1);
    expect(byTestId(tree, 'health-more-screen')).toHaveLength(1);
  });

  it('HEALTH-MORE-101: confirming deletes, blocks, collapses, and re-reads preferences', async () => {
    let release!: (value: unknown) => void;
    mockClearAll.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    const tree = await renderScreen();
    const readsBefore = mockLoadHealthPrefs.mock.calls.length;

    act(() => pressById(tree, 'health-setting-clear-data'));
    act(() => pressById(tree, 'health-clear-data-confirm'));

    await act(async () => {
      alertButtons('Delete all health data?').find((b) => b.style === 'destructive')?.onPress?.();
    });

    // Mid-delete: blocked, with the CLEAR copy rather than the export copy.
    const overlay = byTestId(tree, 'health-data-overlay');
    expect(overlay).toHaveLength(1);
    expect(allText(overlay[0].props.children)).toContain('Deleting your health data…');
    expect(allText(overlay[0].props.children)).toContain(
      'Removing every entry from your account',
    );
    expect(mockClearAll).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ status: 'cleared', message: 'Your health data has been deleted.', deleted: 9, failed: 0 });
    });

    expect(byTestId(tree, 'health-data-overlay')).toHaveLength(0);
    // The panel closes — leaving it open would invite a second run against an
    // account that now has nothing in it.
    expect(byTestId(tree, 'health-clear-data-panel')).toHaveLength(0);
    // Preferences are re-read: the caches were dropped, so the subtitles must
    // fall back to the documented defaults instead of showing deleted state.
    expect(mockLoadHealthPrefs.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(Alert.alert as jest.Mock).toHaveBeenCalledWith(
      'Health data deleted',
      'Your health data has been deleted.',
    );
  });

  it('HEALTH-MORE-102: a PARTIAL clear says so, and never with a system string', async () => {
    // The dangerous outcome is the quiet one: a member told "deleted" when some
    // rows could not be reached would never run it again. The title itself has
    // to carry the bad news.
    mockClearAll.mockResolvedValue({
      status: 'partial',
      message:
        'Most of your health data was deleted, but some records could not be reached. Run it again to finish.',
      deleted: 300,
      failed: 12,
    });

    const tree = await renderScreen();
    act(() => pressById(tree, 'health-setting-clear-data'));
    act(() => pressById(tree, 'health-clear-data-confirm'));
    await act(async () => {
      alertButtons('Delete all health data?').find((b) => b.style === 'destructive')?.onPress?.();
    });

    const call = (Alert.alert as jest.Mock).mock.calls.find(
      (c) => c[0] === 'Not everything was deleted',
    );
    expect(call).toBeDefined();
    expect(String(call?.[1])).toMatch(/Run it again to finish/i);
    expect(String(call?.[1])).not.toMatch(/Error|500|Network request failed/);
    expect(byTestId(tree, 'health-data-overlay')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * The "YOUR DEVICES" section (plan §6 / He5).
 *
 * The row is the only way into second-device enrolment, and the
 * two-device suite scrolls More looking for it by id. It is also the
 * row most likely to be written in the wrong voice: Health is one user
 * with N devices (plan §1.2), so there is nobody to invite, and
 * `td-40-no-invite-partner-copy.yaml` sweeps this tab for that.
 * ------------------------------------------------------------------ */

describe('HealthMoreScreen — your devices', () => {
  it('hides the row entirely on a build with no local ledger', async () => {
    // Not disabled-but-tappable: without the ledger there is no household key
    // to hand over, so the row would offer a setup that cannot complete.
    mockLocalFirst = false;
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-setting-other-device')).toHaveLength(0);
    const text = allText(tree.toJSON());
    expect(text).not.toContain('YOUR DEVICES');
    expect(text).not.toContain('Add your other device');
    // The section it sits above is untouched.
    expect(byTestId(tree, 'health-setting-on-device-storage')).toHaveLength(1);
  });

  it('routes the row to the enrolment screen, in device words', async () => {
    mockLocalFirst = true;
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-setting-other-device')).not.toHaveLength(0);
    const text = allText(tree.toJSON());
    expect(text).toContain('YOUR DEVICES');
    expect(text).toContain('Add your other device');

    act(() => pressById(tree, 'health-setting-other-device'));
    expect(mockPush).toHaveBeenCalledWith('/health-other-device');
  });

  it('adds no invite / member / partner copy to the tab', async () => {
    // The exact patterns `td-40` asserts the absence of across every Health
    // screen, run against the tab with the new section showing.
    mockLocalFirst = true;
    const tree = await renderScreen();
    const text = allText(tree.toJSON());

    for (const pattern of [/invite/i, /household member/i, /add member/i, /join household/i]) {
      expect([pattern.source, pattern.test(text)]).toEqual([pattern.source, false]);
    }
    // The one row that talks about where data lives keeps talking about DEVICES.
    expect(text).toContain('Private to your account, synced across your devices');
  });
});
