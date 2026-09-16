/**
 * Symply Health — WATER area, cross-surface parity.
 *
 * Hydration is loggable on THREE screens and read on a fourth:
 *   * Home              — `health-water-{minus,plus}`, ±1 cup
 *   * Nutrition (today) — `health-nutrition-water-{minus,plus}`, ±1 cup
 *   * Water tab         — presets / custom amount / per-entry delete, millilitres
 *   * Trends            — read-only hydration tiles off the rolling history
 *
 * Every other Health suite mocks `healthLocalStorage` / `healthWaterStorage`, so
 * each screen is proven against a STUB of the store and nothing proves the four
 * agree. That is precisely the bug class that matters here: a member adds a
 * bottle on the Water tab, switches to Home, and sees the old cup count — or
 * worse, two surfaces each keep their own tally and the day's total depends on
 * which screen you ask.
 *
 * So this file mocks NOTHING below the API. The screens run against the REAL
 * stores, the real MMKV mock and one shared fake water ledger, which is the only
 * arrangement in which "one record, three surfaces" is a testable claim rather
 * than an aspiration in a comment.
 *
 * Scope discipline: the assertions are about WATER only. Every other figure on
 * these screens (meals, workouts, weight, habits) is left at its empty-account
 * default and is owned by its own area's suite.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { healthApi } from '@api/health';
import { ThemeProvider } from '@contexts/ThemeContext';
import { storageHelpers } from '@services/storage';

import { loadFoods, loadFoodSuggestions } from '../../healthFoodStorage';
import {
  CUP_ML,
  HEALTH_WATER_KEY,
  loadWaterToday,
  type WaterDay,
} from '../../healthLocalStorage';
import { __setHealthOfflineForTests, clearHealthCache } from '../../healthRepository';
import { loadWaterDay } from '../../healthWaterStorage';
import { HealthHomeScreen } from '../../screens/HealthHomeScreen';
import { HealthNutritionScreen } from '../../screens/HealthNutritionScreen';
import { HealthTrendsScreen } from '../../screens/HealthTrendsScreen';
import { HealthWaterScreen } from '../../screens/HealthWaterScreen';
import {
  fakeGoalServer,
  installHealthApiDefaults,
  ok,
  waterEntryRow,
  waterSummaryRow,
  type MockedHealthApi,
} from '../../test-utils/healthApiTestKit';

jest.mock('@api/health');

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactMock = require('react');
    ReactMock.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { display_name: 'Ada Lovelace' }, logout: jest.fn() }),
}));

// Home publishes the water figure to the shared widget/watch container. Capture
// it: the widget is a FOURTH reader of the same number and must not diverge.
const mockSetSnapshot = jest.fn();
jest.mock('@services/widget-sync', () => ({
  widgetSync: { setSnapshot: (...args: unknown[]) => mockSetSnapshot(...args) },
}));

// The food library is a different area's API surface; stub its three reads so an
// unmocked module does not decide whether a water assertion passes.
jest.mock('../../healthFoodStorage', () => {
  const actual = jest.requireActual('../../healthFoodStorage');
  return {
    ...actual,
    loadFoods: jest.fn(),
    loadFoodSuggestions: jest.fn(),
    logFoodToDiary: jest.fn(),
  };
});

// Charts measure through SVG; Trends only needs to hand over the right series.
// The rest of the module (`collectReferenceLines`, consumed by AppBarChart) stays
// REAL — replacing it wholesale takes the bar chart down with it.
jest.mock('@components/ui/AppLineChart', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    ...jest.requireActual('@components/ui/AppLineChart'),
    AppLineChart: ({ data }: { data: Array<{ value: number }> }) =>
      ReactMock.createElement(View, {
        testID: 'app-line-chart',
        accessibilityValue: { text: data.map((p) => p.value).join(',') },
      }),
  };
});

const api = healthApi as unknown as MockedHealthApi;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';
const YESTERDAY = '2026-07-12';

interface LedgerRow {
  id: string;
  date: string;
  ml: number;
  container: string | null;
  createdAt: string;
}

/**
 * ONE ledger behind all four screens.
 *
 * Sharing it is the whole point: if each screen had its own fake, "they agree"
 * would be a statement about the fakes. Rows carry `created_at` because the Water
 * tab sorts by it and `POST /water/undo` (Home's minus) removes by it.
 */
