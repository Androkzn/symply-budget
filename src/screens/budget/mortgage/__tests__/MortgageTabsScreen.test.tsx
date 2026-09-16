/**
 * MortgageTabsScreen — the "Customize tabs" editor reached from Mortgage
 * settings. Covers the behaviour the strip depends on: every tab is listed with
 * a drag handle, Overview is locked (no hide affordance), hiding/showing moves a
 * tab between the two lists, a drag persists the new order, Save writes the
 * whole order + hidden set to the store and pops, and Reset restores defaults.
 * `react-native-draggable-flatlist` is replaced with a list that exposes its
 * `onDragEnd` so reordering is testable without a real gesture.
 */

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
    ScreenHeader: ({
      onBackPress,
      rightElement,
    }: {
      onBackPress?: () => void;
      rightElement?: React.ReactNode;
    }) => React.createElement(View, { testID: 'screen-header', onPress: onBackPress }, rightElement),
    // Surfaces `disabled` as its own testID so the suite can assert the Save
    // affordance's state without depending on how RN forwards a11y props.
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
    }) =>
      React.createElement(
        View,
        { testID: disabled ? `${testID}-disabled` : testID, onPress },
        label
      ),
    screenScrollViewStyle: { scroll: {} },
  };
});

// A drag-free stand-in: renders each row through `renderItem` and hands the
// suite the list's `onDragEnd` so a reorder can be simulated directly.
jest.mock('react-native-draggable-flatlist', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({
      data,
      renderItem,
      keyExtractor,
      onDragEnd,
      testID,
    }: {
      data: Array<{ id: string }>;
      renderItem: (p: unknown) => React.ReactNode;
      keyExtractor: (i: { id: string }) => string;
      onDragEnd?: (p: { data: Array<{ id: string }> }) => void;
      testID?: string;
    }) =>
      React.createElement(
        View,
        { testID, onDragEnd },
        data.map((item) =>
          React.createElement(
            React.Fragment,
            { key: keyExtractor(item) },
            renderItem({ item, drag: jest.fn(), isActive: false })
          )
        )
      ),
    ScaleDecorator: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
  };
});

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack }),
}));

jest.mock('expo-haptics', () => ({
  __esModule: true,
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

const mockShowToast = jest.fn();
jest.mock('@services/toastManager', () => ({
  __esModule: true,
  showToast: (...a: unknown[]) => mockShowToast(...a),
}));

const mockSetLayout = jest.fn();
const mockResetLayout = jest.fn();
let mockOrder: string[] | null = null;
let mockHidden: string[] = [];
jest.mock('@stores/mortgageStore', () => ({
  useMortgageStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      subTabOrder: mockOrder,
      hiddenSubTabs: mockHidden,
      setSubTabLayout: mockSetLayout,
      resetSubTabLayout: mockResetLayout,
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { DEFAULT_MORTGAGE_TAB_ORDER, getMortgageTab } from '../mortgageTabs';
import { MortgageTabsScreen } from '../MortgageTabsScreen';

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <MortgageTabsScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

const has = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  tree.root.findAllByProps({ testID }).length > 0;

const press = async (tree: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  await act(async () => {
    tree.root.findByProps({ testID }).props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOrder = null;
  mockHidden = [];
});

describe('MortgageTabsScreen', () => {
  it('lists every tab as a reorderable row', async () => {
    const tree = await render();
    DEFAULT_MORTGAGE_TAB_ORDER.forEach((id) => {
      expect(has(tree, `mortgage-tab-row-${id}`)).toBe(true);
    });
    expect(has(tree, 'mortgage-tabs-hidden')).toBe(false);
  });

  it('offers no hide affordance for the locked Overview tab', async () => {
    const tree = await render();
    expect(has(tree, 'mortgage-tab-hide-overview')).toBe(false);
    expect(has(tree, 'mortgage-tab-hide-schedule')).toBe(true);
  });

  it('moves a tab to Hidden and back', async () => {
    const tree = await render();

    await press(tree, 'mortgage-tab-hide-schedule');
    expect(has(tree, 'mortgage-tabs-hidden')).toBe(true);
    expect(has(tree, 'mortgage-tab-show-schedule')).toBe(true);
    expect(has(tree, 'mortgage-tab-row-schedule')).toBe(false);

    await press(tree, 'mortgage-tab-show-schedule');
    expect(has(tree, 'mortgage-tab-row-schedule')).toBe(true);
    expect(has(tree, 'mortgage-tabs-hidden')).toBe(false);
  });

  it('keeps Save disabled until the layout actually changes', async () => {
    const tree = await render();
    expect(has(tree, 'mortgage-tabs-save-disabled')).toBe(true);
    await press(tree, 'mortgage-tab-hide-equity');
    expect(has(tree, 'mortgage-tabs-save-disabled')).toBe(false);
    expect(has(tree, 'mortgage-tabs-save')).toBe(true);
  });

  it('saves the full order plus the hidden set, then pops', async () => {
    const tree = await render();
    await press(tree, 'mortgage-tab-hide-equity');
    await press(tree, 'mortgage-tab-hide-renew');
    await press(tree, 'mortgage-tabs-save');

    const [order, hidden] = mockSetLayout.mock.calls[0];
    expect(hidden).toEqual(['renew', 'equity']);
    // Hidden ids stay in the persisted order (at the end) so re-showing one
    // later restores it rather than losing its place entirely.
    expect(order).toEqual([
      'overview',
      'payments',
      'forecast',
      'schedule',
      'renewal',
      'statements',
      'history',
      'renew',
      'equity',
    ]);
    expect(mockShowToast).toHaveBeenCalledWith('success', 'Mortgage tabs updated');
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('persists a drag-reordered strip', async () => {
    const tree = await render();
    const order = ['forecast', 'overview', 'payments', 'equity', 'schedule', 'renewal',
      'statements', 'renew', 'history'];
    const reordered = order.map((id) => getMortgageTab(id)!);

    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-tabs-shown' }).props.onDragEnd({ data: reordered });
    });
    await press(tree, 'mortgage-tabs-save');

    expect(mockSetLayout).toHaveBeenCalledWith(order, []);
  });

  it('starts from the persisted layout', async () => {
    mockOrder = ['history', 'overview', 'payments', 'equity', 'forecast', 'schedule', 'renewal',
      'statements', 'renew'];
    mockHidden = ['payments'];
    const tree = await render();

    expect(has(tree, 'mortgage-tab-show-payments')).toBe(true);
    expect(has(tree, 'mortgage-tab-row-payments')).toBe(false);
    expect(has(tree, 'mortgage-tab-row-history')).toBe(true);
  });

  it('restores the default strip through the confirm alert', async () => {
    mockOrder = DEFAULT_MORTGAGE_TAB_ORDER.slice();
    mockHidden = ['equity', 'schedule'];
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(((_t, _m, buttons?: Array<{ style?: string; onPress?: () => void }>) => {
        buttons?.find((b) => b.style === 'destructive')?.onPress?.();
      }) as typeof Alert.alert);

    const tree = await render();
    expect(has(tree, 'mortgage-tabs-hidden')).toBe(true);

    await press(tree, 'mortgage-tabs-reset');
    expect(mockResetLayout).toHaveBeenCalled();
    expect(has(tree, 'mortgage-tabs-hidden')).toBe(false);
    DEFAULT_MORTGAGE_TAB_ORDER.forEach((id) => {
      expect(has(tree, `mortgage-tab-row-${id}`)).toBe(true);
    });
    alertSpy.mockRestore();
  });
});
