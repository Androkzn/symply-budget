/**
 * Symply Health — the Weight tab.
 *
 * Renders the REAL screen through <ThemeProvider> and drives the paths the
 * donor's `WeightTabView` + `WeightDashboardView` own and the RN app previously
 * had no home for: past-window navigation, back-dated logging, editing a
 * reading in place, deleting one, setting a goal, and reordering the dashboard.
 *
 * Only the storage-backed async functions are mocked; the pure derivation stays
 * real (it owns its coverage in `../../__tests__/healthWeightAnalytics.test.ts`),
 * so what is asserted here is the SCREEN's use of them.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { loadBodyEntries, type BodyEntry } from '../../healthBodyStorage';
import {
  addWeightEntry,
  deleteWeightEntry,
  loadHealthPrefs,
  loadWeightLog,
  updateWeightEntry,
  type WeightEntry,
} from '../../healthLocalStorage';
import { loadMeals, type MealEntry } from '../../healthNutritionStorage';
import {
  EMPTY_WEIGHT_GOAL,
  loadWeightGoal,
  loadWeightLayout,
  saveWeightGoal,
  saveWeightLayout,
  DEFAULT_WEIGHT_LAYOUT,
  type WeightGoal,
  type WeightLayout,
} from '../../healthWeightStorage';
import { HealthWeightScreen } from '../HealthWeightScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

// This suite renders the screen standalone, with no real NavigationContainer,
// so the real `useFocusEffect` (used to re-hydrate on focus/HealthKit sync)
// would throw the instant it mounts. Same inert-callback shim
// HealthSectionScreens.test.tsx uses.
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactActual = jest.requireActual('react');
    ReactActual.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

// The charts render through gifted-charts' SVG; stub them so the suite asserts
// the screen's wiring rather than the library's output (the primitives own
// their coverage in src/components/ui/__tests__).
jest.mock('react-native-gifted-charts', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    LineChart: (props: Record<string, unknown>) =>
      ReactMock.createElement(View, {
        testID: 'line-chart',
        accessibilityValue: {
          text: JSON.stringify({
            referenceLine1Position: props.referenceLine1Position ?? null,
            yAxisOffset: props.yAxisOffset ?? null,
          }),
        },
      }),
    BarChart: () => ReactMock.createElement(View, { testID: 'bar-chart' }),
  };
});

jest.mock('../../healthLocalStorage', () => {
  const actual = jest.requireActual('../../healthLocalStorage');
  return {
    ...actual,
    loadWeightLog: jest.fn(),
    loadHealthPrefs: jest.fn(),
    addWeightEntry: jest.fn(),
    updateWeightEntry: jest.fn(),
    deleteWeightEntry: jest.fn(),
  };
});

jest.mock('../../healthWeightStorage', () => {
  const actual = jest.requireActual('../../healthWeightStorage');
  return {
    ...actual,
    loadWeightGoal: jest.fn(),
    saveWeightGoal: jest.fn(),
    loadWeightLayout: jest.fn(),
    saveWeightLayout: jest.fn(),
  };
});

jest.mock('../../healthNutritionStorage', () => {
  const actual = jest.requireActual('../../healthNutritionStorage');
  return { ...actual, loadMeals: jest.fn() };
});

jest.mock('../../healthBodyStorage', () => {
  const actual = jest.requireActual('../../healthBodyStorage');
  return { ...actual, loadBodyEntries: jest.fn() };
});

const mockLoadWeightLog = loadWeightLog as jest.Mock;
const mockLoadPrefs = loadHealthPrefs as jest.Mock;
const mockAdd = addWeightEntry as jest.Mock;
const mockUpdate = updateWeightEntry as jest.Mock;
const mockDelete = deleteWeightEntry as jest.Mock;
const mockLoadGoal = loadWeightGoal as jest.Mock;
const mockSaveGoal = saveWeightGoal as jest.Mock;
const mockLoadLayout = loadWeightLayout as jest.Mock;
const mockSaveLayout = saveWeightLayout as jest.Mock;
const mockLoadMeals = loadMeals as jest.Mock;
const mockLoadBody = loadBodyEntries as jest.Mock;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

function entry(date: string, value: number, over: Partial<WeightEntry> = {}): WeightEntry {
  return {
    id: `w-${date}`,
    value,
    unit: 'kg',
    loggedAt: `${date}T08:00:00.000Z`,
    date,
    note: '',
    source: 'manual',
    ...over,
  };
}

function goal(over: Partial<WeightGoal> = {}): WeightGoal {
  return { ...EMPTY_WEIGHT_GOAL, ...over };
}

function layout(over: Partial<WeightLayout> = {}): WeightLayout {
  return { ...DEFAULT_WEIGHT_LAYOUT, ...over };
}

function bodyEntry(
  date: string,
  metric: BodyEntry['metric'],
  value: number,
  unit = '%'
): BodyEntry {
  return { id: `b-${metric}-${date}`, date, metric, value, unit, loggedAt: `${date}T07:00:00.000Z` };
}

function meal(date: string, calories: number, id = `m-${date}-${calories}`): MealEntry {
  return {
    id,
    date,
    slot: 'lunch',
    name: 'Lunch',
    calories,
    protein: 0,
    carbs: 0,
    fat: 0,
    loggedAt: `${date}T12:00:00.000Z`,
  };
}

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthWeightScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const target = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  act(() => target.props.onPress());
}

async function pressAsync(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const target = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  await act(async () => {
    await target.props.onPress();
  });
}

function type(tree: ReactTestRenderer.ReactTestRenderer, testID: string, value: string) {
  const target = tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID
  );
  act(() => target.props.onChangeText(value));
}

function node(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find((n) => typeof n.type === 'string' && n.props?.testID === testID);
}

function field(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID
  );
}

/** A stat tile announces itself as "Label: value" — the string VoiceOver reads. */
function tile(tree: ReactTestRenderer.ReactTestRenderer, testID: string): string {
  return node(tree, testID).props.accessibilityLabel as string;
}