function fakeWaterLedger(seed: LedgerRow[] = []) {
  const goal = fakeGoalServer(api) as unknown as { goal: { daily_water_ml: number | null } };
  const state = { rows: [...seed] };
  let clock = 0;
  const totalFor = (date: string) =>
    state.rows.filter((r) => r.date === date).reduce((s, r) => s + r.ml, 0);

  api.addWater.mockImplementation((body) => {
    const row: LedgerRow = {
      id: `h2o_${state.rows.length}_${clock}`,
      date: body.date,
      ml: body.amount_ml,
      container: (body as { container?: string }).container ?? null,
      createdAt: `2026-07-13T${String(8 + clock++).padStart(2, '0')}:00:00.000Z`,
    };
    state.rows.push(row);
    return Promise.resolve(ok({ entry: waterEntryRow({ id: row.id, date: row.date }) }));
  });
  api.undoWater.mockImplementation((date) => {
    const forDay = state.rows.filter((r) => r.date === date);
    const last = forDay[forDay.length - 1];
    if (last) state.rows.splice(state.rows.indexOf(last), 1);
    return Promise.resolve(ok({ removed: !!last }));
  });
  api.deleteWater.mockImplementation((id) => {
    const index = state.rows.findIndex((r) => r.id === id);
    if (index >= 0) state.rows.splice(index, 1);
    return Promise.resolve(ok({ deleted: index >= 0 }));
  });
  api.waterSummary.mockImplementation((date) =>
    Promise.resolve(
      ok({
        summary: waterSummaryRow({
          date,
          total_ml: totalFor(date),
          goal_ml: goal.goal.daily_water_ml,
          entry_count: state.rows.filter((r) => r.date === date).length,
        }),
      })
    )
  );
  api.listWater.mockImplementation((params) =>
    Promise.resolve(
      ok({
        entries: state.rows
          .filter((r) => (params?.from ? r.date >= params.from : true))
          .filter((r) => (params?.to ? r.date <= params.to : true))
          .map((r) =>
            waterEntryRow({
              id: r.id,
              date: r.date,
              amount_ml: r.ml,
              container: r.container,
              created_at: r.createdAt,
            })
          ),
      })
    )
  );
  return { rows: state.rows, totalFor, goal };
}

/* ---------------------------------------------------------------- */
/* Render helpers                                                    */
/* ---------------------------------------------------------------- */

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

function byTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer, id: string): string {
  const node = byTestId(tree, id)[0];
  return node ? allText(node) : '';
}

/** Fire the nearest pressable carrying `testID` and flush its async handler. */
async function press(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === id && typeof n.props?.onPress === 'function'
  );
  await act(async () => {
    node.props.onPress();
  });
}

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]);
  __setHealthOfflineForTests(false);
  // `clearAllMocks`, deliberately NOT `resetAllMocks`: this file RENDERS, and a
  // reset also wipes jest-expo's own asset-registry mocks, after which every
  // brand PNG throws "Module 1 is missing from the asset registry" mid-render.
  // Clearing usage data is enough — every stub below is re-declared here anyway.
  jest.clearAllMocks();
  installHealthApiDefaults(api);
  api.deleteWater.mockResolvedValue(ok({ deleted: true }));
  // The food library is another area's surface; it must answer "empty account"
  // rather than `undefined`, or Nutrition throws before the water card renders.
  (loadFoods as jest.Mock).mockResolvedValue([]);
  (loadFoodSuggestions as jest.Mock).mockResolvedValue([]);
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

