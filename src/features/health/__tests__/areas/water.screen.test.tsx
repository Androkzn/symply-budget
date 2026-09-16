/**
 * Water tab (`HealthWaterScreen`) — the interactions no other suite drives.
 *
 * `water.dedicated.test.ts` owns the store (`healthWaterStorage.ts`) end to
 * end, and `water.surfaces.test.tsx` proves the tab agrees with Home and
 * Nutrition on one shared record. Neither ever types into the custom-amount
 * field, opens the goal editor's typed input, or presses through a delete
 * confirmation — the three interaction paths a member actually taps that a
 * preset button or a Trends read never exercises. This file owns those,
 * against the REAL screen with only the async store calls mocked.
 *
 * Left to other suites: whether the numbers the store returns are correct
 * (that is `healthWaterStorage`'s own coverage) and whether this tab agrees
 * with the other three water surfaces (`water.surfaces.test.tsx`).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  addWaterAmount,
  deleteWaterEntry,
  loadWaterDay,
  loadWaterPrefs,
  saveWaterUnit,
  setWaterGoalMl,
  WATER_GOAL_PRESETS_ML,
  type WaterDayDetail,
  type WaterLogEntry,
} from '../../healthWaterStorage';
import { HealthWaterScreen } from '../../screens/HealthWaterScreen';

type Rendered = ReactTestRenderer.ReactTestRenderer;

const TODAY = '2026-07-13';
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

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

jest.mock('../../healthWaterStorage', () => {
  const actual = jest.requireActual('../../healthWaterStorage');
  return {
    ...actual,
    loadWaterDay: jest.fn(),
    loadWaterPrefs: jest.fn(),
    addWaterAmount: jest.fn(),
    deleteWaterEntry: jest.fn(),
    saveWaterUnit: jest.fn(),
    setWaterGoalMl: jest.fn(),
  };
});

const mockLoadWaterDay = loadWaterDay as jest.Mock;
const mockLoadWaterPrefs = loadWaterPrefs as jest.Mock;
const mockAddWaterAmount = addWaterAmount as jest.Mock;
const mockDeleteWaterEntry = deleteWaterEntry as jest.Mock;
const mockSaveWaterUnit = saveWaterUnit as jest.Mock;
const mockSetWaterGoalMl = setWaterGoalMl as jest.Mock;

function logEntry(over: Partial<WaterLogEntry> = {}): WaterLogEntry {
  return {
    id: over.id ?? 'e1',
    date: over.date ?? TODAY,
    amountMl: over.amountMl ?? 250,
    container: over.container ?? 'Glass',
    beverageType: over.beverageType ?? 'water',
    createdAt: over.createdAt ?? `${TODAY}T09:00:00.000Z`,
  };
}

function day(over: Partial<WaterDayDetail> = {}): WaterDayDetail {
  return {
    date: over.date ?? TODAY,
    totalMl: over.totalMl ?? 0,
    goalMl: over.goalMl ?? 2000,
    entries: over.entries ?? [],
  };
}

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function byTestId(tree: Rendered, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

/** The composite carrying `testID` (the Pressable, not its host View). */
function pressable(tree: Rendered, testID: string) {
  return tree.root.find((n) => n.props?.testID === testID && typeof n.props?.onPress === 'function');
}

function press(tree: Rendered, testID: string) {
  act(() => pressable(tree, testID).props.onPress());
}

async function pressAsync(tree: Rendered, testID: string) {
  await act(async () => pressable(tree, testID).props.onPress());
}

function input(tree: Rendered, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID,
  );
}

function type(tree: Rendered, testID: string, text: string) {
  act(() => input(tree, testID).props.onChangeText(text));
}

async function render() {
  let tree!: Rendered;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthWaterScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);

  mockLoadWaterDay.mockResolvedValue(day());
  mockLoadWaterPrefs.mockResolvedValue({ unit: 'ml' });
  mockAddWaterAmount.mockResolvedValue(day());
  mockDeleteWaterEntry.mockResolvedValue(day());
  mockSaveWaterUnit.mockResolvedValue({ unit: 'ml' });
  mockSetWaterGoalMl.mockResolvedValue(day());
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Custom amount — typed field, ± steppers, keyboard submit             */
/* ------------------------------------------------------------------ */

