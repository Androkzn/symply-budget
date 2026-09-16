/**
 * MortgageStatementsScreen — the "clean / edit any data manually" surface for a
 * property. This suite verifies it lists the property's statements, routes to
 * the form to ADD and to EDIT (passing the statement through), DELETES one via
 * the confirm alert, and CLEARS ALL statements (looping the delete). Nav/focus
 * hooks + the `@components/common` barrel are stubbed; real UI renders under
 * ThemeProvider.
 */

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
    // Renders `rightElement` so the header's "Add a statement" action is
    // reachable from the tests (it moved out of the scroll body).
    ScreenHeader: ({
      onBackPress,
      rightElement,
    }: {
      onBackPress?: () => void;
      rightElement?: React.ReactNode;
    }) =>
      React.createElement(
        View,
        { testID: 'screen-header', onPress: onBackPress },
        rightElement ?? null
      ),
    HeaderActionButton: ({
      onPress,
      testID,
      children,
      label,
    }: {
      onPress?: () => void;
      testID?: string;
      children?: React.ReactNode;
      label?: string;
    }) => React.createElement(View, { testID, onPress }, children ?? label ?? null),
    screenScrollViewStyle: { scroll: {} },
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
// jest.config maps `expo-router/react-navigation` → `@react-navigation/native`
// (same module), so this single mock must cover useNavigation + useRoute +
// useFocusEffect (the screen pulls the first two from `@react-navigation/native`
// and the last from `expo-router/react-navigation`, which resolve identically).
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { mortgageId: 'm-1' } }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb]);
  },
}));

const mockListStatements = jest.fn();
const mockDeleteStatement = jest.fn();
jest.mock('@api/mortgage', () => ({
  __esModule: true,
  mortgageApi: {
    listStatements: (...a: unknown[]) => mockListStatements(...a),
    deleteStatement: (...a: unknown[]) => mockDeleteStatement(...a),
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-1' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

const mockMarkDirty = jest.fn();
jest.mock('@stores/mortgageStore', () => ({
  useMortgageStore: (sel?: (s: unknown) => unknown) => {
    const s = { markDirty: mockMarkDirty };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { MortgageStatementsScreen } from '../MortgageStatementsScreen';

const STATEMENTS = [
  {
    id: 's-1',
    mortgage_id: 'm-1',
    statement_date: '2026-03-31',
    closing_balance_cents: 47_000_000,
    opening_balance_cents: null,
    interest_paid_cents: 200_000,
    principal_paid_cents: 90_000,
    payment_amount_cents: 290_000,
    interest_rate_bps: 500,
    source: 'manual',
    created_at: '2026-03-31T00:00:00Z',
  },
  {
    id: 's-2',
    mortgage_id: 'm-1',
    statement_date: '2026-02-28',
    closing_balance_cents: 47_500_000,
    opening_balance_cents: null,
    interest_paid_cents: null,
    principal_paid_cents: null,
    payment_amount_cents: null,
    interest_rate_bps: null,
    source: 'camera',
    created_at: '2026-02-28T00:00:00Z',
  },
  {
    id: 's-3',
    mortgage_id: 'm-1',
    statement_date: '2026-01-31',
    closing_balance_cents: 48_000_000,
    opening_balance_cents: null,
    interest_paid_cents: null,
    principal_paid_cents: null,
    payment_amount_cents: null,
    interest_rate_bps: null,
    source: 'google_drive',
    created_at: '2026-01-31T00:00:00Z',
  },
];

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <MortgageStatementsScreen />
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
  mockListStatements.mockResolvedValue({ statements: STATEMENTS });
  mockDeleteStatement.mockResolvedValue(undefined);
});

describe('MortgageStatementsScreen', () => {
  it('lists the property statements (balance + month/year + source)', async () => {
    const tree = await render();
    expect(mockListStatements).toHaveBeenCalledWith('hh-1', 'm-1');
    const text = allText(tree.root);
    expect(text).toContain('$470,000');
    expect(text).toContain('March 2026'); // statement_date 2026-03-31 → "March 2026"
    expect(text).not.toContain('2026-03-31'); // raw date no longer shown
    expect(text).toContain('Manual');
    expect(text).toContain('Scanned'); // camera → Scanned
  });

  it('puts the add action in the header and the origin in a toned pill', async () => {
    const tree = await render();

    // "Add a statement" is a header right-element now, not a body button.
    const header = tree.root.findByProps({ testID: 'screen-header' });
    expect(header.findAllByProps({ testID: 'mortgage-statements-add' }).length).toBeGreaterThan(0);

    // Each origin renders as a tinted pill beside the month instead of a third
    // plain-caption line under the balance — and each origin gets its own hue.
    const pill = (id: string) => tree.root.findByProps({ testID: `mortgage-statement-source-${id}` });
    // The pill's fill lives on the rendered View, not on the composite wrapper.
    const bgOf = (id: string) => {
      const view = pill(id).findAll((n) => n.props?.style !== undefined)[0];
      return StyleSheet.flatten(view.props.style).backgroundColor as string;
    };

    expect(allText(pill('s-1'))).toContain('Manual');
    expect(allText(pill('s-2'))).toContain('Scanned');
    expect(allText(pill('s-3'))).toContain('Drive');

    const tones = [bgOf('s-1'), bgOf('s-2'), bgOf('s-3')];
    tones.forEach((bg) => expect(bg).toMatch(/^rgba\(/)); // tinted fill, not transparent
    expect(new Set(tones).size).toBe(3); // manual / scanned / drive each differ
  });

  it('routes to the form to add and to edit (passing the statement)', async () => {
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-statements-add' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageStatementForm', { mortgageId: 'm-1' });

    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-statement-edit-s-1' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageStatementForm', {
      mortgageId: 'm-1',
      statement: STATEMENTS[0],
    });
  });

  it('deletes a single statement through the confirm alert and reloads', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(((_t, _m, buttons?: Array<{ style?: string; onPress?: () => void }>) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    }) as typeof Alert.alert);

    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-statement-delete-s-1' }).props.onPress();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(mockDeleteStatement).toHaveBeenCalledWith('hh-1', 'm-1', 's-1');
    expect(mockMarkDirty).toHaveBeenCalled();
    expect(mockListStatements).toHaveBeenCalledTimes(2); // initial + after delete
    alertSpy.mockRestore();
  });

  it('clears all statements (deletes every row) via the confirm alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(((_t, _m, buttons?: Array<{ style?: string; onPress?: () => void }>) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    }) as typeof Alert.alert);

    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-statements-clear' }).props.onPress();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });

    expect(mockDeleteStatement).toHaveBeenCalledWith('hh-1', 'm-1', 's-1');
    expect(mockDeleteStatement).toHaveBeenCalledWith('hh-1', 'm-1', 's-2');
    expect(mockMarkDirty).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('shows the empty state when the property has no statements', async () => {
    mockListStatements.mockResolvedValue({ statements: [] });
    const tree = await render();
    expect(tree.root.findAllByProps({ testID: 'mortgage-statements-empty' }).length).toBeGreaterThan(0);
    expect(allText(tree.root)).toContain('No statements yet');
    // The empty state keeps its own CTA so a first-run screen isn't relying
    // solely on the header icon.
    const cta = tree.root.findAllByProps({ testID: 'mortgage-statements-add-empty' });
    expect(cta.length).toBeGreaterThan(0);
    await act(async () => {
      cta[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageStatementForm', { mortgageId: 'm-1' });
  });
});