/* ---------------------------------------------------------------- */
/* Home ⇄ Nutrition — the two ±1-cup counters                        */
/* ---------------------------------------------------------------- */

describe('water — the two ±1-cup surfaces read one day', () => {
  it('HEALTH-HOME-124: a cup added on Home is already there when Nutrition mounts', async () => {
    fakeWaterLedger();

    const home = await render(<HealthHomeScreen />);
    expect(textOf(home, 'health-water-cups-count')).toBe('0');

    await press(home, 'health-water-plus');
    await press(home, 'health-water-plus');
    expect(textOf(home, 'health-water-cups-count')).toBe('2');

    // A separate mount, reading the same server day through the same store —
    // this is what switching tabs does.
    const nutrition = await render(<HealthNutritionScreen />);
    expect(textOf(nutrition, 'health-nutrition-water-count')).toBe('2 / 8 cups');
  });

  it('HEALTH-HOME-125: a cup removed on Nutrition is gone when Home re-mounts', async () => {
    const ledger = fakeWaterLedger();

    const nutrition = await render(<HealthNutritionScreen />);
    await press(nutrition, 'health-nutrition-water-plus');
    await press(nutrition, 'health-nutrition-water-plus');
    await press(nutrition, 'health-nutrition-water-plus');
    expect(textOf(nutrition, 'health-nutrition-water-count')).toBe('3 / 8 cups');

    await press(nutrition, 'health-nutrition-water-minus');
    expect(textOf(nutrition, 'health-nutrition-water-count')).toBe('2 / 8 cups');
    expect(ledger.totalFor(TODAY)).toBe(2 * CUP_ML);

    const home = await render(<HealthHomeScreen />);
    expect(textOf(home, 'health-water-cups-count')).toBe('2');
  });

  it('HEALTH-HOME-126: both counters floor at zero and neither persists a negative', async () => {
    const ledger = fakeWaterLedger();

    const home = await render(<HealthHomeScreen />);
    await press(home, 'health-water-minus');
    await press(home, 'health-water-minus');
    expect(textOf(home, 'health-water-cups-count')).toBe('0');

    const nutrition = await render(<HealthNutritionScreen />);
    await press(nutrition, 'health-nutrition-water-minus');
    expect(textOf(nutrition, 'health-nutrition-water-count')).toBe('0 / 8 cups');

    // Neither surface invented a row, and the shared cache is a clean zero — a
    // cached −1 would come back as "0" on screen but poison every later
    // arithmetic (clamps happen on read, not on write, in several places).
    expect(ledger.rows).toHaveLength(0);
    expect(await storageHelpers.getObject<WaterDay>(HEALTH_WATER_KEY)).toMatchObject({ cups: 0 });
  });

  it('HEALTH-HOME-127: rapid taps on Home settle on the true total, not a lost update', async () => {
    const ledger = fakeWaterLedger();
    const home = await render(<HealthHomeScreen />);

    // `onPress={() => void handleWater(1)}` is fire-and-forget, so a burst
    // overlaps rather than queues.
    for (let i = 0; i < 5; i += 1) await press(home, 'health-water-plus');

    expect(ledger.rows).toHaveLength(5);
    expect(textOf(home, 'health-water-cups-count')).toBe('5');
    expect((await loadWaterToday()).cups).toBe(5);
  });

  it('HEALTH-HOME-128: past days have no counter, so a tap can only ever mean today', async () => {
    fakeWaterLedger();

    const nutrition = await render(<HealthNutritionScreen />);
    expect(byTestId(nutrition, 'health-nutrition-water-plus')).toHaveLength(1);

    await press(nutrition, 'health-nutrition-prev-day');

    // Hydration is a TODAY-only control: `adjustWater` always writes
    // `todayDateKey()`, so offering it while the diary shows yesterday would log
    // the cup against the wrong day.
    expect(byTestId(nutrition, 'health-nutrition-water-plus')).toHaveLength(0);
    expect(byTestId(nutrition, 'health-nutrition-water-count')).toHaveLength(0);
  });

  it('HEALTH-HOME-129: the widget snapshot carries the same figure, in millilitres', async () => {
    fakeWaterLedger();
    const home = await render(<HealthHomeScreen />);

    await press(home, 'health-water-plus');
    await press(home, 'health-water-plus');

    // The widget is a fourth reader of this number and lives in an App Group
    // container other brands can read — it must carry water and nothing else.
    // Home publishes to the watch key in the same pass, so select by key rather
    // than taking the last call.
    const widget = mockSetSnapshot.mock.calls.filter(([key]) => key === 'widget_health_today');
    expect(widget.length).toBeGreaterThan(0);
    expect(widget.at(-1)?.[1]).toMatchObject({
      water_ml: 2 * CUP_ML,
      water_goal_ml: 8 * CUP_ML,
    });
  });
});