describe('HealthWaterScreen — custom amount', () => {
  it('HEALTH-WATER-037: typing a custom amount and pressing Add logs it and clears the field', async () => {
    mockAddWaterAmount.mockResolvedValue(day({ totalMl: 180 }));
    const tree = await render();

    type(tree, 'health-water-custom-input', '180');
    expect(input(tree, 'health-water-custom-input').props.value).toBe('180');

    await pressAsync(tree, 'health-water-custom-add');

    expect(mockAddWaterAmount).toHaveBeenCalledWith(180, { container: null });
    // The field clears so a repeat tap cannot re-log the same figure.
    expect(input(tree, 'health-water-custom-input').props.value).toBe('');
  });

  it('HEALTH-WATER-038: an empty or zero custom amount cannot be added', async () => {
    const tree = await render();

    // Untouched — the Add button ignores a press rather than logging 0 ml.
    await pressAsync(tree, 'health-water-custom-add');
    expect(mockAddWaterAmount).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-water-custom-add')[0].props.accessibilityState).toEqual({
      disabled: true,
    });

    // Non-numeric input sanitizes down to nothing, same result.
    type(tree, 'health-water-custom-input', 'abc');
    expect(input(tree, 'health-water-custom-input').props.value).toBe('');
    await pressAsync(tree, 'health-water-custom-add');
    expect(mockAddWaterAmount).not.toHaveBeenCalled();
  });

  it('HEALTH-WATER-039: non-digit characters are stripped as they are typed', async () => {
    const tree = await render();

    type(tree, 'health-water-custom-input', '2x5$0ml');
    // Only digits and '.' survive, and in the order they were typed.
    expect(input(tree, 'health-water-custom-input').props.value).toBe('250');
  });

  it('HEALTH-WATER-040: the keyboard’s Done key adds, exactly like the button', async () => {
    mockAddWaterAmount.mockResolvedValue(day({ totalMl: 300 }));
    const tree = await render();

    type(tree, 'health-water-custom-input', '300');
    await act(async () => input(tree, 'health-water-custom-input').props.onSubmitEditing());

    expect(mockAddWaterAmount).toHaveBeenCalledWith(300, { container: null });
  });

  it('HEALTH-WATER-041: the ± steppers move the field by one donor step, floored at zero', async () => {
    const tree = await render();

    // From empty (0 ml), minus is a no-op floor rather than going negative.
    press(tree, 'health-water-custom-minus');
    expect(input(tree, 'health-water-custom-input').props.value).toBe('');

    // Plus moves up by the 50 ml donor stride.
    press(tree, 'health-water-custom-plus');
    expect(input(tree, 'health-water-custom-input').props.value).toBe('50');
    press(tree, 'health-water-custom-plus');
    expect(input(tree, 'health-water-custom-input').props.value).toBe('100');

    // And minus steps back down by the same stride.
    press(tree, 'health-water-custom-minus');
    expect(input(tree, 'health-water-custom-input').props.value).toBe('50');
  });
});

/* ------------------------------------------------------------------ */
/* The hero ring                                                        */
/* ------------------------------------------------------------------ */

