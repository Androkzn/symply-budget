/**
 * MortgageSettingsScreen — the property-management hub reached from the header
 * gear on the Mortgage tab. This suite drives the core new behaviour: it lists
 * the household's mortgages (properties) from `mortgageApi.list`, marks the
 * selected/active one, SWITCHES the active property on tap (store +
 * markDirty), navigates to Edit / Statements / Setup, and DELETES a property
 * through the confirm alert (clearing the selection when the deleted one was
 * active). The heavy `@components/common` barrel + navigation/focus hooks are
 * stubbed; the real UI primitives render under ThemeProvider.
 */

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
    ScreenHeader: ({ onBackPress }: { onBackPress?: () => void }) =>
      React.createElement(View, { testID: 'screen-header', onPress: onBackPress }),
    screenScrollViewStyle: { scroll: {} },
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
// jest.config maps `expo-router/react-navigation` → `@react-navigation/native`
// (same module), so BOTH the screen's `useNavigation` and its `useFocusEffect`
// must be provided by this single mock.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb]);
  },
}));

const mockList = jest.fn();
const mockRemove = jest.fn();
jest.mock('@api/mortgage', () => ({
  __esModule: true,
  mortgageApi: {
    list: (...a: unknown[]) => mockList(...a),
    remove: (...a: unknown[]) => mockRemove(...a),
  },
}));

let mockCurrentHousehold: { id: string } | null = { id: 'hh-1' };
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: mockCurrentHousehold };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

const mockSetSelected = jest.fn();
const mockMarkDirty = jest.fn();
let mockSelectedId: string | null = null;
jest.mock('@stores/mortgageStore', () => ({
  useMortgageStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      selectedMortgageId: mockSelectedId,
      setSelectedMortgage: mockSetSelected,
      markDirty: mockMarkDirty,
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { MortgageSettingsScreen } from '../MortgageSettingsScreen';

const PROPERTIES = [
  {
    id: 'm-1',
    nickname: 'Main home',
    lender: 'TD',
    productType: 'standard',
    currentBalanceCents: 48_000_000,
    pctPaid: 0.04,
    nextRenewalDate: '2030-01-01',
    isActive: true,
  },
  {
    id: 'm-2',
    nickname: 'Cottage',
    lender: null,
    productType: 'standard',
    currentBalanceCents: 20_000_000,
    pctPaid: 0.5,
    nextRenewalDate: null,
    isActive: true,
  },
];

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <MortgageSettingsScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

function allText(root: ReactTestRenderer.ReactTestInstance): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const inst = node as ReactTestRenderer.ReactTestInstance;
    if (inst && inst.children) walk(inst.children as unknown);
  };
  walk(root.children as unknown);
  return out.join(' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentHousehold = { id: 'hh-1' };
  mockSelectedId = null;
  mockList.mockResolvedValue({ mortgages: PROPERTIES });
  mockRemove.mockResolvedValue(undefined);
});

describe('MortgageSettingsScreen', () => {
  it('lists the household properties with balance + %-paid meta', async () => {
    const tree = await render();
    expect(mockList).toHaveBeenCalledWith('hh-1');
    const text = allText(tree.root);
    expect(text).toContain('Main home');
    expect(text).toContain('Cottage');
    expect(text).toContain('$480,000'); // 48,000,000 cents
    expect(text).toContain('4% paid');
    expect(text).toContain('50% paid');
    // Every property exposes edit / statements / delete affordances.
    expect(tree.root.findAllByProps({ testID: 'mortgage-property-edit-m-1' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'mortgage-property-statements-m-1' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'mortgage-property-delete-m-1' }).length).toBeGreaterThan(0);
  });

  it('marks the first property active when nothing is explicitly selected', async () => {
    const tree = await render();
    expect(tree.root.findAllByProps({ testID: 'mortgage-property-selected-m-1' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'mortgage-property-selected-m-2' }).length).toBe(0);
  });

  it('switches the active property (store + markDirty) when a row is tapped', async () => {
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-property-row-m-2' }).props.onPress();
    });
    expect(mockSetSelected).toHaveBeenCalledWith('m-2');
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('navigates to edit, statements and setup', async () => {
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-property-edit-m-1' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageEdit', { mortgageId: 'm-1' });

    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-property-statements-m-2' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageStatements', { mortgageId: 'm-2' });

    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-settings-add' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageSetup');
  });

  it('deletes a property through the confirm alert and clears the selection when it was active', async () => {
    mockSelectedId = 'm-1';
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(((_t, _m, buttons?: Array<{ style?: string; onPress?: () => void }>) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    }) as typeof Alert.alert);

    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-property-delete-m-1' }).props.onPress();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(mockRemove).toHaveBeenCalledWith('hh-1', 'm-1');
    expect(mockSetSelected).toHaveBeenCalledWith(null);
    expect(mockMarkDirty).toHaveBeenCalled();
    // Reloads the list after the delete.
    expect(mockList).toHaveBeenCalledTimes(2);
    alertSpy.mockRestore();
  });

  it('shows the empty state (with an add CTA) when there are no properties', async () => {
    mockList.mockResolvedValue({ mortgages: [] });
    const tree = await render();
    expect(tree.root.findAllByProps({ testID: 'mortgage-settings-empty' }).length).toBeGreaterThan(0);
    expect(allText(tree.root)).toContain('No properties yet');
  });

  it('opens the tab customizer — offered with or without a property', async () => {
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-settings-customize-tabs' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageTabs');

    mockList.mockResolvedValue({ mortgages: [] });
    const empty = await render();
    expect(
      empty.root.findAllByProps({ testID: 'mortgage-settings-customize-tabs' }).length
    ).toBeGreaterThan(0);
  });
});