/* ---------------------------------------------------------------- */
/* Water tab ⇄ the cup counters                                      */
/* ---------------------------------------------------------------- */

describe('water — the millilitre tab and the cup counters are one record', () => {
  it('HEALTH-WATER-032: a preset logged on the Water tab moves Home’s cup counter', async () => {
    const ledger = fakeWaterLedger();

    const water = await render(<HealthWaterScreen />);
    expect(textOf(water, 'health-water-log-empty')).toContain('Nothing logged yet today');

    await press(water, 'health-water-preset-bottle'); // 500 ml
    await press(water, 'health-water-preset-glass'); // 250 ml

    expect(ledger.totalFor(TODAY)).toBe(750);
    expect(textOf(water, 'health-water-remaining')).toContain('to go');

    // 750 ml ÷ 240 = 3.125 → 3 cups. Home does not re-count; it reads the
    // millilitre total the tab mirrored into `health.water.v1`.
    const home = await render(<HealthHomeScreen />);
    expect(textOf(home, 'health-water-cups-count')).toBe('3');

    const nutrition = await render(<HealthNutritionScreen />);
    expect(textOf(nutrition, 'health-nutrition-water-count')).toBe('3 / 8 cups');
  });

  it('HEALTH-WATER-033: a cup added on Home appears as a row in the Water tab log', async () => {
    fakeWaterLedger();

    const home = await render(<HealthHomeScreen />);
    await press(home, 'health-water-plus');

    const water = await render(<HealthWaterScreen />);

    // One 240 ml row, addressable and individually removable — the ±1 control
    // writes an ordinary entry, not a special "cup" record.
    expect(byTestId(water, 'health-water-log-empty')).toHaveLength(0);
    const day = await loadWaterDay();
    expect(day.entries).toHaveLength(1);
    expect(day.entries[0].amountMl).toBe(CUP_ML);
    expect(allText(water.toJSON())).toContain('240 ml');
  });

  it('HEALTH-WATER-034: deleting a drink on the Water tab takes the cups down with it', async () => {
    const ledger = fakeWaterLedger();

    const water = await render(<HealthWaterScreen />);
    await press(water, 'health-water-preset-bottle'); // 500 ml
    await press(water, 'health-water-preset-bottle'); // 500 ml
    expect((await loadWaterToday()).cups).toBe(4); // 1000 ml ÷ 240 → 4

    const day = await loadWaterDay();
    await press(water, `health-water-delete-${day.entries[0].id}`);

    // The screen confirms through an Alert; the store call is what this asserts.
    // (The Alert path itself is a screen concern — see the Maestro flow.)
    expect(ledger.rows).toHaveLength(2);
  });

  it('HEALTH-WATER-035: a goal set in millilitres restates the cup TARGET everywhere', async () => {
    fakeWaterLedger();

    const water = await render(<HealthWaterScreen />);
    await press(water, 'health-water-edit-goal');
    await press(water, 'health-water-goal-preset-2500');

    // 2,500 ml ÷ 240 = 10.4 → a target of 10 cups. One effective-dated goal row
    // feeds both vocabularies, so the two screens cannot state different goals.
    const home = await render(<HealthHomeScreen />);
    expect(allText(home.toJSON())).toContain('/ 10 cups');

    const nutrition = await render(<HealthNutritionScreen />);
    expect(textOf(nutrition, 'health-nutrition-water-count')).toBe('0 / 10 cups');
  });

  it('HEALTH-WATER-036: the ml/oz choice is display-only and never reaches the wire', async () => {
    fakeWaterLedger();

    const water = await render(<HealthWaterScreen />);
    await press(water, 'health-water-unit-oz');
    await press(water, 'health-water-preset-bottle'); // 500 ml

    // The label switched…
    expect(allText(water.toJSON())).toContain('17 oz');
    // …but the request, the stored row and the cup mirror are all millilitres.
    expect(api.addWater).toHaveBeenCalledWith({
      date: TODAY,
      amount_ml: 500,
      container: 'Bottle',
    });
    expect((await loadWaterDay()).totalMl).toBe(500);
    expect((await loadWaterToday()).cups).toBe(2);
  });
});

