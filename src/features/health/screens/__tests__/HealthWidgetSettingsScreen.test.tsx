/**
 * HealthWidgetSettingsScreen — the donor's `WidgetSettingsView`, minus its
 * 1,800-line rendered preview (see the screen header for why).
 *
 * Renders the REAL screen through <ThemeProvider>, with `healthWidgetStorage`
 * mocked as a seam — its own suite (`areas/widget.glance-publisher.test.ts` +
 * a dedicated `healthWidgetStorage.test.ts`) owns the read/write/republish
 * contract. This file proves the SCREEN'S OWN job: every choice row and toggle
 * patches only the field it controls, the summary line always reads from the
 * REAL formatter (never hardcoded copy), and the chart section explains itself
 * differently depending on whether "Weight and trends" is on.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { HealthWidgetPreferences } from '@api/healthAssets';
import { ThemeProvider } from '@contexts/ThemeContext';

import {
  DEFAULT_HEALTH_WIDGET_PREFERENCES,
  describeWidgetPreferences,
  loadWidgetPreferences,
  MEDIUM_WIDGET_LAYOUT_OPTIONS,
  MEDIUM_WIDGET_METRIC_OPTIONS,
  saveWidgetPreferences,
  SMALL_WIDGET_METRIC_OPTIONS,
  SMALL_WIDGET_STYLE_OPTIONS,
  WIDGET_CHART_METRIC_OPTIONS,
  WIDGET_CHART_TYPE_OPTIONS,
} from '../../healthWidgetStorage';
import { HealthWidgetSettingsScreen } from '../HealthWidgetSettingsScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Pressable } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({
      title,
      onBackPress,
      backButtonTestID,
    }: {
      title?: string;
      onBackPress?: () => void;
      backButtonTestID?: string;
    }) =>
      ReactMock.createElement(
        View,
        { testID: 'screen-header', accessibilityLabel: title },
        ReactMock.createElement(Pressable, { testID: backButtonTestID, onPress: onBackPress })
      ),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('../../healthWidgetStorage', () => {
  const actual = jest.requireActual('../../healthWidgetStorage');
  return {
    ...actual,
    loadWidgetPreferences: jest.fn(),
    saveWidgetPreferences: jest.fn(),
  };
});

const mockLoad = loadWidgetPreferences as jest.Mock;
const mockSave = saveWidgetPreferences as jest.Mock;

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

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthWidgetSettingsScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockLoad.mockResolvedValue(DEFAULT_HEALTH_WIDGET_PREFERENCES);
  mockSave.mockImplementation(async (patch: Partial<HealthWidgetPreferences>) => ({
    preferences: { ...DEFAULT_HEALTH_WIDGET_PREFERENCES, ...patch },
    status: 'saved',
    message: null,
  }));
});

describe('HealthWidgetSettingsScreen — loading', () => {
  it('HEALTH-WIDGETSET-001: shows the shell spinner until preferences resolve', async () => {
    mockLoad.mockReturnValue(pending<HealthWidgetPreferences>());
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-widget-screen').length).toBe(1);
    expect(byTestId(tree, 'health-widget-screen-scroll').length).toBe(0);
    expect(byTestId(tree, 'health-widget-summary').length).toBe(0);
  });

  it('HEALTH-WIDGETSET-002: renders every card once preferences resolve', async () => {
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-widget-screen-scroll').length).toBe(1);
    expect(byTestId(tree, 'health-widget-summary').length).toBe(1);
    expect(byTestId(tree, 'health-widget-small').length).toBe(1);
    expect(byTestId(tree, 'health-widget-medium').length).toBe(1);
    expect(byTestId(tree, 'health-widget-sections').length).toBe(1);
    expect(byTestId(tree, 'health-widget-chart').length).toBe(1);
    expect(byTestId(tree, 'health-widget-privacy').length).toBe(1);
  });
});

describe('HealthWidgetSettingsScreen — summary line', () => {
  it('HEALTH-WIDGETSET-010: the summary is the REAL formatter output, not hardcoded copy', async () => {
    const custom = {
      ...DEFAULT_HEALTH_WIDGET_PREFERENCES,
      small_widget_metric: 'water' as const,
      show_weight: false,
      show_nutrition: false,
      show_workouts: false,
    };
    mockLoad.mockResolvedValue(custom);
    const tree = await renderScreen();

    expect(allText(byTestId(tree, 'health-widget-summary-line')[0].props.children)).toBe(
      describeWidgetPreferences(custom)
    );
    expect(describeWidgetPreferences(custom)).toContain('Water only');
  });
});

describe('HealthWidgetSettingsScreen — small widget metric (ChoiceRow)', () => {
  it('HEALTH-WIDGETSET-020: every option is rendered and the selected one is marked', async () => {
    const tree = await renderScreen();
    for (const key of SMALL_WIDGET_METRIC_OPTIONS) {
      const node = tree.root.find((n) => n.props?.testID === `health-widget-metric-${key}`);
      expect(node.props.accessibilityState.selected).toBe(key === 'steps');
    }
  });

  it('HEALTH-WIDGETSET-021: choosing a metric patches ONLY small_widget_metric', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'health-widget-metric-calories').props.onPress();
    });
    expect(mockSave).toHaveBeenCalledWith({ small_widget_metric: 'calories' });
    expect(Object.keys(mockSave.mock.calls[0][0])).toEqual(['small_widget_metric']);
  });
});

describe('HealthWidgetSettingsScreen — small widget style (ChoiceRow)', () => {
  it('HEALTH-WIDGETSET-022: every option is rendered and the selected one is marked', async () => {
    const tree = await renderScreen();
    for (const key of SMALL_WIDGET_STYLE_OPTIONS) {
      const node = tree.root.find((n) => n.props?.testID === `health-widget-small-style-${key}`);
      expect(node.props.accessibilityState.selected).toBe(key === 'standard');
    }
  });

  it('HEALTH-WIDGETSET-023: choosing a style patches ONLY small_widget_style', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'health-widget-small-style-compact').props.onPress();
    });
    expect(mockSave).toHaveBeenCalledWith({ small_widget_style: 'compact' });
    expect(Object.keys(mockSave.mock.calls[0][0])).toEqual(['small_widget_style']);
  });
});

describe('HealthWidgetSettingsScreen — medium widget layout', () => {
  it('HEALTH-WIDGETSET-025: every layout option is rendered and the selected one is marked', async () => {
    const tree = await renderScreen();
    for (const key of MEDIUM_WIDGET_LAYOUT_OPTIONS) {
      const node = tree.root.find((n) => n.props?.testID === `health-widget-medium-layout-${key}`);
      expect(node.props.accessibilityState.selected).toBe(key === 'standard');
    }
  });

  it('HEALTH-WIDGETSET-026: "standard" shows the show-all toggle, not the metric pickers', async () => {
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-widget-medium-show-all')).toHaveLength(1);
    expect(byTestId(tree, 'health-widget-medium-primary-steps')).toHaveLength(0);
    expect(byTestId(tree, 'health-widget-medium-secondary-steps')).toHaveLength(0);
  });

  it('HEALTH-WIDGETSET-027: "dual" shows the two metric pickers, not the show-all toggle', async () => {
    mockLoad.mockResolvedValue({ ...DEFAULT_HEALTH_WIDGET_PREFERENCES, medium_widget_layout: 'dual' });
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-widget-medium-show-all')).toHaveLength(0);
    for (const key of MEDIUM_WIDGET_METRIC_OPTIONS) {
      expect(byTestId(tree, `health-widget-medium-primary-${key}`)).toHaveLength(1);
      expect(byTestId(tree, `health-widget-medium-secondary-${key}`)).toHaveLength(1);
    }
  });

  it('HEALTH-WIDGETSET-028: "grid" shows neither the show-all toggle nor the metric pickers', async () => {
    mockLoad.mockResolvedValue({ ...DEFAULT_HEALTH_WIDGET_PREFERENCES, medium_widget_layout: 'grid' });
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-widget-medium-show-all')).toHaveLength(0);
    expect(byTestId(tree, 'health-widget-medium-primary-steps')).toHaveLength(0);
  });

  it('HEALTH-WIDGETSET-029: layout / primary / secondary / show-all each patch ONLY their own field', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'health-widget-medium-layout-dual').props.onPress();
    });
    expect(mockSave).toHaveBeenLastCalledWith({ medium_widget_layout: 'dual' });

    // The default `mockSave` merges a patch onto `DEFAULT_HEALTH_WIDGET_PREFERENCES`
    // (fine for every other test here, which only ever changes one field from
    // its shipped default) — that would silently flip `medium_widget_layout`
    // back to "standard" on the very first patch below and hide the pickers
    // this test is exercising. Merge onto the DUAL base instead, mirroring the
    // real PUT route's actual merge-onto-CURRENT-row semantics.
    const dualBase = { ...DEFAULT_HEALTH_WIDGET_PREFERENCES, medium_widget_layout: 'dual' as const };
    mockLoad.mockResolvedValue(dualBase);
    mockSave.mockImplementation(async (patch: Partial<HealthWidgetPreferences>) => ({
      preferences: { ...dualBase, ...patch },
      status: 'saved',
      message: null,
    }));
    const dualTree = await renderScreen();
    mockSave.mockClear();
    await act(async () => {
      dualTree.root
        .find((n) => n.props?.testID === 'health-widget-medium-primary-water')
        .props.onPress();
    });
    expect(mockSave).toHaveBeenCalledWith({ medium_primary_metric: 'water' });
    expect(Object.keys(mockSave.mock.calls[0][0])).toEqual(['medium_primary_metric']);

    mockSave.mockClear();
    await act(async () => {
      dualTree.root
        .find((n) => n.props?.testID === 'health-widget-medium-secondary-workout')
        .props.onPress();
    });
    expect(mockSave).toHaveBeenCalledWith({ medium_secondary_metric: 'workout' });
    expect(Object.keys(mockSave.mock.calls[0][0])).toEqual(['medium_secondary_metric']);

    mockLoad.mockResolvedValue(DEFAULT_HEALTH_WIDGET_PREFERENCES);
    mockSave.mockImplementation(async (patch: Partial<HealthWidgetPreferences>) => ({
      preferences: { ...DEFAULT_HEALTH_WIDGET_PREFERENCES, ...patch },
      status: 'saved',
      message: null,
    }));
    const standardTree = await renderScreen();
    mockSave.mockClear();
    await act(async () => {
      standardTree.root
        .find((n) => n.props?.testID === 'health-widget-medium-show-all')
        .props.onValueChange(false);
    });
    expect(mockSave).toHaveBeenCalledWith({ medium_show_all_metrics: false });
    expect(Object.keys(mockSave.mock.calls[0][0])).toEqual(['medium_show_all_metrics']);
  });
});

describe('HealthWidgetSettingsScreen — the three section toggles', () => {
  it.each([
    ['health-widget-show-weight', 'show_weight'],
    ['health-widget-show-nutrition', 'show_nutrition'],
    ['health-widget-show-workouts', 'show_workouts'],
  ])('HEALTH-WIDGETSET-030: %s patches ONLY %s', async (testID, field) => {
    const tree = await renderScreen();
    const toggle = tree.root.find((n) => n.props?.testID === testID);
    const next = !toggle.props.value;

    await act(async () => {
      toggle.props.onValueChange(next);
    });

    expect(mockSave).toHaveBeenCalledWith({ [field]: next });
    expect(Object.keys(mockSave.mock.calls[0][0])).toEqual([field]);
  });

  it('HEALTH-WIDGETSET-031: every toggle is disabled while a write is in flight', async () => {
    let resolveSave!: (value: unknown) => void;
    mockSave.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    const tree = await renderScreen();
    const toggle = () => tree.root.find((n) => n.props?.testID === 'health-widget-show-weight');

    act(() => {
      toggle().props.onValueChange(false);
    });
    expect(toggle().props.disabled).toBe(true);

    await act(async () => {
      resolveSave({
        preferences: { ...DEFAULT_HEALTH_WIDGET_PREFERENCES, show_weight: false },
        status: 'saved',
        message: null,
      });
    });
    expect(toggle().props.disabled).toBe(false);
  });
});

describe('HealthWidgetSettingsScreen — chart section', () => {
  it('HEALTH-WIDGETSET-040: explains itself differently depending on show_weight', async () => {
    const withWeight = await renderScreen();
    expect(allText(withWeight.toJSON())).toContain('How the weekly chart is drawn.');
    expect(allText(withWeight.toJSON())).not.toContain('it appears once');

    mockLoad.mockResolvedValue({ ...DEFAULT_HEALTH_WIDGET_PREFERENCES, show_weight: false });
    const withoutWeight = await renderScreen();
    expect(allText(withoutWeight.toJSON())).toContain(
      'How the weekly chart is drawn — it appears once "Weight and trends" is on.'
    );
  });

  it('HEALTH-WIDGETSET-041: chart TYPE and chart METRIC each patch only their own field', async () => {
    const tree = await renderScreen();

    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'health-widget-chart-type-line').props.onPress();
    });
    expect(mockSave).toHaveBeenCalledWith({ chart_type: 'line' });

    mockSave.mockClear();
    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'health-widget-chart-metric-both').props.onPress();
    });
    expect(mockSave).toHaveBeenCalledWith({ chart_metric: 'both' });
  });

  it('HEALTH-WIDGETSET-042: every declared chart type and metric option renders', async () => {
    const tree = await renderScreen();
    for (const key of WIDGET_CHART_TYPE_OPTIONS) {
      expect(byTestId(tree, `health-widget-chart-type-${key}`)).toHaveLength(1);
    }
    for (const key of WIDGET_CHART_METRIC_OPTIONS) {
      expect(byTestId(tree, `health-widget-chart-metric-${key}`)).toHaveLength(1);
    }
  });
});

describe('HealthWidgetSettingsScreen — message + privacy copy', () => {
  it('HEALTH-WIDGETSET-050: an offline save shows the offline copy', async () => {
    mockSave.mockResolvedValue({
      preferences: { ...DEFAULT_HEALTH_WIDGET_PREFERENCES, show_nutrition: false },
      status: 'offline',
      message: 'Saved on this device — your widget will update when you are back online.',
    });
    const tree = await renderScreen();

    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'health-widget-show-nutrition').props.onValueChange(false);
    });

    expect(byTestId(tree, 'health-widget-message')).toHaveLength(1);
    expect(allText(tree.toJSON())).toContain('your widget will update when you are back online');
  });

  it('HEALTH-WIDGETSET-051: no message node before any write happens', async () => {
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-widget-message')).toHaveLength(0);
  });

  it('HEALTH-WIDGETSET-052: states the lock-screen privacy line — never a photo, cycle or vitality record', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('On a locked screen');
    expect(text).toMatch(/never sent to it/);
  });
});

describe('HealthWidgetSettingsScreen — back navigation (HealthSettingsShell)', () => {
  it('HEALTH-WIDGETSET-060: goes back when the router CAN go back', async () => {
    mockCanGoBack = true;
    const tree = await renderScreen();
    act(() => {
      tree.root.find((n) => n.props?.testID === 'health-widget-screen-back').props.onPress();
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('HEALTH-WIDGETSET-061: replaces with /settings when there is nowhere to go back to', async () => {
    mockCanGoBack = false;
    const tree = await renderScreen();
    act(() => {
      tree.root.find((n) => n.props?.testID === 'health-widget-screen-back').props.onPress();
    });
    expect(mockReplace).toHaveBeenCalledWith('/settings');
    expect(mockBack).not.toHaveBeenCalled();
  });
});