/** Depth-first search of the RENDERED json for a node carrying `testID`. */
function findJson(json: unknown, testID: string): { children?: unknown } | null {
  if (json == null || typeof json !== 'object') return null;
  if (Array.isArray(json)) {
    for (const child of json) {
      const hit = findJson(child, testID);
      if (hit) return hit;
    }
    return null;
  }
  const candidate = json as { props?: Record<string, unknown>; children?: unknown };
  if (candidate.props?.testID === testID) return candidate;
  return findJson(candidate.children, testID);
}

function text(tree: ReactTestRenderer.ReactTestRenderer, testID: string): string {
  const found = findJson(tree.toJSON(), testID);
  if (found === null) throw new Error(`no node with testID "${testID}"`);
  return allText(found);
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAll((n) => n.props?.testID === testID).length > 0;
}

const LOG = [
  entry(TODAY, 80),
  entry('2026-07-12', 80.5),
  entry('2026-07-11', 81),
  entry('2026-06-20', 84),
  entry('2026-05-04', 90),
];

/**
 * `LOG` always carries a TODAY reading, so the default "LOG A WEIGHT" card
 * — gated on `weightHasGapThisWeek`, which only looks at this ISO week
 * through today — is hidden against it. Tests that need the blank/default
 * form on screen (rather than reaching it via an edit or a tapped gap) swap
 * in this variant instead of changing the shared fixture every other test
 * (window labels, "4 readings", summary figures) is pinned to.
 */
const LOG_GAP_TODAY = LOG.filter((e) => e.date !== TODAY);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
  mockLoadWeightLog.mockResolvedValue(LOG);
  mockLoadPrefs.mockResolvedValue({ preferredUnit: 'kg', healthKitEnabled: false, aiEnabled: false });
  mockLoadGoal.mockResolvedValue(goal());
  mockLoadLayout.mockResolvedValue(layout());
  mockSaveLayout.mockImplementation((patch: Partial<WeightLayout>) =>
    Promise.resolve(layout(patch))
  );
  mockSaveGoal.mockImplementation((patch: Record<string, unknown>) =>
    Promise.resolve(goal({ targetKg: (patch.target as number) ?? null }))
  );
  mockLoadMeals.mockResolvedValue([]);
  mockLoadBody.mockResolvedValue([]);
  mockAdd.mockResolvedValue(LOG);
  mockUpdate.mockResolvedValue(LOG);
  mockDelete.mockResolvedValue(LOG.slice(1));
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Window navigation                                                   */
/* ------------------------------------------------------------------ */

describe('HealthWeightScreen — the past-window navigator', () => {
  it('HEALTH-WEIGHT-300: opens on the calendar month CONTAINING today, with ▶ disabled', async () => {
    const tree = await render();
    expect(node(tree, 'health-weight-window-label').props.children).toBe('1 Jul – 31 Jul');
    expect(node(tree, 'health-weight-window-next').props.accessibilityState.disabled).toBe(true);
  });

  it('HEALTH-WEIGHT-301: ◀ reaches a window trailing-only ranges never could', async () => {
    const tree = await render();
    press(tree, 'health-weight-window-previous');
    press(tree, 'health-weight-window-previous');
    expect(node(tree, 'health-weight-window-label').props.children).toBe('1 May – 31 May');
    expect(node(tree, 'health-weight-window-next').props.accessibilityState.disabled).toBe(false);
  });

  it('HEALTH-WEIGHT-302: ▶ walks back to today and stops there', async () => {
    const tree = await render();
    press(tree, 'health-weight-window-previous');
    press(tree, 'health-weight-window-next');
    press(tree, 'health-weight-window-next'); // already current — a no-op
    expect(node(tree, 'health-weight-window-label').props.children).toBe('1 Jul – 31 Jul');
  });

  it('HEALTH-WEIGHT-303: the window states how many readings are in it, in words', async () => {
    const tree = await render();
    // The current window is the calendar month of July, so the 20 June
    // reading is now outside it — only the three July readings count.
    expect(text(tree, 'health-weight-window-count')).toMatch(/3 readings/);

    // Two windows back reaches the 4 May reading — the whole point of the
    // navigator, and a reading a trailing-only "last 30 days" could never show.
    press(tree, 'health-weight-window-previous');
    press(tree, 'health-weight-window-previous');
    expect(text(tree, 'health-weight-window-count')).toMatch(/1 reading in this window/);

    // Further back there is nothing, and it says so rather than drawing an
    // empty axis.
    press(tree, 'health-weight-window-previous');
    press(tree, 'health-weight-window-previous');
    expect(text(tree, 'health-weight-window-count')).toMatch(/Nothing logged/i);
  });

  it('HEALTH-WEIGHT-304: changing the WIDTH returns to the current window and persists', async () => {
    const tree = await render();
    press(tree, 'health-weight-window-previous');
    await act(async () => {
      press(tree, 'health-weight-range-7');
    });
    // Keeping the offset would land on a different span than the one on screen.
    expect(node(tree, 'health-weight-window-next').props.accessibilityState.disabled).toBe(true);
    expect(mockSaveLayout).toHaveBeenCalledWith({ windowDays: 7 });
  });
});