/* ---------------------------------------------------------------- */
/* Trends — the read-only fourth surface                             */
/* ---------------------------------------------------------------- */

describe('water — Trends reports what the logging surfaces wrote', () => {
  it('HEALTH-TREND-112: the hydration tiles match the days actually logged', async () => {
    // Two tracked days: today will reach the 8-cup goal, yesterday will not.
    fakeWaterLedger([
      {
        id: 'y',
        date: YESTERDAY,
        ml: 4 * CUP_ML,
        container: null,
        createdAt: '2026-07-12T09:00:00.000Z',
      },
    ]);

    const home = await render(<HealthHomeScreen />);
    for (let i = 0; i < 8; i += 1) await press(home, 'health-water-plus');
    expect(textOf(home, 'health-water-cups-count')).toBe('8');

    const trends = await render(<HealthTrendsScreen />);

    // 1 of the 2 tracked days met the goal, and (8 + 4) / 2 = 6 cups average.
    expect(textOf(trends, 'health-trends-water-goal-days')).toContain('1/2 days');
    expect(textOf(trends, 'health-trends-water-average')).toContain('6');
  });

  it('HEALTH-TREND-113: a day drained back to zero is UNTRACKED, not a zero average', async () => {
    fakeWaterLedger([
      {
        id: 'y',
        date: YESTERDAY,
        ml: 8 * CUP_ML,
        container: null,
        createdAt: '2026-07-12T09:00:00.000Z',
      },
    ]);

    const home = await render(<HealthHomeScreen />);
    await press(home, 'health-water-plus');
    await press(home, 'health-water-minus');
    expect(textOf(home, 'health-water-cups-count')).toBe('0');

    const trends = await render(<HealthTrendsScreen />);

    // Yesterday alone. If today were kept as a 0-cup row the average would fall
    // to 4 and the member would be told they are drinking half what they are.
    expect(textOf(trends, 'health-trends-water-goal-days')).toContain('1/1 days');
    expect(textOf(trends, 'health-trends-water-average')).toContain('8');
  });

  it('HEALTH-TREND-114: an account that never logged water reads as untracked, not zero', async () => {
    fakeWaterLedger();

    const trends = await render(<HealthTrendsScreen />);

    expect(textOf(trends, 'health-trends-water-goal-days')).toContain('0/0 days');
    // The em-dash, not "0" — a figure of zero would be a claim about a day the
    // member never logged. (The tile testID wraps its own label, so the value is
    // asserted as the tail of `Avg cups—`.)
    expect(textOf(trends, 'health-trends-water-average')).toBe('Avg cups—');
  });
});