describe('HealthWaterScreen — the hero figure', () => {
  it('HEALTH-WATER-050: meeting or passing the goal reads "Goal reached", not a remaining figure', async () => {
    mockLoadWaterDay.mockResolvedValue(day({ totalMl: 2200, goalMl: 2000 }));
    const tree = await render();

    expect(allText(byTestId(tree, 'health-water-remaining')[0])).toBe('Goal reached');
  });

  it('HEALTH-WATER-051: short of the goal shows how much is left, not "Goal reached"', async () => {
    mockLoadWaterDay.mockResolvedValue(day({ totalMl: 500, goalMl: 2000 }));
    const tree = await render();

    expect(allText(byTestId(tree, 'health-water-remaining')[0])).toBe('1.5 L to go');
  });

  it('HEALTH-WATER-052: a second tap while the first is still in flight cannot double-log', async () => {
    // A slow network is the one way `busy` is observed true: the first tap
    // starts a request that has not resolved yet, and a second tap landing
    // inside that window must be a no-op rather than a second drink.
    let resolveFirst!: (value: WaterDayDetail) => void;
    mockAddWaterAmount.mockReturnValueOnce(
      new Promise<WaterDayDetail>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const tree = await render();

    let firstAdd!: Promise<void>;
    act(() => {
      firstAdd = pressable(tree, 'health-water-preset-bottle').props.onPress();
    });
    // Still in flight: a second press must be swallowed by the busy guard,
    // not queued as a second 500 ml bottle.
    act(() => {
      pressable(tree, 'health-water-preset-bottle').props.onPress();
    });
    expect(mockAddWaterAmount).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst(day({ totalMl: 500 }));
      await firstAdd;
    });
    expect(mockAddWaterAmount).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* Goal editor                                                          */
/* ------------------------------------------------------------------ */

describe('HealthWaterScreen — goal editor', () => {
  it('HEALTH-WATER-042: opening the editor seeds the field with the CURRENT goal', async () => {
    mockLoadWaterDay.mockResolvedValue(day({ goalMl: 2500 }));
    const tree = await render();

    expect(byTestId(tree, 'health-water-goal-editor')).toHaveLength(0);
    press(tree, 'health-water-edit-goal');

    expect(byTestId(tree, 'health-water-goal-editor')).toHaveLength(1);
    expect(input(tree, 'health-water-goal-input').props.value).toBe('2500');
  });

  it('HEALTH-WATER-043: a typed goal saves in millilitres and closes the editor', async () => {
    mockSetWaterGoalMl.mockResolvedValue(day({ goalMl: 3200 }));
    const tree = await render();

    press(tree, 'health-water-edit-goal');
    type(tree, 'health-water-goal-input', '3200');
    await pressAsync(tree, 'health-water-goal-save');

    expect(mockSetWaterGoalMl).toHaveBeenCalledWith(3200);
    expect(byTestId(tree, 'health-water-goal-editor')).toHaveLength(0);
    expect(allText(tree.toJSON())).toContain('3.2 L');
  });

  it('HEALTH-WATER-044: a blank goal closes the editor WITHOUT saving', async () => {
    const tree = await render();

    press(tree, 'health-water-edit-goal');
    type(tree, 'health-water-goal-input', '');
    await pressAsync(tree, 'health-water-goal-save');

    // Invalid input restores rather than surfacing a parse error — the
    // editor just closes on whatever goal was already in effect.
    expect(mockSetWaterGoalMl).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-water-goal-editor')).toHaveLength(0);
  });

  it('HEALTH-WATER-045: Cancel discards the draft and saves nothing', async () => {
    const tree = await render();

    press(tree, 'health-water-edit-goal');
    type(tree, 'health-water-goal-input', '9999');
    press(tree, 'health-water-goal-cancel');

    expect(mockSetWaterGoalMl).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-water-goal-editor')).toHaveLength(0);
  });

  it('HEALTH-WATER-046: every donor preset is offered and saves its exact figure', async () => {
    const tree = await render();
    press(tree, 'health-water-edit-goal');

    for (const ml of WATER_GOAL_PRESETS_ML) {
      expect(byTestId(tree, `health-water-goal-preset-${ml}`)).toHaveLength(1);
    }

    await pressAsync(tree, 'health-water-goal-preset-2500');
    expect(mockSetWaterGoalMl).toHaveBeenCalledWith(2500);
  });
});

/* ------------------------------------------------------------------ */
/* Deleting a logged drink                                              */
/* ------------------------------------------------------------------ */

describe('HealthWaterScreen — deleting a drink', () => {
  it('HEALTH-WATER-047: delete asks first, and Cancel leaves the entry alone', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadWaterDay.mockResolvedValue(day({ totalMl: 250, entries: [logEntry()] }));
    const tree = await render();

    press(tree, 'health-water-delete-e1');

    expect(alertSpy.mock.calls[0][0]).toBe('Remove drink');
    expect(alertSpy.mock.calls[0][1]).toBe('Remove 250 ml from today?');
    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }>;
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Remove']);
    expect(buttons[1].style).toBe('destructive');

    await act(async () => buttons.find((b) => b.text === 'Cancel')?.onPress?.());
    expect(mockDeleteWaterEntry).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('HEALTH-WATER-048: confirming Remove deletes THAT entry and refreshes the total', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadWaterDay.mockResolvedValue(day({ totalMl: 250, entries: [logEntry({ id: 'e1' })] }));
    mockDeleteWaterEntry.mockResolvedValue(day({ totalMl: 0, entries: [] }));
    const tree = await render();

    press(tree, 'health-water-delete-e1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === 'Remove')?.onPress?.());

    expect(mockDeleteWaterEntry).toHaveBeenCalledWith('e1', TODAY);
    // The screen re-renders from the store's answer — the row is gone.
    expect(byTestId(tree, 'health-water-entry-e1')).toHaveLength(0);
    expect(byTestId(tree, 'health-water-log-empty')).toHaveLength(1);
    alertSpy.mockRestore();
  });

  it('HEALTH-WATER-049: the confirm copy states the amount in the DISPLAY unit', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadWaterPrefs.mockResolvedValue({ unit: 'oz' });
    mockLoadWaterDay.mockResolvedValue(day({ totalMl: 500, entries: [logEntry({ amountMl: 500 })] }));
    const tree = await render();

    press(tree, 'health-water-delete-e1');
    // 500 ml ≈ 17 oz (whole ounces past 10, per `formatVolume`) — the alert
    // must not silently confirm in millilitres once the member has switched
    // the tab to ounces.
    expect(alertSpy.mock.calls[0][1]).toBe('Remove 17 oz from today?');
    alertSpy.mockRestore();
  });
});