/* ------------------------------------------------------------------ */
/* Logging, editing, deleting                                          */
/* ------------------------------------------------------------------ */

describe('HealthWeightScreen — entries', () => {
  it('HEALTH-WEIGHT-310: logs a reading with a date and a note', async () => {
    mockLoadWeightLog.mockResolvedValue(LOG_GAP_TODAY);
    const tree = await render();
    type(tree, 'health-weight-entry-value', '79.4');
    type(tree, 'health-weight-entry-date', '2026-07-10');
    type(tree, 'health-weight-entry-note', 'after a long flight');
    await pressAsync(tree, 'health-weight-entry-save');

    expect(mockAdd).toHaveBeenCalledWith(79.4, 'kg', {
      date: '2026-07-10',
      note: 'after a long flight',
    });
  });

  it('HEALTH-WEIGHT-311: a FUTURE date is refused, in words, and blocks the save', async () => {
    mockLoadWeightLog.mockResolvedValue(LOG_GAP_TODAY);
    const tree = await render();
    type(tree, 'health-weight-entry-value', '79.4');
    type(tree, 'health-weight-entry-date', '2027-01-01');

    expect(text(tree, 'health-weight-entry-date-error')).toMatch(/future/i);
    expect(node(tree, 'health-weight-entry-save').props.accessibilityState.disabled).toBe(true);
    await pressAsync(tree, 'health-weight-entry-save');
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('HEALTH-WEIGHT-312: a non-numeric weight cannot be saved', async () => {
    mockLoadWeightLog.mockResolvedValue(LOG_GAP_TODAY);
    const tree = await render();
    type(tree, 'health-weight-entry-value', 'abc');
    expect(node(tree, 'health-weight-entry-save').props.accessibilityState.disabled).toBe(true);
  });

  it('HEALTH-WEIGHT-313: editing loads the row and UPDATES it in place, keeping its id', async () => {
    const tree = await render();
    press(tree, 'health-weight-edit-w-2026-07-12');

    // The form is populated from the row being edited, not left blank.
    const value = tree.root.find(
      (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === 'health-weight-entry-value'
    );
    expect(value.props.value).toBe('80.5');

    type(tree, 'health-weight-entry-value', '80.9');
    await pressAsync(tree, 'health-weight-entry-save');

    // Not delete-then-re-add: that changes the row id and its logged time.
    expect(mockUpdate).toHaveBeenCalledWith('w-2026-07-12', {
      value: 80.9,
      unit: 'kg',
      date: '2026-07-12',
      note: null,
    });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('HEALTH-WEIGHT-314: cancelling an edit clears the form back to a fresh add', async () => {
    mockLoadWeightLog.mockResolvedValue(LOG_GAP_TODAY);
    const tree = await render();
    press(tree, 'health-weight-edit-w-2026-07-12');
    press(tree, 'health-weight-edit-cancel');
    const value = tree.root.find(
      (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === 'health-weight-entry-value'
    );
    expect(value.props.value).toBe('');
  });

  it('HEALTH-WEIGHT-315: deleting removes the row through the store', async () => {
    const tree = await render();
    await pressAsync(tree, 'health-weight-delete-w-2026-07-12');
    expect(mockDelete).toHaveBeenCalledWith('w-2026-07-12');
  });

  it('HEALTH-WEIGHT-316: an IMPORTED reading is marked, a typed one is not', async () => {
    mockLoadWeightLog.mockResolvedValue([
      entry(TODAY, 80, { id: 'imported', source: 'healthkit' }),
      entry('2026-07-12', 80.5, { id: 'typed' }),
    ]);
    const tree = await render();
    // An unexplained number a member did not type is the one they most need to
    // be able to identify before correcting it.
    expect(text(tree, 'health-weight-row-imported')).toMatch(/Apple Health/);
    expect(text(tree, 'health-weight-row-typed')).not.toMatch(/Apple Health/);
  });

  it('HEALTH-WEIGHT-317: history shows five rows and offers the rest behind "See all"', async () => {
    // `loadWeightLog` always answers newest-first; the screen renders the order
    // it is given.
    mockLoadWeightLog.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) =>
        entry(`2026-07-${String(9 - i).padStart(2, '0')}`, 80 + i)
      )
    );
    const tree = await render();
    expect(has(tree, 'health-weight-row-w-2026-07-09')).toBe(true);
    expect(has(tree, 'health-weight-row-w-2026-07-01')).toBe(false);
    press(tree, 'health-weight-history-see-all');
    expect(has(tree, 'health-weight-row-w-2026-07-01')).toBe(true);
  });

  it('HEALTH-WEIGHT-318: an empty log names the emptiness rather than showing a blank card', async () => {
    mockLoadWeightLog.mockResolvedValue([]);
    const tree = await render();
    expect(text(tree, 'health-weight-history-empty')).toMatch(/No weigh-ins/i);
  });
});

/* ------------------------------------------------------------------ */
/* Goal                                                                */
/* ------------------------------------------------------------------ */

// The "Goal & body details" editor (target/starting/height/birth year/sex/
// activity) no longer lives on this screen — the target itself is still set
// from HealthGoalsScreen and reaches the Weight tab as a read-only figure via
// the Goal Progress widget (now a fixed section, not a dashboard card) and the
// chart's reference rule, which is what this suite covers now.
describe('HealthWeightScreen — the goal', () => {
  it('HEALTH-WEIGHT-320: with no target, Goal Progress names what setting one unlocks', async () => {
    const tree = await render();
    expect(text(tree, 'health-weight-goal-empty')).toMatch(/goal line/i);
  });

  it('HEALTH-WEIGHT-323: the goal reaches the CHART as a reference rule, and Goal Progress as a figure', async () => {
    mockLoadGoal.mockResolvedValue(goal({ targetKg: 75 }));
    const tree = await render();
    const chart = tree.root.find(
      (n) => typeof n.type === 'string' && n.props?.testID === 'line-chart'
    );
    const props = JSON.parse(chart.props.accessibilityValue.text) as {
      referenceLine1Position: number | null;
      yAxisOffset: number | null;
    };
    expect(props.referenceLine1Position).toBe(75);
    // …and the axis is truncated so the rule is not drawn on top of the series.
    expect(props.yAxisOffset).toBeGreaterThan(0);
    expect(text(tree, 'health-weight-goal-target')).toContain('75');
  });
});

/* ------------------------------------------------------------------ */
/* The dashboard                                                       */
/* ------------------------------------------------------------------ */

describe('HealthWeightScreen — the dashboard', () => {
  it('HEALTH-WEIGHT-330: renders the default two dashboard widgets, and NOT weeklyChange/dataStack', async () => {
    const tree = await render();
    for (const key of ['mainChart', 'aiInsights']) {
      expect(has(tree, `health-weight-widget-${key}`)).toBe(true);
    }
    // "This week" and "Averages" are dropped from the screen entirely, not
    // just the default set — the same comparison is already a line inside
    // `aiInsights`.
    expect(has(tree, 'health-weight-widget-weeklyChange')).toBe(false);
    expect(has(tree, 'health-weight-widget-dataStack')).toBe(false);
    expect(has(tree, 'health-weight-widget-bmiTracker')).toBe(false);
  });

  it('HEALTH-WEIGHT-330b: Goal Progress renders as a fixed section regardless of the stored layout', async () => {
    mockLoadLayout.mockResolvedValue(layout({ widgets: ['streaks'] }));
    const tree = await render();
    expect(has(tree, 'health-weight-widget-goalProgress')).toBe(true);
  });

  it('HEALTH-WEIGHT-330c: a layout persisted before this change cannot double-render goalProgress, or render weeklyChange/dataStack at all', async () => {
    mockLoadLayout.mockResolvedValue(
      layout({ widgets: ['mainChart', 'dataStack', 'goalProgress', 'weeklyChange', 'aiInsights'] })
    );
    const tree = await render();
    expect(
      tree.root.findAll(
        (n) => typeof n.type === 'string' && n.props?.testID === 'health-weight-widget-goalProgress'
      ).length
    ).toBe(1);
    expect(has(tree, 'health-weight-widget-weeklyChange')).toBe(false);
    expect(has(tree, 'health-weight-widget-dataStack')).toBe(false);
  });

  it('HEALTH-WEIGHT-331: a stored layout is honoured, including the other nine', async () => {
    mockLoadLayout.mockResolvedValue(layout({ widgets: ['streaks', 'predictions'] }));
    const tree = await render();
    expect(has(tree, 'health-weight-widget-streaks')).toBe(true);
    expect(has(tree, 'health-weight-widget-mainChart')).toBe(false);
  });

  it('HEALTH-WEIGHT-332: an unknown stored key is skipped rather than crashing the tab', async () => {
    mockLoadLayout.mockResolvedValue(layout({ widgets: ['mainChart', 'notAWidget'] }));
    const tree = await render();
    expect(has(tree, 'health-weight-widget-mainChart')).toBe(true);
  });

  // HEALTH-WEIGHT-333/334/335 (Customise offer/toggle/reorder/reset in-screen)
  // retired: the in-screen "Customise" panel was extracted into the shared
  // `WidgetOrderSection` reachable from More → Customize Tabs (see
  // TabCustomizationScreen's "WEIGHT SCREEN WIDGETS" section). That
  // interaction is now covered directly at
  // src/components/customization/__tests__/WidgetOrderSection.test.tsx.

  it('HEALTH-WEIGHT-336: the chart mode toggles between the trend line and change bars', async () => {
    const tree = await render();
    await act(async () => {
      press(tree, 'health-weight-chart-mode-change');
    });
    expect(mockSaveLayout).toHaveBeenCalledWith({ chartMode: 'change' });
  });

  it('HEALTH-WEIGHT-337: the change chart is BARS with a real zero, not a truncated line', async () => {
    mockLoadLayout.mockResolvedValue(layout({ chartMode: 'change' }));
    const tree = await render();
    expect(has(tree, 'health-weight-chart-change-chart')).toBe(true);
    expect(allText(tree.toJSON())).toMatch(/difference from the previous day/i);
  });

  it('HEALTH-WEIGHT-342: the average rule can be switched off from the chart itself', async () => {
    const tree = await render();
    expect(allText(tree.toJSON())).toContain('Average line on');

    await act(async () => {
      press(tree, 'health-weight-chart-toggle-average');
    });

    expect(mockSaveLayout).toHaveBeenCalledWith({ showAverageLine: false });
    expect(allText(tree.toJSON())).toContain('Average line off');
  });

  it('HEALTH-WEIGHT-355: per-point values can be switched on from the chart itself', async () => {
    const tree = await render();
    expect(allText(tree.toJSON())).toContain('Values hidden');

    await act(async () => {
      press(tree, 'health-weight-chart-toggle-values');
    });

    expect(mockSaveLayout).toHaveBeenCalledWith({ showValues: true });
    expect(allText(tree.toJSON())).toContain('Values shown');
  });

  it('HEALTH-WEIGHT-343: the Measurements card sends you to the Body tab, not a second copy', async () => {
    mockLoadLayout.mockResolvedValue(layout({ widgets: ['measurements'] }));
    const tree = await render();

    press(tree, 'health-weight-measurements-open');
    expect(mockPush).toHaveBeenCalledWith('/health-body');
  });

  // HEALTH-WEIGHT-344 (drag a widget down) retired alongside 333/334/335 —
  // see the note above; reorder-down is covered in WidgetOrderSection.test.tsx.

  it('HEALTH-WEIGHT-345: hiding the goal LINE leaves the goal itself alone', async () => {
    mockLoadGoal.mockResolvedValue(goal({ targetKg: 75 }));
    const withLine = await render();
    expect(text(withLine, 'health-weight-chart-legend-rule')).toContain('Goal 75 kg');

    mockLoadLayout.mockResolvedValue(layout({ showGoalLine: false }));
    const withoutLine = await render();
    // The rule falls back to the average rather than disappearing, and the goal
    // is still set — a chart preference must not read as "goal cleared".
    const legend = text(withoutLine, 'health-weight-chart-legend-rule');
    expect(legend).toMatch(/^Average /);
    expect(legend).not.toContain('Goal');
    expect(text(withoutLine, 'health-weight-goal-target')).toContain('75');
  });
});

/* ------------------------------------------------------------------ */
/* What the series is made of                                          */
/* ------------------------------------------------------------------ */

describe('HealthWeightScreen — deriving the series', () => {
  it('HEALTH-WEIGHT-338: one axis carries ONE unit — the odd reading out is not plotted', async () => {
    mockLoadWeightLog.mockResolvedValue([
      entry(TODAY, 176.4, { id: 'lb-new', unit: 'lb' }),
      entry('2026-07-12', 80, { id: 'kg-one' }),
      entry('2026-07-11', 180, { id: 'lb-old', unit: 'lb' }),
    ]);
    mockLoadLayout.mockResolvedValue(layout({ widgets: ['weightHistory'] }));
    const tree = await render();

    // Plotting 80 kg beside 176.4 lb would draw a 96-unit cliff that never
    // happened, so the series carries only the unit the log is being kept in…
    expect(tile(tree, 'health-weight-history-starting')).toBe('Starting: 180 lb');
    expect(tile(tree, 'health-weight-history-current')).toBe('Current: 176.4 lb');
    expect(tile(tree, 'health-weight-history-lowest')).toBe('Lowest: 176.4 lb');

    // …and the odd reading is still in the log, in the unit it was typed in.
    expect(text(tree, 'health-weight-row-kg-one')).toContain('80 kg');
    expect(text(tree, 'health-weight-window-count')).toContain('3 readings');
  });

  it('HEALTH-WEIGHT-339: two weigh-ins on one day are ONE point — the newest', async () => {
    // Stepping on and off the scale twice is one morning, not a 3 kg swing.
    mockLoadWeightLog.mockResolvedValue([
      entry(TODAY, 79, { id: 'second' }),
      entry(TODAY, 82, { id: 'first' }),
      entry('2026-07-12', 80.5, { id: 'yesterday' }),
    ]);
    mockLoadLayout.mockResolvedValue(layout({ widgets: ['weightHistory'] }));
    const tree = await render();

    expect(tile(tree, 'health-weight-history-current')).toBe('Current: 79 kg');
    // 82 was the day's other reading; taking it as the high would invent a peak.
    expect(tile(tree, 'health-weight-history-highest')).toBe('Highest: 80.5 kg');

    // Both are still listed — the log keeps what was logged.
    expect(has(tree, 'health-weight-row-first')).toBe(true);
    expect(has(tree, 'health-weight-row-second')).toBe(true);
  });

  it('HEALTH-WEIGHT-340: the NEWEST body-fat reading splits the weight, in the log’s unit', async () => {
    mockLoadBody.mockResolvedValue([
      bodyEntry('2026-07-01', 'bodyFat', 30),
      bodyEntry('2026-07-10', 'bodyFat', 25),
      bodyEntry('2026-07-10', 'waist', 84, 'cm'),
    ]);
    mockLoadLayout.mockResolvedValue(layout({ widgets: ['bodyComposition'] }));

    const kg = await render();
    // 30% is last month's; a split built on it would describe a body that has
    // since changed. The waist reading is not a percentage at all.
    expect(tile(kg, 'health-weight-composition-fat-percent')).toBe('Body fat: 25%');
    expect(tile(kg, 'health-weight-composition-fat-mass')).toBe('Fat mass: 20 kg');
    expect(tile(kg, 'health-weight-composition-lean-mass')).toBe('Lean mass: 60 kg');

    mockLoadWeightLog.mockResolvedValue([entry(TODAY, 176.4, { unit: 'lb' })]);
    const lb = await render();
    // The formulas are metric whatever the log is in; only the display converts,
    // so a member logging in pounds gets the same split, stated in pounds.
    expect(tile(lb, 'health-weight-composition-fat-percent')).toBe('Body fat: 25%');
    expect(tile(lb, 'health-weight-composition-fat-mass')).toBe('Fat mass: 44.1 lb');
    expect(tile(lb, 'health-weight-composition-lean-mass')).toBe('Lean mass: 132.3 lb');
  });

  it('HEALTH-WEIGHT-341: two meals on one day are ONE day of calories', async () => {
    // The correlation pairs a WEEK of intake with that week's weight change, so
    // a day counted twice would halve the intake it reports.
    mockLoadWeightLog.mockResolvedValue([
      entry('2026-06-29', 81.5),
      entry('2026-06-22', 82),
      entry('2026-06-15', 83),
      entry('2026-06-08', 83.5),
      entry('2026-06-01', 84),
    ]);
    mockLoadMeals.mockResolvedValue([
      meal('2026-06-08', 300, 'breakfast'),
      meal('2026-06-08', 300, 'dinner'),
      meal('2026-06-15', 700),
      meal('2026-06-22', 800),
      meal('2026-06-29', 900),
    ]);
    mockLoadLayout.mockResolvedValue(layout({ widgets: ['calorieCorrelation'] }));
    const tree = await render();

    // 600 · 700 · 800 · 900 over four weeks. Two 300s read as two days would
    // make the first week 300 and the average 725.
    expect(tile(tree, 'health-weight-correlation-calories')).toBe('Avg intake: 750 kcal');
  });
});

/* ------------------------------------------------------------------ */
/* The entry form and the goal editor, at their edges                  */
/* ------------------------------------------------------------------ */

describe('HealthWeightScreen — form edges', () => {
  it('HEALTH-WEIGHT-346: a reading is stored in the member\'s global preferred unit (pounds)', async () => {
    // The unit is set once, app-wide, from More → Preferences → Units — there
    // is no per-entry toggle on this form to override it with. An empty log
    // is required to observe it: `dominantUnit` prefers an EXISTING log's own
    // unit over the preference (by design — one chart axis, one unit), so a
    // kg-dominant fixture like LOG/LOG_GAP_TODAY would mask this fallback.
    mockLoadPrefs.mockResolvedValue({ preferredUnit: 'lb', healthKitEnabled: false, aiEnabled: false });
    mockLoadWeightLog.mockResolvedValue([]);
    const tree = await render();
    expect(has(tree, 'health-weight-entry-unit-lb')).toBe(false);
    expect(has(tree, 'health-weight-entry-unit')).toBe(true);
    type(tree, 'health-weight-entry-value', '176.4');
    await pressAsync(tree, 'health-weight-entry-save');

    // Converting on the way in would lose the unit the member weighs in.
    expect(mockAdd).toHaveBeenCalledWith(176.4, 'lb', { date: TODAY, note: '' });
  });

  it('HEALTH-WEIGHT-347: "Today" puts a hand-typed date back to today', async () => {
    mockLoadWeightLog.mockResolvedValue(LOG_GAP_TODAY);
    const tree = await render();
    type(tree, 'health-weight-entry-value', '80');
    type(tree, 'health-weight-entry-date', '2026-06-01');
    press(tree, 'health-weight-entry-today');

    expect(field(tree, 'health-weight-entry-date').props.value).toBe(TODAY);
    await pressAsync(tree, 'health-weight-entry-save');
    expect(mockAdd).toHaveBeenCalledWith(80, 'kg', { date: TODAY, note: '' });
  });

  it('HEALTH-WEIGHT-348: a note is shown on its row and survives an edit', async () => {
    mockLoadWeightLog.mockResolvedValue([
      entry(TODAY, 80, { id: 'noted', note: 'after a long flight' }),
      entry('2026-07-12', 80.5, { id: 'plain' }),
    ]);
    const tree = await render();

    // The note is why the number moved; a row without it is a number with no
    // explanation.
    expect(text(tree, 'health-weight-row-noted')).toMatch(/· after a long flight$/);
    expect(text(tree, 'health-weight-row-plain')).not.toContain('after a long flight');

    press(tree, 'health-weight-edit-noted');
    await pressAsync(tree, 'health-weight-entry-save');
    expect(mockUpdate).toHaveBeenCalledWith('noted', {
      value: 80,
      unit: 'kg',
      date: TODAY,
      note: 'after a long flight',
    });
  });

  it('HEALTH-WEIGHT-349: a stored gender still reaches the Body Composition card', async () => {
    // Height/birth year/sex/activity are no longer editable from this screen
    // (moved out with the "Goal & body details" section) — this covers the
    // one figure among them the Weight tab still reads: gender, for the BMR
    // formula's sex term on the Body Composition card.
    mockLoadGoal.mockResolvedValue(goal({ gender: 'female' }));
    mockLoadBody.mockResolvedValue([bodyEntry(TODAY, 'bodyFat', 23.6)]);
    const tree = await render();
    expect(has(tree, 'health-weight-bodycomposition-card')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Donor Weight-tab parity: Summary / Weekly / Body Composition        */
/* ------------------------------------------------------------------ */

describe('HealthWeightScreen — the donor main-tab cards (Summary, Weekly, Body Composition)', () => {
  it('HEALTH-WEIGHT-360: the Weight Summary card reads off the selected window', async () => {
    const tree = await render();
    // Default window is the trailing 30 days ("14 Jun – 13 Jul"), which holds
    // three of LOG's readings (13/12/11 Jul) — current is the latest of them.
    // `formatWeightValue` prints whole numbers without a decimal.
    expect(text(tree, 'health-weight-summary-current-value')).toBe('80 kg');
  });

  it('HEALTH-WEIGHT-361: the period chart follows the SELECTED window, not always this calendar week', async () => {
    const tree = await render();
    // Default window is 30 days, so the chart opens on the aggregated
    // MONTHLY view — the whole point of tying it to the same picker the
    // navigator and summary card use, instead of always the 7-day view
    // regardless of what is selected above it.
    expect(text(tree, 'health-weight-weeklychart-title')).toBe('MONTHLY WEIGHT');
    expect(has(tree, 'health-weight-weeklychart-bar-mon')).toBe(false);

    await act(async () => {
      press(tree, 'health-weight-range-7');
    });
    expect(text(tree, 'health-weight-weeklychart-title')).toBe('WEEKLY WEIGHT');
    // TODAY is itself a Monday, so the Monday-Sunday week containing it
    // STARTS today — only "mon" (13 Jul, 80kg) has a bar; the rest of the
    // week (Tue-Sun) has not happened yet and renders as a future placeholder,
    // not a tappable "+".
    expect(has(tree, 'health-weight-weeklychart-bar-mon')).toBe(true);
    expect(has(tree, 'health-weight-weeklychart-bar-sat')).toBe(false);
    expect(has(tree, 'health-weight-weeklychart-bar-sun')).toBe(false);
    expect(has(tree, 'health-weight-weeklychart-add-tue')).toBe(false);
    expect(has(tree, 'health-weight-weeklychart-future-tue')).toBe(true);
    expect(has(tree, 'health-weight-weeklychart-future-wed')).toBe(true);
    expect(has(tree, 'health-weight-weeklychart-future-thu')).toBe(true);
    expect(has(tree, 'health-weight-weeklychart-future-fri')).toBe(true);
    expect(has(tree, 'health-weight-weeklychart-future-sat')).toBe(true);
    expect(has(tree, 'health-weight-weeklychart-future-sun')).toBe(true);
    expect(text(tree, 'health-weight-weeklychart-entries')).toBe('1/7');
  });

  it('HEALTH-WEIGHT-362: tapping an empty day pre-fills the log form with that date', async () => {
    // Move "today" to the Wednesday of TODAY's week, so Mon/Tue are distinct
    // PAST days within the same Monday-Sunday window — otherwise, with TODAY
    // itself a Monday, the only past day in the window would be today, which
    // would not exercise "tap a day that ISN'T today" at all.
    const wednesday = new Date(2026, 6, 15, 12, 0, 0);
    jest.setSystemTime(wednesday);
    mockLoadWeightLog.mockResolvedValue(LOG_GAP_TODAY);
    const tree = await render();
    await act(async () => {
      press(tree, 'health-weight-range-7');
    });
    press(tree, 'health-weight-weeklychart-add-tue');
    // Tue in the Mon 13 Jul … Sun 19 Jul window is 14 Jul — a day before
    // today (Wed 15 Jul), not tomorrow, which a past day can never be.
    expect(field(tree, 'health-weight-entry-date').props.value).toBe('2026-07-14');
    expect(has(tree, 'health-weight-edit-cancel')).toBe(true);

    // Cancelling a prefill (not an edit) clears the date back to today rather
    // than leaving it parked on a day nothing was tapped for.
    press(tree, 'health-weight-edit-cancel');
    expect(field(tree, 'health-weight-entry-date').props.value).toBe('2026-07-15');
    expect(has(tree, 'health-weight-edit-cancel')).toBe(false);

    // Beyond 7 days a bucket covers many days at once and has no single date
    // of its own — every tap opens the log form for TODAY instead.
    await act(async () => {
      press(tree, 'health-weight-range-30');
    });
    press(tree, 'health-weight-weeklychart-bucket-0');
    expect(field(tree, 'health-weight-entry-date').props.value).toBe('2026-07-15');
  });

  it('HEALTH-WEIGHT-363: there is no Averages card at all — window-over-window averages live only as a line inside Insights', async () => {
    const tree = await render();
    expect(has(tree, 'health-weight-averages')).toBe(false);
    expect(has(tree, 'health-weight-averages-week-current')).toBe(false);
    // The `dataStack` widget (also titled "Averages") is redundant with that
    // Insights line and is dropped from the tab entirely, same as
    // `weeklyChange`.
    expect(has(tree, 'health-weight-widget-dataStack')).toBe(false);
  });

  it('HEALTH-WEIGHT-364: Body Composition is hidden until there is a body-fat % or a BMI to show', async () => {
    const tree = await render();
    expect(has(tree, 'health-weight-bodycomposition-card')).toBe(false);
  });

  it('HEALTH-WEIGHT-365: Body Composition appears once a body-fat % is logged', async () => {
    mockLoadBody.mockResolvedValue([bodyEntry(TODAY, 'bodyFat', 23.6)]);
    const tree = await render();
    expect(has(tree, 'health-weight-bodycomposition-card')).toBe(true);
    expect(text(tree, 'health-weight-bodycomposition-fat')).toMatch(/23\.6%/);
  });

  it('HEALTH-WEIGHT-366: Body Composition Trends only appears with at least two body-fat readings', async () => {
    mockLoadBody.mockResolvedValue([bodyEntry(TODAY, 'bodyFat', 23.6)]);
    let tree = await render();
    expect(has(tree, 'health-weight-bodyfat-trend-chart')).toBe(false);

    mockLoadBody.mockResolvedValue([
      bodyEntry(TODAY, 'bodyFat', 23.6),
      bodyEntry('2026-07-01', 'bodyFat', 24.1),
    ]);
    tree = await render();
    expect(has(tree, 'health-weight-bodyfat-trend-chart')).toBe(true);
  });

  it('HEALTH-WEIGHT-367: Body Composition (+ its Trends chart) renders after the other dashboard widgets and directly above Insights', async () => {
    mockLoadBody.mockResolvedValue([
      bodyEntry(TODAY, 'bodyFat', 23.6),
      bodyEntry('2026-07-01', 'bodyFat', 24.1),
    ]);
    const tree = await render();

    const order: string[] = [];
    const walk = (json: unknown): void => {
      if (!json || typeof json !== 'object') return;
      const n = json as { props?: Record<string, unknown>; children?: unknown[] };
      const id = n.props?.testID;
      if (typeof id === 'string') order.push(id);
      (n.children ?? []).forEach(walk);
    };
    walk(tree.toJSON());

    const mainChart = order.indexOf('health-weight-widget-mainChart');
    const bodyComposition = order.indexOf('health-weight-bodycomposition-card');
    const trends = order.indexOf('health-weight-bodyfat-trend-chart');
    const insights = order.indexOf('health-weight-widget-aiInsights');
    // LOG (from `beforeEach`) always carries a TODAY reading, so the History
    // section renders its row rather than the empty state.
    const history = order.indexOf(`health-weight-row-w-${TODAY}`);

    for (const index of [mainChart, bodyComposition, trends, insights, history]) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    expect(mainChart).toBeLessThan(bodyComposition);
    expect(bodyComposition).toBeLessThan(trends);
    expect(trends).toBeLessThan(insights);
    expect(insights).toBeLessThan(history);
  });

  it('HEALTH-WEIGHT-368: Body Composition charts a BMI trend, following the PAGE-level window navigator with no card-local range picker, once height and at least two weigh-ins are on file', async () => {
    mockLoadGoal.mockResolvedValue(goal({ heightCm: 178 }));
    const tree = await render();

    // LOG carries four readings (13/12/11 Jul, 20 Jun) inside the default
    // 30-day window, so the chart renders straight away.
    expect(has(tree, 'health-weight-bodycomposition-card')).toBe(true);
    expect(has(tree, 'health-weight-bodycomposition-bmi-trend-chart')).toBe(true);
    expect(has(tree, 'health-weight-bodycomposition-bmi-asof')).toBe(true);

    // No card-local range picker — the screen's own window navigator up top
    // is the ONLY period control; Body Composition just follows it.
    for (const days of [7, 30, 90, 365]) {
      expect(has(tree, `health-weight-bodycomposition-bmi-trend-range-${days}`)).toBe(false);
    }

    // Switching the PAGE'S 7-day pill drops the older LOG readings (20 Jun, 4
    // May) but keeps the three from this week, so the trend survives and
    // moves with the same control that drives the rest of the screen.
    press(tree, 'health-weight-range-7');
    expect(has(tree, 'health-weight-bodycomposition-bmi-trend-chart')).toBe(true);
  });

  it('HEALTH-WEIGHT-369: without a height on file, the BMI trend section stays off entirely', async () => {
    mockLoadBody.mockResolvedValue([bodyEntry(TODAY, 'bodyFat', 23.6)]);
    const tree = await render();
    expect(has(tree, 'health-weight-bodycomposition-card')).toBe(true);
    expect(has(tree, 'health-weight-bodycomposition-bmi-trend')).toBe(false);
  });
});
